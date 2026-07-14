import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { RecipeProposalArtifact } from '@/lib/contracts';
import { Check, ChevronRight, SlidersHorizontal, X } from 'lucide-react';

export function ProposalReview({
  proposal,
  decision,
  onAccept,
  onDecline,
}: {
  proposal: RecipeProposalArtifact;
  decision: 'pending' | 'accepted' | 'declined';
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <Card data-testid="proposal-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SlidersHorizontal className="size-4" aria-hidden="true" />
          </span>
          <Badge variant="outline">Review proposal</Badge>
        </div>
        <CardTitle>{proposal.title}</CardTitle>
        <CardDescription>{proposal.rationale}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex-1">
            <DiffValue label="Current offset" value="0 ms" />
          </div>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          <div className="flex-1">
            <DiffValue
              label="Proposed offset"
              value={`${proposal.patch.alignmentOffsetMs ?? 0} ms`}
            />
          </div>
        </div>
        {decision === 'pending' ? (
          <ButtonGroup className="w-full">
            <Button variant="outline" className="flex-1" onClick={onDecline}>
              <X aria-hidden="true" /> Decline
            </Button>
            <Button className="flex-1" data-testid="accept-proposal" onClick={onAccept}>
              <Check aria-hidden="true" /> Accept as v2
            </Button>
          </ButtonGroup>
        ) : (
          <Alert>
            {decision === 'accepted' ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
            <AlertDescription>
              Proposal {decision}.{' '}
              {decision === 'accepted'
                ? 'Recipe version 2 was appended.'
                : 'Version 1 remains active.'}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function DiffValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block truncate text-xs text-muted-foreground">{label}</span>
      <strong className="font-mono text-sm">{value}</strong>
    </div>
  );
}
