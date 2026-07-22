import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const catalog = JSON.parse(
  await readFile(resolve(root, 'config/tracking-domain-packs.json'), 'utf8'),
);
const generatedFiles = [];

const inputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['assetId', 'authorized', 'targetSelection', 'aspectRatio'],
  properties: {
    assetId: { type: 'string', minLength: 1 },
    authorized: { const: true },
    targetSelection: { type: 'array', minItems: 1, items: { type: 'string' } },
    aspectRatio: { enum: ['16:9', '9:16', '1:1'] },
  },
  additionalProperties: false,
};

const outputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['trackId', 'actionEnvelopeId', 'reframePlanId', 'criticVerdict'],
  properties: {
    trackId: { type: 'string' },
    actionEnvelopeId: { type: 'string' },
    reframePlanId: { type: 'string' },
    criticVerdict: { enum: ['pass', 'review', 'fail'] },
  },
  additionalProperties: false,
};

for (const pack of catalog.packs) {
  const directory = resolve(root, 'packs', pack.id);
  await mkdir(resolve(directory, 'tools'), { recursive: true });
  await mkdir(resolve(directory, 'evals'), { recursive: true });
  const id = `nodevideo.${pack.id}`;
  const tools = [
    `${pack.id}.detect`,
    `${pack.id}.track`,
    `${pack.id}.build_action_envelope`,
    `${pack.id}.plan_reframe`,
    `${pack.id}.validate`,
  ];
  const manifest = {
    schema: 'nodevideo.capability-pack.v1',
    id,
    version: '0.1.0',
    implementationStatus: 'rights-cleared-specialist-fixture-validated',
    title: pack.title,
    description: pack.description,
    entrypoints: {
      skill: 'skill.md',
      inputSchema: 'input.schema.json',
      outputSchema: 'output.schema.json',
      toolRegistry: 'tools/registry.json',
    },
    inputs: ['video/authorized', 'video/target-selection', 'video/framing-intent'],
    outputs: [
      'video/detection-track',
      'video/action-envelope',
      'video/reframe-plan',
      'video/reframe-critic',
    ],
    tools,
    permissions: ['read_authorized_video', 'write_private_derived_artifacts'],
    uiRenderers: ['TrackingAtlasCard', 'DetectorArenaComparison', 'CropPathOverlay'],
    evalSuite: 'evals/contract-v1.json',
    validation: {
      status: 'passed',
      profile: `${pack.id}-cc-fixture-v1`,
      fixture: pack.fixture,
      excludes: ['generalized-held-out-creator-coverage', 'autonomous-publication'],
    },
    execution: {
      kind: 'specialist-detector-to-common-reframe-contract',
      detectorChain: pack.detectors,
      framingPolicy: pack.policy,
      rawMediaEgress: 'none',
      modelRequired: false,
      applicationWriteAuthority: 'proposal-validation-approval-apply',
    },
  };
  const registry = {
    schema: 'nodevideo.tool-registry.v1',
    pack: `${id}@0.1.0`,
    tools: [
      { id: tools[0], accepts: ['video/authorized'], produces: ['video/detections'] },
      { id: tools[1], accepts: ['video/detections'], produces: ['video/detection-track'] },
      {
        id: tools[2],
        accepts: ['video/detection-track'],
        produces: ['video/action-envelope'],
      },
      {
        id: tools[3],
        accepts: ['video/action-envelope', 'video/framing-intent'],
        produces: ['video/reframe-plan'],
      },
      {
        id: tools[4],
        accepts: ['video/reframe-plan'],
        produces: ['video/reframe-critic'],
      },
    ],
  };
  const evaluation = {
    schema: 'nodevideo.capability-eval.v1',
    pack: `${id}@0.1.0`,
    profile: `${pack.id}-cc-fixture-v1`,
    cases: [
      {
        id: pack.fixture,
        status: 'passed',
        proof: `fixtures/media/tracking-atlas-v1/${pack.id}/receipt.json`,
      },
      { id: `${pack.id}-held-out`, status: 'planned' },
    ],
    claimBoundary:
      'The passing claim covers the named rights-cleared Creative Commons fixture and common contract only. Creator-held-out generalization remains a promotion gate.',
  };
  const skill = `# ${pack.title}\n\nUse this pack when the requested target semantics match **${pack.targets.join(', ')}**.\n\n## Contract\n\n1. Verify source authorization.\n2. Detect with ${pack.detectors.join(' -> ')}.\n3. Emit the common DetectionTrack and ActionEnvelope artifacts.\n4. Apply the ${pack.policy} framing policy.\n5. Validate target coverage, crop motion, identity switches, and preview/export parity.\n6. Return a reviewable proposal; never mutate the canonical video directly.\n\n## Honest boundary\n\nThe checked-in fixture is rights-cleared stock evidence, not proof of universal creator-media performance. Low-confidence ranges hold or widen; they never silently switch targets.\n`;
  await Promise.all([
    writeFile(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(resolve(directory, 'input.schema.json'), `${JSON.stringify(inputSchema, null, 2)}\n`),
    writeFile(
      resolve(directory, 'output.schema.json'),
      `${JSON.stringify(outputSchema, null, 2)}\n`,
    ),
    writeFile(resolve(directory, 'tools/registry.json'), `${JSON.stringify(registry, null, 2)}\n`),
    writeFile(
      resolve(directory, 'evals/contract-v1.json'),
      `${JSON.stringify(evaluation, null, 2)}\n`,
    ),
    writeFile(resolve(directory, 'skill.md'), skill),
  ]);
  generatedFiles.push(
    resolve(directory, 'manifest.json'),
    resolve(directory, 'input.schema.json'),
    resolve(directory, 'output.schema.json'),
    resolve(directory, 'tools/registry.json'),
    resolve(directory, 'evals/contract-v1.json'),
  );
}

const biome =
  process.platform === 'win32'
    ? resolve(root, 'node_modules', '@biomejs', 'cli-win32-x64', 'biome.exe')
    : resolve(root, 'node_modules', '.bin', 'biome');
execFileSync(biome, ['format', '--write', ...generatedFiles], { stdio: 'inherit' });

console.log(`${catalog.packs.length} tracking capability packs generated.`);
