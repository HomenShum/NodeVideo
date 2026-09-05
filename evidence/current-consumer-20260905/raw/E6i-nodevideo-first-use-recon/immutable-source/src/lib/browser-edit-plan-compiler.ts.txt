import type { BrowserFfmpegFile } from './browser-ffmpeg';
import {
  type EditPlan,
  type OverlayClip,
  type SourceVideoClip,
  type VideoClip,
  validateEditPlan,
} from './edit-contracts';

export const BROWSER_EDIT_EXPORT_VERSION = 'nodevideo.browser-edit-export@0.1.0' as const;
export const BROWSER_EDIT_EXPORT_FONT = 'Geist-Variable-Latin.ttf' as const;
export const BROWSER_EDIT_EXPORT_OUTPUT = 'nodevideo-edit.mp4' as const;

const MAX_BROWSER_DURATION_SECONDS = 10 * 60;
const MAX_BROWSER_CANVAS_PIXELS = 3840 * 2160;
const MAX_BROWSER_FRAME_RATE = 120;

interface FixedTextTemplate {
  fontScale: number;
  maxWidthRatio?: number;
  minFontSize: number;
  maxFontSize: number;
  color: string;
  borderColor: string;
  borderWidth: number;
  shadowColor: string;
  shadowX: number;
  shadowY: number;
  opacity?: number;
  horizontalAlign?: 'left' | 'right';
}

const FIXED_TEXT_TEMPLATES: Readonly<Record<string, FixedTextTemplate>> = Object.freeze({
  'text.cue': {
    fontScale: 0.72,
    minFontSize: 18,
    maxFontSize: 82,
    color: 'white',
    borderColor: 'black@0.86',
    borderWidth: 3,
    shadowColor: 'black@0.55',
    shadowX: 2,
    shadowY: 2,
  },
  'text.title': {
    fontScale: 0.78,
    minFontSize: 22,
    maxFontSize: 96,
    color: 'white',
    borderColor: 'black@0.9',
    borderWidth: 4,
    shadowColor: 'black@0.6',
    shadowX: 2,
    shadowY: 3,
  },
  'text.outro': {
    fontScale: 0.64,
    minFontSize: 20,
    maxFontSize: 76,
    color: 'white',
    borderColor: 'black@0.82',
    borderWidth: 3,
    shadowColor: 'black@0.5',
    shadowX: 2,
    shadowY: 2,
  },
  'text.end-card': {
    fontScale: 0.64,
    minFontSize: 18,
    maxFontSize: 64,
    color: '0x383838',
    borderColor: 'black@0.35',
    borderWidth: 1,
    shadowColor: 'black@0.25',
    shadowX: 1,
    shadowY: 2,
  },
  'text.creator-commentary': {
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
  },
  'text.creator-title': {
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
  },
  'text.creator-watermark': {
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
  },
  'text.creator-cta': {
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
  },
  'text.creator-end-card': {
    fontScale: 0.5,
    minFontSize: 18,
    maxFontSize: 58,
    color: 'white',
    borderColor: 'black@0.88',
    borderWidth: 3,
    shadowColor: 'black@0.5',
    shadowX: 1,
    shadowY: 2,
  },
});

export interface BrowserEditAssetBinding {
  fileName: string;
}

export type BrowserEditAssetBindings = Readonly<Record<string, string | BrowserEditAssetBinding>>;

export interface BrowserEditPlanCompileOptions {
  fontFileName?: string;
  outputFile?: string;
}

export interface BrowserEditExportManifest {
  rendererVersion: typeof BROWSER_EDIT_EXPORT_VERSION;
  planId: string;
  planVersion: number;
  frameRate: number;
  canvas: { width: number; height: number };
  durationFrames: number;
  durationSeconds: number;
  sourceAssetIds: string[];
  videoClipCount: number;
  textOverlayCount: number;
  container: 'mp4';
  videoCodec: 'h264';
  audio: 'omitted';
  overlayAnimation: 'fixed-plan-animations';
  gradeHandling: 'browser-proxy-sdr';
  cropHandling: 'edit-plan-keyframes' | 'none';
}

