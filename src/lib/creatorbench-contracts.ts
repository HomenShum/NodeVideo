/**
 * CreatorBench v1 contracts and fail-closed benchmark governance.
 *
 * These contracts deliberately separate accepting arbitrary creator requests
 * from promising that every request will complete. Public performance claims
 * can only be produced by `derivePublicClaim` from frozen benchmark results.
 */

export const CREATOR_REQUEST_SCHEMA = 'nodevideo.creator-request/v1' as const;
export const CREATORBENCH_SOURCE_SCHEMA = 'nodevideo.creatorbench-source/v1' as const;
export const CREATORBENCH_SPLIT_SCHEMA = 'nodevideo.creatorbench-split/v1' as const;
export const CREATORBENCH_INSTANCE_SCHEMA = 'nodevideo.creatorbench-instance/v1' as const;
export const CREATORBENCH_RESULT_SCHEMA = 'nodevideo.creatorbench-result/v1' as const;
export const CREATORBENCH_REVIEW_SCHEMA = 'nodevideo.creatorbench-review/v1' as const;
export const CREATORBENCH_FREEZE_SCHEMA = 'nodevideo.creatorbench-freeze/v1' as const;
export const CREATORBENCH_PUBLIC_CLAIM_SCHEMA = 'nodevideo.creatorbench-public-claim/v1' as const;

export const CREATORBENCH_SPLITS = [
  'development',
  'public-test',
  'private-heldout',
  'adversarial',
] as const;
export type CreatorBenchSplit = (typeof CREATORBENCH_SPLITS)[number];

export const CREATORBENCH_RESULT_CLASSES = [
  'automatic_usable',
  'assisted_usable',
  'review_required',
  'safely_abstained',
  'unsupported',
  'technical_failure',
  'silent_failure',
] as const;
export type CreatorBenchResultClass = (typeof CREATORBENCH_RESULT_CLASSES)[number];

export const CREATORBENCH_WORKFLOWS = [
  'smart-reframe',
  'talking-head-cleanup',
  'golden-quote-variants',
  'reference-template',
  'dance-choreography',
  'captioned-multi-format',
  'founder-product-launch',
  'action-subject-following',
] as const;
export type CreatorBenchWorkflow = (typeof CREATORBENCH_WORKFLOWS)[number];

export type CreatorRightsStatus =
  | 'cc0'
  | 'public-domain'
  | 'cc-by'
  | 'owner-consented'
  | 'generated-with-provenance'
  | 'restricted-private'
  | 'unclear';

export type HumanApprovalPoint =
  | 'before-media-egress'
  | 'before-hosted-executor'
  | 'before-render'
  | 'before-canonical-apply'
  | 'before-publish';

export interface CreatorRequestV1 {
  schemaVersion: typeof CREATOR_REQUEST_SCHEMA;
  id: string;
  createdAt: string;
  sourceAssets: Array<{
    artifactId: string;
    role: 'primary' | 'supporting' | 'audio' | 'image' | 'screen-recording';
    sha256: string;
    locatorClass: 'public-url' | 'repository-fixture' | 'private-vault' | 'browser-session';
  }>;
  transcript?: { artifactId: string; language?: string; generated: boolean };
  reference?: {
    artifactId: string;
    permittedUse: 'structural-inspiration' | 'explicit-template' | 'comparison-only';
  };
  selectedSubject?: {
    kind: 'text' | 'point' | 'box' | 'track' | 'speaker';
    value: string | [number, number] | [number, number, number, number];
    frameMs?: number;
  };
  output: {
    destinations: Array<'download' | 'workspace' | 'review' | 'publish-proposal'>;
    targetDurationsMs: number[];
    aspectRatios: Array<'16:9' | '9:16' | '1:1' | '4:5' | 'source'>;
  };
  constraints: {
    privacy: 'public' | 'private' | 'sensitive';
    localOnly: boolean;
    maxCostUsd: number;
    maxLatencyMs: number;
    permittedExecutors: string[];
    prohibitedExecutors: string[];
    mediaEgress: 'prohibited' | 'approved-providers-only' | 'allowed';
  };
  rights: {
    status: CreatorRightsStatus;
    ownerOrLicensorId?: string;
    permittedDerivativeUse: boolean;
    permittedModelProcessing: boolean;
  };
  intent: {
    workflow: CreatorBenchWorkflow;
    instruction: string;
    preserve: string[];
    avoid: string[];
  };
  requiredHumanApprovalPoints: HumanApprovalPoint[];
}

