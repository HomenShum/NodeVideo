import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import type { LoadedIntegratedInspector } from '@/lib/integrated-inspector';
import { AudioLines, ExternalLink, ScanSearch, StepBack, StepForward } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { PoseEvidenceCard, VideoEvidenceCard, seek } from './inspector-evidence';

export function VerifiedFrameInspector({
  frame,
  loaded,
  setFrame,
}: {
  frame: number;
  loaded: LoadedIntegratedInspector;
  setFrame: (frame: number) => void;
}) {
  const { manifest, pose } = loaded;
  const maxFrame = Math.round(manifest.synchronization.durationSeconds * 30) - 1;
  const outputSeconds = frame / 30;
  const choreographySeconds = Math.min(
    outputSeconds,
    manifest.synchronization.choreographyDurationSeconds,
  );
  const phraseIndex = Math.min(
    manifest.synchronization.generatedCutsSeconds.filter((cut) => outputSeconds >= cut).length,
    manifest.synchronization.selectedTakeAssetIds.length - 1,
  );
  const generatedRef = useRef<HTMLVideoElement>(null);
  const targetRef = useRef<HTMLVideoElement>(null);
  const takeARef = useRef<HTMLVideoElement>(null);
  const takeBRef = useRef<HTMLVideoElement>(null);
  const takeATime =
    manifest.synchronization.takeOffsetsSeconds['asset.take-a'] + choreographySeconds;
  const takeBTime =
    manifest.synchronization.takeOffsetsSeconds['asset.take-b'] + choreographySeconds;
  const referenceTime = manifest.synchronization.referenceOffsetSeconds + choreographySeconds;

  useEffect(() => {
    seek(generatedRef, outputSeconds);
    seek(targetRef, outputSeconds);
    seek(takeARef, takeATime);
    seek(takeBRef, takeBTime);
  }, [outputSeconds, takeATime, takeBTime]);
  const move = useCallback(
    (delta: number) => {
      setFrame(Math.max(0, Math.min(maxFrame, frame + delta)));
    },
    [frame, maxFrame, setFrame],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move]);

  return (
    <div className="space-y-3" data-testid="verified-frame-inspector">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="h-auto max-w-full whitespace-normal text-center">
              7/7 SHA-256 verified
            </Badge>
            <Badge className="h-auto max-w-full whitespace-normal text-center" variant="outline">
              Target opened after freeze
            </Badge>
            <Badge className="h-auto max-w-full whitespace-normal text-center" variant="outline">
              LocateAnything not executed
            </Badge>
          </div>
          <CardTitle className="mt-2">One output frame controls every evidence panel</CardTitle>
          <CardDescription>
            Frame {frame} · {outputSeconds.toFixed(3)} s · phrase {phraseIndex + 1} ·{' '}
            {manifest.synchronization.selectedTakeAssetIds[phraseIndex].replace('asset.', '')} ·{' '}
            {manifest.synchronization.framingTemplates[phraseIndex]}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              aria-label="Previous output frame"
              onClick={() => move(-1)}
              size="icon"
              variant="outline"
            >
              <StepBack aria-hidden="true" />
            </Button>
            <Slider
              aria-label="Output frame"
              className="min-w-0 flex-1"
              max={maxFrame}
              min={0}
              onValueChange={([value]) => setFrame(value)}
              step={1}
              value={[frame]}
            />
            <Button
              aria-label="Next output frame"
              onClick={() => move(1)}
              size="icon"
              variant="outline"
            >
              <StepForward aria-hidden="true" />
            </Button>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <PoseEvidenceCard
              description={`Reference ${referenceTime.toFixed(3)} s`}
              mediaTime={referenceTime}
              track={pose.tracks.reference}
            />
            <VideoEvidenceCard
              description={`Source ${takeATime.toFixed(3)} s · fit lane`}
              mediaTime={takeATime}
              poseTrack={pose.tracks['take-a']}
              videoRef={takeARef}
              src={manifest.media.takeA}
              title="Creator take A"
              wide
            />
            <VideoEvidenceCard
              description={`Source ${takeBTime.toFixed(3)} s · fill lane`}
              mediaTime={takeBTime}
              poseTrack={pose.tracks['take-b']}
              videoRef={takeBRef}
              src={manifest.media.takeB}
              title="Creator take B"
              wide
            />
            <VideoEvidenceCard
              description="Autonomous output · public copy is silent"
              mediaTime={outputSeconds}
              videoRef={generatedRef}
              src={manifest.media.generated}
              title="Frozen generated edit"
            />
            <VideoEvidenceCard
              description="Evaluator-only · mounted after freeze"
              mediaTime={outputSeconds}
              poseTrack={pose.tracks.target}
              videoRef={targetRef}
              src={manifest.media.target}
              title="Manual final MP4"
            />
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <ProofCard
          icon={<ScanSearch className="size-4" aria-hidden="true" />}
          title="Pose evidence"
        >
          Real MediaPipe analysis at {pose.tracks.reference.sampleCadenceHz.toFixed(2)} Hz.
          LocateAnything was not used because no licensed model sidecar is configured.
        </ProofCard>
        <ProofCard
          icon={<AudioLines className="size-4" aria-hidden="true" />}
          title="Music handoff"
        >
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
    </div>
  );
}

function ProofCard({
  children,
  icon,
  title,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
}) {
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
