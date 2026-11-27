#!/usr/bin/env python3
"""Save a static ESPN moneyline and spread snapshot.

Fills blank team prices only. A getoddy price already on a parlay leg stays.
"""
from __future__ import annotations

import json
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT / "pipeline"))

from nflboard.store import data_dir, read_json, write_json  # noqa: E402

API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={season}&seasontype=2&week={week}&limit=100"
ET = ZoneInfo("America/New_York")


def norm(abbr: str) -> str:
    return {"WSH": "WAS", "LA": "LAR", "JAC": "JAX"}.get(abbr, abbr)


def american(text):
    if text is None or text == "":
        return None
    try:
        return int(str(text).replace("+", ""))
    except ValueError:
        return None


def close_odds(block, side):
    return american(((block or {}).get(side) or {}).get("close", {}).get("odds"))


def fetch_board(season: int, week: int) -> dict:
    url = API.format(season=season, week=week)
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def parse_board(board: dict, season: int, week: int, fetched: str) -> dict:
    games = {}
    for event in board.get("events") or []:
        comp = (event.get("competitions") or [{}])[0]
        state = ((comp.get("status") or {}).get("type") or {}).get("state")
        if state != "pre":
            continue
        odds = (comp.get("odds") or [None])[0]
        if not odds:
            continue
        sides = {row.get("homeAway"): row.get("team") or {} for row in comp.get("competitors") or []}
        away = norm((sides.get("away") or {}).get("abbreviation") or "")
        home = norm((sides.get("home") or {}).get("abbreviation") or "")
        if not away or not home:
            continue
        home_line = odds.get("spread")
        try:
            home_line = float(home_line)
        except (TypeError, ValueError):
            home_line = None
        provider_row = odds.get("provider") or {}
        provider = provider_row.get("displayName") or provider_row.get("name") or "ESPN"
        ml_away = close_odds(odds.get("moneyline"), "away")
        ml_home = close_odds(odds.get("moneyline"), "home")
        sp_away = close_odds(odds.get("pointSpread"), "away")
        sp_home = close_odds(odds.get("pointSpread"), "home")
        if ml_away is None and ml_home is None and home_line is None:
            continue
        games[f"{away}-{home}"] = {
            "away": away,
            "home": home,
            "status": "pre",
            "source": "ESPN scoreboard odds",
            "book": provider,
            "asOf": fetched,
            "moneyline": {
                away: None if ml_away is None else {"price": ml_away, "book": provider},
                home: None if ml_home is None else {"price": ml_home, "book": provider},
            },
            "spread": None if home_line is None else {
                "homeLine": home_line,
                "awayLine": -home_line,
                away: None if sp_away is None else {"line": -home_line, "price": sp_away, "book": provider},
                home: None if sp_home is None else {"line": home_line, "price": sp_home, "book": provider},
            },
        }
    return {
        "season": season,
        "week": week,
        "source": "ESPN scoreboard odds",
        "asOf": fetched,
        "games": games,
    }


def fill_parlay_moneylines(root: Path, week: int, snapshot: dict) -> int:
    path = data_dir(root) / f"parlays-wk{week}.json"
    payload = read_json(path)
    if not payload:
        return 0
    filled = 0
    for key, game in (payload.get("games") or {}).items():
        book = snapshot["games"].get(key)
        if not book:
            continue
        for leg in game.get("legs") or []:
            if leg.get("market") != "ML":
                continue
            if leg.get("priced") and leg.get("book") not in (None, "", "ESPN"):
                continue
            quote = (book.get("moneyline") or {}).get(leg.get("team"))
            if not quote:
                continue
            price = quote["price"]
            leg["price"] = price
            leg["book"] = quote["book"]
            leg["source"] = book.get("source") or "ESPN scoreboard odds"
            leg["price_str"] = f"{price:+d} {quote['book']}".replace("+-", "-") if price > 0 else f"{price} {quote['book']}"
            if price > 0:
                leg["price_str"] = f"+{price} {quote['book']}"
            leg["asof"] = book["asOf"]
            leg["priced"] = True
            filled += 1
        if filled and not (game.get("snapshot") or {}).get("game_asof"):
            game.setdefault("snapshot", {})["game_asof"] = book["asOf"]
            game["snapshot"]["note"] = "Moneyline filled from an ESPN scoreboard snapshot where getoddy had none."
    if filled:
        write_json(path, payload)
    return filled


def current_and_next(season: int):
    board = fetch_board(season, 1)
    # The dated request still returns the requested week. Ask without a week for the live week.
    url = f"https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={season}&seasontype=2&limit=100"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        live = json.load(response)
    week = int((live.get("week") or {}).get("number") or 1)
    return [week, week + 1] if week < 18 else [week]


def save_week(root: Path, season: int, week: int, fetched: str) -> dict:
    snapshot = parse_board(fetch_board(season, week), season, week, fetched)
    path = data_dir(root) / f"team-odds-wk{week}.json"
    write_json(path, snapshot)
    filled = fill_parlay_moneylines(root, week, snapshot)
    print(f"wrote {path.relative_to(root)} ({len(snapshot['games'])} unstarted games, {filled} blank moneylines filled)")
    return snapshot


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Save ESPN moneyline and spread snapshots")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--week", type=int)
    parser.add_argument("--auto", action="store_true")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    if not args.week and not args.auto:
        parser.error("pass --week or --auto")
    fetched = datetime.now(ET).strftime("%b ") + str(datetime.now(ET).day) + datetime.now(ET).strftime(", %-I:%M %p ET")
    weeks = current_and_next(args.season) if args.auto else [args.week]
    for week in weeks:
        save_week(args.root.resolve(), args.season, week, fetched)


if __name__ == "__main__":
    main()
