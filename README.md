# NodeVideo

NodeVideo is a deterministic video-reconstruction proof. The live release foregrounds one
owner-authorized real-media case: a local FFmpeg worker reconstructed a final edit from two MOV
sources, then measured the decoded result against the supplied final MP4.

The claim is deliberately narrow. This is a target-guided reconstruction of one authorized case,
not a generic edit autopilot. A separate generated known-marker fixture remains the default generic
worker and CI smoke proof.

## Live release

[Open NodeVideo on Vercel](https://nodevideo-pi.vercel.app). The release is anonymous and responsive
across laptop, tablet, and phone layouts.

Choose **Load and verify real case** to inspect six metadata-stripped derivative videos: the two
source proxies, final-target proxy, MOV-only reconstruction, side-by-side comparison, and amplified
pixel difference. Before showing them, the browser hashes the case manifest, worker result, receipt,
and all six videos, then checks their authorization, lineage, metric, and artifact relationships.
Any mismatch fails closed instead of presenting an unverified render.

Vercel serves a verified replay of a completed worker run. It does not execute FFmpeg for a visitor;
the media worker runs locally or in CI. The checked-in receipt and trace record what produced the
published artifacts.

## Proven result and boundary

The reconstruction matches the target's exact structure:

- 720x1280 video at 30 fps;
- 1,335 frames and 44.5 seconds;
- footage cuts at frames `201`, `482`, `589`, and `753`; and
- both source MOVs represented in the render.

Measured over decoded 720x1280 video, with target audio excluded:

| Metric | Result |
| --- | ---: |
| SSIM | `0.946873` |
| PSNR | `26.311718 dB` |
| VMAF | `29.819468` |
| Claim tier | `perceptually-close-video` |

These measurements do not claim pixel identity. Timing, framing, and grade parameters were inferred
against the final MP4, but the reconstruction's render inputs are only the two MOV sources plus
independently recreated graphics. The final MP4 is analysis-and-evaluation-only: its frames and
soundtrack are not copied into the reconstruction.

The output uses cut source audio followed by a silent branded tail. The target soundtrack was not
present in either MOV, remains unmatched, and was not copied. The result therefore proves a close
visual reconstruction of this edit, not exact audiovisual reproduction or automatic discovery on
arbitrary footage.

## Run locally

Requirements: Node.js 22+, npm 10+, Chromium for browser tests, and FFmpeg/FFprobe for worker
regeneration or independent media verification.

```bash
npm ci
npm run dev
```

Open `http://localhost:4173`.

Verify both checked-in worker proofs without rewriting their artifacts:

```powershell
npm run worker:authorized:verify
npm run worker:verify
```

`worker:authorized:verify` validates the authorized case's hashes, decodability, sanitized lineage,
target exclusion from render inputs, exact timeline, metrics, and passing receipt. Regenerating that
case is an explicit owner-authorized developer action; see
[`packs/reference-reconstruct/README.md`](packs/reference-reconstruct/README.md).

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

The real-case refactor removed the bespoke feature shell and reduced authored UI from 889 to 253
logical lines. Generated files in `src/components/ui/**` and `src/components/ai-elements/**` remain an
immutable vendor zone whose upstream snapshots are pinned in `.ui/ui-policy.json`.

`npm run check:ui` rejects raw generic controls, direct Radix imports, inline layout styles,
arbitrary Tailwind dimensions, extra authored stylesheets, and custom media queries. The release is
at 253 of the 900 authored-UI-line ceiling and 95 of the 120 authored-CSS-line ceiling. See
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
- The final MP4 is an evaluation input, never a reconstruction render input.
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
- [`packs/tutorial-compare/`](packs/tutorial-compare/) and
  [`fixtures/media/tutorial-compare-v1/`](fixtures/media/tutorial-compare-v1/) — generated
  known-marker smoke proof.
- [`scripts/workers/`](scripts/workers/) — deterministic FFmpeg workers and verifiers.
- [`src/lib/published-cases.ts`](src/lib/published-cases.ts) — browser integrity and lineage checks.
- [`docs/architecture.md`](docs/architecture.md) — execution, replay, and evidence boundaries.
- [`.qa/profile.md`](.qa/profile.md) — canonical UI journey, consent rules, and selector contract.

## Status

The live app provides a verified, playable real-case reconstruction with six inspectable views and
an evidence-backed `perceptually-close-video` claim. Exact structure, source lineage, target
exclusion, metadata sanitization, artifact hashes, and quality metrics are independently checked.
Still unclaimed: pixel-exact reproduction, target soundtrack recovery, generic edit discovery,
hosted FFmpeg execution, and model-driven editing quality.
