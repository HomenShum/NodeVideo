import { describe, expect, it } from 'vitest';
import {
  buildFounderStoryGraph,
  proposeTalkingHeadCleanup,
  rankGoldenQuotes,
} from './founder-content';
import { MEDIA_INDEX_SCHEMA, type MediaIndex } from './media-orchestration-contracts';

const index: MediaIndex = {
  schemaVersion: MEDIA_INDEX_SCHEMA,
  id: 'media-index.founder-v1',
  assetId: 'asset.founder-interview',
  sourceHash: `sha256:${'a'.repeat(64)}`,
  technical: { durationMs: 120_000, width: 1920, height: 1080, frameRate: 30, audioTracks: 1 },
  speech: {
    words: [
      { startMs: 1_000, endMs: 1_300, text: 'We', confidence: 0.99 },
      { startMs: 1_320, endMs: 1_700, text: 'built', confidence: 0.99 },
    ],
    silenceRegions: [
      { startMs: 2_000, endMs: 2_500 },
      { startMs: 4_000, endMs: 6_200 },
    ],
    fillers: [
      { startMs: 7_000, endMs: 7_300, text: 'um', confidence: 0.94 },
      { startMs: 8_000, endMs: 8_150, text: 'like', confidence: 0.55 },
    ],
  },
  visual: {
    shots: [{ id: 'shot.1', startMs: 0, endMs: 120_000, confidence: 1 }],
    subjectTrackIds: ['subject.founder'],
    textRegions: [],
  },
  audio: { speechRegions: [{ startMs: 0, endMs: 120_000 }], musicRegions: [] },
  semantics: {
    topics: [
      { id: 'topic.problem', label: 'problem', startMs: 10_000, endMs: 30_000, confidence: 0.9 },
    ],
    quotes: [
      {
        id: 'quote.clear',
        text: 'We turned a week of work into one reviewable hour.',
        startMs: 40_000,
        endMs: 46_000,
        scores: { clarity: 0.96, hook: 0.91, novelty: 0.8, selfContained: 0.97 },
      },
      {
        id: 'quote.vague',
        text: 'And that is why it matters.',
        startMs: 50_000,
        endMs: 52_000,
        scores: { clarity: 0.7, hook: 0.6, novelty: 0.5, selfContained: 0.2 },
      },
    ],
    demonstrations: [
      {
        id: 'demo.product',
        label: 'Product workflow',
        startMs: 60_000,
        endMs: 82_000,
        confidence: 0.92,
      },
    ],
  },
  provenance: {
    generatedAt: '2026-07-21T00:00:00.000Z',
    tools: [
      { id: 'fixture.indexer', version: '1.0.0', parametersHash: `sha256:${'b'.repeat(64)}` },
    ],
  },
};

describe('founder content deterministic workflow', () => {
  it('proposes only long pauses and confident fillers with review boundaries', () => {
    const candidates = proposeTalkingHeadCleanup(index, {
      pausePolicy: 'natural',
      removeFillers: true,
    });
    expect(candidates.map((item) => item.kind)).toEqual(['silence', 'filler']);
    expect(candidates[0]).toMatchObject({ startMs: 4_120, endMs: 6_080, approval: 'automatic' });
    expect(candidates[1]).toMatchObject({ startMs: 6_980, endMs: 7_320, approval: 'required' });
  });

  it('ranks a clear self-contained quote above a vague fragment', () => {
    expect(rankGoldenQuotes(index)[0].id).toBe('quote.clear');
  });

  it('builds a source-grounded hook-to-demo-to-CTA story graph', () => {
    const graph = buildFounderStoryGraph(index);
    expect(graph.nodes.map((node) => node.role)).toEqual(['hook', 'demo', 'cta']);
    expect(graph.nodes[0].evidenceIds).toEqual(['quote.clear']);
    expect(graph.nodes[2].evidenceIds).toEqual([]);
  });
});
