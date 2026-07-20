import './practice.css';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import poseLoop from '../../landing/src/pose-loop.json';

// The practice room P0: one phrase, one dancer, one camera — everything on
// this device. The reference skeleton is the committed public pose track of
// the Sign case; the beat clock is its plan's measured grid. Feedback is a
// relative pose-similarity signal with honest abstention — never a grade.

const TEMPO_BPM = 107.7;
const BEAT_MS = 60_000 / TEMPO_BPM;
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
// Joints that carry the comparison (shoulders/elbows/wrists/hips/knees/ankles).
const CORE_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const frames = (poseLoop as { frames: Array<Array<[number, number] | null>> }).frames;
const cadence = (poseLoop as { cadenceHz: number }).cadenceHz;
const PHRASE_MS = (frames.length / cadence) * 1000;
const BEATS_PER_PHRASE = Math.round(PHRASE_MS / BEAT_MS);

type Landmark = { x: number; y: number; visibility?: number };
type Mode = 'intro' | 'camera-setup' | 'countdown' | 'practicing' | 'summary';
type BeatMark = 'close' | 'off' | 'abstain';

// Hip-centered, torso-scaled normalization so body size and camera framing
// cancel out of the comparison.
function normalizePose(points: Array<[number, number] | null>): Array<[number, number] | null> {
  const hipL = points[23];
  const hipR = points[24];
  const shL = points[11];
  const shR = points[12];
  if (!hipL || !hipR || !shL || !shR) return points.map(() => null);
  const cx = (hipL[0] + hipR[0]) / 2;
  const cy = (hipL[1] + hipR[1]) / 2;
  const torso = Math.hypot((shL[0] + shR[0]) / 2 - cx, (shL[1] + shR[1]) / 2 - cy) || 1;
  return points.map((p) => (p ? [(p[0] - cx) / torso, (p[1] - cy) / torso] : null));
}

