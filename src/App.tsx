import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FrameInspector } from '@/features/nodevideo/frame-inspector';
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
          <Badge variant="secondary">
            <ShieldCheck aria-hidden="true" /> Source-only proof
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
          <Badge className="h-auto max-w-full whitespace-normal" variant="outline">
            Original dance → raw takes → chosen song → frozen edit
          </Badge>
          <h1 id="page-title" className="max-w-4xl font-heading text-3xl font-semibold sm:text-5xl">
            Inspect how NodeVideo understood the choreography and made the cut.
          </h1>
          <p className="max-w-3xl text-pretty text-muted-foreground sm:text-lg">
            The pipeline aligned both raw MOVs to the official dance, mapped movement and lyric
            phrases to “Sign,” selected takes and framing, then froze the edit before opening the
            manual final MP4 for evaluation.
          </p>
        </section>

        <FrameInspector />

        <p className="text-xs text-muted-foreground">
          Public media is sanitized and the generated preview is silent. Hash-bound analysis, plan,
          freeze receipt, evaluation, performer selection, pose tracks, and preview are verified in
          your browser before inspection.
        </p>
      </main>
    </div>
  );
}
