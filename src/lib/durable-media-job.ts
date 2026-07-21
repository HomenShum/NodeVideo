export const MEDIA_JOB_SCHEMA = 'nodevideo.media-job.v1' as const;

export type MediaJobStatus =
  | 'queued'
  | 'running'
  | 'awaiting-review'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type MediaJob = {
  schemaVersion: typeof MEDIA_JOB_SCHEMA;
  id: string;
  executorId: string;
  capability: string;
  status: MediaJobStatus;
  attempt: number;
  maximumAttempts: number;
  createdAt: string;
  updatedAt: string;
  lease?: { owner: string; expiresAt: string };
  providerJobId?: string;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  checkpoint?: Record<string, unknown>;
  error?: { code: string; message: string; retryable: boolean };
};

const transitions: Record<MediaJobStatus, MediaJobStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['queued', 'awaiting-review', 'succeeded', 'failed', 'cancelled'],
  'awaiting-review': ['running', 'succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: ['queued'],
  cancelled: [],
};

export function transitionMediaJob(job: MediaJob, status: MediaJobStatus, at: string): MediaJob {
  if (!transitions[job.status].includes(status)) {
    throw new Error(`Invalid media job transition: ${job.status} -> ${status}`);
  }
  if (status === 'queued' && job.attempt >= job.maximumAttempts) {
    throw new Error('Media job attempt ceiling reached');
  }
  return {
    ...job,
    status,
    updatedAt: at,
    attempt: status === 'running' ? job.attempt + 1 : job.attempt,
    lease: status === 'running' ? job.lease : undefined,
  };
}

export function claimMediaJob(job: MediaJob, owner: string, now: Date, leaseMs: number): MediaJob {
  if (job.status !== 'queued') throw new Error('Only queued jobs can be claimed');
  if (job.attempt >= job.maximumAttempts) throw new Error('Media job attempt ceiling reached');
  return transitionMediaJob(
    { ...job, lease: { owner, expiresAt: new Date(now.getTime() + leaseMs).toISOString() } },
    'running',
    now.toISOString(),
  );
}
