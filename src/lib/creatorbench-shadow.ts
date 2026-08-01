import { type RouteReceipt, validateRouteReceipt } from './route-receipts.ts';

export const CREATORBENCH_SHADOW_SCHEMA = 'nodevideo.creatorbench-shadow/v1' as const;
export const MAXIMUM_SHADOW_RETENTION_DAYS = 30;

export type ShadowPrivacyPolicy = {
  localOnly: boolean;
  mediaEgress: 'prohibited' | 'derived-only' | 'allowed';
  approvedExecutorIds: string[];
};

export type ShadowRetentionPolicy =
  | { mode: 'delete-on-completion' }
  | { mode: 'time-bounded'; deleteAfter: string };

export type ShadowRouteProposal = {
  routeReceiptId: string;
  executorId: string;
  disposition: Exclude<RouteReceipt['disposition'], 'abstain'>;
  artifactIds: string[];
  createdAt: string;
  canonicalMutationAllowed: false;
  publicationAllowed: false;
};

export type ShadowCreatorChoice = {
  routeReceiptId: string;
  rejectedRouteReceiptIds: string[];
  correctionTimeSeconds: number;
  recordedAt: string;
};

export type ShadowDeletionReceipt = {
  deletedAt: string;
  reason: 'creator-request' | 'retention-expired' | 'completion-policy';
  removedArtifactIds: string[];
  benchmarkContributionRevoked: true;
};

export type CreatorBenchShadowRecord = {
  schemaVersion: typeof CREATORBENCH_SHADOW_SCHEMA;
  id: string;
  requestId: string;
  enabled: true;
  optedInAt: string;
  privacy: ShadowPrivacyPolicy;
  retention: ShadowRetentionPolicy;
  benchmarkContributionOptIn: boolean;
  benchmarkContributionOptedInAt?: string;
  canonicalMutationAllowed: false;
  publicationAllowed: false;
  proposals: ShadowRouteProposal[];
  creatorChoice?: ShadowCreatorChoice;
  deletion?: ShadowDeletionReceipt;
};

/** Shadow evaluation is fail-closed: the caller must enable it and collect creator consent. */
export function beginShadowEvaluation(input: {
  id: string;
  requestId: string;
  shadowModeEnabled?: boolean;
  explicitOptIn: boolean;
  privacy: ShadowPrivacyPolicy;
  retention?: ShadowRetentionPolicy;
  now?: string;
}): CreatorBenchShadowRecord {
  if (input.shadowModeEnabled !== true) {
    throw new Error('Production shadow mode is disabled by default.');
  }
  if (!input.explicitOptIn) {
    throw new Error('Production shadow evaluation requires explicit opt-in.');
  }
  validatePrivacyPolicy(input.privacy);
  const optedInAt = input.now ?? new Date().toISOString();
  validDate(optedInAt, 'Shadow opt-in timestamp');
  const retention = input.retention ?? { mode: 'delete-on-completion' };
  validateRetention(retention, optedInAt);
  return {
    schemaVersion: CREATORBENCH_SHADOW_SCHEMA,
    id: input.id,
    requestId: input.requestId,
    enabled: true,
    optedInAt,
    privacy: input.privacy,
    retention,
    benchmarkContributionOptIn: false,
    canonicalMutationAllowed: false,
    publicationAllowed: false,
    proposals: [],
  };
}

/** Only eligible, selected route proposals may enter a shadow comparison. */
export function recordShadowProposal(
  record: CreatorBenchShadowRecord,
  input: { routeReceipt: RouteReceipt; artifactIds: string[]; createdAt?: string },
): CreatorBenchShadowRecord {
  assertActive(record);
  const receipt = validateRouteReceipt(input.routeReceipt);
  if (receipt.requestId !== record.requestId) {
    throw new Error('Shadow proposal route belongs to a different creator request.');
  }
  if (receipt.disposition === 'abstain' || receipt.selectedExecutorId === null) {
    throw new Error('An abstained route cannot produce a shadow proposal.');
  }
  const decision = receipt.candidateDecisions.find(
    (candidate) => candidate.executorId === receipt.selectedExecutorId,
  );
  if (!decision?.eligible) {
    throw new Error('Shadow proposal executor is not eligible.');
  }
  assertPrivacyCompatible(record.privacy, receipt);
  if (input.artifactIds.length === 0) {
    throw new Error('Shadow proposal requires at least one non-canonical proposal artifact.');
  }
  if (record.proposals.some((item) => item.routeReceiptId === receipt.id)) return record;
  return {
    ...record,
    proposals: [
      ...record.proposals,
      {
        routeReceiptId: receipt.id,
        executorId: receipt.selectedExecutorId,
        disposition: receipt.disposition,
        artifactIds: [...input.artifactIds],
        createdAt: input.createdAt ?? new Date().toISOString(),
        canonicalMutationAllowed: false,
        publicationAllowed: false,
      },
    ],
  };
}

export function recordShadowChoice(
  record: CreatorBenchShadowRecord,
  input: { routeReceiptId: string; correctionTimeSeconds: number; recordedAt?: string },
): CreatorBenchShadowRecord {
  assertActive(record);
  if (record.proposals.length < 2) {
    throw new Error('Creator choice requires at least two eligible shadow proposals.');
  }
  if (!record.proposals.some((proposal) => proposal.routeReceiptId === input.routeReceiptId)) {
    throw new Error('Selected shadow proposal is not part of this comparison.');
  }
  if (!Number.isFinite(input.correctionTimeSeconds) || input.correctionTimeSeconds < 0) {
    throw new Error('Correction time must be non-negative.');
  }
  return {
    ...record,
    creatorChoice: {
      routeReceiptId: input.routeReceiptId,
      rejectedRouteReceiptIds: record.proposals
        .map((proposal) => proposal.routeReceiptId)
        .filter((routeReceiptId) => routeReceiptId !== input.routeReceiptId),
      correctionTimeSeconds: input.correctionTimeSeconds,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
    },
  };
}

