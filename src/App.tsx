import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RealCasePanel } from '@/features/nodevideo/real-case-panel';
import { Film, GitBranch, ShieldCheck } from 'lucide-react';

export function App() {
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
          <Badge variant="outline">Deterministic media-worker proof</Badge>
          <h1 id="page-title" className="max-w-3xl font-heading text-3xl font-semibold sm:text-5xl">
            Can two MOVs reproduce the final edit?
          </h1>
          <p className="max-w-3xl text-pretty text-muted-foreground sm:text-lg">
            NodeVideo recovered the cut map, normalized HDR footage, recreated the graphic layer,
            rendered from both source videos, and measured the result against the authorized final
            MP4. Verify every deployed artifact before playback.
          </p>
        </section>

        <RealCasePanel />
      </main>

      <footer className="border-t px-3 py-5 text-center text-xs text-muted-foreground sm:px-6">
        Vercel serves a hash-verified replay. The FFmpeg worker runs locally or in CI.
      </footer>
    </div>
  );
}
