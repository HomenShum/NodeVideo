# Fable judge verdict

Verdict: APPROVED

Named proof: a mobile creator cannot approve a proposal from its compressed summary; approval is available only after the exact operations are visible.

Raw evidence checked:

- Diff from `39d7726` through `36dac30`.
- Production bundle signals: `Review changes`, `View applied changes`, `View requested revision`, and `Approve exact variant`.
- Vercel deployment list: newest production deployment Ready and under one minute old at verification.
- Production Playwright: 3 focused scenarios passed.
- Isolated Playwright: 9 runnable mobile scenarios passed, 4 existing capability guards skipped.
- Rendered production pixels: empty, pending summary, and exact-review states.

Adversarial checks:

- Direct summary `Accept` locator count is zero.
- Rejected summary removes repeated rejection and offers `View requested revision`.
- Accepted summary offers `View applied changes`.
- Project version advances only after `Approve exact variant` on the detailed view.
- Degraded free-provider state remains honest and does not claim deep-agent success.

Residual risk: the production build stamp reports `commit unknown` because Vercel's uploaded source omits `.git`. Exact SHA provenance is therefore established by the detached deployment worktree and pushed history, while live-content identity is independently established from the aliased production bundle and browser behavior.
