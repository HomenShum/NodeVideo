import './edit.css';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { exportBrowserEditPlan } from './browser-export';
import type { CreatorAgentRequest } from './creator-agent-panel';
import type { PlanningReceipt } from './creator-caseflow';
import { useCreatorCaseflow } from './creator-caseflow';
import {
  type CreatorPreset,
  DEMO_SOURCE_URL,
  createLocalMediaIndex,
  runCreatorPipeline,
  sha256,
} from './creator-pipeline';
import { CreatorWorkspace } from './creator-workspace';

type SourceState = {
  name: string;
  url: string;
  fileName: string;
  blob: Blob;
  durationMs: number;
  width: number;
  height: number;
};

const DEMO_TRANSCRIPT =
  'Most coding agents stop when the code exists. We built NodeVideo so one source can become a clean master, a golden quote, and a launch-ready story. The agent plans the work, specialized tools execute it, and every variant stays reviewable before export.';

function inspectVideo(blob: Blob, url: string, name: string): Promise<SourceState> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () =>
      resolve({
        name,
        url,
        fileName: name.toLowerCase().endsWith('.mp4') ? name : 'source.mp4',
        blob,
        durationMs: Math.max(1, video.duration * 1_000),
        width: video.videoWidth || 1280,
        height: video.videoHeight || 720,
      });
    video.onerror = () =>
      reject(new Error('The selected file could not be read as a browser-playable video.'));
    video.src = url;
  });
}

