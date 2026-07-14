import { TraceWaterfall } from '@/components/TraceWaterfall';
import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { NodeVideoCheckpoint, RecipeProposalArtifact } from '@/lib/contracts';
import { Check, TriangleAlert } from 'lucide-react';
import { ArtifactList, VersionList } from './evidence-lists';
import { ProposalReview } from './proposal-review';
import { SectionLabel } from './section-label';

export function InspectorPanel({
  checkpoint,
  proposal,
  decision,
  onAccept,
  onDecline,
  onRestore,
}: {
  checkpoint: NodeVideoCheckpoint;
  proposal?: RecipeProposalArtifact;
  decision: 'pending' | 'accepted' | 'declined';
  onAccept: () => void;
  onDecline: () => void;
  onRestore: (recipeId: string, version: number) => void;
}) {
  const receipt = checkpoint.artifacts.find((item) => item.kind === 'worker-receipt');
  const completed = checkpoint.stages.filter((stage) => stage.status === 'completed').length;
  const awaiting = checkpoint.stages.filter((stage) => stage.status === 'awaiting-review').length;
  const failed = checkpoint.stages.filter((stage) => stage.status === 'failed');

  return (
    <ScrollArea className="min-h-0 min-w-0 w-full flex-1">
      <div className="w-0 min-w-full space-y-4 p-3">
        <section
          className="space-y-2"
          data-testid="stage-list"
          aria-label="Recorded pipeline stages"
        >
          <SectionLabel label="Pipeline receipt" meta={`${checkpoint.stages.length} stages`} />
          <Alert variant={failed.length ? 'destructive' : 'default'}>
            {failed.length ? <TriangleAlert aria-hidden="true" /> : <Check aria-hidden="true" />}
            <AlertDescription>
              {completed} complete · {awaiting} review · {failed.length} failed
            </AlertDescription>
          </Alert>
        </section>

        {receipt?.kind === 'worker-receipt' ? (
          <Tool defaultOpen data-testid="worker-tool-card" className="mb-0">
            <ToolHeader
              type="dynamic-tool"
              toolName="nodevideo.tutorial-compare"
              title={`Worker receipt · ${receipt.validationCount} checks`}
              state={receipt.validationVerdict === 'pass' ? 'output-available' : 'output-error'}
              className="min-w-0 gap-2 px-3 py-2"
            />
            <ToolContent className="px-3 pb-3 text-xs text-muted-foreground">
              Deterministic public worker · {receipt.eventCount} events · media hash verified
            </ToolContent>
          </Tool>
        ) : null}

        {proposal ? (
          <ProposalReview
            proposal={proposal}
            decision={decision}
            onAccept={onAccept}
            onDecline={onDecline}
          />
        ) : null}

        <ArtifactList artifacts={checkpoint.artifacts} />
        <section className="space-y-2" data-testid="trace-panel" aria-labelledby="trace-heading">
          <SectionLabel
            id="trace-heading"
            label="Complete trace"
            meta={`${checkpoint.spans.length} spans · ${failed.length ? 'partial' : 'ok'}`}
          />
          <TraceWaterfall spans={checkpoint.spans} />
        </section>
        <VersionList
          versions={checkpoint.recipeVersions}
          activeVersion={checkpoint.activeRecipeVersion}
          onRestore={onRestore}
        />
      </div>
    </ScrollArea>
  );
}
