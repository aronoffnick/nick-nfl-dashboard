#!/usr/bin/env python3
"""Save a static getoddy price snapshot into the week files.

The dashboard never calls this. A scheduled run writes the prices it finds
and the time they were saved. A missing page or a line that is not in the
snapshot stays blank. Existing prices are not replaced.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

from nflboard.logic import TEAM_NAMES, name_key  # noqa: E402
from nflboard.store import data_dir, read_json, write_json  # noqa: E402

SNAPSHOT_URL = "https://getoddy.com/api/snapshot"
PROPS_URL = "https://getoddy.com/api/props?game={game_id}"
ET = ZoneInfo("America/New_York")
BOOKS = {
    "espnbet": "theScore Bet", "draftkings": "DraftKings", "fanduel": "FanDuel",
    "fanatics": "Fanatics", "polymarket": "Polymarket", "betmgm": "BetMGM",
    "novig": "Novig", "caesars": "Caesars", "betrivers": "BetRivers",
    "hardrockbet": "Hard Rock", "fliff": "Fliff", "bovada": "Bovada", "kalshi": "Kalshi",
    "prophetx": "ProphetX", "pinnacle": "Pinnacle",
}
MARKET = {
    "Pass yds": "pass_yds", "Rush yds": "rush_yds", "Rec yds": "rec_yds", "Receptions": "receptions",
}


def american_text(value) -> str:
    number = int(round(float(value)))
    return f"+{number}" if number > 0 else str(number)


def as_of(stamp: str) -> str:
    parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(ET)
    clock = parsed.strftime("%I:%M %p").lstrip("0")
    return f"{parsed.strftime('%b')} {parsed.day}, {clock} ET"


def slug(away: str, home: str, day: str) -> str:
    def nick(abbr):
        return TEAM_NAMES.get(abbr, abbr).split()[-1].lower().replace(" ", "")
    return f"{nick(away)}-{nick(home)}-{day}"


def quote_for(markets, market, player, side, line):
    rows = (markets or {}).get(market) or []
    target = name_key(player)
    side_key = "over" if str(side).lower() in {"over", "yes"} else "under"
    nearest = None
    for row in rows:
        if name_key(row.get("player")) != target:
            continue
        point = row.get("point")
        if nearest is None or abs(float(point) - float(line)) < abs(float(nearest.get("point")) - float(line)):
            nearest = row
        if abs(float(point) - float(line)) > 0.01:
            continue
        side_row = row.get(side_key) or {}
        price = side_row.get("bestAmerican")
        book = side_row.get("bestBook")
        if price is None or not book:
            return None
        return {"price": int(round(float(price))), "book": BOOKS.get(book, book), "line": point}
    if nearest is not None and abs(float(nearest.get("point")) - float(line)) > 0.01:
        return {"mismatch": nearest.get("point")}
    return None


def apply_td_prices(game, markets, when, url):
    filled = 0
    for side in game.get("sides") or []:
        for row in side.get("rows") or []:
            picks = [row.get("confident"), row.get("relativelySafe"), *(row.get("upside") or [])]
            for pick in picks:
                if not pick or pick.get("price") not in (None, ""):
                    continue
                market, line, side_name = ("td", 0.5, "over") if pick.get("prop") == "Anytime TD" else ("td2", 1.5, "over") if pick.get("prop") == "2+ TDs" else (None, None, None)
                if market is None:
                    continue
                found = quote_for(markets, market, pick.get("player"), side_name, line)
                if not found or found.get("mismatch") is not None or "price" not in found:
                    continue
                pick["price"] = american_text(found["price"])
                pick["book"] = found["book"]
                filled += 1
    if filled and not (game.get("priceSnapshot") or {}).get("asOf"):
        game["priceSnapshot"] = {
            "source": "getoddy.com best price across books",
            "url": url,
            "asOf": when,
            "playersPriced": filled,
            "note": "Saved when the weekly job ran. Not a live price.",
        }
    elif filled:
        game.setdefault("priceSnapshot", {})["playersPriced"] = sum(
            1 for side in game.get("sides") or [] for row in side.get("rows") or []
            for pick in [row.get("confident"), row.get("relativelySafe"), *(row.get("upside") or [])]
            if pick and pick.get("price") not in (None, "")
        )
    return filled


def apply_parlay_prices(game, markets, when, moneylines):
    filled = 0
    for leg in game.get("legs") or []:
        if leg.get("price") not in (None, ""):
            continue
        if leg.get("kind") == "ml":
            quote = moneylines.get(leg.get("team"))
            if not quote:
                continue
            leg["price"] = quote["price"]
            leg["book"] = quote["book"]
            leg["price_str"] = f"{american_text(quote['price'])} {quote['book']}"
            leg["priced"] = True
            leg["asof"] = when
            filled += 1
            continue
        market = MARKET.get(leg.get("market"))
        if not market or leg.get("line") is None:
            continue
        found = quote_for(markets, market, leg.get("player"), leg.get("side"), leg.get("line"))
        if not found:
            continue
        if found.get("mismatch") is not None:
            if not leg.get("flags"):
                leg["flags"] = f"getoddy snapshot line is {found['mismatch']}"
            continue
        leg["price"] = found["price"]
        leg["book"] = found["book"]
        leg["price_str"] = f"{american_text(found['price'])} {found['book']}"
        leg["priced"] = True
        leg["asof"] = when
        filled += 1
    if filled and not (game.get("snapshot") or {}).get("props_asof"):
        game["snapshot"] = {"props_asof": when, "game_asof": when, "fetched_at": when, "note": "Saved when the weekly job ran. Not a live price."}
    return filled


def fetch_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "nick-nfl-dashboard-snapshot"})
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def nfl_games(snapshot):
    for sport in snapshot.get("sports") or []:
        if sport.get("key") == "americanfootball_nfl":
            return sport.get("games") or []
    return []


def match_game(oddy_games, away, home):
    wanted = {TEAM_NAMES.get(away, away), TEAM_NAMES.get(home, home)}
    for game in oddy_games:
        names = {game.get("away"), game.get("home")}
        if names == wanted:
            return game
    return None


def moneyline_for(game):
    found = {}
    nick_to_abbr = {name: abbr for abbr, name in TEAM_NAMES.items()}
    for side in game.get("moneyline") or []:
        abbr = nick_to_abbr.get(side.get("name"))
        price = side.get("bestAmerican")
        book = side.get("bestBook")
        if abbr and price is not None and book:
            found[abbr] = {"price": int(round(float(price))), "book": BOOKS.get(book, book)}
    return found


def price_week(root: Path, season: int, week: int) -> int:
    folder = data_dir(root)
    td_path = folder / f"td-riskscale-wk{week}.json"
    parlay_path = folder / f"parlays-wk{week}.json"
    td = read_json(td_path)
    parlays = read_json(parlay_path)
    if not td or not parlays:
        print(f"week {week} files are missing. Nothing was priced.")
        return 0
    try:
        snapshot = fetch_json(SNAPSHOT_URL)
        oddy = nfl_games(snapshot)
    except Exception as exc:  # noqa: BLE001 — leave prices blank
        print(f"getoddy snapshot could not be fetched ({exc}). Prices left blank.")
        return 0
    filled = 0
    for game in td.get("games") or []:
        away, home = game["key"].split("@")
        oddy_game = match_game(oddy, away, home)
        if not oddy_game:
            print(f"{game['key']}: not in the getoddy slate. Prices left blank.")
            continue
        try:
            props = fetch_json(PROPS_URL.format(game_id=oddy_game["id"]))
        except Exception as exc:  # noqa: BLE001
            print(f"{game['key']}: props fetch failed ({exc}). Prices left blank.")
            continue
        when = as_of(props.get("at") or props.get("generatedAt") or snapshot.get("generatedAt"))
        day = datetime.fromisoformat(oddy_game["commence"].replace("Z", "+00:00")).astimezone(ET).date().isoformat()
        url = f"https://getoddy.com/nfl/games/{slug(away, home, day)}/props"
        markets = props.get("markets") or {}
        filled += apply_td_prices(game, markets, when, url)
        parlay_game = (parlays.get("games") or {}).get(f"{away}-{home}")
        if parlay_game:
            filled += apply_parlay_prices(parlay_game, markets, when, moneyline_for(oddy_game))
        print(f"{game['key']}: snapshot {when}")
    if filled:
        write_json(td_path, td)
        write_json(parlay_path, parlays)
    print(f"filled {filled} blank prices. Existing prices were kept.")
    return filled


def main():
    parser = argparse.ArgumentParser(description="Save a static getoddy snapshot for one week")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--week", type=int)
    parser.add_argument("--auto", action="store_true")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    weeks = [args.week] if args.week else []
    if args.auto or not weeks:
        from nflboard.fetch import paths_for
        from nflboard.logic import select_weeks
        import pandas as pd
        schedule = pd.read_csv(paths_for(args.season, root)["games"])
        weeks = select_weeks(schedule, args.season)["targets"]
    for week in weeks:
        price_week(root, args.season, week)


if __name__ == "__main__":
    main()
