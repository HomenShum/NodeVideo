#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ffmpegVersion,
  ffprobeVersion,
  probeMedia,
  rationalNumber,
  requireFile,
  resolveInputPath,
  runBinary,
  runText,
  sanitizeProbe,
  sha256File,
  writeJson,
} from '../media/media-proof-lib.mjs';

export const RENDER_METRICS_SCHEMA_VERSION = 'nodevideo.render-metrics.v1';
export const RENDER_METRICS_TOOL_VERSION = 'nodevideo.render-metrics-v2@1.1.0';
export const WINDOW_DEFINITIONS_SCHEMA_VERSION = 'nodevideo.render-metric-windows.v1';
export const SOURCE_LEAKAGE_SCHEMA_VERSION = 'nodevideo.source-leakage-measurement.v1';
export const DEFAULT_REFERENCE_AUDIO_RANGE_MS = Object.freeze({ start: 0, end: 40_338.6 });
/** @deprecated Use DEFAULT_REFERENCE_AUDIO_RANGE_MS. */
export const DEFAULT_MASTER_RANGE_MS = DEFAULT_REFERENCE_AUDIO_RANGE_MS;

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
const DEFAULT_AUDIO_SAMPLE_RATE = 8_000;
const DEFAULT_MAX_AUDIO_LAG_MS = 50;

/**
 * Measure an audiovisual render against its reference target.
 *
 * `definition` may be a canonical EditPlan or a
 * `nodevideo.render-metric-windows.v1` document. Metric windows are always
 * decoded by exact frame number. Fit-layout windows use an explicit ROI or a
 * source-aspect contain rectangle, never a black-padding-dominated full frame.
 */
export async function measureRenderMetrics(options) {
  const renderPath = resolveInputPath(requiredString(options?.renderPath, 'renderPath'));
  const referencePath = resolveInputPath(requiredString(options?.referencePath, 'referencePath'));
  const ffmpeg = options.ffmpeg ?? 'ffmpeg';
  const ffprobe = options.ffprobe ?? 'ffprobe';
  requireFile(renderPath, 'render');
  requireFile(referencePath, 'reference target');

  const renderProbeRaw = probeMedia(renderPath, ffprobe);
  const referenceProbeRaw = probeMedia(referencePath, ffprobe);
  const renderProbe = sanitizeProbe(renderProbeRaw);
  const referenceProbe = sanitizeProbe(referenceProbeRaw);
  const referenceVideo = referenceProbe.video;
  if (!referenceVideo) throw new Error('Reference target has no video stream.');

  const definition = options.definition ?? null;
  const frameRate = resolveFrameRate(definition, referenceVideo);
  const canvas = resolveCanvas(definition, referenceVideo);
  const durationFrames = resolveDurationFrames(definition, referenceVideo, frameRate);
  const assetPaths = normalizeAssetPaths(options.assetPaths);
  const assetDimensions = {
    ...normalizeAssetDimensions(definition?.assetDimensions),
    ...(await probeAssetDimensions(assetPaths, ffprobe)),
    ...normalizeAssetDimensions(options.assetDimensions),
  };
  const specs = buildMetricWindowSpecs(definition, {
    canvas,
    durationFrames,
    assetDimensions,
  });
  const windows = [];
  for (const spec of specs) {
    const roi =
      spec.roi ??
      (await detectReferenceActiveArea({
        referencePath,
        timelineRange: spec.timelineRange,
        canvas,
        ffmpeg,
      }));
    if (spec.layout === 'fit' && isFullCanvas(roi, canvas)) {
      throw new Error(
        `Fit window ${spec.id} resolved to the full canvas; provide its source dimensions or an explicit ROI.`,
      );
    }
    const metric = measureVideoPair({
      referencePath,
      renderPath,
      timelineRange: spec.timelineRange,
      canvas,
      roi,
      ffmpeg,
    });
    windows.push({
      id: spec.id,
      timelineRange: spec.timelineRange,
      score: metric.ssim,
      metric: isFullCanvas(roi, canvas) ? 'ssim' : 'content-ssim',
      roi: {
        ...roi,
        strategy: spec.roi ? spec.roiStrategy : 'reference-cropdetect-fallback',
      },
      ssim: metric.ssim,
      psnrDb: metric.psnrDb,
      psnrInfinite: metric.psnrInfinite,
    });
  }

  const fullCanvas = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const globalVideo = measureVideoPair({
    referencePath,
    renderPath,
    timelineRange: { startFrame: 0, endFrameExclusive: durationFrames },
    canvas,
    roi: fullCanvas,
    ffmpeg,
  });
  const vmaf = supportsFilter(ffmpeg, 'libvmaf')
    ? measureVmaf({
        referencePath,
        renderPath,
        timelineRange: { startFrame: 0, endFrameExclusive: durationFrames },
        canvas,
        ffmpeg,
      })
    : null;

  const referenceRangeMs = resolveReferenceRangeMs(
    definition,
    options.referenceRangeMs ?? options.masterRangeMs,
  );
  const audio = await measureAudio({
    renderPath,
    referencePath,
    renderProbe,
    referenceProbe,
    frameRate,
    specs,
    assetPaths,
    sourceProbes: await probeSourceMedia(assetPaths, ffprobe),
    precomputedSourceLeakage: options.sourceLeakageMeasurement,
    referenceRangeMs,
    sampleRate: options.audioSampleRate ?? DEFAULT_AUDIO_SAMPLE_RATE,
    maxLagMs: options.maxAudioLagMs ?? DEFAULT_MAX_AUDIO_LAG_MS,
    ffmpeg,
  });

  const technical = measureTechnical({
    renderPath,
    referencePath,
    renderProbe,
    referenceProbe,
    frameRate,
    durationFrames,
    referenceRangeMs,
    ffmpeg,
  });
  const renderSha256 = await sha256File(renderPath);
  const referenceSha256 = await sha256File(referencePath);

  return {
    schemaVersion: RENDER_METRICS_SCHEMA_VERSION,
    toolVersion: RENDER_METRICS_TOOL_VERSION,
    artifactId:
      nonEmptyString(options.artifactId) ?? `artifact.render.sha256-${renderSha256.slice(0, 16)}`,
    inputs: {
      renderSha256,
      referenceSha256,
    },
    frameRate,
    canvas,
    durationFrames,
    global: {
      score: globalVideo.ssim,
      metric: 'ssim',
      ssim: globalVideo.ssim,
      psnrDb: globalVideo.psnrDb,
      psnrInfinite: globalVideo.psnrInfinite,
      vmaf,
      contentWeightedSsim: weightedWindowScore(windows),
      warning:
        'Full-frame values are diagnostic only; release gates use exact local windows, and fit windows exclude black padding.',
    },
    windows,
    audio,
    technical,
    provenance: {
      ffmpeg: ffmpegVersion(ffmpeg),
      ffprobe: ffprobeVersion(ffprobe),
      videoMetric: 'FFmpeg ssim/psnr on normalized decoded frames',
      audioMetric: 'lag-bounded zero-mean normalized waveform correlation',
    },
  };
}

