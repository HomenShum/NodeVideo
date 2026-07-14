import type {
  NodeVideoArtifact,
  NodeVideoCheckpoint,
  NodeVideoRecipeVersion,
  RuntimeClock,
} from './contracts';
import {
  LocalNodeVideoRuntime,
  type LocalNodeVideoRuntimeOptions,
  createDeterministicClock,
} from './runtime';

export const SYNTHETIC_DEMO_DISCLOSURE =
  'Deterministic synthetic fixture data; no uploaded video was decoded or analyzed.';

const syntheticProvenance = () =>
  ({
    kind: 'synthetic',
    generator: 'nodevideo-demo',
    disclosure: SYNTHETIC_DEMO_DISCLOSURE,
  }) as const;

export interface SyntheticDemoRuntimeOptions extends Omit<LocalNodeVideoRuntimeOptions, 'clock'> {
  clock?: RuntimeClock;
  /** Defaults to true for a new runtime and false when restoring a checkpoint. */
  runPipeline?: boolean;
}

export class SyntheticDemoRuntime extends LocalNodeVideoRuntime {
  constructor(options: SyntheticDemoRuntimeOptions = {}) {
    super({
      checkpoint: options.checkpoint,
      clock:
        options.clock ??
        createDeterministicClock({
          startAt: '2026-07-14T16:00:00.000Z',
          stepMs: 250,
          seed: 'demo',
        }),
    });

    if (!options.checkpoint) {
      this.initializeDemo();
    }
    if (options.runPipeline ?? !options.checkpoint) {
      this.runSyntheticPipeline();
    }
  }

  get proposal(): Extract<NodeVideoArtifact, { kind: 'recipe-proposal' }> | undefined {
    return this.snapshot().artifacts.find(
      (artifact): artifact is Extract<NodeVideoArtifact, { kind: 'recipe-proposal' }> =>
        artifact.kind === 'recipe-proposal',
    );
  }

  /**
   * Runs a deterministic metadata-only pipeline. Calling it again after the
   * proposal exists is a no-op and returns a fresh checkpoint.
   */
  runSyntheticPipeline(): NodeVideoCheckpoint {
    if (this.findArtifact('recipe-proposal')) {
      return this.snapshot();
    }

    const recipe = this.activeRecipe;
    if (!recipe) {
      throw new Error('Synthetic demo has no active recipe');
    }

    const manifest = this.runIngest(recipe);
    this.runNormalize(recipe);
    const audio = this.runAudio(recipe);
    const pose = this.runPose(recipe);
    const alignment = this.runAlignment(recipe);
    const differences = this.runDifferences(recipe);
    this.runPreview(recipe);
    this.runSummary(recipe, [manifest.id, audio.id, pose.id, alignment.id, differences.id]);
    this.runReview(recipe);
    return this.snapshot();
  }

  private initializeDemo(): void {
    const reference = this.registerAsset({
      role: 'reference',
      filename: 'synthetic-reference.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 12_400_000,
      durationMs: 12_000,
      width: 1080,
      height: 1920,
      fps: 30,
      source: {
        kind: 'synthetic',
        fixtureId: 'reference-v1',
        disclosure: SYNTHETIC_DEMO_DISCLOSURE,
      },
    });
    const practice = this.registerAsset({
      role: 'practice',
      filename: 'synthetic-practice.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 13_100_000,
      durationMs: 12_360,
      width: 1080,
      height: 1920,
      fps: 30,
      source: {
        kind: 'synthetic',
        fixtureId: 'practice-v1',
        disclosure: SYNTHETIC_DEMO_DISCLOSURE,
      },
    });

    this.createRecipe({
      name: 'Synthetic two-clip comparison',
      referenceAssetId: reference.id,
      practiceAssetId: practice.id,
      settings: {
        alignment: {
          method: 'synthetic-fixture',
          offsetMs: 0,
          maxSearchMs: 2_000,
        },
        difference: {
          scoreThreshold: 0.45,
          minimumSegmentMs: 300,
        },
        render: {
          layout: 'side-by-side',
          fps: 30,
        },
        focusWindows: [],
      },
    });
  }

  private runIngest(recipe: NodeVideoRecipeVersion) {
    const stage = this.startStage({
      kind: 'ingest',
      label: 'Inspect fixture metadata',
      mode: 'synthetic',
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      message: SYNTHETIC_DEMO_DISCLOSURE,
    });
    const artifact = this.createArtifact({
      kind: 'asset-manifest',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Synthetic asset manifest',
      provenance: syntheticProvenance(),
      assetIds: [recipe.referenceAssetId, recipe.practiceAssetId],
      facts: {
        durationDeltaMs: 360,
        dimensionsMatch: true,
        frameRatesMatch: true,
      },
    });
    this.completeStage(stage.id, 'Fixture metadata recorded; no media bytes were read.');
    return artifact;
  }

  private runNormalize(recipe: NodeVideoRecipeVersion): void {
    const stage = this.startStage({
      kind: 'normalize',
      label: 'Describe normalized timeline',
      mode: 'synthetic',
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      message: SYNTHETIC_DEMO_DISCLOSURE,
    });
    this.completeStage(stage.id, 'Synthetic timeline assumes 30 fps at source dimensions.');
  }

  private runAudio(recipe: NodeVideoRecipeVersion) {
    const stage = this.startStage({
      kind: 'audio',
      label: 'Generate fixture onset evidence',
      mode: 'synthetic',
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      message: SYNTHETIC_DEMO_DISCLOSURE,
    });
    const artifact = this.createArtifact({
      kind: 'feature-report',
      feature: 'audio',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Synthetic audio features',
      provenance: syntheticProvenance(),
      sampleCount: 12,
      confidence: 0.96,
      observations: [
        'Fixture onset at 1.20 s in the reference timeline.',
        'Fixture onset at 1.48 s in the practice timeline.',
      ],
    });
    this.completeStage(stage.id, 'Synthetic onset samples generated.');
    return artifact;
  }

