import { describe, expect, it, vi } from 'vitest';
import {
  CreatorBenchReviewClient,
  type DurableReviewInput,
  type ReviewBackend,
} from './creatorbench-review-client';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const input: DurableReviewInput = {
  benchmarkVersion: 'creatorbench-v1.3',
  instanceId: 'instance:public:1',
  resultId: 'result:public:1',
  split: 'public-test',
  blindedVariantIds: ['variant:a', 'variant:b'],
  usability: 'usable_after_minor_correction',
  correctionTimeSeconds: 18,
  reasonCodes: ['wrong_subject'],
  explicitOptIn: true,
};

function backend(): ReviewBackend {
  const records: Array<Record<string, unknown>> = [];
  return {
    claimAssignment: vi.fn(async (args) => {
      records.push({ ...args, status: 'assigned', blind: true });
    }),
    submitReview: vi.fn(async (args) => {
      const record = records.find((item) => item.assignmentId === args.assignmentId);
      if (record) Object.assign(record, args, { status: 'completed' });
    }),
    listReviewerHistory: vi.fn(async ({ reviewerRef }) =>
      records.filter((item) => item.reviewerRef === reviewerRef),
    ) as ReviewBackend['listReviewerHistory'],
    deleteReviewerData: vi.fn(async ({ reviewerRef }) => {
      records.splice(0, records.length);
      return { deletedCount: 1, deletedAt: Date.now(), reviewerRef };
    }),
  };
}

describe('CreatorBench review client', () => {
  it('requires explicit opt-in before creating an identity or contacting the backend', async () => {
    const transport = backend();
    const storage = new MemoryStorage();
    const client = new CreatorBenchReviewClient(transport, storage);
    await expect(client.submit({ ...input, explicitOptIn: false })).rejects.toThrow(/opt-in/u);
    expect(transport.claimAssignment).not.toHaveBeenCalled();
    expect(storage.length).toBe(0);
  });

  it('persists a pseudonymous blinded review and verifies the completed record', async () => {
    const transport = backend();
    const client = new CreatorBenchReviewClient(transport, new MemoryStorage());
    const result = await client.submit(input);
    expect(result.reviewerRef).toMatch(/^reviewer:[a-f\d]{32}$/u);
    expect(result.confirmed).toMatchObject({ blind: true, status: 'completed' });
    expect(transport.claimAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ consentVersion: 'creatorbench-review-consent/v1' }),
    );
  });

  it('fails closed when the backend is unavailable', async () => {
    const client = new CreatorBenchReviewClient(null, new MemoryStorage());
    await expect(client.submit(input)).rejects.toThrow(/backend unavailable/u);
  });

  it('exports pseudonymous history and verifies deletion before clearing local identity', async () => {
    const storage = new MemoryStorage();
    const client = new CreatorBenchReviewClient(backend(), storage);
    await client.submit(input);
    const exported = JSON.parse(await client.exportHistory());
    expect(exported.reviewerRef).toMatch(/^reviewer:/u);
    expect(exported.records).toHaveLength(1);
    const receipt = await client.deleteAll();
    expect(receipt.deletedCount).toBe(1);
    expect(storage.length).toBe(0);
  });

  it('rejects hidden target and private locator hints in blind variant identifiers', async () => {
    const client = new CreatorBenchReviewClient(backend(), new MemoryStorage());
    await expect(
      client.submit({ ...input, blindedVariantIds: ['private-heldout-target-hint'] }),
    ).rejects.toThrow(/prohibited/u);
  });
});
