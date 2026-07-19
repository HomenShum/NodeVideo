import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Plan,
  nudgeBoundary,
  planSummary,
  reorderClips,
  setOverlayText,
  swapClipSource,
  videoClips,
} from '../../apps/edit/src/plan-tools';

// The same committed Sign plan the studio and browser agent load.
const plan = JSON.parse(
  readFileSync(
    new URL('../../fixtures/media/integrated-source-only-v1/edit-plan.json', import.meta.url),
    'utf8',
  ),
) as Plan;

describe('browser plan tools (shared with the in-browser model agent)', () => {
  it('summary is model-groundable', () => {
    const summary = planSummary(plan);
    expect(summary.bpm).toBeCloseTo(107.7, 1);
    expect(summary.clips.length).toBeGreaterThanOrEqual(5);
    expect(summary.overlays.length).toBeGreaterThanOrEqual(10);
  });

  it('swap re-aligns source, preserves timeline, never mutates input', () => {
    const before = videoClips(plan)[1].assetId;
    const { plan: next, error } = swapClipSource(plan, 1);
    expect(error).toBeUndefined();
    expect(videoClips(next as Plan)[1].assetId).not.toEqual(before);
    expect(videoClips(next as Plan)[1].timelineRange).toEqual(videoClips(plan)[1].timelineRange);
    expect(videoClips(plan)[1].assetId).toEqual(before); // input untouched
  });

  it('nudge stays contiguous and refuses collapses', () => {
    const { plan: next } = nudgeBoundary(plan, 0, -1);
    const clips = videoClips(next as Plan);
    expect(clips[0].timelineRange.endFrameExclusive).toEqual(clips[1].timelineRange.startFrame);
    expect(nudgeBoundary(plan, 0, -1000).error).toMatch(/collapse/);
  });

  it('reorder preserves total duration', () => {
    const { plan: next } = reorderClips(plan, 0, 2);
    expect(videoClips(next as Plan).at(-1)?.timelineRange.endFrameExclusive).toEqual(
      videoClips(plan).at(-1)?.timelineRange.endFrameExclusive,
    );
  });

  it('overlay text is bounded and validated; bad indexes fail closed', () => {
    const overlay = plan.tracks.find((t) => t.kind === 'overlay')?.clips[0];
    expect(setOverlayText(plan, overlay?.id ?? '', 'New words').patch?.kind).toEqual(
      'set-overlay-text',
    );
    expect(setOverlayText(plan, overlay?.id ?? '', '  ').error).toBeDefined();
    expect(swapClipSource(plan, 99).error).toBeDefined();
    expect(reorderClips(plan, 0, 99).error).toBeDefined();
  });
});
