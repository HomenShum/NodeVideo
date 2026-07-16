import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { validateEditPlan as validateCanonicalEditPlan } from '../../src/lib/edit-contracts.ts';
import { REPO_ROOT, requireFile, runText, sha256File } from '../media/media-proof-lib.mjs';

/** @typedef {import('../../src/lib/edit-contracts.ts').EditPlan} EditPlan */

export const EDIT_PLAN_RENDERER_VERSION = 'nodevideo.edit-plan-renderer@0.3.0';
export const SUPPORTED_EDIT_PLAN_SCHEMA = 'nodevideo.edit-plan.v1';
export const RENDERER_FONT = Object.freeze({
  id: 'font.geist-variable-latin',
  path: join(REPO_ROOT, 'packs', 'edit-plan-renderer', 'assets', 'Geist-Variable-Latin.ttf'),
  license: 'OFL-1.1',
  source: '@fontsource-variable/geist@5.2.9',
  sha256: '786b83d6b721df0400f1d4837fcd5a04ae801a3db3f592d46f07796c744d059b',
});

export const FIXED_TEXT_TEMPLATES = Object.freeze({
  'text.cue': Object.freeze({
    fontScale: 0.72,
    minFontSize: 18,
    maxFontSize: 82,
    color: 'white',
    borderColor: 'black@0.86',
    borderWidth: 3,
    shadowColor: 'black@0.55',
    shadowX: 2,
    shadowY: 2,
  }),
  'text.title': Object.freeze({
    fontScale: 0.78,
    minFontSize: 22,
    maxFontSize: 96,
    color: 'white',
    borderColor: 'black@0.9',
    borderWidth: 4,
    shadowColor: 'black@0.6',
    shadowX: 2,
    shadowY: 3,
  }),
  'text.outro': Object.freeze({
    fontScale: 0.64,
    minFontSize: 20,
    maxFontSize: 76,
    color: 'white',
    borderColor: 'black@0.82',
    borderWidth: 3,
    shadowColor: 'black@0.5',
    shadowX: 2,
    shadowY: 2,
  }),
  'text.end-card': Object.freeze({
    fontScale: 0.64,
    minFontSize: 18,
    maxFontSize: 64,
    color: '0x383838',
    borderColor: 'black@0.35',
    borderWidth: 1,
    shadowColor: 'black@0.25',
    shadowX: 1,
    shadowY: 2,
  }),
  'text.creator-commentary': Object.freeze({
    fontScale: 0.4,
    maxWidthRatio: 0.86,
    minFontSize: 18,
    maxFontSize: 70,
    color: 'white',
    borderColor: 'black@0.94',
    borderWidth: 3,
    shadowColor: 'black@0.55',
    shadowX: 1,
    shadowY: 2,
  }),
  'text.creator-title': Object.freeze({
    fontScale: 0.34,
    maxWidthRatio: 0.82,
    minFontSize: 22,
    maxFontSize: 74,
    color: 'white',
    borderColor: 'black@0.92',
    borderWidth: 3,
    shadowColor: 'black@0.6',
    shadowX: 1,
    shadowY: 2,
  }),
  'text.creator-watermark': Object.freeze({
    fontScale: 0.48,
    minFontSize: 14,
    maxFontSize: 42,
    color: 'white',
    borderColor: 'black@0.7',
    borderWidth: 2,
    shadowColor: 'black@0.35',
    shadowX: 1,
    shadowY: 1,
    opacity: 0.84,
    horizontalAlign: 'left',
  }),
  'text.creator-cta': Object.freeze({
    fontScale: 0.3,
    maxWidthRatio: 0.82,
    minFontSize: 20,
    maxFontSize: 70,
    color: 'white',
    borderColor: 'black@0.92',
    borderWidth: 3,
    shadowColor: 'black@0.55',
    shadowX: 1,
    shadowY: 2,
  }),
  'text.creator-end-card': Object.freeze({
    fontScale: 0.5,
    minFontSize: 18,
    maxFontSize: 58,
    color: 'white',
    borderColor: 'black@0.88',
    borderWidth: 3,
    shadowColor: 'black@0.5',
    shadowX: 1,
    shadowY: 2,
  }),
});

export const FIXED_GRAPHIC_TEMPLATES = Object.freeze(
  new Set([
    'graphic.default',
    'graphic.watermark',
    'graphic.end-card',
    'graphic.creator-watermark',
    'graphic.creator-end-card',
  ]),
);

export const FIXED_GRADE_PRESETS = Object.freeze({
  'hlg-bt2020-to-sdr-bt709-hable': Object.freeze([]),
  'hlg-bt2020-to-sdr-bt709-creator-vibrant': Object.freeze([
    'eq=brightness=-0.035:contrast=1.08:saturation=1.38:gamma=0.97',
  ]),
  'hlg-bt2020-to-sdr-bt709-creator-dark-warm': Object.freeze([
    'eq=brightness=-0.18:contrast=1.08:saturation=1.6:gamma=0.88',
    'colorbalance=rs=0.025:gs=-0.01:bs=-0.035:rm=0.012:bm=-0.018',
  ]),
});

