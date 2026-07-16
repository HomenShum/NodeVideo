#!/usr/bin/env python3
"""Export compact, public-safe pose tracks for the synchronized evidence inspector."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--track", action="append", required=True, metavar="ID=NPZ")
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    args = parse_args()
    tracks = {}
    for binding in args.track:
        track_id, separator, raw_path = binding.partition("=")
        if not separator or track_id in tracks:
            raise ValueError(f"Invalid track binding: {binding}")
        path = Path(raw_path)
        payload = np.load(path)
        times = np.asarray(payload["times"], dtype=np.float64)
        poses = np.asarray(payload["poses"], dtype=np.float32)
        if poses.ndim == 4:
            raise ValueError("Inspector tracks must contain one selected performer")
        if poses.shape[2] == 3:
            xy = poses[:, :, :2]
            visibility = poses[:, :, 2]
        elif poses.shape[2] >= 4:
            xy = poses[:, :, :2]
            visibility = poses[:, :, 3]
        else:
            raise ValueError(f"Unsupported pose shape for {track_id}")
        points = np.concatenate([xy, visibility[:, :, None]], axis=2)
        rounded = np.round(points, 4)
        pose_payload = [
            [
                [float(value) if np.isfinite(value) else None for value in point]
                for point in pose
            ]
            for pose in rounded
        ]
        tracks[track_id] = {
            "sourceSha256": sha256(path),
            "sampleCadenceHz": round(1 / float(np.median(np.diff(times))), 6),
            "times": np.round(times, 4).tolist(),
            "poses": pose_payload,
        }
    artifact = {
        "schemaVersion": "nodevideo.pose-inspector.v1",
        "coordinateSpace": "normalized-frame-top-left-v1",
        "landmarkModel": "MediaPipe Pose Landmarker · 33 landmarks",
        "displayPolicy": "Linear interpolation is display-only; inference cadence remains visible.",
        "tracks": tracks,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(
        (json.dumps(artifact, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
    )
    print(f"Wrote {args.output} with {len(tracks)} tracks")


if __name__ == "__main__":
    main()
