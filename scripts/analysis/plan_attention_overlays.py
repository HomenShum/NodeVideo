#!/usr/bin/env python3
"""Plan reusable body-safe timed text overlays on an existing NodeVideo EditPlan."""

from __future__ import annotations

import argparse
import bisect
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

from audit_overlay_body_clearance import (
    body_mask,
    overlap_ratio,
    pose_tracks,
    source_clip_at,
    source_frame,
    source_sizes,
    transform_points,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--cues", type=Path, required=True)
    parser.add_argument("--pose", action="append", default=[], metavar="ASSET_ID=TRACK.npz")
    parser.add_argument("--source-size", action="append", default=[], metavar="ASSET_ID=WIDTHxHEIGHT")
    parser.add_argument("--output-plan", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--max-overlap-ratio", type=float, default=0.05)
    parser.add_argument("--pose-max-gap-frames", type=int, default=5)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_cues(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    cues = payload.get("cues", payload.get("lyricCues")) if isinstance(payload, dict) else payload
    if not isinstance(cues, list) or not cues:
        raise ValueError("Timed text input must contain a non-empty cues array.")
    result = []
    for index, cue in enumerate(cues):
        if not isinstance(cue, dict):
            raise ValueError(f"cues[{index}] must be an object.")
        text = str(cue.get("text", "")).strip()
        start = float(cue.get("startSeconds", -1))
        end = float(cue.get("endSeconds", -1))
        role = cue.get("role", "attention")
        if not text or start < 0 or end <= start or role not in {"attention", "identity"}:
            raise ValueError(f"cues[{index}] has invalid text, timing, or role.")
        result.append(
            {
                "id": str(cue.get("id", f"cue.{index + 1}")),
                "text": text,
                "startSeconds": start,
                "endSeconds": end,
                "role": role,
                "animation": cue.get("animation", "pop" if role == "attention" else "fade"),
            }
        )
    return result


def nearest_pose(track: dict[int, np.ndarray], frame: int, max_gap: int) -> np.ndarray | None:
    direct = track.get(frame)
    if direct is not None:
        return direct
    frames = sorted(track)
    index = bisect.bisect_left(frames, frame)
    candidates = frames[max(0, index - 1): min(len(frames), index + 1)]
    if not candidates:
        return None
    nearest = min(candidates, key=lambda value: abs(value - frame))
    return track[nearest] if abs(nearest - frame) <= max_gap else None


def candidate_boxes(cue: dict[str, Any]) -> list[dict[str, float]]:
    if cue["role"] == "identity":
        width, height = 0.27, 0.045
    else:
        length = len(cue["text"])
        width = 0.30 if length <= 10 else 0.36 if length <= 16 else 0.42
        height = 0.075
    x_positions = sorted({0.03, round((1 - width) / 2, 6), round(0.97 - width, 6)})
    y_positions = [0.05, 0.18, 0.32, 0.46, 0.60, 0.74, 0.87]
    return [
        {"x": x, "y": y, "width": width, "height": height}
        for y in y_positions
        for x in x_positions
    ]


def timeline_pose_samples(
    *,
    start: int,
    end: int,
    video_clips: list[dict[str, Any]],
    tracks: dict[str, dict[int, np.ndarray]],
    sizes: dict[str, tuple[int, int]],
    canvas: dict[str, int],
    max_gap: int,
) -> list[tuple[int, np.ndarray]]:
    samples = []
    for timeline_frame in range(start, end):
        clip = source_clip_at(video_clips, timeline_frame)
        if not clip or clip.get("kind") not in {"source", "freeze"}:
            continue
        asset_id = clip.get("assetId")
        if asset_id not in tracks:
            continue
        frame = source_frame(clip, timeline_frame)
        if frame is None:
            continue
        pose = nearest_pose(tracks[asset_id], frame, max_gap)
        if pose is None:
            continue
        if not np.any(np.isfinite(pose[..., 0]) & np.isfinite(pose[..., 1]) & (pose[..., 3] >= 0.3)):
            continue
        transformed = transform_points(
            pose,
            clip,
            canvas,
            sizes.get(asset_id, sizes["__default__"]),
        )
        samples.append((timeline_frame, transformed))
    return samples


def center(box: dict[str, float]) -> np.ndarray:
    return np.asarray([box["x"] + box["width"] / 2, box["y"] + box["height"] / 2])


def primary_pose(poses: np.ndarray) -> np.ndarray:
    pose_set = poses[np.newaxis, ...] if poses.ndim == 2 else poses
    ranked = []
    for pose in pose_set:
        visible = np.isfinite(pose[:, 0]) & np.isfinite(pose[:, 1]) & (pose[:, 3] >= 0.3)
        if np.count_nonzero(visible) < 4:
            continue
        points = pose[visible, :2]
        extent = np.ptp(points, axis=0)
        area = float(extent[0] * extent[1])
        centroid = np.mean(points, axis=0)
        centrality = max(0.1, 1 - float(np.linalg.norm(centroid - np.asarray([0.5, 0.5]))))
        confidence = float(np.nanmean(pose[visible, 3]))
        ranked.append((confidence * (0.25 + area) * centrality, pose))
    if not ranked:
        raise ValueError("No visible primary pose is available for gesture affinity.")
    return max(ranked, key=lambda item: item[0])[1]


def landmark_xy(pose: np.ndarray, index: int, fallback: np.ndarray) -> np.ndarray:
    point = pose[index, :2]
    if pose[index, 3] >= 0.3 and np.all(np.isfinite(point)):
        return point
    return fallback


def plan_cue(
    cue: dict[str, Any],
    poses: list[tuple[int, np.ndarray]],
    previous_center: np.ndarray | None,
    threshold: float,
    canvas: dict[str, int] | None = None,
) -> tuple[dict[str, float], dict[str, Any], np.ndarray]:
    canvas = canvas or {"width": 720, "height": 1280}
    audit_width = 360
    audit_height = round(audit_width * canvas["height"] / canvas["width"])
    masks = [body_mask(pose, audit_width, audit_height) for _, pose in poses]
    if not masks:
        raise ValueError(f"No admitted pose evidence covers {cue['id']}.")
    first = primary_pose(poses[0][1])
    middle = primary_pose(poses[len(poses) // 2][1])
    last = primary_pose(poses[-1][1])
    middle_visible = np.isfinite(middle[:, 0]) & np.isfinite(middle[:, 1]) & (middle[:, 3] >= 0.3)
    gesture_fallback = (
        np.mean(middle[middle_visible, :2], axis=0)
        if np.any(middle_visible)
        else np.asarray([0.5, 0.5])
    )
    left_travel = float(
        np.linalg.norm(
            landmark_xy(last, 15, gesture_fallback)
            - landmark_xy(first, 15, gesture_fallback)
        )
    )
    right_travel = float(
        np.linalg.norm(
            landmark_xy(last, 16, gesture_fallback)
            - landmark_xy(first, 16, gesture_fallback)
        )
    )
    wrist = 15 if left_travel >= right_travel else 16
    active_wrist = landmark_xy(middle, wrist, gesture_fallback)
    ranked = []
    for box in candidate_boxes(cue):
        overlaps = [overlap_ratio(mask, box) for mask in masks]
        maximum = max(overlaps)
        box_center = center(box)
        wrist_distance = float(np.linalg.norm(box_center - active_wrist))
        gesture_affinity = max(0.0, 1 - abs(wrist_distance - 0.24) / 0.5)
        novelty = 0.5 if previous_center is None else min(
            1.0,
            float(np.linalg.norm(box_center - previous_center)) / 0.65,
        )
        stability = 1.0 if cue["role"] == "identity" and previous_center is not None and np.linalg.norm(box_center - previous_center) < 0.08 else 0.0
        score = 1.4 * (1 - maximum) + 0.44 * gesture_affinity + 0.28 * novelty + 0.2 * stability
        ranked.append((score, maximum, float(np.mean(overlaps)), novelty, box, box_center))
    safe = [item for item in ranked if item[1] <= threshold]
    if not safe:
        best = min(ranked, key=lambda item: item[1])
        raise ValueError(
            f"No body-safe placement exists for {cue['id']}; best max overlap is {best[1]:.6f}."
        )
    score, maximum, mean, novelty, box, selected_center = max(safe, key=lambda item: item[0])
    evidence = {
        "cueId": cue["id"],
        "role": cue["role"],
        "box": box,
        "sampleCount": len(poses),
        "maxBodyOverlapRatio": round(maximum, 6),
        "meanBodyOverlapRatio": round(mean, 6),
        "spatialNovelty": round(novelty, 6),
        "activeGesture": "left-wrist" if wrist == 15 else "right-wrist",
        "score": round(score, 6),
        "policy": "framewise-dilated-pose-silhouette-v1",
    }
    return box, evidence, selected_center


def main() -> None:
    args = parse_args()
    if not 0 <= args.max_overlap_ratio <= 1 or args.pose_max_gap_frames < 0:
        raise ValueError("Invalid overlap threshold or pose gap.")
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    cues = read_cues(args.cues)
    tracks = pose_tracks(args.pose, float(plan["frameRate"]))
    sizes = source_sizes(args.source_size, plan["canvas"])
    primary = next(
        track for track in plan["tracks"] if track["kind"] == "video" and track["role"] == "primary"
    )
    overlay_track = next((track for track in plan["tracks"] if track["kind"] == "overlay"), None)
    if overlay_track is None:
        overlay_track = {"id": "track.overlays", "kind": "overlay", "clips": []}
        plan["tracks"].append(overlay_track)
    overlay_track["clips"] = [
        clip for clip in overlay_track["clips"] if not clip["id"].startswith("overlay.attention-")
    ]
    placements = []
    previous_center = None
    for index, cue in enumerate(cues):
        start = round(cue["startSeconds"] * plan["frameRate"])
        end = round(cue["endSeconds"] * plan["frameRate"])
        if start < 0 or end <= start or end > plan["durationFrames"]:
            raise ValueError(f"{cue['id']} is outside the EditPlan timeline.")
        poses = timeline_pose_samples(
            start=start,
            end=end,
            video_clips=primary["clips"],
            tracks=tracks,
            sizes=sizes,
            canvas=plan["canvas"],
            max_gap=args.pose_max_gap_frames,
        )
        box, evidence, previous_center = plan_cue(
            cue,
            poses,
            previous_center,
            args.max_overlap_ratio,
            plan["canvas"],
        )
        overlay_track["clips"].append(
            {
                "id": f"overlay.attention-{index + 1}",
                "timelineRange": {"startFrame": start, "endFrameExclusive": end},
                "kind": "text",
                "text": cue["text"],
                "templateId": "text.cue" if cue["role"] == "attention" else "text.creator-watermark",
                "box": box,
                "animation": cue["animation"],
            }
        )
        placements.append(evidence)
    plan["id"] = f"{plan['id']}.attention-overlays"
    plan["version"] = int(plan.get("version", 0)) + 1
    args.output_plan.parent.mkdir(parents=True, exist_ok=True)
    args.output_plan.write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
    receipt = {
        "schemaVersion": "nodevideo.attention-overlay-plan-receipt.v1",
        "planId": plan["id"],
        "inputPlanSha256": sha256(args.plan),
        "timedTextSha256": sha256(args.cues),
        "outputPlanSha256": sha256(args.output_plan),
        "coordinateSpace": "rendered-canvas-normalized-v1",
        "maxBodyOverlapRatio": args.max_overlap_ratio,
        "status": "pass",
        "placements": placements,
    }
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "pass", "placements": len(placements)}, indent=2))


if __name__ == "__main__":
    main()
