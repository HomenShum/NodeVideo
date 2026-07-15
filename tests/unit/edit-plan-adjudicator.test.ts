import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MINIMUM_PERMANENT_WINDOW_SCORE,
  RELEASE_READINESS_SCOPE,
  RENDER_METRICS_VERSION,
  adjudicateEditPlan,
} from '../../scripts/quality/edit-plan-adjudicator-lib.mjs';
import {
  EDIT_PLAN_SCHEMA_VERSION,
  type EditPlan,
  type OverlayTrack,
  type VideoTrack,
  validateCriticReport,
  validateEditPlan,
} from '../../src/lib/edit-contracts';

const groundTruth = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'packs/reference-reconstruct/evals/authorized-real-v2-ground-truth.json',
    ),
    'utf8',
  ),
) as any;

const fixedCreatedAt = '2026-07-15T20:00:00.000Z';
const clone = <T>(value: T): T => structuredClone(value);

function createCorrectPlan(): EditPlan {
  const videoClips = groundTruth.video.clips.map((clip: any) => {
    if (clip.kind === 'black') {
      return {
        id: clip.id,
        kind: 'black' as const,
        timelineRange: clone(clip.timelineRange),
      };
    }
    if (clip.kind === 'freeze') {
      return {
        id: clip.id,
        kind: 'freeze' as const,
        assetId: clip.assetId,
        sourceFrame: clip.sourceFrame,
        timelineRange: clone(clip.timelineRange),
        fit: clip.layout,
        cropKeyframes: [],
        grade: { kind: 'none' as const },
      };
    }
    return {
      id: clip.id,
      kind: 'source' as const,
      assetId: clip.assetId,
      timelineRange: clone(clip.timelineRange),
      sourceRange: clone(clip.sourceRange),
      playbackRate: clip.playbackRate,
      fit: clip.layout,
      cropKeyframes: [],
      grade: { kind: 'none' as const },
    };
  });
  const textClips = groundTruth.textCues.map((cue: any, index: number) => ({
    id: `text-${String(index + 1).padStart(2, '0')}`,
    timelineRange: {
      startFrame: cue.startFrame,
      endFrameExclusive: cue.endFrameExclusive,
    },
    kind: 'text' as const,
    text: cue.text,
    templateId: 'text.cue',
    box: { x: 0.05, y: 0.75, width: 0.9, height: 0.12 },
    animation: 'none' as const,
  }));

  return {
    schemaVersion: EDIT_PLAN_SCHEMA_VERSION,
    id: 'authorized-real-v2-plan',
    understandingId: 'authorized-real-v2-understanding',
    version: 1,
    createdAt: fixedCreatedAt,
    frameRate: 30,
    canvas: { width: 720, height: 1280 },
    durationFrames: 1335,
    lineage: {
      renderAssetIds: [
        'asset.source-a-original',
        'asset.source-b-original',
        'asset.music-target-derived',
        'asset.end-sting-target-derived',
      ],
      evaluationOnlyAssetIds: ['asset.target-final'],
      targetDerivedRenderAssetIds: ['asset.music-target-derived', 'asset.end-sting-target-derived'],
    },
    audio: {
      routing: [
        {
          id: 'route-source-a',
          sourceKind: 'asset-audio',
          sourceId: 'asset.source-a-original',
          bus: 'program',
          muted: true,
          gainDb: 0,
        },
        {
          id: 'route-source-b',
          sourceKind: 'asset-audio',
          sourceId: 'asset.source-b-original',
          bus: 'program',
          muted: true,
          gainDb: 0,
        },
        {
          id: 'route-music',
          sourceKind: 'track',
          sourceId: 'track.music',
          bus: 'music',
          muted: false,
          gainDb: 0,
        },
        {
          id: 'route-effects',
          sourceKind: 'track',
          sourceId: 'track.effects',
          bus: 'effects',
          muted: false,
          gainDb: 0,
        },
      ],
      events: [
        {
          id: 'event.music',
          kind: 'music',
          clipId: 'clip.music',
          sourceOffsetMs: 0,
          releasedMasterOffsetMs: 29_146,
          releasedMasterGainDb: -6.12,
          targetStartMs: 0,
          targetEndMs: 40_338.6,
          gainDb: 0,
          identity: {
            title: 'Sign',
            artist: '82MAJOR',
            isrc: 'KRA382601866',
          },
        },
        {
          id: 'event.silence-1',
          kind: 'silence',
          targetStartMs: 40_338.6,
          targetEndMs: 40_837.3,
        },
        {
          id: 'event.end-sting',
          kind: 'sting',
          clipId: 'clip.end-sting',
          sourceOffsetMs: 0,
          targetStartMs: 40_837.3,
          targetEndMs: 42_153.5,
          gainDb: -2,
          label: 'end sting',
        },
        {
          id: 'event.silence-2',
          kind: 'silence',
          targetStartMs: 42_153.5,
          targetEndMs: 44_500,
        },
      ],
    },
    beatGrid: {
      bpm: 120,
      offsetMs: 0,
      beatsMs: [0, 500, 1_000],
      downbeatsMs: [0],
      confidence: 1,
    },
    tracks: [
      {
        id: 'track.primary',
        kind: 'video',
        role: 'primary',
        clips: videoClips,
      },
      {
        id: 'track.music',
        kind: 'audio',
        role: 'music',
        clips: [
          {
            id: 'clip.music',
            assetId: 'asset.music-target-derived',
            timelineRange: { startFrame: 0, endFrameExclusive: 1210 },
            sourceRange: { startFrame: 0, endFrameExclusive: 1210 },
            playbackRate: 1,
            role: 'music',
            gainDb: 0,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            license: {
              status: 'target-derived-authorized',
              proofRef: 'owner-authorization:authorized-real-v2',
            },
          },
        ],
      },
      {
        id: 'track.effects',
        kind: 'audio',
        role: 'effects',
        clips: [
          {
            id: 'clip.end-sting',
            assetId: 'asset.end-sting-target-derived',
            timelineRange: { startFrame: 1225, endFrameExclusive: 1265 },
            sourceRange: { startFrame: 0, endFrameExclusive: 40 },
            playbackRate: 1,
            role: 'sting',
            gainDb: -2,
            fadeInFrames: 0,
            fadeOutFrames: 0,
          },
        ],
      },
      {
        id: 'track.overlays',
        kind: 'overlay',
        clips: textClips,
      },
    ],
  };
}