/** Build exact window definitions without touching media. */
export function buildMetricWindowSpecs(definition, context) {
  const canvas = validateCanvas(context.canvas);
  const durationFrames = positiveInteger(context.durationFrames, 'durationFrames');
  const assetDimensions = normalizeAssetDimensions(context.assetDimensions);
  let rawWindows;

  if (definition?.schemaVersion === 'nodevideo.edit-plan.v1') {
    const primary = definition.tracks?.find(
      (track) => track?.kind === 'video' && track?.role === 'primary',
    );
    if (!primary || !Array.isArray(primary.clips) || primary.clips.length === 0) {
      throw new Error('EditPlan must contain a non-empty primary video track.');
    }
    rawWindows = primary.clips.map((clip) => ({
      id: `render.${clip.id}`,
      timelineRange: clip.timelineRange,
      kind: clip.kind,
      layout: clip.fit ?? 'fill',
      assetId: clip.assetId,
      sourceRange: clip.sourceRange,
      playbackRate: clip.playbackRate,
    }));
  } else if (definition != null) {
    if (
      definition.schemaVersion != null &&
      definition.schemaVersion !== WINDOW_DEFINITIONS_SCHEMA_VERSION
    ) {
      throw new Error(`Unsupported metric-window schema: ${definition.schemaVersion}`);
    }
    if (!Array.isArray(definition.windows) || definition.windows.length === 0) {
      throw new Error('Metric-window definition must contain at least one window.');
    }
    rawWindows = definition.windows;
  } else {
    rawWindows = [
      {
        id: 'render.full',
        timelineRange: { startFrame: 0, endFrameExclusive: durationFrames },
        kind: 'source',
        layout: 'fill',
      },
    ];
  }

  return rawWindows.map((input, index) => {
    const range = validateRange(input.timelineRange, durationFrames, `window ${index + 1}`);
    const layout = normalizeLayout(input.layout ?? input.fit);
    const explicitRoi = input.roi ? validateRoi(input.roi, canvas, `window ${index + 1}`) : null;
    const dimensions = input.assetId ? assetDimensions[input.assetId] : null;
    const derivedRoi =
      explicitRoi ??
      (layout === 'fit' && dimensions ? deriveContainRoi(canvas, dimensions) : null) ??
      (layout !== 'fit' ? { x: 0, y: 0, width: canvas.width, height: canvas.height } : null);

    return {
      id: nonEmptyString(input.id) ?? `render.window-${index + 1}`,
      timelineRange: range,
      kind: input.kind ?? 'source',
      layout,
      assetId: nonEmptyString(input.assetId),
      sourceRange: input.sourceRange
        ? validateRange(input.sourceRange, Number.MAX_SAFE_INTEGER, `window ${index + 1} source`)
        : null,
      playbackRate:
        input.playbackRate == null
          ? 1
          : positiveNumber(input.playbackRate, `window ${index + 1} playbackRate`),
      roi: derivedRoi,
      roiStrategy: explicitRoi
        ? 'explicit'
        : layout === 'fit' && dimensions
          ? 'source-aspect-contain'
          : 'full-canvas-layout',
    };
  });
}

