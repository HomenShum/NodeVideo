export const CREATOR_TASTE_PROFILE_SCHEMA_VERSION = 'nodevideo.creator-taste-profile.v1' as const;
export const PRODUCTION_AUDIT_SCHEMA_VERSION = 'nodevideo.production-audit.v1' as const;
export const TARGET_SPEC_CONSISTENCY_SCHEMA_VERSION =
  'nodevideo.target-spec-consistency.v1' as const;

export type ContentKind = 'dance' | 'talking-head' | 'tutorial' | 'comedy' | 'montage' | 'other';
export type VerticalZone = 'top' | 'middle' | 'bottom';
export type CueRole =
  | 'hook'
  | 'commentary'
  | 'instruction'
  | 'lyric'
  | 'identity'
  | 'cta'
  | 'end-card'
  | 'other';

export interface NormalizedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ObservedTextCue {
  text: string;
  role: CueRole;
  startMs: number;
  endMs: number;
  confidence: number;
  region: NormalizedRegion;
}

export interface ProductionAudit {
  schemaVersion: typeof PRODUCTION_AUDIT_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  durationMs: number;
  contentKind: ContentKind;
  evidenceArtifactIds: string[];
  observations: {
    textCues: ObservedTextCue[];
    cuts: Array<{ frame: number; confidence: number }>;
    visualTreatment?: {
      lumaMean: number;
      lumaStd: number;
      saturationMean: number;
    };
  };
  claimedTargetSpec?: {
    overlayCount: number;
    roles: CueRole[];
    persistentIdentity: boolean;
    endCard: boolean;
    visualTreatmentDescribed: boolean;
    verticalZones: VerticalZone[];
  };
}

export interface SupportedValue<T> {
  value: T;
  supportProductions: number;
  confidence: number;
  evidenceRefs: string[];
}

export interface CreatorTasteProfile {
  schemaVersion: typeof CREATOR_TASTE_PROFILE_SCHEMA_VERSION;
  id: string;
  learnedAt: string;
  sourceProductionIds: string[];
  applicableContentKinds: ContentKind[];
  confidence: number;
  editorialAttention: {
    textCuesPerMinute: SupportedValue<number>;
    hookInFirstThreeSecondsRate: SupportedValue<number>;
    endCardRate: SupportedValue<number>;
    preferredCueRoles: SupportedValue<CueRole[]>;
  };
  creatorVoice: {
    commentaryRate: SupportedValue<number>;
    instructionRate: SupportedValue<number>;
    lyricRate: SupportedValue<number>;
    ctaRate: SupportedValue<number>;
  };
  spatialGrammar: {
    roleZones: Array<{ role: CueRole; zone: VerticalZone; confidence: number; samples: number }>;
    persistentIdentityZone?: SupportedValue<VerticalZone>;
  };
  visualWorld?: {
    lumaMean: SupportedValue<number>;
    lumaStd: SupportedValue<number>;
    saturationMean: SupportedValue<number>;
  };
  distributionIdentity: {
    persistentIdentityRate: SupportedValue<number>;
    identityTokens: SupportedValue<string[]>;
  };
  cautions: string[];
}

export type ConsistencyStatus = 'pass' | 'fail' | 'insufficient-evidence';