/** Benchmark contribution always requires a second, separately timestamped opt-in. */
export function optInShadowBenchmark(
  record: CreatorBenchShadowRecord,
  input: { explicitOptIn: boolean; now?: string },
): CreatorBenchShadowRecord {
  assertActive(record);
  if (!input.explicitOptIn) {
    throw new Error('Benchmark contribution requires separate explicit opt-in.');
  }
  const benchmarkContributionOptedInAt = input.now ?? new Date().toISOString();
  validDate(benchmarkContributionOptedInAt, 'Benchmark contribution opt-in timestamp');
  if (Date.parse(benchmarkContributionOptedInAt) < Date.parse(record.optedInAt)) {
    throw new Error('Benchmark contribution opt-in cannot precede shadow-mode opt-in.');
  }
  return {
    ...record,
    benchmarkContributionOptIn: true,
    benchmarkContributionOptedInAt,
  };
}

export function deleteShadowEvaluation(
  record: CreatorBenchShadowRecord,
  input: {
    reason?: ShadowDeletionReceipt['reason'];
    now?: string;
  } = {},
): CreatorBenchShadowRecord {
  const removedArtifactIds = record.proposals.flatMap((proposal) => proposal.artifactIds);
  return {
    ...record,
    proposals: [],
    creatorChoice: undefined,
    benchmarkContributionOptIn: false,
    benchmarkContributionOptedInAt: undefined,
    deletion: {
      deletedAt: input.now ?? new Date().toISOString(),
      reason: input.reason ?? 'creator-request',
      removedArtifactIds,
      benchmarkContributionRevoked: true,
    },
  };
}

export function enforceShadowRetention(
  record: CreatorBenchShadowRecord,
  now = new Date().toISOString(),
): CreatorBenchShadowRecord {
  if (record.deletion || record.retention.mode !== 'time-bounded') return record;
  return Date.parse(now) >= Date.parse(record.retention.deleteAfter)
    ? deleteShadowEvaluation(record, { reason: 'retention-expired', now })
    : record;
}

export function completeShadowEvaluation(
  record: CreatorBenchShadowRecord,
  now = new Date().toISOString(),
): CreatorBenchShadowRecord {
  assertActive(record);
  return record.retention.mode === 'delete-on-completion'
    ? deleteShadowEvaluation(record, { reason: 'completion-policy', now })
    : record;
}

export function mayContributeShadowRecord(
  record: CreatorBenchShadowRecord,
  now = new Date().toISOString(),
) {
  const retained = enforceShadowRetention(record, now);
  return Boolean(
    !retained.deletion &&
      retained.benchmarkContributionOptIn &&
      retained.benchmarkContributionOptedInAt &&
      retained.creatorChoice,
  );
}

function assertPrivacyCompatible(policy: ShadowPrivacyPolicy, receipt: RouteReceipt) {
  if (policy.localOnly && receipt.request.privacy !== 'local-only') {
    throw new Error('Local-only shadow evaluation rejected an egress route.');
  }
  if (policy.mediaEgress === 'prohibited' && receipt.request.privacy !== 'local-only') {
    throw new Error('Shadow media-egress policy rejected this route.');
  }
  if (policy.mediaEgress === 'derived-only' && receipt.request.privacy === 'media-egress') {
    throw new Error('Shadow policy allows derived data, not full media egress.');
  }
  if (
    policy.approvedExecutorIds.length > 0 &&
    receipt.selectedExecutorId &&
    !policy.approvedExecutorIds.includes(receipt.selectedExecutorId)
  ) {
    throw new Error('Shadow proposal selected an unapproved executor.');
  }
}

function validatePrivacyPolicy(policy: ShadowPrivacyPolicy) {
  if (policy.localOnly && policy.mediaEgress !== 'prohibited') {
    throw new Error('Local-only shadow evaluation must prohibit media egress.');
  }
  if (new Set(policy.approvedExecutorIds).size !== policy.approvedExecutorIds.length) {
    throw new Error('Shadow approved executor IDs must be unique.');
  }
}

function validateRetention(retention: ShadowRetentionPolicy, optedInAt: string) {
  if (retention.mode !== 'time-bounded') return;
  validDate(retention.deleteAfter, 'Shadow retention deadline');
  const duration = Date.parse(retention.deleteAfter) - Date.parse(optedInAt);
  const maximum = MAXIMUM_SHADOW_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  if (duration <= 0 || duration > maximum) {
    throw new Error(
      `Shadow retention must be positive and at most ${MAXIMUM_SHADOW_RETENTION_DAYS} days.`,
    );
  }
}

function assertActive(record: CreatorBenchShadowRecord) {
  if (record.deletion) throw new Error('Deleted shadow evaluation data cannot be reused.');
  if (record.canonicalMutationAllowed || record.publicationAllowed) {
    throw new Error('Shadow evaluation can never mutate or publish canonical work.');
  }
}

function validDate(value: string, label: string) {
  if (Number.isNaN(Date.parse(value))) throw new Error(`${label} is invalid.`);
}
