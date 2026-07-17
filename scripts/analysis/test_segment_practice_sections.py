import unittest

import numpy as np

from segment_practice_sections import build_sections, snap_to_landing


def dancer_fixture(frames=600, fps=15.0, hide=None):
    """Solo dancer with a hit-and-hold every 16 frames (landing = low motion)."""
    times = np.arange(frames) / fps
    poses = np.full((frames, 2, 33, 4), np.nan, dtype=np.float32)
    for frame, t in enumerate(times):
        # Motion pauses (landing) on every 16th frame.
        amplitude = 0.02 if frame % 16 == 0 else 0.15
        for landmark in range(33):
            x = 0.5 + amplitude * np.sin(t * 5 + landmark * 0.2)
            y = 0.5 + amplitude * np.cos(t * 4 + landmark * 0.15)
            poses[frame, 0, landmark] = (x, y, 0, 0.95)
    if hide is not None:
        poses[hide, 0] = np.nan
    return times, poses


class SectionTests(unittest.TestCase):
    def setUp(self):
        self.times, self.poses = dancer_fixture()
        # 120 BPM: beat every 0.5s over 40s.
        self.beats = np.arange(0, 40, 0.5)

    def test_sections_are_eight_count_blocks_in_order(self):
        sections = build_sections(self.beats, self.times, self.poses, 0)
        self.assertGreaterEqual(len(sections), 8)
        for before, after in zip(sections, sections[1:]):
            self.assertEqual(before["endSeconds"], after["startSeconds"])
        # 8 counts at 120 BPM = 4s nominal; snapping may shift ±0.3s.
        widths = [s["endSeconds"] - s["startSeconds"] for s in sections]
        self.assertTrue(all(3.0 <= w <= 5.0 for w in widths), widths)

    def test_boundary_snaps_to_motion_minimum(self):
        energy = np.where(np.arange(600) % 16 == 0, 0.001, 0.05).astype(float)
        # Window 9.3–10.1s covers frames 140–151; landing frame 144 (9.6s)
        # is the unique energy minimum inside it.
        snapped = snap_to_landing(9.7, self.times, energy, tolerance=0.4)
        frame = int(round(snapped * 15))
        self.assertEqual(frame, 144)

    def test_low_visibility_section_is_watch_only(self):
        times, poses = dancer_fixture(hide=slice(150, 300))
        sections = build_sections(self.beats, times, poses, 0)
        hidden = [s for s in sections if s["startSeconds"] >= 10.0 and s["endSeconds"] <= 20.0]
        self.assertTrue(hidden)
        self.assertTrue(all(not s["practiceReady"] for s in hidden))
        visible = [s for s in sections if s["endSeconds"] <= 9.5]
        self.assertTrue(any(s["practiceReady"] for s in visible))

    def test_fully_hidden_reference_degrades_to_beat_timing_not_silence(self):
        # A learner running the whole video must still get feedback where the
        # reference is unusable: music-relative timing needs no reference pose.
        times, poses = dancer_fixture(hide=slice(150, 300))
        sections = build_sections(self.beats, times, poses, 0)
        hidden = [s for s in sections if s["startSeconds"] >= 10.5 and s["endSeconds"] <= 19.5]
        self.assertTrue(hidden)
        for section in hidden:
            self.assertEqual(section["feedbackTier"], "beat-timing")
            self.assertEqual(section["feedbackSignals"], ["beatTiming"])
            self.assertIn("referenceForm", section["unverified"])

    def test_cropped_legs_degrade_to_upper_body_feedback(self):
        times, poses = dancer_fixture()
        # Feet/knees out of frame for 150-300, upper body still tracked.
        from segment_practice_sections import LOWER_BODY

        for joint in LOWER_BODY:
            poses[150:300, 0, joint] = np.nan
        sections = build_sections(self.beats, times, poses, 0)
        cropped = [s for s in sections if s["startSeconds"] >= 10.5 and s["endSeconds"] <= 19.5]
        self.assertTrue(cropped)
        for section in cropped:
            self.assertEqual(section["feedbackTier"], "partial-upper")
            self.assertIn("timing", section["feedbackSignals"])
            self.assertEqual(section["unverified"], ["lowerBody"])
        full = [s for s in sections if s["endSeconds"] <= 9.5]
        self.assertTrue(all(s["feedbackTier"] == "full" for s in full))

    def test_blurred_arms_degrade_to_lower_body_feedback(self):
        # The inverse crop: fast arm work blurs upper landmarks while
        # footwork tracks cleanly (observed on the lestwin reel).
        times, poses = dancer_fixture()
        from segment_practice_sections import UPPER_BODY

        for joint in UPPER_BODY:
            poses[150:300, 0, joint] = np.nan
        sections = build_sections(self.beats, times, poses, 0)
        blurred = [s for s in sections if s["startSeconds"] >= 10.5 and s["endSeconds"] <= 19.5]
        self.assertTrue(blurred)
        for section in blurred:
            self.assertEqual(section["feedbackTier"], "partial-lower")
            self.assertIn("lowerForm", section["feedbackSignals"])
            self.assertEqual(section["unverified"], ["upperBody"])
            self.assertTrue(section["practiceReady"])

    def test_difficulty_is_relative_and_bounded(self):
        sections = build_sections(self.beats, self.times, self.poses, 0)
        for section in sections:
            self.assertGreaterEqual(section["relativeDifficulty"], 0.0)
            self.assertLessEqual(section["relativeDifficulty"], 1.0)

    def test_too_few_beats_produces_no_sections(self):
        self.assertEqual(build_sections(np.arange(3, dtype=float), self.times, self.poses, 0), [])


if __name__ == "__main__":
    unittest.main()
