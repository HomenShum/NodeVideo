import './collab.css';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AlertCircle, Columns2, Download, Pause, Play, Rows2, X } from 'lucide-react';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Layout = 'side-by-side' | 'top-bottom';
type ExportPump = 'animation-frame' | 'timer-fallback';

const EXPORT_FRAME_MS = 1000 / 30;
const EXPORT_PUMP_STALL_MS = 1000;
const EXPORT_URL_LIFETIME_MS = 60_000;

function drawCollabFrame(
  canvas: HTMLCanvasElement,
  take: HTMLVideoElement,
  reference: HTMLVideoElement,
  layout: Layout,
): boolean {
  if (!take.videoWidth || !reference.videoWidth) return false;
  const context = canvas.getContext('2d');
  if (!context) return false;
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
      layout === 'side-by-side' ? index * half.w + (half.w - width) / 2 : (half.w - width) / 2;
    const y =
      layout === 'side-by-side' ? (half.h - height) / 2 : index * half.h + (half.h - height) / 2;
    context.drawImage(video, x, y, width, height);
  };
  place(reference, 0);
  place(take, 1);
  return true;
}

// Drag-and-drop intake slot. The native file input stays (labeled, focusable,
// contract-resolvable) — the label is the drop target and click target, so
// keyboard and screen-reader flows are the browser's own. The thumbnail is a
// real decoded frame from the chosen file, drawn locally; nothing uploads.
function DropSlot({
  id,
  label,
  hint,
  file,
  disabled = false,
  onFile,
}: {
  id: string;
  label: string;
  hint: string;
  file: File | null;
  disabled?: boolean;
  onFile: (file: File | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [thumb, setThumb] = useState('');
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    setThumb('');
    setSeconds(0);
    if (!file) return;
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    video.addEventListener(
      'loadeddata',
      () => {
        video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
      },
      { once: true },
    );
    video.addEventListener(
      'seeked',
      () => {
        if (cancelled) return;
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = Math.round((320 * video.videoHeight) / (video.videoWidth || 320)) || 180;
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        setThumb(canvas.toDataURL('image/jpeg', 0.7));
        setSeconds(video.duration || 0);
      },
      { once: true },
    );
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const duration = seconds
    ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
    : '';
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <label
        aria-disabled={disabled || undefined}
        className={`block rounded-xl border border-dashed p-3 transition-colors ${
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
        } ${dragging ? 'border-brand bg-brand/5' : 'border-border hover:border-foreground/40'}`}
        htmlFor={id}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (disabled) return;
          const dropped = event.dataTransfer.files?.[0];
          if (dropped?.type.startsWith('video/')) onFile(dropped);
        }}
      >
        {file && thumb ? (
          <span className="flex items-center gap-3">
            <img
              alt={`First frames of ${file.name}`}
              className="h-16 w-28 rounded-lg object-cover"
              src={thumb}
            />
            <span className="min-w-0 text-sm">
              <span className="block truncate">{file.name}</span>
              <span className="text-xs text-muted-foreground">
                {duration && `${duration} · `}tap or drop to replace
              </span>
            </span>
          </span>
        ) : (
          <span className="flex min-h-16 flex-col justify-center gap-1 text-sm">
            <span>{file ? file.name : 'Drop a video here, or tap to browse'}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </span>
        )}
      </label>
      <span className="sr-only">
        <Input
          accept="video/mp4,video/quicktime,video/webm"
          disabled={disabled}
          id={id}
          onChange={(event) => onFile(event.target.files?.[0] ?? null)}
          type="file"
        />
      </span>
    </Field>
  );
}

