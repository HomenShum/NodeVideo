#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { validateEditPlan } from '../../src/lib/edit-contracts.ts';

const options = parseArgs(process.argv.slice(2));
const plan = JSON.parse(await readFile(resolve(options.plan), 'utf8'));
const profile = JSON.parse(await readFile(resolve(options.profile), 'utf8'));
validateEditPlan(plan);
validateProfile(profile, plan.id);
const output = structuredClone(plan);
for (const track of output.tracks) {
  if (track.kind === 'video') {
    for (const clip of track.clips) {
      if (clip.kind !== 'black') clip.grade = { kind: profile.gradeKind };
    }
  }
  if (track.kind === 'audio') {
    for (const clip of track.clips) {
      if (clip.role === 'music') clip.gainDb = profile.musicGainDb;
    }
  }
}
for (const event of output.audio.events) {
  if (event.kind === 'music') event.gainDb = profile.musicGainDb;
}
const overlayTrack = output.tracks.find((track) => track.kind === 'overlay');
if (!overlayTrack) throw new Error('EditPlan has no overlay track.');
const removeIds = new Set(profile.removeOverlayIds);
overlayTrack.clips = overlayTrack.clips.filter((clip) => !removeIds.has(clip.id));
overlayTrack.clips.push(...structuredClone(profile.addOverlays));
overlayTrack.clips.sort(
  (left, right) =>
    left.timelineRange.startFrame - right.timelineRange.startFrame ||
    left.id.localeCompare(right.id),
);
output.id = profile.outputPlanId;
output.version += 1;
output.createdAt = profile.createdAt;
output.lineage.decisionArtifactIds = [
  ...new Set([...(output.lineage.decisionArtifactIds ?? []), profile.id]),
];
if (output.lineage.calibration) {
  output.lineage.calibration.disclosure = profile.calibrationDisclosure;
}
validateEditPlan(output);
const outputPath = resolve(options.out);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${outputPath}\n`);

function validateProfile(value, planId) {
  const keys = [
    'schemaVersion',
    'id',
    'planId',
    'outputPlanId',
    'createdAt',
    'gradeKind',
    'musicGainDb',
    'removeOverlayIds',
    'addOverlays',
    'calibrationDisclosure',
  ];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value))
  ) {
    throw new Error(`Creator delivery profile requires exactly: ${keys.join(', ')}.`);
  }
  if (value.schemaVersion !== 'nodevideo.creator-delivery-profile.v1') {
    throw new Error('Unsupported creator delivery profile schema.');
  }
  if (value.planId !== planId) throw new Error('Creator delivery profile plan mismatch.');
  if (value.gradeKind !== 'hlg-bt2020-to-sdr-bt709-creator-social-vivid') {
    throw new Error('Creator delivery profile grade is unsupported.');
  }
  if (!Number.isFinite(value.musicGainDb) || value.musicGainDb < -96 || value.musicGainDb > 24) {
    throw new Error('Creator delivery profile musicGainDb is invalid.');
  }
  if (!Array.isArray(value.removeOverlayIds) || !Array.isArray(value.addOverlays)) {
    throw new Error('Creator delivery overlay changes must be arrays.');
  }
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--plan', '--profile', '--out'].includes(flag) || !args[index + 1]) {
      throw new Error(
        'Usage: apply_creator_delivery_profile.mjs --plan plan.json --profile profile.json --out plan.json',
      );
    }
    result[flag.slice(2)] = args[index + 1];
  }
  if (!result.plan || !result.profile || !result.out) throw new Error('Missing required paths.');
  return result;
}
