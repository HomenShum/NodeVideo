import './collab.css';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AlertCircle, Columns2, Download, Pause, Play, Rows2 } from 'lucide-react';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Layout = 'side-by-side' | 'top-bottom';

// Everything on this page happens in the browser: decode, composite, record.
// No worker, no upload, no account. Export is WebM (what MediaRecorder can
// honestly produce); the studio pipeline remains the path to bit-controlled MP4.
function CollabEditor() {
  const [takeFile, setTakeFile] = useState<File | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [layout, setLayout] = useState<Layout>('side-by-side');
  const [offsetMs, setOffsetMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const takeUrl = useMemo(() => (takeFile ? URL.createObjectURL(takeFile) : ''), [takeFile]);
  const referenceUrl = useMemo(
    () => (referenceFile ? URL.createObjectURL(referenceFile) : ''),
    [referenceFile],
  );
  const takeRef = useRef<HTMLVideoElement>(null);
  const referenceRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => () => void (takeUrl && URL.revokeObjectURL(takeUrl)), [takeUrl]);
  useEffect(() => () => void (referenceUrl && URL.revokeObjectURL(referenceUrl)), [referenceUrl]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const take = takeRef.current;
      const reference = referenceRef.current;
      if (canvas && take && reference && take.videoWidth && reference.videoWidth) {
        const context = canvas.getContext('2d');
        if (context) {
          context.fillStyle = '#0c0e0a';
          context.fillRect(0, 0, canvas.width, canvas.height);
          const half =
            layout === 'side-by-side'
              ? { w: canvas.width / 2, h: canvas.height }
              : { w: canvas.width, h: canvas.height / 2 };
          const place = (video: HTMLVideoElement, index: number) => {
            const scale = Math.min(half.w / video.videoWidth, half.h / video.videoHeight);
            const width = video.videoWidth * scale;
            const height = video.videoHeight * scale;
            const x =
              layout === 'side-by-side'
                ? index * half.w + (half.w - width) / 2
                : (half.w - width) / 2;
            const y =
              layout === 'side-by-side'
                ? (half.h - height) / 2
                : index * half.h + (half.h - height) / 2;
            context.drawImage(video, x, y, width, height);
          };
          place(reference, 0);
          place(take, 1);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [layout]);

  function syncReference() {
    const take = takeRef.current;
    const reference = referenceRef.current;
    if (!take || !reference) return;
    reference.currentTime = Math.max(0, take.currentTime + offsetMs / 1000);
  }

  async function togglePlay() {
    const take = takeRef.current;
    const reference = referenceRef.current;
    if (!take || !reference) return;
    if (playing) {
      take.pause();
      reference.pause();
      setPlaying(false);
      return;
    }
    syncReference();
    await Promise.all([take.play(), reference.play()]).catch(() => {
      setError('The browser could not decode one of the videos. MP4 or MOV (H.264) works best.');
    });
    setPlaying(true);
  }

  function nudge(delta: number) {
    setOffsetMs((current) => {
      const next = current + delta;
      return Math.abs(next) > 10_000 ? current : next;
    });
  }

  useEffect(() => {
    const take = takeRef.current;
    const reference = referenceRef.current;
    if (!take || !reference) return;
    reference.currentTime = Math.max(0, take.currentTime + offsetMs / 1000);
  }, [offsetMs]);

  function exportCollab() {
    const canvas = canvasRef.current;
    const take = takeRef.current;
    const reference = referenceRef.current;
    if (!canvas || !take || !reference) return;
    setError('');
    const stream = canvas.captureStream(30);
    const withAudio = (reference as HTMLVideoElement & { captureStream?: () => MediaStream })
      .captureStream;
    if (withAudio) {
      for (const track of withAudio.call(reference).getAudioTracks()) stream.addTrack(track);
    }
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    recorder.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'nodevideo-collab.webm';
      anchor.click();
      URL.revokeObjectURL(url);
      setRecording(false);
    };
    recorderRef.current = recorder;
    take.currentTime = 0;
    syncReference();
    void Promise.all([take.play(), reference.play()]);
    setPlaying(true);
    recorder.start();
    setRecording(true);
    take.onended = () => {
      recorder.state !== 'inactive' && recorder.stop();
      reference.pause();
      setPlaying(false);
    };
  }

  const ready = Boolean(takeFile && referenceFile);
  return (
    <main className="mx-auto min-h-svh max-w-5xl space-y-6 p-4 sm:p-6" data-testid="collab-editor">
      <header className="space-y-1">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          NodeVideo · Collab editor
        </p>
        <h1 className="font-heading text-2xl font-semibold sm:text-3xl">
          Dance next to the original.
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Load the reference video and your take, line them up, and export a side-by-side or
          top-and-bottom collab. Both videos stay in this tab — nothing ever leaves your browser.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="reference-video">Reference video</FieldLabel>
          <Input
            accept="video/mp4,video/quicktime,video/webm"
            id="reference-video"
            onChange={(event) => setReferenceFile(event.target.files?.[0] ?? null)}
            type="file"
          />
          <FieldDescription>
            A saved copy of the original (YouTube and Instagram pages cannot be captured directly —
            use your downloaded file).
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="take-video">Your take</FieldLabel>
          <Input
            accept="video/mp4,video/quicktime,video/webm"
            id="take-video"
            onChange={(event) => setTakeFile(event.target.files?.[0] ?? null)}
            type="file"
          />
          <FieldDescription>Your camera recording. Its length drives the export.</FieldDescription>
        </Field>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Layout and alignment</CardTitle>
          <CardDescription>
            Reference plays {layout === 'side-by-side' ? 'left' : 'on top'}; your take{' '}
            {layout === 'side-by-side' ? 'right' : 'below'}. Nudge the reference until the first
            landing matches.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              aria-pressed={layout === 'side-by-side'}
              onClick={() => setLayout('side-by-side')}
              size="sm"
              type="button"
              variant={layout === 'side-by-side' ? 'default' : 'outline'}
            >
              <Columns2 aria-hidden="true" /> Side by side
            </Button>
            <Button
              aria-pressed={layout === 'top-bottom'}
              onClick={() => setLayout('top-bottom')}
              size="sm"
              type="button"
              variant={layout === 'top-bottom' ? 'default' : 'outline'}
            >
              <Rows2 aria-hidden="true" /> Top and bottom
            </Button>
            <span className="mx-2 h-5 w-px bg-border" />
            <Button onClick={() => nudge(-100)} size="sm" type="button" variant="outline">
              Reference −0.1s
            </Button>
            <span className="font-mono text-xs text-muted-foreground">
              {(offsetMs / 1000).toFixed(1)}s
            </span>
            <Button onClick={() => nudge(100)} size="sm" type="button" variant="outline">
              Reference +0.1s
            </Button>
          </div>

          <canvas
            aria-label="Collab preview"
            className="w-full rounded-xl border border-border bg-black"
            height={layout === 'side-by-side' ? 720 : 1280}
            ref={canvasRef}
            role="img"
            width={layout === 'side-by-side' ? 1280 : 720}
          />
          {/* Hidden decoders that feed the compositor. Captions cannot exist
              for user-supplied local files; the visible output is the canvas. */}
          <video className="hidden" muted playsInline ref={takeRef} src={takeUrl} />
          {/* biome-ignore lint/a11y/useMediaCaption: user-supplied local file; audio is the dance track itself */}
          <video className="hidden" playsInline ref={referenceRef} src={referenceUrl} />

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!ready || recording} onClick={togglePlay} type="button">
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              {playing ? 'Pause preview' : 'Play preview'}
            </Button>
            <Button
              disabled={!ready || recording}
              onClick={exportCollab}
              type="button"
              variant="secondary"
            >
              <Download aria-hidden="true" />
              {recording ? 'Recording…' : 'Export collab video'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Exports WebM in real time with the reference audio. For frame-exact MP4 delivery, use
              the studio pipeline.
            </span>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Could not play the videos</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <footer className="text-xs text-muted-foreground">
        Rights note: only export collabs you have permission to make from both videos. NodeVideo
        never uploads either file.
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <CollabEditor />
  </StrictMode>,
);
