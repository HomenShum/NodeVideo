import { describe, expect, it } from 'vitest';

import type { EditPlan } from './edit-contracts.ts';
import {
  type ActiveEditorialProfile,
  assertActiveEditorialProfileDigest,
  assertActiveEditorialProfilesMatch,
  assertPlanUsesActiveEditorialProfile,
  bindActiveEditorialProfile,
  digestActiveEditorialProfile,
  planningBodyOverlapRatio,
  validateGovernedTimedCues,
} from './editorial-governance-contracts.ts';

describe('active editorial governance under realistic creator workloads', () => {
  it('binds the owner-approved profile to a short social edit and preserves it for rendering', async () => {
    const activeProfile = await profile();
    const plan = await bindActiveEditorialProfile(basePlan(), activeProfile);

    assertPlanUsesActiveEditorialProfile(plan, activeProfile);
    expect(plan.lineage.activeEditorialProfile).toEqual({
      profileId: activeProfile.id,
      profileDigest: activeProfile.profileDigest,
      activationApprovalId: activeProfile.activationApprovalId,
    });
    expect(plan.lineage.decisionArtifactIds).toContain(activeProfile.id);
  });

  it('fails closed when a stale agent replays a previously approved profile digest', async () => {
    const staleProfile = await profile();
    staleProfile.overlayPolicy.minimumFontSizePx = 44;

    await expect(assertActiveEditorialProfileDigest(staleProfile)).rejects.toThrow(
      /digest mismatch/u,
    );
  });

  it('isolates concurrent creator jobs so one approval cannot govern another edit', async () => {
    const [first, second] = await Promise.all([
      profile('editorial.creator-a', 'approval.creator-a'),
      profile('editorial.creator-b', 'approval.creator-b'),
    ]);
    const [firstPlan, secondPlan] = await Promise.all([
      bindActiveEditorialProfile(basePlan('plan.creator-a'), first),
      bindActiveEditorialProfile(basePlan('plan.creator-b'), second),
    ]);

    expect(() => assertPlanUsesActiveEditorialProfile(firstPlan, second)).toThrow(/ID mismatch/u);
    expect(() => assertPlanUsesActiveEditorialProfile(secondPlan, first)).toThrow(/ID mismatch/u);
    expect(() => assertActiveEditorialProfilesMatch(first, second)).toThrow(/ID mismatch/u);
  });

  it('holds policy bounds across a sustained 512-cue batch and rejects the 513th cue', async () => {
    const activeProfile = await profile();
    const cues = Array.from({ length: 512 }, (_, index) => ({
      id: `cue.${index}`,
      text: `Proof ${index}`,
      startSeconds: index * 0.25,
      endSeconds: index * 0.25 + 0.2,
      role: index % 2 === 0 ? ('attention' as const) : ('identity' as const),
      animation: index % 2 === 0 ? ('pop' as const) : ('fade' as const),
    }));

    expect(() => validateGovernedTimedCues(activeProfile, cues, 0.04)).not.toThrow();
    expect(() =>
      validateGovernedTimedCues(
        activeProfile,
        [
          ...cues,
          {
            id: 'cue.overflow',
            text: 'Overflow',
            startSeconds: 128,
            endSeconds: 128.2,
            role: 'attention',
            animation: 'pop',
          },
        ],
        0.04,
      ),
    ).toThrow(/1 to 512 cues/u);
  });

  it('rejects degraded requests that weaken body safety or use an unapproved animation', async () => {
    const activeProfile = await profile();
    activeProfile.overlayPolicy.allowedAnimations = ['none', 'fade'];
    activeProfile.profileDigest = await digestActiveEditorialProfile(activeProfile);
    const cue = {
      id: 'cue.degraded',
      text: 'Unreviewed motion',
      startSeconds: 0,
      endSeconds: 1,
      role: 'attention' as const,
      animation: 'pop' as const,
    };

    expect(() => validateGovernedTimedCues(activeProfile, [cue], 0.04)).toThrow(
      /animation is not allowed/u,
    );
    expect(() =>
      validateGovernedTimedCues(activeProfile, [{ ...cue, animation: 'fade' }], 0.051),
    ).toThrow(/exceeds the active editorial profile/u);
  });

  it('reserves rendered-glyph clearance instead of planning at the final safety ceiling', () => {
    expect(planningBodyOverlapRatio(0.05, 0.05)).toBeCloseTo(0.045, 10);
    expect(planningBodyOverlapRatio(0.03, 0.05)).toBeCloseTo(0.03, 10);
  });
});

async function profile(
  id = 'editorial.homen-social-v1',
  activationApprovalId = 'approval.homen-social-v1',
): Promise<ActiveEditorialProfile> {
  const value: ActiveEditorialProfile = {
    schemaVersion: 'nodevideo.active-editorial-profile.v1',
    id,
    version: 1,
    activatedAt: '2026-08-01T23:30:00.000Z',
    activationApprovalId,
    overlayPolicy: {
      allowedRoles: ['attention', 'identity'],
      allowedAnimations: ['none', 'fade', 'pop', 'slide-up'],
      allowedTemplateIds: [
        'text.creator-commentary',
        'text.creator-title',
        'text.creator-watermark',
        'text.creator-cta',
        'text.creator-end-card',
      ],
      maxBodyOverlapRatio: 0.05,
      minimumFontSizePx: 32,
      requireCausalProof: true,
    },
    profileDigest: `sha256:${'0'.repeat(64)}`,
  };
  value.profileDigest = await digestActiveEditorialProfile(value);
  return value;
}

function basePlan(id = 'plan.social-proof'): EditPlan {
  return {
    schemaVersion: 'nodevideo.edit-plan.v1',
    id,
    understandingId: 'understanding.social-proof',
    version: 1,
    createdAt: '2026-08-01T23:30:00.000Z',
    frameRate: 30,
    canvas: { width: 720, height: 1280 },
    durationFrames: 90,
    lineage: {
      renderAssetIds: ['asset.video'],
      evaluationOnlyAssetIds: [],
      targetDerivedRenderAssetIds: [],
    },
    audio: {
      routing: [
        {
          id: 'route.source',
          sourceKind: 'asset-audio',
          sourceId: 'asset.video',
          bus: 'program',
          muted: true,
          gainDb: 0,
        },
      ],
      events: [],
    },
    tracks: [
      {
        id: 'track.video',
        kind: 'video',
        role: 'primary',
        clips: [
          {
            id: 'clip.video',
            kind: 'source',
            assetId: 'asset.video',
            timelineRange: { startFrame: 0, endFrameExclusive: 90 },
            sourceRange: { startFrame: 0, endFrameExclusive: 90 },
            playbackRate: 1,
            fit: 'fit',
            cropKeyframes: [],
            grade: { kind: 'none' },
          },
        ],
      },
      { id: 'track.overlays', kind: 'overlay', clips: [] },
    ],
  };
}
