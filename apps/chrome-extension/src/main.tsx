import './extension.css';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Progress } from '@/components/ui/progress';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { AlertCircle, ChevronDown, Film, Play, Upload } from 'lucide-react';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Artifact = { name: string; contentType: string; url: string };
type Moment = { referenceTime: number; attemptTime: number; severity: number };
type Verdict = {
  status: 'completed' | 'abstained';
  confidence: number;
  overall: number | null;
  scoreInterpretation?: 'relative-motion-signal-not-calibrated-pass-fail';
  scores: Record<string, number>;
  measurements?: {
    comparisonMode?: 'team' | 'solo-focal-performer';
    medianTimingErrorMs?: number;
    referencePeopleUsed?: number[];
  };
  criticalMoments: Moment[];
  limitations: string[];
};
type Job = {
  id: string;
  status: string;
  stage: string;
  progress: number;
  events?: Array<{ detail: string }>;
  error?: string;
  verdict?: Verdict;
  artifacts: Record<string, Artifact>;
};
type ExtensionApi = {
  tabs: { query(options: object): Promise<Array<{ url?: string; title?: string }>> };
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(values: object): Promise<void>;
    };
  };
};

const extensionApi = (globalThis as { chrome?: ExtensionApi }).chrome?.tabs?.query
  ? (globalThis as { chrome: ExtensionApi }).chrome
  : null;

