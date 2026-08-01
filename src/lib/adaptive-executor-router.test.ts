import { describe, expect, it } from 'vitest';
import {
  type ExecutorRouteCandidate,
  type ExecutorRouteRequest,
  evaluateBenchmarkPromotion,
  routeExecutor,
} from './adaptive-executor-router.ts';
import { EXECUTOR_SCHEMA, type ExecutorDefinition } from './media-orchestration-contracts.ts';

const request = (overrides: Partial<ExecutorRouteRequest> = {}): ExecutorRouteRequest => ({
  id: 'request-1',
  capability: 'video.track-subject',
  domain: 'object',
  privacy: 'local-only',
  maximumCostUsd: 1,
  maximumLatency: 'long',
  commercialUseRequired: true,
  availableGpuVramGb: 8,
  requireBenchmarkPromotion: false,
  ...overrides,
});

const definition = (overrides: Partial<ExecutorDefinition> = {}): ExecutorDefinition => ({
  schemaVersion: EXECUTOR_SCHEMA,
  id: 'executor.local-auto',
  version: '1.0.0',
  capabilities: ['video.track-subject'],
  runtime: 'local-worker',
  cost: { tier: 'free', estimatedUsd: 0 },
  latency: 'short',
  deterministic: false,
  qualityTier: 'standard',
  privacy: { sendsMediaOffDevice: false, sendsDerivedFrames: false },
  requirements: { gpu: false },
  license: { code: 'Apache-2.0', commercialUse: true },
  validatorIds: ['tracking.identity'],
  enabled: true,
  ...overrides,
});

const candidate = (
  executorOverrides: Partial<ExecutorDefinition> = {},
  candidateOverrides: Partial<ExecutorRouteCandidate> = {},
): ExecutorRouteCandidate => ({
  definition: definition(executorOverrides),
  domains: ['object'],
  defaultDisposition: 'automatic',
  benchmark: { sampleSize: 100, successes: 95, silentFailures: 0 },
  ...candidateOverrides,
});

describe('adaptive executor router', () => {
  it('rejects an off-device executor when the request is local-only', () => {
    const receipt = routeExecutor({
      request: request(),
      candidates: [
        candidate({
          id: 'executor.remote',
          runtime: 'api',
          privacy: { sendsMediaOffDevice: true, sendsDerivedFrames: true },
        }),
      ],
    });

    expect(receipt.disposition).toBe('abstain');
    expect(receipt.candidateDecisions[0]?.rejectedReasons.map((reason) => reason.code)).toContain(
      'privacy-conflict',
    );
  });

  it('records unavailable executors instead of treating provider presence as capability', () => {
    const receipt = routeExecutor({
      request: request(),
      candidates: [candidate({ id: 'executor.offline', enabled: false })],
    });

    expect(receipt.selectedExecutorId).toBeNull();
    expect(receipt.candidateDecisions[0]?.rejectedReasons[0]?.code).toBe('executor-unavailable');
  });

  it('selects an explicit assisted route when a manual seed is required', () => {
    const receipt = routeExecutor({
      request: request(),
      candidates: [
        candidate(
          { id: 'executor.seeded-tracker' },
          {
            defaultDisposition: 'assisted',
            assistance: {
              kind: 'manual-seed',
              instruction: 'Select the product on its first clear frame.',
            },
          },
        ),
      ],
    });

    expect(receipt.disposition).toBe('assisted');
    expect(receipt.selectedExecutorId).toBe('executor.seeded-tracker');
    expect(receipt.selectedAssistance?.kind).toBe('manual-seed');
  });

  it('preserves fallback history and routes around a failed first choice', () => {
    const receipt = routeExecutor({
      request: request(),
      candidates: [
        candidate({ id: 'executor.cheap', cost: { tier: 'free', estimatedUsd: 0 } }),
        candidate({ id: 'executor.backup', cost: { tier: 'low', estimatedUsd: 0.25 } }),
      ],
      fallbackHistory: [
        {
          executorId: 'executor.cheap',
          outcome: 'failed',
          reason: 'Identity was lost after occlusion.',
          attemptedAt: '2026-07-21T12:00:00.000Z',
        },
      ],
    });

    expect(receipt.selectedExecutorId).toBe('executor.backup');
    expect(receipt.fallbackHistory).toHaveLength(1);
    expect(
      receipt.candidateDecisions
        .find((decision) => decision.executorId === 'executor.cheap')
        ?.rejectedReasons.map((reason) => reason.code),
    ).toContain('previous-attempt-failed');
  });

  it('abstains when every executor violates a hard constraint', () => {
    const receipt = routeExecutor({
      request: request({ maximumCostUsd: 0.05 }),
      candidates: [
        candidate({ id: 'executor.too-expensive', cost: { tier: 'medium', estimatedUsd: 2 } }),
      ],
    });

    expect(receipt.disposition).toBe('abstain');
    expect(receipt.abstentionReasons.join(' ')).toContain('cost-limit-exceeded');
  });

  it('does not promote an automatic route from one successful fixture', () => {
    const promotion = evaluateBenchmarkPromotion({
      sampleSize: 1,
      successes: 1,
      silentFailures: 0,
    });
    const receipt = routeExecutor({
      request: request({ requireBenchmarkPromotion: true }),
      candidates: [
        candidate(
          { id: 'executor.one-shot' },
          { benchmark: { sampleSize: 1, successes: 1, silentFailures: 0 } },
        ),
      ],
    });

    expect(promotion.promoted).toBe(false);
    expect(promotion.reasons.join(' ')).toContain('at least 30 held-out samples');
    expect(receipt.disposition).toBe('review');
    expect(receipt.candidateDecisions[0]?.promotion?.promoted).toBe(false);
  });

  it('blocks promotion when a large sample still contains a silent failure', () => {
    const promotion = evaluateBenchmarkPromotion({
      sampleSize: 500,
      successes: 499,
      silentFailures: 1,
    });

    expect(promotion.successLowerBound).toBeGreaterThan(0.8);
    expect(promotion.promoted).toBe(false);
    expect(promotion.reasons.join(' ')).toContain('Silent failures 1 exceed the maximum 0');
  });

  it('chooses the cheapest automatically credible executor', () => {
    const receipt = routeExecutor({
      request: request({ requireBenchmarkPromotion: true }),
      candidates: [
        candidate({ id: 'executor.premium', cost: { tier: 'high', estimatedUsd: 0.9 } }),
        candidate({ id: 'executor.efficient', cost: { tier: 'low', estimatedUsd: 0.1 } }),
      ],
    });

    expect(receipt.disposition).toBe('automatic');
    expect(receipt.selectedExecutorId).toBe('executor.efficient');
    expect(receipt.selectedCostEstimateUsd).toBe(0.1);
    expect(receipt.privacyClassification).toBe('local-only');
    expect(receipt.licenseClassification).toBe('commercial-compatible');
    expect(receipt.toolModelVersions).toContain('executor.efficient');
    expect(receipt.userIntervention.required).toBe(false);
  });
});
