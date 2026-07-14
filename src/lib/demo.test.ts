import { describe, expect, it } from 'vitest';
import { NODE_VIDEO_STAGE_KINDS } from './contracts';
import {
  SYNTHETIC_DEMO_DISCLOSURE,
  createSyntheticDemoRuntime,
  createSyntheticDemoSnapshot,
} from './demo';

describe('synthetic NodeVideo demo', () => {
  it('builds the same serializable checkpoint on every run', () => {
    expect(createSyntheticDemoSnapshot()).toEqual(createSyntheticDemoSnapshot());
  });

  it('is explicit about synthetic evidence and never claims a rendered preview', () => {
    const checkpoint = createSyntheticDemoSnapshot();
    const preview = checkpoint.artifacts.find((artifact) => artifact.kind === 'comparison-preview');

    expect(checkpoint.assets).toHaveLength(2);
    expect(checkpoint.assets.every((asset) => asset.source.kind === 'synthetic')).toBe(true);
    expect(checkpoint.artifacts.length).toBeGreaterThan(0);
    expect(
      checkpoint.artifacts.every(
        (artifact) =>
          artifact.provenance.kind === 'synthetic' &&
          artifact.provenance.disclosure === SYNTHETIC_DEMO_DISCLOSURE,
      ),
    ).toBe(true);
    expect(preview).toMatchObject({
      kind: 'comparison-preview',
      title: 'Synthetic preview metadata',
    });
    expect(preview && 'mediaUrl' in preview ? preview.mediaUrl : undefined).toBeUndefined();
  });

  it('records every stage, span, artifact, and event with stable links', () => {
    const checkpoint = createSyntheticDemoSnapshot();

    expect(checkpoint.stages.map((stage) => stage.kind)).toEqual(NODE_VIDEO_STAGE_KINDS);
    expect(checkpoint.stages.slice(0, -1).every((stage) => stage.status === 'completed')).toBe(
      true,
    );
    expect(checkpoint.stages.at(-1)?.status).toBe('awaiting-review');
    expect(checkpoint.spans).toHaveLength(checkpoint.stages.length);
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
