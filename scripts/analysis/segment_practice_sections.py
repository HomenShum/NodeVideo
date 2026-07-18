"""Split a reference dance video into practice sections suited for learners.

Sections follow how instructors teach:
  1. A musical 8-count grid from the reference's OWN audio (beat tracking via
     librosa; reels often run at a different tempo than the canonical song).
  2. Boundaries snap to the primary dancer's motion-energy minima ("landings")
     within a fraction of a beat, so sections never cut mid-move.
  3. Sections where the primary track's visibility is too low are marked
     watch-only — the judge would abstain there, so learners are not told to
     practice against evidence-free footage.
  4. Relative difficulty ranks sections against each other using observable
     proxies only (motion energy, direction changes). Uncalibrated by design.

The 8-count grid starts at the first tracked beat; if the musical "1" is
offset, pass --count-offset to shift the grid by whole beats.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from choreography_judge import stabilize_people
from suggest_primary_dancer import visible_mask

MIN_SECTION_COUNTS = 4
WATCH_ONLY_VISIBILITY = 0.6

# MediaPipe pose landmark regions. A degraded reference often still shows a
# clean upper body (feet cropped, close-ups), so feedback degrades by region
# instead of dying: full -> partial-upper -> beat-timing. Beat-timing needs no
# reference pose at all (the learner's landings are judged against the music
# grid), so an end-to-end run always produces some honest feedback.
UPPER_BODY = [11, 12, 13, 14, 15, 16, 23, 24]
LOWER_BODY = [25, 26, 27, 28, 29, 30, 31, 32]
TIER_SIGNALS = {
    "full": ["form", "timing", "path", "dynamics"],
    "partial-upper": ["upperForm", "timing"],
    "partial-lower": ["lowerForm", "timing"],
    "beat-timing": ["beatTiming"],
}
TIER_UNVERIFIED = {
    "full": [],
    "partial-upper": ["lowerBody"],
    "partial-lower": ["upperBody"],
    "beat-timing": ["referenceForm"],
}


def extract_beats(media: Path) -> tuple[float, np.ndarray]:
    import librosa

    with tempfile.TemporaryDirectory() as scratch:
        wav = Path(scratch) / "audio.wav"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(media), "-ac", "1", "-ar", "22050", "-y", str(wav)],
            check=True,
            timeout=120,
        )
        samples, rate = librosa.load(str(wav), sr=22050, mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=samples, sr=rate, units="time")
    return float(np.atleast_1d(tempo)[0]), np.asarray(beat_frames, dtype=np.float64)


def motion_energy(times: np.ndarray, poses: np.ndarray, track_id: int) -> np.ndarray:
    """Per-sample displacement of the track's visible joints (NaN when unseen)."""
    stable = stabilize_people(poses)
    xy = stable[:, track_id, :, :2]
    ok = stable[:, track_id, :, 3] > 0.5
    energy = np.full(len(times), np.nan)
    for frame in range(1, len(times)):
        shared = ok[frame] & ok[frame - 1]
        if shared.sum() >= 8:
            energy[frame] = float(np.mean(np.linalg.norm(xy[frame][shared] - xy[frame - 1][shared], axis=1)))
    return energy


def snap_to_landing(boundary: float, times: np.ndarray, energy: np.ndarray, tolerance: float) -> float:
    """Move a boundary to the nearest motion-energy minimum within ±tolerance."""
    window = np.flatnonzero((times >= boundary - tolerance) & (times <= boundary + tolerance))
    window = window[np.isfinite(energy[window])]
    if len(window) == 0:
        return boundary
    return float(times[window[np.argmin(energy[window])]])


def direction_changes(times: np.ndarray, poses: np.ndarray, track_id: int, start: float, end: float) -> int:
    stable = stabilize_people(poses)
    ok = visible_mask(stable)[:, track_id]
    span = np.flatnonzero((times >= start) & (times <= end) & ok)
    if len(span) < 3:
        return 0
    hips = np.nanmean(stable[span, track_id, 23:25, 0], axis=1)
    velocity = np.diff(hips)
    signs = np.sign(velocity[np.abs(velocity) > 1e-3])
    return int(np.count_nonzero(np.diff(signs) != 0))


