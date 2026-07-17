import { describe, expect, it } from 'vitest';
import { toNodeVideoStageKind, toVideoUiEvent } from './nodeagent-adapter';
import { PUBLIC_WORKER_RECEIPT } from './public-worker';

describe('NodeAgent to NodeVideo UI adapter', () => {
  it('maps reusable taste and fidelity stages without dance-only labels', () => {
    expect(toNodeVideoStageKind('learn_creator_profile')).toBe('profile');
    expect(toNodeVideoStageKind('interpret_production')).toBe('planning');
    expect(toNodeVideoStageKind('compose_editorial_overlays')).toBe('editorial');
    expect(toNodeVideoStageKind('evaluate_hidden_target')).toBe('evaluation');
  });

  it('maps immutable worker events to stage and tool states without inventing progress', () => {
    const mapped = PUBLIC_WORKER_RECEIPT.events.map(toVideoUiEvent);
    expect(mapped[0]).toMatchObject({ sequence: 1, stageKind: 'ingest', progress: 0 });
    expect(mapped.at(-1)).toMatchObject({
      stageKind: 'review',
      status: 'completed',
      toolState: 'output-available',
      progress: 1,
    });
    expect(
      mapped.every((event, index) => index === 0 || event.sequence > mapped[index - 1].sequence),
    ).toBe(true);
  });
});
