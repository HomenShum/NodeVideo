import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  type LoadedPublishedCaseV2,
  PUBLISHED_REAL_CASE_V2,
  type PublishedCaseV2Descriptor,
  loadPublishedCaseV2,
} from '@/lib/published-case-v2';
import { CheckCircle2, FileCheck2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { V2MediaViewer } from './v2-media-viewer';
import { V2ProofEvidence } from './v2-proof-evidence';

type ProofLoadState = 'verifying' | 'ready' | 'error';

interface V2ProofPanelProps {
  descriptor?: PublishedCaseV2Descriptor;
}

export function V2ProofPanel({ descriptor = PUBLISHED_REAL_CASE_V2 }: V2ProofPanelProps) {
  const [loadedCase, setLoadedCase] = useState<LoadedPublishedCaseV2>();
  const [loadState, setLoadState] = useState<ProofLoadState>('verifying');
  const [error, setError] = useState<string>();

  const verify = useCallback(async () => {
    setLoadState('verifying');
    setError(undefined);
    setLoadedCase(undefined);
    try {
      const verified = await loadPublishedCaseV2(descriptor);
      setLoadedCase(verified);
      setLoadState('ready');
    } catch (cause) {
      setLoadState('error');
      setError(
        cause instanceof Error ? cause.message : 'The V2 proof bundle could not be verified.',
      );
    }
  }, [descriptor]);

  useEffect(() => {
    void verify();
  }, [verify]);

  const stateLabel =
    loadState === 'verifying'
      ? 'V2 verification pending'
      : loadedCase?.releasePassed
        ? 'V2 measured gates passed'
        : 'V2 release blocked';

  return (
    <Card aria-label="Authorized V2 audiovisual proof" data-testid="v2-proof-panel">
      <CardHeader>
        <Badge
          data-testid="v2-proof-badge"
          variant={
            loadedCase?.releasePassed
              ? 'default'
              : loadState === 'verifying'
                ? 'outline'
                : 'destructive'
          }
        >
          {stateLabel}
        </Badge>
        <CardTitle>{loadedCase?.manifest.title ?? descriptor.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          aria-live="polite"
          className="flex min-h-10 min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          data-testid="v2-integrity"
        >
          {loadState === 'verifying' ? <Spinner /> : <FileCheck2 aria-hidden="true" />}
          <span className="min-w-0 break-words">
            {loadState === 'verifying'
              ? 'Verifying the trusted manifest and every declared proof asset…'
              : loadedCase
                ? `${loadedCase.integrity.verifiedAssetCount} proof assets plus the trusted manifest are SHA-256 verified.`
                : `Verification stopped. ${error}`}
          </span>
        </div>

        {loadState === 'error' ? (
          <Alert variant="destructive" data-testid="v2-verification-error">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>V2 is not presented as a pass</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              <Button className="mt-3" onClick={() => void verify()} size="sm" variant="outline">
                <RefreshCw aria-hidden="true" /> Retry verification
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {loadedCase ? (
          <>
            <Alert
              data-testid="v2-verdict"
              variant={loadedCase.releasePassed ? 'default' : 'destructive'}
            >
              {loadedCase.releasePassed ? (
                <CheckCircle2 aria-hidden="true" />
              ) : (
                <TriangleAlert aria-hidden="true" />
              )}
              <AlertTitle>
                {loadedCase.releasePassed
                  ? 'Measured reconstruction gates passed'
                  : 'Release gates remain blocked'}
              </AlertTitle>
              <AlertDescription>
                <p>{loadedCase.manifest.verdict.summary}</p>
                {loadedCase.manifest.verdict.releaseBlockers.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {loadedCase.manifest.verdict.releaseBlockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                ) : null}
              </AlertDescription>
            </Alert>
            <V2MediaViewer manifest={loadedCase.manifest} />
            <V2ProofEvidence manifest={loadedCase.manifest} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
