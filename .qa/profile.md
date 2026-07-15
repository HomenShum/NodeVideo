# QA profile: NodeVideo

This is the canonical app profile for the `agentic-ui-qa` runner. Execute claims literally, preserve evidence, and fail closed. The foreground release is the anonymous, owner-authorized `authorized-real-v1` verified replay. The built-in synthetic fixture remains the default generic worker/CI smoke input but is not a foreground UI journey. User media without explicit, scoped owner authorization is local-only and must never be copied into Git, a hosted preview, CI, screenshots, traces, console logs, or shared QA artifacts. Authorization for one named case never transfers to another file or run.

## Environment

| Thing | Value |
|---|---|
| Prod URL | `https://nodevideo-pi.vercel.app` |
| Repo root | `<repo-root>` |
| Dev command + port | `npm run dev`; `http://127.0.0.1:4173` |
| Preview command + port | `npm run build && npm run preview`; `http://127.0.0.1:4173` |
| Playwright local URL | `http://127.0.0.1:4317`; the Playwright config owns this isolated dev/preview port |
| Backend / deployments | Vercel hosts a static Vite shell plus same-origin, metadata-stripped `authorized-real-v1` JSON and media derivatives. The browser verifies authorization/lineage contracts, six media SHA-256 digests, and the result digest before revealing playback or the recorded trace. Vercel does not run FFmpeg, a model, or a durable job; the deterministic worker runs locally or in CI. The synthetic fixture remains a generic worker/CI smoke input only. |
| Auth path for a QA agent | Anonymous; open canonical `/` and use `real-case-load`. There is no login, upload, external-model consent, credential, or server mutation in the foreground release. Future provider credentials must remain server-side and consent-gated, and the profile must name their env vars without printing values. |
| Typecheck gate | `npm run typecheck` |
| Lint gate | `npm run lint` |
| Test gate | `npm run test` |
| Build gate | `npm run build` |
| E2E gate | `npm run test:e2e` |
| Playwright available in repo? (pixels.cjs `repo` field) | Yes: `playwright`; use repo root as `repo`. Install Chromium with `npx playwright install chromium`. |
| Evidence dir convention | `<repo-root>/.qa/evidence/public/<run-id>/`; include a machine-readable report, console/network ledger, and named PNGs. Never place non-authorized real user video or object URLs in public evidence. Owner-authorized public evidence must use only the named case's verified metadata-stripped derivatives and public aliases. Private media proof remains under ignored `.qa/evidence/private/`. |
| Memory dir (SKILL §9; append-only ledger) | `<repo-root>/.qa/memory/` |

## Safety classes

| Mode | Allowed use | Required visible truth | Forbidden |
|---|---|---|---|
| Public synthetic worker fixture | Generic worker/CI smoke and held-out deterministic tests; not a foreground UI mode | Synthetic provenance in worker artifacts and test logs | Presenting it as the owner-authorized case, a model run, or foreground product proof |
| Local-only media | Private/manual tooling outside the current foreground UI | Explicit local-only handling in that tooling and private ignored evidence | Adding an upload path to this release; network egress; persisted object URLs; file paths or media bytes in logs/traces/checkpoints/public evidence |
| Owner-authorized public real-media case | Only the specifically named case and publication scope recorded in its committed manifest and receipt; hosted demo and public evidence may consume verified derivatives | Owner authorization, case-specific/target-guided scope, metadata stripping, public aliases, render/evaluation lineage, measured metrics, and limitations remain visible | Raw source containers; private filenames or paths; location, coordinates, device/software, or creation metadata; target pixels/audio represented as render lineage; extending consent to any other media |
| Future external model/media service | Not in the current release claim | Per-action preflight plus server receipt matching provider/model/sources/memory/read-write scope/actual egress | Any call before consent, client-side secrets, or optimistic/fabricated provenance |

