import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import type { NodeVideoArtifact, NodeVideoRecipeVersion } from '@/lib/contracts';
import { Download, FileJson, RotateCcw } from 'lucide-react';
import { downloadJson } from './model';
import { SectionLabel } from './section-label';

export function ArtifactList({ artifacts }: { artifacts: readonly NodeVideoArtifact[] }) {
  return (
    <section className="space-y-2" data-testid="artifact-panel" aria-labelledby="artifact-heading">
      <SectionLabel
        id="artifact-heading"
        label="Synthetic artifacts"
        meta={`${artifacts.length}`}
      />
      <ItemGroup className="gap-2" role="presentation">
        {artifacts.map((artifact) => (
          <Item variant="outline" size="sm" key={artifact.id}>
            <ItemMedia className="text-muted-foreground">
              <FileJson aria-hidden="true" />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="max-w-full truncate" title={artifact.title}>
                {artifact.title}
              </ItemTitle>
              <ItemDescription className="line-clamp-1 text-xs">
                {artifact.kind} · synthetic
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Download ${artifact.title}`}
                title="Download artifact JSON"
                onClick={() => downloadJson(`${artifact.kind}.json`, artifact)}
              >
                <Download aria-hidden="true" />
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </section>
  );
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
      <ItemGroup className="gap-2" role="presentation">
        {[...versions].reverse().map((version) => {
          const active = version.version === activeVersion;
          return (
            <Item variant={active ? 'muted' : 'outline'} size="sm" key={version.id}>
              <ItemMedia>
                <Badge variant={active ? 'default' : 'outline'}>v{version.version}</Badge>
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>Version {version.version}</ItemTitle>
                <ItemDescription className="line-clamp-1 text-xs">
                  {version.reason} · {version.settings.render.layout}
                </ItemDescription>
              </ItemContent>
              {!active ? (
                <ItemActions>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Restore version ${version.version}`}
                    title="Restore as a new version"
                    onClick={() => onRestore(version.recipeId, version.version)}
                  >
                    <RotateCcw aria-hidden="true" />
                  </Button>
                </ItemActions>
              ) : null}
            </Item>
          );
        })}
      </ItemGroup>
    </section>
  );
}