function poseDistance(
  user: Array<[number, number] | null>,
  reference: Array<[number, number] | null>,
): number | null {
  const a = normalizePose(user);
  const b = normalizePose(reference);
  let sum = 0;
  let count = 0;
  for (const joint of CORE_JOINTS) {
    const pa = a[joint];
    const pb = b[joint];
    if (!pa || !pb) continue;
    sum += Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
    count += 1;
  }
  return count >= 8 ? sum / count : null;
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  points: Array<[number, number] | null>,
  scaleX: number,
  scaleY: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const [a, b] of EDGES) {
    const pa = points[a];
    const pb = points[b];
    if (!pa || !pb) continue;
    ctx.beginPath();
    ctx.moveTo(pa[0] * scaleX, pa[1] * scaleY);
    ctx.lineTo(pb[0] * scaleX, pb[1] * scaleY);
    ctx.stroke();
  }
  for (const p of points) {
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p[0] * scaleX, p[1] * scaleY, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function PracticeRoom() {
  const [mode, setMode] = useState<Mode>('intro');
  const [status, setStatus] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [beatMarks, setBeatMarks] = useState<BeatMark[]>([]);
  const [inFrame, setInFrame] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const ghostRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef(0);
  const modeRef = useRef<Mode>('intro');
  modeRef.current = mode;
  const phraseStartRef = useRef(0);
  const beatDistancesRef = useRef<Array<number | null>>([]);
  const marksRef = useRef<BeatMark[]>([]);
  const lastBeatRef = useRef(-1);

  async function startCamera() {
    setMode('camera-setup');
    setStatus('Loading the on-device pose model…');
    try {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe-wasm');
      landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task' },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setStatus('Step back until your whole body is in frame.');
      loop();
    } catch (cause) {
      setMode('intro');
      setStatus(
        cause instanceof Error && cause.name === 'NotAllowedError'
          ? 'Camera permission was declined — the practice room needs it to see your dancing. Nothing is recorded or uploaded.'
          : 'Could not start the camera or load the pose model on this device.',
      );
    }
  }

  function beginCountdown() {
    setBeatMarks([]);
    marksRef.current = [];
    beatDistancesRef.current = [];
    lastBeatRef.current = -1;
    setCountdown(3);
    setMode('countdown');
    let remaining = 3;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        phraseStartRef.current = performance.now();
        setMode('practicing');
        return;
      }
      setCountdown(remaining);
      window.setTimeout(tick, BEAT_MS * 2);
    };
    window.setTimeout(tick, BEAT_MS * 2);
  }

  function loop() {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    const ghost = ghostRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !overlay || !ghost || !landmarker) return;
    const step = () => {
      rafRef.current = requestAnimationFrame(step);
      if (video.readyState < 2) return;
      const result = landmarker.detectForVideo(video, performance.now());
      const raw = result.landmarks?.[0] as Landmark[] | undefined;
      const points: Array<[number, number] | null> = raw
        ? raw.map((l) => ((l.visibility ?? 1) > 0.5 ? [l.x, l.y] : null))
        : frames[0].map(() => null);
      const visible = CORE_JOINTS.filter((j) => points[j]).length;
      setInFrame(visible >= 10);

      // User overlay (mirrored like a mirror).
      const ctx = overlay.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        ctx.save();
        ctx.translate(overlay.width, 0);
        ctx.scale(-1, 1);
        drawSkeleton(ctx, points, overlay.width, overlay.height, '#cfff4a');
        ctx.restore();
      }

      const currentMode = modeRef.current;
      if (currentMode === 'practicing') {
        const elapsed = performance.now() - phraseStartRef.current;
        const phrasePosition = elapsed % PHRASE_MS;
        const referenceFrame =
          frames[Math.floor((phrasePosition / 1000) * cadence) % frames.length];

        // Reference ghost.
        const gctx = ghost.getContext('2d');
        if (gctx) {
          gctx.clearRect(0, 0, ghost.width, ghost.height);
          drawSkeleton(gctx, referenceFrame, ghost.width, ghost.height, '#eef0e8');
        }

        // Rolling distance; sampled at each beat boundary.
        const distance = poseDistance(points, referenceFrame);
        beatDistancesRef.current.push(distance);
        if (beatDistancesRef.current.length > 30) beatDistancesRef.current.shift();
        const beatIndex = Math.floor(elapsed / BEAT_MS);
        if (beatIndex !== lastBeatRef.current) {
          lastBeatRef.current = beatIndex;
          const window_ = beatDistancesRef.current.filter((d): d is number => d !== null);
          const mark: BeatMark =
            window_.length < 5
              ? 'abstain'
              : window_.reduce((s, d) => s + d, 0) / window_.length < 0.55
                ? 'close'
                : 'off';
          marksRef.current = [...marksRef.current, mark];
          setBeatMarks(marksRef.current);
          if (marksRef.current.length >= BEATS_PER_PHRASE * 2) {
            setMode('summary');
          }
        }
      }
    };
    rafRef.current = requestAnimationFrame(step);
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

  const closeCount = beatMarks.filter((m) => m === 'close').length;
  const measuredCount = beatMarks.filter((m) => m !== 'abstain').length;
  return (
    <main className="mx-auto min-h-svh max-w-5xl space-y-4 p-4 sm:p-6" data-testid="practice-room">
      <header className="space-y-1">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          NodeVideo · Practice room · early beta
        </p>
        <h1 className="font-heading text-2xl font-semibold sm:text-3xl">
          Dance the Sign phrase with your camera.
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Pose tracking runs on this device — no video or pose data leaves your browser, and nothing
          is recorded.
        </p>
      </header>

      {mode === 'intro' && (
        <div className="space-y-3">
          <Button onClick={() => void startCamera()} size="lg" type="button">
            Start camera
          </Button>
          {status && <p className="text-sm text-destructive">{status}</p>}
          <p className="max-w-2xl text-xs text-muted-foreground">
            Room to move, whole body in frame. Feedback compares you to the reference skeleton beat
            by beat — it is not a score, a grade, or a judgment of your dancing.
          </p>
          <p className="max-w-2xl text-xs text-muted-foreground">
            No music plays here — the phrase runs on a silent beat clock at {TEMPO_BPM} bpm. Put the
            song on yourself if you want it.
          </p>
        </div>
      )}

      {mode !== 'intro' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.62fr)_minmax(0,0.38fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                You
                <Badge variant={inFrame ? 'default' : 'outline'}>
                  {inFrame ? 'In frame' : 'Step into frame'}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative overflow-hidden rounded-xl bg-black">
                <video className="w-full -scale-x-100" muted playsInline ref={videoRef} />
                <canvas
                  className="absolute inset-0 h-full w-full"
                  height={480}
                  ref={overlayRef}
                  width={640}
                />
                {mode === 'countdown' && (
                  <div className="absolute inset-0 grid place-items-center">
                    <span className="font-heading text-8xl font-semibold text-brand">
                      {countdown}
                    </span>
                  </div>
                )}
              </div>
              {mode === 'camera-setup' && (
                <div className="mt-3 flex items-center gap-3">
                  <Button disabled={!inFrame} onClick={beginCountdown} type="button">
                    Start the phrase
                  </Button>
                  <span className="text-xs text-muted-foreground">{status}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Follow the reference</CardTitle>
              <CardDescription>
                Real pose track · verified public case · {BEATS_PER_PHRASE} beats per phrase
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <canvas
                aria-label="Reference skeleton"
                className="w-full rounded-xl border border-border bg-card"
                height={360}
                ref={ghostRef}
                role="img"
                width={300}
              />
              <output aria-label="Beat feedback" className="flex flex-wrap gap-1 font-mono text-sm">
                {beatMarks.map((mark, index) => (
                  <span
                    className={
                      mark === 'close'
                        ? 'text-brand'
                        : mark === 'off'
                          ? 'text-muted-foreground'
                          : 'text-destructive'
                    }
                    key={`${index}-${mark}`}
                  >
                    {mark === 'close' ? '✓' : mark === 'off' ? '△' : '·'}
                  </span>
                ))}
              </output>
              {mode === 'summary' && (
                <div className="space-y-2 rounded-lg border border-border bg-card p-3">
                  <p className="text-sm">
                    {measuredCount === 0
                      ? 'Not enough of your body was visible to measure anything — no feedback rather than made-up feedback.'
                      : `${closeCount} of ${measuredCount} measured beats tracked close to the reference. Relative signal only — not a grade.`}
                  </p>
                  <Button onClick={beginCountdown} size="sm" type="button">
                    Retry the phrase
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <footer className="text-xs text-muted-foreground">
        Abstention is honest: beats where fewer than five clean samples were visible show as “·” and
        are excluded from the summary.
      </footer>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Practice room root missing.');
createRoot(root).render(
  <StrictMode>
    <PracticeRoom />
  </StrictMode>,
);
