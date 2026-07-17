#!/usr/bin/env python3
"""Select the reference performer and align creator takes using normalized MediaPipe poses."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

JOINTS = np.asarray([0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--reference-start-seconds", required=True, type=float)
    parser.add_argument("--take", action="append", default=[], metavar="ASSET_ID=POSE_NPZ")
    parser.add_argument("--duration-seconds", required=True, type=float)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    return parser.parse_args()


def normalize(xy: np.ndarray) -> np.ndarray:
    with np.errstate(invalid="ignore"):
        hips = np.nanmean(xy[..., [23, 24], :], axis=-2)
        shoulders = np.nanmean(xy[..., [11, 12], :], axis=-2)
    scale = np.linalg.norm(shoulders - hips, axis=-1)
    return (xy - hips[..., None, :]) / (scale[..., None, None] + 1e-6)


def parse_takes(values: list[str]) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for value in values:
        asset_id, separator, path = value.partition("=")
        if not separator or not asset_id.startswith("asset.take-") or asset_id in result:
            raise ValueError(f"Invalid take binding: {value}")
        result[asset_id] = Path(path)
    if len(result) < 2:
        raise ValueError("At least two creator takes are required")
    return result


def pose_distance(a: np.ndarray, a_visibility: np.ndarray, b: np.ndarray, b_visibility: np.ndarray) -> float:
    valid = (
        np.isfinite(a).all(axis=1)
        & np.isfinite(b).all(axis=1)
        & (a_visibility > 0.25)
        & (b_visibility > 0.25)
    )
    if valid.sum() < 7:
        return float("inf")
    mirrored = b.copy()
    mirrored[:, 0] *= -1
    return min(
        float(np.median(np.linalg.norm(a[valid] - b[valid], axis=1))),
        float(np.median(np.linalg.norm(a[valid] - mirrored[valid], axis=1))),
    )


def scan_take(
    reference_times: np.ndarray,
    reference_pose: np.ndarray,
    reference_visibility: np.ndarray,
    take_times: np.ndarray,
    take_pose: np.ndarray,
    take_visibility: np.ndarray,
    duration: float,
) -> tuple[float, float, list[dict[str, float]]]:
    relative_times = reference_times - reference_times[0]
    scan_indices = np.arange(0, len(relative_times), 2)
    maximum = max(0.0, float(take_times[-1] - duration + 0.5))
    candidates: list[tuple[float, float]] = []
    for offset in np.arange(0, maximum + 0.001, 0.1):
        raw_indices = np.clip(
            np.searchsorted(take_times, offset + relative_times[scan_indices]),
            0,
            len(take_times) - 1,
        )
        distances: list[float] = []
        for reference_index, raw_index in zip(scan_indices, raw_indices):
            best = min(
                pose_distance(
                    take_pose[raw_index],
                    take_visibility[raw_index],
                    reference_pose[reference_index, person_index],
                    reference_visibility[reference_index, person_index],
                )
                for person_index in range(reference_pose.shape[1])
            )
            if np.isfinite(best):
                distances.append(best)
        if len(distances) >= max(20, len(scan_indices) // 2):
            candidates.append((float(np.median(distances)), float(offset)))
    candidates.sort()
    if not candidates:
        raise RuntimeError("No admissible pose alignment was found")
    best_score, best_offset = candidates[0]
    return best_offset, best_score, [
        {"offsetSeconds": round(offset, 3), "medianDistance": round(score, 6)}
        for score, offset in candidates[:10]
    ]


def main() -> None:
    args = parse_args()
    reference = np.load(args.reference)
    reference_times = np.asarray(reference["times"], dtype=np.float64)
    reference_raw = np.asarray(reference["poses"], dtype=np.float32)
    if reference_raw.ndim != 4 or reference_raw.shape[2] < 29:
        raise ValueError("Reference must be a multi-pose Landmarker track")
    reference_pose = normalize(reference_raw[..., :2])[:, :, JOINTS]
    reference_visibility = reference_raw[..., 3][:, :, JOINTS]

    takes = {}
    alignments = {}
    for asset_id, path in parse_takes(args.take).items():
        payload = np.load(path)
        raw = np.asarray(payload["poses"], dtype=np.float32)
        if raw.ndim == 4 and raw.shape[1] == 1:
            raw = raw[:, 0]
        if raw.ndim != 3:
            raise ValueError(f"Take {asset_id} must contain exactly one performer track")
        pose = normalize(raw[None, ..., :2])[0][:, JOINTS]
        visibility = raw[:, JOINTS, 3 if raw.shape[2] >= 4 else 2]
        times = np.asarray(payload["times"], dtype=np.float64)
        offset, distance, alternatives = scan_take(
            reference_times,
            reference_pose,
            reference_visibility,
            times,
            pose,
            visibility,
            args.duration_seconds,
        )
        takes[asset_id] = (times, pose, visibility)
        alignments[asset_id] = {
            "choreographyStartSeconds": round(offset, 3),
            "medianNormalizedPoseDistance": round(distance, 6),
            "alternatives": alternatives,
        }

    relative_times = reference_times - args.reference_start_seconds
    selected_indices: list[int] = []
    selected_poses: list[np.ndarray] = []
    selected_distances: list[float] = []
    for frame_index, relative_time in enumerate(relative_times):
        person_scores = []
        for person_index in range(reference_pose.shape[1]):
            distances = []
            for asset_id, (times, pose, visibility) in takes.items():
                raw_index = int(
                    np.clip(
                        np.searchsorted(
                            times,
                            alignments[asset_id]["choreographyStartSeconds"] + relative_time,
                        ),
                        0,
                        len(times) - 1,
                    )
                )
                distance = pose_distance(
                    pose[raw_index],
                    visibility[raw_index],
                    reference_pose[frame_index, person_index],
                    reference_visibility[frame_index, person_index],
                )
                if np.isfinite(distance):
                    distances.append(distance)
            person_scores.append(float(np.mean(distances)) if distances else float("inf"))
        selected = int(np.argmin(person_scores))
        selected_indices.append(selected)
        selected_distances.append(person_scores[selected])
        # The existing analyzer accepts x/y/visibility tracks.
        selected_poses.append(reference_raw[frame_index, selected, :, [0, 1, 3]].T)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.output,
        times=reference_times,
        poses=np.asarray(selected_poses, dtype=np.float32),
        referencePersonIndices=np.asarray(selected_indices, dtype=np.int16),
    )
    report = {
        "schemaVersion": "nodevideo.reference-performer-selection.v1",
        "referenceStartSeconds": args.reference_start_seconds,
        "durationSeconds": args.duration_seconds,
        "method": "minimum-mirrored-root-normalized-mediapipe-distance-across-creator-takes",
        "sampleCadenceHz": round(1 / float(np.median(np.diff(reference_times))), 6),
        "alignments": alignments,
        "selection": {
            "sampleCount": len(selected_indices),
            "medianDistance": round(float(np.nanmedian(selected_distances)), 6),
            "personIndexChanges": int(np.count_nonzero(np.diff(selected_indices))),
        },
        "limitations": [
            "Reference person indices are per-frame detector slots, not persistent identities.",
            "Mirroring is evaluated because the creator practiced from a mirrored choreography view.",
            "The held-out final edit was not an input.",
        ],
    }
    args.report.write_bytes((json.dumps(report, indent=2) + "\n").encode("utf-8"))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