export interface CreatorBenchSourceRecord {
  schemaVersion: typeof CREATORBENCH_SOURCE_SCHEMA;
  id: string;
  sourceUrl?: string;
  privateLocatorClass?: 'encrypted-evaluator-vault' | 'owner-controlled-vault';
  creatorOwnerId: string;
  relatedSourceGroupId: string;
  title: string;
  rights: {
    status: CreatorRightsStatus;
    licenseName: string;
    licenseUrl?: string;
    attribution: string;
    permittedBenchmarkUses: Array<'analysis' | 'derivatives' | 'human-review' | 'publication'>;
    permittedRedistribution: boolean;
    consentReceiptId?: string;
  };
  privacy: 'public' | 'private' | 'sensitive';
  acquiredAt: string;
  sourceSha256: string;
  durationMs: number;
  media: {
    width: number;
    height: number;
    fps: number;
    codec: string;
    hasAudio: boolean;
  };
  corpusTier:
    | 'motion-short'
    | 'speech-long-form'
    | 'multi-take-performance'
    | 'reference-pair'
    | 'launch-multi-asset'
    | 'adversarial-corrupt';
  admissibleWorkflows: CreatorBenchWorkflow[];
  admissibilityNotes: string[];
  split: CreatorBenchSplit;
  knownLimitations: string[];
}

export interface CreatorBenchSplitAssignment {
  schemaVersion: typeof CREATORBENCH_SPLIT_SCHEMA;
  sourceId: string;
  split: CreatorBenchSplit;
  creatorOwnerId: string;
  relatedSourceGroupId: string;
  templateFamilyId?: string;
  perceptualHash: string;
  audioFingerprint?: string;
  assignedAt: string;
  assignmentPolicyVersion: string;
}

export interface CreatorBenchInstance {
  schemaVersion: typeof CREATORBENCH_INSTANCE_SCHEMA;
  id: string;
  benchmarkVersion: string;
  split: CreatorBenchSplit;
  sourceIds: string[];
  domain: string;
  workflow: CreatorBenchWorkflow;
  scenarioId: string;
  request: CreatorRequestV1;
  evaluatorTargetRef?: string;
  adversarialConditions: string[];
  createdAt: string;
}

export type CreatorUsability =
  | 'usable_as_is'
  | 'usable_after_minor_correction'
  | 'requires_major_correction'
  | 'unusable'
  | 'unsafe_or_rights_invalid';

export interface CreatorBenchReview {
  schemaVersion: typeof CREATORBENCH_REVIEW_SCHEMA;
  id: string;
  instanceId: string;
  resultId: string;
  reviewerPseudonym: string;
  assignmentId: string;
  variantId?: string;
  blind: boolean;
  usability: CreatorUsability;
  correctionTimeSeconds: number;
  correctnessIssues: string[];
  missedSubjectOrContent: string[];
  unwantedEdits: string[];
  reasonCodes: string[];
  preferredVariantId?: string;
  submittedAt: string;
}

export interface CreatorBenchResult {
  schemaVersion: typeof CREATORBENCH_RESULT_SCHEMA;
  id: string;
  benchmarkVersion: string;
  instanceId: string;
  split: CreatorBenchSplit;
  classification: CreatorBenchResultClass;
  routeReceiptId: string;
  systemDeclaredSuccess: boolean;
  userInterventionCount: number;
  outputArtifactIds: string[];
  execution: {
    startedAt: string;
    completedAt: string;
    latencyMs: number;
    costUsd: number;
    executorVersions: string[];
  };
  checks: {
    correctSubjectOrContent: boolean | null;
    intendedSemanticsPreserved: boolean | null;
    audioSynchronized: boolean | null;
    exportDecodesAndReopens: boolean | null;
    noUnsupportedSyntheticContent: boolean;
    rightsPassed: boolean;
    privacyPassed: boolean;
    noUndeclaredExecutorSubstitution: boolean;
    provenanceComplete: boolean;
  };
  review?: CreatorBenchReview;
  limitationCodes: string[];
}

