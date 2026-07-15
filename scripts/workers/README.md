# NodeVideo media workers

The repository has isolated deterministic media-plane workers. They reuse the same FFmpeg, FFprobe,
hashing, probing, atomic proof-writing, and privacy-containment utilities, but their claims and
publication rules are intentionally separate.

## Plan-driven renderer

`edit-plan-renderer.mjs` consumes the canonical `nodevideo.edit-plan.v1` JSON contract plus a second
JSON object that binds neutral asset IDs to local paths. It does not accept an FFmpeg filter, command,
argument list, or arbitrary React/template code from a planner. The compiler supports only fixed
source/freeze/black video primitives, fit/fill/static-crop layouts, fixed text and graphic overlay
templates, a fixed BT.2020 HLG to BT.709 SDR Hable color-management primitive, explicit
music/SFX/sting/voice/source-audio routes, and first-class silence windows.

Text is rendered with the repository-bundled OFL Geist font and `drawtext` text files with expansion
disabled. Host font discovery and plan-authored filter expressions are not used. Music clips fail
closed without rights provenance, evaluation-only assets cannot enter the render graph, every source
camera-audio route must explicitly mix or mute, and the primary picture track must cover every frame.

Validate a plan without opening any media:

```powershell
npm run worker:edit-plan -- --plan edit-plan.json --bindings bindings.private.json --output render.mp4 --dry-run
```

Remove `--dry-run` to render. Binding files are local runtime configuration and must not be committed.

## Authorized real-case reconstruction

`reference-reconstruct.mjs` implements the `authorized-real-v1` proof. A local or CI run uses two
MOVs as reconstruction sources and the final MP4 only to infer case-specific timing, framing, and
grade parameters and to evaluate the decoded output. Independently recreated graphics complete the
render.

The target is `analysis-and-evaluation-only`: target frames and audio are not copied into the
reconstruction. Output audio is cut from the source MOVs and ends with a silent branded tail because
the target soundtrack is unavailable in the source footage and remains unmatched.

The validated structure is 720x1280 at 30 fps, 1,335 frames, 44.5 seconds, with cuts at frames
`201`, `482`, `589`, and `753`. The measured result is SSIM `0.946873`, PSNR `26.311718 dB`, and VMAF
`29.819468`, supporting the case-bounded tier `perceptually-close-video`. It is not pixel-exact and
does not prove generic automatic edit reconstruction.

Verify the checked-in result without rewriting it:

```powershell
npm run worker:authorized:verify
```

Regeneration requires all three local input bindings plus the explicit owner-publication
authorization flag:

```powershell
npm run worker:authorized
```

The worker fails closed without that authorization. It strips source-container metadata from every
published derivative, rejects forbidden locator or metadata leakage, renders the reconstruction and
six web views, evaluates decoded video, and writes a hash-bound manifest, result, and receipt. Vercel
only serves those completed artifacts; it does not run this FFmpeg graph.

See [`../../packs/reference-reconstruct/README.md`](../../packs/reference-reconstruct/README.md) for
the schemas, tool graph, exact evidence scope, and excluded claims.

## Generated generic smoke worker

Generate and verify the synthetic paired-media proof:

```powershell
npm run worker:public
npm run worker:verify
```

`tutorial-compare.mjs` uses generated color-coded landmarks and known PCM pulses so CI can reproduce
the generic deterministic-worker contract without real media. It demonstrates worker orchestration,
hashing, known-marker analysis, and playable comparison output; it does not demonstrate generic
human-pose, production-music, or arbitrary reconstruction accuracy.

A non-publishing local invocation can still exercise the tutorial worker with developer-controlled
inputs:

```powershell
npm run worker:private
```

Those outputs remain confined to ignored QA evidence. They are not part of the public authorized
case and do not acquire publication consent from it.
