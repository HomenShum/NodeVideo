import type { SpanData } from '@assistant-ui/react-o11y';
import type { NodeVideoSpan } from './contracts';

export function toSpanData(span: NodeVideoSpan): SpanData {
  const startedAt = Date.parse(span.startedAt);
  const endedAt = span.endedAt ? Date.parse(span.endedAt) : null;
  return {
    id: span.id,
    parentSpanId: span.parentSpanId ?? null,
    name: span.name,
    type: span.stageKind,
    status:
      span.status === 'running'
        ? 'running'
        : span.status === 'error'
          ? 'failed'
          : span.status === 'cancelled'
            ? 'skipped'
            : 'completed',
    startedAt,
    endedAt,
    latencyMs: endedAt === null ? null : Math.max(0, endedAt - startedAt),
  };
}

export function spanDurationLabel(span: NodeVideoSpan): string {
  if (!span.endedAt) return 'running';
  const durationMs = Math.max(0, Date.parse(span.endedAt) - Date.parse(span.startedAt));
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

export function spanStepStatus(span: NodeVideoSpan): 'complete' | 'active' | 'pending' {
  if (span.status === 'running') return 'active';
  if (span.status === 'cancelled') return 'pending';
  return 'complete';
}
