import type { CreatorExecutionRoute, CreatorWriteScope } from './creator-agent-panel';

export type CreatorApprovalMode = 'auto-safe' | 'ask';

export type AutoApprovalDecision = {
  action: 'apply' | 'review';
  reason: string;
};

export function decideCreatorAutoApproval(input: {
  mode: CreatorApprovalMode;
  route: CreatorExecutionRoute;
  scope: CreatorWriteScope;
  pendingMeaningApprovals: number;
}): AutoApprovalDecision {
  if (input.mode === 'ask') {
    return { action: 'review', reason: 'Ask mode keeps every proposal pending.' };
  }
  if (input.route === 'openrouter-free') {
    return {
      action: 'review',
      reason: 'External-model plans remain reviewable after the separate egress consent.',
    };
  }
  if (input.route === 'higgsfield') {
    return {
      action: 'review',
      reason: 'Cloud media egress and paid execution always require exact approval.',
    };
  }
  if (input.scope === 'campaign-variants') {
    return {
      action: 'review',
      reason: 'A campaign-wide change requires review before changing the canonical version.',
    };
  }
  if (input.pendingMeaningApprovals > 0) {
    return {
      action: 'review',
      reason: `${input.pendingMeaningApprovals} meaning-sensitive edit${input.pendingMeaningApprovals === 1 ? '' : 's'} need review.`,
    };
  }
  return {
    action: 'apply',
    reason: 'Safe local single-variant proposal can be applied and restored from version history.',
  };
}
