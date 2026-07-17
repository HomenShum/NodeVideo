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
});