// Everything on this page happens in the browser: decode, composite, record.
// No worker, no upload, no account. Export is WebM (what MediaRecorder can
// honestly produce); the studio pipeline remains the path to bit-controlled MP4.
function CollabEditor() {
  const [takeFile, setTakeFile] = useState<File | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [layout, setLayout] = useState<Layout>('side-by-side');
  const [offsetMs, setOffsetMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [preparingExport, setPreparingExport] = useState(false);
  const [recording, setRecording] = useState(false);
  const [exportPump, setExportPump] = useState<ExportPump>('animation-frame');
  const [exportNotice, setExportNotice] = useState('');
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
  const exportStreamRef = useRef<MediaStream | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const lastAnimationDrawRef = useRef(0);
  const exportPumpRef = useRef<ExportPump>('animation-frame');
  const discardExportRef = useRef(false);
  const discardMessageRef = useRef('');
  const exportCompletedRef = useRef(false);
  const takeEndedRef = useRef<(() => void) | null>(null);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);
  const downloadUrlRef = useRef('');
  const revokeTimerRef = useRef<number | null>(null);
  const dragStateRef = useRef<{ x: number; offset: number } | null>(null);

  useEffect(() => () => void (takeUrl && URL.revokeObjectURL(takeUrl)), [takeUrl]);
  useEffect(() => () => void (referenceUrl && URL.revokeObjectURL(referenceUrl)), [referenceUrl]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const take = takeRef.current;
      const reference = referenceRef.current;
      if (canvas && take && reference && drawCollabFrame(canvas, take, reference, layout)) {
        lastAnimationDrawRef.current = performance.now();
        if (exportPumpRef.current !== 'animation-frame') {
          exportPumpRef.current = 'animation-frame';
          setExportPump('animation-frame');
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [layout]);

  useEffect(
    () => () => {
      if (fallbackTimerRef.current !== null) window.clearInterval(fallbackTimerRef.current);
      const take = takeRef.current;
      if (take && takeEndedRef.current) take.removeEventListener('ended', takeEndedRef.current);
      if (visibilityHandlerRef.current) {
        document.removeEventListener('visibilitychange', visibilityHandlerRef.current);
      }
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        if (recorder.state !== 'inactive') recorder.stop();
      }
      for (const track of exportStreamRef.current?.getTracks() ?? []) track.stop();
      if (revokeTimerRef.current !== null) window.clearTimeout(revokeTimerRef.current);
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    },
    [],
  );

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

  function releaseExportResources() {
    if (fallbackTimerRef.current !== null) {
      window.clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    const take = takeRef.current;
    const reference = referenceRef.current;
    if (take && takeEndedRef.current) take.removeEventListener('ended', takeEndedRef.current);
    takeEndedRef.current = null;
    if (visibilityHandlerRef.current) {
      document.removeEventListener('visibilitychange', visibilityHandlerRef.current);
      visibilityHandlerRef.current = null;
    }
    take?.pause();
    reference?.pause();
    for (const track of exportStreamRef.current?.getTracks() ?? []) track.stop();
    exportStreamRef.current = null;
    recorderRef.current = null;
    setPlaying(false);
  }

  function scheduleDownload(blob: Blob) {
    if (revokeTimerRef.current !== null) window.clearTimeout(revokeTimerRef.current);
    if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    const url = URL.createObjectURL(blob);
    downloadUrlRef.current = url;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'nodevideo-collab.webm';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoking synchronously can race the browser's download handoff. Retain
    // the local object URL briefly, then release it (or immediately on unmount).
    revokeTimerRef.current = window.setTimeout(() => {
      if (downloadUrlRef.current === url) downloadUrlRef.current = '';
      URL.revokeObjectURL(url);
      revokeTimerRef.current = null;
    }, EXPORT_URL_LIFETIME_MS);
  }

  function cancelExport(message = 'Export cancelled. No partial file was downloaded.') {
    discardExportRef.current = true;
    discardMessageRef.current = message;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }
    releaseExportResources();
    setPreparingExport(false);
    setRecording(false);
    setExportNotice(message);
  }

  function exportCollab() {
    const canvas = canvasRef.current;
    const take = takeRef.current;
    const reference = referenceRef.current;
    if (!canvas || !take || !reference || preparingExport || recording) return;
    setError('');
    setExportNotice('Preparing the local WebM recorder…');
    if (document.hidden) {
      setError('Keep this tab visible before starting an export. No file was created.');
      setExportNotice('');
      return;
    }
    if (!('captureStream' in canvas) || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record the collab canvas. Try a current Chromium browser.');
      setExportNotice('');
      return;
    }
    if (!drawCollabFrame(canvas, take, reference, layout)) {
      setError('The videos are still decoding. Wait for both thumbnails, then try export again.');
      setExportNotice('');
      return;
    }
    setPreparingExport(true);
    try {
      const stream = canvas.captureStream(30);
      // Retain the stream before any later setup can throw, so every failure
      // path can stop its canvas and audio tracks.
      exportStreamRef.current = stream;
      const withAudio = (reference as HTMLVideoElement & { captureStream?: () => MediaStream })
        .captureStream;
      if (withAudio) {
        for (const track of withAudio.call(reference).getAudioTracks()) stream.addTrack(track);
      }
      const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      const mimeType =
        typeof MediaRecorder.isTypeSupported === 'function'
          ? mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
          : 'video/webm';
      if (!mimeType) throw new Error('webm_not_supported');
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      discardExportRef.current = false;
      discardMessageRef.current = '';
      exportCompletedRef.current = false;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      recorder.onerror = () => {
        cancelExport('The browser recorder failed. No partial file was downloaded.');
      };
      recorder.onstop = () => {
        const discarded = discardExportRef.current || !exportCompletedRef.current;
        const message =
          discardMessageRef.current ||
          'The recorder stopped before the take finished. NodeVideo discarded the partial file.';
        const blob = new Blob(chunks, { type: 'video/webm' });
        releaseExportResources();
        setPreparingExport(false);
        setRecording(false);
        if (discarded) {
          setExportNotice(message || 'Export cancelled. No partial file was downloaded.');
          return;
        }
        if (blob.size === 0) {
          setExportNotice('');
          setError('The browser recorder produced an empty file, so NodeVideo discarded it.');
          return;
        }
        scheduleDownload(blob);
        setExportNotice('Collab exported. Your WebM download should start now.');
      };

      take.currentTime = 0;
      syncReference();
      drawCollabFrame(canvas, take, reference, layout);
      const playback = Promise.all([take.play(), reference.play()]);
      const failClosedWhenHidden = () => {
        if (document.hidden && recorderRef.current === recorder) {
          cancelExport(
            'Export cancelled because this tab was hidden. Keep it visible and try again; no partial file was downloaded.',
          );
        }
      };
      visibilityHandlerRef.current = failClosedWhenHidden;
      document.addEventListener('visibilitychange', failClosedWhenHidden);
      const onTakeEnded = () => {
        exportCompletedRef.current = true;
        if (recorder.state !== 'inactive') recorder.stop();
      };
      takeEndedRef.current = onTakeEnded;
      take.addEventListener('ended', onTakeEnded, { once: true });
      setPlaying(true);
      recorder.start(1000);
      setRecording(true);
      setPreparingExport(false);
      exportPumpRef.current = 'animation-frame';
      setExportPump('animation-frame');
      lastAnimationDrawRef.current = performance.now();
      // rAF gives the smooth visible preview. This independent timer becomes
      // the compositor pump if rAF stalls while the tab is still visible.
      let lastPumpTick = performance.now();
      fallbackTimerRef.current = window.setInterval(() => {
        if (recorderRef.current !== recorder) return;
        const now = performance.now();
        const pumpGap = now - lastPumpTick;
        lastPumpTick = now;
        const animationGap = now - lastAnimationDrawRef.current;
        if (pumpGap > EXPORT_PUMP_STALL_MS && animationGap > EXPORT_PUMP_STALL_MS) {
          cancelExport(
            'Export cancelled because the browser paused both compositor pumps. No partial file was downloaded.',
          );
          return;
        }
        if (animationGap < EXPORT_FRAME_MS * 4) return;
        if (drawCollabFrame(canvas, take, reference, layout)) {
          if (exportPumpRef.current !== 'timer-fallback') {
            exportPumpRef.current = 'timer-fallback';
            setExportPump('timer-fallback');
          }
        }
      }, EXPORT_FRAME_MS);
      void playback.catch(() => {
        if (recorderRef.current !== recorder) return;
        setError('The browser could not play both videos, so NodeVideo cancelled the export.');
        cancelExport('Export cancelled before recording usable frames.');
      });
    } catch (cause) {
      releaseExportResources();
      setPreparingExport(false);
      setRecording(false);
      setExportNotice('');
      setError(
        cause instanceof Error && cause.message === 'webm_not_supported'
          ? 'This browser cannot encode WebM. Try a current Chromium browser.'
          : 'Could not start the local recorder. No file was created.',
      );
    }
  }

  const ready = Boolean(takeFile && referenceFile);
  const exportLocked = preparingExport || recording;
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
          Pick two videos, line them up, export the collab. Both stay in this tab — nothing ever
          leaves your browser.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <DropSlot
          disabled={exportLocked}
          file={referenceFile}
          hint="A saved copy of the original — YouTube and Instagram pages cannot be captured directly."
          id="reference-video"
          label="Reference video"
          onFile={setReferenceFile}
        />
        <DropSlot
          disabled={exportLocked}
          file={takeFile}
          hint="Your camera recording drives the length."
          id="take-video"
          label="Your take"
          onFile={setTakeFile}
        />
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
              disabled={exportLocked}
              onClick={() => setLayout('side-by-side')}
              size="sm"
              type="button"
              variant={layout === 'side-by-side' ? 'default' : 'outline'}
            >
              <Columns2 aria-hidden="true" /> Side by side
            </Button>
            <Button
              aria-pressed={layout === 'top-bottom'}
              disabled={exportLocked}
              onClick={() => setLayout('top-bottom')}
              size="sm"
              type="button"
              variant={layout === 'top-bottom' ? 'default' : 'outline'}
            >
              <Rows2 aria-hidden="true" /> Top and bottom
            </Button>
            <span className="mx-2 h-5 w-px bg-border" />
            <Button
              disabled={exportLocked}
              onClick={() => nudge(-100)}
              size="sm"
              type="button"
              variant="outline"
            >
              Reference −0.1s
            </Button>
            <span className="font-mono text-xs text-muted-foreground">
              {(offsetMs / 1000).toFixed(2)}s
            </span>
            <Button
              disabled={exportLocked}
              onClick={() => nudge(100)}
              size="sm"
              type="button"
              variant="outline"
            >
              Reference +0.1s
            </Button>
          </div>

          {/* Dragging the preview sideways scrubs the reference offset — the
              tactile version of the nudge buttons (which remain the keyboard
              and screen-reader path). 4ms per pixel; same ±10s clamp. */}
          <canvas
            aria-label="Collab preview — drag sideways to nudge the reference"
            className="w-full cursor-ew-resize touch-pan-y rounded-xl border border-border bg-black"
            height={layout === 'side-by-side' ? 720 : 1280}
            onPointerDown={(event) => {
              if (exportLocked) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragStateRef.current = { x: event.clientX, offset: offsetMs };
            }}
            onPointerMove={(event) => {
              if (exportLocked) return;
              const start = dragStateRef.current;
              if (!start) return;
              const next = start.offset + Math.round((event.clientX - start.x) * 4);
              setOffsetMs(Math.max(-10_000, Math.min(10_000, Math.round(next / 20) * 20)));
            }}
            onPointerUp={() => {
              dragStateRef.current = null;
            }}
            onPointerCancel={() => {
              dragStateRef.current = null;
            }}
            ref={canvasRef}
            role="img"
            width={layout === 'side-by-side' ? 1280 : 720}
          />
          {/* Hidden decoders that feed the compositor. Captions cannot exist
              for user-supplied local files; the visible output is the canvas. */}
          <video className="hidden" muted playsInline ref={takeRef} src={takeUrl || undefined} />
          {/* biome-ignore lint/a11y/useMediaCaption: user-supplied local file; audio is the dance track itself */}
          <video
            className="hidden"
            playsInline
            ref={referenceRef}
            src={referenceUrl || undefined}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!ready || exportLocked} onClick={togglePlay} type="button">
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              {playing ? 'Pause preview' : 'Play preview'}
            </Button>
            <Button
              disabled={!ready || preparingExport}
              onClick={recording ? () => cancelExport() : exportCollab}
              type="button"
              variant="secondary"
            >
              {recording ? <X aria-hidden="true" /> : <Download aria-hidden="true" />}
              {preparingExport
                ? 'Preparing export…'
                : recording
                  ? 'Cancel export'
                  : 'Export collab video'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Exports WebM in real time with the reference audio. For frame-exact MP4 delivery, use
              the studio pipeline.
            </span>
          </div>
          {(preparingExport || recording || exportNotice) && (
            <output
              aria-live="polite"
              className="block rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground"
              data-pump={exportPump}
              data-testid="collab-export-status"
            >
              {recording
                ? exportPump === 'timer-fallback'
                  ? 'Animation frames slowed; the timer safety pump is keeping the canvas fresh. Keep this tab visible until the download starts.'
                  : 'Recording locally in real time. Keep this tab visible until the download starts; hiding it cancels safely.'
                : exportNotice}
            </output>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Could not complete the collab</AlertTitle>
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
