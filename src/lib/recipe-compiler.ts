import {
  type CompiledRecipe,
  type CompiledRecipeStage,
  type EditIntent,
  type EditRecipe,
  type ExecutorDefinition,
  type OutputIntent,
  type TemplateSpec,
  VARIANT_SET_SCHEMA,
  type VariantSet,
  validateEditIntent,
  validateTemplateSpec,
} from './media-orchestration-contracts.ts';

export type RuntimeAvailability = {
  browser: boolean;
  localWorker: boolean;
  remoteWorker: boolean;
  api: boolean;
  mcp: boolean;
  gpu: boolean;
  maximumVramGb?: number;
};

const runtimeKey: Record<ExecutorDefinition['runtime'], keyof RuntimeAvailability> = {
  browser: 'browser',
  'local-worker': 'localWorker',
  'remote-worker': 'remoteWorker',
  api: 'api',
  mcp: 'mcp',
};

const qualityRank = { experimental: 0, baseline: 1, standard: 2, premium: 3 } as const;
const latencyRank = { interactive: 0, short: 1, long: 2 } as const;

export function selectExecutor(input: {
  capability: string;
  executors: ExecutorDefinition[];
  intent: EditIntent;
  availability: RuntimeAvailability;
  minimumQuality?: ExecutorDefinition['qualityTier'];
}): ExecutorDefinition {
  const minimumQuality = qualityRank[input.minimumQuality ?? 'baseline'];
  const eligible = input.executors.filter((executor) => {
    if (!executor.enabled || !executor.capabilities.includes(input.capability)) return false;
    if (!input.availability[runtimeKey[executor.runtime]]) return false;
    if (executor.requirements.gpu && !input.availability.gpu) return false;
    if (
      executor.requirements.minimumVramGb !== undefined &&
      (input.availability.maximumVramGb ?? 0) < executor.requirements.minimumVramGb
    )
      return false;
    if (!input.intent.constraints.allowMediaEgress && executor.privacy.sendsMediaOffDevice)
      return false;
    if (executor.license.commercialUse !== true) return false;
    if (qualityRank[executor.qualityTier] < minimumQuality) return false;
    return executor.cost.estimatedUsd <= input.intent.constraints.maximumCostUsd;
  });
  eligible.sort((left, right) => {
    const deterministic = Number(right.deterministic) - Number(left.deterministic);
    if (deterministic) return deterministic;
    const cost = left.cost.estimatedUsd - right.cost.estimatedUsd;
    if (cost) return cost;
    const latency = latencyRank[left.latency] - latencyRank[right.latency];
    if (latency) return latency;
    return qualityRank[right.qualityTier] - qualityRank[left.qualityTier];
  });
  const selected = eligible[0];
  if (!selected) throw new Error(`No eligible executor for capability: ${input.capability}`);
  return selected;
}

function orderedStages(recipe: EditRecipe) {
  const byId = new Map(recipe.stages.map((stage) => [stage.id, stage]));
  if (byId.size !== recipe.stages.length) throw new Error('Recipe stage IDs must be unique');
  for (const stage of recipe.stages)
    for (const dependency of stage.dependsOn)
      if (!byId.has(dependency))
        throw new Error(`Recipe stage ${stage.id} depends on missing stage ${dependency}`);
  const ordered: EditRecipe['stages'] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`Recipe contains a dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const stage = byId.get(id);
    if (!stage) return;
    for (const dependency of stage.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(stage);
  };
  for (const stage of recipe.stages) visit(stage.id);
  return ordered;
}

function matchingTemplate(output: OutputIntent, templates: TemplateSpec[]) {
  if (!output.templateId) return undefined;
  const template = templates.find((item) => item.id === output.templateId);
  if (!template)
    throw new Error(`Output ${output.id} references missing template ${output.templateId}`);
  validateTemplateSpec(template);
  if (!template.format.aspectRatios.includes(output.aspectRatio))
    throw new Error(`Template ${template.id} does not support ${output.aspectRatio}`);
  if (
    output.durationSeconds !== undefined &&
    (output.durationSeconds < template.format.durationRangeSeconds[0] ||
      output.durationSeconds > template.format.durationRangeSeconds[1])
  )
    throw new Error(`Output ${output.id} duration is outside template ${template.id}`);
  return template;
}

export function compileRecipe(input: {
  intent: EditIntent;
  recipe: EditRecipe;
  templates: TemplateSpec[];
  executors: ExecutorDefinition[];
  availability: RuntimeAvailability;
}): CompiledRecipe {
  const intent = validateEditIntent(input.intent);
  const stages = orderedStages(input.recipe);
  const compiled: CompiledRecipeStage[] = [];
  const selectedTemplates = new Set<string>();
  for (const output of intent.outputs) {
    const template = matchingTemplate(output, input.templates);
    if (template) selectedTemplates.add(template.id);
  }
  for (const stage of stages) {
    const targets = stage.fanOut === 'shared' ? [undefined] : intent.outputs;
    for (const output of targets) {
      const executor = selectExecutor({
        capability: stage.capability,
        executors: input.executors,
        intent,
        availability: input.availability,
      });
      compiled.push({
        ...stage,
        compiledId: output ? `${stage.id}:${output.id}` : stage.id,
        outputId: output?.id,
        executorId: executor.id,
        estimatedCostUsd: executor.cost.estimatedUsd,
        dependsOn: stage.dependsOn.map((dependency) => {
          const source = stages.find((candidate) => candidate.id === dependency);
          return output && source?.fanOut === 'per-output'
            ? `${dependency}:${output.id}`
            : dependency;
        }),
      });
    }
  }
  const estimatedCostUsd = compiled.reduce((sum, stage) => sum + stage.estimatedCostUsd, 0);
  if (estimatedCostUsd > intent.constraints.maximumCostUsd)
    throw new Error(
      `Compiled recipe costs $${estimatedCostUsd.toFixed(2)}, above the $${intent.constraints.maximumCostUsd.toFixed(2)} budget`,
    );
  return {
    id: `compiled:${input.recipe.id}:${intent.id}`,
    recipeId: input.recipe.id,
    recipeVersion: input.recipe.version,
    intentId: intent.id,
    templateIds: [...selectedTemplates],
    stages: compiled,
    estimatedCostUsd,
    requiresApproval:
      intent.constraints.requireHumanApproval ||
      compiled.some((stage) => stage.approval === 'required'),
  };
}

export function createVariantSet(intent: EditIntent, mediaIndexIds: string[]): VariantSet {
  validateEditIntent(intent);
  return {
    schemaVersion: VARIANT_SET_SCHEMA,
    id: `variants:${intent.id}`,
    intentId: intent.id,
    sharedMediaIndexIds: [...new Set(mediaIndexIds)],
    variants: intent.outputs.map((output) => ({
      id: `variant:${intent.id}:${output.id}`,
      outputIntentId: output.id,
      status: 'planned',
    })),
  };
}
