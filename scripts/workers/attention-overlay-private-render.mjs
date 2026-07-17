#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  probeMedia,
  rationalNumber,
  sanitizeProbe,
  sha256File,
  writeJson,
} from '../media/media-proof-lib.mjs';
import { renderEditPlan } from './edit-plan-renderer-lib.mjs';

const FRAME_RATE = 30;
const options = parseArguments(process.argv.slice(2));
const outputRoot = resolve(options.outputDirectory);
await mkdir(outputRoot, { recursive: true });
const paths = {
  basePlan: join(outputRoot, 'base-edit-plan.json'),
  plan: join(outputRoot, 'attention-edit-plan.json'),
  bindings: join(outputRoot, 'bindings.private.json'),
  planningReceipt: join(outputRoot, 'attention-overlay-plan-receipt.json'),
  rendererManifest: join(outputRoot, 'renderer-manifest.json'),
  audit: join(outputRoot, 'embodied-overlay-audit.json'),
  preview: join(outputRoot, 'attention-overlay-preview.mp4'),
  receipt: join(outputRoot, 'attention-overlay-pipeline-receipt.json'),
};

const probe = sanitizeProbe(probeMedia(options.video, options.ffprobe));
if (!probe.video || !probe.format.durationSeconds) throw new Error('Input must be a probed video.');
const canvas = deliveryCanvas(probe.video, options.canvasMode);
const gradeKind = resolveGradeKind(options.gradeKind, probe.video);
const sourceRate =
  rationalNumber(probe.video.averageFrameRate) ??
  rationalNumber(probe.video.nominalFrameRate) ??
  30;
const availableDuration = probe.format.durationSeconds - options.sourceStartSeconds;
const durationSeconds = options.durationSeconds ?? availableDuration;
if (durationSeconds <= 0 || durationSeconds > availableDuration + 1 / sourceRate) {
  throw new Error('Requested source interval is outside the video.');
}
const durationFrames = Math.round(durationSeconds * FRAME_RATE);
const sourceStartFrame = Math.round(options.sourceStartSeconds * FRAME_RATE);
const sourceEndFrame = sourceStartFrame + durationFrames;
const assetId = 'asset.video';
const basePlan = {
  schemaVersion: 'nodevideo.edit-plan.v1',
  id: `plan.${options.runId}`,
  understandingId: `understanding.${options.runId}`,
  version: 1,
  createdAt: new Date().toISOString(),
  frameRate: FRAME_RATE,
  canvas,
  durationFrames,
  lineage: {
    renderAssetIds: [assetId],
    evaluationOnlyAssetIds: [],
    targetDerivedRenderAssetIds: [],
  },
  audio: {
    routing: [
      {
        id: 'route.source-audio',
        sourceKind: 'asset-audio',
        sourceId: assetId,
        bus: 'program',
        muted: !probe.audio,
        gainDb: 0,
      },
    ],
    events: [],
  },
  tracks: [
    {
      id: 'track.video.primary',
      kind: 'video',
      role: 'primary',
      clips: [
        {
          id: 'clip.video',
          kind: 'source',
          assetId,
          timelineRange: { startFrame: 0, endFrameExclusive: durationFrames },
          sourceRange: { startFrame: sourceStartFrame, endFrameExclusive: sourceEndFrame },
          playbackRate: 1,
          fit: options.fit,
          cropKeyframes: [],
          grade: { kind: gradeKind },
        },
      ],
    },
    { id: 'track.overlays', kind: 'overlay', clips: [] },
  ],
};
await Promise.all([
  writeJson(paths.basePlan, basePlan),
  writeJson(paths.bindings, { [assetId]: options.video }),
]);

runPython(options.python, resolve('scripts/analysis/plan_attention_overlays.py'), [
  '--plan',
  paths.basePlan,
  '--cues',
  options.cues,
  '--pose',
  `${assetId}=${options.pose}`,
  '--source-size',
  `${assetId}=${probe.video.codedWidth}x${probe.video.codedHeight}`,
  '--output-plan',
  paths.plan,
  '--receipt',
  paths.planningReceipt,
  '--max-overlap-ratio',
  String(options.maxOverlapRatio),
]);

