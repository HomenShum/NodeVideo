import type { ExecutorDefinition } from './media-orchestration-contracts.ts';

export const ROUTE_RECEIPT_SCHEMA = 'nodevideo.route-receipt.v1' as const;

export type RouteDisposition = 'automatic' | 'assisted' | 'review' | 'abstain';

export type RouteRejectionCode =
  | 'capability-mismatch'
  | 'domain-mismatch'
  | 'executor-unavailable'
  | 'privacy-conflict'
  | 'media-egress-disallowed'
  | 'derived-frame-egress-disallowed'
  | 'cost-limit-exceeded'
  | 'latency-limit-exceeded'
  | 'license-incompatible'
  | 'gpu-unavailable'
  | 'previous-attempt-failed';

export type RouteRejection = {
  code: RouteRejectionCode;
  message: string;
  constraint?: string;
  observed?: string | number | boolean;
};

export type PromotionDecision = {
  promoted: boolean;
  sampleSize: number;
  successes: number;
  successRate: number;
  successLowerBound: number;
  silentFailures: number;
  silentFailureRate: number;
  reasons: string[];
};

export type RouteCandidateDecision = {
  executorId: string;
  eligible: boolean;
  requestedDisposition: Exclude<RouteDisposition, 'abstain'>;
  effectiveDisposition?: Exclude<RouteDisposition, 'abstain'>;
  estimatedCostUsd: number;
  latency: ExecutorDefinition['latency'];
  qualityTier: ExecutorDefinition['qualityTier'];
  rejectedReasons: RouteRejection[];
  promotion?: PromotionDecision;
  assistance?: {
    kind: 'manual-seed' | 'human-review' | 'license-review';
    instruction: string;
  };
};

export type RouteFallbackAttempt = {
  executorId: string;
  outcome: 'failed' | 'unavailable' | 'rejected' | 'succeeded';
  reason: string;
  attemptedAt: string;
};

export type RouteReceipt = {
  schemaVersion: typeof ROUTE_RECEIPT_SCHEMA;
  id: string;
  requestId: string;
  createdAt: string;
  request: {
    capability: string;
    domain: string;
    privacy: 'local-only' | 'derived-egress' | 'media-egress';
    maximumCostUsd: number;
    maximumLatency: ExecutorDefinition['latency'];
    commercialUseRequired: boolean;
    requireBenchmarkPromotion: boolean;
  };
  disposition: RouteDisposition;
  selectedExecutorId: string | null;
  selectedAssistance?: RouteCandidateDecision['assistance'];
  selectedCostEstimateUsd: number | null;
  privacyClassification: 'local-only' | 'derived-egress' | 'media-egress';
  licenseClassification: 'commercial-compatible' | 'not-evaluated';
  confidence: number;
  userIntervention: { required: boolean; kind?: string };
  toolModelVersions: string[];
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  candidateDecisions: RouteCandidateDecision[];
  fallbackHistory: RouteFallbackAttempt[];
  abstentionReasons: string[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateRouteReceipt(receipt: RouteReceipt): RouteReceipt {
  assert(receipt.schemaVersion === ROUTE_RECEIPT_SCHEMA, 'RouteReceipt schema is unsupported');
  assert(Boolean(receipt.id && receipt.requestId), 'RouteReceipt identity is required');
  assert(Number.isFinite(Date.parse(receipt.createdAt)), 'RouteReceipt createdAt is invalid');
  assert(receipt.request.capability.length > 0, 'RouteReceipt capability is required');
  assert(receipt.request.domain.length > 0, 'RouteReceipt domain is required');
  assert(receipt.request.maximumCostUsd >= 0, 'RouteReceipt maximum cost must be non-negative');
  assert(receipt.confidence >= 0 && receipt.confidence <= 1, 'RouteReceipt confidence is invalid');
  assert(Array.isArray(receipt.toolModelVersions), 'RouteReceipt tool/model versions are required');
  assert(Array.isArray(receipt.inputArtifactIds), 'RouteReceipt input artifact IDs are required');
  assert(Array.isArray(receipt.outputArtifactIds), 'RouteReceipt output artifact IDs are required');

  const selected = receipt.candidateDecisions.filter(
    (candidate) => candidate.executorId === receipt.selectedExecutorId,
  );
  if (receipt.disposition === 'abstain') {
    assert(receipt.selectedExecutorId === null, 'Abstention cannot select an executor');
    assert(receipt.abstentionReasons.length > 0, 'Abstention requires an explanation');
  } else {
    assert(receipt.selectedExecutorId !== null, 'A routed receipt must select an executor');
    assert(selected.length === 1, 'Selected executor must have exactly one candidate decision');
    assert(selected[0]?.eligible, 'Selected executor must be eligible');
    assert(
      selected[0]?.effectiveDisposition === receipt.disposition,
      'Selected executor disposition must match the receipt',
    );
    if (receipt.disposition === 'assisted' || receipt.disposition === 'review') {
      assert(
        Boolean(receipt.selectedAssistance),
        `${receipt.disposition} routing requires guidance`,
      );
    }
  }

  for (const decision of receipt.candidateDecisions) {
    assert(Boolean(decision.executorId), 'Candidate executor ID is required');
    assert(decision.estimatedCostUsd >= 0, 'Candidate cost must be non-negative');
    if (!decision.eligible) {
      assert(decision.rejectedReasons.length > 0, 'Ineligible candidates require rejected reasons');
    }
  }

  return receipt;
}
