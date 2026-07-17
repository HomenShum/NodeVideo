import { describe, expect, it } from 'vitest';
import { evaluateProductionVerdicts } from './production-verdicts';

describe('production verdict separation', () => {
  it('does not turn provisional profile learning into an edit-fidelity failure', () => {
    const report = {
      schemaVersion: 'nodevideo.creative-fidelity-report.v1',
      candidateArtifactId: 'artifact.candidate',
      referenceAuditId: 'audit.reference',
      status: 'pass',
      conjunctive: true,
      score: 0.9,
      gates: [
        'provenance',
        'structural',
        'semantic-overlays',
        'layout',
        'visual-treatment',
        'creator-identity',
        'delivery',
      ].map((id) => ({
        id,
        score: 1,
        threshold: 0.8,
        status: 'pass',
        evidenceArtifactIds: [`evidence.${id}`],
        note: `${id} passed.`,
      })),
      blockingReasons: [],
    };
    const dimensions = [
      'attention',
      'rhythm',
      'composition',
      'typography',
      'performance',
      'color',
      'audio',
      'identity',
      'narrative',
      'platform',
    ];
    const ledger = {
      schemaVersion: 'nodevideo.production-decision-ledger.v1',
      id: 'ledger.one',
      productionAuditId: 'audit.one',
      createdAt: '2026-07-16T12:00:00.000Z',
      contentKind: 'dance',
      sourceProductionIds: ['production.one'],
      decisions: [],
      coverage: dimensions.map((dimension) => ({
        dimension,
        status: 'missing',
        score: 0,
        decisionIds: [],
        blockingReasons: [`No evidence-bound ${dimension} decision was produced.`],
      })),
      overallStatus: 'fail',
      score: 0,
      cautions: [],
    };
    const result = evaluateProductionVerdicts({
      creativeFidelity: report as never,
      decisionLedger: ledger as never,
      creatorIntentProfile: {
        schemaVersion: 'nodevideo.creator-intent-profile.v1',
        id: 'profile.one',
        learnedAt: '2026-07-16T12:00:00.000Z',
        sourceLedgerIds: ['ledger.one'],
        rules: [],
        cautions: [],
      },
      isolation: {
        manifestArtifactId: 'artifact.manifest',
        freezeArtifactId: 'artifact.freeze',
        mode: 'song-conditioned-source-only',
        finishedEditAcceptedByCli: false,
        forbiddenMediaMountedDuringGeneration: false,
        forbiddenMediaReadDuringGeneration: false,
        forbiddenPlanReadDuringGeneration: false,
        targetMountedDuringGeneration: false,
        targetReadDuringGeneration: false,
        freezeFileCount: 4,
        allGenerationAssertionsPassed: true,
        embodiedOverlayAuditArtifactId: 'artifact.body-safe-overlays',
        embodiedOverlayAuditStatus: 'pass',
        embodiedOverlayAuditScore: 1,
      },
    });
    expect(result.editFidelity.status).toBe('pass');
    expect(result.blindAutonomy.status).toBe('pass');
    expect(result.blindAutonomy.tasteStatus).toBe('awaiting-blinded-human-evaluation');
    expect(result.blindAutonomy.checks.find((item) => item.id === 'body-safe-overlays')).toEqual({
      id: 'body-safe-overlays',
      status: 'pass',
      evidenceArtifactIds: ['artifact.body-safe-overlays'],
    });
    expect(result.creatorProfileMaturity.status).toBe('insufficient');
  });
});
