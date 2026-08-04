# production-agent.json — declared gaps

`production-agent.json` is filled truthfully. Where the truth violates
`schemas/production-agent.v1.schema.json`, the declaration keeps the truth and
the validation error stands as the open item. Current ajv result: **2 errors,
both in `release`, both intentional**:

1. `release.judgeRegression.trigger` = `"manual"` — the schema only accepts
   `on-commit | on-pr | pre-deploy`. The judge commands (`npm run clip:judge`,
   `npm run coach:test`) exist and run, but nothing in CI triggers them.
   Close by wiring them into a workflow, then set the real trigger.
2. `release.canary.trafficPercent` = `0` — the schema demands a positive
   traffic split. The canary in `.github/workflows/openrouter-free-models.yml`
   is a scheduled probe of the current winner models every 6 hours, not a
   production traffic split; 0% of user traffic is canaried.

   A cookie-sticky traffic canary for the web app was considered and not
   applied: the site is a static Vite multi-page build served by Vercel's Git
   integration (`vercel.json`, no middleware layer, no server that assigns
   cookies). Splitting traffic would require two concurrently served builds
   plus edge middleware (or Vercel's paid canary/skew features) — an
   architecture change, not a workflow change. The model-routing canary is
   the traffic split that is real in this architecture, and it now rolls back
   automatically (below).

Closed 2026-08-04: `release.canary.rollbackMode` is now genuinely
`"automatic"`. When the canary/benchmark step in
`.github/workflows/openrouter-free-models.yml` fails, the workflow runs
`scripts/providers/rollback-routing-manifest.sh`, which restores
`config/openrouter-free-routing.json` from the commit before the last change
and pushes the revert (guards: no prior version → no-op; last change already
a rollback → refuse, to prevent ping-pong). The run still fails loudly.

Post-deploy gate for the web app: `.github/workflows/deploy-verify.yml` runs
on every push to main (the event that makes Vercel's Git integration deploy
production), polls the live URL for the `index.html` title signal via
`scripts/quality/verify-production-deploy.mjs`, and on failure runs
`vercel rollback` when `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`
secrets exist. The production URL is parameterized as
`NODEVIDEO_PRODUCTION_URL` (repo variable/secret or dispatch input) because
it is not determinable from the repo; until it is configured the gate fails
loudly rather than pretending to verify. Known ceiling: the signal is
version-independent, so a stale CDN copy of a previous healthy deploy would
pass; a per-commit build stamp in the HTML is the upgrade path.

Other gaps that validate but are declarations, not measurements:

- **No cross-run circuit breaker.** `runtimeGuards.circuitBreaker` describes
  the only real trip today: a per-run abort after all draft attempts fail
  inside the 82s budget. A provider that is hard-down is still re-attempted by
  every new run. The new bounded backoff (`src/lib/backoff.ts`) slows retries
  within a run only.
- **Golden metrics are targets, not telemetry.** `task-completion-rate`,
  `tool-call-error-rate`, and `p99-latency-ms` are declared with values traced
  to the benchmark gate and the planner time budget, but no production
  pipeline emits these metric names.
- **Per-run token ceiling covers the planner only.** `maxRunTokens` (24000,
  `src/lib/nodeagent-runtime.json`) is enforced in `runDeepPlanner`, where
  usage is visible after each call. The in-browser edit agent does not parse
  `usage` from responses, so its runs are bounded by `maxToolIterations` (8)
  and `max_tokens` (1024) per call, not by an accumulated token counter.
- **Error interception is truncation, not full mediation.** Upstream error
  text can reach the user truncated (120 chars in the browser agent) or as a
  `degradedReason` string in the planner.

Validate offline with:

```
node -e "const Ajv=require('ajv/dist/2020');const a=new (Ajv.default||Ajv)({allErrors:true,strict:false});const v=a.compile(require('./schemas/production-agent.v1.schema.json'));console.log(v(require('./production-agent.json'))?'VALID':JSON.stringify(v.errors,null,2))"
```
