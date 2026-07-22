# NodeVideo as a NodeKit Caseflow consumer

NodeVideo consumes the actual packed `@homenshum/nodekit` package. It no longer copies Caseflow
tables, validators, or lifecycle mutations into the host application.

The immutable local candidate is checked in at
`vendor/homenshum-nodekit-0.2.1.tgz`. Its SHA-256, npm integrity, NodeKit source commit, and
distributable source hash are recorded in `vendor/nodekit-package-manifest.json`. The application
installs that tarball through its committed lockfile and imports only supported package surfaces:

```text
@homenshum/nodekit/convex.config.js
@homenshum/nodekit/convex-caseflow
@homenshum/nodekit/test
```

`convex/convex.config.ts` mounts the isolated component. `convex/nodeVideoCaseflow.ts` is a thin
host-owned wrapper: it authenticates the caller, verifies project ownership, derives an opaque
scope key, and then calls the packaged component client. NodeKit never receives an auth token,
organization role, provider credential, raw media file, or hidden evaluation target.

## Data ownership

| Boundary | Owned state | Authority |
| --- | --- | --- |
| Installed NodeKit component | cases, runs, stages, artifact versions, proposals, approvals, exceptions, timeline events, receipts | Portable lifecycle, version checks, idempotent retries, failure containment, receipt integrity |
| NodeVideo host app | `nodeVideoProjects`, `nodeVideoCaseflowBindings`, `sourceOnlyCases`, jobs/stages/events, media artifacts, freeze/evaluation receipts | Identity, tenant/project access, media execution, worker leases, creator review, hidden-target evaluation |
| Worker/evaluator HTTP planes | Existing scoped machine credentials | Domain work only; these credentials cannot impersonate a project owner |

The host binding stores only NodeKit public string IDs. Convex document IDs and component-owned
tables never leak across the component boundary.

## Material lifecycle exercised locally

The deterministic `convex-test` consumer test registers the component from the installed tarball
and drives NodeVideo's real 19-stage workflow shape:

```text
authenticated project
→ source-only case + durable NodeVideo job
→ installed NodeKit case/run
→ render-preview stage
→ versioned NodeVideo edit-plan artifact
→ two same-base proposals
→ creator approval + stale conflict
→ render-worker exception + durable checkpoint
→ blocked-write rejection
→ recovery and resume
→ freeze
→ content-addressed receipt
```

Separate runs prove explicit, retry-safe `cancelled` and `failed_safely` outcomes. Tests also prove
unauthenticated denial, cross-owner denial, different-input idempotency conflicts, whitespace-
normalized retry keys, exact canonical version advancement, and receipt-body recomputation.

## Reproduce the local proof

Prepare a new immutable package candidate only when the NodeKit source tree is ready:

```powershell
npm run nodekit:package
npm install --package-lock-only
```

Commit the package, lockfile, wrapper, tests, and proof scripts. Then run:

```powershell
npm run proof:nodekit-consumer
npx vitest run tests/nodekit-caseflow-proof.test.ts --reporter=verbose
npm test
```

The proof command starts with `npm ci`, then runs lint, application typecheck, Convex function
typecheck, the focused component consumer suite, and the production build. It stores complete logs
and writes `fixtures/proof/nodekit-caseflow-consumer-verdict.json`. The verdict hashes every source,
package, manifest, and command-log evidence file; the proof test recomputes all nested hashes and
rejects missing, duplicate, absolute, escaping, symlinked, or tampered evidence.

## Honest boundary

This is a strong **local component-consumer proof**. It is not a production proof. The verdict must
remain `passed_local_only` until an authorized deployment of the exact tarball is exercised with a
fresh signed-in user, real browser screenshots, export/reopen evidence, and independent ProofLoop
verification. No deployment, npm publication, or Convex submission is authorized by this local
receipt.
