import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import {
  validateChoreographyAnalysis,
  validateChoreographyFreeze,
  validateSongConditionedPlan,
} from '../../src/lib/choreography-contracts.ts';
import { validateLocateResult } from '../../src/lib/visual-grounding.ts';
import {
  REPO_ROOT,
  assertion,
  assertionsPass,
  probeMedia,
  requireFile,
  runText,
  sanitizeProbe,
  sha256File,
  writeJson,
} from '../media/media-proof-lib.mjs';
import { renderEditPlan } from './edit-plan-renderer-lib.mjs';

export const SONG_EDIT_VERSION = 'nodevideo.song-conditioned-auto-edit@0.1.0';
export const SONG_EDIT_CASE_ID = 'song-conditioned-auto-edit-v1';
export const SONG_EDIT_ROOT = join(REPO_ROOT, 'fixtures', 'media', SONG_EDIT_CASE_ID);

const FRAME_RATE = 30;
const DURATION_FRAMES = 180;
const CREATED_AT = '2026-07-15T00:00:00.000Z';
const TIMED_TEXT_FIXTURE = {
  schemaVersion: 'nodevideo.timed-text-input.v1',
  license: 'public-domain-generated-fixture',
  cues: [
    { id: 'cue.1', startMs: 250, endMs: 1600, text: 'Find the phrase' },
    { id: 'cue.2', startMs: 2250, endMs: 3600, text: 'Cut on the beat' },
    { id: 'cue.3', startMs: 4250, endMs: 5600, text: 'Finish clean' },
  ],
};
export const SONG_REPLAY_ARTIFACT_FILES = Object.freeze({
  'original-choreography-reference': 'original-choreography-reference.mp4',
  'creator-take-a': 'creator-take-a.mp4',
  'creator-take-b': 'creator-take-b.mp4',
  'chosen-song': 'chosen-song.m4a',
  'timed-text': 'timed-text.json',
  understanding: 'understanding.json',
  'grounding-receipt': 'grounding-receipt.json',
  'song-conditioned-plan': 'song-conditioned-plan.json',
  'edit-plan': 'edit-plan.json',
  'generation-read-log': 'generation-read-log.json',
  'choreography-freeze': 'choreography-freeze.json',
  preview: 'preview.mp4',
  'freeze-receipt': 'freeze-receipt.json',
  'evaluator-report': 'evaluator-report.json',
});

