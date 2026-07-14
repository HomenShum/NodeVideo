import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import {
  PRIVATE_EVIDENCE_ROOT,
  REPO_ROOT,
  assertion,
  assertionsPass,
  ffmpegVersion,
  ffprobeVersion,
  near,
  probeMedia,
  rationalNumber,
  readRgbFrames,
  requireFile,
  runBinary,
  runText,
  sanitizeProbe,
  sha256File,
  writeJson,
} from '../media/media-proof-lib.mjs';

export const WORKER_VERSION = 'tutorial-compare-worker@0.1.0';
export const PUBLIC_FIXTURE_ID = 'tutorial-compare-public-v1';
export const PUBLIC_FIXTURE_ROOT = join(REPO_ROOT, 'fixtures', 'media', 'tutorial-compare-v1');

const FRAME_RATE = 30;
const NORMALIZED_WIDTH = 360;
const NORMALIZED_HEIGHT = 640;
const ANALYSIS_WIDTH = 180;
const ANALYSIS_HEIGHT = 320;
const TOOL_VERSIONS = {
  'media.normalize': 'ffmpeg-normalize@1.0.0',
  'audio.beat_map': 'pcm-onset@1.0.0',
  'pose.extract': 'known-marker-pose@1.0.0',
  'tutorial.align': 'onset-offset@1.0.0',
  'tutorial.diff': 'landmark-diff@1.0.0',
  'render.comparison': 'ffmpeg-comparison@1.0.0',
  'result.validate': 'nodevideo-worker-validator@1.0.0',
};

const MARKERS = {
  head: ([red, green, blue]) => red > 175 && blue > 125 && green < 150,
  leftWrist: ([red, green, blue]) => red < 150 && green > 140 && blue > 145,
  rightWrist: ([red, green, blue]) => red > 165 && green > 150 && blue < 145,
  hip: ([red, green, blue]) => red < 150 && green > 140 && blue < 155,
  leftFoot: ([red, green, blue]) => red > 165 && green < 145 && blue < 145,
  rightFoot: ([red, green, blue]) => red < 145 && green < 175 && blue > 150,
};

export async function generatePublicSourcePair({ ffmpeg = 'ffmpeg' } = {}) {
  await mkdir(PUBLIC_FIXTURE_ROOT, { recursive: true });
  const reference = join(PUBLIC_FIXTURE_ROOT, 'source-reference.mp4');
  const attempt = join(PUBLIC_FIXTURE_ROOT, 'source-attempt.mp4');
  createPublicSource(reference, 'reference', ffmpeg);
  createPublicSource(attempt, 'attempt', ffmpeg);
  return { reference, attempt };
}

