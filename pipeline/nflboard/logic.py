"""Projection, parlay, touchdown, and calibration math.

Every number comes from the frames passed in. Prices are always null.
Missing inputs stay null instead of being filled with a guess.
"""
from __future__ import annotations

import itertools
import math
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

TEAM_NAMES = {
    "ARI": "Arizona Cardinals", "ATL": "Atlanta Falcons", "BAL": "Baltimore Ravens",
    "BUF": "Buffalo Bills", "CAR": "Carolina Panthers", "CHI": "Chicago Bears",
    "CIN": "Cincinnati Bengals", "CLE": "Cleveland Browns", "DAL": "Dallas Cowboys",
    "DEN": "Denver Broncos", "DET": "Detroit Lions", "GB": "Green Bay Packers",
    "HOU": "Houston Texans", "IND": "Indianapolis Colts", "JAX": "Jacksonville Jaguars",
    "KC": "Kansas City Chiefs", "LAC": "Los Angeles Chargers", "LAR": "Los Angeles Rams",
    "LV": "Las Vegas Raiders", "MIA": "Miami Dolphins", "MIN": "Minnesota Vikings",
    "NE": "New England Patriots", "NO": "New Orleans Saints", "NYG": "New York Giants",
    "NYJ": "New York Jets", "PHI": "Philadelphia Eagles", "PIT": "Pittsburgh Steelers",
    "SEA": "Seattle Seahawks", "SF": "San Francisco 49ers", "TB": "Tampa Bay Buccaneers",
    "TEN": "Tennessee Titans", "WAS": "Washington Commanders",
}
POSITIONS = ("QB", "RB", "WR", "TE")
STAT_COLS = {
    "passYds": "passing_yards",
    "rushYds": "rushing_yards",
    "rec": "receptions",
    "recYds": "receiving_yards",
    "td": None,
}
SHRINK_K = 4.0
FACTOR_LO = 0.75
FACTOR_HI = 1.35
SCALE_LO = 0.90
SCALE_HI = 1.10
TD_RULES = {
    "questionableRankFactor": 0.85,
    "relativelySafeMinProb": 0.22,
    "upside2plusMinProb": 0.12,
    "upside3plusMinProb": 0.06,
    "longShotMinProb": 0.04,
    "maxBackups": 2,
    "probability": (
        "Poisson from expected rushing plus receiving touchdowns. "
        "Relatively safe starts at 22%. A 2+ look is upside only at 12% or higher, and 3+ only at 6% or higher. "
        "Below that, down to 4%, the label is Long shot. "
        "The Week 12 tier check is three finished games, so these floors are deliberately higher than that small sample. "
        "Team totals use season scoring (points divided by 7), not a sportsbook total. "
        "estimate=true means fewer than 4 games."
    ),
}
MIN_LINE = {"Pass yds": 99.5, "Rush yds": 10.5, "Rec yds": 10.5, "Receptions": 1.5}
MARKET_OF = {"passYds": "Pass yds", "rushYds": "Rush yds", "recYds": "Rec yds", "rec": "Receptions"}
ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")


def norm_team(value) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip().upper()
    return {"LA": "LAR", "WSH": "WAS", "JAC": "JAX"}.get(text, text)


def name_key(value) -> str:
    text = str(value or "").lower().replace("'", "").replace("'", "").replace(".", "").replace("’", "")
    parts, word = [], []
    for ch in text:
        if ch.isalnum():
            word.append(ch)
        elif word:
            parts.append("".join(word))
            word = []
    if word:
        parts.append("".join(word))
    skip = {"jr", "sr", "ii", "iii", "iv", "v"}
    return " ".join(part for part in parts if part not in skip)


def nickname(abbr: str) -> str:
    return TEAM_NAMES.get(abbr, abbr).split()[-1]


def round_num(value, places):
    if value is None or (isinstance(value, float) and (math.isnan(value) or math.isinf(value))):
        return None
    return round(float(value), places)


def poisson_at_least(lam: float, count: int) -> float:
    if lam <= 0:
        return 0.0
    base = math.exp(-lam)
    if count <= 1:
        return 1 - base
    if count == 2:
        return 1 - base * (1 + lam)
    return 1 - base * (1 + lam + (lam * lam) / 2)


def bounded_scale(ratio, n, prior=20, lo=SCALE_LO, hi=SCALE_HI) -> float:
    if n is None or n <= 0 or ratio is None or not math.isfinite(ratio) or ratio <= 0:
        return 1.0
    weight = n / (n + prior)
    return max(lo, min(hi, 1 + weight * (ratio - 1)))


def shrink_factor(total, games, league_per_game, k=SHRINK_K, lo=FACTOR_LO, hi=FACTOR_HI):
    if games is None or games <= 0 or league_per_game is None or league_per_game <= 0:
        return None
    shrunk = (total + k * league_per_game) / ((games + k) * league_per_game)
    return max(lo, min(hi, float(shrunk)))


def prepare(stats: pd.DataFrame, schedule: pd.DataFrame, pbp: pd.DataFrame | None):
    stats = stats.copy()
    schedule = schedule.copy()
    for frame, cols in ((stats, ("team", "opponent_team")), (schedule, ("away_team", "home_team"))):
        for col in cols:
            if col in frame.columns:
                frame[col] = frame[col].map(norm_team)
    stats["pos"] = stats["position"].map(lambda pos: "RB" if pos == "FB" else pos)
    stats = stats[stats["pos"].isin(POSITIONS)].copy()
    stats["td"] = stats["rushing_tds"].fillna(0) + stats["receiving_tds"].fillna(0)
    schedule["final"] = schedule["away_score"].notna() & schedule["home_score"].notna()
    if pbp is not None and len(pbp):
        pbp = pbp.copy()
        pbp["posteam"] = pbp["posteam"].map(norm_team)
    else:
        pbp = None
    return stats, schedule, pbp


def final_team_weeks(schedule: pd.DataFrame, before_week: int) -> set[tuple[str, int]]:
    rows = schedule[(schedule["week"] < before_week) & schedule["final"]]
    found = set()
    for row in rows.itertuples(index=False):
        found.add((row.away_team, int(row.week)))
        found.add((row.home_team, int(row.week)))
    return found


def history_stats(stats: pd.DataFrame, schedule: pd.DataFrame, before_week: int) -> pd.DataFrame:
    allowed = final_team_weeks(schedule, before_week)
    if not allowed:
        return stats.iloc[0:0].copy()
    mask = [(team, int(week)) in allowed for team, week in zip(stats["team"], stats["week"])]
    return stats.loc[mask].copy()


def _current_roster(stats: pd.DataFrame) -> pd.DataFrame:
    if stats.empty:
        return stats
    order = stats.sort_values(["player_id", "week"])
    latest = order.groupby("player_id", as_index=False).tail(1)
    return latest[["player_id", "player_display_name", "pos", "team"]]


def player_pool(stats: pd.DataFrame) -> list[dict]:
    if stats.empty:
        return []
    current = _current_roster(stats).set_index("player_id")
    rows = []
    grouped = stats.groupby("player_id", sort=False)
    for player_id, frame in grouped:
        if player_id not in current.index:
            continue
        info = current.loc[player_id]
        team = info.team
        frame = frame[frame["team"] == team].sort_values("week")
        if frame.empty:
            continue
        games = int(len(frame))
        series = {}
        averages = {}
        for key, col in (
            ("passYds", "passing_yards"), ("rushYds", "rushing_yards"),
            ("rec", "receptions"), ("recYds", "receiving_yards"), ("td", "td"),
            ("attempts", "attempts"), ("carries", "carries"), ("targets", "targets"),
        ):
            values = [float(v or 0) for v in frame[col].fillna(0).tolist()]
            series[key] = values
            averages[key] = sum(values) / games
        rows.append({
            "id": str(player_id),
            "name": str(info.player_display_name),
            "pos": str(info.pos),
            "team": str(team),
            "games": games,
            "avg": averages,
            "series": series,
            "targets": float(frame["targets"].fillna(0).sum()),
            "carries": float(frame["carries"].fillna(0).sum()),
            "tds": float(frame["td"].fillna(0).sum()),
            "weeks": [int(w) for w in frame["week"].tolist()],
        })
    return rows


