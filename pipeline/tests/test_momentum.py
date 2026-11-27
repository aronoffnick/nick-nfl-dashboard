import unittest

import pandas as pd

from nflboard.momentum import build_momentum, momentum_multiple, net_multiple, trend_z


def row(pid, name, pos, team, opp, week, rush=40, carries=10, targets=2, rec=1, rec_yds=8, attempts=0, pass_yds=0):
    return {
        "player_id": pid, "player_display_name": name, "position": pos, "season": 2026, "week": week,
        "season_type": "REG", "game_id": f"2026_{week}_{team}", "team": team, "opponent_team": opp,
        "attempts": attempts, "passing_yards": pass_yds, "passing_tds": 0, "carries": carries,
        "rushing_yards": rush, "rushing_tds": 0, "receptions": rec, "targets": targets,
        "receiving_yards": rec_yds, "receiving_tds": 0,
    }


def schedule(weeks=6):
    return pd.DataFrame([
        {"season": 2026, "game_type": "REG", "week": week, "away_team": "BUF", "home_team": "MIA",
         "away_score": 21, "home_score": 17, "gameday": "2026-09-07", "gametime": "13:00"}
        for week in range(1, weeks + 1)
    ])


class MomentumTest(unittest.TestCase):
    def test_recent_hot_streak_is_positive_and_capped(self):
        self.assertGreater(trend_z([10, 10, 10, 10, 30, 40]), 0)
        series = {"position": "RB", "rushYds": [10, 10, 10, 80, 90, 100], "ypc": [2, 2, 2, 6, 7, 8], "carries": [10, 10, 10, 14, 14, 14]}
        self.assertLessEqual(momentum_multiple(series), 1.05)
        self.assertGreater(momentum_multiple(series), 1)
        self.assertEqual(net_multiple(1.05, 1.05), 1.08)

    def test_the_scored_week_does_not_leak(self):
        rows = [row("rb", "Steady Back", "RB", "BUF", "MIA", week, rush=50) for week in range(1, 6)]
        slate = pd.concat([
            schedule(5),
            pd.DataFrame([{"season": 2026, "game_type": "REG", "week": 6, "away_team": "BUF", "home_team": "MIA",
                           "away_score": None, "home_score": None, "gameday": "2026-10-12", "gametime": "13:00"}]),
        ], ignore_index=True)
        quiet = build_momentum(pd.DataFrame(rows), slate, 2026, 6)
        boom = build_momentum(pd.DataFrame(rows + [row("rb", "Steady Back", "RB", "BUF", "MIA", 6, rush=400)]), slate, 2026, 6)
        before = next(player for player in quiet["players"] if player["name"] == "Steady Back")
        after = next(player for player in boom["players"] if player["name"] == "Steady Back")
        self.assertEqual(before["momentumMultiple"], after["momentumMultiple"])


if __name__ == "__main__":
    unittest.main()