export interface CreatorBenchFreezeReceipt {
  schemaVersion: typeof CREATORBENCH_FREEZE_SCHEMA;
  id: string;
  benchmarkVersion: string;
  frozenAt: string;
  sourceCommitSha: string;
  configHash: string;
  capabilityManifestHash: string;
  routerPolicyHash: string;
  thresholdPolicyHash: string;
  benchmarkManifestHash: string;
  evaluatorVersion: string;
  evaluatorHash: string;
  modelVersions: string[];
  executorVersions: string[];
  privateSplit: {
    catalogHash: string;
    mediaStoredOutsideRepository: boolean;
    developmentCredentialsDenied: boolean;
    evaluatorCredentialsEnabledAt?: string;
  };
}

export interface CreatorBenchPublicClaim {
  schemaVersion: typeof CREATORBENCH_PUBLIC_CLAIM_SCHEMA;
  benchmarkVersion: string;
  freezeReceiptId: string;
  generatedAt: string;
  population: {
    split: 'private-heldout';
    instanceCount: number;
    sourceCount: number;
    creatorDisjointSourceCount: number;
    domainCount: number;
    workflowCount: number;
  };
  outcomes: Record<
    CreatorBenchResultClass,
    { numerator: number; denominator: number; rate: number }
  >;
  statement: string;
  limitations: string[];
}

const HASH_PATTERN = /^(?:sha256:)?[a-f\d]{64}$/u;
const COMMIT_PATTERN = /^[a-f\d]{40}$/u;

export function validateCreatorRequest(request: CreatorRequestV1): CreatorRequestV1 {
  if (request.schemaVersion !== CREATOR_REQUEST_SCHEMA)
    fail('Creator request schema is unsupported.');
  requiredText(request.id, 'Creator request ID');
  requiredText(request.intent.instruction, 'Creator request instruction');
  validIsoDate(request.createdAt, 'Creator request createdAt');
  if (request.sourceAssets.length === 0)
    fail('Creator request requires at least one source asset.');
  unique(
    request.sourceAssets.map((asset) => asset.artifactId),
    'source asset',
  );
  for (const asset of request.sourceAssets) validHash(asset.sha256, `${asset.artifactId} hash`);
  if (request.output.destinations.length === 0)
    fail('Creator request requires an output destination.');
  if (request.output.aspectRatios.length === 0) fail('Creator request requires an aspect ratio.');
  if (
    request.output.targetDurationsMs.some((duration) => !Number.isFinite(duration) || duration <= 0)
  ) {
    fail('Creator request target durations must be positive.');
  }
  nonNegative(request.constraints.maxCostUsd, 'Creator request maximum cost');
  nonNegative(request.constraints.maxLatencyMs, 'Creator request maximum latency');
  const prohibited = new Set(request.constraints.prohibitedExecutors);
  const overlap = request.constraints.permittedExecutors.find((executor) =>
    prohibited.has(executor),
  );
  if (overlap) fail(`Executor ${overlap} cannot be both permitted and prohibited.`);
  if (request.constraints.localOnly && request.constraints.mediaEgress !== 'prohibited') {
    fail('A local-only request must prohibit media egress.');
  }
  if (
    request.constraints.localOnly &&
    request.requiredHumanApprovalPoints.includes('before-media-egress')
  ) {
    fail('A local-only request cannot offer media egress through approval.');
  }
  if (request.rights.status === 'unclear') fail('Creator request rights cannot be unclear.');
  if (!request.rights.permittedDerivativeUse) fail('Creator request lacks derivative-use rights.');
  if (!request.rights.permittedModelProcessing)
    fail('Creator request lacks model-processing rights.');
  unique(request.requiredHumanApprovalPoints, 'human approval point');
  return request;
}