def _include(player: dict) -> bool:
    avg = player["avg"]
    volume = avg["attempts"] * player["games"] + player["carries"] + player["targets"]
    if player["games"] >= 3:
        return volume > 0
    return volume >= 8


def defense_factors(stats: pd.DataFrame) -> dict:
    """Shrunk allowed-per-game / league-per-game by position. No sample → null."""
    if stats.empty:
        return {}
    work = stats.copy()
    work["ppr"] = (
        work["receptions"].fillna(0)
        + work["receiving_yards"].fillna(0) / 10
        + work["rushing_yards"].fillna(0) / 10
        + work["passing_yards"].fillna(0) / 25
        + work["td"].fillna(0) * 6
    )
    metrics = {
        "passYds": "passing_yards",
        "rushYds": "rushing_yards",
        "recYds": "receiving_yards",
        "rec": "receptions",
        "td": "td",
        "ppr": "ppr",
    }
    game_pos = work.groupby(["opponent_team", "game_id", "pos"], as_index=False)[list(metrics.values())].sum()
    games_played = work.groupby("opponent_team")["game_id"].nunique().to_dict()
    league_games = int(work.groupby(["opponent_team", "game_id"]).ngroups) or 0
    league = {}
    for pos in POSITIONS:
        block = game_pos[game_pos["pos"] == pos]
        league[pos] = {}
        for label, col in metrics.items():
            league[pos][label] = float(block[col].sum()) / league_games if league_games else 0.0
    factors = {}
    for defense, n_games in games_played.items():
        factors[defense] = {}
        for pos in POSITIONS:
            block = game_pos[(game_pos["opponent_team"] == defense) & (game_pos["pos"] == pos)]
            entry = {"games": int(n_games)}
            for label, col in metrics.items():
                total = float(block[col].sum()) if len(block) else 0.0
                entry[label] = shrink_factor(total, n_games, league[pos][label])
                entry[f"{label}Allowed"] = round_num(total / n_games, 2) if n_games else None
                entry[f"{label}League"] = round_num(league[pos][label], 2)
            factors[defense][pos] = entry
    return factors


def team_scoring(schedule: pd.DataFrame, before_week: int) -> dict:
    rows = schedule[(schedule["week"] < before_week) & schedule["final"]]
    bucket = {abbr: {"points": [], "allowed": []} for abbr in TEAM_NAMES}
    for row in rows.itertuples(index=False):
        if row.away_team in bucket:
            bucket[row.away_team]["points"].append(float(row.away_score))
            bucket[row.away_team]["allowed"].append(float(row.home_score))
        if row.home_team in bucket:
            bucket[row.home_team]["points"].append(float(row.home_score))
            bucket[row.home_team]["allowed"].append(float(row.away_score))
    out = {}
    for abbr, item in bucket.items():
        n = len(item["points"])
        wins = sum(1 for pf, pa in zip(item["points"], item["allowed"]) if pf > pa)
        losses = sum(1 for pf, pa in zip(item["points"], item["allowed"]) if pf < pa)
        out[abbr] = {
            "games": n,
            "ppg": sum(item["points"]) / n if n else None,
            "papg": sum(item["allowed"]) / n if n else None,
            "record": f"{wins}-{losses}" if n else "",
        }
    return out


def inside5_shares(pbp: pd.DataFrame | None, stats: pd.DataFrame, before_week: int) -> dict[str, float] | None:
    if pbp is None or "rush_attempt" not in pbp.columns or "yardline_100" not in pbp.columns:
        return None
    ids = set(stats.loc[stats["pos"].isin(["RB"]), "player_id"].astype(str))
    rush = pbp[(pbp["season_type"] == "REG") & (pbp["week"] < before_week) & (pbp["rush_attempt"] == 1)]
    rush = rush[(rush["yardline_100"].notna()) & (rush["yardline_100"] <= 5) & rush["rusher_player_id"].notna()]
    if rush.empty:
        return {}
    rush = rush.copy()
    rush["rusher_player_id"] = rush["rusher_player_id"].astype(str)
    rush = rush[rush["rusher_player_id"].isin(ids)]
    if rush.empty:
        return {}
    counts = rush.groupby(["posteam", "rusher_player_id"]).size()
    shares = {}
    for team, group in counts.groupby(level=0):
        total = float(group.sum())
        if total <= 0:
            continue
        for (_, player_id), count in group.items():
            shares[str(player_id)] = float(count) / total
    for player_id in ids:
        shares.setdefault(player_id, 0.0)
    return shares


def _gl_role(share):
    if share is None:
        return None
    if share >= 0.45:
        return "primary"
    if share >= 0.20:
        return "shared"
    if share > 0:
        return "occasional"
    return "none"


def role_tables(players: list[dict], stats: pd.DataFrame, inside5: dict[str, float] | None):
    by_team: dict[str, list[dict]] = {}
    for player in players:
        by_team.setdefault(player["team"], []).append(player)
    team_weeks = stats.groupby("team")["week"].apply(lambda s: sorted(set(int(v) for v in s))).to_dict() if len(stats) else {}
    rb_rows, usage_rows, wr_rows = [], [], []
    for team, group in sorted(by_team.items()):
        recent = set(team_weeks.get(team, [])[-4:])
        rbs = [p for p in group if p["pos"] == "RB"]
        wrs = [p for p in group if p["pos"] == "WR"]
        rb_carries = sum(p["carries"] for p in rbs) or 0
        rb_targets = sum(p["targets"] for p in rbs) or 0
        recent_carries = {}
        recent_total = 0.0
        for player in rbs:
            total = 0.0
            for week, carries in zip(player["weeks"], player["series"]["carries"]):
                if week in recent:
                    total += carries
            recent_carries[player["id"]] = total
            recent_total += total
        rbs_sorted = sorted(rbs, key=lambda p: (-p["carries"], -p["targets"], p["name"]))
        for index, player in enumerate(rbs_sorted, start=1):
            if player["carries"] + player["targets"] <= 0:
                continue
            target_share = player["targets"] / rb_targets if rb_targets else 0.0
            recent_share = recent_carries[player["id"]] / recent_total if recent_total else 0.0
            inside = None if inside5 is None else inside5.get(player["id"])
            gl = _gl_role(inside)
            if recent_share >= 0.55:
                primary = "Workhorse"
            elif target_share >= 0.30 and recent_share < 0.40:
                primary = "Pass-catching back"
            elif recent_share < 0.12 and target_share < 0.15 and index > 1:
                primary = "Depth / minimal-use"
            else:
                primary = "Committee"
            secondary = []
            if target_share >= 0.25:
                secondary.append("3rd-down back")
            if gl == "primary":
                secondary.append("goal-line/short-yardage")
            rb_rows.append({
                "team": team,
                "name": player["name"],
                "sheetName": player["name"],
                "depth": f"RB{index}",
                "depthSrc": f"RB{index}",
                "primary": primary,
                "secondary": secondary,
                "glRole": gl,
                "glLabel": None if gl is None else gl,
                "glDetail": None if inside is None else f"inside-5 carry share {inside:.0%} of team RB inside-5 carries",
                "injury": "",
                "out": False,
                "statsMatched": True,
                "scatter": True,
            })
            usage_rows.append({
                "name": player["name"],
                "team": TEAM_NAMES.get(team, team),
                "targetShare": round_num(target_share, 2),
                "recentCarryShare": round_num(recent_share, 2),
                "inside5Share": None if inside is None else round_num(inside, 2),
                "injury": "",
            })
        wrs_sorted = sorted(wrs, key=lambda p: (-p["targets"], -p["avg"]["recYds"], p["name"]))
        rank = 0
        for player in wrs_sorted:
            if player["targets"] <= 0:
                continue
            rank += 1
            if rank > 3:
                break
            wr_rows.append({
                "team": TEAM_NAMES.get(team, team),
                "name": player["name"],
                "rank": f"WR{rank}",
                "slot": None,
                "alignment": "",
                "side": "",
            })
    return rb_rows, usage_rows, wr_rows


