"""Download public nflverse release files. A failed download raises; nothing is invented."""
from __future__ import annotations

import urllib.request
from pathlib import Path

RELEASE = "https://github.com/nflverse/nflverse-data/releases/download"
SOURCES = {
    "games": f"{RELEASE}/schedules/games.csv",
    "stats": f"{RELEASE}/stats_player/stats_player_week_{{season}}.csv",
    "snaps": f"{RELEASE}/snap_counts/snap_counts_{{season}}.csv",
    "pbp": f"{RELEASE}/pbp/play_by_play_{{season}}.parquet",
}


def cache_dir(root: Path) -> Path:
    path = root / "pipeline" / ".cache"
    path.mkdir(parents=True, exist_ok=True)
    return path


def download(url: str, dest: Path, required: bool) -> Path | None:
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url}")
    try:
        urllib.request.urlretrieve(url, dest)
    except Exception as exc:  # noqa: BLE001 — surface the real failure
        if required:
            raise SystemExit(f"Download failed for {url}: {exc}. No stats were invented.") from exc
        print(f"optional download failed for {url}: {exc}")
        if dest.exists():
            dest.unlink()
        return None
    if dest.stat().st_size < 1000:
        if required:
            raise SystemExit(f"Download failed for {url}: file is only {dest.stat().st_size} bytes.")
        dest.unlink()
        return None
    return dest


def paths_for(season: int, root: Path, cache: Path | None = None) -> dict[str, Path | None]:
    folder = cache or cache_dir(root)
    out = {}
    for name, pattern in SOURCES.items():
        url = pattern.format(season=season)
        filename = url.rsplit("/", 1)[-1]
        required = name in {"games", "stats"}
        out[name] = download(url, folder / filename, required=required)
    return out
