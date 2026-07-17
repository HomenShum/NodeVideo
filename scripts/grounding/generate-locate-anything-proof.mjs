#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { locateAnythingOnImage, toLocateResult } from './locate-anything-space.mjs';

const imagePath = resolve(value('--image'));
const resultPath = resolve(value('--result'));
const receiptPath = resolve(value('--receipt'));
const annotatedPath = resolve(value('--annotated'));
const query = optionalValue('--query') ?? 'primary dancer full body';
const request = {
  schemaVersion: 'nodevideo.locate-request.v1',
  requestId: `request.locate-anything.${randomUUID()}`,
  traceId: `trace.locate-anything.${randomUUID()}`,
  assetId: optionalValue('--asset-id') ?? 'asset.integrated-source-only.preview-frame-465',
  queryKind: 'text',
  query,
  task: 'grounding',
  output: 'box',
  cardinality: 'one',
  frameNumber: Number(optionalValue('--frame-number') ?? 465),
  maxResults: 1,
};

if (process.env.NODEVIDEO_LOCATEANYTHING_LICENSE_ACCEPTED !== 'true') {
  throw new Error(
    'Set NODEVIDEO_LOCATEANYTHING_LICENSE_ACCEPTED=true after reviewing the non-commercial model license.',
  );
}

const imageBytes = await readFile(imagePath);
const inference = await locateAnythingOnImage({ imagePath, query });
const result = toLocateResult(request, inference);
if (result.status !== 'valid') throw new Error(`LocateAnything result is ${result.status}`);
if (!inference.annotatedImageUrl)
  throw new Error('LocateAnything did not return an annotated image');
const annotatedResponse = await fetch(inference.annotatedImageUrl);
if (!annotatedResponse.ok)
  throw new Error(`Annotated image download failed: HTTP ${annotatedResponse.status}`);
const annotatedBytes = Buffer.from(await annotatedResponse.arrayBuffer());
const receipt = {
  schemaVersion: 'nodevideo.locate-anything-live-receipt.v1',
  backend: 'official-hugging-face-space',
  space: inference.space,
  modelId: inference.modelId,
  licenseUse: 'research-and-development-non-commercial',
  inputSha256: digest(imageBytes),
  resultSha256: digest(Buffer.from(`${JSON.stringify(result, null, 2)}\n`)),
  annotatedImageSha256: digest(annotatedBytes),
  rawText: inference.rawText,
  stats: inference.stats,
  completedAt: new Date().toISOString(),
};

for (const path of [resultPath, receiptPath, annotatedPath])
  await mkdir(dirname(path), { recursive: true });
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
await writeFile(annotatedPath, annotatedBytes);
console.log(
  JSON.stringify({
    resultPath,
    receiptPath,
    annotatedPath,
    status: result.status,
    observations: result.observations.length,
    stats: receipt.stats,
  }),
);

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
function value(flag) {
  const result = optionalValue(flag);
  if (!result) throw new Error(`${flag} is required`);
  return result;
}
function optionalValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
