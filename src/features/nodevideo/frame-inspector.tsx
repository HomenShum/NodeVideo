import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';
import {
  type LoadedIntegratedInspector,
  loadIntegratedInspector,
} from '@/lib/integrated-inspector';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { VerifiedFrameInspector } from './verified-frame-inspector';

export function FrameInspector() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<LoadedIntegratedInspector>();
  const [error, setError] = useState<string>();
  const [frame, setFrame] = useState(480);

  useEffect(() => {
    if (!open || loaded || error) return;
    void loadIntegratedInspector()
      .then(setLoaded)
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : 'The inspector could not be verified.');
      });
  }, [error, loaded, open]);

  return (
    <section aria-labelledby="frame-inspector-title" data-testid="integrated-frame-inspector">
      <Collapsible onOpenChange={setOpen} open={open}>
        <CollapsibleTrigger asChild>
          <Button
            className="h-auto w-full justify-between gap-3 whitespace-normal py-3 text-left"
            variant="outline"
          >
            <span>
              <span className="block font-medium" id="frame-inspector-title">
                Inspect the calibration cut frame by frame
              </span>
              <span className="block text-xs font-normal text-muted-foreground">
                Official choreography · both takes · MediaPipe · generated edit · held-out final
              </span>
            </span>
            <ChevronDown className={open ? 'rotate-180' : ''} aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          {!loaded && !error ? (
            <Card>
              <CardContent className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Spinner /> Verifying seven hash-bound inspector artifacts…
              </CardContent>
            </Card>
          ) : null}
          {error ? (
            <Card>
              <CardHeader>
                <CardTitle>Inspector blocked</CardTitle>
                <CardDescription>{error}</CardDescription>
              </CardHeader>
            </Card>
          ) : null}
          {loaded ? (
            <VerifiedFrameInspector frame={frame} loaded={loaded} setFrame={setFrame} />
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
