import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const SHA1_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function digest(bytes, algorithm) {
  return createHash(algorithm).update(bytes).digest('hex');
}

function assertRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertExactIsoTimestamp(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be an ISO timestamp`);
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC ISO timestamp`);
  }
}

/**
 * Validate all claims that can be independently recomputed from a packed
 * candidate and its immutable manifest. The source hash remains a claim made
 * by NodeKit's packer, but it is only admitted when the packer records a clean,
 * exact source commit and the committed consumer manifest itself is verified.
 */
export function assertExactPackageProvenance({
  manifest,
  packageBytes,
  packagePath,
  expectedName,
  expectedVersion,
}) {
  const candidate = assertRecord(manifest, 'NodeKit package manifest');
  if (candidate.schemaVersion !== 'nodevideo.nodekit-package-candidate/v1') {
    throw new Error('NodeKit package manifest schemaVersion is not supported');
  }
  assertExactIsoTimestamp(candidate.generatedAt, 'NodeKit package manifest generatedAt');

  const packageClaim = assertRecord(candidate.package, 'NodeKit package manifest package');
  const source = assertRecord(candidate.source, 'NodeKit package manifest source');
  if (source.workingTreeClean !== true) {
    throw new Error('NodeKit source working tree was not clean when the package was created');
  }
  if (typeof source.commit !== 'string' || !COMMIT_PATTERN.test(source.commit)) {
    throw new Error('NodeKit package source commit must be an exact lowercase 40-character SHA');
  }
  if (
    typeof source.distributableSourceHash !== 'string' ||
    !SHA256_PATTERN.test(source.distributableSourceHash)
  ) {
    throw new Error('NodeKit package source hash must be an exact lowercase SHA-256');
  }

  const bytes = Buffer.isBuffer(packageBytes) ? packageBytes : Buffer.from(packageBytes);
  const sha1 = digest(bytes, 'sha1');
  const sha256 = digest(bytes, 'sha256');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (packageClaim.filename !== path.basename(packagePath)) {
    throw new Error('NodeKit package filename does not match the immutable package path');
  }
  if (packageClaim.name !== expectedName || packageClaim.version !== expectedVersion) {
    throw new Error('NodeKit package identity does not match the consumer dependency');
  }
  if (!Number.isSafeInteger(packageClaim.bytes) || packageClaim.bytes !== bytes.length) {
    throw new Error('NodeKit package byte count does not match the packed candidate');
  }
  if (packageClaim.sha1 !== sha1 || packageClaim.shasum !== sha1) {
    throw new Error('NodeKit package SHA-1 provenance does not match the packed candidate');
  }
  if (packageClaim.sha256 !== sha256) {
    throw new Error('NodeKit package SHA-256 provenance does not match the packed candidate');
  }
  if (packageClaim.integrity !== integrity) {
    throw new Error('NodeKit package integrity does not match the packed candidate');
  }

  const { manifestHash, ...manifestBody } = candidate;
  if (typeof manifestHash !== 'string' || !SHA256_PATTERN.test(manifestHash)) {
    throw new Error('NodeKit package manifest hash must be an exact lowercase SHA-256');
  }
  if (contentHash(manifestBody) !== manifestHash) {
    throw new Error('NodeKit package manifest content hash is invalid');
  }
  return {
    manifestHash,
    packageSha1: sha1,
    packageSha256: sha256,
    sourceCommit: source.commit,
    sourceHash: source.distributableSourceHash,
  };
}

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: root,
    encoding,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function normalizedGitPath(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`proof input path must be a non-empty relative path: ${String(relativePath)}`);
  }
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`proof input path escapes the consumer root: ${relativePath}`);
  }
  return normalized;
}

/**
 * Bind every proof input to both the current commit and the working-tree bytes.
 * `git status` alone is insufficient because ignored/untracked paths can evade
 * a narrow status check. Requiring a stage-0 tracked blob in HEAD and comparing
 * its bytes rejects staged, unstaged, untracked, ignored, and symlinked inputs.
 */
export function assertCommittedProofInputs({ root, relativePaths }) {
  const rootRealPath = realpathSync(root);
  const paths = relativePaths.map(normalizedGitPath);
  if (new Set(paths).size !== paths.length) {
    throw new Error('duplicate consumer proof input paths are not allowed');
  }
  const commit = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error('consumer proof requires an exact committed HEAD');
  }
  const dirty = git(
    root,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...paths],
    'buffer',
  );
  if (dirty.length !== 0) {
    throw new Error('consumer proof inputs are dirty or uncommitted');
  }

  const entries = [];
  for (const relativePath of paths) {
    let stage;
    try {
      stage = git(root, ['ls-files', '--stage', '--error-unmatch', '--', relativePath]).trim();
    } catch {
      throw new Error(`consumer proof input is not committed: ${relativePath}`);
    }
    const stageMatch = /^(\d{6}) ([a-f0-9]{40,64}) 0\t(.+)$/u.exec(stage);
    if (!stageMatch || stageMatch[3] !== relativePath) {
      throw new Error(
        `consumer proof input is not a single stage-0 committed file: ${relativePath}`,
      );
    }
    if (!/^100(?:644|755)$/u.test(stageMatch[1])) {
      throw new Error(`consumer proof input is not a committed regular file: ${relativePath}`);
    }
    const absolutePath = realpathSync(path.resolve(root, relativePath));
    if (absolutePath !== rootRealPath && !absolutePath.startsWith(`${rootRealPath}${path.sep}`)) {
      throw new Error(`consumer proof input escapes the consumer root: ${relativePath}`);
    }
    const worktreeBytes = readFileSync(absolutePath);
    let committedBytes;
    try {
      committedBytes = git(root, ['show', `${commit}:${relativePath}`], 'buffer');
    } catch {
      throw new Error(`consumer proof input is absent from HEAD: ${relativePath}`);
    }
    const worktreeSha256 = digest(worktreeBytes, 'sha256');
    const committedSha256 = digest(committedBytes, 'sha256');
    if (worktreeSha256 !== committedSha256) {
      throw new Error(`consumer proof input bytes do not match HEAD: ${relativePath}`);
    }
    const headBlob = git(root, ['rev-parse', `${commit}:${relativePath}`]).trim();
    if (headBlob !== stageMatch[2]) {
      throw new Error(`consumer proof input index does not match HEAD: ${relativePath}`);
    }
    entries.push({
      gitBlob: headBlob,
      mode: stageMatch[1],
      path: relativePath,
      sha256: worktreeSha256,
    });
  }
  return { commit, entries };
}
