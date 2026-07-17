#!/usr/bin/env node
// Writes dist/.well-known/agent-ui.build.json — the receipt binding the served
// UI contract to the build that produced the served bundle. Because it is
// emitted by the same build, an agent that verifies contractSha256 against the
// served contract bytes knows the contract describes THIS deploy, not a newer
// or older one. A stale or missing receipt means the contract must not be
// trusted (fail closed).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const contractPath = join(root, 'dist', '.well-known', 'agent-ui.json');
if (!existsSync(contractPath)) {
  console.error(
    'stamp-contract-build: dist/.well-known/agent-ui.json missing — run vite build first.',
  );
  process.exit(1);
}

let commit = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
if (!commit) {
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    commit = 'unknown';
  }
}

const receipt = {
  schemaVersion: 'nodevideo.agent-ui-build.v1',
  contractSha256: createHash('sha256').update(readFileSync(contractPath)).digest('hex'),
  sourceCommit: commit,
  stampedBy: 'scripts/quality/stamp-contract-build.mjs',
};
const out = join(root, 'dist', '.well-known', 'agent-ui.build.json');
writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(
  `stamped ${out} (contract ${receipt.contractSha256.slice(0, 12)}…, commit ${commit.slice(0, 8)})`,
);
