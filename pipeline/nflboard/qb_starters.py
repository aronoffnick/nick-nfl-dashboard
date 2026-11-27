"""Starting quarterback overrides. Rates come from nflverse, never a guessed line."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / "overrides" / "qb_starters.json"


def load_starters(path: Path | None = None) -> dict:
    file = path or FILE
    if not file.exists():
        return {}
    return json.loads(file.read_text())


def starter_for(season: int, week: int, team: str, path: Path | None = None) -> dict | None:
    """The latest override for this team at or before `week`. A later week replaces it."""
    chosen = None
    chosen_week = -1
    for key, teams in (load_starters(path).get("weeks") or {}).items():
        try:
            number = int(key)
        except (TypeError, ValueError):
            continue
        if number > int(week) or number < chosen_week:
            continue
        spec = (teams or {}).get(team)
        if not spec or spec.get("season") not in (None, season):
            continue
        chosen = spec
        chosen_week = number
    return chosen


def scale_projection(player: dict, projected: dict, spec: dict) -> dict:
    """Replace the listed starter's pass yards and scale catchers. Other quarterbacks stay."""
    if not spec or player.get("team") != spec.get("team"):
        return projected
    updated = {key: list(value) if isinstance(value, list) else value for key, value in projected.items()}
    ratio = float(spec["efficiency"])
    if player.get("pos") == "QB" and player.get("name") == spec.get("qb"):
        base = float(spec["passYdsBeforeDefense"])
        triple = updated.get("passYds") or [None, None, None]
        factor = triple[2] if len(triple) > 2 and triple[2] is not None else spec.get("defenseFactor")
        yards = round(base * float(factor), 1) if factor is not None else float(spec["passYds"])
        updated["passYds"] = [round(base, 1), yards, factor]
    elif player.get("pos") in {"WR", "TE", "RB"}:
        for stat in ("recYds", "td"):
            triple = updated.get(stat)
            if not triple or triple[1] is None:
                continue
            updated[stat] = [None if triple[0] is None else round(float(triple[0]) * ratio, 2 if stat == "td" else 1),
                             round(float(triple[1]) * ratio, 2 if stat == "td" else 1), triple[2]]
    return updated
