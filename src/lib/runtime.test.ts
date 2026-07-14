import { describe, expect, it } from 'vitest';
import type { StorageLike } from './contracts';
import { createSyntheticDemoRuntime, restoreSyntheticDemoRuntime } from './demo';
import {
  LocalStorageCheckpointAdapter,
  assertAppendOnlyEventLog,
  createDeterministicClock,
  isAppendOnlyEventLog,
} from './runtime';

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('LocalNodeVideoRuntime decisions', () => {
  it('accepts a proposal by appending a new immutable recipe version', () => {
    const runtime = createSyntheticDemoRuntime();
    const proposal = runtime.proposal;
    expect(proposal).toBeDefined();
    if (!proposal) throw new Error('Expected the demo proposal');

    const before = runtime.snapshot();
    const accepted = runtime.acceptProposal(proposal.id, 'Use the focused review recipe.');
    const after = runtime.snapshot();

    expect(runtime.proposalStatus(proposal.id)).toBe('accepted');
    expect(accepted).toMatchObject({
      recipeId: proposal.recipeId,
      version: 2,
      reason: 'proposal',
      parentVersion: 1,
      proposalArtifactId: proposal.id,
    });
    expect(accepted.settings).toMatchObject({
      alignment: { offsetMs: 240 },
      difference: { scoreThreshold: 0.025 },
      render: { layout: 'overlay' },
    });
    expect(after.recipeVersions[0]).toEqual(before.recipeVersions[0]);
    expect(after.activeRecipeVersion).toBe(2);
    expect(after.events.at(-1)?.type).toBe('proposal.accepted');
    expect(() => assertAppendOnlyEventLog(before.events, after.events)).not.toThrow();
    expect(() => runtime.declineProposal(proposal.id)).toThrow('already decided');
  });

  it('declines without changing the active recipe', () => {
    const runtime = createSyntheticDemoRuntime();
    const proposal = runtime.proposal;
    if (!proposal) throw new Error('Expected the demo proposal');
    const before = runtime.snapshot();

    runtime.declineProposal(proposal.id, 'Keep the original layout.');
    const after = runtime.snapshot();

    expect(runtime.proposalStatus(proposal.id)).toBe('declined');
    expect(after.activeRecipeVersion).toBe(1);
    expect(after.recipeVersions).toEqual(before.recipeVersions);
    expect(after.events.at(-1)).toMatchObject({
      type: 'proposal.declined',
      payload: { proposalArtifactId: proposal.id, note: 'Keep the original layout.' },
    });
  });

  it('restores an earlier snapshot as a new version instead of rewriting history', () => {
    const runtime = createSyntheticDemoRuntime();
    const proposal = runtime.proposal;
    if (!proposal) throw new Error('Expected the demo proposal');
    const original = runtime.snapshot().recipeVersions[0];
    runtime.acceptProposal(proposal.id);
    const beforeRestore = runtime.snapshot();

    const restored = runtime.restoreVersion(original.recipeId, 1, 'Return to baseline.');
    const afterRestore = runtime.snapshot();

    expect(restored).toMatchObject({
      version: 3,
      reason: 'restore',
      parentVersion: 2,
      restoredFromVersion: 1,
    });
    expect(restored.settings).toEqual(original.settings);
    expect(afterRestore.recipeVersions.slice(0, 2)).toEqual(beforeRestore.recipeVersions);
    expect(afterRestore.activeRecipeVersion).toBe(3);
    expect(afterRestore.events.at(-1)).toMatchObject({
      type: 'recipe.version.restored',
      payload: { sourceVersion: 1, createdVersion: 3 },
    });
  });
});

describe('append-only history and checkpoints', () => {
  it('returns detached snapshots and detects changed event prefixes', () => {
    const runtime = createSyntheticDemoRuntime();
    const untouched = runtime.snapshot();
    const mutated = runtime.snapshot();
    mutated.events[0].timestamp = '2030-01-01T00:00:00.000Z';

    expect(runtime.snapshot()).toEqual(untouched);
    expect(isAppendOnlyEventLog(untouched.events, mutated.events)).toBe(false);
    expect(() => assertAppendOnlyEventLog(untouched.events, mutated.events)).toThrow(
      'Event log entry 1 was changed',
    );
  });

  it('round-trips a checkpoint through a StorageLike adapter and continues monotonically', () => {
    const storage = new MemoryStorage();
    const adapter = new LocalStorageCheckpointAdapter(storage, 'test-nodevideo');
    const runtime = createSyntheticDemoRuntime();
    const saved = runtime.saveCheckpoint(adapter);
    const loaded = adapter.load(saved.runtimeId);

    expect(loaded).toEqual(saved);
    if (!loaded) throw new Error('Expected a loaded checkpoint');

    const restored = restoreSyntheticDemoRuntime(
      loaded,
      createDeterministicClock({
        startAt: '2026-07-14T18:00:00.000Z',
        stepMs: 100,
        seed: 'restored',
      }),
    );
    const proposal = restored.proposal;
    if (!proposal) throw new Error('Expected the restored proposal');
    restored.acceptProposal(proposal.id);
    const continued = restored.snapshot();

    expect(() => assertAppendOnlyEventLog(saved.events, continued.events)).not.toThrow();
    expect(Date.parse(continued.updatedAt)).toBeGreaterThan(Date.parse(saved.updatedAt));
    expect(new Set(continued.events.map((event) => event.id)).size).toBe(continued.events.length);

    adapter.remove(saved.runtimeId);
    expect(adapter.load(saved.runtimeId)).toBeNull();
  });
});
