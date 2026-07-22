import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import {
  benchmarkRoot,
  evidenceRoot,
  ratio,
  readJson,
  sha256,
  wilsonInterval,
  writeJson,
} from './creatorbench-io.mjs';
import {
  assertFrozenPrivateCatalog,
  assertPostFreezeEvaluatorAccess,
} from './sealed-evaluator-guard.mjs';

const sealed = process.argv.includes('--sealed');
const splits = sealed
  ? new Set(['private-heldout'])
  : new Set(['development', 'public-test', 'adversarial']);
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
const instances = manifest.instances.filter((instance) => splits.has(instance.split));
const sources = new Map(sourceCatalog.records.map((source) => [source.id, source]));
const profilesConfig = await readJson(
  resolve(benchmarkRoot, '../../config/executor-routing/executor-profiles.json'),
);

if (sealed) {
  const privateCatalogHash = `sha256:${sha256(JSON.stringify(sourceCatalog))}`;
  assertFrozenPrivateCatalog(freeze, privateCatalogHash);
}

const vite = await createServer({
  root: resolve(benchmarkRoot, '../..'),
  appType: 'custom',
  server: { middlewareMode: true },
  logLevel: 'error',
});
const { routeExecutor } = await vite.ssrLoadModule('/src/lib/adaptive-executor-router.ts');
const { buildExecutorCatalog } = await vite.ssrLoadModule('/src/lib/executor-catalog.ts');
const { validateCreatorBenchResult } = await vite.ssrLoadModule(
  '/src/lib/creatorbench-contracts.ts',
);
const executors = buildExecutorCatalog({
  localMediaWorker: true,
  whisper: false,
  sceneDetect: true,
  opencv: true,
  higgsfieldAuthenticated: false,
  higgsfieldPromotionAppliesToCli: false,
});
const profileByExecutor = new Map(
  profilesConfig.profiles.map((profile) => [profile.executorId, profile]),
);
const capabilityByWorkflow = {
  'smart-reframe': 'video.reframe',
  'talking-head-cleanup': 'speech.detect-silence',
  'golden-quote-variants': 'speech.transcribe',
  'reference-template': 'story.plan',
  'dance-choreography': 'video.detect-subjects',
  'captioned-multi-format': 'video.render',
  'founder-product-launch': 'story.plan',
  'action-subject-following': 'video.reframe',
};
const routeDomain = (domain) => {
  if (domain === 'animals') return 'animal';
  if (['products-small-objects', 'hands-objects', 'product-launch', 'cooking'].includes(domain))
    return 'object';
  if (['groups-formations', 'dance', 'music-performance'].includes(domain)) return 'group';
  if (['fitness', 'climbing', 'skateboarding', 'basketball', 'field-sports'].includes(domain))
    return 'sport';
  return 'general';
};
const candidatesFor = () =>
  executors.map((definition) => {
    const profile = profileByExecutor.get(definition.id);
    return {
      definition,
      domains: profile?.domains ?? ['*'],
      defaultDisposition: profile?.defaultDisposition ?? 'review',
      assistance: profile?.assistance,
      available: definition.enabled,
      benchmark: undefined,
    };
  });

const routeReceipts = [];
const results = [];
for (const instance of instances) {
  const source = sources.get(instance.sourceIds[0]);
  if (!source) throw new Error(`Missing source ${instance.sourceIds[0]}`);
  const capability = capabilityByWorkflow[instance.workflow];
  const supporting = executors.filter((executor) => executor.capabilities.includes(capability));
  const startedAt = new Date().toISOString();
  const route = routeExecutor({
    request: {
      id: instance.id,
      capability,
      domain: routeDomain(instance.domain),
      privacy: instance.request.constraints.localOnly ? 'local-only' : 'derived-egress',
      maximumCostUsd: instance.request.constraints.maxCostUsd,
      maximumLatency: 'long',
      commercialUseRequired: true,
      availableGpuVramGb: undefined,
      requireBenchmarkPromotion: true,
      inputArtifactIds: instance.sourceIds,
    },
    candidates: candidatesFor(),
  });
  routeReceipts.push(route);
  const classification =
    route.disposition === 'abstain'
      ? supporting.length === 0
        ? 'unsupported'
        : 'safely_abstained'
      : 'review_required';
  const completedAt = new Date().toISOString();
  results.push(
    validateCreatorBenchResult({
      schemaVersion: 'nodevideo.creatorbench-result/v1',
      id: `result:${instance.id}`,
      benchmarkVersion: instance.benchmarkVersion,
      instanceId: instance.id,
      split: instance.split,
      classification,
      routeReceiptId: route.id,
      systemDeclaredSuccess: false,
      userInterventionCount: 0,
      outputArtifactIds: [],
      execution: {
        startedAt,
        completedAt,
        latencyMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
        costUsd: 0,
        executorVersions: [route.selectedExecutorId ?? 'router:no-eligible-executor'],
      },
      checks: {
        correctSubjectOrContent: null,
        intendedSemanticsPreserved: null,
        audioSynchronized: null,
        exportDecodesAndReopens: null,
        noUnsupportedSyntheticContent: true,
        rightsPassed: source.rights.status !== 'unclear',
        privacyPassed: instance.request.constraints.localOnly
          ? route.candidateDecisions.every(
              (candidate) =>
                !candidate.eligible ||
                !candidate.rejectedReasons.some((reason) => reason.code === 'privacy-conflict'),
            )
          : true,
        noUndeclaredExecutorSubstitution: true,
        provenanceComplete: true,
      },
      limitationCodes: ['routing-only-no-render', 'human-usability-review-required'],
    }),
  );
}
await vite.close();

