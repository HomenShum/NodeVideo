import type { ContentKind } from './creator-taste-contracts';

export const PRODUCTION_DECISION_LEDGER_SCHEMA_VERSION =
  'nodevideo.production-decision-ledger.v1' as const;
export const CREATOR_INTENT_PROFILE_SCHEMA_VERSION = 'nodevideo.creator-intent-profile.v1' as const;

export const PRODUCTION_DECISION_DIMENSIONS = [
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
] as const;

export type ProductionDecisionDimension = (typeof PRODUCTION_DECISION_DIMENSIONS)[number];
export type DecisionEvidenceStatus = 'observed' | 'inferred' | 'owner-confirmed';
export type DecisionGeneralizability = 'case-only' | 'profile-candidate' | 'profile-rule';
export type DecisionCoverageStatus = 'pass' | 'provisional' | 'missing';

export interface AttentionChoreography {
  target: 'face' | 'hands' | 'body' | 'text' | 'identity' | 'cut' | 'frame';
  action: 'lead-motion' | 'follow-motion' | 'counterpoint' | 'reset' | 'reveal' | 'hold';
  eyeTravel: 'none' | 'up' | 'down' | 'left' | 'right' | 'diagonal' | 'alternating';
  motionRelationship: 'anticipates' | 'coincides' | 'follows' | 'independent';
  spatialNovelty: number;
  saliencyCompetition: number;
}

export interface ProductionDecision {
  id: string;
  dimension: ProductionDecisionDimension;
  timelineRange: { startMs: number; endMs: number } | null;
  observation: string;
  intentHypothesis: string;
  causalFunction: string;
  evidenceArtifactIds: string[];
  alternativesRejected: string[];
  confidence: number;
  evidenceStatus: DecisionEvidenceStatus;
  generalizability: DecisionGeneralizability;
  supportProductions: number;
  requiresOwnerReview: boolean;
  attentionChoreography: AttentionChoreography | null;
}

export interface ProductionDecisionDimensionCoverage {
  dimension: ProductionDecisionDimension;
  status: DecisionCoverageStatus;
  score: number;
  decisionIds: string[];
  blockingReasons: string[];
}

export interface ProductionDecisionLedger {
  schemaVersion: typeof PRODUCTION_DECISION_LEDGER_SCHEMA_VERSION;
  id: string;
  productionAuditId: string;
  createdAt: string;
  contentKind: ContentKind;
  sourceProductionIds: string[];
  decisions: ProductionDecision[];
  coverage: ProductionDecisionDimensionCoverage[];
  overallStatus: 'pass' | 'provisional' | 'fail';
  score: number;
  cautions: string[];
}

export interface CreatorIntentRule {
  id: string;
  dimension: ProductionDecisionDimension;
  causalFunction: string;
  creatorRule: string;
  supportProductions: number;
  confidence: number;
  evidenceArtifactIds: string[];
}

