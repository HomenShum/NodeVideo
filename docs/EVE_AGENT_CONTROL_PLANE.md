# NodeVideo Eve control plane

## Decision

Eve is the durable conversational control plane. It does not replace NodeVideo's
capability packs, Convex job/proposal/artifact ledger, or fixed media workers.
The Vite application and Eve agent deploy as separate Vercel projects from the
same repository.

## Trust boundary

```text
Vite client -> authenticated Eve service -> authenticated control API -> Convex + media worker
                                              |
                                              +-> isolated evaluator after freeze
```

Generation admits only role-bound choreography reference, chosen song excerpt,
creator takes, optional protected lyric timing, objective, IDs, and hashes. The
generation schema contains no target field. The evaluator is physically scoped
to `proof_critic`, uses a different endpoint and credential, and requires a
verified freeze ID and digest.

The model cannot call shell, file, or arbitrary network tools. Runtime adapters
accept only typed IDs and fixed operations. Control endpoints require HTTPS
outside localhost, bearer credentials from server environment variables, bounded
JSON responses, and correlation checks.

## Existing primitives reused

- `packs/song-conditioned-auto-edit`: canonical stages and semantic validators.
- `src/lib/workflowExecutionPort.ts`: bounded, idempotent sidecar envelope pattern.
- `src/lib/nodeVideoWorkflowCandidate.ts`: application-owned admission and CAS review.
- `convex/jobs.ts`: durable job/lease/event authority.
- `convex/proposals.ts`: digest-bound human review authority.
- `convex/artifacts.ts`: artifact ledger.
- `src/lib/music-handoff.ts`: platform music placement instructions.
- Existing analyzers, renderers, validators, and proof scripts remain worker implementations.

## Deployment sequence

1. Deploy `apps/eve-agent` as a separate Vercel project using Node 24.
2. Configure generation and evaluation control URLs/tokens independently.
3. Replace `placeholderAuth()` with the production NodeVideo browser authenticator.
4. Add the stable Eve origin to the Vite CSP and exact Eve CORS policy.
5. Add `useEveAgent({ host, auth })` to the existing primitive-based workspace UI.
6. Run strict live evals against the protected preview before promoting it.

Do not run `vercel link` from the repository root for the Eve project. Large MOV
files upload directly to authorized object storage; they never travel as chat
attachments or model-visible signed URLs.

## Release gates

- Every agent scope passes `scripts/verify-isolation.mjs`.
- Eve typecheck, info, and build pass on Node 24.
- Generation dispatch and held-out evaluation park for explicit approval.
- No target data enters generation prompts, schemas, tools, traces, or credentials.
- Freeze precedes evaluator access.
- Major cut error is measured in signed frames and gated at two frames.
- Public artifacts contain no commercial soundtrack, raw media, protected lyrics,
  paths, locators, credentials, or evaluator lineage.
