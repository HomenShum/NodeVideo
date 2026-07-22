import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertCommittedProofInputs,
  assertExactPackageProvenance,
  contentHash,
} from '../scripts/quality/nodekit-consumer-proof-integrity.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function exactManifest(packageBytes: Buffer, overrides: Record<string, unknown> = {}) {
  const sha1 = createHash('sha1').update(packageBytes).digest('hex');
  const body = {
    generatedAt: '2026-07-22T12:00:00.000Z',
    package: {
      bytes: packageBytes.length,
      filename: 'homenshum-nodekit-0.2.1.tgz',
      integrity: `sha512-${createHash('sha512').update(packageBytes).digest('base64')}`,
      name: '@homenshum/nodekit',
      sha1,
      sha256: createHash('sha256').update(packageBytes).digest('hex'),
      shasum: sha1,
      version: '0.2.1',
    },
    schemaVersion: 'nodevideo.nodekit-package-candidate/v1',
    source: {
      commit: 'a'.repeat(40),
      distributableSourceHash: 'b'.repeat(64),
      workingTreeClean: true,
    },
    ...overrides,
  };
  return { ...body, manifestHash: contentHash(body) };
}

async function createGitFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'nodevideo-consumer-proof-'));
  temporaryDirectories.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'proof@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Proof Test'], { cwd: root });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
  await writeFile(path.join(root, 'input.txt'), 'committed\n', 'utf8');
  execFileSync('git', ['add', '--', 'input.txt'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
  return root;
}

describe('NodeKit consumer proof integrity', () => {
  it('accepts an exact clean package manifest and recomputes every package digest', () => {
    const packageBytes = Buffer.from('exact packed candidate');
    expect(
      assertExactPackageProvenance({
        expectedName: '@homenshum/nodekit',
        expectedVersion: '0.2.1',
        manifest: exactManifest(packageBytes),
        packageBytes,
        packagePath: 'vendor/homenshum-nodekit-0.2.1.tgz',
      }),
    ).toMatchObject({
      sourceCommit: 'a'.repeat(40),
      sourceHash: 'b'.repeat(64),
    });
  });

  it('rejects a package produced from a dirty NodeKit source tree', () => {
    const packageBytes = Buffer.from('candidate');
    const manifest = exactManifest(packageBytes, {
      source: {
        commit: 'a'.repeat(40),
        distributableSourceHash: 'b'.repeat(64),
        workingTreeClean: false,
      },
    });
    expect(() =>
      assertExactPackageProvenance({
        expectedName: '@homenshum/nodekit',
        expectedVersion: '0.2.1',
        manifest,
        packageBytes,
        packagePath: 'vendor/homenshum-nodekit-0.2.1.tgz',
      }),
    ).toThrow(/source working tree was not clean/u);
  });

  it('rejects non-exact source identities and tampered package bytes', () => {
    const packageBytes = Buffer.from('candidate');
    const malformedSource = exactManifest(packageBytes, {
      source: {
        commit: 'main',
        distributableSourceHash: 'not-a-hash',
        workingTreeClean: true,
      },
    });
    expect(() =>
      assertExactPackageProvenance({
        expectedName: '@homenshum/nodekit',
        expectedVersion: '0.2.1',
        manifest: malformedSource,
        packageBytes,
        packagePath: 'vendor/homenshum-nodekit-0.2.1.tgz',
      }),
    ).toThrow(/source commit must be an exact/u);

    expect(() =>
      assertExactPackageProvenance({
        expectedName: '@homenshum/nodekit',
        expectedVersion: '0.2.1',
        manifest: exactManifest(packageBytes),
        packageBytes: Buffer.from('tampered'),
        packagePath: 'vendor/homenshum-nodekit-0.2.1.tgz',
      }),
    ).toThrow(/byte count does not match/u);
  });

  it('binds a clean tracked proof input to HEAD and its committed blob', async () => {
    const root = await createGitFixture();
    const result = assertCommittedProofInputs({ root, relativePaths: ['input.txt'] });
    expect(result.commit).toMatch(/^[a-f0-9]{40}$/u);
    expect(result.entries).toEqual([
      expect.objectContaining({
        mode: '100644',
        path: 'input.txt',
        sha256: createHash('sha256').update('committed\n').digest('hex'),
      }),
    ]);
  });

  it('rejects unstaged, staged, and uncommitted proof inputs', async () => {
    const unstagedRoot = await createGitFixture();
    await writeFile(path.join(unstagedRoot, 'input.txt'), 'dirty\n', 'utf8');
    expect(() =>
      assertCommittedProofInputs({ root: unstagedRoot, relativePaths: ['input.txt'] }),
    ).toThrow(/dirty or uncommitted/u);

    const stagedRoot = await createGitFixture();
    await writeFile(path.join(stagedRoot, 'input.txt'), 'staged\n', 'utf8');
    execFileSync('git', ['add', '--', 'input.txt'], { cwd: stagedRoot });
    expect(() =>
      assertCommittedProofInputs({ root: stagedRoot, relativePaths: ['input.txt'] }),
    ).toThrow(/dirty or uncommitted/u);

    const untrackedRoot = await createGitFixture();
    await writeFile(path.join(untrackedRoot, 'new-input.txt'), 'untracked\n', 'utf8');
    expect(() =>
      assertCommittedProofInputs({ root: untrackedRoot, relativePaths: ['new-input.txt'] }),
    ).toThrow(/dirty or uncommitted/u);
  });

  it('rejects an ignored proof input even when git status is silent', async () => {
    const root = await createGitFixture();
    await writeFile(path.join(root, '.gitignore'), 'ignored.txt\n', 'utf8');
    execFileSync('git', ['add', '--', '.gitignore'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '-m', 'ignore fixture'], { cwd: root });
    await writeFile(path.join(root, 'ignored.txt'), 'ignored\n', 'utf8');
    expect(() => assertCommittedProofInputs({ root, relativePaths: ['ignored.txt'] })).toThrow(
      /not committed/u,
    );
  });
});