/** Return the integer pixel bounds occupied by an aspect-fit source. */
export function deriveContainRoi(canvasInput, sourceInput) {
  const canvas = validateCanvas(canvasInput);
  const source = validateCanvas(sourceInput, 'source dimensions');
  const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
  const scaledWidth = source.width * scale;
  const scaledHeight = source.height * scale;
  const left = Math.floor((canvas.width - scaledWidth) / 2);
  const top = Math.floor((canvas.height - scaledHeight) / 2);
  const right = Math.ceil((canvas.width + scaledWidth) / 2);
  const bottom = Math.ceil((canvas.height + scaledHeight) / 2);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * Lag-bounded Pearson correlation. `absolute=true` is appropriate only for
 * leakage detection, where a phase inversion is still leakage.
 */
export function waveformCorrelation(
  left,
  right,
  { sampleRate, maxLagMs = DEFAULT_MAX_AUDIO_LAG_MS, absolute = false },
) {
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) {
    throw new Error('Waveforms must be Float32Array values.');
  }
  if (left.length < 2 || right.length < 2) {
    return { correlation: null, lagMs: null, comparedSamples: 0 };
  }
  const rate = positiveInteger(sampleRate, 'sampleRate');
  const maximumLag = Math.max(0, Math.round((maxLagMs / 1_000) * rate));
  const stride = Math.max(1, Math.round(rate / 1_000));
  const coarseLeft = decimate(left, stride);
  const coarseRight = decimate(right, stride);
  const coarseMaximumLag = Math.round(maximumLag / stride);
  let bestLag = 0;
  let bestValue = absolute ? -1 : Number.NEGATIVE_INFINITY;
  for (let lag = -coarseMaximumLag; lag <= coarseMaximumLag; lag += 1) {
    const value = pearsonAtLag(coarseLeft, coarseRight, lag);
    if (value == null) continue;
    const comparison = absolute ? Math.abs(value) : value;
    if (comparison > bestValue) {
      bestValue = comparison;
      bestLag = lag * stride;
    }
  }
  const refinementRadius = Math.max(1, stride);
  let exactCorrelation = null;
  let exactLag = bestLag;
  bestValue = absolute ? -1 : Number.NEGATIVE_INFINITY;
  for (
    let lag = Math.max(-maximumLag, bestLag - refinementRadius);
    lag <= Math.min(maximumLag, bestLag + refinementRadius);
    lag += 1
  ) {
    const value = pearsonAtLag(left, right, lag);
    if (value == null) continue;
    const comparison = absolute ? Math.abs(value) : value;
    if (comparison > bestValue) {
      bestValue = comparison;
      exactCorrelation = value;
      exactLag = lag;
    }
  }
  if (exactCorrelation == null) {
    return { correlation: null, lagMs: null, comparedSamples: 0 };
  }
  const comparedSamples = Math.min(
    left.length - Math.max(0, exactLag),
    right.length + Math.min(0, exactLag),
  );
  return {
    correlation: round(absolute ? Math.abs(exactCorrelation) : exactCorrelation, 6),
    lagMs: round((exactLag / rate) * 1_000, 3),
    comparedSamples,
  };
}

async function measureAudio({
  renderPath,
  referencePath,
  renderProbe,
  referenceProbe,
  frameRate,
  specs,
  assetPaths,
  sourceProbes,
  precomputedSourceLeakage,
  referenceRangeMs,
  sampleRate,
  maxLagMs,
  ffmpeg,
}) {
  let referenceAudio = {
    correlation: null,
    lagMs: null,
    comparedSamples: 0,
    status: 'unavailable',
  };
  if (renderProbe.audio && referenceProbe.audio) {
    const durationMs = referenceRangeMs.end - referenceRangeMs.start;
    const rendered = decodeAudio(renderPath, {
      startMs: referenceRangeMs.start,
      durationMs,
      sampleRate,
      ffmpeg,
    });
    const reference = decodeAudio(referencePath, {
      startMs: referenceRangeMs.start,
      durationMs,
      sampleRate,
      ffmpeg,
    });
    referenceAudio = {
      ...waveformCorrelation(rendered, reference, { sampleRate, maxLagMs }),
      status: 'measured',
    };
  }

  const renderSha256 = await sha256File(renderPath);
  let leakage;
  if (precomputedSourceLeakage != null) {
    leakage = validatePrecomputedSourceLeakage(precomputedSourceLeakage, renderSha256);
  } else {
    leakage = measureMappedSourceLeakage({
      renderPath,
      renderHasAudio: renderProbe.audio != null,
      frameRate,
      specs,
      assetPaths,
      sourceProbes,
      sampleRate,
      maxLagMs,
      ffmpeg,
    });
  }

  return {
    referenceCorrelation: referenceAudio.correlation,
    sourceLeakageCorrelation: leakage.correlation,
    reference: {
      status: referenceAudio.status,
      rangeMs: referenceRangeMs,
      sampleRate,
      maximumLagMs: maxLagMs,
      lagMs: referenceAudio.lagMs,
      comparedSamples: referenceAudio.comparedSamples,
      method: 'zero-mean-normalized-waveform-correlation',
      comparison: 'rendered output versus reference target soundtrack',
    },
    sourceLeakage: leakage,
  };
}

