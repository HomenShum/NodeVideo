import { Button } from '@/components/ui/button';
import type { PublishedBlindPilotManifest } from '@/lib/published-blind-pilot';
import { ExternalLink } from 'lucide-react';

export function BlindPilotEvidence({ manifest }: { manifest: PublishedBlindPilotManifest }) {
  return (
    <section className="space-y-2" data-testid="blind-pilot-artifacts">
      <h3 className="font-medium">Frozen plan and post-freeze evidence</h3>
      <div className="flex flex-wrap gap-2">
        {manifest.artifacts.map((artifact) => (
          <Button asChild key={artifact.id} size="sm" variant="outline">
            <a href={artifact.url}>
              {artifact.label} <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        ))}
      </div>
    </section>
  );
}
