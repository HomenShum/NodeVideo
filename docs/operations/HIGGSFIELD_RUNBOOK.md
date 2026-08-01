# Higgsfield promotion and provider runbook

The official provider is optional. NodeVideo never equates a marketing banner with an API/CLI entitlement.

## Connect

1. Complete sign-in yourself in the official Higgsfield browser tab or run `higgsfield auth login`.
2. Run `npm run higgsfield:doctor` and `npm run higgsfield:models -- video`.
3. Capture an entitlement snapshot: plan, credits, promotion expiry, eligible surfaces/models, concurrency, watermark, renewal, and limitations.
4. If the free offer is web-only, keep CLI/MCP cost policy unchanged.

## Propose and execute

Create a request JSON containing job type, prompt, parameters, owned reference IDs, and:

```json
{
  "rights": {
    "sourceAssetsOwned": true,
    "mediaEgressApproved": true
  }
}
```

Then run:

```powershell
npm run higgsfield:run -- .qa/requests/higgsfield/request.json .qa/evidence/higgsfield/run-001
```

The first run writes a cost estimate and proposal, then stops. Review both before executing:

```powershell
$env:HIGGSFIELD_GENERATION_APPROVED='1'
npm run higgsfield:run -- .qa/requests/higgsfield/request.json .qa/evidence/higgsfield/run-001
```

The adapter records the provider job before waiting, downloads outputs, hashes/probes them, and emits pending-rights receipts. It does not make them public.

## Benchmark

```powershell
npm run higgsfield:benchmark:plan
# execute every queued case three times and collect receipt-backed evaluator scores
npm run higgsfield:benchmark:score -- .qa/evidence/higgsfield/benchmark-results.json
```

Route by brief (human motion, product ad, founder, spatial world, etc.). Keep failures and artifact rates in the report.

## Public release

Only after human rights review:

```powershell
$env:NODEVIDEO_PUBLIC_ASSET_APPROVED='1'
npm run asset:approve -- path/to/output.receipt.json
npm run showcase:build
```

Never publish synthetic people as real people, third-party marks, unlicensed music, or reference-derived material whose rights are uncertain.
