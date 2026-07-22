import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const paths = [
  'benchmarks/creatorbench-v1/catalog/public-sources.json',
  'benchmarks/creatorbench-v1/catalog/public-splits.json',
  'benchmarks/creatorbench-v1/catalog/public-instances.json',
  'benchmarks/creatorbench-v1/results/public-evaluation.json',
  'benchmarks/creatorbench-v1/results/public-report.json',
];
const forbidden = [
  /privateLocatorClass/iu,
  /evaluatorTargetRef/iu,
  /encrypted-evaluator-vault/iu,
  /owner-controlled-vault/iu,
  /sealed:[a-f\d]/iu,
  /NODEVIDEO_CREATORBENCH_EVALUATOR_TOKEN/u,
];
const findings = [];
for (const path of paths) {
  const text = await readFile(resolve(root, path), 'utf8').catch(() => '');
  for (const pattern of forbidden)
    if (pattern.test(text)) findings.push(`${path} matched ${pattern}`);
}
if (findings.length)
  throw new Error(`CreatorBench public proof leaked evaluator-only data:\n${findings.join('\n')}`);
console.log(
  JSON.stringify(
    { passed: true, scanned: paths, privateLocatorLeakage: 0, hiddenTargetLeakage: 0 },
    null,
    2,
  ),
);
