#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { adjudicateEditPlan } from './edit-plan-adjudicator-lib.mjs';

const options = parseArguments(process.argv.slice(2));
if (!options.plan) {
  console.error(
    'Usage: node scripts/quality/edit-plan-adjudicator.mjs --plan <edit-plan.json> ' +
      '[--metrics <render-metrics.json>] [--output <adjudication.json>] ' +
      '[--event-output <event-score-report.json>] [--critic-output <critic-report.json>]',
  );
  process.exitCode = 2;
} else {
  const plan = await readJson(options.plan);
  const metrics = options.metrics ? await readJson(options.metrics) : undefined;
  const result = adjudicateEditPlan(plan, metrics, {
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
  });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  let wroteOutput = false;
  if (options.output) {
    console.log(await writeJson(options.output, result));
    wroteOutput = true;
  }
  if (options.eventOutput) {
    console.log(await writeJson(options.eventOutput, result.eventScoreReport));
    wroteOutput = true;
  }
  if (options.criticOutput) {
    console.log(await writeJson(options.criticOutput, result.criticReport));
    wroteOutput = true;
  }
  if (!wroteOutput) {
    process.stdout.write(serialized);
  }
  if (!result.eventScoreReport.passed) process.exitCode = 1;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

async function writeJson(path, value) {
  const outputPath = resolve(path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return outputPath;
}

function parseArguments(arguments_) {
  const result = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    const value = arguments_[index + 1];
    if (value == null || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    result[key] = value;
    index += 1;
  }
  return result;
}
