# Render metrics V2

`render-metrics-v2.mjs` emits the `nodevideo.render-metrics.v1` contract consumed by
`edit-plan-adjudicator-lib.mjs`. It measures decoded output rather than trusting a render receipt.

```powershell
node scripts/quality/render-metrics-v2.mjs `
  --render .qa/evidence/private/render-v2.mp4 `
  --reference fixtures/media/authorized-real-v1/target-web.mp4 `
  --plan .qa/evidence/private/edit-plan-v2.json `
  --source-a fixtures/media/authorized-real-v1/source-a-web.mp4 `
  --source-b fixtures/media/authorized-real-v1/source-b-web.mp4 `
  --output .qa/evidence/private/render-metrics-v2.json
```

The permanent 482–589 frame clip is a separate plan-derived window. For `fit` clips, the scorer
derives the visible contain rectangle from the bound source dimensions. A 16:9 source on the
720×1280 canvas therefore scores the 720×406 center foreground instead of letting the 68% black
padding dominate. An explicit `roi` in a window document is also accepted. Reference
`cropdetect` is a fail-closed fallback when a fit source binding is unavailable.

`audio.referenceCorrelation` compares the rendered and target mono waveforms over the music range
(0–40,338.6 ms by default) with a bounded alignment search. `audio.sourceLeakageCorrelation` is
the maximum absolute correlation across every plan-mapped source window. It is `null` if mapped
coverage is incomplete. A private precomputed leakage file is accepted only when it uses
`nodevideo.source-leakage-measurement.v1`, covers every mapped frame, and is bound to the rendered
file's SHA-256.

This is a target/reference fidelity measurement, not an independent released-master comparison.
Music identity and released-master offset remain separate provenance evidence. The technical gate
also records FFmpeg EBU R128 integrated loudness and enforces a true-peak ceiling of `-1 dBFS`.
