"""Offensive momentum crossed with the upcoming defense.

One calculation for quarterbacks, running backs, and receivers. Every input
is from weeks before the game. The offensive nudge stays inside 5%. The
net nudge, after the defense, stays inside 8%.
"""
from __future__ import annotations

import math

from nflboard.logic import defense_factors, history_stats, player_pool, prepare, project_player, round_num

HALF_LIFE = 3.0
OFFENSE_CAP = 0.05
DEFENSE_CAP = 0.05
NET_CAP = 0.08
STEP = 0.01
PER_Z = 0.02
MIN_GAMES = 4
PRIMARY = {"QB": "passYds", "RB": "rushYds", "WR": "recYds", "TE": "recYds"}
COMPONENTS = {
    "QB": (("passYds", "volume", None), ("ypa", "rate", "attempts")),
    "RB": (("rushYds", "volume", None), ("ypc", "rate", "carries")),
    "WR": (("rec", "volume", None), ("targets", "volume", None), ("recYds", "volume", None), ("ypt", "rate", "targets")),
    "TE": (("rec", "volume", None), ("targets", "volume", None), ("recYds", "volume", None), ("ypt", "rate", "targets")),
}
TYPICAL = {"attempts": 28.0, "carries": 12.0, "targets": 6.0}
POSITIONS = ("QB", "RB", "WR", "TE")


def _mean(values):
    values = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    if not values:
        return None
    return sum(values) / len(values)


def _std(values):
    values = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    if len(values) < 2:
        return None
    mu = sum(values) / len(values)
    return math.sqrt(sum((v - mu) ** 2 for v in values) / (len(values) - 1))


def decay_weights(count: int, half_life: float = HALF_LIFE) -> list[float]:
    """Most recent game is last and weighs the most. Half the weight every `half_life` games."""
    return [0.5 ** ((count - 1 - index) / half_life) for index in range(count)]


def trend_z(values, half_life: float = HALF_LIFE):
    """Decayed recent level versus this player's own prior-game average, in standard deviations."""
    clean = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    if len(clean) < MIN_GAMES:
        return None
    mu = sum(clean) / len(clean)
    sd = _std(clean)
    if not sd:
        return 0.0
    weights = decay_weights(len(clean), half_life)
    ewma = sum(weight * value for weight, value in zip(weights, clean)) / sum(weights)
    return (ewma - mu) / sd


def step_gap(z, cap=OFFENSE_CAP, per_z=PER_Z, step=STEP) -> float:
    if z is None or not math.isfinite(float(z)):
        return 0.0
    raw = max(-cap, min(cap, float(z) * per_z))
    snapped = round(raw / step) * step
    return max(-cap, min(cap, snapped))


def combine_z(series: dict) -> float | None:
    pieces = []
    weights = []
    for key, kind, volume_key in COMPONENTS[series["position"]]:
        zed = trend_z(series.get(key) or [])
        if zed is None:
            continue
        if kind == "rate":
            volume = _mean((series.get(volume_key) or [])[-3:])
            weight = 0.0 if volume is None else min(1.0, volume / TYPICAL[volume_key])
        else:
            weight = 1.0
        if weight <= 0:
            continue
        pieces.append(zed)
        weights.append(weight)
    if not weights:
        return None
    return sum(weight * piece for weight, piece in zip(weights, pieces)) / sum(weights)


def momentum_multiple(series: dict) -> float:
    return round(1 + step_gap(combine_z(series)), 2)


def defense_multiple(factor, allowed_trend) -> float:
    """Blend the shrunk season factor with the defense's own recent trend. Result stays inside 5%."""
    level = 0.0 if factor is None else max(-DEFENSE_CAP, min(DEFENSE_CAP, 0.5 * (float(factor) - 1)))
    trend = step_gap(allowed_trend, DEFENSE_CAP)
    blended = max(-DEFENSE_CAP, min(DEFENSE_CAP, 0.5 * level + 0.5 * trend))
    snapped = round(blended / STEP) * STEP
    return round(1 + max(-DEFENSE_CAP, min(DEFENSE_CAP, snapped)), 2)


def net_multiple(offense: float, defense: float) -> float:
    gap = (float(offense) - 1) + (float(defense) - 1)
    snapped = round(gap / STEP) * STEP
    snapped = max(-NET_CAP, min(NET_CAP, snapped))
    return round(1 + snapped, 2)


