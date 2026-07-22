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
const instanceReceipt = await readJson(resolve(benchmarkRoot, 'receipts/instance-receipt.json'));
const renderPilot = await readJson(
  resolve(benchmarkRoot, 'results/public-render-pilot.json'),
).catch(() => undefined);
const hardTargets = {
  clips: 250,
  creators: 75,
  domains: 15,
  workflows: 8,
  instances: 2_000,
};
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
    workflows: instanceReceipt.representedWorkflowCount,
    instances: instanceReceipt.instanceCount,
    privateHeldoutInstances: claim.population.instanceCount,
    splits: acquisition.splitCounts,
    licenseCounts: acquisition.licenseCounts,
    acquisitionRun: {
      requestedClips: acquisition.requestedClips,
      acquiredClips: acquisition.acquiredClips,
      normalizationGap: acquisition.acquisitionGap,
    },
    hardTargets,
    targetGaps: {
      clips: Math.max(0, hardTargets.clips - acquisition.acquiredClips),
      creators: Math.max(0, hardTargets.creators - acquisition.creators),
      domains: Math.max(0, hardTargets.domains - acquisition.domains),
      workflows: Math.max(0, hardTargets.workflows - instanceReceipt.representedWorkflowCount),
      instances: Math.max(0, hardTargets.instances - instanceReceipt.instanceCount),
    },
    acquisitionFailureCategories: acquisition.failureCategories,
  },
  counts: {
    reviewedInstances: sealed.results.filter((result) => result.review).length,
    excludedInstances: 0,
  },
  workflowCoverage: {
    declared: instanceReceipt.workflowCount,
    represented: instanceReceipt.representedWorkflowCount,
    missing: [
      'smart-reframe',
      'talking-head-cleanup',
      'golden-quote-variants',
      'reference-template',
      'dance-choreography',
      'captioned-multi-format',
      'founder-product-launch',
      'action-subject-following',
    ].filter(
      (workflow) =>
        !sealed.subgroups.some(
          (subgroup) => subgroup.kind === 'workflow' && subgroup.id === workflow,
        ),
    ),
    corpusTierCounts: instanceReceipt.corpusTierCounts,
  },
  metrics: {
    latencyMs: { p50: null, p95: null, scope: 'not-measured-for-sealed-routing' },
    costUsd: { perUsableOutput: null },
    correctionTimeSeconds: { median: null },
    exportReopen: renderPilot?.metrics?.exportReopen ?? {
      numerator: 0,
      denominator: 0,
      rate: null,
    },
    exportReopenScope: renderPilot
      ? 'public deterministic center-crop render pilot; not private-heldout editing quality'
      : 'not measured',
    reviewerAgreement: null,
  },
  missingDataTreatment:
    'Only workflow-admissible sources enter a denominator. Unevaluated editing quality remains review_required, safely_abstained, or unsupported; it is never counted as usable.',
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
  publicRenderPilot: renderPilot
    ? {
        scope: renderPilot.scope,
        metrics: renderPilot.metrics,
        limitations: renderPilot.limitations,
      }
    : null,
  reviewCases:
    renderPilot?.reviewCases.map((reviewCase) => {
      const pilotResult = renderPilot.results?.find(
        (result) => result.instanceId === reviewCase.id,
      );
      return {
        ...reviewCase,
        resultId: reviewCase.resultId ?? pilotResult?.resultId,
        split: reviewCase.split ?? pilotResult?.split,
      };
    }) ?? [],
  publicSourceCount: publicSources.records.length,
  downloads: {
    json: '/benchmarks/creatorbench-v1/results/public-report.json',
    csv: '/benchmarks/creatorbench-v1/results/public-report.csv',
  },
};
const outputRoot = resolve(benchmarkRoot, 'results');
await mkdir(outputRoot, { recursive: true });
await writeJson(resolve(outputRoot, 'public-claim.json'), claim);
await writeJson(resolve(outputRoot, 'public-report.json'), report);
const rows = [
  [
    'record_type',
    'scope',
    'group_kind',
    'group_id',
    'metric',
    'numerator',
    'denominator',
    'rate',
    'value',
    'unit_or_note',
  ],
  ...Object.entries(claim.outcomes).map(([classification, value]) => [
    'outcome',
    'private-heldout routing evaluation',
    '',
    '',
    classification,
    value.numerator,
    value.denominator,
    value.rate,
    '',
    'No human usability labels are present.',
  ]),
  ...sealed.subgroups.flatMap((subgroup) =>
    Object.entries(subgroup.outcomes).map(([classification, value]) => [
      'subgroup-outcome',
      'private-heldout routing evaluation',
      subgroup.kind,
      subgroup.id,
      classification,
      value.numerator,
      value.denominator,
      value.rate,
      '',
      '',
    ]),
  ),
  ...sealed.routeDistribution.flatMap((route) => [
    [
      'route',
      'private-heldout routing evaluation',
      'executor',
      route.executorId,
      'count',
      '',
      '',
      '',
      route.count,
      'instances',
    ],
    ...Object.entries(route.dispositions).map(([disposition, count]) => [
      'route-disposition',
      'private-heldout routing evaluation',
      'executor',
      route.executorId,
      disposition,
      count,
      route.count,
      route.count > 0 ? count / route.count : 0,
      '',
      '',
    ]),
  ]),
  [
    'metric',
    report.metrics.exportReopenScope,
    '',
    '',
    'export_reopen',
    report.metrics.exportReopen.numerator,
    report.metrics.exportReopen.denominator,
    report.metrics.exportReopen.rate,
    '',
    '',
  ],
  ...Object.entries(report.dataset.targetGaps).map(([metricName, gap]) => [
    'target-gap',
    'creatorbench-v1 hard target',
    '',
    '',
    metricName,
    '',
    report.dataset.hardTargets[metricName],
    '',
    gap,
    'remaining',
  ]),
  ...claim.limitations.map((limitation) => [
    'limitation',
    'public claim',
    '',
    '',
    '',
    '',
    '',
    '',
    limitation,
    '',
  ]),
];
const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
await writeFile(
  resolve(outputRoot, 'public-report.csv'),
  `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`,
);
console.log(
  JSON.stringify(
    {
      claim: resolve(outputRoot, 'public-claim.json'),
      report: resolve(outputRoot, 'public-report.json'),
      statement: claim.statement,
    },
    null,
    2,
  ),
);
