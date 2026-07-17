#!/usr/bin/env node
// Blocks NEW oversized binary media from entering git history. Existing blobs
// are grandfathered; this only inspects files added/modified versus the base
// branch, so it stops the bleeding without demanding a history rewrite. It is
// deliberately fail-safe: if it cannot determine the base ref it warns and
// passes rather than blocking CI spuriously.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = Number(process.env.NODEVIDEO_MAX_MEDIA_BYTES ?? 3 * 1024 * 1024);
const allowlistPath = fileURLToPath(new URL('./media-allowlist.txt', import.meta.url));
let allowlist = new Set();
try {
  allowlist = new Set(
    readFileSync(allowlistPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  );
} catch {}
const MEDIA = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.mkv',
  '.webm',
  '.avi',
  '.m4a',
  '.mp3',
  '.wav',
  '.gif',
  '.png',
  '.jpg',
  '.jpeg',
]);
const baseRef = process.env.NODEVIDEO_BLOAT_BASE ?? 'origin/main';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

let mergeBase;
try {
  mergeBase = git(['merge-base', baseRef, 'HEAD']);
} catch {
  console.warn(`[check-repo-bloat] base ref ${baseRef} unavailable; skipping (fail-safe).`);
  process.exit(0);
}

const changed = git(['diff', '--name-only', '--diff-filter=AM', `${mergeBase}...HEAD`])
  .split('\n')
  .filter(Boolean);

const offenders = [];
for (const file of changed) {
  const dot = file.lastIndexOf('.');
  const ext = dot >= 0 ? file.slice(dot).toLowerCase() : '';
  if (!MEDIA.has(ext)) continue;
  if (allowlist.has(file)) continue;
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    continue; // deleted or moved away in the working tree
  }
  if (size > MAX_BYTES) offenders.push({ file, size });
}

if (offenders.length > 0) {
  console.error(
    `[check-repo-bloat] ${offenders.length} new media file(s) exceed ${(MAX_BYTES / 1024 / 1024).toFixed(1)} MB.`,
  );
  for (const { file, size } of offenders.sort((a, b) => b.size - a.size)) {
    console.error(`  ${(size / 1024 / 1024).toFixed(2)} MB  ${file}`);
  }
  console.error(
    'Commit large media through Git LFS or an external store, or keep it under .qa/evidence/ (gitignored).',
  );
  process.exit(1);
}

console.log(
  `[check-repo-bloat] OK — no new media over ${(MAX_BYTES / 1024 / 1024).toFixed(1)} MB.`,
);