export async function generateSongConditionedReplay({ ffmpeg = 'ffmpeg' } = {}) {
  const tutorialRoot = join(REPO_ROOT, 'fixtures', 'media', 'tutorial-compare-v1');
  const referenceInput = join(tutorialRoot, 'source-reference.mp4');
  requireFile(referenceInput, 'public choreography reference');
  await mkdir(SONG_EDIT_ROOT, { recursive: true });

  const inputs = {
    reference: join(SONG_EDIT_ROOT, 'original-choreography-reference.mp4'),
    takeA: join(SONG_EDIT_ROOT, 'creator-take-a.mp4'),
    takeB: join(SONG_EDIT_ROOT, 'creator-take-b.mp4'),
    music: join(SONG_EDIT_ROOT, 'chosen-song.m4a'),
    timedText: join(SONG_EDIT_ROOT, 'timed-text.json'),
  };
  createReference(referenceInput, inputs.reference, ffmpeg);
  createTake(inputs.reference, inputs.takeA, 'between(t,2,4)', ffmpeg);
  createTake(inputs.reference, inputs.takeB, 'between(t,0,2)+between(t,4,6)', ffmpeg);
  extractMusic(inputs.reference, inputs.music, ffmpeg);
  await writeJson(inputs.timedText, TIMED_TEXT_FIXTURE);
  const timedText = JSON.parse(await readFile(inputs.timedText, 'utf8'));
  validateTimedTextInput(timedText);

  const inputHashes = Object.fromEntries(
    await Promise.all(
      Object.entries(inputs).map(async ([key, path]) => [key, await sha256File(path)]),
    ),
  );
  const phraseScores = await scoreTakeSharpness(inputs, ffmpeg);
  const phrases = phraseScores.map((scores, index) => {
    const selectedTakeId = scores.takeA >= scores.takeB ? 'asset.take-a' : 'asset.take-b';
    return {
      id: `phrase.${index + 1}`,
      timelineRange: { startFrame: index * 60, endFrameExclusive: (index + 1) * 60 },
      referenceRange: { startFrame: index * 60, endFrameExclusive: (index + 1) * 60 },
      candidates: [
        candidate('asset.take-a', scores.takeA),
        candidate('asset.take-b', scores.takeB),
      ],
      selectedTakeId,
      selectionReason: 'Highest deterministic sharpness score inside the complete musical phrase.',
    };
  });

  const grounding = buildGroundingReceipt(inputHashes.reference);
  const subjectBox = grounding.observations[0].geometry.box;
  const understanding = buildUnderstanding(inputHashes, phrases, timedText.cues, subjectBox);
  const plan = buildEditPlan(phrases, timedText.cues);
  validateChoreographyAnalysis(understanding);
  validateLocateResult(grounding);
  const bindings = {
    'asset.take-a': inputs.takeA,
    'asset.take-b': inputs.takeB,
    'asset.music': inputs.music,
  };

  const paths = {
    understanding: join(SONG_EDIT_ROOT, 'understanding.json'),
    grounding: join(SONG_EDIT_ROOT, 'grounding-receipt.json'),
    plan: join(SONG_EDIT_ROOT, 'edit-plan.json'),
    songPlan: join(SONG_EDIT_ROOT, 'song-conditioned-plan.json'),
    readLog: join(SONG_EDIT_ROOT, 'generation-read-log.json'),
    choreographyFreeze: join(SONG_EDIT_ROOT, 'choreography-freeze.json'),
    preview: join(SONG_EDIT_ROOT, 'preview.mp4'),
    freeze: join(SONG_EDIT_ROOT, 'freeze-receipt.json'),
    evaluation: join(SONG_EDIT_ROOT, 'evaluator-report.json'),
    manifest: join(SONG_EDIT_ROOT, 'manifest.json'),
  };
  await Promise.all([
    writeJson(paths.understanding, understanding),
    writeJson(paths.grounding, grounding),
    writeJson(paths.plan, plan),
  ]);
  const songPlan = buildSongPlan(understanding, plan, phrases, await sha256File(paths.plan));
  const readLog = buildGenerationReadLog(inputHashes);
  validateSongConditionedPlan(songPlan, understanding);
  await Promise.all([writeJson(paths.songPlan, songPlan), writeJson(paths.readLog, readLog)]);
  await renderEditPlan({
    plan,
    bindings,
    outputPath: paths.preview,
    auxiliaryDirectory: join(
      REPO_ROOT,
      '.qa',
      'evidence',
      'private',
      'song-conditioned-replay-work',
    ),
    ffmpeg,
  });

  const choreographyFreeze = await buildChoreographyFreeze({
    inputHashes,
    paths,
    understanding,
  });
  validateChoreographyFreeze(choreographyFreeze, understanding);
  await writeJson(paths.choreographyFreeze, choreographyFreeze);

  const frozenFiles = await recordsFor([
    paths.understanding,
    paths.grounding,
    paths.plan,
    paths.songPlan,
    paths.readLog,
    paths.choreographyFreeze,
    paths.preview,
  ]);
  const freeze = {
    schemaVersion: 'nodevideo.generation-freeze.v1',
    id: `freeze.${SONG_EDIT_CASE_ID}`,
    createdAt: CREATED_AT,
    generatorVersion: SONG_EDIT_VERSION,
    targetMountedDuringGeneration: false,
    targetReadDuringGeneration: false,
    files: frozenFiles,
  };
  await writeJson(paths.freeze, freeze);

  const evaluation = await evaluateReplay({ paths, plan, phrases });
  await writeJson(paths.evaluation, evaluation);
  const manifest = await buildManifest({ inputHashes, phrases, evaluation });
  await writeJson(paths.manifest, manifest);
  return { inputs, paths, plan, manifest, evaluation };
}

