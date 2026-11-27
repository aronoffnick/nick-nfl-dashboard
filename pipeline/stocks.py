#!/usr/bin/env python3
"""Write stat metrics for quarterbacks, backs, and receivers.

  python pipeline/stocks.py --season 2026 --week 13
  python pipeline/stocks.py --auto
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

from nflboard.fetch import paths_for  # noqa: E402
from nflboard.logic import select_weeks  # noqa: E402
from nflboard.stocks import build_stocks  # noqa: E402
from nflboard.store import data_dir, write_json  # noqa: E402

COLUMNS = [
    "player_id", "player_display_name", "position", "season", "week", "season_type", "game_id",
    "team", "opponent_team", "attempts", "passing_yards", "passing_tds", "passing_interceptions",
    "carries", "rushing_yards", "rushing_tds", "receptions", "targets", "receiving_yards",
    "receiving_tds", "fantasy_points",
]


def load(season: int, root: Path, cache: Path | None):
    files = paths_for(season, root, cache)
    stats = pd.read_csv(files["stats"], usecols=lambda name: name in COLUMNS)
    schedule = pd.read_csv(files["games"])
    return stats, schedule


def write_week(root: Path, stats, schedule, season: int, week: int) -> Path:
    payload = build_stocks(stats, schedule, season, week)
    for player in payload["players"]:
        player.pop("weeks", None)
    path = data_dir(root) / f"stocks-wk{week}.json"
    write_json(path, payload)
    print(f"wrote {path.relative_to(root)} ({len(payload['players'])} players through week {payload['throughWeek']})")
    return path


def main():
    parser = argparse.ArgumentParser(description="Write stat metrics for an NFL week")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--week", type=int)
    parser.add_argument("--auto", action="store_true")
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    if not args.week and not args.auto:
        parser.error("pass --week or --auto")
    root = args.root.resolve()
    stats, schedule = load(args.season, root, args.cache)
    if args.auto:
        plan = select_weeks(schedule, args.season)
        weeks = plan["targets"]
        print(f"auto {plan['weekday']}: weeks {weeks}")
    else:
        weeks = [args.week]
    for week in weeks:
        write_week(root, stats, schedule, args.season, week)
    print(json.dumps({"season": args.season, "weeks": weeks}))


if __name__ == "__main__":
    main()
