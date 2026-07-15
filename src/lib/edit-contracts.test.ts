import { describe, expect, it } from 'vitest';
import {
  CRITIC_REPORT_SCHEMA_VERSION,
  type CriticReport,
  EDIT_PLAN_SCHEMA_VERSION,
  EDIT_UNDERSTANDING_SCHEMA_VERSION,
  type EditPlan,
  type EditUnderstanding,
  LEGACY_CRITIC_REPORT_SCHEMA_VERSION,
  type LegacyCriticReportV1,
  type VideoTrack,
  validateCriticReport,
  validateEditPlan,
  validateEditUnderstanding,
} from './edit-contracts';

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const clone = <T>(value: T): T => structuredClone(value);

const beatGrid = {
  bpm: 120,
  offsetMs: 0,
  beatsMs: [0, 500, 1_000, 1_500, 2_000],
  downbeatsMs: [0, 2_000],
  confidence: 0.96,
};

const createUnderstanding = (): EditUnderstanding => ({
  schemaVersion: EDIT_UNDERSTANDING_SCHEMA_VERSION,
  id: 'understanding-1',
  runId: 'run-1',
  createdAt: '2026-07-15T12:00:00.000Z',
  mode: 'reference-understanding',
  frameRate: 30,
  canvas: { width: 1080, height: 1920 },
  assets: [
    {
      id: 'source-a',
      role: 'source-video',
      sha256: digest('a'),
      mimeType: 'video/quicktime',
      usage: 'render-source',
    },
    {
      id: 'target-a',
      role: 'reference-target',
      sha256: digest('b'),
      mimeType: 'video/mp4',
      usage: 'analysis-and-evaluation-only',
    },
    {
      id: 'music-a',
      role: 'music',
      sha256: digest('c'),
      mimeType: 'audio/mpeg',
      usage: 'render-source',
    },
    {
      id: 'sfx-a',
      role: 'sfx',
      sha256: digest('d'),
      mimeType: 'audio/wav',
      usage: 'render-source',
    },
    {
      id: 'sting-a',
      role: 'sting',
      sha256: digest('e'),
      mimeType: 'audio/wav',
      usage: 'render-source',
    },
  ],
  shots: [
    {
      id: 'shot-1',
      targetRange: { startFrame: 0, endFrameExclusive: 120 },
      candidates: [
        {
          id: 'candidate-1',
          sourceAssetId: 'source-a',
          sourceRange: { startFrame: 30, endFrameExclusive: 150 },
          confidence: 0.94,
          verification: {
            method: 'normalized-frame-search',
            inlierRatio: 0.88,
            reprojectionErrorPx: 1.4,
          },
        },
      ],
      selectedCandidateId: 'candidate-1',
      reframe: {
        keyframes: [
          {
            timelineFrame: 0,
            box: { x: 0.1, y: 0, width: 0.8, height: 1 },
          },
        ],
        confidence: 0.9,
      },
      grade: { kind: 'none', confidence: 0.8 },
    },
  ],
  audio: {
    targetAudioUsage: 'analysis-only',
    beatGrid,
    transcript: [
      {
        text: 'The real moat is understanding the outcome.',
        startMs: 200,
        endMs: 1_700,
        confidence: 0.98,
      },
    ],
    musicCandidates: [
      {
        assetId: 'music-a',
        confidence: 0.91,
        rationale: 'Tempo and downbeats fit the detected cut cadence.',
        identity: {
          title: 'Example Track',
          artist: 'Example Artist',
          isrc: 'USABC2612345',
        },
        excerpt: {
          sourceOffsetMs: 5_000,
          releasedMasterOffsetMs: 5_000,
          releasedMasterGainDb: -10,
          targetStartMs: 0,
          targetEndMs: 3_500,
        },
      },
    ],
    selectedMusicAssetId: 'music-a',
  },
  overlays: [
    {
      id: 'overlay-analysis-1',
      kind: 'text',
      targetRange: { startFrame: 0, endFrameExclusive: 45 },
      text: 'THE REAL MOAT',
      box: { x: 0.1, y: 0.08, width: 0.8, height: 0.12 },
      confidence: 0.97,
      styleToken: 'headline.centered',
    },
  ],
  warnings: [],
});

