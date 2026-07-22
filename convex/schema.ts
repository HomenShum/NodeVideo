import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  caseflowCaseStatus,
  caseflowDecision,
  caseflowExceptionStatus,
  caseflowProposalStatus,
  caseflowRunStatus,
  caseflowStage,
} from './caseflowValidators';
import {
  jobEventKind,
  jobStatus,
  proposalStatus,
  runtimeLayer,
  stageName,
  stageStatus,
} from './validators';

export default defineSchema({
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

  // Application-owned authorization and domain binding records. These stay
  // outside the portable Caseflow lifecycle boundary.
  nodeVideoProjects: defineTable({
    ownerIdentity: v.string(),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_owner_updatedAt', ['ownerIdentity', 'updatedAt']),

  nodeVideoCaseflowBindings: defineTable({
    projectId: v.id('nodeVideoProjects'),
    idempotencyKey: v.string(),
    requestHash: v.string(),
    caseflowCaseId: v.id('caseflowCases'),
    caseflowRunId: v.id('caseflowRuns'),
    sourceOnlyCaseId: v.id('sourceOnlyCases'),
    jobId: v.id('jobs'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_project_idempotency', ['projectId', 'idempotencyKey'])
    .index('by_project_case', ['projectId', 'caseflowCaseId'])
    .index('by_caseflow_case', ['caseflowCaseId'])
    .index('by_job', ['jobId']),

  // Portable Caseflow lifecycle state. This is the candidate component-owned
  // boundary; it intentionally contains no auth subject, project membership,
  // media, provider credential, or hidden evaluator payload.
  caseflowCases: defineTable({
    title: v.string(),
    primaryJob: v.string(),
    status: caseflowCaseStatus,
    currentRunId: v.optional(v.id('caseflowRuns')),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  caseflowRuns: defineTable({
    caseId: v.id('caseflowCases'),
    status: caseflowRunStatus,
    currentStageId: v.string(),
    nextAction: v.string(),
    nextActionOwner: v.string(),
    stages: v.array(caseflowStage),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_case_updatedAt', ['caseId', 'updatedAt']),

  caseflowArtifacts: defineTable({
    caseId: v.id('caseflowCases'),
    runId: v.id('caseflowRuns'),
    kind: v.string(),
    title: v.string(),
    canonicalVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_case', ['caseId'])
    .index('by_run', ['runId']),

  caseflowArtifactVersions: defineTable({
    artifactId: v.id('caseflowArtifacts'),
    version: v.number(),
    contentJson: v.string(),
    contentHash: v.string(),
    proposalId: v.optional(v.id('caseflowProposals')),
    createdAt: v.number(),
  }).index('by_artifact_version', ['artifactId', 'version']),

  caseflowProposals: defineTable({
    artifactId: v.id('caseflowArtifacts'),
    baseVersion: v.number(),
    patchJson: v.string(),
    rationale: v.string(),
    status: caseflowProposalStatus,
    approvalId: v.optional(v.id('caseflowApprovals')),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
  }).index('by_artifact_createdAt', ['artifactId', 'createdAt']),

  caseflowApprovals: defineTable({
    proposalId: v.id('caseflowProposals'),
    comment: v.string(),
    decision: caseflowDecision,
    decidedAt: v.number(),
  }).index('by_proposal', ['proposalId']),

  caseflowExceptions: defineTable({
    runId: v.id('caseflowRuns'),
    code: v.string(),
    message: v.string(),
    preservedStateJson: v.string(),
    status: caseflowExceptionStatus,
    resolution: v.optional(v.string()),
    raisedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index('by_run_status', ['runId', 'status']),

  caseflowReceipts: defineTable({
    runId: v.id('caseflowRuns'),
    artifactIds: v.array(v.id('caseflowArtifacts')),
    eventIds: v.array(v.id('caseflowEvents')),
    proposalIds: v.array(v.id('caseflowProposals')),
    generatedAt: v.number(),
    status: v.literal('completed'),
    receiptHash: v.string(),
  }).index('by_run', ['runId']),

  caseflowEvents: defineTable({
    aggregateType: v.string(),
    aggregateId: v.string(),
    sequence: v.number(),
    eventType: v.string(),
    actorJson: v.string(),
    payloadJson: v.string(),
    occurredAt: v.number(),
  }).index('by_aggregate_sequence', ['aggregateId', 'sequence']),

  caseflowExternalRefs: defineTable({
    caseId: v.id('caseflowCases'),
    runId: v.optional(v.id('caseflowRuns')),
    namespace: v.string(),
    kind: v.string(),
    externalId: v.string(),
    createdAt: v.number(),
  })
    .index('by_case', ['caseId'])
    .index('by_namespace_external', ['namespace', 'externalId']),
});
