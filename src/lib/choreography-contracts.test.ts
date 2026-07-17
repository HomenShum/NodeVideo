import { describe, expect, it } from 'vitest';
import {
  CHOREOGRAPHY_ANALYSIS_SCHEMA_VERSION,
  CHOREOGRAPHY_FREEZE_SCHEMA_VERSION,
  type ChoreographyAnalysisArtifact,
  type ChoreographyFreezeArtifact,
  SONG_CONDITIONED_PLAN_SCHEMA_VERSION,
  type SongConditionedPlanArtifact,
  validateChoreographyAnalysis,
  validateChoreographyFreeze,
  validateSongConditionedPlan,
} from './choreography-contracts';

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const clone = <T>(value: T): T => structuredClone(value);

const score = (name: string) => ({ value: 0.9, evidenceArtifactId: `evidence.${name}` });

function createAnalysis(): ChoreographyAnalysisArtifact {
  return {
    schemaVersion: CHOREOGRAPHY_ANALYSIS_SCHEMA_VERSION,
    id: 'analysis.1',
    runId: 'run.1',
    traceId: 'trace.1',
    createdAt: '2026-07-15T12:00:00.000Z',
    reference: {
      assetId: 'asset.reference',
      sha256: digest('a'),
      mimeType: 'video/mp4',
      usage: 'analysis-only',
      sourceRange: { startFrame: 0, endFrameExclusive: 120 },
      frameRate: 30,
      mirrorPolicy: 'as-recorded',
      evidenceArtifactIds: ['evidence.reference-pose'],
    },
    song: {
      assetId: 'asset.song',
      sha256: digest('b'),
      mimeType: 'audio/mpeg',
      usage: 'render-source',
      excerpt: { startMs: 5_000, endMs: 9_000 },
      license: { status: 'licensed', proofRef: 'license.song.1' },
      beatGrid: {
        bpm: 60,
        beatsMs: [0, 1_000, 2_000, 3_000, 4_000],
        downbeatsMs: [0, 4_000],
        evidenceArtifactId: 'evidence.song-beats',
      },
    },
    timedText: {
      assetId: 'asset.timed-text',
      sha256: digest('d'),
      mimeType: 'application/json',
      usage: 'analysis-only',
      cueCount: 1,
      license: { status: 'licensed', proofRef: 'license.lyrics.1' },
    },
    takes: [
      {
        id: 'take.1',
        assetId: 'asset.take.1',
        sha256: digest('c'),
        mimeType: 'video/quicktime',
        usage: 'render-source',
        sourceRange: { startFrame: 0, endFrameExclusive: 150 },
        frameRate: 30,
        mirrorApplied: false,
        alignmentAnchors: [
          {
            referenceFrame: 0,
            takeFrame: 10,
            timelineMs: 0,
            evidenceArtifactId: 'evidence.anchor.1',
          },
          {
            referenceFrame: 119,
            takeFrame: 139,
            timelineMs: 4_000,
            evidenceArtifactId: 'evidence.anchor.2',
          },
        ],
        evidenceArtifactIds: ['evidence.take-pose'],
      },
    ],
    phrases: [
      {
        id: 'phrase.1',
        order: 0,
        referenceRange: { startFrame: 0, endFrameExclusive: 60 },
        timelineRange: { startMs: 0, endMs: 2_000 },
        beatRange: { startIndex: 0, endIndexExclusive: 2 },
        movementEvidenceArtifactIds: ['evidence.movement.1'],
      },
      {
        id: 'phrase.2',
        order: 1,
        referenceRange: { startFrame: 60, endFrameExclusive: 120 },
        timelineRange: { startMs: 2_000, endMs: 4_000 },
        beatRange: { startIndex: 2, endIndexExclusive: 5 },
        movementEvidenceArtifactIds: ['evidence.movement.2'],
      },
    ],
    candidates: [
      candidate('candidate.1', 'phrase.1', { startFrame: 10, endFrameExclusive: 70 }, 0, 2_000),
      candidate(
        'candidate.2',
        'phrase.2',
        { startFrame: 70, endFrameExclusive: 130 },
        2_000,
        4_000,
      ),
    ],
    captionLayouts: [
      {
        id: 'caption.1',
        phraseId: 'phrase.1',
        timelineRange: { startMs: 250, endMs: 1_500 },
        text: 'MOVE\nWITH ME',
        lines: ['MOVE', 'WITH ME'],
        box: { x: 0.1, y: 0.05, width: 0.8, height: 0.12 },
        templateId: 'text.cue',
        bodyOverlapRatio: 0.01,
        faceOverlapRatio: 0,
        safeAreaEvidenceArtifactIds: ['evidence.safe-area.1'],
        groundingResultId: 'locate.body.1',
      },
    ],
    warnings: [],
  };
}

function candidate(
  id: string,
  phraseId: string,
  sourceRange: { startFrame: number; endFrameExclusive: number },
  startMs: number,
  endMs: number,
) {
  return {
    id,
    phraseId,
    takeId: 'take.1',
    sourceRange,
    timelineRange: { startMs, endMs },
    scores: {
      timing: score(`${id}.timing`),
      pose: score(`${id}.pose`),
      motion: score(`${id}.motion`),
      visibility: score(`${id}.visibility`),
      framing: score(`${id}.framing`),
      technical: score(`${id}.technical`),
    },
    eligibility: 'eligible' as const,
    rejectionReasons: [],
    evidenceArtifactIds: [`evidence.${id}`],
  };
}

