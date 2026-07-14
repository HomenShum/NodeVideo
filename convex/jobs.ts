import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import {
  assertActiveLease,
  assertBoundedString,
  assertIdempotentInput,
  assertLeaseDuration,
  assertSha256Digest,
  claimLeaseTransition,
} from './lib/durability';
import { appendJobEvent, requireJob } from './lib/persistence';
import { workerEventKind } from './validators';

export const create = internalMutation({
  args: {
    projectId: v.string(),
    idempotencyKey: v.string(),
    inputDigest: v.string(),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const projectId = assertBoundedString(args.projectId, 128, 'project_id');
    const idempotencyKey = assertBoundedString(args.idempotencyKey, 256, 'idempotency_key');
    const inputDigest = assertSha256Digest(args.inputDigest);
    const maxAttempts = args.maxAttempts ?? 3;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
      throw new Error('invalid_max_attempts');
    }

    const existing = await ctx.db
      .query('jobs')
      .withIndex('by_project_idempotency', (query) =>
        query.eq('projectId', projectId).eq('idempotencyKey', idempotencyKey),
      )
      .unique();
    if (existing !== null) {
      assertIdempotentInput(existing.inputDigest, inputDigest);
      return { jobId: existing._id, reused: true };
    }

    const now = Date.now();
    const jobId = await ctx.db.insert('jobs', {
      projectId,
      idempotencyKey,
      inputDigest,
      status: 'queued',
      attempt: 0,
      maxAttempts,
      leaseToken: 0,
      nextEventSequence: 1,
      createdAt: now,
      updatedAt: now,
    });
    await appendJobEvent(ctx, jobId, 'job.created', { inputDigest }, now);
    return { jobId, reused: false };
  },
});

export const claim = internalMutation({
  args: { jobId: v.id('jobs'), leaseId: v.string(), leaseMs: v.number() },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    const now = Date.now();
    const result = claimLeaseTransition(job, args, now);

    if (!result.claimed) {
      if (result.reason === 'attempts_exhausted') {
        await ctx.db.patch(job._id, {
          status: 'failed',
          error: 'max_attempts_exhausted',
          leaseId: undefined,
          leaseUntil: undefined,
          updatedAt: now,
        });
        await appendJobEvent(ctx, job._id, 'job.failed', { error: 'max_attempts_exhausted' }, now);
      }
      return { claimed: false as const, reason: result.reason };
    }

    await ctx.db.patch(job._id, {
      status: result.state.status,
      attempt: result.state.attempt,
      leaseId: result.state.leaseId,
      leaseToken: result.state.leaseToken,
      leaseUntil: result.state.leaseUntil,
      error: undefined,
      updatedAt: now,
    });
    await appendJobEvent(
      ctx,
      job._id,
      'lease.claimed',
      {
        attempt: result.state.attempt,
        leaseToken: result.state.leaseToken,
        leaseUntil: result.state.leaseUntil,
      },
      now,
    );
    return {
      claimed: true as const,
      leaseToken: result.state.leaseToken,
      leaseUntil: result.state.leaseUntil,
    };
  },
});

export const heartbeat = internalMutation({
  args: {
    jobId: v.id('jobs'),
    leaseId: v.string(),
    leaseToken: v.number(),
    leaseMs: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    const now = Date.now();
    assertActiveLease(job, args.leaseId, args.leaseToken, now);
    const leaseUntil = now + assertLeaseDuration(args.leaseMs);
    await ctx.db.patch(job._id, { leaseUntil, updatedAt: now });
    await appendJobEvent(ctx, job._id, 'lease.heartbeat', { leaseUntil }, now);
    return { leaseUntil };
  },
});

export const appendWorkerEvent = internalMutation({
  args: {
    jobId: v.id('jobs'),
    leaseId: v.string(),
    leaseToken: v.number(),
    kind: workerEventKind,
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    const now = Date.now();
    assertActiveLease(job, args.leaseId, args.leaseToken, now);
    return appendJobEvent(ctx, job._id, args.kind, args.payload, now);
  },
});

export const complete = internalMutation({
  args: { jobId: v.id('jobs'), leaseId: v.string(), leaseToken: v.number() },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    const now = Date.now();
    assertActiveLease(job, args.leaseId, args.leaseToken, now);
    await ctx.db.patch(job._id, {
      status: 'completed',
      leaseId: undefined,
      leaseUntil: undefined,
      completedAt: now,
      updatedAt: now,
    });
    await appendJobEvent(ctx, job._id, 'job.completed', undefined, now);
    return { completed: true as const };
  },
});

export const fail = internalMutation({
  args: {
    jobId: v.id('jobs'),
    leaseId: v.string(),
    leaseToken: v.number(),
    error: v.string(),
    retryable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    const now = Date.now();
    assertActiveLease(job, args.leaseId, args.leaseToken, now);
    const error = assertBoundedString(args.error, 2_000, 'job_error');
    const willRetry = args.retryable && job.attempt < job.maxAttempts;
    await ctx.db.patch(job._id, {
      status: willRetry ? 'queued' : 'failed',
      error,
      leaseId: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    await appendJobEvent(
      ctx,
      job._id,
      willRetry ? 'job.retry_scheduled' : 'job.failed',
      { error, retryable: args.retryable },
      now,
    );
    return { willRetry };
  },
});

export const cancel = internalMutation({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args) => {
    const job = await requireJob(ctx, args.jobId);
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return { cancelled: job.status === 'cancelled', reused: true };
    }
    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: 'cancelled',
      leaseId: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    await appendJobEvent(ctx, job._id, 'job.cancelled', undefined, now);
    return { cancelled: true, reused: false };
  },
});

export const get = internalQuery({
  args: { jobId: v.id('jobs') },
  handler: (ctx, args) => ctx.db.get(args.jobId),
});
