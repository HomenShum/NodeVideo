import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  jobEventKind,
  jobStatus,
  proposalStatus,
  runtimeLayer,
  stageName,
  stageStatus,
} from './validators';

export default defineSchema({
  cases: defineTable({
    ownerKey: v.string(),
    idempotencyKey: v.string(),
    title: v.string(),
    brief: v.string(),
    journey: v.string(),
    status: v.union(
      v.literal('intake'),
      v.literal('planning'),
      v.literal('review'),
      v.literal('execution'),
      v.literal('blocked'),
      v.literal('completed'),
    ),
    currentArtifactVersion: v.number(),
    selectedArtifactId: v.optional(v.id('artifacts')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_owner_updatedAt', ['ownerKey', 'updatedAt'])
    .index('by_owner_idempotency', ['ownerKey', 'idempotencyKey']),

  runs: defineTable({
    caseId: v.id('cases'),
    jobId: v.id('jobs'),
    threadId: v.id('agentThreads'),
    idempotencyKey: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('awaiting_review'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('failed_safely'),
      v.literal('cancelled'),
    ),
    currentStage: v.string(),
    planningReceiptJson: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_case_updatedAt', ['caseId', 'updatedAt'])
    .index('by_case_idempotency', ['caseId', 'idempotencyKey']),

  agentThreads: defineTable({
    caseId: v.id('cases'),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_case', ['caseId']),

  messages: defineTable({
    threadId: v.id('agentThreads'),
    runId: v.optional(v.id('runs')),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('tool')),
    text: v.string(),
    metadataJson: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_thread_createdAt', ['threadId', 'createdAt']),

  artifactVersions: defineTable({
    caseId: v.id('cases'),
    artifactId: v.id('artifacts'),
    version: v.number(),
    parentVersion: v.optional(v.number()),
    snapshotJson: v.string(),
    snapshotDigest: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
  })
    .index('by_case_version', ['caseId', 'version'])
    .index('by_artifact_version', ['artifactId', 'version']),

  approvals: defineTable({
    caseId: v.id('cases'),
    runId: v.id('runs'),
    proposalId: v.id('proposals'),
    expectedArtifactVersion: v.number(),
    proposalDigest: v.string(),
    decision: v.union(v.literal('approved'), v.literal('rejected')),
    actorRef: v.string(),
    exactCostJson: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_proposal', ['proposalId']),

  exceptions: defineTable({
    caseId: v.id('cases'),
    runId: v.id('runs'),
    code: v.string(),
    message: v.string(),
    preservedStateJson: v.string(),
    status: v.union(v.literal('open'), v.literal('resolved')),
    resolution: v.optional(v.string()),
    raisedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index('by_run_status', ['runId', 'status']),

  executorJobs: defineTable({
    caseId: v.id('cases'),
    runId: v.id('runs'),
    proposalId: v.id('proposals'),
    provider: v.string(),
    capability: v.string(),
    status: v.union(
      v.literal('proposed'),
      v.literal('approved'),
      v.literal('quote_invalidated'),
      v.literal('submitted'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    inputManifestJson: v.string(),
    quoteJson: v.string(),
    quoteDigest: v.string(),
    approvedQuoteDigest: v.optional(v.string()),
    providerJobId: v.optional(v.string()),
    outputArtifactId: v.optional(v.id('artifacts')),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_run_updatedAt', ['runId', 'updatedAt']),

  receipts: defineTable({
    caseId: v.id('cases'),
    runId: v.id('runs'),
    kind: v.string(),
    payloadJson: v.string(),
    payloadDigest: v.string(),
    createdAt: v.number(),
  }).index('by_run_createdAt', ['runId', 'createdAt']),

  timelineEvents: defineTable({
    caseId: v.id('cases'),
    runId: v.optional(v.id('runs')),
    sequence: v.number(),
    kind: v.string(),
    actorRef: v.string(),
    payloadJson: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_case_sequence', ['caseId', 'sequence']),

  sourceOnlyCases: defineTable({
    projectId: v.string(),
    idempotencyKey: v.string(),
    inputDigest: v.string(),
    inputJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_project_idempotency', ['projectId', 'idempotencyKey'])
    .index('by_project_createdAt', ['projectId', 'createdAt']),

  caseAssets: defineTable({
    caseId: v.id('sourceOnlyCases'),
    role: v.string(),
    storageId: v.id('_storage'),
    sha256: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    admittedAt: v.number(),
  }).index('by_case_role', ['caseId', 'role']),

  jobs: defineTable({
    caseId: v.optional(v.id('sourceOnlyCases')),
    projectId: v.string(),
    idempotencyKey: v.string(),
    inputDigest: v.string(),
    status: jobStatus,
    attempt: v.number(),
    maxAttempts: v.number(),
    leaseId: v.optional(v.string()),
    leaseToken: v.number(),
    leaseUntil: v.optional(v.number()),
    nextEventSequence: v.number(),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    currentStage: v.optional(stageName),
    frozenPlanDigest: v.optional(v.string()),
    frozenAt: v.optional(v.number()),
    evaluationUnsealedAt: v.optional(v.number()),
  })
    .index('by_project_idempotency', ['projectId', 'idempotencyKey'])
    .index('by_status_updatedAt', ['status', 'updatedAt']),

  jobStages: defineTable({
    jobId: v.id('jobs'),
    ordinal: v.number(),
    name: stageName,
    status: stageStatus,
    attempt: v.number(),
    maxAttempts: v.number(),
    inputDigest: v.string(),
    outputArtifactIds: v.array(v.id('artifacts')),
    checkpointJson: v.optional(v.string()),
    leaseId: v.optional(v.string()),
    leaseToken: v.number(),
    leaseUntil: v.optional(v.number()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_job_ordinal', ['jobId', 'ordinal'])
    .index('by_job_name', ['jobId', 'name'])
    .index('by_status_updatedAt', ['status', 'updatedAt']),

  jobEvents: defineTable({
    jobId: v.id('jobs'),
    sequence: v.number(),
    kind: jobEventKind,
    payloadJson: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_job_sequence', ['jobId', 'sequence']),

  artifacts: defineTable({
    projectId: v.string(),
    jobId: v.id('jobs'),
    artifactKey: v.string(),
    kind: v.string(),
    storageRef: v.string(),
    sha256: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    toolName: v.string(),
    toolVersion: v.string(),
    inputDigests: v.array(v.string()),
    metadataJson: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_job_artifactKey', ['jobId', 'artifactKey'])
    .index('by_project_createdAt', ['projectId', 'createdAt']),

  proposals: defineTable({
    projectId: v.string(),
    jobId: v.id('jobs'),
    artifactId: v.optional(v.id('artifacts')),
    baseRecipeVersion: v.string(),
    payloadJson: v.string(),
    payloadDigest: v.string(),
    status: proposalStatus,
    approvalDigest: v.optional(v.string()),
    approverRef: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index('by_job_status', ['jobId', 'status'])
    .index('by_payloadDigest', ['payloadDigest']),

  freezeReceipts: defineTable({
    jobId: v.id('jobs'),
    planArtifactId: v.id('artifacts'),
    planDigest: v.string(),
    renderArtifactId: v.id('artifacts'),
    renderDigest: v.string(),
    generationReadLogDigest: v.string(),
    createdAt: v.number(),
  }).index('by_job', ['jobId']),

  evaluationReceipts: defineTable({
    jobId: v.id('jobs'),
    freezeReceiptId: v.id('freezeReceipts'),
    hiddenTargetDigest: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
    ),
    reportArtifactId: v.optional(v.id('artifacts')),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_job', ['jobId']),

  runtimeSources: defineTable({
    layer: runtimeLayer,
    sourceSha: v.string(),
    deployment: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_layer', ['layer']),

  creatorBenchReviews: defineTable({
    benchmarkVersion: v.string(),
    instanceId: v.string(),
    resultId: v.string(),
    split: v.union(v.literal('development'), v.literal('public-test'), v.literal('adversarial')),
    reviewerRef: v.string(),
    assignmentId: v.string(),
    variantId: v.optional(v.string()),
    blind: v.boolean(),
    status: v.union(v.literal('assigned'), v.literal('completed')),
    usability: v.optional(
      v.union(
        v.literal('usable_as_is'),
        v.literal('usable_after_minor_correction'),
        v.literal('requires_major_correction'),
        v.literal('unusable'),
        v.literal('unsafe_or_rights_invalid'),
      ),
    ),
    correctionTimeSeconds: v.optional(v.number()),
    reasonCodes: v.array(v.string()),
    correctnessIssues: v.array(v.string()),
    missedSubjectOrContent: v.array(v.string()),
    unwantedEdits: v.array(v.string()),
    preferredVariantId: v.optional(v.string()),
    blindedVariantOrderJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_instance', ['benchmarkVersion', 'instanceId'])
    .index('by_reviewer_status', ['reviewerRef', 'status'])
    .index('by_assignment', ['assignmentId']),
});
