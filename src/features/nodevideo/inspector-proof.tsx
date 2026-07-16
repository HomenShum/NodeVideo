import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { IntegratedInspectorManifest } from '@/lib/integrated-inspector';
import { AudioLines, CircleCheck, ExternalLink, ScanSearch } from 'lucide-react';
import type { ReactNode } from 'react';

export function InspectorProof({
  cadence,
  manifest,
}: {
  cadence: number;
  manifest: IntegratedInspectorManifest;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <ProofCard
        icon={<CircleCheck className="size-4" aria-hidden="true" />}
        title="Strict timing audit"
      >
        {manifest.result.strictCutComparison.passedAssignments}/
        {manifest.result.strictCutComparison.totalAssignments} assigned boundaries are within
        &plusmn;
        {manifest.result.strictCutComparison.thresholdFrames} frames. Maximum error:{' '}
        {manifest.result.strictCutComparison.maxAbsoluteErrorFrames} frames. Strict timing passed;
        creative taste remains not evaluated.
      </ProofCard>
      <ProofCard icon={<ScanSearch className="size-4" aria-hidden="true" />} title="Pose evidence">
        MediaPipe analysis runs at {cadence.toFixed(2)} Hz for this frozen edit. A separate live
        research stage now verifies NVIDIA LocateAnything without relabeling replay boxes.
      </ProofCard>
      <ProofCard icon={<AudioLines className="size-4" aria-hidden="true" />} title="Music handoff">
        {manifest.result.soundtrack.handoff} Private comparison: correlation{' '}
        {manifest.result.soundtrack.privateAudioCorrelation.toFixed(4)}, lag{' '}
        {manifest.result.soundtrack.bestLagMs.toFixed(2)} ms.
        <Button asChild className="mt-2" size="sm" variant="outline">
          <a href={manifest.reference.url} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden="true" /> Open official choreography
          </a>
        </Button>
      </ProofCard>
    </div>
  );
}

function ProofCard({
  children,
  icon,
  title,
}: { children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{children}</CardContent>
    </Card>
  );
}
