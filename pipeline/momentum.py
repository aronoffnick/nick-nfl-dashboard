#!/usr/bin/env python3
"""Write momentum multiples for one week.

  python pipeline/momentum.py --season 2026 --week 13
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
from nflboard.momentum import build_momentum  # noqa: E402
from nflboard.store import data_dir, write_json  # noqa: E402

COLUMNS = [
    "player_id", "player_display_name", "position", "season", "week", "season_type", "game_id",
    "team", "opponent_team", "attempts", "passing_yards", "passing_tds",
    "carries", "rushing_yards", "rushing_tds", "receptions", "targets", "receiving_yards", "receiving_tds",
]


def main():
    parser = argparse.ArgumentParser(description="Write momentum multiples for an NFL week")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--week", type=int)
    parser.add_argument("--auto", action="store_true")
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    if not args.week and not args.auto:
        parser.error("pass --week or --auto")
    root = args.root.resolve()
    files = paths_for(args.season, root, args.cache)
    stats = pd.read_csv(files["stats"], usecols=lambda name: name in COLUMNS)
    schedule = pd.read_csv(files["games"])
    weeks = select_weeks(schedule, args.season)["targets"] if args.auto else [args.week]
    for week in weeks:
        payload = build_momentum(stats, schedule, args.season, week)
        path = data_dir(root) / f"momentum-wk{week}.json"
        write_json(path, payload)
        print(f"wrote {path.relative_to(root)} ({len(payload['players'])} players)")
        print(json.dumps(payload["backtest"]))


if __name__ == "__main__":
    main()