const classes = [
  'automatic_usable',
  'assisted_usable',
  'review_required',
  'safely_abstained',
  'unsupported',
  'technical_failure',
  'silent_failure',
];
function aggregate(items) {
  return Object.fromEntries(
    classes.map((classification) => {
      const numerator = items.filter((result) => result.classification === classification).length;
      return [
        classification,
        {
          numerator,
          denominator: items.length,
          rate: ratio(numerator, items.length),
          confidenceInterval: wilsonInterval(numerator, items.length),
        },
      ];
    }),
  );
}
const sourceIds = new Set(instances.flatMap((instance) => instance.sourceIds));
const aggregateResult = {
  schemaVersion: 'nodevideo.creatorbench-evaluation/v1',
  benchmarkVersion: manifest.benchmarkVersion,
  evaluationMode: sealed ? 'sealed-private-heldout' : 'public-routing-and-ingestion',
  generatedAt: new Date().toISOString(),
  population: {
    instanceCount: results.length,
    sourceCount: sourceIds.size,
    creatorCount: new Set([...sourceIds].map((id) => sources.get(id)?.creatorOwnerId)).size,
    domainCount: new Set(instances.map((instance) => instance.domain)).size,
    workflowCount: new Set(instances.map((instance) => instance.workflow)).size,
  },
  outcomes: aggregate(results),
  subgroups: [
    ...[...new Set(instances.map((instance) => instance.domain))].sort().map((id) => ({
      kind: 'domain',
      id,
      count: instances.filter((instance) => instance.domain === id).length,
      outcomes: aggregate(
        results.filter(
          (result) =>
            instances.find((instance) => instance.id === result.instanceId)?.domain === id,
        ),
      ),
    })),
    ...[...new Set(instances.map((instance) => instance.workflow))].sort().map((id) => ({
      kind: 'workflow',
      id,
      count: instances.filter((instance) => instance.workflow === id).length,
      outcomes: aggregate(
        results.filter(
          (result) =>
            instances.find((instance) => instance.id === result.instanceId)?.workflow === id,
        ),
      ),
    })),
  ],
  routeDistribution: Object.entries(
    Object.groupBy(routeReceipts, (receipt) => receipt.selectedExecutorId ?? 'none'),
  ).map(([executorId, receipts]) => ({
    executorId,
    count: receipts.length,
    dispositions: Object.fromEntries(
      ['automatic', 'assisted', 'review', 'abstain'].map((disposition) => [
        disposition,
        receipts.filter((receipt) => receipt.disposition === disposition).length,
      ]),
    ),
  })),
  limitations: [
    'No result is classified usable until a rendered artifact is blindly reviewed by a human.',
    'This baseline measures request ingestion, rights validation, route eligibility, and honest non-success states—not editing quality.',
  ],
  resultsSha256: `sha256:${sha256(JSON.stringify(results))}`,
};
if (sealed) {
  await mkdir(resolve(evidenceRoot, 'results'), { recursive: true });
  await writeJson(resolve(evidenceRoot, 'results/sealed-results.json'), {
    ...aggregateResult,
    results,
    routeReceipts,
  });
  await writeJson(resolve(benchmarkRoot, 'receipts/sealed-evaluation-receipt.json'), {
    schemaVersion: 'nodevideo.creatorbench-sealed-evaluation-receipt/v1',
    benchmarkVersion: aggregateResult.benchmarkVersion,
    generatedAt: aggregateResult.generatedAt,
    population: aggregateResult.population,
    outcomes: aggregateResult.outcomes,
    resultsSha256: aggregateResult.resultsSha256,
    privateMediaExposed: false,
  });
} else {
  await mkdir(resolve(benchmarkRoot, 'results'), { recursive: true });
  await writeJson(resolve(benchmarkRoot, 'results/public-evaluation.json'), aggregateResult);
  await mkdir(resolve(evidenceRoot, 'results'), { recursive: true });
  await writeJson(resolve(evidenceRoot, 'results/public-route-receipts.json'), {
    results,
    routeReceipts,
  });
}
console.log(
  JSON.stringify(
    {
      mode: aggregateResult.evaluationMode,
      population: aggregateResult.population,
      outcomes: aggregateResult.outcomes,
    },
    null,
    2,
  ),
);
