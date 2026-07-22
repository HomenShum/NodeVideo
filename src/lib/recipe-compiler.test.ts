import { describe, expect, it } from 'vitest';
import {
  EDIT_INTENT_SCHEMA,
  EDIT_RECIPE_SCHEMA,
  EXECUTOR_SCHEMA,
  type EditIntent,
  type EditRecipe,
  type ExecutorDefinition,
  TEMPLATE_SPEC_SCHEMA,
  type TemplateSpec,
} from './media-orchestration-contracts';
import { compileRecipe, createVariantSet } from './recipe-compiler';

const intent: EditIntent = {
  schemaVersion: EDIT_INTENT_SCHEMA,
  id: 'intent.founder-repurpose',
  goal: 'Turn one founder interview into a clean master and launch-ready variants.',
  instructions: 'Remove fillers and long silences, preserve meaning, and use the strongest quote.',
  sourceAssetIds: ['asset.founder-interview'],
  outputs: [
    { id: 'clean', purpose: 'clean-master', aspectRatio: '16:9' },
    {
      id: 'short',
      purpose: 'short',
      durationSeconds: 30,
      aspectRatio: '9:16',
      platform: 'linkedin',
    },
    {
      id: 'launch',
      purpose: 'launch',
      durationSeconds: 60,
      aspectRatio: '16:9',
      templateId: 'template.founder-demo',
    },
  ],
  constraints: {
    preserveMeaning: true,
    requireHumanApproval: true,
    allowMediaEgress: false,
    allowGenerativeMedia: false,
    maximumCostUsd: 1,
    preferredRuntime: 'local',
  },
};

const recipe: EditRecipe = {
  schemaVersion: EDIT_RECIPE_SCHEMA,
  id: 'recipe.founder-content',
  version: '1.0.0',
  title: 'Founder content factory',
  intentKinds: ['repurpose-founder-interview'],
  requiredMediaFeatures: ['speech.words', 'speech.silences', 'semantics.quotes'],
  techniqueIds: ['technique.remove-fillers', 'technique.tighten-silence'],
  stages: [
    {
      id: 'index',
      capability: 'media.index',
      dependsOn: [],
      inputArtifacts: ['source-media'],
      outputArtifacts: ['media-index'],
      validators: ['media-index.validate'],
      approval: 'automatic',
      fanOut: 'shared',
    },
    {
      id: 'story',
      capability: 'story.select',
      dependsOn: ['index'],
      inputArtifacts: ['media-index'],
      outputArtifacts: ['story-graph'],
      validators: ['story-grounding.validate'],
      approval: 'automatic',
      fanOut: 'shared',
    },
    {
      id: 'plan',
      capability: 'edit.compile',
      dependsOn: ['story'],
      inputArtifacts: ['story-graph', 'template-spec'],
      outputArtifacts: ['edit-plan'],
      validators: ['edit-plan.validate'],
      approval: 'required',
      fanOut: 'per-output',
    },
    {
      id: 'render',
      capability: 'render.preview',
      dependsOn: ['plan'],
      inputArtifacts: ['edit-plan'],
      outputArtifacts: ['preview'],
      validators: ['render.technical.validate'],
      approval: 'automatic',
      fanOut: 'per-output',
    },
  ],
};

const template: TemplateSpec = {
  schemaVersion: TEMPLATE_SPEC_SCHEMA,
  id: 'template.founder-demo',
  version: '1.0.0',
  title: 'Founder plus product demonstration',
  provenance: {
    sourceRefs: ['structural-study:founder-demo'],
    rights: 'structural-study',
    redistributionAllowed: false,
    derivedAt: '2026-07-21T00:00:00.000Z',
  },
  format: { aspectRatios: ['16:9', '9:16'], durationRangeSeconds: [30, 90] },
  narrative: [
    { role: 'hook', targetDurationRatio: 0.15, required: true },
    { role: 'problem', targetDurationRatio: 0.2, required: true },
    { role: 'solution', targetDurationRatio: 0.2, required: true },
    { role: 'demo', targetDurationRatio: 0.3, required: true },
    { role: 'cta', targetDurationRatio: 0.15, required: true },
  ],
  visualGrammar: {
    shotLengthRangeMs: [900, 5000],
    captionStyleId: 'caption.brand-clean',
    transitionTechniqueIds: ['technique.cut', 'technique.j-cut'],
    framingRules: ['founder-eyeline-safe', 'product-demo-readable'],
  },
  audioGrammar: {
    pausePolicy: 'tighten-long-preserve-intentional',
    musicPolicy: 'optional-rights-cleared-bed',
    loudnessTargetLufs: -14,
  },
  brandPolicy: { structuralInspirationOnly: true, copyBrandAssets: false },
  evaluatorIds: ['story.coverage', 'speech.continuity', 'brand.non-copying'],
};

