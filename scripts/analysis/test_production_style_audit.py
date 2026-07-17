from production_style_audit import identity_score, match_ocr


def group(text: str, first: float, last: float, x: float, y: float) -> dict:
    return {
        "normalizedText": text,
        "firstSeconds": first,
        "lastSeconds": last,
        "sampleCount": 2,
        "maxConfidence": 0.9,
        "medianBox": {"x": x, "y": y, "width": 0.2, "height": 0.05},
    }


def test_short_text_nine_seconds_late_does_not_match() -> None:
    reference = [group("right now", 2.5, 2.5, 0.7, 0.2)]
    candidate = [group("right now", 11.5, 11.5, 0.7, 0.2)]
    assert match_ocr(candidate, reference) == []


def test_matching_text_exposes_timing_and_two_dimensional_placement() -> None:
    reference = [group("tick", 21.5, 22.5, 0.3, 0.1)]
    candidate = [group("tick", 21.5, 22.5, 0.32, 0.12)]
    match = match_ocr(candidate, reference)[0]
    assert match["timingScore"] == 1
    assert match["sameHorizontalZone"] is True
    assert match["placementScore"] > 0.9


def test_identity_requires_reference_spatial_phases() -> None:
    reference = [
        group("@shumhomen", 1.5, 15.5, 0.75, 0.2),
        group("@shumhomen", 16.5, 39.5, 0.05, 0.6),
        group("@shumhomen", 41.5, 43.5, 0.4, 0.5),
    ]
    candidate = [group("@shumhomen", 1.5, 39.5, 0.75, 0.2)]
    score = identity_score(
        candidate,
        reference,
        44.5,
        {"lineage": {"renderAssetIds": ["asset.watermark", "asset.end-card-brand"]}},
    )
    assert score < 0.7
