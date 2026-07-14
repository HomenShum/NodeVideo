import { describe, expect, it } from 'vitest';
import {
  type DurableJobState,
  assertActiveLease,
  assertIdempotentInput,
  assertProposalApproval,
  canonicalJson,
  claimLeaseTransition,
  consumeEventSequence,
  sha256Digest,
} from '../../convex/lib/durability';

const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;

function queuedJob(overrides: Partial<DurableJobState> = {}): DurableJobState {
  return {
    status: 'queued',
    attempt: 0,
    maxAttempts: 3,
    leaseToken: 0,
    nextEventSequence: 1,
    ...overrides,
  };
}

describe('durability contracts', () => {
  it('canonicalizes JSON and hashes equivalent payloads identically', async () => {
    const left = canonicalJson({ z: [3, { b: true, a: 'x' }], a: 1 });
    const right = canonicalJson({ a: 1, z: [3, { a: 'x', b: true }] });

    expect(left).toBe('{"a":1,"z":[3,{"a":"x","b":true}]}');
    expect(await sha256Digest(left)).toBe(await sha256Digest(right));
  });

  it('reuses an idempotency key only for the same input digest', () => {
    expect(() => assertIdempotentInput(digestA, digestA)).not.toThrow();
    expect(() => assertIdempotentInput(digestA, digestB)).toThrow(
      'idempotency_key_reused_with_different_input',
    );
  });

  it('blocks a live lease and fences a reclaimed worker', () => {
    const first = claimLeaseTransition(queuedJob(), { leaseId: 'worker-a', leaseMs: 1_000 }, 100);
    expect(first.claimed).toBe(true);
    if (!first.claimed) throw new Error('expected the first claim to succeed');

    const blocked = claimLeaseTransition(first.state, { leaseId: 'worker-b', leaseMs: 1_000 }, 200);
    expect(blocked).toMatchObject({ claimed: false, reason: 'leased' });

    const reclaimed = claimLeaseTransition(
      first.state,
      { leaseId: 'worker-b', leaseMs: 1_000 },
      1_101,
    );
    expect(reclaimed.claimed).toBe(true);
    if (!reclaimed.claimed) throw new Error('expected the expired lease to be reclaimed');
    expect(reclaimed.state.leaseToken).toBe(2);
    expect(reclaimed.state.attempt).toBe(2);
    expect(() => assertActiveLease(reclaimed.state, 'worker-a', 1, 1_102)).toThrow(
      'stale_lease_fence',
    );
    expect(() => assertActiveLease(reclaimed.state, 'worker-b', 2, 1_102)).not.toThrow();
  });

  it('allocates event sequence numbers monotonically', () => {
    const first = consumeEventSequence(queuedJob({ nextEventSequence: 7 }));
    const second = consumeEventSequence(first.nextState);

    expect([first.sequence, second.sequence]).toEqual([7, 8]);
    expect(second.nextState.nextEventSequence).toBe(9);
  });

  it('binds approval to the exact stored proposal payload', async () => {
    const payloadJson = canonicalJson({ operation: 'trim', endFrame: 120, startFrame: 5 });
    const storedDigest = await sha256Digest(payloadJson);

    await expect(
      assertProposalApproval(payloadJson, storedDigest, storedDigest),
    ).resolves.toBeUndefined();
    await expect(
      assertProposalApproval(`${payloadJson} `, storedDigest, storedDigest),
    ).rejects.toThrow('proposal_payload_digest_mismatch');
    await expect(assertProposalApproval(payloadJson, storedDigest, digestA)).rejects.toThrow(
      'approval_digest_mismatch',
    );
  });
});
