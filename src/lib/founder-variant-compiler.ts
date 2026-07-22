import type { EditPlan } from './edit-contracts.ts';
import { EDIT_PLAN_SCHEMA_VERSION } from './edit-contracts.ts';
import { EDIT_PLAN_V2_SCHEMA, type EditPlanV2, validateEditPlanV2 } from './edit-plan-v2.ts';
import { proposeTalkingHeadCleanup, rankGoldenQuotes } from './founder-content.ts';
import {
  type EditIntent,
  type MediaIndex,
  type OutputIntent,
  type VariantSet,
  validateEditIntent,
  validateMediaIndex,
} from './media-orchestration-contracts.ts';
import { createVariantSet } from './recipe-compiler.ts';
import { type ReframePlan, compileReframeIntoEditPlan } from './smart-reframe.ts';

export type FounderVariant = {
  id: string;
  title: string;
  output: OutputIntent;
  rendererPlan: EditPlan;
  semanticPlan: EditPlanV2;
  rationale: string[];
};

const frame = (milliseconds: number, frameRate: number) =>
  Math.round((milliseconds / 1_000) * frameRate);

function retainedRanges(durationMs: number, removals: Array<{ startMs: number; endMs: number }>) {
  const ranges: Array<{ startMs: number; endMs: number }> = [];
  let cursor = 0;
  for (const removal of [...removals].sort((a, b) => a.startMs - b.startMs)) {
    if (removal.startMs > cursor) ranges.push({ startMs: cursor, endMs: removal.startMs });
    cursor = Math.max(cursor, removal.endMs);
  }
  if (cursor < durationMs) ranges.push({ startMs: cursor, endMs: durationMs });
  return ranges.filter((range) => range.endMs - range.startMs >= 150);
}

function rendererPlan(input: {
  mediaIndex: MediaIndex;
  output: OutputIntent;
  ranges: Array<{ startMs: number; endMs: number }>;
  headline?: string;
}): EditPlan {
  const fps = Math.min(60, Math.max(24, Math.round(input.mediaIndex.technical.frameRate || 30)));
  const source = input.mediaIndex.technical;
  const vertical = input.output.aspectRatio === '9:16';
  const square = input.output.aspectRatio === '1:1';
  const canvas = vertical
    ? { width: 720, height: 1280 }
    : square
      ? { width: 1080, height: 1080 }
      : { width: 1280, height: 720 };
  let cursor = 0;
  const clips = input.ranges.map((range, index) => {
    const duration = Math.max(1, frame(range.endMs - range.startMs, fps));
    const clip = {
      id: `clip:${input.output.id}:${index}`,
      kind: 'source' as const,
      assetId: input.mediaIndex.assetId,
      timelineRange: { startFrame: cursor, endFrameExclusive: cursor + duration },
      sourceRange: {
        startFrame: frame(range.startMs, fps),
        endFrameExclusive: frame(range.startMs, fps) + duration,
      },
      playbackRate: 1,
      fit: 'fill' as const,
      cropKeyframes: [],
      grade: { kind: 'none' as const },
    };
    cursor += duration;
    return clip;
  });
  const overlayDuration = Math.min(cursor, fps * 4);
  return {
    schemaVersion: EDIT_PLAN_SCHEMA_VERSION,
    id: `render:${input.mediaIndex.id}:${input.output.id}`,
    understandingId: input.mediaIndex.id,
    version: 1,
    createdAt: input.mediaIndex.provenance.generatedAt,
    frameRate: fps,
    canvas,
    durationFrames: cursor,
    lineage: {
      renderAssetIds: [input.mediaIndex.assetId],
      evaluationOnlyAssetIds: [],
      targetDerivedRenderAssetIds: [],
    },
    audio: {
      routing: [
        {
          id: 'route.creator-source-program',
          sourceKind: 'asset-audio',
          sourceId: input.mediaIndex.assetId,
          bus: 'program',
          muted: false,
          gainDb: 0,
        },
      ],
      events: [],
    },
    tracks: [
      { id: 'track.primary', kind: 'video', role: 'primary', clips },
      {
        id: 'track.overlay',
        kind: 'overlay',
        clips:
          input.headline && overlayDuration > 0
            ? [
                {
                  id: `overlay:${input.output.id}:headline`,
                  kind: 'text',
                  text: input.headline.slice(0, 140),
                  templateId: 'text.creator-title',
                  animation: 'slide-up',
                  timelineRange: { startFrame: 0, endFrameExclusive: overlayDuration },
                  box: { x: 0.08, y: vertical ? 0.12 : 0.1, width: 0.84, height: 0.14 },
                },
              ]
            : [],
      },
    ],
  };
}

