import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import {
  assertActiveLease,
  assertBoundedString,
  assertSha256Digest,
  boundedCanonicalJson,
} from './lib/durability';
import { appendJobEvent, requireJob } from './lib/persistence';

const METADATA_MAX_BYTES = 32 * 1024;

export const record = internalMutation({
  args: {
    jobId: v.id('jobs'),
    leaseId: v.string(),
    leaseToken: v.number(),
    artifactKey: v.string(),
    kind: v.string(),
    storageRef: v.string(),
    sha256: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    toolName: v.string(),
    toolVersion: v.string(),
    inputDigests: v.array(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    const now = Date.now();
    assertActiveLease(job, args.leaseId, args.leaseToken, now);

    const artifactKey = assertBoundedString(args.artifactKey, 256, 'artifact_key');
    const kind = assertBoundedString(args.kind, 128, 'artifact_kind');
    const storageRef = assertBoundedString(args.storageRef, 2_048, 'storage_ref');
    if (/^https?:\/\//i.test(storageRef)) throw new Error('storage_ref_must_not_be_a_url');
    const sha256 = assertSha256Digest(args.sha256);
    const mimeType = assertBoundedString(args.mimeType, 128, 'mime_type');
    const toolName = assertBoundedString(args.toolName, 128, 'tool_name');
    const toolVersion = assertBoundedString(args.toolVersion, 128, 'tool_version');
    if (!Number.isSafeInteger(args.sizeBytes) || args.sizeBytes < 0) {
      throw new Error('invalid_artifact_size');
    }
    if (args.inputDigests.length > 64) throw new Error('too_many_input_digests');
    const inputDigests = args.inputDigests.map(assertSha256Digest);
    const metadataJson =
      args.metadata === undefined
        ? undefined
        : boundedCanonicalJson(args.metadata, METADATA_MAX_BYTES, 'artifact_metadata');

    const existing = await ctx.db
      .query('artifacts')
      .withIndex('by_job_artifactKey', (query) =>
        query.eq('jobId', job._id).eq('artifactKey', artifactKey),
      )
      .unique();
    if (existing !== null) {
      if (existing.sha256 !== sha256) throw new Error('artifact_key_digest_conflict');
      return { artifactId: existing._id, reused: true };
    }

    const artifactId = await ctx.db.insert('artifacts', {
      projectId: job.projectId,
      jobId: job._id,
      artifactKey,
      kind,
      storageRef,
      sha256,
      mimeType,
      sizeBytes: args.sizeBytes,
      toolName,
      toolVersion,
      inputDigests,
      metadataJson,
      createdAt: now,
    });
    await appendJobEvent(
      ctx,
      job._id,
      'artifact.recorded',
      { artifactId, artifactKey, kind, sha256 },
      now,
    );
    return { artifactId, reused: false };
  },
});
