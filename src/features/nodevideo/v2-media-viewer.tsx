import * as ArtifactUi from '@/components/ai-elements/artifact';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import * as SelectUi from '@/components/ui/select';
import {
  type PublishedCaseV2Manifest,
  type V2CaseViewId,
  V2_CASE_VIEW_IDS,
} from '@/lib/published-case-v2';
import { useState } from 'react';

export function V2MediaViewer({ manifest }: { manifest: PublishedCaseV2Manifest }) {
  const [viewId, setViewId] = useState<V2CaseViewId>('corrected');
  const selectedView = manifest.views.find((view) => view.id === viewId) ?? manifest.views[0];

  return (
    <ArtifactUi.Artifact
      className={`mx-auto w-full ${selectedView.ratio < 1 ? 'max-w-sm' : 'max-w-3xl'}`}
    >
      <ArtifactUi.ArtifactHeader className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <ArtifactUi.ArtifactTitle>{selectedView.label}</ArtifactUi.ArtifactTitle>
        <SelectUi.Select
          onValueChange={(value) => {
            if (isV2CaseViewId(value)) setViewId(value);
          }}
          value={viewId}
        >
          <SelectUi.SelectTrigger
            aria-label="V2 comparison view"
            className="w-full sm:w-56"
            data-testid="v2-view-selector"
          >
            <SelectUi.SelectValue />
          </SelectUi.SelectTrigger>
          <SelectUi.SelectContent>
            {manifest.views.map((view) => (
              <SelectUi.SelectItem key={view.id} value={view.id}>
                {view.label}
              </SelectUi.SelectItem>
            ))}
          </SelectUi.SelectContent>
        </SelectUi.Select>
      </ArtifactUi.ArtifactHeader>
      <ArtifactUi.ArtifactContent className="bg-muted/40 p-0">
        <AspectRatio ratio={selectedView.ratio}>
          {/* biome-ignore lint/a11y/useMediaCaption: The verified soundtrack and timed text evidence is described immediately below the player. */}
          <video
            aria-label={`${selectedView.label} video`}
            className="size-full bg-black object-contain"
            controls
            key={selectedView.id}
            playsInline
            preload="metadata"
            src={selectedView.url}
          />
        </AspectRatio>
      </ArtifactUi.ArtifactContent>
    </ArtifactUi.Artifact>
  );
}

function isV2CaseViewId(value: string): value is V2CaseViewId {
  return (V2_CASE_VIEW_IDS as readonly string[]).includes(value);
}
