#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const resultPath = resolve(value('--result'));
const planPath = resolve(value('--plan'));
const outputPath = resolve(value('--output'));
const frameNumber = Number(value('--frame-number'));
const [resultBytes, planBytes] = await Promise.all([readFile(resultPath), readFile(planPath)]);
const result = JSON.parse(resultBytes);
const plan = JSON.parse(planBytes);
const observation = result.observations?.find((item) => item.geometry?.kind === 'box');
if (result.status !== 'valid' || !observation)
  throw new Error('A valid LocateAnything box is required');
const overlayTrack = plan.tracks?.find((track) => track.kind === 'overlay');
const overlays = (overlayTrack?.clips ?? []).filter(
  (clip) =>
    clip.kind === 'text' &&
    clip.timelineRange.startFrame <= frameNumber &&
    clip.timelineRange.endFrameExclusive > frameNumber,
);
if (overlays.length === 0) throw new Error('No active text overlay at the evidence frame');
const subject = observation.geometry.box;
const checks = overlays.map((overlay) => {
  const intersection = intersectionArea(subject, overlay.box);
  return {
    overlayId: overlay.id,
    overlayBox: overlay.box,
    subjectBox: subject,
    intersectionArea: intersection,
    passed: intersection === 0,
  };
});
const receipt = {
  schemaVersion: 'nodevideo.locate-caption-safety.v1',
  frameNumber,
  coordinateSpace: 'normalized-frame-top-left-v1',
  groundingProvider: result.provider,
  groundingResultSha256: digest(resultBytes),
  planSha256: digest(planBytes),
  checks,
  passed: checks.every((check) => check.passed),
  scope: 'sampled-live-grounding-gate',
};
if (!receipt.passed) throw new Error('LocateAnything found a text/body overlap');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, passed: receipt.passed, checks: checks.length }));

function intersectionArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return Number((width * height).toFixed(8));
}
function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
function value(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${flag} is required`);
  return process.argv[index + 1];
}
