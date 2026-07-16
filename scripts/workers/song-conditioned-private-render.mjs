#!/usr/bin/env node

import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import {
  PRIVATE_EVIDENCE_ROOT,
  assertion,
  assertionsPass,
  probeMedia,
  requireFile,
  sanitizeProbe,
  sha256File,
  writeJson,
} from '../media/media-proof-lib.mjs';
import { renderEditPlan } from './edit-plan-renderer-lib.mjs';

const FRAME_RATE = 30;
const CANVAS = { width: 720, height: 1280 };
const VERSION = 'nodevideo.song-conditioned-private-render@0.1.0';

const options = parseArguments(process.argv.slice(2));
const analysis = JSON.parse(await readFile(options.analysis, 'utf8'));
validateAnalysis(analysis, options);
const outputRoot = resolve(options.outputDirectory);
assertPrivateOutputRoot(outputRoot);
await mkdir(outputRoot, { recursive: true });
const paths = {
  analysis: join(outputRoot, 'analysis.json'),
  plan: join(outputRoot, 'edit-plan.json'),
  bindings: join(outputRoot, 'bindings.private.json'),
  preview: join(outputRoot, 'source-only-song-preview.mp4'),
  manifest: join(outputRoot, 'generation-manifest.json'),
  freeze: join(outputRoot, 'freeze-receipt.json'),
};

const musicProbe = sanitizeProbe(probeMedia(options.music));
const planDurationFrames = Math.round(options.outputDurationSeconds * FRAME_RATE);
const choreographyEndFrame = Math.round(analysis.phrases.at(-1).timelineEndSeconds * FRAME_RATE);
if (choreographyEndFrame >= planDurationFrames) {
  throw new Error(
    'Output duration must leave at least one frame for the deterministic outro freeze.',
  );
}
const availableMusicFrames = Math.floor(musicProbe.audio.durationSeconds * FRAME_RATE + 0.0001);
const musicEndFrame = Math.min(planDurationFrames, availableMusicFrames);
const createdAt = new Date().toISOString();
const plan = buildPlan({
  analysis,
  choreographyEndFrame,
  createdAt,
  musicEndFrame,
  options,
  planDurationFrames,
});
const bindings = Object.fromEntries([...options.takes.entries(), ['asset.music', options.music]]);

await Promise.all([
  copyFile(options.analysis, paths.analysis),
  writeJson(paths.plan, plan),
  writeJson(paths.bindings, bindings),
]);
await renderEditPlan({
  plan,
  bindings,
  outputPath: paths.preview,
  auxiliaryDirectory: join(outputRoot, '.render-work'),
  ffmpeg: options.ffmpeg,
});

const previewProbe = sanitizeProbe(probeMedia(paths.preview));
const assertions = validateRender({
  analysis,
  plan,
  previewProbe,
  choreographyEndFrame,
  musicEndFrame,
});
if (!assertionsPass(assertions)) {
  throw new Error(
    assertions
      .filter((item) => !item.pass)
      .map((item) => item.name)
      .join(', '),
  );
}

const inputRecords = [
  {
    assetId: 'asset.choreography-reference-pose',
    role: 'analysis-only-reference',
    sha256: analysis.reference.sha256,
  },
  ...(await Promise.all(
    [...options.takes.entries()].map(async ([assetId, path]) => ({
      assetId,
      role: 'render-source',
      sha256: await sha256File(path),
    })),
  )),
  { assetId: 'asset.music', role: 'render-music', sha256: await sha256File(options.music) },
];
const manifest = {
  schemaVersion: 'nodevideo.song-conditioned-generation-manifest.v1',
  id: options.runId,
  createdAt,
  generatorVersion: VERSION,
  mode:
    options.musicLicenseStatus === 'target-derived-authorized'
      ? 'target-picture-isolated-target-audio-oracle'
      : 'song-conditioned-source-only',
  inputs: inputRecords,
  decisions: {
    phraseBoundariesSeconds: analysis.phrases.map((phrase) => phrase.timelineEndSeconds),
    selectedTakeAssetIds: analysis.phrases.map((phrase) => phrase.selectedTakeAssetId),
    beatTemplateId: analysis.tasteTemplate.id,
    cameraAudioMuted: true,
    bodySafeLyrics: analysis.lyricCues.length,
    outroTextSource: options.outroText ? 'creator-brief' : 'absent',
  },
  isolation: {
    level: 'audited-input-allowlist',
    finishedEditAcceptedByCli: false,
    ...(options.musicLicenseStatus === 'target-derived-authorized'
      ? {
          targetPictureMountedDuringGeneration: false,
          targetPictureReadDuringGeneration: false,
          targetPlanReadDuringGeneration: false,
        }
      : {
          forbiddenMediaMountedDuringGeneration: false,
          forbiddenMediaReadDuringGeneration: false,
          forbiddenPlanReadDuringGeneration: false,
        }),
    ...(options.musicLicenseStatus === 'target-derived-authorized'
      ? {
          targetAudioOracle: {
            used: true,
            proofRef: options.musicProofRef,
            limitation:
              'This run tests picture planning against the exact user-authorized soundtrack; it does not prove song or excerpt selection.',
          },
        }
      : {}),
  },
  render: {
    file: basename(paths.preview),
    sha256: await sha256File(paths.preview),
    durationSeconds: previewProbe.format.durationSeconds,
    width: previewProbe.video.codedWidth,
    height: previewProbe.video.codedHeight,
    hasAudio: Boolean(previewProbe.audio),
  },
  assertions,
  claimBoundary: {
    proven: [
      'The generator CLI accepts no final target picture or target plan; its read log is an audited allowlist, not an OS sandbox.',
      'Pose alignment, beat-count phrasing, take contrast, source-audio muting, typed planning, and rendering completed.',
    ],
    notProven: [
      'Independent choreography-reference fidelity for this case.',
      'Autonomous song or excerpt selection when target-derived authorized audio is used.',
      'General creative taste or blinded human preference.',
    ],
  },
};
await writeJson(paths.manifest, manifest);

