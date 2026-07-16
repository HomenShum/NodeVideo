#!/usr/bin/env python3
"""Content-neutral, rerunnable short-form production comparison audit."""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import cv2
import easyocr
import numpy as np
from skimage.metrics import structural_similarity


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--candidate-plan", type=Path)
    parser.add_argument("--reference-plan", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sample-cadence-seconds", type=float, default=1.0)
    parser.add_argument("--content-kind", default="other")
    parser.add_argument("--ocr-languages", default="en")
    parser.add_argument(
        "--reuse-observations-from",
        type=Path,
        help=(
            "Reuse frameMetrics and summarized OCR from a prior audit. "
            "This reruns scoring and plan checks without decoding video or invoking OCR."
        ),
    )
    return parser.parse_args()


def frame_at(capture: cv2.VideoCapture, seconds: float) -> np.ndarray:
    capture.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000)
    ok, frame = capture.read()
    if not ok:
        raise RuntimeError(f"Could not read frame at {seconds:.3f}s")
    return frame


def image_metrics(frame: np.ndarray) -> dict[str, float]:
    yuv = cv2.cvtColor(frame, cv2.COLOR_BGR2YUV)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    return {
        "lumaMean": float(np.mean(yuv[:, :, 0])),
        "lumaStd": float(np.std(yuv[:, :, 0])),
        "saturationMean": float(np.mean(hsv[:, :, 1])),
    }


def similarity(candidate: np.ndarray, reference: np.ndarray) -> dict[str, float]:
    if candidate.shape != reference.shape:
        reference = cv2.resize(
            reference, (candidate.shape[1], candidate.shape[0]), interpolation=cv2.INTER_AREA
        )
    left = cv2.cvtColor(candidate, cv2.COLOR_BGR2GRAY)
    right = cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY)
    return {
        "graySsim": float(structural_similarity(left, right, data_range=255)),
        "meanAbsoluteRgbError": float(np.mean(cv2.absdiff(candidate, reference))),
    }


def normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9@+]+", " ", value.lower()).strip()


def ocr_observations(
    reader: easyocr.Reader, frame: np.ndarray, seconds: float
) -> list[dict]:
    if frame.shape[1] > 360:
        scale = 360 / frame.shape[1]
        frame = cv2.resize(
            frame,
            (360, max(1, round(frame.shape[0] * scale))),
            interpolation=cv2.INTER_AREA,
        )
    height, width = frame.shape[:2]
    observations = []
    for polygon, text, confidence in reader.readtext(
        frame, detail=1, paragraph=False, text_threshold=0.45, low_text=0.25
    ):
        normalized = normalize_text(text)
        if not normalized or confidence < 0.2:
            continue
        points = np.asarray(polygon, dtype=float)
        x1, y1 = points.min(axis=0)
        x2, y2 = points.max(axis=0)
        observations.append(
            {
                "seconds": seconds,
                "text": text,
                "normalizedText": normalized,
                "confidence": float(confidence),
                "box": {
                    "x": float(x1 / width),
                    "y": float(y1 / height),
                    "width": float((x2 - x1) / width),
                    "height": float((y2 - y1) / height),
                },
            }
        )
    return observations


def summarize_ocr(observations: list[dict]) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for observation in observations:
        groups[observation["normalizedText"]].append(observation)
    result = []
    for text, items in groups.items():
        boxes = [item["box"] for item in items]
        result.append(
            {
                "normalizedText": text,
                "firstSeconds": min(item["seconds"] for item in items),
                "lastSeconds": max(item["seconds"] for item in items),
                "sampleCount": len(items),
                "maxConfidence": max(item["confidence"] for item in items),
                "medianBox": {
                    key: float(np.median([box[key] for box in boxes]))
                    for key in ("x", "y", "width", "height")
                },
            }
        )
    return sorted(result, key=lambda item: (item["firstSeconds"], item["normalizedText"]))


def zone(box: dict) -> str:
    center = box["y"] + box["height"] / 2
    return "top" if center < 1 / 3 else "middle" if center < 2 / 3 else "bottom"


