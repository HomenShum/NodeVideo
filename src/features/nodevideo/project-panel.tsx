import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import type { NodeVideoCheckpoint } from '@/lib/contracts';
import { Check, Download, Sparkles, Upload, Video } from 'lucide-react';
import type { DragEvent } from 'react';
import {
  type DisplayStage,
  LOCAL_PREVIEW_STAGES,
  type LocalMedia,
  type ProjectMode,
  formatBytes,
  formatDuration,
  statusLabel,
} from './model';
import { SectionLabel } from './section-label';

export function ProjectPanel({
  mode,
  checkpoint,
  localMedia,
  displayStages,
  runComplete,
  onFiles,
  onLoadDemo,
  onDownloadManifest,
}: {
  mode: ProjectMode;
  checkpoint: NodeVideoCheckpoint | null;
  localMedia: readonly LocalMedia[];
  displayStages: readonly DisplayStage[];
  runComplete: boolean;
  onFiles: (files: FileList | File[]) => void;
  onLoadDemo: () => void;
  onDownloadManifest: () => void;
}) {
  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files);
  };
  const stages = mode === 'local' ? LOCAL_PREVIEW_STAGES : displayStages;

  return (
    <ScrollArea className="min-h-0 min-w-0 w-full flex-1">
      <div className="w-0 min-w-full space-y-4 p-3">
        <SectionLabel label="Sources" meta={mode === 'synthetic' ? 'fixture' : 'on device'} />
        <ItemGroup className="gap-2" role="presentation">
          {mode === 'synthetic'
            ? checkpoint?.assets.map((asset) => (
                <AssetItem
                  key={asset.id}
                  title={asset.filename}
                  role={asset.role}
                  meta={`${formatDuration(asset.durationMs)} · ${asset.width}×${asset.height}`}
                />
              ))
            : localMedia.map((media, index) => (
                <AssetItem
                  key={media.id}
                  title={media.file.name}
                  role={index === 0 ? 'reference preview' : `local clip ${index + 1}`}
                  meta={`${formatDuration(media.durationMs)} · ${formatBytes(media.file.size)}`}
                />
              ))}
        </ItemGroup>
        {mode === 'empty' && localMedia.length === 0 ? (
          <p className="text-sm text-muted-foreground">No source clips selected.</p>
        ) : null}
        <Button asChild variant="outline" className="h-auto w-full justify-start py-3">
          <label onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
            <Upload aria-hidden="true" />
            <span className="min-w-0 text-left">
              <span className="block font-medium">Add local video</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                Preview only; bytes stay in this browser
              </span>
            </span>
            <input
              className="sr-only"
              type="file"
              accept="video/*,.mov"
              multiple
              onChange={(event) => event.target.files && onFiles(event.target.files)}
            />
          </label>
        </Button>

        {mode !== 'empty' ? (
          <div className="space-y-3">
            <SectionLabel
              label="Pipeline"
              meta={runComplete ? 'recorded' : mode === 'local' ? 'preview' : 'ready'}
            />
            <Card>
              <CardContent className="space-y-1 p-2">
                {stages.map((stage, index) => (
                  <Item key={`${stage.kind}-${index}`} size="xs" variant="default">
                    <ItemMedia
                      className={
                        stage.status === 'completed'
                          ? 'text-primary'
                          : stage.status === 'running'
                            ? 'text-foreground'
                            : 'text-muted-foreground'
                      }
                    >
                      {stage.status === 'completed' ? (
                        <Check aria-hidden="true" />
                      ) : stage.status === 'running' ? (
                        <Spinner aria-hidden="true" />
                      ) : (
                        <span className="w-4 text-center text-xs">{index + 1}</span>
                      )}
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="max-w-full truncate">{stage.label}</ItemTitle>
                      {stage.status === 'running' ? (
                        <Progress value={stage.progress * 100} className="h-1" />
                      ) : null}
                    </ItemContent>
                    <Badge variant="outline" className="text-xs">
                      {statusLabel(stage.status)}
                    </Badge>
                  </Item>
                ))}
              </CardContent>
            </Card>
            {mode === 'local' ? (
              <Button variant="outline" className="w-full" onClick={onDownloadManifest}>
                <Download /> Download local manifest
              </Button>
            ) : null}
            {mode === 'local' ? (
              <Button variant="ghost" className="w-full" onClick={onLoadDemo}>
                <Sparkles /> Open verified demo
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}

function AssetItem({ title, role, meta }: { title: string; role: string; meta: string }) {
  return (
    <Item variant="outline" size="sm">
      <ItemMedia className="text-muted-foreground">
        <Video aria-hidden="true" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full truncate" title={title}>
          {title}
        </ItemTitle>
        <ItemDescription className="line-clamp-1 text-xs">
          {role} · {meta}
        </ItemDescription>
      </ItemContent>
    </Item>
  );
}
