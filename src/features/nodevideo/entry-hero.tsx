import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Activity, FolderOpen, History, ShieldCheck, Sparkles, WandSparkles } from 'lucide-react';
import type { ChangeEvent } from 'react';

export function EntryHero({
  onLoadDemo,
  onFiles,
}: {
  onLoadDemo: () => void;
  onFiles: (files: FileList | File[]) => void;
}) {
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) onFiles(event.target.files);
  };

  return (
    <Empty className="h-full border-0 px-5" aria-labelledby="hero-title">
      <EmptyHeader className="max-w-xl gap-3">
        <EmptyMedia variant="icon" className="size-12 rounded-xl bg-primary/10 text-primary">
          <WandSparkles className="size-6" aria-hidden="true" />
        </EmptyMedia>
        <Badge variant="outline">Inspectable video reconstruction</Badge>
        <EmptyTitle id="hero-title" className="text-3xl font-semibold sm:text-4xl">
          Frame math first. Suggestions second.
        </EmptyTitle>
        <EmptyDescription className="max-w-lg text-base">
          Preview clips locally, inspect every recorded stage, and approve recipe changes before
          they become a new version.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-lg gap-3 sm:flex-row sm:justify-center">
        <Button size="lg" data-testid="demo-load" onClick={onLoadDemo}>
          <Sparkles aria-hidden="true" />
          Load verified synthetic demo
        </Button>
        <Button asChild size="lg" variant="outline">
          <label data-testid="local-upload">
            <FolderOpen aria-hidden="true" />
            Choose local video
            <input
              className="sr-only"
              type="file"
              accept="video/*,.mov"
              multiple
              onChange={onChange}
            />
          </label>
        </Button>
      </EmptyContent>
      <div
        className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground"
        aria-label="Privacy and proof properties"
      >
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" aria-hidden="true" /> No cloud upload
        </span>
        <span className="flex items-center gap-1.5">
          <Activity className="size-3.5" aria-hidden="true" /> Append-only trace
        </span>
        <span className="flex items-center gap-1.5">
          <History className="size-3.5" aria-hidden="true" /> Restorable recipes
        </span>
      </div>
    </Empty>
  );
}
