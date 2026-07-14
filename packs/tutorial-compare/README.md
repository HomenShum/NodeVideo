# Tutorial Compare capability pack

Status: `public-worker-validated` for the publication-safe synthetic known-marker profile.

This pack now has a real deterministic worker proof. FFmpeg decoded and normalized two generated videos, PCM onset analysis produced a beat map, a purpose-built extractor measured six color-coded landmarks, deterministic tools aligned and compared the tracks, and FFmpeg rendered playable side-by-side and difference videos plus critical-moment evidence. No model or personal media was used.

That proof is intentionally narrow. The known-marker extractor is not a generic human pose model, the generated pulse track is not production music, and the checked-in bundle is a completed worker run served by the frontend—not FFmpeg executing inside Vercel.

## Public proof

- `fixtures/media/tutorial-compare-v1/receipt.json` records tool versions, source and output hashes, 22 monotonic job events, 10 worker spans, 13 passing in-run checks, and the completed result.
- `fixtures/media/tutorial-compare-v1/result.json` validates against `output.schema.json` and contains the beat map, 240 ms alignment, three critical moments, deterministic fixture coaching, and three seven-frame-per-input burst artifacts.
- The independent verifier checks every receipt media hash, verifies the four videos remain FFprobe-decodable, confirms the receipt verdict and critical-moment count, and checks event ordering.

Run the non-mutating verifier from the repository root with FFprobe available:

```powershell
node scripts/workers/tutorial-compare.mjs --verify-public
```

Regenerating the public proof is a separate developer action and rewrites the public fixture bundle. Because receipts contain measured timestamps and durations, regeneration also requires refreshing the hash binding in `evals/public-worker-v1.json`:

```powershell
node scripts/workers/tutorial-compare.mjs --public
```

## Files

- `manifest.json` declares capability identity, schemas, tools, renderers, boundaries, and validated scope.
- `input.schema.json` validates reference, attempt, optional music, reproducible options, and opaque media-plane access.
- `output.schema.json` defines complete, partial, failed, and cancelled results plus artifact, validation, and provenance contracts.
- `skill.md` defines orchestration and evidence rules without a model prompt.
- `tools/registry.json` records the implemented public tool versions, exact validation strength, lifecycle gaps, and trace redaction policy.
- `evals/public-worker-v1.json` binds the public fixture hashes to observed results and names every excluded claim.

## Execution boundaries

| Boundary | Permitted source | Validation status |
|---|---|---|
| `public-worker` | `public-fixture` only | Passed for the generated PCM/known-marker fixture |
| `private-worker` | Public fixtures or explicitly authorized `private-user-media` | Contract exists; generic human tutorial comparison is not validated |

Media locators are worker capabilities, not durable domain data. Resolve them in the media plane and redact them from checkpoints, traces, logs, artifacts, screenshots, and exported evidence. Control-plane records retain IDs, hashes, tool versions, ranges, status, latency, and artifact IDs only.

Private human-video inspection and reconstruction proofs remain under ignored `.qa/evidence/private/` on the laptop. They prove real codec, rotation, color, cut, and render handling; they do not prove this pack's generic human pose, alignment, coaching, or private tutorial-comparison accuracy.

## Runtime compatibility

The browser imports the checked-in result and receipt, verifies the deployed side-by-side media hash and receipt/result verdicts, then replays immutable `nodevideo.job-event.v1` records through the UI adapter. Local user selection remains preview-only and never uploads bytes. The semantic control plane is still browser-local; Convex has not been activated for production jobs, shared state, leases, retries, or collaboration.

## Remaining gates

Do not broaden the public claim until the matching evidence exists:

1. Evaluate a real human pose implementation on consent-cleared, held-out reference/attempt footage.
2. Evaluate beat/onset behavior on representative production music.
3. Prove private human tutorial comparison entirely in ignored laptop-local evidence before exposing it in UI copy.
4. Implement and test stage retry, semantic cancellation, leases, and checkpoint resume.
5. Deploy and prove the durable Convex control plane and external media-worker execution before describing either as live.
