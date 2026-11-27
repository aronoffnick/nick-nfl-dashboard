# nick-nfl-dashboard

Matchup lab for the current NFL week. The app is in `dashboard/` and is deployed at https://nick-nfl-dashboard.vercel.app.

The page loads the live week from ESPN. Charts, touchdown boards, parlays, and role sheets come from JSON files named by week (`dashboard/src/data/*-wk12.json`, `dashboard/src/props/*-week12.json`). A missing week stays blank. Older weeks stay in the repo.

## Weekly pipeline

`pipeline/run.py` builds those files from the public [nflverse](https://github.com/nflverse/nflverse-data) schedule, weekly player stats, and (when the file downloads) play-by-play. It does not invent stats. Sportsbook prices stay blank unless a game already has a saved snapshot; those priced games are left as they were.

```bash
pip install -r pipeline/requirements.txt
python pipeline/run.py --season 2026 --week 13
python pipeline/run.py --auto
```

`--week` builds that week. A week that already contains saved prices is filled in (missing games only, existing charts kept). A week without saved prices is rewritten from the stats through the previous week. `--auto` uses the schedule and the weekday in Eastern time: Tuesday builds the open week, and Thursday and Sunday also refresh the following week. Finished games are scored into `dashboard/src/data/calibration-wkN.json`. The next week's projections are multiplied by scales that shrink toward 1 and stay inside 0.90–1.10.

GitHub Actions (`.github/workflows/weekly-slate.yml`) runs that command on Tuesday, Thursday, and Sunday at 11:00 UTC and opens a pull request. It does not push to `main`.

The 2025 man/zone touchdown index is copied forward for the new week. Rebuild it with `dashboard/scripts/build-td-coverage.py` when you want a fresh participation file. There is no 2026 participation file, so this week's coverage mixes are left blank.
