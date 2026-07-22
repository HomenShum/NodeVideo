import defaultPolicy from '../../config/executor-routing/default-policy.json';
import type { ExecutorDefinition } from './media-orchestration-contracts.ts';
import {
  type PromotionDecision,
  ROUTE_RECEIPT_SCHEMA,
  type RouteCandidateDecision,
  type RouteDisposition,
  type RouteFallbackAttempt,
  type RouteReceipt,
  type RouteRejection,
  validateRouteReceipt,
} from './route-receipts.ts';

export type BenchmarkStatistics = {
  sampleSize: number;
  successes: number;
  silentFailures: number;
};

export type BenchmarkPromotionPolicy = {
  minimumSamples: number;
  minimumSuccessLowerBound: number;
  maximumSilentFailureRate: number;
  maximumSilentFailures: number;
  confidenceZ: number;
};

export type RoutingPolicy = {
  promotion: BenchmarkPromotionPolicy;
  ranking: {
    dispositionOrder: Array<Exclude<RouteDisposition, 'abstain'>>;
    latencyOrder: ExecutorDefinition['latency'][];
    qualityOrder: ExecutorDefinition['qualityTier'][];
  };
};

export type ExecutorRouteCandidate = {
  definition: ExecutorDefinition;
  domains: string[];
  defaultDisposition: Exclude<RouteDisposition, 'abstain'>;
  assistance?: RouteCandidateDecision['assistance'];
  available?: boolean;
  benchmark?: BenchmarkStatistics;
};

export type ExecutorRouteRequest = {
  id: string;
  capability: string;
  domain: string;
  privacy: 'local-only' | 'derived-egress' | 'media-egress';
  maximumCostUsd: number;
  maximumLatency: ExecutorDefinition['latency'];
  commercialUseRequired: boolean;
  availableGpuVramGb?: number;
  requireBenchmarkPromotion: boolean;
  inputArtifactIds?: string[];
};

export const DEFAULT_ROUTING_POLICY = defaultPolicy as RoutingPolicy;

const dispositionFallbackRank: Record<Exclude<RouteDisposition, 'abstain'>, number> = {
  automatic: 0,
  assisted: 1,
  review: 2,
};

/** Wilson score lower bound prevents one lucky fixture from promoting an executor. */
export function successRateLowerBound(successes: number, sampleSize: number, z = 1.96) {
  if (sampleSize <= 0) return 0;
  const p = successes / sampleSize;
  const zSquared = z * z;
  const denominator = 1 + zSquared / sampleSize;
  const centre = p + zSquared / (2 * sampleSize);
  const margin = z * Math.sqrt((p * (1 - p) + zSquared / (4 * sampleSize)) / sampleSize);
  return Math.max(0, (centre - margin) / denominator);
}

export function evaluateBenchmarkPromotion(
  statistics: BenchmarkStatistics | undefined,
  policy: BenchmarkPromotionPolicy = DEFAULT_ROUTING_POLICY.promotion,
): PromotionDecision {
  const sampleSize = statistics?.sampleSize ?? 0;
  const successes = statistics?.successes ?? 0;
  const silentFailures = statistics?.silentFailures ?? 0;
  if (!Number.isInteger(sampleSize) || sampleSize < 0) {
    throw new Error('Benchmark sampleSize must be a non-negative integer.');
  }
  if (!Number.isInteger(successes) || successes < 0 || successes > sampleSize) {
    throw new Error('Benchmark successes must be between zero and sampleSize.');
  }
  if (!Number.isInteger(silentFailures) || silentFailures < 0 || silentFailures > sampleSize) {
    throw new Error('Benchmark silentFailures must be between zero and sampleSize.');
  }
  const successRate = sampleSize > 0 ? successes / sampleSize : 0;
  const silentFailureRate = sampleSize > 0 ? silentFailures / sampleSize : 0;
  const successLowerBound = successRateLowerBound(successes, sampleSize, policy.confidenceZ);
  const reasons: string[] = [];

  if (sampleSize < policy.minimumSamples) {
    reasons.push(
      `Requires at least ${policy.minimumSamples} held-out samples; received ${sampleSize}.`,
    );
  }
  if (successLowerBound < policy.minimumSuccessLowerBound) {
    reasons.push(
      `Success lower bound ${successLowerBound.toFixed(4)} is below ${policy.minimumSuccessLowerBound}.`,
    );
  }
  if (silentFailures > policy.maximumSilentFailures) {
    reasons.push(
      `Silent failures ${silentFailures} exceed the maximum ${policy.maximumSilentFailures}.`,
    );
  }
  if (silentFailureRate > policy.maximumSilentFailureRate) {
    reasons.push(
      `Silent-failure rate ${silentFailureRate.toFixed(4)} exceeds ${policy.maximumSilentFailureRate}.`,
    );
  }

  return {
    promoted: reasons.length === 0,
    sampleSize,
    successes,
    successRate,
    successLowerBound,
    silentFailures,
    silentFailureRate,
    reasons,
  };
}

