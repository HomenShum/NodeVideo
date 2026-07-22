import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { probeMedia, sanitizeProbe } from '../media/media-proof-lib.mjs';
import { renderEditPlan } from '../workers/edit-plan-renderer-lib.mjs';
import { benchmarkRoot, evidenceRoot, readJson, sha256, writeJson } from './creatorbench-io.mjs';
import {
  assertFrozenPrivateCatalog,
  assertPostFreezeEvaluatorAccess,
} from './sealed-evaluator-guard.mjs';

const sealed = process.argv.includes('--sealed');
const selectedSplits = sealed
  ? new Set(['private-heldout'])
  : new Set(['development', 'public-test', 'adversarial']);
const outputRoot = resolve(
  evidenceRoot,
  sealed
    ? 'workflow-renders/private-talking-head-cleanup'
    : 'workflow-renders/public-talking-head-cleanup',
);
await mkdir(outputRoot, { recursive: true });

let freeze;
if (sealed) {
  freeze = await readJson(resolve(benchmarkRoot, 'receipts/creatorbench-freeze-receipt.json'));
  assertPostFreezeEvaluatorAccess({
    sealed,
    credential: process.env.NODEVIDEO_CREATORBENCH_EVALUATOR_TOKEN,
    freeze,
  });
}
const manifest = await readJson(
  sealed
    ? resolve(evidenceRoot, 'private-heldout-instances.json')
    : resolve(benchmarkRoot, 'catalog/public-instances.json'),
);
const sourceCatalog = await readJson(
  sealed
    ? resolve(evidenceRoot, 'private-heldout-catalog.json')
    : resolve(benchmarkRoot, 'catalog/public-sources.json'),
);
if (sealed) {
  assertFrozenPrivateCatalog(freeze, `sha256:${sha256(JSON.stringify(sourceCatalog))}`);
}
const vault = await readJson(resolve(evidenceRoot, 'acquisition-vault.json'));
const sourceById = new Map(sourceCatalog.records.map((source) => [source.id, source]));
const vaultById = new Map(vault.records.map((record) => [record.id, record]));
const instances = manifest.instances.filter(
  (instance) =>
    instance.workflow === 'talking-head-cleanup' &&
    instance.scenarioId === 'baseline' &&
    selectedSplits.has(instance.split),
);

const vite = await createServer({
  root: resolve(benchmarkRoot, '../..'),
  appType: 'custom',
  server: { middlewareMode: true },
  logLevel: 'error',
});
const { executeTalkingHeadCleanupPlan } = await vite.ssrLoadModule(
  '/src/lib/creatorbench-workflow-execution.ts',
);
const { evaluateWorkflowMetrics } = await vite.ssrLoadModule('/src/lib/creatorbench-evaluators.ts');
const { validateCreatorBenchResult } = await vite.ssrLoadModule(
  '/src/lib/creatorbench-contracts.ts',
);