const frozen = await Promise.all(
  [paths.analysis, paths.plan, paths.manifest, paths.preview].map(async (path) => ({
    file: basename(path),
    sha256: await sha256File(path),
  })),
);
const freeze = {
  schemaVersion: 'nodevideo.generation-freeze.v1',
  id: `freeze.${options.runId}`,
  createdAt: new Date().toISOString(),
  generatorVersion: VERSION,
  targetMountedDuringGeneration: false,
  targetReadDuringGeneration: false,
  ...(options.musicLicenseStatus === 'target-derived-authorized'
    ? { targetPlanReadDuringGeneration: false }
    : {}),
  isolationLevel: 'audited-input-allowlist',
  files: frozen,
};
await writeJson(paths.freeze, freeze);
console.log(`Rendered ${paths.preview}`);
console.log(`Frozen ${frozen.length} generation artifacts before evaluator access.`);

function buildPlan({
  analysis,
  choreographyEndFrame,
  createdAt,
  musicEndFrame,
  options,
  planDurationFrames,
}) {
  const videoClips = analysis.phrases.map((phrase, index) => {
    const timelineStart = index === 0 ? 0 : Math.round(phrase.timelineStartSeconds * FRAME_RATE);
    const timelineEnd = Math.round(phrase.timelineEndSeconds * FRAME_RATE);
    const selected = phrase.candidates.find(
      (candidate) => candidate.takeAssetId === phrase.selectedTakeAssetId,
    );
    if (!selected) throw new Error(`${phrase.id} does not contain its selected take candidate.`);
    const sourceStart = Math.round(selected.sourceStartSeconds * FRAME_RATE);
    return {
      id: `clip.${phrase.id}`,
      kind: 'source',
      assetId: phrase.selectedTakeAssetId,
      timelineRange: { startFrame: timelineStart, endFrameExclusive: timelineEnd },
      sourceRange: {
        startFrame: sourceStart,
        endFrameExclusive: sourceStart + timelineEnd - timelineStart,
      },
      playbackRate: 1,
      fit: phrase.framingTemplate ?? 'fit',
      cropKeyframes: [],
      grade: { kind: 'hlg-bt2020-to-sdr-bt709-hable' },
    };
  });
  const outroSourceFrame = videoClips.at(-1).sourceRange.endFrameExclusive - 1;
  const terminalTransitionFrames = analysis.tasteTemplate?.terminalTransitionFrames ?? 0;
  if (terminalTransitionFrames > 0) {
    videoClips.push({
      id: 'clip.terminal-transition',
      kind: 'black',
      timelineRange: {
        startFrame: choreographyEndFrame,
        endFrameExclusive: choreographyEndFrame + terminalTransitionFrames,
      },
    });
  }
  const freezeStartFrame = choreographyEndFrame + terminalTransitionFrames;
  videoClips.push({
    id: 'clip.outro-freeze',
    kind: 'freeze',
    assetId: analysis.phrases.at(-1).selectedTakeAssetId,
    timelineRange: { startFrame: freezeStartFrame, endFrameExclusive: planDurationFrames },
    sourceFrame: outroSourceFrame,
    fit: 'fit',
    cropKeyframes: [],
    grade: { kind: 'hlg-bt2020-to-sdr-bt709-hable' },
  });

  const overlays = analysis.lyricCues.map((cue, index) => {
    const phrase = analysis.phrases.find(
      (item) =>
        cue.startSeconds >= item.timelineStartSeconds && cue.startSeconds < item.timelineEndSeconds,
    );
    return {
      id: `overlay.lyric-${index + 1}`,
      timelineRange: {
        startFrame: Math.round(cue.startSeconds * FRAME_RATE),
        endFrameExclusive: Math.round(cue.endSeconds * FRAME_RATE),
      },
      kind: 'text',
      text: cue.text,
      templateId: 'text.cue',
      box: phrase?.captionSafeZone ?? { x: 0.1, y: 0.04, width: 0.8, height: 0.075 },
      animation: 'pop',
    };
  });
  if (options.outroText) {
    overlays.push({
      id: 'overlay.outro',
      timelineRange: { startFrame: freezeStartFrame, endFrameExclusive: planDurationFrames },
      kind: 'text',
      text: options.outroText,
      templateId: 'text.outro',
      box: { x: 0.14, y: 0.12, width: 0.72, height: 0.08 },
      animation: 'fade',
    });
  }

  const renderedTakeIds = [
    ...new Set(analysis.phrases.map((phrase) => phrase.selectedTakeAssetId)),
  ];
  const targetDerived =
    options.musicLicenseStatus === 'target-derived-authorized' ? ['asset.music'] : [];
  const musicEndMs = (musicEndFrame / FRAME_RATE) * 1000;
  const planEndMs = (planDurationFrames / FRAME_RATE) * 1000;
  return {
    schemaVersion: 'nodevideo.edit-plan.v1',
    id: `plan.${options.runId}`,
    understandingId: `understanding.${options.runId}`,
    version: 1,
    createdAt,
    frameRate: FRAME_RATE,
    canvas: CANVAS,
    durationFrames: planDurationFrames,
    lineage: {
      renderAssetIds: [...renderedTakeIds, 'asset.music'],
      evaluationOnlyAssetIds: [],
      targetDerivedRenderAssetIds: targetDerived,
    },
    audio: {
      routing: [
        ...renderedTakeIds.map((assetId) => ({
          id: `route.mute.${assetId}`,
          sourceKind: 'asset-audio',
          sourceId: assetId,
          bus: 'program',
          muted: true,
          gainDb: 0,
        })),
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
          releasedMasterOffsetMs: options.releasedMasterOffsetMs,
          releasedMasterGainDb: 0,
          targetStartMs: 0,
          targetEndMs: musicEndMs,
          gainDb: 0,
          identity: { title: options.musicTitle, artist: options.musicArtist },
        },
        ...(musicEndFrame < planDurationFrames
          ? [
              {
                id: 'event.silence',
                kind: 'silence',
                targetStartMs: musicEndMs,
                targetEndMs: planEndMs,
              },
            ]
          : []),
      ],
    },
    beatGrid: analysis.music.beatGrid,
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
            timelineRange: { startFrame: 0, endFrameExclusive: musicEndFrame },
            sourceRange: { startFrame: 0, endFrameExclusive: musicEndFrame },
            playbackRate: 1,
            role: 'music',
            gainDb: 0,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            license: { status: options.musicLicenseStatus, proofRef: options.musicProofRef },
          },
        ],
      },
      { id: 'track.overlays', kind: 'overlay', clips: overlays },
    ],
  };
}