export interface TargetSpecConsistencyReport {
  schemaVersion: typeof TARGET_SPEC_CONSISTENCY_SCHEMA_VERSION;
  auditId: string;
  status: ConsistencyStatus;
  score: number;
  checks: Array<{
    id: string;
    status: ConsistencyStatus;
    observed: string;
    claimed: string;
    message: string;
  }>;
  blockingReasons: string[];
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CONTENT_KINDS: readonly ContentKind[] = [
  'dance',
  'talking-head',
  'tutorial',
  'comedy',
  'montage',
  'other',
];
const CUE_ROLES: readonly CueRole[] = [
  'hook',
  'commentary',
  'instruction',
  'lyric',
  'identity',
  'cta',
  'end-card',
  'other',
];
const VERTICAL_ZONES: readonly VerticalZone[] = ['top', 'middle', 'bottom'];
const CONSISTENCY_STATUSES: readonly ConsistencyStatus[] = [
  'pass',
  'fail',
  'insufficient-evidence',
];

export function validateProductionAudit(value: unknown): asserts value is ProductionAudit {
  const audit = asRecord(value, 'ProductionAudit');
  assertExactKeys(
    audit,
    'ProductionAudit',
    [
      'schemaVersion',
      'id',
      'createdAt',
      'durationMs',
      'contentKind',
      'evidenceArtifactIds',
      'observations',
    ],
    ['claimedTargetSpec'],
  );
  assert(audit.schemaVersion === PRODUCTION_AUDIT_SCHEMA_VERSION, 'Unsupported audit schema.');
  assertId(audit.id, 'ProductionAudit.id');
  assertIsoTimestamp(audit.createdAt, 'ProductionAudit.createdAt');
  assertPositive(audit.durationMs, 'ProductionAudit.durationMs');
  assertOneOf(audit.contentKind, CONTENT_KINDS, 'ProductionAudit.contentKind');
  validateUniqueIds(audit.evidenceArtifactIds, 'ProductionAudit.evidenceArtifactIds');

  const observations = asRecord(audit.observations, 'ProductionAudit.observations');
  assertExactKeys(
    observations,
    'ProductionAudit.observations',
    ['textCues', 'cuts'],
    ['visualTreatment'],
  );
  assert(Array.isArray(observations.textCues), 'ProductionAudit textCues must be an array.');
  observations.textCues.forEach((cue, index) =>
    validateTextCue(cue, `ProductionAudit.observations.textCues[${index}]`, audit.durationMs),
  );
  assert(Array.isArray(observations.cuts), 'ProductionAudit cuts must be an array.');
  observations.cuts.forEach((cut, index) => {
    const label = `ProductionAudit.observations.cuts[${index}]`;
    const item = asRecord(cut, label);
    assertExactKeys(item, label, ['frame', 'confidence']);
    assertNonNegativeInteger(item.frame, `${label}.frame`);
    assertUnit(item.confidence, `${label}.confidence`);
  });
  if (observations.visualTreatment !== undefined) {
    validateVisualTreatment(observations.visualTreatment, 'ProductionAudit.visualTreatment');
  }
  if (audit.claimedTargetSpec !== undefined) validateClaimedSpec(audit.claimedTargetSpec);
}

export function validateCreatorTasteProfile(value: unknown): asserts value is CreatorTasteProfile {
  const profile = asRecord(value, 'CreatorTasteProfile');
  assertExactKeys(
    profile,
    'CreatorTasteProfile',
    [
      'schemaVersion',
      'id',
      'learnedAt',
      'sourceProductionIds',
      'applicableContentKinds',
      'confidence',
      'editorialAttention',
      'creatorVoice',
      'spatialGrammar',
      'distributionIdentity',
      'cautions',
    ],
    ['visualWorld'],
  );
  assert(
    profile.schemaVersion === CREATOR_TASTE_PROFILE_SCHEMA_VERSION,
    'Unsupported creator taste profile schema.',
  );
  assertId(profile.id, 'CreatorTasteProfile.id');
  assertIsoTimestamp(profile.learnedAt, 'CreatorTasteProfile.learnedAt');
  validateUniqueIds(profile.sourceProductionIds, 'CreatorTasteProfile.sourceProductionIds', 1);
  validateEnumArray(
    profile.applicableContentKinds,
    CONTENT_KINDS,
    'CreatorTasteProfile.applicableContentKinds',
    1,
  );
  assertUnit(profile.confidence, 'CreatorTasteProfile.confidence');

  const attention = asRecord(profile.editorialAttention, 'CreatorTasteProfile.editorialAttention');
  assertExactKeys(attention, 'CreatorTasteProfile.editorialAttention', [
    'textCuesPerMinute',
    'hookInFirstThreeSecondsRate',
    'endCardRate',
    'preferredCueRoles',
  ]);
  validateSupportedNumber(attention.textCuesPerMinute, 'textCuesPerMinute', 0, 10_000);
  validateSupportedNumber(
    attention.hookInFirstThreeSecondsRate,
    'hookInFirstThreeSecondsRate',
    0,
    1,
  );
  validateSupportedNumber(attention.endCardRate, 'endCardRate', 0, 1);
  validateSupportedEnumArray(attention.preferredCueRoles, CUE_ROLES, 'preferredCueRoles');

  const voice = asRecord(profile.creatorVoice, 'CreatorTasteProfile.creatorVoice');
  assertExactKeys(voice, 'CreatorTasteProfile.creatorVoice', [
    'commentaryRate',
    'instructionRate',
    'lyricRate',
    'ctaRate',
  ]);
  for (const key of ['commentaryRate', 'instructionRate', 'lyricRate', 'ctaRate']) {
    validateSupportedNumber(voice[key], `CreatorTasteProfile.creatorVoice.${key}`, 0, 1);
  }

  const spatial = asRecord(profile.spatialGrammar, 'CreatorTasteProfile.spatialGrammar');
  assertExactKeys(
    spatial,
    'CreatorTasteProfile.spatialGrammar',
    ['roleZones'],
    ['persistentIdentityZone'],
  );
  assert(Array.isArray(spatial.roleZones), 'CreatorTasteProfile roleZones must be an array.');
  const seenRoles = new Set<string>();
  spatial.roleZones.forEach((entry, index) => {
    const label = `CreatorTasteProfile.spatialGrammar.roleZones[${index}]`;
    const item = asRecord(entry, label);
    assertExactKeys(item, label, ['role', 'zone', 'confidence', 'samples']);
    assertOneOf(item.role, CUE_ROLES, `${label}.role`);
    assert(!seenRoles.has(item.role), `${label}.role is duplicated.`);
    seenRoles.add(item.role);
    assertOneOf(item.zone, VERTICAL_ZONES, `${label}.zone`);
    assertUnit(item.confidence, `${label}.confidence`);
    assertPositiveInteger(item.samples, `${label}.samples`);
  });
  if (spatial.persistentIdentityZone !== undefined) {
    validateSupportedEnum(spatial.persistentIdentityZone, VERTICAL_ZONES, 'persistentIdentityZone');
  }

  if (profile.visualWorld !== undefined) {
    const world = asRecord(profile.visualWorld, 'CreatorTasteProfile.visualWorld');
    assertExactKeys(world, 'CreatorTasteProfile.visualWorld', [
      'lumaMean',
      'lumaStd',
      'saturationMean',
    ]);
    validateSupportedNumber(world.lumaMean, 'visualWorld.lumaMean', 0, 255);
    validateSupportedNumber(world.lumaStd, 'visualWorld.lumaStd', 0, 255);
    validateSupportedNumber(world.saturationMean, 'visualWorld.saturationMean', 0, 255);
  }

  const identity = asRecord(
    profile.distributionIdentity,
    'CreatorTasteProfile.distributionIdentity',
  );
  assertExactKeys(identity, 'CreatorTasteProfile.distributionIdentity', [
    'persistentIdentityRate',
    'identityTokens',
  ]);
  validateSupportedNumber(identity.persistentIdentityRate, 'persistentIdentityRate', 0, 1);
  validateSupportedStrings(identity.identityTokens, 'identityTokens');
  validateStrings(profile.cautions, 'CreatorTasteProfile.cautions');
}

export function validateTargetSpecConsistencyReport(
  value: unknown,
): asserts value is TargetSpecConsistencyReport {
  const report = asRecord(value, 'TargetSpecConsistencyReport');
  assertExactKeys(report, 'TargetSpecConsistencyReport', [
    'schemaVersion',
    'auditId',
    'status',
    'score',
    'checks',
    'blockingReasons',
  ]);
  assert(
    report.schemaVersion === TARGET_SPEC_CONSISTENCY_SCHEMA_VERSION,
    'Unsupported consistency report schema.',
  );
  assertId(report.auditId, 'TargetSpecConsistencyReport.auditId');
  assertOneOf(report.status, CONSISTENCY_STATUSES, 'TargetSpecConsistencyReport.status');
  assertUnit(report.score, 'TargetSpecConsistencyReport.score');
  assert(
    Array.isArray(report.checks) && report.checks.length > 0,
    'Consistency checks are required.',
  );
  report.checks.forEach((check, index) => {
    const label = `TargetSpecConsistencyReport.checks[${index}]`;
    const item = asRecord(check, label);
    assertExactKeys(item, label, ['id', 'status', 'observed', 'claimed', 'message']);
    assertId(item.id, `${label}.id`);
    assertOneOf(item.status, CONSISTENCY_STATUSES, `${label}.status`);
    for (const key of ['observed', 'claimed', 'message'])
      assertString(item[key], `${label}.${key}`);
  });
  validateStrings(report.blockingReasons, 'TargetSpecConsistencyReport.blockingReasons');
  const hasFailure = report.checks.some((check: { status: string }) => check.status === 'fail');
  assert((report.status === 'fail') === hasFailure, 'Report status must reflect failed checks.');
}

function validateTextCue(value: unknown, label: string, durationMs: number): void {
  const cue = asRecord(value, label);
  assertExactKeys(cue, label, ['text', 'role', 'startMs', 'endMs', 'confidence', 'region']);
  assertString(cue.text, `${label}.text`);
  assertOneOf(cue.role, CUE_ROLES, `${label}.role`);
  assertNonNegative(cue.startMs, `${label}.startMs`);
  assertPositive(cue.endMs, `${label}.endMs`);
  assert(cue.endMs > cue.startMs && cue.endMs <= durationMs, `${label} range is invalid.`);
  assertUnit(cue.confidence, `${label}.confidence`);
  validateRegion(cue.region, `${label}.region`);
}

function validateRegion(value: unknown, label: string): void {
  const region = asRecord(value, label);
  assertExactKeys(region, label, ['x', 'y', 'width', 'height']);
  for (const key of ['x', 'y', 'width', 'height']) assertUnit(region[key], `${label}.${key}`);
  assert(region.width > 0 && region.height > 0, `${label} must have positive dimensions.`);
  assert(region.x + region.width <= 1 + 1e-9, `${label} exceeds horizontal bounds.`);
  assert(region.y + region.height <= 1 + 1e-9, `${label} exceeds vertical bounds.`);
}

function validateVisualTreatment(value: unknown, label: string): void {
  const visual = asRecord(value, label);
  assertExactKeys(visual, label, ['lumaMean', 'lumaStd', 'saturationMean']);
  for (const key of ['lumaMean', 'lumaStd', 'saturationMean']) {
    assertRange(visual[key], `${label}.${key}`, 0, 255);
  }
}

function validateClaimedSpec(value: unknown): void {
  const spec = asRecord(value, 'ProductionAudit.claimedTargetSpec');
  assertExactKeys(spec, 'ProductionAudit.claimedTargetSpec', [
    'overlayCount',
    'roles',
    'persistentIdentity',
    'endCard',
    'visualTreatmentDescribed',
    'verticalZones',
  ]);
  assertNonNegativeInteger(spec.overlayCount, 'claimedTargetSpec.overlayCount');
  validateEnumArray(spec.roles, CUE_ROLES, 'claimedTargetSpec.roles');
  assertBoolean(spec.persistentIdentity, 'claimedTargetSpec.persistentIdentity');
  assertBoolean(spec.endCard, 'claimedTargetSpec.endCard');
  assertBoolean(spec.visualTreatmentDescribed, 'claimedTargetSpec.visualTreatmentDescribed');
  validateEnumArray(spec.verticalZones, VERTICAL_ZONES, 'claimedTargetSpec.verticalZones');
}

function validateSupportedNumber(value: unknown, label: string, min: number, max: number): void {
  const supported = validateSupportedBase(value, label);
  assertRange(supported.value, `${label}.value`, min, max);
}

function validateSupportedEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): void {
  const supported = validateSupportedBase(value, label);
  assertOneOf(supported.value, allowed, `${label}.value`);
}

function validateSupportedEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): void {
  const supported = validateSupportedBase(value, label);
  validateEnumArray(supported.value, allowed, `${label}.value`);
}

function validateSupportedStrings(value: unknown, label: string): void {
  const supported = validateSupportedBase(value, label);
  validateStrings(supported.value, `${label}.value`);
}

function validateSupportedBase(value: unknown, label: string): Record<string, any> {
  const supported = asRecord(value, label);
  assertExactKeys(supported, label, ['value', 'supportProductions', 'confidence', 'evidenceRefs']);
  assertPositiveInteger(supported.supportProductions, `${label}.supportProductions`);
  assertUnit(supported.confidence, `${label}.confidence`);
  validateUniqueIds(supported.evidenceRefs, `${label}.evidenceRefs`, 1);
  return supported;
}

function verticalZone(y: number): VerticalZone {
  if (y < 1 / 3) return 'top';
  if (y < 2 / 3) return 'middle';
  return 'bottom';
}

export function regionVerticalZone(region: NormalizedRegion): VerticalZone {
  return verticalZone(region.y + region.height / 2);
}

function validateUniqueIds(value: unknown, label: string, minimum = 0): void {
  assert(Array.isArray(value) && value.length >= minimum, `${label} must be an array.`);
  const seen = new Set<string>();
  value.forEach((item, index) => {
    assertId(item, `${label}[${index}]`);
    assert(!seen.has(item), `${label} contains a duplicate.`);
    seen.add(item);
  });
}

