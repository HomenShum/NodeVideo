import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPublishedSongCalibration } from './published-song-calibration';

const root = join(process.cwd(), 'fixtures', 'media', 'song-conditioned-real-calibration-v1');

describe('published song calibration', () => {
  it('verifies the pinned manifest, exact artifact set, and derivation chain', async () => {
    const fixture = await loadFixture();
    const manifest = await loadPublishedSongCalibration(
      fixture.descriptor,
      fixtureFetcher(fixture.files),
    );
    expect(manifest.result.cutBoundaries.f1).toBe(0.909091);
    expect(manifest.result.phraseSourceAgreement.agreementRatio).toBe(1);
  });

  it('fails closed when the picture-only derivation receipt changes', async () => {
    const fixture = await loadFixture();
    fixture.files.set('derivation-receipt.json', new TextEncoder().encode('{"tampered":true}'));
    await expect(
      loadPublishedSongCalibration(fixture.descriptor, fixtureFetcher(fixture.files)),
    ).rejects.toThrow(/derivation-receipt failed SHA-256 verification/u);
  });

  it('fails closed when a required artifact is omitted from a newly signed manifest', async () => {
    const fixture = await loadFixture();
    const originalManifestBytes = fixture.files.get('manifest.json');
    if (!originalManifestBytes) throw new Error('Fixture manifest is missing.');
    const manifest = JSON.parse(new TextDecoder().decode(originalManifestBytes)) as {
      artifacts: Array<{ id: string }>;
    };
    manifest.artifacts = manifest.artifacts.filter(
      (artifact) => artifact.id !== 'post-freeze-evaluation',
    );
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    fixture.files.set('manifest.json', manifestBytes);
    fixture.descriptor.manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');

    await expect(
      loadPublishedSongCalibration(fixture.descriptor, fixtureFetcher(fixture.files)),
    ).rejects.toThrow(/manifest failed its release contract/u);
  });
});

async function loadFixture() {
  const manifestBytes = await readFile(join(root, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
    artifacts: Array<{ file: string }>;
  };
  const files = new Map<string, Uint8Array>([['manifest.json', manifestBytes]]);
  for (const artifact of manifest.artifacts) {
    files.set(artifact.file, await readFile(join(root, artifact.file)));
  }
  return {
    descriptor: {
      manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
      manifestUrl: '/media/song-conditioned-real-calibration-v1/manifest.json',
    },
    files,
  };
}

function fixtureFetcher(files: Map<string, Uint8Array>) {
  return async (input: RequestInfo | URL) => {
    const file = String(input).split('/').at(-1) ?? '';
    const bytes = files.get(file);
    return bytes
      ? new Response(bytes.slice().buffer as ArrayBuffer)
      : new Response('not found', { status: 404 });
  };
}
