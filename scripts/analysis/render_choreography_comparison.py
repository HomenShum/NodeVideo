#!/usr/bin/env python3
"""Render an inspectable side-by-side skeleton comparison from a verdict path."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

CONNECTIONS = [(11,12),(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),
               (23,24),(23,25),(25,27),(24,26),(26,28),(27,29),(29,31),(28,30),(30,32)]


def panel(frame: np.ndarray, width: int, height: int) -> tuple[np.ndarray, float, int, int]:
    source_height, source_width = frame.shape[:2]
    scale = min(width / source_width, height / source_height)
    resized = cv2.resize(frame, (round(source_width * scale), round(source_height * scale)))
    output = np.full((height, width, 3), (16, 18, 22), dtype=np.uint8)
    x, y = (width - resized.shape[1]) // 2, (height - resized.shape[0]) // 2
    output[y:y+resized.shape[0], x:x+resized.shape[1]] = resized
    return output, scale, x, y


def draw_pose(image: np.ndarray, pose: np.ndarray, scale: float, x: int, y: int,
              source_shape: tuple[int, int], color: tuple[int, int, int]) -> None:
    height, width = source_shape
    points = [(round(x + landmark[0] * width * scale), round(y + landmark[1] * height * scale))
              for landmark in pose]
    for start, end in CONNECTIONS:
        if pose[start,3] >= .35 and pose[end,3] >= .35:
            cv2.line(image, points[start], points[end], color, 3, cv2.LINE_AA)
    for index in {value for edge in CONNECTIONS for value in edge}:
        if pose[index,3] >= .35:
            cv2.circle(image, points[index], 4, (250,250,250), -1, cv2.LINE_AA)


def advance(capture: cv2.VideoCapture, current_index: int, target_index: int,
            current_frame: np.ndarray | None) -> tuple[bool, np.ndarray | None, int]:
    if target_index < current_index:
        capture.set(cv2.CAP_PROP_POS_FRAMES, target_index)
        current_index = target_index - 1
    while current_index < target_index:
        ok, current_frame = capture.read()
        if not ok:
            return False, current_frame, current_index
        current_index += 1
    return current_frame is not None, current_frame, current_index


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-video", required=True, type=Path)
    parser.add_argument("--attempt-video", required=True, type=Path)
    parser.add_argument("--reference-track", required=True, type=Path)
    parser.add_argument("--attempt-track", required=True, type=Path)
    parser.add_argument("--verdict", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    reference, attempt = np.load(args.reference_track), np.load(args.attempt_track)
    verdict = json.loads(args.verdict.read_text(encoding="utf-8"))
    alignment = verdict.get("alignment", [])
    if not alignment:
        raise ValueError("verdict has no alignment path")
    ref_capture, att_capture = cv2.VideoCapture(str(args.reference_video)), cv2.VideoCapture(str(args.attempt_video))
    output = cv2.VideoWriter(str(args.output), cv2.VideoWriter_fourcc(*"mp4v"), 15.0, (720, 640))
    if not output.isOpened():
        raise RuntimeError("could not open comparison writer")
    ref_index = att_index = -1
    ref_frame = att_frame = None
    try:
        for pair in alignment:
            ri, ai = pair["referenceFrame"], pair["attemptFrame"]
            ref_ok, ref_frame, ref_index = advance(ref_capture, ref_index, int(reference["frames"][ri]), ref_frame)
            att_ok, att_frame, att_index = advance(att_capture, att_index, int(attempt["frames"][ai]), att_frame)
            if not ref_ok or not att_ok:
                continue
            ref_panel, rs, rx, ry = panel(ref_frame, 360, 640)
            att_panel, ass, ax, ay = panel(att_frame, 360, 640)
            ref_people = reference["poses"][ri]; att_people = attempt["poses"][ai]
            for pose in ref_people:
                if np.count_nonzero(pose[:,3] >= .35) >= 5:
                    draw_pose(ref_panel, pose, rs, rx, ry, ref_frame.shape[:2], (98,255,217))
            for pose in att_people:
                if np.count_nonzero(pose[:,3] >= .35) >= 5:
                    draw_pose(att_panel, pose, ass, ax, ay, att_frame.shape[:2], (250,139,167))
            cv2.rectangle(ref_panel, (0,0), (360,54), (0,0,0), -1)
            cv2.rectangle(att_panel, (0,0), (360,54), (0,0,0), -1)
            cv2.putText(ref_panel, f"REFERENCE  {pair['referenceTime']:.2f}s", (14,35),
                        cv2.FONT_HERSHEY_SIMPLEX, .56, (98,255,217), 2, cv2.LINE_AA)
            cv2.putText(att_panel, f"YOUR TAKE  {pair['attemptTime']:.2f}s", (14,35),
                        cv2.FONT_HERSHEY_SIMPLEX, .56, (250,139,167), 2, cv2.LINE_AA)
            output.write(np.hstack([ref_panel, att_panel]))
    finally:
        output.release(); ref_capture.release(); att_capture.release()


if __name__ == "__main__":
    main()
