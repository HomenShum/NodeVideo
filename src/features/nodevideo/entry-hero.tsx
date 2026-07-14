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
import { Spinner } from '@/components/ui/spinner';
import { FolderOpen, Sparkles, WandSparkles } from 'lucide-react';
import type { ChangeEvent } from 'react';

export function EntryHero({
  onLoadDemo,
  onFiles,
  isLoadingProof,
  loadError,
}: {
  onLoadDemo: () => void | Promise<void>;
  onFiles: (files: FileList | File[]) => void;
  isLoadingProof: boolean;
  loadError?: string;
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
        <Button size="lg" data-testid="demo-load" onClick={onLoadDemo} disabled={isLoadingProof}>
          {isLoadingProof ? <Spinner aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
          {isLoadingProof ? 'Verifying worker proof…' : 'Load verified synthetic worker demo'}
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
      {loadError ? (
        <p role="alert" className="max-w-lg text-sm text-destructive">
          {loadError} Retry when the deployment is reachable.
        </p>
      ) : null}
    </Empty>
  );
}