const VIDEO_ENCODER_ARGS = Object.freeze([
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '18',
  '-pix_fmt',
  'yuv420p',
  '-colorspace',
  'bt709',
  '-color_trc',
  'bt709',
  '-color_primaries',
  'bt709',
]);

const AUDIO_ENCODER_ARGS = Object.freeze([
  '-c:a',
  'aac',
  '-b:a',
  '192k',
  '-ar',
  '48000',
  '-ac',
  '2',
]);

const FORBIDDEN_EXECUTION_KEYS = new Set([
  'args',
  'command',
  'expression',
  'ffmpeg',
  'filter',
  'filtercomplex',
  'filter_complex',
]);

export class EditPlanValidationError extends Error {
  constructor(issues) {
    super(`EditPlan validation failed:\n- ${issues.join('\n- ')}`);
    this.name = 'EditPlanValidationError';
    this.issues = issues;
  }
}

/**
 * Validate and normalize the canonical EditPlan JSON at the media-plane boundary.
 * Missing `kind` on a video clip is accepted as a temporary v1 legacy alias for `source`.
 *
 * @param {unknown} input
 * @param {unknown} bindingsInput
 * @returns {{plan: EditPlan, bindings: Map<string, string>}}
 */
export function validateEditPlan(input, bindingsInput) {
  const issues = [];
  rejectExecutionKeys(input, '$', issues);
  if (!isRecord(input)) {
    throw new EditPlanValidationError(['$ must be an object']);
  }

  const plan = structuredClone(input);
  for (const track of plan.tracks ?? []) {
    if (track?.kind !== 'video' || !Array.isArray(track.clips)) continue;
    for (const clip of track.clips) {
      if (isRecord(clip) && clip.kind == null && 'sourceRange' in clip) clip.kind = 'source';
    }
  }
  try {
    validateCanonicalEditPlan(plan);
  } catch (error) {
    issues.push(`canonical contract: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (issues.length > 0) throw new EditPlanValidationError(issues);

  if (plan.frameRate > 120) issues.push('renderer v1 supports frame rates up to 120 fps');
  if (plan.canvas.width % 2 !== 0 || plan.canvas.height % 2 !== 0) {
    issues.push('renderer v1 requires an even canvas for yuv420p');
  }
  for (const [trackIndex, track] of plan.tracks.entries()) {
    const trackPath = `tracks[${trackIndex}]`;
    if (track.kind === 'video') {
      if (track.role === 'b-roll') {
        issues.push(`${trackPath} b-roll is unsupported; use a fixed graphic overlay primitive`);
      }
      for (const [clipIndex, clip] of track.clips.entries()) {
        validateRendererVideoClip(clip, `${trackPath}.clips[${clipIndex}]`, issues);
      }
    } else if (track.kind === 'audio') {
      for (const [clipIndex, clip] of track.clips.entries()) {
        validateRendererAudioClip(clip, `${trackPath}.clips[${clipIndex}]`, issues);
      }
    } else {
      for (const [clipIndex, clip] of track.clips.entries()) {
        validateRendererOverlayClip(clip, `${trackPath}.clips[${clipIndex}]`, issues);
      }
    }
  }
  for (const [routeIndex, route] of plan.audio.routing.entries()) {
    if (route.gainDb < -96 || route.gainDb > 24) {
      issues.push(`audio.routing[${routeIndex}].gainDb must be between -96 and 24`);
    }
  }

  const usedAssetIds = referencedAssetIds(plan);
  const bindings = normalizeBindings(bindingsInput, issues);
  for (const assetId of usedAssetIds) {
    if (!bindings.has(assetId)) issues.push(`missing path binding for ${assetId}`);
  }

  if (issues.length > 0) throw new EditPlanValidationError(issues);
  return { plan, bindings };
}

/**
 * Compile a validated plan to one deterministic FFmpeg command and auxiliary text files.
 * Asset paths are emitted only as process arguments, never as plan-authored filter fragments.
 *
 * @param {unknown} input
 * @param {unknown} bindingsInput
 * @param {{outputPath?: string, auxiliaryDirectory?: string}} [options]
 */
export function compileEditPlan(input, bindingsInput, options = {}) {
  const { plan, bindings } = validateEditPlan(input, bindingsInput);
  const outputPath = resolve(options.outputPath ?? 'nodevideo-render.mp4');
  const auxiliaryDirectory = resolve(
    options.auxiliaryDirectory ??
      join(dirname(outputPath), `.nodevideo-${safeFilePart(plan.id)}-v${plan.version}`),
  );
  const inputArgs = [];
  const filters = [];
  const auxiliaryFiles = [];
  const inputRecords = [];
  let inputIndex = 0;

  const addInput = (assetId, purpose, stillImage = false) => {
    const path = bindings.get(assetId);
    const index = inputIndex;
    inputIndex += 1;
    if (stillImage) inputArgs.push('-loop', '1', '-framerate', numeric(plan.frameRate));
    inputArgs.push('-i', path);
    inputRecords.push({ assetId, purpose, inputIndex: index });
    return index;
  };

  const primary = plan.tracks.find((track) => track.kind === 'video' && track.role === 'primary');
  const videoLabels = [];
  for (const [clipIndex, clip] of primary.clips.entries()) {
    const outputLabel = `video_clip_${clipIndex}`;
    const durationFrames = frameCount(clip.timelineRange);
    const kind = clip.kind ?? 'source';
    if (kind === 'black') {
      filters.push(
        `color=c=black:s=${plan.canvas.width}x${plan.canvas.height}:r=${numeric(plan.frameRate)}` +
          `,trim=end_frame=${durationFrames},setpts=N/(${numeric(plan.frameRate)}*TB)` +
          `,format=yuv420p[${outputLabel}]`,
      );
    } else {
      const assetId = clip.assetId;
      const index = addInput(assetId, `video:${kind}:${clip.id}`);
      const sourceFilter =
        kind === 'freeze'
          ? freezeFilter(index, clip, durationFrames, plan, bindings)
          : sourceVideoFilter(index, clip, durationFrames, plan, bindings);
      filters.push(`${sourceFilter}[${outputLabel}]`);
    }
    videoLabels.push(`[${outputLabel}]`);
  }

  filters.push(
    `${videoLabels.join('')}concat=n=${videoLabels.length}:v=1:a=0,trim=end_frame=${plan.durationFrames},setpts=N/(${numeric(plan.frameRate)}*TB),setsar=1[video_stitched]`,
  );

  let currentVideoLabel = 'video_stitched';
  let overlayNumber = 0;
  for (const track of plan.tracks.filter((candidate) => candidate.kind === 'overlay')) {
    for (const clip of track.clips) {
      const nextLabel = `overlay_result_${overlayNumber}`;
      if (clip.kind === 'text') {
        const textPath = join(
          auxiliaryDirectory,
          `${String(overlayNumber).padStart(3, '0')}-${safeFilePart(clip.id)}.txt`,
        );
        auxiliaryFiles.push({
          kind: 'text',
          path: textPath,
          content: normalizeTextFile(clip.text),
        });
        filters.push(
          `[${currentVideoLabel}]${textOverlayFilter(clip, textPath, plan)}` + `[${nextLabel}]`,
        );
      } else {
        const index = addInput(clip.assetId, `graphic:${clip.id}`, true);
        const graphicLabel = `graphic_${overlayNumber}`;
        filters.push(graphicInputFilter(index, clip, graphicLabel, plan));
        filters.push(
          `[${currentVideoLabel}][${graphicLabel}]${graphicOverlayFilter(clip, plan)}` +
            `[${nextLabel}]`,
        );
      }
      currentVideoLabel = nextLabel;
      overlayNumber += 1;
    }
  }
  filters.push(
    `[${currentVideoLabel}]trim=end_frame=${plan.durationFrames}` +
      `,setpts=N/(${numeric(plan.frameRate)}*TB),format=yuv420p[outv]`,
  );

  const audioTracks = plan.tracks.filter((track) => track.kind === 'audio');
  const declaredAudioClips = audioTracks.flatMap((track) => track.clips);
  const eventByClipId = new Map(
    plan.audio.events
      .filter((event) => event.kind !== 'silence')
      .map((event) => [event.clipId, event]),
  );
  const audioLabels = [];
  const audioEndSeconds = [];
  let audioNumber = 0;
  for (const track of audioTracks) {
    const route = plan.audio.routing.find(
      (candidate) => candidate.sourceKind === 'track' && candidate.sourceId === track.id,
    );
    if (route.muted) continue;
    for (const clip of track.clips) {
      const event = eventByClipId.get(clip.id);
      const index = addInput(clip.assetId, `audio:${clip.role}:${clip.id}`);
      const label = `audio_clip_${audioNumber}`;
      filters.push(
        audioClipFilter(index, clip, label, plan, {
          event,
          routeGainDb: route.gainDb,
        }),
      );
      audioLabels.push(`[${label}]`);
      audioEndSeconds.push(
        event ? event.targetEndMs / 1000 : clip.timelineRange.endFrameExclusive / plan.frameRate,
      );
      Object.assign(inputRecords.at(-1), {
        trackRole: track.role,
        bus: route.bus,
        routeId: route.id,
      });
      audioNumber += 1;
    }
  }

  for (const clip of primary.clips.filter((candidate) => candidate.kind === 'source')) {
    const route = plan.audio.routing.find(
      (candidate) => candidate.sourceKind === 'asset-audio' && candidate.sourceId === clip.assetId,
    );
    if (route.muted) continue;
    const index = addInput(clip.assetId, `audio:source-video:${clip.id}`);
    const label = `audio_clip_${audioNumber}`;
    filters.push(
      audioClipFilter(
        index,
        {
          ...clip,
          role: 'source',
          gainDb: 0,
          fadeInFrames: 0,
          fadeOutFrames: 0,
        },
        label,
        plan,
        { routeGainDb: route.gainDb },
      ),
    );
    audioLabels.push(`[${label}]`);
    audioEndSeconds.push(clip.timelineRange.endFrameExclusive / plan.frameRate);
    Object.assign(inputRecords.at(-1), {
      bus: route.bus,
      routeId: route.id,
    });
    audioNumber += 1;
  }

  const silenceEvents = plan.audio.events.filter((event) => event.kind === 'silence');
  for (const event of silenceEvents) {
    const label = `audio_silence_${audioNumber}`;
    const durationSeconds = (event.targetEndMs - event.targetStartMs) / 1000;
    filters.push(
      `anullsrc=r=48000:cl=stereo,atrim=end=${numeric(durationSeconds)}` +
        `,asetpts=PTS-STARTPTS,adelay=${numeric(event.targetStartMs)}|` +
        `${numeric(event.targetStartMs)}[${label}]`,
    );
    audioLabels.push(`[${label}]`);
    audioEndSeconds.push(event.targetEndMs / 1000);
    audioNumber += 1;
  }

  const hasAudio = audioLabels.length > 0;
  if (hasAudio) {
    const lastAudioSecond = Math.max(...audioEndSeconds);
    let audioFilter = `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0`;
    for (const event of silenceEvents) {
      audioFilter +=
        `,volume=volume=0:enable='between(t,${numeric(event.targetStartMs / 1000)},` +
        `${numeric(event.targetEndMs / 1000)})'`;
    }
    audioFilter += `,atrim=end=${numeric(lastAudioSecond)},aresample=48000,alimiter=limit=0.794328:attack=5:release=50:level=0:latency=1[outa]`;
    filters.push(audioFilter);
  }

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...inputArgs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[outv]',
  ];
  if (hasAudio) args.push('-map', '[outa]');
  args.push(
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    ...VIDEO_ENCODER_ARGS,
    '-g',
    String(Math.max(1, Math.round(plan.frameRate))),
    '-keyint_min',
    String(Math.max(1, Math.round(plan.frameRate))),
    '-sc_threshold',
    '0',
  );
  if (hasAudio) args.push(...AUDIO_ENCODER_ARGS);
  args.push('-movflags', '+faststart', outputPath);

  const boundAssets = [...referencedAssetIds(plan)].map((assetId) => ({
    assetId,
    path: bindings.get(assetId),
  }));
  return {
    rendererVersion: EDIT_PLAN_RENDERER_VERSION,
    args,
    filterComplex: filters.join(';'),
    auxiliaryFiles,
    outputPath,
    auxiliaryDirectory,
    inputRecords,
    boundAssets,
    manifest: {
      planId: plan.id,
      planVersion: plan.version,
      schemaVersion: plan.schemaVersion,
      canvas: plan.canvas,
      frameRate: plan.frameRate,
      durationFrames: plan.durationFrames,
      hasAudio,
      videoClipCount: primary.clips.length,
      overlayClipCount: overlayNumber,
      audioClipCount: declaredAudioClips.length,
      renderedAudioClipCount: audioNumber - silenceEvents.length,
      silenceEventCount: silenceEvents.length,
      overlayTemplates: [
        ...new Set(
          plan.tracks
            .filter((track) => track.kind === 'overlay')
            .flatMap((track) => track.clips.map((clip) => clip.templateId)),
        ),
      ].sort(),
      textPlacements: plan.tracks
        .filter((track) => track.kind === 'overlay')
        .flatMap((track) => track.clips)
        .filter((clip) => clip.kind === 'text')
        .map((clip) => textPlacement(clip, plan)),
      gradeKinds: [
        ...new Set(
          primary.clips.filter((clip) => clip.kind !== 'black').map((clip) => clip.grade.kind),
        ),
      ].sort(),
      framePolicy: {
        freezeHolds: 'exact-frame-count',
        oneFrameBlackGaps: 'rejected',
      },
      audioDelivery: hasAudio
        ? {
            limiter: 'ffmpeg-alimiter',
            ceilingLinear: 0.794328,
            nominalCeilingDbfs: -2,
          }
        : null,
      usedAssetIds: boundAssets.map((record) => record.assetId).sort(),
      targetDerivedRenderAssetIds: [...plan.lineage.targetDerivedRenderAssetIds],
      decisionArtifactIds: [...(plan.lineage.decisionArtifactIds ?? [])],
      calibration: plan.lineage.calibration ? structuredClone(plan.lineage.calibration) : null,
      rendererAssets: [
        {
          id: RENDERER_FONT.id,
          license: RENDERER_FONT.license,
          source: RENDERER_FONT.source,
          sha256: RENDERER_FONT.sha256,
        },
      ],
    },
  };
}

