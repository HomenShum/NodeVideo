import { describe, expect, it } from 'vitest';
import {
  collectRepositoryFixtureCandidates,
  repositoryFixtureDefinitions,
} from './repository-fixtures.mjs';

describe('CreatorBench repository fixtures', () => {
  it('verifies retained hashes before admitting generated fixtures', async () => {
    const candidates = await collectRepositoryFixtureCandidates();
    expect(candidates).toHaveLength(4);
    expect(candidates.every((candidate) => candidate.permittedRedistribution)).toBe(true);
    expect(candidates.every((candidate) => candidate.sourceUrl.startsWith('repository://'))).toBe(
      true,
    );
  });

  it('covers the two previously absent workflow families', () => {
    const workflows = new Set(
      repositoryFixtureDefinitions.flatMap((definition) => definition.admissibleWorkflows),
    );
    expect(workflows.has('dance-choreography')).toBe(true);
    expect(workflows.has('founder-product-launch')).toBe(true);
  });
});
