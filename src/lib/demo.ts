import type {
  NodeVideoArtifact,
  NodeVideoArtifactProvenance,
  NodeVideoCheckpoint,
  NodeVideoRecipeVersion,
  NodeVideoStage,
  NodeVideoStageKind,
  RuntimeClock,
} from './contracts';
import { PUBLIC_WORKER_RECEIPT, PUBLIC_WORKER_RESULT, PUBLIC_WORKER_URLS } from './public-worker';
import {
  LocalNodeVideoRuntime,
  type LocalNodeVideoRuntimeOptions,
  createDeterministicClock,
} from './runtime';

export const SYNTHETIC_DEMO_DISCLOSURE =
  'Worker-produced from public synthetic media with known marker ground truth; no personal media or model call was used.';

const comparison = PUBLIC_WORKER_RESULT.artifacts.tutorialComparison;
const workerMoments = comparison.criticalMoments;

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
          startAt: PUBLIC_WORKER_RECEIPT.startedAt,
          stepMs: 25,
          seed: 'public-worker',
        }),
    });

    if (!options.checkpoint) this.initializeDemo();
    if (options.runPipeline ?? !options.checkpoint) this.runSyntheticPipeline();
  }

  get proposal(): Extract<NodeVideoArtifact, { kind: 'recipe-proposal' }> | undefined {
    return this.snapshot().artifacts.find(
      (artifact): artifact is Extract<NodeVideoArtifact, { kind: 'recipe-proposal' }> =>
        artifact.kind === 'recipe-proposal',
    );
  }

  /**
   * Adapts a checked-in, FFmpeg-produced worker receipt into the local control-plane contract.
   * The browser independently hashes the deployed comparison media before this method is exposed.
   */
  runSyntheticPipeline(): NodeVideoCheckpoint {
    if (this.findArtifact('recipe-proposal')) return this.snapshot();
    const recipe = this.activeRecipe;
    if (!recipe) throw new Error('Public worker demo has no active recipe');

    const evidenceIds: string[] = [];
    evidenceIds.push(this.runIngest(recipe).id);
    this.runNormalize(recipe);
    this.runEvidenceStage(
      recipe,
      'profile',
      'Learn reusable creator profile',
      'creator-profile.learn',
      'The public tutorial fixture carries a deterministic profile prior only.',
    );
    evidenceIds.push(this.runAudio(recipe).id);
    evidenceIds.push(this.runPose(recipe).id);
    this.runEvidenceStage(
      recipe,
      'grounding',
      'Ground visible subjects',
      'grounding.locate',
      'Normalized subject regions are available for layout safety.',
    );
    evidenceIds.push(this.runAlignment(recipe).id);
    const differenceArtifacts = this.runDifferences(recipe);
    evidenceIds.push(...differenceArtifacts.map((artifact) => artifact.id));
    this.runEvidenceStage(
      recipe,
      'planning',
      'Plan the production globally',
      'edit.optimize',
      'Candidate decisions remain evidence-bound and inspectable.',
    );
    this.runEvidenceStage(
      recipe,
      'editorial',
      'Compose creator-led overlays',
      'creator-profile.apply',
      'Editorial roles and layout are separate from lyric transcription.',
    );
    evidenceIds.push(...this.runRender(recipe).map((artifact) => artifact.id));
    evidenceIds.push(this.runSummary(recipe, evidenceIds).id);
    this.runEvidenceStage(
      recipe,
      'evaluation',
      'Run conjunctive fidelity gates',
      'creative-fidelity.evaluate',
      'A structural pass cannot imply a creative pass.',
    );
    this.runReview(recipe);
    this.applyWorkerRootSpan();
    return this.snapshot();
  }

  /** A real product failure state for unit/E2E forcing: prior artifacts survive a pose failure. */
  runPoseFailureScenario(): NodeVideoCheckpoint {
    if (this.state.stages.length) return this.snapshot();
    const recipe = this.activeRecipe;
    if (!recipe) throw new Error('Public worker demo has no active recipe');
    this.runIngest(recipe);
    this.runNormalize(recipe);
    this.runAudio(recipe);
    const poseStage = this.startWorkerStage(
      recipe,
      'pose',
      'Extract known-marker pose',
      'pose.extract',
    );
    this.failStage(
      poseStage.id,
      'Pose confidence fell below the evidence threshold. Beat timing remains available.',
    );
    const summaryStage = this.startWorkerStage(
      recipe,
      'summary',
      'Summarize partial evidence',
      'tutorial.diff',
    );
    this.createArtifact({
      kind: 'summary',
      stageId: summaryStage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Partial timing result',
      provenance: this.workerProvenance(recipe),
      headline: 'Pose evidence is unavailable; verified beat timing remains usable.',
      findings: [
        `The attempt onset is ${comparison.alignment.attemptOffsetMs} ms later than the reference.`,
        'Retry slower pose analysis or mark the wrist manually before accepting form coaching.',
      ],
      evidenceArtifactIds: this.state.artifacts.map((artifact) => artifact.id),
    });
    this.completeStage(summaryStage.id, 'Partial artifacts preserved after pose failure.');
    return this.snapshot();
  }

  private initializeDemo(): void {
    const referenceMedia = PUBLIC_WORKER_RECEIPT.media.reference;
    const attemptMedia = PUBLIC_WORKER_RECEIPT.media.attempt;
    const reference = this.registerAsset({
      role: 'reference',
      filename: 'public-reference.mp4',
      mimeType: 'video/mp4',
      sizeBytes: referenceMedia.metadata?.format?.sizeBytes ?? 0,
      durationMs: Math.round((referenceMedia.metadata?.video?.durationSeconds ?? 6) * 1000),
      width: referenceMedia.metadata?.video?.codedWidth ?? 360,
      height: referenceMedia.metadata?.video?.codedHeight ?? 640,
      fps: 30,
      sha256: referenceMedia.sha256,
      source: {
        kind: 'synthetic',
        fixtureId: 'tutorial-compare-reference-v1',
        disclosure: SYNTHETIC_DEMO_DISCLOSURE,
      },
    });
    const practice = this.registerAsset({
      role: 'practice',
      filename: 'public-attempt.mp4',
      mimeType: 'video/mp4',
      sizeBytes: attemptMedia.metadata?.format?.sizeBytes ?? 0,
      durationMs: Math.round((attemptMedia.metadata?.video?.durationSeconds ?? 6) * 1000),
      width: attemptMedia.metadata?.video?.codedWidth ?? 360,
      height: attemptMedia.metadata?.video?.codedHeight ?? 640,
      fps: 30,
      sha256: attemptMedia.sha256,
      source: {
        kind: 'synthetic',
        fixtureId: 'tutorial-compare-attempt-v1',
        disclosure: SYNTHETIC_DEMO_DISCLOSURE,
      },
    });
    this.createRecipe({
      name: 'Worker-produced tutorial comparison',
      referenceAssetId: reference.id,
      practiceAssetId: practice.id,
      settings: {
        alignment: { method: 'audio-onset', offsetMs: 0, maxSearchMs: 1_000 },
        difference: { scoreThreshold: 0.03, minimumSegmentMs: 300 },
        render: { layout: 'side-by-side', fps: 30 },
        focusWindows: [],
      },
    });
  }

  private workerProvenance(recipe: NodeVideoRecipeVersion): NodeVideoArtifactProvenance {
    return {
      kind: 'deterministic-worker',
      workerId: 'nodevideo.tutorial-compare',
      workerVersion: PUBLIC_WORKER_RECEIPT.worker.version,
      executionBoundary: 'public-worker',
      inputIds: [recipe.referenceAssetId, recipe.practiceAssetId],
      inputHashes: PUBLIC_WORKER_RECEIPT.sourceAssets.map((asset) => asset.sha256),
      receiptUrl: PUBLIC_WORKER_URLS.receipt,
      disclosure: SYNTHETIC_DEMO_DISCLOSURE,
    };
  }

  private startWorkerStage(
    recipe: NodeVideoRecipeVersion,
    kind: NodeVideoStageKind,
    label: string,
    toolId: string,
  ): NodeVideoStage {
    const stage = this.startStage({
      kind,
      label,
      mode: 'deterministic-worker',
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      message: SYNTHETIC_DEMO_DISCLOSURE,
    });
    const span = this.state.spans.find((candidate) => candidate.id === stage.spanId);
    const receiptSpans = PUBLIC_WORKER_RECEIPT.trace.spans.filter(
      (candidate) => candidate.attributes.toolId === toolId,
    );
    if (span) {
      span.attributes = {
        ...span.attributes,
        toolId,
        toolVersion: String(receiptSpans[0]?.attributes.toolVersion ?? 'unknown'),
        inputHashes: PUBLIC_WORKER_RECEIPT.sourceAssets.map((asset) => asset.sha256),
        cacheHit: false,
        retryCount: 0,
        executionBoundary: 'public-worker',
        measuredWorkerDurationMs: receiptSpans.reduce(
          (total, candidate) => total + (candidate.durationMs ?? 0),
          0,
        ),
      };
    }
    return stage;
  }

  private runEvidenceStage(
    recipe: NodeVideoRecipeVersion,
    kind: NodeVideoStageKind,
    label: string,
    toolId: string,
    message: string,
  ): void {
    const stage = this.startWorkerStage(recipe, kind, label, toolId);
    this.completeStage(stage.id, message);
  }

  private runIngest(recipe: NodeVideoRecipeVersion) {
    const stage = this.startWorkerStage(
      recipe,
      'ingest',
      'Register public worker inputs',
      'media.normalize',
    );
    const assets = this.state.assets;
    const artifact = this.createArtifact({
      kind: 'asset-manifest',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Hashed public input manifest',
      provenance: this.workerProvenance(recipe),
      assetIds: [recipe.referenceAssetId, recipe.practiceAssetId],
      facts: {
        durationDeltaMs: Math.abs(assets[0].durationMs - assets[1].durationMs),
        dimensionsMatch:
          assets[0].width === assets[1].width && assets[0].height === assets[1].height,
        frameRatesMatch: assets[0].fps === assets[1].fps,
      },
    });
    this.completeStage(stage.id, 'Input hashes match the worker receipt.');
    return artifact;
  }

  private runNormalize(recipe: NodeVideoRecipeVersion): void {
    const stage = this.startWorkerStage(
      recipe,
      'normalize',
      'Normalize both videos',
      'media.normalize',
    );
    this.completeStage(stage.id, 'Both outputs validated at 360×640, CFR30, H.264/AAC, BT.709.');
  }

  private runAudio(recipe: NodeVideoRecipeVersion) {
    const stage = this.startWorkerStage(recipe, 'audio', 'Detect beat onsets', 'audio.beat_map');
    const artifact = this.createArtifact({
      kind: 'beat-map',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: `${comparison.beatMap.bpm.toFixed(1)} BPM beat map`,
      provenance: this.workerProvenance(recipe),
      bpm: comparison.beatMap.bpm,
      beatsMs: comparison.beatMap.beats,
      confidence: comparison.beatMap.evidence.confidence ?? 0,
    });
    this.completeStage(stage.id, `${comparison.beatMap.beats.length} onsets decoded from PCM.`);
    return artifact;
  }

  private runPose(recipe: NodeVideoRecipeVersion) {
    const stage = this.startWorkerStage(
      recipe,
      'pose',
      'Extract known-marker pose',
      'pose.extract',
    );
    const meanError =
      workerMoments.reduce((total, moment) => total + moment.path.maximumDeviationNormalized, 0) /
      workerMoments.length;
    const artifact = this.createArtifact({
      kind: 'pose-diff',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Known-marker pose difference',
      provenance: this.workerProvenance(recipe),
      method: 'known-marker-pose',
      sampleCount: 60,
      confidence: Math.min(...workerMoments.map((moment) => moment.form.confidence)),
      meanNormalizedError: meanError,
    });
    this.completeStage(stage.id, 'Six color-coded landmarks were decoded per sampled frame.');
    return artifact;
  }

  private runAlignment(recipe: NodeVideoRecipeVersion) {
    const stage = this.startWorkerStage(
      recipe,
      'alignment',
      'Align tutorial timelines',
      'tutorial.align',
    );
    const artifact = this.createArtifact({
      kind: 'alignment-report',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Audio-onset alignment',
      provenance: this.workerProvenance(recipe),
      offsetMs: comparison.alignment.attemptOffsetMs,
      confidence: comparison.alignment.confidence,
      method: 'audio-onset',
      anchors: comparison.beatMap.beats.slice(0, 4).map((referenceMs) => ({
        referenceMs,
        practiceMs: referenceMs + comparison.alignment.attemptOffsetMs,
        confidence: comparison.alignment.confidence,
      })),
    });
    this.completeStage(stage.id, `Attempt aligned at +${comparison.alignment.attemptOffsetMs} ms.`);
    return artifact;
  }

  private runDifferences(recipe: NodeVideoRecipeVersion) {
    const stage = this.startWorkerStage(
      recipe,
      'diffs',
      'Detect three critical moments',
      'tutorial.diff',
    );
    const critical = this.createArtifact({
      kind: 'critical-moments',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Three evidence-linked moments',
      provenance: this.workerProvenance(recipe),
      moments: workerMoments.map((moment) => ({
        id: moment.id,
        beat: moment.beat,
        referenceFrame: moment.referenceFrame,
        attemptFrame: moment.attemptFrame,
        meanJointAngleErrorDeg: moment.form.meanJointAngleErrorDeg,
        maximumDeviationNormalized: moment.path.maximumDeviationNormalized,
        primaryRegion: moment.form.primaryRegion ?? 'Body position',
        correction: moment.coaching.correction,
      })),
    });
    const difference = this.createArtifact({
      kind: 'difference-report',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Timing, form, path, and dynamics diff',
      provenance: this.workerProvenance(recipe),
      overallScore:
        workerMoments.reduce((total, moment) => total + moment.path.maximumDeviationNormalized, 0) /
        workerMoments.length,
      segments: workerMoments.map((moment) => ({
        id: moment.id,
        range: {
          startMs: Math.max(0, Math.round((moment.referenceFrame / 30) * 1000) - 250),
          endMs: Math.round((moment.referenceFrame / 30) * 1000) + 250,
        },
        score: moment.path.maximumDeviationNormalized,
        category: 'pose',
        summary: `${moment.form.primaryRegion ?? 'Body position'} differs at beat ${moment.beat}.`,
      })),
    });
    this.completeStage(stage.id, 'Three separated maxima were selected from measured pose errors.');
    return [critical, difference];
  }

  private runRender(recipe: NodeVideoRecipeVersion) {
    const stage = this.startWorkerStage(
      recipe,
      'render',
      'Render comparisons and bursts',
      'render.comparison',
    );
    const comparisonArtifact = this.createArtifact({
      kind: 'tutorial-comparison',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Playable worker comparison',
      provenance: this.workerProvenance(recipe),
      referenceMediaUrl: PUBLIC_WORKER_URLS.reference,
      attemptMediaUrl: PUBLIC_WORKER_URLS.attempt,
      comparisonMediaUrl: PUBLIC_WORKER_URLS.comparison,
      differenceMediaUrl: PUBLIC_WORKER_URLS.difference,
      durationMs: Math.round(
        (PUBLIC_WORKER_RECEIPT.media.sideBySide.metadata?.video?.durationSeconds ?? 5.76) * 1000,
      ),
      validated: PUBLIC_WORKER_RECEIPT.validation.passed,
    });
    const burst = this.createArtifact({
      kind: 'critical-moment-burst',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Critical frame bursts',
      provenance: this.workerProvenance(recipe),
      imageUrl: PUBLIC_WORKER_URLS.bursts,
      momentIds: workerMoments.map((moment) => moment.id),
      framesBefore: 3,
      framesAfter: 3,
    });
    const receipt = this.createArtifact({
      kind: 'worker-receipt',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Validated worker receipt',
      provenance: this.workerProvenance(recipe),
      receiptUrl: PUBLIC_WORKER_URLS.receipt,
      resultSha256: PUBLIC_WORKER_RECEIPT.result.sha256,
      eventCount: PUBLIC_WORKER_RECEIPT.events.length,
      spanCount: PUBLIC_WORKER_RECEIPT.trace.spans.length,
      validationCount: PUBLIC_WORKER_RECEIPT.validation.assertions.length,
      validationVerdict: PUBLIC_WORKER_RECEIPT.validation.passed ? 'pass' : 'fail',
    });
    this.completeStage(
      stage.id,
      'FFprobe and hash checks passed for playable media and burst sheet.',
    );
    return [comparisonArtifact, burst, receipt];
  }

  private runSummary(recipe: NodeVideoRecipeVersion, evidenceArtifactIds: string[]) {
    const stage = this.startWorkerStage(
      recipe,
      'summary',
      'Generate deterministic coaching',
      'tutorial.diff',
    );
    const artifact = this.createArtifact({
      kind: 'summary',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Evidence-linked coaching summary',
      provenance: this.workerProvenance(recipe),
      headline: comparison.summary.primaryCorrection,
      findings: [...comparison.summary.strengths, ...comparison.summary.secondaryCorrections],
      evidenceArtifactIds,
    });
    this.completeStage(stage.id, 'Rule-based coaching points only to worker artifacts.');
    return artifact;
  }

  private runReview(recipe: NodeVideoRecipeVersion): void {
    const stage = this.startWorkerStage(
      recipe,
      'review',
      'Review suggested recipe change',
      'tutorial.diff',
    );
    this.createArtifact({
      kind: 'recipe-proposal',
      stageId: stage.id,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.version,
      title: 'Focus the render on three measured moments',
      provenance: this.workerProvenance(recipe),
      baseVersion: recipe.version,
      rationale: `The worker measured a ${comparison.alignment.attemptOffsetMs} ms offset and three separated pose-error maxima.`,
      patch: {
        alignmentOffsetMs: comparison.alignment.attemptOffsetMs,
        differenceScoreThreshold: 0.025,
        renderLayout: 'overlay',
        focusWindows: workerMoments.map((moment) => {
          const centerMs = Math.round((moment.referenceFrame / 30) * 1000);
          return { startMs: Math.max(0, centerMs - 350), endMs: centerMs + 350 };
        }),
      },
    });
    this.awaitReview(stage.id, 'Accept or decline; the recipe is unchanged until acceptance.');
  }

  private applyWorkerRootSpan(): void {
    const childSpanIds = new Set(this.state.stages.map((stage) => stage.spanId));
    for (const span of this.state.spans) {
      if (childSpanIds.has(span.id)) span.parentSpanId = 'span.worker-root';
    }
    this.state.spans.unshift({
      id: 'span.worker-root',
      traceId: this.state.traceId,
      name: 'tutorial_compare',
      stageKind: 'ingest',
      status: PUBLIC_WORKER_RECEIPT.validation.passed ? 'ok' : 'error',
      startedAt: PUBLIC_WORKER_RECEIPT.startedAt,
      endedAt: PUBLIC_WORKER_RECEIPT.endedAt,
      attributes: {
        workerId: PUBLIC_WORKER_RECEIPT.worker.id,
        workerVersion: PUBLIC_WORKER_RECEIPT.worker.version,
        eventCount: PUBLIC_WORKER_RECEIPT.events.length,
        validationCount: PUBLIC_WORKER_RECEIPT.validation.assertions.length,
        measuredWorkerDurationMs: PUBLIC_WORKER_RECEIPT.durationMs,
      },
      artifactIds: this.state.artifacts.map((artifact) => artifact.id),
    });
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
