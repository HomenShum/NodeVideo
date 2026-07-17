import unittest

import numpy as np

from generate_practice_guide import find_hits, find_holds, snap_to_grid


def energy_fixture(frames=300, fps=15.0):
    """Steady groove with two sharp pops, one freeze, and tracking gaps."""
    times = np.arange(frames) / fps
    energy = np.full(frames, 0.02)
    energy[75] = 0.09   # sharp pop at 5.0s
    energy[76] = 0.03
    energy[150:160] = 0.003  # freeze 10.0-10.6s
    energy[225] = 0.08  # second pop at 15.0s
    energy[40:44] = np.nan   # tracking gap must not crash or fabricate
    return times, energy


class GuideTests(unittest.TestCase):
    def test_pops_are_detected_at_the_right_moments(self):
        times, energy = energy_fixture()
        hits = find_hits(times, energy, beat_period=0.5)
        hit_times = [h["timeSeconds"] for h in hits]
        self.assertTrue(any(abs(t - 5.0) < 0.1 for t in hit_times), hit_times)
        self.assertTrue(any(abs(t - 15.0) < 0.1 for t in hit_times), hit_times)

    def test_freeze_is_a_hold_not_a_hit(self):
        times, energy = energy_fixture()
        holds = find_holds(times, energy)
        self.assertTrue(any(abs(h["startSeconds"] - 10.0) < 0.2 for h in holds), holds)
        hits = find_hits(times, energy, beat_period=0.5)
        self.assertFalse(any(10.0 <= h["timeSeconds"] <= 10.6 for h in hits))

    def test_flat_motion_yields_no_fabricated_accents(self):
        times = np.arange(300) / 15.0
        flat = np.full(300, 0.02)
        self.assertEqual(find_hits(times, flat, beat_period=0.5), [])
        self.assertEqual(find_holds(times, flat), [])

    def test_snap_reports_count_and_offbeat_honestly(self):
        beats = np.arange(0, 20, 0.5)  # 120 BPM
        on = snap_to_grid(4.01, beats)
        self.assertEqual(on["snappedSeconds"], 4.0)
        self.assertFalse(on["offBeat"])
        between = snap_to_grid(4.13, beats)
        self.assertTrue(between["offBeat"] or between["snappedSeconds"] in (4.0, 4.25))

    def test_counts_cycle_one_through_eight(self):
        beats = np.arange(0, 20, 0.5)
        counts = [snap_to_grid(t, beats)["count"] for t in np.arange(0, 4.0, 0.5)]
        self.assertEqual(counts, [1, 2, 3, 4, 5, 6, 7, 8])


if __name__ == "__main__":
    unittest.main()
