import unittest

from team_odds import close_odds, parse_board


class TeamOddsTest(unittest.TestCase):
    def test_close_odds_and_unstarted_games_only(self):
        self.assertEqual(close_odds({"away": {"close": {"odds": "-110"}}}, "away"), -110)
        self.assertIsNone(close_odds({}, "home"))
        board = {"events": [
            {"competitions": [{
                "status": {"type": {"state": "post"}},
                "competitors": [
                    {"homeAway": "away", "team": {"abbreviation": "GB"}},
                    {"homeAway": "home", "team": {"abbreviation": "LAR"}},
                ],
                "odds": [{"spread": -3.5, "provider": {"displayName": "DraftKings"},
                          "moneyline": {"away": {"close": {"odds": "+150"}}, "home": {"close": {"odds": "-170"}}},
                          "pointSpread": {"away": {"close": {"odds": "-110"}}, "home": {"close": {"odds": "-110"}}}}],
            }]},
            {"competitions": [{
                "status": {"type": {"state": "pre"}},
                "competitors": [
                    {"homeAway": "away", "team": {"abbreviation": "WSH"}},
                    {"homeAway": "home", "team": {"abbreviation": "ARI"}},
                ],
                "odds": [{"spread": 2.5, "provider": {"displayName": "DraftKings"},
                          "moneyline": {"away": {"close": {"odds": "+120"}}, "home": {"close": {"odds": "-140"}}},
                          "pointSpread": {"away": {"close": {"odds": "-105"}}, "home": {"close": {"odds": "-115"}}}}],
            }]},
        ]}
        parsed = parse_board(board, 2026, 12, "Nov 27, 2:00 PM ET")
        self.assertEqual(list(parsed["games"]), ["WAS-ARI"])
        game = parsed["games"]["WAS-ARI"]
        self.assertEqual(game["moneyline"]["WAS"]["price"], 120)
        self.assertEqual(game["spread"]["homeLine"], 2.5)
        self.assertEqual(game["spread"]["ARI"]["line"], 2.5)
        self.assertEqual(game["source"], "ESPN scoreboard odds")


if __name__ == "__main__":
    unittest.main()