/**
 * @param {{plan: unknown, bindings: unknown, outputPath: string, auxiliaryDirectory?: string, ffmpeg?: string}} options
 */
export async function renderEditPlan(options) {
  const compiled = compileEditPlan(options.plan, options.bindings, {
    outputPath: options.outputPath,
    auxiliaryDirectory: options.auxiliaryDirectory,
  });
  for (const binding of compiled.boundAssets) {
    requireFile(binding.path, `bound asset ${binding.assetId}`);
  }
  requireFile(RENDERER_FONT.path, `fixed renderer font ${RENDERER_FONT.id}`);
  const fontDigest = await sha256File(RENDERER_FONT.path);
  if (fontDigest !== RENDERER_FONT.sha256) {
    throw new Error(`fixed renderer font digest mismatch for ${RENDERER_FONT.id}`);
  }
  await mkdir(compiled.auxiliaryDirectory, { recursive: true });
  for (const file of compiled.auxiliaryFiles) {
    await atomicWrite(file.path, file.content);
  }
  await mkdir(dirname(compiled.outputPath), { recursive: true });
  runText(options.ffmpeg ?? process.env.FFMPEG_PATH ?? 'ffmpeg', compiled.args);
  return {
    outputPath: compiled.outputPath,
    rendererVersion: compiled.rendererVersion,
    manifest: compiled.manifest,
  };
}

