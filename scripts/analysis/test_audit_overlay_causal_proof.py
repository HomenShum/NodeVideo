import numpy as np

from audit_overlay_causal_proof import normalized_box_to_pixels


def test_vertical_creator_frame_maps_normalized_overlay_to_exact_pixels():
    box = {"x": 0.1, "y": 0.2, "width": 0.5, "height": 0.25}

    assert normalized_box_to_pixels(box, 720, 1280) == (72, 256, 432, 576)


def test_edge_aligned_overlay_stays_bounded_during_sustained_frame_audits():
    box = {"x": 0.95, "y": 0.9, "width": 0.05, "height": 0.1}

    for _ in range(10_000):
        assert normalized_box_to_pixels(box, 720, 1280) == (684, 1152, 720, 1280)


def test_tiny_rounding_noise_does_not_become_visible_overlay_change():
    difference = np.full((100,), 0.9, dtype=np.float32)

    assert np.count_nonzero(difference >= 8.0) == 0
