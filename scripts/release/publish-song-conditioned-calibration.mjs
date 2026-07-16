#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  probeMedia,
  requireFile,
  runText,
  sanitizeProbe,
  sha256File,
  writeJson,
} from '../media/media-proof-lib.mjs';

if (process.argv.includes('--help')) {
  console.log(`Usage: node scripts/release/publish-song-conditioned-calibration.mjs [options]

Options:
  --input <directory>   Private evidence directory
  --output <directory>  Public release directory
  --verify-public       Verify the existing public release without writing files
  --help                Show this help without writing files`);
  process.exit(0);
}

const CASE_ID = 'song-conditioned-real-calibration-v1';
const inputRoot = resolve(
  argument('--input') ?? '.qa/evidence/private/song-conditioned-source-only-v1',
);
const outputRoot = resolve(argument('--output') ?? `fixtures/media/${CASE_ID}`);
const verifyOnly = process.argv.includes('--verify-public');
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';

if (verifyOnly) {
  const result = await verifyPublic(outputRoot);
  console.log(`Verified ${CASE_ID} (${result.verifiedArtifacts} hash-bound artifacts).`);
  process.exit(0);
}

const inputPaths = {
  analysis: join(inputRoot, 'analysis.json'),
  plan: join(inputRoot, 'edit-plan.json'),
  generation: join(inputRoot, 'generation-manifest.json'),
  freeze: join(inputRoot, 'freeze-receipt.json'),
  evaluation: join(inputRoot, 'post-freeze-evaluation.json'),
  preview: join(inputRoot, 'source-only-song-preview.mp4'),
};
for (const [label, path] of Object.entries(inputPaths)) {
  requireFile(path, label);
}
await verifyPrivateEvidence(inputPaths);
await mkdir(outputRoot, { recursive: true });

const copied = {
  analysis: join(outputRoot, 'analysis.json'),
  plan: join(outputRoot, 'edit-plan.json'),
  generation: join(outputRoot, 'generation-manifest.json'),
  freeze: join(outputRoot, 'freeze-receipt.json'),
  evaluation: join(outputRoot, 'post-freeze-evaluation.json'),
};
for (const [key, outputPath] of Object.entries(copied)) {
  const bytes = await readFile(inputPaths[key]);
  assertPublicSafeJson(bytes, key);
  await writeFile(outputPath, bytes);
}

const silentPreview = join(outputRoot, 'picture-only-preview.mp4');
runText(ffmpeg, [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-i',
  inputPaths.preview,
  '-map',
  '0:v:0',
  '-an',
  '-c:v',
  'copy',
  '-movflags',
  '+faststart',
  silentPreview,
]);
const probe = sanitizeProbe(probeMedia(silentPreview));
if (probe.audio || Math.abs(probe.format.durationSeconds - 44.5) > 0.04) {
  throw new Error('Public calibration preview must be silent and 44.5 seconds long.');
}