def _num(row, name) -> float:
    value = getattr(row, name, 0)
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return 0.0
    return float(value)


def game_stats(row) -> dict:
    attempts = _num(row, "attempts")
    carries = _num(row, "carries")
    targets = _num(row, "targets")
    pass_yds = _num(row, "passing_yards")
    rush_yds = _num(row, "rushing_yards")
    rec_yds = _num(row, "receiving_yards")
    return {
        "passYds": pass_yds,
        "ypa": None if attempts <= 0 else pass_yds / attempts,
        "attempts": attempts,
        "rushYds": rush_yds,
        "ypc": None if carries <= 0 else rush_yds / carries,
        "carries": carries,
        "rec": _num(row, "receptions"),
        "targets": targets,
        "recYds": rec_yds,
        "ypt": None if targets <= 0 else rec_yds / targets,
    }


def _append(bucket: dict, key: str, stats: dict):
    row = bucket.setdefault(key, {name: [] for name in ("passYds", "ypa", "attempts", "rushYds", "ypc", "carries", "rec", "targets", "recYds", "ypt")})
    for name, value in stats.items():
        row[name].append(value)


def _actual(stats: dict, position: str) -> float:
    return float(stats[PRIMARY[position]])


def _mae(rows):
    if not rows:
        return None
    return sum(abs(row["actual"] - row["predicted"]) for row in rows) / len(rows)


