"""Skill-player surplus versus a pre-game line.

The line is the pipeline projection from weeks before that game. When that
projection does not exist, the line is the player's own trailing average.
The current game is never part of either line. Players under four scored
games are left out. Samples shrink toward the position mean.
"""
from __future__ import annotations

import math

import pandas as pd

from nflboard.logic import (
    defense_factors,
    history_stats,
    player_pool,
    prepare,
    project_player,
    round_num,
)

SKILL = ("RB", "WR", "TE")
MIN_GAMES = 4
PRIOR = 4.0
TOOLTIPS = {
    "meanExcess": "Mean excess: how many half-PPR points he has finished above the pre-game line, on average.",
    "volatility": "Volatility: how wide those week-to-week finishes swing around that line.",
    "sharpe": "Sharpe: steady over-the-line production per unit of week-to-week swing.",
    "upsideCapture": "Upside capture: in weeks the offense scores above its usual total, how much of that good script shows up in his surplus.",
    "downsideCapture": "Downside capture: in weeks the offense scores under its usual total, how far his surplus falls with that quiet script.",
    "beta": "Beta: how tightly his half-PPR points move with the points his team scores.",
    "skew": "Skew: whether his misses are mostly quiet weeks or the occasional huge week.",
    "tailRate": "Tail rate: share of games he at least doubled the pre-game line.",
    "qbCorrelation": "QB correlation: whether his big weeks land in the same games as his quarterback's.",
}


def half_ppr_value(rush_yds, rec_yds, receptions, tds, pass_yds=0, pass_tds=0, interceptions=0) -> float:
    return (
        0.1 * float(rush_yds or 0)
        + 0.1 * float(rec_yds or 0)
        + 0.5 * float(receptions or 0)
        + 6 * float(tds or 0)
        + 0.04 * float(pass_yds or 0)
        + 4 * float(pass_tds or 0)
        - 2 * float(interceptions or 0)
    )


def row_half_ppr(row) -> float:
    fantasy = getattr(row, "fantasy_points", None)
    if fantasy is not None and not (isinstance(fantasy, float) and math.isnan(fantasy)):
        receptions = getattr(row, "receptions", 0) or 0
        return float(fantasy) + 0.5 * float(receptions)
    return half_ppr_value(
        getattr(row, "rushing_yards", 0),
        getattr(row, "receiving_yards", 0),
        getattr(row, "receptions", 0),
        (getattr(row, "rushing_tds", 0) or 0) + (getattr(row, "receiving_tds", 0) or 0),
        getattr(row, "passing_yards", 0),
        getattr(row, "passing_tds", 0),
        getattr(row, "passing_interceptions", 0),
    )


