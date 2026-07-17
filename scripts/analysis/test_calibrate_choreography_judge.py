import unittest
from pathlib import Path

from calibrate_choreography_judge import analyze_results, validate_manifest


def clip(identifier: str, sha: str, family: str) -> dict:
    return {
        "id": identifier,
        "track": f"{identifier}.npz",
        "mediaSha256": sha * 64,
        "choreographyFamily": family,
        "productionFamily": identifier,
    }


def pair(identifier: str, reference: str, attempt: str, expected: str,
         group: str = "group-1", independence: str = "independent") -> dict:
    return {
        "id": identifier,
        "reference": reference,
        "attempt": attempt,
        "expected": expected,
        "independence": independence,
        "caseGroup": group,
        "labelSource": "fixture provenance",
    }


class CalibrationTests(unittest.TestCase):
    def test_rejects_self_comparison_by_media_hash(self):
        manifest = {
            "schemaVersion": "nodevideo.choreography-calibration-manifest.v1",
            "clips": [clip("a", "a", "dance"), clip("b", "a", "dance")],
            "pairs": [pair("same", "a", "b", "same-choreography")],
        }
        with self.assertRaisesRegex(ValueError, "self-comparison"):
            validate_manifest(manifest, Path.cwd(), require_tracks=False)

    def test_rejects_label_that_conflicts_with_provenance(self):
        manifest = {
            "schemaVersion": "nodevideo.choreography-calibration-manifest.v1",
            "clips": [clip("a", "a", "dance-a"), clip("b", "b", "dance-b")],
            "pairs": [pair("wrong", "a", "b", "same-choreography")],
        }
        with self.assertRaisesRegex(ValueError, "conflicts"):
            validate_manifest(manifest, Path.cwd(), require_tracks=False)

    def test_rejects_independence_claim_within_one_production(self):
        left, right = clip("a", "a", "dance"), clip("b", "b", "dance")
        right["productionFamily"] = left["productionFamily"]
        manifest = {
            "schemaVersion": "nodevideo.choreography-calibration-manifest.v1",
            "clips": [left, right],
            "pairs": [pair("dependent", "a", "b", "same-choreography")],
        }
        with self.assertRaisesRegex(ValueError, "cannot be independent"):
            validate_manifest(manifest, Path.cwd(), require_tracks=False)

    def test_withholds_threshold_when_case_groups_are_not_diverse(self):
        pairs = [pair(f"p{i}", "a", "b", "same-choreography") for i in range(5)]
        pairs += [pair(f"n{i}", "a", "c", "different-choreography", "negative-1") for i in range(5)]
        results = {item["id"]: {"status": "completed", "overall": 80 if item["id"][0] == "p" else 30}
                   for item in pairs}
        analysis = analyze_results({"pairs": pairs}, results)
        self.assertEqual(analysis["status"], "insufficient-independent-evidence")
        self.assertIsNone(analysis["publishedThreshold"])
        self.assertFalse(analysis["exploratoryCandidate"]["usableForProductDecisions"])

    def test_publishes_only_after_pair_and_group_minimums(self):
        pairs = []
        results = {}
        for prefix, expected, value in (("p", "same-choreography", 80),
                                        ("n", "different-choreography", 30)):
            for index in range(6):
                item = pair(f"{prefix}{index}", "a", "b", expected, f"{prefix}-group-{index % 3}")
                pairs.append(item)
                results[item["id"]] = {"status": "completed", "overall": value + index}
        analysis = analyze_results({"pairs": pairs}, results)
        self.assertEqual(analysis["status"], "publishable")
        self.assertTrue(analysis["scoreBandsPublished"])
        self.assertGreater(analysis["publishedThreshold"], 35)
        self.assertLess(analysis["publishedThreshold"], 80)


if __name__ == "__main__":
    unittest.main()
