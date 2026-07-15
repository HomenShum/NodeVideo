import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RENDER_METRICS_SCHEMA_VERSION,
  WINDOW_DEFINITIONS_SCHEMA_VERSION,
  buildMetricWindowSpecs,
  deriveContainRoi,
  measureRenderMetrics,
  waveformCorrelation,
} from '../../scripts/quality/render-metrics-v2.mjs';

let directory: string;
let referencePath: string;
let renderPath: string;
let sourcePath: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nodevideo-render-metrics-'));
  referencePath = join(directory, 'reference.mp4');
  renderPath = join(directory, 'render.mp4');
  sourcePath = join(directory, 'source.mp4');
  generateMedia(referencePath, 'red', 440);
  generateMedia(renderPath, 'blue', 440);
  generateMedia(sourcePath, 'green', 997);
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('render metrics V2', () => {
  it('preserves the permanent frame range and derives the black-padding-free fit ROI', () => {
    const definition = {
      schemaVersion: 'nodevideo.edit-plan.v1',
      frameRate: 30,
      canvas: { width: 720, height: 1280 },
      durationFrames: 1335,
      tracks: [
        {
          id: 'primary',
          kind: 'video',
          role: 'primary',
          clips: [
            {
              id: 'a-fit-2',
              kind: 'source',
              assetId: 'asset.source-a-original',
              timelineRange: { startFrame: 482, endFrameExclusive: 589 },
              sourceRange: { startFrame: 942, endFrameExclusive: 1049 },
              fit: 'fit',
            },
          ],
        },
      ],
    } as any;
    const specs = buildMetricWindowSpecs(definition, {
      canvas: definition.canvas,
      durationFrames: definition.durationFrames,
      assetDimensions: { 'asset.source-a-original': { width: 640, height: 360 } },
    });

    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      timelineRange: { startFrame: 482, endFrameExclusive: 589 },
      roi: { x: 0, y: 437, width: 720, height: 406 },
      roiStrategy: 'source-aspect-contain',
    });
    expect(deriveContainRoi({ width: 720, height: 1280 }, { width: 640, height: 360 })).toEqual({
      x: 0,
      y: 437,
      width: 720,
      height: 406,
    });
  });

  it('scores foreground independently and measures soundtrack and mapped-source leakage', async () => {
    const definition = {
      schemaVersion: WINDOW_DEFINITIONS_SCHEMA_VERSION,
      frameRate: 10,
      canvas: { width: 180, height: 320 },
      durationFrames: 20,
      audio: { masterRangeMs: { start: 0, end: 2_000 } },
      windows: [
        {
          id: 'window.permanent-regression',
          timelineRange: { startFrame: 0, endFrameExclusive: 20 },
          kind: 'source',
          layout: 'fit',
          assetId: 'asset.source-a-original',
          sourceRange: { startFrame: 0, endFrameExclusive: 20 },
          roi: { x: 0, y: 110, width: 180, height: 100 },
        },
      ],
    } as const;

    const result = await measureRenderMetrics({
      renderPath,
      referencePath,
      definition,
      assetPaths: { 'asset.source-a-original': sourcePath },
      maxAudioLagMs: 20,
    });

    expect(result.schemaVersion).toBe(RENDER_METRICS_SCHEMA_VERSION);
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]).toMatchObject({
      id: 'window.permanent-regression',
      timelineRange: { startFrame: 0, endFrameExclusive: 20 },
      metric: 'content-ssim',
      roi: { x: 0, y: 110, width: 180, height: 100, strategy: 'explicit' },
    });
    expect(result.global.ssim).toBeGreaterThan(result.windows[0].score + 0.1);
    expect(result.audio.referenceCorrelation).toBeGreaterThan(0.99);
    expect(result.audio.sourceLeakageCorrelation).not.toBeNull();
    expect(result.audio.sourceLeakageCorrelation as number).toBeLessThan(0.05);
    expect(result.technical.passed).toBe(true);
    expect(result.technical.audioDelivery).toMatchObject({
      method: 'FFmpeg ebur128=peak=true',
    });
  });

  it('does not invent correlation when either waveform has no measurable energy', () => {
    const silence = new Float32Array(1_000);
    const tone = Float32Array.from({ length: 1_000 }, (_, index) => Math.sin(index / 10));
    expect(waveformCorrelation(silence, tone, { sampleRate: 1_000 })).toEqual({
      correlation: null,
      lagMs: null,
      comparedSamples: 0,
    });
  });
});

function generateMedia(path: string, color: string, frequency: number) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=180x320:r=10:d=2',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${frequency}:sample_rate=48000:duration=2`,
      '-vf',
      `drawbox=x=0:y=110:w=180:h=100:color=${color}:t=fill`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      '-y',
      path,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0 || result.error) {
    throw new Error(String(result.error?.message ?? result.stderr));
  }
}
