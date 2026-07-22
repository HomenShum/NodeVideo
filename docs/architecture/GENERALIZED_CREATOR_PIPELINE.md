# Generalized creator pipeline

NodeVideo now separates creative intent, media understanding, reusable technique, execution, and rendering. Dance remains a deeply evaluated capability pack; it is no longer the architecture.

```text
source media + optional transcript/reference + creator request
  -> MediaIndex (one reusable analysis)
  -> EditIntent (one or many outputs)
  -> StoryGraph / TemplateSpec
  -> EditRecipe compiler
  -> cheapest sufficient privacy-compatible executors
  -> EditPlan v2 proposals
  -> human review
  -> fixed renderer + receipt
```

## Scaling boundary

- `MediaIndex` is the shared, content-addressed analysis. Variants do not retranscribe or re-index the same source.
- `EditIntent` describes goals and output constraints without naming implementation tools.
- capability packs own techniques, schemas, fixtures, and evaluations.
- `TemplateSpec` stores narrative and visual grammar, not copied brand assets or copyrighted footage.
- the recipe compiler fans out only output-specific work and selects the cheapest executor that satisfies capability, privacy, runtime, GPU, license, quality, and budget constraints.
- `EditPlan v2` records semantic retain/remove/caption/reframe/transition/audio operations plus approvals and lineage. Existing fixed renderers remain on the proven v1 contract and can be described or upgraded without breaking them.

## Executor ladder

The orchestrating agent should not be the pixel processor. A capability can be served by several interchangeable executors:

1. deterministic browser or local code for metadata, exact cuts, reframing, captions, and export;
2. cheap open-source models for VAD, filler detection, transcription, shot detection, tracking, and segmentation;
3. specialist local or hosted models for semantic clipping, restoration, rotoscoping, or generative media;
4. a human editor or review gate when evidence is ambiguous or rights/meaning are consequential.

Executor selection fails closed when media egress, commercial-use licensing, GPU availability, quality, or budget constraints cannot be met.

## Template vault

The vault contains source references, rights metadata, derived narrative ratios, shot-length ranges, caption/transition technique IDs, framing rules, audio policy, and evaluators. It does not redistribute reference videos. An accelerator or creator style is represented as a structural study and must never copy logos, graphics, music, scripts, or footage.

The initial catalog lives at `packs/reference-template/templates/catalog.json` and includes founder-launch, podcast-quote, and product-feature structures. Authorized user references can be converted into private `TemplateSpec` records through the `nodevideo.reference-template` pack.

## What is working now

- upload or rights-cleared bundled source in `/creator.html`;
- optional transcript-backed quote indexing;
- cleanup, golden-quote, and founder-launch workflows;
- shared analysis with per-output recipe fan-out;
- source-grounded EditPlan v2 operations and approval gates;
- 16:9, 9:16, square, and source-aspect previews;
- local H.264 browser export and EditPlan JSON download;
- desktop/mobile browser regression proof.
- local FFprobe/FFmpeg media indexing, silence detection, PySceneDetect shots, OpenCV subject sampling, and optional local Whisper word timestamps;
- approval-gated local rendering with source-audio preservation and asset/run receipts;
- a pinned Higgsfield CLI adapter with model discovery, cost estimation, proposal-before-spend, durable provider job IDs, downloads, hashes, and pending-rights receipts;
- provider benchmark queues and per-brief scoring across three repetitions;
- rights-gated showcase manifests for image, video, GIF, audio, GLB, Gaussian-splat, and HTML outputs.

## Honest current limits

The browser convenience renderer remains video-only; use `npm run creator:local` for audio-preserving production renders. Untimed pasted transcripts are evenly distributed and explicitly low-confidence, while local Whisper is slower and must be requested. Higgsfield is implemented but cannot be certified live until the user completes official sign-in and an entitlement snapshot proves which surfaces and models the promotion covers. Auto-Editor, OpenStoryline, TRELLIS, and VGGT remain disabled until installed, evaluated, and commercially reviewed. A generated asset is never public-ready until its separate rights receipt is approved.