function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function CreatorPipeline() {
  const caseflow = useCreatorCaseflow();
  const [source, setSource] = useState<SourceState | null>(null);
  const [sourceDigest, setSourceDigest] = useState('');
  const [transcript, setTranscript] = useState(DEMO_TRANSCRIPT);
  const [prompt, setPrompt] = useState(
    'Create a clean master and launch variants. Preserve meaning, keep the strongest source-grounded quote, and show every proposed cut before export.',
  );
  const [preset, setPreset] = useState<CreatorPreset>('founder');
  const [result, setResult] = useState<ReturnType<typeof runCreatorPipeline> | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('Load a source to begin.');
  const [exportRatio, setExportRatio] = useState(0);
  const [version, setVersion] = useState(1);
  const sourceUrlRef = useRef('');
  const selected =
    result?.variants.find((variant) => variant.id === selectedId) ?? result?.variants[0];
  const pendingApprovals =
    selected?.semanticPlan.approvals.filter((item) => item.status === 'required').length ?? 0;

  useEffect(() => {
    if (caseflow.remote) setVersion(caseflow.remote.case.currentArtifactVersion);
  }, [caseflow.remote]);

  const latestConflictId = caseflow.remote?.timeline
    .slice()
    .reverse()
    .find((entry) => entry.kind === 'proposal.conflicted')?._id;
  useEffect(() => {
    if (!latestConflictId || !caseflow.remote) return;
    setStatus(
      `Stale proposal rejected. Canonical project version ${caseflow.remote.case.currentArtifactVersion} remains unchanged.`,
    );
  }, [caseflow.remote, latestConflictId]);

  useEffect(() => {
    if (!source || !sourceDigest || caseflow.remote?.run.currentStage !== 'intake') return;
    void caseflow.markSourceReady(source.name, sourceDigest).catch((error) => {
      setStatus(
        error instanceof Error
          ? `Source is local, but durable stage sync failed: ${error.message}`
          : 'Source is local, but durable stage sync failed.',
      );
    });
  }, [caseflow.markSourceReady, caseflow.remote?.run.currentStage, source, sourceDigest]);

  useEffect(() => {
    if (result || !caseflow.latestProposal?.payloadJson) return;
    try {
      const candidate = JSON.parse(caseflow.latestProposal.payloadJson) as ReturnType<
        typeof runCreatorPipeline
      >;
      if (
        !candidate ||
        !Array.isArray(candidate.variants) ||
        !candidate.variantSet ||
        !candidate.compiledRecipe ||
        !candidate.mediaIndex
      ) {
        setStatus(
          'The durable proposal is preserved, but it is not a reopenable NodeVideo campaign snapshot.',
        );
        return;
      }
      setResult(candidate);
      setSelectedId('');
    } catch {
      setStatus('The durable proposal exists, but its artifact snapshot could not be reopened.');
    }
  }, [caseflow.latestProposal?.payloadJson, result]);

  useEffect(
    () => () => {
      if (sourceUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(sourceUrlRef.current);
    },
    [],
  );

  const loadDemo = async () => {
    setStatus('Loading the bundled rights-cleared demo source…');
    const response = await fetch(DEMO_SOURCE_URL);
    if (!response.ok) throw new Error('The bundled demo source is unavailable.');
    const blob = await response.blob();
    const inspected = await inspectVideo(blob, DEMO_SOURCE_URL, 'nodevideo-demo.mp4');
    setSource(inspected);
    setTranscript(DEMO_TRANSCRIPT);
    const digest = await sha256(blob);
    setSourceDigest(digest);
    setStatus('Demo source ready. Media remains in this tab.');
  };

  const onUpload = async (file?: File) => {
    if (!file) return;
    if (sourceUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(sourceUrlRef.current);
    const url = URL.createObjectURL(file);
    sourceUrlRef.current = url;
    setResult(null);
    const inspected = await inspectVideo(file, url, file.name);
    setSource(inspected);
    const digest = await sha256(file);
    setSourceDigest(digest);
    setStatus(
      'Source ready. Add a transcript for quote-aware variants, or compile from media metadata only.',
    );
  };

  const compile = async (request = prompt) => {
    if (!source) return null;
    setStatus('Indexing once, routing executors, and compiling variants…');
    const hash = await sha256(source.blob);
    const mediaIndex = createLocalMediaIndex({
      assetId: 'asset.creator-source',
      hash,
      durationMs: source.durationMs,
      width: source.width,
      height: source.height,
      transcript,
    });
    const next = runCreatorPipeline({ mediaIndex, preset, prompt: request });
    setResult(next);
    setSelectedId(next.variants[0]?.id ?? '');
    setApproved(new Set());
    setStatus(
      `${next.variants.length} variants compiled from one shared MediaIndex. Review before export.`,
    );
    return next;
  };

  const sendAgentRequest = async (message: string, request: CreatorAgentRequest) => {
    setPrompt(message);
    await caseflow.appendMessage('user', message, { route: request.route, scope: request.scope });
    if (request.route === 'openrouter-free' && !request.externalConsent) {
      const blocked = {
        text: 'External planning consent was not granted. No OpenRouter request was sent and the canonical artifact is unchanged.',
        tools: [],
        meta: 'blocked · consent off · zero external requests',
      };
      await caseflow.appendMessage('assistant', blocked.text, { meta: blocked.meta });
      return blocked;
    }
    if (!source) {
      const blocked = {
        text: 'Attach a source from the vault first. I will keep it local while indexing and will show any proposed external executor before media leaves the device.',
        tools: [],
        meta: 'blocked · no source · no executor started',
      };
      await caseflow.appendMessage('assistant', blocked.text, { meta: blocked.meta });
      return blocked;
    }
    let planner:
      | {
          text: string;
          provider: string;
          model: string;
          inputTokens: number;
          outputTokens: number;
          latencyMs: number;
          costUsd: number;
          operations: Array<{ kind: string; reason: string }>;
        }
      | undefined;
    let plannerFailure = '';
    if (request.route === 'openrouter-free') {
      try {
        const response = await fetch('/api/creator-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request: message,
            transcript: transcript.slice(0, 12_000),
            source: {
              fileName: source.fileName,
              durationMs: source.durationMs,
              width: source.width,
              height: source.height,
            },
            scope: request.scope,
          }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          text?: string;
          provider?: string;
          model?: string;
          plan?: { operations?: Array<{ kind?: string; reason?: string }> };
          inputTokens?: number;
          outputTokens?: number;
          latencyMs?: number;
          costUsd?: number;
          error?: string;
        };
        const operations = payload.plan?.operations?.flatMap((operation) =>
          operation.kind && operation.reason
            ? [{ kind: operation.kind, reason: operation.reason }]
            : [],
        );
        if (
          !response.ok ||
          !payload.ok ||
          !payload.text ||
          !payload.model ||
          !payload.provider ||
          !operations?.length
        ) {
          throw new Error(payload.error ?? 'The free router returned no usable plan.');
        }
        planner = {
          text: payload.text,
          provider: payload.provider,
          model: payload.model,
          inputTokens: payload.inputTokens ?? 0,
          outputTokens: payload.outputTokens ?? 0,
          latencyMs: payload.latencyMs ?? 0,
          costUsd: payload.costUsd ?? 0,
          operations,
        };
      } catch (error) {
        plannerFailure =
          error instanceof Error ? error.message : 'The OpenRouter free route was unavailable.';
      }
    }
    const typedPlanningInput = planner
      ? `${message}\n\nValidated planning operations:\n${planner.operations
          .map((operation) => `${operation.kind}: ${operation.reason}`)
          .join('\n')}`
      : message;
    const next = await compile(typedPlanningInput);
    if (!next) throw new Error('The source could not be compiled.');
    const promptDigest = await sha256(new Blob([message], { type: 'text/plain' }));
    const planningReceipt: PlanningReceipt = {
      requestedRoute:
        request.route === 'openrouter-free' ? 'openrouter/free' : 'local/deterministic',
      resolvedProvider: planner?.provider ?? 'nodevideo',
      resolvedModel: planner?.model ?? 'deterministic-founder-variant-compiler-v2',
      promptDigest,
      inputScope: {
        prompt: true,
        transcript: request.route === 'openrouter-free',
        sourceMetadata: request.route === 'openrouter-free',
        rawMediaUploaded: false,
      },
      tokensIn: planner?.inputTokens ?? 0,
      tokensOut: planner?.outputTokens ?? 0,
      costUsd: planner?.costUsd ?? 0,
      latencyMs: planner?.latencyMs ?? 0,
      result:
        request.route === 'openrouter-free' && !planner ? 'fallback_used' : 'proposal_created',
      ...(plannerFailure ? { fallbackReason: plannerFailure } : {}),
    };
    const proposal = await caseflow.createProposal(next, planningReceipt);
    if (request.route === 'higgsfield') {
      const executorPrompt =
        'A clean cinematic macro shot of a luminous modular video-editing timeline assembling itself from source clips into three aspect-ratio variants, dark studio background, chartreuse interface accents, no people, no logos, no text, smooth controlled camera move';
      const parameters = {
        aspectRatio: '16:9',
        bitrateMode: 'standard',
        duration: 5,
        generateAudio: false,
        genre: 'auto',
        mode: 'fast',
        resolution: '480p',
      };
      const executorPromptDigest = await sha256(new Blob([executorPrompt], { type: 'text/plain' }));
      const parametersDigest = await sha256(
        new Blob([JSON.stringify(parameters)], { type: 'application/json' }),
      );
      await caseflow.proposeExecutor(
        proposal.proposalId,
        {
          schemaVersion: 'nodevideo.executor-input-manifest/v1',
          sourceAssetIds: [source.name],
          promptDigest: executorPromptDigest,
          parametersDigest,
          rawMediaUploaded: false,
        },
        {
          executor: 'higgsfield',
          job: 'seedance_2_0',
          durationSeconds: 5,
          mediaLeavingDevice: [source.name],
          estimatedCredits: 7.5,
          currentBalanceCredits: 10,
          outputUse: 'optional platform-hero variant',
          canonicalVideoAffected: false,
          quotedAt: Date.now(),
        },
      );
    }
    const replyText =
      request.route === 'higgsfield'
        ? `I analyzed the source locally and prepared ${next.variants.length} reviewable variants. Higgsfield is only a proposed executor: no media was uploaded and no credits were spent. Review the edit and obtain a fresh cost-and-egress approval before any cloud generation.`
        : request.route === 'openrouter-free' && planner
          ? `${planner.text}\n\nI validated that plan against NodeVideo’s local media contract and prepared ${next.variants.length} reviewable variants. Nothing has been applied or exported.`
          : request.route === 'openrouter-free'
            ? `The free planning route was unavailable, so I fell back to deterministic local planning: ${plannerFailure} I still prepared ${next.variants.length} reviewable variants without changing or uploading the source.`
            : `I analyzed the source once and prepared ${next.variants.length} reviewable variants. I have not exported or uploaded anything. Accept, reject, or inspect the proposal directly in this thread.`;
    const tools = [
      { name: 'Media index', detail: 'Source metadata and transcript context indexed locally' },
      { name: 'Story planner', detail: 'Source-grounded quote and edit intent compiled' },
      ...(request.route === 'openrouter-free'
        ? [
            {
              name: 'Free model router',
              detail: planner
                ? `${planner.model} resolved in ${planner.latencyMs} ms · ${planner.inputTokens} → ${planner.outputTokens} tokens · $0.00`
                : `Deterministic fallback · ${plannerFailure}`,
            },
          ]
        : []),
      {
        name: 'Executor router',
        detail:
          request.route === 'higgsfield'
            ? 'Higgsfield held behind exact cost, privacy, and media-egress approval'
            : `${next.compiledRecipe.stages.length} stages routed with $${next.compiledRecipe.estimatedCostUsd.toFixed(2)} estimated local cost`,
      },
    ];
    const meta = `${request.route === 'higgsfield' ? 'proposal-only · Higgsfield gated' : request.route === 'openrouter-free' && planner ? `planned · openrouter/free → ${planner.model}` : request.route === 'openrouter-free' ? 'completed · deterministic fallback' : 'completed · deterministic local'} · ${request.scope === 'campaign-variants' ? 'all campaign variants' : 'selected variant'}`;
    await caseflow.appendMessage('assistant', replyText, {
      meta,
      tools,
      planningReceipt: { ...planningReceipt, proposalDigest: proposal.proposalDigest },
      proposalId: proposal.proposalId,
    });
    return {
      text: replyText,
      tools,
      meta,
    };
  };

  const approve = async () => {
    if (!selected || !caseflow.latestProposal) return;
    try {
      const decision = await caseflow.decideProposal(
        caseflow.latestProposal._id,
        caseflow.latestProposal.payloadDigest,
        'approved',
      );
      if (!decision.applied) {
        setStatus(
          `Approval failed closed: this proposal was based on an older artifact version. Project version ${decision.version} remains canonical.`,
        );
        return;
      }
      setResult((current) =>
        current
          ? {
              ...current,
              variants: current.variants.map((variant) =>
                variant.id === selected.id
                  ? {
                      ...variant,
                      semanticPlan: {
                        ...variant.semanticPlan,
                        approvals: variant.semanticPlan.approvals.map((approval) => ({
                          ...approval,
                          status: 'approved' as const,
                        })),
                      },
                    }
                  : variant,
              ),
              variantSet: {
                ...current.variantSet,
                variants: current.variantSet.variants.map((variant) =>
                  variant.id === selected.id
                    ? { ...variant, status: 'accepted' as const }
                    : variant,
                ),
              },
            }
          : current,
      );
      setApproved((current) => new Set(current).add(selected.id));
      setVersion(decision.version);
      setStatus(`${selected.title} approved as project version ${decision.version}.`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Approval failed closed: ${error.message}`
          : 'Approval failed closed before the canonical artifact changed.',
      );
    }
  };

  const restoreDraft = async () => {
    if (!selected || !approved.has(selected.id)) return;
    if (!result) return;
    const candidate = {
      ...result,
      variants: result.variants.map((variant) =>
        variant.id === selected.id
          ? {
              ...variant,
              semanticPlan: {
                ...variant.semanticPlan,
                approvals: variant.semanticPlan.approvals.map((approval) => ({
                  ...approval,
                  status: 'required' as const,
                })),
              },
            }
          : variant,
      ),
      variantSet: {
        ...result.variantSet,
        variants: result.variantSet.variants.map((variant) =>
          variant.id === selected.id ? { ...variant, status: 'awaiting-review' as const } : variant,
        ),
      },
    };
    const promptDigest = await sha256(new Blob(['restore approved draft'], { type: 'text/plain' }));
    await caseflow.createProposal(candidate, {
      requestedRoute: 'local/deterministic',
      resolvedProvider: 'nodevideo',
      resolvedModel: 'deterministic-restore-proposal-v1',
      promptDigest,
      inputScope: {
        prompt: true,
        transcript: false,
        sourceMetadata: false,
        rawMediaUploaded: false,
      },
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: 0,
      result: 'proposal_created',
    });
    setResult(candidate);
    setApproved((current) => {
      const next = new Set(current);
      next.delete(selected.id);
      return next;
    });
    setStatus(
      `${selected.title} restore is now a reviewable proposal against project version ${version}.`,
    );
  };

  const reject = async () => {
    if (!selected || !caseflow.latestProposal) return;
    try {
      await caseflow.decideProposal(
        caseflow.latestProposal._id,
        caseflow.latestProposal.payloadDigest,
        'rejected',
      );
      setResult((current) =>
        current
          ? {
              ...current,
              variants: current.variants.map((variant) =>
                variant.id === selected.id
                  ? {
                      ...variant,
                      semanticPlan: {
                        ...variant.semanticPlan,
                        approvals: variant.semanticPlan.approvals.map((approval) => ({
                          ...approval,
                          status: 'rejected' as const,
                        })),
                      },
                    }
                  : variant,
              ),
              variantSet: {
                ...current.variantSet,
                variants: current.variantSet.variants.map((variant) =>
                  variant.id === selected.id
                    ? { ...variant, status: 'rejected' as const }
                    : variant,
                ),
              },
            }
          : current,
      );
      setApproved((current) => {
        const next = new Set(current);
        next.delete(selected.id);
        return next;
      });
      setStatus(
        `${selected.title} rejected. Ask NodeAgent for a revision against project version ${version}.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Rejection failed closed: ${error.message}`
          : 'Rejection failed before any durable decision was recorded.',
      );
    }
  };

  const exportVariant = async () => {
    if (!source || !selected || !approved.has(selected.id)) return;
    setStatus('Rendering locally with browser FFmpeg. Source media is not uploaded.');
    setExportRatio(0.01);
    try {
      const rendered = await exportBrowserEditPlan(selected.rendererPlan, {
        assetSources: {
          'asset.creator-source': {
            url: source.url,
            fileName: source.fileName.replace(/[^a-zA-Z0-9._-]/gu, '-'),
          },
        },
        fileName: `${selected.output.id}.mp4`,
        onProgress: (progress) => setExportRatio(progress.ratio),
      });
      const url = URL.createObjectURL(rendered.blob);
      await inspectVideo(rendered.blob, url, rendered.fileName);
      const outputDigest = await sha256(rendered.blob);
      const receipt = await caseflow.issueConsumerReceipt({
        schemaVersion: 'nodekit.consumer-proof/v1',
        consumer: 'NodeVideo',
        caseflowContract: 'nodekit.caseflow/v1',
        backend: 'convex',
        journey: 'founder-launch-video',
        caseId: caseflow.locator?.caseId,
        runId: caseflow.remote?.run?._id,
        canonicalArtifactVersion: version,
        proposalDigest: caseflow.latestProposal?.payloadDigest,
        output: {
          fileName: rendered.fileName,
          sha256: outputDigest,
          sizeBytes: rendered.blob.size,
        },
        certificationStatus: 'pending-independent-proof',
        twoSessionReactive: false,
        staleProposalRejected: false,
        exactlyOnceApproval: false,
        reloadPreserved: false,
        exportReopened: true,
        deploymentRevisionBound: Boolean(import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA),
        deploymentRevision: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || null,
        limitations: [
          'Browser export is video-only in the current convenience renderer.',
          'Cross-session reactivity, stale acceptance, exactly-once approval, and reload preservation remain false until the independent release suite binds those observations to this revision.',
        ],
      });
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = rendered.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setStatus(
        `Exported and reopened ${rendered.fileName}. Receipt ${receipt.payloadDigest.slice(0, 18)}… binds the output.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setExportRatio(0);
    }
  };

  const assetUrls = useMemo(() => (source ? { 'asset.creator-source': source.url } : {}), [source]);

  const downloadPlan = () => {
    if (selected) downloadJson(selected.semanticPlan, `${selected.output.id}-edit-plan-v2.json`);
  };

  const downloadReceipt = () => {
    if (!selected || !result) return;
    downloadJson(
      {
        schemaVersion: 'nodevideo.creator-run-receipt.v1',
        status: approved.has(selected.id) ? 'accepted' : 'awaiting-review',
        projectVersion: version,
        mediaIndex: result.mediaIndex,
        intent: result.intent,
        compiledRecipe: result.compiledRecipe,
        variantSet: result.variantSet,
        selectedPlan: selected.semanticPlan,
        limitations: [
          'Browser export omits audio.',
          'Untimed pasted transcripts use low-confidence even distribution.',
          'Higgsfield live cost is not inferred from the website promotion.',
        ],
      },
      `${selected.output.id}-run-receipt.json`,
    );
  };

  const latestExecutor = caseflow.remote?.executorJobs
    .slice()
    .sort((a, b) => b._creationTime - a._creationTime)[0];
  const executorProposal = useMemo(() => {
    if (!latestExecutor) return undefined;
    try {
      const quote = JSON.parse(latestExecutor.quoteJson) as {
        job: string;
        durationSeconds: number;
        mediaLeavingDevice: string[];
        estimatedCredits: number;
        currentBalanceCredits: number;
        outputUse: string;
        canonicalVideoAffected: boolean;
      };
      return {
        id: latestExecutor._id,
        provider: latestExecutor.provider,
        capability: latestExecutor.capability,
        status: latestExecutor.status,
        quoteDigest: latestExecutor.quoteDigest,
        ...quote,
      };
    } catch {
      return undefined;
    }
  }, [latestExecutor]);

  const approveExecutor = async () => {
    if (!latestExecutor) return;
    try {
      await caseflow.approveExecutor(latestExecutor._id, latestExecutor.quoteDigest);
      setStatus('Exact Higgsfield quote approved. No job was submitted and no credits were spent.');
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Executor approval failed closed: ${error.message}`
          : 'Executor approval failed closed.',
      );
    }
  };

  const chooseExecutorAlternative = async (decision: 'decline' | 'local_alternative') => {
    if (!latestExecutor) return;
    try {
      await caseflow.chooseExecutorAlternative(latestExecutor._id, decision);
      setStatus(
        decision === 'decline'
          ? 'Higgsfield proposal declined. No media left the device and no credits were spent.'
          : 'Local alternative selected. The canonical video remains unchanged until its local proposal is approved.',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Executor decision failed closed.');
    }
  };

  return (
    <CreatorWorkspace
      source={source}
      transcript={transcript}
      prompt={prompt}
      preset={preset}
      result={result}
      selected={selected}
      approved={approved}
      status={status}
      exportRatio={exportRatio}
      version={version}
      caseTitle={caseflow.remote?.case.title ?? 'Founder launch video'}
      runStage={caseflow.remote?.run?.currentStage ?? 'intake'}
      caseStatus={
        caseflow.initializationError
          ? `failed · ${caseflow.initializationError}`
          : (caseflow.remote?.case.status ?? 'connecting')
      }
      messages={
        caseflow.remote?.messages.map((message) => ({
          id: message._id,
          role: message.role === 'tool' ? 'assistant' : message.role,
          text: message.text,
          createdAt: message.createdAt,
          ...(message.metadataJson
            ? {
                meta: (() => {
                  try {
                    const metadata = JSON.parse(message.metadataJson) as { meta?: string };
                    return metadata.meta;
                  } catch {
                    return undefined;
                  }
                })(),
              }
            : {}),
        })) ?? []
      }
      caseflowReady={Boolean(caseflow.locator && caseflow.remote?.run)}
      proposalDigest={caseflow.latestProposal?.payloadDigest}
      proposalStatus={caseflow.latestProposal?.status}
      executorProposal={executorProposal}
      assetUrls={assetUrls}
      onUpload={(file) => void onUpload(file)}
      onLoadDemo={() => void loadDemo()}
      onPreset={setPreset}
      onPrompt={setPrompt}
      onTranscript={setTranscript}
      onAgentSend={sendAgentRequest}
      onSelectVariant={setSelectedId}
      onApprove={approve}
      onReject={reject}
      onRestore={restoreDraft}
      onExport={() => void exportVariant()}
      onDownloadPlan={downloadPlan}
      onDownloadReceipt={downloadReceipt}
      onApproveExecutor={() => void approveExecutor()}
      onDeclineExecutor={() => void chooseExecutorAlternative('decline')}
      onUseLocalExecutor={() => void chooseExecutorAlternative('local_alternative')}
    />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Creator pipeline root missing.');
const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) throw new Error('VITE_CONVEX_URL is required for the durable creator workspace.');
const convex = new ConvexReactClient(convexUrl);
createRoot(root).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <CreatorPipeline />
    </ConvexProvider>
  </StrictMode>,
);