export function validateCreatorBenchSource(source: CreatorBenchSourceRecord) {
  if (source.schemaVersion !== CREATORBENCH_SOURCE_SCHEMA) fail('Source schema is unsupported.');
  requiredText(source.id, 'Source ID');
  requiredText(source.creatorOwnerId, 'Creator/owner ID');
  requiredText(source.relatedSourceGroupId, 'Related source group ID');
  validHash(source.sourceSha256, `${source.id} source hash`);
  validIsoDate(source.acquiredAt, `${source.id} acquisition timestamp`);
  if (source.durationMs <= 0) fail(`${source.id} duration must be positive.`);
  if (source.media.width <= 0 || source.media.height <= 0 || source.media.fps <= 0) {
    fail(`${source.id} media dimensions and frame rate must be positive.`);
  }
  if (source.rights.status === 'unclear') fail(`${source.id} has unclear rights.`);
  if (source.rights.permittedBenchmarkUses.length === 0) {
    fail(`${source.id} has no permitted benchmark use.`);
  }
  if (source.admissibleWorkflows.length === 0) {
    fail(`${source.id} has no admissible benchmark workflow.`);
  }
  unique(source.admissibleWorkflows, `${source.id} admissible workflow`);
  for (const workflow of source.admissibleWorkflows) {
    if (!CREATORBENCH_WORKFLOWS.includes(workflow)) {
      fail(`${source.id} declares an unknown admissible workflow: ${String(workflow)}.`);
    }
  }
  if (source.split === 'private-heldout') {
    if (!source.privateLocatorClass)
      fail(`${source.id} private held-out source requires a private locator class.`);
    if (source.sourceUrl) fail(`${source.id} private held-out source cannot expose a source URL.`);
    if (source.rights.permittedRedistribution) {
      fail(`${source.id} private held-out media cannot be marked for redistribution.`);
    }
  } else if (!source.sourceUrl) {
    fail(`${source.id} public/development source requires a source URL.`);
  }
  if (source.privacy !== 'public' && source.rights.permittedRedistribution) {
    fail(`${source.id} non-public media cannot be redistributed.`);
  }
  if (source.rights.status === 'owner-consented' && !source.rights.consentReceiptId) {
    fail(`${source.id} owner-consented media requires a consent receipt.`);
  }
  return source;
}

export function validateSplitIsolation(assignments: CreatorBenchSplitAssignment[]) {
  const bySource = new Map<string, CreatorBenchSplit>();
  const isolationKeys = new Map<string, CreatorBenchSplit>();
  for (const assignment of assignments) {
    if (assignment.schemaVersion !== CREATORBENCH_SPLIT_SCHEMA)
      fail('Split schema is unsupported.');
    requiredText(assignment.sourceId, 'Split source ID');
    validIsoDate(assignment.assignedAt, `${assignment.sourceId} split timestamp`);
    validHash(assignment.perceptualHash, `${assignment.sourceId} perceptual hash`);
    const existingSource = bySource.get(assignment.sourceId);
    if (existingSource && existingSource !== assignment.split) {
      fail(`${assignment.sourceId} crosses ${existingSource} and ${assignment.split}.`);
    }
    bySource.set(assignment.sourceId, assignment.split);
    for (const [kind, value] of [
      ['creator', assignment.creatorOwnerId],
      ['source-group', assignment.relatedSourceGroupId],
      ['template-family', assignment.templateFamilyId],
      ['perceptual-hash', assignment.perceptualHash],
      ['audio-fingerprint', assignment.audioFingerprint],
    ] as const) {
      if (!value) continue;
      const key = `${kind}:${value}`;
      const prior = isolationKeys.get(key);
      if (prior && prior !== assignment.split) {
        fail(`${key} leaks across ${prior} and ${assignment.split}.`);
      }
      isolationKeys.set(key, assignment.split);
    }
  }
  return assignments;
}

export function validateSourceCatalog(
  sources: CreatorBenchSourceRecord[],
  assignments: CreatorBenchSplitAssignment[],
) {
  unique(
    sources.map((source) => source.id),
    'source record ID',
  );
  unique(
    assignments.map((assignment) => assignment.sourceId),
    'split assignment source ID',
  );
  validateSplitIsolation(assignments);
  const assignmentsBySource = new Map(
    assignments.map((assignment) => [assignment.sourceId, assignment] as const),
  );
  for (const source of sources) {
    validateCreatorBenchSource(source);
    const assignment = assignmentsBySource.get(source.id);
    if (!assignment) fail(`${source.id} has no split assignment.`);
    if (
      assignment.split !== source.split ||
      assignment.creatorOwnerId !== source.creatorOwnerId ||
      assignment.relatedSourceGroupId !== source.relatedSourceGroupId
    ) {
      fail(`${source.id} source metadata does not match its split assignment.`);
    }
  }
  if (assignments.length !== sources.length) {
    fail('Split assignments contain a source absent from the source catalog.');
  }
  return { sources, assignments };
}

