import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_DECISION_LEDGER_SCHEMA_VERSION,
  type ProductionDecision,
  type ProductionDecisionLedger,
  deriveDecisionCoverage,
  deriveDecisionLedgerStatus,
  validateProductionDecisionLedger,
} from './production-decision-contracts';

function decision(overrides: Partial<ProductionDecision> = {}): ProductionDecision {
  return {
    id: 'decision.attention.one',
    dimension: 'attention',
    timelineRange: { startMs: 100, endMs: 800 },
    observation: 'The title moves above the raised hand before the gesture lands.',
    intentHypothesis: 'The early title leads the eye toward the next movement.',
    causalFunction: 'anticipate the gesture and retain attention',
    evidenceArtifactIds: ['artifact.timeline.one'],
    alternativesRejected: [],
    confidence: 0.8,
    evidenceStatus: 'inferred',
    generalizability: 'case-only',
    supportProductions: 1,
    requiresOwnerReview: true,
    attentionChoreography: {
      target: 'hands',
      action: 'lead-motion',
      eyeTravel: 'up',
      motionRelationship: 'anticipates',
      spatialNovelty: 0.7,
      saliencyCompetition: 0.2,
    },
    ...overrides,
  };
}

function ledger(decisions: ProductionDecision[]): ProductionDecisionLedger {
  const coverage = deriveDecisionCoverage(decisions);
  return {
    schemaVersion: PRODUCTION_DECISION_LEDGER_SCHEMA_VERSION,
    id: 'ledger.owner.one',
    productionAuditId: 'audit.owner.one',
    createdAt: '2026-07-16T12:00:00.000Z',
    contentKind: 'dance',
    sourceProductionIds: ['production.owner.one'],
    decisions,
    coverage,
    overallStatus: deriveDecisionLedgerStatus(coverage),
    score: Math.min(...coverage.map((item) => item.score)),
    cautions: ['Single-production intent remains provisional.'],
  };
}

describe('production decision contracts', () => {
  it('fails closed when intentional dimensions have no evidence', () => {
    const value = ledger([decision()]);
    expect(value.overallStatus).toBe('fail');
    expect(value.coverage.find((item) => item.dimension === 'attention')?.status).toBe(
      'provisional',
    );
    expect(value.coverage.find((item) => item.dimension === 'rhythm')?.status).toBe('missing');
    expect(() => validateProductionDecisionLedger(value)).not.toThrow();
  });

  it('does not allow inferred intent to silently become a learned profile rule', () => {
    const value = ledger([
      decision({
        evidenceStatus: 'inferred',
        generalizability: 'profile-rule',
        supportProductions: 2,
        requiresOwnerReview: true,
      }),
    ]);
    expect(() => validateProductionDecisionLedger(value)).toThrow('must be owner-confirmed');
  });

  it('requires attention decisions to expose eye-travel and saliency intent', () => {
    const value = ledger([decision({ attentionChoreography: null })]);
    expect(() => validateProductionDecisionLedger(value)).toThrow(
      'attention decisions require choreography',
    );
  });
});
