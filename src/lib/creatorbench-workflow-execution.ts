import {
  type CreatorBenchInstance,
  validateCreatorBenchInstance,
} from './creatorbench-contracts.ts';
import { evaluateWorkflowMetrics } from './creatorbench-evaluators.ts';
import { compileFounderVariants } from './founder-variant-compiler.ts';
import {
  EDIT_INTENT_SCHEMA,
  type EditIntent,
  type MediaIndex,
} from './media-orchestration-contracts.ts';

type Range = { startMs: number; endMs: number };

function overlapMs(left: Range, right: Range) {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

export function executeTalkingHeadCleanupPlan(input: {
  instance: CreatorBenchInstance;
  mediaIndex: MediaIndex;
}) {
  validateCreatorBenchInstance(input.instance);
  if (input.instance.workflow !== 'talking-head-cleanup') {
    throw new Error('Talking-head executor received a different workflow.');
  }
  if (input.mediaIndex.assetId !== input.instance.sourceIds[0]) {
    throw new Error('MediaIndex is not bound to the benchmark source.');
  }
  const intent: EditIntent = {
    schemaVersion: EDIT_INTENT_SCHEMA,
    id: `intent:${input.instance.id}`,
    goal: input.instance.request.intent.instruction,
    instructions: input.instance.request.intent.instruction,
    sourceAssetIds: [input.mediaIndex.assetId],
    outputs: [
      {
        id: 'clean-master',
        purpose: 'clean-master',
        aspectRatio: 'source',
        platform: 'generic',
      },
    ],
    constraints: {
      preserveMeaning: true,
      requireHumanApproval: true,
      allowMediaEgress: !input.instance.request.constraints.localOnly,
      allowGenerativeMedia: false,
      maximumCostUsd: input.instance.request.constraints.maxCostUsd,
      preferredRuntime: 'local',
    },
  };
  const compiled = compileFounderVariants(input.mediaIndex, intent);
  const variant = compiled.variants[0];
  const operations = variant.semanticPlan.operations.filter(
    (operation) => operation.kind === 'remove',
  );
  const automaticCutRanges = operations
    .filter((operation) => /pause policy/u.test(operation.reason))
    .map((operation) => ({ startMs: operation.sourceStartMs, endMs: operation.sourceEndMs }));
  const fillerReviewRanges = operations
    .filter((operation) => /Detected filler/u.test(operation.reason))
    .map((operation) => ({ startMs: operation.sourceStartMs, endMs: operation.sourceEndMs }));
  const silenceReviewRanges = operations
    .filter((operation) => /overlaps transcript timing/u.test(operation.reason))
    .map((operation) => ({ startMs: operation.sourceStartMs, endMs: operation.sourceEndMs }));
  const words = input.mediaIndex.speech?.words ?? [];
  const speechDurationMs = words.reduce((sum, word) => sum + (word.endMs - word.startMs), 0);
  const removedSpeechMs = words.reduce(
    (sum, word) =>
      sum + automaticCutRanges.reduce((cutSum, cut) => cutSum + overlapMs(word, cut), 0),
    0,
  );
  const wordTruncations = words.filter((word) =>
    automaticCutRanges.some(
      (cut) =>
        (cut.startMs > word.startMs && cut.startMs < word.endMs) ||
        (cut.endMs > word.startMs && cut.endMs < word.endMs),
    ),
  ).length;
  const metrics = {
    speechRetention:
      speechDurationMs > 0 ? Math.max(0, 1 - removedSpeechMs / speechDurationMs) : null,
    wordTruncations,
    intentionalPauseFalsePositives: null,
    audioClicks: null,
    audioVideoSyncMs: 0,
    exportReopens: null,
  };
  return {
    schemaVersion: 'nodevideo.creatorbench-workflow-execution/v1' as const,
    workflow: 'talking-head-cleanup' as const,
    instanceId: input.instance.id,
    sourceId: input.instance.sourceIds[0],
    intent,
    variantSet: compiled.variantSet,
    semanticPlan: variant.semanticPlan,
    rendererPlan: variant.rendererPlan,
    automaticCutRanges,
    fillerReviewRanges,
    silenceReviewRanges,
    metrics,
    evaluation: evaluateWorkflowMetrics({ workflow: 'talking-head-cleanup', metrics }),
    route: {
      stages: [
        'executor.ffmpeg-silencedetect',
        'executor.nasa-official-srt',
        'executor.ffmpeg-edit-plan',
      ],
      mediaEgress: false,
      estimatedCostUsd: 0,
      approvalState:
        fillerReviewRanges.length + silenceReviewRanges.length > 0
          ? 'pending-speech-edit-review'
          : 'render-review',
    },
  };
}
