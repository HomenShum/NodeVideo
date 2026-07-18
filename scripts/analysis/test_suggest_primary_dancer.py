import unittest

import numpy as np

from suggest_primary_dancer import best_window, score_tracks


def cypher_fixture(frames=150, fps=15.0):
    """Synthetic cypher: one dancing performer center-frame, two static
    spectators at the edges, one flickering spectator, one empty slot."""
    times = np.arange(frames) / fps
    poses = np.full((frames, 5, 33, 4), np.nan, dtype=np.float32)
    for frame, t in enumerate(times):
        # Track 0: featured dancer — center, large, high motion.
        for landmark in range(33):
            x = 0.5 + 0.12 * np.sin(t * 4 + landmark * 0.2)
            y = 0.5 + 0.18 * np.cos(t * 3 + landmark * 0.15)
            poses[frame, 0, landmark] = (x, y, 0, 0.95)
        # Tracks 1-2: static edge spectators, smaller.
        for person, base_x in ((1, 0.12), (2, 0.88)):
            for landmark in range(33):
                poses[frame, person, landmark] = (
                    base_x + 0.02 * (landmark % 5) / 5,
                    0.4 + 0.05 * (landmark % 7) / 7,
                    0,
                    0.9,
                )
        # Track 3: spectator visible only in short flickers.
        if (frame // 10) % 3 == 0:
            for landmark in range(33):
                poses[frame, 3, landmark] = (0.3, 0.35 + 0.04 * (landmark % 6) / 6, 0, 0.85)
    return times, poses


class SuggestPrimaryTests(unittest.TestCase):
    def test_center_mover_beats_static_and_flickering_spectators(self):
        # Stabilized slot ids are internal identities — the fixture's input
        # slot 0 need not survive. Assert the winner by dancer traits instead.
        times, poses = cypher_fixture()
        candidates = score_tracks(times, poses)
        self.assertGreaterEqual(len(candidates), 3)
        winner = candidates[0]
        self.assertGreater(winner["signals"]["motion"], 0.5)
        self.assertGreater(winner["signals"]["centrality"], 0.7)
        self.assertGreater(winner["primaryScore"], candidates[1]["primaryScore"] + 0.1)

    def test_ranking_is_deterministic(self):
        times, poses = cypher_fixture()
        first = score_tracks(times, poses)
        second = score_tracks(times, poses)
        self.assertEqual(first, second)

    def test_best_window_prefers_visible_stretch(self):
        times, poses = cypher_fixture()
        # Hide the dancer for the first 40 frames — window must move past it.
        poses[:40, 0] = np.nan
        candidates = score_tracks(times, poses)
        movers = [c for c in candidates if c["signals"]["motion"] > 0.5]
        self.assertTrue(movers)
        window = best_window(times, poses, movers[0]["trackId"], seconds=3.0)
        self.assertIsNotNone(window)
        # The stabilizer may merge the appearing dancer with the flickering
        # spectator's slot across its gap tolerance, extending visibility a few
        # frames before frame 40 — assert the window skips the hidden stretch,
        # not an exact boundary.
        self.assertGreaterEqual(window["startSeconds"], times[29])
        self.assertGreaterEqual(window["visibility"], 0.95)

    def test_empty_and_sparse_tracks_are_excluded(self):
        times, poses = cypher_fixture()
        candidates = score_tracks(times, poses)
        track_ids = {candidate["trackId"] for candidate in candidates}
        self.assertNotIn(4, track_ids)  # never-visible slot


if __name__ == "__main__":
    unittest.main()
