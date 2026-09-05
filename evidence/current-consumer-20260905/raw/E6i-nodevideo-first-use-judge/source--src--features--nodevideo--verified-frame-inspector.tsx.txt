import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Item } from '@/components/ui/item';
import { Slider } from '@/components/ui/slider';
import type { LoadedIntegratedInspector } from '@/lib/integrated-inspector';
import { StepBack, StepForward, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { PoseEvidenceCard, VideoEvidenceCard, seek } from './inspector-evidence';
import { InspectorProof } from './inspector-proof';
import { LOCAL_PREVIEW_URL, useLocalPreview } from './local-preview';

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
  const localPreview = useLocalPreview();
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
    <div className="space-y-5" data-testid="verified-frame-inspector">
      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="h-auto max-w-full whitespace-normal text-center">
              7/7 SHA-256 verified
            </Badge>
            <Badge className="h-auto max-w-full whitespace-normal text-center" variant="outline">
              Target opened after freeze
            </Badge>
            <Badge className="h-auto max-w-full whitespace-normal text-center">
              Strict timing passed
            </Badge>
            <Badge
              className="h-auto max-w-full whitespace-normal text-center"
              variant={localPreview ? 'default' : 'outline'}
            >
              {localPreview ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
              {localPreview ? 'Local soundtrack enabled' : 'Public proof · silent'}
            </Badge>
          </div>
          <CardTitle className="mt-2">Compare the strict-passing frozen edit</CardTitle>
          <CardDescription className="font-mono tabular-nums">
            Frame {frame} · {outputSeconds.toFixed(3)} s · phrase {phraseIndex + 1} ·{' '}
            {manifest.synchronization.selectedTakeAssetIds[phraseIndex].replace('asset.', '')} ·{' '}
            {manifest.synchronization.framingTemplates[phraseIndex]}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Item className="flex-nowrap" variant="muted">
            <Button
              aria-label="Previous output frame"
              onClick={() => move(-1)}
              size="icon"
              variant="ghost"
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
              variant="ghost"
            >
              <StepForward aria-hidden="true" />
            </Button>
          </Item>
          <div className="grid gap-3 md:grid-cols-2" data-testid="outcome-comparison">
            <VideoEvidenceCard
              controls
              description={
                localPreview
                  ? 'Private local render · soundtrack enabled'
                  : 'Hash-bound public render · silent'
              }
              mediaTime={outputSeconds}
              muted={!localPreview}
              onPlaybackTime={(seconds) =>
                localPreview && setFrame(Math.min(maxFrame, Math.round(seconds * 30)))
              }
              videoRef={generatedRef}
              src={localPreview ? LOCAL_PREVIEW_URL : manifest.media.generated}
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

      <section className="space-y-3" aria-labelledby="frame-evidence-title">
        <div>
          <h2 className="font-heading text-xl font-semibold" id="frame-evidence-title">
            Why this frame
          </h2>
          <p className="text-sm text-muted-foreground">
            Official movement and both raw takes at the same choreography moment.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="motion-evidence">
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
        </div>
      </section>
      <InspectorProof cadence={pose.tracks.reference.sampleCadenceHz} manifest={manifest} />
    </div>
  );
}
