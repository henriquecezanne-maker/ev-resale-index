# Roadmap

## Purpose

Turn Metabase exports of EV auction data into a shareable, always-up-to-date
dashboard that shows how EV auction prices and residual values move over
time — a mix-adjusted price index, a residual-value curve, and brand/country
breakdowns — following the methodology in `docs/methodology.md`.

## Users

- **Internal (Aampere team)**: interactive dashboard with all filters, both
  price bases (corrected/raw), DAT EK bands, and every section from the
  original mockup. Used to explore the data and sanity-check claims before
  they go external.
- **Press / external**: a simplified static view — one accent color, direct
  labeling, no legend, a single mix-adjusted chart, and the marque
  "n real auctions" credibility anchor. No filters, no DAT EK, no raw index.

## Features (In scope)

- Load a Metabase CSV export from `data/` (manual drop-in, no API/DB).
- Build script (`npm run build`) that cleans/maps fields per methodology
  §2–3, computes the price index, mix weighting, residual-value curve, and
  brand/country breakdowns, and generates a static HTML dashboard —
  no backend server.
- Internal dashboard: full interactivity from the original mockup (filters,
  sliders, brand/country toggle, sortable table, CSV re-load in browser).
- Press dashboard: a second, minimal static page generated from the same
  data (one chart + one number + one methodology line).
- Auto-deploy the generated site to GitHub Pages on every push to `main`,
  so a link can always be shared.
- Validation report (n-thresholds, bootstrap CI, Mann-Whitney where
  relevant) printed alongside the generated dashboard per methodology §11.

## Explicitly out of scope

- Automatic Metabase API pull — data arrives via manual CSV export/drop-in
  only (open follow-up item in the methodology doc).
- User accounts / auth — the dashboard is a public static site; treat
  contents as shareable, not confidential.
- Editing data in the browser and persisting it back — the "load your own
  CSV" feature in the browser is session-only, exactly like the original
  mockup.

## Status checklist

- [ ] Scaffold project (this step)
- [ ] Land first real Metabase CSV export into `data/`
- [ ] Port field-mapping + cleaning (methodology §2–3) into `src/`
- [ ] Port price index + mix weighting (methodology §4–5)
- [ ] Port residual-value curve + brand ranking (methodology §6)
- [ ] Port validation KPIs + traffic-light system (methodology §11)
- [ ] Generate internal dashboard (reuse chart/interaction code from
      `reference/original-mockup.html`)
- [ ] Generate press dashboard (methodology §12)
- [ ] Wire up GitHub Pages deploy
- [ ] Share first live link
