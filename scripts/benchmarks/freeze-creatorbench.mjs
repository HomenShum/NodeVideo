import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
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
  if (pack.isDirectory()) packManifests.push(`packs/${pack.name}/manifest.json`);
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
const evaluatorPath = 'scripts/benchmarks/evaluate-creatorbench.mjs';
const benchmarkManifestHash = `sha256:${sha256(JSON.stringify({ publicManifest, privateManifest, publicCatalog, privateCatalog, publicSplits, privateSplits }))}`;
const frozenAt = new Date().toISOString();
const receipt = {
  schemaVersion: 'nodevideo.creatorbench-freeze/v1',
  id: `creatorbench-freeze:${sha256(`${sourceCommitSha}:${benchmarkManifestHash}`).slice(0, 24)}`,
  benchmarkVersion: publicManifest.benchmarkVersion,
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
