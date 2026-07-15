#!/usr/bin/env python3
"""Hard regression for the authorized soundtrack-fidelity plan.

Expected case facts live here, never in the generic analyzer/compiler.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


EXPECTED_EVENTS = [
    ("music", 0.0, 40338.6),
    ("silence", 40338.6, 40837.3),
    ("sting", 40837.3, 42153.5),
    ("silence", 42153.5, 44500.0),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_dir", type=Path)
    output_dir = parser.parse_args().output_dir
    understanding = json.loads((output_dir / "edit-understanding.json").read_text(encoding="utf-8"))
    plan = json.loads((output_dir / "edit-plan.json").read_text(encoding="utf-8"))

    selected_id = understanding["audio"]["selectedMusicAssetId"]
    selected = next(
        candidate
        for candidate in understanding["audio"]["musicCandidates"]
        if candidate["assetId"] == selected_id
    )
    assert selected["identity"] == {
        "title": "Sign",
        "artist": "82MAJOR",
        "isrc": "KRA382601866",
    }
    assert selected["excerpt"]["sourceOffsetMs"] == 0.0
    assert selected["excerpt"]["releasedMasterOffsetMs"] == 29146.0
    assert selected["excerpt"]["releasedMasterGainDb"] == -6.12

    actual_events = [
        (event["kind"], event["targetStartMs"], event["targetEndMs"])
        for event in plan["audio"]["events"]
    ]
    assert actual_events == EXPECTED_EVENTS
    music = next(event for event in plan["audio"]["events"] if event["kind"] == "music")
    assert music["sourceOffsetMs"] == 0.0
    assert music["releasedMasterOffsetMs"] == 29146.0
    assert music["gainDb"] == 0.0
    assert music["releasedMasterGainDb"] == -6.12

    source_routes = [
        route for route in plan["audio"]["routing"] if route["sourceKind"] == "asset-audio"
    ]
    assert len(source_routes) == 2
    assert all(route["sourceId"].startswith("asset.source-") for route in source_routes)
    assert all(route["muted"] is True and route["gainDb"] == -120.0 for route in source_routes)
    assert selected_id in plan["lineage"]["targetDerivedRenderAssetIds"]
    assert selected_id in plan["lineage"]["renderAssetIds"]
    assert "asset.reference-target" not in plan["lineage"]["renderAssetIds"]
    assert (output_dir / "music-target-derived.m4a").is_file()
    print(
        json.dumps(
            {
                "status": "pass",
                "events": actual_events,
                "sourceOffsetMs": 0.0,
                "releasedMasterOffsetMs": 29146.0,
                "renderGainDb": 0.0,
                "releasedMasterGainDb": -6.12,
            }
        )
    )


if __name__ == "__main__":
    main()
