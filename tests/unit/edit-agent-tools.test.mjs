import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  nudgeBoundary,
  planSummary,
  reorderClips,
  setOverlayText,
  swapClipSource,
  videoClips,
} from '../../scripts/workers/edit-agent.mjs';

// The committed, hash-verified Sign plan — the same data the studio loads.
const plan = JSON.parse(
  readFileSync(
    new URL('../../fixtures/media/integrated-source-only-v1/edit-plan.json', import.meta.url),
    'utf8',
  ),
);

describe('edit agent plan operations (real Sign plan)', () => {
  it('summarizes the plan the model grounds on', () => {
    const summary = planSummary(plan);
    expect(summary.bpm).toBeCloseTo(107.7, 1);
    expect(summary.clips.length).toBeGreaterThanOrEqual(5);
    expect(summary.overlays.length).toBeGreaterThanOrEqual(10);
    expect(summary.clips[0].lane).toMatch(/^[AB]$/);
  });

  it('swap keeps the timeline range and re-aligns the source to the other take', () => {
    const before = videoClips(plan)[1];
    const { plan: next, patch, error } = swapClipSource(plan, 1);
    expect(error).toBeUndefined();
    expect(patch).toEqual({ kind: 'swap-source', clipIndex: 1 });
    const after = videoClips(next)[1];
    expect(after.timelineRange).toEqual(before.timelineRange);
    expect(after.assetId).not.toEqual(before.assetId);
    // The original plan must not be mutated (proposals are copies).
    expect(videoClips(plan)[1].assetId).toEqual(before.assetId);
  });

  it('nudge moves the boundary and keeps the timeline contiguous', () => {
    const { plan: next, error } = nudgeBoundary(plan, 0, -1);
    expect(error).toBeUndefined();
    const clips = videoClips(next);
    expect(clips[0].timelineRange.endFrameExclusive).toEqual(clips[1].timelineRange.startFrame);
    expect(clips[0].timelineRange.endFrameExclusive).toBeLessThan(
      videoClips(plan)[0].timelineRange.endFrameExclusive,
    );
  });

  it('nudge refuses to collapse a clip below one beat', () => {
    const { error } = nudgeBoundary(plan, 0, -1000);
    expect(error).toMatch(/collapse/);
  });

  it('reorder preserves total duration and every clip source range', () => {
    const originalSources = videoClips(plan).map((c) => c.sourceRange);
    const { plan: next, error } = reorderClips(plan, 0, 2);
    expect(error).toBeUndefined();
    const clips = videoClips(next);
    expect(clips.at(-1).timelineRange.endFrameExclusive).toEqual(
      videoClips(plan).at(-1).timelineRange.endFrameExclusive,
    );
    expect(clips.map((c) => c.sourceRange)).toEqual(expect.arrayContaining(originalSources));
  });

  it('overlay text edits are bounded and reject empties', () => {
    const overlay = plan.tracks.find((t) => t.kind === 'overlay').clips[0];
    const { plan: next, patch } = setOverlayText(plan, overlay.id, 'New words');
    expect(patch.kind).toEqual('set-overlay-text');
    expect(next.tracks.find((t) => t.kind === 'overlay').clips[0].text).toEqual('New words');
    expect(setOverlayText(plan, overlay.id, '   ').error).toBeDefined();
    expect(setOverlayText(plan, 'overlay.nope', 'x').error).toBeDefined();
  });

  it('out-of-range indexes fail closed', () => {
    expect(swapClipSource(plan, 99).error).toBeDefined();
    expect(reorderClips(plan, 0, 99).error).toBeDefined();
    expect(nudgeBoundary(plan, 98, 1).error).toBeDefined();
  });
});
