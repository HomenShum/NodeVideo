# Media proof fixtures

`nodevideo-proof-v1.mp4` is generated entirely from FFmpeg's `testsrc2` and
`sine` filters. It contains no uploaded or personal media and is safe for
public demos, screenshots, and automated tests.

Generate and verify it from the repository root:

```sh
node scripts/media/generate-synthetic-fixture.mjs
```

The six-second, 720×1280, 30 fps fixture deliberately exercises:

- landscape-to-portrait **fit** geometry;
- center-cropped **fill** geometry;
- hard cuts at frames 45, 90, and 135;
- a frozen/dimmed geometric end card; and
- a five-second synthetic tone followed by a one-second silent video tail.

The adjacent `nodevideo-proof-v1.proof.json` records the file hash, structural
metadata, public-safe recipe, and deterministic assertions. Byte hashes can
change with a different FFmpeg build, while the asserted media contract must
remain stable.

Personal media, thumbnails, private reconstruction candidates, and any other
derived evidence belong only in `.qa/evidence/private/`, which is ignored.