export async function readEditPlanInputs(planPath, bindingsPath) {
  const [planText, bindingsText] = await Promise.all([
    readFile(resolve(planPath), 'utf8'),
    readFile(resolve(bindingsPath), 'utf8'),
  ]);
  return {
    plan: JSON.parse(planText),
    bindings: JSON.parse(bindingsText),
  };
}

function validateRendererVideoClip(clip, path, issues) {
  if (clip.kind === 'black') {
    if (frameCount(clip.timelineRange) === 1) {
      issues.push(
        `${path} is a one-frame black gap; use a source/freeze hold or an intentional black clip of at least 2 frames`,
      );
    }
    return;
  }
  if (clip.kind === 'source') {
    if (clip.playbackRate < 0.125 || clip.playbackRate > 8) {
      issues.push(`${path}.playbackRate must be between 0.125 and 8`);
    }
    const sourceFrames = frameCount(clip.sourceRange);
    const timelineFrames = frameCount(clip.timelineRange);
    if (Math.abs(sourceFrames / clip.playbackRate - timelineFrames) > 1) {
      issues.push(
        `${path} source duration/playbackRate must match timeline duration within 1 frame`,
      );
    }
  }
  validateRendererLayout(clip, path, issues);
  const supportedGrades = new Set([
    'none',
    'cube-lut',
    'hlg-bt2020-to-sdr-bt709-hable',
    'hlg-bt2020-to-sdr-bt709-hable-cube-lut',
    'hlg-bt2020-to-sdr-bt709-creator-vibrant',
    'hlg-bt2020-to-sdr-bt709-creator-dark-warm',
  ]);
  if (!supportedGrades.has(clip.grade.kind)) {
    issues.push(`${path}.grade.kind is not a fixed renderer v1 color primitive`);
  }
}

