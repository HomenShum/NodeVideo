import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { NodeVideoCheckpoint } from '@/lib/contracts';
import type { ControlPlaneStatus } from '@/lib/convex-runtime';
import { Download, Film, Lock } from 'lucide-react';
import type { ProjectMode } from './model';

export function AppHeader({
  mode,
  checkpoint,
  controlPlaneStatus,
  onDownloadReceipt,
}: {
  mode: ProjectMode;
  checkpoint: NodeVideoCheckpoint | null;
  controlPlaneStatus: ControlPlaneStatus;
  onDownloadReceipt: () => void;
}) {
  const projectName =
    mode === 'synthetic'
      ? 'Worker-verified public comparison'
      : mode === 'local'
        ? 'Browser-local preview'
        : 'New local project';

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur md:px-4">
      <div className="flex shrink-0 items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Film className="size-4" aria-hidden="true" />
        </span>
        <span className="hidden font-heading font-semibold tracking-tight sm:inline">
          NodeVideo
        </span>
        <Badge variant="outline" className="hidden sm:inline-flex">
          {controlPlaneStatus === 'online' ? 'Convex online' : 'worker P0'}
        </Badge>
      </div>
      <div className="hidden min-w-0 flex-1 truncate border-l pl-3 text-sm text-muted-foreground md:block">
        {projectName}
        {checkpoint?.activeRecipeVersion ? ` · recipe v${checkpoint.activeRecipeVersion}` : ''}
      </div>
      <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
        <Badge
          variant="secondary"
          data-testid="privacy-badge"
          className="min-w-0 max-w-36 truncate sm:max-w-52"
          title={
            mode === 'synthetic'
              ? 'Public synthetic worker proof; no personal video is bundled.'
              : 'Selected files remain in this browser session.'
          }
        >
          <Lock aria-hidden="true" />
          <span className="truncate">
            {mode === 'synthetic' ? 'Public synthetic worker' : 'Local to this browser'}
          </span>
        </Badge>
        {checkpoint?.stages.length ? (
          <Button
            variant="outline"
            size="icon"
            aria-label="Download run receipt"
            title="Download run receipt"
            onClick={onDownloadReceipt}
          >
            <Download aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </header>
  );
}
