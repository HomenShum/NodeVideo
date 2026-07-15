import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { BlindPilotPanel } from '@/features/nodevideo/blind-pilot-panel';
import { RealCasePanel } from '@/features/nodevideo/real-case-panel';
import { V2ProofPanel } from '@/features/nodevideo/v2-proof-panel';
import { ChevronDown, Film, GitBranch, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

export function App() {
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="min-h-svh bg-background text-foreground" data-testid="app-shell">
      <header className="border-b bg-background/95">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-3 py-3 sm:px-6">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Film className="size-4" aria-hidden="true" />
          </span>
          <span className="font-heading font-semibold tracking-tight">NodeVideo</span>
          <Badge variant="secondary" data-testid="privacy-badge">
            <ShieldCheck aria-hidden="true" /> Authorized derivatives only
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
          <Badge variant="outline">Source-only creative editing</Badge>
          <h1 id="page-title" className="max-w-3xl font-heading text-3xl font-semibold sm:text-5xl">
            Choose the edit before seeing the answer, then make the music handoff usable.
          </h1>
          <p className="max-w-3xl text-pretty text-muted-foreground sm:text-lg">
            A fresh planner receives only the two source videos and public music-catalog context.
            Its clean edit, text, track candidate, preview-relative segment reference, and desired
            beat-alignment cues are frozen before the held-out target is opened. The older
            target-guided reconstruction remains below as calibration evidence, never as blind-taste
            evidence.
          </p>
          <div className="flex flex-wrap gap-2" aria-label="Claim boundary">
            <Badge variant="secondary">Audited source-only generation</Badge>
            <Badge variant="secondary">Instagram-ready music cues</Badge>
            <Badge variant="outline">Generalized taste awaits multi-case votes</Badge>
          </div>
        </section>

        <BlindPilotPanel />

        <section className="space-y-2" aria-labelledby="calibration-title">
          <Badge variant="outline">Target-guided calibration</Badge>
          <h2 className="font-heading text-2xl font-semibold" id="calibration-title">
            Reference understanding and reconstruction
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            This separate case can score exact target fidelity, including the soundtrack and the
            16–19 second correction. It does not contribute to the blind claim above.
          </p>
        </section>

        <Collapsible onOpenChange={setCalibrationOpen} open={calibrationOpen}>
          <CollapsibleTrigger asChild>
            <Button className="w-full justify-between" data-testid="v2-calibration-trigger">
              {calibrationOpen
                ? 'Hide target-guided calibration'
                : 'Load calibration proof · 17 MB'}
              <ChevronDown
                aria-hidden="true"
                className={`transition-transform ${calibrationOpen ? 'rotate-180' : ''}`}
              />
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
              <ChevronDown
                aria-hidden="true"
                className={`transition-transform ${historyOpen ? 'rotate-180' : ''}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3" data-testid="v1-history">
              <RealCasePanel />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </main>

      <footer className="border-t px-3 py-5 text-center text-xs text-muted-foreground sm:px-6">
        Vercel serves verified proof artifacts. Deterministic media workers run locally or in CI.
      </footer>
    </div>
  );
}
