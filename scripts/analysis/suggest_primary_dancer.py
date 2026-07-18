"""Rank tracked performers in a reference video and suggest the primary dancer.

Deterministic scorer behind the dancer-selection UI: given extracted pose
tracks (extract_pose_landmarks.py output), stabilize identities, score each
persistent track on observable signals, and emit a ranked JSON report with a
suggested primary plus the best-visibility practice window for that track.

The suggestion is a default, never a decision: the UI presents ranked
candidates with thumbnail timestamps and the user confirms or overrides.
Signals (all observable, no artistry judgments):
  - presence:   fraction of frames the track is visible
  - continuity: longest continuous visible run (spectators flicker, the
                featured dancer persists)
  - centrality: median horizontal proximity to frame center
  - prominence: median bounding-box area (closer to camera = larger)
  - motion:     median per-frame displacement of visible joints (the dancer
                moves; the circle mostly stands)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from choreography_judge import stabilize_people

MIN_VISIBLE_JOINTS = 8
VISIBILITY_THRESHOLD = 0.5


def visible_mask(poses: np.ndarray) -> np.ndarray:
    """(frames, people) -> track visible with enough confident joints."""
    return (poses[..., 3] > VISIBILITY_THRESHOLD).sum(axis=-1) >= MIN_VISIBLE_JOINTS


def longest_run(flags: np.ndarray) -> int:
    best = run = 0
    for flag in flags:
        run = run + 1 if flag else 0
        best = max(best, run)
    return best


def score_tracks(times: np.ndarray, poses: np.ndarray) -> list[dict]:
    stable = stabilize_people(poses)
    frames, people = stable.shape[0], stable.shape[1]
    mask = visible_mask(stable)
    candidates = []
    for person in range(people):
        person_mask = mask[:, person]
        frames_visible = int(person_mask.sum())
        if frames_visible < max(10, frames * 0.05):
            continue
        xy = stable[:, person, :, :2]
        joint_ok = stable[:, person, :, 3] > VISIBILITY_THRESHOLD
        centers, areas, steps = [], [], []
        previous = None
        for frame in range(frames):
            if not person_mask[frame]:
                previous = None
                continue
            points = xy[frame][joint_ok[frame]]
            centers.append(abs(float(np.median(points[:, 0])) - 0.5))
            spans = points.max(axis=0) - points.min(axis=0)
            areas.append(float(spans[0] * spans[1]))
            if previous is not None:
                shared = joint_ok[frame] & previous[1]
                if shared.sum() >= MIN_VISIBLE_JOINTS:
                    steps.append(
                        float(np.mean(np.linalg.norm(xy[frame][shared] - previous[0][shared], axis=1)))
                    )
            previous = (xy[frame], joint_ok[frame])
        presence = frames_visible / frames
        continuity = longest_run(person_mask) / frames
        centrality = 1.0 - min(float(np.median(centers)), 0.5) / 0.5
        prominence = min(float(np.median(areas)) / 0.25, 1.0)
        motion = min(float(np.median(steps)) / 0.02, 1.0) if steps else 0.0
        candidates.append(
            {
                "trackId": person,
                "signals": {
                    "presence": round(presence, 4),
                    "continuity": round(continuity, 4),
                    "centrality": round(centrality, 4),
                    "prominence": round(prominence, 4),
                    "motion": round(motion, 4),
                },
                "primaryScore": round(
                    0.25 * presence + 0.20 * continuity + 0.20 * centrality
                    + 0.15 * prominence + 0.20 * motion,
                    4,
                ),
                "framesVisible": frames_visible,
                "thumbnailTimes": [
                    round(float(times[index]), 2)
                    for index in np.flatnonzero(person_mask)[
                        np.linspace(0, frames_visible - 1, min(3, frames_visible), dtype=int)
                    ]
                ],
            }
        )
    candidates.sort(key=lambda item: -item["primaryScore"])
    return candidates


def best_window(times: np.ndarray, poses: np.ndarray, track_id: int, seconds: float) -> dict | None:
    """Highest-visibility contiguous window of the given length for one track."""
    stable = stabilize_people(poses)
    person_mask = visible_mask(stable)[:, track_id].astype(np.float32)
    if len(times) < 2:
        return None
    step = float(np.median(np.diff(times)))
    width = max(2, int(round(seconds / step)))
    if width >= len(person_mask):
        start = 0
    else:
        coverage = np.convolve(person_mask, np.ones(width), mode="valid")
        start = int(np.argmax(coverage))
    end = min(start + width, len(times) - 1)
    return {
        "startSeconds": round(float(times[start]), 2),
        "endSeconds": round(float(times[end]), 2),
        "visibility": round(float(person_mask[start:end + 1].mean()), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pose", type=Path, required=True, help="npz from extract_pose_landmarks.py")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--window-seconds", type=float, default=8.0)
    args = parser.parse_args()

    data = np.load(args.pose)
    times, poses = data["times"], data["poses"]
    candidates = score_tracks(times, poses)
    report = {
        "schemaVersion": "nodevideo.primary-dancer-suggestion.v1",
        "interpretation": "observable-signal-ranking-user-must-confirm",
        "candidates": candidates,
        "suggestedPrimary": candidates[0]["trackId"] if candidates else None,
        "suggestedWindow": (
            best_window(times, poses, candidates[0]["trackId"], args.window_seconds)
            if candidates else None
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
