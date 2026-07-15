# Reference Reconstruction capability pack

This pack documents one completed, owner-authorized real-media reconstruction. A deterministic local worker used two MOVs as render sources, inferred timing, framing, and grade parameters against the final MP4, applied independently recreated graphics, and emitted a 44.5-second reconstruction plus comparison evidence.

The checked-in evidence supports the `perceptually-close-video` claim tier for this case: SSIM `0.946873`, PSNR `26.311718 dB`, and VMAF `29.819468` over decoded 720x1280 video. All 12 structural assertions passed, including 1335 frames at 30 fps, four matched footage cuts, both source MOVs represented, and decodable output artifacts.

This is deliberately a narrow claim. It is one target-guided case, not a generic edit-autopilot evaluation. The final MP4 is used only for analysis and evaluation; its pixels and soundtrack are not copied into the reconstruction. The reconstruction audio is cut source audio with a silent branded tail because the target soundtrack was not present in either MOV and remains unmatched.

## Public proof

- `fixtures/media/authorized-real-v1/case-manifest.json` publishes the authorization scope, source roles, artifact hashes, quality measurements, and limitations.
- `fixtures/media/authorized-real-v1/result.json` records the frame-accurate timeline, source lineage, media artifacts, evaluation metrics, validation assertions, and the case-specific automation disclosure.
- `fixtures/media/authorized-real-v1/receipt.json` records sanitized lineage, tool versions, 15 ordered worker events, seven spans, output hashes, and the passing verdict.
- The published videos are metadata-stripped browser derivatives. Original source-container metadata is not published.

Verify the checked-in proof without rewriting it:

```powershell
npm run worker:authorized:verify
```

Regeneration is an explicit owner-authorized developer action. It requires the three local input bindings and the publication authorization flag, executes FFmpeg locally, and rewrites the public evidence bundle:

```powershell
npm run worker:authorized
```

## Files

- `manifest.json` declares the case-bounded capability, tools, outputs, UI renderers, permissions, and excluded claims.
- `input.schema.json` requires explicit owner authorization, two render-source videos, an evaluation-only target, independently recreated graphics, and no target-audio copying.
- `output.schema.json` defines the completed result, lineage, timeline, media artifacts, video metrics, structural assertions, and limitations.
- `skill.md` defines the orchestration, privacy, provenance, and claim rules.
- `tools/registry.json` records the implemented tool graph and the exact validated scope of each primitive.
- `evals/authorized-real-v1.json` binds the pack to the public case, receipt, result, media hashes, and measured result.

## Execution boundary

The media worker runs locally or in CI with FFmpeg. Vercel serves a verified replay of checked-in artifacts and receipts; it does not run this FFmpeg graph. Media-plane locators and raw container metadata never belong in hosted events, logs, traces, screenshots, or exported evidence.

The authorization in this proof is case-specific. It does not establish a blanket policy for other user media. Any new real-media publication needs its own explicit owner authorization, metadata sanitization, hash verification, and claim-scoped evaluation.

## Claim boundary

This proof demonstrates that the existing primitives can reproduce the source selection, hard-cut timing, fit/fill framing, target-guided tone mapping, recreated overlays, transition, and end card for one known edit. It does not demonstrate:

- automatic reconstruction of an arbitrary final edit;
- target soundtrack recovery or reproduction;
- copied target frames, graphics, or audio;
- worker execution inside Vercel;
- a live production Convex control plane; or
- model-driven editing quality.

Broaden the claim only after consent-cleared held-out cases pass an evaluation defined before their targets are inspected.
