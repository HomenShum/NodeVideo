import { execFileSync } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import {
  benchmarkRoot,
  evidenceRoot,
  gitOutput,
  readJson,
  root,
  sha256,
  writeJson,
} from './creatorbench-io.mjs';

const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
if (dirty) throw new Error(`CreatorBench freeze requires a clean tracked worktree:\n${dirty}`);
const sourceCommitSha = await gitOutput(['rev-parse', 'HEAD']);
async function hashFiles(paths) {
  const entries = [];
  for (const path of [...paths].sort())
    entries.push(`${path}\0${sha256(await readFile(resolve(root, path)))}`);
  return `sha256:${sha256(entries.join('\n'))}`;
}
const configFiles = [
  'benchmarks/creatorbench-v1/config/domains.json',
  'benchmarks/creatorbench-v1/config/routing-policy.json',
];
const packManifests = [];
for (const pack of await readdir(resolve(root, 'packs'), { withFileTypes: true })) {
  const manifestPath = `packs/${pack.name}/manifest.json`;
  if (pack.isDirectory()) {
    await access(resolve(root, manifestPath))
      .then(() => packManifests.push(manifestPath))
      .catch(() => undefined);
  }
}
const publicManifest = await readJson(resolve(benchmarkRoot, 'catalog/public-instances.json'));
const privateManifest = await readJson(resolve(evidenceRoot, 'private-heldout-instances.json'));
const publicCatalog = await readJson(resolve(benchmarkRoot, 'catalog/public-sources.json'));
const privateCatalog = await readJson(resolve(evidenceRoot, 'private-heldout-catalog.json'));
const publicSplits = await readJson(resolve(benchmarkRoot, 'catalog/public-splits.json'));
const privateSplits = await readJson(resolve(evidenceRoot, 'private-heldout-splits.json'));
const dedupe = await readJson(resolve(benchmarkRoot, 'receipts/deduplication-receipt.json'));
if (!dedupe.passed)
  throw new Error('CreatorBench cannot freeze with split leakage or blocking duplicates.');
const benchmarkVersion = publicManifest.benchmarkVersion;
const versionedArtifacts = [
  ['private instance manifest', privateManifest.benchmarkVersion],
  ['public source catalog', publicCatalog.benchmarkVersion],
  ['private source catalog', privateCatalog.benchmarkVersion],
  ['public split catalog', publicSplits.benchmarkVersion],
  ['private split catalog', privateSplits.benchmarkVersion],
];
for (const [label, observedVersion] of versionedArtifacts) {
  if (observedVersion !== benchmarkVersion) {
    throw new Error(
      `CreatorBench freeze refused: ${label} is ${observedVersion}, expected ${benchmarkVersion}.`,
    );
  }
}
const publicSourceIds = new Set(publicCatalog.records.map((source) => source.id));
const privateSourceIds = new Set(privateCatalog.records.map((source) => source.id));
for (const instance of publicManifest.instances) {
  for (const sourceId of instance.sourceIds) {
    if (!publicSourceIds.has(sourceId)) {
      throw new Error(
        `CreatorBench freeze refused: public instance ${instance.id} references missing source ${sourceId}.`,
      );
    }
  }
}
for (const instance of privateManifest.instances) {
  for (const sourceId of instance.sourceIds) {
    if (!privateSourceIds.has(sourceId)) {
      throw new Error(
        `CreatorBench freeze refused: private instance ${instance.id} references missing source ${sourceId}.`,
      );
    }
  }
}
const evaluatorPath = 'scripts/benchmarks/evaluate-creatorbench.mjs';
const benchmarkManifestHash = `sha256:${sha256(JSON.stringify({ publicManifest, privateManifest, publicCatalog, privateCatalog, publicSplits, privateSplits }))}`;
const frozenAt = new Date().toISOString();
const receipt = {
  schemaVersion: 'nodevideo.creatorbench-freeze/v1',
  id: `creatorbench-freeze:${sha256(`${sourceCommitSha}:${benchmarkManifestHash}`).slice(0, 24)}`,
  benchmarkVersion,
  frozenAt,
  sourceCommitSha,
  configHash: await hashFiles(configFiles),
  capabilityManifestHash: await hashFiles(packManifests),
  routerPolicyHash: await hashFiles([
    'config/executor-routing/default-policy.json',
    'config/executor-routing/executor-profiles.json',
  ]),
  thresholdPolicyHash: await hashFiles(['benchmarks/creatorbench-v1/config/routing-policy.json']),
  benchmarkManifestHash,
  evaluatorVersion: 'creatorbench-evaluator-v1',
  evaluatorHash: await hashFiles([evaluatorPath]),
  modelVersions: ['none:routing-baseline'],
  executorVersions: ['adaptive-executor-router-v1', 'executor-catalog-v1'],
  privateSplit: {
    catalogHash: `sha256:${sha256(JSON.stringify(privateCatalog))}`,
    mediaStoredOutsideRepository: true,
    developmentCredentialsDenied: true,
  },
};
const vite = await createServer({
  root,
  appType: 'custom',
  server: { middlewareMode: true },
  logLevel: 'error',
});
const { validateFreezeReceipt } = await vite.ssrLoadModule('/src/lib/creatorbench-contracts.ts');
validateFreezeReceipt(receipt);
await vite.close();
await writeJson(resolve(benchmarkRoot, 'receipts/creatorbench-freeze-receipt.json'), receipt);
console.log(JSON.stringify(receipt, null, 2));
