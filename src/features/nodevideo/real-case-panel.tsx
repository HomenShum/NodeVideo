import { TraceWaterfall } from '@/components/TraceWaterfall';
import * as ArtifactUi from '@/components/ai-elements/artifact';
import { Checkpoint, CheckpointIcon } from '@/components/ai-elements/checkpoint';
import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import * as SelectUi from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import * as Case from '@/lib/published-cases';
import { FileJson2, Play, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export function RealCasePanel() {
  const [loadedCase, setLoadedCase] = useState<Case.LoadedPublishedCase>();
  const [viewId, setViewId] = useState<Case.RealCaseViewId>('side-by-side');
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState<string>();
  const selectedView = loadedCase?.views.find((view) => view.id === viewId);
  const metrics = loadedCase?.manifest.metrics;
  const presentation = Case.REAL_CASE_VIEW_PRESENTATION[viewId];
  const integrityMessage = error
    ? `Not fully checked. ${error}`
    : loadedCase
      ? `${loadedCase.integrity.verifiedAssetCount}/6 deployed videos, poster, and V2 invalidation adjudication are SHA-256-verified`
      : 'Deployed asset hashes have not been checked yet';

  async function handleLoad() {
    setLoadState('loading');
    setError(undefined);
    setLoadedCase(undefined);
    setViewId('side-by-side');
    try {
      setLoadedCase(await Case.loadPublishedCase());
      setLoadState('ready');
    } catch (cause) {
      setLoadState('error');
      setError(
        cause instanceof Error ? cause.message : 'The published case could not be verified.',
      );
    }
  }

  return (
    <Card aria-label="Owner-authorized real-media reconstruction">
      <CardHeader>
        <Badge variant="destructive">V1 invalidated · retained as failure evidence</Badge>
        <CardTitle>{Case.PUBLISHED_REAL_CASE.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive" data-testid="case-invalidated">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Do not treat this run as a reconstruction pass</AlertTitle>
          <AlertDescription>
            {loadedCase?.adjudication.summary ?? Case.REAL_CASE_COPY.invalidated}
          </AlertDescription>
        </Alert>
        <Alert>
          <ShieldCheck aria-hidden="true" />
          <AlertTitle data-testid="case-consent">Owner-authorized publication</AlertTitle>
          <AlertDescription data-testid="target-usage">
            {Case.REAL_CASE_COPY.consent} {Case.REAL_CASE_COPY.targetUsage}
          </AlertDescription>
        </Alert>
        <Button
          className="w-full sm:w-auto"
          data-testid="real-case-load"
          disabled={loadState === 'loading'}
          onClick={handleLoad}
        >
          {loadState === 'loading' ? <Spinner /> : <Play aria-hidden="true" />}
          {loadState === 'loading'
            ? 'Verifying deployed media…'
            : loadedCase
              ? 'Verify case again'
              : 'Load and verify real case'}
        </Button>
        {error ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>Verification stopped</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Checkpoint className="flex-wrap gap-2 overflow-visible" data-testid="asset-integrity">
          <CheckpointIcon />
          <span className="min-w-0 flex-1" aria-live="polite">
            {integrityMessage}
          </span>
        </Checkpoint>
        {selectedView ? (
          <ArtifactUi.Artifact className={`mx-auto w-full ${presentation.width}`}>
            <ArtifactUi.ArtifactHeader className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <ArtifactUi.ArtifactTitle>
                {Case.REAL_CASE_VIEW_LABELS[selectedView.id]}
              </ArtifactUi.ArtifactTitle>
              <SelectUi.Select
                value={viewId}
                onValueChange={(value) => setViewId(value as Case.RealCaseViewId)}
              >
                <SelectUi.SelectTrigger className="w-full sm:w-56" aria-label="Comparison view">
                  <SelectUi.SelectValue />
                </SelectUi.SelectTrigger>
                <SelectUi.SelectContent>
                  {loadedCase?.views.map((view) => (
                    <SelectUi.SelectItem key={view.id} value={view.id}>
                      {Case.REAL_CASE_VIEW_LABELS[view.id]}
                    </SelectUi.SelectItem>
                  ))}
                </SelectUi.SelectContent>
              </SelectUi.Select>
            </ArtifactUi.ArtifactHeader>
            <ArtifactUi.ArtifactContent className="bg-black p-0">
              <AspectRatio ratio={presentation.ratio} className="bg-black">
                {/* biome-ignore lint/a11y/useMediaCaption: This footage has no dialogue captions to publish. */}
                <video
                  key={selectedView.url}
                  aria-label={`${Case.REAL_CASE_VIEW_LABELS[selectedView.id]} video`}
                  className="size-full object-contain"
                  controls
                  playsInline
                  poster={
                    viewId === 'side-by-side' ? Case.PUBLISHED_REAL_CASE.posterUrl : undefined
                  }
                  preload="metadata"
                  src={selectedView.url}
                />
              </AspectRatio>
            </ArtifactUi.ArtifactContent>
          </ArtifactUi.Artifact>
        ) : null}
        <Card data-testid="quality-summary" size="sm">
          <CardHeader>
            <CardTitle>Historical aggregate metrics · diagnostic only</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            <p data-testid="metric-ssim">SSIM · {metrics?.ssim.toFixed(6) ?? '—'}</p>
            <p data-testid="metric-psnr">
              PSNR · {metrics ? `${metrics.psnrDb.toFixed(6)} dB` : '—'}
            </p>
            <p>VMAF · {metrics?.vmaf.toFixed(6) ?? '—'}</p>
            <p className="text-xs text-muted-foreground sm:col-span-3">
              Not a pass: VMAF 29.819468, soundtrack excluded, timed overlays incomplete, and the
              permanent 16.067–19.633 second regression window uses the wrong source motion.
            </p>
          </CardContent>
        </Card>
        <Tool className="mb-0">
          <ToolHeader
            type="dynamic-tool"
            toolName="nodevideo.reference-reconstruct"
            title={loadedCase ? 'Recorded worker trace · 7 spans' : 'Verify worker proof'}
            state={Case.REAL_CASE_TOOL_STATES[loadState]}
          />
          <ToolContent>
            <p className="text-sm text-muted-foreground">{Case.REAL_CASE_COPY.replay}</p>
            {loadedCase ? <TraceWaterfall spans={loadedCase.traceSpans} /> : null}
            <Button asChild variant="outline" data-testid="real-case-receipt">
              <a href={Case.PUBLISHED_REAL_CASE.receiptUrl} target="_blank" rel="noreferrer">
                <FileJson2 aria-hidden="true" /> Open JSON receipt
              </a>
            </Button>
          </ToolContent>
        </Tool>
      </CardContent>
    </Card>
  );
}
