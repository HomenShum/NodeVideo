import '@/styles.css';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  CloudOff,
  Database,
  Download,
  FileDown,
  FileJson,
  Film,
  FlaskConical,
  GitCompareArrows,
  Info,
  Moon,
  RefreshCcw,
  Route,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Trash2,
  TriangleAlert,
  Users,
  XCircle,
} from 'lucide-react';
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './creatorbench.css';
import { CreatorBenchReviewClient, createConvexReviewBackend } from './creatorbench-review-client';

const REPORT_URL = '/benchmarks/creatorbench-v1/results/public-report.json';
const CSV_URL = '/benchmarks/creatorbench-v1/results/public-report.csv';

type Metric = {
  numerator?: number;
  denominator?: number;
  estimate?: number;
  rate?: number;
  confidenceInterval?: { lower?: number; upper?: number; level?: number };
};

type Subgroup = {
  id?: string;
  label?: string;
  domain?: string;
  workflow?: string;
  condition?: string;
  total?: number;
  automaticUsable?: Metric | number;
  assistedUsable?: Metric | number;
  reviewRequired?: Metric | number;
  safelyAbstained?: Metric | number;
  silentFailure?: Metric | number;
  medianCorrectionSeconds?: number;
};

type RouteRecord = {
  id?: string;
  label?: string;
  executor?: string;
  workflow?: string;
  domain?: string;
  sampleCount?: number;
  usable?: Metric | number;
  silentFailure?: Metric | number;
  medianCostUsd?: number;
  medianLatencyMs?: number;
  status?: string;
  reason?: string;
};

type FailureRecord = {
  id?: string;
  title?: string;
  workflow?: string;
  domain?: string;
  outcome?: string;
  reason?: string;
  limitation?: string;
  poster?: string;
  publicArtifactUrl?: string;
};

type ReviewCase = {
  id: string;
  resultId?: string;
  split?: 'development' | 'public-test' | 'adversarial';
  variantId?: string;
  blindedVariantIds?: string[];
  agreementMode?: boolean;
  agreementRoundId?: string;
  visibility?: 'public' | 'private';
  request?: string;
  sourcePoster?: string;
  outputPoster?: string;
  outputs?: Array<{ id: string; label: string; poster: string }>;
  variantAPoster?: string;
  variantBPoster?: string;
  publicSourceLabel?: string;
  route?: string;
  confidence?: number;
  machineFindings?: string[];
};

type PublicReport = {
  schemaVersion?: string;
  benchmarkVersion?: string;
  status?: string;
  generatedAt?: string;
  methodologyUrl?: string;
  counts?: {
    clips?: number;
    creators?: number;
    sources?: number;
    domains?: number;
    workflows?: number;
    instances?: number;
    privateHeldoutInstances?: number;
    adversarialInstances?: number;
    reviewedInstances?: number;
    excludedInstances?: number;
    splits?: Record<string, number>;
  };
  outcomes?: Record<string, Metric | number | undefined>;
  performance?: Record<string, Metric | number | undefined>;
  subgroupPerformance?: Subgroup[];
  subgroups?: Subgroup[];
  routes?: RouteRecord[];
  routeComparison?: RouteRecord[];
  knownWeaknesses?: string[];
  weaknesses?: string[];
  representativeFailures?: FailureRecord[];
  failures?: FailureRecord[];
  reviewCases?: ReviewCase[];
  reviewerAgreement?: Metric | number;
  medianCorrectionSeconds?: number;
  p50LatencyMs?: number;
  p95LatencyMs?: number;
  costPerUsableOutputUsd?: number;
  exportReopen?: Metric | number;
  exportReopenScope?: string;
  missingDataTreatment?: string;
  exclusions?: string[];
  workflowCoverage?: {
    declared?: number;
    represented?: number;
    missing?: string[];
    corpusTierCounts?: Record<string, number>;
  };
  freezeReceipt?: {
    receiptId?: string;
    frozenAt?: string;
    sourceCommit?: string;
    configHash?: string;
    manifestHash?: string;
    evaluatorVersion?: string;
    thresholdPolicy?: string;
    status?: string;
  };
};

type RawPublicReport = PublicReport & {
  claim?: {
    schemaVersion?: string;
    benchmarkVersion?: string;
    generatedAt?: string;
    freezeReceiptId?: string;
    population?: {
      instanceCount?: number;
      sourceCount?: number;
      creatorDisjointSourceCount?: number;
      domainCount?: number;
      workflowCount?: number;
    };
    outcomes?: Record<string, Metric | number | undefined>;
    limitations?: string[];
  };
  dataset?: {
    clips?: number;
    creators?: number;
    sources?: number;
    domains?: number;
    workflows?: number;
    instances?: number;
    privateHeldoutInstances?: number;
    splits?: Record<string, number>;
  };
  metrics?: {
    latencyMs?: { p50?: number | null; p95?: number | null };
    costUsd?: { perUsableOutput?: number | null };
    correctionTimeSeconds?: { median?: number | null };
    exportReopen?: (Metric & { scope?: string; label?: string }) | number;
    exportReopenScope?: string;
  };
  downloads?: { json?: string; csv?: string };
};

type View = 'overview' | 'coverage' | 'failures' | 'routes' | 'freeze' | 'review';
type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; report: PublicReport; raw: string };
type ReviewCategory =
  | 'usable_as_is'
  | 'usable_after_minor_correction'
  | 'requires_major_correction'
  | 'unusable'
  | 'unsafe_or_rights_invalid';

const OUTCOMES = [
  ['automaticUsable', 'Automatic usable', 'automatic'],
  ['assistedUsable', 'Assisted usable', 'assisted'],
  ['reviewRequired', 'Review required', 'review'],
  ['safelyAbstained', 'Safely abstained', 'abstain'],
  ['unsupported', 'Unsupported', 'unsupported'],
  ['technicalFailure', 'Technical failure', 'technical'],
  ['silentFailure', 'Silent failure', 'silent'],
] as const;

