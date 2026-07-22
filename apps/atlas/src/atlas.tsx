import '@/styles.css';
import type { TrackingAtlasReceipt } from '@/lib/tracking-domain';
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Download,
  Film,
  Gauge,
  Layers3,
  Library,
  MessageSquare,
  Moon,
  Play,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
} from 'lucide-react';
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './atlas.css';

type Catalog = {
  schemaVersion: string;
  generatedAt: string;
  model: string;
  compilation: string;
  receipts: TrackingAtlasReceipt[];
};
type AtlasMode = 'gallery' | 'arena' | 'harness' | 'proof';
type ChatMessage = { role: 'user' | 'assistant'; text: string };

const MODES: Array<{ id: AtlasMode; label: string; icon: typeof Film }> = [
  { id: 'gallery', label: 'Artifact Gallery', icon: Library },
  { id: 'arena', label: 'Detector Arena', icon: Target },
  { id: 'harness', label: 'Harness Compare', icon: Layers3 },
  { id: 'proof', label: 'Proof & rights', icon: ShieldCheck },
];

const baseUri = (path: string) => `/${path.replace(/^fixtures\//u, '')}`;

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function detectorLabel(detector: string) {
  return detector.includes('manual-first-frame') ? 'Manual seed + OpenCV' : 'YOLO11n local';
}

function ArtifactCard({
  receipt,
  active,
  onSelect,
}: {
  receipt: TrackingAtlasReceipt;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <article className={`atlas-card ${active ? 'is-active' : ''}`}>
      <button type="button" className="atlas-card-select" onClick={onSelect}>
        <span className="atlas-card-kicker">{receipt.packId.replaceAll('-', ' ')}</span>
        <b>{detectorLabel(receipt.execution.detector)}</b>
        <span>{pct(receipt.evaluation.targetCoverage)} target coverage</span>
      </button>
      <video
        src={baseUri(receipt.outputs.comparisonVideo)}
        controls
        muted
        playsInline
        preload="metadata"
        aria-label={`${receipt.packId} before and after comparison`}
      />
      <div className="atlas-before-after">
        <figure>
          <img
            src={baseUri(receipt.outputs.beforeImage)}
            alt={`${receipt.packId} source with detector envelope`}
          />
          <figcaption>Before · source + detector</figcaption>
        </figure>
        <figure>
          <img
            src={baseUri(receipt.outputs.afterImage)}
            alt={`${receipt.packId} vertical reframed result`}
          />
          <figcaption>After · governed 9:16</figcaption>
        </figure>
      </div>
      <footer>
        <span>
          <CheckCircle2 /> fixture pass
        </span>
        <span>
          <Clock3 /> {(receipt.execution.latencyMs / 1000).toFixed(1)}s
        </span>
        <span>$0 local</span>
      </footer>
    </article>
  );
}

function Gallery({
  receipts,
  selected,
  onSelect,
}: {
  receipts: TrackingAtlasReceipt[];
  selected?: TrackingAtlasReceipt;
  onSelect: (receipt: TrackingAtlasReceipt) => void;
}) {
  return (
    <div className="atlas-gallery" data-testid="artifact-gallery">
      {receipts.map((receipt) => (
        <ArtifactCard
          key={receipt.id}
          receipt={receipt}
          active={selected?.id === receipt.id}
          onSelect={() => onSelect(receipt)}
        />
      ))}
    </div>
  );
}

function DetectorArena({ receipts }: { receipts: TrackingAtlasReceipt[] }) {
  return (
    <section className="atlas-arena" data-testid="detector-arena">
      <div className="atlas-section-heading">
        <span>Same contract, specialized execution</span>
        <h2>Detector Arena</h2>
        <p>
          Passes are fixture-bound. Automatic discovery and manual target seeding remain visibly
          distinct.
        </p>
      </div>
      <div className="arena-table-wrap">
        <table className="arena-table">
          <caption className="sr-only">Detector comparison</caption>
          <thead>
            <tr className="arena-head">
              <th>Capability</th>
              <th>Executor</th>
              <th>Detection</th>
              <th>Target</th>
              <th>Hold</th>
              <th>Proof</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.id}>
                <th>{receipt.packId.replaceAll('-', ' ')}</th>
                <td>{detectorLabel(receipt.execution.detector)}</td>
                <td>{pct(receipt.evaluation.detectionCoverage)}</td>
                <td>{pct(receipt.evaluation.targetCoverage)}</td>
                <td>{pct(receipt.evaluation.lowConfidenceHoldRate)}</td>
                <td>
                  <span className="arena-pass">PASS</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="arena-explainers">
        <article>
          <Target />
          <b>Automatic route</b>
          <p>
            YOLO11n finds COCO targets; the common envelope and crop critic own downstream behavior.
          </p>
        </article>
        <article>
          <CircleHelp />
          <b>Seeded route</b>
          <p>
            The creator selects a first-frame object; OpenCV follows it locally when generic
            semantics are weak.
          </p>
        </article>
        <article>
          <ShieldCheck />
          <b>Promotion gate</b>
          <p>
            No pack graduates from fixture proof until held-out creator cases pass without silent
            identity switches.
          </p>
        </article>
      </div>
    </section>
  );
}

