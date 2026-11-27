import unittest

import pandas as pd

from nflboard.breakout import build_breakout


def stats_row(pid, name, pos, week, targets, carries, rush=20, rec=20):
    return {
        "player_id": pid, "player_display_name": name, "position": pos, "season": 2026, "week": week,
        "season_type": "REG", "game_id": f"2026_{week}", "team": "BUF", "opponent_team": "MIA",
        "attempts": 0, "passing_yards": 0, "passing_tds": 0, "carries": carries, "rushing_yards": rush,
        "rushing_tds": 0, "receptions": 3, "targets": targets, "receiving_yards": rec, "receiving_tds": 0,
    }


class BreakoutTest(unittest.TestCase):
    def test_only_running_backs_are_ranked(self):
        rows = []
        snaps = []
        plays = []
        for week in range(1, 6):
            rows.append(stats_row("rb", "Goal Line Back", "RB", week, targets=2, carries=8 + week, rush=40 + week * 5))
            rows.append(stats_row("wr", "Wideout", "WR", week, targets=8, carries=0, rush=0, rec=70))
            snaps.append({"player": "Goal Line Back", "team": "BUF", "week": week, "offense_snaps": 20 + week * 5, "offense_pct": 0.3 + week * 0.1})
            plays.append({"season_type": "REG", "week": week, "posteam": "BUF", "yardline_100": 8, "rush_attempt": 1, "pass_attempt": 0, "rusher_player_id": "rb", "receiver_player_id": None})
            plays.append({"season_type": "REG", "week": week, "posteam": "BUF", "yardline_100": 35, "rush_attempt": 1, "pass_attempt": 0, "rusher_player_id": "other", "receiver_player_id": None})
        schedule = pd.DataFrame([
            {"season": 2026, "game_type": "REG", "week": week, "away_team": "BUF", "home_team": "MIA",
             "away_score": 24 if week < 6 else None, "home_score": 17 if week < 6 else None,
             "gameday": "2026-09-07", "gametime": "13:00"}
            for week in range(1, 7)
        ])
        payload = build_breakout(pd.DataFrame(rows), schedule, pd.DataFrame(plays), pd.DataFrame(snaps), 2026, 6)
        names = [row["name"] for row in payload["candidates"]]
        self.assertIn("Goal Line Back", names)
        self.assertTrue(all(row["position"] == "RB" for row in payload["players"]))
        self.assertNotIn("Wideout", names)
        self.assertTrue(any(row["name"] == "Wideout" and row["ranked"] is False for row in payload["unvalidated"]))
        scored = next(row for row in payload["candidates"] if row["name"] == "Goal Line Back")
        self.assertGreaterEqual(scored["score"], 3)
        self.assertGreaterEqual(scored["signals"]["redZoneShare"], 0.2)

    def test_a_future_week_does_not_change_the_score(self):
        rows = [stats_row("rb", "Goal Line Back", "RB", week, 2, 10, 40) for week in range(1, 6)]
        future = rows + [stats_row("rb", "Goal Line Back", "RB", 6, 12, 25, 180)]
        schedule = pd.DataFrame([
            {"season": 2026, "game_type": "REG", "week": week, "away_team": "BUF", "home_team": "MIA",
             "away_score": 20 if week < 6 else None, "home_score": 17 if week < 6 else None,
             "gameday": "2026-09-07", "gametime": "13:00"}
            for week in range(1, 7)
        ])
        holds = build_breakout(pd.DataFrame(rows), schedule, None, None, 2026, 6)
        leaked = build_breakout(pd.DataFrame(future), schedule, None, None, 2026, 6)
        self.assertEqual(holds["players"][0]["signals"]["opportunitiesRising"], leaked["players"][0]["signals"]["opportunitiesRising"])


if __name__ == "__main__":
    unittest.main()