def _factor_for(factors, defense, pos, stat):
    if pos in {"WR", "TE"} and stat == "rushYds":
        return None
    if pos != "QB" and stat == "passYds":
        return None
    if pos == "QB" and stat in {"rec", "recYds"}:
        return None
    entry = factors.get(defense, {}).get(pos, {})
    return entry.get(stat)


def _lookup_scale(adjustments, pos, stat) -> float:
    if not adjustments:
        return 1.0
    try:
        value = float(adjustments.get("projection", {}).get(pos, {}).get(stat, 1.0))
    except (TypeError, ValueError):
        return 1.0
    if not math.isfinite(value):
        return 1.0
    return max(SCALE_LO, min(SCALE_HI, value))


def _td_scale(adjustments, pos) -> float:
    if not adjustments:
        return 1.0
    try:
        value = float(adjustments.get("tdLambda", {}).get(pos, 1.0))
    except (TypeError, ValueError):
        return 1.0
    if not math.isfinite(value):
        return 1.0
    return max(SCALE_LO, min(SCALE_HI, value))


def project_player(player, defense, factors, adjustments):
    projected = {}
    for stat in ("passYds", "rushYds", "rec", "recYds", "td"):
        if player["pos"] == "QB" and stat in {"rec", "recYds"}:
            continue
        if player["pos"] != "QB" and stat == "passYds":
            continue
        avg = player["avg"][stat]
        factor = _factor_for(factors, defense, player["pos"], stat)
        scale = _td_scale(adjustments, player["pos"]) if stat == "td" else _lookup_scale(adjustments, player["pos"], stat)
        places = 2 if stat == "td" else 1
        if factor is None:
            proj = avg * (scale if stat == "td" else 1.0)
            projected[stat] = [round_num(avg, places), round_num(proj, places), None]
        else:
            proj = avg * factor * scale
            projected[stat] = [round_num(avg, places), round_num(proj, places), round_num(factor, 2)]
    return projected


def implied_points(scoring, offense, defense):
    off = scoring.get(offense, {}).get("ppg")
    allowed = scoring.get(defense, {}).get("papg")
    if off is None or allowed is None:
        return None
    return 0.5 * (off + allowed)


def _td_allowed(stats: pd.DataFrame, defense: str) -> dict:
    block = stats[stats["opponent_team"] == defense]
    games = int(block["game_id"].nunique()) if len(block) else 0
    by_pos = {pos: int(round(float(block.loc[block["pos"] == pos, "td"].sum()))) for pos in POSITIONS}
    by_role = {pos: {} for pos in POSITIONS}
    if len(block):
        ranks = {}
        for team, group in stats.groupby("team"):
            for pos in POSITIONS:
                ordered = group[group["pos"] == pos].groupby("player_id")["targets"].sum().sort_values(ascending=False)
                for index, player_id in enumerate(ordered.index, start=1):
                    ranks[(team, str(player_id))] = (pos, index)
        for row in block.itertuples(index=False):
            pos, index = ranks.get((row.team, str(row.player_id)), (row.pos, 9))
            label = f"{pos}1" if index == 1 else f"{pos}2+"
            tds = int(round(float(row.td or 0)))
            if tds:
                by_role[pos][label] = by_role[pos].get(label, 0) + tds
    return {"games": games, "byPos": by_pos, "byRole": by_role}


def rules_for(path=None) -> dict:
    """Defaults, overridden by pipeline/td-rules.json when that file exists."""
    rules = dict(TD_RULES)
    if path is not None and Path(path).exists():
        import json
        loaded = json.loads(Path(path).read_text())
        rules.update({key: loaded[key] for key in loaded if key in rules or key == "probability"})
    return rules


def _band_scale(prob, adjustments) -> float:
    for band in (adjustments or {}).get("bands") or []:
        if band.get("lo") is None:
            continue
        if float(band["lo"]) <= float(prob) < float(band["hi"]):
            return float(band.get("scale") or 1)
    return 1.0


def display_scale(prob, tier, adjustments) -> float:
    """Tier and probability-band scales, with the product clipped to 0.90–1.10."""
    if not adjustments or prob is None:
        return 1.0
    tier_scale = float((adjustments.get("tiers") or {}).get(tier) or 1)
    combined = tier_scale * _band_scale(prob, adjustments)
    if not math.isfinite(combined):
        return 1.0
    return max(SCALE_LO, min(SCALE_HI, combined))


def _scaled(pick, tier, adjustments):
    if not pick or pick.get("modelProb") is None:
        return pick
    scale = display_scale(pick["modelProb"], tier, adjustments)
    if abs(scale - 1) < 0.005:
        return pick
    updated = dict(pick)
    updated["modelProb"] = round_num(max(0.01, min(0.95, float(pick["modelProb"]) * scale)), 3)
    return updated


def _multi_looks(top, offense, two, three, adjustments):
    looks = []
    rules = TD_RULES
    player, _lam, _anytime, _reason, role = top
    if two >= rules["upside2plusMinProb"]:
        looks.append(_scaled({**_pick(player, offense, "2+ TDs", two, "Same expected touchdowns, Poisson chance of two or more.", role), "flavor": "safer_2plus"}, "upside", adjustments))
    elif two >= rules["longShotMinProb"]:
        looks.append(_scaled({**_pick(player, offense, "2+ TDs", two, "Below the upside floor. Long shot, not a relatively safe or upside look.", role), "flavor": "long_shot"}, "longShot", adjustments))
    if three >= rules["upside3plusMinProb"]:
        looks.append(_scaled({**_pick(player, offense, "3+ TDs", three, "Same expected touchdowns, Poisson chance of three or more.", role), "flavor": "safer_3plus"}, "upside", adjustments))
    elif three >= rules["longShotMinProb"]:
        looks.append(_scaled({**_pick(player, offense, "3+ TDs", three, "Below the upside floor. Long shot, not a relatively safe or upside look.", role), "flavor": "long_shot"}, "longShot", adjustments))
    return looks


def _pick(player, team, prop, prob, reason, role):
    return {
        "player": player["name"],
        "team": team,
        "position": player["pos"],
        "role": role,
        "prop": prop,
        "modelProb": round_num(prob, 3),
        "price": None,
        "book": None,
        "estimate": player["games"] < 4,
        "reason": reason,
        "status": None,
    }


