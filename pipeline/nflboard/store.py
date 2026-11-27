"""Read and write the dashboard JSON files. Priced games are kept as saved snapshots."""
from __future__ import annotations

import json
import math
from pathlib import Path

from nflboard.logic import game_has_price


def data_dir(root: Path) -> Path:
    return root / "dashboard" / "src" / "data"


def props_dir(root: Path) -> Path:
    return root / "dashboard" / "src" / "props"


def read_json(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text())


def clean(value):
    if isinstance(value, dict):
        return {str(key): clean(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if hasattr(value, "item"):
        return clean(value.item())
    return value


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(clean(payload), indent=2) + "\n")


def week_has_priced_board(root: Path, week: int) -> bool:
    td = read_json(data_dir(root) / f"td-riskscale-wk{week}.json")
    parlays = read_json(data_dir(root) / f"parlays-wk{week}.json")
    games = []
    if isinstance(td, dict):
        games.extend(td.get("games") or [])
    if isinstance(parlays, dict):
        games.extend((parlays.get("games") or {}).values())
    return any(game_has_price(game) for game in games)


def _merge_td(existing, generated):
    if not existing:
        return generated
    kept, keys = [], set()
    for game in existing.get("games") or []:
        if game_has_price(game):
            kept.append(game)
            keys.add(game.get("key"))
    for game in generated.get("games") or []:
        if game.get("key") not in keys:
            kept.append(game)
    kept.sort(key=lambda game: game.get("kickoffUtc") or game.get("key") or "")
    merged = dict(existing)
    merged["games"] = kept
    merged["pipeline"] = {"keptPricedGames": sorted(keys), "gameCount": len(kept)}
    return merged


def _merge_parlays(existing, generated):
    if not existing or int(existing.get("version") or 0) < 2:
        return generated
    games = {}
    for key, game in (existing.get("games") or {}).items():
        if game_has_price(game):
            games[key] = game
    for key, game in (generated.get("games") or {}).items():
        games.setdefault(key, game)
    merged = dict(existing)
    merged["games"] = games
    merged["pipeline"] = {"keptPricedGames": sorted(key for key, game in games.items() if game_has_price(game))}
    return merged


def _coverage_has_mix(payload) -> bool:
    for game in (payload or {}).get("games", {}).values():
        for offense in (game.get("offenses") or {}).values():
            if offense.get("mix"):
                return True
    return False


def _snapshot_has_price(payload) -> bool:
    for game in (payload or {}).get("games", {}).values():
        for card in game.get("cards") or []:
            for leg in card.get("legs") or []:
                if leg.get("price") not in (None, ""):
                    return True
    return False


def write_bundle(root: Path, season: int, week: int, bundle: dict, mode: str) -> list[str]:
    data = data_dir(root)
    props = props_dir(root)
    written = []
    full = mode == "full"

    td_path = data / f"td-riskscale-wk{week}.json"
    write_json(td_path, _merge_td(read_json(td_path), bundle["td"]))
    written.append(str(td_path.relative_to(root)))

    parlay_path = data / f"parlays-wk{week}.json"
    write_json(parlay_path, _merge_parlays(read_json(parlay_path), bundle["parlays"]))
    written.append(str(parlay_path.relative_to(root)))

    if full:
        scatter_path = data / f"scatter-wk{week}.json"
        write_json(scatter_path, bundle["scatter"])
        written.append(str(scatter_path.relative_to(root)))

        defense_path = data / f"defense-vs-opponents-wk{week}.json"
        write_json(defense_path, bundle["defense"])
        written.append(str(defense_path.relative_to(root)))

        for name, rows in (
            (f"rb-starters-week{week}.json", bundle["roles"]["rb"]),
            (f"rb-usage-week{week}.json", bundle["roles"]["usage"]),
            (f"wr-starters-week{week}.json", bundle["roles"]["wr"]),
        ):
            path = props / name
            write_json(path, rows)
            written.append(str(path.relative_to(root)))

        coverage_path = data / f"coverage-wk{week}.json"
        existing_coverage = read_json(coverage_path)
        if not _coverage_has_mix(existing_coverage):
            write_json(coverage_path, bundle["coverage"])
            written.append(str(coverage_path.relative_to(root)))

        snapshot_path = data / f"parlay-snapshot-wk{week}.json"
        existing_snapshot = read_json(snapshot_path)
        if not _snapshot_has_price(existing_snapshot):
            write_json(snapshot_path, bundle["snapshot"])
            written.append(str(snapshot_path.relative_to(root)))

        _copy_td_coverage(data, week)
        written.append(f"dashboard/src/data/td-coverage-wk{week}.json")
    return written


def _copy_td_coverage(data: Path, week: int) -> None:
    target = data / f"td-coverage-wk{week}.json"
    sources = sorted(data.glob("td-coverage-wk*.json"), key=lambda path: path.name)
    sources = [path for path in sources if path != target]
    if target.exists() or not sources:
        return
    payload = read_json(sources[-1])
    payload["week"] = week
    payload["copiedFrom"] = sources[-1].name
    payload["copyNote"] = "2025 man/zone touchdown indexes carried forward. Not refit, and not a 2026 coverage mix."
    write_json(target, payload)


def load_adjustments(root: Path, week: int) -> dict:
    data = data_dir(root)
    files = sorted(data.glob("calibration-wk*.json"))
    chosen = None
    for path in files:
        digits = "".join(ch for ch in path.stem if ch.isdigit())
        if digits and int(digits) < week:
            chosen = path
    if chosen is None:
        return {}
    payload = read_json(chosen) or {}
    return payload.get("adjustments") or {}


def write_calibration(root: Path, payload: dict) -> Path:
    path = data_dir(root) / f"calibration-wk{payload['week']}.json"
    write_json(path, payload)
    return path
