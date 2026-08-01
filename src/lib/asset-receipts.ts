export const ASSET_RECEIPT_SCHEMA = 'node.asset-receipt.v1' as const;

export type AssetKind = 'image' | 'video' | 'audio' | 'gif' | 'glb' | 'gaussian-splat' | 'document';

export type AssetReceipt = {
  schemaVersion: typeof ASSET_RECEIPT_SCHEMA;
  id: string;
  assetKind: AssetKind;
  provider: string;
  model: string;
  generationId?: string;
  createdAt: string;
  source: {
    promptHash?: `sha256:${string}`;
    promptFile?: string;
    referenceAssetIds: string[];
    sourceCommit?: string;
    recipeId?: string;
  };
  output: {
    uri: string;
    sha256: `sha256:${string}`;
    mimeType: string;
    sizeBytes: number;
    width?: number;
    height?: number;
    durationMs?: number;
  };
  rights: {
    sourceAssetsOwned: boolean;
    publicReleaseApproved: boolean;
    syntheticPeopleOnly: boolean;
    thirdPartyMarks: boolean;
    musicRedistribution: boolean;
    providerTermsSnapshot?: string;
    reviewStatus: 'pending' | 'approved' | 'rejected';
    notes: string[];
  };
  execution: {
    startedAt?: string;
    completedAt?: string;
    estimatedCostUsd?: number;
    actualCostUsd?: number;
    latencyMs?: number;
    attempt: number;
    parametersHash: `sha256:${string}`;
  };
  evaluation: {
    selected: boolean;
    scores: Record<string, number>;
    validatorIds: string[];
    limitations: string[];
  };
  intendedUses: string[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateAssetReceipt(receipt: AssetReceipt): AssetReceipt {
  assert(receipt.schemaVersion === ASSET_RECEIPT_SCHEMA, 'AssetReceipt schema is unsupported');
  assert(
    Boolean(receipt.id && receipt.provider && receipt.model),
    'AssetReceipt identity is required',
  );
  assert(/^sha256:[a-f\d]{64}$/u.test(receipt.output.sha256), 'Output SHA-256 is invalid');
  assert(
    /^sha256:[a-f\d]{64}$/u.test(receipt.execution.parametersHash),
    'Parameter hash is invalid',
  );
  assert(receipt.output.sizeBytes >= 0, 'Output size must be non-negative');
  assert(receipt.execution.attempt >= 1, 'Execution attempt must be positive');
  for (const [name, score] of Object.entries(receipt.evaluation.scores)) {
    assert(
      Number.isFinite(score) && score >= 0 && score <= 1,
      `${name} score must be between 0 and 1`,
    );
  }
  if (receipt.rights.publicReleaseApproved) {
    assert(
      receipt.rights.reviewStatus === 'approved',
      'Public assets require approved rights review',
    );
    assert(
      !receipt.rights.thirdPartyMarks,
      'Public assets cannot contain uncleared third-party marks',
    );
  }
  return receipt;
}

export function publicReleaseEligible(receipt: AssetReceipt) {
  validateAssetReceipt(receipt);
  return (
    receipt.rights.publicReleaseApproved &&
    receipt.rights.reviewStatus === 'approved' &&
    !receipt.rights.thirdPartyMarks &&
    (receipt.assetKind !== 'audio' || receipt.rights.musicRedistribution)
  );
}
