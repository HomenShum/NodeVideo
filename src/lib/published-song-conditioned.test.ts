import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPublishedSongReplay } from './published-song-conditioned';

const root = join(process.cwd(), 'fixtures', 'media', 'song-conditioned-auto-edit-v1');

describe('published song-conditioned replay', () => {
  it('verifies the trusted manifest and every declared artifact', async () => {
    const manifestBytes = await readFile(join(root, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
      artifacts: Array<{ file: string; id: string }>;
    };
    const files = new Map<string, Uint8Array>([['manifest.json', manifestBytes]]);
    for (const artifact of manifest.artifacts) {
      files.set(artifact.file, await readFile(join(root, artifact.file)));
    }
    const loaded = await loadPublishedSongReplay(
      {
        manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
        manifestUrl: '/media/song-conditioned-auto-edit-v1/manifest.json',
      },
      fixtureFetcher(files),
    );
    expect(loaded.selection.selectedTakeIds).toEqual([
      'asset.take-a',
      'asset.take-b',
      'asset.take-a',
    ]);
    expect(loaded.evaluation.tasteStatus).toBe('not-evaluated');
  });

  it('fails closed when a declared artifact changes', async () => {
    const manifestBytes = await readFile(join(root, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
      artifacts: Array<{ file: string; id: string }>;
    };
    const files = new Map<string, Uint8Array>([['manifest.json', manifestBytes]]);
    for (const artifact of manifest.artifacts) {
      files.set(
        artifact.file,
        artifact.id === 'edit-plan'
          ? new TextEncoder().encode('{"tampered":true}')
          : await readFile(join(root, artifact.file)),
      );
    }
    await expect(
      loadPublishedSongReplay(
        {
          manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
          manifestUrl: '/media/song-conditioned-auto-edit-v1/manifest.json',
        },
        fixtureFetcher(files),
      ),
    ).rejects.toThrow(/edit-plan failed SHA-256 verification/u);
  });

  it('fails closed when a required artifact is omitted from a newly signed manifest', async () => {
    const originalManifestBytes = await readFile(join(root, 'manifest.json'));
    const manifest = JSON.parse(originalManifestBytes.toString('utf8')) as {
      artifacts: Array<{ file: string; id: string }>;
    };
    manifest.artifacts = manifest.artifacts.filter(
      (artifact) => artifact.id !== 'generation-read-log',
    );
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const files = new Map<string, Uint8Array>([['manifest.json', manifestBytes]]);

    await expect(
      loadPublishedSongReplay(
        {
          manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
          manifestUrl: '/media/song-conditioned-auto-edit-v1/manifest.json',
        },
        fixtureFetcher(files),
      ),
    ).rejects.toThrow(/manifest failed the song-conditioned proof contract/u);
  });

  it('fails closed when the hash-bound timed-text input changes', async () => {
    const manifestBytes = await readFile(join(root, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
      artifacts: Array<{ file: string; id: string }>;
    };
    const files = new Map<string, Uint8Array>([['manifest.json', manifestBytes]]);
    for (const artifact of manifest.artifacts) {
      files.set(
        artifact.file,
        artifact.id === 'timed-text'
          ? new TextEncoder().encode('{"tampered":true}')
          : await readFile(join(root, artifact.file)),
      );
    }

    await expect(
      loadPublishedSongReplay(
        {
          manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
          manifestUrl: '/media/song-conditioned-auto-edit-v1/manifest.json',
        },
        fixtureFetcher(files),
      ),
    ).rejects.toThrow(/timed-text failed SHA-256 verification/u);
  });
});

function fixtureFetcher(files: Map<string, Uint8Array>) {
  return async (input: RequestInfo | URL) => {
    const file = String(input).split('/').at(-1) ?? '';
    const bytes = files.get(file);
    return bytes
      ? new Response(bytes.slice().buffer as ArrayBuffer)
      : new Response('not found', { status: 404 });
  };
}