function validateStrings(value: unknown, label: string): void {
  assert(Array.isArray(value), `${label} must be an array.`);
  value.forEach((item, index) => assertString(item, `${label}[${index}]`));
}

function validateEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  minimum = 0,
): void {
  assert(Array.isArray(value) && value.length >= minimum, `${label} must be an array.`);
  const seen = new Set<string>();
  value.forEach((item, index) => {
    assertOneOf(item, allowed, `${label}[${index}]`);
    assert(!seen.has(item), `${label} contains a duplicate.`);
    seen.add(item);
  });
}

function asRecord(value: unknown, label: string): Record<string, any> {
  assert(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${label} must be an object.`,
  );
  return value as Record<string, any>;
}

function assertExactKeys(
  value: Record<string, any>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) assert(Object.hasOwn(value, key), `${label}.${key} is required.`);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label}.${key} is not allowed.`);
}

function assertId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && ID_PATTERN.test(value), `${label} is invalid.`);
}

function assertString(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' && value.trim().length > 0 && value.length <= 2_000,
    `${label} is invalid.`,
  );
}

function assertIsoTimestamp(value: unknown, label: string): void {
  assert(
    typeof value === 'string' &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    `${label} must be an ISO timestamp.`,
  );
}

function assertOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): asserts value is T {
  assert(typeof value === 'string' && allowed.includes(value as T), `${label} is invalid.`);
}

function assertRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
): asserts value is number {
  assert(
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max,
    `${label} is out of range.`,
  );
}

function assertUnit(value: unknown, label: string): asserts value is number {
  assertRange(value, label, 0, 1);
}

function assertPositive(value: unknown, label: string): asserts value is number {
  assert(
    typeof value === 'number' && Number.isFinite(value) && value > 0,
    `${label} must be positive.`,
  );
}

function assertNonNegative(value: unknown, label: string): asserts value is number {
  assert(
    typeof value === 'number' && Number.isFinite(value) && value >= 0,
    `${label} must be non-negative.`,
  );
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  assert(
    Number.isSafeInteger(value) && (value as number) > 0,
    `${label} must be a positive integer.`,
  );
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  assert(
    Number.isSafeInteger(value) && (value as number) >= 0,
    `${label} must be a non-negative integer.`,
  );
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  assert(typeof value === 'boolean', `${label} must be boolean.`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