def touchdown_game(away, home, meta, players, factors, scoring, stats, adjustments):
    allowed = {
        away: _td_allowed(stats, home),
        home: _td_allowed(stats, away),
    }
    sides = []
    for offense, defense in ((away, home), (home, away)):
        roster = [p for p in players if p["team"] == offense and _include(p)]
        lambdas = []
        for player in roster:
            proj = project_player(player, defense, factors, {"projection": {}, "tdLambda": {}})
            td = proj.get("td")
            if not td or td[1] is None:
                continue
            lambdas.append((player, float(td[1])))
        implied = implied_points(scoring, offense, defense)
        implied_tds = None if implied is None else implied / 7
        total_lambda = sum(lam for _, lam in lambdas)
        team_scale = 1.0
        if implied_tds and total_lambda > 0:
            team_scale = max(0.75, min(1.25, implied_tds / total_lambda))
        learned = {pos: _td_scale(adjustments, pos) for pos in POSITIONS}
        tuned = []
        for player, lam in lambdas:
            tuned.append((player, lam * team_scale * learned[player["pos"]]))
        info = allowed[defense]
        rows = []
        skipped = []
        for pos in POSITIONS:
            group = [(player, lam) for player, lam in tuned if player["pos"] == pos and lam > 0]
            group.sort(key=lambda item: -item[1])
            if not group:
                skipped.append(pos)
                continue
            role_name = {player["id"]: f"{pos}{index}" for index, (player, _) in enumerate(group, start=1)}
            made = []
            for player, lam in group[:6]:
                anytime = poisson_at_least(lam, 1)
                reason = (
                    f"{player['tds']:.0f} rushing plus receiving TDs in {player['games']} games "
                    f"({lam:.2f} expected this week). {defense} allowed {info['byPos'].get(pos, 0)} {pos} TDs "
                    f"in {info['games']} games."
                )
                made.append((player, lam, anytime, reason, role_name[player["id"]]))
            made.sort(key=lambda item: -item[2])
            top = made[0]
            second = made[1] if len(made) > 1 and made[1][2] >= TD_RULES["relativelySafeMinProb"] else None
            backups = made[2:2 + TD_RULES["maxBackups"]] if second else made[1:1 + TD_RULES["maxBackups"]]
            upside = []
            two = poisson_at_least(top[1], 2)
            three = poisson_at_least(top[1], 3)
            upside.extend(_multi_looks(top, offense, two, three, adjustments))
            for player, lam, anytime, reason, role in backups:
                upside.append(_scaled({**_pick(player, offense, "Anytime TD", anytime, reason, role), "flavor": "backup_1td"}, "upside", adjustments))
            rows.append({
                "position": pos,
                "tdsAllowed": info["byPos"].get(pos, 0),
                "byRole": info["byRole"].get(pos) or {},
                "confident": _scaled(_pick(top[0], offense, "Anytime TD", top[2], top[3], top[4]), "confident", adjustments),
                "relativelySafe": None if second is None else _scaled(_pick(second[0], offense, "Anytime TD", second[2], second[3], second[4]), "relativelySafe", adjustments),
                "upside": upside,
            })
        rows.sort(key=lambda row: (-row["tdsAllowed"], row["position"]))
        sides.append({
            "offense": offense,
            "defense": defense,
            "impliedTeamPoints": round_num(implied, 1),
            "defenseGames": info["games"],
            "tdsAllowedByPosition": info["byPos"],
            "positionsSkipped": skipped,
            "rows": rows,
        })
    return {
        "game": f"{away} at {home}",
        "key": f"{away}@{home}",
        "espnEventId": meta.get("espn"),
        "kickoff": meta.get("kickoff"),
        "kickoffUtc": meta.get("kickoffUtc"),
        "line": None,
        "priceSnapshot": {
            "source": None,
            "url": None,
            "asOf": None,
            "playersPriced": 0,
            "note": "No price source available. Prices left blank.",
        },
        "sides": sides,
    }


def _market_values(player, stat):
    return player["series"][stat]


def _prop_leg(player, stat, defense):
    market = MARKET_OF[stat]
    proj = player["projected"][stat][1]
    if proj is None:
        return None
    minimum = MIN_LINE[market]
    line = math.floor(float(proj)) + 0.5
    if line < minimum:
        return None
    side = "Over" if float(proj) >= line else "Under"
    values = _market_values(player, stat)
    n = len(values)
    if n < 4:
        return None
    hits = sum(1 for value in values if (value > line if side == "Over" else value < line))
    prob = (hits + SHRINK_K / 2) / (n + SHRINK_K)
    prob = max(0.02, min(0.98, prob))
    edge = (float(proj) - line) / line * 100 if line else None
    season = f"{side} in {hits} of {n}"
    label = f"{player['name']} {side.lower()} {line:g} {market}"
    return {
        "id": f"prop:{name_key(player['name'])}:{market}:{side}:{line:g}",
        "kind": "prop",
        "player": player["name"],
        "team": player["team"],
        "pos": player["pos"],
        "market": market,
        "side": side,
        "line": line,
        "label": label,
        "card_label": f"{player['name']} · {side.lower()} {line:g} {market.replace('yds', 'yards').replace('Pass yards', 'passing yards').replace('Rush yards', 'rushing yards').replace('Rec yards', 'receiving yards')}",
        "p": round_num(prob, 3),
        "center": round_num(proj, 2),
        "center_kind": "mean",
        "season": season,
        "price": None,
        "book": None,
        "price_str": "No price in the snapshot",
        "asof": None,
        "priced": False,
        "market_p": None,
        "direction": side.lower(),
        "rating": int(round(prob * 100)),
        "flags": "",
        "confidence": "thin sample" if n < 6 else "",
        "model_edge_pct": round_num(edge, 1),
        "defense": defense,
    }


def _cards(legs):
    pool = sorted(legs, key=lambda leg: (-leg["p"], leg["player"], leg["market"]))[:14]
    cards = []
    used = set()

    def take(size, count, title):
        found = 0
        ranked = []
        for combo in itertools.combinations(pool, size):
            if len({leg["player"] for leg in combo}) < size:
                continue
            ratings = [leg["rating"] for leg in combo]
            score = round(0.65 * min(ratings) + 0.35 * (sum(ratings) / len(ratings)))
            ranked.append((score, math.prod(leg["p"] for leg in combo), combo))
        ranked.sort(key=lambda item: (-item[0], -item[1]))
        for score, _product, combo in ranked:
            signature = tuple(sorted(leg["id"] for leg in combo))
            if signature in used:
                continue
            used.add(signature)
            found += 1
            product = 1.0
            for leg in combo:
                product *= leg["p"]
            cards.append({
                "label": f"{title} {found}" if count > 1 else title,
                "score": int(score),
                "legs": [leg["id"] for leg in combo],
                "combined": round_num(product, 4),
                "independent": round_num(product, 4),
                "all_priced": False,
                "payout": None,
                "implied": None,
                "correlations": [],
            })
            if found >= count:
                return

    take(3, 2, "3-LEG PARLAY")
    take(2, 2, "2-LEG PARLAY")
    take(4, 1, "4-LEG PARLAY")
    return cards


