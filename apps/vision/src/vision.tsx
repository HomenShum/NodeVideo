import './vision.css';
import { Button } from '@/components/ui/button';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  Activity,
  Crosshair,
  Eye,
  Lock,
  MessageCircle,
  ScanLine,
  ShieldCheck,
  X,
} from 'lucide-react';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

const EDGES: Array<[number, number]> = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [0, 11],
  [0, 12],
];
const CORE_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
type Landmark = { x: number; y: number; visibility?: number };
type Phase = 'ready' | 'loading' | 'live' | 'error';
type StartupStage = 'camera' | 'runtime' | 'model' | 'playback';

function startupFailureMessage(stage: StartupStage, cause: unknown) {
  const name = cause instanceof Error ? cause.name : 'UnknownError';
  if (stage === 'camera') {
    if (name === 'NotAllowedError') {
      return '[CAMERA_DENIED] Allow camera access for this site in Safari or Chrome, then try again.';
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      return '[CAMERA_BUSY] Close any app using the camera, open this link directly in Safari or Chrome, then try again.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return '[NO_CAMERA] This browser could not find a usable camera. Open the link in Safari or Chrome.';
    }
    return `[CAMERA_START_FAILED] The browser could not start its camera (${name}). Open this link directly in Safari or Chrome.`;
  }
  if (stage === 'runtime' || stage === 'model') {
    return `[POSE_MODEL_FAILED] Camera access works, but the on-device pose model could not load (${name}). Keep this tab open and try again on Wi-Fi.`;
  }
  return `[CAMERA_PLAYBACK_FAILED] The camera opened but could not display video (${name}). Reload this page in Safari or Chrome.`;
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  points: Array<[number, number] | null>,
  locked: boolean,
) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.clearRect(0, 0, width, height);
  const visible = points.filter((point) => point !== null) as Array<[number, number]>;
  if (!visible.length) return;

  const xs = visible.map(([x]) => x * width);
  const ys = visible.map(([, y]) => y * height);
  const pad = 24;
  const left = Math.max(10, Math.min(...xs) - pad);
  const right = Math.min(width - 10, Math.max(...xs) + pad);
  const top = Math.max(10, Math.min(...ys) - pad);
  const bottom = Math.min(height - 10, Math.max(...ys) + pad);
  const color = locked ? '#ffcc42' : '#b4ff4e';

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = locked ? 4 : 3;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  for (const [a, b] of EDGES) {
    const start = points[a];
    const end = points[b];
    if (!start || !end) continue;
    ctx.beginPath();
    ctx.moveTo(start[0] * width, start[1] * height);
    ctx.lineTo(end[0] * width, end[1] * height);
    ctx.stroke();
  }
  for (const point of visible) {
    ctx.beginPath();
    ctx.arc(point[0] * width, point[1] * height, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  const corner = 34;
  ctx.lineWidth = locked ? 5 : 2;
  for (const [x, y, dx, dy] of [
    [left, top, 1, 1],
    [right, top, -1, 1],
    [left, bottom, 1, -1],
    [right, bottom, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x + dx * corner, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * corner);
    ctx.stroke();
  }

  ctx.font = '600 22px ui-monospace, monospace';
  ctx.fillStyle = '#050807';
  ctx.fillRect(left, Math.max(8, top - 34), Math.min(220, right - left), 34);
  ctx.fillStyle = color;
  ctx.fillText(locked ? 'TARGET LOCKED · #01' : 'PERSON · #01', left + 9, Math.max(31, top - 10));
}

function NodeVision() {
  const [phase, setPhase] = useState<Phase>('ready');
  const [status, setStatus] = useState(
    'Private on-device vision. Nothing is uploaded or recorded.',
  );
  const [locked, setLocked] = useState(false);
  const [poseVisible, setPoseVisible] = useState(false);
  const [fps, setFps] = useState(0);
  const [latency, setLatency] = useState(0);
  const [jarvisOpen, setJarvisOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef(0);
  const startingRef = useRef(false);
  const lockedRef = useRef(false);
  lockedRef.current = locked;
  const sampleRef = useRef({ frames: 0, started: performance.now(), latestLatency: 0 });

  async function startVision() {
    if (startingRef.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setPhase('error');
      setStatus(
        'Camera access needs the secure HTTPS phone link. The LAN HTTP address is preview-only.',
      );
      return;
    }
    startingRef.current = true;
    setPhase('loading');
    setStatus('Requesting the rear camera…');
    let stage: StartupStage = 'camera';
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      setStatus('Camera connected. Loading the on-device pose model…');
      stage = 'runtime';
      const vision = await FilesetResolver.forVisionTasks('/mediapipe-wasm');
      stage = 'model';
      landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task' },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      stage = 'playback';
      flushSync(() => setPhase('live'));
      const video = videoRef.current;
      if (!video) throw new Error('Camera stage is unavailable.');
      video.srcObject = stream;
      await video.play();
      setStatus('Scanning locally');
      runVisionLoop();
    } catch (cause) {
      for (const track of stream?.getTracks() ?? []) track.stop();
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      console.error('[NodeVision startup]', stage, cause);
      setPhase('error');
      setStatus(startupFailureMessage(stage, cause));
    } finally {
      startingRef.current = false;
    }
  }

  function runVisionLoop() {
    const step = () => {
      rafRef.current = requestAnimationFrame(step);
      const video = videoRef.current;
      const canvas = overlayRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !canvas || !landmarker || video.readyState < 2) return;

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
      }
      const started = performance.now();
      const result = landmarker.detectForVideo(video, started);
      sampleRef.current.latestLatency = Math.round(performance.now() - started);
      const raw = result.landmarks?.[0] as Landmark[] | undefined;
      const points =
        raw?.map((point) =>
          (point.visibility ?? 1) > 0.45 ? ([point.x, point.y] as [number, number]) : null,
        ) ?? [];
      const detected = CORE_JOINTS.filter((joint) => points[joint]).length >= 7;
      setPoseVisible(detected);
      const ctx = canvas.getContext('2d');
      if (ctx) drawHud(ctx, points, lockedRef.current);

      sampleRef.current.frames += 1;
      const elapsed = performance.now() - sampleRef.current.started;
      if (elapsed >= 1000) {
        setFps(Math.round((sampleRef.current.frames * 1000) / elapsed));
        setLatency(sampleRef.current.latestLatency);
        sampleRef.current = {
          frames: 0,
          started: performance.now(),
          latestLatency: sampleRef.current.latestLatency,
        };
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }

  function stopVision() {
    cancelAnimationFrame(rafRef.current);
    const stream = videoRef.current?.srcObject as MediaStream | null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    if (videoRef.current) videoRef.current.srcObject = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    setPhase('ready');
    setPoseVisible(false);
    setLocked(false);
    setJarvisOpen(false);
    setStatus('Private on-device vision. Nothing is uploaded or recorded.');
  }

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      const stream = videoRef.current?.srcObject as MediaStream | null;
      for (const track of stream?.getTracks() ?? []) track.stop();
      landmarkerRef.current?.close();
    },
    [],
  );

  if (phase === 'ready' || phase === 'loading' || phase === 'error') {
    const currentUrl = window.location.href;
    const qrImageUrl = `https://quickchart.io/qr?size=440&margin=2&text=${encodeURIComponent(currentUrl)}`;
    return (
      <main
        className="vision-shell vision-grid grid min-h-svh place-items-center px-6 py-10"
        data-testid="nodevision-ready"
      >
        <section className="grid w-full max-w-3xl items-center gap-8 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="space-y-9 text-center">
            <div className="mx-auto grid size-20 place-items-center rounded-[1.6rem] border border-brand/30 bg-brand/10 text-brand shadow-[0_0_60px_rgba(180,255,78,0.12)]">
              <Eye className="size-10" aria-hidden="true" />
            </div>
            <div className="space-y-3">
              <p className="font-mono text-xs uppercase tracking-[0.35em] text-brand">
                NodeVision · Alpha 01
              </p>
              <h1 className="font-heading text-4xl font-semibold tracking-tight">
                See what changed.
              </h1>
              <p className="mx-auto max-w-xs text-sm leading-6 text-muted-foreground">
                Turn your phone camera into a live visual HUD with private, on-device pose tracking.
              </p>
            </div>
            <div className="space-y-3">
              <Button
                className="h-14 w-full text-base"
                disabled={phase === 'loading'}
                onClick={() => void startVision()}
                type="button"
              >
                {phase === 'loading' ? <Activity className="animate-pulse" /> : <ScanLine />}
                {phase === 'loading'
                  ? 'Initializing vision…'
                  : phase === 'error'
                    ? 'Try camera again'
                    : 'Start live vision'}
              </Button>
              <label
                className="block text-left font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground"
                htmlFor="vision-preset"
              >
                Preset
              </label>
              <select
                className="vision-glass h-11 w-full rounded-lg px-3 text-sm"
                defaultValue="general"
                id="vision-preset"
              >
                <option value="general">General awareness</option>
                <option value="motion">Motion analysis</option>
                <option value="coach">Sports coach</option>
              </select>
            </div>
            <output
              className={
                phase === 'error'
                  ? 'text-sm text-destructive'
                  : 'block text-xs leading-5 text-muted-foreground'
              }
            >
              {status}
            </output>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-brand" /> Camera frames stay on this device
            </div>
          </div>
          <aside
            className="vision-glass hidden rounded-2xl p-5 text-center md:block"
            data-testid="nodevision-phone-qr"
          >
            <img
              alt={`QR code for ${currentUrl}`}
              className="aspect-square w-full rounded-xl bg-white p-2"
              referrerPolicy="no-referrer"
              src={qrImageUrl}
            />
            <p className="mt-4 font-mono text-xs uppercase tracking-[0.18em] text-brand">
              Scan with your phone
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Opens this exact secure NodeVision session. No app install.
            </p>
          </aside>
        </section>
      </main>
    );
  }

  return (
    <main className="vision-stage" data-testid="nodevision-live">
      <video className="vision-video" muted playsInline ref={videoRef} />
      <canvas aria-label="Live pose HUD" className="vision-overlay" ref={overlayRef} role="img" />
      <div className="vision-scanline" aria-hidden="true" />

      <header className="vision-safe-top absolute inset-x-4 z-10 flex items-center justify-between font-mono text-[0.65rem] uppercase tracking-[0.15em]">
        <div className="vision-glass flex items-center gap-2 rounded-full px-3 py-2">
          <span className="size-2 rounded-full bg-brand shadow-[0_0_10px_#b4ff4e]" /> Live ·{' '}
          {fps || '—'} FPS
        </div>
        <div className="vision-glass rounded-full px-3 py-2">{latency || '—'} ms</div>
      </header>

      <section className="absolute inset-x-4 top-20 z-10 flex justify-center" aria-live="polite">
        <div className="vision-glass rounded-full px-4 py-2 font-mono text-xs uppercase tracking-[0.12em]">
          {locked
            ? 'Target locked · #01'
            : poseVisible
              ? '1 person · pose acquired'
              : 'Scanning for people'}
        </div>
      </section>

      {jarvisOpen && (
        <section
          className="vision-glass absolute inset-x-4 bottom-28 z-20 rounded-2xl p-4"
          data-testid="jarvis-sheet"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand">
              Jarvis · observed
            </p>
            <button aria-label="Close Jarvis" onClick={() => setJarvisOpen(false)} type="button">
              <X className="size-4" />
            </button>
          </div>
          <p className="text-sm leading-6">
            {poseVisible
              ? `Person #01 is visible${locked ? ' and remains the active target' : ''}. Pose landmarks are being measured on this device.`
              : 'No complete person pose is visible yet. Point the camera toward a person and keep their upper body in frame.'}
          </p>
          <p className="mt-2 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
            Evidence · current camera frame · {latency || '—'} ms inference
          </p>
        </section>
      )}

      <nav
        className="vision-safe-bottom vision-glass absolute inset-x-4 z-20 grid grid-cols-4 gap-1 rounded-2xl p-2"
        aria-label="Vision controls"
      >
        <button
          className="grid place-items-center gap-1 rounded-xl py-2 text-[0.65rem] text-muted-foreground"
          onClick={() => setJarvisOpen((open) => !open)}
          type="button"
        >
          <MessageCircle className="size-5" />
          <span>Ask</span>
        </button>
        <button
          className={
            locked
              ? 'grid place-items-center gap-1 rounded-xl bg-amber-300/15 py-2 text-[0.65rem] text-amber-300'
              : 'grid place-items-center gap-1 rounded-xl py-2 text-[0.65rem] text-muted-foreground'
          }
          disabled={!poseVisible}
          onClick={() => setLocked((value) => !value)}
          type="button"
        >
          {locked ? <Lock className="size-5" /> : <Crosshair className="size-5" />}
          <span>{locked ? 'Release' : 'Track'}</span>
        </button>
        <button
          className="grid place-items-center gap-1 rounded-xl bg-brand/10 py-2 text-[0.65rem] text-brand"
          type="button"
        >
          <ScanLine className="size-5" />
          <span>Scan</span>
        </button>
        <button
          className="grid place-items-center gap-1 rounded-xl py-2 text-[0.65rem] text-muted-foreground"
          onClick={stopVision}
          type="button"
        >
          <X className="size-5" />
          <span>Stop</span>
        </button>
      </nav>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('NodeVision root missing.');
createRoot(root).render(
  <StrictMode>
    <NodeVision />
  </StrictMode>,
);