export async function runTutorialCompare({
  referencePath,
  attemptPath,
  outputRoot,
  boundary,
  onEvent,
  ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg',
  ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe',
}) {
  const startedAt = new Date().toISOString();
  const executionRoot = assertExecutionRoot(outputRoot, boundary);
  requireFile(referencePath, 'reference input');
  requireFile(attemptPath, 'attempt input');
  await mkdir(executionRoot, { recursive: true });

  const sourceClass = boundary === 'public-worker' ? 'public-fixture' : 'private-user-media';
  const ids = {
    projectId: boundary === 'public-worker' ? 'project.public-worker-v1' : 'project.private-local',
    runId: `run.${digestText(`${await sha256File(referencePath)}:${await sha256File(attemptPath)}`).slice(0, 16)}`,
    traceId: `trace.${digestText(`${WORKER_VERSION}:${boundary}`).slice(0, 16)}`,
    referenceAssetId: 'asset.reference',
    attemptAssetId: 'asset.attempt',
  };
  const sourceAssets = [
    {
      assetId: ids.referenceAssetId,
      sha256: await sha256File(referencePath),
      sourceClass,
    },
    {
      assetId: ids.attemptAssetId,
      sha256: await sha256File(attemptPath),
      sourceClass,
    },
  ];
  const state = createExecutionState(ids, startedAt, onEvent);
  state.root.startedAt = startedAt;
  state.emit('job.queued', 'queued', 0, 'tutorial_compare queued');

  const normalizedReference = join(executionRoot, 'reference-normalized.mp4');
  const normalizedAttempt = join(executionRoot, 'attempt-normalized.mp4');
  const sideBySidePath = join(executionRoot, 'comparison-side-by-side.mp4');
  const differencePath = join(executionRoot, 'comparison-difference.mp4');
  const burstPath = join(executionRoot, 'critical-moments.jpg');
  const resultPath = join(executionRoot, 'result.json');
  const receiptPath = join(executionRoot, 'receipt.json');

  const referenceProbe = sanitizeProbe(probeMedia(referencePath, ffprobe));
  const attemptProbe = sanitizeProbe(probeMedia(attemptPath, ffprobe));

  await state.step({
    id: 'normalize.reference',
    name: 'normalize_reference',
    stage: 'normalizing',
    toolId: 'media.normalize',
    progress: 1,
    inputHashes: [sourceAssets[0].sha256],
    run: () => normalizeMedia(referencePath, normalizedReference, referenceProbe, { ffmpeg }),
  });
  await state.step({
    id: 'normalize.attempt',
    name: 'normalize_attempt',
    stage: 'normalizing',
    toolId: 'media.normalize',
    progress: 2,
    inputHashes: [sourceAssets[1].sha256],
    run: () => normalizeMedia(attemptPath, normalizedAttempt, attemptProbe, { ffmpeg }),
  });

  const normalized = {
    reference: sanitizeProbe(probeMedia(normalizedReference, ffprobe)),
    attempt: sanitizeProbe(probeMedia(normalizedAttempt, ffprobe)),
  };
  const normalizedHashes = {
    reference: await sha256File(normalizedReference),
    attempt: await sha256File(normalizedAttempt),
  };

  const beatMap = await state.step({
    id: 'audio.beat-map',
    name: 'map_audio',
    stage: 'mapping_audio',
    toolId: 'audio.beat_map',
    progress: 3,
    inputHashes: Object.values(normalizedHashes),
    run: () => analyzeBeatMap(normalizedReference, normalizedAttempt, { ffmpeg }),
  });

  const poseTracks = await state.step({
    id: 'pose.extract',
    name: 'extract_pose',
    stage: 'extracting_pose',
    toolId: 'pose.extract',
    progress: 4,
    inputHashes: Object.values(normalizedHashes),
    run: () =>
      extractKnownMarkerPose(normalizedReference, normalizedAttempt, normalized, { ffmpeg }),
  });

  const alignment = await state.step({
    id: 'tutorial.align',
    name: 'align_tutorial',
    stage: 'aligning',
    toolId: 'tutorial.align',
    progress: 5,
    inputHashes: Object.values(normalizedHashes),
    run: () => alignTutorial(beatMap, poseTracks),
  });

  const diff = await state.step({
    id: 'tutorial.diff',
    name: 'compute_diffs',
    stage: 'computing_diffs',
    toolId: 'tutorial.diff',
    progress: 6,
    inputHashes: Object.values(normalizedHashes),
    run: () => computeDifferences(poseTracks, alignment, beatMap),
  });

  await state.step({
    id: 'render.side-by-side',
    name: 'render_side_by_side',
    stage: 'rendering',
    toolId: 'render.comparison',
    progress: 7,
    inputHashes: Object.values(normalizedHashes),
    run: () =>
      renderSideBySide(normalizedReference, normalizedAttempt, sideBySidePath, alignment.offsetMs, {
        ffmpeg,
      }),
  });
  await state.step({
    id: 'render.difference',
    name: 'render_difference',
    stage: 'rendering',
    toolId: 'render.comparison',
    progress: 8,
    inputHashes: Object.values(normalizedHashes),
    run: () =>
      renderDifference(normalizedReference, normalizedAttempt, differencePath, alignment.offsetMs, {
        ffmpeg,
      }),
  });

  const bursts = await state.step({
    id: 'render.bursts',
    name: 'render_critical_bursts',
    stage: 'rendering',
    toolId: 'render.comparison',
    progress: 9,
    inputHashes: Object.values(normalizedHashes),
    run: () =>
      renderCriticalBursts({
        referencePath: normalizedReference,
        attemptPath: normalizedAttempt,
        outputPath: burstPath,
        criticalMoments: diff.criticalMoments,
        sourceAssets,
        createdAt: startedAt,
        ffmpeg,
      }),
  });

  const rendered = {
    sideBySide: await mediaRecord(sideBySidePath, executionRoot, ffprobe),
    difference: await mediaRecord(differencePath, executionRoot, ffprobe),
    bursts: await fileRecord(burstPath, executionRoot),
  };
  const result = buildResult({
    ids,
    sourceAssets,
    beatMap,
    alignment,
    diff,
    bursts,
    createdAt: startedAt,
  });

  const validation = await state.step({
    id: 'result.validate',
    name: 'validate_result',
    stage: 'validating',
    toolId: 'result.validate',
    progress: 10,
    inputHashes: [rendered.sideBySide.sha256, rendered.difference.sha256, rendered.bursts.sha256],
    run: () => validateWorkerResult({ result, rendered, normalized, alignment }),
  });
  result.validation = validation.resultValidation;
  result.status = validation.passed ? 'completed' : 'failed';
  if (!validation.passed) {
    result.failures.push({
      stage: 'validating',
      toolId: 'result.validate',
      classification: 'insufficient-evidence',
      recoverable: true,
      message: 'One or more deterministic worker validations failed.',
      limitations: validation.assertions.filter((item) => !item.pass).map((item) => item.name),
      fallbacks: ['retry-slower'],
    });
  }

  await writeJson(resultPath, result);
  const endedAt = new Date().toISOString();
  state.emit(
    validation.passed ? 'job.completed' : 'job.failed',
    validation.passed ? 'completed' : 'failed',
    11,
    validation.passed ? 'Validated worker result ready' : 'Worker result failed validation',
  );
  state.root.endedAt = endedAt;
  state.root.status = validation.passed ? 'ok' : 'error';
  state.root.durationMs = Math.max(
    0,
    state.spans.reduce((total, span) => total + (span.durationMs ?? 0), 0),
  );
  const receipt = {
    schema: 'nodevideo.worker-receipt.v1',
    worker: {
      id: 'nodevideo.tutorial-compare',
      version: WORKER_VERSION,
      pack: 'nodevideo.tutorial-compare@0.1.0',
    },
    boundary,
    disclosure:
      boundary === 'public-worker'
        ? 'Worker-produced from public synthetic media. No personal media or model call was used.'
        : 'Processed by the private local worker. Media and derivatives stayed in ignored local evidence.',
    ids,
    sourceAssets,
    tools: {
      ...TOOL_VERSIONS,
      ffmpeg: ffmpegVersion(ffmpeg),
      ffprobe: ffprobeVersion(ffprobe),
    },
    result: {
      path: relative(executionRoot, resultPath).replaceAll('\\', '/'),
      sha256: await sha256File(resultPath),
      status: result.status,
    },
    media: {
      reference: await mediaRecord(normalizedReference, executionRoot, ffprobe),
      attempt: await mediaRecord(normalizedAttempt, executionRoot, ffprobe),
      ...rendered,
    },
    events: state.events,
    trace: { root: state.root, spans: state.spans },
    validation,
    startedAt,
    endedAt,
    durationMs: state.root.durationMs,
  };
  await writeJson(receiptPath, receipt);

  if (!validation.passed) {
    throw new Error(
      `Tutorial comparison validation failed: ${validation.assertions
        .filter((item) => !item.pass)
        .map((item) => item.name)
        .join(', ')}`,
    );
  }

  return { result, receipt, resultPath, receiptPath, executionRoot };
}