function measureMappedSourceLeakage({
  renderPath,
  renderHasAudio,
  frameRate,
  specs,
  assetPaths,
  sourceProbes,
  sampleRate,
  maxLagMs,
  ffmpeg,
}) {
  const mapped = specs.filter(
    (spec) => spec.kind === 'source' && spec.assetId && spec.sourceRange != null,
  );
  const expectedFrames = mapped.reduce((sum, spec) => sum + rangeLength(spec.timelineRange), 0);
  if (!renderHasAudio || mapped.length === 0) {
    return {
      status: 'unavailable',
      correlation: null,
      method: 'mapped-source-window-absolute-correlation',
      coverage: { measuredFrames: 0, expectedFrames, ratio: 0 },
      windows: [],
      reason: !renderHasAudio ? 'render-has-no-audio' : 'no-mapped-source-windows',
    };
  }

  const windows = [];
  let measuredFrames = 0;
  for (const spec of mapped) {
    const sourcePath = assetPaths[spec.assetId];
    const sourceProbe = sourceProbes[spec.assetId];
    if (!sourcePath || !sourceProbe?.audio) {
      windows.push({
        id: spec.id,
        timelineRange: spec.timelineRange,
        correlation: null,
        status: 'unavailable',
        reason: !sourcePath ? 'source-binding-missing' : 'source-has-no-audio',
      });
      continue;
    }
    const timelineDurationMs = (rangeLength(spec.timelineRange) / frameRate) * 1_000;
    const sourceFrameRate = resolveProbeFrameRate(sourceProbe.video);
    if (!Number.isFinite(sourceFrameRate) || sourceFrameRate <= 0) {
      windows.push({
        id: spec.id,
        timelineRange: spec.timelineRange,
        correlation: null,
        status: 'unavailable',
        reason: 'source-frame-rate-unavailable',
      });
      continue;
    }
    const sourceDurationMs = (rangeLength(spec.sourceRange) / sourceFrameRate) * 1_000;
    const renderWaveform = decodeAudio(renderPath, {
      startMs: (spec.timelineRange.startFrame / frameRate) * 1_000,
      durationMs: timelineDurationMs,
      sampleRate,
      ffmpeg,
    });
    const sourceWaveform = decodeAudio(sourcePath, {
      startMs: (spec.sourceRange.startFrame / sourceFrameRate) * 1_000,
      durationMs: sourceDurationMs,
      sampleRate,
      tempo: spec.playbackRate,
      ffmpeg,
    });
    const result = waveformCorrelation(renderWaveform, sourceWaveform, {
      sampleRate,
      maxLagMs,
      absolute: true,
    });
    windows.push({
      id: spec.id,
      timelineRange: spec.timelineRange,
      sourceAssetId: spec.assetId,
      sourceRange: spec.sourceRange,
      correlation: result.correlation,
      lagMs: result.lagMs,
      comparedSamples: result.comparedSamples,
      status: result.correlation == null ? 'unavailable' : 'measured',
    });
    if (result.correlation != null) measuredFrames += rangeLength(spec.timelineRange);
  }

  const coverageRatio = expectedFrames === 0 ? 0 : measuredFrames / expectedFrames;
  const complete = measuredFrames === expectedFrames;
  const correlations = windows
    .map((window) => window.correlation)
    .filter((value) => Number.isFinite(value));
  return {
    status: complete ? 'measured' : 'incomplete',
    correlation: complete && correlations.length > 0 ? round(Math.max(...correlations), 6) : null,
    method: 'maximum-absolute-mapped-source-window-correlation',
    coverage: {
      measuredFrames,
      expectedFrames,
      ratio: round(coverageRatio, 6),
    },
    windows,
    ...(complete ? {} : { reason: 'not-all-mapped-source-windows-were-measurable' }),
  };
}

function validatePrecomputedSourceLeakage(input, renderSha256) {
  if (input?.schemaVersion !== SOURCE_LEAKAGE_SCHEMA_VERSION) {
    throw new Error(`Precomputed source leakage must use ${SOURCE_LEAKAGE_SCHEMA_VERSION}.`);
  }
  if (input.renderSha256 !== renderSha256) {
    throw new Error('Precomputed source leakage does not match the rendered artifact SHA-256.');
  }
  if (!Number.isFinite(input.correlation) || input.correlation < 0 || input.correlation > 1) {
    throw new Error('Precomputed source leakage correlation must be between 0 and 1.');
  }
  if (
    !input.coverage ||
    input.coverage.measuredFrames !== input.coverage.expectedFrames ||
    input.coverage.expectedFrames <= 0
  ) {
    throw new Error('Precomputed source leakage must document complete mapped-frame coverage.');
  }
  if (!Array.isArray(input.windows) || input.windows.length === 0) {
    throw new Error('Precomputed source leakage must include per-window evidence.');
  }
  return {
    status: 'measured-precomputed',
    correlation: round(input.correlation, 6),
    method: requiredString(input.method, 'precomputed source leakage method'),
    coverage: input.coverage,
    windows: input.windows,
    evidenceId: requiredString(input.evidenceId, 'precomputed source leakage evidenceId'),
  };
}

