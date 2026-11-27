#!/usr/bin/env python3
"""Score pre-game breakout signals for one week.

  python pipeline/breakout.py --season 2026 --week 13

Weights are read from pipeline/breakout-weights.json. A missing input stays
blank. Nothing is filled in from the week being scored.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

from nflboard.breakout import build_breakout, load_weights  # noqa: E402
from nflboard.fetch import paths_for  # noqa: E402
from nflboard.logic import select_weeks  # noqa: E402
from nflboard.store import data_dir, write_json  # noqa: E402

STAT_COLUMNS = [
    "player_id", "player_display_name", "position", "season", "week", "season_type", "game_id",
    "team", "opponent_team", "attempts", "passing_yards", "passing_tds",
    "carries", "rushing_yards", "rushing_tds", "receptions", "targets",
    "receiving_yards", "receiving_tds", "receiving_air_yards", "target_share", "air_yards_share",
]
PBP_COLUMNS = [
    "season_type", "week", "posteam", "yardline_100", "rush_attempt", "pass_attempt",
    "rusher_player_id", "receiver_player_id",
]


def load(season: int, root: Path, cache: Path | None):
    files = paths_for(season, root, cache)
    stats = pd.read_csv(files["stats"], usecols=lambda name: name in STAT_COLUMNS)
    schedule = pd.read_csv(files["games"])
    snaps = pd.read_csv(files["snaps"]) if files.get("snaps") else None
    pbp = None
    if files.get("pbp"):
        try:
            pbp = pd.read_parquet(files["pbp"], columns=PBP_COLUMNS)
        except Exception as exc:  # noqa: BLE001 — red-zone share stays blank
            print(f"play-by-play could not be read ({exc}). Red-zone shares left blank.")
    return stats, schedule, pbp, snaps


def write_week(root: Path, stats, schedule, pbp, snaps, season: int, week: int, weights: dict) -> Path:
    payload = build_breakout(stats, schedule, pbp, snaps, season, week, weights)
    path = data_dir(root) / f"breakout-wk{week}.json"
    write_json(path, payload)
    print(f"wrote {path.relative_to(root)} ({len(payload['candidates'])} candidates)")
    return path


def main():
    parser = argparse.ArgumentParser(description="Score breakout signals for an NFL week")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--week", type=int)
    parser.add_argument("--auto", action="store_true")
    parser.add_argument("--weights", type=Path, default=ROOT / "pipeline" / "breakout-weights.json")
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    if not args.week and not args.auto:
        parser.error("pass --week or --auto")
    root = args.root.resolve()
    stats, schedule, pbp, snaps = load(args.season, root, args.cache)
    weights = load_weights(args.weights)
    if args.auto:
        plan = select_weeks(schedule, args.season)
        weeks = plan["targets"]
        print(f"auto {plan['weekday']}: weeks {weeks}")
    else:
        weeks = [args.week]
    for week in weeks:
        write_week(root, stats, schedule, pbp, snaps, args.season, week, weights)
    print(json.dumps({"season": args.season, "weeks": weeks}))


if __name__ == "__main__":
    main()
