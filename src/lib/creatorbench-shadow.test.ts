import { describe, expect, it } from 'vitest';
import {
  beginShadowEvaluation,
  deleteShadowEvaluation,
  mayContributeShadowRecord,
  recordShadowChoice,
  recordShadowProposal,
} from './creatorbench-shadow';

describe('CreatorBench production shadow mode', () => {
  it('is opt-in, proposal-only, and separately gated for benchmark contribution', () => {
    expect(() =>
      beginShadowEvaluation({
        id: 'shadow:1',
        requestId: 'request:1',
        explicitOptIn: false,
        localOnly: true,
      }),
    ).toThrow(/explicit opt-in/u);
    let record = beginShadowEvaluation({
      id: 'shadow:1',
      requestId: 'request:1',
      explicitOptIn: true,
      localOnly: true,
      benchmarkContributionOptIn: true,
      now: '2026-07-21T00:00:00.000Z',
    });
    expect(record.canonicalMutationAllowed).toBe(false);
    record = recordShadowProposal(record, {
      routeReceiptId: 'route:1',
      artifactIds: ['artifact:proposal'],
      createdAt: '2026-07-21T00:01:00.000Z',
    });
    record = recordShadowChoice(record, { routeReceiptId: 'route:1', correctionTimeSeconds: 12 });
    expect(mayContributeShadowRecord(record)).toBe(true);
    record = deleteShadowEvaluation(record, '2026-07-21T00:02:00.000Z');
    expect(record.proposals).toEqual([]);
    expect(mayContributeShadowRecord(record)).toBe(false);
  });
});
