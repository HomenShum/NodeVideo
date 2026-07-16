#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { validateEditPlan } from '../../src/lib/edit-contracts.ts';

const args = parseArgs(process.argv.slice(2));
const plan = JSON.parse(await readFile(args.plan, 'utf8'));
const refinement = JSON.parse(await readFile(args.refinement, 'utf8'));
validateEditPlan(plan);
validateRefinement(refinement, plan.id);

const output = structuredClone(plan);
const overlayTracks = output.tracks.filter((track) => track.kind === 'overlay');
for (const replacement of refinement.replacements) {
  const matches = overlayTracks.flatMap((track) =>
    track.clips.flatMap((clip, index) =>
      clip.id === replacement.targetClipId ? [{ track, index }] : [],
    ),
  );
  if (matches.length !== 1) {
    throw new Error(`${replacement.targetClipId} must identify exactly one overlay clip.`);
  }
  matches[0].track.clips.splice(matches[0].index, 1, ...structuredClone(replacement.clips));
}

output.id = refinement.outputPlanId;
output.version += 1;
output.createdAt = refinement.createdAt;
if (output.lineage.calibration) {
  output.lineage.calibration.disclosure = refinement.calibrationDisclosure;
}
output.lineage.decisionArtifactIds = [
  ...new Set([...(output.lineage.decisionArtifactIds ?? []), refinement.decisionArtifactId]),
];
for (const track of overlayTracks) {
  track.clips.sort(
    (left, right) =>
      left.timelineRange.startFrame - right.timelineRange.startFrame ||
      left.id.localeCompare(right.id),
  );
}
validateEditPlan(output);
await mkdir(dirname(args.output), { recursive: true });
await writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(args.output);

function validateRefinement(value, expectedPlanId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Overlay refinement must be an object.');
  }
  const exactKeys = [
    'schemaVersion',
    'planId',
    'outputPlanId',
    'createdAt',
    'decisionArtifactId',
    'reason',
    'calibrationDisclosure',
    'replacements',
  ];
  if (Object.keys(value).length !== exactKeys.length || exactKeys.some((key) => !(key in value))) {
    throw new Error(`Overlay refinement requires exactly: ${exactKeys.join(', ')}.`);
  }
  if (value.schemaVersion !== 'nodevideo.overlay-refinement.v1') {
    throw new Error('Unsupported overlay refinement schemaVersion.');
  }
  if (value.planId !== expectedPlanId) throw new Error('Overlay refinement planId mismatch.');
  for (const key of [
    'outputPlanId',
    'createdAt',
    'decisionArtifactId',
    'reason',
    'calibrationDisclosure',
  ]) {
    if (typeof value[key] !== 'string' || value[key].trim().length === 0) {
      throw new Error(`${key} must be a non-empty string.`);
    }
  }
  if (!Number.isFinite(Date.parse(value.createdAt))) throw new Error('createdAt must be ISO-8601.');
  if (!Array.isArray(value.replacements) || value.replacements.length === 0) {
    throw new Error('replacements must be a non-empty array.');
  }
  const targets = new Set();
  for (const replacement of value.replacements) {
    if (
      !replacement ||
      typeof replacement !== 'object' ||
      Object.keys(replacement).length !== 2 ||
      typeof replacement.targetClipId !== 'string' ||
      !Array.isArray(replacement.clips) ||
      replacement.clips.length === 0
    ) {
      throw new Error('Each replacement requires targetClipId and non-empty clips.');
    }
    if (targets.has(replacement.targetClipId)) throw new Error('Duplicate replacement target.');
    targets.add(replacement.targetClipId);
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!['--plan', '--refinement', '--output'].includes(flag) || !value) {
      throw new Error(
        'Usage: node apply_overlay_refinement.mjs --plan plan.json --refinement refinement.json --output plan-v2.json',
      );
    }
    parsed[flag.slice(2)] = resolve(value);
  }
  if (!parsed.plan || !parsed.refinement || !parsed.output)
    throw new Error('Missing required paths.');
  return parsed;
}
