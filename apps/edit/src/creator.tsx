import './edit.css';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { exportBrowserEditPlan } from './browser-export';
import type { CreatorAgentRequest } from './creator-agent-panel';
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
  const [source, setSource] = useState<SourceState | null>(null);
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
    setStatus('Demo source ready. Media remains in this tab.');
  };

  const onUpload = async (file?: File) => {
    if (!file) return;
    if (sourceUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(sourceUrlRef.current);
    const url = URL.createObjectURL(file);
    sourceUrlRef.current = url;
    setResult(null);
    setSource(await inspectVideo(file, url, file.name));
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
    if (!source) {
      return {
        text: 'Attach a source from the vault first. I will keep it local while indexing and will show any proposed external executor before media leaves the device.',
        tools: [],
        meta: 'blocked · no source · no executor started',
      };
    }
    let planner:
      | {
          text: string;
          model: string;
          inputTokens: number;
          outputTokens: number;
          latencyMs: number;
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
          model?: string;
          inputTokens?: number;
          outputTokens?: number;
          latencyMs?: number;
          error?: string;
        };
        if (!response.ok || !payload.ok || !payload.text || !payload.model) {
          throw new Error(payload.error ?? 'The free router returned no usable plan.');
        }
        planner = {
          text: payload.text,
          model: payload.model,
          inputTokens: payload.inputTokens ?? 0,
          outputTokens: payload.outputTokens ?? 0,
          latencyMs: payload.latencyMs ?? 0,
        };
      } catch (error) {
        plannerFailure =
          error instanceof Error ? error.message : 'The OpenRouter free route was unavailable.';
      }
    }
    const next = await compile(message);
    if (!next) throw new Error('The source could not be compiled.');
    return {
      text:
        request.route === 'higgsfield'
          ? `I analyzed the source locally and prepared ${next.variants.length} reviewable variants. Higgsfield is only a proposed executor: no media was uploaded and no credits were spent. Review the edit and obtain a fresh cost-and-egress approval before any cloud generation.`
          : request.route === 'openrouter-free' && planner
            ? `${planner.text}\n\nI validated that plan against NodeVideo’s local media contract and prepared ${next.variants.length} reviewable variants. Nothing has been applied or exported.`
            : request.route === 'openrouter-free'
              ? `The free planning route was unavailable, so I fell back to deterministic local planning: ${plannerFailure} I still prepared ${next.variants.length} reviewable variants without changing or uploading the source.`
              : `I analyzed the source once and prepared ${next.variants.length} reviewable variants. I have not exported or uploaded anything. Accept, reject, or inspect the proposal directly in this thread.`,
      tools: [
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
      ],
      meta: `${request.route === 'higgsfield' ? 'proposal-only · Higgsfield gated' : request.route === 'openrouter-free' && planner ? `planned · openrouter/free → ${planner.model}` : request.route === 'openrouter-free' ? 'completed · deterministic fallback' : 'completed · deterministic local'} · ${request.scope === 'campaign-variants' ? 'all campaign variants' : 'selected variant'}`,
    };
  };

  const approve = () => {
    if (!selected) return;
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
                variant.id === selected.id ? { ...variant, status: 'accepted' as const } : variant,
              ),
            },
          }
        : current,
    );
    setApproved((current) => new Set(current).add(selected.id));
    setVersion((current) => current + 1);
    setStatus(`${selected.title} approved as project version ${version + 1}.`);
  };

  const restoreDraft = () => {
    if (!selected || !approved.has(selected.id)) return;
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
                        status: 'required' as const,
                      })),
                    },
                  }
                : variant,
            ),
            variantSet: {
              ...current.variantSet,
              variants: current.variantSet.variants.map((variant) =>
                variant.id === selected.id
                  ? { ...variant, status: 'awaiting-review' as const }
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
    setVersion((current) => current + 1);
    setStatus(`${selected.title} restored to review as project version ${version + 1}.`);
  };

  const reject = () => {
    if (!selected) return;
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
                variant.id === selected.id ? { ...variant, status: 'rejected' as const } : variant,
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
    setVersion((current) => current + 1);
    setStatus(
      `${selected.title} rejected. Ask NodeAgent for a revision against project version ${version + 1}.`,
    );
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
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = rendered.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setStatus(
        `Exported ${rendered.fileName}. Browser convenience renders are currently video-only; the receipt says so explicitly.`,
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
    />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Creator pipeline root missing.');
createRoot(root).render(
  <StrictMode>
    <CreatorPipeline />
  </StrictMode>,
);
