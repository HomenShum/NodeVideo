# Tutorial comparison worker

The worker is an isolated deterministic media-plane CLI. It reuses the repository's FFmpeg,
FFprobe, hashing, probing, atomic proof-writing, and privacy-containment utilities.

Generate the public, synthetic paired-media proof:

```powershell
npm run worker:public
npm run worker:verify
```

Run against two private local files without uploading them:

```powershell
$env:NODEVIDEO_REFERENCE_INPUT='D:\media\reference.mp4'
$env:NODEVIDEO_ATTEMPT_INPUT='D:\media\attempt.mp4'
npm run worker:private
```

Private outputs are forcibly contained under ignored `.qa/evidence/private/`. Receipts use
asset IDs and SHA-256 digests; they do not contain source paths or private filenames. The
public proof uses generated color-coded landmarks so pose extraction has known ground truth.
It demonstrates the worker and orchestration contract, not general human-pose accuracy.