const evaluation = JSON.parse(await readFile(copied.evaluation, 'utf8'));
const freeze = JSON.parse(await readFile(copied.freeze, 'utf8'));
const frozenRender = freeze.files.find((record) => record.file.endsWith('.mp4'));
if (!frozenRender) throw new Error('Private freeze does not bind its rendered preview.');
const derivationPath = join(outputRoot, 'derivation-receipt.json');
await writeJson(derivationPath, {
  schemaVersion: 'nodevideo.picture-only-derivation.v1',
  createdAt: evaluation.createdAt,
  sourceFreezeReceiptSha256: await sha256File(copied.freeze),
  sourceRenderSha256: frozenRender.sha256,
  publishedPreviewSha256: await sha256File(silentPreview),
  transform: 'copy-video-stream-remove-all-audio-faststart',
  audioRemoved: true,
});
const baseUrl = `/media/${CASE_ID}`;
const artifactPaths = [
  ['analysis', copied.analysis, 'application/json'],
  ['edit-plan', copied.plan, 'application/json'],
  ['generation-manifest', copied.generation, 'application/json'],
  ['freeze-receipt', copied.freeze, 'application/json'],
  ['post-freeze-evaluation', copied.evaluation, 'application/json'],
  ['derivation-receipt', derivationPath, 'application/json'],
  ['picture-only-preview', silentPreview, 'video/mp4'],
];
const artifacts = await Promise.all(
  artifactPaths.map(async ([id, path, mimeType]) => ({
    id,
    file: basename(path),
    mimeType,
    sha256: await sha256File(path),
    url: `${baseUrl}/${basename(path)}`,
  })),
);
const manifest = {
  schemaVersion: 'nodevideo.song-conditioned-calibration-release.v1',
  id: CASE_ID,
  title: 'Target-picture-isolated song-conditioned calibration',
  publication: {
    commercialAudioIncluded: false,
    sourceContainersIncluded: false,
    previewPolicy: 'sanitized-derived-picture-only',
  },
  isolation: evaluation.isolation,
  result: evaluation.technicalComparison,
  tasteStatus: evaluation.tasteStatus,
  claim:
    'The generator CLI accepted no target picture or target plan, and its audited read log was frozen before evaluation. This is not an OS sandbox. The exact authorized soundtrack was an input oracle, so song selection and general taste are not proven.',
  artifacts,
};
await writeJson(join(outputRoot, 'manifest.json'), manifest);
const result = await verifyPublic(outputRoot);
console.log(`Published ${CASE_ID} (${result.verifiedArtifacts} hash-bound artifacts).`);

async function verifyPrivateEvidence(paths) {
  const [freezeBytes, evaluationBytes] = await Promise.all([
    readFile(paths.freeze),
    readFile(paths.evaluation),
  ]);
  const freeze = JSON.parse(freezeBytes);
  const evaluation = JSON.parse(evaluationBytes);
  if (
    freeze.targetMountedDuringGeneration !== false ||
    freeze.targetReadDuringGeneration !== false ||
    evaluation.isolation?.passed !== true ||
    evaluation.isolation?.targetOpenedOnlyAfterFreezeVerification !== true ||
    evaluation.artifactBindings?.freezeReceiptSha256 !== (await sha256File(paths.freeze)) ||
    evaluation.technicalComparison?.cutBoundaries?.f1 < 0.9 ||
    evaluation.technicalComparison?.phraseSourceAgreement?.agreementRatio !== 1
  ) {
    throw new Error('Private source-only calibration did not satisfy its release gates.');
  }
  for (const record of freeze.files) {
    const path = join(inputRoot, record.file);
    requireFile(path, record.file);
    if ((await sha256File(path)) !== record.sha256) {
      throw new Error(`Frozen generation artifact changed: ${record.file}`);
    }
  }
}

