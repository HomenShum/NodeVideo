#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256File } from '../media/media-proof-lib.mjs';

const sourcePlanPath = resolve(required('--source-plan'));
const targetPlanPath = resolve(required('--target-plan'));
const sourceVideoPath = resolve(required('--source-video'));
const targetVideoPath = resolve(required('--target-video'));
const outputPath = resolve(required('--out'));
const sourcePlan = JSON.parse(await readFile(sourcePlanPath, 'utf8'));
const targetPlan = JSON.parse(await readFile(targetPlanPath, 'utf8'));
const sourceGeometry = renderGeometry(sourcePlan);
const targetGeometry = renderGeometry(targetPlan);
if (JSON.stringify(sourceGeometry) !== JSON.stringify(targetGeometry)) {
  throw new Error('Render plans are not geometry-equivalent.');
}
const receipt = {
  schemaVersion: 'nodevideo.render-geometry-equivalence.v1',
  source: {
    planId: sourcePlan.id,
    planSha256: await sha256File(sourcePlanPath),
    videoSha256: await sha256File(sourceVideoPath),
  },
  target: {
    planId: targetPlan.id,
    planSha256: await sha256File(targetPlanPath),
    videoSha256: await sha256File(targetVideoPath),
  },
  geometryEquivalent: true,
  ignoredDifferences: ['grade', 'audio', 'overlay'],
  comparedFields: [
    'frameRate',
    'canvas',
    'durationFrames',
    'video.clip.kind',
    'video.clip.assetId',
    'video.clip.timelineRange',
    'video.clip.sourceRange-or-sourceFrame',
    'video.clip.playbackRate',
    'video.clip.fit',
    'video.clip.cropKeyframes',
  ],
};
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt)}\n`);

function renderGeometry(plan) {
  const video = plan.tracks.find((track) => track.kind === 'video' && track.role === 'primary');
  if (!video) throw new Error(`${plan.id} has no primary video track.`);
  return {
    frameRate: plan.frameRate,
    canvas: plan.canvas,
    durationFrames: plan.durationFrames,
    clips: video.clips.map((clip) => ({
      kind: clip.kind,
      assetId: clip.assetId ?? null,
      timelineRange: clip.timelineRange,
      sourceRange: clip.sourceRange ?? null,
      sourceFrame: clip.sourceFrame ?? null,
      playbackRate: clip.playbackRate ?? null,
      fit: clip.fit ?? null,
      cropKeyframes: clip.cropKeyframes ?? [],
    })),
  };
}

function required(flag) {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`${flag} is required.`);
  return value;
}
