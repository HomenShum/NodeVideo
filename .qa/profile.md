# QA profile: NodeVideo V2

Mode: AUTHORIZED PRODUCTION. Execute claims literally and fail closed.

The foreground release is `song-conditioned-auto-edit-v1`: a deterministic original-choreography + takes + chosen-song + timed-lyrics replay whose manifest and artifacts verify in the browser. `song-conditioned-real-calibration-v1` is a silent, sanitized picture-only result from the supplied case; its generation was frozen before evaluator access. The prior blind pilot and `authorized-real-v2` remain subordinate evidence. Raw containers, commercial audio in the new calibration lane, and transient analysis stay private.

## Environment and gates

| Thing | Value |
| --- | --- |
| Production | `https://nodevideo-pi.vercel.app` |
| Local | `npm run dev`; Playwright owns its configured isolated port |
| Quality | `npm run lint`; `npm run typecheck`; `npm run test`; `npm run check:ui`; `npm run build`; `npm run test:e2e` |
| Song proof | `npm run proof:song:public`; `npm run proof:song:real:verify`; `npm run grounding:doctor` |
| Worker | `npm run worker:edit-plan -- --plan <plan> --bindings <private-bindings> --output <render>` |
| Evidence | public-safe evidence under `.qa/evidence/public/<run-id>`; raw media and private analysis under ignored `.qa/evidence/private/` |
| QA memory | append-only `.qa/memory/` |

## Claim boundary

Proven only when the deployed manifest and every declared asset hash verify:

- the public replay accepts a distinct choreography reference, two takes, a chosen synthetic 120 BPM song segment, and timed text; selects A/B/A by phrase; mutes both take-audio routes; renders music and body-safe text; and freezes before evaluation;
- canonical `ChoreographyAnalysis`, `SongConditionedPlan`, `EditPlan`, generation read log, grounding result, and choreography freeze artifacts validate;
- the optional grounding boundary supports replay, manual, disabled, and LocateAnything HTTP adapters without inventing confidence, media locators, visual-prompt support, or implicit model-license acceptance;
- for the supplied-case calibration, the target picture and plan were inaccessible until freeze; duration is exact, cut F1 is `0.909091` at ±0.75 s, mean/max boundary error is `0.366667/0.633333 s`, and neutral A/B source agreement is `5/5`;
- the supplied-case public derivative is picture-only and silent; the exact authorized soundtrack was an oracle in private generation and therefore does not prove song/excerpt selection;
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

- independent choreography-reference fidelity for the supplied case, because no separate original-dance video was provided;
- exact-song source-only proof for the supplied case, because no independently supplied rights-cleared song master or timed lyrics were provided;
- creative taste, arbitrary-human-footage accuracy, live LocateAnything accuracy, or live Vercel media execution;
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

The foreground song-conditioned replay must remain `blocked` unless all are true:

1. the deployment-trusted replay manifest and every declared artifact hash verify before media or evidence links appear;
2. the input roles are a distinct choreography reference, at least two takes, chosen song segment, and protected timed text;
3. canonical analysis, song plan, EditPlan, grounding result, generation read log, and both freeze receipts validate;
4. camera audio is structurally muted and only the declared chosen-song track is audible;
5. the A/B/A selections and three complete beat phrases match the frozen replay;
6. target mount/read flags are false and evaluation follows freeze verification;
7. the supplied-case public preview has no audio or raw source containers, while its score remains bound to the private freeze;
8. taste stays `not-evaluated`; LocateAnything stays optional and no model/visual-prompt claim appears.

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

At `/`, the song-conditioned replay appears first, the prior blind pilot is collapsed inside it, V2 is target-guided calibration, and V1 is history. Loading/verifying is real fetch+SHA work, never timer theater. Missing/tampered digests or artifacts must show a bounded error and no pass styling.

Stable outcome selectors:

| Selector | Contract |
| --- | --- |
| `app-shell` | reachable NodeVideo shell |
| `privacy-badge` | authorization boundary, not integrity proof |
| `song-conditioned-panel` | foreground original-dance/takes/song/lyrics workflow |
| `case-input-boundary` | replay verification state and supplied-case missing-input disclosure |
| `song-conditioned-artifacts` | canonical interpretation, plan, freeze, evaluation, and manifest links after verification |
| `song-calibration-integrity` | pinned calibration manifest, seven artifact hashes, and silent-preview derivation chain |
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

- A0 smoke: clean `/`; no horizontal overflow; song workflow primary; prior blind pilot collapsed; V2 calibration; V1 historical.
- A1 song integrity: hash the replay manifest and every declared artifact; preview and links remain absent on any mismatch.
- A2 song mechanics: original-reference/takes/song/lyrics roles visible; A/B/A phrase cuts decode with music and body-safe text; camera audio mute and freeze-before-evaluator are explicit.
- A3 real calibration: verify the pinned manifest, seven artifacts, and derivation receipt before exposing links; picture-only preview is silent and 44.5 s; post-freeze score is F1 ≥0.9 with 5/5 A/B agreement; oracle/taste limitations remain visible.
- A4 grounding boundary: replay/manual/disabled doctor passes; LocateAnything is optional, text-only, license-gated, and never auto-downloaded.
- A5 blind integrity: hash the blind manifest, preview, and eight evidence artifacts; verify the public/private read-log redaction bridge.
- A6 creator handoff: preview decodes; search and exact steps copy; six anchors remain readable; Instagram navigation is a handoff, not a preselected-audio claim.
- A7 blind boundary: generation freeze precedes target unseal; target flags are false; taste is null/awaiting; no commercial preview file is public.
- A8 V2 integrity: hash manifest, five views, nine evidence artifacts, and receipt; scan private metadata/path leakage.
- A9 V2 core: corrected default; all five views decode; soundtrack, 31 cues, and permanent window visible.
- A10 provenance: verify plan lineage, target-derived audio disclosure, evaluator release readiness, and fixed-template renderer receipt.
- A11 adversarial: tamper both trusted manifests and each asset class; every case fails closed with no stale pass.
- A12 accessibility: keyboard Select/collapsibles/copy actions, Axe, reduced motion, and visible focus.
- A13 responsive: inspect 1440×1000, 1280×800, 834×1112, 390×844, and 320×568; document width equals viewport width and all controls/content remain reachable.
- A14 production: deployed URLs, ranges, content types, hashes, ledger, clipboard behavior, and mobile playback.

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

The prior blind-first production score is invalidated by this foreground change. Re-score A0–A14 only after the new replay and real-calibration manifests are deployed and independently verified. B7 remains zero and B3/B6 remain partial because the application is a verified immutable replay, not yet a durable mutable editing service.