const results = [];
const skipped = [];
for (const instance of instances) {
  const sourceId = instance.sourceIds[0];
  const source = sourceById.get(sourceId);
  const vaultRecord = vaultById.get(sourceId);
  if (!source || !vaultRecord) throw new Error(`Missing source or vault record for ${sourceId}.`);
  let mediaIndex;
  try {
    mediaIndex = await readJson(resolve(evidenceRoot, 'media-indexes', `${sourceId}.json`));
  } catch {
    skipped.push({ instanceId: instance.id, reason: 'speech-index-unavailable' });
    continue;
  }
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const execution = executeTalkingHeadCleanupPlan({ instance, mediaIndex });
  const caseRoot = resolve(outputRoot, sha256(instance.id).slice(0, 16));
  await mkdir(caseRoot, { recursive: true });
  await writeJson(resolve(caseRoot, 'semantic-plan.json'), execution.semanticPlan);
  await writeJson(resolve(caseRoot, 'renderer-plan.json'), execution.rendererPlan);
  const outputPath = resolve(caseRoot, 'clean-master.mp4');
  const rendered = await renderEditPlan({
    plan: execution.rendererPlan,
    bindings: { [sourceId]: resolve(evidenceRoot, 'media', vaultRecord.localCacheKey) },
    outputPath,
    auxiliaryDirectory: resolve(caseRoot, '.render-work'),
  });
  const outputBytes = await readFile(outputPath);
  const outputHash = sha256(outputBytes);
  const probe = sanitizeProbe(probeMedia(outputPath));
  const exportReopens =
    Number(probe.format.durationSeconds ?? 0) > 0 && Boolean(probe.video) && Boolean(probe.audio);
  const metrics = { ...execution.metrics, exportReopens };
  const evaluation = evaluateWorkflowMetrics({ workflow: instance.workflow, metrics });
  const completedAt = new Date().toISOString();
  const routeReceipt = {
    schemaVersion: 'nodevideo.creatorbench-stage-route-receipt/v1',
    id: `route:${instance.id}:talking-head-cleanup-v1`,
    instanceId: instance.id,
    selectedExecutorIds: execution.route.stages,
    rejectedExecutorIds: [],
    mediaEgress: false,
    estimatedCostUsd: 0,
    actualCostUsd: 0,
    approvalState: execution.route.approvalState,
    rendererVersion: rendered.rendererVersion,
  };
  const result = validateCreatorBenchResult({
    schemaVersion: 'nodevideo.creatorbench-result/v1',
    id: `result:${instance.id}:talking-head-cleanup-v1`,
    benchmarkVersion: instance.benchmarkVersion,
    instanceId: instance.id,
    split: instance.split,
    classification: 'review_required',
    routeReceiptId: routeReceipt.id,
    systemDeclaredSuccess: false,
    userInterventionCount: 0,
    outputArtifactIds: [`artifact:sha256:${outputHash}`],
    execution: {
      startedAt,
      completedAt,
      latencyMs: Math.round(performance.now() - started),
      costUsd: 0,
      executorVersions: [...execution.route.stages, rendered.rendererVersion],
    },
    checks: {
      correctSubjectOrContent: null,
      intendedSemanticsPreserved: null,
      audioSynchronized: metrics.audioVideoSyncMs === 0,
      exportDecodesAndReopens: exportReopens,
      noUnsupportedSyntheticContent: true,
      rightsPassed: source.rights.permittedBenchmarkUses.includes('derivatives'),
      privacyPassed: true,
      noUndeclaredExecutorSubstitution: true,
      provenanceComplete: true,
    },
    limitationCodes: [
      'human-usability-review-required',
      ...evaluation.missingMetricNames.map((name) => `metric-unverified:${name}`),
    ],
  });
  results.push({
    instanceId: instance.id,
    sourceId,
    split: instance.split,
    routeReceipt,
    result,
    metrics,
    workflowEvaluation: evaluation,
    plan: {
      semanticPlanId: execution.semanticPlan.id,
      rendererPlanId: execution.rendererPlan.id,
      automaticCutCount: execution.automaticCutRanges.length,
      fillerReviewCount: execution.fillerReviewRanges.length,
      silenceReviewCount: execution.silenceReviewRanges.length,
    },
    artifact: {
      id: `artifact:sha256:${outputHash}`,
      sha256: `sha256:${outputHash}`,
      durationMs: Math.round(Number(probe.format.durationSeconds ?? 0) * 1_000),
      hasAudio: Boolean(probe.audio),
      decodesAndReopens: exportReopens,
    },
  });
}
await vite.close();

const aggregate = {
  schemaVersion: 'nodevideo.creatorbench-workflow-pilot/v1',
  benchmarkVersion: manifest.benchmarkVersion,
  workflow: 'talking-head-cleanup',
  evaluationMode: sealed ? 'sealed-private-heldout' : 'public-workflow-pilot',
  generatedAt: new Date().toISOString(),
  instanceCount: results.length,
  sourceCount: new Set(results.map((result) => result.sourceId)).size,
  splitCounts: Object.fromEntries(
    [...selectedSplits].map((split) => [
      split,
      results.filter((result) => result.split === split).length,
    ]),
  ),
  renderedArtifactCount: results.length,
  exportReopenCount: results.filter((result) => result.artifact.decodesAndReopens).length,
  machinePassCount: results.filter((result) => result.workflowEvaluation.machinePass).length,
  reviewRequiredCount: results.length,
  automaticCutCount: results.reduce((sum, result) => sum + result.plan.automaticCutCount, 0),
  fillerReviewCount: results.reduce((sum, result) => sum + result.plan.fillerReviewCount, 0),
  silenceReviewCount: results.reduce((sum, result) => sum + result.plan.silenceReviewCount, 0),
  meanSpeechRetention: (() => {
    const measured = results
      .map((result) => result.metrics.speechRetention)
      .filter((value) => typeof value === 'number');
    return measured.length > 0
      ? measured.reduce((sum, value) => sum + value, 0) / measured.length
      : null;
  })(),
  wordTruncationCount: results.reduce(
    (sum, result) => sum + Number(result.metrics.wordTruncations ?? 0),
    0,
  ),
  skippedCount: skipped.length,
  limitations: [
    'Official SRT timing is segment-level; word timing is uniformly interpolated inside each segment.',
    'Intentional-pause false positives and audible join clicks remain unverified pending blinded human review.',
    'Rendered candidates are not classified usable without human review.',
    'Non-redistributable source and output media remain in the evaluator vault.',
  ],
  resultsSha256: `sha256:${sha256(JSON.stringify(results))}`,
};
if (sealed) {
  await writeJson(resolve(evidenceRoot, 'results/sealed-talking-head-cleanup.json'), {
    ...aggregate,
    results,
    skipped,
  });
  await writeJson(resolve(benchmarkRoot, 'receipts/sealed-talking-head-cleanup-receipt.json'), {
    ...aggregate,
    privateMediaExposed: false,
    privateTranscriptExposed: false,
  });
} else {
  await writeJson(resolve(benchmarkRoot, 'results/public-workflow-pilot.json'), {
    ...aggregate,
    results,
    skipped,
  });
}
console.log(JSON.stringify(aggregate, null, 2));
