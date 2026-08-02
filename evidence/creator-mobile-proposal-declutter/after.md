# Proposal summary declutter — after proof

## Decision

The compressed proposal card is now navigation plus rejection, not an approval surface. A pending proposal shows `Review changes` and `Reject`; exact approval remains inside the detailed proposal record after operations, source lineage, meaning-sensitive removals, and validation context are visible.

## Root cause closure

The summary card duplicated `onApprove` even though it did not display the exact operations that approval commits. That created a shortcut around the product's propose-before-mutate trust contract. The fix removes that duplicate handler from the summary rather than hiding metadata or weakening the detailed review.

## Observed proof

- `after-empty.png`: production mobile intake/empty state remains usable.
- `after.png`: production pending summary contains `Review changes` and `Reject`, with no `Accept` action.
- `review-after.png`: production detail still exposes the exact operations and `Approve exact variant`.
- Production browser gate: 3/3 focused proposal/provider scenarios passed against `https://nodevideo-pi.vercel.app`.
- Isolated exact-commit gate: 9/9 runnable mobile creator scenarios passed; 4 capability-specific scenarios retained their existing skips.
- Clean build, UI policy, UI budget, formatter, and diff whitespace gates passed.

## Failure deep dive

The first local suite failed before React mounted because the clean proof worktree lacked Vercel's public `VITE_CONVEX_URL`; the browser threw the required-config error on every scenario. The earlier dirty-worktree run also collided with an unrelated Stitch Studio process on Playwright's fixed port. Neither was a product defect. Verification was resolved by building the exact commit with the production-injected public Convex URL and serving it on isolated port 4320, without stopping the unrelated process.

One focused assertion then failed after approval because the test remained on the detailed immutable record while looking for the summary badge. The behavior was correct; the scenario was corrected to return to chat and assert both `approved` and `View applied changes`.

## Twin audit

The executor proposal retains its direct `Approve exact … credits` action because that card itself exposes the immutable provider, media egress, quote, balance, output use, and canonical-impact scope. The rough-cut approval in the run inspector already lives on the detailed review surface. No unsafe sibling shortcut remains.
