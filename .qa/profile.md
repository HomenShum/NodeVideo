# QA profile: NodeVideo V2

Mode: AUTHORIZED PRODUCTION. Execute claims literally and fail closed.

The foreground release is `authorized-real-v2`: an owner-authorized, target-guided audiovisual edit-understanding and fidelity-reconstruction case. Raw containers remain private. Only metadata-stripped derivatives, neutral IDs, machine-readable plans, evaluation reports, and receipts may be public.

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

- reference-edit understanding for the named owner-authorized case;
- picture cuts/source mapping, including output frames `[482,589)` → Source A `[942,1049)`;
- explicit soundtrack identity, excerpt timing, beat/onset map, source-audio muting, silence, sting, and measured `0.999504` rendered/reference correlation at `0 ms` lag;
- all 31 timed text cues in the typed plan and evaluator;
- deterministic plan → render execution from fixed primitives;
- content-only worst-window and audio-correlation evaluation.

Not claimed:

- exact original-editor bit identity;
- blind source-only taste equivalence;
- autonomous catalog licensing or ownership of the identified commercial track;
- decoded-render OCR/typography equivalence, exact social transition/gradient styling, or the original editor's grade;
- exact perceptual identity; global VMAF remains `25.949820`;
- a live Vercel FFmpeg/model job. Vercel serves verified static artifacts; analysis/render runs locally or in CI.

Target-derived audio and the grade LUT are allowed only by the explicit owner authorization for fidelity reconstruction. Their lineage must be visible and they disqualify blind music-selection and grade proof. The final target container is never a direct renderer input; its picture pixels remain analysis/evaluation-only, while only the declared derived audio/LUT assets may enter rendering.

## Release blockers

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

At `/`, the V2 proof appears before V1 history. Loading/verifying is real fetch+SHA work, never timer theater. The corrected render is the default view only after verification. Missing/tampered digest or artifacts must show a bounded error and no pass styling.

Stable outcome selectors:

| Selector | Contract |
| --- | --- |
| `app-shell` | reachable NodeVideo shell |
| `privacy-badge` | authorization boundary, not integrity proof |
| `v2-proof-panel` | foreground V2 result |
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

- A0 smoke: clean `/`; no horizontal overflow; V2 is primary; V1 is historical.
- A1 integrity: independently hash manifest, five views, nine evidence artifacts, and receipt; scan for private metadata/path leakage.
- A2 core proof: corrected is default; all five views decode; soundtrack, 31 cues, and permanent window are visible.
- A3 provenance: verify plan lineage, target-derived audio disclosure, evaluator release readiness, and fixed-template renderer receipt.
- A4 adversarial: tamper manifest and each asset class; every case fails closed with retry and no stale pass.
- A5 accessibility: keyboard Select/collapsibles, Axe, reduced motion, and visible focus.
- A6 responsive: inspect 1440×1000, 1280×800, 834×1112, 390×844, and 320×568; document width must equal viewport width and all controls/content remain reachable.
- A7 production: deployed URLs, byte ranges, content types, hashes, console/network ledger, and mobile media playback.

## App-specific traps

- V1 aggregate SSIM is invalid evidence; it omitted soundtrack/text and masked the wrong 16–19 s phrase with black padding.
- Plan-only adjudication is not release readiness. Passing render/audio metrics are mandatory.
- The measured `0.999504` rendered/reference correlation at `0 ms` lag supports bounded soundtrack fidelity, not exact identity, autonomous selection, or licensing.
- Social/end-card recreation and HDR→SDR grade must be disclosed when approximate; do not let their omission disappear into a global average.
- A recorded trace is not a live worker. Never label it live.
- No public URL or JSON may contain original filenames or local paths.
- Long IDs must wrap; mobile must never horizontally scroll.

## Agentic UI Bar

Score only from current artifacts and rendered evidence. B1 consent, B2 provenance, B4 scope, B5 fail-closed degrade, B8 keyboard operability, B9 responsive craft, B10 claim honesty, and B11 first-run clarity are hard gates. Mutable-project dimensions remain N/A until a real durable editing service is connected.

Last complete V2 score: pending current production run. Next target is whichever hard gate first fails; never preserve a historical score after the manifest/render changes.