const VIEWS: Array<{ id: View; label: string; icon: typeof BarChart3 }> = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'coverage', label: 'Coverage', icon: Database },
  { id: 'failures', label: 'Weaknesses', icon: ShieldAlert },
  { id: 'routes', label: 'Route evidence', icon: Route },
  { id: 'freeze', label: 'Freeze receipt', icon: ShieldCheck },
  { id: 'review', label: 'Review lab', icon: ClipboardCheck },
];

const REVIEW_CATEGORIES: Array<{ id: ReviewCategory; label: string; help: string }> = [
  { id: 'usable_as_is', label: 'Usable as-is', help: 'Would publish without an edit.' },
  {
    id: 'usable_after_minor_correction',
    label: 'Minor correction',
    help: 'Bounded adjustment; core result is right.',
  },
  {
    id: 'requires_major_correction',
    label: 'Major correction',
    help: 'Substantial rework before use.',
  },
  { id: 'unusable', label: 'Unusable', help: 'Does not satisfy the creator request.' },
  {
    id: 'unsafe_or_rights_invalid',
    label: 'Unsafe / rights-invalid',
    help: 'Must not be used or published.',
  },
];

const REASON_CODES = [
  'wrong_subject',
  'missed_content',
  'meaning_changed',
  'unwanted_edit',
  'crop_or_caption_collision',
  'audio_or_sync_issue',
  'export_issue',
  'privacy_or_rights_issue',
] as const;

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function metric(value: Metric | number | undefined): Metric {
  if (typeof value === 'number') return { estimate: value };
  return value ?? {};
}

function estimate(value: Metric | number | undefined): number | undefined {
  const normalized = metric(value);
  const direct = finite(normalized.estimate);
  if (direct !== undefined) return direct;
  const rate = finite(normalized.rate);
  if (rate !== undefined) return rate;
  const numerator = finite(normalized.numerator);
  const denominator = finite(normalized.denominator);
  if (numerator !== undefined && denominator && denominator > 0) return numerator / denominator;
  return undefined;
}

function normalizePublicReport(input: RawPublicReport): PublicReport {
  const claim = input.claim;
  const population = claim?.population;
  const dataset = input.dataset;
  const sourceOutcomes = input.outcomes ?? input.performance ?? claim?.outcomes ?? {};
  const aliases: Record<string, string> = {
    automatic_usable: 'automaticUsable',
    assisted_usable: 'assistedUsable',
    review_required: 'reviewRequired',
    safely_abstained: 'safelyAbstained',
    technical_failure: 'technicalFailure',
    silent_failure: 'silentFailure',
  };
  const normalizedOutcomes: Record<string, Metric | number | undefined> = {};
  for (const [key, value] of Object.entries(sourceOutcomes)) {
    normalizedOutcomes[aliases[key] ?? key] = value;
  }
  const rawSubgroups = (input.subgroups ?? input.subgroupPerformance ?? []) as Array<
    Subgroup & {
      kind?: string;
      count?: number;
      outcomes?: Record<string, Metric | number | undefined>;
    }
  >;
  const normalizedSubgroups = rawSubgroups.map((group) => ({
    ...group,
    label:
      group.label ??
      (group.kind && group.id
        ? `${group.kind.replaceAll('-', ' ')} · ${group.id.replaceAll('-', ' ')}`
        : group.id),
    total: group.total ?? group.count,
    domain: group.domain ?? (group.kind === 'domain' ? group.id : undefined),
    workflow: group.workflow ?? (group.kind === 'workflow' ? group.id : undefined),
    automaticUsable: group.automaticUsable ?? group.outcomes?.automatic_usable,
    assistedUsable: group.assistedUsable ?? group.outcomes?.assisted_usable,
    reviewRequired: group.reviewRequired ?? group.outcomes?.review_required,
    safelyAbstained: group.safelyAbstained ?? group.outcomes?.safely_abstained,
    silentFailure: group.silentFailure ?? group.outcomes?.silent_failure,
  }));
  const rawFreeze = input.freezeReceipt as
    | (NonNullable<PublicReport['freezeReceipt']> & {
        id?: string;
        sourceCommitSha?: string;
        benchmarkManifestHash?: string;
        thresholdPolicyHash?: string;
      })
    | undefined;
  return {
    ...input,
    schemaVersion: input.schemaVersion ?? claim?.schemaVersion,
    benchmarkVersion: input.benchmarkVersion ?? claim?.benchmarkVersion,
    generatedAt: input.generatedAt ?? claim?.generatedAt,
    counts: {
      ...input.counts,
      clips: input.counts?.clips ?? dataset?.clips,
      creators:
        input.counts?.creators ?? dataset?.creators ?? population?.creatorDisjointSourceCount,
      sources: input.counts?.sources ?? dataset?.sources ?? population?.sourceCount,
      domains: input.counts?.domains ?? dataset?.domains ?? population?.domainCount,
      workflows: input.counts?.workflows ?? dataset?.workflows ?? population?.workflowCount,
      instances: input.counts?.instances ?? dataset?.instances ?? population?.instanceCount,
      privateHeldoutInstances:
        input.counts?.privateHeldoutInstances ??
        dataset?.privateHeldoutInstances ??
        population?.instanceCount,
      splits: input.counts?.splits ?? dataset?.splits,
    },
    outcomes: normalizedOutcomes,
    subgroupPerformance: normalizedSubgroups,
    knownWeaknesses: input.knownWeaknesses ?? input.weaknesses ?? claim?.limitations ?? [],
    p50LatencyMs: finite(input.p50LatencyMs ?? input.metrics?.latencyMs?.p50),
    p95LatencyMs: finite(input.p95LatencyMs ?? input.metrics?.latencyMs?.p95),
    medianCorrectionSeconds: finite(
      input.medianCorrectionSeconds ?? input.metrics?.correctionTimeSeconds?.median,
    ),
    costPerUsableOutputUsd: finite(
      input.costPerUsableOutputUsd ?? input.metrics?.costUsd?.perUsableOutput,
    ),
    exportReopen: input.exportReopen ?? input.metrics?.exportReopen,
    exportReopenScope:
      input.exportReopenScope ??
      input.metrics?.exportReopenScope ??
      (typeof input.metrics?.exportReopen === 'object'
        ? (input.metrics.exportReopen.scope ?? input.metrics.exportReopen.label)
        : undefined),
    freezeReceipt: rawFreeze
      ? {
          ...rawFreeze,
          receiptId: rawFreeze.receiptId ?? rawFreeze.id,
          sourceCommit: rawFreeze.sourceCommit ?? rawFreeze.sourceCommitSha,
          manifestHash: rawFreeze.manifestHash ?? rawFreeze.benchmarkManifestHash,
          thresholdPolicy: rawFreeze.thresholdPolicy ?? rawFreeze.thresholdPolicyHash,
        }
      : claim?.freezeReceiptId
        ? { receiptId: claim.freezeReceiptId }
        : undefined,
  };
}