export interface CreatorIntentProfile {
  schemaVersion: typeof CREATOR_INTENT_PROFILE_SCHEMA_VERSION;
  id: string;
  learnedAt: string;
  sourceLedgerIds: string[];
  rules: CreatorIntentRule[];
  cautions: string[];
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CONTENT_KINDS = ['dance', 'talking-head', 'tutorial', 'comedy', 'montage', 'other'];

export function deriveDecisionCoverage(
  decisions: readonly ProductionDecision[],
): ProductionDecisionDimensionCoverage[] {
  return PRODUCTION_DECISION_DIMENSIONS.map((dimension) => {
    const relevant = decisions.filter((decision) => decision.dimension === dimension);
    if (relevant.length === 0) {
      return {
        dimension,
        status: 'missing',
        score: 0,
        decisionIds: [],
        blockingReasons: [`No evidence-bound ${dimension} decision was produced.`],
      };
    }
    const score = Math.min(...relevant.map((decision) => decision.confidence));
    const learned = relevant.every(
      (decision) =>
        decision.evidenceStatus === 'owner-confirmed' &&
        decision.generalizability === 'profile-rule' &&
        decision.supportProductions >= 2 &&
        !decision.requiresOwnerReview,
    );
    return {
      dimension,
      status: learned ? 'pass' : 'provisional',
      score,
      decisionIds: relevant.map((decision) => decision.id),
      blockingReasons: learned
        ? []
        : [
            `${dimension} has evidence, but its causal intent is not an owner-confirmed rule supported by multiple productions.`,
          ],
    };
  });
}

export function deriveDecisionLedgerStatus(
  coverage: readonly ProductionDecisionDimensionCoverage[],
): ProductionDecisionLedger['overallStatus'] {
  if (coverage.some((item) => item.status === 'missing')) return 'fail';
  if (coverage.some((item) => item.status === 'provisional')) return 'provisional';
  return 'pass';
}

export function validateProductionDecisionLedger(
  value: unknown,
): asserts value is ProductionDecisionLedger {
  assert(isRecord(value), 'ProductionDecisionLedger must be an object.');
  assertExactKeys(value, 'ProductionDecisionLedger', [
    'schemaVersion',
    'id',
    'productionAuditId',
    'createdAt',
    'contentKind',
    'sourceProductionIds',
    'decisions',
    'coverage',
    'overallStatus',
    'score',
    'cautions',
  ]);
  assert(
    value.schemaVersion === PRODUCTION_DECISION_LEDGER_SCHEMA_VERSION,
    'Unsupported production decision ledger schema.',
  );
  assertId(value.id, 'ProductionDecisionLedger.id');
  assertId(value.productionAuditId, 'ProductionDecisionLedger.productionAuditId');
  assertIsoDate(value.createdAt, 'ProductionDecisionLedger.createdAt');
  assert(
    typeof value.contentKind === 'string' && CONTENT_KINDS.includes(value.contentKind),
    'ProductionDecisionLedger.contentKind is invalid.',
  );
  assertIds(value.sourceProductionIds, 'ProductionDecisionLedger.sourceProductionIds', true);
  assert(Array.isArray(value.decisions), 'ProductionDecisionLedger.decisions must be an array.');
  const decisionIds = new Set<string>();
  value.decisions.forEach((decision, index) => {
    validateProductionDecision(decision, `ProductionDecisionLedger.decisions[${index}]`);
    assert(!decisionIds.has(decision.id), `Duplicate production decision: ${decision.id}.`);
    decisionIds.add(decision.id);
  });
  assert(
    Array.isArray(value.coverage) &&
      value.coverage.length === PRODUCTION_DECISION_DIMENSIONS.length,
    'ProductionDecisionLedger.coverage must contain every decision dimension.',
  );
  const coverageDimensions = new Set<string>();
  value.coverage.forEach((item, index) => {
    validateCoverage(item, `ProductionDecisionLedger.coverage[${index}]`, decisionIds);
    assert(!coverageDimensions.has(item.dimension), `Duplicate coverage: ${item.dimension}.`);
    coverageDimensions.add(item.dimension);
  });
  for (const dimension of PRODUCTION_DECISION_DIMENSIONS) {
    assert(coverageDimensions.has(dimension), `Coverage for ${dimension} is required.`);
  }
  const derived = deriveDecisionCoverage(value.decisions);
  assert(
    JSON.stringify(value.coverage) === JSON.stringify(derived),
    'ProductionDecisionLedger.coverage must be derived from the admitted decisions.',
  );
  const derivedStatus = deriveDecisionLedgerStatus(value.coverage);
  assert(
    value.overallStatus === derivedStatus,
    'ProductionDecisionLedger.overallStatus is invalid.',
  );
  const derivedScore = Math.min(...value.coverage.map((item) => item.score));
  assert(
    value.score === derivedScore,
    'ProductionDecisionLedger.score must equal its weakest dimension.',
  );
  assertStrings(value.cautions, 'ProductionDecisionLedger.cautions');
}

export function validateCreatorIntentProfile(
  value: unknown,
): asserts value is CreatorIntentProfile {
  assert(isRecord(value), 'CreatorIntentProfile must be an object.');
  assertExactKeys(value, 'CreatorIntentProfile', [
    'schemaVersion',
    'id',
    'learnedAt',
    'sourceLedgerIds',
    'rules',
    'cautions',
  ]);
  assert(
    value.schemaVersion === CREATOR_INTENT_PROFILE_SCHEMA_VERSION,
    'Unsupported creator intent profile schema.',
  );
  assertId(value.id, 'CreatorIntentProfile.id');
  assertIsoDate(value.learnedAt, 'CreatorIntentProfile.learnedAt');
  assertIds(value.sourceLedgerIds, 'CreatorIntentProfile.sourceLedgerIds', true);
  assert(Array.isArray(value.rules), 'CreatorIntentProfile.rules must be an array.');
  const ids = new Set<string>();
  value.rules.forEach((rule, index) => {
    const label = `CreatorIntentProfile.rules[${index}]`;
    assert(isRecord(rule), `${label} must be an object.`);
    assertExactKeys(rule, label, [
      'id',
      'dimension',
      'causalFunction',
      'creatorRule',
      'supportProductions',
      'confidence',
      'evidenceArtifactIds',
    ]);
    assertId(rule.id, `${label}.id`);
    assert(!ids.has(rule.id), `${label}.id is duplicated.`);
    ids.add(rule.id);
    assertDimension(rule.dimension, `${label}.dimension`);
    assertText(rule.causalFunction, `${label}.causalFunction`);
    assertText(rule.creatorRule, `${label}.creatorRule`);
    assertInteger(rule.supportProductions, `${label}.supportProductions`, 2);
    assertUnit(rule.confidence, `${label}.confidence`);
    assertIds(rule.evidenceArtifactIds, `${label}.evidenceArtifactIds`, true);
  });
  assertStrings(value.cautions, 'CreatorIntentProfile.cautions');
}

function validateProductionDecision(
  value: unknown,
  label: string,
): asserts value is ProductionDecision {
  assert(isRecord(value), `${label} must be an object.`);
  assertExactKeys(value, label, [
    'id',
    'dimension',
    'timelineRange',
    'observation',
    'intentHypothesis',
    'causalFunction',
    'evidenceArtifactIds',
    'alternativesRejected',
    'confidence',
    'evidenceStatus',
    'generalizability',
    'supportProductions',
    'requiresOwnerReview',
    'attentionChoreography',
  ]);
  assertId(value.id, `${label}.id`);
  assertDimension(value.dimension, `${label}.dimension`);
  if (value.timelineRange !== null) {
    assert(isRecord(value.timelineRange), `${label}.timelineRange must be an object or null.`);
    assertExactKeys(value.timelineRange, `${label}.timelineRange`, ['startMs', 'endMs']);
    assertInteger(value.timelineRange.startMs, `${label}.timelineRange.startMs`, 0);
    assertInteger(value.timelineRange.endMs, `${label}.timelineRange.endMs`, 1);
    assert(
      value.timelineRange.endMs > value.timelineRange.startMs,
      `${label}.timelineRange must have positive duration.`,
    );
  }
  assertText(value.observation, `${label}.observation`);
  assertText(value.intentHypothesis, `${label}.intentHypothesis`);
  assertText(value.causalFunction, `${label}.causalFunction`);
  assertIds(value.evidenceArtifactIds, `${label}.evidenceArtifactIds`, true);
  assertStrings(value.alternativesRejected, `${label}.alternativesRejected`);
  assertUnit(value.confidence, `${label}.confidence`);
  assert(
    value.evidenceStatus === 'observed' ||
      value.evidenceStatus === 'inferred' ||
      value.evidenceStatus === 'owner-confirmed',
    `${label}.evidenceStatus is invalid.`,
  );
  assert(
    value.generalizability === 'case-only' ||
      value.generalizability === 'profile-candidate' ||
      value.generalizability === 'profile-rule',
    `${label}.generalizability is invalid.`,
  );
  assertInteger(value.supportProductions, `${label}.supportProductions`, 1);
  assert(
    typeof value.requiresOwnerReview === 'boolean',
    `${label}.requiresOwnerReview is invalid.`,
  );
  if (value.evidenceStatus === 'inferred') {
    assert(value.requiresOwnerReview, `${label} inferred intent must require owner review.`);
  }
  if (value.generalizability === 'case-only') {
    assert(value.supportProductions === 1, `${label} case-only evidence must have one production.`);
  }
  if (value.generalizability === 'profile-rule') {
    assert(
      value.evidenceStatus === 'owner-confirmed',
      `${label} profile rules must be owner-confirmed.`,
    );
    assert(value.supportProductions >= 2, `${label} profile rules require multiple productions.`);
    assert(!value.requiresOwnerReview, `${label} profile rules cannot require review.`);
  }
  if (value.attentionChoreography === null) {
    assert(value.dimension !== 'attention', `${label} attention decisions require choreography.`);
  } else {
    assert(
      value.dimension === 'attention',
      `${label} choreography is only valid for attention decisions.`,
    );
    validateAttention(value.attentionChoreography, `${label}.attentionChoreography`);
  }
}

function validateAttention(value: unknown, label: string): asserts value is AttentionChoreography {
  assert(isRecord(value), `${label} must be an object.`);
  assertExactKeys(value, label, [
    'target',
    'action',
    'eyeTravel',
    'motionRelationship',
    'spatialNovelty',
    'saliencyCompetition',
  ]);
  assert(
    ['face', 'hands', 'body', 'text', 'identity', 'cut', 'frame'].includes(value.target),
    `${label}.target is invalid.`,
  );
  assert(
    ['lead-motion', 'follow-motion', 'counterpoint', 'reset', 'reveal', 'hold'].includes(
      value.action,
    ),
    `${label}.action is invalid.`,
  );
  assert(
    ['none', 'up', 'down', 'left', 'right', 'diagonal', 'alternating'].includes(value.eyeTravel),
    `${label}.eyeTravel is invalid.`,
  );
  assert(
    ['anticipates', 'coincides', 'follows', 'independent'].includes(value.motionRelationship),
    `${label}.motionRelationship is invalid.`,
  );
  assertUnit(value.spatialNovelty, `${label}.spatialNovelty`);
  assertUnit(value.saliencyCompetition, `${label}.saliencyCompetition`);
}

function validateCoverage(
  value: unknown,
  label: string,
  decisionIds: ReadonlySet<string>,
): asserts value is ProductionDecisionDimensionCoverage {
  assert(isRecord(value), `${label} must be an object.`);
  assertExactKeys(value, label, ['dimension', 'status', 'score', 'decisionIds', 'blockingReasons']);
  assertDimension(value.dimension, `${label}.dimension`);
  assert(
    value.status === 'pass' || value.status === 'provisional' || value.status === 'missing',
    `${label}.status is invalid.`,
  );
  assertUnit(value.score, `${label}.score`);
  assertIds(value.decisionIds, `${label}.decisionIds`, false);
  for (const id of value.decisionIds) {
    assert(decisionIds.has(id), `${label} references unknown decision ${id}.`);
  }
  assertStrings(value.blockingReasons, `${label}.blockingReasons`);
}

function assertDimension(
  value: unknown,
  label: string,
): asserts value is ProductionDecisionDimension {
  assert(
    typeof value === 'string' && PRODUCTION_DECISION_DIMENSIONS.includes(value as never),
    `${label} is invalid.`,
  );
}

function assertIds(value: unknown, label: string, requireOne: boolean): asserts value is string[] {
  assert(Array.isArray(value) && (!requireOne || value.length > 0), `${label} is invalid.`);
  const seen = new Set<string>();
  value.forEach((id, index) => {
    assertId(id, `${label}[${index}]`);
    assert(!seen.has(id), `${label} contains a duplicate.`);
    seen.add(id);
  });
}

function assertStrings(value: unknown, label: string): asserts value is string[] {
  assert(Array.isArray(value), `${label} must be an array.`);
  value.forEach((item, index) => assertText(item, `${label}[${index}]`));
}

function assertExactKeys(
  value: Record<string, unknown>,
  label: string,
  keys: readonly string[],
): void {
  const expected = new Set(keys);
  for (const key of keys) assert(Object.hasOwn(value, key), `${label}.${key} is required.`);
  for (const key of Object.keys(value))
    assert(expected.has(key), `${label}.${key} is not allowed.`);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertId(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && ID_PATTERN.test(value), `${label} is invalid.`);
}

function assertText(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' && value.trim().length > 0 && value.length <= 2_000,
    `${label} is invalid.`,
  );
}

function assertInteger(value: unknown, label: string, minimum: number): asserts value is number {
  assert(Number.isInteger(value) && (value as number) >= minimum, `${label} is invalid.`);
}

function assertUnit(value: unknown, label: string): asserts value is number {
  assert(
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1,
    `${label} must be between zero and one.`,
  );
}

function assertIsoDate(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === 'string' && Number.isFinite(Date.parse(value)) && value.includes('T'),
    `${label} must be an ISO timestamp.`,
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