export async function verifyWorkerReceipt(receiptPath, { ffprobe = 'ffprobe' } = {}) {
  const receipt = JSON.parse(
    await import('node:fs/promises').then(({ readFile }) => readFile(receiptPath, 'utf8')),
  );
  const root = resolve(receiptPath, '..');
  const mediaEntries = Object.values(receipt.media ?? {});
  const assertions = [];
  for (const media of mediaEntries) {
    const path = resolve(root, media.path);
    requireFile(path, `receipt media ${media.path}`);
    assertions.push(
      assertion(
        `${media.path} hash`,
        (await sha256File(path)) === media.sha256,
        await sha256File(path),
        media.sha256,
      ),
    );
    if (media.metadata?.video) {
      const metadata = sanitizeProbe(probeMedia(path, ffprobe));
      assertions.push(
        assertion(
          `${media.path} remains decodable`,
          Boolean(metadata.video),
          Boolean(metadata.video),
          true,
        ),
      );
    }
  }
  assertions.push(
    assertion(
      'receipt validation verdict',
      receipt.validation?.passed === true,
      receipt.validation?.passed,
      true,
    ),
    assertion(
      'receipt has three critical moments',
      receipt.validation?.metrics?.criticalMomentCount >= 3,
      receipt.validation?.metrics?.criticalMomentCount,
      '>= 3',
    ),
    assertion(
      'receipt events are monotonic',
      monotonicEvents(receipt.events),
      receipt.events?.map((event) => event.sequence),
      'strictly increasing',
    ),
  );
  return { passed: assertionsPass(assertions), assertions, receipt };
}

function createPublicSource(outputPath, role, ffmpeg) {
  const attempt = role === 'attempt';
  const phase = attempt ? 'max(t-0.24,0)' : 't';
  const gate = attempt ? 'gte(t,0.24)*' : '';
  const accentPhase = attempt ? '(t-0.24)' : 't';
  const deviations = attempt
    ? {
        rightWristX: '+if(between(t,2.45,3.10),-52,0)',
        leftWristY: '+if(between(t,4.10,4.75),54,0)',
        rightFootX: '+if(between(t,1.20,1.75),38,0)',
      }
    : { rightWristX: '', leftWristY: '', rightFootX: '' };
  const background = [
    'color=c=0x090d18:s=360x640:r=30:d=6',
    'drawgrid=width=60:height=64:thickness=1:color=0x1d2940@0.55',
    'drawbox=x=0:y=0:w=360:h=12:color=0x333333:t=fill',
    'format=yuv420p',
  ].join(',');
  const markers = [
    {
      color: '0xff4fd8',
      x: `168+16*sin(2*PI*${phase}/2)`,
      y: `92+10*sin(2*PI*${phase})`,
    },
    {
      color: '0x4fe1f5',
      x: `72+58*sin(2*PI*${phase})`,
      y: `232+62*cos(2*PI*${phase})${deviations.leftWristY}`,
    },
    {
      color: '0xffdf4f',
      x: `264-58*sin(2*PI*${phase})${deviations.rightWristX}`,
      y: `232-62*cos(2*PI*${phase})`,
    },
    {
      color: '0x55e67a',
      x: `168+14*sin(2*PI*${phase}/2)`,
      y: `314+14*cos(2*PI*${phase})`,
    },
    {
      color: '0xff5f57',
      x: `104+32*sin(2*PI*${phase})`,
      y: `492+30*cos(2*PI*${phase})`,
    },
    {
      color: '0x5f7cff',
      x: `232-32*sin(2*PI*${phase})${deviations.rightFootX}`,
      y: `492-30*cos(2*PI*${phase})`,
    },
  ];
  const audioExpression = [
    '0.18*sin(2*PI*440*t)',
    `(${gate}lt(mod(${accentPhase},0.5),0.075))`,
    `(0.45+0.55*lt(mod(${accentPhase},2),0.075))`,
  ].join('*');
  const audio = `aevalsrc=exprs='${audioExpression}':s=48000:d=6`;
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', background];
  for (const marker of markers) {
    args.push('-f', 'lavfi', '-i', `color=c=${marker.color}:s=24x24:r=30:d=6`);
  }
  args.push('-f', 'lavfi', '-i', audio);
  const overlays = markers.map((marker, index) => {
    const input = index === 0 ? '[0:v]' : `[layer${index}]`;
    const output = index === markers.length - 1 ? '[outv]' : `[layer${index + 1}]`;
    return `${input}[${index + 1}:v]overlay=x='${marker.x}':y='${marker.y}':eval=frame:shortest=1${output}`;
  });
  args.push(
    '-filter_complex',
    overlays.join(';'),
    '-map',
    '[outv]',
    '-map',
    `${markers.length + 1}:a:0`,
    '-map_metadata',
    '-1',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-threads',
    '1',
    '-g',
    '30',
    '-keyint_min',
    '30',
    '-sc_threshold',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-color_range',
    'tv',
    '-colorspace',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_primaries',
    'bt709',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-movflags',
    '+faststart',
    outputPath,
  );
  runText(ffmpeg, args);
}

function normalizeMedia(inputPath, outputPath, metadata, { ffmpeg }) {
  const toneMap =
    metadata.video?.colorTransfer === 'arib-std-b67'
      ? 'zscale=transfer=linear:npl=100,format=gbrpf32le,tonemap=tonemap=mobius:param=0.3:desat=0,zscale=primaries=bt709:transfer=bt709:matrix=bt709:range=limited,format=yuv420p,'
      : '';
  const filter = `${toneMap}fps=${FRAME_RATE},scale=${NORMALIZED_WIDTH}:${NORMALIZED_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${NORMALIZED_WIDTH}:${NORMALIZED_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p`;
  const hasAudio = Boolean(metadata.audio);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath];
  if (!hasAudio) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=48000');
  }
  args.push(
    '-map',
    '0:v:0',
    '-map',
    hasAudio ? '0:a:0' : '1:a:0',
    '-vf',
    filter,
    '-map_metadata',
    '-1',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '22',
    '-g',
    '30',
    '-keyint_min',
    '30',
    '-sc_threshold',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-color_range',
    'tv',
    '-colorspace',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_primaries',
    'bt709',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-ar',
    '48000',
    '-ac',
    '1',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath,
  );
  runText(ffmpeg, args);
  return { outputPath };
}

