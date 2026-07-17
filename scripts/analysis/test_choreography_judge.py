import unittest
import numpy as np

from choreography_judge import Track, score


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

    def test_low_visibility_abstains(self):
        result = score(fixture(), fixture(missing=True))
        self.assertEqual(result["status"], "abstained")
        self.assertIn("low_joint_visibility", result["limitations"])

    def test_group_count_affects_formation(self):
        result = score(fixture(people=2), fixture(people=1))
        self.assertLess(result["scores"]["formation"], 75)

    def test_attempt_can_match_reference_subsequence(self):
        reference = fixture(frames=180)
        attempt = Track(reference.times[55:145] - reference.times[55], reference.poses[55:145].copy())
        result = score(reference, attempt)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["measurements"]["alignmentMode"], "subsequence")
        self.assertAlmostEqual(result["measurements"]["referenceWindow"]["startSeconds"], reference.times[55], delta=.35)
        self.assertGreater(result["overall"], 90)


if __name__ == "__main__":
    unittest.main()