def match_ocr(candidate: list[dict], reference: list[dict]) -> list[dict]:
    candidates = [item for item in candidate if item["maxConfidence"] >= 0.45]
    references = [item for item in reference if item["maxConfidence"] >= 0.45]
    matches = []
    for target in references:
        ranked = []
        for index, item in enumerate(candidates):
            exact_score = SequenceMatcher(
                None, target["normalizedText"], item["normalizedText"]
            ).ratio()
            target_compact = target["normalizedText"].replace(" ", "").lstrip("@")
            item_compact = item["normalizedText"].replace(" ", "").lstrip("@")
            compact_score = SequenceMatcher(None, target_compact, item_compact).ratio()
            containment_score = (
                0.94
                if min(len(target_compact), len(item_compact)) >= 4
                and (target_compact in item_compact or item_compact in target_compact)
                else 0.0
            )
            text_score = max(exact_score, compact_score, containment_score)
            time_overlap = max(
                0.0,
                min(target["lastSeconds"] + 1, item["lastSeconds"] + 1)
                - max(target["firstSeconds"], item["firstSeconds"]),
            )
            time_span = max(
                target["lastSeconds"] + 1,
                item["lastSeconds"] + 1,
            ) - min(target["firstSeconds"], item["firstSeconds"])
            timing_score = time_overlap / max(time_span, 0.001)
            ranked.append((0.75 * text_score + 0.25 * timing_score, index, text_score))
        if not ranked:
            continue
        score, index, text_score = max(ranked)
        if text_score < 0.58 or score < 0.5:
            continue
        item = candidates[index]
        matches.append(
            {
                "referenceText": target["normalizedText"],
                "candidateText": item["normalizedText"],
                "score": round(score, 6),
                "sameVerticalZone": zone(target["medianBox"]) == zone(item["medianBox"]),
                "referenceZone": zone(target["medianBox"]),
                "candidateZone": zone(item["medianBox"]),
            }
        )
    return matches


def is_identity_group(item: dict, duration: float) -> bool:
    return not re.search(
        r"thanks|watching|follow|subscribe", item["normalizedText"]
    ) and (
        re.search(r"@|shum|home", item["normalizedText"])
        or item["lastSeconds"] - item["firstSeconds"] >= duration * 0.3
    )


def source_clip_deltas(candidate_plan: dict | None, reference_plan: dict | None) -> list[dict]:
    if not candidate_plan or not reference_plan:
        return []

    def source_clips(plan: dict) -> list[dict]:
        return [
            clip
            for track in plan.get("tracks", [])
            if track.get("kind") == "video"
            for clip in track.get("clips", [])
            if clip.get("kind") == "source"
        ]

    candidate = source_clips(candidate_plan)
    reference = source_clips(reference_plan)
    result = []
    for index, (left, right) in enumerate(zip(candidate, reference), start=1):
        result.append(
            {
                "phrase": index,
                "assetMatch": left.get("assetId") == right.get("assetId"),
                "fitMatch": left.get("fit") == right.get("fit"),
                "timelineStartDeltaFrames": left["timelineRange"]["startFrame"]
                - right["timelineRange"]["startFrame"],
                "timelineEndDeltaFrames": left["timelineRange"]["endFrameExclusive"]
                - right["timelineRange"]["endFrameExclusive"],
                "sourceStartDeltaFrames": left["sourceRange"]["startFrame"]
                - right["sourceRange"]["startFrame"],
                "sourceEndDeltaFrames": left["sourceRange"]["endFrameExclusive"]
                - right["sourceRange"]["endFrameExclusive"],
            }
        )
    return result


def ratio_score(left: float, right: float) -> float:
    if left == right == 0:
        return 1.0
    return min(left, right) / max(left, right, 0.000001)


def plan_provenance_score(plan: dict | None) -> float:
    if not plan:
        return 0.5
    calibration = plan.get("lineage", {}).get("calibration")
    if calibration and calibration.get("disclosure") and calibration.get("targetArtifactIds"):
        return 1.0
    return 1.0 if not plan.get("lineage", {}).get("targetDerivedRenderAssetIds") else 0.0


