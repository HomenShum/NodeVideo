import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical';

// The agent digest and the server digest (convex/lib/durability.ts) must agree,
// so the agent must sort keys by code unit exactly like Object.keys().sort().
function serverKeyOrder(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}

describe('canonicalJson key ordering', () => {
  it('matches the server code-unit sort for mixed-case keys', () => {
    const value = { a: 1, B: 2, aa: 3, Ab: 4 };
    const orderInOutput = [...canonicalJson(value).matchAll(/"([^"]+)":/g)].map((m) => m[1]);
    expect(orderInOutput).toEqual(serverKeyOrder(value));
    // Sanity: this is code-unit order (uppercase before lowercase), not locale order.
    expect(orderInOutput).toEqual(['Ab', 'B', 'a', 'aa']);
  });

  it('is stable and deterministic across nested objects', () => {
    const value = { Z: { b: 1, A: 2 }, a: [3, 2, 1] };
    expect(canonicalJson(value)).toBe('{"Z":{"A":2,"b":1},"a":[3,2,1]}');
  });
});