function validateAnalysis(analysis, options) {
  const isolation = analysis.generationIsolation ?? analysis.targetIsolation;
  if (
    analysis.schemaVersion !== 'nodevideo.song-choreography-analysis.v1' ||
    analysis.mode !== 'song-conditioned-source-only' ||
    isolation?.finishedEditAcceptedAsInput !== false ||
    (isolation.finishedEditPictureRead ?? isolation.targetPictureRead) !== false ||
    (isolation.finishedEditPlanRead ?? isolation.targetPlanRead) !== false
  ) {
    throw new Error('Analysis does not satisfy the source-only contract.');
  }
  if (!Array.isArray(analysis.phrases) || analysis.phrases.length < 2) {
    throw new Error('Analysis must include at least two complete phrases.');
  }
  for (const phrase of analysis.phrases) {
    if (!options.takes.has(phrase.selectedTakeAssetId)) {
      throw new Error(`Missing render binding for ${phrase.selectedTakeAssetId}.`);
    }
  }
}

function validateRender({ analysis, plan, previewProbe, choreographyEndFrame, musicEndFrame }) {
  const primary = plan.tracks.find((track) => track.kind === 'video' && track.role === 'primary');
  return [
    assertion(
      'preview duration matches plan',
      Math.abs(previewProbe.format.durationSeconds - plan.durationFrames / FRAME_RATE) <=
        1 / FRAME_RATE,
      previewProbe.format.durationSeconds,
      plan.durationFrames / FRAME_RATE,
    ),
    assertion(
      'preview is 720x1280',
      previewProbe.video.codedWidth === 720 && previewProbe.video.codedHeight === 1280,
      `${previewProbe.video.codedWidth}x${previewProbe.video.codedHeight}`,
      '720x1280',
    ),
    assertion(
      'preview has chosen audio',
      Boolean(previewProbe.audio),
      Boolean(previewProbe.audio),
      true,
    ),
    assertion(
      'globally planned choreography phrases compile',
      analysis.phrases.length >= 2 &&
        analysis.tasteTemplate?.planner === 'deterministic-dynamic-programming-beam-search',
      analysis.phrases.length,
      'at least 2 phrases from the global planner',
    ),
    assertion(
      'every interior cut carries source-only decision evidence',
      analysis.phrases
        .slice(0, -1)
        .every((phrase) => phrase.outBoundaryDecision?.evidence?.length > 0),
    ),
    assertion(
      'outro freezes after choreography',
      primary.clips.at(-1).kind === 'freeze' &&
        primary.clips.at(-1).timelineRange.startFrame ===
          choreographyEndFrame + (analysis.tasteTemplate?.terminalTransitionFrames ?? 0),
    ),
    assertion(
      'camera audio is muted',
      plan.audio.routing
        .filter((route) => route.sourceKind === 'asset-audio')
        .every((route) => route.muted),
    ),
    assertion(
      'music precedes planned silence',
      musicEndFrame <= plan.durationFrames,
      musicEndFrame,
      plan.durationFrames,
    ),
  ];
}

