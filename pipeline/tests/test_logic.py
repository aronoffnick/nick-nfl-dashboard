import math
import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nflboard.logic import (  # noqa: E402
    bounded_scale,
    build_week,
    game_has_price,
    poisson_at_least,
    score_week,
    select_weeks,
    shrink_factor,
)
from datetime import datetime
from zoneinfo import ZoneInfo


def frames():
    stats = pd.DataFrame([
        _row("p1", "Alpha Back", "RB", "BUF", "MIA", 1, carries=20, rush_yds=100, rush_td=1, targets=4, rec=3, rec_yds=30),
        _row("p1", "Alpha Back", "RB", "BUF", "MIA", 2, carries=18, rush_yds=80, rush_td=1, targets=5, rec=4, rec_yds=40),
        _row("p1", "Alpha Back", "RB", "BUF", "MIA", 3, carries=16, rush_yds=90, rush_td=0, targets=4, rec=3, rec_yds=20),
        _row("p1", "Alpha Back", "RB", "BUF", "MIA", 4, carries=22, rush_yds=110, rush_td=1, targets=3, rec=2, rec_yds=15),
        _row("p2", "Beta Wide", "WR", "BUF", "MIA", 1, targets=8, rec=5, rec_yds=70, rec_td=1),
        _row("p2", "Beta Wide", "WR", "BUF", "MIA", 2, targets=9, rec=6, rec_yds=80, rec_td=0),
        _row("p2", "Beta Wide", "WR", "BUF", "MIA", 3, targets=7, rec=4, rec_yds=50, rec_td=1),
        _row("p2", "Beta Wide", "WR", "BUF", "MIA", 4, targets=8, rec=5, rec_yds=60, rec_td=0),
        _row("q1", "Gamma Back", "RB", "MIA", "BUF", 1, carries=15, rush_yds=60, rush_td=0, targets=2, rec=2, rec_yds=10),
        _row("q1", "Gamma Back", "RB", "MIA", "BUF", 2, carries=14, rush_yds=55, rush_td=1, targets=2, rec=1, rec_yds=8),
        _row("q1", "Gamma Back", "RB", "MIA", "BUF", 3, carries=12, rush_yds=40, rush_td=0, targets=3, rec=2, rec_yds=12),
        _row("q1", "Gamma Back", "RB", "MIA", "BUF", 4, carries=16, rush_yds=70, rush_td=1, targets=1, rec=1, rec_yds=5),
        _row("qb", "Delta Passer", "QB", "BUF", "MIA", 1, attempts=30, pass_yds=250, pass_td=2, carries=4, rush_yds=20, rush_td=0),
        _row("qb", "Delta Passer", "QB", "BUF", "MIA", 2, attempts=28, pass_yds=240, pass_td=1, carries=3, rush_yds=10, rush_td=1),
        _row("qb", "Delta Passer", "QB", "BUF", "MIA", 3, attempts=32, pass_yds=260, pass_td=2, carries=5, rush_yds=25, rush_td=0),
        _row("qb", "Delta Passer", "QB", "BUF", "MIA", 4, attempts=30, pass_yds=230, pass_td=1, carries=2, rush_yds=8, rush_td=0),
    ])
    schedule = pd.DataFrame([
        _game(1, "BUF", "MIA", 24, 17),
        _game(2, "MIA", "BUF", 20, 21),
        _game(3, "BUF", "MIA", 28, 14),
        _game(4, "MIA", "BUF", 10, 27),
        _game(5, "BUF", "MIA", None, None),
    ])
    return stats, schedule


def _row(pid, name, pos, team, opp, week, **stats):
    return {
        "player_id": pid, "player_display_name": name, "position": pos, "season": 2026, "week": week,
        "season_type": "REG", "game_id": f"g{week}", "team": team, "opponent_team": opp,
        "attempts": stats.get("attempts", 0), "passing_yards": stats.get("pass_yds", 0), "passing_tds": stats.get("pass_td", 0),
        "carries": stats.get("carries", 0), "rushing_yards": stats.get("rush_yds", 0), "rushing_tds": stats.get("rush_td", 0),
        "receptions": stats.get("rec", 0), "targets": stats.get("targets", 0), "receiving_yards": stats.get("rec_yds", 0),
        "receiving_tds": stats.get("rec_td", 0),
    }


def _game(week, away, home, away_score, home_score):
    return {
        "season": 2026, "game_type": "REG", "week": week, "gameday": f"2026-10-{week:02d}", "gametime": "13:00",
        "weekday": "Sunday", "away_team": away, "home_team": home, "away_score": away_score, "home_score": home_score,
        "espn": 1000 + week,
    }