export function routeExecutor(input: {
  request: ExecutorRouteRequest;
  candidates: ExecutorRouteCandidate[];
  fallbackHistory?: RouteFallbackAttempt[];
  policy?: RoutingPolicy;
  createdAt?: string;
}): RouteReceipt {
  const policy = input.policy ?? DEFAULT_ROUTING_POLICY;
  const fallbackHistory = input.fallbackHistory ?? [];
  const failedExecutors = new Set(
    fallbackHistory
      .filter((attempt) => attempt.outcome === 'failed' || attempt.outcome === 'unavailable')
      .map((attempt) => attempt.executorId),
  );

  const candidateDecisions = input.candidates.map((candidate) =>
    evaluateCandidate(input.request, candidate, failedExecutors, policy),
  );
  const ranked = candidateDecisions
    .filter((decision) => decision.eligible)
    .sort((left, right) => {
      const dispositionDifference =
        rank(policy.ranking.dispositionOrder, left.effectiveDisposition) -
        rank(policy.ranking.dispositionOrder, right.effectiveDisposition);
      if (dispositionDifference !== 0) return dispositionDifference;
      if (left.estimatedCostUsd !== right.estimatedCostUsd) {
        return left.estimatedCostUsd - right.estimatedCostUsd;
      }
      const qualityDifference =
        rank(policy.ranking.qualityOrder, left.qualityTier) -
        rank(policy.ranking.qualityOrder, right.qualityTier);
      if (qualityDifference !== 0) return qualityDifference;
      const latencyDifference =
        rank(policy.ranking.latencyOrder, left.latency) -
        rank(policy.ranking.latencyOrder, right.latency);
      if (latencyDifference !== 0) return latencyDifference;
      return left.executorId.localeCompare(right.executorId);
    });
  const selected = ranked[0];
  const disposition = selected?.effectiveDisposition ?? 'abstain';
  const abstentionReasons = selected
    ? []
    : summarizeAbstention(candidateDecisions, input.request.capability, input.request.domain);

  return validateRouteReceipt({
    schemaVersion: ROUTE_RECEIPT_SCHEMA,
    id: `route:${input.request.id}`,
    requestId: input.request.id,
    createdAt: input.createdAt ?? new Date().toISOString(),
    request: {
      capability: input.request.capability,
      domain: input.request.domain,
      privacy: input.request.privacy,
      maximumCostUsd: input.request.maximumCostUsd,
      maximumLatency: input.request.maximumLatency,
      commercialUseRequired: input.request.commercialUseRequired,
      requireBenchmarkPromotion: input.request.requireBenchmarkPromotion,
    },
    disposition,
    selectedExecutorId: selected?.executorId ?? null,
    selectedAssistance: selected?.assistance,
    selectedCostEstimateUsd: selected?.estimatedCostUsd ?? null,
    privacyClassification: input.request.privacy,
    licenseClassification:
      selected && input.request.commercialUseRequired ? 'commercial-compatible' : 'not-evaluated',
    confidence: selected?.promotion?.successLowerBound ?? 0,
    userIntervention: {
      required: disposition === 'assisted' || disposition === 'review',
      ...(selected?.assistance?.kind ? { kind: selected.assistance.kind } : {}),
    },
    toolModelVersions: selected ? [selected.executorId] : ['adaptive-executor-router-v1'],
    inputArtifactIds: [...(input.request.inputArtifactIds ?? [])],
    outputArtifactIds: [],
    candidateDecisions,
    fallbackHistory,
    abstentionReasons,
  });
}

