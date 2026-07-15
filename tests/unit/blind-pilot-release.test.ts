import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPublishedBlindPilot } from '../../src/lib/published-blind-pilot';

const fixturesRoot = resolve('fixtures');
const releaseRoot = resolve(fixturesRoot, 'media/blind-source-only-pilot-01');
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

describe('blind source-only public pilot', () => {
  it('verifies the trusted manifest, preview, and all frozen/post-freeze artifacts', async () => {
    const manifestBytes = await readFile(resolve(releaseRoot, 'manifest.json'));
    const loaded = await loadPublishedBlindPilot(
      {
        id: 'blind-source-only-pilot-01',
        manifestSha256: sha256(manifestBytes),
        manifestUrl: '/media/blind-source-only-pilot-01/manifest.json',
        title: 'Blind source-only pilot',
      },
      localFixtureFetch,
    );
    expect(loaded.protocolPassed).toBe(true);
    expect(loaded.integrity.verifiedAssetCount).toBe(9);
    expect(loaded.manifest.verdict).toMatchObject({
      protocolStatus: 'passed',
      tasteEvidenceRef: null,
      tasteStatus: 'awaiting-blinded-human-evaluation',
    });
    expect(loaded.manifest.musicHandoff).toMatchObject({
      artist: 'Doja Cat',
      availabilityStatus: 'confirm-in-instagram',
      commercialAudioPublished: false,
      referenceBasis: 'catalog-preview-relative',
      title: 'Woman',
    });
  });

  it('binds local and CI deployment anchors to the current blind manifest', async () => {
    const digest = sha256(await readFile(resolve(releaseRoot, 'manifest.json')));
    const [exampleEnvironment, workflow] = await Promise.all([
      readFile(resolve('.env.example'), 'utf8'),
      readFile(resolve('.github/workflows/quality.yml'), 'utf8'),
    ]);
    expect(exampleEnvironment).toContain(`VITE_NODEVIDEO_BLIND_MANIFEST_SHA256=${digest}`);
    expect(workflow).toContain(`VITE_NODEVIDEO_BLIND_MANIFEST_SHA256: ${digest}`);
  });

  it('proves the frozen generation inputs are exactly the published source proxies', async () => {
    const [freeze, sourceA, sourceB] = await Promise.all([
      readJson('freeze.json'),
      readFile(resolve(fixturesRoot, 'media/authorized-real-v1/source-a-web.mp4')),
      readFile(resolve(fixturesRoot, 'media/authorized-real-v1/source-b-web.mp4')),
    ]);
    const inputs = freeze.files.filter(({ role }: { role: string }) => role === 'input');
    expect(inputs.map(({ sha256: hash }: { sha256: string }) => hash)).toEqual([
      sha256(sourceA),
      sha256(sourceB),
    ]);
    expect(freeze.isolation_attested).toBe(true);
    expect(freeze.preview_audio).toMatch(/synthetic 108 bpm metronome only/i);
  });

  it('keeps target access post-freeze and reports technical deltas without inventing taste', async () => {
    const [evaluation, manifest, freezeBytes, editPlan, receipt] = await Promise.all([
      readJson('held-out-evaluation.json'),
      readJson('manifest.json'),
      readFile(resolve(releaseRoot, 'freeze.json')),
      readJson('edit-plan.json'),
      readJson('redaction-receipt.json'),
    ]);
    expect(evaluation.runOrder).toMatchObject({ targetWasReadAfterFreezeVerification: true });
    expect(evaluation.runOrder.generationFreezeSha256).toBe(sha256(freezeBytes));
    expect(Date.parse(evaluation.runOrder.targetUnsealedAt)).toBeGreaterThanOrEqual(
      Date.parse(evaluation.runOrder.freezeVerifiedAt),
    );
    expect(evaluation.isolationAudit).toMatchObject({ passed: true });
    expect(evaluation.isolationAudit.privateReadLogSha256).toBe(receipt.sourcePrivateReadLogSha256);
    expect(evaluation.technicalComparison.agentDurationSeconds).toBe(
      editPlan.output.duration_seconds,
    );
    expect(evaluation.technicalComparison.cutBoundaries).toMatchObject({
      f1: 0.4,
      precision: 0.25,
      recall: 1,
    });
    expect(evaluation.technicalComparison.sourceIdentityCoverageWithinAgentHorizon.ratio).toBe(
      0.335206,
    );
    expect(evaluation.taste).toMatchObject({
      score: null,
      status: 'awaiting-blinded-human-evaluation',
    });
    expect(manifest.claimBoundary.notClaimed.join('\n')).toMatch(/general creative superiority/i);
  });

  it('publishes a redacted audit trail and no commercial preview audio file', async () => {
    const [freeze, log, receipt] = await Promise.all([
      readJson('freeze.json'),
      readFile(resolve(releaseRoot, 'read-log.json')),
      readJson('redaction-receipt.json'),
    ]);
    const privateHash = freeze.files.find(
      ({ path }: { path: string }) => path === 'read-log.json',
    ).sha256;
    expect(receipt.sourcePrivateReadLogSha256).toBe(privateHash);
    expect(receipt.publicReadLogSha256).toBe(sha256(log));
    expect(log.toString('utf8')).not.toMatch(/[A-Z]:[\\/]|VSCode Projects|Downloads|IMG_\d+/u);
    const names = await readdir(releaseRoot);
    expect(names.some((name) => /\.(?:m4a|mp3|wav|aac)$/iu.test(name))).toBe(false);
  });

  it('keeps the held-out comparison silent and every text artifact LF-only', async () => {
    const probe = spawnSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type',
        '-of',
        'json',
        resolve(releaseRoot, 'held-out-comparison.mp4'),
      ],
      { encoding: 'utf8' },
    );
    expect(probe.status, probe.stderr).toBe(0);
    expect(JSON.parse(probe.stdout).streams).toEqual([{ codec_type: 'video' }]);
    const textNames = (await readdir(releaseRoot)).filter((name) => /\.(?:json|md)$/u.test(name));
    for (const name of textNames) {
      expect((await readFile(resolve(releaseRoot, name))).includes(Buffer.from('\r\n')), name).toBe(
        false,
      );
    }
  });
});

async function readJson(name: string) {
  return JSON.parse(await readFile(resolve(releaseRoot, name), 'utf8'));
}

async function localFixtureFetch(input: RequestInfo | URL): Promise<Response> {
  const pathname = typeof input === 'string' ? input : input.toString();
  const path = resolve(fixturesRoot, pathname.replace(/^\//u, '').replaceAll('/', sep));
  if (!path.startsWith(`${fixturesRoot}${sep}`)) return new Response(null, { status: 403 });
  try {
    return new Response(await readFile(path), { status: 200 });
  } catch {
    return new Response(null, { status: 404 });
  }
}
