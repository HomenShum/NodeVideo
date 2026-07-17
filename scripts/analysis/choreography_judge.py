#!/usr/bin/env python3
"""Compare MediaPipe pose tracks with confidence-aware temporal alignment.

This module intentionally judges observable motion only. It does not infer a
dancer's intent, musicality, expression, or artistic quality from pose geometry.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

LANDMARKS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
LEFT_RIGHT = {11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15,
              23: 24, 24: 23, 25: 26, 26: 25, 27: 28, 28: 27, 0: 0}
JOINT_TRIPLES = [(11, 13, 15), (12, 14, 16), (23, 25, 27), (24, 26, 28),
                 (13, 11, 23), (14, 12, 24)]


@dataclass
class Track:
    times: np.ndarray
    poses: np.ndarray


def load_track(path: Path) -> Track:
    data = np.load(path)
    poses = np.asarray(data["poses"], dtype=np.float32)
    if poses.ndim == 3:
        poses = poses[:, None, :, :]
    return Track(np.asarray(data["times"], dtype=np.float64), poses)


def pose_centroid(pose: np.ndarray) -> np.ndarray:
    visible = pose[:, 3] >= 0.35
    if visible.sum() < 5:
        return np.array([np.nan, np.nan], dtype=np.float32)
    return np.nanmean(pose[visible, :2], axis=0)


def ordered_people(frame: np.ndarray) -> list[np.ndarray]:
    people = [(pose_centroid(pose), pose) for pose in frame]
    people = [(center, pose) for center, pose in people if np.isfinite(center).all()]
    people.sort(key=lambda value: float(value[0][0]))
    return [pose for _, pose in people]


def normalized_pose(pose: np.ndarray, mirrored: bool = False) -> tuple[np.ndarray, np.ndarray]:
    hip = np.nanmean(pose[[23, 24], :2], axis=0)
    shoulder = np.nanmean(pose[[11, 12], :2], axis=0)
    scale = max(float(np.linalg.norm(shoulder - hip)),
                float(np.linalg.norm(pose[11, :2] - pose[12, :2])), 0.05)
    order = [LEFT_RIGHT[index] if mirrored else index for index in LANDMARKS]
    points = (pose[order, :2] - hip) / scale
    if mirrored:
        points[:, 0] *= -1
    visible = np.isfinite(points).all(axis=1) & (pose[order, 3] >= 0.35)
    return np.nan_to_num(points, nan=0.0), visible


def frame_descriptor(frame: np.ndarray, slots: int, mirrored: bool = False) -> tuple[np.ndarray, np.ndarray]:
    people = ordered_people(frame)
    if mirrored:
        people.reverse()
    points = np.zeros((slots, len(LANDMARKS), 2), dtype=np.float32)
    masks = np.zeros((slots, len(LANDMARKS)), dtype=bool)
    for index, pose in enumerate(people[:slots]):
        points[index], masks[index] = normalized_pose(pose, mirrored)
    return points.reshape(slots * len(LANDMARKS), 2), masks.reshape(slots * len(LANDMARKS))


def descriptor_track(track: Track, mirrored: bool = False, slots: int | None = None) -> tuple[np.ndarray, np.ndarray]:
    slots = slots or track.poses.shape[1]
    points, masks = zip(*(frame_descriptor(frame, slots, mirrored) for frame in track.poses))
    return np.asarray(points).reshape(len(points), -1), np.asarray(masks)


def motion_energy(descriptors: np.ndarray, masks: np.ndarray) -> np.ndarray:
    values = np.zeros(len(descriptors), dtype=np.float32)
    for index in range(1, len(descriptors)):
        shared = np.repeat(masks[index] & masks[index - 1], 2)
        if shared.sum() >= 10:
            values[index] = float(np.mean(np.abs(descriptors[index][shared] - descriptors[index - 1][shared])))
    return values


def align_tracks(reference: np.ndarray, ref_mask: np.ndarray, attempt: np.ndarray,
                 attempt_mask: np.ndarray) -> tuple[list[tuple[int, int]], float, str]:
    n, m = len(reference), len(attempt)
    if max(n, m) <= min(n, m) * 1.35:
        path, cost = dtw(reference, ref_mask, attempt, attempt_mask)
        return path, cost, "global"
    if n < m:
        reversed_path, cost, _ = align_tracks(attempt, attempt_mask, reference, ref_mask)
        return [(attempt_index, reference_index) for reference_index, attempt_index in reversed_path], cost, "subsequence"
    ref_energy = motion_energy(reference, ref_mask)
    attempt_energy = motion_energy(attempt, attempt_mask)
    ref_signal = (ref_energy - np.mean(ref_energy)) / max(float(np.std(ref_energy)), 1e-6)
    attempt_signal = (attempt_energy - np.mean(attempt_energy)) / max(float(np.std(attempt_energy)), 1e-6)
    correlation = np.correlate(ref_signal, attempt_signal, mode="valid")
    candidate_starts: list[int] = []
    minimum_separation = max(1, m // 3)
    for candidate in np.argsort(correlation)[::-1]:
        if all(abs(int(candidate) - selected) >= minimum_separation for selected in candidate_starts):
            candidate_starts.append(int(candidate))
        if len(candidate_starts) == min(5, len(correlation)):
            break
    best: tuple[list[tuple[int, int]], float] = ([], float("inf"))
    for start in candidate_starts:
        local_path, cost = dtw(
            reference[start:start + m], ref_mask[start:start + m], attempt, attempt_mask, band_ratio=.16
        )
        if cost < best[1]:
            best = ([(i + int(start), j) for i, j in local_path], cost)
    return best[0], best[1], "subsequence"


def masked_cost(a: np.ndarray, am: np.ndarray, b: np.ndarray, bm: np.ndarray) -> float:
    mask = np.repeat(am & bm, 2)
    if mask.sum() < 10:
        return 0.35
    return float(np.mean(np.abs(a[mask] - b[mask])))


def dtw(reference: np.ndarray, ref_mask: np.ndarray, attempt: np.ndarray,
        attempt_mask: np.ndarray, band_ratio: float = 0.22) -> tuple[list[tuple[int, int]], float]:
    n, m = len(reference), len(attempt)
    band = max(abs(n - m) + 2, math.ceil(max(n, m) * band_ratio))
    costs = np.full((n + 1, m + 1), np.inf, dtype=np.float32)
    previous = np.full((n + 1, m + 1), -1, dtype=np.int8)
    costs[0, 0] = 0
    for i in range(1, n + 1):
        expected = round(i * m / max(n, 1))
        for j in range(max(1, expected - band), min(m, expected + band) + 1):
            choices = (costs[i - 1, j - 1], costs[i - 1, j], costs[i, j - 1])
            choice = int(np.argmin(choices))
            costs[i, j] = choices[choice] + masked_cost(
                reference[i - 1], ref_mask[i - 1], attempt[j - 1], attempt_mask[j - 1]
            )
            previous[i, j] = choice
    if not np.isfinite(costs[n, m]):
        return [], float("inf")
    path: list[tuple[int, int]] = []
    i, j = n, m
    while i > 0 and j > 0:
        path.append((i - 1, j - 1))
        choice = previous[i, j]
        if choice == 0:
            i, j = i - 1, j - 1
        elif choice == 1:
            i -= 1
        else:
            j -= 1
    path.reverse()
    return path, float(costs[n, m] / max(len(path), 1))


def angle(p1: np.ndarray, p2: np.ndarray, p3: np.ndarray) -> float:
    a, b = p1 - p2, p3 - p2
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom < 1e-6:
        return float("nan")
    return float(np.arccos(np.clip(np.dot(a, b) / denom, -1, 1)))


def group_centers(frame: np.ndarray) -> np.ndarray:
    centers = [pose_centroid(pose) for pose in ordered_people(frame)]
    return np.asarray(centers, dtype=np.float32)


def score(reference: Track, attempt: Track) -> dict:
    slots = max(reference.poses.shape[1], attempt.poses.shape[1])
    ref_desc, ref_mask = descriptor_track(reference, slots=slots)
    candidates = []
    for mirrored in (False, True):
        att_desc, att_mask = descriptor_track(attempt, mirrored, slots)
        path, cost, alignment_mode = align_tracks(ref_desc, ref_mask, att_desc, att_mask)
        candidates.append((cost, mirrored, path, att_desc, att_mask, alignment_mode))
    cost, mirrored, path, att_desc, att_mask, alignment_mode = min(candidates, key=lambda item: item[0])
    if not path:
        return abstention("alignment_failed")

    visibility = float(np.mean([np.mean(ref_mask[i] & att_mask[j]) for i, j in path]))
    shorter_length = min(len(reference.times), len(attempt.times))
    covered_shorter = len({j for _, j in path}) if len(attempt.times) <= len(reference.times) else len({i for i, _ in path})
    coverage = float(covered_shorter / max(shorter_length, 1))
    alignment_confidence = math.exp(-max(cost, 0) / 0.55)
    confidence = float(np.clip(visibility * coverage * alignment_confidence, 0, 1))

    distances, angle_errors, ref_velocity, att_velocity, timing_errors = [], [], [], [], []
    prior = None
    ref_start, ref_end = float(reference.times[path[0][0]]), float(reference.times[path[-1][0]])
    att_start, att_end = float(attempt.times[path[0][1]]), float(attempt.times[path[-1][1]])
    for i, j in path:
        mask = np.repeat(ref_mask[i] & att_mask[j], 2)
        if mask.any():
            distances.append(float(np.mean(np.abs(ref_desc[i][mask] - att_desc[j][mask]))))
        ref_people, att_people = ordered_people(reference.poses[i]), ordered_people(attempt.poses[j])
        if ref_people and att_people:
            if mirrored:
                att_people.reverse()
            for rp, original_ap in zip(ref_people, att_people):
                ap = original_ap
                if mirrored:
                    ap = original_ap.copy()
                    remapped = ap.copy()
                    for left, right in LEFT_RIGHT.items():
                        remapped[left] = ap[right]
                    ap = remapped
                for a, b, c in JOINT_TRIPLES:
                    ra, aa = angle(rp[a,:2], rp[b,:2], rp[c,:2]), angle(ap[a,:2], ap[b,:2], ap[c,:2])
                    if np.isfinite(ra) and np.isfinite(aa):
                        angle_errors.append(abs(ra-aa))
        linear_t = att_start + (reference.times[i] - ref_start) / max(ref_end - ref_start, 1e-6) * (att_end - att_start)
        timing_errors.append(abs(float(attempt.times[j] - linear_t)))
        if prior:
            pi, pj = prior
            ref_velocity.append(float(np.linalg.norm(ref_desc[i] - ref_desc[pi])))
            att_velocity.append(float(np.linalg.norm(att_desc[j] - att_desc[pj])))
        prior = (i, j)

    mean_distance = float(np.mean(distances)) if distances else 3.0
    mean_angle = float(np.mean(angle_errors)) if angle_errors else math.pi
    form = 100 * math.exp(-mean_angle / 0.65)
    path_accuracy = 100 * math.exp(-mean_distance / 0.42)
    median_timing = float(np.median(timing_errors)) if timing_errors else 9.9
    timing = 100 * math.exp(-median_timing / 0.32)
    if len(ref_velocity) > 2 and np.std(ref_velocity) > 1e-6 and np.std(att_velocity) > 1e-6:
        dynamics_corr = float(np.corrcoef(ref_velocity, att_velocity)[0, 1])
    else:
        dynamics_corr = 0.0
    dynamics = 50 * (1 + np.clip(dynamics_corr, -1, 1))

    group_pairs = []
    count_matches = []
    for i, j in path[::max(1, len(path)//120)]:
        rc, ac = group_centers(reference.poses[i]), group_centers(attempt.poses[j])
        count_matches.append(1.0 if len(rc) == 0 and len(ac) == 0 else min(len(rc), len(ac)) / max(len(rc), len(ac), 1))
        if len(rc) > 1 and len(rc) == len(ac):
            rspan, aspan = max(np.ptp(rc[:,0]), .05), max(np.ptp(ac[:,0]), .05)
            group_pairs.append(float(np.mean(np.abs((rc[:,0]-rc[:,0].mean())/rspan - (ac[:,0]-ac[:,0].mean())/aspan))))
    formation = 100 * float(np.mean(count_matches))
    if group_pairs:
        formation *= math.exp(-float(np.mean(group_pairs)) / .28)

    per_pair = [(pair_cost, i, j) for i, j in path
                if np.count_nonzero(ref_mask[i] & att_mask[j]) >= 5
                for pair_cost in [masked_cost(ref_desc[i], ref_mask[i], att_desc[j], att_mask[j])]
                if pair_cost >= .12]
    separated = []
    for pair_cost, i, j in sorted(per_pair, reverse=True):
        if all(abs(reference.times[i] - moment[0]) > .75 for moment in separated):
            separated.append((float(reference.times[i]), float(attempt.times[j]), pair_cost))
        if len(separated) == 5:
            break

    issues = []
    if visibility < .55: issues.append("low_joint_visibility")
    if coverage < .72: issues.append("insufficient_overlap")
    if alignment_confidence < .52: issues.append("weak_motion_alignment")
    status = "abstained" if confidence < .45 else "completed"
    if status == "abstained" and not issues: issues.append("low_combined_confidence")
    fronts = {"form": form, "timing": timing, "path": path_accuracy,
              "dynamics": dynamics, "formation": formation}
    overall = float(np.average(list(fronts.values()), weights=[.30,.25,.20,.15,.10]))
    return {
        "schemaVersion": "nodevideo.choreography-verdict.v1",
        "status": status,
        "confidence": round(confidence, 4),
        "limitations": issues,
        "mirrorApplied": mirrored,
        "observableMotionOnly": True,
        "scores": {key: round(float(value), 1) for key, value in fronts.items()},
        "overall": round(overall, 1) if status == "completed" else None,
        "measurements": {"poseCost": round(cost, 5), "jointCoverage": round(visibility, 4),
                         "durationCoverage": round(coverage, 4), "medianTimingErrorMs": round(median_timing*1000),
                         "alignmentMode": alignment_mode,
                         "referenceWindow": {"startSeconds": round(ref_start, 4), "endSeconds": round(ref_end, 4)},
                         "attemptWindow": {"startSeconds": round(att_start, 4), "endSeconds": round(att_end, 4)}},
        "alignment": [{"referenceFrame": i, "attemptFrame": j,
                       "referenceTime": round(float(reference.times[i]), 4),
                       "attemptTime": round(float(attempt.times[j]), 4)} for i, j in path],
        "criticalMoments": [{"referenceTime": round(rt, 3), "attemptTime": round(at, 3),
                             "severity": round(float(min(pc/1.2, 1)), 3)} for rt, at, pc in separated],
        "scoreBoundaries": {
            "judged": ["2D pose form", "motion timing", "body path", "pose-speed dynamics", "coarse formation"],
            "notJudged": ["artistry", "musicality", "expression", "confidence", "creator taste", "safety"]
        }
    }


def abstention(reason: str) -> dict:
    return {"schemaVersion": "nodevideo.choreography-verdict.v1", "status": "abstained",
            "confidence": 0.0, "limitations": [reason], "observableMotionOnly": True,
            "scores": {}, "overall": None, "alignment": [], "criticalMoments": []}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-track", required=True, type=Path)
    parser.add_argument("--attempt-track", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = score(load_track(args.reference_track), load_track(args.attempt_track))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("status", "confidence", "overall")}))


if __name__ == "__main__":
    main()
