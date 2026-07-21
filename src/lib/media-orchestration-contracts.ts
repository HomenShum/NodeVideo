export const MEDIA_INDEX_SCHEMA = 'nodevideo.media-index.v1' as const;
export const EDIT_INTENT_SCHEMA = 'nodevideo.edit-intent.v1' as const;
export const STORY_GRAPH_SCHEMA = 'nodevideo.story-graph.v1' as const;
export const TEMPLATE_SPEC_SCHEMA = 'nodevideo.template-spec.v1' as const;
export const EDIT_RECIPE_SCHEMA = 'nodevideo.edit-recipe.v1' as const;
export const EXECUTOR_SCHEMA = 'nodevideo.executor.v1' as const;
export const VARIANT_SET_SCHEMA = 'nodevideo.variant-set.v1' as const;

export type TimeRange = { startMs: number; endMs: number };

export type MediaIndex = {
  schemaVersion: typeof MEDIA_INDEX_SCHEMA;
  id: string;
  assetId: string;
  sourceHash: `sha256:${string}`;
  technical: {
    durationMs: number;
    width: number;
    height: number;
    frameRate: number;
    audioTracks: number;
  };
  speech?: {
    words: Array<TimeRange & { text: string; confidence: number; speakerId?: string }>;
    silenceRegions: TimeRange[];
    fillers: Array<TimeRange & { text: string; confidence: number }>;
  };
  visual: {
    shots: Array<TimeRange & { id: string; confidence: number }>;
    subjectTrackIds: string[];
    textRegions: Array<TimeRange & { text: string; confidence: number }>;
  };
  audio: {
    speechRegions: TimeRange[];
    musicRegions: TimeRange[];
    beatsMs?: number[];
  };
  semantics: {
    topics: Array<TimeRange & { id: string; label: string; confidence: number }>;
    quotes: Array<
      TimeRange & {
        id: string;
        text: string;
        speakerId?: string;
        scores: { clarity: number; hook: number; novelty: number; selfContained: number };
      }
    >;
    demonstrations: Array<TimeRange & { id: string; label: string; confidence: number }>;
  };
  provenance: {
    generatedAt: string;
    tools: Array<{ id: string; version: string; parametersHash: `sha256:${string}` }>;
  };
};

export type OutputIntent = {
  id: string;
  purpose: 'clean-master' | 'short' | 'launch' | 'long-form' | 'social' | 'custom';
  durationSeconds?: number;
  aspectRatio: '16:9' | '9:16' | '1:1' | 'source';
  platform?: 'youtube' | 'instagram' | 'tiktok' | 'linkedin' | 'x' | 'generic';
  templateId?: string;
};

export type EditIntent = {
  schemaVersion: typeof EDIT_INTENT_SCHEMA;
  id: string;
  goal: string;
  instructions: string;
  sourceAssetIds: string[];
  outputs: OutputIntent[];
  constraints: {
    preserveMeaning: boolean;
    requireHumanApproval: boolean;
    allowMediaEgress: boolean;
    allowGenerativeMedia: boolean;
    maximumCostUsd: number;
    preferredRuntime: 'browser' | 'local' | 'cloud' | 'any';
  };
};

export type StoryNodeRole =
  | 'hook'
  | 'problem'
  | 'context'
  | 'solution'
  | 'demo'
  | 'proof'
  | 'quote'
  | 'cta'
  | 'chapter';

export type StoryGraph = {
  schemaVersion: typeof STORY_GRAPH_SCHEMA;
  id: string;
  mediaIndexIds: string[];
  nodes: Array<{
    id: string;
    role: StoryNodeRole;
    label: string;
    sourceRanges: Array<{ assetId: string; range: TimeRange }>;
    evidenceIds: string[];
  }>;
  edges: Array<{
    from: string;
    to: string;
    kind: 'precedes' | 'supports' | 'contrasts' | 'demonstrates' | 'summarizes';
  }>;
};

export type TechniqueDefinition = {
  id: string;
  version: string;
  capability: string;
  preconditions: string[];
  operation: Record<string, unknown>;
  validators: string[];
};

export type TemplateSpec = {
  schemaVersion: typeof TEMPLATE_SPEC_SCHEMA;
  id: string;
  version: string;
  title: string;
  provenance: {
    sourceRefs: string[];
    rights: 'private-reference' | 'licensed' | 'public-domain' | 'structural-study';
    redistributionAllowed: boolean;
    derivedAt: string;
  };
  format: {
    aspectRatios: OutputIntent['aspectRatio'][];
    durationRangeSeconds: [number, number];
  };
  narrative: Array<{ role: StoryNodeRole; targetDurationRatio: number; required: boolean }>;
  visualGrammar: {
    shotLengthRangeMs: [number, number];
    captionStyleId?: string;
    transitionTechniqueIds: string[];
    framingRules: string[];
  };
  audioGrammar: { pausePolicy: string; musicPolicy: string; loudnessTargetLufs: number };
  brandPolicy: { structuralInspirationOnly: boolean; copyBrandAssets: false };
  evaluatorIds: string[];
};

export type RecipeStageDefinition = {
  id: string;
  capability: string;
  dependsOn: string[];
  inputArtifacts: string[];
  outputArtifacts: string[];
  validators: string[];
  approval: 'automatic' | 'required';
  fanOut: 'shared' | 'per-output';
};