def parlay_game(away, home, meta, players, scoring):
    legs = []
    for player in players:
        if player["team"] not in {away, home} or player["games"] < 4:
            continue
        defense = home if player["team"] == away else away
        stats = ["passYds"] if player["pos"] == "QB" else []
        if player["pos"] in {"QB", "RB"}:
            stats.append("rushYds")
        if player["pos"] in {"RB", "WR", "TE"}:
            stats.extend(["recYds", "rec"])
        for stat in stats:
            if stat not in player["projected"]:
                continue
            leg = _prop_leg(player, stat, defense)
            if leg:
                legs.append(leg)
    legs.sort(key=lambda leg: (-leg["p"], leg["team"], leg["player"]))
    off = scoring.get(away, {})
    home_s = scoring.get(home, {})
    away_pts = implied_points(scoring, away, home)
    home_pts = implied_points(scoring, home, away)
    margin = None if away_pts is None or home_pts is None else home_pts - away_pts
    favorite = None
    win_prob = None
    if margin is not None:
        favorite = home if margin >= 0 else away
        win_prob = 1 / (1 + math.exp(-abs(margin) / 3.5))
        for abbr, pts in ((away, away_pts), (home, home_pts)):
            record = scoring.get(abbr, {}).get("record") or ""
            legs.append({
                "id": f"ml:{abbr}",
                "kind": "ml",
                "player": f"{nickname(abbr)} moneyline",
                "team": abbr,
                "pos": "TEAM",
                "market": "ML",
                "side": "Yes",
                "line": None,
                "label": f"{nickname(abbr)} moneyline",
                "card_label": f"{nickname(abbr)} moneyline",
                "p": round_num(win_prob if abbr == favorite else 1 - win_prob, 3),
                "center": round_num(pts, 1),
                "center_kind": "implied points",
                "season": record,
                "price": None,
                "book": None,
                "price_str": "No price in the snapshot",
                "asof": None,
                "priced": False,
                "market_p": None,
                "direction": "over",
                "rating": int(round((win_prob if abbr == favorite else 1 - win_prob) * 100)),
                "flags": "",
            })
    prop_legs = [leg for leg in legs if leg["kind"] == "prop"]
    return {
        "game": f"{away}-{home}",
        "away": away,
        "home": home,
        "kickoff": meta.get("kickoff"),
        "snapshot": {"props_asof": None, "game_asof": None, "fetched_at": None, "note": "No price source available. Prices left blank."},
        "dashboard": {
            "favorite": favorite,
            "margin": round_num(abs(margin), 1) if margin is not None else None,
            "win_prob_model": round_num(win_prob, 4) if win_prob is not None else None,
            "awayPoints": round_num(away_pts, 1),
            "homePoints": round_num(home_pts, 1),
            "note": "Win chance is a logistic of the season-scoring margin, not a sportsbook price.",
        },
        "market": None,
        "resolved": [],
        "gaps": ["No sportsbook snapshot. Player and moneyline prices were left blank."],
        "dropped": [],
        "legs": legs,
        "safe_overlap_cards": _cards(prop_legs),
        "corr": {},
        "scoringRecord": {"away": off.get("record"), "home": home_s.get("record")},
    }


def _kickoff(row):
    day = str(row.gameday)
    clock = str(row.gametime or "12:00")[:5]
    local = datetime.strptime(f"{day} {clock}", "%Y-%m-%d %H:%M").replace(tzinfo=ET)
    label = local.strftime("%a %b ") + str(local.day) + local.strftime(", ") + local.strftime("%I:%M %p").lstrip("0") + " ET"
    espn = getattr(row, "espn", None)
    if espn is not None and not (isinstance(espn, float) and math.isnan(espn)):
        espn = str(int(espn)) if isinstance(espn, float) else str(espn)
    else:
        espn = None
    return {
        "kickoff": label,
        "kickoffUtc": local.astimezone(UTC).strftime("%Y-%m-%dT%H:%MZ"),
        "espn": espn,
        "sort": local.isoformat(),
    }


def _season_slice(stats, schedule, pbp, season: int):
    if "season" in schedule.columns:
        schedule = schedule[schedule["season"] == season]
    if "game_type" in schedule.columns:
        schedule = schedule[schedule["game_type"] == "REG"]
    if stats is not None and "season" in stats.columns:
        stats = stats[stats["season"] == season]
    if stats is not None and "season_type" in stats.columns:
        stats = stats[stats["season_type"].isin(["REG", "reg"])]
    if pbp is not None and len(pbp) and "season" in pbp.columns:
        pbp = pbp[pbp["season"] == season]
    return stats, schedule, pbp


def build_week(stats, schedule, pbp, season: int, week: int, adjustments=None):
    adjustments = adjustments or {}
    stats, schedule, pbp = _season_slice(stats, schedule, pbp, season)
    stats, schedule, pbp = prepare(stats, schedule, pbp)
    slate = schedule[schedule["week"] == week].copy()
    hist = history_stats(stats, schedule, week)
    factors = defense_factors(hist)
    scoring = team_scoring(schedule, week)
    players = [p for p in player_pool(hist) if _include(p)]
    inside = inside5_shares(pbp, hist, week)
    rb_rows, usage_rows, wr_rows = role_tables(players, hist, inside)
    games = []
    for row in slate.sort_values(["gameday", "gametime", "away_team"]).itertuples(index=False):
        away, home = row.away_team, row.home_team
        if not away or not home:
            continue
        games.append((away, home, _kickoff(row)))
    scatter_games = {}
    td_games = []
    parlay_games = {}
    coverage_games = {}
    for away, home, meta in games:
        key = f"{away}-{home}"
        projected = []
        for player in players:
            if player["team"] not in {away, home}:
                continue
            defense = home if player["team"] == away else away
            projected = project_player(player, defense, factors, adjustments)
            try:
                from nflboard.qb_starters import starter_for, scale_projection
                spec = starter_for(season, week, player["team"])
                if spec:
                    projected = scale_projection(player, projected, spec)
            except Exception:
                pass
            player = {**player, "projected": projected}
            projected.append(player)
            stat_map = {}
            for stat, triple in player["projected"].items():
                stat_map[stat] = triple
            scatter_games.setdefault(key, {"players": []})
            scatter_games[key]["players"].append({
                "n": player["name"],
                "p": player["pos"],
                "t": player["team"],
                "o": defense,
                "g": player["games"],
                "s": stat_map,
                **({"uncertain": True} if player["games"] < 3 else {}),
            })
        td_games.append(touchdown_game(away, home, meta, projected, factors, scoring, hist, adjustments))
        parlay_games[key] = parlay_game(away, home, meta, projected, scoring)
        coverage_games[key] = {"offenses": {
            away: {"defense": home, "mix": None, "mixNote": "unavailable"},
            home: {"defense": away, "mix": None, "mixNote": "unavailable"},
        }}
    defense_file = {"source": _source(season, week, adjustments), "defenses": {}}
    for abbr, pos_map in sorted(factors.items()):
        defense_file["defenses"][abbr] = {}
        for pos, entry in pos_map.items():
            defense_file["defenses"][abbr][pos] = {
                "pprAllowedPerGame": entry.get("pprAllowed"),
                "leaguePprPerGame": entry.get("pprLeague"),
                "pprFactor": round_num(entry.get("ppr"), 3),
                "rushYdsFactor": None if pos in {"WR", "TE"} else round_num(entry.get("rushYds"), 3),
                "rushYdsAllowedPerGame": None if pos in {"WR", "TE"} else entry.get("rushYdsAllowed"),
                "recYdsFactor": None if pos == "QB" else round_num(entry.get("recYds"), 3),
                "recYdsAllowedPerGame": None if pos == "QB" else entry.get("recYdsAllowed"),
                "passYdsFactor": round_num(entry.get("passYds"), 3) if pos == "QB" else None,
                "passYdsAllowedPerGame": entry.get("passYdsAllowed") if pos == "QB" else None,
                "tdFactor": round_num(entry.get("td"), 3),
            }
    through = week - 1
    return {
        "scatter": {
            "source": _source(season, week, adjustments),
            "week": week,
            "games": scatter_games,
        },
        "defense": defense_file,
        "td": {
            "season": season,
            "week": week,
            "disclaimer": "Model estimates for entertainment only, not betting advice. Prices are left blank when no snapshot is available.",
            "rules": TD_RULES,
            "games": td_games,
        },
        "parlays": {
            "week": week,
            "version": 2,
            "disclaimer": "Model estimates. No sportsbook prices were available, so every price is blank. Entertainment, not advice.",
            "method": (
                "Legs sit on the pipeline projection, on the side of a half-point line the projection favors. "
                "Hit chances are the player's own prior games on that side, shrunk toward one half. "
                "Prices are blank."
            ),
            "rules": {"min_games": 4, "min_line": MIN_LINE, "prices": "blank unless a saved snapshot is merged in"},
            "games": parlay_games,
        },
        "coverage": {
            "week": week,
            "estimate": True,
            "unavailable": "nflverse has no 2026 participation file, so coverage mixes are left blank rather than copied from another season.",
            "coverages": [
                {"key": "COVER_0", "label": "Cover 0", "scheme": "man"},
                {"key": "COVER_1", "label": "Cover 1", "scheme": "man"},
                {"key": "2_MAN", "label": "2-Man", "scheme": "man"},
                {"key": "COVER_2", "label": "Cover 2", "scheme": "zone"},
                {"key": "COVER_3", "label": "Cover 3", "scheme": "zone"},
                {"key": "COVER_4", "label": "Cover 4", "scheme": "zone"},
                {"key": "COVER_6", "label": "Cover 6", "scheme": "zone"},
            ],
            "games": coverage_games,
        },
        "snapshot": {
            "week": week,
            "source": "No price source available. Cards are not invented.",
            "games": {},
        },
        "roles": {"rb": rb_rows, "usage": usage_rows, "wr": wr_rows},
        "throughWeek": through,
        "slate": [f"{away}@{home}" for away, home, _ in games],
    }


