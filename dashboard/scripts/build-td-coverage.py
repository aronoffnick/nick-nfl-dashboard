#!/usr/bin/env python3
"""Build td-coverage-wkN.json from public 2025 nflverse play-by-play.

Downloads (not committed):
  https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.parquet
  https://github.com/nflverse/nflverse-data/releases/download/pbp_participation/pbp_participation_2025.parquet
  https://github.com/nflverse/nflverse-data/releases/download/players/players.parquet

Per receiver, targets and pass TDs vs MAN_COVERAGE and ZONE_COVERAGE are shrunk
toward the position's league TD rate (K=80 targets). The output is the index
the Touchdowns tab uses. It does not invent splits: a failed download stops the script.
"""
from __future__ import annotations

import json
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

K = 80
WEEK = 12
SOURCES = {
    "pbp": "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.parquet",
    "participation": "https://github.com/nflverse/nflverse-data/releases/download/pbp_participation/pbp_participation_2025.parquet",
    "players": "https://github.com/nflverse/nflverse-data/releases/download/players/players.parquet",
}
MAN = "MAN_COVERAGE"
ZONE = "ZONE_COVERAGE"
POS_GROUP = {"WR": "WR", "TE": "TE", "RB": "RB", "FB": "RB"}


def download(url: str, dest: Path) -> None:
    print(f"downloading {url}", file=sys.stderr)
    try:
        urllib.request.urlretrieve(url, dest)
    except Exception as exc:  # noqa: BLE001 — surface the real failure and stop
        raise SystemExit(f"Download failed for {url}: {exc}. No coverage splits were invented.") from exc
    if dest.stat().st_size < 1000:
        raise SystemExit(f"Download failed for {url}: file is only {dest.stat().st_size} bytes.")


def norm_name(value: str) -> str:
    text = str(value or "").lower().replace("'", "").replace("’", "").replace(".", "")
    out = []
    word = []
    for ch in text:
        if ch.isalnum():
            word.append(ch)
        else:
            if word:
                out.append("".join(word))
                word = []
    if word:
        out.append("".join(word))
    suffixes = {"jr", "sr", "ii", "iii", "iv", "v"}
    return " ".join(part for part in out if part not in suffixes)


def rate(tds: float, targets: float) -> float:
    return float(tds) / float(targets) if targets else 0.0


def shrink(tds: float, targets: float, league: float) -> float:
    return (tds + K * league) / (targets + K)


def main() -> None:
    out = Path(__file__).resolve().parents[1] / "src" / "data" / f"td-coverage-wk{WEEK}.json"
    with tempfile.TemporaryDirectory(prefix="td-coverage-") as tmp:
        folder = Path(tmp)
        paths = {}
        for name, url in SOURCES.items():
            dest = folder / f"{name}.parquet"
            download(url, dest)
            paths[name] = dest
        pbp = pd.read_parquet(paths["pbp"], columns=[
            "game_id", "play_id", "week", "season_type", "posteam",
            "pass_attempt", "pass_touchdown", "rush_touchdown",
            "receiver_player_id", "rusher_player_id",
        ])
        part = pd.read_parquet(paths["participation"], columns=[
            "nflverse_game_id", "play_id", "defense_man_zone_type",
        ])
        players = pd.read_parquet(paths["players"], columns=["gsis_id", "display_name", "position"])

    season = pbp[pbp.season_type.isin(["REG", "POST"])].copy()
    players = players.dropna(subset=["gsis_id", "display_name"]).drop_duplicates("gsis_id")
    players["pos"] = players.position.map(POS_GROUP)
    known = players.dropna(subset=["pos"]).set_index("gsis_id")

    rush = season[(season.rush_touchdown == 1) & season.rusher_player_id.notna()]
    rush_td = rush.groupby("rusher_player_id").size()
    rec = season[(season.pass_touchdown == 1) & season.receiver_player_id.notna()]
    rec_td = rec.groupby("receiver_player_id").size()

    passes = season[(season.pass_attempt == 1) & season.receiver_player_id.notna()][
        ["game_id", "play_id", "week", "posteam", "pass_touchdown", "receiver_player_id"]
    ]
    joined = passes.merge(
        part,
        left_on=["game_id", "play_id"],
        right_on=["nflverse_game_id", "play_id"],
        how="inner",
    )
    joined = joined[joined.defense_man_zone_type.isin([MAN, ZONE])]
    joined = joined[joined.receiver_player_id.isin(known.index)]
    joined["pos"] = joined.receiver_player_id.map(known.pos)

    league = {}
    for pos in ("WR", "TE", "RB"):
        group = joined[joined.pos == pos]
        man = group[group.defense_man_zone_type == MAN]
        zone = group[group.defense_man_zone_type == ZONE]
        league[pos] = {
            "man": rate(man.pass_touchdown.sum(), len(man)),
            "zone": rate(zone.pass_touchdown.sum(), len(zone)),
            "tgtMan": int(len(man)),
            "tdMan": int(man.pass_touchdown.sum()),
            "tgtZone": int(len(zone)),
            "tdZone": int(zone.pass_touchdown.sum()),
        }
        if league[pos]["tgtMan"] == 0 or league[pos]["tgtZone"] == 0:
            raise SystemExit(f"No {pos} {MAN if league[pos]['tgtMan'] == 0 else ZONE} sample. Stopping without invented rates.")

    rows = {}
    for gsis, group in joined.groupby("receiver_player_id"):
        info = known.loc[gsis]
        pos = info.pos
        man = group[group.defense_man_zone_type == MAN]
        zone = group[group.defense_man_zone_type == ZONE]
        tgt_man, td_man = int(len(man)), int(man.pass_touchdown.sum())
        tgt_zone, td_zone = int(len(zone)), int(zone.pass_touchdown.sum())
        if tgt_man + tgt_zone == 0:
            continue
        lg = league[pos]
        idx_man = shrink(td_man, tgt_man, lg["man"]) / lg["man"]
        idx_zone = shrink(td_zone, tgt_zone, lg["zone"]) / lg["zone"]
        latest = group.sort_values("week").iloc[-1]
        key = f"{norm_name(info.display_name)}|{pos}"
        rows[key] = {
            "gsisId": gsis,
            "name": info.display_name,
            "pos": pos,
            "team2025": None if pd.isna(latest.posteam) else str(latest.posteam),
            "tgtMan": tgt_man,
            "tdMan": td_man,
            "tgtZone": tgt_zone,
            "tdZone": td_zone,
            "idxMan": round(float(idx_man), 6),
            "idxZone": round(float(idx_zone), 6),
            "recTd2025": int(rec_td.get(gsis, 0)),
            "rushTd2025": int(rush_td.get(gsis, 0)),
        }

    payload = {
        "week": WEEK,
        "source": SOURCES,
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "K": K,
        "league": {pos: {"man": round(league[pos]["man"], 6), "zone": round(league[pos]["zone"], 6)} for pos in ("WR", "TE", "RB")},
        "leagueSample": {pos: {k: league[pos][k] for k in ("tgtMan", "tdMan", "tgtZone", "tdZone")} for pos in ("WR", "TE", "RB")},
        "players": dict(sorted(rows.items())),
    }
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {out} ({len(rows)} players)", file=sys.stderr)
    for pos in ("WR", "TE", "RB"):
        print(f"{pos} man {league[pos]['man']:.4%} on {league[pos]['tgtMan']} zone {league[pos]['zone']:.4%} on {league[pos]['tgtZone']}", file=sys.stderr)


if __name__ == "__main__":
    main()