function measureTechnical({
  renderPath,
  referencePath,
  renderProbe,
  referenceProbe,
  frameRate,
  durationFrames,
  referenceRangeMs,
  ffmpeg,
}) {
  const renderDecode = decodeCheck(renderPath, ffmpeg);
  const referenceDecode = decodeCheck(referencePath, ffmpeg);
  const renderFrames = deriveFrameCount(renderProbe.video, frameRate);
  const referenceFrames = deriveFrameCount(referenceProbe.video, frameRate);
  const audioDelivery = renderProbe.audio ? measureAudioDelivery(renderPath, ffmpeg) : null;
  const checks = [
    technicalCheck('render-video-decodes', renderDecode.pass, renderDecode.error, null),
    technicalCheck('reference-video-decodes', referenceDecode.pass, referenceDecode.error, null),
    technicalCheck('render-has-video', renderProbe.video != null, renderProbe.video != null, true),
    technicalCheck(
      'reference-has-video',
      referenceProbe.video != null,
      referenceProbe.video != null,
      true,
    ),
    technicalCheck(
      'render-frame-count',
      renderFrames === durationFrames,
      renderFrames,
      durationFrames,
    ),
    technicalCheck(
      'reference-frame-count',
      referenceFrames === durationFrames,
      referenceFrames,
      durationFrames,
    ),
    technicalCheck(
      'render-frame-rate',
      near(resolveProbeFrameRate(renderProbe.video), frameRate, 0.001),
      resolveProbeFrameRate(renderProbe.video),
      frameRate,
    ),
    technicalCheck(
      'reference-frame-rate',
      near(resolveProbeFrameRate(referenceProbe.video), frameRate, 0.001),
      resolveProbeFrameRate(referenceProbe.video),
      frameRate,
    ),
    technicalCheck('render-has-audio', renderProbe.audio != null, renderProbe.audio != null, true),
    technicalCheck(
      'reference-has-audio',
      referenceProbe.audio != null,
      referenceProbe.audio != null,
      true,
    ),
    technicalCheck(
      'render-audio-covers-reference-range',
      (renderProbe.audio?.durationSeconds ?? 0) * 1_000 >= referenceRangeMs.end - 1,
      renderProbe.audio?.durationSeconds ?? null,
      referenceRangeMs.end / 1_000,
    ),
    technicalCheck(
      'render-integrated-loudness-measured',
      Number.isFinite(audioDelivery?.integratedLufs),
      audioDelivery?.integratedLufs ?? null,
      'finite LUFS measurement',
    ),
    technicalCheck(
      'render-true-peak-ceiling',
      audioDelivery != null && audioDelivery.truePeakDbfs <= -1,
      audioDelivery?.truePeakDbfs ?? null,
      { maximumDbfs: -1 },
    ),
  ];
  return {
    passed: checks.every((check) => check.pass),
    checks,
    render: renderProbe,
    reference: referenceProbe,
    audioDelivery,
  };
}

function measureAudioDelivery(path, ffmpeg) {
  const log = runFfmpegCapture(ffmpeg, [
    '-hide_banner',
    '-nostats',
    '-i',
    path,
    '-map',
    '0:a:0',
    '-filter:a',
    'ebur128=peak=true',
    '-f',
    'null',
    NULL_DEVICE,
  ]).stderr;
  const integratedMatches = [...log.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s+LUFS/gu)];
  const peakMatches = [...log.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s+dBFS/gu)];
  const integratedLufs = Number(integratedMatches.at(-1)?.[1]);
  const truePeakDbfs = Number(peakMatches.at(-1)?.[1]);
  if (!Number.isFinite(integratedLufs) || !Number.isFinite(truePeakDbfs)) {
    throw new Error('FFmpeg ebur128 did not return integrated loudness and true peak.');
  }
  return {
    integratedLufs,
    truePeakDbfs,
    method: 'FFmpeg ebur128=peak=true',
  };
}

function measureVideoPair({ referencePath, renderPath, timelineRange, canvas, roi, ffmpeg }) {
  const common = videoMetricArguments({
    referencePath,
    renderPath,
    timelineRange,
    canvas,
    roi,
  });
  const ssimLog = runFfmpegCapture(ffmpeg, [
    ...common.inputs,
    '-filter_complex',
    `${common.preparation};[candidate][reference]ssim=shortest=1`,
    '-an',
    '-f',
    'null',
    NULL_DEVICE,
  ]).stderr;
  const psnrLog = runFfmpegCapture(ffmpeg, [
    ...common.inputs,
    '-filter_complex',
    `${common.preparation};[candidate][reference]psnr=shortest=1`,
    '-an',
    '-f',
    'null',
    NULL_DEVICE,
  ]).stderr;
  const ssim = parseLastNumber(ssimLog, /All:([0-9.eE+-]+)/gu, 'SSIM');
  const psnr = parseLastNumberOrInfinity(psnrLog, /average:([0-9.eE+\-]+|inf)/giu, 'PSNR');
  return {
    ssim: round(ssim, 6),
    psnrDb: psnr.infinite ? null : round(psnr.value, 6),
    psnrInfinite: psnr.infinite,
  };
}

function measureVmaf({ referencePath, renderPath, timelineRange, canvas, ffmpeg }) {
  const common = videoMetricArguments({
    referencePath,
    renderPath,
    timelineRange,
    canvas,
    roi: { x: 0, y: 0, width: canvas.width, height: canvas.height },
    pixelFormat: 'yuv420p',
  });
  const log = runFfmpegCapture(ffmpeg, [
    ...common.inputs,
    '-filter_complex',
    `${common.preparation};[candidate][reference]libvmaf=n_threads=4`,
    '-an',
    '-f',
    'null',
    NULL_DEVICE,
  ]).stderr;
  return round(parseLastNumber(log, /VMAF score:\s*([0-9.eE+-]+)/gu, 'VMAF'), 6);
}

