import unittest
from unittest.mock import patch
import numpy as np

from choreography_judge import Track, collapse_solo_tracklets, score, select_performer_match


def fixture(frames=90, people=1, noisy=False, missing=False):
    times = np.arange(frames) / 15
    poses = np.full((frames, people, 33, 4), np.nan, dtype=np.float32)
    for frame, time in enumerate(times):
        for person in range(people):
            for landmark in range(33):
                x = .35 + person*.25 + .07*np.sin(time*3 + landmark*.1)
                y = .45 + .08*np.cos(time*2 + landmark*.13)
                if noisy: x += .035*np.sin(time*7 + landmark)
                poses[frame, person, landmark] = (x, y, 0, .1 if missing else .95)
    return Track(times, poses)


class JudgeTests(unittest.TestCase):
    def test_identical_tracks_score_high(self):
        result = score(fixture(), fixture())
        self.assertEqual(result["status"], "completed")
        self.assertGreater(result["overall"], 95)
        self.assertGreater(result["confidence"], .9)
        self.assertEqual(
            result["scoreInterpretation"],
            "relative-motion-signal-not-calibrated-pass-fail",
        )

    def test_low_visibility_abstains(self):
        result = score(fixture(), fixture(missing=True))
        self.assertEqual(result["status"], "abstained")
        self.assertIn("low_joint_visibility", result["limitations"])
        self.assertIn("measurements", result)
        self.assertIn("scoreBoundaries", result)

    def test_group_count_affects_formation(self):
        result = score(fixture(people=3), fixture(people=2))
        self.assertLess(result["scores"]["formation"], 80)

    def test_requested_empty_slots_do_not_dilute_solo_confidence(self):
        track = fixture(people=10)
        track.poses[:, 1:] = np.nan
        result = score(track, track)
        self.assertEqual(result["status"], "completed")
        self.assertGreater(result["confidence"], .9)
        self.assertEqual(result["measurements"]["comparisonMode"], "solo-focal-performer")
        self.assertNotIn("formation", result["scores"])

    def test_detector_order_swaps_are_stabilized(self):
        reference = fixture(people=2)
        scrambled = reference.poses.copy()
        scrambled[1::2] = scrambled[1::2, ::-1]
        result = score(reference, Track(reference.times, scrambled))
        self.assertEqual(result["status"], "completed")
        self.assertGreater(result["overall"], 95)

    def test_fragmented_solo_tracklets_collapse_to_one_performer(self):
        source = fixture(frames=90)
        poses = np.full((90, 4, 33, 4), np.nan, dtype=np.float32)
        for index in range(90):
            poses[index, index // 23] = source.poses[index, 0]
        collapsed = collapse_solo_tracklets(Track(source.times, poses))
        self.assertEqual(collapsed.poses.shape[1], 1)
        self.assertTrue(np.isfinite(collapsed.poses[:, 0, 0, 0]).all())

    def test_attempt_can_match_reference_subsequence(self):
        reference = fixture(frames=180)
        attempt = Track(reference.times[55:145] - reference.times[55], reference.poses[55:145].copy())
        result = score(reference, attempt)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["measurements"]["alignmentMode"], "subsequence")
        self.assertAlmostEqual(result["measurements"]["referenceWindow"]["startSeconds"], reference.times[55], delta=.35)
        self.assertGreater(result["overall"], 90)

    def test_equal_length_preroll_is_not_scored_as_timing_error(self):
        reference = fixture(frames=120)
        delay = 4
        delayed = np.concatenate([
            np.repeat(reference.poses[:1], delay, axis=0),
            reference.poses[:-delay],
        ])
        result = score(reference, Track(reference.times, delayed))
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["measurements"]["alignmentMode"], "pose-offset")
        self.assertAlmostEqual(result["measurements"]["attemptWindow"]["startSeconds"], delay / 15, delta=.2)
        self.assertGreater(result["scores"]["timing"], 90)

    def test_reference_duration_finds_take_inside_longer_upload(self):
        reference = fixture(frames=90)
        prefix = np.repeat(reference.poses[:1], 35, axis=0)
        attempt_poses = np.concatenate([prefix, reference.poses])
        attempt = Track(np.arange(len(attempt_poses)) / 15, attempt_poses)
        result = score(reference, attempt)
        self.assertEqual(
            result["measurements"]["attemptSegmentationMode"],
            "pose-window-from-reference-duration",
        )
        self.assertAlmostEqual(
            result["measurements"]["attemptCandidateWindow"]["startSeconds"],
            35 / 15,
            delta=1.1,
        )
        self.assertGreater(result["overall"], 90)

    def test_solo_attempt_selects_performer_from_group_before_alignment(self):
        reference = fixture(frames=120, people=3)
        delay = 4
        performer = reference.poses[:, 1:2]
        delayed = np.concatenate([np.repeat(performer[:1], delay, axis=0), performer[:-delay]])
        result = score(reference, Track(reference.times, delayed))
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["measurements"]["alignmentMode"], "pose-offset-dynamic")
        self.assertGreater(result["scores"]["timing"], 90)

    def test_static_attempt_does_not_score_as_a_pass(self):
        reference = fixture(frames=120)
        frozen = np.repeat(reference.poses[:1], 120, axis=0)
        result = score(reference, Track(reference.times, frozen))
        self.assertEqual(result["status"], "abstained")
        self.assertIsNone(result["overall"])
        self.assertIn("insufficient_attempt_motion", result["limitations"])
        self.assertIn("timing", result["unmeasurableScores"])
        self.assertIn("dynamics", result["unmeasurableScores"])
        self.assertNotIn("timing", result["scores"])
        self.assertNotIn("dynamics", result["scores"])

    def test_measurable_dynamics_still_reports_a_score(self):
        result = score(fixture(), fixture())
        self.assertEqual(result["status"], "completed")
        self.assertIn("dynamics", result["scores"])
        self.assertEqual(result["unmeasurableScores"], [])

    def test_long_group_reference_prunes_full_dtw_hypotheses(self):
        reference = fixture(frames=100, people=6)
        attempt = fixture(frames=40)
        with patch(
            "choreography_judge.align_tracks",
            return_value=([(0, 0)], .1, "subsequence"),
        ) as align:
            self.assertIsNotNone(select_performer_match(reference, attempt))
        self.assertEqual(align.call_count, 4)


if __name__ == "__main__":
    unittest.main()
