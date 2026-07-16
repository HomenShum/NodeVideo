# Embodied Grounding capability pack

Status: `adapter-implementations-unit-validated`; the formal public-fixture pack replay remains unexecuted.

This pack defines the narrow visual-grounding boundary used by choreography alignment, crop safety, and body-aware caption placement. It does not choose an AI vendor and does not require a model: deterministic local, local-model, remote-model, and manual adapters all implement the same `LocateRequest`, `LocateResult`, and `GroundingHealth` contract.

`src/lib/visual-grounding.ts` implements LocateAnything HTTP, manual, disabled, and deterministic replay providers behind the same provider-neutral contract. Focused tests execute all six result statuses, coordinate normalization, license fail-closed behavior, trace/asset binding, and the no-invented-confidence rule. The HTTP path is tested with a mock transport; no live LocateAnything service, localization-accuracy benchmark, or formal public-fixture pack receipt is claimed. `evals/replay-v1.json` therefore remains explicitly unexecuted.

## Contract

`nodevideo.locate-request.v1` contains request identity, the media identity pair `traceId + assetId`, one bounded text query, task/output/cardinality, and optional frame/result limits. It has no field for a path, URL, signed locator, token, media bytes, provider payload, thumbnail, or visual-prompt asset.

`LocateResult.status` is one of:

- `valid`: at least one adapter observation passed validation;
- `ambiguous`: one or more plausible observations require review;
- `malformed`: an adapter response could not be parsed into the contract;
- `empty`: the adapter completed but found no admissible region;
- `failed`: execution failed before an admissible result existed; or
- `manual`: reviewed normalized geometry replaced or resolved automation and carries no provider-reported confidence.

Every observation is a normalized point or box: the top-left of the decoded, rotation-corrected frame is `(0, 0)` and the bottom-right is `(1, 1)`. Boxes are `x`, `y`, `width`, `height`. The semantic validator rejects non-finite values, coordinates outside `[0, 1]`, non-positive size, `x + width > 1`, `y + height > 1`, request/result identity mismatch, geometry that disagrees with the requested output kind, and single-cardinality valid results with more than one observation.

`nodevideo.locate-health.v1` reports provider identity, availability, boxes/points, text-prompt capability, and `visualPrompt: false`. An active LocateAnything-compatible provider must report `textPrompt: true`; manual or disabled providers may honestly report false. `licenseBoundary` always discloses separate adapter-code and model-weight license references plus whether the operator accepted them. An adapter may internally use provider-specific machinery, but callers cannot attach an image as a prompt or rely on vendor-native coordinates or raw provider responses.

## Privacy and trace boundary

The media worker resolves an asset binding after input validation. Durable events and traces may contain request, run, trace, asset, region, evidence, adapter, and artifact IDs; normalized derived geometry; bounded status/diagnostic codes; confidence; versions; hashes; and latency. They must not contain raw frames, thumbnails, media bytes, locators, URLs, paths, filenames, credentials, vendor request/response bodies, free-form prompts, or hidden reasoning.

Remote visual egress is valid only after the surrounding worker admission policy authorizes both the asset and visual egress. Those media-plane capabilities deliberately do not enter `LocateRequest`. Public-fixture execution accepts only publication-safe fixtures.

## Rights boundary

The worker binding requires an authorization attestation before processing, outside the locator-free request. Health also requires separate code/model license references and an acceptance flag. The pack does not determine ownership, clear likeness or biometric rights, grant a copyright or model license, or certify that an attestation is legally sufficient.

## Files

- `manifest.json` declares the capability, focused unit proof, and remaining live-provider boundary.
- `input.schema.json` defines `nodevideo.locate-request.v1` with a text query and trace/asset media identity only.
- `output.schema.json` defines `nodevideo.locate-result.v1`, normalized regions, failure rules, and `nodevideo.locate-health.v1`.
- `skill.md` defines orchestration, fallback, and redaction behavior.
- `tools/registry.json` defines the adapter and validator semantics.
- `evals/replay-v1.json` defines the unexecuted six-status replay matrix.

Do not describe this contract as production grounding accuracy until an adapter passes consent-cleared held-out geometry and failure-mode evaluations.
