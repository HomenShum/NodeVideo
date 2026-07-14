import {
  SpanByIndexProvider,
  type SpanData,
  SpanPrimitive,
  SpanResource,
} from '@assistant-ui/react-o11y';
import { AuiProvider, useAui } from '@assistant-ui/store';
import { Check, CircleDashed, TriangleAlert, X } from 'lucide-react';
import { useMemo } from 'react';
import type { NodeVideoSpan } from '../lib/contracts';

interface TraceWaterfallProps {
  spans: readonly NodeVideoSpan[];
}

function toSpanData(span: NodeVideoSpan): SpanData {
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

function durationLabel(span: NodeVideoSpan): string {
  if (!span.endedAt) return 'running';
  const durationMs = Math.max(0, Date.parse(span.endedAt) - Date.parse(span.startedAt));
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function StatusIcon({ status }: { status: NodeVideoSpan['status'] }) {
  if (status === 'ok') return <Check size={13} aria-hidden="true" />;
  if (status === 'error') return <TriangleAlert size={13} aria-hidden="true" />;
  if (status === 'cancelled') return <X size={13} aria-hidden="true" />;
  return <CircleDashed size={13} aria-hidden="true" />;
}

export function TraceWaterfall({ spans }: TraceWaterfallProps) {
  const spanData = useMemo(() => spans.map(toSpanData), [spans]);
  const aui = useAui({ span: SpanResource({ spans: spanData }) }, { parent: null });
  const range = useMemo(() => {
    if (spanData.length === 0) return { min: 0, max: 1 };
    const min = Math.min(...spanData.map((span) => span.startedAt));
    const max = Math.max(...spanData.map((span) => span.endedAt ?? span.startedAt + 1), min + 1);
    return { min, max };
  }, [spanData]);

  if (spans.length === 0) {
    return (
      <div className="empty-inspector">
        <CircleDashed size={16} aria-hidden="true" />
        <span>Trace spans appear after a plan runs.</span>
      </div>
    );
  }

  return (
    <AuiProvider value={aui}>
      <SpanPrimitive.Timeline
        className="trace-waterfall"
        timeRange={range}
        aria-label="Pipeline trace waterfall"
        data-observability-primitives="assistant-ui-react-o11y"
      >
        {spans.map((span, index) => (
          <SpanByIndexProvider index={index} key={span.id}>
            <SpanPrimitive.Root
              className="trace-row"
              aria-label={`${span.name}, ${span.status}, ${durationLabel(span)}`}
            >
              <span className="trace-status" data-status={span.status}>
                <StatusIcon status={span.status} />
              </span>
              <span className="trace-copy">
                <SpanPrimitive.Name className="trace-name" />
                <span className="trace-meta">
                  <SpanPrimitive.TypeBadge className="trace-type" />
                  <span>{span.status}</span>
                  <span>{durationLabel(span)}</span>
                </span>
              </span>
              <span className="trace-track" aria-hidden="true">
                <SpanPrimitive.TimelineBar className="trace-bar" now={range.max} />
              </span>
            </SpanPrimitive.Root>
          </SpanByIndexProvider>
        ))}
      </SpanPrimitive.Timeline>
    </AuiProvider>
  );
}