function evaluateCandidate(
  request: ExecutorRouteRequest,
  candidate: ExecutorRouteCandidate,
  failedExecutors: Set<string>,
  policy: RoutingPolicy,
): RouteCandidateDecision {
  const executor = candidate.definition;
  const rejectedReasons: RouteRejection[] = [];
  if (!executor.capabilities.includes(request.capability)) {
    reject(rejectedReasons, 'capability-mismatch', 'Executor does not provide the capability.');
  }
  if (!(candidate.domains.includes('*') || candidate.domains.includes(request.domain))) {
    reject(rejectedReasons, 'domain-mismatch', 'Executor is not validated for this domain.');
  }
  if (!executor.enabled || candidate.available === false) {
    reject(rejectedReasons, 'executor-unavailable', 'Executor is disabled or unavailable.');
  }
  if (failedExecutors.has(executor.id)) {
    reject(
      rejectedReasons,
      'previous-attempt-failed',
      'Executor was removed from consideration after a failed attempt.',
    );
  }
  if (
    request.privacy === 'local-only' &&
    (executor.privacy.sendsMediaOffDevice || executor.privacy.sendsDerivedFrames)
  ) {
    reject(rejectedReasons, 'privacy-conflict', 'Local-only execution forbids all egress.');
  } else if (request.privacy === 'derived-egress' && executor.privacy.sendsMediaOffDevice) {
    reject(rejectedReasons, 'media-egress-disallowed', 'Only derived-frame egress is authorized.');
  }
  if (request.privacy !== 'media-egress' && executor.privacy.sendsMediaOffDevice) {
    reject(rejectedReasons, 'media-egress-disallowed', 'Full media egress is not authorized.');
  }
  if (request.privacy === 'local-only' && executor.privacy.sendsDerivedFrames) {
    reject(
      rejectedReasons,
      'derived-frame-egress-disallowed',
      'Derived-frame egress is not authorized.',
    );
  }
  if (executor.cost.estimatedUsd > request.maximumCostUsd) {
    reject(rejectedReasons, 'cost-limit-exceeded', 'Executor exceeds the request cost limit.');
  }
  if (
    rank(policy.ranking.latencyOrder, executor.latency) >
    rank(policy.ranking.latencyOrder, request.maximumLatency)
  ) {
    reject(rejectedReasons, 'latency-limit-exceeded', 'Executor exceeds the latency limit.');
  }
  if (request.commercialUseRequired && executor.license.commercialUse === false) {
    reject(rejectedReasons, 'license-incompatible', 'Executor is not licensed for commercial use.');
  }
  if (
    executor.requirements.gpu &&
    (request.availableGpuVramGb === undefined ||
      request.availableGpuVramGb < (executor.requirements.minimumVramGb ?? 0))
  ) {
    reject(rejectedReasons, 'gpu-unavailable', 'Available GPU memory does not meet requirements.');
  }

  let effectiveDisposition = candidate.defaultDisposition;
  let assistance = candidate.assistance;
  if (effectiveDisposition === 'assisted' && assistance === undefined) {
    assistance = {
      kind: 'human-review',
      instruction: 'Complete the executor-specific assistance step before execution.',
    };
  }
  if (
    request.commercialUseRequired &&
    executor.license.commercialUse === 'review-required' &&
    rejectedReasons.length === 0
  ) {
    effectiveDisposition = 'review';
    assistance = {
      kind: 'license-review',
      instruction: 'Confirm model and code licenses before commercial execution.',
    };
  }

  const promotion =
    request.requireBenchmarkPromotion && candidate.defaultDisposition === 'automatic'
      ? evaluateBenchmarkPromotion(candidate.benchmark, policy.promotion)
      : undefined;
  if (promotion && !promotion.promoted && rejectedReasons.length === 0) {
    effectiveDisposition = 'review';
    assistance = {
      kind: 'human-review',
      instruction: `Automatic promotion withheld: ${promotion.reasons.join(' ')}`,
    };
  }

  return {
    executorId: executor.id,
    eligible: rejectedReasons.length === 0,
    requestedDisposition: candidate.defaultDisposition,
    effectiveDisposition: rejectedReasons.length === 0 ? effectiveDisposition : undefined,
    estimatedCostUsd: executor.cost.estimatedUsd,
    latency: executor.latency,
    qualityTier: executor.qualityTier,
    rejectedReasons,
    promotion,
    assistance,
  };
}

function reject(rejections: RouteRejection[], code: RouteRejection['code'], message: string) {
  if (!rejections.some((rejection) => rejection.code === code)) rejections.push({ code, message });
}

function rank<T>(values: T[], value: T | undefined) {
  const position = value === undefined ? -1 : values.indexOf(value);
  return position < 0 ? values.length : position;
}

function summarizeAbstention(
  decisions: RouteCandidateDecision[],
  capability: string,
  domain: string,
) {
  if (decisions.length === 0) {
    return [`No executors were registered for ${capability} in ${domain}.`];
  }
  const codes = [
    ...new Set(
      decisions.flatMap((decision) => decision.rejectedReasons.map((reason) => reason.code)),
    ),
  ];
  return [
    `No credible executor satisfies ${capability} in ${domain}.`,
    ...(codes.length > 0 ? [`Rejected constraints: ${codes.join(', ')}.`] : []),
  ];
}
