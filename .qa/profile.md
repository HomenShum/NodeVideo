# QA profile: NodeVideo

This is the canonical app profile for the `agentic-ui-qa` runner. Execute claims literally, preserve evidence, and fail closed. The public/CI happy path uses only the built-in synthetic demo. User media is local-only and must never be copied into Git, a hosted preview, CI, screenshots, traces, console logs, or shared QA artifacts.

## Environment

| Thing | Value |
|---|---|
| Prod URL | `https://nodevideo-pi.vercel.app` |
| Repo root | `D:\VSCode Projects\NodeVideo` |
| Dev command + port | `npm run dev`; `http://127.0.0.1:4173` |
| Preview command + port | `npm run build && npm run preview`; `http://127.0.0.1:4173` |
| Backend / deployments | Current MVP: browser-local checkpoint/runtime plus public synthetic fixture; no server durability or real media worker may be inferred. Target: Convex semantic control plane and versioned local/media workers. Vercel hosts the Vite shell. |
| Auth path for a QA agent | Anonymous. Public synthetic demo requires no login. Local media uses the browser file picker only and stays on-device. `UNKNOWN — no external-model path exists; any future provider credential must remain server-side and consent-gated, and the profile must name its env var without printing its value.` |
| Typecheck gate | `npm run typecheck` |
| Lint gate | `npm run lint` |
| Test gate | `npm run test` |
| Build gate | `npm run build` |
| E2E gate | `npm run test:e2e` |
| Playwright available in repo? (pixels.cjs `repo` field) | Yes: `playwright`; use repo root as `repo`. Install Chromium with `npx playwright install chromium`. |
| Evidence dir convention | `D:\VSCode Projects\NodeVideo\.qa\evidence\public\<run-id>\`; include a machine-readable report, console/network ledger, and named PNGs. Never place real user video or object URLs in public evidence. Private media proof remains under ignored `.qa/evidence/private/`. |
| Memory dir (SKILL §9; append-only ledger) | `D:\VSCode Projects\NodeVideo\.qa\memory\` |

## Safety classes

| Mode | Allowed use | Required visible truth | Forbidden |
|---|---|---|---|
| Public synthetic demo | CI, hosted preview, screenshots, proof video, deterministic UI/runtime QA | “Public synthetic demo” or equivalent on the load control and synthetic provenance on resulting artifacts | Describing its fixed outputs as real analysis, model work, or a playable render when no media URL exists |
| Local-only media | Manual QA with disposable/private fixtures in the current browser session | `data-testid="privacy-badge"` states that media stays local; artifact provenance says browser-local | Upload/network egress, persisted object URLs, file paths or media bytes in logs/traces/checkpoints/evidence |
| Future external model/media service | Not in the current release claim | Per-action preflight plus server receipt matching provider/model/sources/memory/read-write scope/actual egress | Any call before consent, client-side secrets, or optimistic/fabricated provenance |

The three user-provided evaluation videos are manual local inputs only. Never use them in CI or publish them as evidence. Create small disposable synthetic fixtures for worker tests when that layer exists.

## Provenance surface (ground truth for AI/analysis claims — SKILL §1.2)

| Question | Answer |
|---|---|
| Where does the app show what ran? | `data-testid="stage-list"` for the event-derived lifecycle, `trace-panel` for spans, `artifact-panel` for outputs/provenance, `proposal-card` for the pending recipe mutation, and `version-history` for accepted/restored state. |
| LIVE model run signals | None in the current scope. A synthetic or browser-local artifact is never a LIVE model run. Future LIVE classification requires provider/model, consent ID, nonzero real token/cost fields where billed, timestamps, exact source IDs, trace ID, and server-authored receipt/digest in the trace/artifact surface. |
| Deterministic browser-local signals | Artifact provenance kind `browser-local`, named/versioned processor, input asset IDs, stage/span linkage, and no provider/token/cost claim. |
| SYNTHETIC signals | Artifact/source provenance kind `synthetic`, generator `nodevideo-demo`, and an explicit disclosure. Synthetic values may be deterministic but are not worker/model proof. |
| DEGRADED/fallback signals | `UNKNOWN — degraded UI copy is not yet frozen. Required behavior: visible amber degraded/partial/unknown label, last valid checkpoint, unavailable artifact names, zero invented metrics, and a bounded next action.` |
| FAILED signals | Failed stage in `stage-list`, error span in `trace-panel`, retained valid artifacts in `artifact-panel`, and cause + next step. A tool error must never render as approval denial or completion. |

## First-run behavior (trap U10)

A fresh anonymous session at `/` must show one calm entry surface inside `app-shell`: the public synthetic-demo action, local upload action, and the `privacy-badge`. Workspace evidence surfaces (`stage-list`, `trace-panel`, `artifact-panel`, `proposal-card`, and `version-history`) remain absent until explicit demo load or local selection creates intent. There is no login/onboarding bypass and no hidden fixture query parameter.

Exact start paths:

1. CI/public: click `[data-testid="demo-load"]` (“Load verified synthetic demo”).
2. Manual private: select reference and practice clips through `[data-testid="local-upload"]`; do not attach the user’s files to the QA report.

## Stable selector contract

These test IDs are a versioned agent API and name real product outcomes. Renaming one is a breaking QA-contract change. They may not switch to mock code or manufacture evidence.

| Selector | Contract |
|---|---|
| `app-shell` | reachable NodeVideo shell/root |
| `demo-load` | explicit public synthetic-fixture entry |
| `local-upload` | local video file input/activation; accepts video and never itself sends bytes |
| `run-plan` | review/start control for the current comparison plan; disabled without two assets |
| `stage-list` | event-derived stages and honest statuses |
| `trace-panel` | span hierarchy derived from runtime records |
| `artifact-panel` | typed artifacts with visible provenance |
| `proposal-card` | pending reviewable recipe patch with rationale and before/after values |
| `accept-proposal` | accepts the exact current proposal once; creates one new version |
| `version-history` | append-only version/restore history |
| `privacy-badge` | current safety class: local-only or public synthetic |

Future external-model controls additionally reserve `egress-consent`, `provenance`, and `degraded`, following `BAR-DEFAULTS.md`. Do not add a “Web” or “AI” label until the named capability and receipt exist.

## Live signals (for live-signal.mjs)

The Vite production HTML is an SPA shell, so raw HTML absence is not evidence. After a canonical URL is assigned, use:

- Raw HTML: `NodeVideo` (document title only).
- Hydration-only: `Load verified synthetic demo`.
- Hydration-only: visible `Local only`/on-device privacy statement.
- Hydration-only after demo load: `Synthetic` provenance disclosure.
- Hydration-only after a run: `Review proposal`/equivalent pending-review label.

## Journey mapping (archetypes A0–A7 → concrete steps)

Every `VERIFY` must produce a DOM log, network/console ledger, PNG, trace/artifact export, or gate exit line from the current session.

### A0 Smoke — first-time visitor

1. Clear cookies/local storage; open canonical `/` with no query or hash. VERIFY `location.search === ""`, UTF-8, and `[data-testid="app-shell"]` visible. Evidence: `A0-01-clean-root.txt`.
2. VERIFY exactly one visible `demo-load`, one `local-upload`, and a `privacy-badge`; `proposal-card` is absent. Evidence: `A0-02-first-run.png`.
3. VERIFY the demo action visibly says synthetic/demo and the privacy copy does not imply upload. Evidence: `A0-03-safety-copy.txt`.
4. Click `demo-load`. VERIFY `run-plan` becomes enabled/reachable and no cross-origin request fired. Evidence: `A0-04-demo-loaded.png`, `A0-network.json`.
5. Run `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build`; save exact exits.

### A1 Core creation — cautious user, no AI/media egress

1. Create two disposable tiny video fixtures outside the repo, or use approved non-user QA fixtures. Never use the three user videos for recorded/shared evidence.
2. Arm request/console capture, choose the reference and practice files through `local-upload`, and VERIFY the privacy badge says local/on-device.
3. VERIFY all HTTP(S) requests remain same-origin and checkpoint/trace/console/storage dumps contain no `blob:`, `file:`, absolute path, raw bytes, or selected filenames if filenames are classified private. Evidence: redacted `A1-network.json` and `A1-storage-audit.txt`.
4. Click `run-plan`. VERIFY event-derived stages and browser-local provenance; do not expect model, token, cost, or synthetic-worker claims.
5. Reload. VERIFY metadata/checkpoint recovery is honest and the UI asks for reselection when object URLs are no longer valid.

### A2 Live AI action — consent → propose → provenance → accept

`SKIPPED for the current release — there is no external model path, and the public synthetic proposal must not be relabeled as LIVE AI.`

When a model-backed coaching action is introduced, update this profile before enabling it: default private, inspect `egress-consent`, record provider/model/sources/memory/read-write scope, dispatch one held-out action, require a matching server receipt in `provenance`, inspect `proposal-card` before mutation, click `accept-proposal`, and prove exactly one new entry in `version-history`. Any preflight/receipt mismatch or consent-off egress is P0.

The current deterministic proposal path is still tested under A3/B3/B7: click `run-plan`, wait for `proposal-card`, record its rationale and patch, capture the version history, click `accept-proposal` once, and VERIFY the history changes exactly once.

### A3 Provenance audit — governance reviewer

1. Load the public demo and click `run-plan`; wait for `proposal-card`.
2. VERIFY `stage-list`, `trace-panel`, and `artifact-panel` are visible and mutually consistent: each completed stage names existing artifacts and every artifact identifies a producing stage/span.
3. VERIFY every demo artifact is visibly synthetic, has no fake provider/cost/tokens, and any preview without `mediaUrl` is not presented as playable.
4. Inspect trace parent/child order, statuses, measured timestamps, and artifact links. A running span may show elapsed time only from its real start; no invented end time.
5. Select a span then its artifact when focus controls exist; VERIFY bidirectional focus. Record `A3-trace.png`, `A3-artifacts.png`, and a redacted checkpoint/trace JSON.
6. Scale fixtures (4, 10, 100, then hundreds of spans) when available. Above 12 operations require grouping/collapse; at hundreds require search/filter/virtualization/cursor behavior. Until fixtures exist, mark the scale portions BLOCKED, not PASS.

### A4 Output and sharing — presenter

The current release makes no real export, publish, or share claim. VERIFY such controls are absent or carry a clear unavailable/not-rendered warning. The synthetic demo may be shown publicly, but it is not a rendered comparison export. Once export exists, require a real output file, FFprobe validation, exact input/tool/version provenance, and a privacy-safe share boundary.

### A5 Themes and access — accessibility auditor

1. Keyboard-drive A0 and the demo/proposal flow; VERIFY visible focus, logical order, named controls, and no hover-only action.
2. Render desktop 1440×1000, tablet 834×1112, and mobile 390×844. VERIFY no clipped active action, reachable navigation, readable data, and no horizontal overflow.
3. `UNKNOWN — theme control is not frozen.` Before claiming both themes, require a named toggle and root theme attribute, then capture all six viewport × light/dark PNGs and prove dark pixels are actually dark. Without a theme control, score the missing theme honestly.
4. Emulate reduced motion and VERIFY stage/progress UI remains comprehensible without animation.

### A6 Adversarial — hostile gremlin

1. Attempt `run-plan` with zero and one asset; VERIFY no run/event and an actionable validation state.
2. Double-click `run-plan`; VERIFY one runtime/trace. Double-click `accept-proposal`; VERIFY one accepted event and one new version.
3. Try a non-video, zero-byte, malformed, and oversized file. VERIFY bounded rejection, no crash, no network request, and no leaked path/bytes.
4. Reload mid-run and at awaiting-review. VERIFY checkpoint recovery or explicit interrupted/unknown state; never optimistic completion or auto-accept.
5. Corrupt/remove checkpoint fields in a disposable browser context. VERIFY schema rejection and safe reset/recovery, not partial mutation.
6. Force one stage failure. VERIFY valid earlier artifacts remain, failed state is distinct, and the proposed next action does not overclaim.
7. For the public demo, intercept all cross-origin traffic and fail the test on any egress. For local media, additionally audit storage/trace/console for browser object URLs and raw bytes.

### A7 Agentic depth — durable tool-user (conditional)

Current browser-local execution does not claim server jobs, leases, retries, model routing, web research, collaboration, or durable memory. Score unsupported Depth dimensions `N/A`/unscored rather than inferring them from UI. When the Convex/worker runtime lands, verify real queued/running/waiting/retrying/paused/canceled/failed/completed events, reload by job ID from server checkpoints, idempotent receipts, retry without duplicate render, visible memory controls, and exact artifact/source lineage.

## App-specific traps (beyond universal U1–U12)

- **N1 Synthetic-is-real confusion:** fixed demo features/proposals are flow fixtures, not evidence that FFmpeg, beat, pose, alignment, rendering, or a model ran.
- **N2 Session-only capability:** a persisted `blob:` URL may look recoverable but is invalid/privacy-sensitive. Persist metadata only and ask for reselection.
- **N3 Privacy badge gaming:** `privacy-badge` is not proof. Verify network, storage, checkpoint, trace, and console behavior independently.
- **N4 Proposal auto-apply:** a proposal card shown after mutation fails B3. Compare version history before the card and after explicit acceptance.
- **N5 Double acceptance:** React Strict Mode or rapid clicks can duplicate events/versions. Assert a single accepted event and version increment.
- **N6 Synthetic preview:** a comparison-preview with no `mediaUrl` must not expose active playback/export affordances.
- **N7 Timing theater:** deterministic demo delays/spans must be labeled synthetic; do not score them as measured worker latency.
- **N8 Partial failure erasure:** a later error must not hide already-valid artifacts or rewrite completed trace spans.
- **N9 Port collision:** both Vite dev and preview use `4173`; ensure Playwright owns or deliberately reuses the correct process.
- **N10 Private evidence:** filenames, thumbnails, frames, waveforms, and screenshots derived from user clips are themselves private media.

## Known product behaviors that are NOT bugs

- Public synthetic outputs are stable across runs.
- The public synthetic preview may intentionally have no playable `mediaUrl`.
- Reload can restore local asset metadata while requiring the user to reselect the actual file bytes.
- The first browser-local slice has no server collaboration, share/export, live model, token/cost receipt, or production worker claim.
- A deterministic/browser-local proposal can be useful without being called AI.

## Agentic UI Bar defaults and release thresholds

No score is earned by adding a test ID or badge. Evidence must come from product behavior and external observation.

| Dimension | Day-one NodeVideo convention | Release threshold |
|---|---|---|
| B1 Consent & egress honesty | no external egress in current release; future calls pass one private-by-default per-action gate | zero cross-origin media/model calls now; exact preflight/receipt match later |
| B2 Attribution & provenance | artifact/trace UI reads immutable provenance records | every claim links to source mode, stage/span, tool/generator, version, and validation; no fabricated numbers |
| B3 Propose-before-mutate | `proposal-card` is the only analysis-to-recipe write path | version unchanged before explicit, exact-candidate acceptance |
| B4 Scope boundaries | local/synthetic modes and typed tool read/write manifests | media location and tool authority visible and enforced |
| B5 Honest degrade | failed/partial/unknown are first-class, distinct states | forced failure preserves valid evidence and never renders success |
| B6 Status & latency feel | UI is derived from ordered events/checkpoints | no timer-only progress; stale/missing events stop optimistically advancing |
| B7 Recoverability | append-only recipe versions and restore | accept-then-restore round trip survives reload |
| B8 Agent operability | stable testid/aria contract in this profile | A0–A3 deterministic selectors, keyboard-complete, no hidden-hover action |
| B9 Visual craft | tokenized hierarchy, hue denotes state/provenance, mono for data, responsive pixels | vision-reviewed desktop/tablet/mobile and actual supported themes |
| B10 Conversation/content quality | verdict-first summary, visible evidence, cause + next step errors, `[source needed]` when applicable | no unsupported analytical claim or sycophantic/fake-success copy |
| B11 First-run/progressive disclosure | one explicit demo/local entry; workspace/proof only after intent | clean `/`, no fixture params, no evidence machinery before creation |

## Last Bar score (update after a real evidence-producing pass; lowest = next revamp target)

| B1 | B2 | B3 | B4 | B5 | B6 | B7 | B8 | B9 | B10 | B11 | date | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | 2026-07-14 | Profile/bootstrap only; no rendered evidence or completed QA pass yet. |
| 2 | 2 | 2 | 2 | 1 | 1 | 2 | 2 | 1 | 2 | 2 | 2026-07-14 | 19/22. Production run `prod-2026-07-14T20-15Z`: synthetic and local-only boundaries, provenance, proposal gating, recovery, stable selectors, content, and progressive disclosure passed. B5 remains partial until forced worker failure/degraded UI is implemented; B6 remains partial because the current pipeline is synchronous; B9 remains partial because only the supported dark presentation was reviewed. Next revamp target: B5 honest degraded/failure recovery, followed by a real event-streamed worker path for B6. |

## Pass completion contract

A pass is complete only when A0–A7 are each marked PASS, FAIL (with evidence), BLOCKED (with the repeated blocker), SKIPPED (reason), or N/A; all hard gates ran on the current tree; every claim maps to a current artifact; the Bar is scored; the next revamp target is named; and append-only QA memory is updated. Two failures at the same step trigger the STOP rule.
