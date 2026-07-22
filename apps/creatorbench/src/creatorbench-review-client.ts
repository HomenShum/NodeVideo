import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';

export const REVIEW_CONSENT_VERSION = 'creatorbench-review-consent/v1';
export const REVIEW_DELETE_CONFIRMATION = 'DELETE MY CREATORBENCH REVIEWS';

const SEED_KEY = 'nodevideo.creatorbench.reviewer-seed/v1';
const COMPLETED_PREFIX = 'nodevideo.creatorbench.completed/v1:';

export type ReviewUsability =
  | 'usable_as_is'
  | 'usable_after_minor_correction'
  | 'requires_major_correction'
  | 'unusable'
  | 'unsafe_or_rights_invalid';

export type ReviewSplit = 'development' | 'public-test' | 'adversarial';

export type DurableReviewInput = {
  benchmarkVersion: string;
  instanceId: string;
  resultId: string;
  split: ReviewSplit;
  variantId?: string;
  blindedVariantIds: string[];
  usability: ReviewUsability;
  correctionTimeSeconds: number;
  reasonCodes: string[];
  correctnessIssues?: string[];
  missedSubjectOrContent?: string[];
  unwantedEdits?: string[];
  preferredVariantId?: string;
  agreementMode?: boolean;
  agreementRoundId?: string;
  explicitOptIn: boolean;
};

export type ReviewHistoryRecord = {
  assignmentId?: string;
  instanceId?: string;
  resultId?: string;
  reviewerRef?: string;
  status?: string;
  blind?: boolean;
  usability?: ReviewUsability;
  correctionTimeSeconds?: number;
  reasonCodes?: string[];
  completedAt?: number;
};

export interface ReviewBackend {
  claimAssignment(args: {
    benchmarkVersion: string;
    instanceId: string;
    resultId: string;
    split: ReviewSplit;
    reviewerRef: string;
    assignmentId: string;
    variantId?: string;
    blindedVariantOrderJson: string;
    agreementMode: boolean;
    agreementRoundId?: string;
    consentVersion: string;
  }): Promise<unknown>;
  submitReview(args: {
    assignmentId: string;
    reviewerRef: string;
    usability: ReviewUsability;
    correctionTimeSeconds: number;
    reasonCodes: string[];
    correctnessIssues: string[];
    missedSubjectOrContent: string[];
    unwantedEdits: string[];
    preferredVariantId?: string;
  }): Promise<unknown>;
  listReviewerHistory(args: { reviewerRef: string }): Promise<ReviewHistoryRecord[]>;
  deleteReviewerData(args: {
    reviewerRef: string;
    confirmReviewerRef: string;
    confirmation: string;
  }): Promise<{ deletedCount: number; deletedAt: number; reviewerRef: string }>;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'length' | 'key'>;

export function createConvexReviewBackend(deploymentUrl: string | undefined): ReviewBackend | null {
  if (!deploymentUrl?.trim()) return null;
  const client = new ConvexHttpClient(deploymentUrl);
  const lifecycle = (api as any).creatorbenchReviewLifecycle;
  return {
    claimAssignment: (args) => client.mutation(lifecycle.claimAssignment, args),
    submitReview: (args) => client.mutation(lifecycle.submitReview, args),
    listReviewerHistory: (args) => client.query(lifecycle.listReviewerHistory, args),
    deleteReviewerData: (args) => client.mutation(lifecycle.deleteReviewerData, args),
  };
}

export class CreatorBenchReviewClient {
  constructor(
    private readonly backend: ReviewBackend | null,
    private readonly storage: StorageLike,
  ) {}

  get available() {
    return this.backend !== null;
  }

