import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { benchmarkRoot, evidenceRoot, readJson, writeJson } from './creatorbench-io.mjs';

const freeze = await readJson(resolve(benchmarkRoot, 'receipts/creatorbench-freeze-receipt.json'));
const instances = await readJson(resolve(evidenceRoot, 'private-heldout-instances.json'));
const sources = await readJson(resolve(evidenceRoot, 'private-heldout-catalog.json'));
const sealed = await readJson(resolve(evidenceRoot, 'results/sealed-results.json'));
const vite = await createServer({
  root: resolve(benchmarkRoot, '../..'),
  appType: 'custom',
  server: { middlewareMode: true },
  logLevel: 'error',
});
const { derivePublicClaim } = await vite.ssrLoadModule('/src/lib/creatorbench-contracts.ts');
const claim = derivePublicClaim({
  benchmarkVersion: freeze.benchmarkVersion,
  freeze,
  generatedAt: new Date().toISOString(),
  instances: instances.instances,
  sources: sources.records,
  results: sealed.results,
  limitations: sealed.limitations,
});
await vite.close();
const publicSources = await readJson(resolve(benchmarkRoot, 'catalog/public-sources.json'));
const acquisition = await readJson(resolve(benchmarkRoot, 'receipts/acquisition-receipt.json'));
const report = {
  schemaVersion: 'nodevideo.creatorbench-public-report/v1',
  benchmarkVersion: claim.benchmarkVersion,
  status: 'evaluated',
  generatedAt: claim.generatedAt,
  claim,
  outcomes: sealed.outcomes,
  dataset: {
    clips: acquisition.acquiredClips,
    creators: acquisition.creators,
    domains: acquisition.domains,
    workflows: claim.population.workflowCount,
    instances: claim.population.instanceCount,
    splits: acquisition.splitCounts,
    licenseCounts: acquisition.licenseCounts,
    acquisitionGap: acquisition.acquisitionGap,
    acquisitionFailureCategories: acquisition.failureCategories,
  },
  counts: {
    reviewedInstances: sealed.results.filter((result) => result.review).length,
    excludedInstances: 0,
  },
  metrics: {
    latencyMs: { p50: 0, p95: 0 },
    costUsd: { perUsableOutput: null },
    correctionTimeSeconds: { median: null },
    exportReopen: { numerator: 0, denominator: sealed.results.length, rate: 0 },
    reviewerAgreement: null,
  },
  missingDataTreatment:
    'Unevaluated editing quality remains review_required, safely_abstained, or unsupported; it is never counted as usable.',
  subgroups: sealed.subgroups,
  routes: sealed.routeDistribution,
  representativeFailures: [],
  freezeReceipt: {
    receiptId: freeze.id,
    frozenAt: freeze.frozenAt,
    sourceCommit: freeze.sourceCommitSha,
    configHash: freeze.configHash,
    manifestHash: freeze.benchmarkManifestHash,
    evaluatorVersion: freeze.evaluatorVersion,
    thresholdPolicy: freeze.thresholdPolicyHash,
    status: 'verified',
  },
  reviewCases: [],
  publicSourceCount: publicSources.records.length,
  downloads: {
    json: '/benchmarks/creatorbench-v1/results/public-report.json',
    csv: '/benchmarks/creatorbench-v1/results/public-report.csv',
  },
};
const outputRoot = resolve(benchmarkRoot, 'results');
await mkdir(outputRoot, { recursive: true });
await writeJson(resolve(outputRoot, 'public-report.json'), report);
const rows = [
  ['classification', 'numerator', 'denominator', 'rate'],
  ...Object.entries(claim.outcomes).map(([classification, value]) => [
    classification,
    value.numerator,
    value.denominator,
    value.rate,
  ]),
];
await writeFile(
  resolve(outputRoot, 'public-report.csv'),
  `${rows.map((row) => row.join(',')).join('\n')}\n`,
);
console.log(
  JSON.stringify(
    { report: resolve(outputRoot, 'public-report.json'), statement: claim.statement },
    null,
    2,
  ),
);
