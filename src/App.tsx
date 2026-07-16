import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SongConditionedPanel } from '@/features/nodevideo/blind-pilot-panel';
import { RealCasePanel } from '@/features/nodevideo/real-case-panel';
import { V2ProofPanel } from '@/features/nodevideo/v2-proof-panel';
import { usePublishedSongCalibration } from '@/lib/published-song-calibration';
import { ChevronDown, Film, GitBranch, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

export function App() {
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const calibration = usePublishedSongCalibration();

  return (
    <div className="min-h-svh bg-background text-foreground" data-testid="app-shell">
      <header className="border-b bg-background/95">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-3 py-3 sm:px-6">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Film className="size-4" aria-hidden="true" />
          </span>
          <span className="font-heading font-semibold tracking-tight">NodeVideo</span>
          <Badge variant="secondary" data-testid="privacy-badge">
            <ShieldCheck aria-hidden="true" /> Local-first media
          </Badge>
          <Button asChild className="ml-auto" size="sm" variant="outline">
            <a href="https://github.com/HomenShum/NodeVideo" rel="noreferrer" target="_blank">
              <GitBranch aria-hidden="true" /> Public repo
            </a>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-3 py-6 sm:px-6 sm:py-10">
        <section className="space-y-3" aria-labelledby="page-title">
          <Badge variant="outline">Original dance → takes → chosen song → final edit</Badge>
          <h1 id="page-title" className="max-w-4xl font-heading text-3xl font-semibold sm:text-5xl">
            Understand the choreography, then edit each phrase to the music.
          </h1>
          <p className="max-w-3xl text-pretty text-muted-foreground sm:text-lg">
            NodeVideo aligns every take to an original dance, maps movement accents to a chosen song
            segment, selects the strongest take, and positions lyric text without covering the body.
            The edit plan is frozen before any held-out target can be evaluated.
          </p>
        </section>

        <SongConditionedPanel />

        <section className="space-y-2" aria-labelledby="calibration-title">
          <Badge variant="outline">Target-guided calibration</Badge>
          <h2 className="font-heading text-2xl font-semibold" id="calibration-title">
            Reconstruction remains a separate evaluator
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            This authorized comparison measures exact target fidelity, including soundtrack timing
            and the 16–19 second correction. It never supplies choices to the planner above.
          </p>
          <output
            className="block text-xs text-muted-foreground"
            data-testid="song-calibration-integrity"
          >
            {calibration.status === 'verified'
              ? 'Calibration SHA-256 verified · 7 artifacts'
              : (calibration.error ?? 'Verifying calibration artifacts…')}
          </output>
          {calibration.status === 'verified' ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <a href="/media/song-conditioned-real-calibration-v1/picture-only-preview.mp4">
                  Play supplied-case picture plan · silent
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href="/media/song-conditioned-real-calibration-v1/manifest.json">
                  Read source-only score
                </a>
              </Button>
            </div>
          ) : null}
        </section>

        <Collapsible onOpenChange={setCalibrationOpen} open={calibrationOpen}>
          <CollapsibleTrigger asChild>
            <Button className="w-full justify-between" data-testid="v2-calibration-trigger">
              {calibrationOpen
                ? 'Hide target-guided calibration'
                : 'Load calibration proof · 17 MB'}
              <ChevronDown className={calibrationOpen ? 'rotate-180' : ''} aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3">
              <V2ProofPanel />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible onOpenChange={setHistoryOpen} open={historyOpen}>
          <CollapsibleTrigger asChild>
            <Button
              className="h-auto w-full justify-between whitespace-normal py-3 text-left"
              data-testid="v1-history-trigger"
              variant="outline"
            >
              V1 failure evidence · historical and invalidated
              <ChevronDown className={historyOpen ? 'rotate-180' : ''} aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3" data-testid="v1-history">
              <RealCasePanel />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </main>
    </div>
  );
}