const plan = JSON.parse(await readFile(paths.plan, 'utf8'));
const renderResult = await renderEditPlan({
  plan,
  bindings: { [assetId]: options.video },
  outputPath: paths.preview,
  auxiliaryDirectory: join(outputRoot, '.render-work'),
  ffmpeg: options.ffmpeg,
});
await writeJson(paths.rendererManifest, renderResult.manifest);
runPython(options.python, resolve('scripts/analysis/audit_overlay_body_clearance.py'), [
  '--plan',
  paths.plan,
  '--renderer-manifest',
  paths.rendererManifest,
  '--pose',
  `${assetId}=${options.pose}`,
  '--source-size',
  `${assetId}=${probe.video.codedWidth}x${probe.video.codedHeight}`,
  '--output',
  paths.audit,
  '--max-overlap-ratio',
  String(options.maxOverlapRatio),
]);
const audit = JSON.parse(await readFile(paths.audit, 'utf8'));
if (audit.status !== 'pass' || audit.score !== 1) {
  throw new Error(`Rendered overlay audit failed with score ${audit.score}.`);
}
const receipt = {
  schemaVersion: 'nodevideo.attention-overlay-pipeline-receipt.v1',
  id: options.runId,
  status: 'pass',
  input: {
    videoFile: basename(options.video),
    videoSha256: await sha256File(options.video),
    poseSha256: await sha256File(options.pose),
    timedTextSha256: await sha256File(options.cues),
  },
  delivery: {
    gradeKind,
    requestedGradeKind: options.gradeKind,
    canvas,
    audioPreserved: Boolean(probe.audio),
    outputSha256: await sha256File(paths.preview),
  },
  bodySafety: {
    status: audit.status,
    score: audit.score,
    maxObservedOverlapRatio: Math.max(...audit.overlays.map((item) => item.maxBodyOverlapRatio)),
  },
  artifacts: Object.fromEntries(
    await Promise.all(
      Object.entries(paths)
        .filter(([key]) => key !== 'receipt')
        .map(async ([key, path]) => [
          key,
          { file: basename(path), sha256: await sha256File(path) },
        ]),
    ),
  ),
};
await writeJson(paths.receipt, receipt);
console.log(`Rendered ${paths.preview}`);
console.log(`Body-safe overlays passed at ${receipt.bodySafety.maxObservedOverlapRatio}.`);

function runPython(command, script, args) {
  execFileSync(command, [script, ...args], { stdio: 'inherit' });
}

function parseArguments(args) {
  const allowed = new Set([
    '--video',
    '--pose',
    '--cues',
    '--output-dir',
    '--run-id',
    '--source-start-seconds',
    '--duration-seconds',
    '--grade-kind',
    '--canvas-mode',
    '--fit',
    '--max-overlap-ratio',
    '--python',
    '--ffmpeg',
    '--ffprobe',
  ]);
  for (const value of args) {
    if (value.startsWith('--') && !allowed.has(value)) throw new Error(`Unknown option: ${value}`);
  }
  const gradeKind = optionalValue(args, '--grade-kind') ?? 'auto';
  const supportedGrades = new Set([
    'auto',
    'none',
    'hlg-bt2020-to-sdr-bt709-hable',
    'hlg-bt2020-to-sdr-bt709-creator-vibrant',
    'hlg-bt2020-to-sdr-bt709-creator-dark-warm',
    'hlg-bt2020-to-sdr-bt709-creator-social-vivid',
  ]);
  if (!supportedGrades.has(gradeKind)) throw new Error('--grade-kind is unsupported.');
  const fit = optionalValue(args, '--fit') ?? 'fit';
  if (!['fit', 'fill'].includes(fit)) throw new Error('--fit must be fit or fill.');
  const canvasMode = optionalValue(args, '--canvas-mode') ?? 'source';
  if (!['source', 'vertical'].includes(canvasMode)) {
    throw new Error('--canvas-mode must be source or vertical.');
  }
  return {
    video: resolve(requiredValue(args, '--video')),
    pose: resolve(requiredValue(args, '--pose')),
    cues: resolve(requiredValue(args, '--cues')),
    outputDirectory: requiredValue(args, '--output-dir'),
    runId: optionalValue(args, '--run-id') ?? 'attention-overlay-v1',
    sourceStartSeconds: numberValue(args, '--source-start-seconds', 0),
    durationSeconds: optionalNumberValue(args, '--duration-seconds'),
    gradeKind,
    canvasMode,
    fit,
    maxOverlapRatio: numberValue(args, '--max-overlap-ratio', 0.05),
    python: optionalValue(args, '--python') ?? 'python',
    ffmpeg: optionalValue(args, '--ffmpeg') ?? 'ffmpeg',
    ffprobe: optionalValue(args, '--ffprobe') ?? 'ffprobe',
  };
}

function deliveryCanvas(video, mode) {
  if (mode === 'vertical') return { width: 720, height: 1280 };
  const sourceWidth = video.codedWidth;
  const sourceHeight = video.codedHeight;
  const scale = Math.min(1, 1280 / Math.max(sourceWidth, sourceHeight));
  return {
    width: evenDimension(sourceWidth * scale),
    height: evenDimension(sourceHeight * scale),
  };
}

function evenDimension(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function resolveGradeKind(requested, video) {
  if (requested !== 'auto') return requested;
  const isHlg = video.colorTransfer === 'arib-std-b67';
  const isBt2020 = video.colorSpace === 'bt2020nc' || video.colorPrimaries === 'bt2020';
  return isHlg || isBt2020 ? 'hlg-bt2020-to-sdr-bt709-hable' : 'none';
}

function requiredValue(args, name) {
  const value = optionalValue(args, name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function optionalValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function optionalNumberValue(args, name) {
  const value = optionalValue(args, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be positive.`);
  return number;
}

function numberValue(args, name, fallback) {
  const value = optionalValue(args, name);
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be non-negative.`);
  return number;
}