The named case `authorized-real-v1` has explicit owner authorization for the NodeVideo public demo, repository derivatives, and evaluation evidence. That exception applies only to metadata-stripped derivatives with neutral public aliases; the raw containers remain untracked and unpublished. Before any authorized derivative is committed, hosted, released, or cited as proof, independently verify its digest, decodeability, metadata scan, and lineage. The final MP4 is analysis/evaluation-only and must be absent from reconstruction render inputs; its soundtrack must not be copied or claimed as matched. The built-in synthetic fixture remains the default for CI, worker smoke tests, and all generic product claims. Any other real media remains local-only unless a new, explicit, scoped authorization record is created.

### Owner-authorized publication gate

An owner-authorized public case fails closed unless all of these checks pass:

1. The committed manifest and receipt identify the same named case, authorization status, grant scope, and `sourceContainerMetadataPublished: false`.
2. Every public media path is a relative neutral alias. JSON, logs, UI, and release assets contain no raw filename, absolute path, coordinates, location tag, device make/model, software/encoder tag, or creation timestamp copied from the source container.
3. Every referenced derivative exists, decodes, and matches its declared SHA-256 digest. A successful worker replay independently verifies the same hashes and media probes.
4. Render lineage names both MOV sources and excludes the final target. Evaluation lineage names the target and reconstruction, with target usage fixed to `analysis-and-evaluation-only`.
5. Timeline frames are contiguous and reproduce the declared cut frames, frame count, frame rate, dimensions, and duration. Structural assertions and measured metrics must pass before a similarity tier is shown.
6. Audio provenance states that output audio comes from the MOV sources, the branded tail is silent, and target audio was neither copied nor matched.
7. Claims stay case-specific and target-guided. Passing this case is evidence for the named reconstruction, not a generic edit-autopilot capability.

## Provenance surface (ground truth for AI/analysis claims — SKILL §1.2)

| Question | Answer |
|---|---|
| Where does the app show authorization and scope? | `case-consent` names owner authorization; `target-usage` states metadata stripping, target analysis/evaluation-only use, MOV render lineage, recreated graphics, and unmatched/uncopied target audio. |
| Where does the app show verification and quality? | `asset-integrity` reports unchecked, verified `6/6`, or fail-closed error state. `quality-summary` states the case-specific visual scope; `metric-ssim` and `metric-psnr` remain dashes until verification supplies the measured values. |
| Where does the app show what ran? | The expanded AI Elements `Tool` shows a recorded seven-span trace rendered through `@assistant-ui/react-o11y`, rooted at `[data-observability-primitives="assistant-ui-react-o11y"]`. `real-case-receipt` opens the same-origin immutable JSON receipt. This is recorded worker provenance, not a live Vercel execution. |
| VERIFIED REPLAY signals | Owner-authorized manifest; `sourceContainerMetadataPublished: false`; all six media hashes and the result hash match the receipt; both MOVs are render inputs; target is excluded from render and included only in evaluation; validation passes; recorded spans come from the receipt. |
| LIVE model/run signals | None. No model, token, cost, provider, live FFmpeg, server job, or browser-local analysis claim is allowed. Future LIVE classification requires a separately profiled consent and server-receipt path. |
| SYNTHETIC signals | Checked-in synthetic media remains worker/CI smoke only. It does not appear in the foreground UI and cannot support claims about this real-media case. |
| LOADING signals | `real-case-load` is disabled and says “Verifying deployed media…” while actual same-origin bytes are being hashed. Video, Comparison Select, numeric metric values, and recorded trace remain unrevealed. |
| FAILED signals | A destructive `role="alert"` says “Verification stopped” plus the concrete hash/contract/load cause; `asset-integrity` says not fully checked; loaded media, numeric metric values, and recorded trace stay absent; `real-case-load` remains retryable. |

## First-run behavior (trap U10)