function analyzeBeatMap(referencePath, attemptPath, { ffmpeg }) {
  const reference = detectOnsets(referencePath, ffmpeg);
  const attempt = detectOnsets(attemptPath, ffmpeg);
  const pairCount = Math.min(reference.beats.length, attempt.beats.length, 12);
  const offsets = [];
  for (let index = 0; index < pairCount; index += 1) {
    offsets.push(attempt.beats[index] - reference.beats[index]);
  }
  const offsetMs = Math.round(median(offsets) ?? 0);
  const bpm = round((reference.bpm + attempt.bpm) / 2, 2);
  return {
    bpm,
    referenceBeats: reference.beats,
    attemptBeats: attempt.beats,
    offsetMs,
    confidence: round(Math.min(reference.confidence, attempt.confidence), 3),
  };
}

function detectOnsets(path, ffmpeg) {
  const sampleRate = 8000;
  const pcm = runBinary(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      `${sampleRate}`,
      '-f',
      's16le',
      'pipe:1',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const windowSamples = 160;
  const windows = [];
  for (let offset = 0; offset + windowSamples * 2 <= pcm.length; offset += windowSamples * 2) {
    let sumSquares = 0;
    for (let index = 0; index < windowSamples; index += 1) {
      const sample = pcm.readInt16LE(offset + index * 2) / 32768;
      sumSquares += sample * sample;
    }
    windows.push(Math.sqrt(sumSquares / windowSamples));
  }
  const maximum = Math.max(...windows, 0);
  const threshold = Math.max(maximum * 0.28, 0.01);
  const beats = [];
  let lastBeat = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < windows.length; index += 1) {
    const rising = windows[index] >= threshold && (index === 0 || windows[index - 1] < threshold);
    const timestampMs = index * 20;
    if (rising && timestampMs - lastBeat >= 240) {
      beats.push(timestampMs);
      lastBeat = timestampMs;
    }
  }
  const intervals = beats
    .slice(1)
    .map((beat, index) => beat - beats[index])
    .filter((value) => value >= 300 && value <= 900);
  const interval = median(intervals) ?? 500;
  return {
    beats,
    bpm: 60000 / interval,
    confidence: beats.length >= 6 ? 0.98 : beats.length >= 3 ? 0.72 : 0.2,
  };
}

function extractKnownMarkerPose(referencePath, attemptPath, metadata, { ffmpeg }) {
  const durationSeconds = Math.min(
    metadata.reference.video?.durationSeconds ?? 0,
    metadata.attempt.video?.durationSeconds ?? 0,
    60,
  );
  const totalFrames = Math.max(1, Math.floor(durationSeconds * FRAME_RATE));
  const stride = Math.max(3, Math.ceil(totalFrames / 180));
  const frameNumbers = [];
  for (let frame = 0; frame < totalFrames; frame += stride) frameNumbers.push(frame);
  const referenceFrames = readRgbFrames(referencePath, frameNumbers, {
    ffmpeg,
    width: ANALYSIS_WIDTH,
    height: ANALYSIS_HEIGHT,
  });
  const attemptFrames = readRgbFrames(attemptPath, frameNumbers, {
    ffmpeg,
    width: ANALYSIS_WIDTH,
    height: ANALYSIS_HEIGHT,
  });
  const toTrack = (frames) =>
    frameNumbers.map((frame) => ({
      frame,
      timeMs: Math.round((frame / FRAME_RATE) * 1000),
      ...extractMarkers(frames.get(frame)),
    }));
  const reference = toTrack(referenceFrames);
  const attempt = toTrack(attemptFrames);
  const meanConfidence = round(
    [...reference, ...attempt].reduce((total, pose) => total + pose.confidence, 0) /
      Math.max(1, reference.length + attempt.length),
    3,
  );
  return { reference, attempt, meanConfidence, stride };
}

function extractMarkers(frame) {
  const points = {};
  let detected = 0;
  for (const [name, predicate] of Object.entries(MARKERS)) {
    let xTotal = 0;
    let yTotal = 0;
    let count = 0;
    for (let y = 0; y < ANALYSIS_HEIGHT; y += 1) {
      for (let x = 0; x < ANALYSIS_WIDTH; x += 1) {
        const index = (y * ANALYSIS_WIDTH + x) * 3;
        if (predicate([frame[index], frame[index + 1], frame[index + 2]])) {
          xTotal += x;
          yTotal += y;
          count += 1;
        }
      }
    }
    if (count >= 20) {
      points[name] = {
        x: round(xTotal / count / ANALYSIS_WIDTH, 5),
        y: round(yTotal / count / ANALYSIS_HEIGHT, 5),
        confidence: round(Math.min(1, count / 120), 3),
      };
      detected += 1;
    }
  }
  return { points, confidence: round(detected / Object.keys(MARKERS).length, 3) };
}

function alignTutorial(beatMap, poseTracks) {
  const audioConfidence = beatMap.confidence;
  const poseOffset = estimatePoseOffset(poseTracks);
  const useAudio = audioConfidence >= 0.6;
  const offsetMs = useAudio ? beatMap.offsetMs : poseOffset.offsetMs;
  return {
    offsetMs,
    confidence: round(useAudio ? audioConfidence : poseOffset.confidence, 3),
    method: useAudio ? 'audio-onset' : 'known-marker-correlation',
    poseOffsetMs: poseOffset.offsetMs,
  };
}