const createPlan = (): EditPlan => ({
  schemaVersion: EDIT_PLAN_SCHEMA_VERSION,
  id: 'plan-1',
  understandingId: 'understanding-1',
  version: 1,
  createdAt: '2026-07-15T12:05:00.000Z',
  frameRate: 30,
  canvas: { width: 1080, height: 1920 },
  durationFrames: 120,
  lineage: {
    renderAssetIds: ['source-a', 'music-a', 'sfx-a', 'sting-a'],
    evaluationOnlyAssetIds: ['target-a'],
    targetDerivedRenderAssetIds: [],
  },
  audio: {
    routing: [
      {
        id: 'route-source-a',
        sourceKind: 'asset-audio',
        sourceId: 'source-a',
        bus: 'program',
        muted: true,
        gainDb: 0,
      },
      {
        id: 'route-music',
        sourceKind: 'track',
        sourceId: 'audio-music',
        bus: 'music',
        muted: false,
        gainDb: 0,
      },
      {
        id: 'route-effects',
        sourceKind: 'track',
        sourceId: 'audio-effects',
        bus: 'effects',
        muted: false,
        gainDb: 0,
      },
    ],
    events: [
      {
        id: 'music-event-1',
        kind: 'music',
        clipId: 'music-1',
        sourceOffsetMs: 5_000,
        releasedMasterOffsetMs: 5_000,
        releasedMasterGainDb: -10,
        targetStartMs: 0,
        targetEndMs: 3_500,
        gainDb: -10,
        identity: {
          title: 'Example Track',
          artist: 'Example Artist',
          isrc: 'USABC2612345',
        },
      },
      {
        id: 'sfx-event-1',
        kind: 'sfx',
        clipId: 'sfx-1',
        sourceOffsetMs: 0,
        targetStartMs: 1_000,
        targetEndMs: 1_500,
        gainDb: -4,
        label: 'whoosh',
      },
      {
        id: 'sting-event-1',
        kind: 'sting',
        clipId: 'sting-1',
        sourceOffsetMs: 0,
        targetStartMs: 3_000,
        targetEndMs: 3_500,
        gainDb: -2,
        label: 'end-card sting',
      },
      {
        id: 'silence-event-1',
        kind: 'silence',
        targetStartMs: 3_500,
        targetEndMs: 4_000,
      },
    ],
  },
  beatGrid,
  tracks: [
    {
      id: 'video-primary',
      kind: 'video',
      role: 'primary',
      clips: [
        {
          id: 'video-1',
          kind: 'source',
          assetId: 'source-a',
          timelineRange: { startFrame: 0, endFrameExclusive: 45 },
          sourceRange: { startFrame: 30, endFrameExclusive: 75 },
          playbackRate: 1,
          fit: 'fill',
          cropKeyframes: [],
          grade: { kind: 'hlg-bt2020-to-sdr-bt709-hable' },
        },
        {
          id: 'freeze-1',
          kind: 'freeze',
          assetId: 'source-a',
          timelineRange: { startFrame: 45, endFrameExclusive: 60 },
          sourceFrame: 74,
          fit: 'fill',
          cropKeyframes: [],
          grade: { kind: 'none' },
        },
        {
          id: 'video-2',
          kind: 'source',
          assetId: 'source-a',
          timelineRange: { startFrame: 60, endFrameExclusive: 105 },
          sourceRange: { startFrame: 210, endFrameExclusive: 255 },
          playbackRate: 1,
          fit: 'crop',
          cropKeyframes: [
            {
              timelineFrame: 60,
              box: { x: 0.1, y: 0, width: 0.8, height: 1 },
            },
          ],
          grade: { kind: 'none' },
        },
        {
          id: 'black-1',
          kind: 'black',
          timelineRange: { startFrame: 105, endFrameExclusive: 120 },
        },
      ],
    },
    {
      id: 'audio-music',
      kind: 'audio',
      role: 'music',
      clips: [
        {
          id: 'music-1',
          assetId: 'music-a',
          timelineRange: { startFrame: 0, endFrameExclusive: 105 },
          sourceRange: { startFrame: 150, endFrameExclusive: 255 },
          playbackRate: 1,
          role: 'music',
          gainDb: -10,
          fadeInFrames: 6,
          fadeOutFrames: 12,
          license: { status: 'owned', proofRef: 'license-receipt-1' },
        },
      ],
    },
    {
      id: 'audio-effects',
      kind: 'audio',
      role: 'effects',
      clips: [
        {
          id: 'sfx-1',
          assetId: 'sfx-a',
          timelineRange: { startFrame: 30, endFrameExclusive: 45 },
          sourceRange: { startFrame: 0, endFrameExclusive: 15 },
          playbackRate: 1,
          role: 'sfx',
          gainDb: -4,
          fadeInFrames: 0,
          fadeOutFrames: 0,
        },
        {
          id: 'sting-1',
          assetId: 'sting-a',
          timelineRange: { startFrame: 90, endFrameExclusive: 105 },
          sourceRange: { startFrame: 0, endFrameExclusive: 15 },
          playbackRate: 1,
          role: 'sting',
          gainDb: -2,
          fadeInFrames: 0,
          fadeOutFrames: 0,
        },
      ],
    },
    {
      id: 'overlays',
      kind: 'overlay',
      clips: [
        {
          id: 'title-1',
          timelineRange: { startFrame: 0, endFrameExclusive: 45 },
          kind: 'text',
          text: 'THE REAL MOAT',
          templateId: 'headline.centered',
          box: { x: 0.1, y: 0.08, width: 0.8, height: 0.12 },
          animation: 'fade',
        },
      ],
    },
  ],
});

