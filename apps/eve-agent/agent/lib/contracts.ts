import { z } from 'zod';

export const SHA256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const OpaqueId = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const AssetBinding = z.object({
  assetId: OpaqueId,
  sha256: SHA256,
});

export const SongBinding = AssetBinding.extend({
  excerptStartMs: z.number().int().nonnegative(),
  excerptEndMs: z.number().int().positive(),
  rightsAttestationId: OpaqueId,
});

export const GenerationInput = z
  .object({
    schemaVersion: z.literal('nodevideo.source-only-job-request/v1'),
    projectId: OpaqueId,
    traceId: OpaqueId,
    choreographyReference: AssetBinding,
    song: SongBinding,
    takes: z.array(AssetBinding).min(2).max(32),
    protectedLyrics: AssetBinding.optional(),
    objective: z.string().trim().min(1).max(1200),
  })
  .superRefine((value, context) => {
    if (value.song.excerptEndMs <= value.song.excerptStartMs) {
      context.addIssue({
        code: 'custom',
        path: ['song', 'excerptEndMs'],
        message: 'Song excerpt must have positive duration.',
      });
    }
    const bindings = [
      value.choreographyReference,
      value.song,
      ...value.takes,
      ...(value.protectedLyrics ? [value.protectedLyrics] : []),
    ];
    if (new Set(bindings.map((item) => item.assetId)).size !== bindings.length) {
      context.addIssue({
        code: 'custom',
        path: ['takes'],
        message: 'Every admitted asset must have a unique role-bound ID.',
      });
    }
    if (new Set(bindings.map((item) => item.sha256)).size !== bindings.length) {
      context.addIssue({
        code: 'custom',
        path: ['takes'],
        message: 'Every admitted asset hash must bind exactly one role.',
      });
    }
  });

export const PreparedGeneration = z.object({
  schemaVersion: z.literal('nodevideo.source-only-job/v1'),
  proposalId: OpaqueId,
  proposalDigest: SHA256,
  idempotencyKey: OpaqueId,
  generationInput: GenerationInput,
  isolation: z.object({
    targetAccess: z.literal('denied'),
    evaluatorCredentialPresent: z.literal(false),
    networkAccess: z.literal(false),
  }),
});

export const JobReceipt = z.object({
  schemaVersion: z.string().min(1).max(120),
  jobId: OpaqueId,
  traceId: OpaqueId,
  status: z.enum(['queued', 'running', 'waiting_for_approval', 'succeeded', 'failed', 'cancelled']),
  proposalDigest: SHA256.optional(),
  freezeId: OpaqueId.optional(),
  freezeDigest: SHA256.optional(),
  artifactIds: z.array(OpaqueId).max(256).default([]),
});

export const EvaluationReceipt = z.object({
  schemaVersion: z.string().min(1).max(120),
  evaluationId: OpaqueId,
  freezeId: OpaqueId,
  freezeDigest: SHA256,
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
});

export const CaseReceipt = z.object({
  caseId: OpaqueId,
  reused: z.boolean(),
});

export const StartJobReceipt = z.object({
  jobId: OpaqueId,
  reused: z.boolean(),
});

export const StageName = z.enum([
  'validate_inputs',
  'ingest_reference',
  'normalize_media',
  'align_reference_song',
  'extract_reference_motion',
  'analyze_takes',
  'match_phrases',
  'plan_sequence',
  'place_lyrics',
  'compile_plan',
  'render_preview',
  'validate_preview',
  'await_review',
  'freeze',
  'evaluate_hidden_target',
]);

export const JobSnapshot = z.object({
  job: z
    .object({
      _id: OpaqueId,
      status: z.enum(['queued', 'running', 'awaiting_review', 'completed', 'failed', 'cancelled']),
      currentStage: StageName.optional(),
      frozenPlanDigest: SHA256.optional(),
      error: z.string().optional(),
    })
    .passthrough(),
  stages: z.array(
    z
      .object({
        _id: OpaqueId,
        ordinal: z.number().int().nonnegative(),
        name: StageName,
        status: z.enum([
          'pending',
          'running',
          'awaiting_approval',
          'completed',
          'failed',
          'cancelled',
        ]),
        attempt: z.number().int().nonnegative(),
        maxAttempts: z.number().int().positive(),
        error: z.string().optional(),
        outputArtifactIds: z.array(OpaqueId),
      })
      .passthrough(),
  ),
  events: z.array(
    z.object({ sequence: z.number().int().positive(), kind: z.string() }).passthrough(),
  ),
  artifacts: z.array(
    z
      .object({ _id: OpaqueId, artifactKey: z.string(), kind: z.string(), sha256: SHA256 })
      .passthrough(),
  ),
});

export const ApprovalReceipt = z.object({ approved: z.boolean(), reused: z.boolean() });
export const FreezeReceipt = z.object({ freezeReceiptId: OpaqueId, reused: z.boolean() });
export const UnsealReceipt = z.object({ evaluationReceiptId: OpaqueId, reused: z.boolean() });
export const CancellationReceipt = z.object({ cancelled: z.boolean(), reused: z.boolean() });
export const RetryReceipt = z.object({ retried: z.boolean() });

export type PreparedGeneration = z.infer<typeof PreparedGeneration>;
