import { resolve } from 'node:path';
import {
  benchmarkRoot,
  evidenceRoot,
  loadAllSources,
  readJson,
  sha256,
  writeJson,
} from './creatorbench-io.mjs';
import { applyCreatorBenchScenario, creatorBenchScenarios } from './creatorbench-scenarios.mjs';

const config = await readJson(resolve(benchmarkRoot, 'config/domains.json'));
const sources = await loadAllSources();
const acquisitionVault = await readJson(resolve(evidenceRoot, 'acquisition-vault.json'));
const domainBySource = new Map(
  acquisitionVault.records.map((record) => [record.id, record.domain]),
);
const locatorClassBySource = new Map(
  acquisitionVault.records.map((record) => [record.id, record.sourceLocatorClass]),
);
const adversarialRequests = [
  'Target leaves and re-enters after occlusion; retain identity or request assistance.',
  'Two similar subjects cross; do not silently switch identity.',
  'Rapid camera movement and low confidence; hold safely or abstain.',
  'Selected object changes orientation; preserve the selected instance.',
  'Input may have poor audio or a corrupt tail; report the exact degraded state.',
];

function workflowRequest(source, workflow, workflowIndex) {
  const requests = {
    'smart-reframe':
      'Generate 16:9, 9:16, and 1:1 reframes while preserving the intended subject and action context.',
    'talking-head-cleanup':
      'Remove only accidental silence and review filler edits without truncating speech or intentional pauses.',
    'golden-quote-variants':
      'Find a source-grounded quote and propose 15-, 30-, and 60-second variants with exact lineage.',
    'reference-template':
      'Apply a permitted structural template without copying protected footage, branding, music, or scripts.',
    'dance-choreography':
      'Preserve movement phrases and compile reviewable cut and alignment proposals.',
    'captioned-multi-format':
      'Produce captioned horizontal, vertical, and square variants with safe caption placement.',
    'founder-product-launch':
      'Build hook, problem, product, demonstration, evidence, and CTA variants without inventing claims.',
    'action-subject-following':
      'Follow the intended subject while preserving relevant action context and surfacing uncertainty.',
  };
  const createdAt = source.acquiredAt;
  return {
    schemaVersion: 'nodevideo.creator-request/v1',
    id: `request:${source.id}:${workflow}`,
    createdAt,
    sourceAssets: [
      {
        artifactId: source.id,
        role: 'primary',
        sha256: source.sourceSha256,
        locatorClass:
          source.split === 'private-heldout'
            ? 'private-vault'
            : locatorClassBySource.get(source.id) === 'repository-generated-public'
              ? 'repository-fixture'
              : 'public-url',
      },
    ],
    ...(workflow === 'reference-template'
      ? {
          reference: {
            artifactId: 'template:creatorbench-permitted-structure-v1',
            permittedUse: 'structural-inspiration',
          },
        }
      : {}),
    output: {
      destinations: ['review'],
      targetDurationsMs: workflow === 'golden-quote-variants' ? [15_000, 30_000, 60_000] : [30_000],
      aspectRatios: ['16:9', '9:16', '1:1'],
    },
    constraints: {
      privacy: source.split === 'private-heldout' ? 'private' : 'public',
      localOnly: source.split === 'private-heldout',
      maxCostUsd: 0,
      maxLatencyMs: 120_000,
      permittedExecutors: [],
      prohibitedExecutors:
        source.split === 'private-heldout'
          ? ['runtime:api', 'runtime:remote-worker', 'runtime:mcp']
          : [],
      mediaEgress: 'prohibited',
    },
    rights: {
      status: source.split === 'private-heldout' ? 'restricted-private' : source.rights.status,
      ownerOrLicensorId: source.creatorOwnerId,
      permittedDerivativeUse: true,
      permittedModelProcessing: true,
    },
    intent: {
      workflow,
      instruction:
        source.split === 'adversarial'
          ? `${requests[workflow]} ${adversarialRequests[workflowIndex % adversarialRequests.length]}`
          : requests[workflow],
      preserve: ['source meaning', 'selected subject', 'rights lineage'],
      avoid: ['silent subject switches', 'unsupported claims', 'unapproved egress'],
    },
    requiredHumanApprovalPoints: ['before-render', 'before-canonical-apply', 'before-publish'],
  };
}

