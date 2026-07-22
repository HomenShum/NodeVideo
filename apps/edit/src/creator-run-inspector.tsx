import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { FounderVariant } from '@/lib/founder-variant-compiler';
import type { FramingPolicy, ReframePlan } from '@/lib/smart-reframe';
import { Player } from '@remotion/player';
import {
  Check,
  CircleDot,
  Film,
  History,
  Library,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { CreatorAgentPanel } from './creator-agent-panel';
import type { CreatorAgentReply, CreatorAgentRequest } from './creator-agent-panel';
import type { ExecutorProposalView } from './creator-agent-panel';
import type { ChatMessage } from './creator-agent-panel';
import type { CreatorPreset, runCreatorPipeline } from './creator-pipeline';
import { PlanComposition } from './plan-composition';
import type { SmartReframeView } from './smart-reframe-controls';

type SourceView = {
  name: string;
  url: string;
  durationMs: number;
  width: number;
  height: number;
};

type CreatorResult = ReturnType<typeof runCreatorPipeline>;
type CenterView = 'canvas' | 'timeline' | 'variants';

const TEMPLATES: Array<{
  id: CreatorPreset;
  title: string;
  detail: string;
  request: string;
}> = [
  {
    id: 'cleanup',
    title: 'Clean interview',
    detail: 'Natural pauses, filler review, clean master',
    request:
      'Create a clean interview master. Remove only safe silence, flag filler cuts that may change meaning, preserve cadence, and keep source audio.',
  },
  {
    id: 'variants',
    title: 'Golden quote campaign',
    detail: '9:16 short, square social, 16:9 long cut',
    request:
      'Find the strongest source-grounded quote and propose short, square, and long-form versions. Preserve meaning and show every cut before export.',
  },
  {
    id: 'founder',
    title: 'Founder launch story',
    detail: 'Hook, product evidence, call to action',
    request:
      'Create a founder launch story with a clear hook, product evidence, and call to action. Produce landscape and vertical variants without copying brand assets.',
  },
  {
    id: 'reframe',
    title: 'Smart Reframe',
    detail: 'Local subject tracking and reviewable crop paths',
    request:
      'Make vertical, square, and landscape versions. Follow the selected person, keep the full body visible, hold through low-confidence ranges, and show the crop path before approval.',
  },
];

function SegmentedControl<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string }>;
  label: string;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          type="button"
          role="tab"
          aria-selected={value === item.value}
          key={item.value}
          onClick={() => onChange(item.value)}
          className={`min-h-8 flex-1 rounded-md px-3 text-xs font-medium ${value === item.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Timeline({ variant }: { variant?: FounderVariant }) {
  if (!variant) {
    return (
      <div className="grid min-h-80 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">
        Compile a workflow to materialize its timeline.
      </div>
    );
  }
  const { durationFrames, tracks } = variant.rendererPlan;
  return (
    <div
      className="min-h-80 space-y-5 rounded-xl border bg-background/40 p-4"
      data-testid="artifact-timeline"
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono">00:00:00</span>
        <span>{(durationFrames / variant.rendererPlan.frameRate).toFixed(1)} seconds</span>
      </div>
      {tracks.map((track) => (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3" key={track.id}>
          <div>
            <p className="text-xs font-medium capitalize">{track.role}</p>
            <p className="font-mono text-[10px] text-muted-foreground">{track.kind}</p>
          </div>
          <div className="relative h-12 overflow-hidden rounded-md border bg-muted/50">
            {track.clips.map((clip) => {
              const left = (clip.timelineRange.startFrame / Math.max(1, durationFrames)) * 100;
              const width =
                ((clip.timelineRange.endFrameExclusive - clip.timelineRange.startFrame) /
                  Math.max(1, durationFrames)) *
                100;
              return (
                <div
                  key={clip.id}
                  title={clip.id}
                  className="absolute inset-y-1 overflow-hidden rounded border border-brand/40 bg-brand/15 px-2 py-2 font-mono text-[10px] text-foreground"
                  style={{ left: `${left}%`, width: `${Math.max(2, width)}%` }}
                >
                  {clip.kind}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground">
        <CircleDot className="size-3 text-brand" /> Audio route: source program · 0 dB · unmuted
      </div>
    </div>
  );
}

export function CreatorRunInspector(props: {
  source: SourceView | null;
  transcript: string;
  prompt: string;
  preset: CreatorPreset;
  result: CreatorResult | null;
  selected?: FounderVariant;
  approved: Set<string>;
  status: string;
  exportRatio: number;
  version: number;
  caseTitle: string;
  runStage: string;
  caseStatus: string;
  messages: ChatMessage[];
  caseflowReady: boolean;
  proposalDigest?: string;
  proposalStatus?: string;
  executorProposal?: ExecutorProposalView;
  smartReframe: SmartReframeView;
  assetUrls: Record<string, string>;
  onUpload: (file?: File) => void;
  onLoadDemo: () => void;
  onPreset: (preset: CreatorPreset) => void;
  onPrompt: (prompt: string) => void;
  onTranscript: (transcript: string) => void;
  onAgentSend: (message: string, request: CreatorAgentRequest) => Promise<CreatorAgentReply>;
  onSelectVariant: (id: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onRestore: () => void;
  onExport: () => void;
  onDownloadPlan: () => void;
  onDownloadReceipt: () => void;
  onApproveExecutor: () => void;
  onDeclineExecutor: () => void;
  onUseLocalExecutor: () => void;
  onAnalyzeSubjects: () => void;
  onSelectSubject: (id: string) => void;
  onReframePolicy: (policy: FramingPolicy) => void;
  onReframeMotion: (motion: ReframePlan['intent']['motionPreset']) => void;
  onPlanReframe: () => void;
  onManualCrop: (
    aspectRatio: string,
    box: { x: number; y: number; width: number; height: number },
    frame: number,
  ) => void;
}) {
  const [centerView, setCenterView] = useState<CenterView>('canvas');

  const chooseTemplate = (template: (typeof TEMPLATES)[number]) => {
    props.onPreset(template.id);
    props.onPrompt(template.request);
  };

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card/70 px-4 py-3 backdrop-blur lg:px-6">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-brand text-primary-foreground">
              <Film className="size-4" />
            </div>
            <div>
              <p className="font-heading text-sm font-semibold">NodeVideo</p>
              <p className="text-xs text-muted-foreground">Run Inspector · technical proof</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">Project v{props.version}</Badge>
            <Badge variant="secondary">
              <ShieldCheck className="size-3" /> local by default
            </Badge>
            <Badge variant="secondary">
              <Sparkles className="size-3" /> Higgsfield adapter available · execution gated
            </Badge>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1800px] px-4 py-5 lg:px-6">
        <div className="mb-5 flex flex-col justify-between gap-3 xl:flex-row xl:items-end">
          <div>
            <Badge variant="outline">Campaign 01 · launch system</Badge>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              One source. Many reviewable cuts.
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Bring footage, a structural reference, or a special editing request. The agent plans
              and routes the work; local tools and approved specialist models execute it.
            </p>
          </div>
          <div
            className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <History className="size-4" /> {props.status}
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_380px]">
          <aside className="space-y-4" aria-label="Source and template vault">
            <Card data-testid="caseflow-progress">
              <CardHeader>
                <CardTitle>{props.caseTitle}</CardTitle>
                <CardDescription>Guided founder launch · {props.caseStatus}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  ['intake', 'Add source and destinations'],
                  ['planning', 'Review creative direction'],
                  ['review', 'Approve exact rough cut'],
                  ['execution', 'Render and compare outputs'],
                  ['receipt', 'Export and keep proof'],
                ].map(([stage, label], index) => {
                  const stages = ['intake', 'planning', 'review', 'execution', 'receipt'];
                  const current = Math.max(0, stages.indexOf(props.runStage));
                  return (
                    <div className="flex items-center gap-3 text-xs" key={stage}>
                      <span
                        className={`grid size-6 shrink-0 place-items-center rounded-full border ${index <= current ? 'border-brand bg-brand/15 text-brand' : 'text-muted-foreground'}`}
                      >
                        {index < current ? <Check className="size-3" /> : index + 1}
                      </span>
                      <span className={index === current ? 'font-medium' : 'text-muted-foreground'}>
                        {label}
                      </span>
                    </div>
                  );
                })}
                <div className="rounded-lg bg-brand/10 p-3 text-xs" data-testid="current-action">
                  <strong>Current action</strong>
                  <p className="mt-1 text-muted-foreground">
                    {props.runStage === 'intake'
                      ? 'Add a product recording or use the rights-cleared demo.'
                      : props.runStage === 'planning'
                        ? 'Ask NodeAgent for a source-grounded launch direction.'
                        : props.runStage === 'review'
                          ? 'Inspect and approve or reject the exact proposal digest.'
                          : props.runStage === 'execution'
                            ? 'Render the approved variant locally or review a specialist quote.'
                            : 'Download the output and consumer receipt.'}
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Outputs: 16:9 walkthrough · 9:16 short · 1:1 LinkedIn cut
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  <Library className="mr-2 inline size-4" />
                  Source vault
                </CardTitle>
                <CardDescription>
                  Upload stays local until an executor proposal explicitly says otherwise.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <label
                  htmlFor="creator-source"
                  className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm"
                >
                  <Upload className="size-4" /> Drop or choose a video
                  <Input
                    id="creator-source"
                    className="sr-only"
                    type="file"
                    accept="video/mp4,video/webm"
                    onChange={(event) => props.onUpload(event.target.files?.[0])}
                  />
                </label>
                <Button variant="secondary" className="w-full" onClick={props.onLoadDemo}>
                  Use rights-cleared demo
                </Button>
                {props.source ? (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="truncate text-sm font-medium">{props.source.name}</p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {(props.source.durationMs / 1_000).toFixed(1)}s · {props.source.width}×
                      {props.source.height}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No source attached.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Template vault</CardTitle>
                <CardDescription>
                  Copy pacing and structure—not footage, logos, or brand assets.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {TEMPLATES.map((template) => (
                  <button
                    type="button"
                    key={template.id}
                    onClick={() => chooseTemplate(template)}
                    className={`w-full rounded-lg border p-3 text-left ${props.preset === template.id ? 'border-brand bg-brand/10' : 'bg-card hover:bg-muted/50'}`}
                  >
                    <span className="text-sm font-medium">{template.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {template.detail}
                    </span>
                  </button>
                ))}
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Trending or creator-supplied references enter as rights-scoped structural studies.
                </p>
              </CardContent>
            </Card>
          </aside>

          <section className="min-w-0 space-y-4" aria-label="Artifact stage">
            <Card>
              <CardHeader>
                <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                  <div>
                    <CardTitle>
                      <h2>Artifact stage</h2>
                    </CardTitle>
                    <CardDescription>
                      {props.selected
                        ? `${props.selected.title} · ${props.selected.output.aspectRatio}`
                        : 'Attach a source and compile the campaign.'}
                    </CardDescription>
                  </div>
                  <div className="w-full lg:w-80">
                    <SegmentedControl
                      value={centerView}
                      onChange={setCenterView}
                      label="Artifact stage view"
                      items={[
                        { value: 'canvas', label: 'Canvas' },
                        { value: 'timeline', label: 'Timeline' },
                        { value: 'variants', label: 'Variants' },
                      ]}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {centerView === 'canvas' &&
                  (props.source && props.selected ? (
                    <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border bg-black">
                      <Player
                        component={PlanComposition}
                        inputProps={{
                          plan: props.selected.rendererPlan,
                          assetUrls: props.assetUrls,
                        }}
                        durationInFrames={props.selected.rendererPlan.durationFrames}
                        compositionWidth={props.selected.rendererPlan.canvas.width}
                        compositionHeight={props.selected.rendererPlan.canvas.height}
                        fps={props.selected.rendererPlan.frameRate}
                        controls
                        acknowledgeRemotionLicense
                        style={{
                          width: '100%',
                          aspectRatio: `${props.selected.rendererPlan.canvas.width}/${props.selected.rendererPlan.canvas.height}`,
                        }}
                      />
                    </div>
                  ) : (
                    <div className="grid min-h-96 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">
                      Load a source and compile a workflow.
                    </div>
                  ))}
                {centerView === 'timeline' && <Timeline variant={props.selected} />}
                {centerView === 'variants' && (
                  <div className="grid min-h-80 content-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {props.result?.variants.map((variant) => (
                      <button
                        type="button"
                        key={variant.id}
                        onClick={() => props.onSelectVariant(variant.id)}
                        className={`rounded-xl border p-4 text-left ${props.selected?.id === variant.id ? 'border-brand bg-brand/10' : 'bg-card'}`}
                      >
                        <div className="flex items-center justify-between">
                          <strong className="capitalize">{variant.title}</strong>
                          {props.approved.has(variant.id) && (
                            <Check className="size-4 text-brand" />
                          )}
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {variant.output.aspectRatio} · {variant.output.platform ?? 'generic'} ·{' '}
                          {(
                            variant.rendererPlan.durationFrames / variant.rendererPlan.frameRate
                          ).toFixed(1)}
                          s
                        </p>
                      </button>
                    )) ?? <p className="text-sm text-muted-foreground">No variants compiled.</p>}
                  </div>
                )}
              </CardContent>
            </Card>

            {props.result && (
              <Card size="sm">
                <CardContent className="grid gap-2 md:grid-cols-4">
                  {props.result.compiledRecipe.stages.map((stage, index) => (
                    <div
                      className="flex items-center gap-2 rounded-lg border p-3"
                      key={stage.compiledId}
                    >
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand/15 font-mono text-[10px]">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{stage.compiledId}</p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {stage.executorId}
                        </p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {props.preset === 'reframe' && (
              <Card size="sm" data-testid="smart-reframe-proof">
                <CardHeader>
                  <CardTitle>Smart Reframe proof</CardTitle>
                  <CardDescription>
                    Local MediaPipe pose tracking · no raw-frame egress · preview and export share
                    the compiled crop plan.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-xs md:grid-cols-4">
                  <div>
                    <strong>{props.smartReframe.tracks.length}</strong>
                    <span className="block text-muted-foreground">subject tracks</span>
                  </div>
                  <div>
                    <strong>
                      {props.smartReframe.plans.reduce(
                        (sum, plan) => sum + plan.cropKeyframes.length,
                        0,
                      )}
                    </strong>
                    <span className="block text-muted-foreground">crop keyframes</span>
                  </div>
                  <div>
                    <strong>
                      {props.smartReframe.plans.reduce(
                        (sum, plan) => sum + plan.manualOverrides.length,
                        0,
                      )}
                    </strong>
                    <span className="block text-muted-foreground">manual locks</span>
                  </div>
                  <div>
                    <strong>
                      {Object.values(props.smartReframe.critics).every(
                        (critic) => critic.verdict !== 'fail',
                      )
                        ? 'bounded'
                        : 'review'}
                    </strong>
                    <span className="block text-muted-foreground">critic verdict</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>

          <CreatorAgentPanel
            sourceName={props.source?.name}
            selected={props.selected}
            result={props.result}
            approved={props.approved}
            preset={props.preset}
            suggestedPrompt={props.prompt}
            transcript={props.transcript}
            exportRatio={props.exportRatio}
            messages={props.messages}
            caseflowReady={props.caseflowReady}
            runStatus={`${props.caseStatus} · ${props.runStage}`}
            proposalDigest={props.proposalDigest}
            proposalStatus={props.proposalStatus}
            executorProposal={props.executorProposal}
            onPreset={props.onPreset}
            onTranscript={props.onTranscript}
            onSend={props.onAgentSend}
            onApprove={props.onApprove}
            onReject={props.onReject}
            onRestore={props.onRestore}
            onExport={props.onExport}
            onDownloadPlan={props.onDownloadPlan}
            onDownloadReceipt={props.onDownloadReceipt}
            onApproveExecutor={props.onApproveExecutor}
            onDeclineExecutor={props.onDeclineExecutor}
            onUseLocalExecutor={props.onUseLocalExecutor}
          />
        </div>
        <div
          className="sticky bottom-3 z-20 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card/95 px-4 py-3 text-xs shadow-lg backdrop-blur"
          data-testid="caseflow-activity-strip"
        >
          <span>
            Current execution · <strong>{props.runStage}</strong> · canonical version{' '}
            {props.version}
          </span>
          <span className="font-mono text-muted-foreground">
            {props.proposalDigest
              ? `proposal ${props.proposalDigest.slice(0, 18)}…`
              : 'no proposal yet'}
          </span>
        </div>
      </div>
    </main>
  );
}
