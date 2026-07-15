#!/usr/bin/env python3
"""Regression assertions for the authorized sanitized fixture.

This validator contains expected facts; the analyzer itself contains none of
them.  It is intentionally separate so the 16.067-19.633 failure cannot regress
behind a strong whole-frame average.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


EXPECTED_CUTS = [201, 482, 589, 753, 1214, 1215]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_dir", type=Path)
    return parser.parse_args()


def main() -> None:
    output_dir = parse_args().output_dir
    understanding = json.loads((output_dir / "edit-understanding.json").read_text(encoding="utf-8"))
    plan = json.loads((output_dir / "edit-plan.json").read_text(encoding="utf-8"))
    evidence = json.loads((output_dir / "analysis-evidence.json").read_text(encoding="utf-8"))
    assert evidence["sceneDetection"]["finalCutFrames"] == EXPECTED_CUTS
    video_track = next(track for track in plan["tracks"] if track["kind"] == "video")
    clips = video_track["clips"]
    assert [clip["kind"] for clip in clips] == [
        "source",
        "source",
        "source",
        "source",
        "source",
        "black",
        "freeze",
    ]
    critical = next(
        clip for clip in clips if clip["timelineRange"] == {"startFrame": 482, "endFrameExclusive": 589}
    )
    assert critical["assetId"].startswith("asset.source-a")
    assert critical["sourceRange"] == {"startFrame": 942, "endFrameExclusive": 1049}
    assert critical["sourceRange"]["startFrame"] - 866 == 76
    assert understanding["audio"]["beatGrid"]["beatsMs"]
    assert plan["lineage"]["evaluationOnlyAssetIds"] == ["asset.reference-target"]
    print(json.dumps({"status": "pass", "cuts": EXPECTED_CUTS, "criticalSourceStartFrame": 942}))


if __name__ == "__main__":
    main()
