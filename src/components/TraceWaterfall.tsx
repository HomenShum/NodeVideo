import { ChainOfThought, ChainOfThoughtStep } from '@/components/ai-elements/chain-of-thought';
import { spanDurationLabel, spanStepStatus, toSpanData } from '@/lib/trace-adapter';
import { SpanByIndexProvider, SpanPrimitive, SpanResource } from '@assistant-ui/react-o11y';
import { AuiProvider, useAui } from '@assistant-ui/store';
import { Check, CircleDashed, TriangleAlert, X } from 'lucide-react';
import { useMemo } from 'react';
import type { NodeVideoSpan } from '../lib/contracts';

const statusIcons = {
  ok: Check,
  error: TriangleAlert,
  cancelled: X,
  running: CircleDashed,
} as const;

export function TraceWaterfall({ spans }: { spans: readonly NodeVideoSpan[] }) {
  const spanData = useMemo(() => spans.map(toSpanData), [spans]);
  const aui = useAui({ span: SpanResource({ spans: spanData }) }, { parent: null });

  return (
    <AuiProvider value={aui}>
      <ChainOfThought data-observability-primitives="assistant-ui-react-o11y">
        {spans.map((span, index) => (
          <SpanByIndexProvider index={index} key={span.id}>
            <SpanPrimitive.Root aria-label={`${span.name}, ${span.status}`}>
              <ChainOfThoughtStep
                icon={statusIcons[span.status]}
                label={<SpanPrimitive.Name />}
                description={`${span.stageKind} · ${span.status} · ${spanDurationLabel(span)}`}
                status={spanStepStatus(span)}
              />
            </SpanPrimitive.Root>
          </SpanByIndexProvider>
        ))}
      </ChainOfThought>
    </AuiProvider>
  );
}
