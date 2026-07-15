import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { PublishedCaseV2Manifest } from '@/lib/published-case-v2';
import { CheckCircle2, ChevronDown, ExternalLink, Music2, TriangleAlert, Type } from 'lucide-react';
import { useState } from 'react';
import { AudiovisualTimeline } from './audiovisual-timeline';

export function V2ProofEvidence({ manifest }: { manifest: PublishedCaseV2Manifest }) {
  const [understandingOpen, setUnderstandingOpen] = useState(false);
  const soundtrackPassed =
    manifest.soundtrack.beatMappingPassed && manifest.soundtrack.sourceAudioMuted;

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <Alert
          data-testid="v2-permanent-window"
          variant={manifest.permanentWindow.passed ? 'default' : 'destructive'}
        >
          {manifest.permanentWindow.passed ? (
            <CheckCircle2 aria-hidden="true" />
          ) : (
            <TriangleAlert aria-hidden="true" />
          )}
          <AlertTitle>16.067–19.633 s permanent regression gate</AlertTitle>
          <AlertDescription>{manifest.permanentWindow.summary}</AlertDescription>
        </Alert>
        <Alert data-testid="v2-soundtrack" variant={soundtrackPassed ? 'default' : 'destructive'}>
          <Music2 aria-hidden="true" />
          <AlertTitle>
            Soundtrack: {manifest.soundtrack.title} · {manifest.soundtrack.artist}
          </AlertTitle>
          <AlertDescription>
            <p>{manifest.soundtrack.summary}</p>
            <p className="mt-1">{manifest.soundtrack.licenseBoundary}</p>
          </AlertDescription>
        </Alert>
      </div>

      <Alert data-testid="v2-claim-boundary">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>What this pass does not prove</AlertTitle>
        <AlertDescription>
          <ul className="list-disc space-y-1 pl-5">
            {manifest.claimBoundary.notClaimed.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>

      <AudiovisualTimeline clips={manifest.pictureClips} />

      <Alert
        data-testid="v2-text-summary"
        variant={manifest.textSummary.passed ? 'default' : 'destructive'}
      >
        <Type aria-hidden="true" />
        <AlertTitle>{manifest.textSummary.cueCount} plan-level timed text cues checked</AlertTitle>
        <AlertDescription>{manifest.textSummary.summary}</AlertDescription>
      </Alert>

      <section
        className="space-y-2"
        aria-labelledby="proof-artifacts-title"
        data-testid="v2-artifacts"
      >
        <h3 id="proof-artifacts-title" className="font-medium">
          Verified proof artifacts
        </h3>
        <div className="flex flex-wrap gap-2">
          {manifest.artifacts.map((artifact) => (
            <Button asChild key={artifact.id} size="sm" variant="outline">
              <a href={artifact.url}>
                {artifact.label} <ExternalLink aria-hidden="true" />
              </a>
            </Button>
          ))}
          <Button asChild size="sm" variant="outline">
            <a data-testid="v2-receipt" href={manifest.receiptUrl}>
              Receipt <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        </div>
      </section>

      <Collapsible onOpenChange={setUnderstandingOpen} open={understandingOpen}>
        <CollapsibleTrigger asChild>
          <Button
            className="h-auto w-full justify-between whitespace-normal py-2 text-left"
            variant="outline"
          >
            What the system understood
            <ChevronDown
              aria-hidden="true"
              className={`transition-transform ${understandingOpen ? 'rotate-180' : ''}`}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-4 rounded-lg border p-3" data-testid="v2-understanding">
            <Description label="Cut selection" value={manifest.eventSummary.picture} />
            <Description label="Framing" value={manifest.eventSummary.framing} />
            <Description label="Grade" value={manifest.eventSummary.grade} />
            <Description label="Soundtrack" value={manifest.soundtrack.summary} />
            <Description label="Timed text" value={manifest.textSummary.summary} />
            <Description label="License boundary" value={manifest.soundtrack.licenseBoundary} />
            <div className="space-y-2">
              <p className="font-medium">Claim boundary</p>
              <p className="text-sm text-muted-foreground">
                Proven: {manifest.claimBoundary.proven.join(' ')}
              </p>
              <p className="text-sm text-muted-foreground">
                Not claimed: {manifest.claimBoundary.notClaimed.join(' ')}
              </p>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}

function Description({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="font-medium">{label}</p>
      <p className="text-sm text-muted-foreground">{value}</p>
    </div>
  );
}
