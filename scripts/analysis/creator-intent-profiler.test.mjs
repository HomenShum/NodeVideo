import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_DECISION_LEDGER_SCHEMA_VERSION,
  deriveDecisionCoverage,
  deriveDecisionLedgerStatus,
} from '../../src/lib/production-decision-contracts.ts';
import { learnCreatorIntentProfile } from './creator-intent-profiler.mjs';

function ledger(id, productionId, ownerConfirmed) {
  const decisions = [
    {
      id: `decision.${id}`,
      dimension: 'audio',
      timelineRange: null,
      observation: 'The master leaves platform headroom.',
      intentHypothesis: 'Keep the private guide mix below platform normalization pressure.',
      causalFunction: 'preserve platform headroom',
      evidenceArtifactIds: [`artifact.${id}`],
      alternativesRejected: [],
      confidence: 0.9,
      evidenceStatus: ownerConfirmed ? 'owner-confirmed' : 'inferred',
      generalizability: ownerConfirmed ? 'profile-candidate' : 'case-only',
      supportProductions: 1,
      requiresOwnerReview: !ownerConfirmed,
      attentionChoreography: null,
    },
  ];
  const coverage = deriveDecisionCoverage(decisions);
  return {
    schemaVersion: PRODUCTION_DECISION_LEDGER_SCHEMA_VERSION,
    id,
    productionAuditId: `audit.${id}`,
    createdAt: '2026-07-16T12:00:00.000Z',
    contentKind: 'dance',
    sourceProductionIds: [productionId],
    decisions,
    coverage,
    overallStatus: deriveDecisionLedgerStatus(coverage),
    score: 0,
    cautions: [],
  };
}

describe('creator intent profiler', () => {
  it('does not learn from one inferred production', () => {
    const result = learnCreatorIntentProfile({
      ledgers: [ledger('ledger.one', 'production.one', false)],
      id: 'intent.owner',
      learnedAt: '2026-07-16T12:00:00.000Z',
    });
    expect(result.rules).toEqual([]);
    expect(result.cautions).toHaveLength(1);
  });

  it('promotes matching owner-confirmed intent from two productions', () => {
    const result = learnCreatorIntentProfile({
      ledgers: [
        ledger('ledger.one', 'production.one', true),
        ledger('ledger.two', 'production.two', true),
      ],
      id: 'intent.owner',
      learnedAt: '2026-07-16T12:00:00.000Z',
    });
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].supportProductions).toBe(2);
  });
});