function percent(value: number | undefined): string {
  return value === undefined ? 'Not reported' : `${(value * 100).toFixed(1)}%`;
}

function whole(value: number | undefined): string {
  return value === undefined ? 'Not reported' : new Intl.NumberFormat('en-US').format(value);
}

function dollars(value: number | undefined): string {
  return value === undefined ? 'Not reported' : `$${value.toFixed(value < 1 ? 3 : 2)}`;
}

function interval(value: Metric | number | undefined): string {
  const ci = metric(value).confidenceInterval;
  if (ci?.lower === undefined || ci.upper === undefined) return 'CI not reported';
  return `${Math.round((ci.level ?? 0.95) * 100)}% CI ${percent(ci.lower)}–${percent(ci.upper)}`;
}

function ratio(value: Metric | number | undefined): string {
  const normalized = metric(value);
  if (normalized.numerator === undefined || normalized.denominator === undefined) {
    return 'n/d not reported';
  }
  return `${normalized.numerator}/${normalized.denominator}`;
}

function outcome(report: PublicReport, key: string): Metric | number | undefined {
  return report.outcomes?.[key] ?? report.performance?.[key];
}

function isUnevaluated(report: PublicReport): boolean {
  const total = report.counts?.instances ?? 0;
  return (
    total === 0 || report.status === 'infrastructure_only' || report.status === 'not_evaluated'
  );
}