function passingRenderMetrics(score = 0.99) {
  return {
    schemaVersion: RENDER_METRICS_VERSION,
    artifactId: 'artifact.render.authorized-v2',
    global: { ssim: 0.999, psnrDb: 48, vmaf: 99 },
    windows: [
      {
        id: 'window.permanent-regression',
        timelineRange: { startFrame: 482, endFrameExclusive: 589 },
        score,
        metric: 'content-ssim',
      },
    ],
    audio: {
      referenceCorrelation: 0.99,
      reference: { lagMs: 0 },
      sourceLeakageCorrelation: 0.01,
    },
  };
}

function event(result: ReturnType<typeof adjudicateEditPlan>, id: string) {
  const found = result.eventScoreReport.events.find((candidate: any) => candidate.id === id);
  if (!found) throw new Error(`Missing event: ${id}`);
  return found;
}

describe('evaluator-only EditPlan adjudicator', () => {
  it('passes the corrected Source A mapping at frame 942 and emits canonical reports', () => {
    const plan = createCorrectPlan();
    validateEditPlan(plan);

    const result = adjudicateEditPlan(plan, undefined, { createdAt: fixedCreatedAt });

    expect(event(result, 'video-clip:a-fit-2')).toMatchObject({
      pass: true,
      permanent: true,
      observed: { sourceRange: { startFrame: 942, endFrameExclusive: 1049 } },
    });
    expect(event(result, 'audio-music-excerpt')).toMatchObject({
      pass: true,
      observed: { sourceOffsetMs: 0, releasedMasterOffsetMs: 29_146 },
    });
    expect(event(result, 'audio-music-gain')).toMatchObject({
      pass: true,
      expected: { renderGainDb: 0, releasedMasterGainDb: -6.12 },
    });
    expect(event(result, 'audio-target-derivation-authorization').pass).toBe(true);
    expect(event(result, 'social-overlay-timing:not-represented')).toMatchObject({
      category: 'framing',
      pass: true,
    });
    expect(result.eventScoreReport.passed).toBe(true);
    expect(result.eventScoreReport).toMatchObject({
      scope: 'plan-only',
      releaseReady: false,
      releaseReadyScope: RELEASE_READINESS_SCOPE,
    });
    expect(result.criticReport.verdict).toBe('pass');
    expect(result.criticReport).toMatchObject({
      schemaVersion: 'nodevideo.critic-report.v2',
      scores: { taste: null },
      tasteStatus: 'not-evaluated',
    });
    expect(() => validateCriticReport(result.criticReport, plan)).not.toThrow();
  });

  it('becomes release-ready only when passing render and audio metrics are supplied', () => {
    const plan = createCorrectPlan();
    validateEditPlan(plan);

    const result = adjudicateEditPlan(plan, passingRenderMetrics(), {
      createdAt: fixedCreatedAt,
    });

    expect(result.eventScoreReport).toMatchObject({
      scope: 'plan-and-render',
      passed: true,
      releaseReady: true,
      releaseReadyScope: RELEASE_READINESS_SCOPE,
    });
    expect(result.criticReport.verdict).toBe('pass');
  });

  it('rejects master provenance accidentally reused as local trim and render gain', () => {
    const plan = createCorrectPlan();
    const musicEvent = plan.audio.events.find((candidate) => candidate.kind === 'music');
    const musicTrack = plan.tracks.find(
      (track) => track.kind === 'audio' && track.role === 'music',
    );
    if (!musicEvent || musicEvent.kind !== 'music' || !musicTrack || musicTrack.kind !== 'audio') {
      throw new Error('missing music fixture');
    }
    musicEvent.sourceOffsetMs = musicEvent.releasedMasterOffsetMs;
    musicEvent.gainDb = musicEvent.releasedMasterGainDb;
    musicTrack.clips[0].gainDb = musicEvent.releasedMasterGainDb;

    const result = adjudicateEditPlan(plan, undefined, { createdAt: fixedCreatedAt });

    expect(event(result, 'audio-music-excerpt').pass).toBe(false);
    expect(event(result, 'audio-music-gain').pass).toBe(false);
    expect(result.eventScoreReport.passed).toBe(false);
  });

  it('permanently fails the old frame-866 mapping despite a near-perfect global average', () => {
    const plan = createCorrectPlan();
    const primary = plan.tracks[0] as VideoTrack;
    const regression = primary.clips.find(
      (clip) => clip.timelineRange.startFrame === 482 && clip.kind === 'source',
    );
    if (!regression || regression.kind !== 'source') throw new Error('missing regression clip');
    regression.sourceRange = { startFrame: 866, endFrameExclusive: 973 };
    validateEditPlan(plan);

    const result = adjudicateEditPlan(plan, passingRenderMetrics(), {
      createdAt: fixedCreatedAt,
    });

    expect(event(result, 'video-clip:a-fit-2')).toMatchObject({ pass: false, permanent: true });
    expect(result.eventScoreReport.summary.permanentFailure).toBe(true);
    expect(result.eventScoreReport.passed).toBe(false);
    expect(result.criticReport.verdict).toBe('fail');
    expect(() => validateCriticReport(result.criticReport, plan)).not.toThrow();
  });

  it('does not let soundtrack omission pass a picture-perfect plan', () => {
    const plan = createCorrectPlan();
    plan.tracks = plan.tracks.filter((track) => track.kind !== 'audio');
    plan.audio.routing = plan.audio.routing.filter((route) => route.sourceKind === 'asset-audio');
    plan.audio.events = [
      {
        id: 'event.silence-all',
        kind: 'silence',
        targetStartMs: 0,
        targetEndMs: 44_500,
      },
    ];
    validateEditPlan(plan);

    const result = adjudicateEditPlan(plan, undefined, { createdAt: fixedCreatedAt });

    expect(event(result, 'audio-music-identity').pass).toBe(false);
    expect(event(result, 'audio-music-excerpt').pass).toBe(false);
    expect(event(result, 'audio-end-sting').pass).toBe(false);
    expect(result.eventScoreReport.passed).toBe(false);
    expect(result.criticReport.verdict).toBe('fail');
    expect(() => validateCriticReport(result.criticReport, plan)).not.toThrow();
  });

  it('gates every text cue at the two-frame tolerance', () => {
    const plan = createCorrectPlan();
    const overlays = plan.tracks.find((track) => track.kind === 'overlay') as OverlayTrack;
    overlays.clips[14].timelineRange.startFrame += 3;
    overlays.clips[14].timelineRange.endFrameExclusive += 3;
    validateEditPlan(plan);

    const result = adjudicateEditPlan(plan, undefined, { createdAt: fixedCreatedAt });

    expect(event(result, 'text-cue:15').pass).toBe(false);
    expect(result.eventScoreReport.releaseBlockers).toContain('text-cue:15');
  });

  it('enforces the full social phase sequence when social overlays are represented', () => {
    const plan = createCorrectPlan();
    plan.lineage.renderAssetIds.push('asset.social');
    const overlays = plan.tracks.find((track) => track.kind === 'overlay') as OverlayTrack;
    overlays.clips.push({
      id: 'social-top-right-only',
      kind: 'graphic',
      assetId: 'asset.social',
      timelineRange: { startFrame: 6, endFrameExclusive: 267 },
      templateId: 'social.top-right',
      box: { x: 0.8, y: 0.05, width: 0.15, height: 0.15 },
      animation: 'none',
    });
    validateEditPlan(plan);

    const result = adjudicateEditPlan(plan, undefined, { createdAt: fixedCreatedAt });

    expect(event(result, 'social-overlay-timing:visible-phases')).toMatchObject({
      category: 'framing',
      pass: false,
    });
    expect(result.eventScoreReport.releaseBlockers).toContain(
      'social-overlay-timing:visible-phases',
    );
  });

  it('does not accept legacy master-named audio metric aliases as target-reference evidence', () => {
    const plan = createCorrectPlan();
    const metrics: any = passingRenderMetrics();
    metrics.audio.referenceCorrelation = undefined;
    metrics.audio.reference = undefined;
    metrics.audio.masterCorrelation = 0.99;
    metrics.audio.master = { lagMs: 0 };

    const result = adjudicateEditPlan(plan, metrics, { createdAt: fixedCreatedAt });

    expect(event(result, 'render-audio:reference-correlation').pass).toBe(false);
    expect(event(result, 'rhythm:cut-to-soundtrack-alignment').pass).toBe(false);
    expect(result.eventScoreReport.releaseReady).toBe(false);
  });

  it('fails a low permanent-window score even when the global metric is excellent', () => {
    const plan = createCorrectPlan();
    validateEditPlan(plan);
    const metrics = passingRenderMetrics(MINIMUM_PERMANENT_WINDOW_SCORE - 0.01);

    const result = adjudicateEditPlan(plan, metrics, { createdAt: fixedCreatedAt });

    expect(event(result, 'render-window:permanent-regression')).toMatchObject({
      pass: false,
      permanent: true,
    });
    expect(result.eventScoreReport.summary.permanentFailure).toBe(true);
    expect(result.criticReport.verdict).toBe('fail');
    expect(() => validateCriticReport(result.criticReport, plan)).not.toThrow();
  });
});
