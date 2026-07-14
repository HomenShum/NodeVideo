import * as AiArtifact from '@/components/ai-elements/artifact';
import { Checkpoint, CheckpointIcon } from '@/components/ai-elements/checkpoint';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import * as UiItem from '@/components/ui/item';
import type { NodeVideoArtifact, NodeVideoRecipeVersion } from '@/lib/contracts';
import { Download, RotateCcw } from 'lucide-react';
import { downloadJson } from './model';
import { SectionLabel } from './section-label';

export function ArtifactList({ artifacts }: { artifacts: readonly NodeVideoArtifact[] }) {
  const workerBacked = artifacts.filter(
    (artifact) => artifact.provenance.kind === 'deterministic-worker',
  ).length;
  return (
    <section className="space-y-2" data-testid="artifact-panel" aria-labelledby="artifact-heading">
      <SectionLabel
        id="artifact-heading"
        label="Typed artifacts"
        meta={`${workerBacked}/${artifacts.length} worker-backed`}
      />
      <div className="space-y-2">
        {artifacts.map((artifact) => (
          <AiArtifact.Artifact key={artifact.id} className="rounded-md shadow-none">
            <AiArtifact.ArtifactHeader className="gap-2 px-3 py-2">
              <div className="min-w-0">
                <AiArtifact.ArtifactTitle className="truncate" title={artifact.title}>
                  {artifact.title}
                </AiArtifact.ArtifactTitle>
                <AiArtifact.ArtifactDescription className="truncate text-xs">
                  {artifact.kind} · {provenanceLabel(artifact)}
                </AiArtifact.ArtifactDescription>
              </div>
              <AiArtifact.ArtifactActions>
                <AiArtifact.ArtifactAction
                  icon={Download}
                  label={`Download ${artifact.title}`}
                  tooltip="Download artifact JSON"
                  onClick={() => downloadJson(`${artifact.kind}.json`, artifact)}
                />
              </AiArtifact.ArtifactActions>
            </AiArtifact.ArtifactHeader>
          </AiArtifact.Artifact>
        ))}
      </div>
    </section>
  );
}

function provenanceLabel(artifact: NodeVideoArtifact): string {
  if (artifact.provenance.kind === 'deterministic-worker') {
    return `${artifact.provenance.workerVersion} · ${artifact.provenance.executionBoundary}`;
  }
  if (artifact.provenance.kind === 'browser-local') return 'browser-local';
  return 'synthetic fixture';
}

export function VersionList({
  versions,
  activeVersion,
  onRestore,
}: {
  versions: readonly NodeVideoRecipeVersion[];
  activeVersion?: number;
  onRestore: (recipeId: string, version: number) => void;
}) {
  return (
    <section className="space-y-2" data-testid="version-history" aria-labelledby="version-heading">
      <SectionLabel id="version-heading" label="Version history" meta="append-only" />
      <Checkpoint className="text-xs">
        <CheckpointIcon className="size-3.5" />
        <span className="shrink-0">Every accept and restore appends a checkpoint</span>
      </Checkpoint>
      <UiItem.ItemGroup className="gap-2" role="presentation">
        {[...versions].reverse().map((version) => {
          const active = version.version === activeVersion;
          return (
            <UiItem.Item variant={active ? 'muted' : 'outline'} size="sm" key={version.id}>
              <UiItem.ItemMedia>
                <Badge variant={active ? 'default' : 'outline'}>v{version.version}</Badge>
              </UiItem.ItemMedia>
              <UiItem.ItemContent className="min-w-0">
                <UiItem.ItemTitle>Version {version.version}</UiItem.ItemTitle>
                <UiItem.ItemDescription className="line-clamp-1 text-xs">
                  {version.reason} · {version.settings.render.layout}
                </UiItem.ItemDescription>
              </UiItem.ItemContent>
              {!active ? (
                <UiItem.ItemActions>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Restore version ${version.version}`}
                    title="Restore as a new version"
                    onClick={() => onRestore(version.recipeId, version.version)}
                  >
                    <RotateCcw aria-hidden="true" />
                  </Button>
                </UiItem.ItemActions>
              ) : null}
            </UiItem.Item>
          );
        })}
      </UiItem.ItemGroup>
    </section>
  );
}
