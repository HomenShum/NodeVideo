import { type EditPlan, validateEditPlan } from './edit-contracts.ts';

export const ACTIVE_EDITORIAL_PROFILE_SCHEMA_VERSION =
  'nodevideo.active-editorial-profile.v1' as const;

export type EditorialCueRole = 'attention' | 'identity';
export type EditorialCueAnimation = 'none' | 'fade' | 'pop' | 'slide-up';

export interface ActiveEditorialProfile {
  schemaVersion: typeof ACTIVE_EDITORIAL_PROFILE_SCHEMA_VERSION;
  id: string;
  version: number;
  activatedAt: string;
  activationApprovalId: string;
  overlayPolicy: {
    allowedRoles: EditorialCueRole[];
    allowedAnimations: EditorialCueAnimation[];
    allowedTemplateIds: string[];
    maxBodyOverlapRatio: number;
    minimumFontSizePx: number;
    requireCausalProof: true;
  };
  profileDigest: `sha256:${string}`;
}

export interface GovernedTimedCue {
  id: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  role?: EditorialCueRole;
  animation?: EditorialCueAnimation;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_POLICY_VALUES = 32;
const MAX_CUES_PER_RENDER = 512;
const PLANNING_BODY_OVERLAP_BUDGET_RATIO = 0.9;

export function validateActiveEditorialProfile(
  value: unknown,
): asserts value is ActiveEditorialProfile {
  assert(isRecord(value), 'ActiveEditorialProfile must be an object.');
  assertExactKeys(value, 'ActiveEditorialProfile', [
    'schemaVersion',
    'id',
    'version',
    'activatedAt',
    'activationApprovalId',
    'overlayPolicy',
    'profileDigest',
  ]);
  assert(
    value.schemaVersion === ACTIVE_EDITORIAL_PROFILE_SCHEMA_VERSION,
    'ActiveEditorialProfile schema is unsupported.',
  );
  assertId(value.id, 'ActiveEditorialProfile.id');
  assertInteger(value.version, 'ActiveEditorialProfile.version', 1);
  assertIsoTimestamp(value.activatedAt, 'ActiveEditorialProfile.activatedAt');
  assertId(value.activationApprovalId, 'ActiveEditorialProfile.activationApprovalId');
  assert(
    typeof value.profileDigest === 'string' && DIGEST_PATTERN.test(value.profileDigest),
    'ActiveEditorialProfile.profileDigest must be a canonical sha256 digest.',
  );

  const policy = value.overlayPolicy;
  assert(isRecord(policy), 'ActiveEditorialProfile.overlayPolicy must be an object.');
  assertExactKeys(policy, 'ActiveEditorialProfile.overlayPolicy', [
    'allowedRoles',
    'allowedAnimations',
    'allowedTemplateIds',
    'maxBodyOverlapRatio',
    'minimumFontSizePx',
    'requireCausalProof',
  ]);
  assertEnumArray(
    policy.allowedRoles,
    ['attention', 'identity'],
    'ActiveEditorialProfile.overlayPolicy.allowedRoles',
  );
  assertEnumArray(
    policy.allowedAnimations,
    ['none', 'fade', 'pop', 'slide-up'],
    'ActiveEditorialProfile.overlayPolicy.allowedAnimations',
  );
  assertIdArray(
    policy.allowedTemplateIds,
    'ActiveEditorialProfile.overlayPolicy.allowedTemplateIds',
  );
  assert(
    typeof policy.maxBodyOverlapRatio === 'number' &&
      Number.isFinite(policy.maxBodyOverlapRatio) &&
      policy.maxBodyOverlapRatio >= 0 &&
      policy.maxBodyOverlapRatio <= 0.05,
    'ActiveEditorialProfile.overlayPolicy.maxBodyOverlapRatio must be between 0 and 0.05.',
  );
  assertInteger(
    policy.minimumFontSizePx,
    'ActiveEditorialProfile.overlayPolicy.minimumFontSizePx',
    12,
  );
  assert(
    policy.minimumFontSizePx <= 256,
    'ActiveEditorialProfile.overlayPolicy.minimumFontSizePx must be at most 256.',
  );
  assert(
    policy.requireCausalProof === true,
    'ActiveEditorialProfile.overlayPolicy.requireCausalProof must be true.',
  );
}

export async function digestActiveEditorialProfile(
  profile: ActiveEditorialProfile,
): Promise<`sha256:${string}`> {
  validateActiveEditorialProfile(profile);
  const { profileDigest: _ignored, ...payload } = profile;
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `sha256:${hex}`;
}

export async function assertActiveEditorialProfileDigest(
  profile: ActiveEditorialProfile,
): Promise<void> {
  const actual = await digestActiveEditorialProfile(profile);
  assert(
    actual === profile.profileDigest,
    `ActiveEditorialProfile digest mismatch: expected ${profile.profileDigest}, computed ${actual}.`,
  );
}

export function assertActiveEditorialProfilesMatch(
  supplied: ActiveEditorialProfile,
  embedded: ActiveEditorialProfile,
): void {
  validateActiveEditorialProfile(supplied);
  validateActiveEditorialProfile(embedded);
  assert(embedded.id === supplied.id, 'Embedded editorial profile ID mismatch.');
  assert(
    embedded.profileDigest === supplied.profileDigest,
    'Embedded editorial profile digest mismatch.',
  );
  assert(
    embedded.activationApprovalId === supplied.activationApprovalId,
    'Embedded editorial-profile approval mismatch.',
  );
}

export function validateGovernedTimedCues(
  profile: ActiveEditorialProfile,
  cues: readonly GovernedTimedCue[],
  requestedMaxBodyOverlapRatio: number,
): void {
  validateActiveEditorialProfile(profile);
  assert(Array.isArray(cues), 'Governed overlay cues must be an array.');
  assert(
    cues.length > 0 && cues.length <= MAX_CUES_PER_RENDER,
    `Governed overlay requests require 1 to ${MAX_CUES_PER_RENDER} cues.`,
  );
  assert(
    Number.isFinite(requestedMaxBodyOverlapRatio) &&
      requestedMaxBodyOverlapRatio >= 0 &&
      requestedMaxBodyOverlapRatio <= profile.overlayPolicy.maxBodyOverlapRatio,
    'Requested body-overlap threshold exceeds the active editorial profile.',
  );
  const ids = new Set<string>();
  for (const [index, cue] of cues.entries()) {
    assert(isRecord(cue), `cues[${index}] must be an object.`);
    assertId(cue.id, `cues[${index}].id`);
    assert(!ids.has(cue.id), `Duplicate governed cue: ${cue.id}.`);
    ids.add(cue.id);
    assert(
      typeof cue.text === 'string' && cue.text.trim().length > 0 && cue.text.length <= 280,
      `cues[${index}].text is invalid.`,
    );
    assert(
      Number.isFinite(cue.startSeconds) && cue.startSeconds >= 0,
      `cues[${index}].startSeconds is invalid.`,
    );
    assert(
      Number.isFinite(cue.endSeconds) && cue.endSeconds > cue.startSeconds,
      `cues[${index}] must have positive duration.`,
    );
    const role = cue.role ?? 'attention';
    const animation = cue.animation ?? 'none';
    assert(
      profile.overlayPolicy.allowedRoles.includes(role),
      `cues[${index}].role is not allowed by the active editorial profile.`,
    );
    assert(
      profile.overlayPolicy.allowedAnimations.includes(animation),
      `cues[${index}].animation is not allowed by the active editorial profile.`,
    );
  }
}

export function planningBodyOverlapRatio(
  requestedMaxBodyOverlapRatio: number,
  profileMaxBodyOverlapRatio: number,
): number {
  assert(
    Number.isFinite(requestedMaxBodyOverlapRatio) && requestedMaxBodyOverlapRatio >= 0,
    'Requested body-overlap threshold must be non-negative.',
  );
  assert(
    Number.isFinite(profileMaxBodyOverlapRatio) && profileMaxBodyOverlapRatio >= 0,
    'Profile body-overlap threshold must be non-negative.',
  );
  return Math.min(
    requestedMaxBodyOverlapRatio,
    profileMaxBodyOverlapRatio * PLANNING_BODY_OVERLAP_BUDGET_RATIO,
  );
}

export async function bindActiveEditorialProfile(
  plan: EditPlan,
  profile: ActiveEditorialProfile,
): Promise<EditPlan> {
  validateEditPlan(plan);
  await assertActiveEditorialProfileDigest(profile);
  const output = structuredClone(plan);
  output.lineage.activeEditorialProfile = {
    profileId: profile.id,
    profileDigest: profile.profileDigest,
    activationApprovalId: profile.activationApprovalId,
  };
  output.lineage.decisionArtifactIds = [
    ...new Set([...(output.lineage.decisionArtifactIds ?? []), profile.id]),
  ];
  validateEditPlan(output);
  return output;
}

export function assertPlanUsesActiveEditorialProfile(
  plan: EditPlan,
  profile: ActiveEditorialProfile,
): void {
  validateEditPlan(plan);
  validateActiveEditorialProfile(profile);
  const binding = plan.lineage.activeEditorialProfile;
  assert(binding !== undefined, 'EditPlan is missing its active editorial profile binding.');
  assert(binding.profileId === profile.id, 'EditPlan active editorial profile ID mismatch.');
  assert(
    binding.profileDigest === profile.profileDigest,
    'EditPlan active editorial profile digest mismatch.',
  );
  assert(
    binding.activationApprovalId === profile.activationApprovalId,
    'EditPlan editorial-profile approval mismatch.',
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function assertEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): asserts value is T[] {
  assert(Array.isArray(value), `${label} must be an array.`);
  assert(value.length > 0 && value.length <= MAX_POLICY_VALUES, `${label} is not bounded.`);
  const unique = new Set(value);
  assert(unique.size === value.length, `${label} contains duplicates.`);
  assert(
    value.every((item) => typeof item === 'string' && allowed.includes(item as T)),
    `${label} is invalid.`,
  );
}

function assertIdArray(value: unknown, label: string): asserts value is string[] {
  assert(Array.isArray(value), `${label} must be an array.`);
  assert(value.length > 0 && value.length <= MAX_POLICY_VALUES, `${label} is not bounded.`);
  const unique = new Set(value);
  assert(unique.size === value.length, `${label} contains duplicates.`);
  value.forEach((item, index) => assertId(item, `${label}[${index}]`));
}

function assertExactKeys(value: Record<string, unknown>, label: string, keys: readonly string[]) {
  const expected = new Set(keys);
  for (const key of keys) assert(Object.hasOwn(value, key), `${label}.${key} is required.`);
  for (const key of Object.keys(value))
    assert(expected.has(key), `${label}.${key} is not allowed.`);
}

function assertId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && ID_PATTERN.test(value), `${label} is invalid.`);
}

function assertInteger(value: unknown, label: string, minimum: number): asserts value is number {
  assert(Number.isSafeInteger(value) && (value as number) >= minimum, `${label} is invalid.`);
}

function assertIsoTimestamp(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' && value.includes('T') && Number.isFinite(Date.parse(value)),
    `${label} must be an ISO timestamp.`,
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