function videoMetricArguments({
  referencePath,
  renderPath,
  timelineRange,
  canvas,
  roi,
  pixelFormat = 'yuv444p',
}) {
  const trim = `trim=start_frame=${timelineRange.startFrame}:end_frame=${timelineRange.endFrameExclusive}`;
  const geometry =
    `scale=${canvas.width}:${canvas.height}:flags=bicubic,setsar=1,format=${pixelFormat},` +
    `crop=${roi.width}:${roi.height}:${roi.x}:${roi.y}`;
  return {
    inputs: ['-hide_banner', '-loglevel', 'info', '-i', referencePath, '-i', renderPath],
    preparation:
      `[0:v:0]${trim},setpts=PTS-STARTPTS,${geometry}[reference];` +
      `[1:v:0]${trim},setpts=PTS-STARTPTS,${geometry}[candidate]`,
  };
}

async function detectReferenceActiveArea({ referencePath, timelineRange, canvas, ffmpeg }) {
  const log = runFfmpegCapture(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'info',
    '-i',
    referencePath,
    '-map',
    '0:v:0',
    '-vf',
    `trim=start_frame=${timelineRange.startFrame}:end_frame=${timelineRange.endFrameExclusive},` +
      `scale=${canvas.width}:${canvas.height}:flags=bicubic,cropdetect=limit=0.04:round=2:reset=1`,
    '-an',
    '-f',
    'null',
    NULL_DEVICE,
  ]).stderr;
  const candidates = [...log.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/gu)].map((match) => ({
    width: Number(match[1]),
    height: Number(match[2]),
    x: Number(match[3]),
    y: Number(match[4]),
  }));
  if (candidates.length === 0) {
    throw new Error('Unable to detect active content for a fit-layout metric window.');
  }
  const counts = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.width}:${candidate.height}:${candidate.x}:${candidate.y}`;
    const current = counts.get(key) ?? { count: 0, roi: candidate };
    current.count += 1;
    counts.set(key, current);
  }
  const selected = [...counts.values()].sort(
    (left, right) => right.count - left.count || left.roi.height - right.roi.height,
  )[0]?.roi;
  return validateRoi(selected, canvas, 'detected active area');
}

function decodeAudio(path, { startMs, durationMs, sampleRate, tempo = 1, ffmpeg }) {
  const filters = [
    `atrim=start=${startMs / 1_000}:duration=${durationMs / 1_000}`,
    'asetpts=PTS-STARTPTS',
    ...atempoFilters(tempo),
  ];
  const bytes = runBinary(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-af',
      filters.join(','),
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      'f32le',
      'pipe:1',
    ],
    { maxBuffer: Math.ceil((durationMs / 1_000) * sampleRate * 4 * 1.1) + 65_536 },
  );
  const alignedLength = bytes.length - (bytes.length % 4);
  const copy = Buffer.from(bytes.subarray(0, alignedLength));
  return new Float32Array(copy.buffer, copy.byteOffset, alignedLength / 4).slice();
}

function atempoFilters(value) {
  const tempo = positiveNumber(value, 'audio tempo');
  const factors = [];
  let remaining = tempo;
  while (remaining > 2) {
    factors.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 1e-9 || factors.length > 0) factors.push(remaining);
  return factors.map((factor) => `atempo=${factor}`);
}

function decodeCheck(path, ffmpeg) {
  const result = spawnSync(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-xerror',
      '-i',
      path,
      '-map',
      '0:v:0',
      '-f',
      'null',
      NULL_DEVICE,
    ],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true },
  );
  return {
    pass: result.status === 0 && result.error == null,
    error:
      result.status === 0 && result.error == null
        ? null
        : String(result.error?.message ?? result.stderr ?? 'decode failed').slice(0, 1_000),
  };
}

function runFfmpegCapture(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with exit code ${result.status}: ${String(result.stderr).trim()}`,
    );
  }
  return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
}

function supportsFilter(ffmpeg, name) {
  try {
    return new RegExp(`\\b${name}\\b`, 'u').test(
      runText(ffmpeg, ['-hide_banner', '-filters'], { maxBuffer: 16 * 1024 * 1024 }),
    );
  } catch {
    return false;
  }
}

async function probeAssetDimensions(assetPaths, ffprobe) {
  const entries = await Promise.all(
    Object.entries(assetPaths).map(async ([assetId, path]) => {
      requireFile(path, `source binding ${assetId}`);
      const probe = sanitizeProbe(probeMedia(path, ffprobe));
      const dimensions = displayDimensions(probe.video);
      return [assetId, dimensions];
    }),
  );
  return Object.fromEntries(entries.filter(([, dimensions]) => dimensions != null));
}

async function probeSourceMedia(assetPaths, ffprobe) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(assetPaths).map(async ([assetId, path]) => [
        assetId,
        sanitizeProbe(probeMedia(path, ffprobe)),
      ]),
    ),
  );
}

function displayDimensions(video) {
  if (!video?.codedWidth || !video?.codedHeight) return null;
  const rotated = Math.abs(video.rotationDegrees ?? 0) % 180 === 90;
  return rotated
    ? { width: video.codedHeight, height: video.codedWidth }
    : { width: video.codedWidth, height: video.codedHeight };
}

function resolveFrameRate(definition, referenceVideo) {
  const value = definition?.frameRate ?? resolveProbeFrameRate(referenceVideo);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Unable to determine frame rate.');
  return value;
}

