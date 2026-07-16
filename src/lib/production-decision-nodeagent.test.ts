import { describe, expect, it } from 'vitest';
import {
  type ProductionDecisionWorkflowCandidate,
  validateProductionDecisionWorkflowCandidate,
} from './creator-taste-nodeagent';
import {
  PRODUCTION_DECISION_LEDGER_SCHEMA_VERSION,
  type ProductionDecision,
  deriveDecisionCoverage,
  deriveDecisionLedgerStatus,
} from './production-decision-contracts';

function candidate(): ProductionDecisionWorkflowCandidate {
  const decisions: ProductionDecision[] = [
    {
      id: 'decision.attention.one',
      dimension: 'attention',
      timelineRange: null,
      observation: 'Text alternates between gesture regions.',
      intentHypothesis: 'The alternation may direct the eye through the choreography.',
      causalFunction: 'direct eye travel',
      evidenceArtifactIds: ['artifact.pose-and-text'],
      alternativesRejected: [],
      confidence: 0.8,
      evidenceStatus: 'inferred',
      generalizability: 'case-only',
      supportProductions: 1,
      requiresOwnerReview: true,
      attentionChoreography: {
        target: 'hands',
        action: 'lead-motion',
        eyeTravel: 'alternating',
        motionRelationship: 'anticipates',
        spatialNovelty: 0.8,
        saliencyCompetition: 0.1,
      },
    },
  ];
  const coverage = deriveDecisionCoverage(decisions);
  return {
    kind: 'production-decision-audit',
    projectId: 'project.one',
    ledger: {
      schemaVersion: PRODUCTION_DECISION_LEDGER_SCHEMA_VERSION,
      id: 'ledger.one',
      productionAuditId: 'audit.one',
      createdAt: '2026-07-16T12:00:00.000Z',
      contentKind: 'dance',
      sourceProductionIds: ['production.one'],
      decisions,
      coverage,
      overallStatus: deriveDecisionLedgerStatus(coverage),
      score: 0,
      cautions: [],
    },
    creatorIntentProfile: null,
    evaluationReady: false,
  };
}

describe('production decision NodeAgent admission', () => {
  it('admits a valid fail-closed analysis candidate', () => {
    expect(
      validateProductionDecisionWorkflowCandidate(candidate(), 'project.one', 'audit.one'),
    ).toEqual([]);
  });

  it('rejects an audit-boundary mismatch', () => {
    expect(
      validateProductionDecisionWorkflowCandidate(candidate(), 'project.one', 'audit.other'),
    ).toContain('Production decision ledger crossed the production-audit boundary.');
  });
});
