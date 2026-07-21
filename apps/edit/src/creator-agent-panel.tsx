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
};
type ChatMessage = {
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
type DetailView = 'chat' | 'proposal' | 'proof';

const INITIAL_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'Tell me what you want to make. I can inspect the source once, propose cuts and variants, route each stage to the cheapest capable executor, and keep every change reviewable.',
  createdAt: 0,
};

const QUICK_ACTIONS = [
  'Remove silences and fillers without changing meaning',
  'Find the golden quote and make three formats',
  'Turn this into a founder launch video',
];

function loadMessages(): ChatMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('nodevideo.creator.chat.v1') ?? '[]');
    return Array.isArray(parsed) && parsed.length ? parsed.slice(-40) : [INITIAL_MESSAGE];
  } catch {
    return [INITIAL_MESSAGE];
  }
}

export function CreatorAgentPanel(props: {
  sourceName?: string;
  selected?: FounderVariant;
  result: CreatorResult | null;
  approved: Set<string>;
  preset: CreatorPreset;
  suggestedPrompt: string;
  transcript: string;
  exportRatio: number;
  onPreset: (preset: CreatorPreset) => void;
  onTranscript: (transcript: string) => void;
  onSend: (message: string, request: CreatorAgentRequest) => Promise<CreatorAgentReply>;
  onApprove: () => void;
  onReject: () => void;
  onRestore: () => void;
  onExport: () => void;
  onDownloadPlan: () => void;
  onDownloadReceipt: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [draft, setDraft] = useState(props.suggestedPrompt);
  const [working, setWorking] = useState(false);
  const [activity, setActivity] = useState<CreatorAgentReply['tools']>([]);
  const [route, setRoute] = useState<CreatorExecutionRoute>('auto');
  const [scope, setScope] = useState<CreatorWriteScope>('selected-variant');
  const [detailView, setDetailView] = useState<DetailView>('chat');
  const feedRef = useRef<HTMLDivElement>(null);
  const pendingApprovals =
    props.selected?.semanticPlan.approvals.filter((item) => item.status === 'required').length ?? 0;
  const isApproved = Boolean(props.selected && props.approved.has(props.selected.id));
  const selectedStatus = props.result?.variantSet.variants.find(
    (variant) => variant.id === props.selected?.id,
  )?.status;
  const isRejected = selectedStatus === 'rejected';

  useEffect(() => {
    localStorage.setItem('nodevideo.creator.chat.v1', JSON.stringify(messages.slice(-40)));
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [messages]);

  useEffect(() => setDraft(props.suggestedPrompt), [props.suggestedPrompt]);

  const send = async (value = draft) => {
    const text = value.trim();
    if (!text || working) return;
    setDetailView('chat');
    setDraft('');
    setWorking(true);
    setActivity([{ name: 'Understanding request', detail: 'Reading source and campaign context' }]);
    setMessages((current) => [
      ...current,
      { id: `user:${Date.now()}`, role: 'user', text, createdAt: Date.now() },
    ]);
    try {
      const reply = await props.onSend(text, { route, scope });
      setActivity(reply.tools);
      setMessages((current) => [
        ...current,
        {
          id: `assistant:${Date.now()}`,
          role: 'assistant',
          text: reply.text,
          createdAt: Date.now(),
          meta: reply.meta,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant:${Date.now()}`,
          role: 'assistant',
          text:
            error instanceof Error
              ? error.message
              : 'The request failed before a proposal was created.',
          createdAt: Date.now(),
        },
      ]);
    } finally {
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
            {messages.map((message) => (
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
                  <Button size="sm" onClick={props.onApprove} disabled={isApproved}>
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
                  disabled={!draft.trim() || working}
                  onClick={() => void send()}
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Paperclip className="size-3" />
              {props.sourceName ? 'Source read context attached' : 'Attach from source vault'}
              {route === 'openrouter-free' && ' · prompt and transcript context leave this device'}
              {route === 'higgsfield' && ' · cost and egress approval required before execution'}
            </div>
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
                disabled={isApproved}
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
