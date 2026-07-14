# Deterministic media proof tooling

These scripts are dependency-free Node entry points that call local `ffmpeg`
and `ffprobe` binaries. They keep public synthetic fixtures separate from
private evidence and reconstruction derivatives.

## Public synthetic fixture

```sh
node scripts/media/generate-synthetic-fixture.mjs
```

This creates and verifies:

- `fixtures/media/nodevideo-proof-v1.mp4`
- `fixtures/media/nodevideo-proof-v1.proof.json`

The media is generated only from FFmpeg `lavfi` sources. The script refuses to
write outside `fixtures/media/`.

## Private metadata and recipe verification

```sh
node scripts/media/inspect-private-media.mjs
```

Set explicit paths for the three private inputs without editing the script. The
tool intentionally has no filename or Downloads-directory defaults, so private
file metadata cannot enter Git by accident:

```powershell
$env:NODEVIDEO_RAW_TAKE_A='D:\media\take-a.mov'
$env:NODEVIDEO_RAW_TAKE_B='D:\media\take-b.mov'
$env:NODEVIDEO_REFERENCE_OUTPUT='D:\media\reference.mp4'
node scripts/media/inspect-private-media.mjs
```

The inspector writes only
`.qa/evidence/private/private-media-evidence.json`. The report contains aliases,
SHA-256 hashes, sanitized stream metadata, geometry measurements, and assertion
results. It never records source paths and never writes decoded frames.

It verifies:

- coded dimensions and the raw clips' `-90` degree rotation tags;
- 10-bit HLG/BT.2020 input and 8-bit BT.709 output metadata;
- duration, frame rate, frame count, and audio tail;
- fit/fill state immediately before and after each inferred cut;
- the fitted band near `y=437..842` and the dim/frozen end card; and
- that no private input hash or filename appears in deployable directories.

## Optional private reconstruction

```sh
node scripts/media/render-private-reconstruction.mjs
```

The same three input environment variables are required for reconstruction.

The candidate and proof JSON are forcibly contained under
`.qa/evidence/private/`. The renderer applies explicit HLG-to-SDR tone mapping,
uses the five inferred source ranges and fit/fill transforms, mutes the raw clip
audio, carries the continuous reference audio, and builds a generic geometric
end card. It is a local reconstruction baseline, not a public fixture and not a
claim that the original edit project has been recovered.

You may change its filename only with a path that still resolves inside the
private evidence directory:

```powershell
$env:NODEVIDEO_PRIVATE_RECONSTRUCTION_OUTPUT='.qa\evidence\private\candidate-v2.mp4'
node scripts/media/render-private-reconstruction.mjs
```

If FFmpeg is not on `PATH`, set `FFMPEG_PATH` and `FFPROBE_PATH` to the desired
binaries. Any failed assertion makes the corresponding script exit non-zero
after writing its JSON proof.
