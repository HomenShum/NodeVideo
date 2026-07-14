import type { NodeVideoCheckpoint } from '@/lib/contracts';
import {
  SYNTHETIC_DEMO_DISCLOSURE,
  type SyntheticDemoRuntime,
  createSyntheticDemoRuntime,
  restoreSyntheticDemoRuntime,
} from '@/lib/demo';
import { LocalStorageCheckpointAdapter } from '@/lib/runtime';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type CompareView,
  DEMO_STAGE_LABELS,
  type DisplayStage,
  LAST_RUNTIME_KEY,
  type LocalMedia,
  type MobileView,
  type ProjectMode,
  SYNTHETIC_PROOF_URL,
  downloadJson,
  findProposal,
  inspectLocalFile,
  proposalDecision,
} from './model';

export function useNodeVideoWorkspace() {
  const [mode, setMode] = useState<ProjectMode>('empty');
  const [runtime, setRuntime] = useState<SyntheticDemoRuntime | null>(null);
  const [checkpoint, setCheckpoint] = useState<NodeVideoCheckpoint | null>(null);
  const [localMedia, setLocalMedia] = useState<LocalMedia[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(-1);
  const [compareView, setCompareView] = useState<CompareView>('reconstruction');
  const [mobileView, setMobileView] = useState<MobileView>('canvas');
  const [announcement, setAnnouncement] = useState('');
  const localMediaRef = useRef<LocalMedia[]>([]);

  useEffect(() => {
    try {
      const runtimeId = localStorage.getItem(LAST_RUNTIME_KEY);
      if (!runtimeId) return;
      const saved = new LocalStorageCheckpointAdapter().load(runtimeId);
      if (!saved) return;
      const restored = restoreSyntheticDemoRuntime(saved);
      setRuntime(restored);
      setCheckpoint(restored.snapshot());
      setMode('synthetic');
      setMobileView(saved.stages.length ? 'inspect' : 'canvas');
    } catch {
      localStorage.removeItem(LAST_RUNTIME_KEY);
    }
  }, []);

  useEffect(() => {
    localMediaRef.current = localMedia;
  }, [localMedia]);

  useEffect(
    () => () => {
      for (const media of localMediaRef.current) URL.revokeObjectURL(media.objectUrl);
    },
    [],
  );

  const runComplete = Boolean(checkpoint?.stages.length);
  const proposal = findProposal(checkpoint);
  const decision = proposalDecision(checkpoint, proposal?.id);
  const displayStages = useMemo<DisplayStage[]>(() => {
    if (runComplete && checkpoint) {
      return checkpoint.stages.map((stage) => ({
        kind: stage.kind,
        label: stage.label,
        status: stage.status,
        progress: stage.progress,
      }));
    }
    return DEMO_STAGE_LABELS.map((stage, index) => ({
      ...stage,
      status: isRunning
        ? index < runProgress
          ? 'completed'
          : index === runProgress
            ? 'running'
            : 'pending'
        : 'pending',
      progress: index === runProgress ? 0.72 : index < runProgress ? 1 : 0,
    }));
  }, [checkpoint, isRunning, runComplete, runProgress]);

  const persistRuntime = (selectedRuntime: SyntheticDemoRuntime) => {
    const next = selectedRuntime.saveCheckpoint(new LocalStorageCheckpointAdapter());
    localStorage.setItem(LAST_RUNTIME_KEY, next.runtimeId);
    setCheckpoint(next);
  };

  const clearLocalMedia = () => {
    for (const media of localMediaRef.current) URL.revokeObjectURL(media.objectUrl);
    localMediaRef.current = [];
    setLocalMedia([]);
  };

  const loadDemo = () => {
    clearLocalMedia();
    const nextRuntime = createSyntheticDemoRuntime({ runPipeline: false });
    setRuntime(nextRuntime);
    setCheckpoint(nextRuntime.snapshot());
    setMode('synthetic');
    setRunProgress(-1);
    setCompareView('reconstruction');
    setMobileView('canvas');
    setAnnouncement('Synthetic fixture loaded. The deterministic plan is ready to run.');
  };

  const selectFiles = async (files: FileList | File[]) => {
    const videoFiles = Array.from(files).filter(
      (file) => file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mov'),
    );
    if (!videoFiles.length) {
      setAnnouncement('No video files were selected.');
      return;
    }
    clearLocalMedia();
    setMode('local');
    setRuntime(null);
    setCheckpoint(null);
    setMobileView('canvas');
    setAnnouncement('Reading browser-local metadata. No upload was started.');
    const inspected = await Promise.all(videoFiles.map(inspectLocalFile));
    localMediaRef.current = inspected;
    setLocalMedia(inspected);
    setAnnouncement(
      `${inspected.length} local video ${inspected.length === 1 ? 'is' : 'are'} ready to preview.`,
    );
  };

  const run = async () => {
    if (!runtime || isRunning || runComplete) return;
    setIsRunning(true);
    setAnnouncement('Running the deterministic synthetic fixture.');
    const finalCheckpoint = runtime.runSyntheticPipeline();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (let index = 0; index < DEMO_STAGE_LABELS.length; index += 1) {
      setRunProgress(index);
      if (!reduceMotion) await new Promise((resolve) => window.setTimeout(resolve, 90));
    }
    setRunProgress(DEMO_STAGE_LABELS.length);
    setCheckpoint(finalCheckpoint);
    persistRuntime(runtime);
    setIsRunning(false);
    setMobileView(window.innerWidth <= 1024 ? 'inspect' : 'canvas');
    setAnnouncement('Synthetic proof complete. A recipe proposal is waiting for review.');
  };

  const accept = () => {
    if (!runtime || !proposal || runtime.proposalStatus(proposal.id) !== 'pending') return;
    runtime.acceptProposal(proposal.id, 'Accepted in the NodeVideo review panel.');
    persistRuntime(runtime);
    setAnnouncement('Proposal accepted. Recipe version 2 was appended.');
  };

  const decline = () => {
    if (!runtime || !proposal || runtime.proposalStatus(proposal.id) !== 'pending') return;
    runtime.declineProposal(proposal.id, 'Declined in the NodeVideo review panel.');
    persistRuntime(runtime);
    setAnnouncement('Proposal declined. Recipe version 1 remains active.');
  };

  const restore = (recipeId: string, version: number) => {
    if (!runtime) return;
    runtime.restoreVersion(recipeId, version, `Restored version ${version} from history.`);
    persistRuntime(runtime);
    setAnnouncement(`Version ${version} was restored as a new append-only recipe version.`);
  };

  const downloadManifest = () => {
    downloadJson('nodevideo-local-manifest.json', {
      schema: 'nodevideo.local-manifest.v1',
      disclosure: 'Browser metadata only. No media bytes are included.',
      generatedAt: new Date().toISOString(),
      assets: localMedia.map((media) => ({
        name: media.file.name,
        type: media.file.type || 'unknown',
        sizeBytes: media.file.size,
        lastModified: media.file.lastModified,
        durationMs: media.durationMs ?? null,
        width: media.width ?? null,
        height: media.height ?? null,
        metadataError: media.error ?? null,
      })),
      unavailableInBrowser: ['frame rate', 'rotation tag', 'HDR transfer metadata', 'content hash'],
    });
  };

  const downloadReceipt = () => {
    if (!checkpoint) return;
    downloadJson('nodevideo-run-receipt.json', {
      schema: 'nodevideo.run-receipt.v1',
      disclosure: SYNTHETIC_DEMO_DISCLOSURE,
      checkpoint,
      publicMediaProof: SYNTHETIC_PROOF_URL,
    });
  };

  return {
    state: {
      mode,
      checkpoint,
      localMedia,
      isRunning,
      runComplete,
      displayStages,
      compareView,
      mobileView,
      announcement,
      proposal,
      decision,
    },
    actions: {
      setCompareView,
      setMobileView,
      loadDemo,
      selectFiles,
      run,
      accept,
      decline,
      restore,
      downloadManifest,
      downloadReceipt,
    },
  };
}