export interface CompiledBrowserEditPlan {
  args: string[];
  auxiliaryFiles: BrowserFfmpegFile[];
  inputs: Array<{ assetId: string; fileName: string }>;
  fontFileName: string;
  outputFile: string;
  expectedFrames: number;
  durationSeconds: number;
  manifest: BrowserEditExportManifest;
}

function numeric(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Internal browser export value is not finite.');
  return Number(value.toFixed(9)).toString();
}

function frameCount(range: { startFrame: number; endFrameExclusive: number }): number {
  return range.endFrameExclusive - range.startFrame;
}

function filterLabel(name: string): string {
  return `[${name}]`;
}

function assertSafeVirtualFileName(name: string, label: string): void {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(name) ||
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new Error(`${label} must be a flat, safe MEMFS filename.`);
  }
}

function bindingFileName(bindings: BrowserEditAssetBindings, assetId: string): string {
  const binding = bindings[assetId];
  const fileName = typeof binding === 'string' ? binding : binding?.fileName;
  if (!fileName) throw new Error(`Missing browser media binding for ${assetId}.`);
  assertSafeVirtualFileName(fileName, `binding ${assetId}`);
  return fileName;
}

function layoutFilter(clip: Exclude<VideoClip, { kind: 'black' }>, plan: EditPlan): string {
  const { width, height } = plan.canvas;
  if (clip.cropKeyframes.length) {
    const keyframes = [...clip.cropKeyframes].sort(
      (left, right) => left.timelineFrame - right.timelineFrame,
    );
    const first = keyframes[0];
    const constantSize = keyframes.every(
      (item) =>
        Math.abs(item.box.width - first.box.width) < 0.000001 &&
        Math.abs(item.box.height - first.box.height) < 0.000001,
    );
    if (!constantSize) {
      throw new Error(`Browser export requires a constant Smart Reframe crop size (${clip.id}).`);
    }
    const axisExpression = (axis: 'x' | 'y') => {
      const local = keyframes.map((item) => ({
        frame: Math.max(0, item.timelineFrame - clip.timelineRange.startFrame),
        value: item.box[axis],
      }));
      let expression = numeric(local.at(-1)?.value ?? 0);
      for (let index = local.length - 2; index >= 0; index -= 1) {
        const current = local[index];
        const next = local[index + 1];
        const span = Math.max(1, next.frame - current.frame);
        const interpolation = `${numeric(current.value)}+(${numeric(next.value - current.value)})*max(0\,min(1\,(n-${current.frame})/${span}))`;
        expression = `if(lte(n\,${next.frame})\,${interpolation}\,${expression})`;
      }
      return expression;
    };
    return (
      `crop=w='trunc(iw*${numeric(first.box.width)}/2)*2':` +
      `h='trunc(ih*${numeric(first.box.height)}/2)*2':` +
      `x='iw*(${axisExpression('x')})':y='ih*(${axisExpression('y')})',` +
      `scale=w=${width}:h=${height}:flags=lanczos,setsar=1`
    );
  }
  if (clip.fit === 'fit') {
    return `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  }
  return (
    `scale=w=${width}:h=${height}:force_original_aspect_ratio=increase:` +
    `force_divisible_by=2:flags=lanczos,crop=${width}:${height}:` +
    `(iw-${width})/2:(ih-${height})/2,setsar=1`
  );
}

function estimatedTextEmWidth(text: string): number {
  return Math.max(
    1,
    ...text.split(/\r?\n/u).map((line) =>
      Array.from(line).reduce((width, character) => {
        if (/\s/u.test(character)) return width + 0.33;
        if (/[iIl1|.,'`]/u.test(character)) return width + 0.28;
        if (/[mMwW@#%&]/u.test(character)) return width + 0.86;
        if (/[A-Z]/u.test(character)) return width + 0.62;
        return width + ((character.codePointAt(0) ?? 0) > 0xff ? 0.95 : 0.55);
      }, 0),
    ),
  );
}