A fresh anonymous session at canonical `/` shows a calm owner-authorized consent/scope card and exactly one primary action, `[data-testid="real-case-load"]`. `case-consent`, `target-usage`, and the unchecked `asset-integrity` state are visible before action. The video artifact, Comparison Select, measured values, and recorded react-o11y trace remain absent until every case contract and declared digest passes. There is no login, upload, synthetic-mode switch, editor, hidden fixture query, or automatic verification on arrival.

Exact start path: open `/` with no query/hash, read `case-consent` and `target-usage`, then activate `real-case-load` (“Load and verify real case”).

## Stable selector contract

These test IDs are a versioned agent API and name real product outcomes. Renaming one is a breaking QA-contract change. They may not switch to mock code or manufacture evidence.

| Selector | Contract |
|---|---|
| `app-shell` | reachable NodeVideo shell/root |
| `privacy-badge` | header boundary: authorized derivatives only; never sufficient integrity proof by itself |
| `case-consent` | exact owner-authorized publication disclosure |
| `target-usage` | metadata, render/evaluation lineage, recreated-graphics, and audio limitation disclosure |
| `real-case-load` | explicit fail-closed verification action; disabled only while bytes are being verified |
| `asset-integrity` | unchecked, `6/6` hash-verified, or not-fully-checked state derived from verification |
| `quality-summary` | case-specific `perceptually-close-video` scope, frame/cut facts, and target-audio exclusion |
| `metric-ssim` | measured SSIM `0.946873`, absent/dash before verification |
| `metric-psnr` | measured PSNR `26.311718 dB`, absent/dash before verification |
| `real-case-receipt` | same-origin immutable receipt JSON link |
| `[aria-label="Comparison view"]` | six-option Select: Target, Reconstruction, Side-by-side, Difference, Source A, Source B |
| `[data-observability-primitives="assistant-ui-react-o11y"]` | recorded receipt trace inside the expanded Tool; never labeled live |

Future external-model controls additionally reserve `egress-consent`, `provenance`, and `degraded`, following `BAR-DEFAULTS.md`. Do not add a “Web”, “AI”, or live-run label until the named capability and receipt exist.

## Live signals (for live-signal.mjs)

The Vite production HTML is an SPA shell, so raw HTML absence is not evidence. After a canonical URL is assigned, use:

- Raw HTML: `NodeVideo` (document title only).
- Hydration-only before verification: `Owner-authorized publication`.
- Hydration-only before verification: `Load and verify real case`.
- Hydration-only before verification: `Deployed asset hashes have not been checked yet`.
- Hydration-only after verification: `6/6 deployed videos match the SHA-256 receipt`.
- Hydration-only after verification: `Perceptually-close video for this target-guided single case`.
- Hydration-only after verification: `Recorded worker trace · 7 verified spans`.

## Journey mapping (archetypes A0–A7 → concrete steps)

Every `VERIFY` must produce a DOM log, network/console ledger, PNG, trace/artifact export, or gate exit line from the current session.

### A0 Smoke — first-time visitor

