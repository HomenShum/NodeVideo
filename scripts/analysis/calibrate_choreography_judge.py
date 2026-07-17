#!/usr/bin/env python3
"""Run leakage-guarded choreography calibration without inventing score bands."""

from __future__ import annotations

import argparse
import hashlib
import json
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from statistics import mean, median
from typing import Any

from choreography_judge import load_track, score

SCHEMA_VERSION = "nodevideo.choreography-calibration-manifest.v1"
OUTPUT_VERSION = "nodevideo.choreography-calibration-report.v1"
MINIMUM_PAIRS_PER_CLASS = 5
MINIMUM_CASE_GROUPS_PER_CLASS = 3


def validate_manifest(manifest: dict[str, Any], root: Path, require_tracks: bool = True) -> dict[str, dict]:
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"schemaVersion must be {SCHEMA_VERSION}")
    clip_list = manifest.get("clips")
    pair_list = manifest.get("pairs")
    if not isinstance(clip_list, list) or not isinstance(pair_list, list):
        raise ValueError("clips and pairs must be arrays")
    clips: dict[str, dict] = {}
    for clip in clip_list:
        required = {"id", "track", "mediaSha256", "choreographyFamily", "productionFamily"}
        if not isinstance(clip, dict) or not required.issubset(clip):
            raise ValueError(f"clip is missing required keys: {sorted(required)}")
        if clip["id"] in clips:
            raise ValueError(f"duplicate clip id: {clip['id']}")
        if len(clip["mediaSha256"]) != 64:
            raise ValueError(f"clip {clip['id']} has an invalid mediaSha256")
        track = (root / clip["track"]).resolve()
        if require_tracks and not track.is_file():
            raise ValueError(f"clip {clip['id']} track does not exist: {track}")
        sidecar = track.with_suffix(".json")
        if require_tracks and sidecar.is_file():
            metadata = json.loads(sidecar.read_text(encoding="utf-8"))
            if metadata.get("videoSha256", "").lower() != clip["mediaSha256"].lower():
                raise ValueError(f"clip {clip['id']} media hash does not match its pose sidecar")
        clips[clip["id"]] = {**clip, "resolvedTrack": str(track)}

    seen_pairs: set[str] = set()
    for pair in pair_list:
        required = {"id", "reference", "attempt", "expected", "independence", "caseGroup", "labelSource"}
        if not isinstance(pair, dict) or not required.issubset(pair):
            raise ValueError(f"pair is missing required keys: {sorted(required)}")
        if pair["id"] in seen_pairs:
            raise ValueError(f"duplicate pair id: {pair['id']}")
        seen_pairs.add(pair["id"])
        if pair["reference"] not in clips or pair["attempt"] not in clips:
            raise ValueError(f"pair {pair['id']} references an unknown clip")
        reference, attempt = clips[pair["reference"]], clips[pair["attempt"]]
        if reference["mediaSha256"].lower() == attempt["mediaSha256"].lower():
            raise ValueError(f"pair {pair['id']} is a forbidden self-comparison")
        if reference["resolvedTrack"] == attempt["resolvedTrack"]:
            raise ValueError(f"pair {pair['id']} uses the same pose track twice")
        if pair["expected"] not in {"same-choreography", "different-choreography"}:
            raise ValueError(f"pair {pair['id']} has an invalid expected label")
        if pair["independence"] not in {"independent", "dependent"}:
            raise ValueError(f"pair {pair['id']} has an invalid independence label")
        if pair["independence"] == "independent" and \
                reference["productionFamily"] == attempt["productionFamily"]:
            raise ValueError(f"pair {pair['id']} cannot be independent within one productionFamily")
        same_family = reference["choreographyFamily"] == attempt["choreographyFamily"]
        if same_family != (pair["expected"] == "same-choreography"):
            raise ValueError(f"pair {pair['id']} label conflicts with choreographyFamily provenance")
        if not str(pair["labelSource"]).strip():
            raise ValueError(f"pair {pair['id']} must cite a labelSource")
    return clips


def compact_verdict(verdict: dict[str, Any]) -> dict[str, Any]:
    measurements = verdict.get("measurements", {})
    return {
        "status": verdict["status"],
        "confidence": verdict["confidence"],
        "overall": verdict.get("overall"),
        "scores": verdict.get("scores", {}),
        "measurements": {
            key: measurements[key]
            for key in (
                "poseCost", "jointCoverage", "durationCoverage", "medianTimingErrorMs",
                "alignmentMode", "comparisonMode", "referenceWindow", "attemptWindow",
            )
            if key in measurements
        },
        "limitations": verdict.get("limitations", []),
    }


