import type {
  NodeVideoCheckpoint,
  NodeVideoStageKind,
  RecipeProposalArtifact,
} from '@/lib/contracts';

export const SYNTHETIC_VIDEO_URL = new URL(
  '../../../fixtures/media/nodevideo-proof-v1.mp4',
  import.meta.url,
).href;

export const SYNTHETIC_PROOF_URL = new URL(
  '../../../fixtures/media/nodevideo-proof-v1.proof.json',
  import.meta.url,
).href;

export const LAST_RUNTIME_KEY = 'nodevideo:last-runtime-id';

export type ProjectMode = 'empty' | 'synthetic' | 'local';
export type MobileView = 'project' | 'canvas' | 'inspect';
export type CompareView = 'reference' | 'reconstruction' | 'difference';

export interface LocalMedia {
  id: string;
  file: File;
  objectUrl: string;
  durationMs?: number;
  width?: number;
  height?: number;
  error?: string;
}

export interface DisplayStage {
  kind: NodeVideoStageKind;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'awaiting-review' | 'failed' | 'cancelled';
  progress: number;
}

export const LOCAL_PREVIEW_STAGES = [
  { kind: 'ingest', label: 'Read browser metadata', status: 'completed', progress: 1 },
  {
    kind: 'normalize',
    label: 'Media worker not connected',
    status: 'pending',
    progress: 0,
  },
] satisfies readonly DisplayStage[];

export const DEMO_STAGE_LABELS: Array<{ kind: NodeVideoStageKind; label: string }> = [
  { kind: 'ingest', label: 'Inspect fixture metadata' },
  { kind: 'normalize', label: 'Describe normalized timeline' },
  { kind: 'audio', label: 'Generate onset evidence' },
  { kind: 'pose', label: 'Generate pose evidence' },
  { kind: 'alignment', label: 'Align fixture timelines' },
  { kind: 'diffs', label: 'Score fixture differences' },
  { kind: 'render', label: 'Describe comparison preview' },
  { kind: 'summary', label: 'Summarize fixture evidence' },
  { kind: 'review', label: 'Review recipe change' },
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(durationMs?: number): string {
  if (!durationMs || !Number.isFinite(durationMs)) return 'duration unavailable';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function statusLabel(status: DisplayStage['status']): string {
  if (status === 'awaiting-review') return 'Review';
  if (status === 'completed') return 'Complete';
  if (status === 'running') return 'Running';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Queued';
}

export function proposalDecision(
  checkpoint: NodeVideoCheckpoint | null,
  proposalId?: string,
): 'pending' | 'accepted' | 'declined' {
  if (!checkpoint || !proposalId) return 'pending';
  const decision = [...checkpoint.events]
    .reverse()
    .find(
      (event) =>
        (event.type === 'proposal.accepted' || event.type === 'proposal.declined') &&
        event.payload.proposalArtifactId === proposalId,
    );
  if (decision?.type === 'proposal.accepted') return 'accepted';
  if (decision?.type === 'proposal.declined') return 'declined';
  return 'pending';
}

export function findProposal(
  checkpoint: NodeVideoCheckpoint | null,
): RecipeProposalArtifact | undefined {
  return checkpoint?.artifacts.find(
    (artifact): artifact is RecipeProposalArtifact => artifact.kind === 'recipe-proposal',
  );
}

export function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function inspectLocalFile(file: File, index: number): Promise<LocalMedia> {
  const objectUrl = URL.createObjectURL(file);
  const base: LocalMedia = {
    id: `local-${file.lastModified}-${file.size}-${index}`,
    file,
    objectUrl,
  };

  return new Promise((resolve) => {
    const video = document.createElement('video');
    const finish = (result: LocalMedia) => {
      video.removeAttribute('src');
      video.load();
      resolve(result);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      finish({
        ...base,
        durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      });
    };
    video.onerror = () => {
      finish({
        ...base,
        error: 'This browser could not decode metadata. The file still stayed on this device.',
      });
    };
    video.src = objectUrl;
  });
}