async function verifyPublic(root) {
  const expectedFiles = {
    analysis: 'analysis.json',
    'edit-plan': 'edit-plan.json',
    'generation-manifest': 'generation-manifest.json',
    'freeze-receipt': 'freeze-receipt.json',
    'post-freeze-evaluation': 'post-freeze-evaluation.json',
    'derivation-receipt': 'derivation-receipt.json',
    'picture-only-preview': 'picture-only-preview.mp4',
  };
  const manifestPath = join(root, 'manifest.json');
  requireFile(manifestPath, 'public calibration manifest');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const artifactById = new Map(manifest.artifacts?.map((artifact) => [artifact.id, artifact]));
  if (
    manifest.schemaVersion !== 'nodevideo.song-conditioned-calibration-release.v1' ||
    manifest.publication?.commercialAudioIncluded !== false ||
    manifest.publication?.sourceContainersIncluded !== false ||
    manifest.isolation?.passed !== true ||
    manifest.result?.cutBoundaries?.f1 < 0.9 ||
    manifest.result?.phraseSourceAgreement?.agreementRatio !== 1 ||
    manifest.tasteStatus !== 'not-evaluated' ||
    artifactById.size !== Object.keys(expectedFiles).length ||
    Object.entries(expectedFiles).some(([id, file]) => artifactById.get(id)?.file !== file)
  ) {
    throw new Error('Public calibration manifest failed its claim contract.');
  }
  for (const artifact of manifest.artifacts) {
    const path = join(root, artifact.file);
    requireFile(path, artifact.id);
    if ((await sha256File(path)) !== artifact.sha256) {
      throw new Error(`${artifact.id} failed public SHA-256 verification.`);
    }
  }
  const actualFiles = (await readdir(root)).sort();
  const allowedFiles = ['manifest.json', ...Object.values(expectedFiles)].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(allowedFiles)) {
    throw new Error('Public calibration directory contains an unexpected file.');
  }

  const [freeze, evaluation, generation, derivation] = await Promise.all(
    ['freeze-receipt', 'post-freeze-evaluation', 'generation-manifest', 'derivation-receipt'].map(
      async (id) => JSON.parse(await readFile(join(root, artifactById.get(id).file), 'utf8')),
    ),
  );
  const artifactHash = (id) => artifactById.get(id)?.sha256;
  const frozenFiles = new Map(freeze.files?.map((record) => [record.file, record.sha256]));
  const frozenRender = freeze.files?.find((record) => record.file.endsWith('.mp4'));
  if (
    freeze.schemaVersion !== 'nodevideo.generation-freeze.v1' ||
    freeze.targetMountedDuringGeneration !== false ||
    freeze.targetReadDuringGeneration !== false ||
    freeze.targetPlanReadDuringGeneration !== false ||
    frozenFiles.size !== 4 ||
    frozenFiles.get('analysis.json') !== artifactHash('analysis') ||
    frozenFiles.get('edit-plan.json') !== artifactHash('edit-plan') ||
    frozenFiles.get('generation-manifest.json') !== artifactHash('generation-manifest') ||
    !frozenRender ||
    generation.render?.sha256 !== frozenRender.sha256 ||
    generation.render?.hasAudio !== true ||
    generation.decisions?.cameraAudioMuted !== true ||
    evaluation.artifactBindings?.freezeReceiptSha256 !== artifactHash('freeze-receipt') ||
    evaluation.artifactBindings?.generatedPlanSha256 !== artifactHash('edit-plan') ||
    !isSha256(evaluation.artifactBindings?.evaluatorOnlyPlanSha256) ||
    JSON.stringify(evaluation.isolation) !== JSON.stringify(manifest.isolation) ||
    JSON.stringify(evaluation.technicalComparison) !== JSON.stringify(manifest.result) ||
    derivation.schemaVersion !== 'nodevideo.picture-only-derivation.v1' ||
    derivation.sourceFreezeReceiptSha256 !== artifactHash('freeze-receipt') ||
    derivation.sourceRenderSha256 !== frozenRender.sha256 ||
    derivation.publishedPreviewSha256 !== artifactHash('picture-only-preview') ||
    derivation.transform !== 'copy-video-stream-remove-all-audio-faststart' ||
    derivation.audioRemoved !== true
  ) {
    throw new Error('Public calibration artifact chain failed semantic verification.');
  }

  const preview = artifactById.get('picture-only-preview');
  const probe = sanitizeProbe(probeMedia(join(root, preview.file)));
  if (probe.audio || Math.abs(probe.format.durationSeconds - 44.5) > 0.04) {
    throw new Error('Public picture-only preview media contract failed.');
  }
  return { verifiedArtifacts: manifest.artifacts.length };
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function assertPublicSafeJson(bytes, label) {
  const text = bytes.toString('utf8');
  JSON.parse(text);
  if (/[A-Z]:[\\/]|\.mov\b|target-sanitized|source-[ab]-sanitized/iu.test(text)) {
    throw new Error(`${label} exposes a private path or source filename.`);
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}
