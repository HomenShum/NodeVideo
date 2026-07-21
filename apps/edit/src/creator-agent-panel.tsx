import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { FounderVariant } from '@/lib/founder-variant-compiler';
import {
  Bot,
  Check,
  ChevronLeft,
  Clock3,
  Download,
  FileJson,
  Film,
  Paperclip,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  User,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CreatorPreset, runCreatorPipeline } from './creator-pipeline';

type CreatorResult = ReturnType<typeof runCreatorPipeline>;
export type CreatorExecutionRoute = 'auto' | 'local' | 'openrouter-free' | 'higgsfield';
export type CreatorWriteScope = 'selected-variant' | 'campaign-variants';
export type CreatorAgentRequest = {
  route: CreatorExecutionRoute;
  scope: CreatorWriteScope;
  externalConsent: boolean;
};
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  meta?: string;
};
export type CreatorAgentReply = {
  text: string;
  tools: Array<{ name: string; detail: string }>;
  meta?: string;
};
export type ExecutorProposalView = {
  id: string;
  provider: string;
  capability: string;
  status: string;
  quoteDigest: string;
  job: string;
  durationSeconds: number;
  mediaLeavingDevice: string[];
  estimatedCredits: number;
  currentBalanceCredits: number;
  outputUse: string;
  canonicalVideoAffected: boolean;
};
type DetailView = 'chat' | 'proposal' | 'proof';

const QUICK_ACTIONS = [
  'Remove silences and fillers without changing meaning',
  'Find the golden quote and make three formats',
  'Turn this into a founder launch video',
];

