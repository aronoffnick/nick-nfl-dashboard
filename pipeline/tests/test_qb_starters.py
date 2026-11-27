import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nflboard.qb_starters import scale_projection, starter_for  # noqa: E402


class QbStarterTest(unittest.TestCase):
    def test_an_override_carries_forward_until_a_later_week_replaces_it(self):
        payload = {
            "weeks": {
                "12": {"PIT": {"season": 2026, "team": "PIT", "qb": "Mason Rudolph", "efficiency": 0.9305}},
                "15": {"PIT": {"season": 2026, "team": "PIT", "qb": "Next Passer", "efficiency": 1}},
            }
        }
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "qb_starters.json"
            path.write_text(json.dumps(payload))
            self.assertIsNone(starter_for(2026, 11, "PIT", path))
            self.assertEqual(starter_for(2026, 12, "PIT", path)["qb"], "Mason Rudolph")
            self.assertEqual(starter_for(2026, 14, "PIT", path)["qb"], "Mason Rudolph")
            self.assertEqual(starter_for(2026, 15, "PIT", path)["qb"], "Next Passer")
            self.assertEqual(starter_for(2026, 16, "PIT", path)["qb"], "Next Passer")
            self.assertIsNone(starter_for(2026, 16, "HOU", path))

    def test_pass_yards_use_this_opponents_defense_factor(self):
        spec = {"team": "PIT", "qb": "Mason Rudolph", "passYdsBeforeDefense": 242.9, "passYds": 252.6, "defenseFactor": 1.04, "efficiency": 0.9305}
        updated = scale_projection(
            {"team": "PIT", "pos": "QB", "name": "Mason Rudolph"},
            {"passYds": [224.1, 234.9, 1.05]},
            spec,
        )
        self.assertEqual(updated["passYds"], [242.9, 255.0, 1.05])
        catcher = scale_projection(
            {"team": "PIT", "pos": "WR", "name": "DK Metcalf"},
            {"recYds": [43.4, 47.5, 1.11], "td": [0.2, 0.2, 0.99]},
            spec,
        )
        self.assertEqual(catcher["recYds"][1], round(47.5 * 0.9305, 1))
        self.assertEqual(catcher["td"][1], round(0.2 * 0.9305, 2))
