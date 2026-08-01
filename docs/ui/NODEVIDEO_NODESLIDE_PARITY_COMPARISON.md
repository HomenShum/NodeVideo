# NodeVideo, NodeSlide, and Parity Studio workspace comparison

This comparison uses the current product code in all three repositories. It is a product-contract comparison, not a styling exercise.

| Capability | NodeVideo | NodeSlide | Parity Studio | NodeVideo decision |
| --- | --- | --- | --- | --- |
| Primary artifact | Video canvas, timeline, and variants | Editable deck and slide canvas | Generated application and validation workspace | Keep video artifact dominant |
| Agent placement | Persistent right rail | Persistent AI inspector | Persistent/collapsible agent rail | Keep the right rail; allow collapse later |
| Conversation model | Browser-persistent creator thread | Durable run turns with streamed messages | Convex-backed runs and recent history | Adopt run-shaped turns; durable backend remains a platform gap |
| Proposal review | Inline accept, reject, and detailed review | Inline patch preview, accept, and reject | Candidate output and run review | Match inline decisions and preserve detailed media review |
| Scope | Selected variant or all campaign variants | Deck, slide, or selected elements | Run/project context | Make read/write scope explicit before every request |
| Model/executor route | Auto/local/OpenRouter Free/Higgsfield proposal route | Provider, model, effort, and research controls | BYOK, model route, and session controls | Use free models for planning, deterministic media tools for execution, and cost/egress approval for cloud media |
| Trace and proof | Compiled executor stages and downloadable receipts | Trace per run, sources, citations, and patch status | Pipeline telemetry, cost, history, and run status | Add durable run trace and history next |
| Domain strength | Media indexing, story graph, templates, rendering, variants | Slide structure, element-scoped editing, citations | General agent operations and reusable shell | Do not flatten NodeVideo into a generic chat app |

## What NodeVideo now adopts

- A Cursor-like private agent rail that remains usable beside the artifact.
- A user turn followed by visible tool activity, assistant result, and an inline proposal card.
- Accept, reject, and inspect actions directly in the conversation.
- Explicit write scope: selected variant or the campaign variant set.
- Explicit executor intent: local-first, local-only, or Higgsfield behind approval.
- An opt-in `openrouter/free` planning route that records the resolved model, tokens, latency, and zero cost before deterministic compilation.
- Run metadata that distinguishes deterministic local completion from proposal-only cloud routing.

## What is intentionally not faked

- Creator chat is currently persisted in the browser, not as durable Convex runs.
- Assistant prose is not token-streamed yet.
- Higgsfield selection does not upload media or spend credits. It prepares a gated proposal only.
- OpenRouter Free sends only the bounded prompt, transcript context, source metadata, and selected scope. The API key remains server-side; failures fall back visibly to the deterministic planner.
- The current proof view is a compiled-stage receipt, not yet NodeSlide-style per-turn trace storage.
- Cross-device history, cancel/resume, citations, memory, attachments from the composer, and durable run replay remain backend work.

## Target convergence

NodeVideo should share the same agent-workspace constitution as NodeSlide and Parity Studio while retaining a different artifact contract:

```text
private conversation
→ explicit artifact scope
→ typed media tools
→ executor and cost proposal
→ reviewable edit variants
→ accept, reject, or revise
→ render and reopen
→ proof receipt
```

The shared shell can eventually be extracted after NodeVideo and NodeSlide both prove the contract. Media indexing, timelines, template grammar, rendering, and executor routing remain NodeVideo-owned domain capabilities.