def projected_half_ppr(projected: dict) -> float | None:
    if not projected:
        return None
    def mid(stat):
        triple = projected.get(stat)
        if not triple or triple[1] is None:
            return 0.0
        return float(triple[1])
    if not any(projected.get(stat) and projected[stat][1] is not None for stat in ("rushYds", "recYds", "rec", "td")):
        return None
    return half_ppr_value(mid("rushYds"), mid("recYds"), mid("rec"), mid("td"))


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
    var = sum((v - mu) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(var)


def _corr(left, right):
    pairs = [(float(a), float(b)) for a, b in zip(left, right) if a is not None and b is not None and math.isfinite(float(a)) and math.isfinite(float(b))]
    if len(pairs) < MIN_GAMES:
        return None
    xs = [a for a, _ in pairs]
    ys = [b for _, b in pairs]
    sx, sy = _std(xs), _std(ys)
    if not sx or not sy:
        return 0.0
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    cov = sum((a - mx) * (b - my) for a, b in pairs) / (len(pairs) - 1)
    return cov / (sx * sy)


def _skew(values):
    values = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    n = len(values)
    if n < 3:
        return None
    sd = _std(values)
    if not sd:
        return 0.0
    mu = sum(values) / n
    raw = sum(((v - mu) / sd) ** 3 for v in values)
    return (n / ((n - 1) * (n - 2))) * raw


def _beta(points, team_points):
    pairs = [(float(a), float(b)) for a, b in zip(points, team_points) if a is not None and b is not None]
    if len(pairs) < MIN_GAMES:
        return None
    ys = [b for _, b in pairs]
    sy = _std(ys)
    if not sy:
        return 0.0
    xs = [a for a, _ in pairs]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    cov = sum((a - mx) * (b - my) for a, b in pairs) / (len(pairs) - 1)
    return cov / (sy ** 2)


def _capture(games, sign):
    chosen = [g for g in games if g["script"] is not None and (g["script"] > 0 if sign > 0 else g["script"] < 0)]
    if len(chosen) < 2:
        return None
    script = _mean([g["script"] for g in chosen])
    if script is None or abs(script) < 1e-9:
        return None
    excess = _mean([g["excess"] for g in chosen])
    return None if excess is None else excess / script


def shrink_toward(value, games, position_mean, prior=PRIOR):
    if value is None or position_mean is None or games is None:
        return None
    return (games * float(value) + prior * float(position_mean)) / (games + prior)


def _metrics(games):
    excess = [g["excess"] for g in games]
    mean_excess = _mean(excess)
    volatility = _std(excess)
    sharpe = None if mean_excess is None or not volatility else mean_excess / volatility
    tail_games = [g for g in games if g["benchmark"] and g["benchmark"] > 0]
    tail = None
    if tail_games:
        tail = sum(1 for g in tail_games if g["actual"] >= 2 * g["benchmark"]) / len(tail_games)
    return {
        "meanExcess": mean_excess,
        "volatility": volatility,
        "sharpe": sharpe,
        "upsideCapture": _capture(games, 1),
        "downsideCapture": _capture(games, -1),
        "beta": _beta([g["actual"] for g in games], [g["teamPoints"] for g in games]),
        "skew": _skew(excess),
        "tailRate": tail,
        "qbCorrelation": _corr([g["actual"] for g in games], [g["qbPoints"] for g in games]),
    }


def _team_points(schedule: pd.DataFrame) -> dict[tuple[str, int], float]:
    found = {}
    finals = schedule[schedule["final"]] if "final" in schedule.columns else schedule
    for row in finals.itertuples(index=False):
        if getattr(row, "away_score", None) is None or getattr(row, "home_score", None) is None:
            continue
        if isinstance(row.away_score, float) and math.isnan(row.away_score):
            continue
        week = int(row.week)
        found[(row.away_team, week)] = float(row.away_score)
        found[(row.home_team, week)] = float(row.home_score)
    return found


def _quarterbacks(stats: pd.DataFrame) -> dict[tuple[str, int], float]:
    qbs = stats[stats["pos"] == "QB"]
    best = {}
    for row in qbs.itertuples(index=False):
        key = (row.team, int(row.week))
        attempts = float(getattr(row, "attempts", 0) or 0)
        current = best.get(key)
        if current is None or attempts > current[0]:
            best[key] = (attempts, row_half_ppr(row))
    return {key: points for key, (_, points) in best.items()}


def build_stocks(stats: pd.DataFrame, schedule: pd.DataFrame, season: int, week: int) -> dict:
    stats, schedule, _ = prepare(stats, schedule, None)
    if "season" in stats.columns:
        stats = stats[stats["season"] == season]
    if "season_type" in stats.columns:
        stats = stats[stats["season_type"].isin(["REG", "reg"])]
    if "season" in schedule.columns:
        schedule = schedule[schedule["season"] == season]
    if "game_type" in schedule.columns:
        schedule = schedule[schedule["game_type"] == "REG"]
    points = _team_points(schedule)
    quarterbacks = _quarterbacks(stats)
    weeks = sorted({w for (_team, w) in points if w < week})
    logs: dict[str, list] = {}
    names: dict[str, dict] = {}
    prior_actual: dict[str, list] = {}
    prior_team_points: dict[str, list] = {}
    for played in weeks:
        hist = history_stats(stats, schedule, played)
        pool = {player["id"]: player for player in player_pool(hist)}
        factors = defense_factors(hist) if len(hist) else {}
        slate = stats[stats["week"] == played]
        for row in slate.itertuples(index=False):
            team = row.team
            if team is None or (team, played) not in points:
                continue
            pid = str(row.player_id)
            actual = row_half_ppr(row)
            opponent = row.opponent_team
            player = pool.get(pid)
            benchmark = None
            source = None
            if player and player["team"] == team and player["pos"] in SKILL:
                benchmark = projected_half_ppr(project_player(player, opponent, factors, {}))
                source = "projection"
            if benchmark is None and prior_actual.get(pid) and str(getattr(row, "pos", "")) in SKILL:
                benchmark = _mean(prior_actual[pid])
                source = "trailing"
            if str(getattr(row, "pos", "")) in SKILL:
                prior_actual.setdefault(pid, []).append(actual)
            if benchmark is None or source is None:
                continue
            usual = _mean(prior_team_points.get(team, []))
            team_points = points[(team, played)]
            script = None if usual is None else team_points - usual
            logs.setdefault(pid, []).append({
                "week": played,
                "actual": round_num(actual, 2),
                "benchmark": round_num(benchmark, 2),
                "source": source,
                "excess": round_num(actual - benchmark, 2),
                "teamPoints": team_points,
                "script": None if script is None else round_num(script, 2),
                "qbPoints": None if quarterbacks.get((team, played)) is None else round_num(quarterbacks[(team, played)], 2),
            })
            names[pid] = {"name": str(row.player_display_name), "team": team, "position": str(row.pos)}
        for team, played_week in points:
            if played_week == played:
                prior_team_points.setdefault(team, []).append(points[(team, played)])
    raw_rows = []
    for pid, games in logs.items():
        if len(games) < MIN_GAMES:
            continue
        raw_rows.append({**names[pid], "id": pid, "games": len(games), "raw": _metrics(games), "weeks": games})
    means = {pos: {} for pos in SKILL}
    keys = list(TOOLTIPS)
    for pos in SKILL:
        block = [row for row in raw_rows if row["position"] == pos]
        for key in keys:
            means[pos][key] = _mean([row["raw"][key] for row in block if row["raw"][key] is not None])
    players = []
    for row in raw_rows:
        shrunk = {}
        pos_mean = means[row["position"]]
        for key in keys:
            shrunk[key] = shrink_toward(row["raw"][key], row["games"], pos_mean.get(key))
        if shrunk["meanExcess"] is not None and shrunk["volatility"]:
            shrunk["sharpe"] = shrunk["meanExcess"] / shrunk["volatility"]
        players.append({
            "name": row["name"],
            "team": row["team"],
            "position": row["position"],
            "games": row["games"],
            **{key: None if shrunk[key] is None else round_num(shrunk[key], 3) for key in keys},
            "raw": {key: None if row["raw"][key] is None else round_num(row["raw"][key], 3) for key in keys},
            "weeks": row["weeks"],
        })
    players.sort(key=lambda row: (-(row["sharpe"] if row["sharpe"] is not None else -999), row["position"], row["name"]))
    return {
        "season": season,
        "week": week,
        "throughWeek": max(weeks) if weeks else None,
        "label": "Model estimates",
        "minGames": MIN_GAMES,
        "shrinkGames": PRIOR,
        "positions": list(SKILL),
        "method": (
            "Return = weekly half-PPR points minus a pre-game line. "
            "The line is the pipeline projection from earlier weeks only (current-team average times the shrunk defense factor), "
            "and a trailing average when that projection is missing. "
            f"Players under {MIN_GAMES} scored games are omitted. "
            f"Each metric shrinks toward the position mean with a prior of {int(PRIOR)} games. "
            "A good or bad script is the team's points versus its own earlier scoring average, not a sportsbook total."
        ),
        "tooltips": TOOLTIPS,
        "players": players,
    }
