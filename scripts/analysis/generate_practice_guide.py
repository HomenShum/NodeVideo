"""Generate a follow-along practice guide from a reference dance video.

Turns extracted pose + the music's beat grid into the data a Just-Dance-style
follow lane renders from:
  - hits:  sharp motion-energy accents (pops, locks, snaps) snapped to the
           nearest half-beat — the moments a learner must land.
  - holds: low-energy plateaus (freezes) with their duration.
  - sections: the 8-count blocks from segment_practice_sections.
  - cues:  one editable text slot per hit/hold, pre-seeded with the accent
           type; choreographers rename them ("shoulder pop", "look left") —
           the guide never invents move names it cannot know.

Everything is observable-motion only: accents are energy geometry, not
semantic move recognition. Cue text is human-authored by design.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from choreography_judge import stabilize_people
from segment_practice_sections import build_sections, extract_beats, motion_energy

HALF_BEAT_SNAP = 0.5
HIT_PROMINENCE = 1.6
HOLD_ENERGY_RATIO = 0.35
MIN_HOLD_SECONDS = 0.4


def find_hits(times: np.ndarray, energy: np.ndarray, beat_period: float) -> list[dict]:
    """Sharp accents: local maxima that rise well above the local median."""
    finite = np.where(np.isfinite(energy), energy, 0.0)
    if finite.max() <= 0:
        return []
    window = max(3, int(round(beat_period / np.median(np.diff(times)))))
    hits = []
    for index in range(1, len(finite) - 1):
        if finite[index] <= finite[index - 1] or finite[index] < finite[index + 1]:
            continue
        low = max(0, index - window)
        high = min(len(finite), index + window)
        local = np.median(finite[low:high])
        if local > 0 and finite[index] / local >= HIT_PROMINENCE:
            sharp_left = finite[index] - finite[index - 1]
            sharp_right = finite[index] - finite[min(index + 1, len(finite) - 1)]
            hits.append(
                {
                    "timeSeconds": round(float(times[index]), 3),
                    "strength": round(float(finite[index] / local), 2),
                    "kind": "pop" if min(sharp_left, sharp_right) > 0.3 * finite[index] else "accent",
                }
            )
    return hits


def find_holds(times: np.ndarray, energy: np.ndarray) -> list[dict]:
    finite = np.where(np.isfinite(energy), energy, np.nan)
    threshold = np.nanmedian(finite) * HOLD_ENERGY_RATIO
    holds, start = [], None
    for index in range(len(finite)):
        low = np.isfinite(finite[index]) and finite[index] <= threshold
        if low and start is None:
            start = index
        elif not low and start is not None:
            duration = float(times[index - 1] - times[start])
            if duration >= MIN_HOLD_SECONDS:
                holds.append(
                    {
                        "startSeconds": round(float(times[start]), 3),
                        "endSeconds": round(float(times[index - 1]), 3),
                    }
                )
            start = None
    return holds


def snap_to_grid(moment: float, beats: np.ndarray) -> dict:
    period = float(np.median(np.diff(beats))) if len(beats) > 1 else 0.5
    grid = beats[0] + np.round((moment - beats[0]) / (period * HALF_BEAT_SNAP)) * period * HALF_BEAT_SNAP
    count = int(np.floor((grid - beats[0]) / period)) % 8 + 1
    return {
        "snappedSeconds": round(float(grid), 3),
        "count": count,
        "offBeat": bool(abs(moment - grid) > period * 0.2),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media", type=Path, required=True)
    parser.add_argument("--pose", type=Path, required=True)
    parser.add_argument("--track", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    tempo, beats = extract_beats(args.media)
    data = np.load(args.pose)
    times, poses = data["times"], data["poses"]
    stabilize_people(poses)
    energy = motion_energy(times, poses, args.track)
    beat_period = float(np.median(np.diff(beats))) if len(beats) > 1 else 60.0 / max(tempo, 1)

    hits = find_hits(times, energy, beat_period)
    holds = find_holds(times, energy)
    for hit in hits:
        hit.update(snap_to_grid(hit["timeSeconds"], beats))
    cues = [
        {
            "id": f"cue-{index}",
            "timeSeconds": event["snappedSeconds"] if "snappedSeconds" in event else event["startSeconds"],
            "seed": event.get("kind", "hold"),
            "text": "",
            "editable": True,
        }
        for index, event in enumerate([*hits, *holds])
    ]
    guide = {
        "schemaVersion": "nodevideo.practice-guide.v1",
        "interpretation": "observable-motion-accents-cue-text-is-human-authored",
        "tempoBpm": round(tempo, 1),
        "beatTimes": [round(float(beat), 3) for beat in beats],
        "sections": build_sections(beats, times, poses, args.track),
        "hits": hits,
        "holds": holds,
        "cues": cues,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(guide, indent=2) + "\n")
    print(
        f"guide: {len(guide['sections'])} sections, {len(hits)} hits "
        f"({sum(1 for h in hits if h['kind'] == 'pop')} pops), {len(holds)} holds, "
        f"{len(cues)} editable cues @ {guide['tempoBpm']} bpm"
    )


if __name__ == "__main__":
    main()
