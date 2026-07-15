#!/usr/bin/env python3
"""Primitive-based reference edit understanding for NodeVideo.

The analyzer is deliberately a compiler, not an editor.  Established media
primitives produce evidence; this file only normalizes their outputs into the
NodeVideo EditUnderstanding/EditPlan contracts and an OpenTimelineIO timeline.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable

# MediaPipe probes TensorFlow as an optional documentation dependency.  A
# broken/global TensorFlow install must not prevent the standalone TFLite task
# runtime from loading.  The analyzer never uses TensorFlow.
if "tensorflow" not in sys.modules:
    sys.modules["tensorflow"] = None

import cv2
import easyocr
import librosa
import mediapipe as mp
import numpy as np
import opentimelineio as otio
from scenedetect import ContentDetector, SceneManager, StatsManager, open_video


ANALYZER_VERSION = "nodevideo-reference-edit-analyzer@0.1.0"
UNDERSTANDING_SCHEMA = "nodevideo.edit-understanding.v1"
PLAN_SCHEMA = "nodevideo.edit-plan.v1"
EVIDENCE_SCHEMA = "nodevideo.analysis-evidence.v1"
TARGET_ASSET_ID = "asset.reference-target"
SOURCE_ID = re.compile(r"^asset\.source-[a-z0-9][a-z0-9-]*$")
GRAY_PIXELS = 160 * 90


@dataclass(frozen=True)
class VideoAsset:
    asset_id: str
    path: Path
    sha256: str
    mime_type: str
    fps: float
    width: int
    height: int
    frames: int
    duration_seconds: float


@dataclass
class Shot:
    shot_id: str
    start: int
    end: int
    layout: str
    layout_confidence: float
    active_rows: tuple[int, int] | None
    is_black: bool = False
    is_static: bool = False


@dataclass(frozen=True)
class PoseSeries:
    sample_frames: np.ndarray
    poses: np.ndarray


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Infer a public-safe reference edit plan from a target and neutral source bindings."
    )
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument(
        "--source",
        action="append",
        required=True,
        metavar="asset.source-id=PATH",
        help="Repeat for every candidate source; IDs must be neutral asset.source-* identifiers.",
    )
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--pose-model", required=True, type=Path)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    parser.add_argument("--scene-threshold", type=float, default=27.0)
    parser.add_argument("--pose-sample-fps", type=float, default=10.0)
    parser.add_argument("--ocr-sample-seconds", type=float, default=0.5)
    parser.add_argument("--ocr-min-confidence", type=float, default=0.18)
    parser.add_argument("--skip-ocr", action="store_true", help="Diagnostic-only fast path.")
    parser.add_argument(
        "--music-identification-json",
        type=Path,
        help="Optional typed track identity/excerpt evidence; arbitrary fields are discarded.",
    )
    parser.add_argument(
        "--authorize-target-audio-fidelity",
        action="store_true",
        help="Explicitly allow a target-derived audio asset for reference-fidelity rendering.",
    )
    parser.add_argument(
        "--audio-event-review-json",
        type=Path,
        help="Optional reviewed music/silence/sting boundaries using neutral typed fields.",
    )
    parser.add_argument(
        "--target-audio-authorization-proof-ref",
        default="authorization.owner-provided-target-audio-fidelity",
        help="Neutral authorization receipt ID stored on the target-derived music clip.",
    )
    return parser.parse_args()


def source_bindings(values: Iterable[str]) -> list[tuple[str, Path]]:
    parsed: list[tuple[str, Path]] = []
    seen: set[str] = set()
    for value in values:
        if "=" not in value:
            raise ValueError("Each --source must use asset.source-id=PATH syntax.")
        asset_id, path_text = value.split("=", 1)
        if not SOURCE_ID.fullmatch(asset_id):
            raise ValueError("Source IDs must be neutral asset.source-* identifiers.")
        if asset_id in seen:
            raise ValueError(f"Duplicate source binding: {asset_id}")
        seen.add(asset_id)
        parsed.append((asset_id, Path(path_text).expanduser().resolve()))
    return parsed


def run_text(command: str, args: list[str]) -> str:
    completed = subprocess.run(
        [command, *args], capture_output=True, check=True, text=True, encoding="utf-8"
    )
    return completed.stdout


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def probe_asset(asset_id: str, path: Path, ffprobe: str) -> VideoAsset:
    if not path.is_file():
        raise FileNotFoundError("A configured media input is missing.")
    payload = json.loads(
        run_text(
            ffprobe,
            [
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,avg_frame_rate,nb_frames,duration:stream_side_data=rotation:format=duration",
                "-of",
                "json",
                str(path),
            ],
        )
    )
    stream = payload["streams"][0]
    numerator, denominator = stream["avg_frame_rate"].split("/")
    fps = float(numerator) / float(denominator)
    duration = float(stream.get("duration") or payload["format"]["duration"])
    frames = int(stream.get("nb_frames") or round(duration * fps))
    suffix = path.suffix.lower()
    mime = {".mov": "video/quicktime", ".webm": "video/webm"}.get(suffix, "video/mp4")
    width = int(stream["width"])
    height = int(stream["height"])
    rotation = next(
        (
            int(item["rotation"])
            for item in stream.get("side_data_list", [])
            if isinstance(item.get("rotation"), (int, float))
        ),
        0,
    )
    if abs(rotation) % 180 == 90:
        width, height = height, width
    return VideoAsset(
        asset_id=asset_id,
        path=path,
        sha256=sha256_file(path),
        mime_type=mime,
        fps=fps,
        width=width,
        height=height,
        frames=frames,
        duration_seconds=duration,
    )


def discover_scenes(target: VideoAsset, threshold: float) -> tuple[list[tuple[int, int]], dict[int, float]]:
    stats = StatsManager()
    manager = SceneManager(stats_manager=stats)
    manager.add_detector(ContentDetector(threshold=threshold, min_scene_len=1))
    video = open_video(str(target.path))
    manager.detect_scenes(video=video, show_progress=False)
    scenes = [(start.frame_num, end.frame_num) for start, end in manager.get_scene_list()]
    scores: dict[int, float] = {}
    for start, _ in scenes[1:]:
        score = stats.get_metrics(start, ["content_val"])[0]
        scores[start] = round(float(score or 0.0), 6)
    return scenes or [(0, target.frames)], scores


def scan_black_runs(target: VideoAsset) -> list[tuple[int, int]]:
    capture = cv2.VideoCapture(str(target.path))
    flags: list[bool] = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        flags.append(float(gray.mean()) < 3.0 and float(gray.std()) < 3.0)
    capture.release()
    runs: list[tuple[int, int]] = []
    index = 0
    while index < len(flags):
        if not flags[index]:
            index += 1
            continue
        end = index + 1
        while end < len(flags) and flags[end]:
            end += 1
        runs.append((index, end))
        index = end
    return runs


def split_scenes(
    detected: list[tuple[int, int]], black_runs: list[tuple[int, int]], total_frames: int
) -> list[tuple[int, int]]:
    boundaries = {0, total_frames}
    for start, end in detected:
        boundaries.update((start, end))
    for start, end in black_runs:
        boundaries.update((start, end))
    ordered = sorted(boundaries)
    return [(start, end) for start, end in zip(ordered, ordered[1:]) if end > start]


def sample_frames(path: Path, frame_numbers: Iterable[int]) -> list[np.ndarray]:
    capture = cv2.VideoCapture(str(path))
    output: list[np.ndarray] = []
    for frame_number in frame_numbers:
        capture.set(cv2.CAP_PROP_POS_FRAMES, int(frame_number))
        ok, frame = capture.read()
        if ok:
            output.append(frame)
    capture.release()
    return output


def longest_run(values: np.ndarray) -> tuple[int, int] | None:
    indices = np.flatnonzero(values)
    if indices.size == 0:
        return None
    best = (int(indices[0]), int(indices[0]) + 1)
    start = int(indices[0])
    previous = start
    for value in indices[1:]:
        value = int(value)
        if value > previous + 2:
            if previous + 1 - start > best[1] - best[0]:
                best = (start, previous + 1)
            start = value
        previous = value
    if previous + 1 - start > best[1] - best[0]:
        best = (start, previous + 1)
    return best


def classify_shot(
    target: VideoAsset, start: int, end: int, black_runs: list[tuple[int, int]], ordinal: int
) -> Shot:
    is_black = any(start >= black_start and end <= black_end for black_start, black_end in black_runs)
    if is_black:
        return Shot(f"shot.{ordinal:03d}", start, end, "black", 1.0, None, is_black=True)
    count = min(7, max(1, end - start))
    positions = np.linspace(start, max(start, end - 1), num=count, dtype=int)
    frames = sample_frames(target.path, positions)
    if not frames:
        return Shot(f"shot.{ordinal:03d}", start, end, "fill", 0.0, None)
    row_coverages = []
    for frame in frames:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        central = gray[:, round(gray.shape[1] * 0.08) : round(gray.shape[1] * 0.92)]
        row_coverages.append(np.mean(central > 12, axis=1))
    median_coverage = np.median(np.stack(row_coverages), axis=0)
    active = longest_run(median_coverage > 0.24)
    if active is None:
        return Shot(f"shot.{ordinal:03d}", start, end, "fill", 0.2, None)
    active_fraction = (active[1] - active[0]) / target.height
    symmetric_padding = 1.0 - abs(active[0] - (target.height - active[1])) / max(target.height, 1)
    if active_fraction < 0.82 and symmetric_padding > 0.75:
        confidence = min(0.99, 0.65 + (0.82 - active_fraction))
        return Shot(f"shot.{ordinal:03d}", start, end, "fit", confidence, active)
    confidence = min(0.99, 0.65 + min(active_fraction, 1.0) * 0.3)
    return Shot(f"shot.{ordinal:03d}", start, end, "fill", confidence, None)


def crop_fill(frame: np.ndarray, aspect: float) -> np.ndarray:
    height, width = frame.shape[:2]
    current = width / height
    if current > aspect:
        crop_width = max(1, round(height * aspect))
        left = (width - crop_width) // 2
        return frame[:, left : left + crop_width]
    crop_height = max(1, round(width / aspect))
    top = (height - crop_height) // 2
    return frame[top : top + crop_height, :]


def view_frame(
    frame: np.ndarray,
    layout: str,
    *,
    is_target: bool,
    target_aspect: float,
    active_rows: tuple[int, int] | None = None,
) -> np.ndarray:
    viewed = frame
    if layout == "fit":
        if is_target and active_rows is not None:
            viewed = frame[active_rows[0] : active_rows[1], :]
    elif layout == "fill" and not is_target:
        viewed = crop_fill(frame, target_aspect)
    return viewed


def shot_at(shots: list[Shot], frame_number: int) -> Shot:
    for shot in shots:
        if shot.start <= frame_number < shot.end:
            return shot
    return shots[-1]


def pose_image(frame: np.ndarray) -> np.ndarray:
    height, width = frame.shape[:2]
    scale = min(1.0, 640.0 / max(height, width))
    if scale < 1.0:
        frame = cv2.resize(
            frame, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA
        )
    return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)


def pose_from_result(result: Any) -> np.ndarray:
    pose = np.full((33, 3), np.nan, dtype=np.float32)
    if not result.pose_landmarks:
        return pose
    for index, landmark in enumerate(result.pose_landmarks[0]):
        pose[index] = (landmark.x, landmark.y, landmark.visibility)
    return pose


def extract_pose_series(
    asset: VideoAsset,
    landmarker: Any,
    sample_fps: float,
    target_aspect: float,
    *,
    layout: str | None = None,
    target_shots: list[Shot] | None = None,
) -> PoseSeries:
    step = max(1, round(asset.fps / sample_fps))
    capture = cv2.VideoCapture(str(asset.path))
    sampled: list[int] = []
    poses: list[np.ndarray] = []
    frame_number = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if frame_number % step != 0:
            frame_number += 1
            continue
        if target_shots is not None:
            shot = shot_at(target_shots, frame_number)
            current_layout = shot.layout if shot.layout in {"fit", "fill"} else "fill"
            viewed = view_frame(
                frame,
                current_layout,
                is_target=True,
                target_aspect=target_aspect,
                active_rows=shot.active_rows,
            )
        else:
            current_layout = layout or "fit"
            viewed = view_frame(
                frame, current_layout, is_target=False, target_aspect=target_aspect
            )
        image = pose_image(viewed)
        result = landmarker.detect(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(image))
        )
        sampled.append(frame_number)
        poses.append(pose_from_result(result))
        frame_number += 1
    capture.release()
    return PoseSeries(np.asarray(sampled, dtype=np.int32), np.asarray(poses, dtype=np.float32))


def normalized_pose(pose: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    xy = pose[:, :, :2].astype(np.float32)
    visibility = np.nan_to_num(pose[:, :, 2], nan=0.0)
    hip_points = xy[:, [23, 24], :]
    shoulder_points = xy[:, [11, 12], :]
    hip_count = np.isfinite(hip_points).all(axis=2).sum(axis=1, keepdims=True)
    shoulder_count = np.isfinite(shoulder_points).all(axis=2).sum(axis=1, keepdims=True)
    hips = np.divide(
        np.nansum(hip_points, axis=1),
        hip_count,
        out=np.full((len(xy), 2), np.nan, dtype=np.float32),
        where=hip_count > 0,
    )
    shoulders = np.divide(
        np.nansum(shoulder_points, axis=1),
        shoulder_count,
        out=np.full((len(xy), 2), np.nan, dtype=np.float32),
        where=shoulder_count > 0,
    )
    scale = np.linalg.norm(shoulders - hips, axis=1)
    scale = np.where(np.isfinite(scale) & (scale > 0.03), scale, 1.0)
    relative = (xy - hips[:, None, :]) / scale[:, None, None]
    return xy, relative, visibility


def pose_distance_matrix(target: np.ndarray, source: np.ndarray) -> np.ndarray:
    target_xy, target_rel, target_vis = normalized_pose(target)
    source_xy, source_rel, source_vis = normalized_pose(source)
    valid = (target_vis[:, None, :] >= 0.2) & (source_vis[None, :, :] >= 0.2)
    weights = np.minimum(target_vis[:, None, :], source_vis[None, :, :]) * valid
    rel_distance = np.linalg.norm(target_rel[:, None, :, :] - source_rel[None, :, :, :], axis=3)
    absolute = np.linalg.norm(target_xy[:, None, :, :] - source_xy[None, :, :, :], axis=3)
    joint_distance = 0.8 * rel_distance + 0.2 * absolute
    denominator = weights.sum(axis=2)
    distance = np.divide(
        (np.nan_to_num(joint_distance, nan=0.0) * weights).sum(axis=2),
        denominator,
        out=np.full_like(denominator, np.inf, dtype=np.float32),
        where=denominator > 4.0,
    )
    return distance


def coarse_pose_candidates(
    target_series: PoseSeries,
    source_series: PoseSeries,
    shot: Shot,
    target_fps: float,
    source_fps: float,
    limit: int = 7,
) -> list[dict[str, float]]:
    target_positions = np.flatnonzero(
        (target_series.sample_frames >= shot.start) & (target_series.sample_frames < shot.end)
    )
    if target_positions.size < 5:
        return []
    target_poses = target_series.poses[target_positions]
    distances = pose_distance_matrix(target_poses, source_series.poses)
    target_times = target_series.sample_frames[target_positions] / target_fps
    source_times = source_series.sample_frames / source_fps
    sample_period = float(np.median(np.diff(source_times)))
    offset_min = math.floor((source_times[0] - target_times[-1]) / sample_period)
    offset_max = math.ceil((source_times[-1] - target_times[0]) / sample_period)
    scored: list[tuple[float, float, int]] = []
    for offset_index in range(offset_min, offset_max + 1):
        desired = target_times + offset_index * sample_period
        source_indices = np.rint(desired / sample_period).astype(int)
        valid = (source_indices >= 0) & (source_indices < len(source_times))
        if valid.sum() < max(5, math.ceil(len(target_positions) * 0.55)):
            continue
        values = distances[np.flatnonzero(valid), source_indices[valid]]
        finite = values[np.isfinite(values)]
        if finite.size < max(5, math.ceil(len(target_positions) * 0.5)):
            continue
        scored.append((float(np.median(finite)), offset_index * sample_period, int(finite.size)))
    selected: list[tuple[float, float, int]] = []
    for candidate in sorted(scored):
        if any(abs(candidate[1] - prior[1]) < sample_period * 1.5 for prior in selected):
            continue
        selected.append(candidate)
        if len(selected) == limit:
            break
    return [
        {"medianPoseCost": round(cost, 6), "offsetSeconds": round(offset, 6), "posePairs": pairs}
        for cost, offset, pairs in selected
    ]


def gray_view(
    frame: np.ndarray,
    layout: str,
    *,
    is_target: bool,
    target_aspect: float,
    active_rows: tuple[int, int] | None,
) -> np.ndarray:
    viewed = view_frame(
        frame,
        layout,
        is_target=is_target,
        target_aspect=target_aspect,
        active_rows=active_rows,
    )
    size = (160, 90) if layout == "fit" else (90, 160)
    resized = cv2.resize(viewed, size, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    return cv2.GaussianBlur(gray, (3, 3), 0).reshape(GRAY_PIXELS)


def build_gray_views(
    asset: VideoAsset,
    target_aspect: float,
    *,
    is_target: bool,
    shots: list[Shot] | None = None,
) -> dict[str, np.ndarray]:
    views = {
        "fit": np.empty((asset.frames, GRAY_PIXELS), dtype=np.uint8),
        "fill": np.empty((asset.frames, GRAY_PIXELS), dtype=np.uint8),
    }
    capture = cv2.VideoCapture(str(asset.path))
    frame_number = 0
    while frame_number < asset.frames:
        ok, frame = capture.read()
        if not ok:
            break
        shot = shot_at(shots, frame_number) if shots else None
        for layout in ("fit", "fill"):
            active_rows = shot.active_rows if shot and layout == "fit" else None
            views[layout][frame_number] = gray_view(
                frame,
                layout,
                is_target=is_target,
                target_aspect=target_aspect,
                active_rows=active_rows,
            )
        frame_number += 1
    capture.release()
    if frame_number != asset.frames:
        for layout in views:
            views[layout] = views[layout][:frame_number]
    return views


def motion_maps(views: np.ndarray) -> np.ndarray:
    output = np.empty((max(0, len(views) - 1), views.shape[1]), dtype=np.uint8)
    for start in range(0, len(output), 64):
        end = min(len(output), start + 64)
        difference = np.abs(
            views[start + 1 : end + 1].astype(np.int16) - views[start:end].astype(np.int16)
        )
        output[start:end] = np.maximum(difference - 2, 0).astype(np.uint8)
    return output


def motion_similarity(
    target_motion: np.ndarray,
    source_motion: np.ndarray,
    shot: Shot,
    source_start: int,
) -> tuple[float, float, int]:
    duration = shot.end - shot.start
    source_end = source_start + duration
    if source_start < 0 or source_end > len(source_motion) + 1 or duration < 3:
        return 0.0, 0.0, 0
    target_slice = target_motion[shot.start : shot.end - 1].astype(np.float32)
    source_slice = source_motion[source_start : source_end - 1].astype(np.float32)
    numerator = np.einsum("ij,ij->i", target_slice, source_slice)
    denominator = np.linalg.norm(target_slice, axis=1) * np.linalg.norm(source_slice, axis=1)
    energetic = denominator > 100.0
    if energetic.sum() < max(4, math.ceil((duration - 1) * 0.25)):
        return 0.0, 0.0, int(energetic.sum())
    cosine = np.divide(
        numerator[energetic], denominator[energetic], out=np.zeros(energetic.sum()), where=True
    )
    return float(np.mean(cosine)), float(np.mean(cosine >= 0.5)), int(cosine.size)


def match_shot(
    shot: Shot,
    target: VideoAsset,
    sources: list[VideoAsset],
    target_pose: PoseSeries,
    source_pose: dict[str, dict[str, PoseSeries]],
    target_motion: dict[str, np.ndarray],
    source_motion: dict[str, dict[str, np.ndarray]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if shot.layout not in {"fit", "fill"} or shot.end - shot.start < 3:
        return [], []
    evidence_candidates: list[dict[str, Any]] = []
    for source in sources:
        coarse = coarse_pose_candidates(
            target_pose, source_pose[source.asset_id][shot.layout], shot, target.fps, source.fps
        )
        for pose_candidate in coarse:
            predicted_start = round(
                (shot.start / target.fps + pose_candidate["offsetSeconds"]) * source.fps
            )
            radius = max(4, round(source.fps / 10.0) + 1)
            for source_start in range(predicted_start - radius, predicted_start + radius + 1):
                score, inliers, pairs = motion_similarity(
                    target_motion[shot.layout],
                    source_motion[source.asset_id][shot.layout],
                    shot,
                    source_start,
                )
                evidence_candidates.append(
                    {
                        "sourceAssetId": source.asset_id,
                        "sourceStartFrame": source_start,
                        "sourceEndFrameExclusive": source_start + (shot.end - shot.start),
                        "coarseOffsetSeconds": pose_candidate["offsetSeconds"],
                        "medianPoseCost": pose_candidate["medianPoseCost"],
                        "posePairs": pose_candidate["posePairs"],
                        "motionSimilarity": round(score, 6),
                        "motionInlierRatio": round(inliers, 6),
                        "motionPairs": pairs,
                    }
                )
    deduplicated: dict[tuple[str, int], dict[str, Any]] = {}
    for candidate in evidence_candidates:
        key = (candidate["sourceAssetId"], candidate["sourceStartFrame"])
        current = deduplicated.get(key)
        if current is None or candidate["medianPoseCost"] < current["medianPoseCost"]:
            deduplicated[key] = candidate
    ranked = sorted(
        deduplicated.values(),
        key=lambda item: (-item["motionSimilarity"], item["medianPoseCost"]),
    )
    top_evidence = ranked[:8]
    if not ranked or ranked[0]["motionSimilarity"] < 0.45:
        return [], top_evidence
    best = ranked[0]
    second_score = ranked[1]["motionSimilarity"] if len(ranked) > 1 else 0.0
    margin = max(0.0, best["motionSimilarity"] - second_score)
    contract_candidates: list[dict[str, Any]] = []
    selected_rows = ranked[:3]
    for index, row in enumerate(selected_rows, start=1):
        pose_confidence = math.exp(-max(0.0, row["medianPoseCost"]) * 2.0)
        row_margin = max(0.0, row["motionSimilarity"] - (ranked[3]["motionSimilarity"] if len(ranked) > 3 else 0.0))
        confidence = float(
            np.clip(0.62 * row["motionSimilarity"] + 0.25 * pose_confidence + 0.13 * min(1.0, row_margin * 3), 0, 0.99)
        )
        contract_candidates.append(
            {
                "id": f"candidate.{shot.shot_id}.{index}",
                "sourceAssetId": row["sourceAssetId"],
                "sourceRange": {
                    "startFrame": row["sourceStartFrame"],
                    "endFrameExclusive": row["sourceEndFrameExclusive"],
                },
                "confidence": round(confidence, 6),
            }
        )
    best["selectionMargin"] = round(margin, 6)
    return contract_candidates, top_evidence


def decode_audio(path: Path, ffmpeg: str, sample_rate: int = 22050) -> np.ndarray | None:
    completed = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-map",
            "0:a:0?",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-f",
            "f32le",
            "pipe:1",
        ],
        capture_output=True,
        check=True,
    )
    if not completed.stdout:
        return None
    return np.frombuffer(completed.stdout, dtype="<f4")


def read_music_identification(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise FileNotFoundError("The configured music-identification JSON is missing.")
    source = json.loads(resolved.read_text(encoding="utf-8"))
    if not isinstance(source, dict):
        raise ValueError("Music-identification JSON must be an object.")
    title = source.get("title")
    artist = source.get("artist")
    confidence = source.get("confidence")
    excerpt_start = source.get("excerptStartSeconds")
    if not isinstance(title, str) or not title.strip() or len(title) > 256:
        raise ValueError("Music identification requires a bounded title.")
    if not isinstance(artist, str) or not artist.strip() or len(artist) > 256:
        raise ValueError("Music identification requires a bounded artist.")
    if not isinstance(confidence, (int, float)) or not 0 <= float(confidence) <= 1:
        raise ValueError("Music identification confidence must be between zero and one.")
    if not isinstance(excerpt_start, (int, float)) or float(excerpt_start) < 0:
        raise ValueError("Music identification requires a non-negative excerptStartSeconds.")
    output: dict[str, Any] = {
        "title": title.strip(),
        "artist": artist.strip(),
        "confidence": round(float(confidence), 6),
        "excerptStartSeconds": round(float(excerpt_start), 6),
    }
    isrc = source.get("isrc")
    if isrc is not None:
        if not isinstance(isrc, str) or not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{3}\d{7}", isrc):
            raise ValueError("Music identification ISRC must use canonical 12-character syntax.")
        output["isrc"] = isrc
    excerpt_end = source.get("excerptEndSeconds")
    if isinstance(excerpt_end, (int, float)) and float(excerpt_end) > float(excerpt_start):
        output["excerptEndSeconds"] = round(float(excerpt_end), 6)
    released_master_gain = source.get("releasedMasterGainDb")
    if released_master_gain is not None:
        if not isinstance(released_master_gain, (int, float)) or not math.isfinite(
            float(released_master_gain)
        ):
            raise ValueError("releasedMasterGainDb must be finite when provided.")
        output["releasedMasterGainDb"] = round(float(released_master_gain), 6)
    provider = source.get("provider")
    if isinstance(provider, str) and provider.strip() and len(provider) <= 128:
        output["provider"] = provider.strip()
    return output


def finite_milliseconds(value: Any, label: str) -> float:
    if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"{label} must be finite milliseconds.")
    return round(float(value), 3)


def read_audio_event_review(
    path: Path | None, target_duration_ms: float
) -> dict[str, Any] | None:
    if path is None:
        return None
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise FileNotFoundError("The configured audio-event review JSON is missing.")
    source = json.loads(resolved.read_text(encoding="utf-8"))
    if not isinstance(source, dict) or source.get("schemaVersion") != "nodevideo.audio-event-review.v1":
        raise ValueError("Unsupported audio-event review schema.")
    music = source.get("music")
    events = source.get("events")
    if not isinstance(music, dict) or not isinstance(events, list):
        raise ValueError("Audio-event review requires music and events.")
    segments: list[dict[str, Any]] = [
        {
            "id": "audio.event.music-001",
            "kind": "music",
            "targetStartMs": finite_milliseconds(music.get("targetStartMs"), "music start"),
            "targetEndMs": finite_milliseconds(music.get("targetEndMs"), "music end"),
        }
    ]
    counters = Counter()
    for item in events:
        if not isinstance(item, dict) or item.get("kind") not in {"silence", "sting"}:
            raise ValueError("Reviewed audio events support only silence and sting after music.")
        kind = item["kind"]
        counters[kind] += 1
        segments.append(
            {
                "id": f"audio.event.{kind}-{counters[kind]:03d}",
                "kind": kind,
                "targetStartMs": finite_milliseconds(item.get("targetStartMs"), f"{kind} start"),
                "targetEndMs": finite_milliseconds(item.get("targetEndMs"), f"{kind} end"),
            }
        )
    segments.sort(key=lambda item: item["targetStartMs"])
    if abs(segments[0]["targetStartMs"]) > 1.0:
        raise ValueError("Reviewed audio events must start at zero.")
    previous_end = 0.0
    for segment in segments:
        if segment["targetEndMs"] <= segment["targetStartMs"]:
            raise ValueError("Reviewed audio events must have positive duration.")
        if abs(segment["targetStartMs"] - previous_end) > 1.0:
            raise ValueError("Reviewed audio events must be ordered and contiguous.")
        previous_end = segment["targetEndMs"]
    if abs(previous_end - target_duration_ms) > 1.0:
        raise ValueError("Reviewed audio events must cover the full target duration.")
    method = source.get("method")
    if isinstance(method, str) and len(method) > 256:
        raise ValueError("Audio-event review method must be bounded.")
    return {
        "schemaVersion": "nodevideo.audio-event-review.v1",
        "method": method.strip() if isinstance(method, str) and method.strip() else "reviewed",
        "segments": segments,
    }


def extract_authorized_target_audio(
    target: VideoAsset, output_path: Path, ffmpeg: str, ffprobe: str
) -> VideoAsset:
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(target.path),
            "-map",
            "0:a:0",
            "-vn",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            str(output_path),
        ],
        capture_output=True,
        check=True,
    )
    duration = float(
        json.loads(
            run_text(
                ffprobe,
                [
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "json",
                    str(output_path),
                ],
            )
        )["format"]["duration"]
    )
    return VideoAsset(
        asset_id="asset.music-target-derived",
        path=output_path,
        sha256=sha256_file(output_path),
        mime_type="audio/mp4",
        fps=target.fps,
        width=0,
        height=0,
        frames=min(target.frames, max(1, round(duration * target.fps))),
        duration_seconds=duration,
    )


def complement_intervals(intervals: list[tuple[float, float]], duration: float) -> list[list[float]]:
    output: list[list[float]] = []
    cursor = 0.0
    for start, end in intervals:
        if start > cursor:
            output.append([round(cursor, 6), round(start, 6)])
        cursor = max(cursor, end)
    if cursor < duration:
        output.append([round(cursor, 6), round(duration, 6)])
    return output


def analyze_audio(
    target: VideoAsset, ffmpeg: str, cut_frames: list[int]
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any] | None]:
    sample_rate = 22050
    samples = decode_audio(target.path, ffmpeg, sample_rate)
    if samples is None or samples.size == 0:
        return (
            {"targetAudioUsage": "absent", "transcript": [], "musicCandidates": []},
            {"present": False},
            None,
        )
    hop_length = 512
    onset_envelope = librosa.onset.onset_strength(y=samples, sr=sample_rate, hop_length=hop_length)
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_envelope, sr=sample_rate, hop_length=hop_length
    )
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset_envelope, sr=sample_rate, hop_length=hop_length, units="frames"
    )
    beat_times = librosa.frames_to_time(beat_frames, sr=sample_rate, hop_length=hop_length)
    onset_times = librosa.frames_to_time(onset_frames, sr=sample_rate, hop_length=hop_length)
    tempo_value = float(np.asarray(tempo).reshape(-1)[0])
    if beat_frames.size:
        strengths = onset_envelope[np.clip(beat_frames, 0, len(onset_envelope) - 1)]
        phase_scores = [float(strengths[phase::4].mean()) for phase in range(min(4, len(strengths)))]
        downbeat_phase = int(np.argmax(phase_scores))
        downbeat_times = beat_times[downbeat_phase::4]
        normalized_strength = float(np.mean(strengths) / max(float(np.max(onset_envelope)), 1e-6))
        beat_confidence = float(np.clip(0.45 + 0.55 * normalized_strength, 0, 0.95))
    else:
        downbeat_phase = 0
        downbeat_times = np.asarray([], dtype=float)
        beat_confidence = 0.0
    non_silent_samples = librosa.effects.split(samples, top_db=40)
    non_silent = [(float(start / sample_rate), float(end / sample_rate)) for start, end in non_silent_samples]
    audio_duration = len(samples) / sample_rate
    silence = complement_intervals(non_silent, target.duration_seconds)
    cut_offsets = []
    for cut in cut_frames:
        cut_ms = cut / target.fps * 1000
        if beat_times.size:
            nearest = float(beat_times[np.argmin(np.abs(beat_times * 1000 - cut_ms))] * 1000)
            cut_offsets.append(
                {"cutFrame": cut, "nearestBeatMs": round(nearest, 3), "offsetMs": round(cut_ms - nearest, 3)}
            )
    beat_grid = None
    if beat_times.size:
        beats_ms = [round(float(value * 1000), 3) for value in beat_times]
        downbeats_ms = [round(float(value * 1000), 3) for value in downbeat_times]
        beat_grid = {
            "bpm": round(tempo_value, 6),
            "offsetMs": beats_ms[0],
            "beatsMs": beats_ms,
            "downbeatsMs": downbeats_ms,
            "confidence": round(beat_confidence, 6),
        }
    understanding = {
        "targetAudioUsage": "analysis-only",
        "transcript": [],
        "musicCandidates": [],
    }
    if beat_grid:
        understanding["beatGrid"] = beat_grid
    evidence = {
        "present": True,
        "decodedDurationSeconds": round(audio_duration, 6),
        "tempoBpm": round(tempo_value, 6),
        "beatTimesMs": beat_grid["beatsMs"] if beat_grid else [],
        "downbeatMethod": "strongest-four-beat-phase",
        "downbeatPhase": downbeat_phase,
        "onsetTimesMs": [round(float(value * 1000), 3) for value in onset_times],
        "silenceIntervalsSeconds": silence,
        "cutToNearestBeat": cut_offsets,
        "peak": round(float(np.max(np.abs(samples))), 6),
        "rmsDb": round(float(librosa.amplitude_to_db(np.asarray([np.sqrt(np.mean(samples**2))]))[0]), 6),
    }
    return understanding, evidence, beat_grid


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def box_iou(left: dict[str, float], right: dict[str, float]) -> float:
    x1 = max(left["x"], right["x"])
    y1 = max(left["y"], right["y"])
    x2 = min(left["x"] + left["width"], right["x"] + right["width"])
    y2 = min(left["y"] + left["height"], right["y"] + right["height"])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = left["width"] * left["height"] + right["width"] * right["height"] - intersection
    return intersection / union if union else 0.0


def normalized_box(points: list[list[float]], width: int, height: int) -> dict[str, float]:
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    x1, x2 = max(0.0, min(xs)), min(float(width), max(xs))
    y1, y2 = max(0.0, min(ys)), min(float(height), max(ys))
    return {
        "x": round(x1 / width, 6),
        "y": round(y1 / height, 6),
        "width": round(max(1.0, x2 - x1) / width, 6),
        "height": round(max(1.0, y2 - y1) / height, 6),
    }


def analyze_overlays(
    target: VideoAsset,
    sample_seconds: float,
    minimum_confidence: float,
) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    step = max(1, round(target.fps * sample_seconds))
    sample_numbers = list(range(step // 2, target.frames, step))
    capture = cv2.VideoCapture(str(target.path))
    detections: list[dict[str, Any]] = []
    for frame_number in sample_numbers:
        capture.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ok, frame = capture.read()
        if not ok:
            continue
        enlarged = cv2.resize(frame, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        for points, text, confidence in reader.readtext(
            enlarged,
            detail=1,
            paragraph=False,
            text_threshold=0.55,
            low_text=0.3,
            link_threshold=0.3,
        ):
            value = clean_text(text)
            if float(confidence) < minimum_confidence or len(value) < 2:
                continue
            if not any(character.isalnum() for character in value):
                continue
            detections.append(
                {
                    "frame": frame_number,
                    "text": value,
                    "confidence": float(confidence),
                    "box": normalized_box(points, enlarged.shape[1], enlarged.shape[0]),
                }
            )
    capture.release()
    tracks: list[list[dict[str, Any]]] = []
    for detection in detections:
        best_track: list[dict[str, Any]] | None = None
        best_score = 0.0
        for track in tracks:
            prior = track[-1]
            if detection["frame"] - prior["frame"] > step * 1.6:
                continue
            text_score = SequenceMatcher(
                None, detection["text"].casefold(), prior["text"].casefold()
            ).ratio()
            spatial = box_iou(detection["box"], prior["box"])
            center_distance = math.hypot(
                detection["box"]["x"]
                + detection["box"]["width"] / 2
                - prior["box"]["x"]
                - prior["box"]["width"] / 2,
                detection["box"]["y"]
                + detection["box"]["height"] / 2
                - prior["box"]["y"]
                - prior["box"]["height"] / 2,
            )
            score = 0.7 * text_score + 0.3 * max(spatial, 1.0 - center_distance * 3)
            if text_score >= 0.68 and score > best_score:
                best_score = score
                best_track = track
        if best_track is None:
            tracks.append([detection])
        else:
            best_track.append(detection)
    overlays: list[dict[str, Any]] = []
    review_patches: list[dict[str, Any]] = []
    observations: list[dict[str, Any]] = []
    half_step = max(1, step // 2)
    for index, track in enumerate(tracks, start=1):
        first = track[0]["frame"]
        last = track[-1]["frame"]
        start = max(0, first - half_step)
        end = min(target.frames, last + half_step + 1)
        texts = Counter(item["text"] for item in track)
        text = max(texts, key=lambda value: (texts[value], max(item["confidence"] for item in track if item["text"] == value)))
        box = {
            key: round(float(np.median([item["box"][key] for item in track])), 6)
            for key in ("x", "y", "width", "height")
        }
        # Median boxes can exceed the canvas by a rounding unit.
        box["width"] = round(min(box["width"], 1.0 - box["x"]), 6)
        box["height"] = round(min(box["height"], 1.0 - box["y"]), 6)
        persistence = min(1.0, len(track) / 2.0)
        confidence = float(np.clip(np.mean([item["confidence"] for item in track]) * (0.62 + 0.33 * persistence), 0, 0.99))
        overlay_id = f"overlay.ocr-{index:03d}"
        overlay = {
            "id": overlay_id,
            "kind": "text",
            "targetRange": {"startFrame": start, "endFrameExclusive": max(start + 1, end)},
            "text": text,
            "box": box,
            "confidence": round(confidence, 6),
            "styleToken": "ocr-observation",
        }
        overlays.append(overlay)
        observations.append(
            {
                "observationId": overlay_id,
                "sampleFrames": [item["frame"] for item in track],
                "sampleConfidences": [round(item["confidence"], 6) for item in track],
                "timingResolutionFrames": step,
            }
        )
        review_patches.append(
            {
                "op": "review-overlay-observation",
                "observationId": overlay_id,
                "timelineRange": overlay["targetRange"],
                "fields": ["text", "timing", "box", "style"],
                "confidence": overlay["confidence"],
                "reason": "EasyOCR observations are candidates; exact typography and frame boundaries require review.",
            }
        )
    evidence = {
        "sampleIntervalFrames": step,
        "sampleCount": len(sample_numbers),
        "rawDetectionCount": len(detections),
        "observations": observations,
    }
    return overlays, evidence, review_patches


def tool_versions(ffmpeg: str, ffprobe: str) -> dict[str, str]:
    packages = {
        "PySceneDetect": "scenedetect",
        "librosa": "librosa",
        "MediaPipe": "mediapipe",
        "EasyOCR": "easyocr",
        "OpenTimelineIO": "OpenTimelineIO",
        "NumPy": "numpy",
        "SciPy": "scipy",
    }
    versions = {}
    for label, package in packages.items():
        try:
            versions[label] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[label] = "unknown"
    versions["OpenCV"] = cv2.__version__
    versions["FFmpeg"] = run_text(ffmpeg, ["-version"]).splitlines()[0]
    versions["FFprobe"] = run_text(ffprobe, ["-version"]).splitlines()[0]
    versions["analyzer"] = ANALYZER_VERSION
    return versions


def asset_record(asset: VideoAsset, role: str, usage: str) -> dict[str, Any]:
    return {
        "id": asset.asset_id,
        "role": role,
        "sha256": f"sha256:{asset.sha256}",
        "mimeType": asset.mime_type,
        "usage": usage,
    }


def crop_analysis(shot: Shot, target: VideoAsset, source: VideoAsset) -> dict[str, Any] | None:
    if shot.layout != "fill":
        return None
    crop_width = min(1.0, (target.width / target.height) / (source.width / source.height))
    box = {
        "x": round((1.0 - crop_width) / 2.0, 6),
        "y": 0.0,
        "width": round(crop_width, 6),
        "height": 1.0,
    }
    keyframes = [{"timelineFrame": shot.start, "box": box}]
    if shot.end - shot.start > 1:
        keyframes.append({"timelineFrame": shot.end - 1, "box": box})
    return {"keyframes": keyframes, "confidence": round(shot.layout_confidence, 6)}


def overlay_template_id(
    overlay: dict[str, Any], frame_rate: float, outro_start_frame: int
) -> str:
    start = overlay["targetRange"]["startFrame"]
    if start >= outro_start_frame:
        return "text.outro"
    if start < round(frame_rate * 2) and overlay["box"]["y"] >= 0.65:
        return "text.title"
    return "text.cue"


def write_otio(plan: dict[str, Any], path: Path, confidence_by_clip: dict[str, float]) -> None:
    timeline = otio.schema.Timeline(name=plan["id"])
    timeline.metadata["nodevideo"] = {
        "schemaVersion": PLAN_SCHEMA,
        "understandingId": plan["understandingId"],
        "lineage": plan["lineage"],
        "beatGrid": plan.get("beatGrid"),
    }
    rate = plan["frameRate"]
    primary = otio.schema.Track(name="Primary video", kind=otio.schema.TrackKind.Video)
    video_track = next(track for track in plan["tracks"] if track["kind"] == "video")
    for clip_data in video_track["clips"]:
        duration = clip_data["timelineRange"]["endFrameExclusive"] - clip_data["timelineRange"]["startFrame"]
        if clip_data["kind"] == "black":
            item = otio.schema.Gap(
                name=clip_data["id"],
                source_range=otio.opentime.TimeRange(
                    otio.opentime.RationalTime(0, rate), otio.opentime.RationalTime(duration, rate)
                ),
            )
        else:
            source_start = (
                clip_data["sourceRange"]["startFrame"]
                if clip_data["kind"] == "source"
                else clip_data["sourceFrame"]
            )
            reference = otio.schema.ExternalReference(
                target_url=f"nodevideo://{clip_data['assetId']}"
            )
            item = otio.schema.Clip(name=clip_data["id"], media_reference=reference)
            item.source_range = otio.opentime.TimeRange(
                otio.opentime.RationalTime(source_start, rate),
                otio.opentime.RationalTime(duration, rate),
            )
            if clip_data["kind"] == "freeze":
                item.effects.append(otio.schema.FreezeFrame())
        item.metadata["nodevideo"] = {
            "kind": clip_data["kind"],
            "timelineRange": clip_data["timelineRange"],
            "fit": clip_data.get("fit"),
            "confidence": confidence_by_clip.get(clip_data["id"]),
        }
        primary.append(item)
    timeline.tracks.append(primary)
    for audio_data in (track for track in plan["tracks"] if track["kind"] == "audio"):
        audio_track = otio.schema.Track(name=audio_data["id"], kind=otio.schema.TrackKind.Audio)
        cursor = 0
        for clip_data in sorted(
            audio_data["clips"], key=lambda clip: clip["timelineRange"]["startFrame"]
        ):
            start = clip_data["timelineRange"]["startFrame"]
            end = clip_data["timelineRange"]["endFrameExclusive"]
            if start > cursor:
                audio_track.append(
                    otio.schema.Gap(
                        source_range=otio.opentime.TimeRange(
                            otio.opentime.RationalTime(0, rate),
                            otio.opentime.RationalTime(start - cursor, rate),
                        )
                    )
                )
            audio_clip = otio.schema.Clip(
                name=clip_data["id"],
                media_reference=otio.schema.ExternalReference(
                    target_url=f"nodevideo://{clip_data['assetId']}"
                ),
            )
            audio_clip.source_range = otio.opentime.TimeRange(
                otio.opentime.RationalTime(clip_data["sourceRange"]["startFrame"], rate),
                otio.opentime.RationalTime(
                    clip_data["sourceRange"]["endFrameExclusive"]
                    - clip_data["sourceRange"]["startFrame"],
                    rate,
                ),
            )
            audio_clip.metadata["nodevideo"] = {
                "role": clip_data["role"],
                "timelineRange": clip_data["timelineRange"],
                "gainDb": clip_data["gainDb"],
                "license": clip_data.get("license"),
            }
            audio_track.append(audio_clip)
            cursor = end
        if cursor < plan["durationFrames"]:
            audio_track.append(
                otio.schema.Gap(
                    source_range=otio.opentime.TimeRange(
                        otio.opentime.RationalTime(0, rate),
                        otio.opentime.RationalTime(plan["durationFrames"] - cursor, rate),
                    )
                )
            )
        timeline.tracks.append(audio_track)
    overlay_track = next((track for track in plan["tracks"] if track["kind"] == "overlay"), None)
    if overlay_track:
        for clip_data in overlay_track["clips"]:
            track = otio.schema.Track(name=clip_data["id"], kind=otio.schema.TrackKind.Video)
            start = clip_data["timelineRange"]["startFrame"]
            duration = clip_data["timelineRange"]["endFrameExclusive"] - start
            if start:
                track.append(
                    otio.schema.Gap(
                        source_range=otio.opentime.TimeRange(
                            otio.opentime.RationalTime(0, rate),
                            otio.opentime.RationalTime(start, rate),
                        )
                    )
                )
            overlay = otio.schema.Clip(name=clip_data["id"])
            overlay.source_range = otio.opentime.TimeRange(
                otio.opentime.RationalTime(0, rate), otio.opentime.RationalTime(duration, rate)
            )
            overlay.metadata["nodevideo"] = clip_data
            track.append(overlay)
            timeline.tracks.append(track)
    otio.adapters.write_to_file(timeline, str(path))


def assert_public_safe(payloads: Iterable[Any], forbidden_paths: Iterable[Path]) -> None:
    serialized = "\n".join(json.dumps(payload, ensure_ascii=False) for payload in payloads).casefold()
    for path in forbidden_paths:
        tokens = {str(path.resolve()).casefold(), path.name.casefold()}
        for token in tokens:
            if token and token in serialized:
                raise RuntimeError("A private path or filename reached a public-safe output payload.")


def write_json(path: Path, payload: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def analyze(args: argparse.Namespace) -> dict[str, Path]:
    bindings = source_bindings(args.source)
    target_path = args.target.expanduser().resolve()
    pose_model = args.pose_model.expanduser().resolve()
    if not pose_model.is_file():
        raise FileNotFoundError("The configured pose model is missing.")
    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    target = probe_asset(TARGET_ASSET_ID, target_path, args.ffprobe)
    sources = [probe_asset(asset_id, path, args.ffprobe) for asset_id, path in bindings]
    if any(abs(source.fps - target.fps) > 0.01 for source in sources):
        raise ValueError(
            "Source and target frame rates differ; normalize them to a common constant frame rate "
            "before frame-exact analysis."
        )
    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    auxiliary_digests = "".join(
        sha256_file(path.expanduser().resolve())
        for path in (args.music_identification_json, args.audio_event_review_json)
        if path is not None
    )
    run_digest = hashlib.sha256(
        (
            ANALYZER_VERSION
            + target.sha256
            + "".join(item.sha256 for item in sources)
            + auxiliary_digests
            + str(args.authorize_target_audio_fidelity)
            + args.target_audio_authorization_proof_ref
        ).encode()
    ).hexdigest()[:16]
    run_id = f"run.reference-understanding.{run_digest}"
    understanding_id = f"understanding.{run_digest}"
    plan_id = f"plan.{run_digest}.v1"

    detected, content_scores = discover_scenes(target, args.scene_threshold)
    black_runs = scan_black_runs(target)
    ranges = split_scenes(detected, black_runs, target.frames)
    shots = [
        classify_shot(target, start, end, black_runs, ordinal)
        for ordinal, (start, end) in enumerate(ranges, start=1)
    ]
    target_aspect = target.width / target.height

    base_options = mp.tasks.BaseOptions(model_asset_path=str(pose_model))
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_poses=1,
        min_pose_detection_confidence=0.15,
        min_pose_presence_confidence=0.15,
        min_tracking_confidence=0.15,
        output_segmentation_masks=False,
    )
    with mp.tasks.vision.PoseLandmarker.create_from_options(options) as landmarker:
        target_pose = extract_pose_series(
            target,
            landmarker,
            args.pose_sample_fps,
            target_aspect,
            target_shots=shots,
        )
        source_pose = {
            source.asset_id: {
                layout: extract_pose_series(
                    source,
                    landmarker,
                    args.pose_sample_fps,
                    target_aspect,
                    layout=layout,
                )
                for layout in ("fit", "fill")
            }
            for source in sources
        }

    target_views = build_gray_views(target, target_aspect, is_target=True, shots=shots)
    source_views = {
        source.asset_id: build_gray_views(source, target_aspect, is_target=False)
        for source in sources
    }
    target_motion = {layout: motion_maps(view) for layout, view in target_views.items()}
    source_motion = {
        asset_id: {layout: motion_maps(view) for layout, view in views.items()}
        for asset_id, views in source_views.items()
    }
    for shot in shots:
        if shot.is_black or shot.end - shot.start < 3:
            continue
        motion = target_motion[shot.layout][shot.start : shot.end - 1]
        shot.is_static = bool(motion.size and float(np.mean(motion)) < 0.45)

    understood_shots: list[dict[str, Any]] = []
    matching_evidence: list[dict[str, Any]] = []
    plan_clips: list[dict[str, Any]] = []
    clip_confidence: dict[str, float] = {}
    previous_source_clip: dict[str, Any] | None = None
    source_by_id = {source.asset_id: source for source in sources}
    warnings = [
        "Target audio is analyzed for rhythm but is not a render asset or an autonomous music-selection claim.",
        "Color grade is intentionally unresolved; no target-fitted LUT is emitted.",
        "OCR overlay timing, typography, and boxes are observations with typed review patches.",
        "Detailed public-safe primitive evidence is stored in analysis-evidence.json.",
    ]
    for shot in shots:
        target_range = {"startFrame": shot.start, "endFrameExclusive": shot.end}
        understood: dict[str, Any] = {
            "id": shot.shot_id,
            "targetRange": target_range,
            "candidates": [],
        }
        clip_id = f"clip.{shot.shot_id}"
        if shot.is_black:
            plan_clips.append({"id": clip_id, "kind": "black", "timelineRange": target_range})
            clip_confidence[clip_id] = 1.0
            matching_evidence.append(
                {"shotId": shot.shot_id, "classification": "black", "candidates": []}
            )
        else:
            candidates, candidate_evidence = match_shot(
                shot,
                target,
                sources,
                target_pose,
                source_pose,
                target_motion,
                source_motion,
            )
            understood["candidates"] = candidates
            matching_evidence.append(
                {
                    "shotId": shot.shot_id,
                    "layout": shot.layout,
                    "layoutConfidence": round(shot.layout_confidence, 6),
                    "static": shot.is_static,
                    "candidates": candidate_evidence,
                }
            )
            if candidates:
                selected = candidates[0]
                understood["selectedCandidateId"] = selected["id"]
                source = source_by_id[selected["sourceAssetId"]]
                reframe = crop_analysis(shot, target, source)
                if reframe:
                    understood["reframe"] = reframe
                clip = {
                    "id": clip_id,
                    "kind": "source",
                    "assetId": selected["sourceAssetId"],
                    "timelineRange": target_range,
                    "sourceRange": selected["sourceRange"],
                    "playbackRate": 1.0,
                    "fit": shot.layout,
                    "cropKeyframes": [],
                    "grade": {"kind": "none"},
                }
                plan_clips.append(clip)
                clip_confidence[clip_id] = selected["confidence"]
                previous_source_clip = clip
            elif shot.is_static and previous_source_clip is not None:
                source_frame = previous_source_clip["sourceRange"]["endFrameExclusive"] - 1
                inferred = {
                    "id": f"candidate.{shot.shot_id}.freeze",
                    "sourceAssetId": previous_source_clip["assetId"],
                    "sourceRange": {
                        "startFrame": source_frame,
                        "endFrameExclusive": source_frame + 1,
                    },
                    "confidence": 0.55,
                }
                understood["candidates"] = [inferred]
                understood["selectedCandidateId"] = inferred["id"]
                plan_clips.append(
                    {
                        "id": clip_id,
                        "kind": "freeze",
                        "assetId": previous_source_clip["assetId"],
                        "timelineRange": target_range,
                        "sourceFrame": source_frame,
                        "fit": previous_source_clip["fit"],
                        "cropKeyframes": [],
                        "grade": {"kind": "none"},
                    }
                )
                clip_confidence[clip_id] = 0.55
                warnings.append(
                    f"{shot.shot_id} is a static, unmatched scene; the plan freezes the preceding source frame and leaves graphics to overlay review."
                )
            else:
                plan_clips.append({"id": clip_id, "kind": "black", "timelineRange": target_range})
                clip_confidence[clip_id] = 0.0
                warnings.append(
                    f"{shot.shot_id} has no source match above the deterministic confidence floor; the fail-closed plan emits black."
                )
        understood_shots.append(understood)

    cut_frames = [end for _, end in ranges[:-1]]
    audio_understanding, audio_evidence, beat_grid = analyze_audio(
        target, args.ffmpeg, cut_frames
    )
    music_identification = read_music_identification(args.music_identification_json)
    audio_event_review = read_audio_event_review(
        args.audio_event_review_json, target.frames / target.fps * 1_000
    )
    target_derived_music: VideoAsset | None = None
    if args.authorize_target_audio_fidelity:
        if not audio_evidence.get("present"):
            raise ValueError("Target-audio fidelity was authorized, but the target has no audio stream.")
        target_derived_music = extract_authorized_target_audio(
            target,
            output_dir / "music-target-derived.m4a",
            args.ffmpeg,
            args.ffprobe,
        )
        identity = music_identification or {
            "title": "unidentified reference soundtrack",
            "artist": "unknown",
            "confidence": 0.0,
            "excerptStartSeconds": 0.0,
        }
        rationale = (
            f"Reference identification: {identity['title']} by {identity['artist']}; "
            f"the edit starts near the original-track offset {identity['excerptStartSeconds']} seconds. "
            "The render asset is extracted from the authorized target, so this is fidelity evidence, "
            "not autonomous music selection."
        )
        reviewed_music_end_ms = next(
            (
                segment["targetEndMs"]
                for segment in audio_event_review["segments"]
                if segment["kind"] == "music"
            ),
            round(target_derived_music.frames / target.fps * 1_000, 3),
        ) if audio_event_review is not None else round(
            target_derived_music.frames / target.fps * 1_000, 3
        )
        music_identity = {
            "title": identity["title"],
            "artist": identity["artist"],
            **({"isrc": identity["isrc"]} if "isrc" in identity else {}),
        }
        audio_understanding.update(
            {
                "targetAudioUsage": "authorized-render-source",
                "musicCandidates": [
                    {
                        "assetId": target_derived_music.asset_id,
                        "confidence": identity["confidence"],
                        "rationale": rationale,
                        "identity": music_identity,
                        "excerpt": {
                            "sourceOffsetMs": 0.0,
                            "releasedMasterOffsetMs": round(
                                identity["excerptStartSeconds"] * 1_000, 3
                            ),
                            "releasedMasterGainDb": identity.get("releasedMasterGainDb", 0.0),
                            "targetStartMs": 0.0,
                            "targetEndMs": reviewed_music_end_ms,
                        },
                    }
                ],
                "selectedMusicAssetId": target_derived_music.asset_id,
            }
        )
        warnings[0] = (
            "Target audio is an explicitly authorized target-derived render source; this run is "
            "eligible for reference-fidelity evaluation and ineligible for autonomous music-selection proof."
        )
    if args.skip_ocr:
        overlays: list[dict[str, Any]] = []
        ocr_evidence = {"skipped": True}
        review_patches: list[dict[str, Any]] = []
        warnings.append("OCR was explicitly skipped for this diagnostic run.")
    else:
        overlays, ocr_evidence, review_patches = analyze_overlays(
            target, args.ocr_sample_seconds, args.ocr_min_confidence
        )

    assets = [
        *[asset_record(source, "source-video", "render-source") for source in sources],
        *(
            [asset_record(target_derived_music, "music", "render-source")]
            if target_derived_music is not None
            else []
        ),
        asset_record(
            target,
            "reference-target",
            "analysis-evaluation-and-authorized-asset-derivation",
        ),
    ]
    understanding = {
        "schemaVersion": UNDERSTANDING_SCHEMA,
        "id": understanding_id,
        "runId": run_id,
        "createdAt": created_at,
        "mode": "reference-understanding",
        "frameRate": target.fps,
        "canvas": {"width": target.width, "height": target.height},
        "assets": assets,
        "shots": understood_shots,
        "audio": audio_understanding,
        "overlays": overlays,
        "warnings": warnings,
    }
    outro_start_frame = next(
        (
            clip["timelineRange"]["startFrame"]
            for clip in plan_clips
            if clip["kind"] == "freeze"
        ),
        target.frames,
    )
    overlay_clips = [
        {
            "id": f"clip.{overlay['id']}",
            "timelineRange": overlay["targetRange"],
            "kind": "text",
            "text": overlay["text"],
            "templateId": overlay_template_id(overlay, target.fps, outro_start_frame),
            "box": overlay["box"],
            "animation": "none",
        }
        for overlay in overlays
        if overlay["confidence"] >= 0.5
    ]
    music_clips: list[dict[str, Any]] = []
    sting_clips: list[dict[str, Any]] = []
    target_duration_ms = target.frames / target.fps * 1_000
    if target_derived_music is None:
        planned_audio_segments = [
            {
                "id": "audio.event.silence-full",
                "kind": "silence",
                "targetStartMs": 0.0,
                "targetEndMs": target_duration_ms,
            }
        ]
    elif audio_event_review is not None:
        planned_audio_segments = audio_event_review["segments"]
    else:
        audible_end_ms = target_derived_music.frames / target.fps * 1_000
        planned_audio_segments = [
            {
                "id": "audio.event.music-001",
                "kind": "music",
                "targetStartMs": 0.0,
                "targetEndMs": audible_end_ms,
            },
            {
                "id": "audio.event.silence-001",
                "kind": "silence",
                "targetStartMs": audible_end_ms,
                "targetEndMs": target_duration_ms,
            },
        ]
        warnings.append(
            "No reviewed audio-event map was supplied; the fidelity plan uses decoded audio duration "
            "and leaves sting classification unresolved."
        )
    music_identity = (
        {
            "title": music_identification["title"],
            "artist": music_identification["artist"],
            **(
                {"isrc": music_identification["isrc"]}
                if "isrc" in music_identification
                else {}
            ),
        }
        if music_identification is not None
        else {"title": "unidentified reference soundtrack", "artist": "unknown"}
    )
    audio_program_events: list[dict[str, Any]] = []
    if target_derived_music is not None:
        for index, segment in enumerate(planned_audio_segments, start=1):
            kind = segment["kind"]
            if kind == "silence":
                audio_program_events.append(
                    {
                        "id": segment["id"],
                        "kind": "silence",
                        "targetStartMs": segment["targetStartMs"],
                        "targetEndMs": segment["targetEndMs"],
                    }
                )
                continue
            start_frame = max(0, round(segment["targetStartMs"] * target.fps / 1_000))
            end_frame = min(
                target_derived_music.frames,
                max(start_frame + 1, round(segment["targetEndMs"] * target.fps / 1_000)),
            )
            clip_id = f"audio.{kind}.target-derived-{index:03d}"
            clip = {
                "id": clip_id,
                "assetId": target_derived_music.asset_id,
                "timelineRange": {
                    "startFrame": start_frame,
                    "endFrameExclusive": end_frame,
                },
                "sourceRange": {
                    "startFrame": start_frame,
                    "endFrameExclusive": end_frame,
                },
                "playbackRate": 1.0,
                "role": kind,
                "gainDb": 0.0,
                "fadeInFrames": 0,
                "fadeOutFrames": 0,
                **(
                    {
                        "license": {
                            "status": "target-derived-authorized",
                            "proofRef": args.target_audio_authorization_proof_ref,
                        }
                    }
                    if kind == "music"
                    else {}
                ),
            }
            if kind == "music":
                music_clips.append(clip)
                audio_program_events.append(
                    {
                        "id": segment["id"],
                        "kind": "music",
                        "clipId": clip_id,
                        "sourceOffsetMs": segment["targetStartMs"],
                        "releasedMasterOffsetMs": round(
                            float((music_identification or {}).get("excerptStartSeconds", 0.0))
                            * 1_000,
                            3,
                        ),
                        "releasedMasterGainDb": float(
                            (music_identification or {}).get("releasedMasterGainDb", 0.0)
                        ),
                        "targetStartMs": segment["targetStartMs"],
                        "targetEndMs": segment["targetEndMs"],
                        "gainDb": 0.0,
                        "identity": music_identity,
                    }
                )
            else:
                sting_clips.append(clip)
                audio_program_events.append(
                    {
                        "id": segment["id"],
                        "kind": "sting",
                        "clipId": clip_id,
                        "sourceOffsetMs": segment["targetStartMs"],
                        "targetStartMs": segment["targetStartMs"],
                        "targetEndMs": segment["targetEndMs"],
                        "gainDb": 0.0,
                        "label": "reviewed soundtrack sting",
                    }
                )
    else:
        audio_program_events = [
            {
                "id": planned_audio_segments[0]["id"],
                "kind": "silence",
                "targetStartMs": 0.0,
                "targetEndMs": target_duration_ms,
            }
        ]
    audio_routing = [
        *[
            {
                "id": f"route.mute.{asset_id}",
                "sourceKind": "asset-audio",
                "sourceId": asset_id,
                "bus": "program",
                "muted": True,
                "gainDb": 0.0,
            }
            for asset_id in sorted(
                {clip["assetId"] for clip in plan_clips if clip["kind"] == "source"}
            )
        ],
        {
            "id": "route.track.music",
            "sourceKind": "track",
            "sourceId": "track.audio.music",
            "bus": "music",
            "muted": False,
            "gainDb": 0.0,
        },
        {
            "id": "route.track.effects",
            "sourceKind": "track",
            "sourceId": "track.audio.effects",
            "bus": "effects",
            "muted": False,
            "gainDb": 0.0,
        },
    ]
    plan: dict[str, Any] = {
        "schemaVersion": PLAN_SCHEMA,
        "id": plan_id,
        "understandingId": understanding_id,
        "version": 1,
        "createdAt": created_at,
        "frameRate": target.fps,
        "canvas": {"width": target.width, "height": target.height},
        "durationFrames": target.frames,
        "lineage": {
            "renderAssetIds": [
                *[source.asset_id for source in sources],
                *(
                    [target_derived_music.asset_id]
                    if target_derived_music is not None
                    else []
                ),
            ],
            "evaluationOnlyAssetIds": [target.asset_id],
            "targetDerivedRenderAssetIds": (
                [target_derived_music.asset_id]
                if target_derived_music is not None
                else []
            ),
        },
        "audio": {"routing": audio_routing, "events": audio_program_events},
        "tracks": [
            {"id": "track.video.primary", "kind": "video", "role": "primary", "clips": plan_clips},
            {"id": "track.audio.music", "kind": "audio", "role": "music", "clips": music_clips},
            {
                "id": "track.audio.effects",
                "kind": "audio",
                "role": "effects",
                "clips": sting_clips,
            },
            {"id": "track.overlays", "kind": "overlay", "clips": overlay_clips},
        ],
    }
    if beat_grid:
        plan["beatGrid"] = beat_grid
    audio_events = [
        {
            "id": segment["id"],
            "kind": segment["kind"],
            "targetStartMs": segment["targetStartMs"],
            "targetEndMs": segment["targetEndMs"],
            "timelineRange": {
                "startFrame": max(0, round(segment["targetStartMs"] * target.fps / 1_000)),
                "endFrameExclusive": min(
                    target.frames,
                    max(
                        1,
                        round(segment["targetEndMs"] * target.fps / 1_000),
                    ),
                ),
            },
            "confidence": 1.0 if audio_event_review is not None else 0.6,
            "status": "reviewed" if audio_event_review is not None else "derived",
        }
        for segment in planned_audio_segments
    ]
    audio_evidence["events"] = audio_events
    audio_evidence["eventReview"] = (
        {
            "schemaVersion": audio_event_review["schemaVersion"],
            "method": audio_event_review["method"],
        }
        if audio_event_review is not None
        else None
    )
    audio_evidence["musicIdentification"] = (
        {
            "identity": {
                "title": music_identification["title"],
                "artist": music_identification["artist"],
                **(
                    {"isrc": music_identification["isrc"]}
                    if "isrc" in music_identification
                    else {}
                ),
            },
            "confidence": music_identification["confidence"],
            "sourceOffsetMs": 0.0,
            "releasedMasterOffsetMs": round(
                music_identification["excerptStartSeconds"] * 1_000, 3
            ),
            "releasedMasterGainDb": music_identification.get("releasedMasterGainDb"),
            **(
                {"provider": music_identification["provider"]}
                if "provider" in music_identification
                else {}
            ),
        }
        if music_identification is not None
        else None
    )
    audio_evidence["routing"] = {
        "sourceRoutes": "muted",
        "sourceGainDb": -120.0,
        "musicGainDb": 0.0 if target_derived_music is not None else None,
    }
    audio_evidence["fidelityAuthorization"] = {
        "authorized": target_derived_music is not None,
        "proofRef": (
            args.target_audio_authorization_proof_ref
            if target_derived_music is not None
            else None
        ),
        "autonomousMusicSelectionEligible": False,
        "reason": (
            "The music render asset is derived from the authorized target."
            if target_derived_music is not None
            else "No renderable music asset was selected."
        ),
    }
    versions = tool_versions(args.ffmpeg, args.ffprobe)
    evidence = {
        "schemaVersion": EVIDENCE_SCHEMA,
        "id": f"evidence.{run_digest}",
        "runId": run_id,
        "createdAt": created_at,
        "toolVersions": versions,
        "model": {
            "role": "pose-landmarker",
            "sha256": f"sha256:{sha256_file(pose_model)}",
        },
        "parameters": {
            "sceneThreshold": args.scene_threshold,
            "poseSampleFps": args.pose_sample_fps,
            "ocrSampleSeconds": args.ocr_sample_seconds,
            "ocrMinConfidence": args.ocr_min_confidence,
        },
        "sceneDetection": {
            "detector": "PySceneDetect.ContentDetector",
            "detectedRanges": [
                {"startFrame": start, "endFrameExclusive": end} for start, end in detected
            ],
            "contentScoresAtCuts": [
                {"cutFrame": frame, "contentScore": score}
                for frame, score in sorted(content_scores.items())
            ],
            "blackRuns": [
                {"startFrame": start, "endFrameExclusive": end} for start, end in black_runs
            ],
            "finalCutFrames": cut_frames,
        },
        "sourceMatching": matching_evidence,
        "audio": audio_evidence,
        "ocr": ocr_evidence,
        "reviewPatches": review_patches,
        "privacy": {
            "rawPathsEmitted": False,
            "rawFilenamesEmitted": False,
            "externalReferencesUseNeutralAssetUris": True,
        },
    }
    assert_public_safe(
        [understanding, plan, evidence],
        [
            target.path,
            pose_model,
            *[source.path for source in sources],
            *(
                [args.music_identification_json.expanduser().resolve()]
                if args.music_identification_json is not None
                else []
            ),
            *(
                [args.audio_event_review_json.expanduser().resolve()]
                if args.audio_event_review_json is not None
                else []
            ),
        ],
    )
    understanding_path = output_dir / "edit-understanding.json"
    plan_path = output_dir / "edit-plan.json"
    evidence_path = output_dir / "analysis-evidence.json"
    timeline_path = output_dir / "edit-plan.otio"
    write_json(understanding_path, understanding)
    write_json(plan_path, plan)
    write_json(evidence_path, evidence)
    write_otio(plan, timeline_path, clip_confidence)
    otio_text = timeline_path.read_text(encoding="utf-8").casefold()
    for private_path in [
        target.path,
        pose_model,
        *[source.path for source in sources],
        *(
            [args.music_identification_json.expanduser().resolve()]
            if args.music_identification_json is not None
            else []
        ),
        *(
            [args.audio_event_review_json.expanduser().resolve()]
            if args.audio_event_review_json is not None
            else []
        ),
    ]:
        if private_path.name.casefold() in otio_text or str(private_path).casefold() in otio_text:
            timeline_path.unlink(missing_ok=True)
            raise RuntimeError("A private path or filename reached the OTIO payload.")
    return {
        "understanding": understanding_path,
        "plan": plan_path,
        "evidence": evidence_path,
        "timeline": timeline_path,
    }


def main() -> None:
    outputs = analyze(parse_args())
    print(
        json.dumps(
            {
                "status": "ok",
                "analyzer": ANALYZER_VERSION,
                "outputs": [path.name for path in outputs.values()],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
