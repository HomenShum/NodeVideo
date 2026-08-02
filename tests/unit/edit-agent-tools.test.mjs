import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ONE_EDIT_PER_PROPOSAL_ERROR as ONE_EDIT_PER_PROPOSAL_ERROR_IN_BROWSER,
  deleteClipRipple as deleteClipRippleInBrowser,
  duplicateClipRipple as duplicateClipRippleInBrowser,
  moveOverlay as moveOverlayInBrowser,
} from '../../apps/edit/src/plan-tools';
import {
  ONE_EDIT_PER_PROPOSAL_ERROR,
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
} from '../../scripts/workers/edit-agent.mjs';
import { validateEditPlan } from '../../src/lib/edit-contracts';

// The committed, hash-verified Sign plan — the same data the studio loads.
const plan = JSON.parse(
  readFileSync(
    new URL('../../fixtures/media/integrated-source-only-v1/edit-plan.json', import.meta.url),
    'utf8',
  ),
);

describe('edit agent plan operations (real Sign plan)', () => {
  it('keeps the one-edit proposal guard identical in browser and worker runtimes', () => {
    expect(ONE_EDIT_PER_PROPOSAL_ERROR).toBe(ONE_EDIT_PER_PROPOSAL_ERROR_IN_BROWSER);
    expect(ONE_EDIT_PER_PROPOSAL_ERROR).toContain('apply or dismiss');
  });

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

  it('an unattended agent proposes the same source-contiguous split a human will review', () => {
    const clip = videoClips(plan)[2];
    const atFrame = Math.round(
      (clip.timelineRange.startFrame + clip.timelineRange.endFrameExclusive) / 2,
    );
    const originalCount = videoClips(plan).length;
    const { plan: next, patch, error } = splitClip(plan, 2, atFrame);
    expect(error).toBeUndefined();
    expect(patch).toEqual({ kind: 'split-clip', clipIndex: 2, atFrame });
    const clips = videoClips(next);
    expect(clips).toHaveLength(originalCount + 1);
    expect(clips[2].timelineRange.endFrameExclusive).toBe(clips[3].timelineRange.startFrame);
    expect(clips[2].sourceRange.endFrameExclusive).toBe(clips[3].sourceRange.startFrame);
    expect(videoClips(plan)).toHaveLength(originalCount);
    expect(splitClip(plan, 99, atFrame).error).toMatch(/does not exist/);
    expect(splitClipOnNearestBeat(plan, 2).patch.atFrame).toEqual(expect.any(Number));
  });

  it('an unattended agent can propose contract-valid multi-track duplicate and delete edits', () => {
    const selected = videoClips(plan)[2];
    const duration = selected.timelineRange.endFrameExclusive - selected.timelineRange.startFrame;
    const duplicated = duplicateClipRipple(plan, 2);
    expect(duplicated.error).toBeUndefined();
    expect(duplicated.plan.durationFrames).toBe(plan.durationFrames + duration);
    expect(() => validateEditPlan(duplicated.plan)).not.toThrow();
    const deleted = deleteClipRipple(plan, 2);
    expect(deleted.error).toBeUndefined();
    expect(deleted.plan.durationFrames).toBe(plan.durationFrames - duration);
    expect(() => validateEditPlan(deleted.plan)).not.toThrow();
    expect(videoClips(plan)).toHaveLength(5);
  });

  it('the browser and worker produce the same accepted ripple plan', () => {
    expect(duplicateClipRipple(plan, 2)).toEqual(duplicateClipRippleInBrowser(plan, 2));
    expect(deleteClipRipple(plan, 2)).toEqual(deleteClipRippleInBrowser(plan, 2));
  });

  it('overlay text edits are bounded and reject empties', () => {
    const overlay = plan.tracks.find((t) => t.kind === 'overlay').clips[0];
    const { plan: next, patch } = setOverlayText(plan, overlay.id, 'New words');
    expect(patch.kind).toEqual('set-overlay-text');
    expect(next.tracks.find((t) => t.kind === 'overlay').clips[0].text).toEqual('New words');
    expect(setOverlayText(plan, overlay.id, '   ').error).toBeDefined();
    expect(setOverlayText(plan, 'overlay.nope', 'x').error).toBeDefined();
  });

  it('the worker and browser move the same caption by one whole beat', () => {
    const overlay = plan.tracks.find((track) => track.kind === 'overlay').clips[5];
    const browser = moveOverlayInBrowser(plan, overlay.id, -1);
    const worker = moveOverlay(plan, overlay.id, -1);
    expect(worker).toEqual(browser);
    expect(() => validateEditPlan(worker.plan)).not.toThrow();
    expect(
      moveOverlay(plan, plan.tracks.find((track) => track.kind === 'overlay').clips[0].id, -1)
        .error,
    ).toMatch(/leave the accepted timeline/);
  });

  it('out-of-range indexes fail closed', () => {
    expect(swapClipSource(plan, 99).error).toBeDefined();
    expect(reorderClips(plan, 0, 99).error).toBeDefined();
    expect(nudgeBoundary(plan, 98, 1).error).toBeDefined();
  });
});
