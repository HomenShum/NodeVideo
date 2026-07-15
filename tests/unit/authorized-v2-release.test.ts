import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPublishedCaseV2 } from '../../src/lib/published-case-v2';

const fixturesRoot = resolve('fixtures');
const releaseRoot = resolve(fixturesRoot, 'media/authorized-real-v2');

describe('authorized real V2 public release', () => {
  it('verifies the trusted manifest and every declared public asset', async () => {
    const manifestPath = resolve(releaseRoot, 'manifest.json');
    const manifestBytes = await readFile(manifestPath);
    const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
    const loaded = await loadPublishedCaseV2(
      {
        id: 'authorized-real-v2',
        title: 'Authorized audiovisual reconstruction',
        manifestUrl: '/media/authorized-real-v2/manifest.json',
        manifestSha256,
      },
      localFixtureFetch,
    );

    expect(loaded.releasePassed).toBe(true);
    expect(loaded.integrity.verifiedAssetCount).toBe(15);
    expect(loaded.manifest.verdict.releaseBlockers).toEqual([]);
    expect(loaded.manifest.permanentWindow.passed).toBe(true);
    expect(loaded.manifest.soundtrack.sourceAudioMuted).toBe(true);
    expect(loaded.manifest.textSummary).toMatchObject({ cueCount: 31, passed: true });

    const notClaimed = loaded.manifest.claimBoundary.notClaimed.join('\n');
    expect(notClaimed).toMatch(/blind source-only taste/i);
    expect(notClaimed).toMatch(/exact perceptual identity.*VMAF/i);
    expect(notClaimed).toMatch(/decoded-render OCR\/typography/i);
    expect(notClaimed).toMatch(/commercial-track ownership.*redistribution rights/i);
    expect(loaded.manifest.soundtrack.licenseBoundary).toMatch(
      /target-(?:derived|asset derivation).*not.*ownership.*redistribution/i,
    );
  });

  it('binds every checked-in deployment trust anchor to the release manifest', async () => {
    const manifestSha256 = createHash('sha256')
      .update(await readFile(resolve(releaseRoot, 'manifest.json')))
      .digest('hex');
    const [exampleEnvironment, workflow] = await Promise.all([
      readFile(resolve('.env.example'), 'utf8'),
      readFile(resolve('.github/workflows/quality.yml'), 'utf8'),
    ]);

    expect(exampleEnvironment).toContain(`VITE_NODEVIDEO_V2_MANIFEST_SHA256=${manifestSha256}`);
    expect(workflow).toContain(`VITE_NODEVIDEO_V2_MANIFEST_SHA256: ${manifestSha256}`);
  });

  it('publishes no local path or original filename in machine-readable artifacts', async () => {
    const names = await readdir(releaseRoot);
    const textNames = names.filter((name) => /\.(?:json|otio|cube)$/u.test(name));
    const text = (
      await Promise.all(textNames.map((name) => readFile(resolve(releaseRoot, name), 'utf8')))
    ).join('\n');

    expect(text).not.toMatch(/[A-Z]:[\\/]/u);
    expect(text).not.toMatch(/Downloads|\.mov\b|IMG_\d{4}|\b[a-f0-9]{32}\.mp4\b|\(\d+\)\.mp4\b/iu);
    expect(text).not.toMatch(/(?:deviceMake|deviceModel|location|coordinates)/iu);
  });

  it('keeps hash-bound text artifacts LF-only for Git and Linux deployment parity', async () => {
    const names = await readdir(releaseRoot);
    const textNames = names.filter((name) => /\.(?:json|otio|cube)$/u.test(name));
    for (const name of textNames) {
      const bytes = await readFile(resolve(releaseRoot, name));
      expect(bytes.includes(Buffer.from('\r\n')), name).toBe(false);
    }
  });

  it('records passing permanent-window and audio release metrics', async () => {
    const metrics = JSON.parse(await readFile(resolve(releaseRoot, 'render-metrics.json'), 'utf8'));
    const events = JSON.parse(
      await readFile(resolve(releaseRoot, 'event-score-report.json'), 'utf8'),
    );
    const critic = JSON.parse(await readFile(resolve(releaseRoot, 'critic-report.json'), 'utf8'));
    const receipt = JSON.parse(await readFile(resolve(releaseRoot, 'receipt.json'), 'utf8'));
    const permanent = metrics.windows.find(
      (window: { timelineRange: { startFrame: number; endFrameExclusive: number } }) =>
        window.timelineRange.startFrame === 482 && window.timelineRange.endFrameExclusive === 589,
    );

    expect(events).toMatchObject({
      passed: true,
      releaseReady: true,
      releaseReadyScope: 'technical-reconstruction-of-authorized-reference-case',
    });
    expect(events.summary).toMatchObject({ total: 56, passed: 56, failed: 0 });
    expect(events.events.some(({ id }: { id: string }) => id === 'audio-music-rights')).toBe(false);
    expect(events.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'audio-target-derivation-authorization',
          category: 'lineage',
          pass: true,
        }),
        expect.objectContaining({
          id: 'social-overlay-timing:visible-phases',
          category: 'framing',
          pass: true,
        }),
      ]),
    );
    expect(critic).toMatchObject({
      schemaVersion: 'nodevideo.critic-report.v2',
      scores: { taste: null },
      tasteStatus: 'not-evaluated',
    });
    expect(receipt.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'reference-target',
          usage: 'analysis-evaluation-and-authorized-asset-derivation',
        }),
      ]),
    );
    expect(receipt.evaluation).toMatchObject({
      criticScores: { taste: null },
      criticTasteStatus: 'not-evaluated',
      releaseReadyScope: 'technical-reconstruction-of-authorized-reference-case',
    });
    expect(permanent.score).toBeGreaterThanOrEqual(0.9);
    expect(metrics.audio.referenceCorrelation).toBeGreaterThanOrEqual(0.97);
    expect(Math.abs(metrics.audio.sourceLeakageCorrelation)).toBeLessThanOrEqual(0.05);
  });
});

async function localFixtureFetch(input: RequestInfo | URL): Promise<Response> {
  const pathname = typeof input === 'string' ? input : input.toString();
  const relative = pathname.replace(/^\//u, '').replaceAll('/', sep);
  const path = resolve(fixturesRoot, relative);
  if (!path.startsWith(`${fixturesRoot}${sep}`)) return new Response(null, { status: 403 });
  try {
    return new Response(await readFile(path), { status: 200 });
  } catch {
    return new Response(null, { status: 404 });
  }
}
