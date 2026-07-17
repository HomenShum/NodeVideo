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
from scipy.optimize import linear_sum_assignment

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
    if poses.shape[-1] == 3:
        converted = np.full((*poses.shape[:-1], 4), np.nan, dtype=np.float32)
        converted[..., :2] = poses[..., :2]
        converted[..., 2] = 0
        converted[..., 3] = poses[..., 2]
        poses = converted
    # score() owns identity stabilization so direct callers and loaded tracks
    # follow one identical path without paying the association cost twice.
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
    if pose.shape[-1] < 4 or not np.isfinite(pose[[11, 12, 23, 24], :2]).any():
        return np.zeros((len(LANDMARKS), 2), dtype=np.float32), np.zeros(len(LANDMARKS), dtype=bool)
    hip = np.nanmean(pose[[23, 24], :2], axis=0)
    shoulder = np.nanmean(pose[[11, 12], :2], axis=0)
    if not np.isfinite(hip).all() or not np.isfinite(shoulder).all():
        return np.zeros((len(LANDMARKS), 2), dtype=np.float32), np.zeros(len(LANDMARKS), dtype=bool)
    scale = max(float(np.linalg.norm(shoulder - hip)),
                float(np.linalg.norm(pose[11, :2] - pose[12, :2])), 0.05)
    order = [LEFT_RIGHT[index] if mirrored else index for index in LANDMARKS]
    points = (pose[order, :2] - hip) / scale
    if mirrored:
        points[:, 0] *= -1
    visible = np.isfinite(points).all(axis=1) & (pose[order, 3] >= 0.35)
    return np.nan_to_num(points, nan=0.0), visible


def tracking_cost(previous: np.ndarray, current: np.ndarray) -> float:
    previous_center, current_center = pose_centroid(previous), pose_centroid(current)
    if not np.isfinite(previous_center).all() or not np.isfinite(current_center).all():
        return float("inf")
    previous_points, previous_mask = normalized_pose(previous)
    current_points, current_mask = normalized_pose(current)
    shared = previous_mask & current_mask
    shape = float(np.median(np.linalg.norm(previous_points[shared] - current_points[shared], axis=1))) \
        if shared.sum() >= 5 else .8
    return float(np.linalg.norm(previous_center - current_center) + .18 * shape)


def stabilize_people(poses: np.ndarray, maximum_gap: int = 15) -> np.ndarray:
    """Convert unstable per-frame detector order into bounded persistent slots."""
    if poses.shape[1] <= 1:
        return poses.copy()
    stable = np.full_like(poses, np.nan)
    last_pose: list[np.ndarray | None] = [None] * poses.shape[1]
    last_seen = np.full(poses.shape[1], -maximum_gap - 1, dtype=np.int32)
    for frame_index, frame in enumerate(poses):
        detections = [pose for pose in frame if np.isfinite(pose_centroid(pose)).all()]
        detections.sort(key=lambda pose: float(pose_centroid(pose)[0]))
        active = [index for index, pose in enumerate(last_pose)
                  if pose is not None and frame_index - last_seen[index] <= maximum_gap]
        assigned_slots: set[int] = set()
        assigned_detections: set[int] = set()
        if active and detections:
            costs = np.asarray([[tracking_cost(last_pose[slot], detection)
                                 for detection in detections] for slot in active])
            rows, columns = linear_sum_assignment(costs)
            for row, column in zip(rows, columns):
                if costs[row, column] > .55:
                    continue
                slot = active[int(row)]
                stable[frame_index, slot] = detections[int(column)]
                last_pose[slot], last_seen[slot] = detections[int(column)], frame_index
                assigned_slots.add(slot)
                assigned_detections.add(int(column))
        available = [index for index in range(poses.shape[1]) if index not in assigned_slots and
                     (last_pose[index] is None or frame_index - last_seen[index] > maximum_gap)]
        for detection_index, slot in zip(
            [index for index in range(len(detections)) if index not in assigned_detections], available
        ):
            stable[frame_index, slot] = detections[detection_index]
            last_pose[slot], last_seen[slot] = detections[detection_index], frame_index
    return stable


def performer_descriptor(track: Track, person_index: int, mirrored: bool = False) -> tuple[np.ndarray, np.ndarray]:
    samples = [normalized_pose(frame[person_index], mirrored) for frame in track.poses]
    points, masks = zip(*samples)
    return np.asarray(points).reshape(len(points), -1), np.asarray(masks)


