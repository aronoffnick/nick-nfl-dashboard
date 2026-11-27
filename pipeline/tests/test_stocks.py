import math
import unittest

import pandas as pd

from nflboard.stocks import build_stocks, projected_half_ppr, shrink_toward


def schedule(weeks=6):
    rows = []
    for week in range(1, weeks + 1):
        rows.append({
            "season": 2026, "game_type": "REG", "week": week,
            "away_team": "BUF", "home_team": "MIA",
            "away_score": 20 + week, "home_score": 17,
            "gameday": "2026-09-07", "gametime": "13:00",
        })
    return pd.DataFrame(rows)


def player(pid, name, pos, team, opp, week, rush=50, targets=3, rec=2, rec_yds=15, td=0, attempts=0, pass_yds=0, pass_td=0):
    return {
        "player_id": pid, "player_display_name": name, "position": pos, "season": 2026,
        "week": week, "season_type": "REG", "game_id": f"2026_{week}", "team": team, "opponent_team": opp,
        "attempts": attempts, "passing_yards": pass_yds, "passing_tds": pass_td, "passing_interceptions": 0,
        "carries": 10, "rushing_yards": rush, "rushing_tds": td, "receptions": rec,
        "targets": targets, "receiving_yards": rec_yds, "receiving_tds": 0,
        "fantasy_points": 0.1 * rush + 0.1 * rec_yds + 6 * td + 0.04 * pass_yds + 4 * pass_td,
    }


class StocksTest(unittest.TestCase):
    def test_projection_line_ignores_the_current_week(self):
        rows = []
        for week in range(1, 6):
            rows.append(player("rb", "Steady Back", "RB", "BUF", "MIA", week, rush=100))
        rows.append(player("rb", "Steady Back", "RB", "BUF", "MIA", 6, rush=400))
        rows.append(player("qb", "Passer", "QB", "BUF", "MIA", 1, rush=0, targets=0, rec=0, rec_yds=0, attempts=30, pass_yds=250, pass_td=2))
        payload = build_stocks(pd.DataFrame(rows), schedule(), 2026, 7)
        back = next(row for row in payload["players"] if row["name"] == "Steady Back")
        last = back["weeks"][-1]
        self.assertEqual(last["week"], 6)
        self.assertEqual(last["source"], "projection")
        self.assertLess(last["benchmark"], 20)
        self.assertGreater(last["excess"], 20)
        self.assertGreaterEqual(back["games"], 4)

    def test_short_samples_and_shrink(self):
        rows = []
        for week in range(1, 4):
            rows.append(player("short", "Short Back", "RB", "BUF", "MIA", week, rush=80))
        for week in range(1, 7):
            rows.append(player("long", "Long Back", "RB", "MIA", "BUF", week, rush=40))
        payload = build_stocks(pd.DataFrame(rows), schedule(), 2026, 7)
        names = {row["name"] for row in payload["players"]}
        self.assertNotIn("Short Back", names)
        long = next(row for row in payload["players"] if row["name"] == "Long Back")
        self.assertGreaterEqual(long["games"], 4)
        moved = shrink_toward(2, 4, 0)
        self.assertTrue(math.isclose(moved, 1.0))

    def test_half_ppr_from_the_projection(self):
        points = projected_half_ppr({"rushYds": [10, 100, 1], "rec": [1, 4, 1], "recYds": [5, 40, 1], "td": [0.1, 0.5, 1]})
        self.assertTrue(math.isclose(points, 0.1 * 100 + 0.1 * 40 + 0.5 * 4 + 6 * 0.5))


if __name__ == "__main__":
    unittest.main()