function resolveProbeFrameRate(video) {
  return rationalNumber(video?.averageFrameRate) ?? rationalNumber(video?.nominalFrameRate);
}

function resolveCanvas(definition, referenceVideo) {
  if (definition?.canvas) return validateCanvas(definition.canvas);
  return validateCanvas({ width: referenceVideo.codedWidth, height: referenceVideo.codedHeight });
}

function resolveDurationFrames(definition, referenceVideo, frameRate) {
  const value =
    definition?.durationFrames ??
    referenceVideo.frameCount ??
    Math.round((referenceVideo.durationSeconds ?? 0) * frameRate);
  return positiveInteger(value, 'durationFrames');
}

function resolveReferenceRangeMs(definition, override) {
  if (override) return validateMillisecondsRange(override);
  const music = Array.isArray(definition?.audio?.events)
    ? definition.audio.events.find((event) => event?.kind === 'music')
    : null;
  if (music) {
    return validateMillisecondsRange({ start: music.targetStartMs, end: music.targetEndMs });
  }
  if (definition?.audio?.referenceRangeMs ?? definition?.audio?.masterRangeMs) {
    return validateMillisecondsRange(
      definition.audio.referenceRangeMs ?? definition.audio.masterRangeMs,
    );
  }
  return { ...DEFAULT_REFERENCE_AUDIO_RANGE_MS };
}

function deriveFrameCount(video, frameRate) {
  return video?.frameCount ?? Math.round((video?.durationSeconds ?? 0) * frameRate);
}

function normalizeAssetPaths(input) {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('assetPaths must be an asset-id-to-path object.');
  }
  return Object.fromEntries(
    Object.entries(input).map(([assetId, path]) => [
      requiredString(assetId, 'asset id'),
      resolveInputPath(requiredString(path, `path for ${assetId}`)),
    ]),
  );
}

function normalizeAssetDimensions(input) {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('assetDimensions must be an object.');
  }
  return Object.fromEntries(
    Object.entries(input).map(([assetId, dimensions]) => [assetId, validateCanvas(dimensions)]),
  );
}

function normalizeLayout(value) {
  if (value == null) return 'fill';
  if (!['fit', 'fill', 'crop'].includes(value)) throw new Error(`Unsupported layout: ${value}`);
  return value;
}

function validateCanvas(input, label = 'canvas') {
  if (!input || typeof input !== 'object') throw new Error(`${label} must be an object.`);
  return {
    width: positiveInteger(input.width, `${label}.width`),
    height: positiveInteger(input.height, `${label}.height`),
  };
}

function validateRange(input, durationFrames, label) {
  if (
    !input ||
    !Number.isSafeInteger(input.startFrame) ||
    !Number.isSafeInteger(input.endFrameExclusive) ||
    input.startFrame < 0 ||
    input.endFrameExclusive <= input.startFrame ||
    input.endFrameExclusive > durationFrames
  ) {
    throw new Error(`${label} has an invalid frame range.`);
  }
  return { startFrame: input.startFrame, endFrameExclusive: input.endFrameExclusive };
}

function validateRoi(input, canvas, label) {
  if (
    !input ||
    !Number.isSafeInteger(input.x) ||
    !Number.isSafeInteger(input.y) ||
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.x < 0 ||
    input.y < 0 ||
    input.width < 1 ||
    input.height < 1 ||
    input.x + input.width > canvas.width ||
    input.y + input.height > canvas.height
  ) {
    throw new Error(`${label} has an invalid pixel ROI.`);
  }
  return { x: input.x, y: input.y, width: input.width, height: input.height };
}

function validateMillisecondsRange(input) {
  if (
    !input ||
    !Number.isFinite(input.start) ||
    !Number.isFinite(input.end) ||
    input.start < 0 ||
    input.end <= input.start
  ) {
    throw new Error('Reference-audio range must be a valid millisecond range.');
  }
  return { start: input.start, end: input.end };
}

function parseLastNumber(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) throw new Error(`Unable to parse ${label} from FFmpeg output.`);
  const value = Number(matches.at(-1)[1]);
  if (!Number.isFinite(value)) throw new Error(`${label} was not finite.`);
  return value;
}

function parseLastNumberOrInfinity(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) throw new Error(`Unable to parse ${label} from FFmpeg output.`);
  const token = matches.at(-1)[1];
  if (/^inf$/iu.test(token)) return { value: null, infinite: true };
  const value = Number(token);
  if (!Number.isFinite(value)) throw new Error(`${label} was not finite.`);
  return { value, infinite: false };
}

function pearsonAtLag(left, right, lag) {
  const leftStart = Math.max(0, lag);
  const rightStart = Math.max(0, -lag);
  const length = Math.min(left.length - leftStart, right.length - rightStart);
  if (length < 2) return null;
  let leftSum = 0;
  let rightSum = 0;
  for (let index = 0; index < length; index += 1) {
    leftSum += left[leftStart + index];
    rightSum += right[rightStart + index];
  }
  const leftMean = leftSum / length;
  const rightMean = rightSum / length;
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[leftStart + index] - leftMean;
    const rightValue = right[rightStart + index] - rightMean;
    numerator += leftValue * rightValue;
    leftEnergy += leftValue * leftValue;
    rightEnergy += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator > 1e-20 ? numerator / denominator : null;
}