export async function verifySongConditionedReplay({ ffprobe = 'ffprobe' } = {}) {
  const manifestPath = join(SONG_EDIT_ROOT, 'manifest.json');
  requireFile(manifestPath, 'song-conditioned manifest');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const assertions = [
    assertion(
      'manifest schema',
      manifest.schemaVersion === 'nodevideo.song-conditioned-replay.v1',
      manifest.schemaVersion,
      'nodevideo.song-conditioned-replay.v1',
    ),
    assertion(
      'target hidden through freeze',
      manifest.protocol.targetMountedDuringGeneration === false,
    ),
    assertion(
      'original choreography is an input',
      manifest.inputs.originalChoreographyReference === true,
    ),
    assertion('chosen song is an input', manifest.inputs.chosenSongSegment === true),
    assertion('multiple creator takes are inputs', manifest.inputs.creatorTakeCount === 2),
    assertion('source audio is structurally muted', manifest.audio.sourceAudioMuted === true),
    assertion('music is rendered', manifest.audio.previewContainsChosenSong === true),
    assertion('three complete phrases selected', manifest.selection.phraseCount === 3),
    assertion('intentional take switching occurred', manifest.selection.takeSwitchCount >= 2),
    assertion(
      'artifact set is exact',
      manifest.artifacts.length === Object.keys(SONG_REPLAY_ARTIFACT_FILES).length &&
        Object.entries(SONG_REPLAY_ARTIFACT_FILES).every(
          ([id, file]) => manifest.artifacts.find((artifact) => artifact.id === id)?.file === file,
        ),
    ),
  ];
  for (const artifact of manifest.artifacts) {
    const path = join(SONG_EDIT_ROOT, artifact.file);
    requireFile(path, artifact.id);
    assertions.push(
      assertion(
        `${artifact.id} hash`,
        (await sha256File(path)) === artifact.sha256,
        await sha256File(path),
        artifact.sha256,
      ),
    );
  }
  const probe = sanitizeProbe(probeMedia(join(SONG_EDIT_ROOT, 'preview.mp4'), ffprobe));
  assertions.push(
    assertion(
      'preview duration',
      Math.abs(probe.format.durationSeconds - 6) <= 0.04,
      probe.format.durationSeconds,
      6,
    ),
    assertion(
      'preview portrait width',
      probe.video.codedWidth === 360,
      probe.video.codedWidth,
      360,
    ),
    assertion(
      'preview portrait height',
      probe.video.codedHeight === 640,
      probe.video.codedHeight,
      640,
    ),
    assertion('preview has audio', Boolean(probe.audio), Boolean(probe.audio), true),
  );
  return { passed: assertionsPass(assertions), assertions };
}

function createReference(input, output, ffmpeg) {
  runText(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-t',
    '6',
    '-vf',
    'fps=30,scale=360:640:flags=lanczos,format=yuv420p',
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'veryfast',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    output,
  ]);
}

function createTake(input, output, enable, ffmpeg) {
  runText(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-vf',
    `boxblur=luma_radius=8:luma_power=2:enable='${enable}',format=yuv420p`,
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'veryfast',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    output,
  ]);
}

function extractMusic(input, output, ffmpeg) {
  runText(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-vn',
    '-t',
    '6',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    output,
  ]);
}

