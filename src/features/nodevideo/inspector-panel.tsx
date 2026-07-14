import { TraceWaterfall } from '@/components/TraceWaterfall';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { NodeVideoCheckpoint, RecipeProposalArtifact } from '@/lib/contracts';
import { Check } from 'lucide-react';
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
  const alignment = checkpoint.artifacts.find((item) => item.kind === 'alignment-report');
  const differences = checkpoint.artifacts.find((item) => item.kind === 'difference-report');
  const completed = checkpoint.stages.filter((stage) => stage.status === 'completed').length;
  const awaiting = checkpoint.stages.filter((stage) => stage.status === 'awaiting-review').length;

  return (
    <ScrollArea className="min-h-0 min-w-0 w-full flex-1">
      <div className="w-0 min-w-full space-y-4 p-3">
        <section
          className="space-y-2"
          data-testid="stage-list"
          aria-label="Recorded pipeline stages"
        >
          <SectionLabel label="Pipeline receipt" meta={`${checkpoint.stages.length} stages`} />
          <Alert>
            <Check aria-hidden="true" />
            <AlertDescription>
              {completed} complete · {awaiting} review
            </AlertDescription>
          </Alert>
        </section>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Review gate
          </span>
          <Badge variant="outline">{decision}</Badge>
        </div>
        {proposal ? (
          <ProposalReview
            proposal={proposal}
            decision={decision}
            onAccept={onAccept}
            onDecline={onDecline}
          />
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <Fact
            label="Alignment"
            value={alignment?.kind === 'alignment-report' ? `${alignment.offsetMs} ms` : '—'}
          />
          <Fact
            label="Difference score"
            value={
              differences?.kind === 'difference-report'
                ? `${Math.round(differences.overallScore * 100)}%`
                : '—'
            }
          />
        </div>

        <ArtifactList artifacts={checkpoint.artifacts} />
        <section className="space-y-2" data-testid="trace-panel" aria-labelledby="trace-heading">
          <SectionLabel
            id="trace-heading"
            label="Complete trace"
            meta={`${checkpoint.spans.length} spans · ok`}
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-3">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <strong className="font-mono text-lg">{value}</strong>
      </CardContent>
    </Card>
  );
}