function parseArguments(args) {
  const allowed = new Set([
    '--analysis',
    '--take',
    '--music',
    '--output-dir',
    '--run-id',
    '--output-duration-seconds',
    '--outro-text',
    '--music-license-status',
    '--music-proof-ref',
    '--music-title',
    '--music-artist',
    '--released-master-offset-ms',
    '--ffmpeg',
  ]);
  for (const value of args) {
    if (value.startsWith('--') && !allowed.has(value)) throw new Error(`Unknown option: ${value}`);
  }
  const takes = new Map();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--take') continue;
    const value = args[index + 1];
    if (!value?.includes('=')) throw new Error('--take requires asset.take-*=path');
    const [assetId, ...pathParts] = value.split('=');
    if (!/^asset\.take-[a-z0-9-]+$/.test(assetId) || takes.has(assetId)) {
      throw new Error(`Invalid or duplicate take asset ID: ${assetId}`);
    }
    const path = resolve(pathParts.join('='));
    requireFile(path, assetId);
    takes.set(assetId, path);
  }
  if (takes.size < 2) throw new Error('At least two --take bindings are required.');
  const musicLicenseStatus = value(args, '--music-license-status');
  if (
    ![
      'owned',
      'licensed',
      'public-domain',
      'reference-only-private',
      'target-derived-authorized',
    ].includes(musicLicenseStatus)
  ) {
    throw new Error('--music-license-status is unsupported.');
  }
  const analysis = resolve(value(args, '--analysis'));
  const music = resolve(value(args, '--music'));
  requireFile(analysis, 'source-only analysis');
  requireFile(music, 'chosen music');
  return {
    analysis,
    takes,
    music,
    outputDirectory: value(args, '--output-dir'),
    runId: optionalValue(args, '--run-id') ?? 'song-conditioned-private-v1',
    outputDurationSeconds: numberValue(args, '--output-duration-seconds', 44.5),
    outroText: optionalValue(args, '--outro-text'),
    musicLicenseStatus,
    musicProofRef: value(args, '--music-proof-ref'),
    musicTitle: value(args, '--music-title'),
    musicArtist: value(args, '--music-artist'),
    releasedMasterOffsetMs: numberValue(args, '--released-master-offset-ms', 0),
    ffmpeg: optionalValue(args, '--ffmpeg') ?? 'ffmpeg',
  };
}

function value(args, name) {
  const result = optionalValue(args, name);
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function optionalValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const result = args[index + 1];
  if (!result || result.startsWith('--')) throw new Error(`${name} requires a value.`);
  return result;
}

function numberValue(args, name, fallback) {
  const raw = optionalValue(args, name);
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`${name} must be a non-negative number.`);
  return parsed;
}

function assertPrivateOutputRoot(outputRoot) {
  const relativePath = relative(PRIVATE_EVIDENCE_ROOT, outputRoot);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`--output-dir must be a child of ${PRIVATE_EVIDENCE_ROOT}.`);
  }
}