export type EditRecipe = {
  schemaVersion: typeof EDIT_RECIPE_SCHEMA;
  id: string;
  version: string;
  title: string;
  intentKinds: string[];
  requiredMediaFeatures: string[];
  techniqueIds: string[];
  stages: RecipeStageDefinition[];
};

export type ExecutorDefinition = {
  schemaVersion: typeof EXECUTOR_SCHEMA;
  id: string;
  version: string;
  capabilities: string[];
  runtime: 'browser' | 'local-worker' | 'remote-worker' | 'api' | 'mcp';
  cost: { tier: 'free' | 'low' | 'medium' | 'high'; estimatedUsd: number };
  latency: 'interactive' | 'short' | 'long';
  deterministic: boolean;
  qualityTier: 'baseline' | 'standard' | 'premium' | 'experimental';
  privacy: { sendsMediaOffDevice: boolean; sendsDerivedFrames: boolean };
  requirements: { gpu: boolean; minimumVramGb?: number };
  license: { code: string; model?: string; commercialUse: boolean | 'review-required' };
  validatorIds: string[];
  enabled: boolean;
};

export type CompiledRecipeStage = RecipeStageDefinition & {
  compiledId: string;
  outputId?: string;
  executorId: string;
  estimatedCostUsd: number;
};

export type CompiledRecipe = {
  id: string;
  recipeId: string;
  recipeVersion: string;
  intentId: string;
  templateIds: string[];
  stages: CompiledRecipeStage[];
  estimatedCostUsd: number;
  requiresApproval: boolean;
};

export type VariantSet = {
  schemaVersion: typeof VARIANT_SET_SCHEMA;
  id: string;
  intentId: string;
  sharedMediaIndexIds: string[];
  variants: Array<{
    id: string;
    outputIntentId: string;
    status: 'planned' | 'rendering' | 'awaiting-review' | 'accepted' | 'rejected' | 'failed';
    editPlanId?: string;
    previewArtifactId?: string;
    receiptId?: string;
  }>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function validateRange(range: TimeRange, label: string, durationMs?: number) {
  assert(Number.isFinite(range.startMs) && range.startMs >= 0, `${label}.startMs is invalid`);
  assert(Number.isFinite(range.endMs) && range.endMs > range.startMs, `${label}.endMs is invalid`);
  if (durationMs !== undefined)
    assert(range.endMs <= durationMs, `${label} exceeds media duration`);
}

export function validateMediaIndex(index: MediaIndex): MediaIndex {
  assert(index.schemaVersion === MEDIA_INDEX_SCHEMA, 'MediaIndex schema is unsupported');
  assert(index.id && index.assetId, 'MediaIndex identity is required');
  assert(/^sha256:[a-f\d]{64}$/u.test(index.sourceHash), 'MediaIndex sourceHash is invalid');
  assert(index.technical.durationMs > 0, 'MediaIndex duration must be positive');
  const ranges: Array<[TimeRange, string]> = [
    ...(index.speech?.words.map((item, i) => [item, `speech.words[${i}]`] as [TimeRange, string]) ??
      []),
    ...(index.speech?.silenceRegions.map(
      (item, i) => [item, `speech.silenceRegions[${i}]`] as [TimeRange, string],
    ) ?? []),
    ...index.visual.shots.map((item, i) => [item, `visual.shots[${i}]`] as [TimeRange, string]),
    ...index.semantics.quotes.map(
      (item, i) => [item, `semantics.quotes[${i}]`] as [TimeRange, string],
    ),
  ];
  for (const [range, label] of ranges) validateRange(range, label, index.technical.durationMs);
  return index;
}

export function validateEditIntent(intent: EditIntent): EditIntent {
  assert(intent.schemaVersion === EDIT_INTENT_SCHEMA, 'EditIntent schema is unsupported');
  assert(intent.id && intent.goal.trim(), 'EditIntent identity and goal are required');
  assert(intent.sourceAssetIds.length > 0, 'EditIntent requires at least one source asset');
  assert(intent.outputs.length > 0, 'EditIntent requires at least one output');
  assert(
    new Set(intent.outputs.map((item) => item.id)).size === intent.outputs.length,
    'Output IDs must be unique',
  );
  assert(intent.constraints.maximumCostUsd >= 0, 'Maximum cost must be non-negative');
  return intent;
}

export function validateTemplateSpec(template: TemplateSpec): TemplateSpec {
  assert(template.schemaVersion === TEMPLATE_SPEC_SCHEMA, 'TemplateSpec schema is unsupported');
  assert(template.brandPolicy.copyBrandAssets === false, 'Templates may not copy brand assets');
  assert(
    template.brandPolicy.structuralInspirationOnly,
    'Templates must be structural inspiration only',
  );
  const ratio = template.narrative.reduce((sum, item) => sum + item.targetDurationRatio, 0);
  assert(Math.abs(ratio - 1) <= 0.001, 'Template narrative ratios must total one');
  assert(
    template.format.durationRangeSeconds[1] >= template.format.durationRangeSeconds[0],
    'Template duration range is invalid',
  );
  return template;
}
