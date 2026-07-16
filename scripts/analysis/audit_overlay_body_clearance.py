#!/usr/bin/env python3
"""Fail-closed framewise text-box clearance audit using admitted pose tracks."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

BODY_EDGES = (
    (11, 13), (13, 15), (12, 14), (14, 16), (11, 12), (11, 23), (12, 24),
    (23, 24), (23, 25), (25, 27), (27, 31), (24, 26), (26, 28), (28, 32),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--pose", action="append", default=[], metavar="ASSET_ID=TRACK.npz")
    parser.add_argument("--source-size", action="append", default=[], metavar="ASSET_ID=WIDTHxHEIGHT")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--renderer-manifest", type=Path)
    parser.add_argument("--timeline-pose", type=Path)
    parser.add_argument("--timeline-pose-metadata", type=Path)
    parser.add_argument("--rendered-video", type=Path)
    parser.add_argument("--pose-reuse-receipt", type=Path)
    parser.add_argument("--max-overlap-ratio", type=float, default=0.05)
    parser.add_argument("--sample-stride-frames", type=int, default=1)
    return parser.parse_args()


def mappings(values: list[str]) -> dict[str, str]:
    result = {}
    for value in values:
        key, separator, item = value.partition("=")
        if not separator or not key or not item or key in result:
            raise ValueError(f"Invalid or duplicate mapping: {value}")
        result[key] = item
    return result


def pose_tracks(values: list[str]) -> dict[str, dict[int, np.ndarray]]:
    result = {}
    for asset_id, path in mappings(values).items():
        data = np.load(path, allow_pickle=False)
        result[asset_id] = {
            int(frame): poses[0] for frame, poses in zip(data["frames"], data["poses"])
        }
    return result


def source_sizes(values: list[str], canvas: dict) -> dict[str, tuple[int, int]]:
    result = {}
    for asset_id, value in mappings(values).items():
        width, separator, height = value.lower().partition("x")
        if not separator or int(width) <= 0 or int(height) <= 0:
            raise ValueError(f"Invalid source size: {value}")
        result[asset_id] = (int(width), int(height))
    result["__default__"] = (canvas["width"], canvas["height"])
    return result


def source_clip_at(clips: list[dict], timeline_frame: int) -> dict | None:
    return next((clip for clip in clips if clip["timelineRange"]["startFrame"] <= timeline_frame < clip["timelineRange"]["endFrameExclusive"]), None)


def source_frame(clip: dict, timeline_frame: int) -> int | None:
    if clip["kind"] == "source":
        offset = timeline_frame - clip["timelineRange"]["startFrame"]
        return clip["sourceRange"]["startFrame"] + round(offset * clip["playbackRate"])
    if clip["kind"] == "freeze":
        return clip["sourceFrame"]
    return None


def transform_points(points: np.ndarray, clip: dict, canvas: dict, source_size: tuple[int, int]) -> np.ndarray:
    width, height = source_size
    canvas_width, canvas_height = canvas["width"], canvas["height"]
    transformed = points.copy()
    if clip["fit"] == "crop":
        box = clip["cropKeyframes"][0]["box"]
        transformed[:, 0] = (transformed[:, 0] - box["x"]) / box["width"]
        transformed[:, 1] = (transformed[:, 1] - box["y"]) / box["height"]
        return transformed
    scale = min(canvas_width / width, canvas_height / height) if clip["fit"] == "fit" else max(canvas_width / width, canvas_height / height)
    output_width, output_height = width * scale, height * scale
    transformed[:, 0] = (transformed[:, 0] * output_width + (canvas_width - output_width) / 2) / canvas_width
    transformed[:, 1] = (transformed[:, 1] * output_height + (canvas_height - output_height) / 2) / canvas_height
    return transformed


def body_mask(points: np.ndarray, width: int, height: int) -> np.ndarray:
    mask = np.zeros((height, width), dtype=np.uint8)
    finite_points = np.nan_to_num(points, nan=-10.0, posinf=-10.0, neginf=-10.0)
    xy = np.column_stack((finite_points[:, 0] * width, finite_points[:, 1] * height)).astype(int)
    confidence = points[:, 3]
    limb_width = max(5, round(width * 0.045))
    for left, right in BODY_EDGES:
        if confidence[left] >= 0.5 and confidence[right] >= 0.5:
            cv2.line(mask, tuple(xy[left]), tuple(xy[right]), 255, limb_width)
    if all(confidence[index] >= 0.5 for index in (11, 12, 23, 24)):
        cv2.fillConvexPoly(mask, np.asarray([xy[11], xy[12], xy[24], xy[23]]), 255)
    if confidence[0] >= 0.5:
        cv2.circle(mask, tuple(xy[0]), max(7, round(width * 0.06)), 255, -1)
    return mask


def overlap_ratio(mask: np.ndarray, box: dict) -> float:
    height, width = mask.shape
    left = max(0, min(width, round(box["x"] * width)))
    top = max(0, min(height, round(box["y"] * height)))
    right = max(left + 1, min(width, round((box["x"] + box["width"]) * width)))
    bottom = max(top + 1, min(height, round((box["y"] + box["height"]) * height)))
    region = mask[top:bottom, left:right]
    return float(np.count_nonzero(region) / region.size) if region.size else 1.0


def main() -> None:
    args = parse_args()
    if not 0 <= args.max_overlap_ratio <= 1 or args.sample_stride_frames < 1:
        raise ValueError("Invalid overlap threshold or sample stride.")
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    placement_boxes = {}
    if args.renderer_manifest:
        manifest = json.loads(args.renderer_manifest.read_text(encoding="utf-8"))
        if manifest.get("planId") != plan["id"]:
            raise ValueError("Renderer manifest planId does not match the audited plan.")
        placement_boxes = {
            item["clipId"]: item["estimatedGlyphBox"]
            for item in manifest.get("textPlacements", [])
        }
    tracks = pose_tracks(args.pose)
    timeline_track = None
    pose_reuse_receipt = None
    if args.timeline_pose:
        if not args.timeline_pose_metadata or not args.rendered_video:
            raise ValueError(
                "--timeline-pose requires --timeline-pose-metadata and --rendered-video."
            )
        metadata = json.loads(args.timeline_pose_metadata.read_text(encoding="utf-8"))
        rendered_sha256 = sha256(args.rendered_video)
        if metadata.get("videoSha256") != rendered_sha256:
            if not args.pose_reuse_receipt:
                raise ValueError("Timeline pose is not bound to the rendered video.")
            pose_reuse_receipt = json.loads(
                args.pose_reuse_receipt.read_text(encoding="utf-8")
            )
            if not (
                pose_reuse_receipt.get("geometryEquivalent") is True
                and pose_reuse_receipt.get("source", {}).get("videoSha256")
                == metadata.get("videoSha256")
                and pose_reuse_receipt.get("target", {}).get("videoSha256")
                == rendered_sha256
                and pose_reuse_receipt.get("target", {}).get("planId") == plan["id"]
                and pose_reuse_receipt.get("target", {}).get("planSha256")
                == sha256(args.plan)
            ):
                raise ValueError("Pose reuse receipt does not bind equivalent render geometry.")
        data = np.load(args.timeline_pose, allow_pickle=False)
        timeline_track = {
            int(frame): poses[0] for frame, poses in zip(data["frames"], data["poses"])
        }
    sizes = source_sizes(args.source_size, plan["canvas"])
    video = next(track for track in plan["tracks"] if track["kind"] == "video" and track["role"] == "primary")
    text_clips = [clip for track in plan["tracks"] if track["kind"] == "overlay" for clip in track["clips"] if clip["kind"] == "text"]
    audit_width = 360
    audit_height = round(audit_width * plan["canvas"]["height"] / plan["canvas"]["width"])
    results = []
    for overlay in text_clips:
        samples = []
        audited_box = placement_boxes.get(overlay["id"], overlay["box"])
        start, end = overlay["timelineRange"]["startFrame"], overlay["timelineRange"]["endFrameExclusive"]
        for timeline_frame in range(start, end, args.sample_stride_frames):
            if timeline_track is not None:
                pose = timeline_track.get(timeline_frame)
                if pose is None:
                    pose = timeline_track.get(timeline_frame - 1)
                if pose is None:
                    pose = timeline_track.get(timeline_frame + 1)
                if pose is None:
                    continue
                ratio = overlap_ratio(body_mask(pose, audit_width, audit_height), audited_box)
                samples.append({"timelineFrame": timeline_frame, "bodyOverlapRatio": ratio})
                continue
            clip = source_clip_at(video["clips"], timeline_frame)
            if not clip or clip["kind"] == "black" or clip["assetId"] not in tracks:
                continue
            frame = source_frame(clip, timeline_frame)
            pose = tracks[clip["assetId"]].get(frame)
            if pose is None:
                continue
            transformed = transform_points(pose, clip, plan["canvas"], sizes.get(clip["assetId"], sizes["__default__"]))
            ratio = overlap_ratio(body_mask(transformed, audit_width, audit_height), audited_box)
            samples.append({"timelineFrame": timeline_frame, "bodyOverlapRatio": ratio})
        maximum = max((sample["bodyOverlapRatio"] for sample in samples), default=1.0)
        results.append({
            "overlayId": overlay["id"],
            "text": overlay["text"],
            "auditedBox": audited_box,
            "sampleCount": len(samples),
            "maxBodyOverlapRatio": maximum,
            "meanBodyOverlapRatio": float(np.mean([sample["bodyOverlapRatio"] for sample in samples])) if samples else 1.0,
            "status": "pass" if samples and maximum <= args.max_overlap_ratio else "fail",
            "failingFrames": [sample["timelineFrame"] for sample in samples if sample["bodyOverlapRatio"] > args.max_overlap_ratio],
        })
    passed = all(item["status"] == "pass" for item in results)
    report = {
        "schemaVersion": "nodevideo.embodied-overlay-audit.v1",
        "planId": plan["id"],
        "coordinateSpace": "rendered-canvas-normalized-v1",
        "placementPolicy": "renderer-estimated-glyph-box" if placement_boxes else "admitted-box",
        "poseEvidence": "rendered-timeline" if timeline_track is not None else "source-transformed",
        "timelinePose": {
            "path": str(args.timeline_pose),
            "sha256": sha256(args.timeline_pose),
            "metadataSha256": sha256(args.timeline_pose_metadata),
            "renderedVideoSha256": sha256(args.rendered_video),
            "geometryReuseReceiptSha256": (
                sha256(args.pose_reuse_receipt) if args.pose_reuse_receipt else None
            ),
        }
        if args.timeline_pose
        else None,
        "maxBodyOverlapRatio": args.max_overlap_ratio,
        "sampleStrideFrames": args.sample_stride_frames,
        "status": "pass" if passed else "fail",
        "score": sum(item["status"] == "pass" for item in results) / max(1, len(results)),
        "overlays": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "score": report["score"]}, indent=2))
    print(args.output)


if __name__ == "__main__":
    main()
