import { describe, expect, it } from 'vitest';
import {
  TARGET_SPEC_CONSISTENCY_SCHEMA_VERSION,
  type TargetSpecConsistencyReport,
} from './creator-taste-contracts';
import {
  CREATIVE_FIDELITY_GATE_IDS,
  CREATIVE_FIDELITY_INPUT_SCHEMA_VERSION,
  type CreativeFidelityInput,
  evaluateCreativeFidelity,
  validateCreativeFidelityReport,
} from './creator-taste-evaluator';

function consistency(status: 'pass' | 'fail'): TargetSpecConsistencyReport {
  return {
    schemaVersion: TARGET_SPEC_CONSISTENCY_SCHEMA_VERSION,
    auditId: 'production.reference',
    status,
    score: status === 'pass' ? 1 : 0,
    checks: [
      {
        id: 'target-interpretation',
        status,
        observed: 'visible identity, grade, overlays, and end-card',
        claimed: status === 'pass' ? 'all represented' : 'lyrics only',
        message: status === 'pass' ? 'Spec explains the pixels.' : 'Spec omits visible semantics.',
      },
    ],
    blockingReasons: status === 'pass' ? [] : ['Target interpretation is lossy.'],
  };
}

function input(specStatus: 'pass' | 'fail' = 'pass'): CreativeFidelityInput {
  return {
    schemaVersion: CREATIVE_FIDELITY_INPUT_SCHEMA_VERSION,
    candidateArtifactId: 'artifact.candidate',
    referenceAuditId: 'production.reference',
    targetSpecConsistency: consistency(specStatus),
    gates: Object.fromEntries(
      CREATIVE_FIDELITY_GATE_IDS.map((id) => [
        id,
        {
          score: 1,
          evidenceArtifactIds: [`evidence.${id}`],
          note: `${id} was measured against frozen reference evidence.`,
        },
      ]),
    ) as CreativeFidelityInput['gates'],
  };
}

describe('creative fidelity evaluator', () => {
  it('passes only when every evidence-bound gate passes', () => {
    const passing = evaluateCreativeFidelity(input());
    expect(passing.status).toBe('pass');
    expect(() => validateCreativeFidelityReport(passing)).not.toThrow();
    const weakLayout = input();
    weakLayout.gates.layout.score = 0.79;
    const report = evaluateCreativeFidelity(weakLayout);
    expect(report.status).toBe('fail');
    expect(report.score).toBe(0.79);
    expect(report.blockingReasons).toEqual([expect.stringMatching(/layout scored/)]);
  });

  it('invalidates evaluation before scoring when target interpretation is inconsistent', () => {
    const report = evaluateCreativeFidelity(input('fail'));
    expect(report.status).toBe('invalid');
    expect(report.gates.every((gate) => gate.status === 'invalid')).toBe(true);
    expect(report.blockingReasons.join(' ')).toMatch(/cannot be adjudicated/);
  });

  it('rejects missing or evidence-free gates', () => {
    const missingEvidence = input();
    missingEvidence.gates.delivery.evidenceArtifactIds = [];
    expect(() => evaluateCreativeFidelity(missingEvidence)).toThrow(/must not be empty/);
  });
});