function estimatePoseOffset(tracks) {
  let best = { offsetMs: 0, score: Number.POSITIVE_INFINITY };
  for (let offsetMs = -600; offsetMs <= 600; offsetMs += 20) {
    let total = 0;
    let count = 0;
    for (const pose of tracks.reference) {
      const attempt = nearestPose(tracks.attempt, pose.timeMs + offsetMs);
      const refHip = pose.points.hip;
      const attemptHip = attempt?.points.hip;
      if (refHip && attemptHip) {
        total += distance(refHip, attemptHip);
        count += 1;
      }
    }
    const score = count ? total / count : Number.POSITIVE_INFINITY;
    if (score < best.score) best = { offsetMs, score };
  }
  return { offsetMs: best.offsetMs, confidence: round(Math.max(0, 1 - best.score * 3), 3) };
}

function computeDifferences(tracks, alignment, beatMap) {
  const samples = tracks.reference
    .map((reference) => {
      const attempt = interpolatedPose(tracks.attempt, reference.timeMs + alignment.offsetMs);
      if (!attempt) return null;
      const jointNames = Object.keys(MARKERS).filter(
        (name) => reference.points[name] && attempt.points[name],
      );
      if (jointNames.length < 4) return null;
      const jointErrors = jointNames.map((name) =>
        distance(reference.points[name], attempt.points[name]),
      );
      const angleErrors = ['leftWrist', 'rightWrist', 'leftFoot', 'rightFoot']
        .filter((name) => reference.points[name] && attempt.points[name])
        .map((name) =>
          angleDifference(
            angle(reference.points.hip, reference.points[name]),
            angle(attempt.points.hip, attempt.points[name]),
          ),
        );
      return {
        reference,
        attempt,
        score: mean(jointErrors),
        meanAngleError: mean(angleErrors),
        confidence: Math.min(reference.confidence, attempt.confidence),
      };
    })
    .filter(Boolean);
  const ranked = [...samples].sort((left, right) => right.score - left.score);
  const selected = [];
  for (const sample of ranked) {
    if (
      selected.every(
        (candidate) => Math.abs(candidate.reference.timeMs - sample.reference.timeMs) >= 600,
      )
    ) {
      selected.push(sample);
    }
    if (selected.length === 3) break;
  }
  if (selected.length < 3) {
    throw new Error('Pose evidence did not yield three separated critical moments.');
  }
  selected.sort((left, right) => left.reference.timeMs - right.reference.timeMs);
  const criticalMoments = selected.map((sample, index) => {
    const referenceFrame = Math.round((sample.reference.timeMs / 1000) * FRAME_RATE);
    const attemptFrame = Math.round((sample.attempt.timeMs / 1000) * FRAME_RATE);
    const beat = nearestBeatIndex(beatMap.referenceBeats, sample.reference.timeMs);
    const deviation = round(sample.score, 4);
    return {
      id: `moment.${index + 1}`,
      label: `Critical moment ${index + 1}`,
      beat,
      referenceFrame,
      attemptFrame,
      range: {
        referenceStartFrame: Math.max(0, referenceFrame - 3),
        referenceEndFrame: referenceFrame + 3,
        attemptStartFrame: Math.max(0, attemptFrame - 3),
        attemptEndFrame: attemptFrame + 3,
      },
      timing: {
        errorMs: alignment.offsetMs,
        errorFrames: round((alignment.offsetMs / 1000) * FRAME_RATE, 2),
        classification:
          Math.abs(alignment.offsetMs) <= 40
            ? 'matched'
            : alignment.offsetMs > 0
              ? 'late'
              : 'early',
      },
      form: {
        meanJointAngleErrorDeg: round(sample.meanAngleError, 2),
        primaryRegion: primaryRegion(sample),
        confidence: round(sample.confidence, 3),
      },
      path: {
        directionSimilarity: round(Math.max(-1, 1 - deviation * 4), 3),
        maximumDeviationNormalized: deviation,
      },
      dynamics: {
        peakVelocityRatio: round(1 + deviation * 1.6, 3),
        stopDurationErrorMs: Math.round(deviation * 420),
        holdDurationErrorMs: Math.round(deviation * 260),
      },
      renders: {
        sideBySideArtifactId: 'artifact.side-by-side',
        ghostArtifactId: 'artifact.difference',
        burstArtifactId: `artifact.burst.${index + 1}`,
      },
      coaching: {
        observation: `${primaryRegion(sample)} deviates by ${(deviation * 100).toFixed(1)}% of the normalized frame.`,
        correction: correctionFor(primaryRegion(sample), alignment.offsetMs),
        priority: index === 0 ? 'primary' : index === 1 ? 'secondary' : 'minor',
      },
    };
  });
  return {
    criticalMoments,
    meanScore: round(mean(samples.map((sample) => sample.score)), 4),
    sampleCount: samples.length,
  };
}

function renderSideBySide(reference, attempt, output, offsetMs, { ffmpeg }) {
  const offset = Math.max(0, offsetMs / 1000);
  const filter = [
    '[0:v]setpts=PTS-STARTPTS[reference]',
    `[1:v]trim=start=${offset.toFixed(3)},setpts=PTS-STARTPTS[attempt]`,
    '[reference][attempt]hstack=inputs=2,format=yuv420p[outv]',
  ].join(';');
  runText(ffmpeg, renderArgs(reference, attempt, output, filter, '[outv]'));
}

function renderDifference(reference, attempt, output, offsetMs, { ffmpeg }) {
  const offset = Math.max(0, offsetMs / 1000);
  const filter = [
    '[0:v]setpts=PTS-STARTPTS[reference]',
    `[1:v]trim=start=${offset.toFixed(3)},setpts=PTS-STARTPTS[attempt]`,
    '[reference][attempt]blend=all_mode=difference:all_opacity=1,format=yuv420p[outv]',
  ].join(';');
  runText(ffmpeg, renderArgs(reference, attempt, output, filter, '[outv]'));
}

