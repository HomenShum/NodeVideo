#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateCreativeFidelity } from '../../src/lib/creator-taste-evaluator.ts';

const inputPath = value('--input');
const outputPath = value('--out');
const input = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
const report = evaluateCreativeFidelity(input);
await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Creative fidelity ${report.status}: ${report.score.toFixed(3)} -> ${outputPath}`);
if (report.status !== 'pass') process.exitCode = 2;

function value(flag) {
  const index = process.argv.indexOf(flag);
  const result = index >= 0 ? process.argv[index + 1] : undefined;
  if (!result || result.startsWith('--')) {
    throw new Error(
      'Usage: node scripts/quality/evaluate-creative-fidelity.mjs --input input.json --out report.json',
    );
  }
  return result;
}
