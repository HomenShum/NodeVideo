import { describe, expect, it } from 'vitest';
import { NODE_VIDEO_STAGE_KINDS } from './contracts';
import {
  SYNTHETIC_DEMO_DISCLOSURE,
  createSyntheticDemoRuntime,
  createSyntheticDemoSnapshot,
} from './demo';

describe('public worker NodeVideo demo', () => {
  it('builds the same serializable checkpoint on every run', () => {
    expect(createSyntheticDemoSnapshot()).toEqual(createSyntheticDemoSnapshot());
  });

  it('is explicit about worker-produced synthetic evidence and links a real render', () => {
    const checkpoint = createSyntheticDemoSnapshot();
    const preview = checkpoint.artifacts.find(
      (artifact) => artifact.kind === 'tutorial-comparison',
    );

    expect(checkpoint.assets).toHaveLength(2);
    expect(checkpoint.assets.every((asset) => asset.source.kind === 'synthetic')).toBe(true);
    expect(checkpoint.artifacts.length).toBeGreaterThan(0);
    expect(
      checkpoint.artifacts.every(
        (artifact) =>
          artifact.provenance.kind === 'deterministic-worker' &&
          artifact.provenance.disclosure === SYNTHETIC_DEMO_DISCLOSURE,
      ),
    ).toBe(true);
    expect(preview).toMatchObject({
      kind: 'tutorial-comparison',
      title: 'Playable worker comparison',
      validated: true,
    });
    expect(
      preview?.kind === 'tutorial-comparison' ? preview.comparisonMediaUrl : undefined,
    ).toMatch(/comparison-side-by-side/);
  });

  it('records every stage, span, artifact, and event with stable links', () => {
    const checkpoint = createSyntheticDemoSnapshot();

    expect(checkpoint.stages.map((stage) => stage.kind)).toEqual(NODE_VIDEO_STAGE_KINDS);
    expect(checkpoint.stages.slice(0, -1).every((stage) => stage.status === 'completed')).toBe(
      true,
    );
    expect(checkpoint.stages.at(-1)?.status).toBe('awaiting-review');
    expect(checkpoint.spans).toHaveLength(checkpoint.stages.length + 1);
    expect(
      checkpoint.stages.every((stage) =>
        checkpoint.spans.some(
          (span) =>
            span.id === stage.spanId &&
            span.traceId === checkpoint.traceId &&
            span.artifactIds.length === stage.artifactIds.length,
        ),
      ),
    ).toBe(true);
    expect(checkpoint.events.map((event) => event.sequence)).toEqual(
      checkpoint.events.map((_, index) => index + 1),
    );
  });

  it('preserves valid beat evidence when pose extraction fails', () => {
    const runtime = createSyntheticDemoRuntime({ runPipeline: false });
    const checkpoint = runtime.runPoseFailureScenario();

    expect(checkpoint.stages.find((stage) => stage.kind === 'pose')?.status).toBe('failed');
    expect(checkpoint.artifacts.some((artifact) => artifact.kind === 'beat-map')).toBe(true);
    expect(checkpoint.artifacts.find((artifact) => artifact.kind === 'summary')).toMatchObject({
      headline: 'Pose evidence is unavailable; verified beat timing remains usable.',
    });
  });

  it('runs the pipeline once and is idempotent after its proposal is recorded', () => {
    const runtime = createSyntheticDemoRuntime({ runPipeline: false });
    expect(runtime.snapshot().stages).toHaveLength(0);

    const first = runtime.runSyntheticPipeline();
    const second = runtime.runSyntheticPipeline();

    expect(first.stages).toHaveLength(NODE_VIDEO_STAGE_KINDS.length);
    expect(second).toEqual(first);
    expect(runtime.proposalStatus(runtime.proposal?.id ?? '')).toBe('pending');
  });
});