function validateRendererAudioClip(clip, path, issues) {
  if (clip.playbackRate < 0.125 || clip.playbackRate > 8) {
    issues.push(`${path}.playbackRate must be between 0.125 and 8`);
  }
  if (clip.gainDb < -96 || clip.gainDb > 24) {
    issues.push(`${path}.gainDb must be between -96 and 24`);
  }
  const sourceFrames = frameCount(clip.sourceRange);
  const timelineFrames = frameCount(clip.timelineRange);
  if (Math.abs(sourceFrames / clip.playbackRate - timelineFrames) > 1) {
    issues.push(`${path} source duration/playbackRate must match timeline duration within 1 frame`);
  }
}

function validateRendererOverlayClip(clip, path, issues) {
  if (clip.kind === 'text') {
    if (!(clip.templateId in FIXED_TEXT_TEMPLATES)) {
      issues.push(`${path}.templateId must name a fixed text template`);
    }
    if (clip.text.length > 500) {
      issues.push(`${path}.text must be at most 500 characters`);
    }
  } else if (!FIXED_GRAPHIC_TEMPLATES.has(clip.templateId)) {
    issues.push(`${path}.templateId must name a fixed graphic template`);
  }
}

function validateRendererLayout(clip, path, issues) {
  if (clip.fit === 'crop') {
    if (clip.cropKeyframes.length !== 1) {
      issues.push(`${path} renderer v1 supports exactly one static crop keyframe`);
    } else if (clip.cropKeyframes[0].timelineFrame !== clip.timelineRange.startFrame) {
      issues.push(`${path} static crop keyframe must start with the clip`);
    }
  } else if (clip.cropKeyframes.length > 0) {
    issues.push(`${path}.cropKeyframes must be empty for fit/fill layouts`);
  }
}

function normalizeBindings(input, issues) {
  const result = new Map();
  if (!isRecord(input)) {
    issues.push('bindings must be an asset-id to path object');
    return result;
  }
  for (const [assetId, path] of Object.entries(input)) {
    if (typeof path !== 'string' || path.trim().length === 0) {
      issues.push(`binding ${assetId} must be a non-empty path string`);
      continue;
    }
    result.set(assetId, resolve(path));
  }
  return result;
}