  private runPose(recipe: NodeVideoRecipeVersion) {
    const stage = this.startStage({
      kind: 'pose',
      label: 'Generate fixture pose evidence',
      mode: 'synthetic',
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      message: SYNTHETIC_DEMO_DISCLOSURE,
    });
    const artifact = this.createArtifact({
      kind: 'feature-report',
      feature: 'pose',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Synthetic pose features',
      provenance: syntheticProvenance(),
      sampleCount: 8,
      confidence: 0.89,
      observations: [
        'Fixture shoulder turn trails the reference in the first focus window.',
        'Fixture landing position is inside the comparison tolerance.',
      ],
    });
    this.completeStage(stage.id, 'Synthetic pose samples generated.');
    return artifact;
  }

  private runAlignment(recipe: NodeVideoRecipeVersion) {
    const stage = this.startStage({
      kind: 'alignment',
      label: 'Align fixture timelines',
      mode: 'synthetic',
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      message: SYNTHETIC_DEMO_DISCLOSURE,
    });
    const artifact = this.createArtifact({
      kind: 'alignment-report',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Synthetic alignment',
      provenance: syntheticProvenance(),
      offsetMs: 280,
      confidence: 0.94,
      method: 'synthetic-fixture',
      anchors: [
        { referenceMs: 1_200, practiceMs: 1_480, confidence: 0.97 },
        { referenceMs: 6_400, practiceMs: 6_690, confidence: 0.91 },
      ],
    });
    this.completeStage(stage.id, 'Fixture timelines aligned with a declared 280 ms offset.');
    return artifact;
  }

  private runDifferences(recipe: NodeVideoRecipeVersion) {
    const stage = this.startStage({
      kind: 'diffs',
      label: 'Score fixture differences',
      mode: 'synthetic',
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      message: SYNTHETIC_DEMO_DISCLOSURE,
    });
    const artifact = this.createArtifact({
      kind: 'difference-report',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Synthetic difference report',
      provenance: syntheticProvenance(),
      overallScore: 0.72,
      segments: [
        {
          id: this.allocateId('difference_segment'),
          range: { startMs: 2_100, endMs: 3_400 },
          score: 0.84,
          category: 'timing',
          summary: 'Fixture practice motion begins later than the reference.',
        },
        {
          id: this.allocateId('difference_segment'),
          range: { startMs: 6_100, endMs: 7_200 },
          score: 0.67,
          category: 'pose',
          summary: 'Fixture shoulder rotation differs at the midpoint.',
        },
      ],
    });
    this.completeStage(stage.id, 'Two deterministic fixture windows exceeded the threshold.');
    return artifact;
  }

  private runPreview(recipe: NodeVideoRecipeVersion): void {
    const stage = this.startStage({
      kind: 'render',
      label: 'Describe comparison preview',
      mode: 'synthetic',
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      message: SYNTHETIC_DEMO_DISCLOSURE,
    });
    this.createArtifact({
      kind: 'comparison-preview',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Synthetic preview metadata',
      provenance: syntheticProvenance(),
      layout: recipe.settings.render.layout,
      durationMs: 12_000,
    });
    this.completeStage(stage.id, 'Metadata only; no preview video was rendered.');
  }

  private runSummary(recipe: NodeVideoRecipeVersion, evidenceArtifactIds: string[]): void {
    const stage = this.startStage({
      kind: 'summary',
      label: 'Summarize fixture evidence',
      mode: 'synthetic',
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      message: SYNTHETIC_DEMO_DISCLOSURE,
    });
    this.createArtifact({
      kind: 'summary',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Synthetic comparison summary',
      provenance: syntheticProvenance(),
      headline: 'Practice timing trails the fixture reference by 280 ms.',
      findings: [
        'Review the 2.10–3.40 s timing window first.',
        'The 6.10–7.20 s pose window is a secondary difference.',
      ],
      evidenceArtifactIds,
    });
    this.completeStage(stage.id, 'Summary points only to synthetic evidence artifacts.');
  }

  private runReview(recipe: NodeVideoRecipeVersion): void {
    const stage = this.startStage({
      kind: 'review',
      label: 'Review suggested recipe change',
      mode: 'synthetic',
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      message: SYNTHETIC_DEMO_DISCLOSURE,
    });
    this.createArtifact({
      kind: 'recipe-proposal',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Focus comparison on the two fixture differences',
      provenance: syntheticProvenance(),
      baseVersion: recipe.version,
      rationale: 'The deterministic fixture marks two high-value windows and a 280 ms offset.',
      patch: {
        alignmentOffsetMs: 280,
        differenceScoreThreshold: 0.55,
        renderLayout: 'overlay',
        focusWindows: [
          { startMs: 2_100, endMs: 3_400 },
          { startMs: 6_100, endMs: 7_200 },
        ],
      },
    });
    this.awaitReview(stage.id, 'Accept or decline; the recipe is unchanged until acceptance.');
  }
}

export const createSyntheticDemoRuntime = (
  options?: SyntheticDemoRuntimeOptions,
): SyntheticDemoRuntime => new SyntheticDemoRuntime(options);

export const createSyntheticDemoSnapshot = (): NodeVideoCheckpoint =>
  createSyntheticDemoRuntime().snapshot();

export const restoreSyntheticDemoRuntime = (
  checkpoint: NodeVideoCheckpoint,
  clock?: RuntimeClock,
): SyntheticDemoRuntime => new SyntheticDemoRuntime({ checkpoint, clock, runPipeline: false });