const createCriticReport = (): CriticReport => ({
  schemaVersion: CRITIC_REPORT_SCHEMA_VERSION,
  id: 'critic-1',
  planId: 'plan-1',
  planVersion: 1,
  renderArtifactId: 'render-1',
  createdAt: '2026-07-15T12:10:00.000Z',
  mode: 'combined',
  verdict: 'revise',
  scores: {
    technical: 0.99,
    mapping: 0.84,
    rhythm: 0.8,
    framing: 0.92,
    text: 0.95,
    audio: 0.86,
    grade: 0.9,
    taste: null,
  },
  tasteStatus: 'not-evaluated',
  findings: [
    {
      id: 'finding-1',
      severity: 'warning',
      category: 'rhythm',
      message: 'The second cut lands three frames after the downbeat.',
      evidence: {
        artifactId: 'render-1',
        timelineRange: { startFrame: 57, endFrameExclusive: 66 },
      },
    },
  ],
  worstWindows: [
    {
      timelineRange: { startFrame: 57, endFrameExclusive: 66 },
      score: 0.72,
      metric: 'rhythm',
      findingIds: ['finding-1'],
    },
  ],
  patches: [
    {
      id: 'patch-1',
      op: 'nudge-cut',
      targetClipId: 'video-2',
      startDeltaFrames: -3,
      rationale: 'Land the cut on the detected downbeat.',
      confidence: 0.9,
    },
  ],
});

const createLegacyCriticReport = (): LegacyCriticReportV1 => {
  const current = createCriticReport();
  const { tasteStatus: _tasteStatus, tasteEvidenceRef: _tasteEvidenceRef, ...legacy } = current;
  return {
    ...legacy,
    schemaVersion: LEGACY_CRITIC_REPORT_SCHEMA_VERSION,
    scores: { ...legacy.scores, taste: 0.82 },
  };
};