function sourceVideoFilter(index, clip, durationFrames, plan, bindings) {
  const layout = layoutFilter(clip, plan);
  const grade = gradeFilter(clip.grade, bindings);
  const processing = [grade, layout].filter(Boolean).join(',');
  return (
    `[${index}:v:0]trim=start_frame=${clip.sourceRange.startFrame}:` +
    `end_frame=${clip.sourceRange.endFrameExclusive},setpts=(PTS-STARTPTS)/${numeric(
      clip.playbackRate,
    )}` +
    `,fps=${numeric(plan.frameRate)},trim=end_frame=${durationFrames}` +
    `,setpts=N/(${numeric(plan.frameRate)}*TB),${processing},format=yuv420p`
  );
}

function freezeFilter(index, clip, durationFrames, plan, bindings) {
  const layout = layoutFilter(clip, plan);
  const grade = gradeFilter(clip.grade, bindings);
  const processing = [grade, layout].filter(Boolean).join(',');
  return (
    `[${index}:v:0]trim=start_frame=${clip.sourceFrame}:end_frame=${clip.sourceFrame + 1}` +
    `,setpts=PTS-STARTPTS,fps=${numeric(plan.frameRate)},${processing}` +
    `,tpad=stop_mode=clone:stop=${Math.max(0, durationFrames - 1)}` +
    `,trim=end_frame=${durationFrames},setpts=N/(${numeric(plan.frameRate)}*TB),format=yuv420p`
  );
}

function layoutFilter(clip, plan) {
  const width = plan.canvas.width;
  const height = plan.canvas.height;
  if (clip.fit === 'fit') {
    return `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  }
  if (clip.fit === 'fill') {
    return `scale=w=${width}:h=${height}:force_original_aspect_ratio=increase:force_divisible_by=2:flags=lanczos,crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,setsar=1`;
  }
  const box = clip.cropKeyframes[0].box;
  return (
    `crop=w='max(2,trunc(iw*${numeric(box.width)}/2)*2)':` +
    `h='max(2,trunc(ih*${numeric(box.height)}/2)*2)':` +
    `x='iw*${numeric(box.x)}':y='ih*${numeric(box.y)}',` +
    `scale=${width}:${height}:flags=lanczos,setsar=1`
  );
}

function gradeFilter(grade, bindings) {
  if (grade.kind === 'none') return '';
  if (
    grade.kind === 'hlg-bt2020-to-sdr-bt709-hable' ||
    grade.kind === 'hlg-bt2020-to-sdr-bt709-hable-cube-lut' ||
    grade.kind === 'hlg-bt2020-to-sdr-bt709-creator-vibrant' ||
    grade.kind === 'hlg-bt2020-to-sdr-bt709-creator-dark-warm'
  ) {
    const filters = [
      'zscale=transfer=linear:npl=100',
      'format=gbrpf32le',
      'tonemap=tonemap=hable:desat=0',
      'zscale=primaries=bt709:transfer=bt709:matrix=bt709:range=limited',
      'format=yuv420p',
    ];
    if (grade.kind === 'hlg-bt2020-to-sdr-bt709-hable-cube-lut') {
      filters.push(`lut3d=file='${escapeFilterPath(bindings.get(grade.artifactId))}'`);
    } else {
      filters.push(...(FIXED_GRADE_PRESETS[grade.kind] ?? []));
    }
    return filters.join(',');
  }
  const path = bindings.get(grade.artifactId);
  return `lut3d=file='${escapeFilterPath(path)}'`;
}

function textOverlayFilter(clip, textPath, plan) {
  const template = FIXED_TEXT_TEMPLATES[clip.templateId];
  const placement = textPlacement(clip, plan);
  const { widthPx, heightPx, xPx, yPx, fontSize } = placement;
  const start = clip.timelineRange.startFrame;
  const end = clip.timelineRange.endFrameExclusive - 1;
  const duration = frameCount(clip.timelineRange);
  const animationFrames = Math.max(1, Math.min(6, Math.floor(duration / 2)));
  const xExpression =
    template.horizontalAlign === 'left'
      ? `${xPx}`
      : template.horizontalAlign === 'right'
        ? `${xPx}+${widthPx}-text_w`
        : `${xPx}+(${widthPx}-text_w)/2`;
  let yExpression = `${yPx}+(${heightPx}-text_h)/2`;
  let fontSizeExpression = String(fontSize);
  let alphaExpression = numeric(template.opacity ?? 1);
  if (clip.animation === 'fade') {
    const opacity = numeric(template.opacity ?? 1);
    alphaExpression =
      `${opacity}*if(lt(n,${start + animationFrames}),` +
      `(n-${start}+1)/${animationFrames},` +
      `if(gt(n,${end - animationFrames}),(${end}-n+1)/${animationFrames},1))`;
  } else if (clip.animation === 'pop') {
    fontSizeExpression = `${fontSize}*(0.85+0.15*min(max(n-${start},0)/${animationFrames},1))`;
  } else if (clip.animation === 'slide-up') {
    const offset = Math.max(8, Math.round(heightPx * 0.35));
    yExpression =
      `${yPx}+(${heightPx}-text_h)/2+` +
      `if(lt(n,${start + animationFrames}),${offset}*(1-(n-${start})/${animationFrames}),0)`;
  }
  return [
    `drawtext=textfile='${escapeFilterPath(textPath)}':expansion=none:`,
    `fontfile='${escapeFilterPath(RENDERER_FONT.path)}':fontsize='${fontSizeExpression}':`,
    `fontcolor=${template.color}:bordercolor=${template.borderColor}:`,
    `borderw=${template.borderWidth}:shadowcolor=${template.shadowColor}:`,
    `shadowx=${template.shadowX}:shadowy=${template.shadowY}:`,
    template.boxColor
      ? `box=1:boxcolor=${template.boxColor}:boxborderw=${template.boxBorderWidth}:`
      : '',
    `x='${xExpression}':y='${yExpression}':alpha='${alphaExpression}':`,
    `fix_bounds=1:enable='between(n,${start},${end})'`,
  ].join('');
}

export function textPlacement(clip, plan) {
  const template = FIXED_TEXT_TEMPLATES[clip.templateId];
  const widthPx = Math.max(2, Math.round(clip.box.width * plan.canvas.width));
  const heightPx = Math.max(2, Math.round(clip.box.height * plan.canvas.height));
  const xPx = Math.round(clip.box.x * plan.canvas.width);
  const yPx = Math.round(clip.box.y * plan.canvas.height);
  const emWidth = estimatedTextEmWidth(clip.text);
  const fontSize = clamp(
    Math.min(
      Math.round(heightPx * template.fontScale),
      Math.floor(
        Math.max(1, widthPx * (template.maxWidthRatio ?? 1) - template.borderWidth * 2) / emWidth,
      ),
    ),
    template.minFontSize,
    template.maxFontSize,
  );
  const glyphWidth = Math.min(widthPx, Math.ceil(emWidth * fontSize + template.borderWidth * 2));
  const glyphHeight = Math.min(
    heightPx,
    Math.ceil(fontSize * 1.2 + template.borderWidth * 2 + Math.abs(template.shadowY)),
  );
  const glyphX =
    template.horizontalAlign === 'left'
      ? xPx
      : template.horizontalAlign === 'right'
        ? xPx + widthPx - glyphWidth
        : xPx + (widthPx - glyphWidth) / 2;
  const glyphY = yPx + (heightPx - glyphHeight) / 2;
  return {
    clipId: clip.id,
    box: clip.box,
    fontSize,
    widthPx,
    heightPx,
    xPx,
    yPx,
    estimatedGlyphBox: {
      x: glyphX / plan.canvas.width,
      y: glyphY / plan.canvas.height,
      width: glyphWidth / plan.canvas.width,
      height: glyphHeight / plan.canvas.height,
    },
  };
}

export function estimatedTextEmWidth(text) {
  return Math.max(
    1,
    ...text.split(/\r?\n/u).map((line) =>
      Array.from(line).reduce((width, character) => {
        if (/\s/u.test(character)) return width + 0.33;
        if (/[iIl1|.,'`]/u.test(character)) return width + 0.28;
        if (/[mMwW@#%&]/u.test(character)) return width + 0.86;
        if (/[A-Z]/u.test(character)) return width + 0.62;
        return width + (character.codePointAt(0) > 0xff ? 0.95 : 0.55);
      }, 0),
    ),
  );
}

