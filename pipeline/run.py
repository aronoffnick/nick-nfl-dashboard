#!/usr/bin/env python3
"""Build one NFL week's dashboard files from public nflverse data.

Examples:
  python pipeline/run.py --season 2026 --week 12
  python pipeline/run.py --season 2026 --week 13
  python pipeline/run.py --auto

A week that already has saved prices keeps those games. Other prices stay blank.
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
from nflboard.history import write_history  # noqa: E402
from nflboard.logic import build_week, score_week, select_weeks  # noqa: E402
from nflboard.store import (  # noqa: E402
    data_dir,
    load_adjustments,
    read_json,
    week_has_priced_board,
    write_bundle,
    write_calibration,
)

STAT_COLUMNS = [
    "player_id", "player_display_name", "position", "season", "week", "season_type",
    "game_id", "team", "opponent_team", "attempts", "passing_yards", "passing_tds",
    "carries", "rushing_yards", "rushing_tds", "receptions", "targets", "receiving_yards", "receiving_tds",
    "sack_yards_lost",
]
PBP_COLUMNS = ["season", "season_type", "week", "posteam", "yardline_100", "rush_attempt", "rusher_player_id"]


def load_frames(season: int, root: Path, cache: Path | None):
    files = paths_for(season, root, cache)
    schedule = pd.read_csv(files["games"])
    stats = pd.read_csv(files["stats"], usecols=lambda name: name in STAT_COLUMNS)
    pbp = None
    if files.get("pbp"):
        try:
            pbp = pd.read_parquet(files["pbp"], columns=PBP_COLUMNS)
        except Exception as exc:  # noqa: BLE001 — inside-5 is optional
            print(f"play-by-play could not be read ({exc}). Inside-5 shares left blank.")
    return stats, schedule, pbp


def score_existing(root: Path, stats, schedule, season: int, week: int):
    folder = data_dir(root)
    scatter = read_json(folder / f"scatter-wk{week}.json")
    if not scatter:
        print(f"no scatter-wk{week}.json, so week {week} was not scored")
        return None
    prior_rollup = None
    for path in sorted(folder.glob("calibration-wk*.json")):
        digits = "".join(ch for ch in path.stem if ch.isdigit())
        if digits and int(digits) < week:
            prior_rollup = (read_json(path) or {}).get("rollup")
    payload = score_week(
        scatter,
        read_json(folder / f"td-riskscale-wk{week}.json") or {},
        read_json(folder / f"coverage-wk{week}.json") or {},
        read_json(folder / f"td-coverage-wk{week}.json") or {},
        read_json(root / "dashboard" / "src" / "props" / f"wr-starters-week{week}.json") or [],
        stats,
        schedule,
        season,
        week,
        prior_rollup=prior_rollup,
    )
    if not payload["gamesScored"]:
        print(f"week {week} has no final games to score")
        return None
    path = write_calibration(root, payload)
    print(f"wrote {path.relative_to(root)} ({payload['gamesScored']} final games)")
    return payload


def build_one(root: Path, stats, schedule, pbp, season: int, week: int, mode: str | None = None):
    mode = mode or ("fill" if week_has_priced_board(root, week) else "full")
    adjustments = {} if mode == "fill" else load_adjustments(root, week)
    bundle = build_week(stats, schedule, pbp, season, week, adjustments)
    if not bundle["slate"]:
        raise SystemExit(f"No {season} week {week} games in the nflverse schedule. Nothing was written.")
    written = write_bundle(root, season, week, bundle, mode)
    print(f"week {week} {mode}: {len(bundle['slate'])} games → {', '.join(written)}")
    return {"week": week, "mode": mode, "games": bundle["slate"], "files": written}


def main():
    parser = argparse.ArgumentParser(description="Build dashboard files for an NFL week")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--week", type=int, help="Week to build. Omit with --auto.")
    parser.add_argument("--auto", action="store_true", help="Pick the week from the schedule and the weekday")
    parser.add_argument("--mode", choices=["fill", "full"], help="fill keeps existing charts and adds missing games; full rewrites the week")
    parser.add_argument("--cache", type=Path, help="Directory for downloaded nflverse files")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    if not args.week and not args.auto:
        parser.error("pass --week or --auto")
    root = args.root.resolve()
    stats, schedule, pbp = load_frames(args.season, root, args.cache)
    if args.auto:
        plan = select_weeks(schedule, args.season)
        weeks = plan["targets"]
        print(f"auto {plan['weekday']}: weeks {weeks}")
    else:
        weeks = [args.week]
    write_history(root, stats, schedule, args.season)
    reports = []
    for week in weeks:
        report = build_one(root, stats, schedule, pbp, args.season, week, args.mode)
        scored = score_existing(root, stats, schedule, args.season, week)
        report["scoredGames"] = None if scored is None else scored["gamesScored"]
        reports.append(report)
    print(json.dumps({"season": args.season, "weeks": reports}))


if __name__ == "__main__":
    main()