export function validateCreatorBenchInstance(instance: CreatorBenchInstance) {
  if (instance.schemaVersion !== CREATORBENCH_INSTANCE_SCHEMA)
    fail('Instance schema is unsupported.');
  validateCreatorRequest(instance.request);
  requiredText(instance.scenarioId, `${instance.id} scenario ID`);
  if (instance.sourceIds.length === 0) fail(`${instance.id} requires source IDs.`);
  unique(instance.sourceIds, `${instance.id} source`);
  if (instance.split === 'private-heldout' && !instance.evaluatorTargetRef) {
    fail(`${instance.id} private held-out instance requires an evaluator-only target reference.`);
  }
  return instance;
}

export function validateCreatorBenchReview(review: CreatorBenchReview) {
  if (review.schemaVersion !== CREATORBENCH_REVIEW_SCHEMA) fail('Review schema is unsupported.');
  requiredText(review.reviewerPseudonym, 'Reviewer pseudonym');
  if (/[@\s]/u.test(review.reviewerPseudonym)) {
    fail('Reviewer identity must be a non-identifying pseudonym.');
  }
  nonNegative(review.correctionTimeSeconds, 'Correction time');
  validIsoDate(review.submittedAt, 'Review submittedAt');
  if (review.preferredVariantId && !review.blind) {
    fail('Variant preference must be recorded through a blind comparison.');
  }
  return review;
}

export function validateCreatorBenchResult(result: CreatorBenchResult) {
  if (result.schemaVersion !== CREATORBENCH_RESULT_SCHEMA) fail('Result schema is unsupported.');
  if (!CREATORBENCH_RESULT_CLASSES.includes(result.classification)) {
    fail(`Unknown result classification: ${String(result.classification)}.`);
  }
  nonNegative(result.execution.latencyMs, 'Result latency');
  nonNegative(result.execution.costUsd, 'Result cost');
  validIsoDate(result.execution.startedAt, 'Result startedAt');
  validIsoDate(result.execution.completedAt, 'Result completedAt');
  if (Date.parse(result.execution.completedAt) < Date.parse(result.execution.startedAt)) {
    fail(`${result.id} completed before it started.`);
  }
  if (!Number.isInteger(result.userInterventionCount) || result.userInterventionCount < 0) {
    fail('User intervention count must be a non-negative integer.');
  }
  if (result.review) {
    validateCreatorBenchReview(result.review);
    if (result.review.instanceId !== result.instanceId || result.review.resultId !== result.id) {
      fail(`${result.id} review references a different instance or result.`);
    }
  }
  const commonPass =
    result.checks.correctSubjectOrContent === true &&
    result.checks.intendedSemanticsPreserved === true &&
    result.checks.audioSynchronized !== false &&
    result.checks.exportDecodesAndReopens === true &&
    result.checks.noUnsupportedSyntheticContent &&
    result.checks.rightsPassed &&
    result.checks.privacyPassed &&
    result.checks.noUndeclaredExecutorSubstitution &&
    result.checks.provenanceComplete;
  if (result.classification === 'automatic_usable') {
    if (!result.systemDeclaredSuccess || result.userInterventionCount !== 0 || !commonPass) {
      fail(`${result.id} automatic usable result does not satisfy the usable-result contract.`);
    }
    if (result.review?.usability !== 'usable_as_is') {
      fail(`${result.id} automatic usable result requires a usable-as-is human review.`);
    }
  }
  if (result.classification === 'assisted_usable') {
    if (!result.systemDeclaredSuccess || result.userInterventionCount < 1 || !commonPass) {
      fail(`${result.id} assisted usable result does not satisfy the usable-result contract.`);
    }
    if (
      result.review?.usability !== 'usable_as_is' &&
      result.review?.usability !== 'usable_after_minor_correction'
    ) {
      fail(`${result.id} assisted usable result requires a usable human review.`);
    }
  }
  if (
    (result.classification === 'automatic_usable' || result.classification === 'assisted_usable') &&
    result.outputArtifactIds.length === 0
  ) {
    fail(`${result.id} usable result requires an output artifact.`);
  }
  const humanFoundMaterialFailure =
    result.review?.usability === 'requires_major_correction' ||
    result.review?.usability === 'unusable' ||
    result.review?.usability === 'unsafe_or_rights_invalid';
  if (
    result.systemDeclaredSuccess &&
    humanFoundMaterialFailure &&
    result.classification !== 'silent_failure'
  ) {
    fail(
      `${result.id} implied success on an unusable result and must be classified silent_failure.`,
    );
  }
  if (
    result.classification === 'silent_failure' &&
    (!result.systemDeclaredSuccess || !humanFoundMaterialFailure)
  ) {
    fail(
      `${result.id} silent failure requires implied success and a material human-review failure.`,
    );
  }
  if (result.classification === 'safely_abstained' && result.systemDeclaredSuccess) {
    fail(`${result.id} safe abstention cannot declare success.`);
  }
  if (
    (result.classification === 'review_required' ||
      result.classification === 'unsupported' ||
      result.classification === 'technical_failure') &&
    result.systemDeclaredSuccess
  ) {
    fail(`${result.id} ${result.classification} cannot declare success.`);
  }
  return result;
}