export function CreatorAgentPanel(props: {
  sourceName?: string;
  selected?: FounderVariant;
  result: CreatorResult | null;
  approved: Set<string>;
  preset: CreatorPreset;
  suggestedPrompt: string;
  transcript: string;
  exportRatio: number;
  messages: ChatMessage[];
  caseflowReady: boolean;
  runStatus?: string;
  proposalDigest?: string;
  proposalStatus?: string;
  executorProposal?: ExecutorProposalView;
  onPreset: (preset: CreatorPreset) => void;
  onTranscript: (transcript: string) => void;
  onSend: (message: string, request: CreatorAgentRequest) => Promise<CreatorAgentReply>;
  onApprove: () => void;
  onReject: () => void;
  onRestore: () => void;
  onExport: () => void;
  onDownloadPlan: () => void;
  onDownloadReceipt: () => void;
  onApproveExecutor: () => void;
  onDeclineExecutor: () => void;
  onUseLocalExecutor: () => void;
}) {
  const [draft, setDraft] = useState(props.suggestedPrompt);
  const [working, setWorking] = useState(false);
  const [activity, setActivity] = useState<CreatorAgentReply['tools']>([]);
  const [route, setRoute] = useState<CreatorExecutionRoute>('auto');
  const [scope, setScope] = useState<CreatorWriteScope>('selected-variant');
  const [externalConsent, setExternalConsent] = useState(false);
  const [detailView, setDetailView] = useState<DetailView>('chat');
  const feedRef = useRef<HTMLDivElement>(null);
  const pendingApprovals =
    props.selected?.semanticPlan.approvals.filter((item) => item.status === 'required').length ?? 0;
  const isApproved = Boolean(props.selected && props.approved.has(props.selected.id));
  const selectedStatus = props.result?.variantSet.variants.find(
    (variant) => variant.id === props.selected?.id,
  )?.status;
  const isRejected = selectedStatus === 'rejected';
  const proposalReady = props.proposalStatus === 'pending';

  useEffect(() => {
    if (props.messages.length === 0) return;
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [props.messages]);

  useEffect(() => setDraft(props.suggestedPrompt), [props.suggestedPrompt]);

  const send = async (value = draft) => {
    const text = value.trim();
    if (!text || working) return;
    if (route === 'openrouter-free' && !externalConsent) {
      setActivity([
        {
          name: 'Consent required',
          detail:
            'No external request was sent. Confirm the disclosed prompt and transcript egress first.',
        },
      ]);
      return;
    }
    setDetailView('chat');
    setDraft('');
    setWorking(true);
    setActivity([{ name: 'Understanding request', detail: 'Reading source and campaign context' }]);
    try {
      const reply = await props.onSend(text, { route, scope, externalConsent });
      setActivity(reply.tools);
    } catch (error) {
      setActivity([
        {
          name: 'Run failed',
          detail:
            error instanceof Error
              ? error.message
              : 'The request failed before a proposal was created.',
        },
      ]);
    } finally {
      if (route === 'openrouter-free') setExternalConsent(false);
      setWorking(false);
    }
  };

  return (
    <aside
      className="flex min-h-[680px] flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)]"
      aria-label="NodeVideo agent"
    >
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-brand/15 text-brand">
            <Bot className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">NodeAgent</h2>
            <p className="text-[11px] text-muted-foreground">Private media collaborator</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={detailView === 'proposal' ? 'secondary' : 'ghost'}
            onClick={() => setDetailView('proposal')}
            disabled={!props.selected}
          >
            Proposal
          </Button>
          <Button
            size="sm"
            variant={detailView === 'proof' ? 'secondary' : 'ghost'}
            onClick={() => setDetailView('proof')}
            disabled={!props.result}
          >
            Proof
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5 border-b px-4 py-2 text-[11px]">
        {props.sourceName ? (
          <Badge variant="secondary">
            <Paperclip className="size-3" /> {props.sourceName}
          </Badge>
        ) : (
          <Badge variant="outline">No source attached</Badge>
        )}
        {props.selected && (
          <Badge variant="outline">
            <Film className="size-3" /> {props.selected.title}
          </Badge>
        )}
        <Badge variant="outline">
          <ShieldCheck className="size-3" /> local context
        </Badge>
      </div>

      {detailView === 'chat' && (
        <>
          <div
            ref={feedRef}
            className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5"
            aria-live="polite"
          >
            {props.messages.map((message) => (
              <article
                className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                key={message.id}
                data-testid="agent-message"
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full ${message.role === 'assistant' ? 'bg-brand/15 text-brand' : 'bg-muted'}`}
                >
                  {message.role === 'assistant' ? (
                    <Sparkles className="size-3.5" />
                  ) : (
                    <User className="size-3.5" />
                  )}
                </span>
                <div
                  className={`max-w-[88%] rounded-xl px-3 py-2.5 text-sm leading-relaxed ${message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/60'}`}
                >
                  {message.text}
                  {message.meta && (
                    <p className="mt-2 border-t border-current/10 pt-2 font-mono text-[10px] opacity-65">
                      {message.meta}
                    </p>
                  )}
                </div>
              </article>
            ))}

            {working && (
              <div className="flex gap-3">
                <span className="grid size-7 place-items-center rounded-full bg-brand/15 text-brand">
                  <Sparkles className="size-3.5" />
                </span>
                <div className="rounded-xl border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                  <Clock3 className="mr-2 inline size-3 animate-pulse" />
                  Inspecting context and compiling a proposal…
                </div>
              </div>
            )}

            {activity.length > 0 && !working && (
              <div
                className="ml-10 rounded-lg border bg-background/40 p-3"
                data-testid="agent-tool-activity"
              >
                <div className="mb-2 flex items-center gap-2 text-xs font-medium">
                  <Wrench className="size-3" /> Tool activity
                </div>
                {activity.map((tool) => (
                  <div
                    className="flex items-start gap-2 border-t py-2 text-[11px] first:border-0"
                    key={`${tool.name}:${tool.detail}`}
                  >
                    <Check className="mt-0.5 size-3 shrink-0 text-brand" />
                    <div>
                      <p className="font-medium">{tool.name}</p>
                      <p className="text-muted-foreground">{tool.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {props.result && (
              <div
                className="ml-10 rounded-xl border border-brand/30 bg-brand/5 p-3"
                data-testid="agent-proposal-card"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Edit proposal ready</p>
                    <p className="text-xs text-muted-foreground">
                      {props.result.variants.length} variants ·{' '}
                      {props.result.compiledRecipe.stages.length} routed stages
                    </p>
                  </div>
                  <Badge variant={isApproved ? 'secondary' : 'outline'}>
                    {isApproved ? 'approved' : isRejected ? 'revision requested' : 'review'}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Button
                    size="sm"
                    onClick={props.onApprove}
                    disabled={isApproved || isRejected || !proposalReady}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={props.onReject}
                    disabled={isRejected}
                  >
                    Reject
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setDetailView('proposal')}>
                    Review
                  </Button>
                </div>
                {props.proposalDigest && (
                  <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
                    digest {props.proposalDigest}
                  </p>
                )}
              </div>
            )}
            {props.executorProposal && (
              <div
                className="ml-10 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3"
                data-testid="executor-proposal-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Specialist executor proposal</p>
                    <p className="text-xs text-muted-foreground">
                      {props.executorProposal.provider} · {props.executorProposal.job}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {props.executorProposal.status.replaceAll('_', ' ')}
                  </Badge>
                </div>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd>{props.executorProposal.durationSeconds}s</dd>
                  <dt className="text-muted-foreground">Media egress</dt>
                  <dd>{props.executorProposal.mediaLeavingDevice.join(', ') || 'none'}</dd>
                  <dt className="text-muted-foreground">Exact quote</dt>
                  <dd>{props.executorProposal.estimatedCredits} credits</dd>
                  <dt className="text-muted-foreground">Balance</dt>
                  <dd>{props.executorProposal.currentBalanceCredits} credits</dd>
                  <dt className="text-muted-foreground">Output use</dt>
                  <dd>{props.executorProposal.outputUse}</dd>
                  <dt className="text-muted-foreground">Canonical affected</dt>
                  <dd>{props.executorProposal.canonicalVideoAffected ? 'yes' : 'no'}</dd>
                </dl>
                <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
                  quote {props.executorProposal.quoteDigest}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={props.onDeclineExecutor}
                    disabled={props.executorProposal.status === 'cancelled'}
                  >
                    Decline
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={props.onUseLocalExecutor}
                    disabled={props.executorProposal.status === 'cancelled'}
                  >
                    Use local alternative
                  </Button>
                  <Button
                    size="sm"
                    onClick={props.onApproveExecutor}
                    disabled={
                      props.executorProposal.status === 'approved' ||
                      props.executorProposal.status === 'submitted'
                    }
                  >
                    Approve exact {props.executorProposal.estimatedCredits} credits
                  </Button>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Approval permits only this quote. It does not submit a paid job. Any quote change
                  invalidates it.
                </p>
              </div>
            )}
          </div>

          <div className="border-t bg-card p-3">
            {!props.sourceName && (
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    type="button"
                    onClick={() => setDraft(action)}
                    className="shrink-0 rounded-full border px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                    key={action}
                  >
                    {action}
                  </button>
                ))}
              </div>
            )}
            <div className="rounded-xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/40">
              <Textarea
                aria-label="Message NodeAgent"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="Ask NodeAgent to edit this video…"
                rows={3}
                className="min-h-16 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              <div className="flex items-center justify-between gap-2 pt-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Select
                    value={scope}
                    onValueChange={(value) => setScope(value as CreatorWriteScope)}
                  >
                    <SelectTrigger
                      className="h-7 w-[132px] text-[10px]"
                      aria-label="Agent write scope"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="selected-variant">Selected variant</SelectItem>
                      <SelectItem value="campaign-variants">All variants</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={route}
                    onValueChange={(value) => setRoute(value as CreatorExecutionRoute)}
                  >
                    <SelectTrigger
                      className="h-7 w-[126px] text-[10px]"
                      aria-label="Executor route"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto · local first</SelectItem>
                      <SelectItem value="local">Local only</SelectItem>
                      <SelectItem value="openrouter-free">OpenRouter Free · external</SelectItem>
                      <SelectItem value="higgsfield">Higgsfield · gated</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="icon-sm"
                  aria-label="Send message"
                  disabled={!draft.trim() || working || !props.caseflowReady}
                  onClick={() => void send()}
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Paperclip className="size-3" />
              {props.sourceName ? 'Source read context attached' : 'Attach from source vault'}
              {!props.caseflowReady && ' · connecting durable case'}
              {route === 'openrouter-free' && ' · prompt and transcript context leave this device'}
              {route === 'higgsfield' && ' · cost and egress approval required before execution'}
            </div>
            {route === 'openrouter-free' && (
              <label className="mt-2 flex items-start gap-2 rounded-lg border p-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={externalConsent}
                  onChange={(event) => setExternalConsent(event.target.checked)}
                  className="mt-0.5 size-4"
                  aria-label="Consent to send prompt and transcript context to OpenRouter"
                />
                <span>
                  Send this prompt, bounded transcript context, and source metadata to OpenRouter.
                  Raw media is not uploaded. Consent resets after this action.
                </span>
              </label>
            )}
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer py-1">Workflow and transcript context</summary>
              <div className="mt-2 space-y-3 rounded-lg border p-3">
                <Field>
                  <FieldLabel htmlFor="creator-workflow">Workflow</FieldLabel>
                  <Select
                    value={props.preset}
                    onValueChange={(value) => props.onPreset(value as CreatorPreset)}
                  >
                    <SelectTrigger id="creator-workflow" aria-label="Workflow">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cleanup">Clean interview</SelectItem>
                      <SelectItem value="variants">Golden quote variants</SelectItem>
                      <SelectItem value="founder">Founder launch template</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="creator-transcript">Transcript</FieldLabel>
                  <Textarea
                    id="creator-transcript"
                    value={props.transcript}
                    onChange={(event) => props.onTranscript(event.target.value)}
                    rows={5}
                  />
                </Field>
              </div>
            </details>
          </div>
        </>
      )}

      {detailView === 'proposal' && (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <Button variant="ghost" size="sm" className="mb-4" onClick={() => setDetailView('chat')}>
            <ChevronLeft className="size-4" /> Back to chat
          </Button>
          {props.selected ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold capitalize">{props.selected.title}</h3>
                <p className="text-sm text-muted-foreground">
                  Exact proposed operations against the current source version.
                </p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Source lineage</span>
                <Badge>
                  <ShieldCheck className="size-3" /> linked
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Meaning-sensitive removals</span>
                <Badge variant={pendingApprovals ? 'outline' : 'secondary'}>
                  {pendingApprovals} pending
                </Badge>
              </div>
              <ul className="space-y-2 rounded-lg border p-3 text-sm text-muted-foreground">
                {props.selected.rationale.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
              <Button
                variant="secondary"
                className="w-full"
                onClick={props.onApprove}
                disabled={isApproved || isRejected || !proposalReady}
              >
                Approve exact variant
              </Button>
              {isApproved && (
                <Button variant="outline" className="w-full" onClick={props.onRestore}>
                  <RotateCcw className="size-4" /> Restore draft
                </Button>
              )}
              <Button
                className="w-full"
                disabled={!isApproved || props.exportRatio > 0}
                onClick={props.onExport}
              >
                <Download className="size-4" /> Export local MP4
              </Button>
              {props.exportRatio > 0 && <Progress value={props.exportRatio * 100} />}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ask NodeAgent to compile a proposal first.
            </p>
          )}
        </div>
      )}

      {detailView === 'proof' && (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <Button variant="ghost" size="sm" className="mb-4" onClick={() => setDetailView('chat')}>
            <ChevronLeft className="size-4" /> Back to chat
          </Button>
          <h3 className="text-lg font-semibold">Run proof</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Source lineage, routed executors, approval state, and explicit limitations.
          </p>
          {props.runStatus && (
            <div className="mt-4 rounded-lg border p-3 text-xs">
              <span className="text-muted-foreground">Durable run</span>{' '}
              <strong>{props.runStatus}</strong>
            </div>
          )}
          <div className="my-4 space-y-2">
            {props.result?.compiledRecipe.stages.map((stage) => (
              <div className="rounded-lg border p-3" key={stage.compiledId}>
                <p className="text-xs font-medium">{stage.compiledId}</p>
                <p className="font-mono text-[10px] text-muted-foreground">{stage.executorId}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={props.onDownloadPlan}
              disabled={!props.selected}
            >
              <FileJson className="size-4" /> Download EditPlan v2
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={props.onDownloadReceipt}
              disabled={!props.result}
            >
              <FileJson className="size-4" /> Download run receipt
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
