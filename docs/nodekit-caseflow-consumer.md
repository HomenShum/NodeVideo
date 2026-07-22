# NodeKit Caseflow consumer boundary

NodeVideo consumes the supported `@homenshum/nodekit/caseflow` entry point from the immutable
NodeKit source revision `5cc61578b3c1bd5b5c8195b83347b91f8b83242b`. The dependency is an exact
GitHub source archive, not a mutable package version. The packaged `runCaseflowConformance()` suite
runs against NodeVideo's Convex-backed adapter in
`tests/nodekit-caseflow-conformance.test.ts`.

This adoption does not replace NodeVideo's working source-only workflow. The existing
`sourceOnlyCases`, `jobs`, `jobStages`, `jobEvents`, domain `artifacts`, domain `proposals`, freeze
receipts, evaluation receipts, stage leases, worker routes, and evaluator routes remain the
application's execution spine. `startProjectCaseflow` calls the same extracted record helpers used
by the existing internal `workflow.createCase` and `workflow.startJob` mutations, then records typed
external references from the portable lifecycle to those real records in the same Convex
transaction.

## Data ownership

| Boundary | Tables/data | Authority |
| --- | --- | --- |
| Candidate component-owned Caseflow state | `caseflowCases`, `caseflowRuns`, `caseflowArtifacts`, `caseflowArtifactVersions`, `caseflowProposals`, `caseflowApprovals`, `caseflowExceptions`, `caseflowReceipts`, `caseflowEvents`, `caseflowExternalRefs` | Portable lifecycle, optimistic version checks, retry-safe decisions, exception recovery, explicit next-action owner, immutable content-addressed receipts |
| NodeVideo app-owned authorization | `nodeVideoProjects`, `nodeVideoCaseflowBindings`, Convex `ctx.auth` identity | Project ownership, tenant isolation, idempotency scope, and binding a portable case/run to domain records |
| NodeVideo app-owned domain workflow | `sourceOnlyCases`, `caseAssets`, `jobs`, `jobStages`, `jobEvents`, `artifacts`, `proposals`, `freezeReceipts`, `evaluationReceipts`, media in Convex storage | Video inputs, stage leases/checkpoints, worker artifacts, creator review, freeze boundary, hidden-target evaluation, media lineage |
| Machine credentials | `NODEVIDEO_WORKER_TOKEN`, `NODEVIDEO_EVALUATION_TOKEN` on the existing HTTP planes | Worker and evaluator operations only; neither credential grants project-owner authority |

The portable records intentionally contain no auth subject, organization membership, raw media,
provider credential, hidden evaluator target, or arbitrary application payload. The app-owned
binding is the only record that knows both an authenticated project and the corresponding portable
and domain IDs.

## Authenticated host wrapper

`convex/nodeVideoCaseflow.ts` is the application boundary. It requires `ctx.auth` for every public
operation, derives the stable identity from `tokenIdentifier` (or issuer plus subject), loads the
project, and fails closed unless that identity owns the project. A caller-provided `projectId` is a
locator, never authority.

The wrapper exposes:

- `createProject`, which binds a project to the authenticated identity;
- `startProjectCaseflow`, which atomically creates or reuses the domain case/job and portable
  case/run under an owner-scoped idempotency key;
- `readProjectCaseflow`, which returns only the owned binding and its linked domain state;
- `decideProjectProposal`, which checks ownership before a human decision; and
- `resolveProjectException`, which checks ownership before resuming a blocked run.

The generic adapter functions in `convex/caseflowRuntime.ts` are internal Convex functions. They are
not added to the owner-token, worker-token, or evaluator-token HTTP surfaces.

## Verified behavior

The `convex-test` suite uses a real transactional in-memory Convex backend and the packaged NodeKit
runner. It covers:

- every assertion in `runCaseflowConformance()`, including repeat active start, repeat matching
  decision, and repeat completion with the exact original receipt;
- unauthenticated and cross-owner denial;
- application-level duplicate start reuse and different-input idempotency conflict;
- same-base proposal races, one canonical version advance, and stale conflict without overwrite;
- exception checkpoint persistence, reload, resolution, and resume;
- reload/snapshot from a newly constructed adapter over the same database; and
- recomputation of the receipt content hash plus fail-closed detection of stored receipt tampering.

Run locally:

```powershell
npm ci
npm run typecheck
npx tsc -p convex/tsconfig.json --noEmit --pretty false
npx vitest run tests/nodekit-caseflow-conformance.test.ts --reporter=verbose
npm run build
```

No deployment or package publication is part of this consumer proof. The checked-in verdict at
`fixtures/proof/nodekit-caseflow-consumer-verdict.json` identifies the exact NodeKit revision,
consumer source identity, commands, assertions, and its own content hash.