function HarnessCompare({ receipts }: { receipts: TrackingAtlasReceipt[] }) {
  const automatic = receipts.filter((receipt) =>
    receipt.execution.detector.includes('yolo'),
  ).length;
  return (
    <section className="harness-compare" data-testid="harness-compare">
      <div className="atlas-section-heading">
        <span>Harness v0 → v1</span>
        <h2>The model did not become the product. The harness did.</h2>
      </div>
      <div className="harness-columns">
        <article>
          <span className="harness-version">v0 · single person</span>
          <h3>Pose-only Smart Reframe</h3>
          <ul>
            <li>1 visible person</li>
            <li>MediaPipe pose landmarks</li>
            <li>3 aspect ratios</li>
            <li>Single-person browser proof</li>
          </ul>
        </article>
        <div className="harness-arrow">→</div>
        <article className="is-current">
          <span className="harness-version">v1 · domain registry</span>
          <h3>Detector-orchestrated Atlas</h3>
          <ul>
            <li>{receipts.length} domain packs</li>
            <li>{automatic} automatic detector fixtures</li>
            <li>{receipts.length - automatic} explicit target-seed fixtures</li>
            <li>Hash-bound media + source rights receipts</li>
          </ul>
        </article>
      </div>
      <div className="harness-loop">
        {[
          'Intent',
          'Pack route',
          'Detector',
          'Action envelope',
          'Reframe',
          'Critic',
          'Receipt',
        ].map((item, index) => (
          <span key={item}>
            {index > 0 && <i>→</i>}
            {item}
          </span>
        ))}
      </div>
      <div className="honest-boundary">
        <ShieldCheck />
        <div>
          <b>What this does not prove</b>
          <p>
            Universal identity continuity, professional sports event understanding, species
            keypoints, or held-out creator preference. Those remain explicit promotion gates.
          </p>
        </div>
      </div>
    </section>
  );
}

function ProofLedger({
  receipts,
  generatedAt,
}: { receipts: TrackingAtlasReceipt[]; generatedAt: string }) {
  return (
    <section className="proof-ledger" data-testid="proof-ledger">
      <div className="atlas-section-heading">
        <span>Source → execution → artifact</span>
        <h2>Rights and proof ledger</h2>
        <p>
          Generated {new Date(generatedAt).toLocaleString()}. Every source is linked, licensed, and
          content-addressed.
        </p>
      </div>
      {receipts.map((receipt) => (
        <article key={receipt.id}>
          <CheckCircle2 />
          <div>
            <b>{receipt.packId.replaceAll('-', ' ')}</b>
            <a href={receipt.source.url} target="_blank" rel="noreferrer">
              {receipt.source.title}
            </a>
          </div>
          <div>
            <span>{receipt.source.uploader}</span>
            <small>{receipt.source.license}</small>
          </div>
          <code>{receipt.source.sourceSha256.slice(0, 26)}…</code>
          <span className="proof-tier">{receipt.evaluation.tier}</span>
        </article>
      ))}
    </section>
  );
}

function AtlasGuide({ selected }: { selected?: TrackingAtlasReceipt }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      text: 'Select an artifact or ask how NodeAgent routed its detector, framing policy, and proof boundary.',
    },
  ]);
  const [draft, setDraft] = useState('');
  const send = () => {
    const prompt = draft.trim();
    if (!prompt) return;
    const context = selected
      ? `${selected.packId} used ${detectorLabel(selected.execution.detector)}, reached ${pct(selected.evaluation.targetCoverage)} target coverage, and remains limited to a rights-cleared fixture.`
      : 'The Atlas currently contains eight fixture-bound domain packs across group, object, animal, and sports tracking.';
    setMessages((current) => [
      ...current,
      { role: 'user', text: prompt },
      { role: 'assistant', text: context },
    ]);
    setDraft('');
  };
  return (
    <aside className="atlas-guide" aria-label="NodeVideo Atlas guide">
      <header>
        <span>
          <Bot />
        </span>
        <div>
          <b>NodeAgent</b>
          <small>local catalog guide · no egress</small>
        </div>
      </header>
      <div className="atlas-guide-context">
        <span>READ</span>
        <b>{selected?.packId.replaceAll('-', ' ') ?? 'entire Atlas'}</b>
        <small>WRITE · none</small>
      </div>
      <div className="atlas-guide-feed">
        {messages.map((message, index) => (
          <div className={message.role} key={`${message.role}-${index}`}>
            {message.text}
          </div>
        ))}
      </div>
      <div className="atlas-guide-tools">
        <Activity /> catalog.query <span>local</span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          aria-label="Ask the Atlas"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Why did this use a manual seed?"
        />
        <button type="submit" aria-label="Send Atlas question">
          <Send />
        </button>
      </form>
    </aside>
  );
}

