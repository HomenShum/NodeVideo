#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const jobId = value('--job-id');
const root = resolve(value('--proof-root'));
const baseUrl = required(
  process.env.NODEVIDEO_WORKER_CONTROL_URL,
  'NODEVIDEO_WORKER_CONTROL_URL',
).replace(/\/$/, '');
const token = required(
  process.env.NODEVIDEO_WORKER_CONTROL_TOKEN,
  'NODEVIDEO_WORKER_CONTROL_TOKEN',
);
const workerInput = await call('read-worker-input', { jobId });
const expectedRoles = [
  'choreography-reference',
  'creator-take-a',
  'creator-take-b',
  'chosen-song',
  'timed-lyrics',
];
if (expectedRoles.some((role) => !workerInput.assets.some((asset) => asset.role === role))) {
  throw new Error('Live case is missing a required admitted role.');
}

const outputs = new Map([
  ['learn_creator_profile', [join(root, 'creator-taste-run.json'), 'creator-taste-profile']],
  ['extract_reference_motion', [join(root, 'reference-selected-30fps.npz'), 'reference-motion']],
  ['analyze_takes', [join(root, 'alignment-30fps.json'), 'take-analysis']],
  [
    'ground_subjects',
    [join(root, 'locate-anything', 'locate-result.json'), 'locate-anything-grounding'],
  ],
  ['interpret_production', [join(root, 'creator-taste-run.json'), 'production-audit']],
  ['match_phrases', [join(root, 'analysis-strict-candidate.json'), 'phrase-match']],
  ['plan_sequence', [join(root, 'analysis-strict-candidate.json'), 'sequence-plan']],
  [
    'place_lyrics',
    [join(root, 'locate-anything', 'caption-safety.json'), 'lyrics-layout-validation'],
  ],
  [
    'compose_editorial_overlays',
    [join(root, 'strict-render-v3', 'edit-plan.json'), 'creator-editorial-plan'],
  ],
  ['compile_plan', [join(root, 'strict-render', 'edit-plan.json'), 'edit-plan']],
  ['render_preview', [join(root, 'strict-render', 'source-only-song-preview.mp4'), 'preview']],
  ['validate_preview', [join(root, 'strict-render', 'generation-manifest.json'), 'validation']],
]);
const stages = [
  'validate_inputs',
  'ingest_reference',
  'learn_creator_profile',
  'normalize_media',
  'align_reference_song',
  'extract_reference_motion',
  'analyze_takes',
  'ground_subjects',
  'interpret_production',
  'match_phrases',
  'plan_sequence',
  'place_lyrics',
  'compose_editorial_overlays',
  'compile_plan',
  'render_preview',
  'validate_preview',
];
const startStage = optionalValue('--start-stage');
const startIndex = startStage === undefined ? 0 : stages.indexOf(startStage);
if (startIndex < 0) throw new Error(`Unknown --start-stage value: ${startStage}`);
const groundingBytes = await readFile(join(root, 'locate-anything', 'locate-result.json'));
const groundingDigest = digest(groundingBytes);

for (const stage of stages.slice(startIndex)) {
  const leaseId = `worker.${randomUUID()}`;
  const claim = await call('claim-stage', { jobId, stage, leaseId, leaseMs: 15 * 60 * 1000 });
  if (!claim.claimed) throw new Error(`Could not claim ${stage}: ${claim.reason}`);
  try {
    const configured = outputs.get(stage);
    const bytes = configured
      ? await readFile(configured[0])
      : Buffer.from(
          `${JSON.stringify({ schemaVersion: 'nodevideo.stage-receipt/v1', stage, inputDigest: workerInput.job.inputDigest, verifiedAssetRoles: expectedRoles })}\n`,
        );
    const kind = configured?.[1] ?? 'stage-receipt';
    const mimeType = configured?.[0].endsWith('.mp4')
      ? 'video/mp4'
      : configured?.[0].endsWith('.npz')
        ? 'application/x-npz'
        : 'application/json';
    const storageId = await uploadArtifact(bytes, mimeType, stage);
    const artifact = await call('record-stage-artifact', {
      jobId,
      stage,
      leaseId,
      leaseToken: claim.leaseToken,
      artifactKey: `stage.${String(stages.indexOf(stage)).padStart(2, '0')}.${stage}`,
      kind,
      storageId,
      sha256: digest(bytes),
      mimeType,
      sizeBytes: bytes.byteLength,
      toolName: 'nodevideo.live-proof-stage-publisher',
      toolVersion: '1.0.0',
      inputDigests: [
        workerInput.job.inputDigest,
        ...(stages.indexOf(stage) > stages.indexOf('ground_subjects') ? [groundingDigest] : []),
      ],
      metadata: {
        sourceOnly: true,
        frozenCandidate: stage === 'validate_preview',
        ...(stage === 'ground_subjects'
          ? { provider: 'nvidia/LocateAnything-3B', backend: 'official-hugging-face-space' }
          : {}),
      },
    });
    await call('complete-stage', {
      jobId,
      stage,
      leaseId,
      leaseToken: claim.leaseToken,
      outputArtifactIds: [artifact.artifactId],
      checkpoint: { artifactId: artifact.artifactId, sha256: digest(bytes) },
    });
    console.log(`Completed ${stage}.`);
  } catch (error) {
    await call('fail-stage', {
      jobId,
      stage,
      leaseId,
      leaseToken: claim.leaseToken,
      error: error instanceof Error ? error.message : 'stage_publish_failed',
      retryable: false,
    });
    throw error;
  }
}
console.log(
  JSON.stringify({
    schemaVersion: 'nodevideo.live-stage-publication/v1',
    jobId,
    completedStages: stages.length,
  }),
);

async function call(path, body) {
  const response = await fetch(`${baseUrl}/control/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}
async function uploadArtifact(bytes, mimeType, stage) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { uploadUrl } = await call('create-worker-upload-url', {});
      const upload = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'content-type': mimeType },
        body: bytes,
      });
      if (!upload.ok) throw new Error(`HTTP ${upload.status}`);
      return (await upload.json()).storageId;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * attempt));
    }
  }
  throw new Error(
    `Artifact upload failed for ${stage}: ${lastError instanceof Error ? lastError.message : 'unknown error'}`,
  );
}
function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
function value(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${flag} is required.`);
  return process.argv[index + 1];
}
function optionalValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : undefined;
}
function required(input, name) {
  if (!input) throw new Error(`${name} is required.`);
  return input;
}