const instances = sources.flatMap((source) =>
  config.workflows
    .filter((workflow) => source.admissibleWorkflows.includes(workflow))
    .flatMap((workflow, workflowIndex) => {
      const baseRequest = workflowRequest(source, workflow, workflowIndex);
      return creatorBenchScenarios.map((scenario, scenarioIndex) => ({
        schemaVersion: 'nodevideo.creatorbench-instance/v1',
        id: `instance:${source.id}:${workflow}:${scenario.id}`,
        benchmarkVersion: config.benchmarkVersion,
        sourceIds: [source.id],
        domain: domainBySource.get(source.id) ?? 'general-creator-footage',
        workflow,
        scenarioId: scenario.id,
        split: source.split,
        request: applyCreatorBenchScenario(baseRequest, scenario),
        ...(source.split === 'private-heldout'
          ? {
              evaluatorTargetRef: `sealed:${sha256(
                `${source.id}:${workflow}:${scenario.id}:target`,
              ).slice(0, 24)}`,
            }
          : {}),
        adversarialConditions:
          source.split === 'adversarial'
            ? [adversarialRequests[(workflowIndex + scenarioIndex) % adversarialRequests.length]]
            : [],
        createdAt: source.acquiredAt,
      }));
    }),
);
const publicInstances = instances.filter((instance) => instance.split !== 'private-heldout');
const privateInstances = instances.filter((instance) => instance.split === 'private-heldout');
const publicManifest = {
  schemaVersion: 'nodevideo.creatorbench-instance-manifest.v1',
  benchmarkVersion: config.benchmarkVersion,
  generatedAt: new Date().toISOString(),
  instances: publicInstances,
};
const privateManifest = {
  schemaVersion: 'nodevideo.creatorbench-private-instance-manifest.v1',
  benchmarkVersion: config.benchmarkVersion,
  generatedAt: new Date().toISOString(),
  instances: privateInstances,
};
await writeJson(resolve(benchmarkRoot, 'catalog/public-instances.json'), publicManifest);
await writeJson(resolve(evidenceRoot, 'private-heldout-instances.json'), privateManifest);
const receipt = {
  schemaVersion: 'nodevideo.creatorbench-instance-receipt.v1',
  benchmarkVersion: config.benchmarkVersion,
  generatedAt: new Date().toISOString(),
  sourceCount: sources.length,
  instanceCount: instances.length,
  workflowCount: config.workflows.length,
  scenarioCount: creatorBenchScenarios.length,
  representedWorkflowCount: new Set(instances.map((instance) => instance.workflow)).size,
  corpusTierCounts: Object.fromEntries(
    Object.entries(Object.groupBy(sources, (source) => source.corpusTier)).map(
      ([tier, records]) => [tier, records.length],
    ),
  ),
  domainCount: new Set(sources.map((source) => domainBySource.get(source.id))).size,
  creatorCount: new Set(sources.map((source) => source.creatorOwnerId)).size,
  splitCounts: Object.fromEntries(
    ['development', 'public-test', 'private-heldout', 'adversarial'].map((split) => [
      split,
      instances.filter((instance) => instance.split === split).length,
    ]),
  ),
  publicManifestSha256: `sha256:${sha256(JSON.stringify(publicManifest))}`,
  privateManifestSha256: `sha256:${sha256(JSON.stringify(privateManifest))}`,
};
await writeJson(resolve(benchmarkRoot, 'receipts/instance-receipt.json'), receipt);
console.log(JSON.stringify(receipt, null, 2));