function graphicInputFilter(index, clip, outputLabel, plan) {
  const durationFrames = frameCount(clip.timelineRange);
  const width = evenDimension(clip.box.width * plan.canvas.width);
  const height = evenDimension(clip.box.height * plan.canvas.height);
  const animationFrames = Math.max(1, Math.min(6, Math.floor(durationFrames / 2)));
  let scale = `scale=${width}:${height}:flags=lanczos`;
  if (clip.animation === 'pop') {
    scale = `scale=w='max(2,trunc(${width}*(0.85+0.15*min(n/${animationFrames},1))/2)*2)':h='max(2,trunc(${height}*(0.85+0.15*min(n/${animationFrames},1))/2)*2)':eval=frame:flags=lanczos`;
  }
  const filters = [
    `[${index}:v:0]fps=${numeric(plan.frameRate)}`,
    'format=rgba',
    `tpad=stop_mode=clone:stop=${Math.max(0, durationFrames - 1)}`,
    `trim=end_frame=${durationFrames}`,
    `setpts=N/(${numeric(plan.frameRate)}*TB)`,
    scale,
    'format=rgba',
  ];
  if (clip.animation === 'fade') {
    const fadeSeconds = seconds(animationFrames, plan.frameRate);
    const outStart = seconds(durationFrames - animationFrames, plan.frameRate);
    filters.push(
      `fade=t=in:st=0:d=${fadeSeconds}:alpha=1`,
      `fade=t=out:st=${outStart}:d=${fadeSeconds}:alpha=1`,
    );
  }
  filters.push(
    `setpts=PTS+${clip.timelineRange.startFrame}/(${numeric(plan.frameRate)}*TB)[${outputLabel}]`,
  );
  return filters.join(',');
}

