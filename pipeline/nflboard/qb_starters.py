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
    spec = load_starters(path).get("weeks", {}).get(str(week), {}).get(team)
    if not spec or spec.get("season") not in (None, season):
        return spec if spec else None
    return spec


def scale_projection(player: dict, projected: dict, spec: dict) -> dict:
    """Replace the listed starter's pass yards and scale catchers. Other quarterbacks stay."""
    if not spec or player.get("team") != spec.get("team"):
        return projected
    updated = {key: list(value) if isinstance(value, list) else value for key, value in projected.items()}
    ratio = float(spec["efficiency"])
    if player.get("pos") == "QB" and player.get("name") == spec.get("qb"):
        base = float(spec["passYdsBeforeDefense"])
        yards = float(spec["passYds"])
        factor = updated.get("passYds", [None, None, None])[2]
        updated["passYds"] = [round(base, 1), round(yards, 1), factor if factor is not None else spec.get("defenseFactor")]
    elif player.get("pos") in {"WR", "TE", "RB"}:
        for stat in ("recYds", "td"):
            triple = updated.get(stat)
            if not triple or triple[1] is None:
                continue
            updated[stat] = [None if triple[0] is None else round(float(triple[0]) * ratio, 2 if stat == "td" else 1),
                             round(float(triple[1]) * ratio, 2 if stat == "td" else 1), triple[2]]
    return updated
