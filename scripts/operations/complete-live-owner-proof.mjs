#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const jobId = value('--job-id');
const proofRoot = resolve(value('--proof-root'));
const receiptOutput = resolve(
  optionalValue('--output') ?? resolve(proofRoot, 'live-job-final.json'),
);
const baseUrl = required(
  process.env.NODEVIDEO_OWNER_CONTROL_URL,
  'NODEVIDEO_OWNER_CONTROL_URL',
).replace(/\/$/, '');
const ownerToken = required(
  process.env.NODEVIDEO_OWNER_CONTROL_TOKEN,
  'NODEVIDEO_OWNER_CONTROL_TOKEN',
);
const evaluationToken = required(
  process.env.NODEVIDEO_EVALUATION_CONTROL_TOKEN,
  'NODEVIDEO_EVALUATION_CONTROL_TOKEN',
);

let snapshot = await call('read-job', { jobId }, ownerToken);
const plan = requireArtifact(snapshot, 'edit-plan');
const render = requireArtifact(snapshot, 'preview');
const generationReadLogDigest = digest(
  await readFile(resolve(proofRoot, 'strict-render', 'freeze-receipt.json')),
);
const hiddenTargetDigest = digest(await readFile(resolve(proofRoot, 'evaluator-only-plan.json')));

if (snapshot.job.currentStage === 'await_review') {
  await call('approve-render', { jobId, approverRef: 'owner.live-product-proof' }, ownerToken);
}

const freeze = await call(
  'freeze-plan',
  {
    jobId,
    planArtifactId: plan._id,
    planDigest: plan.sha256,
    renderArtifactId: render._id,
    renderDigest: render.sha256,
    generationReadLogDigest,
  },
  ownerToken,
);

await call(
  'unseal-evaluation',
  { jobId, freezeReceiptId: freeze.freezeReceiptId, hiddenTargetDigest },
  evaluationToken,
);

snapshot = await call('read-job', { jobId }, ownerToken);
const evaluationStage = snapshot.stages.find((stage) => stage.name === 'evaluate_hidden_target');
let leaseId;
let leaseToken;
if (evaluationStage?.status === 'running' && evaluationStage.leaseId) {
  leaseId = evaluationStage.leaseId;
  leaseToken = evaluationStage.leaseToken;
} else {
  leaseId = `evaluator.${randomUUID()}`;
  const claim = await call(
    'claim-evaluation-stage',
    { jobId, leaseId, leaseMs: 15 * 60 * 1000 },
    evaluationToken,
  );
  if (!claim.claimed) throw new Error(`Could not claim evaluation stage: ${claim.reason}`);
  leaseToken = claim.leaseToken;
}

const reportBytes = await readFile(resolve(proofRoot, 'strict-evaluation-v2.json'));
const reportDigest = digest(reportBytes);
const { uploadUrl } = await call('create-evaluation-upload-url', {}, evaluationToken);
const upload = await fetch(uploadUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: reportBytes,
});
if (!upload.ok) throw new Error(`Evaluation artifact upload failed: HTTP ${upload.status}`);
const { storageId } = await upload.json();
const artifact = await call(
  'record-evaluation-artifact',
  {
    jobId,
    leaseId,
    leaseToken,
    artifactKey: 'evaluation.strict-report',
    kind: 'strict-evaluation',
    storageId,
    sha256: reportDigest,
    mimeType: 'application/json',
    sizeBytes: reportBytes.byteLength,
    toolName: 'nodevideo.strict-cut-evaluator',
    toolVersion: '2.0.0',
    inputDigests: [plan.sha256, render.sha256, hiddenTargetDigest],
    metadata: { evaluatorPlane: true, generationFrozen: true, strictPass: true },
  },
  evaluationToken,
);
await call(
  'complete-evaluation-stage',
  {
    jobId,
    leaseId,
    leaseToken,
    outputArtifactIds: [artifact.artifactId],
    checkpoint: { artifactId: artifact.artifactId, reportDigest, strictPass: true },
  },
  evaluationToken,
);

snapshot = await call('read-job', { jobId }, ownerToken);
const receipt = {
  schemaVersion: 'nodevideo.live-job-proof/v1',
  capturedAt: new Date().toISOString(),
  job: snapshot.job,
  stages: snapshot.stages,
  events: snapshot.events,
  artifacts: snapshot.artifacts.map(({ url: _url, ...entry }) => entry),
  proof: {
    freezeReceiptId: freeze.freezeReceiptId,
    generationReadLogDigest,
    hiddenTargetDigest,
    strictEvaluationDigest: reportDigest,
  },
};
await writeFile(receiptOutput, `${JSON.stringify(receipt, null, 2)}\n`);

const incompleteStages = snapshot.stages.filter((stage) => stage.status !== 'completed');
if (snapshot.job.status !== 'completed' || incompleteStages.length > 0) {
  throw new Error(
    `Live job did not complete: ${snapshot.job.status}; incomplete=${incompleteStages.length}`,
  );
}
console.log(
  JSON.stringify({
    jobId,
    status: snapshot.job.status,
    completedStages: snapshot.stages.length,
    artifacts: snapshot.artifacts.length,
    events: snapshot.events.length,
    strictEvaluationDigest: reportDigest,
  }),
);

async function call(path, body, token) {
  const response = await fetch(`${baseUrl}/control/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

function requireArtifact(snapshotValue, kind) {
  const artifactValue = snapshotValue.artifacts.find((entry) => entry.kind === kind);
  if (!artifactValue) throw new Error(`Missing ${kind} artifact.`);
  return artifactValue;
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
