# Tutorial Compare capability

## Purpose

Coordinate the deterministic tutorial-comparison worker graph defined by `tools/registry.json`. This pack interprets no natural language, calls no model, and performs no frame or media mathematics itself.

The pack is `public-worker-validated` only for the generated PCM and known-color-marker profile recorded in `evals/public-worker-v1.json`. Treat private human-video comparison, generic pose, production music, remote execution, and durable control-plane behavior as unvalidated.

## Required behavior

1. Validate the request against `input.schema.json` before resolving any media locator.
2. Enforce the execution boundary. A `public-worker` accepts only `public-fixture` assets. `private-user-media` requires a `private-worker` and must never enter public CI, hosted previews, or public evidence.
3. Resolve locators only inside the media plane. Never copy signed references, worker-local tokens, local paths, filenames, object URLs, media bytes, or credentials into events, traces, logs, or artifacts.
4. Run tools according to the dependencies in `tools/registry.json`. Parallelize only dependency-independent deterministic work.
5. Emit immutable job events from actual tool execution. The current public frontend replays a checked-in completed receipt; it must not describe that replay as a worker running inside Vercel.
6. Emit outputs that validate against `output.schema.json`. Every claim must link to tool-versioned evidence from the supplied asset hashes.
7. Treat deterministic coaching rules as a presentation of measured differences. For the validated public profile, “pose” means six synthetic color landmarks; never relabel it as generic human pose evidence.
8. A failed or unvalidated result cannot be marked `completed`. Partial-artifact recovery is a production target and is not proven by the completed public fixture.
9. The current worker supports a full-run restart only. It has no stage retry, semantic cancellation, durable lease, or checkpoint resume; surrounding runtimes must not fabricate those receipts.
10. Stop at review. This pack may recommend outputs; it does not silently mutate a project recipe or accept a proposal.

## Trace behavior

Record only the allowlisted metadata in `tools/registry.json`. A trace may explain the plan, tool status, evidence, and validation verdict, but must not expose hidden reasoning or media-plane capabilities.

## Target progressive order

The dependency order for a future streaming runtime is:

1. Normalized media enables a comparison preview.
2. A validated beat map enables timeline markers.
3. Validated profile-specific landmarks and alignment enable moment and difference evidence.
4. Validated differences enable critical bursts and deterministic coaching.
5. Independent validation is required before a result is `completed`.

The checked-in public proof validates the completed graph. It does not prove progressive remote artifact delivery.