function decimate(input, stride) {
  const output = new Float32Array(Math.ceil(input.length / stride));
  for (let source = 0, target = 0; source < input.length; source += stride, target += 1) {
    output[target] = input[source];
  }
  return output;
}

function weightedWindowScore(windows) {
  const totalFrames = windows.reduce((sum, window) => sum + rangeLength(window.timelineRange), 0);
  if (totalFrames === 0) return null;
  return round(
    windows.reduce((sum, window) => sum + window.score * rangeLength(window.timelineRange), 0) /
      totalFrames,
    6,
  );
}

function technicalCheck(id, pass, observed, expected) {
  return { id, pass: Boolean(pass), observed, expected };
}

function rangeLength(range) {
  return range.endFrameExclusive - range.startFrame;
}

function isFullCanvas(roi, canvas) {
  return roi.x === 0 && roi.y === 0 && roi.width === canvas.width && roi.height === canvas.height;
}

function near(actual, expected, tolerance) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive integer.`);
  return value;
}

function positiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive.`);
  return value;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredString(value, label) {
  const result = nonEmptyString(value);
  if (!result) throw new Error(`${label} must be a non-empty string.`);
  return result;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolveInputPath(path), 'utf8'));
}

function parseArguments(args) {
  if (args.includes('--help')) return { help: true };
  const allowed = new Set([
    '--render',
    '--reference',
    '--windows',
    '--plan',
    '--source-a',
    '--source-b',
    '--source-a-asset-id',
    '--source-b-asset-id',
    '--source-leakage-measurement',
    '--reference-audio-end-ms',
    '--master-end-ms',
    '--artifact-id',
    '--output',
    '--ffmpeg',
    '--ffprobe',
  ]);
  for (const value of args) {
    if (value.startsWith('--') && !allowed.has(value)) throw new Error(`Unknown option: ${value}`);
  }
  const windowsPath = optionalValue(args, '--windows');
  const planPath = optionalValue(args, '--plan');
  if (windowsPath && planPath) throw new Error('Use either --windows or --plan, not both.');
  return {
    renderPath: requiredValue(args, '--render'),
    referencePath: requiredValue(args, '--reference'),
    definitionPath: windowsPath ?? planPath,
    sourceAPath: optionalValue(args, '--source-a'),
    sourceBPath: optionalValue(args, '--source-b'),
    sourceAAssetId: optionalValue(args, '--source-a-asset-id') ?? 'asset.source-a-original',
    sourceBAssetId: optionalValue(args, '--source-b-asset-id') ?? 'asset.source-b-original',
    sourceLeakagePath: optionalValue(args, '--source-leakage-measurement'),
    referenceAudioEndMs:
      optionalNumber(args, '--reference-audio-end-ms') ?? optionalNumber(args, '--master-end-ms'),
    artifactId: optionalValue(args, '--artifact-id'),
    outputPath: requiredValue(args, '--output'),
    ffmpeg: optionalValue(args, '--ffmpeg') ?? 'ffmpeg',
    ffprobe: optionalValue(args, '--ffprobe') ?? 'ffprobe',
  };
}

function requiredValue(args, name) {
  const value = optionalValue(args, name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function optionalValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function optionalNumber(args, name) {
  const value = optionalValue(args, name);
  if (value == null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} requires a finite number.`);
  return number;
}

function printHelp() {
  console.log(`Usage:
  node scripts/quality/render-metrics-v2.mjs \\
    --render <render.mp4> --reference <target.mp4> \\
    [--plan <edit-plan.json> | --windows <windows.json>] \\
    [--source-a <source-a.mov>] [--source-b <source-b.mov>] \\
    [--source-leakage-measurement <typed-private-measurement.json>] \\
    [--reference-audio-end-ms 40338.6] --output <render-metrics.json>

Fit windows must have source dimensions, an explicit pixel ROI, or a detectable
reference active area. Source-leakage correlation is null unless every mapped
source window is measured or supplied by a SHA-bound typed measurement.`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const definition = options.definitionPath ? await readJson(options.definitionPath) : null;
  const sourceLeakageMeasurement = options.sourceLeakagePath
    ? await readJson(options.sourceLeakagePath)
    : null;
  const assetPaths = {};
  if (options.sourceAPath) assetPaths[options.sourceAAssetId] = options.sourceAPath;
  if (options.sourceBPath) assetPaths[options.sourceBAssetId] = options.sourceBPath;
  const result = await measureRenderMetrics({
    renderPath: options.renderPath,
    referencePath: options.referencePath,
    definition,
    assetPaths,
    sourceLeakageMeasurement,
    referenceRangeMs:
      options.referenceAudioEndMs == null
        ? undefined
        : { start: 0, end: options.referenceAudioEndMs },
    artifactId: options.artifactId,
    ffmpeg: options.ffmpeg,
    ffprobe: options.ffprobe,
  });
  await writeJson(resolve(options.outputPath), result);
  console.log(
    `Measured ${result.windows.length} exact render windows; ` +
      `reference soundtrack correlation=${result.audio.referenceCorrelation ?? 'unavailable'}, ` +
      `source leakage=${result.audio.sourceLeakageCorrelation ?? 'unavailable'}.`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  await main();
}
