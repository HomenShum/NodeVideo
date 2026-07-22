import { describe, expect, it } from 'vitest';
import {
  MEDIA_JOB_SCHEMA,
  type MediaJob,
  claimMediaJob,
  transitionMediaJob,
} from './durable-media-job';

function job(): MediaJob {
  return {
    schemaVersion: MEDIA_JOB_SCHEMA,
    id: 'job:1',
    executorId: 'executor:replay',
    capability: 'video.generate',
    status: 'queued',
    attempt: 0,
    maximumAttempts: 2,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    inputArtifactIds: [],
    outputArtifactIds: [],
  };
}

describe('durable media jobs', () => {
  it('claims a queued job with a bounded lease', () => {
    const claimed = claimMediaJob(job(), 'worker:1', new Date('2026-07-21T00:00:00.000Z'), 30_000);
    expect(claimed.status).toBe('running');
    expect(claimed.attempt).toBe(1);
    expect(claimed.lease?.expiresAt).toBe('2026-07-21T00:00:30.000Z');
  });

  it('rejects terminal state mutation', () => {
    expect(() =>
      transitionMediaJob({ ...job(), status: 'succeeded' }, 'running', new Date().toISOString()),
    ).toThrow(/Invalid/u);
  });
});
