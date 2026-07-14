import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { JobEventKind } from '../validators';
import { boundedCanonicalJson, consumeEventSequence } from './durability';

const EVENT_PAYLOAD_MAX_BYTES = 16 * 1024;

export async function requireJob(ctx: MutationCtx, jobId: Id<'jobs'>) {
  const job = await ctx.db.get(jobId);
  if (job === null) throw new Error('job_not_found');
  return job;
}

export async function appendJobEvent(
  ctx: MutationCtx,
  jobId: Id<'jobs'>,
  kind: JobEventKind,
  payload: unknown,
  now: number,
) {
  const job = await requireJob(ctx, jobId);
  const { sequence, nextState } = consumeEventSequence(job);
  const payloadJson =
    payload === undefined
      ? undefined
      : boundedCanonicalJson(payload, EVENT_PAYLOAD_MAX_BYTES, 'event_payload');
  const eventId = await ctx.db.insert('jobEvents', {
    jobId,
    sequence,
    kind,
    payloadJson,
    createdAt: now,
  });
  await ctx.db.patch(jobId, {
    nextEventSequence: nextState.nextEventSequence,
    updatedAt: now,
  });
  return { eventId, sequence };
}