function textOverlayFilter(
  clip: OverlayClip,
  textFileName: string,
  fontFileName: string,
  plan: EditPlan,
): string {
  const template = FIXED_TEXT_TEMPLATES[clip.templateId];
  if (!template || clip.kind !== 'text' || clip.text === undefined) {
    throw new Error(`Unsupported browser text template: ${clip.templateId}.`);
  }
  const widthPx = Math.max(2, Math.round(clip.box.width * plan.canvas.width));
  const heightPx = Math.max(2, Math.round(clip.box.height * plan.canvas.height));
  const xPx = Math.round(clip.box.x * plan.canvas.width);
  const yPx = Math.round(clip.box.y * plan.canvas.height);
  const availableWidth = Math.max(
    1,
    widthPx * (template.maxWidthRatio ?? 1) - template.borderWidth * 2,
  );
  const fontSize = Math.min(
    template.maxFontSize,
    Math.max(
      template.minFontSize,
      Math.min(
        Math.round(heightPx * template.fontScale),
        Math.floor(availableWidth / estimatedTextEmWidth(clip.text)),
      ),
    ),
  );
  const xExpression =
    template.horizontalAlign === 'left'
      ? `${xPx}`
      : template.horizontalAlign === 'right'
        ? `${xPx}+${widthPx}-text_w`
        : `${xPx}+(${widthPx}-text_w)/2`;
  const start = clip.timelineRange.startFrame;
  const end = clip.timelineRange.endFrameExclusive - 1;
  const duration = frameCount(clip.timelineRange);
  const animationFrames = Math.max(1, Math.min(6, Math.floor(duration / 2)));
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
  return (
    `drawtext=textfile=/${textFileName}:expansion=none:fontfile=/${fontFileName}:` +
    `fontsize='${fontSizeExpression}':fontcolor=${template.color}:` +
    `bordercolor=${template.borderColor}:` +
    `borderw=${template.borderWidth}:shadowcolor=${template.shadowColor}:` +
    `shadowx=${template.shadowX}:shadowy=${template.shadowY}:` +
    `x='${xExpression}':y='${yExpression}':alpha='${alphaExpression}':` +
    `fix_bounds=1:enable='between(n,${start},${end})'`
  );
}

function normalizeTextFile(text: string): string {
  return text.replace(/\0/gu, '\uFFFD').replace(/\r\n?/gu, '\n');
}

function validateBrowserProfile(plan: EditPlan): void {
  if (plan.frameRate > MAX_BROWSER_FRAME_RATE) {
    throw new Error(`Browser export supports frame rates up to ${MAX_BROWSER_FRAME_RATE} fps.`);
  }
  if (plan.canvas.width % 2 !== 0 || plan.canvas.height % 2 !== 0) {
    throw new Error('Browser H.264 export requires even canvas dimensions.');
  }
  if (plan.canvas.width * plan.canvas.height > MAX_BROWSER_CANVAS_PIXELS) {
    throw new Error('Browser export canvas exceeds the 3840x2160 safety limit.');
  }
  if (plan.durationFrames / plan.frameRate > MAX_BROWSER_DURATION_SECONDS) {
    throw new Error('Browser export duration exceeds the 10-minute safety limit.');
  }
  if (plan.tracks.some((track) => track.kind === 'video' && track.role === 'b-roll')) {
    throw new Error('Browser export does not support b-roll video tracks.');
  }
  for (const track of plan.tracks) {
    if (track.kind === 'overlay') {
      for (const clip of track.clips) {
        if (clip.kind !== 'text') {
          throw new Error(`Browser export does not support graphic overlay ${clip.id}.`);
        }
        if (!(clip.templateId in FIXED_TEXT_TEMPLATES)) {
          throw new Error(`Browser export does not support text template ${clip.templateId}.`);
        }
        if ((clip.text?.length ?? 0) > 500) {
          throw new Error(`Browser export text overlay ${clip.id} exceeds 500 characters.`);
        }
      }
      continue;
    }
    if (track.kind !== 'video') continue;
    for (const clip of track.clips) {
      if (clip.kind === 'black') continue;
      if (clip.fit === 'crop' && clip.cropKeyframes.length === 0) {
        throw new Error(`Browser crop export requires crop keyframes (${clip.id}).`);
      }
      if (clip.grade.kind !== 'none' && clip.grade.kind !== 'hlg-bt2020-to-sdr-bt709-hable') {
        throw new Error(`Browser export does not support grade ${clip.grade.kind} (${clip.id}).`);
      }
      if (clip.kind === 'source') {
        if (clip.playbackRate < 0.125 || clip.playbackRate > 8) {
          throw new Error(`Browser export playbackRate is out of range (${clip.id}).`);
        }
        const sourceFrames = frameCount(clip.sourceRange);
        const timelineFrames = frameCount(clip.timelineRange);
        if (Math.abs(sourceFrames / clip.playbackRate - timelineFrames) > 1) {
          throw new Error(`Browser export source/timeline duration mismatch (${clip.id}).`);
        }
      }
    }
  }
}

