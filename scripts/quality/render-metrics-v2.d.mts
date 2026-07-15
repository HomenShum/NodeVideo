import type { EditPlan, FrameRange } from '../../src/lib/edit-contracts';

export const RENDER_METRICS_SCHEMA_VERSION: 'nodevideo.render-metrics.v1';
export const RENDER_METRICS_TOOL_VERSION: 'nodevideo.render-metrics-v2@1.1.0';
export const WINDOW_DEFINITIONS_SCHEMA_VERSION: 'nodevideo.render-metric-windows.v1';
export const SOURCE_LEAKAGE_SCHEMA_VERSION: 'nodevideo.source-leakage-measurement.v1';
export const DEFAULT_REFERENCE_AUDIO_RANGE_MS: Readonly<{ start: 0; end: 40338.6 }>;
/** @deprecated Use DEFAULT_REFERENCE_AUDIO_RANGE_MS. */
export const DEFAULT_MASTER_RANGE_MS: Readonly<{ start: 0; end: 40338.6 }>;

export interface PixelRoi {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MetricWindowDefinition {
  id: string;
  timelineRange: FrameRange;
  kind?: 'source' | 'freeze' | 'black';
  layout?: 'fit' | 'fill' | 'crop';
  assetId?: string;
  sourceRange?: FrameRange;
  playbackRate?: number;
  roi?: PixelRoi;
}

export interface MetricWindowDocument {
  schemaVersion: typeof WINDOW_DEFINITIONS_SCHEMA_VERSION;
  frameRate: number;
  canvas: { width: number; height: number };
  durationFrames: number;
  assetDimensions?: Record<string, { width: number; height: number }>;
  audio?: {
    referenceRangeMs?: { start: number; end: number };
    masterRangeMs?: { start: number; end: number };
  };
  windows: readonly MetricWindowDefinition[];
}

export interface MetricWindowSpec {
  id: string;
  timelineRange: FrameRange;
  kind: string;
  layout: 'fit' | 'fill' | 'crop';
  assetId: string | null;
  sourceRange: FrameRange | null;
  playbackRate: number;
  roi: PixelRoi | null;
  roiStrategy: string;
}

export interface RenderMetrics {
  schemaVersion: typeof RENDER_METRICS_SCHEMA_VERSION;
  toolVersion: typeof RENDER_METRICS_TOOL_VERSION;
  artifactId: string;
  inputs: { renderSha256: string; referenceSha256: string };
  frameRate: number;
  canvas: { width: number; height: number };
  durationFrames: number;
  global: {
    score: number;
    metric: 'ssim';
    ssim: number;
    psnrDb: number | null;
    psnrInfinite: boolean;
    vmaf: number | null;
    contentWeightedSsim: number | null;
    warning: string;
  };
  windows: Array<{
    id: string;
    timelineRange: FrameRange;
    score: number;
    metric: 'ssim' | 'content-ssim';
    roi: PixelRoi & { strategy: string };
    ssim: number;
    psnrDb: number | null;
    psnrInfinite: boolean;
  }>;
  audio: {
    referenceCorrelation: number | null;
    sourceLeakageCorrelation: number | null;
    reference: unknown;
    sourceLeakage: unknown;
  };
  technical: {
    passed: boolean;
    checks: unknown[];
    render: unknown;
    reference: unknown;
    audioDelivery: unknown;
  };
  provenance: unknown;
}

export function measureRenderMetrics(options: {
  renderPath: string;
  referencePath: string;
  definition?: EditPlan | MetricWindowDocument | null;
  assetPaths?: Record<string, string>;
  assetDimensions?: Record<string, { width: number; height: number }>;
  sourceLeakageMeasurement?: unknown;
  referenceRangeMs?: { start: number; end: number };
  /** @deprecated Use referenceRangeMs. */
  masterRangeMs?: { start: number; end: number };
  audioSampleRate?: number;
  maxAudioLagMs?: number;
  artifactId?: string;
  ffmpeg?: string;
  ffprobe?: string;
}): Promise<RenderMetrics>;

export function buildMetricWindowSpecs(
  definition: EditPlan | MetricWindowDocument | null,
  context: {
    canvas: { width: number; height: number };
    durationFrames: number;
    assetDimensions?: Record<string, { width: number; height: number }>;
  },
): MetricWindowSpec[];

export function deriveContainRoi(
  canvas: { width: number; height: number },
  source: { width: number; height: number },
): PixelRoi;

export function waveformCorrelation(
  left: Float32Array,
  right: Float32Array,
  options: { sampleRate: number; maxLagMs?: number; absolute?: boolean },
): { correlation: number | null; lagMs: number | null; comparedSamples: number };
