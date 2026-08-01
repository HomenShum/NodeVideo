# OpenRouter free-model routing runbook

NodeVideo ranks free models on its own structured Creator-planning workload. Generic leaderboards
do not replace this benchmark. Production uses the top two eligible models in
`config/openrouter-free-routing.json`, followed by `openrouter/free` as an availability escape
hatch.

## Automatic triggers

The `OpenRouter free-model routing` GitHub workflow runs every six hours. It fetches the current
OpenRouter catalog and runs one canary scenario against each selected model. A full benchmark runs
when the catalog digest changes, either canary fails, a maintainer forces a run, or an external
monitor emits the `openrouter-health-failure` repository dispatch event.

A full run exercises every discovered zero-cost text model that advertises structured outputs and
`max_tokens`, up to eight candidates, across four Creator personas and two repetitions. Concurrency
is capped at two, each request times out after 25 seconds, and each response is capped at one
megabyte. The workflow stores the detailed report as a 30-day artifact and opens or updates a
promotion PR containing only the routing manifest.

## Promotion and rollback

This is a Class B provider-routing change. Review the generated candidate rows and confirm that each
selected model is eligible before merging. Production changes only after the manifest PR is merged
and deployed. Roll back by reverting that manifest commit; `openrouter/free` remains the final
fallback even when no specific model is eligible.

The benchmark never writes or prints the API key. The repository secret must be named
`OPENROUTER_API_KEY`.

## Manual commands

```bash
npm run openrouter:benchmark
npm run openrouter:benchmark:auto
gh workflow run openrouter-free-models.yml -f force_full=true
```

The local commands require `OPENROUTER_API_KEY` in the process environment. Reports under
`.qa/openrouter-free-models/` are evidence, not committed routing state.
