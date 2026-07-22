import {
  type MediaIndex,
  STORY_GRAPH_SCHEMA,
  type StoryGraph,
  type TimeRange,
  validateMediaIndex,
} from './media-orchestration-contracts.ts';

export type CleanupCandidate = TimeRange & {
  id: string;
  kind: 'silence' | 'filler';
  reason: string;
  confidence: number;
  approval: 'automatic' | 'required';
};

const pauseThreshold = { tight: 700, natural: 1_200, presentation: 1_800 } as const;

export function proposeTalkingHeadCleanup(
  mediaIndex: MediaIndex,
  options: { pausePolicy: keyof typeof pauseThreshold; removeFillers: boolean },
): CleanupCandidate[] {
  validateMediaIndex(mediaIndex);
  if (!mediaIndex.speech) return [];
  const duration = mediaIndex.technical.durationMs;
  const candidates: CleanupCandidate[] = mediaIndex.speech.silenceRegions
    .filter((range) => range.endMs - range.startMs >= pauseThreshold[options.pausePolicy])
    .map<CleanupCandidate>((range, index) => {
      const candidate = {
        startMs: Math.min(range.startMs + 120, range.endMs),
        endMs: Math.max(range.endMs - 120, range.startMs),
      };
      const overlapsTranscript = mediaIndex.speech?.words.some(
        (word) => word.startMs < candidate.endMs && word.endMs > candidate.startMs,
      );
      return {
        id: `cleanup:silence:${index}`,
        kind: 'silence',
        ...candidate,
        reason: overlapsTranscript
          ? 'Acoustic silence overlaps transcript timing; review protects speech and intentional cadence'
          : `${options.pausePolicy} pause policy preserves 120 ms at each speech edge`,
        confidence: overlapsTranscript ? 0.5 : 1,
        approval: overlapsTranscript ? 'required' : 'automatic',
      };
    })
    .filter((range) => range.endMs > range.startMs);
  if (options.removeFillers) {
    for (const [index, filler] of mediaIndex.speech.fillers.entries()) {
      if (filler.confidence < 0.8) continue;
      candidates.push({
        id: `cleanup:filler:${index}`,
        kind: 'filler',
        startMs: Math.max(0, filler.startMs - 20),
        endMs: Math.min(duration, filler.endMs + 20),
        reason: `Detected filler “${filler.text}”; review protects meaning and cadence`,
        confidence: filler.confidence,
        approval: 'required',
      });
    }
  }
  return candidates.sort((left, right) => left.startMs - right.startMs);
}

export function rankGoldenQuotes(mediaIndex: MediaIndex) {
  validateMediaIndex(mediaIndex);
  return [...mediaIndex.semantics.quotes]
    .map((quote) => ({
      ...quote,
      score:
        quote.scores.clarity * 0.35 +
        quote.scores.hook * 0.3 +
        quote.scores.selfContained * 0.25 +
        quote.scores.novelty * 0.1,
    }))
    .sort((left, right) => right.score - left.score);
}

export function buildFounderStoryGraph(mediaIndex: MediaIndex): StoryGraph {
  const quotes = rankGoldenQuotes(mediaIndex);
  if (quotes.length === 0)
    throw new Error('Founder story requires at least one source-grounded quote');
  const selected = quotes[0];
  const demonstration = mediaIndex.semantics.demonstrations[0];
  const nodes: StoryGraph['nodes'] = [
    {
      id: 'story.hook',
      role: 'hook',
      label: selected.text,
      sourceRanges: [{ assetId: mediaIndex.assetId, range: selected }],
      evidenceIds: [selected.id],
    },
  ];
  if (demonstration) {
    nodes.push({
      id: 'story.demo',
      role: 'demo',
      label: demonstration.label,
      sourceRanges: [{ assetId: mediaIndex.assetId, range: demonstration }],
      evidenceIds: [demonstration.id],
    });
  }
  nodes.push({
    id: 'story.cta',
    role: 'cta',
    label: 'Creator-supplied call to action required',
    sourceRanges: [],
    evidenceIds: [],
  });
  return {
    schemaVersion: STORY_GRAPH_SCHEMA,
    id: `story:${mediaIndex.id}`,
    mediaIndexIds: [mediaIndex.id],
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      from: nodes[index].id,
      to: node.id,
      kind: 'precedes' as const,
    })),
  };
}
