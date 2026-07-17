import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EDIT_PLAN_RENDERER_VERSION,
  FIXED_GRADE_PRESETS,
  FIXED_TEXT_TEMPLATES,
  RENDERER_FONT,
  compileEditPlan,
  estimatedTextEmWidth,
  validateEditPlan,
} from '../../scripts/workers/edit-plan-renderer-lib.mjs';

const paths = {
  'asset.source-1': resolve('fixtures/test-assets/source-1.mp4'),
  'asset.music-1': resolve('fixtures/test-assets/music-1.wav'),
  'asset.sting-1': resolve('fixtures/test-assets/sting-1.wav'),
  'asset.watermark-1': resolve('fixtures/test-assets/watermark-1.png'),
  'asset.grade-1': resolve('fixtures/test-assets/grade-1.cube'),
};

function range(startFrame, endFrameExclusive) {
  return { startFrame, endFrameExclusive };
}

function basePlan() {
  return {
    schemaVersion: 'nodevideo.edit-plan.v1',
    id: 'plan.renderer-unit',
    understandingId: 'understanding.renderer-unit',
    version: 1,
    createdAt: '2026-07-15T00:00:00.000Z',
    frameRate: 30,
    canvas: { width: 720, height: 1280 },
    durationFrames: 90,
    lineage: {
      renderAssetIds: ['asset.source-1', 'asset.music-1', 'asset.sting-1', 'asset.watermark-1'],
      evaluationOnlyAssetIds: ['asset.reference-target'],
      targetDerivedRenderAssetIds: ['asset.music-1'],
    },
    beatGrid: {
      bpm: 120,
      offsetMs: 0,
      beatsMs: [0, 500, 1000, 1500, 2000, 2500],
      downbeatsMs: [0, 2000],
      confidence: 0.95,
    },
    audio: {
      routing: [
        {
          id: 'route.source-muted',
          sourceKind: 'asset-audio',
          sourceId: 'asset.source-1',
          bus: 'program',
          muted: true,
          gainDb: 0,
        },
        {
          id: 'route.music',
          sourceKind: 'track',
          sourceId: 'track.music',
          bus: 'music',
          muted: false,
          gainDb: 0,
        },
        {
          id: 'route.effects',
          sourceKind: 'track',
          sourceId: 'track.effects',
          bus: 'effects',
          muted: false,
          gainDb: 1,
        },
      ],
      events: [
        {
          id: 'event.music',
          kind: 'music',
          clipId: 'audio.music',
          sourceOffsetMs: 0,
          releasedMasterOffsetMs: 29_146,
          releasedMasterGainDb: -6.12,
          targetStartMs: 0,
          targetEndMs: 2000,
          gainDb: 0,
          identity: { title: 'Licensed track', artist: 'Example artist' },
        },
        {
          id: 'event.silence-before-sting',
          kind: 'silence',
          targetStartMs: 2000,
          targetEndMs: 2166.666667,
        },
        {
          id: 'event.sting',
          kind: 'sting',
          clipId: 'audio.sting',
          sourceOffsetMs: 0,
          targetStartMs: 2166.666667,
          targetEndMs: 2666.666667,
          gainDb: -3,
          label: 'end sting',
        },
        {
          id: 'event.trailing-silence',
          kind: 'silence',
          targetStartMs: 2666.666667,
          targetEndMs: 2833.333333,
        },
      ],
    },
    tracks: [
      {
        id: 'track.primary',
        kind: 'video',
        role: 'primary',
        clips: [
          {
            kind: 'source',
            id: 'video.source',
            assetId: 'asset.source-1',
            timelineRange: range(0, 30),
            sourceRange: range(100, 130),
            playbackRate: 1,
            fit: 'fit',
            cropKeyframes: [],
            grade: { kind: 'none' },
          },
          {
            kind: 'freeze',
            id: 'video.freeze',
            assetId: 'asset.source-1',
            timelineRange: range(30, 60),
            sourceFrame: 129,
            fit: 'fill',
            cropKeyframes: [],
            grade: { kind: 'none' },
          },
          {
            kind: 'black',
            id: 'video.black',
            timelineRange: range(60, 90),
          },
        ],
      },
      {
        id: 'track.music',
        kind: 'audio',
        role: 'music',
        clips: [
          {
            id: 'audio.music',
            assetId: 'asset.music-1',
            timelineRange: range(0, 60),
            sourceRange: range(0, 60),
            playbackRate: 1,
            role: 'music',
            gainDb: 0,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            license: {
              status: 'target-derived-authorized',
              proofRef: 'authorization.owner-demo',
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
            id: 'audio.sting',
            assetId: 'asset.sting-1',
            timelineRange: range(65, 80),
            sourceRange: range(0, 15),
            playbackRate: 1,
            role: 'sting',
            gainDb: -3,
            fadeInFrames: 1,
            fadeOutFrames: 2,
          },
        ],
      },
      {
        id: 'track.overlays',
        kind: 'overlay',
        clips: [
          {
            id: 'overlay.cue',
            kind: 'text',
            timelineRange: range(5, 20),
            text: "Cue %{metadata}; movie='untrusted'",
            templateId: 'text.cue',
            box: { x: 0.2, y: 0.35, width: 0.6, height: 0.1 },
            animation: 'fade',
          },
          {
            id: 'overlay.watermark',
            kind: 'graphic',
            assetId: 'asset.watermark-1',
            timelineRange: range(0, 90),
            templateId: 'graphic.watermark',
            box: { x: 0.7, y: 0.03, width: 0.25, height: 0.08 },
            animation: 'slide-up',
          },
          {
            id: 'overlay.end-card-text',
            kind: 'text',
            timelineRange: range(60, 90),
            text: 'Thanks for watching',
            templateId: 'text.end-card',
            box: { x: 0.15, y: 0.45, width: 0.7, height: 0.1 },
            animation: 'fade',
          },
        ],
      },
    ],
  };
}

describe('plan-driven deterministic renderer', () => {
  it('compiles canonical video, overlay, routing, silence, music, and sting primitives', () => {
    const plan = basePlan();
    const compiled = compileEditPlan(plan, paths, {
      outputPath: resolve('tmp/rendered-plan.mp4'),
      auxiliaryDirectory: resolve('tmp/rendered-plan-assets'),
    });

    expect(compiled.rendererVersion).toBe(EDIT_PLAN_RENDERER_VERSION);
    expect(compiled.manifest).toMatchObject({
      hasAudio: true,
      videoClipCount: 3,
      overlayClipCount: 3,
      audioClipCount: 2,
      renderedAudioClipCount: 2,
      silenceEventCount: 2,
      targetDerivedRenderAssetIds: ['asset.music-1'],
      overlayTemplates: ['graphic.watermark', 'text.cue', 'text.end-card'],
      gradeKinds: ['none'],
      framePolicy: {
        freezeHolds: 'exact-frame-count',
        oneFrameBlackGaps: 'rejected',
      },
    });
    expect(compiled.manifest.rendererAssets).toEqual([
      {
        id: RENDERER_FONT.id,
        license: 'OFL-1.1',
        source: '@fontsource-variable/geist@5.2.9',
        sha256: RENDERER_FONT.sha256,
      },
    ]);
    expect(createHash('sha256').update(readFileSync(RENDERER_FONT.path)).digest('hex')).toBe(
      RENDERER_FONT.sha256,
    );

    expect(compiled.filterComplex).toContain('trim=start=3.333333333:end=4.333333333');
    expect(compiled.filterComplex).toContain('tpad=stop_mode=clone');
    expect(compiled.filterComplex).toContain('color=c=black:s=720x1280:r=30');
    expect(compiled.filterComplex).toContain('drawtext=textfile=');
    expect(compiled.filterComplex).toContain('fontfile=');
    expect(compiled.filterComplex).toContain("enable='between(n,5,19)'");
    expect(compiled.filterComplex).toContain('overlay=x=');
    expect(compiled.filterComplex).toContain("enable='between(t,");
    expect(compiled.filterComplex).toContain('tpad=stop_mode=clone:stop=29');
    expect(compiled.filterComplex).toContain('tpad=stop_mode=clone:stop=89');
    expect(compiled.filterComplex).toContain('fontcolor=0x383838');
    expect(compiled.filterComplex).toContain('atrim=start=0:end=2');
    expect(compiled.filterComplex).not.toContain('atrim=start=29.146');
    expect(compiled.filterComplex).toContain('volume=0dB');
    expect(compiled.filterComplex).not.toContain('volume=-6.12dB');
    expect(compiled.filterComplex).toContain('volume=-2dB');
    expect(compiled.filterComplex).toContain('anullsrc=r=48000:cl=stereo');
    expect(compiled.filterComplex).toContain(
      'alimiter=limit=0.794328:attack=5:release=50:level=0:latency=1',
    );
    expect(compiled.filterComplex).toContain('volume=volume=0');

    expect(compiled.filterComplex).not.toContain('untrusted');
    expect(compiled.filterComplex).not.toContain('%{metadata}');
    expect(compiled.auxiliaryFiles).toHaveLength(2);
    expect(compiled.auxiliaryFiles[0].content).toBe(plan.tracks[3].clips[0].text);
    expect(compiled.args.filter((value) => value === paths['asset.source-1'])).toHaveLength(2);
    expect(
      compiled.inputRecords.some((record) => record.purpose.startsWith('audio:source-video')),
    ).toBe(false);
  });

  it('accepts the legacy missing source kind only by normalizing it to the canonical union', () => {
    const plan = basePlan();
    plan.tracks[0].clips[0].kind = undefined;
    const validated = validateEditPlan(plan, paths);

    expect(validated.plan.tracks[0].clips[0].kind).toBe('source');
  });

  it('routes mapped camera audio only when its explicit asset route is unmuted', () => {
    const plan = basePlan();
    plan.audio.routing[0].muted = false;
    plan.audio.routing[0].gainDb = -12;
    plan.audio.routing[1].muted = true;
    plan.audio.routing[2].muted = true;

    const compiled = compileEditPlan(plan, paths);
    expect(
      compiled.inputRecords.some((record) => record.purpose === 'audio:source-video:video.source'),
    ).toBe(true);
    expect(compiled.filterComplex).toContain('atrim=start=3.333333333:end=4.333333333');
    expect(compiled.filterComplex).toContain('volume=-12dB');
    expect(
      compiled.inputRecords.some((record) => record.purpose === 'audio:music:audio.music'),
    ).toBe(false);
    expect(
      compiled.inputRecords.some((record) => record.purpose === 'audio:sting:audio.sting'),
    ).toBe(false);
  });

  it('applies local gain and asset-local offset when the bound asset is a licensed master', () => {
    const plan = basePlan();
    plan.lineage.targetDerivedRenderAssetIds = [];
    plan.audio.routing[1].gainDb = -2;
    plan.audio.events[0].sourceOffsetMs = 29_146;
    plan.audio.events[0].gainDb = -6.12;
    plan.tracks[1].clips[0].sourceRange = range(874, 934);
    plan.tracks[1].clips[0].gainDb = -6.12;
    plan.tracks[1].clips[0].license = {
      status: 'licensed',
      proofRef: 'catalog-license.example',
    };

    const compiled = compileEditPlan(plan, paths);
    expect(compiled.filterComplex).toContain('atrim=start=29.146:end=31.146');
    expect(compiled.filterComplex).toContain('volume=-8.12dB');
  });

  it('uses the fixed HLG BT.2020 to SDR BT.709 color-management chain before layout', () => {
    const plan = basePlan();
    plan.tracks[0].clips[0].grade = { kind: 'hlg-bt2020-to-sdr-bt709-hable' };

    const compiled = compileEditPlan(plan, paths);
    const colorStart = compiled.filterComplex.indexOf('zscale=transfer=linear:npl=100');
    const toneMap = compiled.filterComplex.indexOf('tonemap=tonemap=hable:desat=0');
    const layout = compiled.filterComplex.indexOf(
      'scale=w=720:h=1280:force_original_aspect_ratio=decrease',
    );
    expect(colorStart).toBeGreaterThan(-1);
    expect(toneMap).toBeGreaterThan(colorStart);
    expect(layout).toBeGreaterThan(toneMap);
    expect(compiled.filterComplex).toContain(
      'zscale=primaries=bt709:transfer=bt709:matrix=bt709:range=limited',
    );
  });

  it('can compose the fixed HLG transform with a bound target-guided cube artifact', () => {
    const plan = basePlan();
    plan.lineage.renderAssetIds.push('asset.grade-1');
    plan.tracks[0].clips[0].grade = {
      kind: 'hlg-bt2020-to-sdr-bt709-hable-cube-lut',
      artifactId: 'asset.grade-1',
    };

    const compiled = compileEditPlan(plan, paths);
    const toneMap = compiled.filterComplex.indexOf('tonemap=tonemap=hable:desat=0');
    const cube = compiled.filterComplex.indexOf('lut3d=file=');
    expect(toneMap).toBeGreaterThan(-1);
    expect(cube).toBeGreaterThan(toneMap);
    expect(compiled.manifest.usedAssetIds).toContain('asset.grade-1');

    const missingGradeBinding = Object.fromEntries(
      Object.entries(paths).filter(([assetId]) => assetId !== 'asset.grade-1'),
    );
    expect(() => compileEditPlan(plan, missingGradeBinding)).toThrow(
      /missing path binding for asset.grade-1/u,
    );
  });

  it('offers fixed creator grade presets without an external LUT artifact', () => {
    const plan = basePlan();
    plan.tracks[0].clips[0].grade = {
      kind: 'hlg-bt2020-to-sdr-bt709-creator-dark-warm',
    };
    plan.tracks[0].clips[1].grade = {
      kind: 'hlg-bt2020-to-sdr-bt709-creator-vibrant',
    };

    const compiled = compileEditPlan(plan, paths);

    expect(Object.keys(FIXED_GRADE_PRESETS)).toContain('hlg-bt2020-to-sdr-bt709-creator-dark-warm');
    expect(compiled.filterComplex).toContain(
      'eq=brightness=-0.18:contrast=1.08:saturation=1.6:gamma=0.88',
    );
    expect(compiled.filterComplex).toContain(
      'colorbalance=rs=0.025:gs=-0.01:bs=-0.035:rm=0.012:bm=-0.018',
    );
    expect(compiled.filterComplex).toContain(
      'eq=brightness=-0.035:contrast=1.08:saturation=1.38:gamma=0.97',
    );
    expect(compiled.manifest.gradeKinds).toEqual([
      'hlg-bt2020-to-sdr-bt709-creator-dark-warm',
      'hlg-bt2020-to-sdr-bt709-creator-vibrant',
    ]);
  });

  it('compiles reusable creator title, commentary, watermark, CTA, and end-card text', () => {
    const plan = basePlan();
    plan.tracks[3].clips = [
      {
        id: 'overlay.creator-title',
        kind: 'text',
        timelineRange: range(0, 20),
        text: 'Sign\nSolo practice',
        templateId: 'text.creator-title',
        box: { x: 0.1, y: 0.08, width: 0.8, height: 0.12 },
        animation: 'fade',
      },
      {
        id: 'overlay.creator-commentary',
        kind: 'text',
        timelineRange: range(20, 40),
        text: 'Sharp + clean',
        templateId: 'text.creator-commentary',
        box: { x: 0.08, y: 0.72, width: 0.4, height: 0.08 },
        animation: 'pop',
      },
      {
        id: 'overlay.creator-watermark',
        kind: 'text',
        timelineRange: range(0, 90),
        text: '@SHUMHOMEN',
        templateId: 'text.creator-watermark',
        box: { x: 0.05, y: 0.04, width: 0.4, height: 0.06 },
        animation: 'none',
      },
      {
        id: 'overlay.creator-cta',
        kind: 'text',
        timelineRange: range(60, 75),
        text: 'Thanks for watching!',
        templateId: 'text.creator-cta',
        box: { x: 0.15, y: 0.36, width: 0.7, height: 0.1 },
        animation: 'slide-up',
      },
      {
        id: 'overlay.creator-end-card',
        kind: 'text',
        timelineRange: range(75, 90),
        text: 'Follow @SHUMHOMEN',
        templateId: 'text.creator-end-card',
        box: { x: 0.12, y: 0.47, width: 0.76, height: 0.1 },
        animation: 'fade',
      },
    ];

    const compiled = compileEditPlan(plan, paths);

    expect(Object.keys(FIXED_TEXT_TEMPLATES)).toEqual(
      expect.arrayContaining([
        'text.creator-title',
        'text.creator-commentary',
        'text.creator-watermark',
        'text.creator-cta',
        'text.creator-end-card',
      ]),
    );
    expect(compiled.auxiliaryFiles).toHaveLength(5);
    expect(compiled.filterComplex).toContain("x='36':");
    expect(compiled.filterComplex).toContain("alpha='0.84'");
    expect(compiled.manifest.overlayTemplates).toEqual([
      'text.creator-commentary',
      'text.creator-cta',
      'text.creator-end-card',
      'text.creator-title',
      'text.creator-watermark',
    ]);
  });

  it('fits long creator text to its admitted box instead of covering the subject', () => {
    const plan = basePlan();
    plan.tracks[3].clips = [
      {
        id: 'overlay.long-commentary',
        kind: 'text',
        timelineRange: range(0, 30),
        text: 'Something something…',
        templateId: 'text.creator-commentary',
        box: { x: 0.51, y: 0.63, width: 0.45, height: 0.07 },
        animation: 'pop',
      },
    ];

    const compiled = compileEditPlan(plan, paths);
    expect(estimatedTextEmWidth('Something something…')).toBeGreaterThan(10);
    expect(compiled.filterComplex).toContain("fontsize='24*(0.85+");
    expect(compiled.filterComplex).not.toContain("fontsize='56*(0.85+");
    expect(compiled.manifest.textPlacements).toEqual([
      expect.objectContaining({
        clipId: 'overlay.long-commentary',
        fontSize: 24,
        estimatedGlyphBox: expect.objectContaining({ width: expect.any(Number) }),
      }),
    ]);
    expect(compiled.manifest.textPlacements[0].estimatedGlyphBox.width).toBeLessThanOrEqual(0.45);
  });

  it('fails closed on a primary video gap', () => {
    const plan = basePlan();
    plan.tracks[0].clips[1].timelineRange.startFrame = 31;

    expect(() => validateEditPlan(plan, paths)).toThrow(/contiguous|start at frame 30/u);
  });

  it('rejects a one-frame black gap while retaining intentional black segments', () => {
    const accidentalGap = basePlan();
    accidentalGap.tracks[0].clips[1].timelineRange.endFrameExclusive = 59;
    accidentalGap.tracks[0].clips[2].timelineRange = range(59, 60);
    accidentalGap.tracks[0].clips.push({
      kind: 'freeze',
      id: 'video.final-hold',
      assetId: 'asset.source-1',
      timelineRange: range(60, 90),
      sourceFrame: 129,
      fit: 'fill',
      cropKeyframes: [],
      grade: { kind: 'none' },
    });

    expect(() => validateEditPlan(accidentalGap, paths)).toThrow(/one-frame black gap/u);
    expect(() => validateEditPlan(basePlan(), paths)).not.toThrow();
  });

  it('rejects plan-authored FFmpeg fragments and unknown overlay templates', () => {
    const plan = basePlan();
    plan.tracks[3].clips[0].templateId = 'custom.drawtext';
    plan.tracks[3].clips[0].filterComplex = 'movie=private.mp4';

    expect(() => validateEditPlan(plan, paths)).toThrow(/forbidden|fixed text template/u);
  });

  it('requires explicit rights provenance for music', () => {
    const plan = basePlan();
    plan.tracks[1].clips[0].license = undefined;

    expect(() => validateEditPlan(plan, paths)).toThrow(/license is required|rights status/u);
  });

  it('keeps evaluation-only assets out of render bindings', () => {
    const plan = basePlan();
    plan.tracks[0].clips[0].assetId = 'asset.reference-target';

    expect(() => validateEditPlan(plan, paths)).toThrow(/evaluation-only|not a render asset/u);
  });

  it('discloses target-informed decision artifacts without binding them as render inputs', () => {
    const plan = basePlan();
    plan.lineage.decisionArtifactIds = ['asset.reference-target'];
    plan.lineage.calibration = {
      targetAccess: 'authorized-profile-learning',
      targetArtifactIds: ['asset.reference-target'],
      disclosure: 'Owner-authorized style learning; this is not a blind generation.',
    };

    const compiled = compileEditPlan(plan, paths);

    expect(compiled.manifest.decisionArtifactIds).toEqual(['asset.reference-target']);
    expect(compiled.manifest.calibration).toEqual(plan.lineage.calibration);
    expect(compiled.boundAssets.some((asset) => asset.assetId === 'asset.reference-target')).toBe(
      false,
    );
  });
});