function publicAsset(path: string | undefined): string | undefined {
  if (!path) return undefined;
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  if (/(private|heldout|signed|token|locator)/iu.test(decoded)) return undefined;
  const relative = decoded.startsWith('/') ? decoded : `/${decoded.replace(/^fixtures\//u, '')}`;
  if (!/^\/(media|benchmarks\/creatorbench-v1\/public)\//u.test(relative)) return undefined;
  return relative;
}

function MetricCard({
  label,
  value,
  tone,
}: { label: string; value: Metric | number | undefined; tone: string }) {
  const normalized = metric(value);
  const point = estimate(value);
  return (
    <article className={`cb-metric cb-tone-${tone}`} data-testid={`metric-${tone}`}>
      <div className="cb-metric-top">
        <span>{label}</span>
        <b>{percent(point)}</b>
      </div>
      <div className="cb-meter" role="img" aria-label={`${label}: ${percent(point)}`}>
        <i style={{ width: `${Math.max(0, Math.min(1, point ?? 0)) * 100}%` }} />
      </div>
      <footer>
        <code>{ratio(normalized)}</code>
        <span>{interval(normalized)}</span>
      </footer>
    </article>
  );
}

function DatasetStrip({ report }: { report: PublicReport }) {
  const items = [
    ['Clips', report.counts?.clips],
    ['Creator-disjoint sources', report.counts?.creators ?? report.counts?.sources],
    ['Domains', report.counts?.domains],
    ['Workflows', report.counts?.workflows],
    ['Instances', report.counts?.instances],
    ['Private held-out population', report.counts?.privateHeldoutInstances],
  ] as const;
  return (
    <section className="cb-dataset-strip" aria-label="Dataset coverage">
      {items.map(([label, value]) => (
        <div key={label}>
          <b>{whole(value)}</b>
          <span>{label}</span>
        </div>
      ))}
    </section>
  );
}

function HonestEmpty({ report }: { report: PublicReport }) {
  return (
    <section className="cb-empty" data-testid="unevaluated-state">
      <FlaskConical />
      <span>Infrastructure ready · evidence pending</span>
      <h2>No benchmark performance has been published yet.</h2>
      <p>
        CreatorBench will not estimate rates from showcase fixtures. Results appear only after a
        frozen configuration, sealed execution, and bounded human review produce a public report.
      </p>
      <div>
        <b>Current report status</b>
        <code>{report.status ?? 'not reported'}</code>
      </div>
    </section>
  );
}

function Overview({ report }: { report: PublicReport }) {
  if (isUnevaluated(report)) return <HonestEmpty report={report} />;
  const exportMetric = metric(report.exportReopen);
  const exportScope =
    report.exportReopenScope ??
    (exportMetric.numerator === 264 && exportMetric.denominator === 264
      ? 'Public center-crop render pilot'
      : 'Scope not reported');
  return (
    <div className="cb-overview" data-testid="creatorbench-overview">
      {report.counts?.reviewedInstances === 0 && (
        <section className="cb-unverified-quality" role="note" data-testid="unverified-quality">
          <AlertTriangle />
          <div>
            <b>Human editing quality and silent-failure incidence are unverified</b>
            <p>
              This release contains zero completed human reviews. Machine classifications cannot
              establish creator usability or silent-failure incidence.
            </p>
          </div>
        </section>
      )}
      <section className="cb-metric-grid" aria-label="Benchmark outcome rates">
        {OUTCOMES.map(([key, label, tone]) => (
          <MetricCard key={key} label={label} value={outcome(report, key)} tone={tone} />
        ))}
      </section>
      <section className="cb-system-grid">
        <article>
          <Clock3 />
          <span>Latency</span>
          <b>
            {report.p50LatencyMs === undefined
              ? 'Not reported'
              : `${(report.p50LatencyMs / 1000).toFixed(1)}s p50`}
          </b>
          <small>
            {report.p95LatencyMs === undefined
              ? 'p95 not reported'
              : `${(report.p95LatencyMs / 1000).toFixed(1)}s p95`}
          </small>
        </article>
        <article>
          <Activity />
          <span>Creator correction</span>
          <b>
            {report.medianCorrectionSeconds === undefined
              ? 'Not reported'
              : `${report.medianCorrectionSeconds}s median`}
          </b>
          <small>{whole(report.counts?.reviewedInstances)} reviewed instances</small>
        </article>
        <article>
          <GitCompareArrows />
          <span>Export + reopen</span>
          <b>{percent(estimate(report.exportReopen))}</b>
          <small>
            {ratio(report.exportReopen)} · {exportScope}
          </small>
        </article>
        <article>
          <Database />
          <span>Cost per usable output</span>
          <b>{dollars(report.costPerUsableOutputUsd)}</b>
          <small>Missing costs remain excluded</small>
        </article>
      </section>
      <section className="cb-disclosure">
        <Info />
        <div>
          <b>Missing-data treatment</b>
          <p>{report.missingDataTreatment ?? 'Not reported in this benchmark release.'}</p>
        </div>
      </section>
    </div>
  );
}

function Coverage({ report }: { report: PublicReport }) {
  const groups = report.subgroupPerformance ?? report.subgroups ?? [];
  const splitEntries = Object.entries(report.counts?.splits ?? {});
  return (
    <div className="cb-coverage" data-testid="coverage-view">
      <section className="cb-section-heading">
        <span>Distribution, not one average</span>
        <h2>Subgroup performance</h2>
        <p>
          Every weak category stays visible. Empty cells mean the report did not publish a value.
        </p>
      </section>
      {splitEntries.length > 0 && (
        <section className="cb-splits" aria-label="Benchmark splits">
          {splitEntries.map(([name, count]) => (
            <article key={name}>
              <span>{name.replaceAll('_', ' ')}</span>
              <b>{whole(count)}</b>
            </article>
          ))}
        </section>
      )}
      {report.workflowCoverage && (
        <section className="cb-admissibility" aria-label="Workflow admissibility coverage">
          <div>
            <span>Workflow-admissible coverage</span>
            <b>
              {whole(report.workflowCoverage.represented)} /{' '}
              {whole(report.workflowCoverage.declared)} workflows
            </b>
            <p>
              Sources count only where their duration, audio, assets, and annotations make the
              workflow a valid test. Missing tiers remain explicit gaps.
            </p>
          </div>
          {(report.workflowCoverage.missing?.length ?? 0) > 0 && (
            <ul>
              {report.workflowCoverage.missing?.map((workflow) => (
                <li key={workflow}>{workflow.replaceAll('-', ' ')}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      {groups.length === 0 ? (
        <section className="cb-inline-empty">
          <CircleHelp /> No subgroup results were published in this report.
        </section>
      ) : (
        <div className="cb-table-wrap">
          <table className="cb-table">
            <caption className="sr-only">CreatorBench subgroup performance</caption>
            <thead>
              <tr>
                <th>Subgroup</th>
                <th>n</th>
                <th>Automatic</th>
                <th>Assisted</th>
                <th>Review</th>
                <th>Abstained</th>
                <th>Silent failure</th>
                <th>Correction</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, index) => (
                <tr key={group.id ?? `${group.label}-${index}`}>
                  <th>
                    <b>{group.label ?? group.domain ?? group.workflow ?? 'Unnamed subgroup'}</b>
                    <span>{group.condition ?? group.workflow ?? group.domain ?? '—'}</span>
                  </th>
                  <td>{whole(group.total)}</td>
                  <td>{percent(estimate(group.automaticUsable))}</td>
                  <td>{percent(estimate(group.assistedUsable))}</td>
                  <td>{percent(estimate(group.reviewRequired))}</td>
                  <td>{percent(estimate(group.safelyAbstained))}</td>
                  <td className="cb-cell-danger">{percent(estimate(group.silentFailure))}</td>
                  <td>
                    {group.medianCorrectionSeconds === undefined
                      ? 'Not reported'
                      : `${group.medianCorrectionSeconds}s`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(report.exclusions?.length ?? 0) > 0 && (
        <section className="cb-exclusions">
          <b>Benchmark exclusions</b>
          <ul>
            {report.exclusions?.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FailureCard({ failure }: { failure: FailureRecord }) {
  const image = publicAsset(failure.poster);
  return (
    <article className="cb-failure-card">
      <div className="cb-failure-media">
        {image ? (
          <img src={image} alt="Public benchmark failure example" />
        ) : (
          <div aria-label="No public media disclosed">
            <ShieldAlert />
            <span>Media withheld</span>
          </div>
        )}
        <span>{failure.outcome?.replaceAll('_', ' ') ?? 'failure'}</span>
      </div>
      <div>
        <small>{[failure.workflow, failure.domain].filter(Boolean).join(' · ')}</small>
        <h3>{failure.title ?? 'Untitled disclosed failure'}</h3>
        <p>{failure.reason ?? failure.limitation ?? 'No failure explanation was published.'}</p>
        {failure.publicArtifactUrl && (
          <a href={failure.publicArtifactUrl} target="_blank" rel="noreferrer">
            Inspect public artifact
          </a>
        )}
      </div>
    </article>
  );
}

function Failures({ report }: { report: PublicReport }) {
  const weaknesses = report.knownWeaknesses ?? report.weaknesses ?? [];
  const failures = report.representativeFailures ?? report.failures ?? [];
  return (
    <div className="cb-failures" data-testid="failure-view">
      <section className="cb-section-heading danger">
        <span>Failures are benchmark output</span>
        <h2>Where NodeVideo is not yet reliable</h2>
        <p>Representative public cases only. Private held-out media is never rendered here.</p>
      </section>
      <section className="cb-weakness-grid">
        {weaknesses.length === 0 ? (
          <div className="cb-inline-empty">
            <CircleHelp /> No known weaknesses were published in this report.
          </div>
        ) : (
          weaknesses.map((weakness, index) => (
            <article key={weakness}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <p>{weakness}</p>
            </article>
          ))
        )}
      </section>
      <section className="cb-failure-gallery" aria-label="Representative failure gallery">
        {failures.length === 0 ? (
          <div className="cb-inline-empty">
            <CircleHelp /> No rights-cleared public failure artifacts were disclosed.
          </div>
        ) : (
          failures.map((failure, index) => (
            <FailureCard key={failure.id ?? `${failure.title}-${index}`} failure={failure} />
          ))
        )}
      </section>
    </div>
  );
}

function Routes({ report }: { report: PublicReport }) {
  const routes = report.routeComparison ?? report.routes ?? [];
  return (
    <div className="cb-routes" data-testid="route-view">
      <section className="cb-section-heading">
        <span>Cheapest credible route</span>
        <h2>Executor evidence</h2>
        <p>
          A route is promoted only from sufficient samples, confidence bounds, and silent-failure
          limits.
        </p>
      </section>
      {routes.length === 0 ? (
        <section className="cb-inline-empty">
          <Route /> No route comparison has been published.
        </section>
      ) : (
        <div className="cb-route-grid">
          {routes.map((route, index) => (
            <article key={route.id ?? `${route.executor}-${index}`}>
              <header>
                <span>{route.status ?? 'observed'}</span>
                <b>{route.label ?? route.executor ?? 'Unnamed route'}</b>
                <small>{[route.workflow, route.domain].filter(Boolean).join(' · ')}</small>
              </header>
              <dl>
                <div>
                  <dt>Samples</dt>
                  <dd>{whole(route.sampleCount)}</dd>
                </div>
                <div>
                  <dt>Usable</dt>
                  <dd>{percent(estimate(route.usable))}</dd>
                </div>
                <div>
                  <dt>Silent failure</dt>
                  <dd>{percent(estimate(route.silentFailure))}</dd>
                </div>
                <div>
                  <dt>Median cost</dt>
                  <dd>{dollars(route.medianCostUsd)}</dd>
                </div>
                <div>
                  <dt>Median latency</dt>
                  <dd>
                    {route.medianLatencyMs === undefined
                      ? 'Not reported'
                      : `${(route.medianLatencyMs / 1000).toFixed(1)}s`}
                  </dd>
                </div>
              </dl>
              {route.reason && <p>{route.reason}</p>}
            </article>
          ))}
        </div>
      )}
      <section className="cb-route-ladder">
        <b>Routing ladder</b>
        <div>
          {[
            'Signals',
            'Closed-set',
            'Open vocabulary',
            'Segmentation',
            'Specialist',
            'User seed',
            'Review',
            'Abstain',
          ].map((item, index) => (
            <span key={item}>
              <i>{index + 1}</i>
              {item}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function Freeze({ report }: { report: PublicReport }) {
  const receipt = report.freezeReceipt;
  const fields = [
    ['Receipt', receipt?.receiptId],
    ['Frozen at', receipt?.frozenAt],
    ['Source commit', receipt?.sourceCommit],
    ['Config hash', receipt?.configHash],
    ['Manifest hash', receipt?.manifestHash],
    ['Evaluator', receipt?.evaluatorVersion],
    ['Threshold policy', receipt?.thresholdPolicy],
  ] as const;
  return (
    <div className="cb-freeze" data-testid="freeze-view">
      <section className="cb-freeze-mark">
        <ShieldCheck />
        <div>
          <span>Evaluation boundary</span>
          <h2>{receipt ? 'Configuration receipt disclosed' : 'No freeze receipt published'}</h2>
          <p>
            Private labels may be evaluated only after source, configuration, routes, models,
            thresholds, and evaluator versions are frozen.
          </p>
        </div>
        <strong className={receipt ? 'is-ready' : ''}>{receipt?.status ?? 'not reported'}</strong>
      </section>
      <section className="cb-freeze-fields">
        {fields.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <code>{value ?? 'Not reported'}</code>
          </div>
        ))}
      </section>
      <section className="cb-freeze-rule">
        <TriangleAlert />
        <p>
          A post-reveal repair becomes a new benchmark version. It cannot be reported as the same
          frozen evaluation.
        </p>
      </section>
    </div>
  );
}

function ReviewLab({ cases, benchmarkVersion }: { cases: ReviewCase[]; benchmarkVersion: string }) {
  const [index, setIndex] = useState(0);
  const [category, setCategory] = useState<ReviewCategory>();
  const [seconds, setSeconds] = useState('');
  const [reasons, setReasons] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [variant, setVariant] = useState<'a' | 'b' | 'tie' | ''>('');
  const [submitted, setSubmitted] = useState<Record<string, ReviewCategory>>({});
  const [savedAssignments, setSavedAssignments] = useState<Record<string, string>>({});
  const [explicitOptIn, setExplicitOptIn] = useState(false);
  const [persistence, setPersistence] = useState<'idle' | 'submitting' | 'saved' | 'error'>('idle');
  const [persistenceMessage, setPersistenceMessage] = useState('');
  const [deleteArmed, setDeleteArmed] = useState(false);
  const reviewClient = useMemo(
    () =>
      new CreatorBenchReviewClient(
        createConvexReviewBackend(import.meta.env.VITE_CONVEX_URL),
        window.localStorage,
      ),
    [],
  );
  const reviewCase = cases[index];
  const reset = () => {
    setCategory(undefined);
    setSeconds('');
    setReasons([]);
    setNotes('');
    setVariant('');
    setExplicitOptIn(false);
    setPersistence('idle');
    setPersistenceMessage('');
  };
  const submit = async () => {
    if (!reviewCase || !category || seconds === '' || Number(seconds) < 0) return;
    const persistable = Boolean(reviewCase.resultId && reviewCase.split);
    if (!persistable) {
      setSubmitted((current) => ({ ...current, [reviewCase.id]: category }));
      setPersistenceMessage('Held as a local draft only; this case has no durable assignment.');
      return;
    }
    setPersistence('submitting');
    setPersistenceMessage('Claiming a blinded assignment and verifying the completed write…');
    try {
      const selectedVariant = variant && variant !== 'tie' ? variant : undefined;
      const result = await reviewClient.submit({
        benchmarkVersion,
        instanceId: reviewCase.id,
        resultId: reviewCase.resultId ?? '',
        split: reviewCase.split ?? 'public-test',
        variantId: reviewCase.variantId,
        blindedVariantIds:
          reviewCase.blindedVariantIds ??
          (reviewCase.variantAPoster || reviewCase.variantBPoster
            ? ['variant:a', 'variant:b']
            : []),
        usability: category,
        correctionTimeSeconds: Number(seconds),
        reasonCodes: reasons,
        correctnessIssues: notes ? [notes] : [],
        missedSubjectOrContent: reasons.filter(
          (reason) => reason === 'wrong_subject' || reason === 'missed_content',
        ),
        unwantedEdits: reasons.filter(
          (reason) => reason !== 'wrong_subject' && reason !== 'missed_content',
        ),
        preferredVariantId: selectedVariant,
        agreementMode: Boolean(reviewCase.agreementMode),
        agreementRoundId: reviewCase.agreementRoundId,
        explicitOptIn,
      });
      setSubmitted((current) => ({ ...current, [reviewCase.id]: category }));
      setSavedAssignments((current) => ({
        ...current,
        [reviewCase.id]: result.assignmentId,
      }));
      setPersistence('saved');
      setPersistenceMessage('Durable review verified against the pseudonymous reviewer history.');
    } catch (error) {
      setPersistence('error');
      setPersistenceMessage(
        error instanceof Error ? error.message : 'Review backend failed. Draft was not saved.',
      );
    }
  };
  const exportHistory = async () => {
    try {
      const contents = await reviewClient.exportHistory();
      const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `creatorbench-review-history-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setPersistenceMessage('Pseudonymous review history exported.');
    } catch (error) {
      setPersistence('error');
      setPersistenceMessage(error instanceof Error ? error.message : 'Review export failed.');
    }
  };
  const deleteHistory = async () => {
    if (!deleteArmed) return;
    setPersistence('submitting');
    try {
      const receipt = await reviewClient.deleteAll();
      setSubmitted({});
      setSavedAssignments({});
      setDeleteArmed(false);
      setPersistence('idle');
      setPersistenceMessage(
        `${receipt.deletedCount} server review${receipt.deletedCount === 1 ? '' : 's'} deleted and verified. Local identity removed.`,
      );
    } catch (error) {
      setPersistence('error');
      setPersistenceMessage(
        error instanceof Error ? error.message : 'Reviewer deletion failed closed.',
      );
    }
  };
  if (!reviewCase) {
    return (
      <section className="cb-empty cb-review-empty" data-testid="review-empty">
        <ClipboardCheck />
        <span>Blind reviewer · local only</span>
        <h2>No public review cases are available.</h2>
        <p>
          Private held-out media is never loaded into this public surface. An authorized review
          bundle must supply bounded public or consented cases.
        </p>
      </section>
    );
  }
  const complete = submitted[reviewCase.id];
  const persistable = Boolean(reviewCase.resultId && reviewCase.split);
  const durablySaved = Boolean(savedAssignments[reviewCase.id]);
  return (
    <div className="cb-review" data-testid="review-lab">
      <header className="cb-review-header">
        <div>
          <span>
            Blind review · case {index + 1} of {cases.length}
          </span>
          <h2>Would a creator use this result?</h2>
          <p>
            Route, confidence, and machine findings stay hidden until judgment. Draft state exists
            in this browser session until you explicitly opt in to a pseudonymous durable review.
          </p>
        </div>
        <span className={`cb-local-badge ${durablySaved ? 'is-saved' : ''}`}>
          {durablySaved ? 'DURABLE · VERIFIED' : 'LOCAL DRAFT · NOT SAVED'}
        </span>
      </header>
      <section className="cb-review-request">
        <span>Creator request</span>
        <blockquote>{reviewCase.request ?? 'Request was not disclosed.'}</blockquote>
        <small>{reviewCase.publicSourceLabel ?? 'Public/consented benchmark case'}</small>
      </section>
      <section className="cb-review-media" aria-label="Blind before and after review">
        <figure>
          {publicAsset(reviewCase.sourcePoster) ? (
            <img src={publicAsset(reviewCase.sourcePoster)} alt="Source frame before processing" />
          ) : (
            <div>
              <Film /> Source preview withheld
            </div>
          )}
          <figcaption>Before · source</figcaption>
        </figure>
        <figure>
          {publicAsset(reviewCase.outputPoster) ? (
            <img src={publicAsset(reviewCase.outputPoster)} alt="Candidate output frame" />
          ) : (
            <div>
              <Film /> Output preview withheld
            </div>
          )}
          <figcaption>After · candidate</figcaption>
        </figure>
      </section>
      {reviewCase.outputs?.length ? (
        <section className="cb-review-format-outputs" aria-label="Additional requested formats">
          <h3>Additional requested formats</h3>
          <div>
            {reviewCase.outputs.map((output) => (
              <figure key={output.id}>
                {publicAsset(output.poster) ? (
                  <img src={publicAsset(output.poster)} alt={`${output.label} candidate frame`} />
                ) : (
                  <div>
                    <Film /> Output preview withheld
                  </div>
                )}
                <figcaption>{output.label} candidate</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}
      {(reviewCase.variantAPoster || reviewCase.variantBPoster) && (
        <fieldset className="cb-variant-choice">
          <legend>Blind A/B preference</legend>
          {(['a', 'b', 'tie'] as const).map((choice) => (
            <label key={choice}>
              <input
                type="radio"
                name="variant"
                value={choice}
                checked={variant === choice}
                onChange={() => setVariant(choice)}
              />
              {choice === 'tie' ? 'No preference' : `Variant ${choice.toUpperCase()}`}
            </label>
          ))}
        </fieldset>
      )}
      <section className="cb-review-form">
        <fieldset className="cb-category-fieldset">
          <legend>Usability category</legend>
          {REVIEW_CATEGORIES.map((item) => (
            <label key={item.id} className={category === item.id ? 'is-selected' : ''}>
              <input
                type="radio"
                name="usability"
                value={item.id}
                checked={category === item.id}
                onChange={() => setCategory(item.id)}
              />
              <span>
                <b>{item.label}</b>
                <small>{item.help}</small>
              </span>
              {category === item.id && <Check />}
            </label>
          ))}
        </fieldset>
        <div className="cb-review-details">
          <label>
            Estimated correction time <span>seconds</span>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
              placeholder="0"
            />
          </label>
          <fieldset>
            <legend>Reason codes</legend>
            <div className="cb-reason-grid">
              {REASON_CODES.map((reason) => (
                <label key={reason}>
                  <input
                    type="checkbox"
                    checked={reasons.includes(reason)}
                    onChange={() =>
                      setReasons((current) =>
                        current.includes(reason)
                          ? current.filter((item) => item !== reason)
                          : [...current, reason],
                      )
                    }
                  />
                  {reason.replaceAll('_', ' ')}
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            Reviewer notes <span>optional</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Describe the smallest correction that would make this usable."
            />
            <small>Do not include names, private locators, or identifying information.</small>
          </label>
          {persistable && (
            <label className="cb-review-optin">
              <input
                type="checkbox"
                checked={explicitOptIn}
                onChange={(event) => setExplicitOptIn(event.target.checked)}
              />
              <span>
                <b>Save this review pseudonymously</b>
                <small>
                  Creates a local random reviewer hash, stores the blinded judgment in the review
                  backend, and verifies the completed write. No raw identity is submitted.
                </small>
              </span>
            </label>
          )}
          {persistable && !reviewClient.available && (
            <div className="cb-review-backend-warning" role="alert">
              <CloudOff />
              <span>
                <b>Review backend unavailable</b>
                <small>Your draft remains local and is not counted.</small>
              </span>
            </div>
          )}
          <button
            type="button"
            className="cb-review-submit"
            disabled={
              !category ||
              seconds === '' ||
              Number(seconds) < 0 ||
              Boolean(complete) ||
              persistence === 'submitting' ||
              (persistable && (!explicitOptIn || !reviewClient.available))
            }
            onClick={submit}
          >
            {persistence === 'submitting' ? (
              <>
                <RefreshCcw className="cb-spin" /> Verifying durable review…
              </>
            ) : complete ? (
              <>
                <CheckCircle2 />{' '}
                {durablySaved ? 'Durable review verified' : 'Judgment held locally'}
              </>
            ) : (
              <>
                <ClipboardCheck /> {persistable ? 'Submit durable review' : 'Hold local judgment'}
              </>
            )}
          </button>
          {persistenceMessage && (
            <p
              className={`cb-persistence-message ${persistence === 'error' ? 'is-error' : ''}`}
              role={persistence === 'error' ? 'alert' : 'status'}
            >
              {persistenceMessage}
            </p>
          )}
        </div>
      </section>
      {complete && (
        <section className="cb-post-judgment" aria-live="polite">
          <ShieldCheck />
          <div>
            <b>
              {durablySaved
                ? 'Pseudonymous judgment saved and verified'
                : 'Judgment recorded in local memory only'}
            </b>
            <p>
              Route: {reviewCase.route ?? 'not disclosed'} · Confidence:{' '}
              {reviewCase.confidence === undefined
                ? 'not disclosed'
                : percent(reviewCase.confidence)}
            </p>
            <small>Machine findings remain outside this bounded reviewer surface.</small>
            <a
              href={`data:application/json;charset=utf-8,${encodeURIComponent(
                JSON.stringify(
                  {
                    schemaVersion: 'nodevideo.creatorbench-review/v1',
                    id: `review:draft:${reviewCase.id}`,
                    instanceId: reviewCase.id,
                    resultId: `result:${reviewCase.id}`,
                    reviewerPseudonym: 'reviewer-local-draft',
                    assignmentId: `assignment:draft:${reviewCase.id}`,
                    variantId: variant || undefined,
                    blind: true,
                    usability: complete,
                    correctionTimeSeconds: Number(seconds),
                    correctnessIssues: notes ? [notes] : [],
                    missedSubjectOrContent: reasons.filter((reason) => reason.includes('subject')),
                    unwantedEdits: reasons.filter((reason) => !reason.includes('subject')),
                    reasonCodes: reasons,
                    preferredVariantId: variant && variant !== 'tie' ? variant : undefined,
                    submittedAt: new Date().toISOString(),
                  },
                  null,
                  2,
                ),
              )}`}
              download={`creatorbench-review-${reviewCase.id}.json`}
            >
              <Download /> Download review draft
            </a>
          </div>
        </section>
      )}
      <section className="cb-review-privacy" aria-label="Review data controls">
        <div>
          <ShieldCheck />
          <p>
            <b>Your review data</b>
            <span>
              Export the pseudonymous server history, or permanently delete every associated review
              and this browser’s local reviewer identity.
            </span>
          </p>
        </div>
        <div className="cb-review-data-actions">
          <button type="button" onClick={exportHistory} disabled={!reviewClient.available}>
            <FileDown /> Export history
          </button>
          <label>
            <input
              type="checkbox"
              checked={deleteArmed}
              onChange={(event) => setDeleteArmed(event.target.checked)}
            />
            Confirm permanent deletion
          </label>
          <button
            type="button"
            className="is-danger"
            onClick={deleteHistory}
            disabled={!deleteArmed || !reviewClient.available || persistence === 'submitting'}
          >
            <Trash2 /> Delete all review data
          </button>
        </div>
      </section>
      <footer className="cb-review-pagination">
        <span>{Object.keys(submitted).length} reviewed in this session</span>
        <button
          type="button"
          onClick={() => {
            setIndex((current) => (current - 1 + cases.length) % cases.length);
            reset();
          }}
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => {
            setIndex((current) => (current + 1) % cases.length);
            reset();
          }}
        >
          Next unreviewed
        </button>
      </footer>
    </div>
  );
}

function BenchmarkGuide({ report, view }: { report: PublicReport; view: View }) {
  const [messages, setMessages] = useState([
    {
      id: 0,
      text: 'Ask what this benchmark can defend, where it is weak, or how a route earned promotion.',
    },
  ]);
  const [draft, setDraft] = useState('');
  const ask = () => {
    if (!draft.trim()) return;
    const response = isUnevaluated(report)
      ? 'No performance claim is available. The public report contains no evaluated instances.'
      : view === 'failures'
        ? `${(report.knownWeaknesses ?? report.weaknesses ?? []).length} weaknesses are disclosed; inspect category counts before reading the aggregate.`
        : `CreatorBench ${report.benchmarkVersion ?? 'version not reported'} reports ${whole(report.counts?.instances)} instances. Every rate should be read with its numerator, denominator, and interval.`;
    setMessages((current) => [...current, { id: (current.at(-1)?.id ?? 0) + 1, text: response }]);
    setDraft('');
  };
  return (
    <aside className="cb-guide" aria-label="CreatorBench guide">
      <header>
        <span>
          <Bot />
        </span>
        <div>
          <b>NodeAgent</b>
          <small>report guide · local · no egress</small>
        </div>
      </header>
      <div className="cb-guide-scope">
        <span>READ</span>
        <b>public report · {view}</b>
        <small>WRITE · none</small>
      </div>
      <div className="cb-guide-feed">
        {messages.map((message) => (
          <p key={message.id}>{message.text}</p>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <textarea
          aria-label="Ask CreatorBench"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="What can this release claim?"
        />
        <button type="submit" aria-label="Send benchmark question">
          <Send />
        </button>
      </form>
    </aside>
  );
}

function App() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [view, setView] = useState<View>('overview');
  const [dark, setDark] = useState(true);
  const loadReport = () => {
    setLoad({ kind: 'loading' });
    fetch(REPORT_URL, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Public report unavailable (${response.status}).`);
        const raw = await response.text();
        let report: PublicReport;
        try {
          report = normalizePublicReport(JSON.parse(raw) as RawPublicReport);
        } catch {
          throw new Error('Public report is not valid JSON.');
        }
        if (!report || typeof report !== 'object') throw new Error('Public report is empty.');
        setLoad({ kind: 'ready', report, raw });
      })
      .catch((reason) =>
        setLoad({
          kind: 'error',
          message: reason instanceof Error ? reason.message : 'Public report failed to load.',
        }),
      );
  };
  useEffect(loadReport, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  const downloadJson = useMemo(
    () =>
      load.kind === 'ready'
        ? `data:application/json;charset=utf-8,${encodeURIComponent(load.raw)}`
        : '',
    [load],
  );
  if (load.kind === 'loading') {
    return (
      <main className="cb-state" data-testid="loading-state">
        <FlaskConical className="cb-spin" />
        <span>CreatorBench</span>
        <h1>Loading the public evidence report…</h1>
        <p>No benchmark claim is rendered until the report arrives.</p>
      </main>
    );
  }
  if (load.kind === 'error') {
    return (
      <main className="cb-state cb-error" data-testid="error-state">
        <XCircle />
        <span>Failed closed</span>
        <h1>CreatorBench evidence is unavailable.</h1>
        <p>{load.message}</p>
        <button type="button" onClick={loadReport}>
          <RefreshCcw /> Retry report
        </button>
        <a href="/atlas">Open the fixture-bound Artifact Atlas</a>
      </main>
    );
  }
  const report = load.report;
  return (
    <main className="cb-shell">
      <header className="cb-topbar">
        <a className="cb-brand" href="/creator">
          <span>
            <Film />
          </span>
          <div>
            <b>NodeVideo</b>
            <small>CreatorBench</small>
          </div>
        </a>
        <div className="cb-version">
          <span>{report?.benchmarkVersion ?? 'Version not reported'}</span>
          <code>{report?.schemaVersion ?? 'schema not reported'}</code>
        </div>
        <div className="cb-actions">
          <button
            type="button"
            onClick={() => setDark((current) => !current)}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {dark ? <Sun /> : <Moon />}
          </button>
          <details>
            <summary>
              <Download /> Download <ChevronDown />
            </summary>
            <div>
              <a href={downloadJson} download="creatorbench-public-report.json">
                <FileJson /> Public JSON
              </a>
              <a href={CSV_URL} download>
                <Database /> Public CSV
              </a>
            </div>
          </details>
        </div>
      </header>
      <div className="cb-layout">
        <nav className="cb-nav" aria-label="CreatorBench views">
          <a href="/atlas">
            <ArrowLeft /> Artifact Atlas
          </a>
          <p>Benchmark</p>
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={view === id ? 'is-current' : ''}
              onClick={() => setView(id)}
            >
              <Icon /> {label}
            </button>
          ))}
          <div className="cb-nav-note">
            <ShieldCheck />
            <p>
              <b>Public evidence only</b>
              <span>Private media and labels never load here.</span>
            </p>
          </div>
        </nav>
        <section className="cb-main">
          <header className="cb-hero">
            <div>
              <span className="cb-kicker">
                Measured generalization, not “universal performance”
              </span>
              <h1>See what works, what needs help, and what fails.</h1>
              <p>
                Exact samples, uncertainty, subgroup weaknesses, route decisions, correction time,
                and silent failures—bound to one frozen benchmark release.
              </p>
            </div>
            <aside>
              <span>Release status</span>
              <b>{report?.status?.replaceAll('_', ' ') ?? 'Not reported'}</b>
              <small>
                {report?.generatedAt
                  ? `Generated ${new Date(report.generatedAt).toLocaleString()}`
                  : 'Generation time not reported'}
              </small>
            </aside>
          </header>
          <DatasetStrip report={report} />
          <nav className="cb-mobile-tabs" aria-label="CreatorBench mobile views">
            {VIEWS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={view === id ? 'is-current' : ''}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {view === 'overview' && <Overview report={report} />}
          {view === 'coverage' && <Coverage report={report} />}
          {view === 'failures' && <Failures report={report} />}
          {view === 'routes' && <Routes report={report} />}
          {view === 'freeze' && <Freeze report={report} />}
          {view === 'review' && (
            <ReviewLab
              cases={(report.reviewCases ?? []).filter(
                (reviewCase) => reviewCase.visibility !== 'private',
              )}
              benchmarkVersion={report.benchmarkVersion ?? 'creatorbench-v1.1'}
            />
          )}
        </section>
        <BenchmarkGuide report={report} view={view} />
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('CreatorBench root missing.');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
