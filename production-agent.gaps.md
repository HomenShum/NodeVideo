# production-agent.json — declared gaps

`production-agent.json` is filled truthfully. Where the truth violates
`schemas/production-agent.v1.schema.json`, the declaration keeps the truth and
the validation error stands as the open item. Current ajv result: **3 errors,
all in `release`, all intentional**:

1. `release.judgeRegression.trigger` = `"manual"` — the schema only accepts
   `on-commit | on-pr | pre-deploy`. The judge commands (`npm run clip:judge`,
   `npm run coach:test`) exist and run, but nothing in CI triggers them.
   Close by wiring them into a workflow, then set the real trigger.
2. `release.canary.trafficPercent` = `0` — the schema demands a positive
   traffic split. The canary in `.github/workflows/openrouter-free-models.yml`
   is a scheduled probe of the current winner models every 6 hours, not a
   production traffic split; 0% of user traffic is canaried.
3. `release.canary.rollbackMode` = `"manual"` — the schema requires
   `automatic`. When a canary fails, a maintainer re-runs the benchmark and
   commits new routing; no automatic rollback exists.

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