def identity_score(
    candidate_groups: list[dict],
    reference_groups: list[dict],
    duration: float,
    candidate_plan: dict | None,
) -> float:
    def identity_groups(groups: list[dict]) -> list[dict]:
        return [
            item
            for item in groups
            if item["maxConfidence"] >= 0.45
            and is_identity_group(item, duration)
        ]

    candidate_identity = identity_groups(candidate_groups)
    reference_identity = identity_groups(reference_groups)
    if not reference_identity:
        return 1.0
    if not candidate_identity:
        return 0.0
    candidate_span = max(item["lastSeconds"] for item in candidate_identity) - min(
        item["firstSeconds"] for item in candidate_identity
    )
    reference_span = max(item["lastSeconds"] for item in reference_identity) - min(
        item["firstSeconds"] for item in reference_identity
    )
    persistence = min(1.0, candidate_span / max(reference_span, 0.001))
    render_ids = candidate_plan.get("lineage", {}).get("renderAssetIds", []) if candidate_plan else []
    fixed_identity_assets = any("watermark" in item for item in render_ids) and any(
        "end-card-brand" in item for item in render_ids
    )
    return 0.5 * persistence + 0.5 * float(fixed_identity_assets)


def main() -> None:
    args = parse_args()
    for path in (args.candidate, args.reference):
        if not path.is_file():
            raise FileNotFoundError(path)
    candidate_plan = json.loads(args.candidate_plan.read_text()) if args.candidate_plan else None
    reference_plan = json.loads(args.reference_plan.read_text()) if args.reference_plan else None
    if args.reuse_observations_from:
        prior = json.loads(args.reuse_observations_from.read_text(encoding="utf-8"))
        frames = prior["frameMetrics"]
        candidate_ocr = prior["candidateOcr"]
        reference_ocr = prior["referenceOcr"]
        duration = float(prior["durationSeconds"])
        sample_cadence_seconds = float(prior["sampleCadenceSeconds"])
    else:
        candidate_capture = cv2.VideoCapture(str(args.candidate))
        reference_capture = cv2.VideoCapture(str(args.reference))
        duration = min(
            candidate_capture.get(cv2.CAP_PROP_FRAME_COUNT)
            / candidate_capture.get(cv2.CAP_PROP_FPS),
            reference_capture.get(cv2.CAP_PROP_FRAME_COUNT)
            / reference_capture.get(cv2.CAP_PROP_FPS),
        )
        sample_times = np.arange(
            args.sample_cadence_seconds / 2,
            duration,
            args.sample_cadence_seconds,
        )
        reader = easyocr.Reader(args.ocr_languages.split(","), gpu=False, verbose=False)
        frames = []
        candidate_ocr_raw = []
        reference_ocr_raw = []
        for seconds in sample_times:
            candidate_frame = frame_at(candidate_capture, float(seconds))
            reference_frame = frame_at(reference_capture, float(seconds))
            candidate_metrics = image_metrics(candidate_frame)
            reference_metrics = image_metrics(reference_frame)
            frames.append(
                {
                    "seconds": float(seconds),
                    "candidate": candidate_metrics,
                    "reference": reference_metrics,
                    "similarity": similarity(candidate_frame, reference_frame),
                }
            )
            candidate_ocr_raw.extend(ocr_observations(reader, candidate_frame, float(seconds)))
            reference_ocr_raw.extend(ocr_observations(reader, reference_frame, float(seconds)))
        candidate_capture.release()
        reference_capture.release()
        candidate_ocr = summarize_ocr(candidate_ocr_raw)
        reference_ocr = summarize_ocr(reference_ocr_raw)
        sample_cadence_seconds = args.sample_cadence_seconds
    matches = match_ocr(candidate_ocr, reference_ocr)
    reference_confident = [item for item in reference_ocr if item["maxConfidence"] >= 0.45]
    semantic_reference = [
        item for item in reference_confident if not is_identity_group(item, duration)
    ]
    semantic_reference_text = {item["normalizedText"] for item in semantic_reference}
    semantic_matches = [
        item for item in matches if item["referenceText"] in semantic_reference_text
    ]
    candidate_means = {
        key: float(np.mean([item["candidate"][key] for item in frames]))
        for key in ("lumaMean", "lumaStd", "saturationMean")
    }
    reference_means = {
        key: float(np.mean([item["reference"][key] for item in frames]))
        for key in ("lumaMean", "lumaStd", "saturationMean")
    }
    deltas = source_clip_deltas(candidate_plan, reference_plan)
    exact_structural = bool(deltas) and all(
        item["assetMatch"]
        and item["fitMatch"]
        and max(
            abs(item["timelineStartDeltaFrames"]),
            abs(item["timelineEndDeltaFrames"]),
            abs(item["sourceStartDeltaFrames"]),
            abs(item["sourceEndDeltaFrames"]),
        ) == 0
        for item in deltas
    )
    semantic_score = len(semantic_matches) / max(1, len(semantic_reference))
    layout_score = (
        sum(1 for item in semantic_matches if item["sameVerticalZone"])
        / max(1, len(semantic_matches))
    )
    visual_score = float(
        np.mean(
            [
                ratio_score(candidate_means[key], reference_means[key])
                for key in ("lumaMean", "lumaStd", "saturationMean")
            ]
        )
    )
    measured_identity_score = identity_score(
        candidate_ocr, reference_ocr, duration, candidate_plan
    )
    reference_delivery = [
        item
        for item in reference_confident
        if re.search(r"thanks|watching|follow|subscribe", item["normalizedText"])
    ]
    delivery_matches = [
        item
        for item in matches
        if re.search(r"thanks|watching|follow|subscribe", item["referenceText"])
    ]
    delivery_score = len(delivery_matches) / max(1, len(reference_delivery))
    report = {
        "schemaVersion": "nodevideo.production-style-gap-audit.v1",
        "contentKind": args.content_kind,
        "durationSeconds": duration,
        "sampleCadenceSeconds": sample_cadence_seconds,
        "inputs": {
            "candidate": str(args.candidate),
            "reference": str(args.reference),
            "candidatePlan": str(args.candidate_plan) if args.candidate_plan else None,
            "referencePlan": str(args.reference_plan) if args.reference_plan else None,
            "reusedObservationsFrom": (
                str(args.reuse_observations_from)
                if args.reuse_observations_from
                else None
            ),
        },
        "summary": {
            "candidate": candidate_means,
            "reference": reference_means,
            "meanGraySsim": float(np.mean([item["similarity"]["graySsim"] for item in frames])),
            "meanAbsoluteRgbError": float(
                np.mean([item["similarity"]["meanAbsoluteRgbError"] for item in frames])
            ),
            "ocrReferenceGroups": len(reference_confident),
            "ocrMatchedGroups": len(matches),
            "ocrSemanticReferenceGroups": len(semantic_reference),
            "ocrSemanticMatchedGroups": len(semantic_matches),
            "layoutZoneMatches": sum(
                1 for item in semantic_matches if item["sameVerticalZone"]
            ),
        },
        "sourceAndCutDeltas": deltas,
        "candidateOcr": candidate_ocr,
        "referenceOcr": reference_ocr,
        "ocrMatches": matches,
        "gateSignals": {
            "provenance": round(plan_provenance_score(candidate_plan), 6),
            "structural": 1.0 if exact_structural else 0.0 if deltas else 0.5,
            "semantic-overlays": round(semantic_score, 6),
            "layout": round(layout_score, 6),
            "visual-treatment": round(visual_score, 6),
            "creator-identity": round(measured_identity_score, 6),
            "delivery": round(delivery_score, 6),
        },
        "frameMetrics": frames,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["gateSignals"], indent=2))
    print(args.output)


if __name__ == "__main__":
    main()