  async submit(input: DurableReviewInput) {
    if (!input.explicitOptIn) throw new Error('Explicit review opt-in is required.');
    const backend = this.requireBackend();
    validateInput(input);
    const reviewerRef = await this.reviewerRef(true);
    const completedKey = `${COMPLETED_PREFIX}${input.benchmarkVersion}:${input.instanceId}`;
    if (this.storage.getItem(completedKey) && !input.agreementMode) {
      throw new Error('This reviewer already evaluated the case.');
    }
    const assignmentId = `assignment:${await digestHex(
      [
        input.benchmarkVersion,
        input.instanceId,
        reviewerRef,
        input.agreementMode ? input.agreementRoundId : 'primary',
      ].join(':'),
    )}`;
    await backend.claimAssignment({
      benchmarkVersion: input.benchmarkVersion,
      instanceId: input.instanceId,
      resultId: input.resultId,
      split: input.split,
      reviewerRef,
      assignmentId,
      variantId: input.variantId,
      blindedVariantOrderJson: JSON.stringify(input.blindedVariantIds),
      agreementMode: Boolean(input.agreementMode),
      agreementRoundId: input.agreementRoundId,
      consentVersion: REVIEW_CONSENT_VERSION,
    });
    await backend.submitReview({
      assignmentId,
      reviewerRef,
      usability: input.usability,
      correctionTimeSeconds: input.correctionTimeSeconds,
      reasonCodes: uniqueBounded(input.reasonCodes, 12),
      correctnessIssues: uniqueBounded(input.correctnessIssues ?? [], 24),
      missedSubjectOrContent: uniqueBounded(input.missedSubjectOrContent ?? [], 24),
      unwantedEdits: uniqueBounded(input.unwantedEdits ?? [], 24),
      preferredVariantId: input.preferredVariantId,
    });
    const history = await backend.listReviewerHistory({ reviewerRef });
    const confirmed = history.find(
      (review) => review.assignmentId === assignmentId && review.status === 'completed',
    );
    if (!confirmed) {
      throw new Error('Review write could not be verified. Draft remains unsaved.');
    }
    this.storage.setItem(completedKey, assignmentId);
    return { assignmentId, reviewerRef, confirmed };
  }

  async exportHistory() {
    const backend = this.requireBackend();
    const reviewerRef = await this.reviewerRef(false);
    if (!reviewerRef) throw new Error('No local pseudonymous reviewer identity exists.');
    const records = await backend.listReviewerHistory({ reviewerRef });
    return JSON.stringify(
      {
        schemaVersion: 'nodevideo.creatorbench-review-export/v1',
        exportedAt: new Date().toISOString(),
        reviewerRef,
        records,
      },
      null,
      2,
    );
  }

  async deleteAll() {
    const backend = this.requireBackend();
    const reviewerRef = await this.reviewerRef(false);
    if (!reviewerRef) throw new Error('No local pseudonymous reviewer identity exists.');
    const receipt = await backend.deleteReviewerData({
      reviewerRef,
      confirmReviewerRef: reviewerRef,
      confirmation: REVIEW_DELETE_CONFIRMATION,
    });
    const remaining = await backend.listReviewerHistory({ reviewerRef });
    if (remaining.length > 0) throw new Error('Reviewer deletion could not be verified.');
    this.clearLocal();
    return receipt;
  }

  clearLocal() {
    const remove: string[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (key === SEED_KEY || key?.startsWith(COMPLETED_PREFIX)) remove.push(key);
    }
    for (const key of remove) this.storage.removeItem(key);
  }

  private requireBackend(): ReviewBackend {
    if (!this.backend) throw new Error('Review backend unavailable. Draft was not saved.');
    return this.backend;
  }

  private async reviewerRef(create: boolean): Promise<string | null> {
    let seed = this.storage.getItem(SEED_KEY);
    if (!seed && create) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      seed = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      this.storage.setItem(SEED_KEY, seed);
    }
    return seed ? `reviewer:${(await digestHex(seed)).slice(0, 32)}` : null;
  }
}

function validateInput(input: DurableReviewInput) {
  if (!input.instanceId || !input.resultId) throw new Error('Review assignment is incomplete.');
  if (!Number.isFinite(input.correctionTimeSeconds) || input.correctionTimeSeconds < 0) {
    throw new Error('Correction time must be a non-negative number of seconds.');
  }
  if (
    input.blindedVariantIds.some((value) => /(target|hint|private|heldout|locator)/iu.test(value))
  ) {
    throw new Error('Blind assignment contains a prohibited target or private locator hint.');
  }
  if (input.agreementMode && !input.agreementRoundId) {
    throw new Error('Agreement mode requires an agreement round ID.');
  }
}

function uniqueBounded(values: string[], limit: number) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

async function digestHex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
