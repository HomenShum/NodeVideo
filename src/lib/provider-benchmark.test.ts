import { describe, expect, it } from 'vitest';
import { type ProviderBenchmarkResult, scoreProviderBenchmark } from './provider-benchmark';

const result = (model: string, repetition: number, quality: number): ProviderBenchmarkResult => ({
  caseId: `product-ad:${model}`,
  briefId: 'product-ad',
  model,
  repetition,
  outputReceiptId: `receipt:${model}:${repetition}`,
  evaluatorId: 'evaluator.protected-v1',
  scores: {
    promptAdherence: quality,
    identityConsistency: quality,
    temporalConsistency: quality,
    cameraQuality: quality,
    humanAnatomy: quality,
    textFidelity: quality,
    brandFit: quality,
    editability: quality,
    artifactRate: model === 'unstable' ? 50 : 0,
  },
});

describe('provider benchmark', () => {
  it('routes per brief only after three repetitions and penalizes artifacts', () => {
    const report = scoreProviderBenchmark([
      ...[1, 2, 3].map((repetition) => result('stable', repetition, 80)),
      ...[1, 2, 3].map((repetition) => result('unstable', repetition, 95)),
    ]);
    expect(report.routing[0]?.selectedModel).toBe('stable');
    expect(report.limitations[0]).toContain('does not declare one universal');
  });

  it('does not route incomplete candidates', () => {
    expect(
      scoreProviderBenchmark([result('one-shot', 1, 100)]).routing[0]?.selectedModel,
    ).toBeNull();
  });
});