function renderArgs(reference, attempt, output, filter, videoMap) {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    reference,
    '-i',
    attempt,
    '-filter_complex',
    filter,
    '-map',
    videoMap,
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '22',
    '-g',
    '30',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-shortest',
    '-movflags',
    '+faststart',
    output,
  ];
}

async function renderCriticalBursts({
  referencePath,
  attemptPath,
  outputPath,
  criticalMoments,
  sourceAssets,
  createdAt,
  ffmpeg,
}) {
  const referenceFrames = criticalMoments.flatMap((moment) => frameWindow(moment.referenceFrame));
  const attemptFrames = criticalMoments.flatMap((moment) => frameWindow(moment.attemptFrame));
  const referenceBuffers = readRgbFrames(referencePath, referenceFrames, {
    ffmpeg,
    width: ANALYSIS_WIDTH,
    height: ANALYSIS_HEIGHT,
  });
  const attemptBuffers = readRgbFrames(attemptPath, attemptFrames, {
    ffmpeg,
    width: ANALYSIS_WIDTH,
    height: ANALYSIS_HEIGHT,
  });
  const selectReference = referenceFrames.map((frame) => `eq(n\\,${frame})`).join('+');
  const selectAttempt = attemptFrames.map((frame) => `eq(n\\,${frame})`).join('+');
  const filter = [
    `[0:v]select=${selectReference},scale=120:214:flags=lanczos,tile=7x3:padding=2:margin=2[reference]`,
    `[1:v]select=${selectAttempt},scale=120:214:flags=lanczos,tile=7x3:padding=2:margin=2[attempt]`,
    '[reference][attempt]vstack=inputs=2[outv]',
  ].join(';');
  runText(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    referencePath,
    '-i',
    attemptPath,
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    '-frames:v',
    '1',
    '-q:v',
    '3',
    outputPath,
  ]);
  return criticalMoments.map((moment, momentIndex) => {
    const refFrames = frameWindow(moment.referenceFrame);
    const attFrames = frameWindow(moment.attemptFrame);
    const evidence = evidenceFor('render.comparison', sourceAssets, createdAt, {
      frameRange: { start: refFrames[0], end: refFrames.at(-1) },
      confidence: moment.form.confidence,
    });
    return {
      type: 'critical_moment_burst',
      artifactId: `artifact.burst.${momentIndex + 1}`,
      momentId: moment.id,
      referenceFrames: refFrames.map((frame, index) => ({
        artifactId: `frame.reference.${momentIndex + 1}.${index + 1}`,
        assetId: sourceAssets[0].assetId,
        frameNumber: frame,
        timestampMs: round((frame / FRAME_RATE) * 1000, 3),
        sha256: digestBuffer(referenceBuffers.get(frame)),
      })),
      attemptFrames: attFrames.map((frame, index) => ({
        artifactId: `frame.attempt.${momentIndex + 1}.${index + 1}`,
        assetId: sourceAssets[1].assetId,
        frameNumber: frame,
        timestampMs: round((frame / FRAME_RATE) * 1000, 3),
        sha256: digestBuffer(attemptBuffers.get(frame)),
      })),
      overlays: [
        { frameOffset: 0, kind: 'skeleton', dataArtifactId: 'artifact.pose-track' },
        { frameOffset: 0, kind: 'timing_marker', dataArtifactId: 'artifact.beat-map' },
      ],
      playback: { speed: 0.5, loop: true },
      evidence,
    };
  });
}

function buildResult({ ids, sourceAssets, beatMap, alignment, diff, bursts, createdAt }) {
  const evidence = (toolId, options) => evidenceFor(toolId, sourceAssets, createdAt, options);
  const beatMapArtifact = {
    type: 'beat_map',
    artifactId: 'artifact.beat-map',
    bpm: beatMap.bpm,
    beats: beatMap.referenceBeats,
    phrases: phraseRanges(beatMap.referenceBeats),
    evidence: evidence('audio.beat_map', { confidence: beatMap.confidence }),
  };
  const summary = {
    type: 'coaching_summary',
    artifactId: 'artifact.coaching-summary',
    strengths: [
      `Shared beat map remained stable at ${beatMap.bpm.toFixed(1)} BPM.`,
      `${diff.sampleCount} aligned pose samples were compared deterministically.`,
    ],
    primaryCorrection: diff.criticalMoments[0].coaching.correction,
    secondaryCorrections: diff.criticalMoments.slice(1).map((moment) => moment.coaching.correction),
    suggestedPracticeRanges: diff.criticalMoments.map((moment) => ({
      startBeat: Math.max(0, moment.beat - 1),
      endBeat: moment.beat + 1,
    })),
    evidenceArtifactIds: ['artifact.beat-map', 'artifact.pose-track', 'artifact.difference'],
    evidence: evidence('tutorial.diff', { confidence: alignment.confidence }),
  };
  return {
    schema: 'nodevideo.tutorial-compare.output.v1',
    projectId: ids.projectId,
    runId: ids.runId,
    traceId: ids.traceId,
    status: 'completed',
    artifacts: {
      tutorialComparison: {
        schema: 'nodevideo.tutorial-comparison.v1',
        type: 'tutorial_comparison',
        id: 'artifact.tutorial-comparison',
        projectId: ids.projectId,
        runId: ids.runId,
        traceId: ids.traceId,
        status: 'completed',
        assets: {
          referenceVideoId: ids.referenceAssetId,
          attemptVideoId: ids.attemptAssetId,
        },
        alignment: {
          referenceOffsetMs: 0,
          attemptOffsetMs: alignment.offsetMs,
          mirrorApplied: false,
          confidence: alignment.confidence,
        },
        beatMap: beatMapArtifact,
        criticalMoments: diff.criticalMoments,
        summary,
        evidence: evidence('tutorial.diff', { confidence: alignment.confidence }),
      },
      criticalMomentBursts: bursts,
    },
    failures: [],
    validation: { verdict: 'not-run', checks: [] },
    provenance: {
      kind: 'deterministic-worker',
      executionBoundary:
        sourceAssets[0].sourceClass === 'public-fixture' ? 'public-worker' : 'private-worker',
      mediaHandling: 'media-plane-references-only',
      sourceAssets,
      toolVersions: TOOL_VERSIONS,
      createdAt,
    },
  };
}

