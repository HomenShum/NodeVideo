import { describe, expect, it } from 'vitest';
import { toVideoUiEvent } from './nodeagent-adapter';
import { PUBLIC_WORKER_RECEIPT } from './public-worker';

describe('NodeAgent to NodeVideo UI adapter', () => {
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
