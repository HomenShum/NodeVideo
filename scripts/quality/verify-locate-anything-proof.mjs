#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateLocateResult } from '../../src/lib/visual-grounding.ts';

const root = 'fixtures/media/locate-anything-live-v1';
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 'nodevideo.locate-anything-live-manifest.v1') fail('schema');
if (manifest.provider !== 'nvidia/LocateAnything-3B') fail('provider');
if (manifest.licenseUse !== 'research-and-development-non-commercial') fail('license boundary');
if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 5) fail('artifact set');
for (const artifact of manifest.artifacts) {
  const bytes = await readFile(join(root, artifact.path));
  if (digest(bytes) !== artifact.sha256) fail(`hash ${artifact.path}`);
}
const locateResult = JSON.parse(await readFile(join(root, 'locate-result.json'), 'utf8'));
validateLocateResult(locateResult);
if (
  locateResult.status !== 'valid' ||
  locateResult.provider.modelId !== 'nvidia/LocateAnything-3B' ||
  locateResult.observations.length !== 1
) {
  fail('live result contract');
}
const captionSafety = JSON.parse(await readFile(join(root, 'caption-safety.json'), 'utf8'));
if (
  captionSafety.passed !== true ||
  captionSafety.scope !== 'sampled-live-grounding-gate' ||
  captionSafety.checks?.length !== 1 ||
  captionSafety.checks[0].intersectionArea !== 0
) {
  fail('caption safety receipt');
}
console.log(
  'Verified live LocateAnything proof (5 hash-bound artifacts, 1 valid box, sampled caption gate passed).',
);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function fail(label) {
  throw new Error(`LocateAnything proof failed: ${label}`);
}