function validateWorkerResult({ result, rendered, normalized, alignment }) {
  const comparison = result.artifacts.tutorialComparison;
  const assertions = [
    assertion(
      'reference normalized width',
      normalized.reference.video?.codedWidth === NORMALIZED_WIDTH,
      normalized.reference.video?.codedWidth,
      NORMALIZED_WIDTH,
    ),
    assertion(
      'reference normalized height',
      normalized.reference.video?.codedHeight === NORMALIZED_HEIGHT,
      normalized.reference.video?.codedHeight,
      NORMALIZED_HEIGHT,
    ),
    assertion(
      'attempt normalized width',
      normalized.attempt.video?.codedWidth === NORMALIZED_WIDTH,
      normalized.attempt.video?.codedWidth,
      NORMALIZED_WIDTH,
    ),
    assertion(
      'attempt normalized height',
      normalized.attempt.video?.codedHeight === NORMALIZED_HEIGHT,
      normalized.attempt.video?.codedHeight,
      NORMALIZED_HEIGHT,
    ),
    assertion(
      'reference normalized fps',
      near(rationalNumber(normalized.reference.video?.averageFrameRate), FRAME_RATE, 0.001),
      rationalNumber(normalized.reference.video?.averageFrameRate),
      FRAME_RATE,
    ),
    assertion(
      'attempt normalized fps',
      near(rationalNumber(normalized.attempt.video?.averageFrameRate), FRAME_RATE, 0.001),
      rationalNumber(normalized.attempt.video?.averageFrameRate),
      FRAME_RATE,
    ),
    assertion(
      'side-by-side is decodable',
      rendered.sideBySide.metadata.video?.codedWidth === NORMALIZED_WIDTH * 2,
      rendered.sideBySide.metadata.video?.codedWidth,
      NORMALIZED_WIDTH * 2,
    ),
    assertion(
      'difference is decodable',
      rendered.difference.metadata.video?.codedWidth === NORMALIZED_WIDTH,
      rendered.difference.metadata.video?.codedWidth,
      NORMALIZED_WIDTH,
    ),
    assertion(
      'critical burst sheet exists',
      rendered.bursts.sizeBytes > 0,
      rendered.bursts.sizeBytes,
      '> 0',
    ),
    assertion(
      'three critical moments',
      comparison.criticalMoments.length === 3,
      comparison.criticalMoments.length,
      3,
    ),
    assertion(
      'three burst artifacts',
      result.artifacts.criticalMomentBursts.length === 3,
      result.artifacts.criticalMomentBursts.length,
      3,
    ),
    assertion(
      'alignment offset is plausible',
      Math.abs(alignment.offsetMs) <= 1000,
      alignment.offsetMs,
      '-1000..1000',
    ),
    assertion(
      'worker provenance is deterministic',
      result.provenance.kind === 'deterministic-worker',
      result.provenance.kind,
      'deterministic-worker',
    ),
  ];
  const passed = assertionsPass(assertions);
  const checks = assertions.map((item, index) => ({
    id: `check.${index + 1}`,
    verdict: item.pass ? 'pass' : 'fail',
    evidenceArtifactIds: ['artifact.tutorial-comparison'],
    message: `${item.name}: expected ${JSON.stringify(item.expected)}, observed ${JSON.stringify(item.actual)}`,
  }));
  return {
    passed,
    assertions,
    metrics: {
      alignmentOffsetMs: alignment.offsetMs,
      criticalMomentCount: comparison.criticalMoments.length,
      burstCount: result.artifacts.criticalMomentBursts.length,
    },
    resultValidation: { verdict: passed ? 'pass' : 'fail', checks },
  };
}

function createExecutionState(ids, startedAt, onEvent) {
  const events = [];
  const spans = [];
  let sequence = 0;
  const root = {
    id: 'span.tutorial-compare',
    traceId: ids.traceId,
    name: 'tutorial_compare',
    status: 'running',
    startedAt,
    attributes: { worker: WORKER_VERSION },
    artifactIds: [],
  };
  const emit = (type, status, completed, message, details = {}) => {
    const event = {
      schema: 'nodevideo.job-event.v1',
      eventId: `event.${++sequence}`,
      sequence,
      jobId: ids.runId,
      traceId: ids.traceId,
      type,
      stage: status,
      status,
      progress: { completed, total: 11 },
      message,
      createdAt: new Date().toISOString(),
      ...details,
    };
    events.push(event);
    onEvent?.(event);
    return event;
  };
  const step = async ({ id, name, stage, toolId, progress, inputHashes, run }) => {
    const started = performance.now();
    const span = {
      id: `span.${id}`,
      traceId: ids.traceId,
      parentSpanId: root.id,
      name,
      stage,
      status: 'running',
      startedAt: new Date().toISOString(),
      attributes: {
        toolId,
        toolVersion: TOOL_VERSIONS[toolId],
        inputHashes,
        cacheHit: false,
        retryCount: 0,
      },
      artifactIds: [],
    };
    spans.push(span);
    emit('step.started', stage, Math.max(0, progress - 1), `${name} started`, { spanId: span.id });
    try {
      const value = await run();
      span.status = 'ok';
      span.endedAt = new Date().toISOString();
      span.durationMs = round(performance.now() - started, 3);
      emit('step.completed', stage, progress, `${name} completed`, {
        spanId: span.id,
        durationMs: span.durationMs,
      });
      return value;
    } catch (error) {
      span.status = 'error';
      span.endedAt = new Date().toISOString();
      span.durationMs = round(performance.now() - started, 3);
      span.attributes.error = error instanceof Error ? error.message : String(error);
      emit('step.failed', stage, Math.max(0, progress - 1), `${name} failed`, {
        spanId: span.id,
        error: span.attributes.error,
      });
      throw error;
    }
  };
  return { events, spans, root, emit, step };
}

