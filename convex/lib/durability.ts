export const MAX_LEASE_MS = 15 * 60 * 1000;

export type DurableJobStatus =
  | 'queued'
  | 'running'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DurableJobState {
  status: DurableJobStatus;
  attempt: number;
  maxAttempts: number;
  leaseId?: string;
  leaseToken: number;
  leaseUntil?: number;
  nextEventSequence: number;
}

export class DurabilityError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'DurabilityError';
    this.code = code;
  }
}

function fail(code: string): never {
  throw new DurabilityError(code);
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) fail('json_number_must_be_finite');
      return JSON.stringify(value);
    case 'object': {
      const object = value as object;
      if (ancestors.has(object)) fail('json_value_must_not_be_cyclic');
      ancestors.add(object);

      let result: string;
      if (Array.isArray(value)) {
        result = `[${value.map((item) => canonicalize(item, ancestors)).join(',')}]`;
      } else {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          fail('json_value_must_be_plain');
        }
        if (Object.getOwnPropertySymbols(value).length > 0) {
          fail('json_symbol_keys_are_not_supported');
        }
        result = `{${Object.keys(value)
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key], ancestors)}`,
          )
          .join(',')}}`;
      }

      ancestors.delete(object);
      return result;
    }
    default:
      return fail('json_value_is_not_supported');
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set());
}

export function boundedCanonicalJson(value: unknown, maxBytes: number, label: string): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('json_limit_is_invalid');
  const json = canonicalJson(value);
  if (new TextEncoder().encode(json).byteLength > maxBytes) {
    fail(`${label}_too_large`);
  }
  return json;
}

export async function sha256Digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `sha256:${hex}`;
}

export function assertSha256Digest(value: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) fail('invalid_sha256_digest');
  return value;
}

export function assertBoundedString(value: string, maxLength: number, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) fail(`${label}_required`);
  if (normalized.length > maxLength) fail(`${label}_too_long`);
  return normalized;
}

export function assertLeaseDuration(leaseMs: number): number {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > MAX_LEASE_MS) {
    fail('invalid_lease_duration');
  }
  return leaseMs;
}

export function assertIdempotentInput(existingDigest: string, requestedDigest: string): void {
  assertSha256Digest(existingDigest);
  assertSha256Digest(requestedDigest);
  if (existingDigest !== requestedDigest) {
    fail('idempotency_key_reused_with_different_input');
  }
}

export type ClaimLeaseResult =
  | { claimed: true; state: DurableJobState }
  | {
      claimed: false;
      reason: 'terminal' | 'awaiting_review' | 'leased' | 'attempts_exhausted';
      state: DurableJobState;
    };

export function claimLeaseTransition(
  state: DurableJobState,
  request: { leaseId: string; leaseMs: number },
  now: number,
): ClaimLeaseResult {
  const leaseId = assertBoundedString(request.leaseId, 256, 'lease_id');
  const leaseMs = assertLeaseDuration(request.leaseMs);

  if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
    return { claimed: false, reason: 'terminal', state };
  }
  if (state.status === 'awaiting_review') {
    return { claimed: false, reason: 'awaiting_review', state };
  }
  if (state.status === 'running' && state.leaseUntil !== undefined && state.leaseUntil > now) {
    return { claimed: false, reason: 'leased', state };
  }
  if (state.attempt >= state.maxAttempts) {
    return { claimed: false, reason: 'attempts_exhausted', state };
  }

  return {
    claimed: true,
    state: {
      ...state,
      status: 'running',
      attempt: state.attempt + 1,
      leaseId,
      leaseToken: state.leaseToken + 1,
      leaseUntil: now + leaseMs,
    },
  };
}

export function assertActiveLease(
  state: DurableJobState,
  leaseId: string,
  leaseToken: number,
  now: number,
): void {
  if (state.status !== 'running') fail('job_is_not_running');
  if (state.leaseId !== leaseId || state.leaseToken !== leaseToken) fail('stale_lease_fence');
  if (state.leaseUntil === undefined || state.leaseUntil <= now) fail('lease_expired');
}

export function consumeEventSequence(state: DurableJobState): {
  sequence: number;
  nextState: DurableJobState;
} {
  if (!Number.isSafeInteger(state.nextEventSequence) || state.nextEventSequence < 1) {
    fail('invalid_event_sequence');
  }
  return {
    sequence: state.nextEventSequence,
    nextState: { ...state, nextEventSequence: state.nextEventSequence + 1 },
  };
}

export async function assertProposalApproval(
  payloadJson: string,
  storedDigest: string,
  expectedDigest: string,
): Promise<void> {
  assertSha256Digest(storedDigest);
  assertSha256Digest(expectedDigest);
  const recomputedDigest = await sha256Digest(payloadJson);
  if (recomputedDigest !== storedDigest) fail('proposal_payload_digest_mismatch');
  if (expectedDigest !== storedDigest) fail('approval_digest_mismatch');
}
