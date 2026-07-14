#!/usr/bin/env node

import { join, relative, resolve } from 'node:path';
import { PRIVATE_EVIDENCE_ROOT, REPO_ROOT, resolveInputPath } from '../media/media-proof-lib.mjs';
import {
  PUBLIC_FIXTURE_ROOT,
  generatePublicSourcePair,
  runTutorialCompare,
  verifyWorkerReceipt,
} from './tutorial-compare-lib.mjs';

const mode = process.argv.includes('--public')
  ? 'public'
  : process.argv.includes('--verify-public')
    ? 'verify-public'
    : 'private';

if (mode === 'verify-public') {
  const receiptPath = join(PUBLIC_FIXTURE_ROOT, 'receipt.json');
  const verification = await verifyWorkerReceipt(receiptPath, {
    ffprobe: process.env.FFPROBE_PATH ?? 'ffprobe',
  });
  if (!verification.passed) {
    throw new Error(
      verification.assertions
        .filter((item) => !item.pass)
        .map((item) => item.name)
        .join(', '),
    );
  }
  console.log(
    `Verified ${relative(REPO_ROOT, receiptPath)} (${verification.assertions.length} checks)`,
  );
  process.exit(0);
}

if (mode === 'public') {
  const inputs = await generatePublicSourcePair({ ffmpeg: process.env.FFMPEG_PATH ?? 'ffmpeg' });
  const run = await runTutorialCompare({
    referencePath: inputs.reference,
    attemptPath: inputs.attempt,
    outputRoot: PUBLIC_FIXTURE_ROOT,
    boundary: 'public-worker',
    onEvent: printEvent,
  });
  console.log(`Generated ${relative(REPO_ROOT, run.receiptPath)}`);
  console.log(`Validated ${run.receipt.validation.assertions.length} worker checks`);
  process.exit(0);
}

const referenceValue = argumentValue('--reference') ?? process.env.NODEVIDEO_REFERENCE_INPUT;
const attemptValue = argumentValue('--attempt') ?? process.env.NODEVIDEO_ATTEMPT_INPUT;
if (!referenceValue || !attemptValue) {
  throw new Error(
    'Private worker requires --reference/--attempt or NODEVIDEO_REFERENCE_INPUT/NODEVIDEO_ATTEMPT_INPUT.',
  );
}
const outputValue = argumentValue('--output-dir');
const outputRoot = outputValue
  ? resolveInputPath(outputValue)
  : join(PRIVATE_EVIDENCE_ROOT, 'tutorial-compare-worker');
const run = await runTutorialCompare({
  referencePath: resolveInputPath(referenceValue),
  attemptPath: resolveInputPath(attemptValue),
  outputRoot,
  boundary: 'private-worker',
  onEvent: printEvent,
});
console.log(`Generated private receipt ${relative(REPO_ROOT, run.receiptPath)}`);
console.log('No source path or filename was written to the receipt.');

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function printEvent(event) {
  console.log(
    `[${event.progress.completed}/${event.progress.total}] ${event.type}: ${event.message}`,
  );
}
