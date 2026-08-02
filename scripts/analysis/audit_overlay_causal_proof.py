#!/usr/bin/env python3
"""Prove that declared text overlays cause the expected rendered-pixel change."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--render", required=True)
    parser.add_argument("--knockout", required=True)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--renderer-manifest", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--minimum-inside-delta", type=float, default=1.0)
    parser.add_argument("--minimum-changed-ratio", type=float, default=0.005)
    parser.add_argument("--maximum-outside-ratio", type=float, default=0.25)
    parser.add_argument("--maximum-inactive-delta", type=float, default=1.5)
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: str) -> dict:
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def overlay_windows(plan: dict) -> list[dict]:
    windows = []
    for track in plan["tracks"]:
        if track["kind"] != "overlay":
            continue
        for clip in track["clips"]:
            if clip["kind"] == "text":
                windows.append(
                    {
                        "clipId": clip["id"],
                        "startFrame": clip["timelineRange"]["startFrame"],
                        "endFrameExclusive": clip["timelineRange"]["endFrameExclusive"],
                    }
                )
    return windows


def normalized_box_to_pixels(box: dict, width: int, height: int) -> tuple[int, int, int, int]:
    x1 = max(0, min(width - 1, int(np.floor(float(box["x"]) * width))))
    y1 = max(0, min(height - 1, int(np.floor(float(box["y"]) * height))))
    x2 = max(x1 + 1, min(width, int(np.ceil((float(box["x"]) + float(box["width"])) * width))))
    y2 = max(y1 + 1, min(height, int(np.ceil((float(box["y"]) + float(box["height"])) * height))))
    return x1, y1, x2, y2


def main() -> None:
    args = parse_args()
    render_path = Path(args.render).resolve()
    knockout_path = Path(args.knockout).resolve()
    plan = load_json(args.plan)
    manifest = load_json(args.renderer_manifest)
    windows = overlay_windows(plan)
    if not windows:
        raise ValueError("Causal overlay proof requires at least one rendered text overlay.")

    placements = {item["clipId"]: item["estimatedGlyphBox"] for item in manifest["textPlacements"]}
    missing = sorted(item["clipId"] for item in windows if item["clipId"] not in placements)
    if missing:
        raise ValueError(f"Renderer manifest is missing text placements: {missing}")

    normal = cv2.VideoCapture(str(render_path))
    knockout = cv2.VideoCapture(str(knockout_path))
    if not normal.isOpened() or not knockout.isOpened():
        raise ValueError("Both normal and knockout renders must decode.")

    width = int(normal.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(normal.get(cv2.CAP_PROP_FRAME_HEIGHT))
    knockout_width = int(knockout.get(cv2.CAP_PROP_FRAME_WIDTH))
    knockout_height = int(knockout.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if (width, height) != (knockout_width, knockout_height):
        raise ValueError("Normal and knockout renders must have identical dimensions.")

    inside_sum = 0.0
    inside_pixels = 0
    inside_changed_pixels = 0
    outside_sum = 0.0
    outside_pixels = 0
    inactive_sum = 0.0
    inactive_pixels = 0
    frame_index = 0
    active_frame_count = 0
    inactive_frame_count = 0

    while True:
        normal_ok, normal_frame = normal.read()
        knockout_ok, knockout_frame = knockout.read()
        if normal_ok != knockout_ok:
            raise ValueError("Normal and knockout renders have different frame counts.")
        if not normal_ok:
            break
        difference = cv2.absdiff(normal_frame, knockout_frame).astype(np.float32).mean(axis=2)
        mask = np.zeros((height, width), dtype=bool)
        for window in windows:
            if window["startFrame"] <= frame_index < window["endFrameExclusive"]:
                x1, y1, x2, y2 = normalized_box_to_pixels(
                    placements[window["clipId"]], width, height
                )
                mask[y1:y2, x1:x2] = True
        if np.any(mask):
            active_frame_count += 1
            inside = difference[mask]
            outside = difference[~mask]
            inside_sum += float(inside.sum())
            inside_pixels += int(inside.size)
            inside_changed_pixels += int(np.count_nonzero(inside >= 8.0))
            outside_sum += float(outside.sum())
            outside_pixels += int(outside.size)
        else:
            inactive_frame_count += 1
            inactive_sum += float(difference.sum())
            inactive_pixels += int(difference.size)
        frame_index += 1

    normal.release()
    knockout.release()
    if frame_index == 0 or active_frame_count == 0:
        raise ValueError("Causal overlay proof decoded no active overlay frames.")

    mean_inside_delta = inside_sum / max(1, inside_pixels)
    mean_outside_delta = outside_sum / max(1, outside_pixels)
    mean_inactive_delta = inactive_sum / max(1, inactive_pixels)
    changed_inside_ratio = inside_changed_pixels / max(1, inside_pixels)
    outside_to_inside_ratio = mean_outside_delta / max(mean_inside_delta, 1e-9)
    checks = [
        {
            "id": "declared-region-changed",
            "passed": mean_inside_delta >= args.minimum_inside_delta,
            "observed": mean_inside_delta,
            "threshold": args.minimum_inside_delta,
        },
        {
            "id": "visible-pixel-coverage",
            "passed": changed_inside_ratio >= args.minimum_changed_ratio,
            "observed": changed_inside_ratio,
            "threshold": args.minimum_changed_ratio,
        },
        {
            "id": "change-is-region-local",
            "passed": outside_to_inside_ratio <= args.maximum_outside_ratio,
            "observed": outside_to_inside_ratio,
            "threshold": args.maximum_outside_ratio,
        },
        {
            "id": "inactive-frames-stable",
            "passed": mean_inactive_delta <= args.maximum_inactive_delta,
            "observed": mean_inactive_delta,
            "threshold": args.maximum_inactive_delta,
        },
    ]
    passed = all(check["passed"] for check in checks)
    output = {
        "schemaVersion": "nodevideo.overlay-causal-proof.v1",
        "status": "pass" if passed else "fail",
        "normalRenderSha256": sha256_file(render_path),
        "knockoutRenderSha256": sha256_file(knockout_path),
        "frameCount": frame_index,
        "activeFrameCount": active_frame_count,
        "inactiveFrameCount": inactive_frame_count,
        "metrics": {
            "meanInsideDelta": mean_inside_delta,
            "changedInsideRatio": changed_inside_ratio,
            "meanOutsideDelta": mean_outside_delta,
            "outsideToInsideRatio": outside_to_inside_ratio,
            "meanInactiveDelta": mean_inactive_delta,
        },
        "checks": checks,
        "overlayClipIds": [item["clipId"] for item in windows],
    }
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    if not passed:
        failed = ", ".join(check["id"] for check in checks if not check["passed"])
        raise ValueError(f"Overlay causal proof failed: {failed}")


if __name__ == "__main__":
    main()