def active_people(track: Track) -> list[int]:
    minimum = max(3, round(len(track.times) * .03))
    return [person for person in range(track.poses.shape[1])
            if sum(np.isfinite(pose_centroid(frame[person])).all() for frame in track.poses) >= minimum]


def collapse_solo_tracklets(track: Track) -> Track:
    """Merge fragmented detector slots when no frame contains a real team."""
    counts = [sum(np.isfinite(pose_centroid(pose)).all() for pose in frame) for frame in track.poses]
    if track.poses.shape[1] <= 1 or float(np.median(counts)) >= 1.5:
        return track
    poses = np.full((len(track.times), 1, track.poses.shape[2], track.poses.shape[3]),
                    np.nan, dtype=track.poses.dtype)
    for frame_index, frame in enumerate(track.poses):
        candidates = [pose for pose in frame if np.isfinite(pose_centroid(pose)).all()]
        if not candidates:
            continue
        def quality(pose: np.ndarray) -> tuple[int, float]:
            visible = int(np.count_nonzero(pose[:, 3] >= .35))
            points = pose[pose[:, 3] >= .35, :2]
            span = float(np.ptp(points[:, 0]) * np.ptp(points[:, 1])) if len(points) >= 5 else 0
            return visible, span
        poses[frame_index, 0] = max(candidates, key=quality)
    return Track(track.times, poses)


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
        return pose_offset_dtw(reference, ref_mask, attempt, attempt_mask)
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
        if len(candidate_starts) == min(3, len(correlation)):
            break
    best: tuple[list[tuple[int, int]], float] = ([], float("inf"))
    for start in candidate_starts:
        local_path, cost = dtw(
            reference[start:start + m], ref_mask[start:start + m], attempt, attempt_mask, band_ratio=.16
        )
        if cost < best[1]:
            best = ([(i + int(start), j) for i, j in local_path], cost)
    return best[0], best[1], "subsequence"