export function compileBrowserEditPlan(
  input: unknown,
  bindings: BrowserEditAssetBindings,
  options: BrowserEditPlanCompileOptions = {},
): CompiledBrowserEditPlan {
  validateEditPlan(input);
  const plan = input;
  validateBrowserProfile(plan);

  const fontFileName = options.fontFileName ?? BROWSER_EDIT_EXPORT_FONT;
  const outputFile = options.outputFile ?? BROWSER_EDIT_EXPORT_OUTPUT;
  assertSafeVirtualFileName(fontFileName, 'fontFileName');
  assertSafeVirtualFileName(outputFile, 'outputFile');
  if (fontFileName === outputFile) throw new Error('Font and output filenames must differ.');

  const primary = plan.tracks.find((track) => track.kind === 'video' && track.role === 'primary');
  if (!primary || primary.kind !== 'video') {
    throw new Error('Browser export requires one primary video track.');
  }

  const usageCounts = new Map<string, number>();
  for (const clip of primary.clips) {
    if (clip.kind !== 'black') {
      usageCounts.set(clip.assetId, (usageCounts.get(clip.assetId) ?? 0) + 1);
    }
  }
  const inputs = Array.from(usageCounts.keys()).map((assetId) => ({
    assetId,
    fileName: bindingFileName(bindings, assetId),
  }));
  const occupiedNames = new Set([fontFileName, outputFile]);
  for (const inputBinding of inputs) {
    if (occupiedNames.has(inputBinding.fileName)) {
      throw new Error(`Duplicate browser export filename: ${inputBinding.fileName}.`);
    }
    occupiedNames.add(inputBinding.fileName);
  }

  const filters: string[] = [];
  const inputLabels = new Map<string, string[]>();
  for (const [inputIndex, binding] of inputs.entries()) {
    const count = usageCounts.get(binding.assetId) ?? 0;
    if (count === 1) {
      inputLabels.set(binding.assetId, [`${inputIndex}:v:0`]);
      continue;
    }
    const labels = Array.from({ length: count }, (_, index) => `asset_${inputIndex}_${index}`);
    filters.push(
      `[${inputIndex}:v:0]split=${count}${labels.map((label) => `[${label}]`).join('')}`,
    );
    inputLabels.set(binding.assetId, [...labels]);
  }

  const clipLabels: string[] = [];
  for (const [clipIndex, clip] of primary.clips.entries()) {
    const outputLabel = `video_clip_${clipIndex}`;
    const durationFrames = frameCount(clip.timelineRange);
    if (clip.kind === 'black') {
      filters.push(
        `color=c=black:s=${plan.canvas.width}x${plan.canvas.height}:r=${numeric(plan.frameRate)}` +
          `,trim=end_frame=${durationFrames},setpts=N/(${numeric(plan.frameRate)}*TB)` +
          `,format=yuv420p[${outputLabel}]`,
      );
    } else {
      const sourceLabel = inputLabels.get(clip.assetId)?.shift();
      if (!sourceLabel) throw new Error(`Internal browser input allocation failed for ${clip.id}.`);
      const layout = layoutFilter(clip, plan);
      if (clip.kind === 'source') {
        const source = clip as SourceVideoClip;
        filters.push(
          `[${sourceLabel}]trim=start=${numeric(source.sourceRange.startFrame / plan.frameRate)}:` +
            `end=${numeric(source.sourceRange.endFrameExclusive / plan.frameRate)}` +
            `,setpts=(PTS-STARTPTS)/${numeric(source.playbackRate)},fps=${numeric(plan.frameRate)}` +
            `,trim=end_frame=${durationFrames},setpts=N/(${numeric(plan.frameRate)}*TB)` +
            `,${layout},format=yuv420p[${outputLabel}]`,
        );
      } else {
        filters.push(
          `[${sourceLabel}]trim=start=${numeric(clip.sourceFrame / plan.frameRate)}:` +
            `end=${numeric((clip.sourceFrame + 1) / plan.frameRate)}` +
            `,setpts=PTS-STARTPTS,fps=${numeric(plan.frameRate)},${layout}` +
            `,tpad=stop_mode=clone:stop=${Math.max(0, durationFrames - 1)}` +
            `,trim=end_frame=${durationFrames},setpts=N/(${numeric(plan.frameRate)}*TB)` +
            `,format=yuv420p[${outputLabel}]`,
        );
      }
    }
    clipLabels.push(`[${outputLabel}]`);
  }

  filters.push(
    `${clipLabels.join('')}concat=n=${clipLabels.length}:v=1:a=0,trim=end_frame=${plan.durationFrames},setpts=N/(${numeric(plan.frameRate)}*TB),setsar=1${filterLabel('video_stitched')}`,
  );

  const auxiliaryFiles: BrowserFfmpegFile[] = [];
  let currentLabel = 'video_stitched';
  let overlayIndex = 0;
  for (const track of plan.tracks) {
    if (track.kind !== 'overlay') continue;
    for (const clip of track.clips) {
      const textFileName = `overlay-${String(overlayIndex).padStart(3, '0')}.txt`;
      if (occupiedNames.has(textFileName)) {
        throw new Error(`Duplicate browser export filename: ${textFileName}.`);
      }
      occupiedNames.add(textFileName);
      auxiliaryFiles.push({ name: textFileName, data: normalizeTextFile(clip.text ?? '') });
      const nextLabel = `overlay_result_${overlayIndex}`;
      filters.push(
        `[${currentLabel}]${textOverlayFilter(clip, textFileName, fontFileName, plan)}` +
          `[${nextLabel}]`,
      );
      currentLabel = nextLabel;
      overlayIndex += 1;
    }
  }
  filters.push(
    `[${currentLabel}]trim=end_frame=${plan.durationFrames},` +
      `setpts=N/(${numeric(plan.frameRate)}*TB),format=yuv420p${filterLabel('outv')}`,
  );

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-progress',
    'pipe:1',
    '-nostats',
    ...inputs.flatMap(({ fileName }) => ['-i', fileName]),
    '-filter_complex_threads',
    '1',
    '-filter_complex',
    filters.join(';'),
    '-map',
    filterLabel('outv'),
    '-an',
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-colorspace',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_primaries',
    'bt709',
    '-g',
    String(Math.max(1, Math.round(plan.frameRate))),
    '-keyint_min',
    String(Math.max(1, Math.round(plan.frameRate))),
    '-sc_threshold',
    '0',
    '-movflags',
    '+faststart',
    outputFile,
  ];

  return {
    args,
    auxiliaryFiles,
    inputs,
    fontFileName,
    outputFile,
    expectedFrames: plan.durationFrames,
    durationSeconds: plan.durationFrames / plan.frameRate,
    manifest: {
      rendererVersion: BROWSER_EDIT_EXPORT_VERSION,
      planId: plan.id,
      planVersion: plan.version,
      frameRate: plan.frameRate,
      canvas: { ...plan.canvas },
      durationFrames: plan.durationFrames,
      durationSeconds: plan.durationFrames / plan.frameRate,
      sourceAssetIds: inputs.map(({ assetId }) => assetId),
      videoClipCount: primary.clips.length,
      textOverlayCount: overlayIndex,
      container: 'mp4',
      videoCodec: 'h264',
      audio: 'omitted',
      overlayAnimation: 'fixed-plan-animations',
      gradeHandling: 'browser-proxy-sdr',
      cropHandling: primary.clips.some(
        (clip) => clip.kind !== 'black' && clip.cropKeyframes.length > 0,
      )
        ? 'edit-plan-keyframes'
        : 'none',
    },
  };
}
