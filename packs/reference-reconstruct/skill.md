# Reference Reconstruction capability

## Purpose

Coordinate the deterministic, case-specific reference-reconstruction graph in `tools/registry.json`. This pack performs no hidden media reasoning and requires no model. It is validated only for the owner-authorized case bound in `evals/authorized-real-v1.json`.

## Required behavior

1. Validate the request against `input.schema.json` before resolving a media locator.
2. Require explicit owner authorization for public derivatives. The authorization is case-specific and cannot be inferred from possession of a file or reused for another case.
3. Resolve raw MOV and target locators only inside the local or CI media worker. Never place local paths, original filenames, location/device/container metadata, signed references, tokens, raw media, or credentials in events, traces, receipts, screenshots, or hosted state.
4. Treat source A and source B as render sources. Treat the final MP4 as `analysis-and-evaluation-only`: it may guide timing, framing, grade parameters, and scoring, but its frames and audio must not be copied into the reconstruction.
5. Use only the two MOVs, their cut source audio, and independently recreated pack graphics to render the reconstruction. Keep the branded tail silent. Do not claim that the unmatched target soundtrack was reconstructed.
6. Run the deterministic tools in dependency order from `tools/registry.json`. Emit immutable events from actual execution and evidence-linked outputs that validate against `output.schema.json`.
7. Strip private container metadata from every published media derivative, then hash and independently decode the exact artifacts that will be served.
8. Preserve the measured claim tier. The authorized case supports `perceptually-close-video`; it does not support “exact,” generic edit autopilot, arbitrary-reference reconstruction, or soundtrack matching.
9. Describe the hosted app as a verified replay of checked-in results. The worker runs locally or in CI; Vercel does not execute this FFmpeg graph.
10. Stop at evidence review. This pack does not silently replace project media, approve publication for a new case, or generalize a single result into a product-wide quality claim.

## Trace behavior

Allow only asset IDs, public aliases, content hashes, tool IDs and versions, non-secret render parameters, frame ranges, output artifact IDs, durations, statuses, metrics, and validation verdicts. Deny media-plane locators, original paths or filenames, source-container metadata, raw frames or audio, authorization secrets, credentials, and hidden reasoning.

## Deterministic order

1. Probe and hash the explicitly bound inputs.
2. Sanitize owner-authorized release derivatives and reject forbidden metadata.
3. Map the known target timeline to the two render sources.
4. Render the source-only reconstruction with recreated graphics and source audio.
5. Render browser proxies, side-by-side evidence, a difference video, and a poster.
6. Evaluate decoded reconstruction video against the target with SSIM, PSNR, and VMAF; exclude target audio.
7. Validate dimensions, frame count, duration, cuts, lineage, artifact hashes, decoding, and disclosure before completing the result.

The checked-in receipt proves this completed sequence for one owner-authorized case. It does not prove an automatic analysis stage for unseen edits.
