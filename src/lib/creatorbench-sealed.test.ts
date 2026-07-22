import { describe, expect, it } from 'vitest';
import {
  assertFrozenPrivateCatalog,
  assertPostFreezeEvaluatorAccess,
} from '../../scripts/benchmarks/sealed-evaluator-guard.mjs';

const freeze = {
  id: 'freeze:1',
  frozenAt: '2026-07-21T00:00:00.000Z',
  privateSplit: { catalogHash: `sha256:${'a'.repeat(64)}` },
};

describe('CreatorBench sealed evaluator isolation', () => {
  it('denies private access without a post-freeze credential', () => {
    expect(() =>
      assertPostFreezeEvaluatorAccess({ sealed: true, credential: undefined, freeze }),
    ).toThrow(/post-freeze/u);
    expect(() =>
      assertPostFreezeEvaluatorAccess({ sealed: true, credential: 'x'.repeat(24), freeze }),
    ).not.toThrow();
  });
  it('rejects a private catalog that differs from the freeze', () => {
    expect(() => assertFrozenPrivateCatalog(freeze, `sha256:${'b'.repeat(64)}`)).toThrow(
      /frozen hash/u,
    );
  });
});