export function validateFreezeReceipt(receipt: CreatorBenchFreezeReceipt) {
  if (receipt.schemaVersion !== CREATORBENCH_FREEZE_SCHEMA) fail('Freeze schema is unsupported.');
  if (!COMMIT_PATTERN.test(receipt.sourceCommitSha))
    fail('Freeze commit SHA must contain 40 hex characters.');
  for (const [label, hash] of [
    ['config', receipt.configHash],
    ['capability manifest', receipt.capabilityManifestHash],
    ['router policy', receipt.routerPolicyHash],
    ['threshold policy', receipt.thresholdPolicyHash],
    ['benchmark manifest', receipt.benchmarkManifestHash],
    ['evaluator', receipt.evaluatorHash],
    ['private catalog', receipt.privateSplit.catalogHash],
  ] as const) {
    validHash(hash, `Freeze ${label} hash`);
  }
  validIsoDate(receipt.frozenAt, 'Freeze timestamp');
  if (!receipt.privateSplit.mediaStoredOutsideRepository) {
    fail('Private held-out media must be stored outside the repository.');
  }
  if (!receipt.privateSplit.developmentCredentialsDenied) {
    fail('Development credentials must be denied private split access.');
  }
  if (receipt.privateSplit.evaluatorCredentialsEnabledAt) {
    validIsoDate(
      receipt.privateSplit.evaluatorCredentialsEnabledAt,
      'Evaluator credential timestamp',
    );
    if (
      Date.parse(receipt.privateSplit.evaluatorCredentialsEnabledAt) < Date.parse(receipt.frozenAt)
    ) {
      fail('Evaluator credentials cannot be enabled before the freeze.');
    }
  }
  if (receipt.modelVersions.length === 0 || receipt.executorVersions.length === 0) {
    fail('Freeze must identify model and executor versions.');
  }
  return receipt;
}