class LogicTest(unittest.TestCase):
    def test_shrink_and_scale_stay_inside_bounds(self):
        self.assertAlmostEqual(shrink_factor(100, 4, 25), 1.0, places=6)
        self.assertEqual(shrink_factor(0, 0, 25), None)
        self.assertEqual(shrink_factor(10000, 4, 10), 1.35)
        self.assertEqual(bounded_scale(2, 1000), 1.1)
        self.assertEqual(bounded_scale(0.1, 1000), 0.9)
        self.assertEqual(bounded_scale(1.2, 0), 1.0)
        self.assertAlmostEqual(poisson_at_least(0.5, 1), 1 - math.exp(-0.5))

    def test_week_build_has_a_game_and_blank_prices(self):
        stats, schedule = frames()
        bundle = build_week(stats, schedule, None, 2026, 5, {})
        self.assertEqual(bundle["slate"], ["BUF@MIA"])
        game = bundle["td"]["games"][0]
        self.assertEqual(game["key"], "BUF@MIA")
        pick = game["sides"][0]["rows"][0]["confident"]
        self.assertIsNone(pick["price"])
        self.assertIsNone(pick["book"])
        self.assertGreater(pick["modelProb"], 0)
        parlay = bundle["parlays"]["games"]["BUF-MIA"]
        self.assertTrue(parlay["legs"])
        self.assertTrue(all(leg["price"] is None and leg["priced"] is False for leg in parlay["legs"]))
        self.assertTrue(parlay["safe_overlap_cards"])
        self.assertIsNone(bundle["coverage"]["games"]["BUF-MIA"]["offenses"]["BUF"]["mix"])
        alpha = next(player for player in bundle["scatter"]["games"]["BUF-MIA"]["players"] if player["n"] == "Alpha Back")
        self.assertEqual(alpha["t"], "BUF")
        self.assertGreater(alpha["s"]["rushYds"][0], 0)
        self.assertIsNotNone(alpha["s"]["rushYds"][1])

    def test_learning_scale_moves_the_next_projection_and_stops_at_ten_percent(self):
        stats, schedule = frames()
        base = build_week(stats, schedule, None, 2026, 5, {})
        boosted = build_week(stats, schedule, None, 2026, 5, {"projection": {"RB": {"rushYds": 1.5}}, "tdLambda": {"RB": 1.5}})
        base_y = next(p for p in base["scatter"]["games"]["BUF-MIA"]["players"] if p["n"] == "Alpha Back")["s"]["rushYds"][1]
        next_y = next(p for p in boosted["scatter"]["games"]["BUF-MIA"]["players"] if p["n"] == "Alpha Back")["s"]["rushYds"][1]
        self.assertAlmostEqual(next_y, round(base_y * 1.1, 1))

    def test_priced_games_are_detectable_and_blank_games_are_not(self):
        self.assertFalse(game_has_price({"legs": [{"price": None, "priced": False}]}))
        self.assertTrue(game_has_price({"legs": [{"price": -110, "priced": True}]}))
        self.assertTrue(game_has_price({"sides": [{"rows": [{"confident": {"price": "+140"}}]}]}))

    def test_score_week_reports_a_real_result_and_a_bounded_scale(self):
        stats, schedule = frames()
        bundle = build_week(stats, schedule, None, 2026, 4, {})
        # Week 4 is already final in the fixture, so scoring it is an in-sample check of the math.
        report = score_week(bundle["scatter"], bundle["td"], bundle["coverage"], {}, [], stats, schedule, 2026, 4, partial_prior=1)
        self.assertEqual(report["gamesScored"], 1)
        self.assertGreater(report["touchdowns"]["anytime"]["n"], 0)
        self.assertTrue(report["lines"])
        for pos, stats_map in report["adjustments"]["projection"].items():
            for value in stats_map.values():
                self.assertGreaterEqual(value, 0.9)
                self.assertLessEqual(value, 1.1)
        for value in report["adjustments"]["tdLambda"].values():
            self.assertGreaterEqual(value, 0.9)
            self.assertLessEqual(value, 1.1)

    def test_tuesday_targets_the_open_week_only(self):
        _, schedule = frames()
        tuesday = datetime(2026, 11, 3, 7, 0, tzinfo=ZoneInfo("America/New_York"))
        friday = datetime(2026, 11, 6, 7, 0, tzinfo=ZoneInfo("America/New_York"))
        self.assertEqual(select_weeks(schedule, 2026, tuesday)["targets"], [5])
        self.assertEqual(select_weeks(schedule, 2026, friday)["targets"], [5])


if __name__ == "__main__":
    unittest.main()
