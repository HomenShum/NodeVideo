import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { jobEventKind, jobStatus, proposalStatus, runtimeLayer } from './validators';

export default defineSchema({
  jobs: defineTable({
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
  })
    .index('by_project_idempotency', ['projectId', 'idempotencyKey'])
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

  runtimeSources: defineTable({
    layer: runtimeLayer,
    sourceSha: v.string(),
    deployment: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_layer', ['layer']),
});
