import { describe, expect, it } from 'vitest';
import {
  assignCreatorDisjointSplits,
  assignIsolationDisjointSplits,
} from './creatorbench-splits.mjs';

const stable = (value) => Number(value.replace(/\D/gu, '') || 0);

describe('CreatorBench split assignment', () => {
  it('prefers distinct creators and domains for small held-out splits', () => {
    const records = [
      ...[1, 2, 3].map((id) => ({ creatorId: 'creator:1', domain: `shared-${id}` })),
      { creatorId: 'creator:2', domain: 'talking-head' },
      { creatorId: 'creator:3', domain: 'sports' },
      { creatorId: 'creator:4', domain: 'animals' },
      { creatorId: 'creator:5', domain: 'products' },
      { creatorId: 'creator:6', domain: 'education' },
      { creatorId: 'creator:7', domain: 'music' },
      { creatorId: 'creator:8', domain: 'nature' },
    ];
    const assignment = assignCreatorDisjointSplits(
      records,
      { development: 50, 'public-test': 20, 'private-heldout': 20, adversarial: 10 },
      stable,
    );
    const privateRecords = records.filter(
      (record) => assignment.get(record.creatorId) === 'private-heldout',
    );
    expect(privateRecords).toHaveLength(2);
    expect(new Set(privateRecords.map((record) => record.creatorId)).size).toBe(2);
    expect(new Set(privateRecords.map((record) => record.domain)).size).toBe(2);
  });

  it('never assigns one creator to multiple splits', () => {
    const records = Array.from({ length: 20 }, (_, index) => ({
      creatorId: `creator:${Math.floor(index / 2)}`,
      domain: `domain:${index % 5}`,
    }));
    const assignment = assignCreatorDisjointSplits(
      records,
      { development: 50, 'public-test': 20, 'private-heldout': 20, adversarial: 10 },
      stable,
    );
    expect(assignment.size).toBe(10);
    expect([...assignment.values()].every(Boolean)).toBe(true);
  });

  it('keeps visually near-duplicate sources in the same split', () => {
    const records = [
      {
        id: 'source:1',
        creatorId: 'creator:1',
        relatedSourceGroup: 'group:1',
        sourceSha256: 'hash:1',
        visualPerceptualHash: '0000000000000000',
        audioFingerprint: 'no-audio',
        domain: 'nature',
      },
      {
        id: 'source:2',
        creatorId: 'creator:2',
        relatedSourceGroup: 'group:2',
        sourceSha256: 'hash:2',
        visualPerceptualHash: '0000000000000003',
        audioFingerprint: 'no-audio',
        domain: 'science',
      },
      ...Array.from({ length: 18 }, (_, index) => ({
        id: `source:${index + 3}`,
        creatorId: `creator:${index + 3}`,
        relatedSourceGroup: `group:${index + 3}`,
        sourceSha256: `hash:${index + 3}`,
        visualPerceptualHash: (BigInt(index + 10) << 16n).toString(16).padStart(16, '0'),
        audioFingerprint: 'no-audio',
        domain: `domain:${index % 5}`,
      })),
    ];
    const assignment = assignIsolationDisjointSplits(
      records,
      { development: 50, 'public-test': 20, 'private-heldout': 20, adversarial: 10 },
      stable,
    );
    expect(assignment.get('source:1')).toBe(assignment.get('source:2'));
  });
});
