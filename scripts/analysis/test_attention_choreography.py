from pathlib import Path

import numpy as np

from song_choreography_analyzer import (
    PoseTrack,
    plan_attention_choreography,
    plan_identity_choreography,
)


def test_attention_choreography_uses_pose_and_exposes_intent() -> None:
    times = np.asarray([0.0, 0.5, 1.0, 1.5, 2.0])
    raw = np.full((len(times), 33, 2), 0.5)
    raw[:, :, 1] = 0.55
    raw[:, 11] = [0.42, 0.28]
    raw[:, 12] = [0.58, 0.28]
    raw[:, 23] = [0.44, 0.64]
    raw[:, 24] = [0.56, 0.64]
    raw[:, 15, 0] = np.linspace(0.2, 0.65, len(times))
    raw[:, 15, 1] = 0.25
    raw[:, 16] = [0.68, 0.4]
    track = PoseTrack(
        asset_id="asset.take-a",
        path=Path("take-a.npz"),
        times=times,
        raw_xy=raw,
        normalized_xy=raw,
        motion=np.zeros(len(times) - 1),
        sample_rate=2,
    )
    cues = [
        {"id": "lyric.1", "text": "Tick", "startSeconds": 0.5, "endSeconds": 1.0},
        {"id": "lyric.2", "text": "Tock", "startSeconds": 1.0, "endSeconds": 1.5},
    ]
    phrases = [
        {
            "id": "phrase.1",
            "timelineStartSeconds": 0.0,
            "timelineEndSeconds": 2.0,
            "selectedTakeAssetId": "asset.take-a",
        }
    ]

    result = plan_attention_choreography(
        lyrics=cues,
        phrases=phrases,
        takes={"asset.take-a": track},
        offsets={"asset.take-a": 0.0},
    )

    assert len(result) == 2
    assert result[0]["attentionTarget"] == "left-hand"
    assert result[0]["requiresOwnerReview"] is True
    assert result[0]["saliencyCompetition"] <= 0.05
    assert result[0]["clearancePolicy"] == "framewise-dilated-pose-silhouette-v1"
    assert result[1]["eyeTravel"] in {"none", "up", "down", "left", "right", "diagonal"}

    identity = plan_identity_choreography(
        duration_seconds=2.0,
        phrases=phrases,
        takes={"asset.take-a": track},
        offsets={"asset.take-a": 0.0},
    )
    assert identity
    assert all(item["maxBodyOverlapRatio"] <= 0.05 for item in identity)