def _source(season, week, adjustments):
    scaled = " Learning scales from the prior week are applied within ±10%." if adjustments else ""
    return (
        f"nflverse player stats and schedule, {season} regular season, weeks before {week}. "
        f"Projection = current-team per-game average × shrunk defense factor (k={int(SHRINK_K)}, capped {FACTOR_LO}–{FACTOR_HI}). "
        f"Touchdowns are rushing plus receiving, not passing. No sportsbook prices.{scaled}"
    )


def game_has_price(game: dict) -> bool:
    if not isinstance(game, dict):
        return False
    for leg in game.get("legs") or []:
        if leg.get("priced") or leg.get("price") not in (None, "", 0):
            if leg.get("price") not in (None, ""):
                return True
    for side in game.get("sides") or []:
        for row in side.get("rows") or []:
            picks = []
            for slot in ("confident", "relativelySafe"):
                if row.get(slot):
                    picks.append(row[slot])
            picks.extend(row.get("upside") or [])
            for pick in picks:
                if isinstance(pick, dict) and pick.get("price") not in (None, ""):
                    return True
    return False


def score_week(scatter, td_board, coverage, td_coverage, wr_rows, stats, schedule, season, week, partial_prior=40, prior_rollup=None):
    """Compare published projections to actuals for final games. Does not invent missing actuals."""
    stats, schedule, _ = _season_slice(stats, schedule, None, season)
    stats, schedule, _ = prepare(stats, schedule, None)
    finals = schedule[(schedule["week"] == week) & schedule["final"]]
    final_keys = {f"{row.away_team}-{row.home_team}" for row in finals.itertuples(index=False)}
    actual = stats[stats["week"] == week]
    actual_map = {}
    for row in actual.itertuples(index=False):
        actual_map[(name_key(row.player_display_name), row.team)] = row
    slot_of = {}
    for row in wr_rows or []:
        team = row.get("team") or ""
        slot_of[(name_key(row.get("name")), team)] = row.get("slot")
    rows = []
    games = (scatter or {}).get("games") or {}
    for key, game in games.items():
        if key not in final_keys:
            continue
        for player in game.get("players") or []:
            act = actual_map.get((name_key(player.get("n")), player.get("t")))
            if act is None:
                continue
            actual_td = float(getattr(act, "rushing_tds", 0) or 0) + float(getattr(act, "receiving_tds", 0) or 0)
            actuals = {
                "passYds": float(getattr(act, "passing_yards", 0) or 0),
                "rushYds": float(getattr(act, "rushing_yards", 0) or 0),
                "recYds": float(getattr(act, "receiving_yards", 0) or 0),
                "rec": float(getattr(act, "receptions", 0) or 0),
                "td": actual_td,
            }
            full_team = TEAM_NAMES.get(player.get("t"), "")
            slot = slot_of.get((name_key(player.get("n")), full_team))
            for stat, triple in (player.get("s") or {}).items():
                if stat not in actuals or not triple or triple[1] is None:
                    continue
                pred = float(triple[1])
                rows.append({
                    "pos": player.get("p"), "stat": stat, "pred": pred, "actual": actuals[stat],
                    "slot": slot, "name": player.get("n"), "team": player.get("t"), "game": key,
                })
    by_stat = _group_error(rows)
    td_rows = [row for row in rows if row["stat"] == "td"]
    poisson = _poisson_block(td_rows)
    tiers = _tier_block(td_board, final_keys, actual_map)
    slots = _slot_block(td_rows)
    coverage_block = _coverage_block(td_rows, coverage, td_coverage, final_keys)
    prior = partial_prior if len(final_keys) < _slate_count(schedule, season, week) else 20
    fresh = _fresh_rollup(rows, tiers, poisson, week)
    rollup = add_rollups(prior_rollup, fresh)
    adjustments = scales_from_rollup(rollup, prior, coverage_block["damp"])
    partial = len(final_keys) < _slate_count(schedule, season, week)
    lines = _lines(week, len(final_keys), _slate_count(schedule, season, week), by_stat, poisson, tiers, slots, coverage_block, adjustments, partial)
    if rollup.get("weeks") and len(rollup["weeks"]) < 3:
        lines.append(
            "Tier and probability-band scales use a small finished sample so far, including the Week 12 games. "
            "They stay inside 10% and carry forward when the next week is scored."
        )
    return {
        "season": season,
        "week": week,
        "partial": partial,
        "gamesScored": len(final_keys),
        "gamesOnSlate": _slate_count(schedule, season, week),
        "matchedPlayers": len({(row["name"], row["team"], row["game"]) for row in rows}),
        "byStat": {f"{pos}:{stat}": item for (pos, stat), item in sorted(by_stat.items())},
        "touchdowns": {"anytime": poisson, "byTier": tiers, "bySlot": slots},
        "coverage": coverage_block,
        "adjustments": adjustments,
        "rollup": rollup,
        "lines": lines,
        "note": (
            "Scored only where a final score and a player stat row both exist. "
            "The rollup adds this week to every earlier calibration. "
            "Scales shrink toward 1 and are clipped to 0.90–1.10. They feed the next week, not this one."
        ),
    }


def _fresh_rollup(rows, tiers, poisson, week):
    by_stat = {}
    for row in rows:
        key = f"{row['pos']}:{row['stat']}"
        bucket = by_stat.setdefault(key, {"n": 0, "sumPred": 0.0, "sumActual": 0.0, "sumAbs": 0.0})
        bucket["n"] += 1
        bucket["sumPred"] += float(row["pred"])
        bucket["sumActual"] += float(row["actual"])
        bucket["sumAbs"] += abs(float(row["actual"]) - float(row["pred"]))
    tier_roll = {}
    for name, item in (tiers or {}).items():
        n = int(item.get("n") or 0)
        predicted = item.get("predicted")
        tier_roll[name] = {
            "n": n,
            "hits": int(item.get("hits") or 0),
            "sumPred": float(predicted) * n if predicted is not None and n else 0.0,
        }
    bands = []
    for band in poisson.get("bins") or []:
        n = int(band.get("n") or 0)
        bands.append({
            "lo": band["lo"], "hi": band["hi"], "n": n,
            "hits": int(band.get("hits") if band.get("hits") is not None else round((band.get("actual") or 0) * n)),
            "sumPred": float(band["sumPred"]) if band.get("sumPred") is not None else float(band.get("predicted") or 0) * n,
        })
    return {"weeks": [week], "byStat": by_stat, "tiers": tier_roll, "bands": bands}


