import { describe, expect, it } from 'vitest';
import { validateEditPlan } from './edit-contracts';
import { validateEditPlanV2 } from './edit-plan-v2';
import { compileFounderVariants } from './founder-variant-compiler';
import {
  EDIT_INTENT_SCHEMA,
  type EditIntent,
  MEDIA_INDEX_SCHEMA,
  type MediaIndex,
} from './media-orchestration-contracts';

const index: MediaIndex = {
  schemaVersion: MEDIA_INDEX_SCHEMA,
  id: 'index:founder',
  assetId: 'asset.creator-source',
  sourceHash: `sha256:${'a'.repeat(64)}`,
  technical: { durationMs: 30_000, width: 1920, height: 1080, frameRate: 30, audioTracks: 1 },
  speech: {
    words: [],
    silenceRegions: [{ startMs: 8_000, endMs: 10_000 }],
    fillers: [{ startMs: 3_000, endMs: 3_300, text: 'um', confidence: 0.92 }],
  },
  visual: {
    shots: [{ id: 'shot:1', startMs: 0, endMs: 30_000, confidence: 1 }],
    subjectTrackIds: [],
    textRegions: [],
  },
  audio: { speechRegions: [{ startMs: 0, endMs: 30_000 }], musicRegions: [] },
  semantics: {
    topics: [],
    quotes: [
      {
        id: 'quote:golden',
        text: 'We built the proof before the pitch.',
        startMs: 11_000,
        endMs: 18_000,
        scores: { clarity: 1, hook: 0.95, novelty: 0.8, selfContained: 1 },
      },
    ],
    demonstrations: [],
  },
  provenance: { generatedAt: '2026-07-21T00:00:00.000Z', tools: [] },
};

const intent: EditIntent = {
  schemaVersion: EDIT_INTENT_SCHEMA,
  id: 'intent:founder',
  goal: 'Create reusable founder variants',
  instructions: 'Preserve meaning.',
  sourceAssetIds: [index.assetId],
  outputs: [
    { id: 'clean', purpose: 'clean-master', aspectRatio: 'source' },
    { id: 'short', purpose: 'short', durationSeconds: 15, aspectRatio: '9:16', platform: 'tiktok' },
  ],
  constraints: {
    preserveMeaning: true,
    requireHumanApproval: true,
    allowMediaEgress: false,
    allowGenerativeMedia: false,
    maximumCostUsd: 1,
    preferredRuntime: 'browser',
  },
};

describe('founder variant compiler', () => {
  it('analyzes once and emits renderer-valid, lineage-preserving variants', () => {
    const result = compileFounderVariants(index, intent);
    expect(result.variantSet.sharedMediaIndexIds).toEqual([index.id]);
    expect(result.variants).toHaveLength(2);
    for (const variant of result.variants) {
      expect(() => validateEditPlan(variant.rendererPlan)).not.toThrow();
      expect(() => validateEditPlanV2(variant.semanticPlan)).not.toThrow();
      expect(variant.semanticPlan.lineage.sourceAssetIds).toEqual([index.assetId]);
    }
  });

  it('keeps filler deletion behind an approval while applying deterministic silence cleanup', () => {
    const { variants } = compileFounderVariants(index, intent);
    const clean = variants[0];
    expect(clean.semanticPlan.approvals).toHaveLength(1);
    expect(clean.rendererPlan.durationFrames).toBeLessThan(30 * 30);
    expect(clean.semanticPlan.operations).toContainEqual(
      expect.objectContaining({ kind: 'remove', reason: expect.stringContaining('filler') }),
    );
  });

  it('grounds short-form selection in the top-ranked quote', () => {
    const short = compileFounderVariants(index, intent).variants[1];
    const retained = short.semanticPlan.operations.find((operation) => operation.kind === 'retain');
    expect(retained).toMatchObject({ sourceStartMs: 11_000, sourceEndMs: 18_000 });
  });
});
