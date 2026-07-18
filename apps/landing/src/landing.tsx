import './landing.css';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import poseLoop from './pose-loop.json';

// The one clock: the landing runs at the strict case's real tempo. The count
// ticker, the skeleton, and every pulse share it — motion lands on the count.
const TEMPO_BPM = 103.4;
const BEAT_MS = 60_000 / TEMPO_BPM;

// MediaPipe pose topology (33 landmarks), drawn as the product draws it.
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
  [27, 29],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [28, 32],
  [0, 11],
  [0, 12],
];

type Frame = Array<[number, number] | null>;
const frames = (poseLoop as { frames: Frame[]; cadenceHz: number }).frames;
const cadence = (poseLoop as { cadenceHz: number }).cadenceHz;

function useCountClock(reduced: boolean) {
  const [count, setCount] = useState(1);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const beats = (now - started) / BEAT_MS;
      setCount((Math.floor(beats) % 8) + 1);
      const phase = beats % 1;
      document.documentElement.style.setProperty(
        '--count-pulse',
        String(Math.max(0, 1 - phase * 4)),
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);
  return count;
}

function SkeletonHero({ reduced }: { reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const started = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      const elapsed = reduced ? 0 : (now - started) / 1000;
      const frame = frames[Math.floor(elapsed * cadence) % frames.length];
      const scale = Math.min(canvas.width, canvas.height) * 0.92;
      const pad = { x: (canvas.width - scale) / 2, y: (canvas.height - scale) / 2 };
      const beatPhase = reduced ? 1 : ((now - started) / BEAT_MS) % 1;
      const pulse = Math.max(0, 1 - beatPhase * 4);
      context.clearRect(0, 0, canvas.width, canvas.height);
      const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand-accent');
      context.strokeStyle = `oklch(${brand.trim().replace('oklch(', '').replace(')', '')})`;
      context.strokeStyle = brand.trim() || '#c6f000';
      context.lineWidth = 3 + pulse * 1.5;
      context.lineCap = 'round';
      context.globalAlpha = 0.92;
      for (const [a, b] of EDGES) {
        const pa = frame[a];
        const pb = frame[b];
        if (!pa || !pb) continue;
        context.beginPath();
        context.moveTo(pad.x + pa[0] * scale, pad.y + pa[1] * scale);
        context.lineTo(pad.x + pb[0] * scale, pad.y + pb[1] * scale);
        context.stroke();
      }
      context.globalAlpha = 1;
      for (const point of frame) {
        if (!point) continue;
        context.beginPath();
        context.arc(pad.x + point[0] * scale, pad.y + point[1] * scale, 3 + pulse, 0, Math.PI * 2);
        context.fillStyle = context.strokeStyle;
        context.fill();
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);
  return (
    <canvas
      aria-label="Real pose tracking from a verified NodeVideo comparison, replayed"
      className="h-full w-full"
      height={560}
      ref={canvasRef}
      role="img"
      width={560}
    />
  );
}

function Landing() {
  const reduced =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const count = useCountClock(reduced);
  return (
    <main className="mx-auto min-h-svh max-w-6xl px-5 py-6 sm:px-8" data-testid="landing">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-brand text-background">
            <svg aria-hidden="true" fill="currentColor" height="16" viewBox="0 0 16 16" width="16">
              <rect height="12" rx="2" width="12" x="2" y="2" />
            </svg>
          </span>
          <span className="font-heading font-semibold">NodeVideo</span>
        </div>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <a className="hover:text-foreground" href="/studio.html">
            Proof studio
          </a>
          <a className="hover:text-foreground" href="/.well-known/agent-ui.json">
            Agent contract
          </a>
        </nav>
      </header>

      <section className="grid items-center gap-10 py-14 lg:grid-cols-[1.1fr_0.9fr] lg:py-20">
        <div className="space-y-7">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Choreography coach · judged on visible motion only
          </p>
          <h1 className="on-count max-w-xl font-heading text-5xl font-semibold leading-[1.05] sm:text-6xl">
            Learn the dance you admire.
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
            Point NodeVideo at the dancer you are studying, film your take, and see — count by count
            — where your movement matches and where it drifts. Processed on your machine. Relative
            signals, never grades.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              className="on-count inline-flex h-11 items-center rounded-xl bg-brand px-6 font-medium text-background"
              href="/apps/chrome-extension/sidepanel.html"
            >
              Open the coach
            </a>
            <a
              className="inline-flex h-11 items-center rounded-xl border border-border px-6 font-medium text-foreground"
              href="/studio.html"
            >
              See a verified comparison
            </a>
          </div>
          <div
            aria-label={`Count ${count} of 8 at ${TEMPO_BPM} beats per minute`}
            className="flex items-baseline gap-3 font-mono text-sm text-muted-foreground"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <span className="count-cell" data-live={!reduced && n === count} key={n}>
                {n}
              </span>
            ))}
            <span className="pl-2 text-xs">{TEMPO_BPM} bpm · the page keeps count</span>
          </div>
        </div>
        <div className="relative aspect-square overflow-hidden rounded-3xl border border-border bg-card">
          <SkeletonHero reduced={reduced} />
          <p className="absolute bottom-3 left-4 font-mono text-[11px] text-muted-foreground">
            real pose track · verified public case
          </p>
        </div>
      </section>

      <section className="grid gap-4 border-t border-border py-12 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Form', 'Joint angles against the reference pose, frame by frame.'],
          ['Timing', 'Your landings against the music grid, in milliseconds.'],
          ['Path', 'Where your body travels compared with the reference.'],
          ['Dynamics', 'The sharpness of your hits — pops, locks, accents.'],
        ].map(([name, line]) => (
          <div className="space-y-1.5 rounded-2xl border border-border bg-card p-5" key={name}>
            <h2 className="font-heading font-medium">{name}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{line}</p>
          </div>
        ))}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-8 text-sm text-muted-foreground">
        <p>
          When the evidence is not there, NodeVideo abstains — unmeasured signals are disclosed,
          never invented.
        </p>
        <p className="font-mono text-xs">local-first · hash-verified · consent-gated</p>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
