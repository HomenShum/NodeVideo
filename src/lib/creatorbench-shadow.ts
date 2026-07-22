export const CREATORBENCH_SHADOW_SCHEMA = 'nodevideo.creatorbench-shadow/v1' as const;

export type ShadowRouteProposal = {
  routeReceiptId: string;
  artifactIds: string[];
  createdAt: string;
};

export type CreatorBenchShadowRecord = {
  schemaVersion: typeof CREATORBENCH_SHADOW_SCHEMA;
  id: string;
  requestId: string;
  optedInAt: string;
  localOnly: boolean;
  benchmarkContributionOptIn: boolean;
  canonicalMutationAllowed: false;
  publicationAllowed: false;
  proposals: ShadowRouteProposal[];
  selectedProposalId?: string;
  correctionTimeSeconds?: number;
  deletedAt?: string;
};

export function beginShadowEvaluation(input: {
  id: string;
  requestId: string;
  explicitOptIn: boolean;
  localOnly: boolean;
  benchmarkContributionOptIn?: boolean;
  now?: string;
}): CreatorBenchShadowRecord {
  if (!input.explicitOptIn)
    throw new Error('Production shadow evaluation requires explicit opt-in.');
  return {
    schemaVersion: CREATORBENCH_SHADOW_SCHEMA,
    id: input.id,
    requestId: input.requestId,
    optedInAt: input.now ?? new Date().toISOString(),
    localOnly: input.localOnly,
    benchmarkContributionOptIn: input.benchmarkContributionOptIn ?? false,
    canonicalMutationAllowed: false,
    publicationAllowed: false,
    proposals: [],
  };
}

export function recordShadowProposal(
  record: CreatorBenchShadowRecord,
  proposal: ShadowRouteProposal,
): CreatorBenchShadowRecord {
  assertActive(record);
  if (record.proposals.some((item) => item.routeReceiptId === proposal.routeReceiptId))
    return record;
  return { ...record, proposals: [...record.proposals, proposal] };
}

export function recordShadowChoice(
  record: CreatorBenchShadowRecord,
  input: { routeReceiptId: string; correctionTimeSeconds: number },
): CreatorBenchShadowRecord {
  assertActive(record);
  if (!record.proposals.some((proposal) => proposal.routeReceiptId === input.routeReceiptId)) {
    throw new Error('Selected shadow proposal is not part of this comparison.');
  }
  if (!Number.isFinite(input.correctionTimeSeconds) || input.correctionTimeSeconds < 0) {
    throw new Error('Correction time must be non-negative.');
  }
  return {
    ...record,
    selectedProposalId: input.routeReceiptId,
    correctionTimeSeconds: input.correctionTimeSeconds,
  };
}

export function deleteShadowEvaluation(
  record: CreatorBenchShadowRecord,
  now = new Date().toISOString(),
): CreatorBenchShadowRecord {
  return {
    ...record,
    proposals: [],
    selectedProposalId: undefined,
    correctionTimeSeconds: undefined,
    deletedAt: now,
  };
}

export function mayContributeShadowRecord(record: CreatorBenchShadowRecord) {
  return Boolean(
    !record.deletedAt && record.benchmarkContributionOptIn && record.selectedProposalId,
  );
}

function assertActive(record: CreatorBenchShadowRecord) {
  if (record.deletedAt) throw new Error('Deleted shadow evaluation data cannot be reused.');
  if (record.canonicalMutationAllowed || record.publicationAllowed) {
    throw new Error('Shadow evaluation can never mutate or publish canonical work.');
  }
}