function graphicOverlayFilter(clip, plan) {
  const boxX = Math.round(clip.box.x * plan.canvas.width);
  const boxY = Math.round(clip.box.y * plan.canvas.height);
  const boxWidth = evenDimension(clip.box.width * plan.canvas.width);
  const boxHeight = evenDimension(clip.box.height * plan.canvas.height);
  const start = clip.timelineRange.startFrame;
  const end = clip.timelineRange.endFrameExclusive - 1;
  const startSeconds = start / plan.frameRate;
  const endSeconds = end / plan.frameRate;
  const duration = frameCount(clip.timelineRange);
  const animationFrames = Math.max(1, Math.min(6, Math.floor(duration / 2)));
  const x = `${boxX}+(${boxWidth}-overlay_w)/2`;
  let y = `${boxY}+(${boxHeight}-overlay_h)/2`;
  if (clip.animation === 'slide-up') {
    const offset = Math.max(8, Math.round(boxHeight * 0.35));
    y +=
      `+if(lt(t,${numeric((start + animationFrames) / plan.frameRate)}),` +
      `${offset}*(1-(t-${numeric(startSeconds)})*${numeric(plan.frameRate)}/${animationFrames}),0)`;
  }
  return (
    `overlay=x='${x}':y='${y}':eof_action=pass:shortest=0:` +
    `enable='between(t,${numeric(startSeconds)},${numeric(endSeconds)})'`
  );
}

function audioClipFilter(index, clip, outputLabel, plan, options = {}) {
  const event = options.event;
  const startSeconds = event
    ? event.sourceOffsetMs / 1000
    : clip.sourceRange.startFrame / plan.frameRate;
  const outputDuration = event
    ? (event.targetEndMs - event.targetStartMs) / 1000
    : frameCount(clip.timelineRange) / plan.frameRate;
  const endSeconds = startSeconds + outputDuration * clip.playbackRate;
  const effectiveGainDb = clip.gainDb + (options.routeGainDb ?? 0);
  const filters = [
    `[${index}:a:0]atrim=start=${numeric(startSeconds)}:end=${numeric(endSeconds)}`,
    'asetpts=PTS-STARTPTS',
    ...atempoFilters(clip.playbackRate),
    `atrim=end=${numeric(outputDuration)}`,
    `volume=${numeric(effectiveGainDb)}dB`,
  ];
  if (clip.fadeInFrames > 0) {
    filters.push(`afade=t=in:st=0:d=${seconds(clip.fadeInFrames, plan.frameRate)}`);
  }
  if (clip.fadeOutFrames > 0) {
    filters.push(
      `afade=t=out:st=${seconds(
        frameCount(clip.timelineRange) - clip.fadeOutFrames,
        plan.frameRate,
      )}:d=${seconds(clip.fadeOutFrames, plan.frameRate)}`,
    );
  }
  const delayMs = event
    ? event.targetStartMs
    : (clip.timelineRange.startFrame / plan.frameRate) * 1000;
  filters.push(
    'aresample=48000',
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    `adelay=${numeric(delayMs)}|${numeric(delayMs)}[${outputLabel}]`,
  );
  return filters.join(',');
}

function atempoFilters(playbackRate) {
  const filters = [];
  let remaining = playbackRate;
  while (remaining > 2 + 1e-9) {
    filters.push('atempo=2');
    remaining /= 2;
  }
  while (remaining < 0.5 - 1e-9) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 1e-9) filters.push(`atempo=${numeric(remaining)}`);
  return filters;
}

function referencedAssetIds(plan) {
  const assetIds = new Set();
  for (const track of plan.tracks) {
    for (const clip of track.clips) {
      if (track.kind === 'video' && clip.kind !== 'black') {
        assetIds.add(clip.assetId);
        if (clip.grade.artifactId) assetIds.add(clip.grade.artifactId);
      } else if (track.kind === 'audio') {
        assetIds.add(clip.assetId);
      } else if (track.kind === 'overlay' && clip.kind === 'graphic') {
        assetIds.add(clip.assetId);
      }
    }
  }
  return assetIds;
}

function rejectExecutionKeys(value, path, issues) {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries())
      rejectExecutionKeys(child, `${path}[${index}]`, issues);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_EXECUTION_KEYS.has(key.toLowerCase())) {
      issues.push(`${path}.${key} is forbidden; plans cannot provide executable FFmpeg fragments`);
    }
    rejectExecutionKeys(child, `${path}.${key}`, issues);
  }
}

function frameCount(range) {
  return range.endFrameExclusive - range.startFrame;
}

function seconds(frames, frameRate) {
  return numeric(frames / frameRate);
}

function numeric(value) {
  if (!Number.isFinite(value)) throw new Error('internal renderer numeric value is not finite');
  return Number(value.toFixed(9)).toString();
}

function evenDimension(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function safeFilePart(value) {
  return (
    String(value)
      .replace(/[^a-zA-Z0-9._-]+/gu, '-')
      .slice(0, 80) || 'item'
  );
}

function normalizeTextFile(value) {
  return [...String(value).replace(/\r\n?/gu, '\n').normalize('NFC')]
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint === 9 || codePoint === 10 || (codePoint >= 32 && codePoint !== 127);
    })
    .join('');
}

function escapeFilterPath(path) {
  return resolve(path).replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}
