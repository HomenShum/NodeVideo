# NodeVideo as a NodeKit Caseflow consumer

NodeVideo specializes the video artifact while consuming the shared NodeKit lifecycle:

```text
Case → Run → Stage → ArtifactVersion → Proposal → Approval → Receipt
```

## Ownership

| Lane | Shared contract | NodeVideo specialization |
| --- | --- | --- |
| Components | Case header, progress, current action, proposal review, receipt view | source vault, video canvas, timeline, variant comparison |
| Server | durable thread, proposal/approval state, timeline events | creator planner API and executor routing |
| Database | cases, runs, messages, versions, approvals, exceptions, receipts | video campaign snapshots and executor manifests |
| Integration | exact-digest approval and proof boundaries | browser FFmpeg and Higgsfield adapters |

The creator surface is described as an **agent-workspace composition**. It does not claim runtime
parity with NodeRoom or NodeSlide.

## Golden journey

1. Create the founder-launch case and durable run.
2. Attach one local source and choose 16:9, 9:16, and 1:1 destinations.
3. Optionally send prompt, transcript, and source metadata—not raw media—to OpenRouter Free.
4. Validate the returned JSON and compile it into typed local operations.
5. Persist a proposal against the exact canonical artifact version.
6. Approve or reject the exact proposal digest.
7. Render approved variants locally and reopen the MP4.
8. If a specialist shot is useful, show a Higgsfield quote and media-egress manifest.
9. Require an exact quote-digest approval before a provider job may be submitted.
10. Persist the output hash and consumer receipt.

## Invariants

- Browser-local storage contains only the opaque case locator; messages and proposal content live in Convex.
- Free Router consent off means zero external requests.
- Malformed planner output is rejected and falls back visibly to deterministic planning.
- No proposal acceptance means no canonical artifact change.
- Approval is exactly once and tied to a proposal digest and base version.
- A stale acceptance becomes a conflict and preserves the canonical artifact.
- A changed executor quote invalidates prior approval.
- Approving an executor quote does not submit a job or spend credits.
- The local renderer remains available as the zero-egress alternative.

## Executor boundary

```text
discover capability
→ create input manifest
→ disclose egress
→ quote exact credits
→ approve quote digest
→ submit provider job
→ poll
→ retrieve output
→ import locally
→ validate
→ issue receipt
```

The repository proves discovery, manifest creation, disclosure, quote approval, approval
invalidation, and local fallback. Automatic paid submission remains impossible; the explicit
submission mutation fails closed unless the current quote digest has been approved.
