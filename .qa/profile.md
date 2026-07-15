# QA profile: NodeVideo V2

Mode: AUTHORIZED PRODUCTION. Execute claims literally and fail closed.

The foreground release is `blind-source-only-pilot-01`: an owner-authorized, fresh-context source-only edit and music-handoff pilot. `authorized-real-v2` remains a separate target-guided calibration below it. Raw containers and transient catalog previews remain private. Only metadata-stripped derivatives, neutral IDs, machine-readable plans, evaluation reports, and receipts may be public.

## Environment and gates

| Thing | Value |
| --- | --- |
| Production | `https://nodevideo-pi.vercel.app` |
| Local | `npm run dev`; Playwright owns its configured isolated port |
| Quality | `npm run lint`; `npm run typecheck`; `npm run test`; `npm run check:ui`; `npm run build`; `npm run test:e2e` |
| Worker | `npm run worker:edit-plan -- --plan <plan> --bindings <private-bindings> --output <render>` |
| Evidence | public-safe evidence under `.qa/evidence/public/<run-id>`; raw media and private analysis under ignored `.qa/evidence/private/` |
| QA memory | append-only `.qa/memory/` |

## Claim boundary

Proven only when the deployed manifest and every declared asset hash verify:

- for the named pilot, the planner received the two sanitized source proxies plus public music-catalog context, froze its edit/music choice before target unseal, and published no commercial audio;
- the 17.8-second clean preview, nine-trim plan, sparse text, music handoff, read log, freeze, silent held-out comparison, redaction receipt, and evaluation are hash-bound;
- the handoff is a catalog-preview-relative candidate segment with six desired video-to-preview-reference anchors, not measured Instagram beats or a verified full-track offset;
- reference-edit understanding for the named owner-authorized case;
- picture cuts/source mapping, including output frames `[482,589)` → Source A `[942,1049)`;
- explicit soundtrack identity, excerpt timing, beat/onset map, source-audio muting, silence, sting, and measured `0.999504` rendered/reference correlation at `0 ms` lag;
- all 31 timed text cues in the typed plan and evaluator;
- deterministic plan → render execution from fixed primitives;
- content-only worst-window and audio-correlation evaluation.

Not claimed:

- generalized source-only creative superiority or a blinded taste score from one pilot;
- OS-enforced or cryptographic planner isolation; the first pilot is fresh-context and audit-log isolated;
- verified Instagram availability, deep-link segment selection, full-track candidate offset, or automated rights clearance;
- exact original-editor bit identity;
- autonomous catalog licensing or ownership of the identified commercial track;
- decoded-render OCR/typography equivalence, exact social transition/gradient styling, or the original editor's grade;
- exact perceptual identity; global VMAF remains `25.949820`;
- a live Vercel FFmpeg/model job. Vercel serves verified static artifacts; analysis/render runs locally or in CI.

Target-derived audio and the grade LUT are allowed only by the explicit owner authorization for fidelity reconstruction. Their lineage must be visible and they disqualify blind music-selection and grade proof. The final target container is never a direct renderer input; its picture pixels remain analysis/evaluation-only, while only the declared derived audio/LUT assets may enter rendering.

## Release blockers

The blind pilot must remain `blocked` unless all are true:

1. the deployment-trusted blind manifest and all nine declared assets verify;
2. both source hashes equal the published sanitized source proxies;
3. fresh context, target access false, target mount false, and public-catalog-only selection are explicit;
4. the freeze hashes the plan, handoff, rationale, private read log, clean preview, and both inputs before target unseal;
5. the public read-log redaction receipt preserves the private log hash and removes local paths;
6. the preview contains synthetic guide audio only and the held-out comparison has no audio stream;
7. the candidate is visibly marked `confirm-in-instagram` and `catalog-preview-relative`;
8. taste remains null/awaiting until actual blinded-human evidence exists.

V2 must remain `blocked` unless all are true:

1. trusted manifest hash and every view/artifact/receipt hash verify;
2. exact cut sequence is `201,482,589,753,1214,1215`;
3. the permanent `[482,589)` mapping uses Source A `[942,1049)` and independently passes its foreground-only render window;
4. source audio is structurally muted;
5. music is `Sign` by `82MAJOR`, ISRC `KRA382601866`, with released-master provenance offset `29146 ms` and gain `-6.12 dB`;
6. audio events are music `0–40338.6 ms`, silence `40338.6–40837.3`, sting `40837.3–42153.5`, silence `42153.5–44500`;
7. all 31 text cues pass content and timing gates;
8. render technical checks, target-soundtrack correlation/lag, cut-to-soundtrack alignment, source-leakage, loudness/true-peak, and every local window pass the evaluator;
9. no raw filename, path, device/location/creation metadata, or unauthorized media is public;
10. current-tree quality, build, responsive, accessibility, and production-smoke gates pass.

