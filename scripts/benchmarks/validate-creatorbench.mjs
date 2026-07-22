import { resolve } from 'node:path';
import { createServer } from 'vite';
import { benchmarkRoot, evidenceRoot, loadAllSources, readJson } from './creatorbench-io.mjs';

const config = await readJson(resolve(benchmarkRoot, 'config/domains.json'));
const sources = await loadAllSources();
const publicSplits = await readJson(resolve(benchmarkRoot, 'catalog/public-splits.json'));
const privateSplits = await readJson(resolve(evidenceRoot, 'private-heldout-splits.json'));
const assignments = [...publicSplits.assignments, ...privateSplits.assignments];
const publicManifest = await readJson(resolve(benchmarkRoot, 'catalog/public-instances.json'));
const privateManifest = await readJson(resolve(evidenceRoot, 'private-heldout-instances.json'));
const instances = [...publicManifest.instances, ...privateManifest.instances];
const errors = [];
const vite = await createServer({
  root: resolve(benchmarkRoot, '../..'),
  appType: 'custom',
  server: { middlewareMode: true },
  logLevel: 'error',
});
const contracts = await vite.ssrLoadModule('/src/lib/creatorbench-contracts.ts');
try {
  contracts.validateSourceCatalog(sources, assignments);
} catch (error) {
  errors.push(error.message);
}
for (const instance of instances) {
  try {
    contracts.validateCreatorBenchInstance(instance);
  } catch (error) {
    errors.push(`${instance.id}: ${error.message}`);
  }
}
await vite.close();

const byId = new Map(sources.map((source) => [source.id, source]));
for (const instance of instances) {
  for (const sourceId of instance.sourceIds) {
    const source = byId.get(sourceId);
    if (!source) errors.push(`${instance.id} references missing ${sourceId}`);
    else if (source.split !== instance.split)
      errors.push(`${instance.id} crosses source split ${source.split}`);
  }
  if (
    instance.split === 'private-heldout' &&
    publicManifest.instances.some((candidate) => candidate.id === instance.id)
  )
    errors.push(`${instance.id} private instance leaked publicly`);
}
const creators = new Set(sources.map((source) => source.creatorOwnerId));
const domains = new Set(instances.map((instance) => instance.domain));
if (sources.length < config.targetClips)
  errors.push(`clips ${sources.length} below ${config.targetClips}`);
if (creators.size < config.minimumCreators)
  errors.push(`creators ${creators.size} below ${config.minimumCreators}`);
if (domains.size < 15) errors.push(`domains ${domains.size} below 15`);
if (new Set(instances.map((instance) => instance.workflow)).size < 8)
  errors.push('fewer than 8 workflows');
if (instances.length < 2_000) errors.push(`instances ${instances.length} below 2000`);
const splitCounts = Object.fromEntries(
  Object.keys(config.splitPercentages).map((split) => [
    split,
    sources.filter((source) => source.split === split).length,
  ]),
);
const total = sources.length || 1;
if (splitCounts['private-heldout'] / total < 0.2)
  errors.push('private held-out split is below 20%');
if (splitCounts.adversarial / total < 0.1) errors.push('adversarial split is below 10%');
const summary = {
  passed: errors.length === 0,
  sourceCount: sources.length,
  creatorCount: creators.size,
  domainCount: domains.size,
  instanceCount: instances.length,
  workflowCount: new Set(instances.map((instance) => instance.workflow)).size,
  splitCounts,
  errors,
};
console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exitCode = 1;