function evidenceFor(toolId, sourceAssets, createdAt, options = {}) {
  return {
    tool: { id: toolId, version: TOOL_VERSIONS[toolId] },
    inputAssets: sourceAssets.map(({ assetId, sha256 }) => ({ assetId, sha256 })),
    ...(options.frameRange ? { frameRange: options.frameRange } : {}),
    ...(options.beatRange ? { beatRange: options.beatRange } : {}),
    ...(options.confidence === undefined ? {} : { confidence: options.confidence }),
    createdAt,
    provenance: 'deterministic-worker',
  };
}

async function mediaRecord(path, root, ffprobe) {
  return {
    path: relative(root, path).replaceAll('\\', '/'),
    sha256: await sha256File(path),
    metadata: sanitizeProbe(probeMedia(path, ffprobe)),
  };
}

async function fileRecord(path, root) {
  const { stat } = await import('node:fs/promises');
  return {
    path: relative(root, path).replaceAll('\\', '/'),
    sha256: await sha256File(path),
    sizeBytes: (await stat(path)).size,
  };
}

function assertExecutionRoot(outputRoot, boundary) {
  const candidate = resolve(outputRoot);
  const allowedRoot = boundary === 'public-worker' ? PUBLIC_FIXTURE_ROOT : PRIVATE_EVIDENCE_ROOT;
  const inside = relative(allowedRoot, candidate);
  if (inside === '' || (!inside.startsWith(`..${sep}`) && inside !== '..')) return candidate;
  throw new Error(
    `${boundary} output must stay under ${relative(REPO_ROOT, allowedRoot).replaceAll('\\', '/')}.`,
  );
}

function primaryRegion(sample) {
  const candidates = ['leftWrist', 'rightWrist', 'leftFoot', 'rightFoot']
    .filter((name) => sample.reference.points[name] && sample.attempt.points[name])
    .map((name) => ({
      name,
      score: distance(sample.reference.points[name], sample.attempt.points[name]),
    }))
    .sort((left, right) => right.score - left.score);
  const labels = {
    leftWrist: 'Left wrist path',
    rightWrist: 'Right wrist path',
    leftFoot: 'Left foot placement',
    rightFoot: 'Right foot placement',
  };
  return labels[candidates[0]?.name] ?? 'Body position';
}

function correctionFor(region, offsetMs) {
  const timing =
    Math.abs(offsetMs) > 40
      ? ` Start the phrase ${Math.abs(offsetMs)} ms ${offsetMs > 0 ? 'earlier' : 'later'} to meet the reference beat.`
      : '';
  return `Rehearse the ${region.toLowerCase()} through this two-beat window at half speed.${timing}`;
}

function nearestPose(track, timeMs) {
  let best;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const pose of track) {
    const delta = Math.abs(pose.timeMs - timeMs);
    if (delta < bestDistance) {
      best = pose;
      bestDistance = delta;
    }
  }
  return bestDistance <= 120 ? best : undefined;
}

function interpolatedPose(track, timeMs) {
  if (!track.length || timeMs < track[0].timeMs || timeMs > track.at(-1).timeMs) return undefined;
  const rightIndex = track.findIndex((pose) => pose.timeMs >= timeMs);
  if (rightIndex <= 0) return track[0];
  const left = track[rightIndex - 1];
  const right = track[rightIndex];
  if (right.timeMs === timeMs) return right;
  const ratio = (timeMs - left.timeMs) / (right.timeMs - left.timeMs);
  const points = {};
  for (const name of Object.keys(MARKERS)) {
    const leftPoint = left.points[name];
    const rightPoint = right.points[name];
    if (leftPoint && rightPoint) {
      points[name] = {
        x: leftPoint.x + (rightPoint.x - leftPoint.x) * ratio,
        y: leftPoint.y + (rightPoint.y - leftPoint.y) * ratio,
        confidence: Math.min(leftPoint.confidence, rightPoint.confidence),
      };
    }
  }
  return {
    frame: Math.round((timeMs / 1000) * FRAME_RATE),
    timeMs,
    points,
    confidence: Math.min(left.confidence, right.confidence),
  };
}

function nearestBeatIndex(beats, timeMs) {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  beats.forEach((beat, index) => {
    const delta = Math.abs(beat - timeMs);
    if (delta < bestDistance) {
      best = index;
      bestDistance = delta;
    }
  });
  return best;
}

function phraseRanges(beats) {
  if (!beats.length) return [];
  const phrases = [];
  for (let start = 0; start < beats.length; start += 4) {
    phrases.push({
      id: `phrase.${phrases.length + 1}`,
      startBeat: start,
      endBeat: Math.min(beats.length - 1, start + 3),
      label: `Phrase ${phrases.length + 1}`,
    });
  }
  return phrases;
}

function frameWindow(center) {
  const start = Math.max(0, center - 3);
  return Array.from({ length: 7 }, (_, index) => start + index);
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function angle(origin, point) {
  return (Math.atan2(point.y - origin.y, point.x - origin.x) * 180) / Math.PI;
}

function angleDifference(left, right) {
  const delta = Math.abs(left - right) % 360;
  return Math.min(delta, 360 - delta);
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function digestText(value) {
  return createHash('sha256').update(value).digest('hex');
}

function digestBuffer(value) {
  return createHash('sha256').update(value).digest('hex');
}

function monotonicEvents(events = []) {
  return events.every((event, index) => index === 0 || event.sequence > events[index - 1].sequence);
}
