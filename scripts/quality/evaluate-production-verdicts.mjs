#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateProductionVerdicts } from '../../src/lib/production-verdicts.ts';

const creativeFidelity = await readJson(required('--creative-fidelity'));
const decisionLedger = await readJson(required('--decision-ledger'));
const creatorIntentProfile = await readJson(required('--creator-intent-profile'));
const generationManifest = await readJson(required('--generation-manifest'));
const freeze = await readJson(required('--freeze'));
const output = resolve(required('--out'));
const verdicts = evaluateProductionVerdicts({
  creativeFidelity,
  decisionLedger,
  creatorIntentProfile,
  isolation: {
    manifestArtifactId: `manifest.${generationManifest.id}`,
    freezeArtifactId: freeze.id,
    mode: generationManifest.mode,
    finishedEditAcceptedByCli: generationManifest.isolation.finishedEditAcceptedByCli,
    forbiddenMediaMountedDuringGeneration:
      generationManifest.isolation.forbiddenMediaMountedDuringGeneration,
    forbiddenMediaReadDuringGeneration:
      generationManifest.isolation.forbiddenMediaReadDuringGeneration,
    forbiddenPlanReadDuringGeneration:
      generationManifest.isolation.forbiddenPlanReadDuringGeneration,
    targetMountedDuringGeneration: freeze.targetMountedDuringGeneration,
    targetReadDuringGeneration: freeze.targetReadDuringGeneration,
    freezeFileCount: freeze.files.length,
    allGenerationAssertionsPassed: generationManifest.assertions.every((item) => item.pass),
  },
});
await writeFile(output, `${JSON.stringify(verdicts, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(verdicts)}\n`);

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

function required(flag) {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`${flag} is required.`);
  return value;
}
