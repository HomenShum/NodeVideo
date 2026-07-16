#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { compileEditPlan, readEditPlanInputs, renderEditPlan } from './edit-plan-renderer-lib.mjs';

const options = parseArguments(process.argv.slice(2));
const { plan, bindings } = await readEditPlanInputs(options.planPath, options.bindingsPath);

if (options.dryRun) {
  const compiled = compileEditPlan(plan, bindings, {
    outputPath: options.outputPath,
    auxiliaryDirectory: options.auxiliaryDirectory,
  });
  if (options.manifestOutputPath) {
    await mkdir(dirname(options.manifestOutputPath), { recursive: true });
    await writeFile(options.manifestOutputPath, `${JSON.stringify(compiled.manifest, null, 2)}\n`);
  }
  console.log(
    JSON.stringify(
      {
        rendererVersion: compiled.rendererVersion,
        valid: true,
        manifest: compiled.manifest,
        inputCount: compiled.inputRecords.length,
        auxiliaryFileCount: compiled.auxiliaryFiles.length,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const result = await renderEditPlan({
  plan,
  bindings,
  outputPath: options.outputPath,
  auxiliaryDirectory: options.auxiliaryDirectory,
  ffmpeg: options.ffmpeg,
});
console.log(
  `Rendered ${result.manifest.durationFrames} frames for plan ${result.manifest.planId} ` +
    `with ${result.rendererVersion}.`,
);

function parseArguments(args) {
  const allowed = new Set([
    '--plan',
    '--bindings',
    '--output',
    '--work-dir',
    '--ffmpeg',
    '--dry-run',
    '--manifest-output',
  ]);
  for (const value of args) {
    if (value.startsWith('--') && !allowed.has(value)) {
      throw new Error(`Unknown option: ${value}`);
    }
  }
  const planPath = requiredValue(args, '--plan');
  const bindingsPath = requiredValue(args, '--bindings');
  const outputPath = requiredValue(args, '--output');
  const workDir = optionalValue(args, '--work-dir');
  const ffmpeg = optionalValue(args, '--ffmpeg');
  const manifestOutput = optionalValue(args, '--manifest-output');
  return {
    planPath: resolve(planPath),
    bindingsPath: resolve(bindingsPath),
    outputPath: resolve(outputPath),
    auxiliaryDirectory: workDir ? resolve(workDir) : undefined,
    ffmpeg,
    manifestOutputPath: manifestOutput ? resolve(manifestOutput) : undefined,
    dryRun: args.includes('--dry-run'),
  };
}

function requiredValue(args, name) {
  const value = optionalValue(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}
