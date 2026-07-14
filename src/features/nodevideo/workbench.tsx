import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Check, Info, Play } from 'lucide-react';
import type { CompareView, LocalMedia, ProjectMode } from './model';
import { SYNTHETIC_VIDEO_URL } from './model';

export function Workbench({
  mode,
  localMedia,
  compareView,
  onCompareView,
  runComplete,
  isRunning,
  onRun,
}: {
  mode: Exclude<ProjectMode, 'empty'>;
  localMedia: readonly LocalMedia[];
  compareView: CompareView;
  onCompareView: (view: CompareView) => void;
  runComplete: boolean;
  isRunning: boolean;
  onRun: () => void;
}) {
  const local = localMedia[0];
  const source = mode === 'synthetic' ? SYNTHETIC_VIDEO_URL : local?.objectUrl;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-4 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {mode === 'synthetic' ? 'Public format proof · 6 seconds' : 'Session-only preview'}
          </Badge>
          {mode === 'synthetic' ? (
            <>
              <ToggleGroup
                type="single"
                variant="outline"
                value={compareView}
                onValueChange={(value) => value && onCompareView(value as CompareView)}
                aria-label="Comparison view"
                className="order-3 grid w-full grid-cols-3 sm:order-none sm:ml-auto sm:flex sm:w-auto"
              >
                {(['reference', 'reconstruction', 'difference'] as const).map((view) => (
                  <ToggleGroupItem
                    key={view}
                    value={view}
                    aria-label={`Show ${view}`}
                    className="px-1 text-xs sm:px-3 sm:text-sm"
                  >
                    {view}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Button
                className="w-full sm:w-auto"
                data-testid="run-plan"
                onClick={onRun}
                disabled={isRunning || runComplete}
              >
                {isRunning ? <Spinner /> : runComplete ? <Check /> : <Play />}
                {isRunning ? 'Running…' : runComplete ? 'Proof recorded' : 'Run proof'}
              </Button>
            </>
          ) : null}
        </div>

        <div className="mx-auto w-full max-w-sm">
          <Card className="overflow-hidden border-border/80 bg-black shadow-xl">
            <CardContent className="p-0">
              <AspectRatio ratio={9 / 16} className="relative bg-black">
                {source ? (
                  // biome-ignore lint/a11y/useMediaCaption: The public fixture has no speech; local captions cannot be invented for user-selected media.
                  <video
                    key={source}
                    src={source}
                    controls
                    playsInline
                    preload="metadata"
                    className="size-full object-contain"
                    aria-label={
                      mode === 'synthetic'
                        ? 'Public synthetic video format proof'
                        : `Local preview for ${local?.file.name ?? 'selected video'}`
                    }
                  />
                ) : (
                  <div className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    Choose a local video to preview it here.
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                  <div className="absolute inset-6 rounded-lg border border-dashed border-white/30" />
                  <Badge
                    className="absolute left-3 top-3 bg-black/70 text-white"
                    variant="secondary"
                  >
                    {mode === 'synthetic' ? compareView : 'local preview'}
                  </Badge>
                  {mode === 'synthetic' && compareView === 'difference' ? (
                    <div className="difference-overlay absolute inset-0" />
                  ) : null}
                </div>
              </AspectRatio>
            </CardContent>
          </Card>
        </div>

        {mode === 'synthetic' ? (
          <Card aria-label="Synthetic format proof timeline">
            <CardContent className="space-y-2 p-3">
              <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span>00:00 · fit</span>
                <span className="hidden sm:inline">01:15 · fill</span>
                <span className="hidden sm:inline">03:00 · fit</span>
                <span>06:00</span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                <span className="flex-1 bg-primary" />
                <span className="flex-1 bg-cyan-400" />
                <span className="flex-1 bg-primary" />
                <span className="flex-1 bg-muted-foreground/40" />
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>
            {mode === 'synthetic'
              ? 'Synthetic media and analysis are disclosed.'
              : 'No upload occurred.'}
          </AlertTitle>
          <AlertDescription>
            {mode === 'synthetic'
              ? 'The playable clip proves fit, fill, cuts, BT.709 export, CFR30, and a silent tail. Analysis records are deterministic fixtures—not claims about a person.'
              : (local?.error ??
                'The object URL exists only in this tab. Reloading requires you to choose the file again.')}
          </AlertDescription>
        </Alert>
      </div>
    </ScrollArea>
  );
}
