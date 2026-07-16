#!/usr/bin/env python3
"""Extract inspectable MediaPipe Pose Landmarker tracks from a bounded video interval."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

# MediaPipe probes TensorFlow even though Pose Landmarker uses the TFLite task runtime.
if "tensorflow" not in sys.modules:
    sys.modules["tensorflow"] = None

import cv2
import mediapipe as mp
import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--start-seconds", type=float, default=0.0)
    parser.add_argument("--duration-seconds", type=float)
    parser.add_argument("--sample-fps", type=float, default=10.0)
    parser.add_argument("--num-poses", type=int, default=1)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    args = parse_args()
    if args.sample_fps <= 0 or not 1 <= args.num_poses <= 10:
        raise ValueError("sample-fps must be positive and num-poses must be between 1 and 10")
    capture = cv2.VideoCapture(str(args.video))
    source_fps = float(capture.get(cv2.CAP_PROP_FPS))
    if source_fps <= 0:
        raise RuntimeError("Could not determine source FPS")
    start_frame = round(args.start_seconds * source_fps)
    end_frame = (
        round((args.start_seconds + args.duration_seconds) * source_fps)
        if args.duration_seconds is not None
        else int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    )
    step = max(1, round(source_fps / args.sample_fps))
    capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.model)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_poses=args.num_poses,
        min_pose_detection_confidence=0.15,
        min_pose_presence_confidence=0.15,
        min_tracking_confidence=0.15,
        output_segmentation_masks=False,
    )
    frames: list[int] = []
    poses: list[np.ndarray] = []
    with mp.tasks.vision.PoseLandmarker.create_from_options(options) as landmarker:
        frame_number = start_frame
        while frame_number < end_frame:
            ok, frame = capture.read()
            if not ok:
                break
            if (frame_number - start_frame) % step != 0:
                frame_number += 1
                continue
            height, width = frame.shape[:2]
            scale = min(1.0, 640.0 / max(height, width))
            if scale < 1.0:
                frame = cv2.resize(
                    frame,
                    (round(width * scale), round(height * scale)),
                    interpolation=cv2.INTER_AREA,
                )
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = landmarker.detect(
                mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
            )
            sample = np.full((args.num_poses, 33, 4), np.nan, dtype=np.float32)
            for pose_index, landmarks in enumerate(result.pose_landmarks[: args.num_poses]):
                for landmark_index, landmark in enumerate(landmarks):
                    sample[pose_index, landmark_index] = (
                        landmark.x,
                        landmark.y,
                        landmark.z,
                        landmark.visibility,
                    )
            frames.append(frame_number)
            poses.append(sample)
            frame_number += 1
    capture.release()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.output,
        frames=np.asarray(frames, dtype=np.int32),
        times=np.asarray(frames, dtype=np.float64) / source_fps,
        poses=np.asarray(poses, dtype=np.float32),
    )
    metadata = {
        "schemaVersion": "nodevideo.pose-landmarker-track.v1",
        "videoSha256": sha256(args.video),
        "modelSha256": sha256(args.model),
        "sourceFps": source_fps,
        "sampleFps": source_fps / step,
        "startSeconds": args.start_seconds,
        "durationSeconds": (frames[-1] / source_fps - args.start_seconds) if frames else 0,
        "numRequestedPoses": args.num_poses,
        "sampleCount": len(frames),
        "coordinateSpace": "normalized-frame-top-left-v1",
    }
    args.output.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
