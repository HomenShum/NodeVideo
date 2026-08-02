# UI change boundary

Route: `https://nodevideo-pi.vercel.app/creator`
Viewport: Android Chrome, 412x783 CSS pixels, DPR 2.625
Theme: dark
Session: returning anonymous creator with a durable local proposal
Trigger: Chat → populated proposal card
Fixture/input: rights-cleared demo, deterministic two-variant founder proposal

## CHANGE A · Proposal summary actions

Current: the compact summary offers Accept, Reject, and Review at equal weight. Accept can bypass the exact-operation review when a proposal is pending; the separate Review route already owns exact scope, operations, lineage, validation, and approval.

Expected: one primary `Review changes` route; safe rejection remains secondary only while pending. Accepted and rejected cards expose a single state-aware view action. Approval remains exclusively inside the detailed review surface.

| State | Expected visible result |
| --- | --- |
| Empty | No fabricated proposal card. Existing chat empty state remains unchanged. |
| Loading | Existing working/tool activity remains unchanged; no optimistic proposal actions. |
| Error | Existing degraded/failure disclosure and retry remain unchanged. |
| Pending | `Review changes` primary, `Reject` secondary, no direct approval shortcut. |
| Accepted | `View applied changes`; no reject or duplicate approval action. |
| Rejected | `View requested revision`; no repeated reject action. |
| Overflow | Long state/action copy wraps without horizontal page overflow. |
| Responsive | Mobile uses a two-action row only when pending; desktop keeps the same semantics. |

## Protected and out of scope

Protected: proposal status, exact-operation detail view, source lineage, meaning-sensitive removal count, operations/timestamps, validation notes, approve/reject semantics, restore, export gating, proposal digest, durable status, Chat history, composer, Files recovery, Canvas, and external-executor consent.

Out of scope: proposal-detail layout, executor proposal cards, tool activity, message copy, composer options, Canvas, Files, and desktop workspace topology.

Unchanged assertion: same proposal, status, digest, selected variant, durable case/version, detailed operations, approval mutation, rejection mutation, restore behavior, and export availability.

## Function ledger

| id | selector/component | user promise | capability guard | backing field/action | artifact | disposition | preserve/reverify assertion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | summary `Accept` | approve canonical proposal | `PRESERVE_CAPABILITY` | `onApprove` | `before.png` | MERGE into detailed Review | approval remains reachable exactly once after exact operations are visible |
| C2 | summary `Review` | inspect exact proposal | `PRESERVE_CAPABILITY` | `setDetailView('proposal')` | `before.png` | PRESERVE and promote | state-aware primary action opens detailed review |
| C3 | summary `Reject` | request revision safely | `PRESERVE_CAPABILITY` | `onReject` | `before.png` | PRESERVE while pending | rejection remains direct and disappears after terminal decision |
| C4 | `Proposal ID` | inspect durable digest | `PRESERVE_CAPABILITY` | `proposalDigest` | `before.png` | PRESERVE/DEFER | disclosure remains keyboard reachable |