const executor = (
  id: string,
  capability: string,
  estimatedUsd: number,
  overrides: Partial<ExecutorDefinition> = {},
): ExecutorDefinition => ({
  schemaVersion: EXECUTOR_SCHEMA,
  id,
  version: '1.0.0',
  capabilities: [capability],
  runtime: 'local-worker',
  cost: { tier: estimatedUsd === 0 ? 'free' : 'low', estimatedUsd },
  latency: 'short',
  deterministic: true,
  qualityTier: 'standard',
  privacy: { sendsMediaOffDevice: false, sendsDerivedFrames: false },
  requirements: { gpu: false },
  license: { code: 'MIT', commercialUse: true },
  validatorIds: [`${capability}.validate`],
  enabled: true,
  ...overrides,
});

const executors = [
  executor('executor.media-index', 'media.index', 0),
  executor('executor.story-local', 'story.select', 0.05, { deterministic: false }),
  executor('executor.story-cloud', 'story.select', 0.01, {
    runtime: 'api',
    deterministic: false,
    privacy: { sendsMediaOffDevice: true, sendsDerivedFrames: false },
  }),
  executor('executor.plan', 'edit.compile', 0),
  executor('executor.render', 'render.preview', 0),
];

const availability = {
  browser: true,
  localWorker: true,
  remoteWorker: true,
  api: true,
  mcp: false,
  gpu: false,
};

describe('general media recipe compiler', () => {
  it('analyzes once, fans out per-output stages, and keeps private media local', () => {
    const compiled = compileRecipe({
      intent,
      recipe,
      templates: [template],
      executors,
      availability,
    });
    expect(compiled.stages.filter((stage) => stage.id === 'index')).toHaveLength(1);
    expect(compiled.stages.filter((stage) => stage.id === 'render')).toHaveLength(3);
    expect(compiled.stages.find((stage) => stage.id === 'story')?.executorId).toBe(
      'executor.story-local',
    );
    expect(
      compiled.stages.find((stage) => stage.compiledId === 'render:launch')?.dependsOn,
    ).toEqual(['plan:launch']);
    expect(compiled.templateIds).toEqual(['template.founder-demo']);
    expect(compiled.requiresApproval).toBe(true);
  });

  it('creates one variant per requested output with shared analysis lineage', () => {
    const variants = createVariantSet(intent, ['media-index:founder', 'media-index:founder']);
    expect(variants.sharedMediaIndexIds).toEqual(['media-index:founder']);
    expect(variants.variants.map((item) => item.outputIntentId)).toEqual([
      'clean',
      'short',
      'launch',
    ]);
  });

  it('fails closed when a recipe contains a dependency cycle', () => {
    const cyclic: EditRecipe = {
      ...recipe,
      stages: [{ ...recipe.stages[0], dependsOn: ['render'] }, ...recipe.stages.slice(1)],
    };
    expect(() =>
      compileRecipe({ intent, recipe: cyclic, templates: [template], executors, availability }),
    ).toThrow(/dependency cycle/u);
  });

  it('fails closed when no privacy-compatible executor exists', () => {
    const cloudOnly = executors.filter((item) => item.id !== 'executor.story-local');
    expect(() =>
      compileRecipe({ intent, recipe, templates: [template], executors: cloudOnly, availability }),
    ).toThrow(/No eligible executor for capability: story.select/u);
  });
});
