#!/usr/bin/env python3
"""Build a private, source-grounded nodevideo.media-index.v1 from local media."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def run(command: list[str], timeout: int = 1800) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
        encoding="utf-8",
        errors="replace",
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parameters_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def probe(path: Path) -> dict[str, Any]:
    result = run([
        "ffprobe",
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        str(path),
    ])
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def ratio(value: str | None, fallback: float) -> float:
    if not value:
        return fallback
    numerator, _, denominator = value.partition("/")
    try:
        result = float(numerator) / float(denominator or "1")
        return result if result > 0 else fallback
    except (TypeError, ValueError, ZeroDivisionError):
        return fallback


def silence_regions(path: Path, duration_ms: int) -> list[dict[str, int]]:
    result = run([
        "ffmpeg",
        "-hide_banner",
        "-nostats",
        "-i",
        str(path),
        "-af",
        "silencedetect=noise=-35dB:d=0.35",
        "-f",
        "null",
        "-",
    ])
    combined = f"{result.stdout}\n{result.stderr}"
    starts = [float(value) for value in re.findall(r"silence_start:\s*([0-9.]+)", combined)]
    ends = [float(value) for value in re.findall(r"silence_end:\s*([0-9.]+)", combined)]
    regions: list[dict[str, int]] = []
    for index, start in enumerate(starts):
        end = ends[index] if index < len(ends) else duration_ms / 1000
        start_ms = max(0, min(duration_ms - 1, round(start * 1000)))
        end_ms = max(start_ms + 1, min(duration_ms, round(end * 1000)))
        regions.append({"startMs": start_ms, "endMs": end_ms})
    return regions


def shot_regions(path: Path, duration_ms: int) -> tuple[list[dict[str, Any]], str | None]:
    try:
        from scenedetect import ContentDetector, detect  # type: ignore

        scenes = detect(str(path), ContentDetector(threshold=27.0), start_in_scene=True)
        output = []
        for index, (start, end) in enumerate(scenes):
            start_ms = max(0, round(start.get_seconds() * 1000))
            end_ms = min(duration_ms, max(start_ms + 1, round(end.get_seconds() * 1000)))
            output.append({"id": f"shot:{index}", "startMs": start_ms, "endMs": end_ms, "confidence": 0.8})
        if output:
            output[-1]["endMs"] = duration_ms
            return output, None
    except Exception as error:  # analyzer degradation is represented in provenance
        return ([{"id": "shot:source", "startMs": 0, "endMs": duration_ms, "confidence": 0.4}], str(error))
    return ([{"id": "shot:source", "startMs": 0, "endMs": duration_ms, "confidence": 0.4}], None)


def subject_tracks(path: Path, duration_ms: int) -> tuple[list[str], str | None]:
    try:
        import cv2  # type: ignore

        cascade_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
        detector = cv2.CascadeClassifier(str(cascade_path))
        capture = cv2.VideoCapture(str(path))
        sample_count = min(60, max(1, round(duration_ms / 1000)))
        detections = 0
        for sample in range(sample_count):
            capture.set(cv2.CAP_PROP_POS_MSEC, (sample / sample_count) * duration_ms)
            ok, frame = capture.read()
            if not ok:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(32, 32))
            if len(faces) > 0:
                detections += 1
        capture.release()
        return (["subject:primary-face"] if detections else [], None)
    except Exception as error:
        return ([], str(error))


def transcribe(path: Path, model_name: str, language: str | None) -> tuple[dict[str, Any] | None, list[dict[str, Any]], str | None]:
    if model_name == "none":
        return None, [], "transcription disabled by request"
    try:
        import whisper  # type: ignore

        model = whisper.load_model(model_name)
        result = model.transcribe(str(path), language=language, word_timestamps=True, verbose=False)
        words: list[dict[str, Any]] = []
        segments: list[dict[str, Any]] = []
        for segment in result.get("segments", []):
            text = str(segment.get("text", "")).strip()
            start_ms = round(float(segment.get("start", 0)) * 1000)
            end_ms = max(start_ms + 1, round(float(segment.get("end", 0)) * 1000))
            segments.append({"text": text, "startMs": start_ms, "endMs": end_ms})
            for word in segment.get("words", []) or []:
                word_start = round(float(word.get("start", segment.get("start", 0))) * 1000)
                word_end = max(word_start + 1, round(float(word.get("end", segment.get("end", 0))) * 1000))
                probability = float(word.get("probability", 0.75))
                words.append({
                    "text": str(word.get("word", "")).strip(),
                    "startMs": word_start,
                    "endMs": word_end,
                    "confidence": max(0.0, min(1.0, probability)),
                })
        return {"words": words, "segments": segments, "language": result.get("language")}, segments, None
    except Exception as error:
        return None, [], str(error)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("--asset-id", default="asset.local-source")
    parser.add_argument("--transcription", choices=["none", "tiny", "base", "small", "medium", "large"], default="none")
    parser.add_argument("--language")
    parser.add_argument("--output")
    arguments = parser.parse_args()

    source = Path(arguments.source).resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Source media not found: {source}")

    raw_probe = probe(source)
    video = next((stream for stream in raw_probe.get("streams", []) if stream.get("codec_type") == "video"), None)
    if not video:
        raise RuntimeError("Source has no video stream")
    audio_tracks = [stream for stream in raw_probe.get("streams", []) if stream.get("codec_type") == "audio"]
    duration_seconds = float(raw_probe.get("format", {}).get("duration") or video.get("duration") or 0)
    duration_ms = max(1, round(duration_seconds * 1000))
    source_hash = sha256_file(source)

    silences = silence_regions(source, duration_ms) if audio_tracks else []
    shots, shot_error = shot_regions(source, duration_ms)
    subjects, subject_error = subject_tracks(source, duration_ms)
    transcript, segments, transcription_error = transcribe(source, arguments.transcription, arguments.language)
    words = transcript["words"] if transcript else []
    fillers = [
        {**word, "confidence": min(float(word["confidence"]), 0.95)}
        for word in words
        if re.fullmatch(r"(?:um+|uh+|erm|like)", str(word["text"]).strip(" ,.!?").lower())
    ]
    quotes = []
    for index, segment in enumerate(segments):
        text = segment["text"]
        if not text:
            continue
        quotes.append({
            "id": f"quote:{index}",
            "text": text,
            "startMs": segment["startMs"],
            "endMs": min(duration_ms, segment["endMs"]),
            "scores": {
                "clarity": min(1.0, len(text) / 90),
                "hook": 0.9 if re.search(r"\b(?:why|how|never|first|problem|built|because)\b", text, re.I) else 0.55,
                "novelty": 0.5,
                "selfContained": 0.85 if re.search(r"[.!?]$", text) else 0.6,
            },
        })

    speech_regions = []
    cursor = 0
    for region in silences:
        if region["startMs"] > cursor:
            speech_regions.append({"startMs": cursor, "endMs": region["startMs"]})
        cursor = region["endMs"]
    if cursor < duration_ms and audio_tracks:
        speech_regions.append({"startMs": cursor, "endMs": duration_ms})

    parameters = {"transcription": arguments.transcription, "language": arguments.language, "silenceNoiseDb": -35, "silenceDuration": 0.35, "sceneThreshold": 27.0}
    limitations = [message for message in [transcription_error, shot_error, subject_error] if message]
    tools = [
        {"id": "ffprobe", "version": "system", "parametersHash": f"sha256:{parameters_hash({'tool': 'ffprobe'})}"},
        {"id": "ffmpeg.silencedetect", "version": "system", "parametersHash": f"sha256:{parameters_hash({'noiseDb': -35, 'duration': 0.35})}"},
        {"id": "pyscenedetect", "version": "installed", "parametersHash": f"sha256:{parameters_hash({'threshold': 27.0})}"},
        {"id": "opencv.face-sampler", "version": "installed", "parametersHash": f"sha256:{parameters_hash({'samplesMax': 60})}"},
    ]
    if arguments.transcription != "none":
        tools.append({"id": "openai-whisper", "version": "installed", "parametersHash": f"sha256:{parameters_hash({'model': arguments.transcription, 'language': arguments.language})}"})

    output = {
        "schemaVersion": "nodevideo.media-index.v1",
        "id": f"index:{source_hash[:12]}",
        "assetId": arguments.asset_id,
        "sourceHash": f"sha256:{source_hash}",
        "technical": {
            "durationMs": duration_ms,
            "width": int(video.get("width") or 0),
            "height": int(video.get("height") or 0),
            "frameRate": ratio(video.get("avg_frame_rate"), 30.0),
            "audioTracks": len(audio_tracks),
        },
        "speech": {"words": words, "silenceRegions": silences, "fillers": fillers} if audio_tracks else None,
        "visual": {"shots": shots, "subjectTrackIds": subjects, "textRegions": []},
        "audio": {"speechRegions": speech_regions, "musicRegions": []},
        "semantics": {"topics": [], "quotes": quotes, "demonstrations": []},
        "provenance": {
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "tools": tools,
            "limitations": limitations,
            "mediaEgress": False,
        },
    }
    if output["speech"] is None:
        output.pop("speech")
    encoded = json.dumps(output, indent=2, ensure_ascii=False) + "\n"
    if arguments.output:
        destination = Path(arguments.output).resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_text(encoded, encoding="utf-8")
        temporary.replace(destination)
    else:
        sys.stdout.write(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
