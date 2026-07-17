#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const options = parse(process.argv.slice(2));
const baseUrl = required(
  process.env.NODEVIDEO_GENERATION_CONTROL_URL,
  'NODEVIDEO_GENERATION_CONTROL_URL',
).replace(/\/$/, '');
const token = required(
  process.env.NODEVIDEO_GENERATION_CONTROL_TOKEN,
  'NODEVIDEO_GENERATION_CONTROL_TOKEN',
);
const traceId = `trace.${randomUUID()}`;
const specs = [
  ['choreography-reference', options.reference, 'video/mp4'],
  ['creator-take-a', options.takeA, 'video/quicktime'],
  ['creator-take-b', options.takeB, 'video/quicktime'],
  ['chosen-song', options.song, 'audio/mp4'],
  ['timed-lyrics', options.lyrics, 'application/json'],
];
const assets = await Promise.all(
  specs.map(async ([role, path, mimeType]) => {
    const bytes = await readFile(path);
    return { role, path, bytes, mimeType, name: basename(path), sha256: digest(bytes) };
  }),
);
const input = {
  schemaVersion: 'nodevideo.source-only-case/v1',
  traceId,
  assets: assets.map(({ role, name, sha256 }) => ({ role, name, sha256 })),
  isolation: { hiddenTargetAdmitted: false },
};
const inputDigest = digest(canonicalJson(input));
const ownerCase = await call('create-source-only-case', {
  projectId: 'nodevideo.owner-proof',
  idempotencyKey: traceId,
  inputDigest,
  input,
});
for (const asset of assets) {
  const { uploadUrl } = await call('create-upload-url', {});
  const upload = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'content-type': asset.mimeType },
    body: asset.bytes,
  });
  if (!upload.ok) throw new Error(`Upload failed for ${asset.role}: HTTP ${upload.status}`);
  const { storageId } = await upload.json();
  await call('admit-asset', {
    caseId: ownerCase.caseId,
    role: asset.role,
    storageId,
    sha256: asset.sha256,
    mimeType: asset.mimeType,
    sizeBytes: asset.bytes.byteLength,
  });
  console.log(`Admitted ${asset.role} (${asset.bytes.byteLength} bytes).`);
}
const job = await call('start-job', {
  caseId: ownerCase.caseId,
  idempotencyKey: `job.${traceId}`,
  inputDigest,
});
const receipt = {
  schemaVersion: 'nodevideo.live-owner-seed/v1',
  traceId,
  caseId: ownerCase.caseId,
  jobId: job.jobId,
  inputDigest,
};
if (options.output) await writeFile(options.output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));

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

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
function required(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
function parse(args) {
  const value = (flag) => {
    const index = args.indexOf(flag);
    if (index < 0 || !args[index + 1]) throw new Error(`${flag} is required.`);
    return resolve(args[index + 1]);
  };
  return {
    reference: value('--reference'),
    takeA: value('--take-a'),
    takeB: value('--take-b'),
    song: value('--song'),
    lyrics: value('--lyrics'),
    output: args.includes('--output') ? value('--output') : undefined,
  };
}
