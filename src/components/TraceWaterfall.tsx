import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
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

function statusTone(status: NodeVideoSpan['status']): string {
  if (status === 'ok') return 'bg-primary/10 text-primary';
  if (status === 'error') return 'bg-destructive/10 text-destructive';
  if (status === 'running') return 'bg-amber-500/10 text-amber-500';
  return 'bg-muted text-muted-foreground';
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
      <Card size="sm" className="border-dashed bg-muted/30 py-0 shadow-none">
        <CardContent className="flex min-h-16 items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
          <CircleDashed className="size-4 shrink-0" aria-hidden="true" />
          <span>Trace spans appear after a plan runs.</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <AuiProvider value={aui}>
      <Card size="sm" className="gap-0 py-0 shadow-none">
        <CardContent className="p-0">
          <SpanPrimitive.Timeline
            className="w-full min-w-0"
            timeRange={range}
            aria-label="Pipeline trace waterfall"
            data-observability-primitives="assistant-ui-react-o11y"
          >
            {spans.map((span, index) => (
              <SpanByIndexProvider index={index} key={span.id}>
                <SpanPrimitive.Root
                  className="flex min-h-14 items-center gap-2 border-b border-border/70 px-2 py-2 last:border-b-0"
                  aria-label={`${span.name}, ${span.status}, ${durationLabel(span)}`}
                >
                  <span
                    className={`grid size-5 place-items-center rounded-full ${statusTone(span.status)}`}
                    data-status={span.status}
                  >
                    <StatusIcon status={span.status} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <SpanPrimitive.Name className="block truncate text-xs font-medium text-card-foreground" />
                    <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge
                        asChild
                        variant="outline"
                        className="h-4 rounded-sm bg-muted/50 px-1 py-0 text-xs uppercase tracking-wide text-muted-foreground"
                      >
                        <SpanPrimitive.TypeBadge />
                      </Badge>
                      <span>{span.status}</span>
                      <span>{durationLabel(span)}</span>
                    </span>
                  </span>
                  <span
                    className="trace-track relative h-4 w-20 shrink-0 overflow-hidden border-x border-border"
                    aria-hidden="true"
                  >
                    <SpanPrimitive.TimelineBar
                      className={cn(
                        'top-1.5 h-1.5 min-w-1 rounded-full bg-primary',
                        span.status === 'error' && 'bg-destructive',
                        span.status === 'running' && 'bg-amber-500',
                        span.status === 'cancelled' && 'bg-muted-foreground',
                      )}
                      now={range.max}
                    />
                  </span>
                </SpanPrimitive.Root>
              </SpanByIndexProvider>
            ))}
          </SpanPrimitive.Timeline>
        </CardContent>
      </Card>
    </AuiProvider>
  );
}
