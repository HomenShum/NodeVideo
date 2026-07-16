#!/usr/bin/env python3
"""Source-only song/choreography analysis for repeated dance takes.

The analyzer accepts precomputed pose tracks and a separately declared music input. It never
accepts a finished edit. It aligns repeated takes to a creator-selected choreography reference,
builds source-only boundary candidates from choreography, music, and lyrics; jointly selects the
complete boundary/take sequence; and emits neutral IDs only. Pose extraction remains upstream;
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
import cv2
import numpy as np

from choreography_sequence_optimizer import CandidateMoment, optimize_sequence


SCHEMA_VERSION = "nodevideo.song-choreography-analysis.v1"
ANALYZER_VERSION = "nodevideo.song-choreography-analyzer@0.3.0"
CORE_JOINTS = np.asarray([0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28])
BODY_EDGES = (
    (11, 13), (13, 15), (12, 14), (14, 16), (11, 12), (11, 23), (12, 24),
    (23, 24), (23, 25), (25, 27), (27, 31), (24, 26), (26, 28), (28, 32),
)


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
        "--alignment-json",
        type=Path,
        help="Optional source-only multi-person reference alignment receipt.",
    )
    parser.add_argument(
        "--take-pose",
        action="append",
        default=[],
        metavar="ASSET_ID=POSE_NPZ",
        help="Repeat for every render take, including the selected fallback reference take.",
    )
    parser.add_argument("--music", type=Path, required=True)
    parser.add_argument("--duration-seconds", type=float, required=True)
    parser.add_argument(
        "--phrase-beats",
        default="",
        help="Deprecated optional prior retained for receipt compatibility; never authoritative.",
    )
    parser.add_argument(
        "--phrase-count",
        type=int,
        help="Optional creator preference. By default phrase count is inferred from duration.",
    )
    parser.add_argument("--lyrics-json", type=Path)
    parser.add_argument(
        "--phrase-anchor-json",
        type=Path,
        help="Optional source-only Eve interpretation with one semantic anchor per interior cut.",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--terminal-transition-frames", type=int, default=0)
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
    if not 0 <= args.terminal_transition_frames <= 12:
        raise ValueError("--terminal-transition-frames must be between 0 and 12.")
    phrase_beats = [int(value) for value in args.phrase_beats.split(",") if value.strip()]
    if any(value <= 0 for value in phrase_beats):
        raise ValueError("--phrase-beats values must be positive.")

    take_bindings = parse_bindings(args.take_pose)
    reference = load_pose_track(args.reference_asset_id, args.reference_pose)
    takes = {
        asset_id: load_pose_track(asset_id, path) for asset_id, path in take_bindings.items()
    }
    music = analyze_music(args.music, args.ffmpeg)
    lyrics = read_lyrics(args.lyrics_json, args.duration_seconds)
    alignments = (
        read_alignment_receipt(args.alignment_json, takes, args.duration_seconds)
        if args.alignment_json
        else align_takes(
            reference=reference,
            takes=takes,
            reference_start=args.reference_start_seconds,
            duration=args.duration_seconds,
        )
    )
    phrase_count = args.phrase_count or int(np.clip(round(args.duration_seconds / 8.0), 3, 8))
    if phrase_count < 2 or phrase_count > 12:
        raise ValueError("--phrase-count must be between 2 and 12.")
    offsets = {
        item["takeAssetId"]: float(item["choreographyStartSeconds"])
        for item in alignments
    }
    moments = build_candidate_moments(
        reference=reference,
        reference_start=args.reference_start_seconds,
        takes=takes,
        offsets=offsets,
        music=music,
        lyrics=lyrics,
        duration_seconds=args.duration_seconds,
    )
    interpretation = read_phrase_anchors(args.phrase_anchor_json, phrase_count, args.duration_seconds)
    if interpretation:
        beats = [value / 1000 for value in music["beatsMs"]]
        for item in interpretation:
            time_seconds = float(item["timeSeconds"])
            nearest = min(beats, key=lambda value: abs(value - time_seconds)) if beats else None
            moments.append(
                CandidateMoment(
                    time_seconds=time_seconds,
                    evidence_score=0.9,
                    evidence=("eve-source-only-interpretation",),
                    choreography_landmark="semantic-phrase-and-consensus-motion-anchor",
                    nearest_music_event_seconds=round_number(nearest) if nearest is not None else None,
                    signed_music_offset_seconds=(
                        round_number(time_seconds - nearest) if nearest is not None else None
                    ),
                )
            )
        moments.sort(key=lambda value: value.time_seconds)
    interval_cache: dict[tuple[float, float], list[dict[str, Any]]] = {}
    full_timeline = np.arange(0, args.duration_seconds, 0.1)
    opening_take = min(
        takes,
        key=lambda asset_id: body_box(
            interpolate_raw(takes[asset_id], offsets[asset_id] + full_timeline)
        )["y"],
    )

    def interval_candidates(start: float, end: float) -> list[dict[str, Any]]:
        key = (round(start, 6), round(end, 6))
        if key not in interval_cache:
            interval_cache[key] = score_interval_candidates(
                reference, takes, offsets, args.reference_start_seconds, start, end
            )
        return interval_cache[key]

    sequence = optimize_sequence(
        moments=moments,
        duration_seconds=args.duration_seconds,
        take_ids=takes,
        interval_score=lambda start, end, take_id: next(
            item["totalScore"]
            for item in interval_candidates(start, end)
            if item["takeAssetId"] == take_id
        ),
        desired_phrases=phrase_count,
        anchor_times=[item["timeSeconds"] for item in interpretation] if interpretation else None,
        preferred_opening_take=opening_take,
        minimum_phrase_seconds=max(1.2, args.duration_seconds / (phrase_count * 3.2)),
        maximum_phrase_seconds=min(16.0, args.duration_seconds / phrase_count * 2.1),
    )
    boundaries = [0.0, *[item.time_seconds for item in sequence.boundaries], args.duration_seconds]
    phrases = score_phrases(
        reference=reference,
        takes=takes,
        alignments=alignments,
        boundaries=boundaries,
        reference_asset_id=args.reference_asset_id,
        reference_start=args.reference_start_seconds,
        quality_tolerance=args.quality_tolerance,
        selected_take_ids=sequence.take_ids,
        boundary_moments=sequence.boundaries,
        interval_cache=interval_cache,
    )
    attention_choreography = plan_attention_choreography(
        lyrics=lyrics,
        phrases=phrases,
        takes=takes,
        offsets=offsets,
    )
    identity_choreography = plan_identity_choreography(
        duration_seconds=args.duration_seconds,
        phrases=phrases,
        takes=takes,
        offsets=offsets,
    )
    warnings = []
    is_fallback_reference = (
        args.reference_asset_id in take_bindings
        and args.reference_pose.resolve() == take_bindings[args.reference_asset_id].resolve()
    )
    if is_fallback_reference:
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
            "role": (
                "creator-selected-canonical-fallback"
                if is_fallback_reference
                else "independent-original-choreography-reference"
            ),
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
            "id": "choreography-led-global-sequence.v2",
            "planner": "deterministic-dynamic-programming-beam-search",
            "phraseCount": phrase_count,
            "optionalPhraseBeatPrior": phrase_beats or None,
            "optionalPhraseBeatPriorWeight": 0,
            "boundaryPolicy": "joint-source-only-choreography-music-lyric-candidate-lattice",
            "takePolicy": "joint-interval-quality-and-transition-optimization",
            "qualityTolerance": args.quality_tolerance,
            "candidateMomentCount": len(moments),
            "winningScore": round_number(sequence.score),
            "sourceOnlyInterpretation": interpretation,
            "terminalTransitionFrames": args.terminal_transition_frames,
        },
        "alignments": alignments,
        "candidateMoments": [
            {
                "timeSeconds": moment.time_seconds,
                "evidenceScore": moment.evidence_score,
                "evidence": list(moment.evidence),
                "choreographyLandmark": moment.choreography_landmark,
                "nearestMusicEventSeconds": moment.nearest_music_event_seconds,
                "signedMusicOffsetSeconds": moment.signed_music_offset_seconds,
            }
            for moment in moments
        ],
        "alignmentEvidence": (
            {
                "schemaVersion": "nodevideo.reference-performer-selection.v1",
                "sha256": sha256(args.alignment_json),
            }
            if args.alignment_json
            else None
        ),
        "phrases": phrases,
        "lyricCues": lyrics,
        "attentionChoreography": attention_choreography,
        "identityChoreography": identity_choreography,
        "generationIsolation": {
            "finishedEditAcceptedAsInput": False,
            "finishedEditPictureRead": False,
            "finishedEditPlanRead": False,
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
    if poses.ndim == 4 and poses.shape[1] == 1:
        poses = poses[:, 0]
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
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset, sr=sample_rate, hop_length=hop_length, backtrack=False
    )
    onset_times = librosa.frames_to_time(onset_frames, sr=sample_rate, hop_length=hop_length)
    onset_strengths = onset[onset_frames] if len(onset_frames) else np.asarray([])
    onset_peak = float(np.max(onset_strengths)) if len(onset_strengths) else 1.0
    return {
        "durationSeconds": len(samples) / sample_rate,
        "bpm": bpm,
        "beatsMs": beats_ms,
        "downbeatsMs": downbeats_ms,
        "onsetsMs": (onset_times * 1000).tolist(),
        "onsetStrengths": (onset_strengths / (onset_peak + 1e-9)).tolist(),
        "confidence": confidence,
    }


def build_candidate_moments(
    reference: PoseTrack,
    reference_start: float,
    takes: dict[str, PoseTrack],
    offsets: dict[str, float],
    music: dict[str, Any],
    lyrics: list[dict[str, Any]],
    duration_seconds: float,
) -> list[CandidateMoment]:
    """Fuse independently observed source-only events into a compact candidate lattice."""

    events: list[tuple[float, float, str, str | None]] = []
    for value in music["beatsMs"]:
        events.append((value / 1000, 0.32, "beat", None))
    for value in music["downbeatsMs"]:
        events.append((value / 1000, 0.58, "downbeat", None))
    for value, strength in zip(music.get("onsetsMs", []), music.get("onsetStrengths", [])):
        if strength >= 0.28:
            events.append((value / 1000, 0.25 + 0.4 * strength, "onset", None))
    for cue in lyrics:
        events.append((float(cue["startSeconds"]), 0.56, "lyric-boundary", None))
        events.append((float(cue["endSeconds"]), 0.48, "lyric-boundary", None))

    timeline = np.arange(0.0, duration_seconds, 0.05)
    motion = interpolate_motion(reference, reference_start + timeline)
    if len(motion) >= 5:
        high = float(np.quantile(motion, 0.76))
        low = float(np.quantile(motion, 0.24))
        for index in range(2, len(motion) - 2):
            local = motion[index - 2 : index + 3]
            if motion[index] >= high and motion[index] == np.max(local):
                events.append((float(timeline[index]), 0.78, "gesture-apex", "motion-apex"))
            if motion[index] <= low and motion[index] == np.min(local):
                events.append(
                    (float(timeline[index]), 0.72, "hold-or-completion", "movement-completion")
                )

    pose = interpolate_pose(reference, reference_start + timeline)
    wrist_x = pose[:, [15, 16], 0]
    valid_wrist_count = np.sum(np.isfinite(wrist_x), axis=1)
    wrist_center_x = np.divide(
        np.nansum(wrist_x, axis=1),
        valid_wrist_count,
        out=np.full(len(wrist_x), np.nan),
        where=valid_wrist_count > 0,
    )
    finite_wrist = np.flatnonzero(np.isfinite(wrist_center_x))
    if len(finite_wrist) >= 2:
        wrist_center_x = np.interp(np.arange(len(wrist_center_x)), finite_wrist, wrist_center_x[finite_wrist])
    direction = np.diff(wrist_center_x)
    for index in range(1, len(direction)):
        if abs(direction[index] - direction[index - 1]) > 0.04 and (
            direction[index] * direction[index - 1] < 0
        ):
            events.append(
                (float(timeline[index]), 0.66, "direction-change", "wrist-direction-change")
            )

    events = [event for event in events if 0.2 < event[0] < duration_seconds - 0.2]
    events.sort(key=lambda value: value[0])
    clusters: list[list[tuple[float, float, str, str | None]]] = []
    for event in events:
        if clusters and event[0] - clusters[-1][-1][0] <= 0.12:
            clusters[-1].append(event)
        else:
            clusters.append([event])

    beats = [value / 1000 for value in music["beatsMs"]]
    result: list[CandidateMoment] = []
    for cluster in clusters:
        weight = sum(item[1] for item in cluster)
        time_seconds = sum(item[0] * item[1] for item in cluster) / weight
        evidence = tuple(sorted({item[2] for item in cluster}))
        landmark = next((item[3] for item in cluster if item[3] is not None), None)
        nearest = min(beats, key=lambda value: abs(value - time_seconds)) if beats else None
        multimodal_bonus = 0.14 * max(0, len(evidence) - 1)
        result.append(
            CandidateMoment(
                time_seconds=round_number(time_seconds),
                evidence_score=round_number(min(1.0, max(item[1] for item in cluster) + multimodal_bonus)),
                evidence=evidence,
                choreography_landmark=landmark,
                nearest_music_event_seconds=round_number(nearest) if nearest is not None else None,
                signed_music_offset_seconds=(
                    round_number(time_seconds - nearest) if nearest is not None else None
                ),
            )
        )
    result.extend(
        consensus_direction_moments(reference, reference_start, takes, offsets, duration_seconds, beats)
    )
    result.sort(key=lambda value: value.time_seconds)
    return result


def consensus_direction_moments(
    reference: PoseTrack,
    reference_start: float,
    takes: dict[str, PoseTrack],
    offsets: dict[str, float],
    duration_seconds: float,
    beats: list[float],
) -> list[CandidateMoment]:
    timeline = np.arange(0, duration_seconds, 1 / 30)
    tracks = [(reference, reference_start), *[(track, offsets[asset_id]) for asset_id, track in takes.items()]]
    accelerations = []
    for track, offset in tracks:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=RuntimeWarning)
            wrists = np.nanmean(interpolate_pose(track, offset + timeline)[:, [15, 16]], axis=1)
        x = wrists[:, 0]
        x = np.nan_to_num(x, nan=float(np.nanmedian(x)))
        x = np.convolve(x, np.ones(7) / 7, mode="same")
        acceleration = np.convolve(np.abs(np.gradient(np.gradient(x))), np.ones(5) / 5, mode="same")
        low, high = np.quantile(acceleration, [0.1, 0.95])
        accelerations.append(np.clip((acceleration - low) / (high - low + 1e-9), 0, 2))
    consensus = np.median(np.asarray(accelerations), axis=0)
    threshold = float(np.quantile(consensus, 0.52))
    moments = []
    for index in range(2, len(consensus) - 2):
        if consensus[index] < threshold or consensus[index] != np.max(consensus[index - 2 : index + 3]):
            continue
        time_seconds = float(timeline[index])
        nearest = min(beats, key=lambda value: abs(value - time_seconds)) if beats else None
        moments.append(
            CandidateMoment(
                time_seconds=round_number(time_seconds),
                evidence_score=round_number(min(1.0, 0.55 + 0.28 * consensus[index])),
                evidence=("consensus-direction-change",),
                choreography_landmark="multi-track-wrist-direction-change",
                nearest_music_event_seconds=round_number(nearest) if nearest is not None else None,
                signed_music_offset_seconds=round_number(time_seconds - nearest) if nearest is not None else None,
            )
        )
    return moments


def read_phrase_anchors(path: Path | None, phrase_count: int, duration_seconds: float) -> list[dict[str, Any]]:
    if path is None:
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != "nodevideo.source-only-phrase-interpretation/v1":
        raise ValueError("Unsupported phrase interpretation schema")
    if payload.get("isolation", {}).get("hiddenTargetRead") is not False:
        raise ValueError("Phrase interpretation does not attest target isolation")
    anchors = payload.get("anchors")
    if not isinstance(anchors, list) or len(anchors) != phrase_count - 1:
        raise ValueError("Phrase interpretation must provide one anchor per interior cut")
    result = []
    previous = 0.0
    for index, item in enumerate(anchors):
        time_seconds = float(item["timeSeconds"])
        reason = str(item["reason"]).strip()
        if time_seconds <= previous or time_seconds >= duration_seconds or not reason:
            raise ValueError(f"Invalid phrase anchor at index {index}")
        result.append({"timeSeconds": round_number(time_seconds), "reason": reason})
        previous = time_seconds
    return result


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


def refine_boundaries_with_cues(
    boundaries: list[float], lyrics: list[dict[str, Any]], maximum_shift: float = 0.9
) -> list[float]:
    if not lyrics or len(boundaries) <= 2:
        return boundaries
    transitions = sorted(
        {
            float(value)
            for cue in lyrics
            for value in (cue["startSeconds"], cue["endSeconds"])
            if 0 < float(value) < boundaries[-1]
        }
    )
    refined = [boundaries[0]]
    for boundary in boundaries[1:-1]:
        candidates = [value for value in transitions if abs(value - boundary) <= maximum_shift]
        selected = min(candidates, key=lambda value: abs(value - boundary)) if candidates else boundary
        if selected <= refined[-1] + 0.25:
            selected = boundary
        refined.append(selected)
    refined.append(boundaries[-1])
    return refined


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


def read_alignment_receipt(
    path: Path, takes: dict[str, PoseTrack], duration: float
) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != "nodevideo.reference-performer-selection.v1":
        raise ValueError("Unsupported alignment receipt schema.")
    declared = payload.get("alignments", {})
    if set(declared) != set(takes):
        raise ValueError("Alignment receipt take IDs do not match the admitted creator takes.")
    results = []
    for asset_id, take in takes.items():
        record = declared[asset_id]
        offset = float(record["choreographyStartSeconds"])
        distance = float(record["medianNormalizedPoseDistance"])
        if offset < 0 or offset + duration > take.times[-1] + 0.6 or distance < 0:
            raise ValueError(f"Alignment receipt is out of bounds for {asset_id}.")
        results.append(
            {
                "takeAssetId": asset_id,
                "choreographyStartSeconds": round_number(offset),
                "method": "multi-person-mirrored-normalized-pose-offset-search",
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
    reference_start: float,
    quality_tolerance: float,
    selected_take_ids: tuple[str, ...],
    boundary_moments: tuple[CandidateMoment, ...],
    interval_cache: dict[tuple[float, float], list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    offsets = {item["takeAssetId"]: float(item["choreographyStartSeconds"]) for item in alignments}
    full_timeline = np.arange(0, boundaries[-1], 0.1)
    opening_boxes = {
        asset_id: body_box(interpolate_raw(track, offsets[asset_id] + full_timeline))
        for asset_id, track in takes.items()
    }
    # Prefer the take with the most stable headroom as the wide establishing lane. The other
    # take becomes the contrasting fill lane; this is a reusable visual grammar, not a case ID.
    opening_take = min(opening_boxes, key=lambda asset_id: opening_boxes[asset_id]["y"])
    if len(selected_take_ids) != len(boundaries) - 1:
        raise ValueError("optimizer take decisions do not match phrase intervals")
    result = []
    for index, (start, end) in enumerate(zip(boundaries, boundaries[1:])):
        key = (round(start, 6), round(end, 6))
        raw_candidates = interval_cache.get(key) or score_interval_candidates(
            reference, takes, offsets, reference_start, start, end
        )
        selected = next(
            value for value in raw_candidates if value["takeAssetId"] == selected_take_ids[index]
        )
        moment = boundary_moments[index] if index < len(boundary_moments) else None
        result.append(
            {
                "id": f"phrase.{index + 1}",
                "timelineStartSeconds": round_number(start),
                "timelineEndSeconds": round_number(end),
                "candidates": raw_candidates,
                "selectedTakeAssetId": selected["takeAssetId"],
                "selectionReason": "Globally selected from source-only interval quality and transition coherence.",
                "framingTemplate": "fit" if selected["takeAssetId"] == opening_take else "fill",
                "captionSafeZone": caption_safe_zone(selected["bodyBox"]),
                "outBoundaryDecision": (
                    {
                        "evidence": list(moment.evidence),
                        "evidenceScore": moment.evidence_score,
                        "choreographyLandmark": moment.choreography_landmark,
                        "nearestMusicEventSeconds": moment.nearest_music_event_seconds,
                        "signedMusicOffsetSeconds": moment.signed_music_offset_seconds,
                        "reason": "Jointly maximizes choreography, music, lyric, take-quality, and transition evidence.",
                        "confidence": round_number(0.45 + 0.5 * moment.evidence_score),
                    }
                    if moment is not None
                    else {"evidence": ["terminal"], "reason": "Declared song excerpt end."}
                ),
            }
        )
    return result


def score_interval_candidates(
    reference: PoseTrack,
    takes: dict[str, PoseTrack],
    offsets: dict[str, float],
    reference_start: float,
    start: float,
    end: float,
) -> list[dict[str, Any]]:
    timeline = np.arange(start, end, 0.1)
    reference_pose = interpolate_pose(reference, reference_start + timeline)
    candidates = []
    for asset_id, track in sorted(takes.items()):
        pose = interpolate_pose(track, offsets[asset_id] + timeline)
        raw = interpolate_raw(track, offsets[asset_id] + timeline)
        pose_distance = float(
            np.nanmedian(np.linalg.norm(reference_pose[:, CORE_JOINTS] - pose[:, CORE_JOINTS], axis=2))
        )
        visible = raw[:, CORE_JOINTS]
        completeness = float(np.mean(np.isfinite(visible).all(axis=2)))
        framing = float(
            np.mean(
                np.isfinite(visible).all(axis=2)
                & (visible[:, :, 0] >= 0.015)
                & (visible[:, :, 0] <= 0.985)
                & (visible[:, :, 1] >= 0.015)
                & (visible[:, :, 1] <= 0.985)
            )
        )
        candidates.append(
            {
                "takeAssetId": asset_id,
                "sourceStartSeconds": round_number(offsets[asset_id] + start),
                "sourceEndSeconds": round_number(offsets[asset_id] + end),
                "poseDistance": pose_distance,
                "choreography": math.exp(-pose_distance),
                "completeness": completeness,
                "framing": framing,
                "expression": float(np.nanmedian(interpolate_motion(track, offsets[asset_id] + timeline))),
                "bodyBox": body_box(raw),
            }
        )
    expression_values = [item["expression"] for item in candidates]
    low, high = min(expression_values), max(expression_values)
    for item in candidates:
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
        item["groundingStatus"] = "source-only-pose-track"
    return candidates


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


def plan_attention_choreography(
    *,
    lyrics: list[dict[str, Any]],
    phrases: list[dict[str, Any]],
    takes: dict[str, PoseTrack],
    offsets: dict[str, float],
) -> list[dict[str, Any]]:
    """Place lyric cues as attention events using selected-take pose evidence.

    Candidate boxes are reusable safe-area primitives. The scorer rewards framewise silhouette
    clearance, proximity to the active wrist without covering it, and spatial novelty.
    The result is a proposal with explicit intent evidence, not a silently inferred creator rule.
    """

    result: list[dict[str, Any]] = []
    previous_center: np.ndarray | None = None
    for cue in lyrics:
        phrase = next(
            (
                value
                for value in phrases
                if value["timelineStartSeconds"] <= cue["startSeconds"]
                < value["timelineEndSeconds"]
            ),
            None,
        )
        if phrase is None:
            continue
        take_id = phrase["selectedTakeAssetId"]
        track = takes[take_id]
        middle = (float(cue["startSeconds"]) + float(cue["endSeconds"])) / 2
        source_middle = offsets[take_id] + middle
        sample_times = source_middle + np.asarray([-0.18, 0.0, 0.18])
        raw = interpolate_raw(track, sample_times)
        left_travel = float(np.linalg.norm(raw[-1, 15] - raw[0, 15]))
        right_travel = float(np.linalg.norm(raw[-1, 16] - raw[0, 16]))
        wrist_index = 15 if left_travel >= right_travel else 16
        active_wrist = raw[1, wrist_index]
        target = "left-hand" if wrist_index == 15 else "right-hand"
        timeline_samples = np.arange(
            float(cue["startSeconds"]),
            float(cue["endSeconds"]),
            1 / 30,
        )
        cue_poses = selected_timeline_poses(
            timeline_samples=timeline_samples,
            phrases=phrases,
            takes=takes,
            offsets=offsets,
        )
        text_length = len(str(cue.get("text", "")))
        box_width = 0.30 if text_length <= 10 else 0.36 if text_length <= 16 else 0.42
        x_positions = sorted({0.03, round((1 - box_width) / 2, 6), round(0.97 - box_width, 6)})
        y_positions = [0.05, 0.18, 0.32, 0.46, 0.60, 0.74, 0.87]
        candidates = [
            {"x": x, "y": y, "width": box_width, "height": 0.075}
            for y in y_positions
            for x in x_positions
        ]
        ranked: list[tuple[float, dict[str, float], float, float]] = []
        for box in candidates:
            center = np.asarray([box["x"] + box["width"] / 2, box["y"] + box["height"] / 2])
            body_overlap = silhouette_overlap_max(cue_poses, box)
            wrist_distance = float(np.linalg.norm(center - active_wrist))
            gesture_affinity = max(0.0, 1 - abs(wrist_distance - 0.24) / 0.5)
            novelty = (
                0.5
                if previous_center is None
                else min(1.0, float(np.linalg.norm(center - previous_center)) / 0.65)
            )
            score = 1.4 * (1 - body_overlap) + 0.44 * gesture_affinity + 0.28 * novelty
            ranked.append((score, box, novelty, body_overlap))
        safe_ranked = [item for item in ranked if item[3] <= 0.05]
        if not safe_ranked:
            raise ValueError(f"No body-safe caption placement exists for {cue['id']}.")
        _, selected_box, novelty, body_overlap = max(safe_ranked, key=lambda item: item[0])
        center = np.asarray(
            [
                selected_box["x"] + selected_box["width"] / 2,
                selected_box["y"] + selected_box["height"] / 2,
            ]
        )
        eye_travel = attention_direction(previous_center, center)
        result.append(
            {
                "cueId": cue["id"],
                "selectedTakeAssetId": take_id,
                "timelineRange": {
                    "startSeconds": cue["startSeconds"],
                    "endSeconds": cue["endSeconds"],
                },
                "box": {key: round_number(value) for key, value in selected_box.items()},
                "attentionTarget": target,
                "action": "counterpoint" if body_overlap == 0 else "follow-motion",
                "eyeTravel": eye_travel,
                "motionRelationship": "coincides",
                "spatialNovelty": round_number(novelty),
                "saliencyCompetition": round_number(body_overlap),
                "clearancePolicy": "framewise-dilated-pose-silhouette-v1",
                "intentHypothesis": (
                    "Move the lyric cue near the active gesture region while preserving the full "
                    "performer silhouette and refreshing eye position."
                ),
                "evidenceArtifactIds": [
                    f"pose.{take_id}",
                    f"phrase.{phrase['id']}",
                    f"lyric.{cue['id']}",
                ],
                "requiresOwnerReview": True,
            }
        )
        previous_center = center
    return result


def plan_identity_choreography(
    *,
    duration_seconds: float,
    phrases: list[dict[str, Any]],
    takes: dict[str, PoseTrack],
    offsets: dict[str, float],
) -> list[dict[str, Any]]:
    """Plan persistent creator identity in short, independently body-safe phases."""

    start = min(1.5, duration_seconds)
    boundaries = [start]
    boundaries.extend(
        value["timelineEndSeconds"]
        for value in phrases
        if start + 3 <= value["timelineEndSeconds"] < duration_seconds - 1
    )
    cursor = start
    while cursor + 7.5 < duration_seconds:
        cursor += 7.5
        boundaries.append(cursor)
    boundaries.append(duration_seconds)
    boundaries = sorted(set(round_number(value) for value in boundaries))
    candidates = [
        {"x": 0.03, "y": 0.05, "width": 0.27, "height": 0.045},
        {"x": 0.70, "y": 0.05, "width": 0.27, "height": 0.045},
        {"x": 0.03, "y": 0.20, "width": 0.27, "height": 0.045},
        {"x": 0.70, "y": 0.20, "width": 0.27, "height": 0.045},
        {"x": 0.03, "y": 0.48, "width": 0.27, "height": 0.045},
        {"x": 0.70, "y": 0.48, "width": 0.27, "height": 0.045},
        {"x": 0.03, "y": 0.76, "width": 0.27, "height": 0.045},
        {"x": 0.70, "y": 0.76, "width": 0.27, "height": 0.045},
        {"x": 0.03, "y": 0.90, "width": 0.27, "height": 0.045},
        {"x": 0.70, "y": 0.90, "width": 0.27, "height": 0.045},
    ]
    result = []
    previous_center: np.ndarray | None = None
    for index, (phase_start, phase_end) in enumerate(zip(boundaries, boundaries[1:])):
        if phase_end - phase_start < 0.25:
            continue
        timeline_samples = np.arange(phase_start, phase_end, 1 / 30)
        poses = selected_timeline_poses(
            timeline_samples=timeline_samples,
            phrases=phrases,
            takes=takes,
            offsets=offsets,
        )
        ranked = []
        for box in candidates:
            center = np.asarray([box["x"] + box["width"] / 2, box["y"] + box["height"] / 2])
            overlap = silhouette_overlap_max(poses, box)
            travel = 0.0 if previous_center is None else float(np.linalg.norm(center - previous_center))
            ranked.append((overlap + 0.025 * travel, overlap, box, center))
        _, overlap, box, center = min(ranked, key=lambda item: item[0])
        if overlap > 0.05:
            raise ValueError(f"No body-safe creator identity placement exists for phase {index + 1}.")
        result.append(
            {
                "id": f"identity.phase-{index + 1}",
                "timelineRange": {
                    "startSeconds": round_number(phase_start),
                    "endSeconds": round_number(phase_end),
                },
                "box": {key: round_number(value) for key, value in box.items()},
                "maxBodyOverlapRatio": round_number(overlap),
                "clearancePolicy": "framewise-dilated-pose-silhouette-v1",
                "requiresOwnerReview": True,
            }
        )
        previous_center = center
    return result


def selected_timeline_poses(
    *,
    timeline_samples: np.ndarray,
    phrases: list[dict[str, Any]],
    takes: dict[str, PoseTrack],
    offsets: dict[str, float],
) -> np.ndarray:
    result = []
    for timeline_time in timeline_samples:
        phrase = next(
            (
                item
                for item in phrases
                if item["timelineStartSeconds"] <= timeline_time < item["timelineEndSeconds"]
            ),
            phrases[-1],
        )
        take_id = phrase["selectedTakeAssetId"]
        result.append(interpolate_raw(takes[take_id], np.asarray([offsets[take_id] + timeline_time]))[0])
    return np.asarray(result)


def silhouette_overlap_max(poses: np.ndarray, box: dict[str, float]) -> float:
    """Match the final auditor's dilated body geometry in normalized canvas coordinates."""

    width, height = 180, 320
    left = max(0, min(width, round(box["x"] * width)))
    top = max(0, min(height, round(box["y"] * height)))
    right = max(left + 1, min(width, round((box["x"] + box["width"]) * width)))
    bottom = max(top + 1, min(height, round((box["y"] + box["height"]) * height)))
    maximum = 0.0
    for pose in poses:
        mask = np.zeros((height, width), dtype=np.uint8)
        finite = np.nan_to_num(pose, nan=-10.0, posinf=-10.0, neginf=-10.0)
        xy = np.column_stack((finite[:, 0] * width, finite[:, 1] * height)).astype(int)
        limb_width = max(5, round(width * 0.045))
        for first, second in BODY_EDGES:
            if np.isfinite(pose[first]).all() and np.isfinite(pose[second]).all():
                cv2.line(mask, tuple(xy[first]), tuple(xy[second]), 255, limb_width)
        if all(np.isfinite(pose[joint]).all() for joint in (11, 12, 23, 24)):
            cv2.fillConvexPoly(mask, np.asarray([xy[11], xy[12], xy[24], xy[23]]), 255)
        if np.isfinite(pose[0]).all():
            cv2.circle(mask, tuple(xy[0]), max(7, round(width * 0.06)), 255, -1)
        region = mask[top:bottom, left:right]
        maximum = max(maximum, float(np.count_nonzero(region) / max(1, region.size)))
    return maximum


def normalized_box_overlap(first: dict[str, float], second: dict[str, float]) -> float:
    left = max(first["x"], second["x"])
    top = max(first["y"], second["y"])
    right = min(first["x"] + first["width"], second["x"] + second["width"])
    bottom = min(first["y"] + first["height"], second["y"] + second["height"])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    area = first["width"] * first["height"]
    return 0.0 if area <= 0 else min(1.0, intersection / area)


def attention_direction(previous: np.ndarray | None, current: np.ndarray) -> str:
    if previous is None:
        return "none"
    delta = current - previous
    if np.linalg.norm(delta) < 0.08:
        return "none"
    if abs(delta[0]) > abs(delta[1]) * 1.5:
        return "right" if delta[0] > 0 else "left"
    if abs(delta[1]) > abs(delta[0]) * 1.5:
        return "down" if delta[1] > 0 else "up"
    return "diagonal"


def read_lyrics(path: Path | None, duration_seconds: float) -> list[dict[str, Any]]:
    if path is None:
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    cues = (
        payload.get("cues", payload.get("lyricCues"))
        if isinstance(payload, dict)
        else payload
    )
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