function CoachPanel() {
  const preview = useMemo(() => new URLSearchParams(location.search), []);
  const [reference, setReference] = useState({ url: '', title: 'Open a YouTube dance video' });
  const [attempt, setAttempt] = useState<File | null>(null);
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:4319');
  const [token, setToken] = useState('');
  const [people, setPeople] = useState(10);
  const [referenceStart, setReferenceStart] = useState(preview.get('referenceStart') ?? '');
  const [referenceEnd, setReferenceEnd] = useState(preview.get('referenceEnd') ?? '');
  const [rights, setRights] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [comparisonUrl, setComparisonUrl] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(
    () => () => {
      if (comparisonUrl) URL.revokeObjectURL(comparisonUrl);
    },
    [comparisonUrl],
  );

  useEffect(() => {
    if (!job || ['completed', 'abstained', 'failed'].includes(job.status)) return;
    const timer = window.setTimeout(() => void refreshJob(job.id), 1100);
    return () => window.clearTimeout(timer);
  }, [job]);

  async function initialize() {
    const [tab] = extensionApi
      ? await extensionApi.tabs.query({ active: true, currentWindow: true })
      : [
          {
            url: preview.get('referenceUrl') ?? 'https://www.youtube.com/watch?v=ssA5AJdQtlc',
            title: '10count choreography · UI preview',
          },
        ];
    const url = isYouTubeWatch(tab?.url) ? (tab?.url ?? '') : '';
    setReference({
      url,
      title: url ? tab?.title || 'YouTube reference' : 'Open a YouTube dance video',
    });
    const saved = extensionApi
      ? await extensionApi.storage.local.get(['endpoint', 'token', 'people'])
      : { endpoint: 'http://127.0.0.1:4319', token: preview.get('token') ?? '', people: 10 };
    if (typeof saved.endpoint === 'string') setEndpoint(saved.endpoint);
    if (typeof saved.token === 'string') setToken(saved.token);
    if (typeof saved.people === 'number') setPeople(saved.people);
    const previewJob = preview.get('job');
    if (!extensionApi && previewJob && typeof saved.token === 'string') {
      await refreshJob(previewJob, String(saved.endpoint), saved.token);
    }
  }

  async function refreshJob(id: string, base = endpoint, bearer = token) {
    try {
      const response = await fetch(`${base}/v1/jobs/${id}`, { headers: authorization(bearer) });
      const value = (await response.json()) as Job & { error?: string };
      if (!response.ok) throw new Error(humanError(value.error));
      setJob(value);
      if (value.status === 'failed') {
        setBusy(false);
        setError(value.error ? humanError(value.error) : 'The comparison worker failed.');
      }
      if (['completed', 'abstained'].includes(value.status)) setBusy(false);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : 'Could not reach the local worker.');
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!reference.url)
      return setError('Open the reference choreography on a YouTube watch page first.');
    if (!attempt) return setError('Choose your dance video.');
    if (!token.trim()) return setError('Paste the token printed by the local NodeVideo worker.');
    if (!rights) return setError('Confirm that you have permission to analyze both videos.');
    const hasReferenceStart = referenceStart.trim() !== '';
    const hasReferenceEnd = referenceEnd.trim() !== '';
    if (hasReferenceStart !== hasReferenceEnd)
      return setError('Enter both the start and end of the reference choreography segment.');
    const referenceStartValue = Number(referenceStart);
    const referenceEndValue = Number(referenceEnd);
    if (
      hasReferenceStart &&
      (!Number.isFinite(referenceStartValue) ||
        !Number.isFinite(referenceEndValue) ||
        referenceStartValue < 0 ||
        referenceEndValue <= referenceStartValue ||
        referenceEndValue - referenceStartValue > 90)
    )
      return setError('Reference segment must be a valid range no longer than 90 seconds.');
    const base = endpoint.replace(/\/$/, '');
    if (extensionApi) await extensionApi.storage.local.set({ endpoint: base, token, people });
    const body = new FormData();
    body.set('attempt', attempt);
    body.set('referenceUrl', reference.url);
    body.set('rightsConfirmed', 'true');
    body.set('people', String(people));
    if (hasReferenceStart) {
      body.set('referenceStartSeconds', String(referenceStartValue));
      body.set('referenceEndSeconds', String(referenceEndValue));
    }
    setBusy(true);
    setJob({
      id: '',
      status: 'uploading',
      stage: 'uploading_attempt',
      progress: 2,
      events: [{ detail: 'Sending video to this laptop only' }],
      artifacts: {},
    });
    try {
      const response = await fetch(`${base}/v1/jobs`, {
        method: 'POST',
        headers: authorization(token),
        body,
      });
      const value = (await response.json()) as Job & { error?: string };
      if (!response.ok) throw new Error(humanError(value.error));
      setEndpoint(base);
      setJob(value);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : 'Upload failed.');
    }
  }

  async function loadArtifact(artifact: Artifact, download = false) {
    if (!job) return;
    const response = await fetch(`${endpoint}${artifact.url}`, { headers: authorization(token) });
    if (!response.ok) return setError('Artifact could not be loaded.');
    const url = URL.createObjectURL(await response.blob());
    if (download) {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${job.id}-${artifact.name}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (comparisonUrl) URL.revokeObjectURL(comparisonUrl);
    setComparisonUrl(url);
  }

  const verdict = job?.verdict;
  return (
    <main className="mx-auto min-h-svh max-w-lg space-y-4 bg-background p-3 text-foreground sm:p-4">
      <header className="flex items-center gap-2 py-1">
        <Item className="p-0">
          <ItemMedia
            className="size-9 rounded-lg bg-primary text-primary-foreground"
            variant="icon"
          >
            <Film className="size-4" aria-hidden="true" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle className="font-heading">NodeVideo</ItemTitle>
            <ItemDescription>Choreography coach · local beta</ItemDescription>
          </ItemContent>
        </Item>
      </header>

      <Card size="sm">
        <CardHeader>
          <Badge className="mb-1" variant="outline">
            Reference on this page
          </Badge>
          <CardTitle>
            <h1>{reference.title}</h1>
          </CardTitle>
          <CardDescription className="break-all">
            {reference.url || 'This panel reads only the active YouTube watch URL.'}
          </CardDescription>
        </CardHeader>
      </Card>

      <form className="space-y-4" onSubmit={submit}>
        <Field>
          <FieldLabel htmlFor="attempt">Your dance take</FieldLabel>
          <Input
            id="attempt"
            type="file"
            accept="video/mp4,video/quicktime"
            onChange={(event) => setAttempt(event.target.files?.[0] ?? null)}
          />
          <FieldDescription>
            MP4 or MOV · processed on this laptop{attempt ? ` · ${formatBytes(attempt.size)}` : ''}
          </FieldDescription>
        </Field>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button className="w-full justify-between" type="button" variant="outline">
              Segment, team, and connection
              <ChevronDown aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <Card size="sm">
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel>Reference choreography segment</FieldLabel>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        aria-label="Reference start seconds"
                        inputMode="decimal"
                        min={0}
                        placeholder="Start seconds"
                        type="number"
                        value={referenceStart}
                        onChange={(event) => setReferenceStart(event.target.value)}
                      />
                      <Input
                        aria-label="Reference end seconds"
                        inputMode="decimal"
                        min={0}
                        placeholder="End seconds"
                        type="number"
                        value={referenceEnd}
                        onChange={(event) => setReferenceEnd(event.target.value)}
                      />
                    </div>
                    <FieldDescription>
                      Use the exact music/choreography section. NodeVideo will locate that section
                      inside your longer raw take.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="people">Maximum dancers to track</FieldLabel>
                    <Input
                      id="people"
                      type="number"
                      min={1}
                      max={10}
                      value={people}
                      onChange={(event) =>
                        setPeople(Math.max(1, Math.min(10, Number(event.target.value))))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="endpoint">Local service</FieldLabel>
                    <Input
                      id="endpoint"
                      type="url"
                      value={endpoint}
                      onChange={(event) => setEndpoint(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="token">Service token</FieldLabel>
                    <Input
                      id="token"
                      type="password"
                      autoComplete="off"
                      placeholder="Shown when the worker starts"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                    />
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        <Field orientation="horizontal">
          <Checkbox
            checked={rights}
            id="rights"
            onCheckedChange={(value) => setRights(value === true)}
          />
          <FieldLabel htmlFor="rights">
            I have permission to privately analyze this reference and my upload.
          </FieldLabel>
        </Field>
        <Button className="w-full" disabled={busy} size="lg" type="submit">
          <Upload aria-hidden="true" />
          {busy ? 'Comparing…' : 'Judge choreography'}
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Measures visible 2D form, timing, path, and dynamics. Formation is included when both
          videos show a team. It does not grade artistry, expression, identity, or safety.
        </p>
      </form>

      {job && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>{label(job.stage)}</CardTitle>
            <CardAction>{job.progress}%</CardAction>
          </CardHeader>
          <CardContent className="space-y-2">
            <Progress aria-label="Comparison progress" value={job.progress} />
            <p className="text-xs text-muted-foreground">
              {job.events?.at(-1)?.detail || 'Working…'}
            </p>
          </CardContent>
        </Card>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Could not complete the comparison</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {verdict && (
        <Card>
          <CardHeader>
            <Badge variant="outline">Evidence-backed verdict</Badge>
            <CardTitle className="text-2xl">
              {verdict.status === 'abstained'
                ? 'Needs a clearer take'
                : `${Math.round(verdict.overall ?? 0)} / 100`}
            </CardTitle>
            <CardAction>
              <Badge variant="secondary">{Math.round(verdict.confidence * 100)}% evidence</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            {verdict.scoreInterpretation === 'relative-motion-signal-not-calibrated-pass-fail' && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Relative motion score for comparing takes—not a calibrated pass/fail grade.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {verdict.measurements?.comparisonMode === 'solo-focal-performer' && (
                <Badge variant="outline">Focal dancer matched</Badge>
              )}
              {verdict.measurements?.comparisonMode === 'team' && (
                <Badge variant="outline">Team formation included</Badge>
              )}
              {verdict.measurements?.medianTimingErrorMs !== undefined && (
                <Badge variant="secondary">
                  {Math.round(verdict.measurements.medianTimingErrorMs)} ms median timing drift
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(verdict.scores).map(([name, value]) => (
                <Card className="min-w-32 flex-1" key={name} size="sm">
                  <CardContent>
                    <strong className="block text-xl">{Math.round(value)}</strong>
                    <span className="capitalize text-muted-foreground">{name}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
            <section className="space-y-2" aria-labelledby="moments-title">
              <h2 className="font-heading font-medium" id="moments-title">
                Review these moments
              </h2>
              {verdict.criticalMoments.length ? (
                <ScrollArea className="w-full whitespace-nowrap">
                  <div className="flex w-max gap-2 pb-2">
                    {verdict.criticalMoments.map((moment) => (
                      <Button
                        key={`${moment.referenceTime}-${moment.attemptTime}`}
                        size="sm"
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          if (videoRef.current) {
                            videoRef.current.currentTime = moment.referenceTime;
                            void videoRef.current.play();
                          }
                        }}
                      >
                        {clock(moment.referenceTime)} ref → {clock(moment.attemptTime)} take
                      </Button>
                    ))}
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No material pose mismatches detected.
                </p>
              )}
            </section>
            {comparisonUrl && (
              <video
                aria-label="Aligned choreography comparison"
                className="w-full rounded-lg bg-black"
                controls
                playsInline
                autoPlay
                ref={videoRef}
                src={comparisonUrl}
              >
                <track
                  default
                  kind="captions"
                  label="Audio note"
                  src="data:text/vtt;charset=utf-8,WEBVTT%0A%0A00:00:00.000%20--%3E%2099:59:59.000%0AReference%20soundtrack.%20No%20speech%20transcription%20is%20available."
                />
              </video>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                className="min-w-32 flex-1"
                type="button"
                variant="secondary"
                onClick={() =>
                  job.artifacts.comparison && void loadArtifact(job.artifacts.comparison)
                }
              >
                <Play aria-hidden="true" />
                Load comparison
              </Button>
              <Button
                className="min-w-32 flex-1"
                type="button"
                variant="outline"
                onClick={() =>
                  job.artifacts.verdict && void loadArtifact(job.artifacts.verdict, true)
                }
              >
                Export evidence
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}
function isYouTubeWatch(value = '') {
  try {
    const url = new URL(value);
    return (
      ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname) &&
      url.pathname === '/watch' &&
      url.searchParams.has('v')
    );
  } catch {
    return false;
  }
}
function label(value = '') {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function formatBytes(value: number) {
  return value > 1e6 ? `${(value / 1e6).toFixed(1)} MB` : `${Math.ceil(value / 1e3)} KB`;
}
function humanError(code = '') {
  return (
    (
      {
        invalid_token: 'The local service token is incorrect.',
        rights_confirmation_required: 'Confirm that you have permission to analyze both videos.',
        upload_too_large: 'The video is larger than the 700 MB local limit.',
        invalid_reference_segment: 'Enter a valid reference segment no longer than 90 seconds.',
        reference_segment_required_for_long_video:
          'Choose the exact choreography segment for reference videos longer than 90 seconds.',
      } as Record<string, string>
    )[code] || code.replaceAll('_', ' ')
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('NodeVideo extension root is missing.');
createRoot(root).render(
  <StrictMode>
    <CoachPanel />
  </StrictMode>,
);
