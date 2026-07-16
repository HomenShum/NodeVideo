#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CREATIVE_FIDELITY_GATE_IDS,
  CREATIVE_FIDELITY_INPUT_SCHEMA_VERSION,
} from '../../src/lib/creator-taste-evaluator.ts';

const comparisonPath = value('--comparison');
const tasteRunPath = value('--taste-run');
const outputPath = value('--out');
const candidateArtifactId = optional('--candidate-artifact-id') ?? 'artifact.candidate-production';
const comparison = JSON.parse(await readFile(resolve(comparisonPath), 'utf8'));
const tasteRun = JSON.parse(await readFile(resolve(tasteRunPath), 'utf8'));
const consistency = tasteRun.consistencyReports?.[0];
if (!consistency) throw new Error('Taste run has no target-spec consistency report.');

const gates = Object.fromEntries(
  CREATIVE_FIDELITY_GATE_IDS.map((id) => {
    const score = comparison.gateSignals?.[id];
    if (!Number.isFinite(score)) throw new Error(`Comparison audit is missing ${id}.`);
    return [
      id,
      {
        score,
        evidenceArtifactIds: [`evidence.comparison.${id}`],
        note: gateNote(id, comparison),
      },
    ];
  }),
);
const input = {
  schemaVersion: CREATIVE_FIDELITY_INPUT_SCHEMA_VERSION,
  candidateArtifactId,
  referenceAuditId: consistency.auditId,
  targetSpecConsistency: consistency,
  gates,
};
await writeFile(resolve(outputPath), `${JSON.stringify(input, null, 2)}\n`, 'utf8');
console.log(outputPath);

function gateNote(id, report) {
  const summary = report.summary ?? {};
  const notes = {
    provenance: 'Candidate-plan calibration and render lineage were inspected.',
    structural: `${report.sourceAndCutDeltas?.length ?? 0} source segments were compared frame by frame.`,
    'semantic-overlays': `${summary.ocrMatchedGroups ?? 0}/${summary.ocrReferenceGroups ?? 0} confident OCR groups matched.`,
    layout: `${summary.layoutZoneMatches ?? 0}/${summary.ocrMatchedGroups ?? 0} matched cues used the same vertical zone.`,
    'visual-treatment':
      'Candidate/reference luma, contrast, and saturation ratios were compared across sampled frames.',
    'creator-identity': 'Persistent creator identity OCR coverage was measured.',
    delivery: 'CTA and end-card OCR coverage was measured in the final production window.',
  };
  return notes[id];
}

function value(flag) {
  const result = optional(flag);
  if (!result) {
    throw new Error(
      'Usage: node scripts/analysis/build_creative_fidelity_input.mjs --comparison audit.json --taste-run run.json --out input.json',
    );
  }
  return result;
}

function optional(flag) {
  const index = process.argv.indexOf(flag);
  const result = index >= 0 ? process.argv[index + 1] : undefined;
  return result && !result.startsWith('--') ? result : undefined;
}
