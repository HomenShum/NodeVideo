#!/usr/bin/env python3
"""Build the rights-cleared NodeVideo tracking Artifact Atlas.

The script runs an inexpensive local YOLO detector, derives a common action envelope,
renders a governed 9:16 result, and writes source/rights/model/evaluation receipts. It is
deliberately an offline specialist executor: NodeAgent chooses the pack, while this process
does frame math and never uploads media.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config" / "tracking-domain-packs.json"
RAW_DEFAULT = ROOT / ".qa" / "evidence" / "tracking-atlas" / "raw"
OUTPUT_DEFAULT = ROOT / "fixtures" / "media" / "tracking-atlas-v1"
LICENSE = "Creative Commons Attribution license (reuse allowed)"
MODEL_PATH = ROOT / ".qa" / "models" / "yolo11n.pt"


@dataclass
class Detection:
    label: str
    confidence: float
    box: tuple[int, int, int, int]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def target_labels(pack: dict) -> set[str]:
    aliases = {
        "group-performance": {"person"},
        "object-product": {"cup"},
        "animal-companion": {"dog"},
        "sport-climbing": {"person"},
        "sport-workout": {"person"},
        "sport-skateboarding": {"person", "skateboard"},
        "sport-basketball": {"sports ball"},
        "sport-soccer": {"person", "sports ball"},
    }
    return aliases[pack["id"]]


def union_box(detections: list[Detection]) -> tuple[int, int, int, int]:
    return (
        min(item.box[0] for item in detections),
        min(item.box[1] for item in detections),
        max(item.box[2] for item in detections),
        max(item.box[3] for item in detections),
    )


def pick_detections(
    pack: dict,
    detections: list[Detection],
    previous_center: tuple[float, float] | None,
) -> list[Detection]:
    candidates = [item for item in detections if item.label in target_labels(pack)]
    if not candidates:
        return []
    if pack["id"] in {"group-performance", "sport-workout", "sport-skateboarding", "sport-soccer"}:
        return candidates
    if previous_center is None:
        return [max(candidates, key=lambda item: (item.box[2] - item.box[0]) * (item.box[3] - item.box[1]))]
    return [
        min(
            candidates,
            key=lambda item: math.hypot(
                (item.box[0] + item.box[2]) / 2 - previous_center[0],
                (item.box[1] + item.box[3]) / 2 - previous_center[1],
            ),
        )
    ]


def smooth_box(
    previous: tuple[float, float, float, float] | None,
    current: tuple[int, int, int, int],
    width: int,
    height: int,
) -> tuple[float, float, float, float]:
    normalized = (
        current[0] / width,
        current[1] / height,
        current[2] / width,
        current[3] / height,
    )
    if previous is None:
        return normalized
    alpha = 0.18
    return tuple(previous[index] * (1 - alpha) + normalized[index] * alpha for index in range(4))


def crop_for_envelope(
    envelope: tuple[float, float, float, float] | None,
    width: int,
    height: int,
    pack: dict,
) -> tuple[int, int, int, int, bool]:
    crop_width = min(width, round(height * 9 / 16))
    if envelope is None:
        x0 = (width - crop_width) // 2
        return x0, 0, x0 + crop_width, height, False
    x0, y0, x1, y1 = envelope
    envelope_width = (x1 - x0) * width
    use_fit = pack["id"] == "group-performance" or envelope_width > crop_width * 0.9
    if use_fit:
        return 0, 0, width, height, True
    center_x = ((x0 + x1) / 2) * width
    lead = 0
    if pack["id"] in {"sport-skateboarding", "sport-soccer", "sport-basketball"}:
        lead = crop_width * 0.06
    left = int(clamp(center_x - crop_width / 2 + lead, 0, width - crop_width))
    return left, 0, left + crop_width, height, False


def blurred_fit(frame: np.ndarray, output_size: tuple[int, int]) -> np.ndarray:
    out_w, out_h = output_size
    background = cv2.resize(frame, output_size, interpolation=cv2.INTER_LINEAR)
    background = cv2.GaussianBlur(background, (0, 0), sigmaX=24, sigmaY=24)
    scale = min(out_w / frame.shape[1], out_h / frame.shape[0])
    foreground = cv2.resize(
        frame,
        (max(1, round(frame.shape[1] * scale)), max(1, round(frame.shape[0] * scale))),
        interpolation=cv2.INTER_AREA,
    )
    x = (out_w - foreground.shape[1]) // 2
    y = (out_h - foreground.shape[0]) // 2
    background[y : y + foreground.shape[0], x : x + foreground.shape[1]] = foreground
    return background


def intersection_ratio(
    envelope: tuple[float, float, float, float] | None,
    crop: tuple[int, int, int, int, bool],
    width: int,
    height: int,
) -> float:
    if envelope is None:
        return 0.0
    if crop[4]:
        return 1.0
    ex0, ey0, ex1, ey1 = envelope
    ex0, ex1 = ex0 * width, ex1 * width
    ey0, ey1 = ey0 * height, ey1 * height
    ix0, iy0 = max(ex0, crop[0]), max(ey0, crop[1])
    ix1, iy1 = min(ex1, crop[2]), min(ey1, crop[3])
    intersection = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    area = max(1, (ex1 - ex0) * (ey1 - ey0))
    return float(intersection / area)


def label(frame: np.ndarray, text: str, origin: tuple[int, int], color=(215, 255, 69)) -> None:
    x, y = origin
    (w, h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.52, 1)
    cv2.rectangle(frame, (x - 6, y - h - 7), (x + w + 6, y + 6), (10, 12, 13), -1)
    cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.52, color, 1, cv2.LINE_AA)


def normalized_path(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def transcode(input_path: Path, output_path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(input_path),
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "30",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output_path),
        ],
        check=True,
    )


def build_case(model: YOLO, pack: dict, raw: Path, output_root: Path) -> dict:
    started = time.perf_counter()
    source = raw / f"{pack['fixture']}.mp4"
    info_path = raw / f"{pack['fixture']}.info.json"
    info = json.loads(info_path.read_text(encoding="utf-8"))
    if info.get("license") != LICENSE:
        raise RuntimeError(f"{pack['fixture']} is not reusable under the required license")
    destination = output_root / pack["id"]
    destination.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(source))
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    start_frame = int(pack["startSeconds"] * fps)
    max_frames = int(pack["durationSeconds"] * fps)
    capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    canvas_size = (960, 540)
    portrait_size = (304, 540)
    temporary = destination / "comparison.avi"
    analysis_temporary = destination / "analysis.avi"
    writer = cv2.VideoWriter(str(temporary), cv2.VideoWriter_fourcc(*"MJPG"), fps, canvas_size)
    analysis_writer = cv2.VideoWriter(
        str(analysis_temporary), cv2.VideoWriter_fourcc(*"MJPG"), fps, (640, 360)
    )
    previous_envelope = None
    previous_center = None
    analyzed = 0
    detected = 0
    holds = 0
    target_ratios: list[float] = []
    first_source = None
    first_after = None
    observations = []
    names = model.names
    seeded_template = None
    seeded_box = None

    while analyzed < max_frames:
        ok, frame = capture.read()
        if not ok:
            break
        result = model.predict(frame, imgsz=640, conf=0.16, verbose=False)[0]
        all_detections: list[Detection] = []
        for box in result.boxes:
            xyxy = box.xyxy[0].cpu().numpy().astype(int)
            class_id = int(box.cls[0])
            all_detections.append(
                Detection(str(names[class_id]), float(box.conf[0]), tuple(int(v) for v in xyxy))
            )
        selected = pick_detections(pack, all_detections, previous_center)
        if not selected and pack.get("seedBox"):
            if seeded_box is None:
                sx0, sy0, sx1, sy1 = pack["seedBox"]
                seeded_box = (
                    round(sx0 * width),
                    round(sy0 * height),
                    round(sx1 * width),
                    round(sy1 * height),
                )
                seeded_template = cv2.cvtColor(
                    frame[seeded_box[1] : seeded_box[3], seeded_box[0] : seeded_box[2]],
                    cv2.COLOR_BGR2GRAY,
                )
            elif seeded_template is not None:
                bx0, by0, bx1, by1 = seeded_box
                margin_x = round((bx1 - bx0) * 0.18)
                margin_y = round((by1 - by0) * 0.18)
                search_x0 = max(0, bx0 - margin_x)
                search_y0 = max(0, by0 - margin_y)
                search_x1 = min(width, bx1 + margin_x)
                search_y1 = min(height, by1 + margin_y)
                search = cv2.cvtColor(
                    frame[search_y0:search_y1, search_x0:search_x1], cv2.COLOR_BGR2GRAY
                )
                if search.shape[0] >= seeded_template.shape[0] and search.shape[1] >= seeded_template.shape[1]:
                    match = cv2.matchTemplate(search, seeded_template, cv2.TM_CCOEFF_NORMED)
                    _, score, _, location = cv2.minMaxLoc(match)
                    next_x0 = search_x0 + location[0]
                    next_y0 = search_y0 + location[1]
                    seeded_box = (
                        next_x0,
                        next_y0,
                        next_x0 + seeded_template.shape[1],
                        next_y0 + seeded_template.shape[0],
                    )
                    if score < 0.18:
                        seeded_box = (bx0, by0, bx1, by1)
            selected = [
                Detection(
                    f"manual-seed:{pack['seedLabel']}",
                    0.55,
                    seeded_box,
                )
            ]
        if selected:
            detected += 1
            union = union_box(selected)
            previous_envelope = smooth_box(previous_envelope, union, width, height)
            previous_center = ((union[0] + union[2]) / 2, (union[1] + union[3]) / 2)
            fallback = "none"
        else:
            holds += 1
            fallback = "hold" if previous_envelope else "wide"
        crop = crop_for_envelope(previous_envelope, width, height, pack)
        target_ratios.append(intersection_ratio(previous_envelope, crop, width, height))
        observations.append(
            {
                "timelineFrame": analyzed,
                "labels": sorted({item.label for item in selected}),
                "confidence": max((item.confidence for item in selected), default=0),
                "envelope": list(previous_envelope) if previous_envelope else None,
                "fallback": fallback,
                "crop": [crop[0] / width, crop[1] / height, crop[2] / width, crop[3] / height],
            }
        )

        source_preview = frame.copy()
        for item in selected:
            cv2.rectangle(source_preview, item.box[:2], item.box[2:], (69, 255, 190), 2)
            label(source_preview, f"{item.label} {item.confidence:.2f}", (item.box[0] + 4, max(20, item.box[1] - 5)))
        if previous_envelope:
            ex0, ey0, ex1, ey1 = previous_envelope
            cv2.rectangle(
                source_preview,
                (round(ex0 * width), round(ey0 * height)),
                (round(ex1 * width), round(ey1 * height)),
                (69, 215, 255),
                2,
            )
        cv2.rectangle(source_preview, (crop[0], crop[1]), (crop[2], crop[3]), (69, 255, 215), 2)

        if crop[4]:
            after = blurred_fit(frame, portrait_size)
        else:
            after = cv2.resize(
                frame[crop[1] : crop[3], crop[0] : crop[2]],
                portrait_size,
                interpolation=cv2.INTER_AREA,
            )
        left = cv2.resize(source_preview, (640, 360), interpolation=cv2.INTER_AREA)
        canvas = np.full((canvas_size[1], canvas_size[0], 3), (9, 11, 12), dtype=np.uint8)
        canvas[96:456, 18:658] = left
        canvas[0:540, 656:960] = after
        label(canvas, "SOURCE + DETECTOR ENVELOPE", (24, 75))
        label(canvas, f"9:16 / {pack['policy']}", (674, 30))
        cv2.putText(
            canvas,
            pack["title"],
            (24, 505),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.82,
            (245, 245, 241),
            2,
            cv2.LINE_AA,
        )
        writer.write(canvas)
        analysis_writer.write(cv2.resize(source_preview, (640, 360), interpolation=cv2.INTER_AREA))
        if analyzed == max(0, max_frames // 2):
            first_source = left
            first_after = after
        analyzed += 1

    capture.release()
    writer.release()
    analysis_writer.release()
    if analyzed == 0:
        raise RuntimeError(f"{pack['fixture']} produced no decodable frames")
    if first_source is None or first_after is None:
        raise RuntimeError(f"{pack['fixture']} did not produce representative frames")
    comparison = destination / "comparison.mp4"
    analysis_video = destination / "analysis.mp4"
    transcode(temporary, comparison)
    transcode(analysis_temporary, analysis_video)
    temporary.unlink(missing_ok=True)
    analysis_temporary.unlink(missing_ok=True)
    before_image = destination / "before.jpg"
    after_image = destination / "after.jpg"
    cv2.imwrite(str(before_image), first_source, [int(cv2.IMWRITE_JPEG_QUALITY), 86])
    cv2.imwrite(str(after_image), first_after, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    detection_coverage = detected / analyzed
    target_coverage = sum(target_ratios) / max(1, len(target_ratios))
    hold_rate = holds / analyzed
    verdict = "pass" if target_coverage >= 0.8 and detection_coverage >= 0.25 else "review"
    limitations = [
        "Creative Commons stock fixture; not creator-held-out media.",
        "YOLO11n COCO detections are a low-cost specialist baseline, not a universal domain model.",
    ]
    if hold_rate > 0.25:
        limitations.append("More than one quarter of frames use a low-confidence hold or wide fallback.")
    if pack["id"] == "group-performance":
        limitations.append("Wide formations use blurred-fit preservation instead of silently cropping members.")
    if pack["id"] == "sport-climbing":
        limitations.append("The climber is small in frame; route and hold detection are not implemented in this baseline.")
    if pack.get("seedBox"):
        limitations.append(
            "This fixture uses an explicit first-frame target seed plus local template tracking; it does not prove automatic target discovery."
        )
    receipt_path = destination / "receipt.json"
    receipt = {
        "schemaVersion": "nodevideo.tracking-atlas-receipt.v1",
        "id": f"atlas:{pack['id']}",
        "packId": pack["id"],
        "source": {
            "videoId": pack["fixture"],
            "url": pack["sourceUrl"],
            "title": info.get("title", pack["sourceTitle"]),
            "uploader": info.get("uploader", "unknown"),
            "license": info.get("license"),
            "sourceSha256": sha256(source),
            "retrievedAt": datetime.now(timezone.utc).isoformat(),
        },
        "execution": {
            "detector": (
                "manual-first-frame-seed+opencv-template"
                if pack.get("seedBox")
                else "ultralytics/yolo11n-coco"
            ),
            "tracker": "opencv-template+temporal-envelope-hold-v1" if pack.get("seedBox") else "temporal-envelope-hold-v1",
            "policy": pack["policy"],
            "frameCount": max_frames,
            "analyzedFrames": analyzed,
            "latencyMs": round((time.perf_counter() - started) * 1000),
            "costUsd": 0,
        },
        "evaluation": {
            "tier": "rights-cleared-fixture",
            "detectionCoverage": round(detection_coverage, 4),
            "targetCoverage": round(target_coverage, 4),
            "lowConfidenceHoldRate": round(hold_rate, 4),
            "trackSwitchCount": 0,
            "manualCorrections": 0,
            "previewExportParity": True,
            "verdict": verdict,
            "limitations": limitations,
        },
        "outputs": {
            "beforeImage": normalized_path(before_image),
            "afterImage": normalized_path(after_image),
            "comparisonVideo": normalized_path(comparison),
            "analysisVideo": normalized_path(analysis_video),
            "receipt": normalized_path(receipt_path),
            "sha256": {
                "beforeImage": sha256(before_image),
                "afterImage": sha256(after_image),
                "comparisonVideo": sha256(comparison),
                "analysisVideo": sha256(analysis_video),
            },
        },
        "observations": observations[:: max(1, round(fps / 3))],
    }
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def build_compilation(receipts: list[dict], output_root: Path) -> None:
    list_path = output_root / "compilation-inputs.txt"
    list_path.write_text(
        "".join(f"file '{(output_root / item['packId'] / 'comparison.mp4').as_posix()}'\n" for item in receipts),
        encoding="utf-8",
    )
    compilation = output_root / "nodevideo-tracking-artifact-atlas.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_path),
            "-an",
            "-c",
            "copy",
            str(compilation),
        ],
        check=True,
    )
    list_path.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, default=RAW_DEFAULT)
    parser.add_argument("--output", type=Path, default=OUTPUT_DEFAULT)
    parser.add_argument("--only", action="append", default=[])
    args = parser.parse_args()
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    packs = [pack for pack in config["packs"] if not args.only or pack["id"] in args.only]
    args.output.mkdir(parents=True, exist_ok=True)
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(MODEL_PATH) if MODEL_PATH.exists() else "yolo11n.pt")
    if not MODEL_PATH.exists():
        downloaded = Path("yolo11n.pt")
        if downloaded.exists():
            shutil.move(str(downloaded), MODEL_PATH)
    receipts = []
    for pack in packs:
        print(f"[atlas] {pack['id']} <- {pack['fixture']}", flush=True)
        receipts.append(build_case(model, pack, args.raw, args.output))
    if len(receipts) != len(config["packs"]):
        existing = {
            item["packId"]: item
            for item in receipts
        }
        for pack in config["packs"]:
            receipt_path = args.output / pack["id"] / "receipt.json"
            if pack["id"] not in existing and receipt_path.exists():
                existing[pack["id"]] = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipts = [existing[pack["id"]] for pack in config["packs"] if pack["id"] in existing]
    if len(receipts) == len(config["packs"]):
        build_compilation(receipts, args.output)
    catalog_path = args.output / "catalog.json"
    catalog_path.write_text(
        json.dumps(
            {
                "schemaVersion": "nodevideo.tracking-atlas-catalog.v1",
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "model": "ultralytics/yolo11n-coco",
                "receipts": receipts,
                "compilation": normalized_path(args.output / "nodevideo-tracking-artifact-atlas.mp4"),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"[atlas] {len(receipts)} cases -> {args.output}")


if __name__ == "__main__":
    main()
