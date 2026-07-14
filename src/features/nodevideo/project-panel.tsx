import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool';
import { Button } from '@/components/ui/button';
import * as UiItem from '@/components/ui/item';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { NodeVideoCheckpoint } from '@/lib/contracts';
import { Download, Sparkles, Upload, Video } from 'lucide-react';
import {
  type DisplayStage,
  LOCAL_PREVIEW_STAGES,
  type LocalMedia,
  type ProjectMode,
  formatBytes,
  formatDuration,
  toolState,
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
  mode: Exclude<ProjectMode, 'empty'>;
  checkpoint: NodeVideoCheckpoint | null;
  localMedia: readonly LocalMedia[];
  displayStages: readonly DisplayStage[];
  runComplete: boolean;
  onFiles: (files: FileList | File[]) => void;
  onLoadDemo: () => void | Promise<void>;
  onDownloadManifest: () => void;
}) {
  const stages = mode === 'local' ? LOCAL_PREVIEW_STAGES : displayStages;

  return (
    <ScrollArea className="min-h-0 min-w-0 w-full flex-1">
      <div className="w-0 min-w-full space-y-4 p-3">
        <SectionLabel label="Sources" meta={mode === 'synthetic' ? 'fixture' : 'on device'} />
        <UiItem.ItemGroup className="gap-2" role="presentation">
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
        </UiItem.ItemGroup>
        <Button asChild variant="outline" className="h-auto w-full justify-start py-3">
          <label>
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

        <div className="space-y-3">
          <SectionLabel
            label="Pipeline"
            meta={runComplete ? 'recorded' : mode === 'local' ? 'preview' : 'ready'}
          />
          <div className="space-y-2">
            {stages.map((stage, index) => (
              <Tool key={`${stage.kind}-${index}`} className="mb-0">
                <ToolHeader
                  type="dynamic-tool"
                  toolName={stage.kind}
                  title={stage.label}
                  state={toolState(stage.status)}
                  className="gap-2 p-2"
                />
                {stage.status === 'running' ? (
                  <ToolContent className="p-2">
                    <Progress value={stage.progress * 100} className="h-1" />
                  </ToolContent>
                ) : null}
              </Tool>
            ))}
          </div>
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
      </div>
    </ScrollArea>
  );
}

function AssetItem({ title, role, meta }: { title: string; role: string; meta: string }) {
  return (
    <UiItem.Item variant="outline" size="sm">
      <UiItem.ItemMedia className="text-muted-foreground">
        <Video aria-hidden="true" />
      </UiItem.ItemMedia>
      <UiItem.ItemContent className="min-w-0">
        <UiItem.ItemTitle className="max-w-full truncate" title={title}>
          {title}
        </UiItem.ItemTitle>
        <UiItem.ItemDescription className="line-clamp-1 text-xs">
          {role} · {meta}
        </UiItem.ItemDescription>
      </UiItem.ItemContent>
    </UiItem.Item>
  );
}
