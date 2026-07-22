import { resolve } from 'node:path';
import { benchmarkRoot, readJson, writeJson } from './creatorbench-io.mjs';

const previousPath = process.argv.find((argument) => argument.startsWith('--previous='))?.slice(11);
if (!previousPath)
  throw new Error('Usage: node compare-creatorbench-releases.mjs --previous=<public-report.json>');
const current = await readJson(resolve(benchmarkRoot, 'results/public-report.json'));
const previous = await readJson(resolve(previousPath));
const classes = [
  'automatic_usable',
  'assisted_usable',
  'review_required',
  'safely_abstained',
  'unsupported',
  'technical_failure',
  'silent_failure',
];
const rate = (report, classification) =>
  report.outcomes?.[classification]?.rate ?? report.claim?.outcomes?.[classification]?.rate ?? null;
const changes = classes.map((classification) => {
  const before = rate(previous, classification);
  const after = rate(current, classification);
  const delta = before === null || after === null ? null : after - before;
  return {
    classification,
    before,
    after,
    delta,
    regression:
      delta === null
        ? null
        : classification === 'automatic_usable' || classification === 'assisted_usable'
          ? delta < 0
          : ['technical_failure', 'silent_failure'].includes(classification)
            ? delta > 0
            : false,
  };
});
const comparison = {
  schemaVersion: 'nodevideo.creatorbench-release-comparison/v1',
  previousVersion: previous.benchmarkVersion,
  currentVersion: current.benchmarkVersion,
  generatedAt: new Date().toISOString(),
  changes,
  regressionCount: changes.filter((change) => change.regression).length,
  limitations: [
    'Rates from different benchmark manifests are descriptive unless the populations and methodology are declared comparable.',
  ],
};
await writeJson(resolve(benchmarkRoot, 'results/release-comparison.json'), comparison);
console.log(JSON.stringify(comparison, null, 2));
