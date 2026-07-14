import type { NodeVideoStageKind } from './contracts';
import type { PublicWorkerReceipt } from './public-worker';

export type WorkerEvent = PublicWorkerReceipt['events'][number];

export interface VideoUiEvent {
  sequence: number;
  stageKind: NodeVideoStageKind;
  label: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  toolState: 'input-available' | 'output-available' | 'output-error';
}

const stageMap: Record<string, NodeVideoStageKind> = {
  queued: 'ingest',
  normalizing: 'normalize',
  mapping_audio: 'audio',
  extracting_pose: 'pose',
  aligning: 'alignment',
  computing_diffs: 'diffs',
  rendering: 'render',
  validating: 'summary',
  completed: 'review',
  failed: 'review',
};

/** Compatibility seam: worker/NodeAgent events become presentation-only UI events. */
export function toVideoUiEvent(event: WorkerEvent): VideoUiEvent {
  const failed = event.type === 'step.failed' || event.status === 'failed';
  const completed = event.type === 'step.completed' || event.type === 'job.completed';
  return {
    sequence: event.sequence,
    stageKind: stageMap[event.status] ?? 'ingest',
    label: event.message,
    status: failed ? 'failed' : completed ? 'completed' : 'running',
    progress: event.progress.total ? event.progress.completed / event.progress.total : 0,
    toolState: failed ? 'output-error' : completed ? 'output-available' : 'input-available',
  };
}