describe('edit contract validators', () => {
  it('accepts a complete understanding, licensed beat-aware plan, and targeted critic report', () => {
    const understanding = createUnderstanding();
    const plan = createPlan();
    const report = createCriticReport();

    expect(() => validateEditUnderstanding(understanding)).not.toThrow();
    expect(() => validateEditPlan(plan)).not.toThrow();
    expect(() => validateCriticReport(report, plan)).not.toThrow();
  });

  it('accepts the target-container usage for authorized derived render assets only', () => {
    const understanding = createUnderstanding();
    const target = understanding.assets.find((asset) => asset.role === 'reference-target');
    if (!target) throw new Error('fixture is missing the reference target');
    target.usage = 'analysis-evaluation-and-authorized-asset-derivation';

    expect(() => validateEditUnderstanding(understanding)).not.toThrow();

    const source = understanding.assets.find((asset) => asset.role === 'source-video');
    if (!source) throw new Error('fixture is missing a source video');
    source.usage = 'analysis-evaluation-and-authorized-asset-derivation';
    expect(() => validateEditUnderstanding(understanding)).toThrow(
      /may only be assigned to a reference-target container/,
    );
  });

  it('requires explicit blinded evidence before reporting a taste score', () => {
    const plan = createPlan();
    const report = createCriticReport();

    expect(() => validateCriticReport(report, plan)).not.toThrow();

    report.scores.taste = 0.82;
    expect(() => validateCriticReport(report, plan)).toThrow(
      /scores\.taste must be null when tasteStatus is not-evaluated/,
    );

    report.tasteStatus = 'evaluated-blinded';
    expect(() => validateCriticReport(report, plan)).toThrow(/tasteEvidenceRef must be a string/);

    report.tasteEvidenceRef = 'blinded-panel:review-42';
    expect(() => validateCriticReport(report, plan)).not.toThrow();
  });

  it('continues to validate historical v1 critic artifacts', () => {
    const plan = createPlan();
    const report = createLegacyCriticReport();

    expect(() => validateCriticReport(report, plan)).not.toThrow();
  });

  it('rejects unknown keys at nested boundaries', () => {
    const understanding = createUnderstanding() as EditUnderstanding & {
      implementationHint?: string;
    };
    understanding.implementationHint = 'custom-css';

    expect(() => validateEditUnderstanding(understanding)).toThrow(/unknown key/);
  });

  it('rejects a selected source mapping that is not one of the shot candidates', () => {
    const understanding = createUnderstanding();
    understanding.shots[0].selectedCandidateId = 'candidate-does-not-exist';

    expect(() => validateEditUnderstanding(understanding)).toThrow(
      /selectedCandidateId does not reference a candidate/,
    );
  });

  it('validates canonical ISRC metadata when music identity is available', () => {
    const understanding = createUnderstanding();
    const identity = understanding.audio.musicCandidates[0].identity;
    if (!identity) throw new Error('fixture is missing music identity');
    identity.isrc = 'not-an-isrc';

    expect(() => validateEditUnderstanding(understanding)).toThrow(/canonical 12-character ISRC/);
  });

  it('requires an excerpt mapping for the selected music candidate', () => {
    const understanding = createUnderstanding();
    understanding.audio.musicCandidates[0].excerpt = undefined;

    expect(() => validateEditUnderstanding(understanding)).toThrow(
      /selected music requires an excerpt mapping/,
    );
  });

  it('rejects overlapping primary video clips', () => {
    const plan = createPlan();
    const primary = plan.tracks[0] as VideoTrack;
    primary.clips[1].timelineRange.startFrame = 44;

    expect(() => validateEditPlan(plan)).toThrow(/primary track is contiguous/);
  });

  it('rejects an implicit primary gap instead of guessing how to render it', () => {
    const plan = createPlan();
    const primary = plan.tracks[0] as VideoTrack;
    primary.clips.splice(1, 1);

    expect(() => validateEditPlan(plan)).toThrow(/must start at frame 45/);
  });

  it('requires primary coverage to begin at frame zero', () => {
    const plan = createPlan();
    const primary = plan.tracks[0] as VideoTrack;
    primary.clips[0].timelineRange.startFrame = 1;

    expect(() => validateEditPlan(plan)).toThrow(/must start at frame 0/);
  });

  it('requires the primary track to cover the plan tail explicitly', () => {
    const plan = createPlan();
    const primary = plan.tracks[0] as VideoTrack;
    primary.clips.pop();

    expect(() => validateEditPlan(plan)).toThrow(/must end at frame 120/);
  });

  it('keeps black clips asset-free', () => {
    const plan = createPlan();
    const primary = plan.tracks[0] as VideoTrack;
    const black = primary.clips[3] as (typeof primary.clips)[number] & { assetId?: string };
    black.assetId = 'source-a';

    expect(() => validateEditPlan(plan)).toThrow(/unknown key: assetId/);
  });

  it('requires freeze frames to bind a render-lineage asset', () => {
    const plan = createPlan();
    const primary = plan.tracks[0] as VideoTrack;
    const freeze = primary.clips[1];
    if (freeze.kind !== 'freeze') throw new Error('fixture has the wrong clip type');
    freeze.assetId = 'target-a';

    expect(() => validateEditPlan(plan)).toThrow(/assetId is not a render asset/);
  });

  it('keeps the fixed HLG-to-SDR primitive artifact-free', () => {
    const plan = createPlan();
    const primary = plan.tracks[0] as VideoTrack;
    const source = primary.clips[0];
    if (source.kind !== 'source') throw new Error('fixture has the wrong clip type');
    source.grade = {
      kind: 'hlg-bt2020-to-sdr-bt709-hable',
      artifactId: 'source-a',
    };

    expect(() => validateEditPlan(plan)).toThrow(/artifactId is not allowed for fixed grade/);
  });

  it('keeps evaluation-only target media out of render lineage', () => {
    const plan = createPlan();
    plan.lineage.renderAssetIds.push('target-a');

    expect(() => validateEditPlan(plan)).toThrow(/cannot be render and evaluation-only/);
  });

  it('rejects music without explicit rights evidence', () => {
    const plan = createPlan();
    const musicTrack = plan.tracks[1];
    if (musicTrack.kind !== 'audio') throw new Error('fixture has the wrong track type');
    musicTrack.clips[0].license = undefined;

    expect(() => validateEditPlan(plan)).toThrow(/license is required for music/);
  });

  it('requires a beat grid whenever the plan contains music', () => {
    const plan = createPlan();
    plan.beatGrid = undefined;

    expect(() => validateEditPlan(plan)).toThrow(/music clips require a beat grid/);
  });

  it('requires an explicit mix-or-mute route for embedded source audio', () => {
    const plan = createPlan();
    plan.audio.routing = plan.audio.routing.filter((route) => route.sourceKind !== 'asset-audio');

    expect(() => validateEditPlan(plan)).toThrow(/explicitly mix or mute source audio/);
  });

  it('keeps sample-time music events aligned with their frame clip', () => {
    const plan = createPlan();
    const event = plan.audio.events.find((candidate) => candidate.kind === 'music');
    if (!event || event.kind !== 'music') throw new Error('fixture is missing the music event');
    event.targetEndMs = 3_400;

    expect(() => validateEditPlan(plan)).toThrow(/target timing does not match its audio clip/);
  });

  it('keeps asset-local trim time distinct from released-master provenance', () => {
    const plan = createPlan();
    const musicTrack = plan.tracks.find(
      (track) => track.kind === 'audio' && track.role === 'music',
    );
    const event = plan.audio.events.find((candidate) => candidate.kind === 'music');
    if (!musicTrack || musicTrack.kind !== 'audio' || !event || event.kind !== 'music') {
      throw new Error('fixture is missing music');
    }
    musicTrack.clips[0].sourceRange = { startFrame: 0, endFrameExclusive: 105 };
    musicTrack.clips[0].gainDb = 0;
    event.sourceOffsetMs = 0;
    event.releasedMasterOffsetMs = 5_000;
    event.gainDb = 0;
    event.releasedMasterGainDb = -10;

    expect(() => validateEditPlan(plan)).not.toThrow();

    event.sourceOffsetMs = event.releasedMasterOffsetMs;
    expect(() => validateEditPlan(plan)).toThrow(/sourceOffsetMs does not match its audio clip/);
  });

  it('rejects declared silence that overlaps music, SFX, or a sting', () => {
    const plan = createPlan();
    const silence = plan.audio.events.find((candidate) => candidate.kind === 'silence');
    if (!silence || silence.kind !== 'silence') throw new Error('fixture is missing silence');
    silence.targetStartMs = 3_400;

    expect(() => validateEditPlan(plan)).toThrow(/silence overlaps an audible event/);
  });

  it('keeps SFX and sting event kinds distinct from their bound clips', () => {
    const plan = createPlan();
    const sfx = plan.audio.events.find((candidate) => candidate.kind === 'sfx');
    if (!sfx || sfx.kind !== 'sfx') throw new Error('fixture is missing the SFX event');
    sfx.kind = 'sting';

    expect(() => validateEditPlan(plan)).toThrow(/kind does not match its audio clip role/);
  });

  it('rejects critic patches aimed at a clip outside the validated plan', () => {
    const plan = createPlan();
    const report = createCriticReport();
    report.patches[0].targetClipId = 'video-does-not-exist';

    expect(() => validateCriticReport(report, plan)).toThrow(
      /targetClipId does not exist in the plan/,
    );
  });

  it('rejects a no-op cut patch', () => {
    const plan = createPlan();
    const report = createCriticReport();
    const patch = report.patches[0];
    if (patch.op !== 'nudge-cut') throw new Error('fixture has the wrong patch type');
    patch.startDeltaFrames = 0;

    expect(() => validateCriticReport(report, plan)).toThrow(/requires a non-zero cut delta/);
  });

  it('rejects worst-window evidence that points to an unknown finding', () => {
    const plan = createPlan();
    const report = createCriticReport();
    report.worstWindows[0].findingIds = ['finding-does-not-exist'];

    expect(() => validateCriticReport(report, plan)).toThrow(
      /findingIds references an unknown finding/,
    );
  });

  it('does not allow a passing critic to smuggle in corrective patches', () => {
    const plan = createPlan();
    const report = createCriticReport();
    report.verdict = 'pass';

    expect(() => validateCriticReport(report, plan)).toThrow(
      /passing CriticReport cannot contain patches/,
    );
  });

  it('rejects unsupported schema versions before accepting an artifact', () => {
    const plan: unknown = {
      ...clone(createPlan()),
      schemaVersion: 'nodevideo.edit-plan.v2',
    };

    expect(() => validateEditPlan(plan)).toThrow(/Unsupported EditPlan schema version/);
  });
});
