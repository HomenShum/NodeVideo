import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash } from '@homenshum/nodekit/caseflow';
import { describe, expect, it } from 'vitest';
import verdict from '../fixtures/proof/nodekit-caseflow-consumer-verdict.json';
import consumerPackage from '../package.json';

interface ConsumerVerdict {
  assertions: Record<string, boolean> & {
    authenticatedProductionProof: boolean;
    deployed: boolean;
    hostOwnedAuthAndScope: boolean;
    localComponentRuntime: boolean;
    published: boolean;
  };
  evidence: Array<{ path: string; sha256: string }>;
  evidenceHash: string;
  consumer: {
    committedInputs: Array<{ gitBlob: string; mode: string; path: string; sha256: string }>;
    implementationCommit: string;
  };
  nodekit: {
    installedPackageFiles: Array<{ path: string; sha256: string }>;
    lockfileIntegrity: string;
    packageIntegrity: string;
    packageManifestHash: string;
    packagePath: string;
    packageSha256: string;
    packageSpec: string;
    sourceCommit: string;
    sourceHash: string;
    sourceWorkingTreeCleanAtPackTime: boolean;
    supportedImports: string[];
  };
  status: string;
}

const proof = verdict as unknown as ConsumerVerdict;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootRealPath = realpathSync(root);

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function containedEvidencePath(relativePath: string): string {
  expect(path.isAbsolute(relativePath)).toBe(false);
  const absolutePath = realpathSync(path.resolve(root, relativePath));
  expect(
    absolutePath === rootRealPath || absolutePath.startsWith(`${rootRealPath}${path.sep}`),
  ).toBe(true);
  return absolutePath;
}

describe('NodeVideo local NodeKit consumer proof', () => {
  it('recomputes every nested evidence hash and the verdict hash', () => {
    const { evidenceHash, ...body } = proof;
    expect(evidenceHash).toBe(contentHash(body));
    expect(proof.evidence.length).toBeGreaterThanOrEqual(10);
    expect(new Set(proof.evidence.map((entry) => entry.path)).size).toBe(proof.evidence.length);
    for (const entry of proof.evidence) {
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(sha256(containedEvidencePath(entry.path))).toBe(entry.sha256);
    }
  });

  it('binds the installed package and remains fail-closed about external proof', () => {
    expect(proof.status).toBe('passed_local_only');
    expect(proof.nodekit.packageSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(proof.nodekit.supportedImports).toEqual([
      '@homenshum/nodekit/convex-caseflow',
      '@homenshum/nodekit/convex.config.js',
      '@homenshum/nodekit/test',
    ]);
    expect(consumerPackage.dependencies['@homenshum/nodekit']).toBe(proof.nodekit.packageSpec);
    expect(proof.nodekit.lockfileIntegrity).toBe(proof.nodekit.packageIntegrity);
    const packageManifest = JSON.parse(
      readFileSync(containedEvidencePath('vendor/nodekit-package-manifest.json'), 'utf8'),
    ) as {
      manifestHash: string;
      source: {
        commit: string;
        distributableSourceHash: string;
        workingTreeClean: boolean;
      };
    } & Record<string, unknown>;
    const { manifestHash, ...packageManifestBody } = packageManifest;
    expect(manifestHash).toBe(contentHash(packageManifestBody));
    expect(manifestHash).toBe(proof.nodekit.packageManifestHash);
    expect(packageManifest.source.workingTreeClean).toBe(true);
    expect(proof.nodekit.sourceWorkingTreeCleanAtPackTime).toBe(true);
    expect(proof.nodekit.sourceCommit).toMatch(/^[a-f0-9]{40}$/u);
    expect(proof.nodekit.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(packageManifest.source.commit).toBe(proof.nodekit.sourceCommit);
    expect(packageManifest.source.distributableSourceHash).toBe(proof.nodekit.sourceHash);
    expect(sha256(containedEvidencePath(proof.nodekit.packagePath))).toBe(
      proof.nodekit.packageSha256,
    );
    for (const entry of proof.nodekit.installedPackageFiles) {
      expect(path.isAbsolute(entry.path)).toBe(false);
      expect(sha256(path.join(root, 'node_modules', '@homenshum', 'nodekit', entry.path))).toBe(
        entry.sha256,
      );
    }
    expect(proof.assertions.localComponentRuntime).toBe(true);
    expect(proof.assertions.hostOwnedAuthAndScope).toBe(true);
    expect(proof.assertions.authenticatedProductionProof).toBe(false);
    expect(proof.assertions.deployed).toBe(false);
    expect(proof.assertions.published).toBe(false);
  });

  it('reopens every proof input from the exact consumer commit', () => {
    expect(proof.consumer.implementationCommit).toMatch(/^[a-f0-9]{40}$/u);
    expect(Array.isArray(proof.consumer.committedInputs)).toBe(true);
    expect(proof.consumer.committedInputs.length).toBeGreaterThanOrEqual(10);
    expect(new Set(proof.consumer.committedInputs.map((entry) => entry.path)).size).toBe(
      proof.consumer.committedInputs.length,
    );
    for (const entry of proof.consumer.committedInputs) {
      expect(entry.mode).toMatch(/^100(?:644|755)$/u);
      expect(entry.gitBlob).toMatch(/^[a-f0-9]{40,64}$/u);
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/u);
      const committedBytes = execFileSync(
        'git',
        ['show', `${proof.consumer.implementationCommit}:${entry.path}`],
        { cwd: root, encoding: 'buffer' },
      );
      expect(createHash('sha256').update(committedBytes).digest('hex')).toBe(entry.sha256);
      expect(
        execFileSync('git', ['rev-parse', `${proof.consumer.implementationCommit}:${entry.path}`], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
      ).toBe(entry.gitBlob);
      expect(proof.evidence).toContainEqual({ path: entry.path, sha256: entry.sha256 });
    }
  });
});
