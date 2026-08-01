import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compileFounderVariants } from '../../src/lib/founder-variant-compiler.ts';
import { EDIT_INTENT_SCHEMA } from '../../src/lib/media-orchestration-contracts.ts';
import { probeMedia, sanitizeProbe, sha256File } from '../media/media-proof-lib.mjs';
import { renderEditPlan } from './edit-plan-renderer-lib.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string', default: '.qa/evidence/creator-local' },
    preset: { type: 'string', default: 'variants' },
    transcription: { type: 'string', default: 'none' },
    language: { type: 'string' },
    prompt: {
      type: 'string',
      default: 'Create source-grounded, reviewable variants while preserving meaning.',
    },
    render: { type: 'string' },
  },
});
if (!positionals[0]) {
  throw new Error('Usage: creator-pipeline-local.mjs <source> [--preset cleanup|variants|founder]');
}
const source = resolve(positionals[0]);
const outputRoot = resolve(values.output);
await mkdir(outputRoot, { recursive: true });
const indexPath = join(outputRoot, 'media-index.json');
const pythonArgs = [
  resolve('scripts/analysis/build_media_index.py'),
  source,
  '--output',
  indexPath,
  '--asset-id',
  'asset.creator-source',
  '--transcription',
  values.transcription,
];
if (values.language) pythonArgs.push('--language', values.language);
const indexing = spawnSync('python', pythonArgs, {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 60 * 60 * 1_000,
});
if (indexing.status !== 0) throw new Error(indexing.stderr || 'Media indexing failed');
const mediaIndex = JSON.parse(await readFile(indexPath, 'utf8'));
const outputs = outputsFor(values.preset);
const intent = {
  schemaVersion: EDIT_INTENT_SCHEMA,
  id: `intent:${mediaIndex.id}:${values.preset}`,
  goal: values.prompt,
  instructions: values.prompt,
  sourceAssetIds: [mediaIndex.assetId],
  outputs,
  constraints: {
    preserveMeaning: true,
    requireHumanApproval: true,
    allowMediaEgress: false,
    allowGenerativeMedia: false,
    maximumCostUsd: 0,
    preferredRuntime: 'local',
  },
};
const compiled = compileFounderVariants(mediaIndex, intent);
await atomicJson(join(outputRoot, 'intent.json'), intent);
await atomicJson(join(outputRoot, 'variant-set.json'), compiled.variantSet);
for (const variant of compiled.variants) {
  await atomicJson(
    join(outputRoot, `${variant.output.id}.edit-plan-v1.json`),
    variant.rendererPlan,
  );
  await atomicJson(
    join(outputRoot, `${variant.output.id}.edit-plan-v2.json`),
    variant.semanticPlan,
  );
}

const requestedOutput = values.render;
if (!requestedOutput) {
  console.log(
    JSON.stringify(
      {
        outputRoot,
        status: 'awaiting-review',
        variants: compiled.variants.map((item) => item.output.id),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const selected = compiled.variants.find((item) => item.output.id === requestedOutput);
if (!selected)
  throw new Error(
    `Unknown output ${requestedOutput}; choose ${compiled.variants.map((item) => item.output.id).join(', ')}`,
  );
if (process.env.NODEVIDEO_VARIANT_APPROVED !== '1') {
  throw new Error('Set NODEVIDEO_VARIANT_APPROVED=1 after reviewing the selected EditPlan v2');
}
if (selected.semanticPlan.approvals.some((approval) => approval.status === 'required')) {
  selected.semanticPlan.approvals = selected.semanticPlan.approvals.map((approval) => ({
    ...approval,
    status: 'approved',
  }));
  await atomicJson(
    join(outputRoot, `${selected.output.id}.edit-plan-v2.approved.json`),
    selected.semanticPlan,
  );
}
const outputPath = join(outputRoot, `${selected.output.id}.mp4`);
const startedAt = new Date().toISOString();
const rendered = await renderEditPlan({
  plan: selected.rendererPlan,
  bindings: { 'asset.creator-source': source },
  outputPath,
  auxiliaryDirectory: join(outputRoot, '.render-work'),
});
const completedAt = new Date().toISOString();
const hash = await sha256File(outputPath);
const details = sanitizeProbe(probeMedia(outputPath));
const receipt = {
  schemaVersion: 'node.asset-receipt.v1',
  id: `asset:creator-local:${selected.output.id}`,
  assetKind: 'video',
  provider: 'nodevideo',
  model: rendered.rendererVersion,
  createdAt: completedAt,
  source: {
    promptHash: `sha256:${hashText(values.prompt)}`,
    referenceAssetIds: [mediaIndex.assetId],
    recipeId: 'recipe.founder-content',
  },
  output: {
    uri: outputPath,
    sha256: `sha256:${hash}`,
    mimeType: 'video/mp4',
    sizeBytes: Number(details.format.sizeBytes ?? 0),
    width: details.video?.codedWidth ?? undefined,
    height: details.video?.codedHeight ?? undefined,
    durationMs: details.format.durationSeconds
      ? Math.round(details.format.durationSeconds * 1000)
      : undefined,
  },
  rights: {
    sourceAssetsOwned: true,
    publicReleaseApproved: false,
    syntheticPeopleOnly: false,
    thirdPartyMarks: false,
    musicRedistribution: false,
    reviewStatus: 'pending',
    notes: [
      'Source ownership was asserted for local processing; public release requires a separate rights gate.',
    ],
  },
  execution: {
    startedAt,
    completedAt,
    estimatedCostUsd: 0,
    actualCostUsd: 0,
    attempt: 1,
    parametersHash: `sha256:${hashText(JSON.stringify({ preset: values.preset, transcription: values.transcription }))}`,
  },
  evaluation: {
    selected: true,
    scores: {},
    validatorIds: ['edit-plan.schema', 'media.probe', 'audio.preserved', 'asset-receipt.schema'],
    limitations: mediaIndex.provenance.limitations ?? [],
  },
  intendedUses: ['review'],
};
await atomicJson(`${outputPath}.receipt.json`, receipt);
await atomicJson(join(outputRoot, 'run-receipt.json'), {
  schemaVersion: 'nodevideo.creator-local-run.v1',
  status: 'succeeded',
  mediaIndex,
  intent,
  selectedPlan: selected.semanticPlan,
  renderManifest: rendered.manifest,
  assetReceipt: receipt,
});
console.log(
  JSON.stringify(
    { outputPath, hasAudio: Boolean(details.audio), receipt: `${outputPath}.receipt.json` },
    null,
    2,
  ),
);

function outputsFor(preset) {
  if (preset === 'cleanup')
    return [
      { id: 'clean-master', purpose: 'clean-master', aspectRatio: 'source', platform: 'generic' },
    ];
  if (preset === 'founder')
    return [
      {
        id: 'launch-landscape',
        purpose: 'launch',
        durationSeconds: 30,
        aspectRatio: '16:9',
        platform: 'youtube',
      },
      {
        id: 'launch-vertical',
        purpose: 'launch',
        durationSeconds: 15,
        aspectRatio: '9:16',
        platform: 'instagram',
      },
    ];
  return [
    {
      id: 'golden-short',
      purpose: 'short',
      durationSeconds: 15,
      aspectRatio: '9:16',
      platform: 'tiktok',
    },
    {
      id: 'social-square',
      purpose: 'social',
      durationSeconds: 15,
      aspectRatio: '1:1',
      platform: 'linkedin',
    },
    { id: 'long-cut', purpose: 'long-form', aspectRatio: '16:9', platform: 'youtube' },
  ];
}

function hashText(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}
