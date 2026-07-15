import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { buildInstagramCueSheet, buildWaveform, formatTimestamp } from '@/lib/music-handoff';
import {
  type LoadedPublishedBlindPilot,
  PUBLISHED_BLIND_PILOT,
  loadPublishedBlindPilot,
} from '@/lib/published-blind-pilot';
import {
  CheckCircle2,
  Clipboard,
  Download,
  ExternalLink,
  FileCheck2,
  Music2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { BlindPilotEvidence } from './blind-pilot-evidence';

export function BlindPilotPanel() {
  const [loaded, setLoaded] = useState<LoadedPublishedBlindPilot>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState<string>();
  const verify = useCallback(async () => {
    setError(undefined);
    setLoaded(undefined);
    try {
      setLoaded(await loadPublishedBlindPilot());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The blind pilot could not be verified.');
    }
  }, []);

  useEffect(() => void verify(), [verify]);

  const manifest = loaded?.manifest;
  const handoff = manifest?.musicHandoff;
  const copy = (label: string, value: string) =>
    navigator.clipboard.writeText(value).then(
      () => setCopied(label),
      () => setCopied(undefined),
    );
  const cueSheet = manifest ? buildInstagramCueSheet(manifest) : '';

  return (
    <Card data-testid="blind-pilot-panel">
      <CardHeader>
        <Badge variant={loaded?.protocolPassed ? 'default' : error ? 'destructive' : 'outline'}>
          {loaded?.protocolPassed
            ? 'Source-only plan frozen before target reveal'
            : error
              ? 'Blind pilot blocked'
              : 'Verifying blind-run receipt'}
        </Badge>
        <CardTitle>{manifest?.title ?? PUBLISHED_BLIND_PILOT.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          aria-live="polite"
          className="flex min-h-10 min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          data-testid="blind-pilot-integrity"
        >
          {loaded ? <FileCheck2 aria-hidden="true" /> : error ? <TriangleAlert /> : <Spinner />}
          <span className="min-w-0 break-words">
            {loaded
              ? `${loaded.integrity.verifiedAssetCount} public proof assets plus the trusted manifest are SHA-256 verified.`
              : (error ??
                'Checking source hashes, read log, freeze receipt, preview, and held-out evaluation…')}
          </span>
        </div>

        {error ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>No blind claim is shown</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {manifest && loaded?.protocolPassed ? (
          <>
            <Alert data-testid="blind-taste-boundary">
              <CheckCircle2 aria-hidden="true" />
              <AlertTitle>Blind protocol proven; generalized taste is not</AlertTitle>
              <AlertDescription>
                {manifest.verdict.summary} {manifest.verdict.limitations.join(' ')}
              </AlertDescription>
            </Alert>

            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <section
                aria-labelledby="blind-preview-title"
                className="space-y-3 rounded-lg border p-3"
              >
                <h3 className="font-heading font-medium" id="blind-preview-title">
                  Source-only clean edit
                </h3>
                <AspectRatio
                  className="overflow-hidden rounded-lg bg-black"
                  ratio={manifest.preview.ratio}
                >
                  {/* biome-ignore lint/a11y/useMediaCaption: The preview has no commercial soundtrack; its audio policy is described in the proof. */}
                  <video
                    aria-label="Blind source-only preview"
                    className="size-full object-contain"
                    controls
                    playsInline
                    preload="auto"
                    src={manifest.preview.url}
                  />
                </AspectRatio>
                <Button asChild className="w-full" variant="outline">
                  <a download href={manifest.preview.url}>
                    <Download aria-hidden="true" /> Download clean edit
                  </a>
                </Button>
              </section>

              <section
                aria-labelledby="music-handoff-title"
                className="space-y-4 rounded-lg border p-3"
                data-testid="instagram-music-handoff"
              >
                <h3
                  className="flex items-center gap-2 font-heading font-medium"
                  id="music-handoff-title"
                >
                  <Music2 aria-hidden="true" /> Finish in Instagram
                </h3>
                <div>
                  <p className="font-medium">
                    {handoff?.title} · {handoff?.artist}
                  </p>
                  <p className="text-sm text-muted-foreground">{handoff?.rationale}</p>
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap justify-between gap-2 text-xs">
                    <span>{formatTimestamp(handoff?.referenceStartSeconds ?? 0)}</span>
                    <span>
                      {formatTimestamp(handoff?.referenceEndSeconds ?? 0)} ·{' '}
                      {handoff?.referenceBasis} · {handoff?.referenceCue}
                    </span>
                  </div>
                  <div
                    aria-label={`Catalog preview reference ${formatTimestamp(handoff?.referenceStartSeconds ?? 0)} to ${formatTimestamp(handoff?.referenceEndSeconds ?? 0)}`}
                    className="flex h-8 items-center gap-1 overflow-hidden rounded-md bg-muted px-2"
                    role="img"
                  >
                    {buildWaveform(
                      handoff?.referenceDurationSeconds ?? 1,
                      handoff?.referenceStartSeconds ?? 0,
                      handoff?.referenceEndSeconds ?? 0,
                    ).map((bar) => (
                      <span
                        className={`min-w-0 flex-1 rounded-full ${bar.height} ${bar.active ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                        key={bar.index}
                      />
                    ))}
                  </div>
                </div>
                <ol className="space-y-2" data-testid="music-cue-anchors">
                  {manifest.musicHandoff.anchors.map((anchor) => (
                    <li className="rounded-lg border px-3 py-2 text-sm" key={anchor.id}>
                      <p className="font-medium">
                        {formatTimestamp(anchor.videoSeconds)} video →{' '}
                        {formatTimestamp(anchor.referenceSeconds)} preview ref
                      </p>
                      <p className="text-muted-foreground">Desired alignment: {anchor.label}</p>
                    </li>
                  ))}
                </ol>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    onClick={() => void copy('search', handoff?.searchQuery ?? '')}
                    variant="outline"
                  >
                    <Clipboard aria-hidden="true" />{' '}
                    {copied === 'search' ? 'Search copied' : 'Copy search'}
                  </Button>
                  <Button onClick={() => void copy('cues', cueSheet)} variant="outline">
                    <Clipboard aria-hidden="true" />{' '}
                    {copied === 'cues' ? 'Steps copied' : 'Copy exact steps'}
                  </Button>
                  <Button asChild className="sm:col-span-2">
                    <a href="https://www.instagram.com/reels/" rel="noreferrer" target="_blank">
                      Open Instagram Reels <ExternalLink aria-hidden="true" />
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Confirm the track in your Instagram account. Availability varies by account and
                  region; NodeVideo publishes no commercial audio and grants no music rights.
                </p>
              </section>
            </div>
            <BlindPilotEvidence manifest={manifest} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
