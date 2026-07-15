import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const groundTruthPath = resolve(
  repoRoot,
  'packs/reference-reconstruct/evals/authorized-real-v2-ground-truth.json',
);
const groundTruth = JSON.parse(readFileSync(groundTruthPath, 'utf8'));

function sourceFiles(root: string): string[] {
  if (!statSync(root).isDirectory()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:mjs|ts|tsx|py)$/u.test(entry.name) ? [path] : [];
  });
}

describe('authorized V2 evaluator-only ground truth', () => {
  it('binds the permanent regression to the corrected Source A phrase', () => {
    const clip = groundTruth.video.clips.find((item: any) => item.permanentRegression);
    expect(clip).toMatchObject({
      id: 'a-fit-2',
      assetId: 'asset.source-a-original',
      timelineRange: { startFrame: 482, endFrameExclusive: 589 },
      sourceRange: { startFrame: 942, endFrameExclusive: 1049 },
      playbackRate: 1,
    });
    expect(groundTruth.releaseGates).toMatchObject({
      sourceInOutToleranceFrames: 1,
      permanentRegressionRange: clip.timelineRange,
      worstWindowMayNotBeMaskedByGlobalAverage: true,
    });
  });

  it('defines a contiguous picture decision list through frame 1335', () => {
    let cursor = 0;
    for (const clip of groundTruth.video.clips) {
      expect(clip.timelineRange.startFrame, clip.id).toBe(cursor);
      expect(clip.timelineRange.endFrameExclusive, clip.id).toBeGreaterThan(cursor);
      if (clip.kind === 'source') {
        expect(clip.sourceRange.endFrameExclusive - clip.sourceRange.startFrame, clip.id).toBe(
          clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame,
        );
      }
      cursor = clip.timelineRange.endFrameExclusive;
    }
    expect(cursor).toBe(groundTruth.video.durationFrames);
  });

  it('makes music, silence, sting, source muting, and timed text release-blocking', () => {
    expect(groundTruth.audio).toMatchObject({
      sourceAudioMode: 'muted',
      music: {
        title: 'Sign',
        artist: '82MAJOR',
        isrc: 'KRA382601866',
        releasedMasterOffsetMs: 29146,
        gainDb: -6.12,
      },
    });
    expect(groundTruth.audio.events.map((event: any) => event.kind)).toEqual([
      'silence',
      'end-sting',
      'silence',
    ]);
    expect(groundTruth.textCues).toHaveLength(31);
    expect(groundTruth.releaseGates.audioRequired).toBe(true);
    expect(groundTruth.releaseGates.textTimingToleranceFrames).toBe(2);
  });

  it('is not imported by analyzer, planner, renderer, critic, or application source', () => {
    const forbiddenReference = 'authorized-real-v2-ground-truth';
    const consumers = [
      resolve(repoRoot, 'scripts/analysis'),
      resolve(repoRoot, 'scripts/workers'),
      resolve(repoRoot, 'src'),
    ].filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    });
    const leaks = consumers
      .flatMap(sourceFiles)
      .filter((path) => readFileSync(path, 'utf8').includes(forbiddenReference))
      .map((path) => relative(repoRoot, path));
    expect(leaks).toEqual([]);
  });
});
