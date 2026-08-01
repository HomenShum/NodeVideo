import { describe, expect, it } from 'vitest';
import { type ExecutorRouteRequest, routeExecutor } from './adaptive-executor-router.ts';
import {
  beginShadowEvaluation,
  completeShadowEvaluation,
  deleteShadowEvaluation,
  enforceShadowRetention,
  mayContributeShadowRecord,
  optInShadowBenchmark,
  recordShadowChoice,
  recordShadowProposal,
} from './creatorbench-shadow.ts';
import { EXECUTOR_SCHEMA, type ExecutorDefinition } from './media-orchestration-contracts.ts';

const routeRequest = (
  id: string,
  privacy: ExecutorRouteRequest['privacy'] = 'local-only',
): ExecutorRouteRequest => ({
  id: 'request:1',
  capability: 'video.reframe',
  domain: 'creator',
  privacy,
  maximumCostUsd: 2,
  maximumLatency: 'long',
  commercialUseRequired: true,
  requireBenchmarkPromotion: false,
});

const executor = (id: string, offDevice = false): ExecutorDefinition => ({
  schemaVersion: EXECUTOR_SCHEMA,
  id,
  version: '1.0.0',
  capabilities: ['video.reframe'],
  runtime: offDevice ? 'api' : 'local-worker',
  cost: { tier: 'low', estimatedUsd: 0.1 },
  latency: 'short',
  deterministic: false,
  qualityTier: 'standard',
  privacy: { sendsMediaOffDevice: offDevice, sendsDerivedFrames: offDevice },
  requirements: { gpu: false },
  license: { code: 'Apache-2.0', commercialUse: true },
  validatorIds: ['preview.decode'],
  enabled: true,
});

function route(id: string, privacy: ExecutorRouteRequest['privacy'] = 'local-only') {
  return routeExecutor({
    request: routeRequest(id, privacy),
    receiptId: `route:${id}`,
    candidates: [
      {
        definition: executor(id, privacy !== 'local-only'),
        domains: ['creator'],
        defaultDisposition: 'automatic',
      },
    ],
    createdAt: '2026-07-21T00:01:00.000Z',
  });
}

function begin(
  retention: Parameters<typeof beginShadowEvaluation>[0]['retention'] = {
    mode: 'time-bounded',
    deleteAfter: '2026-07-25T00:00:00.000Z',
  },
) {
  return beginShadowEvaluation({
    id: 'shadow:1',
    requestId: 'request:1',
    shadowModeEnabled: true,
    explicitOptIn: true,
    privacy: {
      localOnly: true,
      mediaEgress: 'prohibited',
      approvedExecutorIds: ['executor.a', 'executor.b'],
    },
    retention,
    now: '2026-07-21T00:00:00.000Z',
  });
}

describe('CreatorBench production shadow mode', () => {
  it('is disabled by default and separately requires creator opt-in', () => {
    expect(() =>
      beginShadowEvaluation({
        id: 'shadow:1',
        requestId: 'request:1',
        explicitOptIn: true,
        privacy: { localOnly: true, mediaEgress: 'prohibited', approvedExecutorIds: [] },
      }),
    ).toThrow(/disabled by default/u);
    expect(() =>
      beginShadowEvaluation({
        id: 'shadow:1',
        requestId: 'request:1',
        shadowModeEnabled: true,
        explicitOptIn: false,
        privacy: { localOnly: true, mediaEgress: 'prohibited', approvedExecutorIds: [] },
      }),
    ).toThrow(/explicit opt-in/u);
  });

  it('compares eligible proposals without allowing mutation or publication', () => {
    let record = begin();
    record = recordShadowProposal(record, {
      routeReceipt: route('executor.a'),
      artifactIds: ['artifact:a'],
    });
    record = recordShadowProposal(record, {
      routeReceipt: route('executor.b'),
      artifactIds: ['artifact:b'],
    });
    record = recordShadowChoice(record, {
      routeReceiptId: 'route:executor.a',
      correctionTimeSeconds: 12,
      recordedAt: '2026-07-21T00:02:00.000Z',
    });

    expect(record.canonicalMutationAllowed).toBe(false);
    expect(record.publicationAllowed).toBe(false);
    expect(record.proposals.every((proposal) => !proposal.canonicalMutationAllowed)).toBe(true);
    expect(record.creatorChoice?.correctionTimeSeconds).toBe(12);
  });

  it('rejects a proposal that violates the local-only egress policy', () => {
    const record = begin();
    expect(() =>
      recordShadowProposal(record, {
        routeReceipt: route('executor.remote', 'media-egress'),
        artifactIds: ['artifact:remote'],
      }),
    ).toThrow(/Local-only/u);
  });

  it('requires a separate benchmark contribution opt-in after shadow opt-in', () => {
    let record = begin();
    record = recordShadowProposal(record, {
      routeReceipt: route('executor.a'),
      artifactIds: ['artifact:a'],
    });
    record = recordShadowProposal(record, {
      routeReceipt: route('executor.b'),
      artifactIds: ['artifact:b'],
    });
    record = recordShadowChoice(record, {
      routeReceiptId: 'route:executor.a',
      correctionTimeSeconds: 4,
    });
    expect(mayContributeShadowRecord(record, '2026-07-22T00:00:00.000Z')).toBe(false);
    expect(() => optInShadowBenchmark(record, { explicitOptIn: false })).toThrow(
      /separate explicit opt-in/u,
    );
    record = optInShadowBenchmark(record, {
      explicitOptIn: true,
      now: '2026-07-21T00:03:00.000Z',
    });
    expect(mayContributeShadowRecord(record, '2026-07-22T00:00:00.000Z')).toBe(true);
  });

  it('purges proposal references, choice, and benchmark consent on deletion', () => {
    let record = begin();
    record = recordShadowProposal(record, {
      routeReceipt: route('executor.a'),
      artifactIds: ['artifact:a'],
    });
    record = deleteShadowEvaluation(record, {
      now: '2026-07-21T00:04:00.000Z',
      reason: 'creator-request',
    });

    expect(record.proposals).toEqual([]);
    expect(record.benchmarkContributionOptIn).toBe(false);
    expect(record.deletion?.removedArtifactIds).toEqual(['artifact:a']);
    expect(mayContributeShadowRecord(record)).toBe(false);
  });

  it('enforces bounded retention and delete-on-completion policy', () => {
    const expired = enforceShadowRetention(begin(), '2026-07-25T00:00:00.000Z');
    expect(expired.deletion?.reason).toBe('retention-expired');

    const completed = completeShadowEvaluation(begin({ mode: 'delete-on-completion' }));
    expect(completed.deletion?.reason).toBe('completion-policy');
  });
});
