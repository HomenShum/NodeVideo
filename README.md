# NodeVideo

NodeVideo is building an artifact-driven video-editing service. The current release proves a
target-guided reconstruction slice; autonomous source-only editing is the target architecture, not
a demonstrated capability. In that architecture, an agent plans and critiques, established media
primitives perform the measurable work, and a typed edit plan controls fixed render templates. The
product goal is the creator's outcome: picture selection, music, rhythm, text, reframing, grade, and
delivery, not a pile of generated editing code.

The owner-authorized V1 real-media run is retained as failure evidence. It is not a successful
reconstruction and must not be cited as proof of autonomous editing or audiovisual fidelity.

## Live release

[Open NodeVideo on Vercel](https://nodevideo-pi.vercel.app). The release requires no sign-in and is responsive
across laptop, tablet, and phone layouts. The V2 proof verifies automatically and opens on the
corrected reconstruction. Its selector exposes the final target, target/corrected side-by-side, and
both metadata-stripped source proxies. The browser first hashes a deployment-trusted manifest and
all 15 declared media/evidence assets; any missing or changed byte fails closed instead of presenting
an unverified pass.

The foreground demo includes the authorized target-derived soundtrack program, measured at
`0.999504` rendered/reference correlation and `0 ms` lag, all 31 timed cue intervals, the corrected
`16.067-19.633 s` movement phrase, the end sting, framing decisions, grade lineage, OTIO, event
scores, render metrics, and critic receipt. The invalidated V1 replay remains available under **V1
failure evidence** so the failure is inspectable rather than erased.

Vercel serves a hash-verified replay of a completed worker run. Hash integrity proves which bytes
ran; the separate event/window/audio gates support the bounded reconstruction verdict. Vercel is
not presented as a live transcoding worker.

## V1 invalidation and recovered ground truth

V1 recovered the container structure and four hard-cut frames, but failed essential editorial
requirements:

- `00:16.067-00:19.633` used the wrong Source A movement phrase. The correct source range begins
  76 frames / 2.533 seconds later, at frame `942` (`00:31.400`).
- The soundtrack was omitted even though the target mutes both MOVs and uses a separate commercial
  music excerpt, an intentional silence, and an end sting.
- Most of the 31 timed cue-text intervals and the cut-spanning animated social layer were omitted.
- `Thanks for watching!` began 139 frames too early.
- Aggregate SSIM was inflated by letterbox padding: 68.28% of each fit frame is black.

The historical diagnostics were:

| Metric | Result |
| --- | ---: |
| SSIM | `0.946873` |
| PSNR | `26.311718 dB` |
| VMAF | `29.819468` |
| Historical verdict | `invalidated` |

VMAF `29.819468` already indicated major perceptual disagreement. SSIM/PSNR over padded video and
with audio excluded were never sufficient evidence for a pass.

V2 separates three claims: reference understanding, plan-driven render fidelity, and held-out
autonomous editing. Target-derived audio may be used in the authorized fidelity replay only with
explicit lineage; it cannot count as autonomous music selection. Autonomous mode must select from
a user-owned or licensed catalog and retain license provenance.

See [the V2 edit-forensics report](docs/authorized-case-v2-forensics.md) for the recovered picture,
music, silence, sting, cue-text, social-layer, framing, and color decisions.

## Run locally

Requirements: Node.js 22+, npm 10+, Chromium for browser tests, and FFmpeg/FFprobe for worker
regeneration or independent media verification.

```bash
npm ci
cp .env.example .env
npm run dev
```

In PowerShell, use `Copy-Item .env.example .env` in place of `cp`.

Open `http://localhost:4173`.

Verify the checked-in synthetic proof and historical V1 replay without rewriting their artifacts:

```powershell
npm run worker:authorized:verify
npm run worker:verify
```

`worker:authorized:verify` checks the immutable historical V1 bundle's original manifest and
receipt contract. It does not validate V2 or turn V1 into passing evidence; V2 trust, artifact,
render/audio, and V1-invalidation assertions run under `npm test`. Regenerating the historical case
is an explicit owner-authorized developer action; see
[`packs/reference-reconstruct/README.md`](packs/reference-reconstruct/README.md).

The V2 path is plan-driven. The reference analyzer emits `EditUnderstanding`, `EditPlan`, OTIO, and
primitive evidence; the renderer accepts that typed plan, neutral private bindings, source media,
and declared render assets. The final target container and its picture pixels are never renderer
inputs; this authorized replay does declare a target-derived soundtrack and grade LUT:

```powershell
python scripts/analysis/reference_edit_analyzer.py --help
npm run worker:edit-plan -- --plan <edit-plan.json> --bindings <bindings.json> --output <render.mp4>
node scripts/quality/edit-plan-adjudicator.mjs --plan <edit-plan.json> --metrics <render-metrics.json>
```

See [`scripts/analysis/README.md`](scripts/analysis/README.md) for the pinned PySceneDetect,
MediaPipe, OpenCV, librosa, EasyOCR, and OpenTimelineIO workflow. Private source paths stay in the
bindings file and never enter public artifacts.

The synthetic worker remains independently reproducible:

```powershell
npm run worker:public
npm run worker:verify
```

It exercises the generic deterministic-worker contract with generated inputs. It is not evidence of
human-pose, production-music, or generic reconstruction accuracy.

## Quality gates

```bash
npm run lint
npm run typecheck
npm run test
npm run check:ui
npm run capability:validate
npm run worker:verify
npm run worker:authorized:verify
npm run build
npx playwright install chromium
npm run test:e2e
```

To run the same browser journeys against production:

```powershell
$env:NODEVIDEO_URL='https://nodevideo-pi.vercel.app'; npm run test:e2e
```

`npm run check` runs the static, unit, schema, receipt, UI-policy, and build gates. Pull requests run
the complete sequence in [`.github/workflows/quality.yml`](.github/workflows/quality.yml). Browser QA
covers 1440, 1280, 834, 390, and 320 CSS-pixel viewports, accessibility, keyboard operation, media
decodability, and document-level horizontal overflow.

The stable automation and consent contract is documented in [`.qa/profile.md`](.qa/profile.md).
`data-testid` values are a versioned public interface for agents and tests; they must not be renamed
casually or used to bypass product code.

## Primitive-first UI

NodeVideo uses Tailwind CSS 4 and generated shadcn/ui primitives for generic presentation and
interaction. Selected AI Elements primitives present the real worker artifact, tool, and checkpoint
records, while the `@assistant-ui/react-o11y` adapter presents the recorded trace. Feature code owns
only video-domain composition.

The real-case refactor removed the bespoke feature shell and reduced authored UI from 889 to 651
logical lines. Generated files in `src/components/ui/**` and `src/components/ai-elements/**` remain an
immutable vendor zone whose upstream snapshots are pinned in `.ui/ui-policy.json`.

`npm run check:ui` rejects raw generic controls, direct Radix imports, inline layout styles,
arbitrary Tailwind dimensions, extra authored stylesheets, and custom media queries. The release is
at 651 of the 900 authored-UI-line ceiling and 95 of the 120 authored-CSS-line ceiling. See
[`docs/ui-primitives.md`](docs/ui-primitives.md) for the selection order and exception process.

## Reuse strategy

NodeVideo reuses existing primitives by responsibility:

- **shadcn/ui and AI Elements:** generated accessible controls, cards, media artifacts, worker tools,
  and checkpoints.
- **react-o11y:** headless trace hierarchy and timing presentation.
- **NodeAgent:** typed tool registry, deterministic execution, receipts, and independent validation
  patterns.
- **NodeRoom:** append-only events, trace contracts, and artifact lineage patterns.
- **FeatureClipStudio:** Playwright-to-video proof and FFmpeg render-verification practices.

The deployed Vercel application is a replay boundary, not the media execution plane. See
[`docs/architecture.md`](docs/architecture.md) for the dependency flow and claim boundaries.

## Publication and privacy rules

- Real media is public only for this explicitly owner-authorized case and only as metadata-stripped
  derivatives. Original source-container metadata is not published.
- The final MP4 container and its picture pixels are evaluation inputs, never reconstruction render
  inputs. This owner-authorized replay separately declares target-derived soundtrack and grade-LUT
  assets as render inputs with visible lineage.
- Receipts, manifests, and results use public asset IDs, sanitized names, hashes, timings, tool
  versions, and artifact roles; they do not publish private local locators.
- A playable render appears only after browser-side integrity and lineage verification succeeds.
- The synthetic fixture remains the default generic and CI smoke proof.
- Any new real-media publication requires its own explicit authorization, metadata sanitization,
  hash verification, and case-scoped evaluation.
- Deterministic analysis is not labeled as a live AI/model run, and a single target-guided result is
  not generalized into an automatic editing claim.

## Repository guide

- [`packs/reference-reconstruct/`](packs/reference-reconstruct/) — authorized real-case schemas,
  tools, evaluation, claim rules, and worker instructions.
- [`fixtures/media/authorized-real-v1/`](fixtures/media/authorized-real-v1/) — metadata-stripped web
  derivatives, case manifest, result, and receipt.
- [`fixtures/media/authorized-real-v2/`](fixtures/media/authorized-real-v2/) — corrected render,
  target/corrected comparison, typed edit artifacts, metrics, critic report, and release receipt.
- [`packs/tutorial-compare/`](packs/tutorial-compare/) and
  [`fixtures/media/tutorial-compare-v1/`](fixtures/media/tutorial-compare-v1/) — generated
  known-marker smoke proof.
- [`scripts/workers/`](scripts/workers/) — deterministic FFmpeg workers and verifiers.
- [`src/lib/published-cases.ts`](src/lib/published-cases.ts) — browser integrity and lineage checks.
- [`docs/architecture.md`](docs/architecture.md) — execution, replay, and evidence boundaries.
- [`.qa/profile.md`](.qa/profile.md) — canonical UI journey, consent rules, and selector contract.

## Status

The V2 authorized case passes all 56 measured plan/render gates. Its corrected permanent window has
foreground-only SSIM `0.919714`; rendered/target soundtrack correlation is `0.999504` at `0 ms`
lag; mapped source-audio leakage is `0.039134`; and the 31 typed plan cues pass the two-frame
tolerance. Delivery audio measures `-14.1 LUFS` and `-1.9 dBFS` true peak. Global VMAF remains only
`25.949820`, so this release does **not** claim pixel identity or exact perceptual equivalence. Text
gates do not independently OCR the decoded render, and social transitions/gradient styling remain
approximate. The soundtrack and grade assets are explicitly target-derived for this replay, which
also means the case does not prove blind music selection, catalog rights, or source-only taste.
