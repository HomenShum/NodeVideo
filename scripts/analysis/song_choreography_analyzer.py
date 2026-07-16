#!/usr/bin/env python3
"""Source-only song/choreography analysis for repeated dance takes.

The analyzer accepts precomputed pose tracks and a separately declared music input. It never
accepts a finished edit. It aligns repeated takes to a creator-selected choreography reference,
segments a short-form hook with a reusable beat-count grammar, scores every take per phrase, and
emits neutral IDs only. Pose extraction remains an upstream capability; this module deliberately
has no MediaPipe/model import so replay and precomputed-source proofs stay lightweight.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import librosa
import numpy as np


SCHEMA_VERSION = "nodevideo.song-choreography-analysis.v1"
ANALYZER_VERSION = "nodevideo.song-choreography-analyzer@0.1.0"
CORE_JOINTS = np.asarray([0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28])


@dataclass(frozen=True)
class PoseTrack:
    asset_id: str
    path: Path
    times: np.ndarray
    raw_xy: np.ndarray
    normalized_xy: np.ndarray
    motion: np.ndarray
    sample_rate: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-asset-id", required=True)
    parser.add_argument("--reference-pose", type=Path, required=True)
    parser.add_argument("--reference-start-seconds", type=float, required=True)
    parser.add_argument(
        "--take-pose",
        action="append",
        default=[],
        metavar="ASSET_ID=POSE_NPZ",
        help="Repeat for every render take, including the selected fallback reference take.",
    )
    parser.add_argument("--music", type=Path, required=True)
    parser.add_argument("--duration-seconds", type=float, required=True)
    parser.add_argument("--phrase-beats", default="12,16,6,10")
    parser.add_argument("--lyrics-json", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument(
        "--quality-tolerance",
        type=float,
        default=0.4,
        help="Maximum score gap allowed for an intentional contrast cut (default: 0.4).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.reference_start_seconds < 0 or args.duration_seconds <= 0:
        raise ValueError("Reference start must be non-negative and duration must be positive.")
    if not 0 <= args.quality_tolerance <= 1:
        raise ValueError("--quality-tolerance must be between 0 and 1.")
    phrase_beats = [int(value) for value in args.phrase_beats.split(",") if value.strip()]
    if not phrase_beats or any(value <= 0 for value in phrase_beats):
        raise ValueError("--phrase-beats must contain positive beat counts.")

    take_bindings = parse_bindings(args.take_pose)
    if args.reference_asset_id not in take_bindings:
        raise ValueError("The reference asset must also appear in --take-pose for fallback rendering.")
    reference = load_pose_track(args.reference_asset_id, args.reference_pose)
    takes = {
        asset_id: load_pose_track(asset_id, path) for asset_id, path in take_bindings.items()
    }
    music = analyze_music(args.music, args.ffmpeg)
    boundaries = build_phrase_boundaries(
        tempo=music["bpm"],
        beats_ms=music["beatsMs"],
        duration_seconds=args.duration_seconds,
        phrase_beats=phrase_beats,
    )
    alignments = align_takes(
        reference=reference,
        takes=takes,
        reference_start=args.reference_start_seconds,
        duration=args.duration_seconds,
    )
    phrases = score_phrases(
        reference=reference,
        takes=takes,
        alignments=alignments,
        boundaries=boundaries,
        reference_asset_id=args.reference_asset_id,
        quality_tolerance=args.quality_tolerance,
    )
    lyrics = read_lyrics(args.lyrics_json, args.duration_seconds)
    warnings = []
    if args.reference_pose.resolve() == take_bindings[args.reference_asset_id].resolve():
        warnings.append(
            "No independent choreography reference was supplied; the creator-selected canonical "
            "take is used as a disclosed fallback reference."
        )
    if not lyrics:
        warnings.append("No independent timed lyrics were supplied; no lyric overlays are invented.")

    artifact = {
        "schemaVersion": SCHEMA_VERSION,
        "analyzerVersion": ANALYZER_VERSION,
        "mode": "song-conditioned-source-only",
        "reference": {
            "assetId": args.reference_asset_id,
            "sha256": sha256(args.reference_pose),
            "choreographyStartSeconds": round_number(args.reference_start_seconds),
            "role": "creator-selected-canonical-fallback",
        },
        "music": {
            "assetId": "asset.music",
            "sha256": sha256(args.music),
            "durationSeconds": round_number(music["durationSeconds"]),
            "segment": {"startSeconds": 0, "endSeconds": round_number(args.duration_seconds)},
            "beatGrid": {
                "bpm": round_number(music["bpm"]),
                "offsetMs": round_number(music["beatsMs"][0] if music["beatsMs"] else 0),
                "beatsMs": [round_number(value) for value in music["beatsMs"]],
                "downbeatsMs": [round_number(value) for value in music["downbeatsMs"]],
                "confidence": round_number(music["confidence"]),
            },
        },
        "tasteTemplate": {
            "id": "short-form-hook-build-accent-response-resolve.v1",
            "phraseBeatCounts": phrase_beats,
            "boundaryPolicy": "accumulated-beat-count-snapped-to-nearest-detected-beat",
            "takePolicy": "quality-gated-contrast-with-switch-when-within-tolerance",
            "qualityTolerance": args.quality_tolerance,
        },
        "alignments": alignments,
        "phrases": phrases,
        "lyricCues": lyrics,
        "targetIsolation": {
            "finishedEditAcceptedAsInput": False,
            "targetPictureRead": False,
            "targetPlanRead": False,
        },
        "warnings": warnings,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes((json.dumps(artifact, indent=2) + "\n").encode("utf-8"))
    print(f"Wrote {args.output} with {len(phrases)} phrase decisions.")


def parse_bindings(values: list[str]) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"Invalid take binding: {value}")
        asset_id, raw_path = value.split("=", 1)
        asset_id = asset_id.strip()
        path = Path(raw_path).expanduser().resolve()
        if not asset_id.startswith("asset.take-"):
            raise ValueError("Take IDs must use the neutral asset.take-* namespace.")
        if asset_id in result:
            raise ValueError(f"Duplicate take binding: {asset_id}")
        if not path.is_file():
            raise FileNotFoundError(path)
        result[asset_id] = path
    if len(result) < 2:
        raise ValueError("At least two creator takes are required.")
    return result


def load_pose_track(asset_id: str, path: Path) -> PoseTrack:
    if not path.is_file():
        raise FileNotFoundError(path)
    payload = np.load(path)
    times = np.asarray(payload["times"], dtype=np.float64)
    poses = np.asarray(payload["poses"], dtype=np.float64)
    if times.ndim != 1 or poses.ndim != 3 or poses.shape[0] != len(times) or poses.shape[1] < 29:
        raise ValueError(f"Unsupported pose track shape for {asset_id}.")
    raw_xy = poses[:, :, :2]
    hip = (raw_xy[:, 23] + raw_xy[:, 24]) / 2
    shoulder_scale = np.linalg.norm(raw_xy[:, 11] - raw_xy[:, 12], axis=1)
    shoulder_scale = np.maximum(shoulder_scale, 0.05)
    normalized = (raw_xy - hip[:, None, :]) / shoulder_scale[:, None, None]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        velocity = np.nanmedian(
            np.linalg.norm(np.diff(normalized, axis=0), axis=2), axis=1
        )
    velocity = np.nan_to_num(velocity, nan=0.0, posinf=0.0, neginf=0.0)
    motion = np.convolve(velocity, np.ones(5) / 5, mode="same")
    deltas = np.diff(times)
    sample_rate = 1 / float(np.median(deltas[deltas > 0]))
    return PoseTrack(asset_id, path, times, raw_xy, normalized, motion, sample_rate)


def analyze_music(path: Path, ffmpeg: str) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(path)
    sample_rate = 22050
    process = subprocess.run(
        [
            ffmpeg,
            "-v",
            "error",
            "-i",
            str(path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-f",
            "f32le",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    )
    samples = np.frombuffer(process.stdout, dtype="<f4").astype(np.float64)
    if len(samples) < sample_rate:
        raise ValueError("Music input must contain at least one second of audio.")
    hop_length = 512
    onset = librosa.onset.onset_strength(y=samples, sr=sample_rate, hop_length=hop_length)
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset, sr=sample_rate, hop_length=hop_length
    )
    bpm = float(np.asarray(tempo).reshape(-1)[0])
    beat_times = librosa.frames_to_time(
        beat_frames, sr=sample_rate, hop_length=hop_length
    )
    beats_ms = (beat_times * 1000).tolist()
    downbeats_ms = beats_ms[1::4] if len(beats_ms) > 1 else beats_ms
    strength = onset[beat_frames] if len(beat_frames) else np.asarray([])
    confidence = 0.0
    if len(strength):
        confidence = float(np.clip(np.median(strength) / (np.max(onset) + 1e-9), 0, 1))
    return {
        "durationSeconds": len(samples) / sample_rate,
        "bpm": bpm,
        "beatsMs": beats_ms,
        "downbeatsMs": downbeats_ms,
        "confidence": confidence,
    }


def build_phrase_boundaries(
    tempo: float, beats_ms: list[float], duration_seconds: float, phrase_beats: list[int]
) -> list[float]:
    ideal = []
    cursor = 0.0
    seconds_per_beat = 60 / tempo
    for beat_count in phrase_beats:
        cursor += beat_count * seconds_per_beat
        if cursor >= duration_seconds - 0.25:
            break
        detected = [value / 1000 for value in beats_ms]
        snapped = min(detected, key=lambda value: abs(value - cursor)) if detected else cursor
        if ideal and snapped <= ideal[-1] + 0.25:
            snapped = cursor
        ideal.append(float(np.clip(snapped, 0.25, duration_seconds - 0.25)))
    return [0.0, *ideal, duration_seconds]


def align_takes(
    reference: PoseTrack,
    takes: dict[str, PoseTrack],
    reference_start: float,
    duration: float,
) -> list[dict[str, Any]]:
    results = []
    for asset_id, take in takes.items():
        if asset_id == reference.asset_id:
            offset, distance = reference_start, 0.0
        else:
            offset, distance = scan_offset(reference, take, reference_start, duration)
        results.append(
            {
                "takeAssetId": asset_id,
                "choreographyStartSeconds": round_number(offset),
                "method": "identity" if asset_id == reference.asset_id else "normalized-pose-offset-search",
                "medianNormalizedPoseDistance": round_number(distance),
                "confidence": round_number(math.exp(-distance)),
            }
        )
    return results


def scan_offset(
    reference: PoseTrack, take: PoseTrack, reference_start: float, duration: float
) -> tuple[float, float]:
    maximum = float(take.times[-1] - min(duration, 30.0))
    if maximum <= 0:
        raise ValueError(f"{take.asset_id} is shorter than the alignment window.")
    offsets = np.arange(0, maximum + 0.001, 0.1)
    sample_duration = min(duration, 30.0, reference.times[-1] - reference_start)
    timeline = np.arange(0, sample_duration, 0.2)
    reference_samples = interpolate_pose(reference, reference_start + timeline)[:, CORE_JOINTS]
    scores = []
    for offset in offsets:
        candidate = interpolate_pose(take, offset + timeline)[:, CORE_JOINTS]
        distance = np.linalg.norm(reference_samples - candidate, axis=2)
        scores.append(float(np.nanmedian(distance)))
    index = int(np.nanargmin(scores))
    return float(offsets[index]), scores[index]


def score_phrases(
    reference: PoseTrack,
    takes: dict[str, PoseTrack],
    alignments: list[dict[str, Any]],
    boundaries: list[float],
    reference_asset_id: str,
    quality_tolerance: float,
) -> list[dict[str, Any]]:
    offsets = {item["takeAssetId"]: float(item["choreographyStartSeconds"]) for item in alignments}
    result = []
    previous = None
    for index, (start, end) in enumerate(zip(boundaries, boundaries[1:])):
        timeline = np.arange(start, end, 0.1)
        reference_pose = interpolate_pose(reference, offsets[reference_asset_id] + timeline)
        raw_candidates = []
        for asset_id, track in sorted(takes.items()):
            pose = interpolate_pose(track, offsets[asset_id] + timeline)
            raw = interpolate_raw(track, offsets[asset_id] + timeline)
            pose_distance = float(
                np.nanmedian(np.linalg.norm(reference_pose[:, CORE_JOINTS] - pose[:, CORE_JOINTS], axis=2))
            )
            completeness = float(np.mean(np.isfinite(raw[:, CORE_JOINTS]).all(axis=2)))
            visible = raw[:, CORE_JOINTS]
            framing = float(
                np.mean(
                    np.isfinite(visible).all(axis=2)
                    & (visible[:, :, 0] >= 0.015)
                    & (visible[:, :, 0] <= 0.985)
                    & (visible[:, :, 1] >= 0.015)
                    & (visible[:, :, 1] <= 0.985)
                )
            )
            motion = interpolate_motion(track, offsets[asset_id] + timeline)
            expression = float(np.nanmedian(motion))
            raw_candidates.append(
                {
                    "takeAssetId": asset_id,
                    "sourceStartSeconds": round_number(offsets[asset_id] + start),
                    "sourceEndSeconds": round_number(offsets[asset_id] + end),
                    "poseDistance": pose_distance,
                    "choreography": math.exp(-pose_distance),
                    "completeness": completeness,
                    "framing": framing,
                    "expression": expression,
                    "bodyBox": body_box(raw),
                }
            )
        expression_values = [item["expression"] for item in raw_candidates]
        low, high = min(expression_values), max(expression_values)
        for item in raw_candidates:
            expression_score = 0.5 if high - low < 1e-9 else (item["expression"] - low) / (high - low)
            item["scores"] = {
                "choreography": round_number(item.pop("choreography")),
                "completeness": round_number(item.pop("completeness")),
                "framing": round_number(item.pop("framing")),
                "expression": round_number(expression_score),
            }
            item["totalScore"] = round_number(
                0.4 * item["scores"]["choreography"]
                + 0.2 * item["scores"]["completeness"]
                + 0.15 * item["scores"]["framing"]
                + 0.25 * item["scores"]["expression"]
            )
            item["poseDistance"] = round_number(item["poseDistance"])
            item["groundingStatus"] = "manual-pose-replay"
        best = max(raw_candidates, key=lambda value: value["totalScore"])
        if index == 0:
            selected = next(value for value in raw_candidates if value["takeAssetId"] == reference_asset_id)
            reason = "Creator-selected canonical take opens the sequence."
        else:
            alternatives = [
                value
                for value in raw_candidates
                if value["takeAssetId"] != previous
                and best["totalScore"] - value["totalScore"] <= quality_tolerance
            ]
            selected = max(alternatives, key=lambda value: value["totalScore"]) if alternatives else best
            reason = (
                "Quality-gated contrast selected a different clean take."
                if selected["takeAssetId"] != previous
                else "The quality margin blocked a cosmetic take switch."
            )
        previous = selected["takeAssetId"]
        result.append(
            {
                "id": f"phrase.{index + 1}",
                "timelineStartSeconds": round_number(start),
                "timelineEndSeconds": round_number(end),
                "candidates": raw_candidates,
                "selectedTakeAssetId": selected["takeAssetId"],
                "selectionReason": reason,
                "captionSafeZone": caption_safe_zone(selected["bodyBox"]),
            }
        )
    return result


def interpolate_pose(track: PoseTrack, times: np.ndarray) -> np.ndarray:
    return interpolate_array(track.times, track.normalized_xy, times)


def interpolate_raw(track: PoseTrack, times: np.ndarray) -> np.ndarray:
    return interpolate_array(track.times, track.raw_xy, times)


def interpolate_array(source_times: np.ndarray, values: np.ndarray, times: np.ndarray) -> np.ndarray:
    indices = np.clip(np.searchsorted(source_times, times), 1, len(source_times) - 1)
    left = indices - 1
    choose_right = np.abs(source_times[indices] - times) < np.abs(source_times[left] - times)
    nearest = np.where(choose_right, indices, left)
    return values[nearest]


def interpolate_motion(track: PoseTrack, times: np.ndarray) -> np.ndarray:
    motion_times = track.times[: len(track.motion)]
    indices = np.clip(np.searchsorted(motion_times, times), 0, len(track.motion) - 1)
    return track.motion[indices]


def body_box(raw: np.ndarray) -> dict[str, float]:
    points = raw[:, CORE_JOINTS].reshape(-1, 2)
    points = points[np.isfinite(points).all(axis=1)]
    if not len(points):
        return {"x": 0.2, "y": 0.15, "width": 0.6, "height": 0.75}
    minimum = np.quantile(points, 0.03, axis=0)
    maximum = np.quantile(points, 0.97, axis=0)
    x = float(np.clip(minimum[0], 0, 1))
    y = float(np.clip(minimum[1], 0, 1))
    width = float(np.clip(maximum[0] - x, 0.01, 1 - x))
    height = float(np.clip(maximum[1] - y, 0.01, 1 - y))
    return {key: round_number(value) for key, value in {"x": x, "y": y, "width": width, "height": height}.items()}


def caption_safe_zone(box: dict[str, float]) -> dict[str, float]:
    top_space = box["y"]
    bottom_space = 1 - (box["y"] + box["height"])
    if top_space >= 0.12 or top_space >= bottom_space:
        y = max(0.035, min(0.16, top_space * 0.3))
    else:
        y = min(0.86, box["y"] + box["height"] + 0.025)
    return {"x": 0.1, "y": round_number(y), "width": 0.8, "height": 0.075}


def read_lyrics(path: Path | None, duration_seconds: float) -> list[dict[str, Any]]:
    if path is None:
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    cues = payload["cues"] if isinstance(payload, dict) else payload
    if not isinstance(cues, list):
        raise ValueError("Lyrics JSON must be a cue array or an object with a cues array.")
    result = []
    for index, cue in enumerate(cues):
        text = str(cue.get("text", "")).strip()
        start = float(cue.get("startSeconds"))
        end = float(cue.get("endSeconds"))
        if not text or start < 0 or end <= start or end > duration_seconds + 1e-6:
            raise ValueError(f"Invalid lyric cue at index {index}.")
        result.append(
            {
                "id": f"lyric.{index + 1}",
                "text": text,
                "startSeconds": round_number(start),
                "endSeconds": round_number(end),
            }
        )
    return result


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def round_number(value: float) -> float:
    return round(float(value), 6)


if __name__ == "__main__":
    main()
