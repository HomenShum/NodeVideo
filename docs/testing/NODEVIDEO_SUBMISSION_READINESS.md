# NodeVideo submission readiness

NodeVideo is an engineering candidate for the NodeKit Caseflow contract. It is not ready for a
Convex component submission or a public parity claim.

## Proven locally and in production

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
- [x] Vercel serves the exact stamped Git revision from
  `https://nodevideo-pi.vercel.app/.well-known/agent-ui.build.json`.
- [x] The production Creator page connects to the production Convex deployment with no browser
  console errors; its CSP explicitly permits the required HTTPS and WebSocket origins.
- [x] A fresh production browser completed the creator workflow, exact executor-gating workflow,
  and two-session stale-proposal workflow.
- [x] The opt-in production OpenRouter lane resolved a zero-cost model, returned a typed structured
  plan, compiled it deterministically, and persisted the proposal.

## Hard blockers before submission

- [ ] Complete one low-cost Higgsfield job only after a fresh immutable quote and explicit spend
  approval, then import, compare, validate, and receipt the returned media.
- [ ] Start from a genuinely empty directory with the NodeKit factory and time a coding agent from
  scaffold through local demo, customization, tests, preview deployment, and proof. Capture every
  milestone and required manual intervention.
- [ ] Repeat the zero-to-proof factory run at least three times or explain why a smaller sample is
  statistically sufficient.
- [ ] Replace the owner-capability locator with an authenticated application wrapper before any
  multi-user or sensitive-media claim.
- [ ] Produce the formal Convex-component submission packet. The current engineering proof includes
  the deployed build stamp and production browser results, but paid-provider and authentication
  boundaries remain intentionally incomplete.

## Current timed evidence

The authoritative machine-readable record is
`.qa/evidence/creator-pipeline/nodekit-consumer-proof.json`. The latest local run executed ten
desktop/mobile journeys in 53.188 seconds wall clock, with four explicitly skipped live-provider
cases. Production separately passed the core creator journey, executor gate, two-session conflict
journey, and live Free Router lane. This measures application behavior, not empty-directory setup
time.

## Claim boundary

Allowed now:

> NodeVideo is a production-deployed NodeKit Caseflow engineering consumer with durable Convex
> state, conflict-safe proposal approval, governed optional execution, a typed zero-cost planning
> route, and browser-verified local export.

Not allowed yet:

- "ready for Convex submission"
- "NodeRoom or NodeSlide runtime parity"
- "zero-to-proof is super easy"
- "Higgsfield integration complete"
- "production certified"
