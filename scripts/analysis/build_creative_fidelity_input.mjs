#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CREATIVE_FIDELITY_GATE_IDS,
  CREATIVE_FIDELITY_INPUT_SCHEMA_VERSION,
} from '../../src/lib/creator-taste-evaluator.ts';
import { validateProductionDecisionLedger } from '../../src/lib/production-decision-contracts.ts';

const comparisonPath = value('--comparison');
const tasteRunPath = value('--taste-run');
const outputPath = value('--out');
const embodiedPath = optional('--embodied-layout');
const decisionLedgerPath = value('--decision-ledger');
const candidateArtifactId = optional('--candidate-artifact-id') ?? 'artifact.candidate-production';
const comparison = JSON.parse(await readFile(resolve(comparisonPath), 'utf8'));
const tasteRun = JSON.parse(await readFile(resolve(tasteRunPath), 'utf8'));
const embodied = embodiedPath
  ? JSON.parse(await readFile(resolve(embodiedPath), 'utf8'))
  : undefined;
const decisionLedger = JSON.parse(await readFile(resolve(decisionLedgerPath), 'utf8'));
validateProductionDecisionLedger(decisionLedger);
if (
  embodied &&
  (embodied.schemaVersion !== 'nodevideo.embodied-overlay-audit.v1' ||
    !Number.isFinite(embodied.score) ||
    !embodied.timelinePose?.sha256)
) {
  throw new Error('Embodied layout audit is invalid or lacks hash-bound rendered pose evidence.');
}
const consistency = tasteRun.consistencyReports?.[0];
if (!consistency) throw new Error('Taste run has no target-spec consistency report.');

const gates = Object.fromEntries(
  CREATIVE_FIDELITY_GATE_IDS.map((id) => {
    if (id === 'intentional-production') {
      return [
        id,
        {
          score: decisionLedger.overallStatus === 'pass' ? decisionLedger.score : 0,
          evidenceArtifactIds: ['evidence.production-decision-ledger'],
          note: gateNote(id, comparison, embodied, decisionLedger),
        },
      ];
    }
    const comparisonScore = comparison.gateSignals?.[id];
    if (!Number.isFinite(comparisonScore)) throw new Error(`Comparison audit is missing ${id}.`);
    const score =
      id === 'layout' && embodied ? Math.min(comparisonScore, embodied.score) : comparisonScore;
    return [
      id,
      {
        score,
        evidenceArtifactIds: [
          `evidence.comparison.${id}`,
          ...(id === 'layout' && embodied ? ['evidence.embodied-overlay-clearance'] : []),
        ],
        note: gateNote(id, comparison, embodied, decisionLedger),
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

function gateNote(id, report, embodied, decisionLedger) {
  const summary = report.summary ?? {};
  const notes = {
    provenance: 'Candidate-plan calibration and render lineage were inspected.',
    structural: `${report.sourceAndCutDeltas?.length ?? 0} source segments were compared frame by frame.`,
    'semantic-overlays': `${summary.ocrSemanticMatchedGroups ?? summary.ocrMatchedGroups ?? 0}/${summary.ocrSemanticReferenceGroups ?? summary.ocrReferenceGroups ?? 0} semantic OCR groups matched.`,
    layout: `${summary.layoutZoneMatches ?? 0}/${summary.ocrSemanticMatchedGroups ?? summary.ocrMatchedGroups ?? 0} semantic cues matched zones; rendered pose clearance ${embodied?.status ?? 'not supplied'}.`,
    'visual-treatment':
      'Candidate/reference luma, contrast, and saturation ratios were compared across sampled frames.',
    'creator-identity': 'Persistent creator identity OCR coverage was measured.',
    delivery: 'CTA and end-card OCR coverage was measured in the final production window.',
    'intentional-production': `${decisionLedger.coverage.filter((item) => item.status === 'pass').length}/10 dimensions are learned; ${decisionLedger.coverage.filter((item) => item.status === 'provisional').length} provisional; ${decisionLedger.coverage.filter((item) => item.status === 'missing').length} missing.`,
  };
  return notes[id];
}

function value(flag) {
  const result = optional(flag);
  if (!result) {
    throw new Error(
      'Usage: node scripts/analysis/build_creative_fidelity_input.mjs --comparison audit.json --taste-run run.json --decision-ledger ledger.json --out input.json [--embodied-layout audit.json]',
    );
  }
  return result;
}

function optional(flag) {
  const index = process.argv.indexOf(flag);
  const result = index >= 0 ? process.argv[index + 1] : undefined;
  return result && !result.startsWith('--') ? result : undefined;
}
