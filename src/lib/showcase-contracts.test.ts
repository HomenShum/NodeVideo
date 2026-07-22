import { describe, expect, it } from 'vitest';
import { ASSET_RECEIPT_SCHEMA } from './asset-receipts';
import { SHOWCASE_MANIFEST_SCHEMA, validateShowcaseManifest } from './showcase-contracts';

const hash = `sha256:${'b'.repeat(64)}` as const;

describe('showcase manifest', () => {
  it('requires rights-cleared hash-bound public artifacts', () => {
    expect(
      validateShowcaseManifest({
        schemaVersion: SHOWCASE_MANIFEST_SCHEMA,
        id: 'nodevideo',
        title: 'NodeVideo',
        summary: 'Proof-backed creator pipeline',
        repository: 'HomenShum/NodeVideo',
        sourceCommit: '7a741cb',
        artifacts: [
          {
            id: 'hero',
            role: 'hero',
            kind: 'mp4',
            alt: 'NodeVideo creator pipeline demonstration',
            receipt: {
              schemaVersion: ASSET_RECEIPT_SCHEMA,
              id: 'asset:hero',
              assetKind: 'video',
              provider: 'nodevideo',
              model: 'edit-plan-renderer',
              createdAt: '2026-07-21T00:00:00.000Z',
              source: { referenceAssetIds: [] },
              output: { uri: 'hero.mp4', sha256: hash, mimeType: 'video/mp4', sizeBytes: 1 },
              rights: {
                sourceAssetsOwned: true,
                publicReleaseApproved: true,
                syntheticPeopleOnly: false,
                thirdPartyMarks: false,
                musicRedistribution: false,
                reviewStatus: 'approved',
                notes: [],
              },
              execution: { attempt: 1, parametersHash: hash },
              evaluation: { selected: true, scores: {}, validatorIds: [], limitations: [] },
              intendedUses: ['showcase'],
            },
          },
        ],
        proof: { testSummary: 'pass', receiptUris: [], limitations: [] },
      }).id,
    ).toBe('nodevideo');
  });
});