def add_rollups(prior, fresh):
    if not prior:
        return fresh
    if not fresh:
        return prior
    by_stat = {}
    for source in (prior.get("byStat") or {}, fresh.get("byStat") or {}):
        for key, item in source.items():
            bucket = by_stat.setdefault(key, {"n": 0, "sumPred": 0.0, "sumActual": 0.0, "sumAbs": 0.0})
            for field in bucket:
                bucket[field] += item.get(field) or 0
    tiers = {}
    names = set((prior.get("tiers") or {}) | (fresh.get("tiers") or {}))
    for name in names:
        left = (prior.get("tiers") or {}).get(name) or {}
        right = (fresh.get("tiers") or {}).get(name) or {}
        tiers[name] = {
            "n": (left.get("n") or 0) + (right.get("n") or 0),
            "hits": (left.get("hits") or 0) + (right.get("hits") or 0),
            "sumPred": (left.get("sumPred") or 0) + (right.get("sumPred") or 0),
        }
    bands = []
    for lo, hi in ((0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 1.01)):
        left = next((band for band in prior.get("bands") or [] if band.get("lo") == lo), {})
        right = next((band for band in fresh.get("bands") or [] if band.get("lo") == lo), {})
        n = (left.get("n") or 0) + (right.get("n") or 0)
        if not n:
            continue
        bands.append({
            "lo": lo, "hi": min(hi, 1), "n": n,
            "hits": (left.get("hits") or 0) + (right.get("hits") or 0),
            "sumPred": (left.get("sumPred") or 0) + (right.get("sumPred") or 0),
        })
    weeks = list(prior.get("weeks") or []) + [week for week in fresh.get("weeks") or [] if week not in (prior.get("weeks") or [])]
    return {"weeks": weeks, "byStat": by_stat, "tiers": tiers, "bands": bands}


def scales_from_rollup(rollup, prior, coverage_damp):
    adjustments = {"projection": {}, "tdLambda": {}, "tiers": {}, "bands": [], "coverageDamp": coverage_damp}
    for key, item in (rollup.get("byStat") or {}).items():
        pos, stat = key.split(":", 1)
        if stat == "td":
            ratio = item["sumActual"] / item["sumPred"] if item["sumPred"] else None
            adjustments["tdLambda"][pos] = round_num(bounded_scale(ratio, item["n"], prior=prior), 3)
            continue
        ratio = item["sumActual"] / item["sumPred"] if item["sumPred"] else None
        adjustments["projection"].setdefault(pos, {})[stat] = round_num(bounded_scale(ratio, item["n"], prior=prior), 3)
    for pos in POSITIONS:
        adjustments["tdLambda"].setdefault(pos, 1.0)
    for name, item in (rollup.get("tiers") or {}).items():
        n = item.get("n") or 0
        ratio = (item.get("hits") or 0) / item["sumPred"] if item.get("sumPred") else None
        adjustments["tiers"][name] = round_num(bounded_scale(ratio, n, prior=max(prior, 30)), 3)
    for band in rollup.get("bands") or []:
        n = band.get("n") or 0
        ratio = (band.get("hits") or 0) / band["sumPred"] if band.get("sumPred") else None
        adjustments["bands"].append({
            "lo": band["lo"], "hi": band["hi"],
            "scale": round_num(bounded_scale(ratio, n, prior=max(prior, 30)), 3),
        })
    return adjustments


def _slate_count(schedule, season, week):
    rows = schedule[schedule["week"] == week] if "week" in schedule.columns else schedule
    return int(len(rows))


def _group_error(rows):
    grouped = {}
    for row in rows:
        if row["stat"] == "td":
            continue
        key = (row["pos"], row["stat"])
        grouped.setdefault(key, []).append(row)
    out = {}
    for key, items in grouped.items():
        err = [item["actual"] - item["pred"] for item in items]
        out[key] = {
            "n": len(items),
            "mae": round_num(sum(abs(v) for v in err) / len(err), 2),
            "bias": round_num(sum(err) / len(err), 2),
            "meanPred": round_num(sum(item["pred"] for item in items) / len(items), 2),
            "meanActual": round_num(sum(item["actual"] for item in items) / len(items), 2),
            "clearedProjection": round_num(sum(1 for item in items if item["actual"] >= item["pred"]) / len(items), 3),
        }
    return out


def _poisson_block(td_rows):
    if not td_rows:
        return {"n": 0, "predictedRate": None, "actualRate": None, "brier": None, "bins": []}
    pairs = []
    for row in td_rows:
        prob = poisson_at_least(max(0.0, row["pred"]), 1)
        hit = 1 if row["actual"] >= 1 else 0
        pairs.append((prob, hit))
    brier = sum((prob - hit) ** 2 for prob, hit in pairs) / len(pairs)
    bins = []
    for lo, hi in ((0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 1.01)):
        group = [(prob, hit) for prob, hit in pairs if lo <= prob < hi]
        if not group:
            continue
        bins.append({
            "lo": lo, "hi": min(hi, 1), "n": len(group),
            "hits": int(sum(hit for _, hit in group)),
            "sumPred": float(sum(prob for prob, _ in group)),
            "predicted": round_num(sum(prob for prob, _ in group) / len(group), 3),
            "actual": round_num(sum(hit for _, hit in group) / len(group), 3),
        })
    return {
        "n": len(pairs),
        "predictedRate": round_num(sum(prob for prob, _ in pairs) / len(pairs), 3),
        "actualRate": round_num(sum(hit for _, hit in pairs) / len(pairs), 3),
        "brier": round_num(brier, 4),
        "bins": bins,
    }


def _tier_block(td_board, final_keys, actual_map):
    counts = {name: {"n": 0, "hits": 0, "predicted": 0.0} for name in ("confident", "relativelySafe", "upside")}
    games = td_board.get("games") if isinstance(td_board, dict) else None
    if isinstance(games, dict):
        game_list = [{"key": key.replace("-", "@"), **value} for key, value in games.items()]
    else:
        game_list = games or []
    for game in game_list:
        key = str(game.get("key") or "").replace("@", "-")
        if key not in final_keys:
            continue
        for side in game.get("sides") or []:
            for row in side.get("rows") or []:
                for tier, picks in (
                    ("confident", [row.get("confident")] if row.get("confident") else []),
                    ("relativelySafe", [row.get("relativelySafe")] if row.get("relativelySafe") else []),
                    ("upside", [pick for pick in (row.get("upside") or []) if pick and pick.get("prop") == "Anytime TD"]),
                ):
                    for pick in picks:
                        if not pick or pick.get("prop") not in (None, "Anytime TD"):
                            continue
                        act = actual_map.get((name_key(pick.get("player")), pick.get("team")))
                        if act is None:
                            continue
                        tds = float(getattr(act, "rushing_tds", 0) or 0) + float(getattr(act, "receiving_tds", 0) or 0)
                        counts[tier]["n"] += 1
                        counts[tier]["hits"] += 1 if tds >= 1 else 0
                        counts[tier]["predicted"] += float(pick.get("modelProb") or 0)
    for item in counts.values():
        item["predicted"] = round_num(item["predicted"] / item["n"], 3) if item["n"] else None
    return counts


def _slot_block(td_rows):
    groups = {"slot": [], "boundary": [], "unknown": []}
    for row in td_rows:
        if row["pos"] != "WR":
            continue
        slot = row["slot"]
        key = "unknown" if slot is None else "slot" if slot else "boundary"
        groups[key].append(row)
    out = {}
    for key, items in groups.items():
        if not items:
            out[key] = {"n": 0, "hits": 0, "predicted": None}
            continue
        hits = sum(1 for row in items if row["actual"] >= 1)
        pred = sum(poisson_at_least(max(0.0, row["pred"]), 1) for row in items) / len(items)
        out[key] = {"n": len(items), "hits": hits, "predicted": round_num(pred, 3)}
    return out