def build_sections(
    beat_times: np.ndarray,
    times: np.ndarray,
    poses: np.ndarray,
    track_id: int,
    counts_per_section: int = 8,
    count_offset: int = 0,
) -> list[dict]:
    beats = beat_times[count_offset:]
    if len(beats) < MIN_SECTION_COUNTS + 1:
        return []
    beat_period = float(np.median(np.diff(beats)))
    energy = motion_energy(times, poses, track_id)
    stable_visible = visible_mask(stabilize_people(poses))[:, track_id]

    stable = stabilize_people(poses)
    joint_ok = stable[:, track_id, :, 3] > 0.5
    upper_visible = joint_ok[:, UPPER_BODY].sum(axis=1) >= 5
    lower_visible = joint_ok[:, LOWER_BODY].sum(axis=1) >= 4

    boundaries = [float(beats[0])]
    for index in range(counts_per_section, len(beats), counts_per_section):
        boundaries.append(snap_to_landing(float(beats[index]), times, energy, 0.6 * beat_period))
    tail = float(min(beats[-1], times[-1]))
    if tail - boundaries[-1] >= MIN_SECTION_COUNTS * beat_period:
        boundaries.append(tail)

    sections = []
    for index in range(len(boundaries) - 1):
        start, end = boundaries[index], boundaries[index + 1]
        span = np.flatnonzero((times >= start) & (times <= end))
        span_energy = energy[span]
        span_energy = span_energy[np.isfinite(span_energy)]
        visibility = float(stable_visible[span].mean()) if len(span) else 0.0
        upper = float(upper_visible[span].mean()) if len(span) else 0.0
        lower = float(lower_visible[span].mean()) if len(span) else 0.0
        # "full" must mean full-body evidence: overall joint count alone would
        # still pass with the entire lower body hidden (25 of 33 joints
        # remain), silently overclaiming on cropped-feet footage. Partial
        # tiers are symmetric — IG crops typically hide feet, but fast arm
        # work can blur upper landmarks while footwork tracks cleanly.
        if visibility >= WATCH_ONLY_VISIBILITY and upper >= WATCH_ONLY_VISIBILITY \
                and lower >= WATCH_ONLY_VISIBILITY:
            tier = "full"
        elif upper >= WATCH_ONLY_VISIBILITY:
            tier = "partial-upper"
        elif lower >= WATCH_ONLY_VISIBILITY:
            tier = "partial-lower"
        else:
            tier = "beat-timing"
        sections.append(
            {
                "index": index,
                "startSeconds": round(start, 2),
                "endSeconds": round(end, 2),
                "counts": counts_per_section,
                "visibility": round(visibility, 3),
                "upperBodyVisibility": round(upper, 3),
                "lowerBodyVisibility": round(lower, 3),
                "practiceReady": tier != "beat-timing",
                "feedbackTier": tier,
                "feedbackSignals": TIER_SIGNALS[tier],
                "unverified": TIER_UNVERIFIED[tier],
                "medianMotion": round(float(np.median(span_energy)), 5) if len(span_energy) else None,
                "directionChanges": direction_changes(times, poses, track_id, start, end),
            }
        )

    motions = [s["medianMotion"] for s in sections if s["medianMotion"] is not None]
    ceiling = max(motions) if motions else 1.0
    turns_ceiling = max((s["directionChanges"] for s in sections), default=1) or 1
    for section in sections:
        motion_part = (section["medianMotion"] or 0.0) / ceiling if ceiling else 0.0
        section["relativeDifficulty"] = round(
            0.6 * motion_part + 0.4 * section["directionChanges"] / turns_ceiling, 3
        )
    return sections


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media", type=Path, required=True)
    parser.add_argument("--pose", type=Path, required=True)
    parser.add_argument("--track", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--counts", type=int, default=8)
    parser.add_argument("--count-offset", type=int, default=0)
    args = parser.parse_args()

    tempo, beat_times = extract_beats(args.media)
    data = np.load(args.pose)
    sections = build_sections(
        beat_times, data["times"], data["poses"], args.track, args.counts, args.count_offset
    )
    durations = {}
    for section in sections:
        length = section["endSeconds"] - section["startSeconds"]
        durations[section["feedbackTier"]] = durations.get(section["feedbackTier"], 0.0) + length
    total = sum(durations.values()) or 1.0
    report = {
        "schemaVersion": "nodevideo.practice-sections.v1",
        "interpretation": "beat-grid-sections-relative-difficulty-user-adjustable",
        "tempoBpm": round(tempo, 1),
        "beatCount": len(beat_times),
        "trackId": args.track,
        "sections": sections,
        "practiceReadyCount": sum(1 for s in sections if s["practiceReady"]),
        # Time-weighted evidence base for an end-to-end run: overall feedback
        # must be reported with this coverage, never as a bare number.
        "runCoverage": {tier: round(seconds / total, 3) for tier, seconds in sorted(durations.items())},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
