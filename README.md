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

`--week` builds that week. A week that already contains saved prices is filled in (missing games only, existing charts kept). A week without saved prices is rewritten from the stats through the previous week. `--auto` uses the schedule and the weekday in Eastern time: Tuesday builds the open week, and Thursday, Friday, and Sunday also refresh the following week when it is scheduled. Finished games are scored into `dashboard/src/data/calibration-wkN.json`. Each file keeps a rollup, so the next week adds to every earlier week. Projection, tier, and probability-band scales shrink toward 1.00 and stay inside 0.90–1.10.

Upside floors are in `TD_RULES` inside `pipeline/nflboard/logic.py`. Copy that object to `pipeline/td-rules.json` to override it. Relatively safe starts at 22%. A 2+ look is upside only at 12% or higher. From 4% up to that floor, the label is Long shot. The Week 12 check is three finished games, so the floors sit above that sample.

```bash
python pipeline/prices.py --season 2026 --week 12
```

That saves a getoddy snapshot into the touchdown and parlay files. A price already on disk is left alone. If getoddy does not answer, or its line is not the model line, the price stays blank. The site never requests odds.

GitHub Actions (`.github/workflows/weekly-slate.yml`) runs the tests, builds the week, saves that snapshot, and merges the data pull request. It does not push straight to `main`.

The 2025 man/zone touchdown index is copied forward. There is no 2026 participation file, so a new week carries the latest real coverage mix and labels it stale. A defense with no earlier mix gets no coverage tweak.
