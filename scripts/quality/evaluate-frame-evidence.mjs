#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateFrameEvidence, formatFrameEvidence } from '../../src/lib/frame-evidence.ts';

// Deterministic frame checks. Runs before any model review, and exits non-zero on a hard zero so a
// clip cannot be called good because the finished MP4 looked fine.
const frames = await readJson(required('--frames'));
const verdict = evaluateFrameEvidence(frames);

const out = argOf('--out');
if (out) await writeFile(resolve(out), `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');

if (argOf('--json') !== undefined) process.stdout.write(`${JSON.stringify(verdict)}\n`);
else process.stderr.write(`${formatFrameEvidence(verdict)}\n`);

if (!verdict.passed) process.exitCode = 1;

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

function argOf(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return !value || value.startsWith('--') ? '' : value;
}

function required(flag) {
  const value = argOf(flag);
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}
