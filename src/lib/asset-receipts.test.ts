import { describe, expect, it } from 'vitest';
import {
  ASSET_RECEIPT_SCHEMA,
  publicReleaseEligible,
  validateAssetReceipt,
} from './asset-receipts';

const hash = `sha256:${'a'.repeat(64)}` as const;

function receipt() {
  return {
    schemaVersion: ASSET_RECEIPT_SCHEMA,
    id: 'asset:test',
    assetKind: 'video' as const,
    provider: 'replay',
    model: 'fixture',
    createdAt: '2026-07-21T00:00:00.000Z',
    source: { referenceAssetIds: [] },
    output: { uri: 'fixtures/test.mp4', sha256: hash, mimeType: 'video/mp4', sizeBytes: 12 },
    rights: {
      sourceAssetsOwned: true,
      publicReleaseApproved: true,
      syntheticPeopleOnly: true,
      thirdPartyMarks: false,
      musicRedistribution: false,
      reviewStatus: 'approved' as const,
      notes: [],
    },
    execution: { attempt: 1, parametersHash: hash },
    evaluation: { selected: true, scores: { adherence: 0.8 }, validatorIds: [], limitations: [] },
    intendedUses: ['test'],
  };
}

describe('asset receipts', () => {
  it('accepts a provenance-complete public video', () => {
    expect(validateAssetReceipt(receipt()).id).toBe('asset:test');
    expect(publicReleaseEligible(receipt())).toBe(true);
  });

  it('fails closed on an uncleared public asset', () => {
    const candidate = receipt();
    candidate.rights.thirdPartyMarks = true;
    expect(() => validateAssetReceipt(candidate)).toThrow(/third-party marks/u);
  });
});
