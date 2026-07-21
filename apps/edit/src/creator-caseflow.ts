import { useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

const LOCATOR_KEY = 'nodevideo.creator.caseflow-locator.v1';

type Locator = {
  caseId: Id<'cases'>;
  runId?: Id<'runs'>;
  threadId?: Id<'agentThreads'>;
  ownerKey: string;
};

export type PlanningReceipt = {
  requestedRoute: 'openrouter/free' | 'local/deterministic';
  resolvedProvider: string;
  resolvedModel: string;
  promptDigest: string;
  inputScope: {
    prompt: boolean;
    transcript: boolean;
    sourceMetadata: boolean;
    rawMediaUploaded: boolean;
  };
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  result: 'proposal_created' | 'fallback_used' | 'rejected' | 'failed';
  fallbackReason?: string;
  proposalDigest?: string;
};

function readLocator(): Locator | null {
  const hashParams = new URLSearchParams(location.hash.replace(/^#/u, ''));
  const queryParams = new URLSearchParams(location.search);
  const params = hashParams.has('case') ? hashParams : queryParams;
  const caseId = params.get('case');
  const ownerKey = params.get('access');
  try {
    const stored = JSON.parse(localStorage.getItem(LOCATOR_KEY) ?? 'null') as Locator | null;
    if (caseId && ownerKey) {
      return {
        ...(stored?.caseId === caseId ? stored : {}),
        caseId: caseId as Id<'cases'>,
        ownerKey,
      };
    }
    return stored?.caseId && stored?.ownerKey ? stored : null;
  } catch {
    return null;
  }
}

function saveLocator(locator: Locator) {
  localStorage.setItem(LOCATOR_KEY, JSON.stringify(locator));
  const url = new URL(location.href);
  url.searchParams.delete('case');
  url.searchParams.delete('access');
  url.hash = new URLSearchParams({ case: locator.caseId, access: locator.ownerKey }).toString();
  history.replaceState(null, '', url);
}

export function useCreatorCaseflow() {
  const [locator, setLocator] = useState<Locator | null>(readLocator);
  const [initializationError, setInitializationError] = useState('');
  const createCampaign = useMutation(api.caseflow.createCampaign);
  const appendMessageMutation = useMutation(api.caseflow.appendMessage);
  const markSourceReadyMutation = useMutation(api.caseflow.markSourceReady);
  const createProposalMutation = useMutation(api.caseflow.createEditProposal);
  const decideProposalMutation = useMutation(api.caseflow.decideProposal);
  const issueReceiptMutation = useMutation(api.caseflow.issueConsumerReceipt);
  const proposeExecutorMutation = useMutation(api.caseflow.proposeExecutorJob);
  const approveExecutorMutation = useMutation(api.caseflow.approveExecutorJob);
  const chooseExecutorAlternativeMutation = useMutation(api.caseflow.chooseExecutorAlternative);
  const remote = useQuery(
    api.caseflow.getCampaign,
    locator ? { caseId: locator.caseId, ownerKey: locator.ownerKey } : 'skip',
  );

  useEffect(() => {
    if (locator) return;
    let cancelled = false;
    const ownerKey = crypto.randomUUID();
    const idempotencyKey = `founder-launch:${ownerKey}`;
    void createCampaign({
      ownerKey,
      idempotencyKey,
      title: 'Founder launch video',
      brief:
        'Turn one product recording into reviewable landscape, vertical, and square launch outputs.',
    })
      .then((created) => {
        if (cancelled) return;
        const next = { ...created, ownerKey };
        saveLocator(next);
        setLocator(next);
      })
      .catch((error) => {
        if (!cancelled)
          setInitializationError(
            error instanceof Error ? error.message : 'Caseflow initialization failed.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [createCampaign, locator]);

  const appendMessage = useCallback(
    async (
      role: 'user' | 'assistant' | 'tool',
      text: string,
      metadata?: Record<string, unknown>,
    ) => {
      if (!locator || !remote?.run) throw new Error('Caseflow is still initializing.');
      return appendMessageMutation({
        caseId: locator.caseId,
        ownerKey: locator.ownerKey,
        runId: remote.run._id,
        role,
        text,
        ...(metadata ? { metadata } : {}),
      });
    },
    [appendMessageMutation, locator, remote?.run],
  );

  const markSourceReady = useCallback(
    async (sourceName: string, sourceDigest: string) => {
      if (!locator || !remote?.run) throw new Error('The durable case is not ready.');
      return markSourceReadyMutation({
        caseId: locator.caseId,
        ownerKey: locator.ownerKey,
        runId: remote.run._id,
        sourceName,
        sourceDigest,
      });
    },
    [locator, markSourceReadyMutation, remote?.run],
  );

  const createProposal = useCallback(
    async (snapshot: unknown, planningReceipt: PlanningReceipt) => {
      if (!locator || !remote?.run) throw new Error('The durable case is not ready.');
      return createProposalMutation({
        caseId: locator.caseId,
        ownerKey: locator.ownerKey,
        runId: remote.run._id,
        expectedArtifactVersion: remote.case.currentArtifactVersion,
        snapshot,
        planningReceipt,
      });
    },
    [createProposalMutation, locator, remote],
  );

  const decideProposal = useCallback(
    async (
      proposalId: Id<'proposals'>,
      expectedDigest: string,
      decision: 'approved' | 'rejected',
    ) => {
      if (!locator || !remote?.run) throw new Error('The durable case is not ready.');
      return decideProposalMutation({
        caseId: locator.caseId,
        ownerKey: locator.ownerKey,
        runId: remote.run._id,
        proposalId,
        expectedDigest,
        decision,
        actorRef: 'case-owner',
      });
    },
    [decideProposalMutation, locator, remote?.run],
  );

  const issueConsumerReceipt = useCallback(
    async (payload: unknown) => {
      if (!locator || !remote?.run) throw new Error('The durable case is not ready.');
      return issueReceiptMutation({
        caseId: locator.caseId,
        ownerKey: locator.ownerKey,
        runId: remote.run._id,
        payload,
      });
    },
    [issueReceiptMutation, locator, remote?.run],
  );

  const proposeExecutor = useCallback(
    async (
      proposalId: Id<'proposals'>,
      inputManifest: {
        schemaVersion: 'nodevideo.executor-input-manifest/v1';
        sourceAssetIds: string[];
        promptDigest: string;
        parametersDigest: string;
        rawMediaUploaded: false;
      },
      quote: {
        executor: string;
        job: string;
        durationSeconds: number;
        mediaLeavingDevice: string[];
        estimatedCredits: number;
        currentBalanceCredits: number;
        outputUse: string;
        canonicalVideoAffected: false;
        quotedAt: number;
      },
    ) => {
      if (!locator || !remote?.run) throw new Error('The durable case is not ready.');
      return proposeExecutorMutation({
        caseId: locator.caseId,
        ownerKey: locator.ownerKey,
        runId: remote.run._id,
        proposalId,
        provider: quote.executor,
        capability: quote.job,
        inputManifest,
        quote,
      });
    },
    [locator, proposeExecutorMutation, remote?.run],
  );

  const approveExecutor = useCallback(
    async (executorJobId: Id<'executorJobs'>, expectedQuoteDigest: string) => {
      if (!locator) throw new Error('The durable case is not ready.');
      return approveExecutorMutation({
        caseId: locator.caseId,
        ownerKey: locator.ownerKey,
        executorJobId,
        expectedQuoteDigest,
      });
    },
    [approveExecutorMutation, locator],
  );

  const chooseExecutorAlternative = useCallback(
    async (executorJobId: Id<'executorJobs'>, decision: 'decline' | 'local_alternative') => {
      if (!locator) throw new Error('The durable case is not ready.');
      return chooseExecutorAlternativeMutation({
        caseId: locator.caseId,
        ownerKey: locator.ownerKey,
        executorJobId,
        decision,
      });
    },
    [chooseExecutorAlternativeMutation, locator],
  );

  const latestProposal = useMemo(
    () => remote?.proposals.slice().sort((a, b) => b._creationTime - a._creationTime)[0],
    [remote?.proposals],
  );
  const latestVersion = useMemo(
    () =>
      remote?.versions
        .slice()
        .sort((a, b) => b.version - a.version || b._creationTime - a._creationTime)[0],
    [remote?.versions],
  );

  return {
    locator,
    remote,
    latestProposal,
    latestVersion,
    initializationError,
    appendMessage,
    markSourceReady,
    createProposal,
    decideProposal,
    proposeExecutor,
    approveExecutor,
    chooseExecutorAlternative,
    issueConsumerReceipt,
  };
}
