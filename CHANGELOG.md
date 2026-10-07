# Changelog

## 2026-10-07 — Creator planning model routing

- Updated the generated free-model selection from the historical Gemma route to
  `nvidia/nemotron-3-super-120b-a12b:free` through [PR #45](https://github.com/HomenShum/NodeVideo/pull/45)
  at `9a1116bc6cb6232624a4aa714cfcd8975ddb6336`.
- The existing scheduled benchmark [run 37583063744](https://github.com/HomenShum/NodeVideo/actions/runs/37583063744)
  evaluated four candidates. The selected model passed all eight attempts across
  four scenarios and two repetitions, without repair; p95 latency was 10,023 ms.
  Retained artifact `11465881448` has SHA-256
  `133e737d58f716990cf3fa95e2d1dccbd75a3f29aac009a23b83cf91f93de17e`.
- Quality and conformance promotion checks passed on `68b1e680c1e9a256702c90e0346693772b91e95a`.
  This records scenario routing qualification. Historical August and current October
  scores are not a matched architecture comparison, and no fresh production or visual
  certification is asserted. The existing free-router fallback and runtime policy remain.

## Unreleased — NodeKit Caseflow consumer

### Components

- Sent the coach's YouTube reference embed with an origin-only referrer, so the player no longer
  answers "Error 153" under the site-wide no-referrer policy.
- Reframed the creator experience around one founder-launch journey with a case rail, durable video
  artifact stage, NodeAgent right rail, and bottom activity strip.
- Added inline proposal review plus governed specialist-executor cards.

### Server

- Added a schema-validated OpenRouter Free planning endpoint with deterministic fallback.
- Added exact-digest proposal, approval, receipt, and executor mutations.

### Database

- Added Convex cases, runs, threads, messages, artifact versions, approvals, exceptions, executor
  jobs, receipts, and timeline events.
- Added idempotent campaign creation, exactly-once approval, and stale-write rejection.

### Integration

- Added the shared NodeKit Caseflow contract test and git-pinned dependency.
- Added Higgsfield capability discovery, quote/egress proposals, approval invalidation, decline, and
  local alternative decisions without automatic spending.
- Added desktop/mobile, two-session, export/reopen, and accessibility proof.
