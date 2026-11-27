import math
import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nflboard.logic import (  # noqa: E402
    add_rollups,
    bounded_scale,
    build_week,
    display_scale,
    game_has_price,
    poisson_at_least,
    role_tables,
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


def _back(pid, name, weeks, carries, targets):
    return {
        "id": pid, "name": name, "pos": "RB", "team": "BUF",
        "carries": float(sum(carries)), "targets": float(targets * len(weeks)),
        "weeks": weeks, "series": {"carries": carries},
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

    def test_tier_and_band_scales_stay_inside_ten_percent_and_roll_forward(self):
        self.assertEqual(display_scale(0.4, "confident", {"tiers": {"confident": 1.2}, "bands": [{"lo": 0.2, "hi": 0.6, "scale": 1.2}]}), 1.1)
        self.assertEqual(display_scale(0.4, "confident", None), 1.0)
        rolled = add_rollups(
            {"weeks": [11], "byStat": {"RB:rushYds": {"n": 10, "sumPred": 100, "sumActual": 90, "sumAbs": 20}}, "tiers": {"confident": {"n": 4, "hits": 2, "sumPred": 2}}, "bands": [{"lo": 0, "hi": 0.2, "n": 3, "hits": 1, "sumPred": 0.4}]},
            {"weeks": [12], "byStat": {"RB:rushYds": {"n": 5, "sumPred": 40, "sumActual": 50, "sumAbs": 12}}, "tiers": {"confident": {"n": 2, "hits": 2, "sumPred": 1}}, "bands": [{"lo": 0, "hi": 0.2, "n": 1, "hits": 0, "sumPred": 0.1}]},
        )
        self.assertEqual(rolled["weeks"], [11, 12])
        self.assertEqual(rolled["byStat"]["RB:rushYds"]["n"], 15)
        self.assertEqual(rolled["tiers"]["confident"]["hits"], 4)

    def test_rb_carry_share_uses_the_full_season_weighted_toward_recent_games(self):
        # Early fades and Late takes over. The old table kept only weeks 3–6.
        weeks = [1, 2, 3, 4, 5, 6]
        early = [20, 18, 10, 8, 6, 4]
        late = [2, 4, 10, 12, 14, 16]
        players = [
            _back("e", "Early Back", weeks, early, targets=2),
            _back("l", "Late Back", weeks, late, targets=8),
            {"id": "w", "name": "Wide Out", "pos": "WR", "team": "BUF", "carries": 0, "targets": 10,
             "weeks": weeks, "series": {"carries": [0] * 6}, "avg": {"recYds": 40}},
        ]
        stats = pd.DataFrame([{"team": "BUF", "week": week} for week in weeks])
        _rb, usage, wr = role_tables(players, stats, None)
        by_name = {row["name"]: row for row in usage}
        weights = [2 ** (-(len(weeks) - 1 - index) / 3) for index in range(len(weeks))]
        early_w = sum(carries * weight for carries, weight in zip(early, weights))
        late_w = sum(carries * weight for carries, weight in zip(late, weights))
        total = early_w + late_w
        last4_early = sum(early[-4:]) / (sum(early[-4:]) + sum(late[-4:]))
        plain_early = sum(early) / (sum(early) + sum(late))
        self.assertEqual(by_name["Early Back"]["seasonCarryShare"], round(early_w / total, 2))
        self.assertEqual(by_name["Late Back"]["seasonCarryShare"], round(late_w / total, 2))
        self.assertNotEqual(by_name["Early Back"]["seasonCarryShare"], round(last4_early, 2))
        self.assertNotEqual(by_name["Early Back"]["seasonCarryShare"], round(plain_early, 2))
        self.assertNotIn("recentCarryShare", by_name["Early Back"])
        self.assertAlmostEqual(
            by_name["Early Back"]["seasonCarryShare"] + by_name["Late Back"]["seasonCarryShare"],
            1.0,
            places=2,
        )
        roles = {row["name"]: row["primary"] for row in _rb}
        self.assertEqual(roles["Late Back"], "Workhorse")
        self.assertEqual(roles["Early Back"], "Committee")
        self.assertEqual(wr, [{"team": "Buffalo Bills", "name": "Wide Out", "rank": "WR1", "slot": None, "alignment": "", "side": ""}])
        # A bye is not a game, and a missed week counts as zero carries that week.
        skipped = [1, 2, 4, 5, 6, 7]
        partial = [
            _back("a", "Alpha", skipped, [10, 10, 10, 10, 10, 10], targets=1),
            _back("b", "Bravo", [4, 5, 6, 7], [0, 0, 0, 30], targets=1),
        ]
        partial_stats = pd.DataFrame([{"team": "BUF", "week": week} for week in skipped])
        _, partial_usage, _ = role_tables(partial, partial_stats, None)
        partial_by = {row["name"]: row["seasonCarryShare"] for row in partial_usage}
        skipped_weights = [2 ** (-(len(skipped) - 1 - index) / 3) for index in range(len(skipped))]
        alpha_w = 10 * sum(skipped_weights)
        bravo_w = 30 * skipped_weights[-1]
        self.assertEqual(partial_by["Alpha"], round(alpha_w / (alpha_w + bravo_w), 2))
        self.assertGreater(partial_by["Bravo"], 0)

    def test_tuesday_targets_the_open_week_only(self):
        _, schedule = frames()
        tuesday = datetime(2026, 11, 3, 7, 0, tzinfo=ZoneInfo("America/New_York"))
        friday = datetime(2026, 11, 6, 7, 0, tzinfo=ZoneInfo("America/New_York"))
        self.assertEqual(select_weeks(schedule, 2026, tuesday)["targets"], [5])
        self.assertEqual(select_weeks(schedule, 2026, friday)["targets"], [5])


if __name__ == "__main__":
    unittest.main()
