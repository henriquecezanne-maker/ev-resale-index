# EV Resale Index

## What this app does

Turns a Metabase export of EV auction data into a shareable dashboard: a
mix-adjusted price index, a residual-value curve, and brand/country
breakdowns, following the methodology in
[docs/methodology.md](docs/methodology.md). There's an internal
(fully interactive) version and a simplified press version. The dashboard
is a static site, published on GitHub Pages so a link can always be shared.

## How to run it

```bash
npm install
npm run build
```

This reads the newest CSV in `data/`, computes everything, and writes the
dashboards to `outputs/`. Open `outputs/index.html` in a browser to see it
locally, or push to GitHub to update the live, shared version.

## Updating the data

1. Export the auction data from Metabase ("without_filters" view).
2. Drop the CSV into `data/`.
3. Run `npm run build`.
4. Save to GitHub (`/ship-project`) — the live dashboard updates
   automatically.

## Where secrets come from

This app doesn't need any secrets, API keys, or passwords — it only reads
a CSV file you place in `data/` yourself. There's nothing to configure in
`.env` for normal use.

## Links to docs

- [Methodology (the spec this app follows)](docs/methodology.md)
- [Roadmap & task list](docs/roadmap.md)
- [Architecture & tech stack](docs/architecture.md)
- [Task groups (larger projects)](docs/tasks/)
