#!/usr/bin/env python3
"""Compute the Mason Rudolph week-12 override from nflverse and patch DEN at PIT."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PRIOR = 200.0
NOTE = "QB override: Rudolph starting (Rodgers out)"


def rates(attempts, yards, tds, ints):
    attempts = float(attempts)
    return yards / attempts, tds / attempts, ints / attempts


def shrink(career, backup, attempts, prior=PRIOR):
    weight = attempts / (attempts + prior)
    return weight * career + (1 - weight) * backup


def points_per_attempt(ypa, td_rate, int_rate):
    return 0.04 * ypa + 4 * td_rate - 2 * int_rate


def main():
    season = pd.read_parquet(
        "/tmp/nflverse/player_stats_season.parquet",
        columns=["player_display_name", "season_type", "attempts", "completions", "passing_yards", "passing_tds", "interceptions"],
    )
    rud = season[(season.player_display_name == "Mason Rudolph") & (season.season_type == "REG") & (season.attempts.fillna(0) > 0)]
    week = pd.read_csv(
        "/tmp/nflverse/stats_player_week_2026.csv",
        usecols=["player_display_name", "position", "team", "week", "season_type", "attempts", "completions", "passing_yards", "passing_tds", "passing_interceptions"],
    )
    rud26 = week[(week.player_display_name == "Mason Rudolph") & (week.season_type == "REG")]
    attempts = float(rud.attempts.sum() + rud26.attempts.sum())
    yards = float(rud.passing_yards.sum() + rud26.passing_yards.sum())
    tds = float(rud.passing_tds.sum() + rud26.passing_tds.sum())
    ints = float(rud.interceptions.sum() + rud26.passing_interceptions.sum())
    career = rates(attempts, yards, tds, ints)
    qbs = week[(week.position == "QB") & (week.season_type == "REG") & (week.attempts.fillna(0) > 0)]
    leaders = qbs.groupby(["team", "player_display_name"]).attempts.sum().reset_index()
    top = set(zip(leaders.sort_values("attempts", ascending=False).groupby("team").head(1).team, leaders.sort_values("attempts", ascending=False).groupby("team").head(1).player_display_name))
    # recompute top cleanly
    idx = leaders.groupby("team").attempts.idxmax()
    top = set(zip(leaders.loc[idx].team, leaders.loc[idx].player_display_name))
    backup = qbs[~qbs.apply(lambda row: (row.team, row.player_display_name) in top, axis=1)]
    batt = float(backup.attempts.sum())
    base = rates(batt, backup.passing_yards.sum(), backup.passing_tds.sum(), backup.passing_interceptions.sum())
    ypa, td_rate, int_rate = (shrink(c, b, attempts) for c, b in zip(career, base))
    rod = qbs[qbs.player_display_name == "Aaron Rodgers"]
    rod_rates = rates(rod.attempts.sum(), rod.passing_yards.sum(), rod.passing_tds.sum(), rod.passing_interceptions.sum())
    efficiency = points_per_attempt(ypa, td_rate, int_rate) / points_per_attempt(*rod_rates)
    pit = qbs[qbs.team == "PIT"]
    attempts_per_game = float(pit.groupby("week").attempts.sum().mean())
    defense_factor = 1.04
    before = attempts_per_game * ypa
    pass_yds = before * defense_factor
    payload = {
        "source": "nflverse player_stats_season plus stats_player_week_2026",
        "weeks": {
            "12": {
                "PIT": {
                    "season": 2026,
                    "team": "PIT",
                    "qb": "Mason Rudolph",
                    "out": "Aaron Rodgers",
                    "note": NOTE,
                    "careerAttempts": int(attempts),
                    "attemptsPerGame": round(attempts_per_game, 2),
                    "yardsPerAttempt": round(ypa, 3),
                    "defenseFactor": defense_factor,
                    "passYdsBeforeDefense": round(before, 1),
                    "passYds": round(pass_yds, 1),
                    "efficiency": round(efficiency, 4),
                    "rodgersYardsPerAttempt": round(rod_rates[0], 3),
                    "backupYardsPerAttempt": round(base[0], 3),
                    "sample2026Attempts": int(rud26.attempts.sum()),
                    "detail": (
                        f"Career {int(attempts)} attempts, {yards:.0f} yards, {int(tds)} TD, {int(ints)} INT, "
                        f"regressed toward the 2026 non-starter pool ({int(batt)} attempts) with a {int(PRIOR)}-attempt prior. "
                        f"2026 alone is {int(rud26.attempts.sum())} attempts and {rud26.passing_yards.sum():.0f} yards."
                    ),
                }
            }
        },
    }
    text = json.dumps(payload, indent=2) + "\n"
    for path in (ROOT / "pipeline" / "overrides" / "qb_starters.json", ROOT / "dashboard" / "src" / "data" / "qb-starters.json"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    spec = payload["weeks"]["12"]["PIT"]
    patch_week(ROOT, spec)
    print(json.dumps({k: spec[k] for k in ("passYds", "efficiency", "yardsPerAttempt", "attemptsPerGame", "careerAttempts", "detail")}, indent=2))


def patch_week(root: Path, spec: dict):
    data = root / "dashboard" / "src" / "data"
    ratio = spec["efficiency"]
    scatter = json.loads((data / "scatter-wk12.json").read_text())
    game = scatter["games"]["DEN-PIT"]
    players = []
    replaced = False
    for player in game["players"]:
        if player["t"] != "PIT":
            players.append(player)
            continue
        if player["p"] == "QB" and player["n"] == "Aaron Rodgers":
            player = {
                **player,
                "n": spec["qb"],
                "g": spec["careerAttempts"],
                "s": {"passYds": [spec["passYdsBeforeDefense"], spec["passYds"], spec["defenseFactor"]], "rushYds": [0.0, 0.0, None], "td": [0.0, 0.0, None]},
                "qbOverride": spec["note"],
            }
            replaced = True
        else:
            stats = dict(player["s"])
            for key, places in (("recYds", 1), ("td", 2)):
                triple = stats.get(key)
                if not triple or triple[1] is None:
                    continue
                stats[key] = [None if triple[0] is None else round(triple[0] * ratio, places), round(triple[1] * ratio, places), triple[2]]
            player = {**player, "s": stats}
        players.append(player)
    if not replaced:
        raise SystemExit("Aaron Rodgers was not on the DEN-PIT scatter")
    game["players"] = players
    game["qbOverride"] = spec["note"]
    (data / "scatter-wk12.json").write_text(json.dumps(scatter))

    board = json.loads((data / "td-riskscale-wk12.json").read_text())
    found = next(item for item in board["games"] if item.get("game") == "DEN at PIT")
    for side in found["sides"]:
        if side.get("offense") != "PIT":
            continue
        side["qbOverride"] = spec["note"]
        for row in side.get("rows") or []:
            for slot in ("confident", "relativelySafe"):
                if row.get(slot):
                    row[slot]["modelProb"] = round(row[slot]["modelProb"] * ratio, 3)
                    row[slot]["reason"] = f"{row[slot]['reason']} {spec['note']}."
            for pick in row.get("upside") or []:
                pick["modelProb"] = round(pick["modelProb"] * ratio, 3)
    (data / "td-riskscale-wk12.json").write_text(json.dumps(board))

    parlays = json.loads((data / "parlays-wk12.json").read_text())
    den = parlays["games"]["DEN-PIT"]
    den["qbOverride"] = spec["note"]

    def scale_leg(leg):
        if not isinstance(leg, dict) or leg.get("team") != "PIT" or leg.get("market") not in {"Rec yds", "TD"}:
            return
        if leg.get("center") is None:
            return
        places = 2 if leg["market"] == "TD" else 2
        leg["center"] = round(float(leg["center"]) * ratio, places)
        if leg.get("line"):
            leg["model_edge_pct"] = round((leg["center"] - float(leg["line"])) / float(leg["line"]) * 100, 1)

    for leg in den.get("legs") or []:
        scale_leg(leg)
    for card in den.get("safe_overlap_cards") or []:
        for leg in card.get("legs") or []:
            scale_leg(leg)
    (data / "parlays-wk12.json").write_text(json.dumps(parlays))


if __name__ == "__main__":
    main()
