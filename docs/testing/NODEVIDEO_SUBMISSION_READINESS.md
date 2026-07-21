# NodeVideo submission readiness

NodeVideo is an engineering candidate for the NodeKit Caseflow contract. It is not ready for a
Convex component submission or a public parity claim.

## Proven locally

- [x] NodeKit Caseflow dependency is pinned to an exact Git revision.
- [x] Case, run, thread, messages, artifact versions, proposals, approvals, exceptions, executor
  jobs, receipts, and timeline events persist in Convex.
- [x] Proposal approval is digest-bound, exactly once, and rejects stale base versions.
- [x] Two browser contexts observe the same canonical version.
- [x] Reload preserves the durable thread and case locator.
- [x] OpenRouter output must pass a typed operation allowlist before deterministic compilation.
- [x] OpenRouter consent is explicit and resets after one action; raw media is excluded.
- [x] Higgsfield quote approval is exact, does not submit a job, and is invalidated by a changed
  quote.
- [x] Local H.264 export downloads and reopens successfully.
- [x] Desktop and mobile browser journeys, Axe checks, and horizontal-overflow checks pass.
- [x] The local proof receipt records exact wall-clock duration and screenshot hashes.

## Hard blockers before submission

- [ ] Commit and deploy the exact clean revision to an isolated Vercel preview and matching Convex
  preview/development backend.
- [ ] Run the same fresh-user suite against that URL and bind deployment identity to the receipt.
- [ ] Run the opt-in live OpenRouter lane and record the resolved provider/model, tokens, latency,
  cost, input scope, and proposal digest from the deployed interface.
- [ ] Complete one low-cost Higgsfield job only after a fresh immutable quote and explicit spend
  approval, then import, compare, validate, and receipt the returned media.
- [ ] Start from a genuinely empty directory with the NodeKit factory and time a coding agent from
  scaffold through local demo, customization, tests, preview deployment, and proof. Capture every
  milestone and required manual intervention.
- [ ] Repeat the zero-to-proof factory run at least three times or explain why a smaller sample is
  statistically sufficient.
- [ ] Replace the owner-capability locator with an authenticated application wrapper before any
  multi-user or sensitive-media claim.
- [ ] Produce a final submission packet containing only revision-bound evidence. Local screenshots
  or self-authored receipt flags cannot substitute for the deployed run.

## Current timed evidence

The authoritative machine-readable record is
`.qa/evidence/creator-pipeline/nodekit-consumer-proof.json`. The latest local run executed ten
desktop/mobile journeys in 53.188 seconds wall clock, with four explicitly skipped live-provider
cases. This measures the browser regression suite, not empty-directory setup time.

## Claim boundary

Allowed now:

> NodeVideo is a locally proven NodeKit Caseflow engineering consumer with durable Convex state,
> conflict-safe proposal approval, governed optional execution, and browser-verified local export.

Not allowed yet:

- "ready for Convex submission"
- "NodeRoom or NodeSlide runtime parity"
- "zero-to-proof is super easy"
- "Higgsfield integration complete"
- "production certified"
