import {
  type CreativeFidelityReport,
  validateCreativeFidelityReport,
} from './creator-taste-evaluator.ts';
import {
  type CreatorIntentProfile,
  type ProductionDecisionLedger,
  validateCreatorIntentProfile,
  validateProductionDecisionLedger,
} from './production-decision-contracts.ts';

export const PRODUCTION_VERDICT_SET_SCHEMA_VERSION = 'nodevideo.production-verdict-set.v1' as const;

export interface GenerationIsolationEvidence {
  manifestArtifactId: string;
  freezeArtifactId: string;
  mode: string;
  finishedEditAcceptedByCli: boolean;
  forbiddenMediaMountedDuringGeneration: boolean;
  forbiddenMediaReadDuringGeneration: boolean;
  forbiddenPlanReadDuringGeneration: boolean;
  targetMountedDuringGeneration: boolean;
  targetReadDuringGeneration: boolean;
  freezeFileCount: number;
  allGenerationAssertionsPassed: boolean;
  embodiedOverlayAuditArtifactId: string;
  embodiedOverlayAuditStatus: 'pass' | 'fail';
  embodiedOverlayAuditScore: number;
}

export interface ProductionVerdictSet {
  schemaVersion: typeof PRODUCTION_VERDICT_SET_SCHEMA_VERSION;
  candidateArtifactId: string;
  editFidelity: {
    status: CreativeFidelityReport['status'];
    score: number;
    blockingReasons: string[];
  };
  blindAutonomy: {
    status: 'pass' | 'fail';
    generationIntegrity: 'pass' | 'fail';
    tasteStatus: 'awaiting-blinded-human-evaluation';
    checks: Array<{ id: string; status: 'pass' | 'fail'; evidenceArtifactIds: string[] }>;
    blockingReasons: string[];
  };
  creatorProfileMaturity: {
    status: 'mature' | 'provisional' | 'insufficient';
    learnedDimensions: number;
    provisionalDimensions: number;
    missingDimensions: number;
    promotedRuleCount: number;
    blockingReasons: string[];
  };
}

export function evaluateProductionVerdicts(args: {
  creativeFidelity: CreativeFidelityReport;
  decisionLedger: ProductionDecisionLedger;
  creatorIntentProfile: CreatorIntentProfile;
  isolation: GenerationIsolationEvidence;
}): ProductionVerdictSet {
  validateCreativeFidelityReport(args.creativeFidelity);
  validateProductionDecisionLedger(args.decisionLedger);
  validateCreatorIntentProfile(args.creatorIntentProfile);
  const checks = [
    check('source-only-mode', args.isolation.mode === 'song-conditioned-source-only'),
    check('finished-edit-excluded', !args.isolation.finishedEditAcceptedByCli),
    check(
      'forbidden-media-excluded',
      !args.isolation.forbiddenMediaMountedDuringGeneration &&
        !args.isolation.forbiddenMediaReadDuringGeneration,
    ),
    check('forbidden-plan-excluded', !args.isolation.forbiddenPlanReadDuringGeneration),
    check(
      'target-excluded-until-freeze',
      !args.isolation.targetMountedDuringGeneration && !args.isolation.targetReadDuringGeneration,
    ),
    check('freeze-complete', args.isolation.freezeFileCount >= 4),
    check('generation-assertions', args.isolation.allGenerationAssertionsPassed),
    check(
      'body-safe-overlays',
      args.isolation.embodiedOverlayAuditStatus === 'pass' &&
        args.isolation.embodiedOverlayAuditScore === 1,
      [args.isolation.embodiedOverlayAuditArtifactId],
    ),
  ];
  const failedIsolation = checks.filter((item) => item.status === 'fail');
  const learnedDimensions = args.decisionLedger.coverage.filter(
    (item) => item.status === 'pass',
  ).length;
  const provisionalDimensions = args.decisionLedger.coverage.filter(
    (item) => item.status === 'provisional',
  ).length;
  const missingDimensions = args.decisionLedger.coverage.filter(
    (item) => item.status === 'missing',
  ).length;
  const profileStatus =
    args.creatorIntentProfile.rules.length > 0 && missingDimensions === 0
      ? 'mature'
      : provisionalDimensions > 0 && missingDimensions === 0
        ? 'provisional'
        : 'insufficient';
  return {
    schemaVersion: PRODUCTION_VERDICT_SET_SCHEMA_VERSION,
    candidateArtifactId: args.creativeFidelity.candidateArtifactId,
    editFidelity: {
      status: args.creativeFidelity.status,
      score: args.creativeFidelity.score,
      blockingReasons: [...args.creativeFidelity.blockingReasons],
    },
    blindAutonomy: {
      status: failedIsolation.length === 0 ? 'pass' : 'fail',
      generationIntegrity: failedIsolation.length === 0 ? 'pass' : 'fail',
      tasteStatus: 'awaiting-blinded-human-evaluation',
      checks,
      blockingReasons: failedIsolation.map((item) => `${item.id} failed.`),
    },
    creatorProfileMaturity: {
      status: profileStatus,
      learnedDimensions,
      provisionalDimensions,
      missingDimensions,
      promotedRuleCount: args.creatorIntentProfile.rules.length,
      blockingReasons:
        profileStatus === 'mature'
          ? []
          : [
              'Reusable creator rules require matching owner-confirmed intent across at least two productions.',
            ],
    },
  };

  function check(id: string, passed: boolean, evidenceArtifactIds?: string[]) {
    return {
      id,
      status: passed ? ('pass' as const) : ('fail' as const),
      evidenceArtifactIds: evidenceArtifactIds ?? [
        args.isolation.manifestArtifactId,
        args.isolation.freezeArtifactId,
      ],
    };
  }
}