def alignment_probe_cost(reference: np.ndarray, ref_mask: np.ndarray, attempt: np.ndarray,
                         attempt_mask: np.ndarray) -> float:
    """Rank performer hypotheses cheaply before allocating full DTW matrices."""
    n, m = len(reference), len(attempt)
    if n < m:
        return alignment_probe_cost(attempt, attempt_mask, reference, ref_mask)
    sample_count = min(160, m)
    sample_indices = np.linspace(0, m - 1, sample_count, dtype=np.int32)
    if n > m * 1.35:
        ref_energy = motion_energy(reference, ref_mask)
        attempt_energy = motion_energy(attempt, attempt_mask)
        ref_signal = (ref_energy - np.mean(ref_energy)) / max(float(np.std(ref_energy)), 1e-6)
        attempt_signal = (attempt_energy - np.mean(attempt_energy)) / max(float(np.std(attempt_energy)), 1e-6)
        start = int(np.argmax(np.correlate(ref_signal, attempt_signal, mode="valid")))
    else:
        maximum_shift = max(1, round(min(n, m) * .04))
        shifts = range(-maximum_shift, maximum_shift + 1, max(1, maximum_shift // 6))
        scored_shifts = []
        for shift in shifts:
            reference_start, attempt_start = max(shift, 0), max(-shift, 0)
            length = min(n - reference_start, m - attempt_start)
            probe = np.linspace(0, length - 1, min(sample_count, length), dtype=np.int32)
            costs = [masked_cost(reference[reference_start + index], ref_mask[reference_start + index],
                                 attempt[attempt_start + index], attempt_mask[attempt_start + index])
                     for index in probe]
            scored_shifts.append((float(np.median(costs)), reference_start, attempt_start, length))
        cost, _, _, _ = min(scored_shifts)
        return cost
    costs = [masked_cost(reference[start + index], ref_mask[start + index],
                         attempt[index], attempt_mask[index]) for index in sample_indices]
    return float(np.median(costs))


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


def pose_offset_dtw(reference: np.ndarray, ref_mask: np.ndarray, attempt: np.ndarray,
                    attempt_mask: np.ndarray) -> tuple[list[tuple[int, int]], float, str]:
    """Estimate bounded pre-roll by pose evidence, then run one local DTW."""
    n, m = len(reference), len(attempt)
    maximum_shift = max(1, round(min(n, m) * .04))
    sample_step = max(1, min(n, m) // 240)
    candidates = []
    for shift in range(-maximum_shift, maximum_shift + 1):
        reference_start, attempt_start = max(shift, 0), max(-shift, 0)
        length = min(n - reference_start, m - attempt_start)
        costs = [masked_cost(reference[i], ref_mask[i], attempt[j], attempt_mask[j])
                 for i, j in zip(range(reference_start, reference_start + length, sample_step),
                                 range(attempt_start, attempt_start + length, sample_step))]
        candidates.append((float(np.median(costs)) + .05 * abs(shift) / min(n, m),
                           shift, reference_start, attempt_start, length))
    _, shift, reference_start, attempt_start, length = min(candidates)
    local_path, cost = dtw(
        reference[reference_start:reference_start + length],
        ref_mask[reference_start:reference_start + length],
        attempt[attempt_start:attempt_start + length],
        attempt_mask[attempt_start:attempt_start + length],
        band_ratio=.16,
    )
    return ([(i + reference_start, j + attempt_start) for i, j in local_path], cost,
            "global" if shift == 0 else "pose-offset")


def select_performer_match(reference: Track, attempt: Track):
    reference_people = active_people(reference)
    attempt_people = active_people(attempt)
    similar_sample_lengths = max(len(reference.times), len(attempt.times)) <= \
        min(len(reference.times), len(attempt.times)) * 1.35
    if len(reference_people) > 1 and len(attempt_people) == 1 and similar_sample_lengths:
        return select_dynamic_focal_match(reference, attempt, attempt_people[0])
    probes = []
    for reference_person in reference_people:
        ref_desc, ref_mask = performer_descriptor(reference, reference_person)
        for attempt_person in attempt_people:
            for mirrored in (False, True):
                att_desc, att_mask = performer_descriptor(attempt, attempt_person, mirrored)
                probes.append((alignment_probe_cost(ref_desc, ref_mask, att_desc, att_mask),
                               reference_person, attempt_person, mirrored,
                               ref_desc, ref_mask, att_desc, att_mask))
    probes.sort(key=lambda item: item[0])
    budget = len(probes) if len(probes) <= 4 else (4 if len(attempt_people) == 1 else 8)
    candidates = []
    for _, reference_person, attempt_person, mirrored, ref_desc, ref_mask, att_desc, att_mask \
            in probes[:budget]:
        path, cost, alignment_mode = align_tracks(ref_desc, ref_mask, att_desc, att_mask)
        if not path:
            continue
        valid = [(i, j) for i, j in path if np.count_nonzero(ref_mask[i] & att_mask[j]) >= 5]
        if not valid:
            continue
        visibility = float(np.mean([np.mean(ref_mask[i] & att_mask[j]) for i, j in valid]))
        if len(attempt.times) <= len(reference.times):
            active_frames = max(1, int(np.count_nonzero(np.count_nonzero(att_mask, axis=1) >= 5)))
            covered = len({j for i, j in valid}) / active_frames
        else:
            active_frames = max(1, int(np.count_nonzero(np.count_nonzero(ref_mask, axis=1) >= 5)))
            covered = len({i for i, j in valid}) / active_frames
        confidence = visibility * min(1.0, covered) * math.exp(-max(cost, 0) / .55)
        candidates.append((confidence, -cost, reference_person, attempt_person, mirrored,
                           path, ref_desc, ref_mask, att_desc, att_mask, alignment_mode))
    return max(candidates, key=lambda item: item[:2]) if candidates else None


def select_reference_sequence(reference: Track, attempt: Track, path: list[tuple[int, int]],
                              attempt_person: int, mirrored: bool) -> list[int]:
    """Choose a temporally coherent reference performer along an established time path."""
    states = active_people(reference)
    if len(states) <= 1:
        return [states[0]] * len(path)
    emissions = np.full((len(path), len(states)), .6, dtype=np.float32)
    centers = np.full((len(path), len(states), 2), np.nan, dtype=np.float32)
    for step, (reference_index, attempt_index) in enumerate(path):
        attempt_points, attempt_mask = normalized_pose(attempt.poses[attempt_index, attempt_person], mirrored)
        for state_index, person in enumerate(states):
            reference_pose = reference.poses[reference_index, person]
            reference_points, reference_mask = normalized_pose(reference_pose)
            emissions[step, state_index] = masked_cost(
                reference_points.reshape(-1), reference_mask,
                attempt_points.reshape(-1), attempt_mask,
            )
            centers[step, state_index] = pose_centroid(reference_pose)
    costs = np.full_like(emissions, np.inf)
    previous = np.full(emissions.shape, -1, dtype=np.int16)
    costs[0] = emissions[0]
    for step in range(1, len(path)):
        for current in range(len(states)):
            transitions = costs[step - 1].copy()
            for prior in range(len(states)):
                if prior == current:
                    continue
                spatial = .25
                if np.isfinite(centers[step - 1, prior]).all() and np.isfinite(centers[step, current]).all():
                    spatial = float(np.linalg.norm(centers[step - 1, prior] - centers[step, current]))
                transitions[prior] += .25 + .20 * spatial
            best = int(np.argmin(transitions))
            costs[step, current] = transitions[best] + emissions[step, current]
            previous[step, current] = best
    state = int(np.argmin(costs[-1]))
    selected = [state]
    for step in range(len(path) - 1, 0, -1):
        state = int(previous[step, state])
        selected.append(state)
    selected.reverse()
    return [states[index] for index in selected]


def select_dynamic_focal_match(reference: Track, attempt: Track, attempt_person: int):
    reference_people = active_people(reference)
    reference_descriptors = {person: performer_descriptor(reference, person)
                             for person in reference_people}
    candidates = []
    for mirrored in (False, True):
        att_desc, att_mask = performer_descriptor(attempt, attempt_person, mirrored)
        maximum_shift = max(1, round(min(len(reference.times), len(attempt.times)) * .04))
        sample_step = max(1, min(len(reference.times), len(attempt.times)) // 240)
        offsets = []
        for shift in range(-maximum_shift, maximum_shift + 1):
            reference_start, attempt_start = max(shift, 0), max(-shift, 0)
            length = min(len(reference.times) - reference_start, len(attempt.times) - attempt_start)
            frame_costs = []
            for reference_index, attempt_index in zip(
                range(reference_start, reference_start + length, sample_step),
                range(attempt_start, attempt_start + length, sample_step),
            ):
                frame_costs.append(min(
                    masked_cost(reference_descriptors[person][0][reference_index],
                                reference_descriptors[person][1][reference_index],
                                att_desc[attempt_index], att_mask[attempt_index])
                    for person in reference_people
                ))
            offsets.append((float(np.median(frame_costs)) + .05 * abs(shift) / min(
                len(reference.times), len(attempt.times)), shift, reference_start, attempt_start, length))
        _, shift, reference_start, attempt_start, length = min(offsets)
        linear_path = list(zip(range(reference_start, reference_start + length),
                               range(attempt_start, attempt_start + length)))
        sequence = select_reference_sequence(reference, attempt, linear_path, attempt_person, mirrored)
        dynamic_points, dynamic_masks = [], []
        for (reference_index, _), person in zip(linear_path, sequence):
            dynamic_points.append(reference_descriptors[person][0][reference_index])
            dynamic_masks.append(reference_descriptors[person][1][reference_index])
        dynamic_points, dynamic_masks = np.asarray(dynamic_points), np.asarray(dynamic_masks)
        local_path, cost = dtw(dynamic_points, dynamic_masks,
                               att_desc[attempt_start:attempt_start + length],
                               att_mask[attempt_start:attempt_start + length], band_ratio=.16)
        path = [(i + reference_start, j + attempt_start) for i, j in local_path]
        valid = [(i, j) for i, j in path if np.count_nonzero(
            dynamic_masks[i - reference_start] & att_mask[j]) >= 5]
        visibility = float(np.mean([np.mean(dynamic_masks[i - reference_start] & att_mask[j])
                                    for i, j in valid])) if valid else 0
        confidence = visibility * math.exp(-max(cost, 0) / .55)
        first_person = sequence[0]
        ref_desc, ref_mask = reference_descriptors[first_person]
        candidates.append((confidence, -cost, first_person, attempt_person, mirrored, path,
                           ref_desc, ref_mask, att_desc, att_mask,
                           "global" if shift == 0 else "pose-offset-dynamic"))
    return max(candidates, key=lambda item: item[:2])


def angle(p1: np.ndarray, p2: np.ndarray, p3: np.ndarray) -> float:
    a, b = p1 - p2, p3 - p2
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom < 1e-6:
        return float("nan")
    return float(np.arccos(np.clip(np.dot(a, b) / denom, -1, 1)))


def group_centers(frame: np.ndarray) -> np.ndarray:
    centers = [pose_centroid(pose) for pose in ordered_people(frame)]
    return np.asarray(centers, dtype=np.float32)


def discover_attempt_window(reference: Track, attempt: Track) -> tuple[Track, dict]:
    """Use a selected short-form reference duration to find the take window."""
    reference_duration = float(reference.times[-1] - reference.times[0])
    attempt_duration = float(attempt.times[-1] - attempt.times[0])
    reference_people = active_people(reference)
    attempt_people = active_people(attempt)
    if (reference_duration < 5 or reference_duration > 90 or
            attempt_duration <= reference_duration * 1.2 or len(attempt_people) != 1):
        return attempt, {}
    attempt_step = float(np.median(np.diff(attempt.times)))
    window_samples = min(len(attempt.times), max(3, round(reference_duration / attempt_step) + 1))
    if window_samples >= len(attempt.times):
        return attempt, {}
    sample_count = min(120, len(reference.times), window_samples)
    reference_indices = np.linspace(0, len(reference.times) - 1, sample_count, dtype=np.int32)
    attempt_offsets = np.linspace(0, window_samples - 1, sample_count, dtype=np.int32)
    reference_descriptors = [performer_descriptor(reference, person) for person in reference_people]
    candidates = []
    start_step = max(1, round(1 / attempt_step))
    for mirrored in (False, True):
        attempt_descriptor, attempt_mask = performer_descriptor(attempt, attempt_people[0], mirrored)
        for start in range(0, len(attempt.times) - window_samples + 1, start_step):
            costs = []
            for reference_index, offset in zip(reference_indices, attempt_offsets):
                attempt_index = start + offset
                costs.append(min(
                    masked_cost(descriptor[reference_index], mask[reference_index],
                                attempt_descriptor[attempt_index], attempt_mask[attempt_index])
                    for descriptor, mask in reference_descriptors
                ))
            candidates.append((float(np.median(costs)), start, mirrored))
    if not candidates:
        return attempt, {}
    cost, start, mirrored = min(candidates)
    end = start + window_samples
    selected = Track(attempt.times[start:end], attempt.poses[start:end])
    return selected, {
        "attemptSegmentationMode": "pose-window-from-reference-duration",
        "attemptInputWindow": {
            "startSeconds": round(float(attempt.times[0]), 4),
            "endSeconds": round(float(attempt.times[-1]), 4),
        },
        "attemptCandidateWindow": {
            "startSeconds": round(float(selected.times[0]), 4),
            "endSeconds": round(float(selected.times[-1]), 4),
        },
        "attemptCandidatePoseCost": round(cost, 5),
        "attemptCandidateMirrored": mirrored,
    }


def score(reference: Track, attempt: Track) -> dict:
    reference = collapse_solo_tracklets(Track(reference.times, stabilize_people(reference.poses)))
    attempt = collapse_solo_tracklets(Track(attempt.times, stabilize_people(attempt.poses)))
    attempt, segmentation = discover_attempt_window(reference, attempt)
    if not active_people(reference) or not active_people(attempt):
        return abstention("low_joint_visibility")
    match = select_performer_match(reference, attempt)
    if match is None:
        return abstention("alignment_failed")
    _, negative_cost, reference_person, attempt_person, mirrored, path, ref_desc, ref_mask, \
        att_desc, att_mask, alignment_mode = match
    reference_sequence = select_reference_sequence(reference, attempt, path, attempt_person, mirrored)
    pair_ref_desc, pair_ref_mask = [], []
    for (reference_index, _), person in zip(path, reference_sequence):
        points, mask = normalized_pose(reference.poses[reference_index, person])
        pair_ref_desc.append(points.reshape(-1))
        pair_ref_mask.append(mask)
    pair_ref_desc, pair_ref_mask = np.asarray(pair_ref_desc), np.asarray(pair_ref_mask)
    pair_att_desc = np.asarray([att_desc[j] for _, j in path])
    pair_att_mask = np.asarray([att_mask[j] for _, j in path])
    valid_steps = [step for step in range(len(path))
                   if np.count_nonzero(pair_ref_mask[step] & pair_att_mask[step]) >= 5]
    if not valid_steps:
        return abstention("low_joint_visibility")
    pair_costs = [masked_cost(pair_ref_desc[step], pair_ref_mask[step],
                              pair_att_desc[step], pair_att_mask[step]) for step in valid_steps]
    cost = float(np.mean(pair_costs))
    visibility = float(np.mean([np.mean(pair_ref_mask[step] & pair_att_mask[step])
                                for step in valid_steps]))
    if len(attempt.times) <= len(reference.times):
        active_shorter = max(1, int(np.count_nonzero(np.count_nonzero(att_mask, axis=1) >= 5)))
        covered_shorter = len({path[step][1] for step in valid_steps})
    else:
        active_shorter = max(1, len({i for i, _ in path}))
        covered_shorter = len({path[step][0] for step in valid_steps})
    coverage = float(min(1, covered_shorter / active_shorter))
    alignment_confidence = math.exp(-max(cost, 0) / 0.55)
    confidence = float(np.clip(visibility * coverage * alignment_confidence, 0, 1))

    distances, angle_errors, ref_velocity, att_velocity, timing_errors = [], [], [], [], []
    ref_start, ref_end = float(reference.times[path[0][0]]), float(reference.times[path[-1][0]])
    att_start, att_end = float(attempt.times[path[0][1]]), float(attempt.times[path[-1][1]])
    for step, (i, j) in enumerate(path):
        mask = np.repeat(pair_ref_mask[step] & pair_att_mask[step], 2)
        if mask.any():
            distances.append(float(np.mean(np.abs(pair_ref_desc[step][mask] - pair_att_desc[step][mask]))))
        rp = reference.poses[i, reference_sequence[step]]
        original_ap = attempt.poses[j, attempt_person]
        ap = original_ap
        if mirrored:
            remapped = original_ap.copy()
            for left, right in LEFT_RIGHT.items():
                remapped[left] = original_ap[right]
            ap = remapped
        for a, b, c in JOINT_TRIPLES:
            ra, aa = angle(rp[a,:2], rp[b,:2], rp[c,:2]), angle(ap[a,:2], ap[b,:2], ap[c,:2])
            if np.isfinite(ra) and np.isfinite(aa):
                angle_errors.append(abs(ra-aa))
        linear_t = att_start + (reference.times[i] - ref_start) / max(ref_end - ref_start, 1e-6) * (att_end - att_start)
        timing_errors.append(abs(float(attempt.times[j] - linear_t)))
        if step:
            ref_velocity.append(float(np.linalg.norm(pair_ref_desc[step] - pair_ref_desc[step - 1])))
            att_velocity.append(float(np.linalg.norm(pair_att_desc[step] - pair_att_desc[step - 1])))

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

    sampled_path = path[::max(1, len(path)//120)]
    reference_counts = [len(group_centers(reference.poses[i])) for i, _ in sampled_path]
    attempt_counts = [len(group_centers(attempt.poses[j])) for _, j in sampled_path]
    team_mode = float(np.median(attempt_counts)) >= 1.5
    formation = None
    if team_mode:
        group_pairs, count_matches = [], []
        for i, j in sampled_path:
            rc, ac = group_centers(reference.poses[i]), group_centers(attempt.poses[j])
            count_matches.append(min(len(rc), len(ac)) / max(len(rc), len(ac), 1))
            if len(rc) > 1 and len(rc) == len(ac):
                rspan, aspan = max(np.ptp(rc[:,0]), .05), max(np.ptp(ac[:,0]), .05)
                group_pairs.append(float(np.mean(np.abs((rc[:,0]-rc[:,0].mean())/rspan -
                                                         (ac[:,0]-ac[:,0].mean())/aspan))))
        formation = 100 * float(np.mean(count_matches))
        if group_pairs:
            formation *= math.exp(-float(np.mean(group_pairs)) / .28)

    per_pair = [(pair_cost, i, j) for step, (i, j) in enumerate(path)
                if np.count_nonzero(pair_ref_mask[step] & pair_att_mask[step]) >= 5
                for pair_cost in [masked_cost(pair_ref_desc[step], pair_ref_mask[step],
                                              pair_att_desc[step], pair_att_mask[step])]
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
    fronts = {"form": form, "timing": timing, "path": path_accuracy, "dynamics": dynamics}
    weights = [.33, .28, .22, .17]
    if formation is not None:
        fronts["formation"] = formation
        weights = [.30, .25, .20, .15, .10]
    overall = float(np.average(list(fronts.values()), weights=weights))
    judged = ["2D pose form", "motion timing", "body path", "pose-speed dynamics"]
    not_judged = ["artistry", "musicality", "expression", "confidence", "creator taste", "safety"]
    if team_mode:
        judged.append("coarse formation")
    else:
        not_judged.append("team formation for a solo upload")
    return {
        "schemaVersion": "nodevideo.choreography-verdict.v1",
        "status": status,
        "confidence": round(confidence, 4),
        "limitations": issues,
        "mirrorApplied": mirrored,
        "observableMotionOnly": True,
        "scoreInterpretation": "relative-motion-signal-not-calibrated-pass-fail",
        "scores": {key: round(float(value), 1) for key, value in fronts.items()},
        "overall": round(overall, 1) if status == "completed" else None,
        "measurements": {"poseCost": round(cost, 5), "jointCoverage": round(visibility, 4),
                         "durationCoverage": round(coverage, 4), "medianTimingErrorMs": round(median_timing*1000),
                         "alignmentMode": alignment_mode,
                         "comparisonMode": "team" if team_mode else "solo-focal-performer",
                         "selectedReferencePerson": int(reference_person),
                         "referencePeopleUsed": sorted({int(person) for person in reference_sequence}),
                         "referencePersonChanges": int(np.count_nonzero(np.diff(reference_sequence))),
                         "selectedAttemptPerson": int(attempt_person),
                         "medianReferencePeople": round(float(np.median(reference_counts)), 2),
                         "medianAttemptPeople": round(float(np.median(attempt_counts)), 2),
                         "referenceWindow": {"startSeconds": round(ref_start, 4), "endSeconds": round(ref_end, 4)},
                         "attemptWindow": {"startSeconds": round(att_start, 4), "endSeconds": round(att_end, 4)},
                         **segmentation},
        "alignment": [{"referenceFrame": i, "attemptFrame": j,
                       "referencePerson": int(person),
                       "referenceTime": round(float(reference.times[i]), 4),
                       "attemptTime": round(float(attempt.times[j]), 4)}
                      for (i, j), person in zip(path, reference_sequence)],
        "criticalMoments": [{"referenceTime": round(rt, 3), "attemptTime": round(at, 3),
                             "severity": round(float(min(pc/1.2, 1)), 3)} for rt, at, pc in separated],
        "scoreBoundaries": {
            "judged": judged,
            "notJudged": not_judged
        }
    }


def abstention(reason: str) -> dict:
    return {"schemaVersion": "nodevideo.choreography-verdict.v1", "status": "abstained",
            "confidence": 0.0, "limitations": [reason], "mirrorApplied": False,
            "observableMotionOnly": True,
            "scoreInterpretation": "relative-motion-signal-not-calibrated-pass-fail",
            "scores": {}, "overall": None, "measurements": {}, "alignment": [],
            "criticalMoments": [], "scoreBoundaries": {
                "judged": [],
                "notJudged": ["insufficient observable motion evidence"]
            }}


def slice_track(track: Track, start: float | None, end: float | None) -> Track:
    if start is None and end is None:
        return track
    mask = np.ones(len(track.times), dtype=bool)
    if start is not None:
        mask &= track.times >= start
    if end is not None:
        mask &= track.times <= end
    if np.count_nonzero(mask) < 3:
        raise ValueError("requested track window contains fewer than three samples")
    return Track(track.times[mask], track.poses[mask])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-track", required=True, type=Path)
    parser.add_argument("--attempt-track", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--reference-start", type=float)
    parser.add_argument("--reference-end", type=float)
    parser.add_argument("--attempt-start", type=float)
    parser.add_argument("--attempt-end", type=float)
    args = parser.parse_args()
    reference = slice_track(load_track(args.reference_track), args.reference_start, args.reference_end)
    attempt = slice_track(load_track(args.attempt_track), args.attempt_start, args.attempt_end)
    result = score(reference, attempt)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("status", "confidence", "overall")}))


if __name__ == "__main__":
    main()