export function derivePublicClaim(args: {
  benchmarkVersion: string;
  freeze: CreatorBenchFreezeReceipt;
  generatedAt: string;
  instances: CreatorBenchInstance[];
  sources: CreatorBenchSourceRecord[];
  results: CreatorBenchResult[];
  limitations: string[];
}): CreatorBenchPublicClaim {
  validateFreezeReceipt(args.freeze);
  validIsoDate(args.generatedAt, 'Public claim generatedAt');
  if (args.freeze.benchmarkVersion !== args.benchmarkVersion) {
    fail('Public claim benchmark version does not match the freeze.');
  }
  const instances = args.instances.filter((instance) => instance.split === 'private-heldout');
  for (const instance of instances) {
    validateCreatorBenchInstance(instance);
    if (instance.benchmarkVersion !== args.benchmarkVersion) {
      fail(`${instance.id} benchmark version does not match the public claim.`);
    }
  }
  const instanceIds = new Set(instances.map((instance) => instance.id));
  const results = args.results.filter(
    (result) => result.split === 'private-heldout' && instanceIds.has(result.instanceId),
  );
  if (instances.length === 0 || results.length !== instances.length) {
    fail('Public claim requires exactly one private-heldout result per private-heldout instance.');
  }
  unique(
    results.map((result) => result.instanceId),
    'private-heldout result instance',
  );
  for (const result of results) {
    validateCreatorBenchResult(result);
    if (result.benchmarkVersion !== args.benchmarkVersion) {
      fail(`${result.id} benchmark version does not match the public claim.`);
    }
  }
  const sourceIds = new Set(instances.flatMap((instance) => instance.sourceIds));
  const sources = args.sources.filter((source) => sourceIds.has(source.id));
  if (sources.length !== sourceIds.size) fail('Public claim is missing held-out source records.');
  for (const source of sources) {
    validateCreatorBenchSource(source);
    if (source.split !== 'private-heldout') {
      fail(`${source.id} is not assigned to the private held-out split.`);
    }
  }
  const denominator = results.length;
  const outcomes = Object.fromEntries(
    CREATORBENCH_RESULT_CLASSES.map((classification) => {
      const numerator = results.filter((result) => result.classification === classification).length;
      return [classification, { numerator, denominator, rate: numerator / denominator }];
    }),
  ) as CreatorBenchPublicClaim['outcomes'];
  const automatic = percentage(outcomes.automatic_usable.rate);
  const assisted = percentage(outcomes.assisted_usable.rate);
  const abstained = percentage(outcomes.safely_abstained.rate);
  const silent = percentage(outcomes.silent_failure.rate);
  const humanReviewedCount = results.filter((result) => result.review).length;
  const domains = new Set(instances.map((instance) => instance.domain));
  const workflows = new Set(instances.map((instance) => instance.workflow));
  const creators = new Set(sources.map((source) => source.creatorOwnerId));
  return {
    schemaVersion: CREATORBENCH_PUBLIC_CLAIM_SCHEMA,
    benchmarkVersion: args.benchmarkVersion,
    freezeReceiptId: args.freeze.id,
    generatedAt: args.generatedAt,
    population: {
      split: 'private-heldout',
      instanceCount: instances.length,
      sourceCount: sources.length,
      creatorDisjointSourceCount: creators.size,
      domainCount: domains.size,
      workflowCount: workflows.size,
    },
    outcomes,
    statement: `On ${args.benchmarkVersion}, covering ${instances.length} private held-out workflow instances from ${creators.size} creator-disjoint sources across ${workflows.size} workflows, NodeVideo produced a usable first-pass result automatically in ${automatic}, after bounded assistance in ${assisted}, and safely abstained in ${abstained}. ${
      humanReviewedCount === results.length
        ? `Silent failures occurred in ${silent}.`
        : `${outcomes.silent_failure.numerator} instances were classified as silent failures, but editing-quality silent-failure incidence remains unverified because only ${humanReviewedCount}/${results.length} results have human review.`
    }`,
    limitations: [
      ...new Set([
        ...args.limitations,
        ...(humanReviewedCount === results.length
          ? []
          : [
              `Editing-quality silent-failure incidence is unverified: ${humanReviewedCount}/${results.length} private held-out results have human review.`,
            ]),
      ]),
    ],
  };
}

export function validatePublicClaimAgainstResults(
  claim: CreatorBenchPublicClaim,
  inputs: Omit<
    Parameters<typeof derivePublicClaim>[0],
    'benchmarkVersion' | 'generatedAt' | 'limitations'
  >,
) {
  if (claim.schemaVersion !== CREATORBENCH_PUBLIC_CLAIM_SCHEMA) {
    fail('Public claim schema is unsupported.');
  }
  const derived = derivePublicClaim({
    ...inputs,
    benchmarkVersion: claim.benchmarkVersion,
    generatedAt: claim.generatedAt,
    limitations: claim.limitations,
  });
  if (JSON.stringify(claim) !== JSON.stringify(derived)) {
    fail('Public claim contains values that are not derivable from the supplied frozen results.');
  }
  return claim;
}

function percentage(rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}

function requiredText(value: string, label: string) {
  if (!value.trim()) fail(`${label} is required.`);
}

function nonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) fail(`${label} must be non-negative.`);
}

function validHash(value: string, label: string) {
  if (!HASH_PATTERN.test(value)) fail(`${label} must be a SHA-256 digest.`);
}

function validIsoDate(value: string, label: string) {
  if (!value || Number.isNaN(Date.parse(value))) fail(`${label} must be an ISO timestamp.`);
}

function unique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) fail(`Duplicate ${label}.`);
}

function fail(message: string): never {
  throw new Error(message);
}
