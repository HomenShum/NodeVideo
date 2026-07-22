import { compileFounderVariants } from '@/lib/founder-variant-compiler';
import {
  EDIT_INTENT_SCHEMA,
  EXECUTOR_SCHEMA,
  type EditIntent,
  type ExecutorDefinition,
  MEDIA_INDEX_SCHEMA,
  type MediaIndex,
  type OutputIntent,
  TEMPLATE_SPEC_SCHEMA,
  type TemplateSpec,
} from '@/lib/media-orchestration-contracts';
import { EDIT_RECIPE_SCHEMA, type EditRecipe } from '@/lib/media-orchestration-contracts';
import { compileRecipe } from '@/lib/recipe-compiler';
import type { ReframePlan } from '@/lib/smart-reframe';

export const DEMO_SOURCE_URL = '/media/authorized-real-v1/source-a-web.mp4';

export const FOUNDER_TEMPLATE: TemplateSpec = {
  schemaVersion: TEMPLATE_SPEC_SCHEMA,
  id: 'template.founder-launch-demo',
  version: '1.0.0',
  title: 'Founder launch demo',
  provenance: {
    sourceRefs: ['creator-supplied references'],
    rights: 'structural-study',
    redistributionAllowed: false,
    derivedAt: '2026-07-21T00:00:00.000Z',
  },
  format: { aspectRatios: ['16:9', '9:16', '1:1'], durationRangeSeconds: [5, 180] },
  narrative: [
    { role: 'hook', targetDurationRatio: 0.2, required: true },
    { role: 'demo', targetDurationRatio: 0.6, required: true },
    { role: 'cta', targetDurationRatio: 0.2, required: true },
  ],
  visualGrammar: {
    shotLengthRangeMs: [1_200, 8_000],
    captionStyleId: 'text.creator-title',
    transitionTechniqueIds: ['transition.hard-cut', 'transition.crossfade'],
    framingRules: ['Keep the speaker visible', 'Prefer product evidence over decorative B-roll'],
  },
  audioGrammar: {
    pausePolicy: 'natural',
    musicPolicy: 'optional-rights-cleared',
    loudnessTargetLufs: -14,
  },
  brandPolicy: { structuralInspirationOnly: true, copyBrandAssets: false },
  evaluatorIds: ['eval.source-lineage', 'eval.story-completeness', 'eval.export-reopen'],
};

const RECIPE: EditRecipe = {
  schemaVersion: EDIT_RECIPE_SCHEMA,
  id: 'recipe.founder-content',
  version: '1.0.0',
  title: 'Analyze once, publish many',
  intentKinds: ['talking-head', 'quote-variants', 'founder-launch'],
  requiredMediaFeatures: ['technical', 'speech-or-transcript', 'semantic-quotes'],
  techniqueIds: [
    'cleanup.natural-pauses',
    'quote.rank',
    'reframe.aspect-ratio',
    'caption.source-grounded',
  ],
  stages: [
    {
      id: 'index',
      capability: 'media.index',
      dependsOn: [],
      inputArtifacts: ['source'],
      outputArtifacts: ['media-index'],
      validators: ['media-index.schema'],
      approval: 'automatic',
      fanOut: 'shared',
    },
    {
      id: 'story',
      capability: 'story.plan',
      dependsOn: ['index'],
      inputArtifacts: ['media-index'],
      outputArtifacts: ['story-graph'],
      validators: ['story.source-lineage'],
      approval: 'required',
      fanOut: 'shared',
    },
    {
      id: 'edit',
      capability: 'video.render',
      dependsOn: ['story'],
      inputArtifacts: ['story-graph'],
      outputArtifacts: ['preview'],
      validators: ['edit-plan.schema'],
      approval: 'required',
      fanOut: 'per-output',
    },
  ],
};

const EXECUTORS: ExecutorDefinition[] = [
  {
    schemaVersion: EXECUTOR_SCHEMA,
    id: 'executor.local-index',
    version: '1.0.0',
    capabilities: ['media.index', 'story.plan'],
    runtime: 'browser',
    cost: { tier: 'free', estimatedUsd: 0 },
    latency: 'interactive',
    deterministic: true,
    qualityTier: 'baseline',
    privacy: { sendsMediaOffDevice: false, sendsDerivedFrames: false },
    requirements: { gpu: false },
    license: { code: 'MIT', commercialUse: true },
    validatorIds: ['media-index.schema'],
    enabled: true,
  },
  {
    schemaVersion: EXECUTOR_SCHEMA,
    id: 'executor.browser-ffmpeg',
    version: '0.12.10',
    capabilities: ['video.render'],
    runtime: 'browser',
    cost: { tier: 'free', estimatedUsd: 0 },
    latency: 'short',
    deterministic: true,
    qualityTier: 'standard',
    privacy: { sendsMediaOffDevice: false, sendsDerivedFrames: false },
    requirements: { gpu: false },
    license: { code: 'LGPL-2.1-or-later', commercialUse: true },
    validatorIds: ['edit-plan.schema'],
    enabled: true,
  },
];

export type CreatorPreset = 'cleanup' | 'variants' | 'founder' | 'reframe';

