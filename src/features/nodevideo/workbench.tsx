import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PUBLIC_WORKER_RESULT, PUBLIC_WORKER_URLS } from '@/lib/public-worker';
import { Check, Info, Play } from 'lucide-react';
import type { CompareView, LocalMedia, ProjectMode } from './model';

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
  const source =
    mode === 'synthetic'
      ? {
          reference: PUBLIC_WORKER_URLS.reference,
          comparison: PUBLIC_WORKER_URLS.comparison,
          difference: PUBLIC_WORKER_URLS.difference,
        }[compareView]
      : local?.objectUrl;
  const comparison = PUBLIC_WORKER_RESULT.artifacts.tutorialComparison;
  const criticalBeats = new Set(comparison.criticalMoments.map((moment) => moment.beat));
  const sideBySide = mode === 'synthetic' && compareView === 'comparison';

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-4 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {mode === 'synthetic'
              ? 'Public worker proof · 10 tools · 13 checks'
              : 'Session-only preview'}
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
                {(['reference', 'comparison', 'difference'] as const).map((view) => (
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
                {isRunning
                  ? 'Replaying events…'
                  : runComplete
                    ? 'Receipt verified'
                    : 'Replay worker run'}
              </Button>
            </>
          ) : null}
        </div>

        <div className={sideBySide ? 'mx-auto w-full max-w-3xl' : 'mx-auto w-full max-w-sm'}>
          <Card className="overflow-hidden border-border/80 bg-black shadow-xl">
            <CardContent className="p-0">
              <AspectRatio ratio={sideBySide ? 9 / 8 : 9 / 16} className="relative bg-black">
                {source ? (
                  // biome-ignore lint/a11y/useMediaCaption: Public media is instrumental; local captions cannot be invented.
                  <video
                    key={source}
                    src={source}
                    controls
                    playsInline
                    preload="metadata"
                    className="size-full object-contain"
                    aria-label={
                      mode === 'synthetic'
                        ? `Worker-produced public ${compareView} video`
                        : `Local preview for ${local?.file.name ?? 'selected video'}`
                    }
                  />
                ) : (
                  <div className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    Choose a local video to preview it here.
                  </div>
                )}
              </AspectRatio>
            </CardContent>
          </Card>
        </div>

        {mode === 'synthetic' ? (
          <Card aria-label="Worker-derived beat and critical-moment timeline">
            <CardContent className="space-y-2 p-3">
              <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span>0:00 · {comparison.beatMap.bpm.toFixed(0)} BPM</span>
                <span>{comparison.beatMap.beats.length} decoded beats</span>
                <span>5.76 s</span>
              </div>
              <div className="grid h-2 grid-cols-12 gap-1" aria-label="Beat markers">
                {comparison.beatMap.beats.map((beat, index) => (
                  <span
                    key={beat}
                    className={
                      criticalBeats.has(index)
                        ? 'rounded-full bg-amber-400'
                        : 'rounded-full bg-primary'
                    }
                    title={
                      criticalBeats.has(index)
                        ? `Critical moment at beat ${index}`
                        : `Beat ${index}`
                    }
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>
            {mode === 'synthetic'
              ? 'Real worker run, synthetic source media.'
              : 'No upload occurred.'}
          </AlertTitle>
          <AlertDescription>
            {mode === 'synthetic'
              ? 'FFmpeg decoded two generated videos, extracted PCM onsets and known color landmarks, aligned them by 240 ms, measured three critical moments, rendered playable comparisons, and passed the checked-in receipt. This proves the pipeline—not general human-pose accuracy.'
              : (local?.error ??
                'The object URL exists only in this tab. Reloading requires you to choose the file again.')}
          </AlertDescription>
        </Alert>
      </div>
    </ScrollArea>
  );
}
