import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const caseDir = resolve(process.cwd(), 'fixtures/media/authorized-real-v1');

function readJson(name: string) {
  return JSON.parse(readFileSync(resolve(caseDir, name), 'utf8'));
}

function sha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

const manifest = readJson('case-manifest.json');
const result = readJson('result.json');
const receipt = readJson('receipt.json');

describe('owner-authorized published case', () => {
  it('binds publication to explicit owner consent without publishing source metadata', () => {
    expect(manifest.sourceClass).toBe('owner-authorized-public-real-media');
    expect(manifest.authorization).toMatchObject({
      status: 'owner-authorized-publication',
      sourceContainerMetadataPublished: false,
    });
    expect(manifest.authorization.scope).toContain('NodeVideo public demo');
    expect(receipt.authorization).toEqual(manifest.authorization);
    expect(result.caseId).toBe(manifest.id);
  });

  it('uses neutral public aliases and contains no private paths or container-identifying tags', () => {
    expect(Object.values(result.inputs).map((input: any) => input.publicName)).toEqual([
      'source-a.mov',
      'source-b.mov',
      'target-edit.mp4',
    ]);

    for (const publicPath of [
      ...manifest.sources.flatMap((source: any) => [source.proxyPath, source.releaseAssetName]),
      ...manifest.views.map((view: any) => view.path),
      manifest.posterPath,
      manifest.receiptPath,
      manifest.resultPath,
    ]) {
      expect(isAbsolute(publicPath)).toBe(false);
      expect(publicPath).not.toContain('..');
    }

    const publishedJson = JSON.stringify({ manifest, result, receipt });
    expect(publishedJson).not.toMatch(/[A-Za-z]:[\\/]|\/Users\/|\/home\//i);
    expect(publishedJson).not.toMatch(/IMG_\d{4}\.(?:mov|mp4)/i);
    expect(publishedJson).not.toMatch(/[0-9a-f]{32}\.mp4/i);
    expect(publishedJson).not.toMatch(/[+-]\d{2,3}\.\d{4,}[+-]\d{2,3}\.\d{4,}/);

    const forbiddenMetadataKeys =
      /^(?:location|latitude|longitude|gps|make|model|device|software|encoder|creation_time)$/i;
    expect(
      collectKeys({ manifest, result, receipt }).filter((key) => forbiddenMetadataKeys.test(key)),
    ).toEqual([]);
  });

  it('keeps both MOVs in render lineage and the final MP4 evaluation-only', () => {
    const sourceIds = ['asset.source-a-original', 'asset.source-b-original'];
    expect(result.renderSourceAssetIds).toEqual(sourceIds);
    expect(receipt.lineage.renderInputAssetIds).toEqual(sourceIds);
    expect(result.renderSourceAssetIds).not.toContain('asset.target-edit');
    expect(receipt.lineage.renderInputAssetIds).not.toContain('asset.target-edit');
    expect(result.evaluationSourceAssetIds).toEqual([
      'asset.target-edit',
      'artifact.reconstruction',
    ]);
    expect(receipt.lineage.evaluationInputAssetIds).toEqual(result.evaluationSourceAssetIds);
    expect(result.targetUsage).toBe('analysis-and-evaluation-only');
    expect(result.inputs.target.usage).toBe('analysis-and-evaluation-only');
    expect(receipt.lineage.targetUsage).toBe('analysis-and-evaluation-only');
  });

  it('states the unmatched soundtrack limitation without copying target audio', () => {
    expect(manifest.metrics.targetAudioMatched).toBe(false);
    expect(manifest.metrics.sourceAudioMode).toBe('cut source audio with silent branded tail');
    expect(manifest.limitations.join(' ')).toMatch(/soundtrack is unmatched/i);
    expect(receipt.lineage.audio).toEqual({
      output: 'cut source MOV audio with silent branded tail',
      targetMatched: false,
      targetCopied: false,
    });
    expect(result.evaluation.targetAudioMatched).toBe(false);
    expect(result.evaluation.metricScope).toMatch(/target audio excluded/i);
  });

  it('preserves the exact contiguous 44.5-second edit timeline and cut frames', () => {
    expect(result.cutFrames).toEqual([201, 482, 589, 753]);
    expect(
      result.timeline.map((segment: any) => [segment.outputStartFrame, segment.outputEndFrame]),
    ).toEqual([
      [0, 200],
      [201, 481],
      [482, 588],
      [589, 752],
      [753, 1213],
      [1214, 1214],
      [1215, 1334],
    ]);

    for (const [index, segment] of result.timeline.entries()) {
      expect(segment.outputFrames).toBe(segment.outputEndFrame - segment.outputStartFrame + 1);
      if (index > 0) {
        expect(segment.outputStartFrame).toBe(result.timeline[index - 1].outputEndFrame + 1);
      }
    }

    expect(result.timeline.at(-1).outputEndFrame + 1).toBe(1335);
    expect(result.media.reconstruction.metadata.video).toMatchObject({
      codedWidth: 720,
      codedHeight: 1280,
      frameCount: 1335,
      nominalFrameRate: '30/1',
      durationSeconds: 44.5,
    });
    expect(result.validation.passed).toBe(true);
    expect(result.validation.structuralAssertions.every((assertion: any) => assertion.pass)).toBe(
      true,
    );
  });

  it('derives the published claim tier from measured, matching metrics', () => {
    expect(manifest.metrics).toEqual(result.evaluation);
    expect(receipt.evaluation).toEqual(result.evaluation);
    expect([result.evaluation.ssim, result.evaluation.psnrDb, result.evaluation.vmaf]).toSatisfy(
      (metrics: number[]) => metrics.every(Number.isFinite),
    );

    const footageSsims = result.evaluation.perSegment
      .filter((segment: any) => !['black-transition', 'branded-end-card'].includes(segment.id))
      .map((segment: any) => segment.ssim);
    const expectedTier =
      result.evaluation.ssim >= 0.97 &&
      result.evaluation.psnrDb >= 35 &&
      Math.min(...footageSsims) >= 0.95
        ? 'near-exact-video'
        : result.evaluation.ssim >= 0.9 &&
            result.evaluation.psnrDb >= 25 &&
            Math.min(...footageSsims) >= 0.85
          ? 'perceptually-close-video'
          : 'structure-matched-video';

    expect(manifest.claimTier).toBe(expectedTier);
    expect(result.validation.claimTier).toBe(expectedTier);
  });

  it('finds every published derivative and verifies its declared digest', () => {
    for (const view of manifest.views) {
      const assetPath = resolve(caseDir, view.path);
      expect(existsSync(assetPath), view.path).toBe(true);
      expect(sha256(assetPath), view.path).toBe(view.sha256);
    }

    const posterPath = resolve(caseDir, manifest.posterPath);
    expect(existsSync(posterPath)).toBe(true);
    expect(sha256(posterPath)).toBe(result.media.poster.sha256);

    const resultPath = resolve(caseDir, manifest.resultPath);
    expect(existsSync(resultPath)).toBe(true);
    expect(sha256(resultPath)).toBe(receipt.result.sha256);
  });
});