export function outputsForPreset(preset: CreatorPreset): OutputIntent[] {
  if (preset === 'cleanup')
    return [
      { id: 'clean-master', purpose: 'clean-master', aspectRatio: 'source', platform: 'generic' },
    ];
  if (preset === 'variants')
    return [
      {
        id: 'golden-short',
        purpose: 'short',
        durationSeconds: 15,
        aspectRatio: '9:16',
        platform: 'tiktok',
      },
      {
        id: 'social-square',
        purpose: 'social',
        durationSeconds: 15,
        aspectRatio: '1:1',
        platform: 'linkedin',
      },
      { id: 'long-cut', purpose: 'long-form', aspectRatio: '16:9', platform: 'youtube' },
    ];
  if (preset === 'reframe')
    return [
      { id: 'reframe-vertical', purpose: 'custom', aspectRatio: '9:16', platform: 'instagram' },
      { id: 'reframe-square', purpose: 'custom', aspectRatio: '1:1', platform: 'linkedin' },
      { id: 'reframe-landscape', purpose: 'custom', aspectRatio: '16:9', platform: 'youtube' },
    ];
  return [
    {
      id: 'launch-landscape',
      purpose: 'launch',
      durationSeconds: 30,
      aspectRatio: '16:9',
      platform: 'youtube',
      templateId: FOUNDER_TEMPLATE.id,
    },
    {
      id: 'launch-vertical',
      purpose: 'launch',
      durationSeconds: 15,
      aspectRatio: '9:16',
      platform: 'instagram',
      templateId: FOUNDER_TEMPLATE.id,
    },
  ];
}

export async function sha256(file: Blob) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}` as const;
}

export function createLocalMediaIndex(input: {
  assetId: string;
  hash: `sha256:${string}`;
  durationMs: number;
  width: number;
  height: number;
  frameRate?: number;
  transcript: string;
}): MediaIndex {
  const sentences = input.transcript
    .split(/(?<=[.!?])\s+/u)
    .map((text) => text.trim())
    .filter(Boolean);
  const slice = input.durationMs / Math.max(1, sentences.length);
  const words = sentences.flatMap((sentence, sentenceIndex) => {
    const tokens = sentence.split(/\s+/u);
    return tokens.map((text, wordIndex) => ({
      text,
      startMs: sentenceIndex * slice + (wordIndex / tokens.length) * slice,
      endMs: sentenceIndex * slice + ((wordIndex + 1) / tokens.length) * slice,
      confidence: 0.65,
    }));
  });
  const fillers = words
    .filter((word) => /^(um+|uh+|erm|like)$/iu.test(word.text.replace(/[,.!?]/gu, '')))
    .map((word) => ({ ...word, confidence: 0.82 }));
  const quotes = sentences.map((text, index) => ({
    id: `quote:${index}`,
    text,
    startMs: index * slice,
    endMs: Math.min(input.durationMs, (index + 1) * slice),
    scores: {
      clarity: Math.min(1, text.length / 80),
      hook: /\b(why|how|never|first|problem|built)\b/iu.test(text) ? 0.9 : 0.55,
      novelty: 0.6,
      selfContained: /[.!?]$/u.test(text) ? 0.9 : 0.6,
    },
  }));
  return {
    schemaVersion: MEDIA_INDEX_SCHEMA,
    id: `index:${input.hash.slice(7, 19)}`,
    assetId: input.assetId,
    sourceHash: input.hash,
    technical: {
      durationMs: input.durationMs,
      width: input.width,
      height: input.height,
      frameRate: input.frameRate ?? 30,
      audioTracks: 1,
    },
    speech: { words, silenceRegions: [], fillers },
    visual: {
      shots: [{ id: 'shot:source', startMs: 0, endMs: input.durationMs, confidence: 1 }],
      subjectTrackIds: [],
      textRegions: [],
    },
    audio: {
      speechRegions: sentences.length ? [{ startMs: 0, endMs: input.durationMs }] : [],
      musicRegions: [],
    },
    semantics: { topics: [], quotes, demonstrations: [] },
    provenance: {
      generatedAt: new Date().toISOString(),
      tools: [
        {
          id: 'browser.metadata-and-transcript-index',
          version: '1.0.0',
          parametersHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        },
      ],
    },
  };
}

export function runCreatorPipeline(input: {
  mediaIndex: MediaIndex;
  preset: CreatorPreset;
  prompt: string;
  reframePlans?: ReframePlan[];
}) {
  const intent: EditIntent = {
    schemaVersion: EDIT_INTENT_SCHEMA,
    id: `intent:${input.mediaIndex.id}:${input.preset}`,
    goal: input.prompt,
    instructions: input.prompt,
    sourceAssetIds: [input.mediaIndex.assetId],
    outputs: outputsForPreset(input.preset),
    constraints: {
      preserveMeaning: true,
      requireHumanApproval: true,
      allowMediaEgress: false,
      allowGenerativeMedia: false,
      maximumCostUsd: 1,
      preferredRuntime: 'browser',
    },
  };
  const compiledRecipe = compileRecipe({
    intent,
    recipe: RECIPE,
    templates: [FOUNDER_TEMPLATE],
    executors: EXECUTORS,
    availability: {
      browser: true,
      localWorker: false,
      remoteWorker: false,
      api: false,
      mcp: false,
      gpu: false,
    },
  });
  return {
    mediaIndex: input.mediaIndex,
    intent,
    compiledRecipe,
    ...compileFounderVariants(input.mediaIndex, intent, input.reframePlans),
    reframePlans: input.reframePlans ?? [],
  };
}