export function compileFounderVariants(
  mediaIndex: MediaIndex,
  intent: EditIntent,
  reframePlans: ReframePlan[] = [],
): { variants: FounderVariant[]; variantSet: VariantSet } {
  validateMediaIndex(mediaIndex);
  validateEditIntent(intent);
  const cleanup = proposeTalkingHeadCleanup(mediaIndex, {
    pausePolicy: 'natural',
    removeFillers: true,
  });
  const approvedRemovals = cleanup.filter((candidate) => candidate.approval === 'automatic');
  const cleanRanges = retainedRanges(mediaIndex.technical.durationMs, approvedRemovals);
  const quote = rankGoldenQuotes(mediaIndex)[0];
  const variants = intent.outputs.map<FounderVariant>((output) => {
    const reframePlan = reframePlans.find(
      (candidate) => candidate.intent.aspectRatio === output.aspectRatio,
    );
    const desiredMs = (output.durationSeconds ?? mediaIndex.technical.durationMs / 1_000) * 1_000;
    const range =
      quote && output.purpose !== 'clean-master' && !output.id.startsWith('reframe-')
        ? [{ startMs: quote.startMs, endMs: Math.min(quote.endMs, quote.startMs + desiredMs) }]
        : cleanRanges;
    const operations: EditPlanV2['operations'] = [
      ...range.map((item, index) => ({
        id: `retain:${output.id}:${index}`,
        kind: 'retain' as const,
        assetId: mediaIndex.assetId,
        sourceStartMs: item.startMs,
        sourceEndMs: item.endMs,
      })),
      ...cleanup.map((item) => ({
        id: `${item.id}:${output.id}`,
        kind: 'remove' as const,
        assetId: mediaIndex.assetId,
        sourceStartMs: item.startMs,
        sourceEndMs: item.endMs,
        reason: item.reason,
      })),
      ...(output.aspectRatio === 'source'
        ? []
        : [
            {
              id: `reframe:${output.id}`,
              kind: 'reframe' as const,
              startMs: 0,
              endMs: Math.max(1, desiredMs),
              aspectRatio: output.aspectRatio,
            },
          ]),
    ];
    const semanticPlan = validateEditPlanV2({
      schemaVersion: EDIT_PLAN_V2_SCHEMA,
      id: `plan:${intent.id}:${output.id}`,
      version: 1,
      createdAt: mediaIndex.provenance.generatedAt,
      mediaIndexIds: [mediaIndex.id],
      intentId: intent.id,
      outputIntentId: output.id,
      templateId: output.templateId,
      operations,
      approvals: cleanup
        .filter((item) => item.approval === 'required')
        .map((item) => ({
          id: `approval:${item.id}:${output.id}`,
          operationIds: [`${item.id}:${output.id}`],
          status: 'required' as const,
          reason: 'Filler removal can change meaning or cadence.',
        })),
      lineage: {
        sourceAssetIds: [mediaIndex.assetId],
        recipeId: 'recipe.founder-content',
        compiledRecipeId: `compiled:recipe.founder-content:${intent.id}`,
        executorIds: ['executor.browser-ffmpeg', 'executor.local-heuristic-index'],
      },
    });
    const headline = quote?.text ?? intent.goal;
    return {
      id: `variant:${intent.id}:${output.id}`,
      title: output.id.replaceAll('-', ' '),
      output,
      rendererPlan: reframePlan
        ? compileReframeIntoEditPlan(
            rendererPlan({ mediaIndex, output, ranges: range, headline }),
            reframePlan,
          )
        : rendererPlan({ mediaIndex, output, ranges: range, headline }),
      semanticPlan,
      rationale: [
        `${cleanup.length} cleanup candidates; ${approvedRemovals.length} deterministic silence cuts applied`,
        quote
          ? `Golden quote ${quote.id} selected from source evidence`
          : 'No quote claimed; goal text used as creator-supplied title',
        output.templateId
          ? `Structural template ${output.templateId}; no brand assets copied`
          : 'No reference template applied',
        ...(reframePlan
          ? [
              `Subject ${reframePlan.sourceTrackId} stays identity-locked across ${reframePlan.cropKeyframes.length} crop keyframes`,
              `${reframePlan.trackingLossRanges.length} low-confidence ranges hold the previous crop`,
              `${reframePlan.manualOverrides.length} manual crop overrides take precedence`,
            ]
          : []),
      ],
    };
  });
  const variantSet = createVariantSet(intent, [mediaIndex.id]);
  for (const item of variantSet.variants) {
    item.status = 'awaiting-review';
    item.editPlanId = variants.find(
      (variant) => variant.output.id === item.outputIntentId,
    )?.semanticPlan.id;
  }
  return { variants, variantSet };
}
