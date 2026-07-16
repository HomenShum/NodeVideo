#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceJobId = value('--source-job-id');
const output = resolve(value('--output'));
const sourceUrl = required(
  process.env.NODEVIDEO_SOURCE_WORKER_URL,
  'NODEVIDEO_SOURCE_WORKER_URL',
).replace(/\/$/, '');
const sourceToken = required(
  process.env.NODEVIDEO_SOURCE_WORKER_TOKEN,
  'NODEVIDEO_SOURCE_WORKER_TOKEN',
);
const targetUrl = required(
  process.env.NODEVIDEO_GENERATION_CONTROL_URL,
  'NODEVIDEO_GENERATION_CONTROL_URL',
).replace(/\/$/, '');
const targetToken = required(
  process.env.NODEVIDEO_GENERATION_CONTROL_TOKEN,
  'NODEVIDEO_GENERATION_CONTROL_TOKEN',
);

const source = await post(sourceUrl, 'read-worker-input', { jobId: sourceJobId }, sourceToken);
const traceId = `trace.production-clone.${createHash('sha256').update(sourceJobId).digest('hex').slice(0, 24)}`;
const input = {
  schemaVersion: 'nodevideo.source-only-case/v1',
  traceId,
  assets: source.assets.map((asset) => ({
    role: asset.role,
    name: `owner-${asset.role}`,
    sha256: asset.sha256,
  })),
  isolation: { hiddenTargetAdmitted: false },
  provenance: { clonedFromLiveSourceOnlyJob: sourceJobId },
};
const inputDigest = digest(Buffer.from(canonicalJson(input)));
const ownerCase = await post(
  targetUrl,
  'create-source-only-case',
  { projectId: 'nodevideo.owner-proof.production', idempotencyKey: traceId, inputDigest, input },
  targetToken,
);

for (const asset of source.assets) {
  const download = await fetch(asset.url);
  if (!download.ok) {
    throw new Error(`Source download failed for ${asset.role}: HTTP ${download.status}`);
  }
  const bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.byteLength !== asset.sizeBytes || digest(bytes) !== asset.sha256) {
    throw new Error(`Source integrity check failed for ${asset.role}.`);
  }
  const { uploadUrl } = await post(targetUrl, 'create-upload-url', {}, targetToken);
  const upload = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'content-type': asset.mimeType },
    body: bytes,
  });
  if (!upload.ok) throw new Error(`Target upload failed for ${asset.role}: HTTP ${upload.status}`);
  const { storageId } = await upload.json();
  await post(
    targetUrl,
    'admit-asset',
    {
      caseId: ownerCase.caseId,
      role: asset.role,
      storageId,
      sha256: asset.sha256,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
    },
    targetToken,
  );
  console.log(`Cloned ${asset.role} (${asset.sizeBytes} bytes).`);
}

const job = await post(
  targetUrl,
  'start-job',
  { caseId: ownerCase.caseId, idempotencyKey: `job.${traceId}`, inputDigest },
  targetToken,
);
const receipt = {
  schemaVersion: 'nodevideo.live-production-clone/v1',
  traceId,
  sourceJobId,
  caseId: ownerCase.caseId,
  jobId: job.jobId,
  inputDigest,
};
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));

async function post(baseUrl, path, body, token) {
  const response = await fetch(`${baseUrl}/control/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalJson(input) {
  if (input === null || typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(input)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function value(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${flag} is required.`);
  return process.argv[index + 1];
}

function required(input, name) {
  if (!input) throw new Error(`${name} is required.`);
  return input;
}
