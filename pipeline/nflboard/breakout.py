"""Pre-game breakout scores.

Running backs use the validated point rule. Wide receivers and tight ends
keep the environment flags that failed out of sample, and those flags are
not a ranking. Weights live in pipeline/breakout-weights.json. Every signal
uses weeks before the one being scored.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd

from nflboard.logic import (
    defense_factors,
    history_stats,
    implied_points,
    name_key,
    norm_team,
    player_pool,
    prepare,
    round_num,
    team_scoring,
)

WEIGHTS_PATH = Path(__file__).resolve().parents[1] / "breakout-weights.json"
DEFAULT_WEIGHTS = {
    "rb": {
        "redZoneShare": {"min": 0.20, "points": 2},
        "inside10Share": {"min": 0.25, "points": 1},
        "snapShareRising": {"points": 1},
        "opportunitiesRising": {"points": 1},
        "minScore": 3,
        "minPriorGames": 3,
        "minOpportunitiesPerGame": 3,
    },
    "unvalidated": {
        "wr": {
            "impliedTotal": {"min": 24, "points": 1},
            "favoriteBy": {"min": 3, "points": 1},
            "defenseYardsFactor": {"min": 1.15, "points": 1},
            "home": {"points": 1},
            "lowBaseline": {"points": 1, "priorReceivingYards": 30},
        },
        "te": {
            "lowBaseline": {"points": 2, "priorReceivingYards": 30},
            "snapShare": {"min": 0.70, "points": 1},
            "gameTotal": {"min": 47, "points": 1},
        },
    },
    "negative": {"underdogBy3": 0.76, "priorSpike": 0.63, "qbChange": 0.82},
    "noEffect": ["adot", "airYardsShare", "targetShare"],
}


def load_weights(path: Path | None = None) -> dict:
    weights = json.loads(json.dumps(DEFAULT_WEIGHTS))
    file = path or WEIGHTS_PATH
    if file.exists():
        loaded = json.loads(file.read_text())
        for section in ("rb", "unvalidated", "negative"):
            if section in loaded:
                if section == "unvalidated":
                    for pos, block in loaded[section].items():
                        weights[section].setdefault(pos, {}).update(block)
                else:
                    weights[section].update(loaded[section])
        if "noEffect" in loaded:
            weights["noEffect"] = loaded["noEffect"]
        if "study" in loaded:
            weights["study"] = loaded["study"]
    return weights


def _mean(values):
    values = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    if not values:
        return None
    return sum(values) / len(values)


def _rising(values):
    clean = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    if len(clean) < 4:
        return False
    recent, earlier = clean[-3:], clean[:-3]
    return sum(recent) / len(recent) > sum(earlier) / len(earlier)


def _share_maps(pbp, before_week: int):
    empty = {}
    if pbp is None or "yardline_100" not in getattr(pbp, "columns", []):
        return empty, empty
    frame = pbp[(pbp["week"] < before_week) & pbp["yardline_100"].notna() & pbp["posteam"].notna()].copy()
    if "season_type" in frame.columns:
        frame = frame[frame["season_type"].isin(["REG", "reg"])]
    parts = []
    if "rush_attempt" in frame.columns and "rusher_player_id" in frame.columns:
        parts.append(frame[(frame["rush_attempt"] == 1) & frame["rusher_player_id"].notna()][["posteam", "rusher_player_id", "yardline_100"]].rename(columns={"rusher_player_id": "player_id"}))
    if "pass_attempt" in frame.columns and "receiver_player_id" in frame.columns:
        parts.append(frame[(frame["pass_attempt"] == 1) & frame["receiver_player_id"].notna()][["posteam", "receiver_player_id", "yardline_100"]].rename(columns={"receiver_player_id": "player_id"}))
    if not parts:
        return empty, empty
    plays = pd.concat(parts, ignore_index=True)
    if plays.empty:
        return empty, empty
    plays["player_id"] = plays["player_id"].astype(str)
    red, inside = {}, {}
    for team, group in plays.groupby("posteam"):
        red_plays = group[group["yardline_100"] <= 20]
        inside_plays = group[group["yardline_100"] <= 10]
        if len(red_plays):
            for pid, count in red_plays.groupby("player_id").size().items():
                red[(team, pid)] = float(count) / len(red_plays)
        if len(inside_plays):
            for pid, count in inside_plays.groupby("player_id").size().items():
                inside[(team, pid)] = float(count) / len(inside_plays)
    return red, inside


def _snap_index(snaps):
    if snaps is None or not len(snaps):
        return None
    frame = snaps.copy()
    frame["team"] = frame["team"].map(norm_team)
    found = {}
    for row in frame.itertuples(index=False):
        found[(name_key(row.player), row.team, int(row.week))] = (float(row.offense_snaps or 0), float(row.offense_pct or 0))
    return found


def _spike(prior, game) -> bool:
    if len(prior) < 3:
        return False
    def val(row, name):
        value = getattr(row, name, 0) or 0
        return 0.0 if isinstance(value, float) and math.isnan(value) else float(value)
    rec_avg = _mean([val(row, "receiving_yards") for row in prior]) or 0
    scrim_avg = _mean([val(row, "rushing_yards") + val(row, "receiving_yards") for row in prior]) or 0
    td_avg = _mean([val(row, "rushing_tds") + val(row, "receiving_tds") for row in prior]) or 0
    rec = val(game, "receiving_yards")
    scrim = val(game, "rushing_yards") + val(game, "receiving_yards")
    tds = val(game, "rushing_tds") + val(game, "receiving_tds")
    return rec >= max(2 * rec_avg, 60) or scrim >= max(2 * scrim_avg, 80) or tds >= max(2 * td_avg, 2)


def build_breakout(stats, schedule, pbp, snaps, season: int, week: int, weights: dict | None = None) -> dict:
    weights = weights or load_weights()
    rb_rule = weights["rb"]
    stats, schedule, pbp = prepare(stats, schedule, pbp)
    if "season" in stats.columns:
        stats = stats[stats["season"] == season]
    if "season_type" in stats.columns:
        stats = stats[stats["season_type"].isin(["REG", "reg"])]
    if "season" in schedule.columns:
        schedule = schedule[schedule["season"] == season]
    if "game_type" in schedule.columns:
        schedule = schedule[schedule["game_type"] == "REG"]
    hist = history_stats(stats, schedule, week)
    pool = [player for player in player_pool(hist) if player["pos"] in {"RB", "WR", "TE"}]
    factors = defense_factors(hist) if len(hist) else {}
    scoring = team_scoring(schedule, week)
    red_share, inside_share = _share_maps(pbp, week)
    snap_rows = _snap_index(snaps)
    by_id = {}
    qb_week = {}
    if len(hist):
        for row in hist.itertuples(index=False):
            by_id.setdefault(str(row.player_id), []).append(row)
            if row.pos == "QB":
                key = (row.team, int(row.week))
                attempts = float(getattr(row, "attempts", 0) or 0)
                current = qb_week.get(key)
                if current is None or attempts > current[0]:
                    qb_week[key] = (attempts, str(row.player_id))
    slate = schedule[schedule["week"] == week] if "week" in schedule.columns else schedule.iloc[0:0]
    home = {}
    opponents = {}
    for row in slate.itertuples(index=False):
        opponents[row.away_team] = row.home_team
        opponents[row.home_team] = row.away_team
        home[row.home_team] = True
        home[row.away_team] = False
    ranked = []
    unvalidated = []
    for player in pool:
        if player["team"] not in opponents:
            continue
        rows = [row for row in by_id.get(player["id"], []) if row.team == player["team"]]
        defense = opponents[player["team"]]
        off = implied_points(scoring, player["team"], defense)
        other = implied_points(scoring, defense, player["team"])
        margin = None if off is None or other is None else off - other
        if player["pos"] == "RB":
            ranked_row = _rb_row(player, rows, defense, off, other, margin, red_share, inside_share, snap_rows, qb_week, rb_rule, weights["negative"])
            if ranked_row:
                ranked.append(ranked_row)
        else:
            flag_row = _skill_flags(player, rows, defense, off, other, margin, home.get(player["team"]), factors, snap_rows, weights["unvalidated"][player["pos"].lower()])
            if flag_row and flag_row["flags"]:
                unvalidated.append(flag_row)
    ranked.sort(key=lambda row: (-row["score"], -(row["implied"] or 0), row["name"]))
    watch = [row for row in ranked if row["score"] >= rb_rule["minScore"]]
    unvalidated.sort(key=lambda row: (row["team"], row["name"]))
    return {
        "season": season,
        "week": week,
        "label": "Model estimates. Running-back rule only. Receiver flags are not a ranking.",
        "prices": "blank",
        "weights": {"rb": rb_rule, "negative": weights["negative"], "noEffect": weights["noEffect"]},
        "study": weights.get("study") or {},
        "candidates": watch,
        "players": ranked,
        "unvalidated": unvalidated,
    }


def _rb_row(player, rows, defense, off, other, margin, red_share, inside_share, snaps, qb_week, rule, negative):
    opportunities = [float(getattr(row, "targets", 0) or 0) + float(getattr(row, "carries", 0) or 0) for row in rows]
    if len(rows) < rule["minPriorGames"]:
        return None
    if not opportunities or sum(opportunities) / len(opportunities) < rule["minOpportunitiesPerGame"]:
        return None
    snap_shares = []
    if snaps is not None:
        for row in rows:
            found = snaps.get((name_key(player["name"]), player["team"], int(row.week)))
            snap_shares.append(None if found is None else found[1])
    red = red_share.get((player["team"], player["id"]), 0.0)
    inside = inside_share.get((player["team"], player["id"]), 0.0)
    points = 0
    signals = {
        "redZoneShare": round_num(red, 3),
        "inside10Share": round_num(inside, 3),
        "snapShareRising": bool(_rising(snap_shares)) if snaps is not None else False,
        "opportunitiesRising": bool(_rising(opportunities)),
    }
    if red >= rule["redZoneShare"]["min"]:
        points += rule["redZoneShare"]["points"]
    if inside >= rule["inside10Share"]["min"]:
        points += rule["inside10Share"]["points"]
    if signals["snapShareRising"]:
        points += rule["snapShareRising"]["points"]
    if signals["opportunitiesRising"]:
        points += rule["opportunitiesRising"]["points"]
    flags = []
    if margin is not None and margin <= -3:
        flags.append("underdog")
    if rows and _spike(rows[:-1], rows[-1]):
        flags.append("priorSpike")
    if _qb_changed(player["team"], rows, qb_week):
        flags.append("qbChange")
    return {
        "name": player["name"],
        "team": player["team"],
        "position": "RB",
        "opponent": defense,
        "games": len(rows),
        "score": points,
        "implied": None if off is None else round_num(off, 2),
        "signals": signals,
        "flags": flags,
        "negative": {mapped: negative[mapped] for name, mapped in (("underdog", "underdogBy3"), ("priorSpike", "priorSpike"), ("qbChange", "qbChange")) if name in flags},
    }


def _qb_changed(team, rows, qb_week) -> bool:
    if len(rows) < 2:
        return False
    last = int(rows[-1].week)
    earlier = [qb_week.get((team, int(row.week))) for row in rows[:-1]]
    earlier = [item[1] for item in earlier if item]
    last_qb = qb_week.get((team, last))
    if not earlier or not last_qb:
        return False
    usual = max(set(earlier), key=earlier.count)
    return last_qb[1] != usual


def _skill_flags(player, rows, defense, off, other, margin, is_home, factors, snaps, rule):
    if len(rows) < 3:
        return None
    rec = _mean([float(getattr(row, "receiving_yards", 0) or 0) for row in rows]) or 0
    flags = []
    points = 0
    if "impliedTotal" in rule and off is not None and off >= rule["impliedTotal"]["min"]:
        flags.append("implied total")
        points += rule["impliedTotal"]["points"]
    if "favoriteBy" in rule and margin is not None and margin >= rule["favoriteBy"]["min"]:
        flags.append("favorite")
        points += rule["favoriteBy"]["points"]
    factor = (factors.get(defense, {}).get(player["pos"], {}) or {}).get("recYds")
    if "defenseYardsFactor" in rule and factor is not None and factor >= rule["defenseYardsFactor"]["min"]:
        flags.append("soft defense")
        points += rule["defenseYardsFactor"]["points"]
    if "home" in rule and is_home:
        flags.append("home")
        points += rule["home"]["points"]
    floor = rule.get("lowBaseline", {}).get("priorReceivingYards", 30)
    if "lowBaseline" in rule and rec < floor:
        flags.append("low baseline")
        points += rule["lowBaseline"]["points"]
    if "snapShare" in rule and snaps is not None:
        recent = []
        for row in rows[-3:]:
            found = snaps.get((name_key(player["name"]), player["team"], int(row.week)))
            if found is not None:
                recent.append(found[1])
        if recent and sum(recent) / len(recent) >= rule["snapShare"]["min"]:
            flags.append("snap share")
            points += rule["snapShare"]["points"]
    total = None if off is None or other is None else off + other
    if "gameTotal" in rule and total is not None and total >= rule["gameTotal"]["min"]:
        flags.append("game total")
        points += rule["gameTotal"]["points"]
    return {
        "name": player["name"],
        "team": player["team"],
        "position": player["pos"],
        "opponent": defense,
        "flags": flags,
        "points": points,
        "ranked": False,
    }
