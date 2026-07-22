import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..', '..');
export const benchmarkRoot = resolve(root, 'benchmarks/creatorbench-v1');
export const evidenceRoot = resolve(root, '.qa/evidence/creatorbench-v1');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeJson(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function loadAllSources() {
  const publicCatalog = await readJson(resolve(benchmarkRoot, 'catalog/public-sources.json'));
  const privateCatalog = await readJson(resolve(evidenceRoot, 'private-heldout-catalog.json'));
  return [...publicCatalog.records, ...privateCatalog.records];
}

export const ratio = (numerator, denominator) => (denominator === 0 ? 0 : numerator / denominator);

export function wilsonInterval(successes, total, z = 1.959963984540054) {
  if (total === 0) return { lower: 0, upper: 0 };
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = proportion + (z * z) / (2 * total);
  const margin =
    z * Math.sqrt((proportion * (1 - proportion)) / total + (z * z) / (4 * total * total));
  return {
    lower: Math.max(0, (center - margin) / denominator),
    upper: Math.min(1, (center + margin) / denominator),
  };
}

export function gitOutput(args) {
  return import('node:child_process').then(({ execFileSync }) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(),
  );
}
