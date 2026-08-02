# Proposal summary verification plan

Named proof: a mobile creator cannot approve a proposal from its compressed summary; approval is available only after the exact operations are visible.

## Scenarios

- Pending proposal: summary offers `Review changes` and `Reject`, but no `Accept` action.
- Exact review: opening the proposal exposes the exact operations before `Approve exact variant` is available.
- Rejected proposal: summary becomes `View requested revision` and removes the redundant reject action.
- Approved proposal: summary becomes `View applied changes` and retains access to the immutable review record.
- Degraded provider: a completed fallback trace still produces a reviewable proposal without mutating the project version.

## Protected behavior

- Existing proposal lineage, timestamps, meaning-sensitive change count, validation result, and exact operation list remain owned by the detailed review.
- Rejection remains available without applying mutations.
- Approval still advances the project version only through the existing exact-variant handler.
