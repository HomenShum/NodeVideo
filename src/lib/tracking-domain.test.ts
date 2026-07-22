import { describe, expect, it } from 'vitest';
import {
  TRACKING_ATLAS_RECEIPT_SCHEMA,
  TRACKING_DOMAIN_PACKS,
  selectTrackingDomainPack,
  summarizeTrackingCoverage,
  validateTrackingAtlasReceipt,
} from './tracking-domain';

const receipt = {
  schemaVersion: TRACKING_ATLAS_RECEIPT_SCHEMA,
  id: 'atlas:group-performance',
  packId: 'group-performance',
  source: {
    videoId: 'vLQ7wIeHSMM',
    url: 'https://www.youtube.com/watch?v=vLQ7wIeHSMM',
    title: 'People Dancing',
    uploader: 'fixture uploader',
    license: 'Creative Commons Attribution license (reuse allowed)',
    sourceSha256: `sha256:${'a'.repeat(64)}`,
    retrievedAt: '2026-07-21T00:00:00.000Z',
  },
  execution: {
    detector: 'yolo11n-coco',
    tracker: 'bytetrack',
    policy: 'group-formation',
    frameCount: 120,
    analyzedFrames: 120,
    latencyMs: 100,
    costUsd: 0,
  },
  evaluation: {
    tier: 'rights-cleared-fixture' as const,
    detectionCoverage: 0.95,
    targetCoverage: 0.92,
    lowConfidenceHoldRate: 0.04,
    trackSwitchCount: 0,
    manualCorrections: 0,
    previewExportParity: true,
    verdict: 'pass' as const,
    limitations: ['Creative Commons stock fixture; not creator-held-out media.'],
  },
  outputs: {
    beforeImage: 'before.jpg',
    afterImage: 'after.jpg',
    comparisonVideo: 'comparison.mp4',
    analysisVideo: 'analysis.mp4',
    receipt: 'receipt.json',
    sha256: {
      beforeImage: `sha256:${'b'.repeat(64)}`,
      afterImage: `sha256:${'c'.repeat(64)}`,
      comparisonVideo: `sha256:${'d'.repeat(64)}`,
      analysisVideo: `sha256:${'e'.repeat(64)}`,
    },
  },
};

describe('tracking domain catalog', () => {
  it('covers group, object, animal, and multiple sport packs', () => {
    expect(new Set(TRACKING_DOMAIN_PACKS.map((pack) => pack.domain))).toEqual(
      new Set(['group', 'object', 'animal', 'sport']),
    );
    expect(TRACKING_DOMAIN_PACKS.filter((pack) => pack.domain === 'sport').length).toBeGreaterThan(
      3,
    );
  });

  it('routes explicit semantics to a specialized pack', () => {
    expect(selectTrackingDomainPack({ domain: 'sport', labels: ['skateboard'] }).id).toBe(
      'sport-skateboarding',
    );
    expect(selectTrackingDomainPack({ domain: 'object', labels: ['cup'] }).id).toBe(
      'object-product',
    );
  });

  it('fails closed on unsupported licenses and inflated verdicts', () => {
    expect(validateTrackingAtlasReceipt(receipt).id).toBe('atlas:group-performance');
    expect(() =>
      validateTrackingAtlasReceipt({
        ...receipt,
        evaluation: { ...receipt.evaluation, targetCoverage: 0.5 },
      }),
    ).toThrow(/cannot pass/u);
    expect(() =>
      validateTrackingAtlasReceipt({
        ...receipt,
        source: { ...receipt.source, license: 'Standard YouTube License' },
      }),
    ).toThrow(/reusable/u);
  });

  it('summarizes validation coverage without hiding review cases', () => {
    expect(
      summarizeTrackingCoverage([
        receipt,
        {
          ...receipt,
          id: 'atlas:object-product',
          packId: 'object-product',
          evaluation: { ...receipt.evaluation, verdict: 'review', targetCoverage: 0.7 },
        },
      ]),
    ).toMatchObject({ total: 2, passed: 1, review: 1, failed: 0, domains: 2 });
  });
});