function AtlasApp() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState('');
  const [mode, setMode] = useState<AtlasMode>('gallery');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [dark, setDark] = useState(true);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  useEffect(() => {
    fetch('/media/tracking-atlas-v1/catalog.json')
      .then((response) => {
        if (!response.ok) throw new Error('Atlas catalog is unavailable.');
        return response.json();
      })
      .then((value: Catalog) => {
        setCatalog(value);
        setSelectedId(value.receipts[0]?.id ?? '');
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Atlas catalog failed.'),
      );
  }, []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (
      catalog?.receipts.filter(
        (receipt) =>
          !needle ||
          `${receipt.packId} ${receipt.execution.detector} ${receipt.execution.policy}`
            .toLowerCase()
            .includes(needle),
      ) ?? []
    );
  }, [catalog, query]);
  const selected = catalog?.receipts.find((receipt) => receipt.id === selectedId) ?? filtered[0];
  if (error)
    return (
      <main className="atlas-error">
        <ShieldCheck />
        <h1>Atlas failed closed</h1>
        <p>{error}</p>
      </main>
    );
  if (!catalog)
    return (
      <main className="atlas-loading">
        <Sparkles />
        <p>Loading proof-backed artifacts…</p>
      </main>
    );
  return (
    <main className="atlas-shell">
      <header className="atlas-topbar">
        <a href="/creator" className="atlas-brand">
          <span>
            <Film />
          </span>
          <div>
            <b>NodeVideo</b>
            <small>Artifact Atlas</small>
          </div>
        </a>
        <div className="atlas-global-search">
          <Search />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search Atlas"
            placeholder="Search tracking, policy, detector…"
          />
        </div>
        <div className="atlas-actions">
          <button
            type="button"
            className="atlas-theme"
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setDark((current) => !current)}
          >
            {dark ? <Sun /> : <Moon />}
          </button>
          <a
            className="atlas-download"
            href="/media/tracking-atlas-v1/nodevideo-tracking-artifact-atlas.mp4"
            download
          >
            <Download /> Download compilation
          </a>
        </div>
      </header>
      <div className="atlas-layout">
        <nav className="atlas-nav" aria-label="Atlas views">
          <a href="/creator">
            <ArrowLeft /> Creator workspace
          </a>
          <p>Explore</p>
          {MODES.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => setMode(id)}
              className={mode === id ? 'is-current' : ''}
            >
              <Icon />
              {label}
            </button>
          ))}
          <p>Coverage</p>
          {['group', 'object', 'animal', 'sport'].map((domain) => (
            <span key={domain}>
              <i />
              {domain}
              <b>
                {
                  catalog.receipts.filter(
                    (receipt) =>
                      receipt.packId.startsWith(domain) ||
                      (domain === 'group' && receipt.packId === 'group-performance') ||
                      (domain === 'object' && receipt.packId === 'object-product') ||
                      (domain === 'animal' && receipt.packId === 'animal-companion'),
                  ).length
                }
              </b>
            </span>
          ))}
        </nav>
        <section className="atlas-main">
          <div className="atlas-hero">
            <div>
              <span className="atlas-kicker">Proof, not a showreel</span>
              <h1>Every way NodeVideo knows how to follow the action.</h1>
              <p>
                Group, object, animal, and sport-specific tracking compiled through one reviewable
                artifact contract.
              </p>
            </div>
            <video
              src="/media/tracking-atlas-v1/nodevideo-tracking-artifact-atlas.mp4"
              controls
              muted
              playsInline
              preload="metadata"
              poster={selected ? baseUri(selected.outputs.beforeImage) : undefined}
            />
            <div className="atlas-stats">
              <span>
                <b>{catalog.receipts.length}</b> domain fixtures
              </span>
              <span>
                <b>4</b> creator domains
              </span>
              <span>
                <b>100%</b> fixture target floor
              </span>
              <span>
                <b>$0</b> local inference
              </span>
            </div>
          </div>
          <div className="atlas-mobile-tabs">
            {MODES.map(({ id, label }) => (
              <button
                type="button"
                className={mode === id ? 'is-current' : ''}
                onClick={() => setMode(id)}
                key={id}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === 'gallery' && (
            <Gallery
              receipts={filtered}
              selected={selected}
              onSelect={(receipt) => setSelectedId(receipt.id)}
            />
          )}
          {mode === 'arena' && <DetectorArena receipts={catalog.receipts} />}
          {mode === 'harness' && <HarnessCompare receipts={catalog.receipts} />}
          {mode === 'proof' && (
            <ProofLedger receipts={catalog.receipts} generatedAt={catalog.generatedAt} />
          )}
        </section>
        <AtlasGuide selected={selected} />
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('NodeVideo Atlas root missing.');
createRoot(root).render(
  <StrictMode>
    <AtlasApp />
  </StrictMode>,
);
