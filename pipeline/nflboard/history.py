"""Completed-week box scores from nflverse, in the shape the dashboard already reads."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from nflboard.store import write_json

ET = ZoneInfo("America/New_York")
# ESPN site-api ids and the abbreviation that scoreboard uses.
ESPN = {
    "ARI": ("22", "ARI", "Arizona Cardinals"),
    "ATL": ("1", "ATL", "Atlanta Falcons"),
    "BAL": ("33", "BAL", "Baltimore Ravens"),
    "BUF": ("2", "BUF", "Buffalo Bills"),
    "CAR": ("29", "CAR", "Carolina Panthers"),
    "CHI": ("3", "CHI", "Chicago Bears"),
    "CIN": ("4", "CIN", "Cincinnati Bengals"),
    "CLE": ("5", "CLE", "Cleveland Browns"),
    "DAL": ("6", "DAL", "Dallas Cowboys"),
    "DEN": ("7", "DEN", "Denver Broncos"),
    "DET": ("8", "DET", "Detroit Lions"),
    "GB": ("9", "GB", "Green Bay Packers"),
    "HOU": ("34", "HOU", "Houston Texans"),
    "IND": ("11", "IND", "Indianapolis Colts"),
    "JAX": ("30", "JAX", "Jacksonville Jaguars"),
    "KC": ("12", "KC", "Kansas City Chiefs"),
    "LV": ("13", "LV", "Las Vegas Raiders"),
    "LAC": ("24", "LAC", "Los Angeles Chargers"),
    "LAR": ("14", "LAR", "Los Angeles Rams"),
    "LA": ("14", "LAR", "Los Angeles Rams"),
    "MIA": ("15", "MIA", "Miami Dolphins"),
    "MIN": ("16", "MIN", "Minnesota Vikings"),
    "NE": ("17", "NE", "New England Patriots"),
    "NO": ("18", "NO", "New Orleans Saints"),
    "NYG": ("19", "NYG", "New York Giants"),
    "NYJ": ("20", "NYJ", "New York Jets"),
    "PHI": ("21", "PHI", "Philadelphia Eagles"),
    "PIT": ("23", "PIT", "Pittsburgh Steelers"),
    "SEA": ("26", "SEA", "Seattle Seahawks"),
    "SF": ("25", "SF", "San Francisco 49ers"),
    "TB": ("27", "TB", "Tampa Bay Buccaneers"),
    "TEN": ("10", "TEN", "Tennessee Titans"),
    "WAS": ("28", "WSH", "Washington Commanders"),
    "WSH": ("28", "WSH", "Washington Commanders"),
}


def _team(abbr):
    espn_id, espn_abbr, name = ESPN[abbr]
    return {
        "id": espn_id,
        "abbr": espn_abbr,
        "name": name,
        "logo": f"https://a.espncdn.com/i/teamlogos/nfl/500/{espn_abbr.lower()}.png",
    }


def _num(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return 0
    return float(value)


def _player(row):
    pos = "RB" if row.position == "FB" else row.position
    return {
        "id": str(row.player_id),
        "name": row.player_display_name,
        "position": pos,
        "passYds": _num(row.passing_yards),
        "passTD": _num(row.passing_tds),
        "passAtt": _num(row.attempts),
        "rushYds": _num(row.rushing_yards),
        "rushTD": _num(row.rushing_tds),
        "carries": _num(row.carries),
        "rec": _num(row.receptions),
        "recYds": _num(row.receiving_yards),
        "recTD": _num(row.receiving_tds),
        "targets": _num(row.targets),
    }


def _side(abbr, points, frame):
    team = _team(abbr)
    players = [_player(row) for row in frame.itertuples(index=False) if row.position in {"QB", "RB", "FB", "WR", "TE"}]
    net_pass = 0.0
    rush = 0.0
    for row in frame.itertuples(index=False):
        net_pass += _num(row.passing_yards) - _num(getattr(row, "sack_yards_lost", 0))
        rush += _num(row.rushing_yards)
    team.update({
        "pass": round(net_pass, 1),
        "rush": round(rush, 1),
        "points": int(points),
        "playerBox": {"players": players, "available": ["passing", "rushing", "receiving"], "source": "nflverse"},
    })
    return team


def build_history(stats: pd.DataFrame, schedule: pd.DataFrame, season: int) -> dict:
    schedule = schedule[(schedule["season"] == season) & (schedule["game_type"] == "REG")].copy()
    schedule = schedule[schedule["away_score"].notna() & schedule["home_score"].notna()]
    stats = stats[(stats["season"] == season) & (stats["season_type"] == "REG")].copy()
    games = []
    for row in schedule.sort_values(["week", "gameday", "gametime"]).itertuples(index=False):
        away, home = row.away_team, row.home_team
        if away not in ESPN or home not in ESPN:
            continue
        clock = str(row.gametime or "12:00")[:5]
        local = datetime.strptime(f"{row.gameday} {clock}", "%Y-%m-%d %H:%M").replace(tzinfo=ET)
        gid = str(int(row.espn)) if pd.notna(getattr(row, "espn", None)) else str(row.game_id)
        played = stats[stats["game_id"] == row.game_id] if "game_id" in stats.columns else stats[(stats["week"] == row.week) & (stats["team"].isin([away, home]))]
        away_rows = played[played["team"] == away]
        home_rows = played[played["team"] == home]
        games.append({
            "id": gid,
            "week": int(row.week),
            "date": local.isoformat(),
            "neutral": str(getattr(row, "location", "") or "").lower() == "neutral",
            "source": "nflverse",
            "away": _side(away, row.away_score, away_rows),
            "home": _side(home, row.home_score, home_rows),
        })
    through = max((game["week"] for game in games), default=None)
    return {
        "season": season,
        "source": "nflverse schedule and weekly player stats",
        "throughWeek": through,
        "asOf": f"through week {through}" if through else None,
        "games": games,
    }


def write_history(root: Path, stats, schedule, season: int) -> Path:
    payload = build_history(stats, schedule, season)
    path = root / "dashboard" / "src" / "data" / f"history-{season}.json"
    write_json(path, payload)
    print(f"wrote {path.relative_to(root)} ({len(payload['games'])} final games through week {payload['throughWeek']})")
    return path
