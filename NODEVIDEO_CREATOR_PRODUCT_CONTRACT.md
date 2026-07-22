# NodeVideo Creator Product Contract

## Product job

NodeVideo turns source media, creative intent, and references into reviewable video variants. The agent coordinates the work; deterministic tools and specialized executors perform it; the creator remains authoritative over consequential edits, media egress, paid execution, and the canonical export.

The normal journey is:

```text
Describe the outcome → add media and references → review a creative direction
→ inspect video, timeline, and variants → review exact changes → approve
→ execute locally or through an approved provider → export and retain proof
```

## Two product modes

### Guided creation

The first arrival contains one outcome composer, source/reference inputs, output targets, and one Start action. It must explain the product in under ten seconds. It must not expose an execution graph, provider configuration, receipt controls, raw executor identifiers, or every later workflow stage.

### Creator workspace

After creation begins, the product becomes an artifact workspace:

- Desktop: project/progress rail (220–260px), dominant video canvas and timeline, persistent NodeAgent/review rail (360–420px), stage header, and compact run-status strip.
- Mobile: explicit Canvas, Agent, Review, and Sources modes. Only one major surface is visible at a time; the current action and sticky action/composer remain reachable above the fold.

## Core hierarchy

1. Primary: current video artifact, selected variant, and timeline.
2. Adjacent: agent conversation, tool activity, proposals, and decisions.
3. Supporting: sources, project stages, versions, and render state.
4. Secondary disclosure: raw traces, hashes, executor IDs, full receipts, model detail, provider setup, worker status, and BYOK routing.

The primary artifact must occupy at least 55% of the desktop working area after planning. The selected variant and canonical version must always be identifiable.

## Shared NodeKit concepts

`CaseHeader`, `StageProgress`, `CurrentAction`, `ArtifactWorkspaceShell`, `AgentReviewRail`, `AgentThread`, `ToolActivity`, `ProposalReview`, `EvidenceRail`, `ExceptionState`, `ReceiptInspector`, `VersionHistory`, `RunStatusBar`, `EgressApproval`, and `CostApproval`.

## NodeVideo-specific concepts

`VideoCanvas`, `SourceVault`, `Timeline`, `ClipInspector`, `VariantSwitcher`, `VariantCompare`, `EditPlanInspector`, `RenderQueue`, `MediaExecutorProposal`, and `VideoExport`.

## Durable Caseflow mapping

| Product concept | Durable object |
| --- | --- |
| Project/campaign | Case |
| Creative objective | Case objective |
| Agent conversation | Thread + messages |
| Editing attempt | Run |
| Tool activity | Run events |
| Proposed edit | Version-pinned proposal |
| Approval/rejection | Decision |
| Accepted video | Canonical artifact version |
| Provider execution | Exact executor proposal + approval |
| Proof/export | Receipt + artifact reference |

The agent rail carries the case, run, selected artifact, selected variant, durable thread, inline tools, proposals, approvals, and execution state. Selecting a clip or variant updates agent context. Accepted proposals apply exactly once; stale approvals fail; a second session observes updates reactively.

## Proposal contract

Every edit proposal must show:

- selected variant scope;
- base/canonical version;
- exact timeline operations and timestamps;
- source lineage;
- meaning-sensitive changes;
- validation state;
- before/after comparison;
- primary approve/reject actions.

Export remains unavailable until the proposal is approved and applied.

## Provider and payment contract

Provider execution is optional. The creator sees provider detail only when it changes a decision. A paid or egressing job requires a fresh exact proposal containing provider, job, inputs, egress disclosure, quoted cost, balance, quote expiry/price invalidation, and local/decline alternatives. Approval authorizes only that immutable proposal.

## Run Inspector

`/creator/runs/:runId/proof` is the technical Run Inspector. It owns compiled graphs, raw executor IDs, hashes, model/tool versions, detailed lineage, full receipts, and diagnostic state. This information must not dominate `/creator`.

## Acceptance invariants

- First arrival has one clear job and primary action, without backstage machinery.
- Active desktop workspace is artifact-dominant and keeps the agent rail visible.
- Mobile uses surface modes, never a page-length stack of desktop columns.
- Tool actions and proposals remain associated with the conversation.
- Conversations and proposals survive reload.
- Canonicalization is exactly once, stale approval is rejected, and a second browser is reactive.
- Export reopens and matches the accepted artifact.
- The application uses the phrase **agent-workspace composition**, not “platform parity.”

