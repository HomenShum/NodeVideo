import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_SOURCE_CLIPS,
  type Plan,
  deleteClipRipple,
  duplicateClipRipple,
  moveOverlay,
  nudgeBoundary,
  planSummary,
  reorderClips,
  setOverlayText,
  splitClip,
  splitClipOnNearestBeat,
  swapClipSource,
  videoClips,
} from '../../apps/edit/src/plan-tools';
import { validateEditPlan } from '../../src/lib/edit-contracts';

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
    expect(summary.overlays[0].endSeconds).toBeGreaterThan(summary.overlays[0].startSeconds);
    expect(summary.overlays[0].templateId).toBe('text.cue');
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

  it('a creator can split a long dance phrase without changing its frames or the accepted plan', () => {
    const clip = videoClips(plan)[2];
    const atFrame = Math.round(
      (clip.timelineRange.startFrame + clip.timelineRange.endFrameExclusive) / 2,
    );
    const originalCount = videoClips(plan).length;
    const { plan: next, patch, error } = splitClip(plan, 2, atFrame);
    expect(error).toBeUndefined();
    expect(patch).toEqual({ kind: 'split-clip', clipIndex: 2, atFrame });
    const split = videoClips(next as Plan);
    expect(split).toHaveLength(originalCount + 1);
    expect(split[2].timelineRange.endFrameExclusive).toBe(atFrame);
    expect(split[3].timelineRange.startFrame).toBe(atFrame);
    expect(split[2].sourceRange.endFrameExclusive).toBe(split[3].sourceRange.startFrame);
    expect(videoClips(plan)).toHaveLength(originalCount);
    expect(splitClip(plan, 2, clip.timelineRange.startFrame).error).toMatch(/one beat/);
    expect(splitClipOnNearestBeat(plan, 2).patch?.atFrame).toEqual(expect.any(Number));
  });

  it('a creator can duplicate and delete a phrase while every timed track remains contract-valid', () => {
    const selected = videoClips(plan)[2];
    const duration = selected.timelineRange.endFrameExclusive - selected.timelineRange.startFrame;
    const duplicated = duplicateClipRipple(plan, 2);
    expect(duplicated.error).toBeUndefined();
    expect(duplicated.patch).toEqual({ kind: 'duplicate-clip', clipIndex: 2 });
    expect(duplicated.plan?.durationFrames).toBe(plan.durationFrames + duration);
    expect(videoClips(duplicated.plan as Plan)).toHaveLength(videoClips(plan).length + 1);
    expect(() => validateEditPlan(duplicated.plan)).not.toThrow();

    const deleted = deleteClipRipple(plan, 2);
    expect(deleted.error).toBeUndefined();
    expect(deleted.patch).toEqual({ kind: 'delete-clip', clipIndex: 2 });
    expect(deleted.plan?.durationFrames).toBe(plan.durationFrames - duration);
    expect(videoClips(deleted.plan as Plan)).toHaveLength(videoClips(plan).length - 1);
    expect(() => validateEditPlan(deleted.plan)).not.toThrow();
    expect(videoClips(plan)).toHaveLength(5);
  });

  it('ripples a secondary video layer through the same selected phrase interval', () => {
    const withBroll = structuredClone(plan);
    const selected = videoClips(withBroll)[2];
    const brollClip = structuredClone(selected);
    brollClip.id = 'clip.broll.proof';
    withBroll.tracks.push({
      id: 'track.video.broll',
      kind: 'video',
      role: 'b-roll',
      clips: [brollClip],
    } as (typeof withBroll.tracks)[number]);

    const duplicated = duplicateClipRipple(withBroll, 2).plan as Plan;
    const duplicateBroll = duplicated.tracks.find((track) => track.id === 'track.video.broll');
    expect(duplicateBroll?.clips).toHaveLength(2);
    expect(duplicateBroll?.clips[1].timelineRange.startFrame).toBe(
      selected.timelineRange.endFrameExclusive,
    );
    expect(() => validateEditPlan(duplicated)).not.toThrow();

    const deleted = deleteClipRipple(withBroll, 2).plan as Plan;
    expect(deleted.tracks.find((track) => track.id === 'track.video.broll')?.clips).toEqual([]);
    expect(() => validateEditPlan(deleted)).not.toThrow();
  });

  it('an adversarial delete loop stops before removing the final source block', () => {
    let working = plan;
    while (videoClips(working).length > 1) {
      const result = deleteClipRipple(working, 0);
      expect(result.error).toBeUndefined();
      working = result.plan as Plan;
      expect(() => validateEditPlan(working)).not.toThrow();
    }
    expect(deleteClipRipple(working, 0).error).toMatch(/last source clip/);
  });

  it('a sustained duplicate loop is bounded before an agent can grow the plan indefinitely', () => {
    let working = plan;
    while (videoClips(working).length < MAX_SOURCE_CLIPS) {
      const result = duplicateClipRipple(working, 0);
      expect(result.error).toBeUndefined();
      working = result.plan as Plan;
    }
    expect(videoClips(working)).toHaveLength(MAX_SOURCE_CLIPS);
    expect(() => validateEditPlan(working)).not.toThrow();
    expect(duplicateClipRipple(working, 0).error).toMatch(/cannot exceed/);
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

  it('a caption editor moves one real overlay by a whole beat and fails closed at the timeline edge', () => {
    const overlays = plan.tracks.find((track) => track.kind === 'overlay')?.clips ?? [];
    const target = overlays[5];
    const duration = target.timelineRange.endFrameExclusive - target.timelineRange.startFrame;
    const result = moveOverlay(plan, target.id, -1);
    expect(result.error).toBeUndefined();
    expect(result.patch).toEqual({ kind: 'move-overlay', overlayId: target.id, beats: -1 });
    const moved = (result.plan as Plan).tracks
      .find((track) => track.kind === 'overlay')
      ?.clips.find((clip) => clip.id === target.id);
    if (!moved) throw new Error('moved overlay missing from accepted plan');
    expect(moved.timelineRange.endFrameExclusive - moved.timelineRange.startFrame).toBe(duration);
    expect(moved?.timelineRange.startFrame).toBeLessThan(target.timelineRange.startFrame);
    expect(() => validateEditPlan(result.plan)).not.toThrow();
    expect(moveOverlay(plan, overlays[0].id, -1).error).toMatch(/leave the accepted timeline/);
    expect(moveOverlay(plan, target.id, 0).error).toMatch(/non-zero whole beat/);
    expect(moveOverlay(plan, 'overlay.missing', 1).error).toMatch(/does not exist/);
  });
});