1. Clear cookies/local storage; open canonical `/` with no query or hash. VERIFY `location.search === ""`, UTF-8, `app-shell`, one `real-case-load`, and the NodeVideo title. Evidence: `A0-01-clean-root.txt` and `A0-01-first-run.png`.
2. VERIFY `case-consent` says owner-authorized publication and `target-usage` states metadata-stripped derivatives, final-MP4 analysis/evaluation-only use, both-MOV render lineage, recreated graphics, and unmatched/uncopied target audio. Evidence: `A0-02-scope.txt`.
3. Before activation, VERIFY `asset-integrity` says hashes have not been checked, SSIM/PSNR are dashes, and no video, Comparison Select, or react-o11y trace is rendered. Evidence: `A0-03-progressive-disclosure.txt`.
4. Arm request/response, console, and page-error capture; activate `real-case-load`. While pending, VERIFY the button is disabled and says “Verifying deployed media…”, with no premature artifact/numeric-metric/trace reveal.
5. At completion, VERIFY `asset-integrity` says `6/6`, one video and the six-option Comparison Select appear, SSIM/PSNR become numeric, and the recorded trace appears. Every JSON/media request must be same-origin and successful; any cross-origin request, console error, page error, or failed case request fails A0. Evidence: `A0-04-verified.png` and `A0-network.json`.
6. Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run check:ui`, `npm run capability:validate`, `npm run worker:authorized:verify`, and `npm run build`; save exact exits.

### A1 Core verification — cautious evaluator, no AI/media egress

1. Independently fetch the same-origin manifest, result, receipt, and six declared video views. VERIFY successful JSON/video content types and independently SHA-256 every video against the manifest plus the result against the receipt; do not treat `asset-integrity` copy as proof. Evidence: `A1-integrity.json`.
2. VERIFY the manifest/result agree on case ID; the manifest/receipt agree on `owner-authorized-publication`, grant scope, and `sourceContainerMetadataPublished: false`; and the receipt trace ID binds `authorized-real-v1`. Scan committed JSON and public names for absolute paths, raw filenames, coordinates/location, device make/model, source software/encoder, and source creation metadata. Evidence: `A1-metadata-scan.txt`.
3. VERIFY render lineage contains exactly both MOV source IDs and excludes `asset.target-edit`; evaluation lineage contains the target and reconstruction; all three target-usage fields equal `analysis-and-evaluation-only`.
4. VERIFY audio provenance says cut source MOV audio with silent branded tail, `targetMatched: false`, and `targetCopied: false`; visual metrics explicitly exclude target audio.
5. VERIFY no HTTP(S) egress leaves the app origin, no upload/file-picker control exists, and no file/blob path or raw bytes enter console, storage, URL, or evidence. Evidence: `A1-network.json` and `A1-privacy-scan.txt`.

### A2 Live AI action — consent → propose → provenance → accept

`N/A for the current release — this is an immutable verified replay with no model, external provider, proposal, mutation, or acceptance path. Never relabel the recorded deterministic worker trace as LIVE AI. Profile a future model-backed action before exposing it.`

### A3 Provenance audit — governance reviewer

1. Complete A1, then VERIFY the visible trust chain is mutually consistent: `case-consent` → `target-usage` → `asset-integrity` → `quality-summary`/metrics → recorded Tool trace → `real-case-receipt`.
2. VERIFY the quality tier is exactly case-specific `perceptually-close-video`, with SSIM `0.946873`, PSNR `26.311718 dB`, decoded-video scope, 720×1280 reconstruction, 1,335 frames, and cut frames `201,482,589,753`. The UI must not say exact match or generic edit autopilot.
3. Inspect the expanded Tool. VERIFY `[data-observability-primitives="assistant-ui-react-o11y"]` contains the seven receipt spans in recorded order, each with accessible name, `ok` status, stage label, and receipt-derived duration. The Tool title must say recorded/verified trace, never running/live.
4. Open `real-case-receipt`; VERIFY it is same-origin JSON, matches the already-hashed receipt, and names worker/package/version, validation, artifacts, lineage, events, and trace. It must contain no provider/model/token/cost fiction.
5. VERIFY the page and footer state that Vercel serves a hash-verified replay while FFmpeg runs locally or in CI. Evidence: `A3-provenance.png`, `A3-trace.txt`, and `A3-receipt-audit.json`.

### A4 Output and sharing — presenter

1. After verified load, keyboard- or pointer-open the `Comparison view` Select and exercise all six distinct options: Target, Reconstruction, Side-by-side, Difference, Source A, Source B.
2. VERIFY each option changes to its distinct same-origin URL and decodes without media error at the declared dimensions: Target 360×640; Reconstruction 720×1280; Side-by-side 720×640; Difference 360×640; Source A and Source B 640×360. Target/Reconstruction/Side-by-side/Difference run 44.5 s; source proxies remain longer source views.
3. VERIFY playback controls are real and the selected label matches the media. The target is comparison evidence, the reconstruction is source-only output, and the amplified difference is not presented as a normal render.
4. VERIFY the only explicit sharing/proof action is the JSON receipt and the public-repo link. There is no editor, export, upload, mutation, or “render on Vercel” control. Evidence: `A4-six-views.json` and one named screenshot per view when public-media evidence is authorized.

### A5 Themes and access — accessibility auditor

1. Keyboard-focus `real-case-load`, activate with Enter, wait for `6/6`, then focus the Comparison Select and open its six named choices with Enter. VERIFY visible focus, logical order, and no hover-only action. Keyboard-changing the selected Radix view remains a held-out follow-up after the current Playwright focus-handoff assertion hit the two-attempt STOP rule; do not count it as passed from pointer selection.
2. Run the verified state at all five configured viewports: 1440×1000, 1280×800, 834×1112, 390×844, and 320×568. At each, assert zero document horizontal overflow and no clipped button, link, video, Select, consent, target-usage, integrity, or quality surface. Capture `A5-<viewport>.png` for rendered-pixel review.
3. Run Axe WCAG 2 A/AA and 2.1 A/AA after verification at every viewport; any serious or critical violation fails the release gate. Manually verify readable hierarchy, media containment, and reachable receipt control.
4. Emulate reduced motion and VERIFY loading/integrity status and the recorded trace remain comprehensible. The current release exposes one supported light presentation and no theme toggle; do not claim a tested dark theme.

### A6 Adversarial — hostile gremlin

1. Intercept `reconstruction.mp4` and return different bytes with HTTP 200/video content type. VERIFY “Verification stopped”, a reconstruction SHA-256 cause, not-fully-checked integrity, retry enabled, and zero video/numeric-metric/trace reveal. A fabricated `6/6` is P0.
2. Independently tamper each browser-enforced trust input class in disposable routes/tests: authorization status, metadata-publication flag, all target-usage fields, render lineage, audio copied/matched flags, metric agreement, view count/path, cut frames, result digest, and result/receipt validation. Every case must reject before reveal. Evaluation-lineage completeness, alias/metadata scanning, audio-output wording, and tier-threshold derivation remain independent unit/worker release gates rather than unimplemented browser checks.
3. Force one JSON/media 404, truncated response, and malformed JSON. VERIFY a bounded cause, retryable action, cleared prior loaded state on re-verification, and no stale success artifact. Independently fail the release gate on a wrong JSON/video content type; do not claim the current browser contract detects content type by itself.
4. Rapidly activate `real-case-load` and retry after a failure. VERIFY the disabled loading state prevents ambiguous concurrent verification and only a fully successful latest attempt reveals evidence.
5. Inject or observe any cross-origin HTTP(S) request. Fail immediately; this static replay needs no Convex, analytics, model, CDN, upload, or external API request.
6. Search rendered text, URLs, JSON, console, trace, storage, and failure artifacts for raw filenames/paths, coordinates, device/source-software tags, source creation metadata, blob URLs, or media bytes. Any leak is P0.

### A7 Agentic depth — durable tool-user (conditional)

`N/A for the current release — there is no live agent loop, server job, lease, retry queue, model routing, web research, collaboration, durable memory, or mutable project state. The seven-span Tool is an immutable recorded receipt trace. Score unsupported Depth dimensions N/A/unscored rather than inferring agentic depth from it.`

## App-specific traps (beyond universal U1–U12)

- **N1 Authorization scope creep:** consent for `authorized-real-v1` does not authorize another file, raw container, derivative, case, or use. Match the named manifest scope every time.
- **N2 Integrity-badge gaming:** `privacy-badge` and `asset-integrity` text are not proof. Independently hash deployed bytes against the manifest/receipt and inspect network behavior.
- **N3 Partial reveal race:** Promise completion or one valid asset must not reveal video, numeric metrics, or trace. All browser-enforced authorization, lineage, validation, six media hashes, and result hash pass atomically before `loadedCase` exists.
- **N4 Stale success after retry:** re-verification must clear the prior verified state before fetching. A failed second attempt cannot leave the first video, numeric metrics, trace, or `6/6` visible.
- **N5 Target contamination:** the target may guide timing/layout/grade analysis and evaluation only. Its asset ID, pixels, or audio in reconstruction render lineage is P0.
- **N6 Soundtrack false match:** visual similarity does not imply audio similarity. The target soundtrack is unmatched and uncopied; metrics exclude target audio.
- **N7 Replay-is-live confusion:** Vercel serves static verified artifacts. The recorded seven-span react-o11y trace is not a live job, and verification latency is hash/fetch time rather than worker latency.
- **N8 Claim-tier inflation:** SSIM/PSNR/VMAF plus per-segment thresholds support `perceptually-close-video`, not exact match or generic edit-autopilot capability.
- **N9 View alias collision:** six labels must resolve to six distinct URLs and expected dimensions; a label change without a media change is a broken output path.
- **N10 Cross-origin creep:** the foreground replay requires only same-origin JSON/media. Convex, analytics, external CDNs, models, uploads, or APIs are unexpected egress and fail the gate.
- **N11 Port collision:** ordinary Vite dev/preview uses `4173`, while Playwright owns isolated `4317`; verify the harness controls the intended process.
- **N12 Private evidence:** filenames, thumbnails, frames, waveforms, and screenshots derived from non-authorized user clips are private media. For the named owner-authorized case, only verified metadata-stripped derivatives and neutral aliases may cross the public boundary; raw-container metadata remains private.

## Known product behaviors that are NOT bugs

- The foreground UI exposes one anonymous owner-authorized real-media case and no upload/synthetic-mode switch.
- The synthetic fixture remains available to generic worker/CI smoke tests without appearing in the foreground UI.
- Vercel serves a same-origin verified replay; FFmpeg runs locally or in CI, not on page load.
- Before verification, the consent/scope, unchecked integrity state, empty quality summary, and verification action are visible; video, Comparison Select, measured values, and recorded trace are not.
- Successful verification downloads and hashes all six videos before revealing the default Side-by-side view, so the first action can take longer on a mobile connection.
- Target, Reconstruction, Side-by-side, Difference, Source A, and Source B intentionally use different dimensions/aspect ratios.
- SSIM, PSNR, and VMAF describe decoded visual reconstruction only. The target soundtrack remains unmatched and excluded.
- The seven Tool spans are recorded receipt provenance rendered with react-o11y, not a live agent trace.
- The release has no editor, proposal, mutation, version history, export, live AI, token/cost record, server job, collaboration, or durable project state.

## Agentic UI Bar defaults and release thresholds

No score is earned by adding a test ID or badge. Evidence must come from product behavior and external observation.

| Dimension | Day-one NodeVideo convention | Release threshold |
|---|---|---|
| B1 Consent & egress honesty | owner authorization, metadata stripping, target use, and unmatched audio are visible before action; all case requests stay same-origin | exact manifest/receipt authorization match and zero cross-origin requests |
| B2 Attribution & provenance | immutable manifest/result/receipt, independent asset hashes, measured metrics, and recorded react-o11y trace | every visible claim agrees with hashed artifacts and receipt lineage; no live/model fiction |
| B3 Propose-before-mutate | N/A: the verified replay is read-only and exposes no proposal or mutation | no mutation-implying control or silent write |
| B4 Scope boundaries | both MOVs are render inputs; target is analysis/evaluation-only; graphics and audio origins are explicit | target excluded from render; target audio unmatched/uncopied; one named authorization scope |
| B5 Honest degrade | unchecked/loading/verified/error are distinct; failed verification clears all loaded evidence | tampered or incomplete bytes never reveal video, numeric metrics, trace, or `6/6`; retry remains available |
| B6 Status & latency feel | disabled loading button and integrity copy reflect actual fetch/hash work | no timer-only progress or premature success; completion follows all digest checks |
| B7 Recoverability | N/A: there is no mutable project state; safe retry is the recovery path | failed or repeated verification starts clean and cannot retain stale success |
| B8 Agent operability | stable testid/aria contract, six-option named Select, keyboard-complete verification and switching | A0–A6 deterministic selectors, keyboard-complete, no hidden-hover action |
| B9 Visual craft | tokenized hierarchy and responsive primitive-first layout for one supported light presentation | vision-reviewed 1440, 1280, 834, 390, and 320 widths with no clipping/overflow and Axe gate green |
| B10 Conversation/content quality | verdict-first case framing, visible limitations, case-specific tier, concrete verification errors | no exact-match, generic-autopilot, live-worker, model, or audio-match overclaim |
| B11 First-run/progressive disclosure | calm consent/scope plus one verification action; artifact, numeric metrics, Select, and recorded trace appear only after all checks | clean `/`, no fixture params or upload/editor machinery, and zero pre-verification artifact/trace reveal |

## Last Bar score (update after a real evidence-producing pass; lowest = next revamp target)

| B1 | B2 | B3 | B4 | B5 | B6 | B7 | B8 | B9 | B10 | B11 | date | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | UNSCORED | 2026-07-14 | Profile/bootstrap only; no rendered evidence or completed QA pass yet. |
| 2 | 2 | 2 | 2 | 1 | 1 | 2 | 2 | 1 | 2 | 2 | 2026-07-14 | 19/22. Production run `prod-2026-07-14T20-15Z`: synthetic and local-only boundaries, provenance, proposal gating, recovery, stable selectors, content, and progressive disclosure passed. B5 remains partial until forced worker failure/degraded UI is implemented; B6 remains partial because the current pipeline is synchronous; B9 remains partial because only the supported dark presentation was reviewed. Next revamp target: B5 honest degraded/failure recovery, followed by a real event-streamed worker path for B6. |
| 2 | 2 | 1 | 2 | 2 | 1 | 0 | 1 | 1 | 2 | 2 | 2026-07-14 | 16/22. Authorized real-media release candidate: five responsive viewports, Axe, hash/tamper gates, artifact/lineage audit, privacy audit, and rendered pixels passed. B7 is unsupported because this release is an immutable replay; B8 is partial because keyboard-changing the selected Radix view remains held out by the two-attempt STOP rule; B9 is partial because only the supported dark presentation was reviewed. Next target: deterministic active-option focus for B8, then honest recovery semantics if the product adds mutable jobs. |
| 2 | 2 | 1 | 2 | 2 | 1 | 0 | 1 | 1 | 2 | 2 | 2026-07-14 | 16/22. Production run `authorized-real-v1-production`: GitHub CI/security, all live endpoints and hashes, byte-range media, in-app browser selection/decode, 8 active Playwright gates, 20 responsive states, and 5 pixel shots passed. The same B7/B8/B9 boundaries remain honest. Next target: deterministic active-option focus for B8, then honest recovery semantics if the product adds mutable jobs. |
| 2 | 2 | 1 | 2 | 2 | 1 | 0 | 1 | 1 | 2 | 2 | 2026-07-14 | 16/22. Production LF hotfix: a Windows CLI redeploy changed receipt-bound JSON line endings, the UI correctly failed closed, `.gitattributes` pinned canonical LF bytes, all 18 capability checks passed, and the restored production suite returned 8 pass / 12 scope skips / 0 fail. B7/B8/B9 and the next target remain unchanged. |

## Pass completion contract

A pass is complete only when A0–A7 are each marked PASS, FAIL (with evidence), BLOCKED (with the repeated blocker), SKIPPED (reason), or N/A; all hard gates ran on the current tree; every claim maps to a current artifact; the Bar is scored; the next revamp target is named; and append-only QA memory is updated. Two failures at the same step trigger the STOP rule.