def score_pair(payload: tuple[dict, dict, dict]) -> tuple[str, dict]:
    pair, reference, attempt = payload
    verdict = score(load_track(Path(reference["resolvedTrack"])), load_track(Path(attempt["resolvedTrack"])))
    return pair["id"], compact_verdict(verdict)


def distribution(values: list[float]) -> dict[str, float | int | None]:
    if not values:
        return {"count": 0, "minimum": None, "median": None, "mean": None, "maximum": None}
    return {
        "count": len(values),
        "minimum": round(min(values), 2),
        "median": round(median(values), 2),
        "mean": round(mean(values), 2),
        "maximum": round(max(values), 2),
    }


def candidate_threshold(positive: list[float], negative: list[float]) -> tuple[float | None, float | None]:
    if not positive or not negative:
        return None, None
    ordered = sorted(set(positive + negative))
    candidates = [ordered[0] - .01, ordered[-1] + .01]
    candidates.extend((left + right) / 2 for left, right in zip(ordered, ordered[1:]))
    best: tuple[float, float] | None = None
    for threshold in candidates:
        true_positive_rate = sum(value >= threshold for value in positive) / len(positive)
        true_negative_rate = sum(value < threshold for value in negative) / len(negative)
        balanced_accuracy = (true_positive_rate + true_negative_rate) / 2
        choice = (balanced_accuracy, threshold)
        if best is None or choice > best:
            best = choice
    return round(best[1], 2), round(best[0], 4)


def analyze_results(manifest: dict[str, Any], results: dict[str, dict]) -> dict[str, Any]:
    independent = [pair for pair in manifest["pairs"] if pair["independence"] == "independent"]
    completed = [pair for pair in independent if results[pair["id"]]["status"] == "completed" and
                 results[pair["id"]].get("overall") is not None]
    positives = [float(results[pair["id"]]["overall"]) for pair in completed
                 if pair["expected"] == "same-choreography"]
    negatives = [float(results[pair["id"]]["overall"]) for pair in completed
                 if pair["expected"] == "different-choreography"]
    positive_groups = {pair["caseGroup"] for pair in completed if pair["expected"] == "same-choreography"}
    negative_groups = {pair["caseGroup"] for pair in completed if pair["expected"] == "different-choreography"}
    enough = (
        len(positives) >= MINIMUM_PAIRS_PER_CLASS and len(negatives) >= MINIMUM_PAIRS_PER_CLASS and
        len(positive_groups) >= MINIMUM_CASE_GROUPS_PER_CLASS and
        len(negative_groups) >= MINIMUM_CASE_GROUPS_PER_CLASS
    )
    threshold, accuracy = candidate_threshold(positives, negatives)
    return {
        "status": "publishable" if enough else "insufficient-independent-evidence",
        "scoreBandsPublished": enough,
        "publishedThreshold": threshold if enough else None,
        "exploratoryCandidate": {
            "threshold": threshold,
            "balancedAccuracy": accuracy,
            "usableForProductDecisions": False,
        },
        "policy": {
            "minimumCompletedPairsPerClass": MINIMUM_PAIRS_PER_CLASS,
            "minimumIndependentCaseGroupsPerClass": MINIMUM_CASE_GROUPS_PER_CLASS,
        },
        "evidence": {
            "completedIndependentPairs": len(completed),
            "abstainedIndependentPairs": len(independent) - len(completed),
            "sameChoreographyCaseGroups": len(positive_groups),
            "differentChoreographyCaseGroups": len(negative_groups),
            "sameChoreographyScores": distribution(positives),
            "differentChoreographyScores": distribution(negatives),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()
    raw = args.manifest.read_bytes()
    manifest = json.loads(raw)
    clips = validate_manifest(manifest, args.root.resolve())
    payloads = [(pair, clips[pair["reference"]], clips[pair["attempt"]]) for pair in manifest["pairs"]]
    verdicts: dict[str, dict] = {}
    with ProcessPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {executor.submit(score_pair, payload): payload[0]["id"] for payload in payloads}
        for future in as_completed(futures):
            pair_id, verdict = future.result()
            verdicts[pair_id] = verdict
            print(json.dumps({"pair": pair_id, "status": verdict["status"], "overall": verdict["overall"]}))
    report = {
        "schemaVersion": OUTPUT_VERSION,
        "manifestSha256": hashlib.sha256(raw).hexdigest(),
        "cohort": {
            "clipCount": len(clips),
            "pairCount": len(manifest["pairs"]),
            "independentPairCount": sum(pair["independence"] == "independent" for pair in manifest["pairs"]),
        },
        "calibration": analyze_results(manifest, verdicts),
        "pairs": [{**pair, "verdict": verdicts[pair["id"]]} for pair in manifest["pairs"]],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "calibration": report["calibration"]}))


if __name__ == "__main__":
    main()