def build_momentum(stats, schedule, season: int, week: int) -> dict:
    stats, schedule, _ = prepare(stats, schedule, None)
    if "season" in stats.columns:
        stats = stats[stats["season"] == season]
    if "season_type" in stats.columns:
        stats = stats[stats["season_type"].isin(["REG", "reg"])]
    if "season" in schedule.columns:
        schedule = schedule[schedule["season"] == season]
    if "game_type" in schedule.columns:
        schedule = schedule[schedule["game_type"] == "REG"]
    finals = schedule[schedule["final"]] if "final" in schedule.columns else schedule
    played = sorted({int(row.week) for row in finals.itertuples(index=False) if int(row.week) < week and row.away_score == row.away_score})
    history: dict[str, dict] = {}
    names: dict[str, dict] = {}
    allowed: dict[tuple, list] = {}
    backtest = {pos: {"train": [], "test": []} for pos in POSITIONS}
    for played_week in played:
        hist = history_stats(stats, schedule, played_week)
        pool = {player["id"]: player for player in player_pool(hist) if player["pos"] in POSITIONS}
        factors = defense_factors(hist) if len(hist) else {}
        slate = stats[stats["week"] == played_week]
        seen_defense = set()
        for row in slate.itertuples(index=False):
            pid = str(row.player_id)
            position = str(row.pos)
            if position not in POSITIONS or row.team is None:
                continue
            current = game_stats(row)
            player = pool.get(pid)
            if player and player["team"] == row.team and player["pos"] == position:
                series = {"position": position, **history.get(pid, {})}
                if sum(1 for value in (series.get(PRIMARY[position]) or []) if value is not None) >= MIN_GAMES:
                    offense = momentum_multiple(series)
                    stat = PRIMARY[position]
                    factor = (factors.get(row.opponent_team, {}).get(position, {}) or {}).get(stat)
                    trend = trend_z(allowed.get((row.opponent_team, position), []))
                    defense = defense_multiple(factor, trend)
                    net = net_multiple(offense, defense)
                    projected = project_player(player, row.opponent_team, factors, {})
                    baseline = projected.get(stat, [None, None])[1]
                    if baseline is not None:
                        actual = _actual(current, position)
                        bucket = "test" if played_week >= 9 else "train"
                        backtest[position][bucket].append({
                            "actual": actual,
                            "baseline": float(baseline),
                            "adjusted": float(baseline) * net,
                        })
            if position in POSITIONS:
                _append(history, pid, current)
                names[pid] = {"name": str(row.player_display_name), "team": row.team, "position": position}
                if (row.opponent_team, position) not in seen_defense:
                    seen_defense.add((row.opponent_team, position))
        for defense, position in seen_defense:
            block = slate[(slate["opponent_team"] == defense) & (slate["pos"] == position)]
            if position == "QB":
                total = float(block["passing_yards"].fillna(0).sum()) if len(block) else 0.0
            elif position == "RB":
                total = float(block["rushing_yards"].fillna(0).sum()) if len(block) else 0.0
            else:
                total = float(block["receiving_yards"].fillna(0).sum()) if len(block) else 0.0
            allowed.setdefault((defense, position), []).append(total)
    hist = history_stats(stats, schedule, week)
    pool = [player for player in player_pool(hist) if player["pos"] in POSITIONS]
    factors = defense_factors(hist) if len(hist) else {}
    slate = schedule[schedule["week"] == week] if "week" in schedule.columns else schedule.iloc[0:0]
    opponents = {}
    for row in slate.itertuples(index=False):
        opponents[row.away_team] = row.home_team
        opponents[row.home_team] = row.away_team
    players = []
    for player in pool:
        if player["team"] not in opponents:
            continue
        series = {"position": player["pos"], **history.get(player["id"], {})}
        offense = momentum_multiple(series)
        defense_team = opponents[player["team"]]
        stat = PRIMARY[player["pos"]]
        factor = (factors.get(defense_team, {}).get(player["pos"], {}) or {}).get(stat)
        defense = defense_multiple(factor, trend_z(allowed.get((defense_team, player["pos"]), [])))
        net = net_multiple(offense, defense)
        projected = project_player(player, defense_team, factors, {})
        baseline = projected.get(stat, [None, None])[1]
        adjusted = None if baseline is None else baseline * net
        detail = {}
        for key, _kind, _volume in COMPONENTS[player["pos"]]:
            zed = trend_z((series.get(key) or []))
            detail[key] = None if zed is None else round_num(zed, 2)
        if offense == 1 and defense == 1 and baseline is None:
            continue
        players.append({
            "name": player["name"],
            "team": player["team"],
            "position": player["pos"],
            "opponent": defense_team,
            "games": player["games"],
            "momentumMultiple": offense,
            "defenseMultiple": defense,
            "defenseFactor": None if factor is None else round_num(factor, 3),
            "netMultiple": net,
            "primary": stat,
            "baseline": None if baseline is None else round_num(baseline, 1),
            "adjusted": None if adjusted is None else round_num(adjusted, 1),
            "components": detail,
        })
    players.sort(key=lambda row: (row["position"], row["name"]))
    summary = {}
    for position, buckets in backtest.items():
        train_base, test_base = _mae([{"actual": r["actual"], "predicted": r["baseline"]} for r in buckets["train"]]), _mae([{"actual": r["actual"], "predicted": r["baseline"]} for r in buckets["test"]])
        train_adj, test_adj = _mae([{"actual": r["actual"], "predicted": r["adjusted"]} for r in buckets["train"]]), _mae([{"actual": r["actual"], "predicted": r["adjusted"]} for r in buckets["test"]])
        helps = None if test_base is None or test_adj is None else test_adj < test_base - 0.05
        summary[position] = {
            "trainGames": len(buckets["train"]),
            "testGames": len(buckets["test"]),
            "trainBaselineMae": None if train_base is None else round_num(train_base, 2),
            "trainAdjustedMae": None if train_adj is None else round_num(train_adj, 2),
            "testBaselineMae": None if test_base is None else round_num(test_base, 2),
            "testAdjustedMae": None if test_adj is None else round_num(test_adj, 2),
            "helps": helps,
        }
    return {
        "season": season,
        "week": week,
        "throughWeek": played[-1] if played else None,
        "label": "Model estimates",
        "method": (
            "Momentum is a decayed z-score of recent games against the player's own prior average "
            f"(half-life {int(HALF_LIFE)} games), stepped by 1% and capped at 5%. "
            "Rate stats (yards per attempt, carry, or target) count less when the recent volume is light. "
            "The defense multiple blends the shrunk yards-allowed factor with that defense's recent trend, also inside 5%. "
            "The net multiple adds the two nudges and stays inside 8%. It scales the pipeline's pre-game projection. "
            "Weeks 9–12 are the holdout. A position is flagged when the net multiple does not lower absolute error there."
        ),
        "backtest": summary,
        "players": players,
    }