## First-run and stable selectors

At `/`, the blind pilot appears first, V2 is target-guided calibration, and V1 is history. Loading/verifying is real fetch+SHA work, never timer theater. Missing/tampered digests or artifacts must show a bounded error and no pass styling.

Stable outcome selectors:

| Selector | Contract |
| --- | --- |
| `app-shell` | reachable NodeVideo shell |
| `privacy-badge` | authorization boundary, not integrity proof |
| `blind-pilot-panel` | foreground source-only pilot |
| `blind-pilot-integrity` | trusted manifest plus nine asset hashes |
| `blind-taste-boundary` | protocol proof and explicit taste limitation |
| `instagram-music-handoff` | candidate, preview-relative segment, copy actions, and rights boundary |
| `music-cue-anchors` | six exact video-to-catalog-preview mappings |
| `blind-pilot-artifacts` | freeze, read log, plan, handoff, comparison, and evaluation |
| `v2-proof-panel` | target-guided V2 calibration |
| `v2-integrity` | unchecked/verifying/verified/error from real hashes |
| `v2-verdict` | derived from manifest gates plus verified bytes |
| `v2-permanent-window` | visible 16.067–19.633 s mapping result |
| `v2-soundtrack` | identity, timing, muting, beat result, and rights boundary |
| `v2-text-summary` | exact cue count and gate |
| `v2-claim-boundary` | visible VMAF, text, social/grade, autonomy, and rights limitations |
| `[aria-label="V2 comparison view"]` | corrected/target/side-by-side/source A/source B |
| `v2-artifacts` | verified EditUnderstanding, EditPlan, OTIO, event score, critic report |
| `v1-history` | subordinate invalidated V1 evidence |

## Required journeys

- A0 smoke: clean `/`; no horizontal overflow; blind pilot primary; V2 calibration; V1 historical.
- A1 blind integrity: hash the blind manifest, preview, and eight evidence artifacts; verify the public/private read-log redaction bridge.
- A2 creator handoff: preview decodes; search and exact steps copy; six anchors remain readable; Instagram navigation is a handoff, not a preselected-audio claim.
- A3 blind boundary: generation freeze precedes target unseal; target flags are false; taste is null/awaiting; no commercial preview file is public.
- A4 V2 integrity: hash manifest, five views, nine evidence artifacts, and receipt; scan private metadata/path leakage.
- A5 V2 core: corrected default; all five views decode; soundtrack, 31 cues, and permanent window visible.
- A6 provenance: verify plan lineage, target-derived audio disclosure, evaluator release readiness, and fixed-template renderer receipt.
- A7 adversarial: tamper both trusted manifests and each asset class; every case fails closed with no stale pass.
- A8 accessibility: keyboard Select/collapsibles/copy actions, Axe, reduced motion, and visible focus.
- A9 responsive: inspect 1440×1000, 1280×800, 834×1112, 390×844, and 320×568; document width equals viewport width and all controls/content remain reachable.
- A10 production: deployed URLs, ranges, content types, hashes, ledger, clipboard behavior, and mobile playback.

## App-specific traps

- V1 aggregate SSIM is invalid evidence; it omitted soundtrack/text and masked the wrong 16–19 s phrase with black padding.
- Plan-only adjudication is not release readiness. Passing render/audio metrics are mandatory.
- The measured `0.999504` rendered/reference correlation at `0 ms` lag supports bounded soundtrack fidelity, not exact identity, autonomous selection, or licensing.
- Social/end-card recreation and HDR→SDR grade must be disclosed when approximate; do not let their omission disappear into a global average.
- A recorded trace is not a live worker. Never label it live.
- No public URL or JSON may contain original filenames or local paths.
- Long IDs must wrap; mobile must never horizontally scroll.
- A catalog-preview timestamp is not an Instagram/full-track timestamp. Never collapse those labels.
- A fresh-context audit log is evidence, not an OS sandbox. Never say “cryptographically isolated.”
- A concrete track recommendation is not a license grant; availability is account/region dependent.

## Agentic UI Bar

Score only from current artifacts and rendered evidence. B1 consent, B2 provenance, B4 scope, B5 fail-closed degrade, B8 keyboard operability, B9 responsive craft, B10 claim honesty, and B11 first-run clarity are hard gates. Mutable-project dimensions remain N/A until a real durable editing service is connected.

Last complete V2-only score: `18/22` on production on 2026-07-15. It is historical until the new blind/music journeys A0–A10 pass on the current deployment. B7 remains zero and B3/B6 remain partial because the application is a verified immutable replay, not yet a durable mutable editing service. Never preserve a historical score after manifest or render changes.