async function scoreTakeSharpness(inputs, ffmpeg) {
  const [takeA, takeB] = await Promise.all([
    decodeGrayFrames(inputs.takeA, ffmpeg),
    decodeGrayFrames(inputs.takeB, ffmpeg),
  ]);
  return [0, 1, 2].map((phrase) => {
    const from = phrase * 8;
    const to = from + 8;
    return {
      takeA: rounded(mean(takeA.slice(from, to).map(laplacianVariance))),
      takeB: rounded(mean(takeB.slice(from, to).map(laplacianVariance))),
    };
  });
}

async function decodeGrayFrames(path, ffmpeg) {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    ffmpeg,
    [
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      'fps=4,scale=90:160:flags=area,format=gray',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { encoding: null, maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error(result.stderr?.toString() || 'Could not decode replay frames.');
  const frameBytes = 90 * 160;
  const frames = [];
  for (let offset = 0; offset + frameBytes <= result.stdout.length; offset += frameBytes) {
    frames.push(result.stdout.subarray(offset, offset + frameBytes));
  }
  if (frames.length < 24)
    throw new Error('Replay take did not decode the expected analysis frames.');
  return frames;
}

function laplacianVariance(frame) {
  const values = [];
  for (let y = 1; y < 159; y += 1) {
    for (let x = 1; x < 89; x += 1) {
      const i = y * 90 + x;
      values.push(4 * frame[i] - frame[i - 1] - frame[i + 1] - frame[i - 90] - frame[i + 90]);
    }
  }
  const average = mean(values);
  return mean(values.map((value) => (value - average) ** 2));
}

function candidate(assetId, sharpness) {
  return {
    takeAssetId: assetId,
    sourceRange: { startFrame: 0, endFrameExclusive: 60 },
    scores: { choreography: 1, completeness: 1, framing: 1, sharpness },
    groundingStatus: 'valid',
  };
}

function validateTimedTextInput(value) {
  if (
    value?.schemaVersion !== 'nodevideo.timed-text-input.v1' ||
    value?.license !== 'public-domain-generated-fixture' ||
    !Array.isArray(value.cues) ||
    value.cues.length !== 3 ||
    value.cues.some(
      (cue) =>
        !/^cue\.[1-9][0-9]*$/u.test(cue.id) ||
        !Number.isInteger(cue.startMs) ||
        !Number.isInteger(cue.endMs) ||
        cue.startMs < 0 ||
        cue.endMs <= cue.startMs ||
        cue.endMs > 6000 ||
        typeof cue.text !== 'string' ||
        cue.text.length === 0 ||
        cue.text.length > 250,
    )
  ) {
    throw new Error('Timed-text fixture failed its input contract.');
  }
}

function buildUnderstanding(inputHashes, phrases, timedTextCues, subjectBox) {
  const evidence = {
    beat: 'evidence.beat-grid',
    alignment: 'evidence.exact-fixture-alignment',
    pose: 'evidence.fixture-choreography-lineage',
    grounding: 'evidence.replay-grounding',
    technical: 'evidence.sharpness-score',
  };
  const captionBox = { x: 0.1, y: 0.035, width: 0.8, height: 0.09 };
  const bodyOverlapRatio = normalizedOverlapRatio(captionBox, subjectBox);
  if (bodyOverlapRatio !== 0) throw new Error('Replay caption intersects the grounded performer.');
  const strictPhrases = phrases.map((phrase, index) => ({
    id: phrase.id,
    order: index,
    referenceRange: phrase.referenceRange,
    timelineRange: { startMs: index * 2000, endMs: (index + 1) * 2000 },
    beatRange: { startIndex: index * 4, endIndexExclusive: (index + 1) * 4 },
    movementEvidenceArtifactIds: [evidence.pose, evidence.beat],
  }));
  const candidates = phrases.flatMap((phrase, phraseIndex) => {
    const maximumSharpness = Math.max(...phrase.candidates.map((item) => item.scores.sharpness));
    return phrase.candidates.map((item, takeIndex) => {
      const takeId = item.takeAssetId === 'asset.take-a' ? 'take.a' : 'take.b';
      const technical = maximumSharpness > 0 ? item.scores.sharpness / maximumSharpness : 0;
      const score = (value, evidenceArtifactId) => ({ value: rounded(value), evidenceArtifactId });
      return {
        id: `candidate.${phraseIndex + 1}.${takeIndex + 1}`,
        phraseId: phrase.id,
        takeId,
        sourceRange: phrase.referenceRange,
        timelineRange: strictPhrases[phraseIndex].timelineRange,
        scores: {
          timing: score(1, evidence.alignment),
          pose: score(1, evidence.pose),
          motion: score(1, evidence.pose),
          visibility: score(1, evidence.grounding),
          framing: score(1, evidence.grounding),
          technical: score(technical, evidence.technical),
        },
        eligibility: 'eligible',
        rejectionReasons: [],
        evidenceArtifactIds: [evidence.alignment, evidence.technical],
      };
    });
  });
  return {
    schemaVersion: 'nodevideo.choreography-analysis.v1',
    id: `analysis.${SONG_EDIT_CASE_ID}`,
    runId: `run.${SONG_EDIT_CASE_ID}`,
    traceId: `trace.${digest(inputHashes.reference).slice(0, 16)}`,
    createdAt: CREATED_AT,
    reference: {
      assetId: 'asset.choreography-reference',
      sha256: prefixed(inputHashes.reference),
      mimeType: 'video/mp4',
      usage: 'analysis-only',
      sourceRange: { startFrame: 0, endFrameExclusive: 180 },
      frameRate: FRAME_RATE,
      mirrorPolicy: 'as-recorded',
      evidenceArtifactIds: [evidence.pose],
    },
    song: {
      assetId: 'asset.music',
      sha256: prefixed(inputHashes.music),
      mimeType: 'audio/mp4',
      usage: 'render-source',
      excerpt: { startMs: 0, endMs: 6000 },
      license: { status: 'public-domain', proofRef: 'fixture.generated-by-nodevideo' },
      beatGrid: {
        bpm: 120,
        beatsMs: Array.from({ length: 12 }, (_, index) => index * 500),
        downbeatsMs: [0, 2000, 4000],
        evidenceArtifactId: evidence.beat,
      },
    },
    timedText: {
      assetId: 'asset.timed-text',
      sha256: prefixed(inputHashes.timedText),
      mimeType: 'application/json',
      usage: 'analysis-only',
      cueCount: timedTextCues.length,
      license: { status: 'public-domain', proofRef: 'fixture.generated-by-nodevideo' },
    },
    takes: [
      strictTake('take.a', 'asset.take-a', inputHashes.takeA, evidence.alignment),
      strictTake('take.b', 'asset.take-b', inputHashes.takeB, evidence.alignment),
    ],
    phrases: strictPhrases,
    candidates,
    captionLayouts: timedTextCues.map((cue, index) => ({
      id: `caption.${index + 1}`,
      phraseId: `phrase.${index + 1}`,
      timelineRange: { startMs: cue.startMs, endMs: cue.endMs },
      text: cue.text,
      lines: [cue.text],
      box: captionBox,
      templateId: 'text.cue',
      bodyOverlapRatio,
      faceOverlapRatio: 0,
      safeAreaEvidenceArtifactIds: [evidence.grounding],
      groundingResultId: 'grounding.primary-dancer',
    })),
    warnings: ['Replay mode validates orchestration without a model or GPU.'],
  };
}

function strictTake(id, assetId, sha256, alignmentEvidenceId) {
  return {
    id,
    assetId,
    sha256: prefixed(sha256),
    mimeType: 'video/mp4',
    usage: 'render-source',
    sourceRange: { startFrame: 0, endFrameExclusive: 180 },
    frameRate: FRAME_RATE,
    mirrorApplied: false,
    alignmentAnchors: [
      { referenceFrame: 0, takeFrame: 0, timelineMs: 0, evidenceArtifactId: alignmentEvidenceId },
      {
        referenceFrame: 179,
        takeFrame: 179,
        timelineMs: 5967,
        evidenceArtifactId: alignmentEvidenceId,
      },
    ],
    evidenceArtifactIds: [alignmentEvidenceId],
  };
}

function buildGroundingReceipt(referenceSha256) {
  return {
    schemaVersion: 'nodevideo.locate-result.v1',
    requestId: 'request.primary-dancer',
    traceId: `trace.${digest(referenceSha256).slice(0, 16)}`,
    assetId: 'asset.choreography-reference',
    provider: { id: 'provider.replay', implementation: 'replay' },
    status: 'valid',
    observations: [
      {
        id: 'grounding.primary-dancer',
        geometry: { kind: 'box', box: { x: 0.18, y: 0.17, width: 0.64, height: 0.72 } },
        label: 'primary dancer full body',
      },
    ],
  };
}

function buildSongPlan(understanding, editPlan, phrases, editPlanSha256) {
  return {
    schemaVersion: 'nodevideo.song-conditioned-plan.v1',
    id: `song-plan.${SONG_EDIT_CASE_ID}`,
    analysisId: understanding.id,
    runId: understanding.runId,
    traceId: understanding.traceId,
    createdAt: CREATED_AT,
    durationMs: 6000,
    selections: phrases.map((phrase, index) => ({
      phraseId: phrase.id,
      candidateId: `candidate.${index + 1}.${phrase.selectedTakeId === 'asset.take-a' ? 1 : 2}`,
      cutBeatIndex: index * 4 + 3,
      rationale: phrase.selectionReason,
      evidenceArtifactIds: ['evidence.sharpness-score', 'evidence.exact-fixture-alignment'],
    })),
    captionLayouts: understanding.captionLayouts,
    editPlanArtifactId: editPlan.id,
    editPlanSha256: prefixed(editPlanSha256),
  };
}

function buildGenerationReadLog(inputHashes) {
  return {
    schemaVersion: 'nodevideo.generation-read-log.v1',
    runId: `run.${SONG_EDIT_CASE_ID}`,
    createdAt: CREATED_AT,
    networkAccess: false,
    reads: [
      ['asset.choreography-reference', inputHashes.reference],
      ['asset.take-a', inputHashes.takeA],
      ['asset.take-b', inputHashes.takeB],
      ['asset.music', inputHashes.music],
      ['asset.timed-text', inputHashes.timedText],
    ].map(([assetId, sha256]) => ({ assetId, sha256: prefixed(sha256) })),
    targetAccess: 'denied',
  };
}

async function buildChoreographyFreeze({ inputHashes, paths, understanding }) {
  const inputDigest = digest(
    Object.entries(inputHashes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}:${value}`)
      .join('\n'),
  );
  return {
    schemaVersion: 'nodevideo.choreography-freeze.v1',
    id: `choreography-freeze.${SONG_EDIT_CASE_ID}`,
    analysisId: understanding.id,
    planArtifactId: `song-plan.${SONG_EDIT_CASE_ID}`,
    renderArtifactId: `render.${SONG_EDIT_CASE_ID}`,
    runId: understanding.runId,
    traceId: understanding.traceId,
    frozenAt: CREATED_AT,
    digests: {
      input: prefixed(inputDigest),
      analysis: prefixed(await sha256File(paths.understanding)),
      plan: prefixed(await sha256File(paths.songPlan)),
      render: prefixed(await sha256File(paths.preview)),
      generationReadLog: prefixed(await sha256File(paths.readLog)),
    },
    generationInputAssetIds: [
      'asset.choreography-reference',
      'asset.music',
      'asset.take-a',
      'asset.take-b',
      'asset.timed-text',
    ],
    evaluationOnlyAssetIds: ['asset.evaluator.synthetic-policy'],
    isolation: {
      generatorTargetAccess: 'denied',
      finalTargetMount: 'absent',
      evaluatorUnlock: 'after-freeze-verification',
    },
  };
}

function buildEditPlan(phrases, timedTextCues) {
  const videoClips = phrases.map((phrase, index) => ({
    id: `clip.phrase-${index + 1}`,
    kind: 'source',
    assetId: phrase.selectedTakeId,
    timelineRange: phrase.timelineRange,
    sourceRange: phrase.referenceRange,
    playbackRate: 1,
    fit: 'fit',
    cropKeyframes: [],
    grade: { kind: 'none' },
  }));
  return {
    schemaVersion: 'nodevideo.edit-plan.v1',
    id: `plan.${SONG_EDIT_CASE_ID}`,
    understandingId: `understanding.${SONG_EDIT_CASE_ID}`,
    version: 1,
    createdAt: CREATED_AT,
    frameRate: FRAME_RATE,
    canvas: { width: 360, height: 640 },
    durationFrames: DURATION_FRAMES,
    lineage: {
      renderAssetIds: ['asset.take-a', 'asset.take-b', 'asset.music'],
      evaluationOnlyAssetIds: [],
      targetDerivedRenderAssetIds: [],
    },
    audio: {
      routing: [
        {
          id: 'route.mute.take-a',
          sourceKind: 'asset-audio',
          sourceId: 'asset.take-a',
          bus: 'program',
          muted: true,
          gainDb: 0,
        },
        {
          id: 'route.mute.take-b',
          sourceKind: 'asset-audio',
          sourceId: 'asset.take-b',
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
      ],
      events: [
        {
          id: 'event.music',
          kind: 'music',
          clipId: 'clip.music',
          sourceOffsetMs: 0,
          releasedMasterOffsetMs: 0,
          releasedMasterGainDb: 0,
          targetStartMs: 0,
          targetEndMs: 6000,
          gainDb: 0,
          identity: { title: 'NodeVideo 120 BPM fixture', artist: 'NodeVideo' },
        },
      ],
    },
    beatGrid: beatGrid(),
    tracks: [
      { id: 'track.video.primary', kind: 'video', role: 'primary', clips: videoClips },
      {
        id: 'track.music',
        kind: 'audio',
        role: 'music',
        clips: [
          {
            id: 'clip.music',
            assetId: 'asset.music',
            timelineRange: { startFrame: 0, endFrameExclusive: DURATION_FRAMES },
            sourceRange: { startFrame: 0, endFrameExclusive: DURATION_FRAMES },
            playbackRate: 1,
            role: 'music',
            gainDb: 0,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            license: { status: 'public-domain', proofRef: 'fixture.generated-by-nodevideo' },
          },
        ],
      },
      {
        id: 'track.overlays',
        kind: 'overlay',
        clips: timedTextCues.map((cue, index) => ({
          id: `overlay.lyric-${index + 1}`,
          timelineRange: {
            startFrame: Math.round((cue.startMs * FRAME_RATE) / 1000),
            endFrameExclusive: Math.round((cue.endMs * FRAME_RATE) / 1000),
          },
          kind: 'text',
          text: cue.text,
          templateId: 'text.cue',
          box: { x: 0.1, y: 0.035, width: 0.8, height: 0.09 },
          animation: 'pop',
        })),
      },
    ],
  };
}

function beatGrid() {
  const beatsMs = Array.from({ length: 12 }, (_, index) => index * 500);
  return { bpm: 120, offsetMs: 0, beatsMs, downbeatsMs: [0, 2000, 4000], confidence: 1 };
}

async function evaluateReplay({ paths, plan, phrases }) {
  const probe = sanitizeProbe(probeMedia(paths.preview));
  const selected = phrases.map((phrase) => phrase.selectedTakeId);
  const assertions = [
    assertion(
      'plan duration is six seconds',
      plan.durationFrames === 180,
      plan.durationFrames,
      180,
    ),
    assertion(
      'each phrase has two candidates',
      phrases.every((phrase) => phrase.candidates.length === 2),
    ),
    assertion(
      'selection alternates A/B/A',
      selected.join(',') === 'asset.take-a,asset.take-b,asset.take-a',
      selected,
    ),
    assertion('preview has music', Boolean(probe.audio), Boolean(probe.audio), true),
    assertion(
      'preview is vertical',
      probe.video.codedWidth === 360 && probe.video.codedHeight === 640,
      `${probe.video.codedWidth}x${probe.video.codedHeight}`,
      '360x640',
    ),
  ];
  return {
    schemaVersion: 'nodevideo.song-conditioned-evaluator.v1',
    createdAt: CREATED_AT,
    freezeReceiptSha256: await sha256File(paths.freeze),
    targetComparison: 'not-run-no-held-out-target',
    tasteStatus: 'not-evaluated',
    passed: assertionsPass(assertions),
    assertions,
    claim:
      'Mechanics and isolation passed for a deterministic public replay; creative taste is not established.',
  };
}

async function buildManifest({ inputHashes, phrases, evaluation }) {
  const artifactPaths = Object.entries(SONG_REPLAY_ARTIFACT_FILES).map(([id, file]) => [
    id,
    join(SONG_EDIT_ROOT, file),
  ]);
  return {
    schemaVersion: 'nodevideo.song-conditioned-replay.v1',
    id: SONG_EDIT_CASE_ID,
    title: 'Song-conditioned choreography edit replay',
    generatorVersion: SONG_EDIT_VERSION,
    protocol: {
      targetMountedDuringGeneration: false,
      targetReadDuringGeneration: false,
      freezeBeforeEvaluation: true,
    },
    inputs: {
      originalChoreographyReference: true,
      creatorTakeCount: 2,
      chosenSongSegment: true,
      timedLyrics: true,
      sha256: inputHashes,
    },
    audio: {
      sourceAudioMuted: true,
      previewContainsChosenSong: true,
      license: 'public-domain-generated-fixture',
    },
    grounding: { provider: 'replay', locateAnythingOptional: true, confidenceInvented: false },
    selection: {
      phraseCount: phrases.length,
      selectedTakeIds: phrases.map((phrase) => phrase.selectedTakeId),
      takeSwitchCount: phrases
        .slice(1)
        .filter((phrase, index) => phrase.selectedTakeId !== phrases[index].selectedTakeId).length,
    },
    evaluation: { passed: evaluation.passed, tasteStatus: evaluation.tasteStatus },
    claimBoundary: {
      proven: [
        'Typed input-to-plan-to-render orchestration',
        'Beat-bound cuts, source-audio muting, body-safe captions, freeze-before-evaluation',
      ],
      notProven: [
        'General creative taste',
        'Performance on arbitrary human footage',
        'LocateAnything model accuracy',
      ],
    },
    artifacts: await Promise.all(
      artifactPaths.map(async ([id, path]) => ({
        id,
        file: basename(path),
        sha256: await sha256File(path),
      })),
    ),
  };
}

async function recordsFor(paths) {
  return Promise.all(
    paths.map(async (path) => ({ file: basename(path), sha256: await sha256File(path) })),
  );
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function prefixed(value) {
  return `sha256:${value}`;
}

function normalizedOverlapRatio(subject, occupied) {
  const left = Math.max(subject.x, occupied.x);
  const top = Math.max(subject.y, occupied.y);
  const right = Math.min(subject.x + subject.width, occupied.x + occupied.width);
  const bottom = Math.min(subject.y + subject.height, occupied.y + occupied.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return rounded(intersection / (subject.width * subject.height));
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

export function replayRelative(path) {
  return relative(REPO_ROOT, resolve(path));
}