function createPlan(): SongConditionedPlanArtifact {
  return {
    schemaVersion: SONG_CONDITIONED_PLAN_SCHEMA_VERSION,
    id: 'song-plan.1',
    analysisId: 'analysis.1',
    runId: 'run.1',
    traceId: 'trace.1',
    createdAt: '2026-07-15T12:01:00.000Z',
    durationMs: 4_000,
    selections: [
      {
        phraseId: 'phrase.1',
        candidateId: 'candidate.1',
        cutBeatIndex: 0,
        rationale: 'The first take has the strongest evidence-linked timing score.',
        evidenceArtifactIds: ['evidence.candidate.1'],
      },
      {
        phraseId: 'phrase.2',
        candidateId: 'candidate.2',
        cutBeatIndex: 2,
        rationale: 'The second phrase remains continuous with the selected take.',
        evidenceArtifactIds: ['evidence.candidate.2'],
      },
    ],
    captionLayouts: createAnalysis().captionLayouts,
    editPlanArtifactId: 'artifact.edit-plan.1',
    editPlanSha256: digest('d'),
  };
}

function createFreeze(): ChoreographyFreezeArtifact {
  return {
    schemaVersion: CHOREOGRAPHY_FREEZE_SCHEMA_VERSION,
    id: 'freeze.1',
    analysisId: 'analysis.1',
    planArtifactId: 'artifact.edit-plan.1',
    renderArtifactId: 'artifact.render.1',
    runId: 'run.1',
    traceId: 'trace.1',
    frozenAt: '2026-07-15T12:02:00.000Z',
    digests: {
      input: digest('e'),
      analysis: digest('f'),
      plan: digest('1'),
      render: digest('2'),
      generationReadLog: digest('3'),
    },
    generationInputAssetIds: ['asset.reference', 'asset.song', 'asset.timed-text', 'asset.take.1'],
    evaluationOnlyAssetIds: ['asset.hidden-final'],
    isolation: {
      generatorTargetAccess: 'denied',
      finalTargetMount: 'absent',
      evaluatorUnlock: 'after-freeze-verification',
    },
  };
}

describe('choreography contracts', () => {
  it('validates evidence-bound reference, song, takes, phrases, candidates, captions, and freeze', () => {
    const analysis = createAnalysis();
    expect(() => validateChoreographyAnalysis(analysis)).not.toThrow();
    expect(() => validateSongConditionedPlan(createPlan(), analysis)).not.toThrow();
    expect(() => validateChoreographyFreeze(createFreeze(), analysis)).not.toThrow();
  });

  it('enforces the song licensing boundary', () => {
    const analysis = clone(createAnalysis());
    analysis.song.license.status = 'platform-handoff-only';
    expect(() => validateChoreographyAnalysis(analysis)).toThrow(
      /Platform-handoff-only music cannot be a render source/,
    );
    analysis.song.usage = 'analysis-only';
    expect(() => validateChoreographyAnalysis(analysis)).not.toThrow();
  });

  it('requires every phrase to have an eligible evidence-bound candidate', () => {
    const analysis = clone(createAnalysis());
    analysis.candidates[1].eligibility = 'rejected';
    analysis.candidates[1].rejectionReasons = ['Subject is occluded.'];
    expect(() => validateChoreographyAnalysis(analysis)).toThrow(/has no eligible candidate/);

    const unbound = clone(createAnalysis());
    unbound.candidates[0].scores.timing = { value: 0.9, evidenceArtifactId: '' };
    expect(() => validateChoreographyAnalysis(unbound)).toThrow(/evidenceArtifactId is invalid/);
  });

  it('rejects unsafe or unnormalized caption placement', () => {
    const bodyOverlap = clone(createAnalysis());
    bodyOverlap.captionLayouts[0].bodyOverlapRatio = 0.2;
    expect(() => validateChoreographyAnalysis(bodyOverlap)).toThrow(/more than 5%/);

    const outside = clone(createAnalysis());
    outside.captionLayouts[0].box.x = 0.9;
    expect(() => validateChoreographyAnalysis(outside)).toThrow(/normalized/);
  });

  it('rejects evaluation-target fields in generation artifacts', () => {
    const analysis = createAnalysis() as ChoreographyAnalysisArtifact & {
      evaluationTargetAssetId?: string;
    };
    analysis.evaluationTargetAssetId = 'asset.hidden-final';
    expect(() => validateChoreographyAnalysis(analysis)).toThrow(/forbidden before freeze/);
  });

  it('requires a complete eligible song-conditioned selection', () => {
    const analysis = createAnalysis();
    const plan = clone(createPlan());
    plan.selections.pop();
    expect(() => validateSongConditionedPlan(plan, analysis)).toThrow(
      /exactly one candidate per phrase/,
    );
  });

  it('keeps evaluation-only assets outside generation and locked until verified freeze', () => {
    const analysis = createAnalysis();
    const leaked = clone(createFreeze());
    leaked.generationInputAssetIds.push('asset.hidden-final');
    expect(() => validateChoreographyFreeze(leaked, analysis)).toThrow(
      /cannot appear in generation inputs/,
    );

    const unfrozen = clone(createFreeze());
    unfrozen.isolation.finalTargetMount = 'mounted' as 'absent';
    expect(() => validateChoreographyFreeze(unfrozen, analysis)).toThrow(/must be absent/);
  });
});
