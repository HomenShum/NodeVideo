import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const atlasRoot = resolve(root, 'fixtures/media/tracking-atlas-v1');
const catalog = JSON.parse(await readFile(resolve(atlasRoot, 'catalog.json'), 'utf8'));
const expected = new Set([
  'group-performance',
  'object-product',
  'animal-companion',
  'sport-climbing',
  'sport-workout',
  'sport-skateboarding',
  'sport-basketball',
  'sport-soccer',
]);

function digest(buffer) {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

const failures = [];
for (const receipt of catalog.receipts ?? []) {
  expected.delete(receipt.packId);
  if (receipt.schemaVersion !== 'nodevideo.tracking-atlas-receipt.v1') {
    failures.push(`${receipt.packId}: unsupported receipt schema`);
  }
  if (receipt.source?.license !== 'Creative Commons Attribution license (reuse allowed)') {
    failures.push(`${receipt.packId}: source is not Creative Commons Attribution`);
  }
  if (!receipt.source?.url?.startsWith('https://www.youtube.com/watch?v=')) {
    failures.push(`${receipt.packId}: source URL is not a bound YouTube video`);
  }
  if (receipt.evaluation?.verdict !== 'pass') {
    failures.push(`${receipt.packId}: fixture verdict is ${receipt.evaluation?.verdict}`);
  }
  if (receipt.evaluation?.targetCoverage < 0.8) {
    failures.push(`${receipt.packId}: target coverage is below 0.8`);
  }
  const outputNames = ['beforeImage', 'afterImage', 'comparisonVideo', 'analysisVideo'];
  for (const name of outputNames) {
    const path = resolve(root, receipt.outputs?.[name] ?? 'missing');
    try {
      const bytes = await readFile(path);
      const expectedHash = receipt.outputs?.sha256?.[name];
      if (digest(bytes) !== expectedHash) failures.push(`${receipt.packId}: ${name} hash mismatch`);
    } catch {
      failures.push(`${receipt.packId}: ${name} is missing`);
    }
  }
  console.log(
    `PASS: ${receipt.packId} · ${receipt.execution.detector} · ${(receipt.evaluation.targetCoverage * 100).toFixed(1)}% target coverage`,
  );
}

if (expected.size) failures.push(`missing cases: ${[...expected].join(', ')}`);
const compilation = resolve(atlasRoot, 'nodevideo-tracking-artifact-atlas.mp4');
try {
  const size = (await stat(compilation)).size;
  if (size > 3 * 1024 * 1024) failures.push('compilation exceeds the 3 MB repository budget');
  console.log(`PASS: compilation is ${(size / 1024 / 1024).toFixed(2)} MB`);
} catch {
  failures.push('compilation is missing');
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `PASS: ${catalog.receipts.length} tracking atlas fixtures are hash-bound and reusable.`,
  );
}