def _man_share(mix):
    if not mix:
        return None
    return sum(float(mix.get(key) or 0) for key in ("COVER_0", "COVER_1", "2_MAN"))


def _coverage_block(td_rows, coverage, td_coverage, final_keys):
    players = (td_coverage or {}).get("players") or {}
    games = (coverage or {}).get("games") or {}
    league_shares = []
    for game in games.values():
        for offense in (game.get("offenses") or {}).values():
            share = _man_share(offense.get("mix"))
            if share is not None:
                league_shares.append(share)
    league = sum(league_shares) / len(league_shares) if league_shares else None
    base_brier, adj_brier, n = 0.0, 0.0, 0
    if league is None or not players:
        return {"compared": 0, "brierBase": None, "brierAdjusted": None, "helped": None, "damp": 1}
    for row in td_rows:
        if row["game"] not in final_keys or row["pos"] == "QB":
            continue
        sample = players.get(f"{name_key(row['name'])}|{row['pos']}")
        mix = (((games.get(row["game"]) or {}).get("offenses") or {}).get(row["team"]) or {}).get("mix")
        man = _man_share(mix)
        if not sample or man is None:
            continue
        lam = max(0.0, row["pred"])
        base = poisson_at_least(lam, 1)
        m_adj = _coverage_madj(sample, man, 1 - man, league, 1 - league, row["pos"], mix_note=(((games.get(row["game"]) or {}).get("offenses") or {}).get(row["team"]) or {}).get("mixNote"))
        adjusted = poisson_at_least(lam * m_adj, 1)
        hit = 1 if row["actual"] >= 1 else 0
        base_brier += (base - hit) ** 2
        adj_brier += (adjusted - hit) ** 2
        n += 1
    if n < 12:
        return {"compared": n, "brierBase": round_num(base_brier / n, 4) if n else None, "brierAdjusted": round_num(adj_brier / n, 4) if n else None, "helped": None, "damp": 1}
    base_mean = base_brier / n
    adj_mean = adj_brier / n
    helped = adj_mean < base_mean
    if base_mean <= 0 or helped:
        damp = 1.0
    else:
        worse = (adj_mean - base_mean) / base_mean
        damp = max(0.5, min(1.0, 1 - worse))
    return {
        "compared": n,
        "brierBase": round_num(base_mean, 4),
        "brierAdjusted": round_num(adj_mean, 4),
        "helped": helped,
        "damp": round_num(damp, 3),
    }


def _coverage_madj(sample, man_def, zone_def, man_lg, zone_lg, position, mix_note=None):
    idx_man = float(sample.get("idxMan") or 1)
    idx_zone = float(sample.get("idxZone") or 1)
    denom = man_lg * idx_man + zone_lg * idx_zone
    m_raw = 1 if denom == 0 else (man_def * idx_man + zone_def * idx_zone) / denom
    m = m_raw
    if position == "RB":
        rec = float(sample.get("recTd2025") or 0)
        rush = float(sample.get("rushTd2025") or 0)
        share = (rec + 0.5) / (rec + rush + 2.5)
        m = 1 + share * (m_raw - 1)
    deviation = 0.5 * (m - 1)
    if mix_note == "clipped":
        deviation *= 0.5
    return min(1.1, max(0.9, 1 + deviation))


def _lines(week, scored, slate, by_stat, poisson, tiers, slots, coverage, adjustments, partial):
    state = f"{scored} of {slate} games final" if partial else f"{scored} games"
    lines = [f"Week {week} check ({state})."]
    if poisson.get("n"):
        lines.append(
            f"Anytime chance from expected touchdowns: predicted {poisson['predictedRate']:.0%} "
            f"versus actual {poisson['actualRate']:.0%} on {poisson['n']} players (Brier {poisson['brier']})."
        )
    tier_bits = []
    for name, label in (("confident", "confident"), ("relativelySafe", "relatively safe"), ("upside", "upside")):
        item = tiers.get(name) or {}
        if item.get("n"):
            tier_bits.append(f"{label} {item['hits']}/{item['n']}")
    if tier_bits:
        lines.append("Touchdown-board tiers that scored: " + ", ".join(tier_bits) + ".")
    slot_bits = []
    for key, label in (("slot", "slot"), ("boundary", "boundary"), ("unknown", "slot unknown")):
        item = (slots or {}).get(key) or {}
        if item.get("n"):
            slot_bits.append(f"{label} {item['hits']}/{item['n']}")
    if slot_bits:
        lines.append("Receiver touchdowns by listed slot: " + ", ".join(slot_bits) + ".")
    for stat, label in (("recYds", "Receiving yards"), ("rec", "Receptions"), ("rushYds", "Rushing yards"), ("passYds", "Passing yards")):
        pieces = []
        for pos in POSITIONS:
            item = by_stat.get((pos, stat))
            if item and item["n"] >= 8:
                pieces.append(f"{pos} bias {item['bias']:+.1f} (n={item['n']})")
        if pieces:
            lines.append(f"{label}: " + "; ".join(pieces) + ". Bias is actual minus projection.")
    if poisson.get("bins"):
        bits = [f"{int(b['lo']*100)}–{int(b['hi']*100)}% predicted {b['predicted']:.0%} actual {b['actual']:.0%} (n={b['n']})" for b in poisson["bins"]]
        lines.append("Poisson bins: " + "; ".join(bits) + ".")
    if coverage.get("compared"):
        if coverage.get("brierBase") is None:
            lines.append("Coverage multiplier was not compared.")
        else:
            lines.append(
                f"Coverage multiplier Brier {coverage['brierAdjusted']} versus {coverage['brierBase']} without it "
                f"on {coverage['compared']} players."
            )
    scales = []
    for pos, stats in (adjustments.get("projection") or {}).items():
        for stat, value in stats.items():
            if value and abs(value - 1) >= 0.005:
                scales.append(f"{pos} {stat} ×{value:.2f}")
    for pos, value in (adjustments.get("tdLambda") or {}).items():
        if value and abs(value - 1) >= 0.005:
            scales.append(f"{pos} TDs ×{value:.2f}")
    if scales:
        lines.append("Next week uses bounded scales: " + ", ".join(scales) + ".")
    else:
        lines.append("Next week's scales stay at 1.00. The sample is shrunk toward no change and clipped within 10%.")
    damp = (adjustments.get("coverageDamp") or 1)
    if damp < 0.999:
        lines.append(f"Coverage adjustments on the next week are damped to {damp:.2f} of the usual move.")
    return lines


def select_weeks(schedule: pd.DataFrame, season: int, today: datetime | None = None) -> dict:
    """Tuesday builds the upcoming week. Thursday and Sunday refresh the open week and the next one."""
    today = today.astimezone(ET) if today else datetime.now(ET)
    rows = schedule[(schedule["season"] == season) & (schedule["game_type"] == "REG")].copy()
    rows["final"] = rows["away_score"].notna() & rows["home_score"].notna()
    weeks = sorted(int(w) for w in rows["week"].unique())
    incomplete = [week for week in weeks if not bool(rows.loc[rows["week"] == week, "final"].all())]
    current = incomplete[0] if incomplete else (weeks[-1] if weeks else None)
    if current is None:
        raise SystemExit(f"No {season} regular-season schedule in the nflverse games file.")
    nxt = current + 1 if (current + 1) in weeks else None
    weekday = today.weekday()  # Monday is 0
    if weekday == 1:
        targets = [current]
    else:
        targets = [current] + ([nxt] if nxt else [])
    return {"current": current, "next": nxt, "targets": targets, "weekday": today.strftime("%A")}
