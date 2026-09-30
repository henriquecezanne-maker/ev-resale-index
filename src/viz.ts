import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientDeal, Deal } from './load.js';
import { monthKey, toClientDeal } from './load.js';
import { buildMonthlyIndex, KWH_BANDS } from './pricing.js';
import { brandResidualRanking, fitExponential, fitLinear, residualPoints } from './residual.js';
import { countByBand, countByCountry, DATEK_BANDS, KM_BANDS } from './mix.js';
import { bootstrapMedianCI, mannWhitneyU, trafficLight } from './validate.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Explicit number->string conversion for template literals (avoids implicit-coercion lint errors). */
function num(n: number): string {
  return n.toString();
}

function fmtPct(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', ',') + ' %';
}

const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Formats a "YYYY-MM" month key as "Mon 'YY" (e.g. "2026-09" -> "Sep '26"). */
function monthKeyLabel(key: string): string {
  const [year, month] = key.split('-');
  const monthIndex = month ? Number(month) - 1 : NaN;
  const abbrev = MONTH_ABBREVIATIONS[monthIndex] ?? month ?? '';
  return `${abbrev} '${year?.slice(2) ?? ''}`;
}

interface DashboardData {
  generatedAt: string;
  totalRows: number;
  droppedRows: number;
  cleanedN: number;
  clientDeals: ClientDeal[];
  baseMonth: string;
  latestMonth: string;
  latestMonthPartial: boolean;
  monthlyIndex: ReturnType<typeof buildMonthlyIndex>;
  rawChangeSinceJan: number;
  weightedChangeSinceJan: number;
  residualCurve: {
    exponential: ReturnType<typeof fitExponential>;
    linear: ReturnType<typeof fitLinear>;
    n: number;
    points: Array<{ t: number; rv: number }>;
  };
  brandRanking: ReturnType<typeof brandResidualRanking>;
  kwhMix: ReturnType<typeof countByBand>;
  datekMix: ReturnType<typeof countByBand>;
  kmMix: ReturnType<typeof countByBand>;
  countryMix: ReturnType<typeof countByCountry>;
  teslaValidation: {
    q1: { n: number; medianVal: number; ciLow: number; ciHigh: number };
    q3: { n: number; medianVal: number; ciLow: number; ciHigh: number };
    p: number;
    effectSize: number;
    light: string;
  } | null;
}

export function computeDashboardData(
  deals: Deal[],
  totalRows: number,
  droppedRows: number,
  removedAuctionKeys: Set<string>,
): DashboardData {
  const monthlyIndex = buildMonthlyIndex(deals);
  const last = monthlyIndex[monthlyIndex.length - 1];
  const rawChangeSinceJan = last ? last.indexRaw - 100 : 0;
  const weightedChangeSinceJan = last?.indexWeighted !== null && last?.indexWeighted !== undefined ? last.indexWeighted - 100 : 0;

  const sortedByEnd = [...deals].sort((a, b) => a.endDate.getTime() - b.endDate.getTime());
  const latestDeal = sortedByEnd[sortedByEnd.length - 1];
  const latestMonth = latestDeal ? monthKey(latestDeal.endDate) : '';
  const latestMonthPartial = latestDeal
    ? latestDeal.endDate.getUTCDate() <
      new Date(Date.UTC(latestDeal.endDate.getUTCFullYear(), latestDeal.endDate.getUTCMonth() + 1, 0)).getUTCDate()
    : false;

  const rvPoints = residualPoints(deals);
  const residualCurve = {
    exponential: fitExponential(rvPoints),
    linear: fitLinear(rvPoints),
    n: rvPoints.length,
    points: rvPoints,
  };

  const brandRanking = brandResidualRanking(deals);

  const kwhMix = countByBand(deals, KWH_BANDS, (d) => d.batteryKwh);
  const datekDeals = deals.filter((d) => d.datekProxy !== null);
  const datekMix = countByBand(datekDeals, DATEK_BANDS, (d) => d.datekProxy as number);
  const kmMix = countByBand(deals, KM_BANDS, (d) => d.km);
  const countryMix = countByCountry(deals);

  // Validation example from methodology §11: Tesla Q1 vs Q3.
  const teslaDeals = deals.filter((d) => d.brand === 'Tesla');
  const q1 = teslaDeals.filter((d) => {
    const m = monthKey(d.endDate);
    return m === '2026-01' || m === '2026-02' || m === '2026-03';
  });
  const q3 = teslaDeals.filter((d) => {
    const m = monthKey(d.endDate);
    return m === '2026-07' || m === '2026-08' || m === '2026-09';
  });

  let teslaValidation: DashboardData['teslaValidation'] = null;
  if (q1.length >= 5 && q3.length >= 5) {
    const q1Bids = q1.map((d) => d.highestBid);
    const q3Bids = q3.map((d) => d.highestBid);
    const q1Ci = bootstrapMedianCI(q1Bids);
    const q3Ci = bootstrapMedianCI(q3Bids);
    const mw = mannWhitneyU(q1Bids, q3Bids);
    const ciSeparated = q1Ci.ciHigh < q3Ci.ciLow || q3Ci.ciHigh < q1Ci.ciLow;
    const ciTouching = !ciSeparated && Math.max(q1Ci.ciLow, q3Ci.ciLow) <= Math.min(q1Ci.ciHigh, q3Ci.ciHigh);
    const light = trafficLight({
      n: Math.min(q1.length, q3.length),
      ciSeparated,
      ciTouching,
      pValue: mw.p,
      effectSize: mw.effectSizeRankBiserial,
    });
    teslaValidation = {
      q1: { n: q1.length, medianVal: q1Ci.median, ciLow: q1Ci.ciLow, ciHigh: q1Ci.ciHigh },
      q3: { n: q3.length, medianVal: q3Ci.median, ciLow: q3Ci.ciLow, ciHigh: q3Ci.ciHigh },
      p: mw.p,
      effectSize: mw.effectSizeRankBiserial,
      light,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    totalRows,
    droppedRows,
    cleanedN: deals.length,
    clientDeals: deals.map((d) => toClientDeal(d, removedAuctionKeys)),
    baseMonth: '2026-01',
    latestMonth,
    latestMonthPartial,
    monthlyIndex,
    rawChangeSinceJan,
    weightedChangeSinceJan,
    residualCurve,
    brandRanking,
    kwhMix,
    datekMix,
    kmMix,
    countryMix,
    teslaValidation,
  };
}

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; background: #0b0e14; color: #e6e8ec; }
  @media (prefers-color-scheme: light) { body { background: #f7f8fa; color: #16181d; } }
  header { padding: 2rem 1.5rem 1rem; max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 0 0 0.3rem; }
  .sub { opacity: 0.7; font-size: 0.9rem; }
  main { max-width: 1100px; margin: 0 auto; padding: 0 1.5rem 3rem; }
  section { margin-top: 2.2rem; }
  h2 { font-size: 1.1rem; border-bottom: 1px solid rgba(128,128,128,0.3); padding-bottom: 0.4rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin-top: 0.8rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid rgba(128,128,128,0.2); }
  th { opacity: 0.7; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-top: 1rem; }
  .card { background: rgba(128,128,128,0.08); border-radius: 10px; padding: 1rem; }
  .card .big { font-size: 1.7rem; font-weight: 700; }
  .card .label { font-size: 0.8rem; opacity: 0.7; }
  .light { display: inline-block; width: 0.7rem; height: 0.7rem; border-radius: 50%; margin-right: 0.4rem; }
  .light.green { background: #2fb85c; }
  .light.yellow { background: #d9a72b; }
  .light.red { background: #d9432b; }
  .muted { opacity: 0.6; font-size: 0.85rem; }
  .unreliable { opacity: 0.5; }
  svg { width: 100%; height: auto; background: rgba(128,128,128,0.05); border-radius: 8px; }
  .nav a { color: inherit; opacity: 0.6; text-decoration: none; margin-right: 1rem; font-size: 0.85rem; }
  .nav a:hover { opacity: 1; }
  footer { max-width: 1100px; margin: 0 auto; padding: 1.5rem; opacity: 0.5; font-size: 0.8rem; }
`;

function lineChartSvg(points: Array<{ x: number; y: number; label: string; reliable: boolean }>, width = 1000, height = 320): string {
  if (points.length === 0) return '<svg viewBox="0 0 1000 320"></svg>';
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const yValues = points.map((p) => p.y);
  const yMin = Math.min(...yValues, 100) - 5;
  const yMax = Math.max(...yValues, 100) + 5;
  const xStep = (width - padding.left - padding.right) / Math.max(1, points.length - 1);

  const toX = (i: number) => padding.left + i * xStep;
  const toY = (y: number) =>
    padding.top + (height - padding.top - padding.bottom) * (1 - (y - yMin) / (yMax - yMin));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.y).toFixed(1)}`).join(' ');
  const basePath = `M ${num(padding.left)} ${toY(100).toFixed(1)} L ${(width - padding.right).toFixed(1)} ${toY(100).toFixed(1)}`;

  const dots = points
    .map(
      (p, i) =>
        `<circle cx="${toX(i).toFixed(1)}" cy="${toY(p.y).toFixed(1)}" r="4" fill="${p.reliable ? '#4f8ff7' : '#888'}" opacity="${p.reliable ? '1' : '0.5'}"><title>${escapeHtml(p.label)}: ${p.y.toFixed(1)}</title></circle>`,
    )
    .join('');
  const labels = points
    .map((p, i) => `<text x="${toX(i).toFixed(1)}" y="${num(height - 12)}" font-size="11" text-anchor="middle" opacity="0.6">${escapeHtml(p.label)}</text>`)
    .join('');

  return `<svg viewBox="0 0 ${num(width)} ${num(height)}" xmlns="http://www.w3.org/2000/svg">
    <path d="${basePath}" stroke="rgba(128,128,128,0.4)" stroke-dasharray="4 3" fill="none" stroke-width="1"/>
    <path d="${linePath}" stroke="#4f8ff7" fill="none" stroke-width="2.5"/>
    ${dots}
    ${labels}
  </svg>`;
}

function residualCurveSvg(
  points: Array<{ t: number; rv: number }>,
  fit: ReturnType<typeof fitExponential>,
  width = 1000,
  height = 320,
): string {
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const tMax = 10;
  const toX = (t: number) => padding.left + (t / tMax) * (width - padding.left - padding.right);
  const toY = (rv: number) => padding.top + (1 - rv / 100) * (height - padding.top - padding.bottom);

  const curvePoints: string[] = [];
  for (let t = 0; t <= tMax; t += 0.2) {
    const rv = fit.a * Math.exp(-fit.b * t);
    curvePoints.push(`${toX(t).toFixed(1)},${toY(rv).toFixed(1)}`);
  }

  // Thin the scatter for display — the curve fit above already used every point;
  // rendering all of them just bloats the page weight without changing what's visible.
  const maxDots = 600;
  const stride = Math.max(1, Math.ceil(points.length / maxDots));
  const dots = points
    .filter((_, i) => i % stride === 0)
    .map((p) => `<circle cx="${toX(p.t).toFixed(1)}" cy="${toY(p.rv).toFixed(1)}" r="2" fill="#4f8ff7" opacity="0.35"/>`)
    .join('');

  return `<svg viewBox="0 0 ${num(width)} ${num(height)}" xmlns="http://www.w3.org/2000/svg">
    ${dots}
    <polyline points="${curvePoints.join(' ')}" fill="none" stroke="#e0a52f" stroke-width="3"/>
  </svg>`;
}

function readClientAsset(filename: string): string {
  return readFileSync(join(MODULE_DIR, 'client', filename), 'utf-8');
}

/** One entry in the nav bar for a brand/model-scoped page, e.g. { slug: 'tesla', label: 'Tesla' }. */
export interface SubsetPageLink {
  slug: string;
  label: string;
}

export interface InternalDashboardOptions {
  /** Restricts the page to one label (brand or model, e.g. "Tesla" or "Model Y") — adjusts copy. */
  scopeLabel?: string;
  /** 'brand': Section 4 groups by model. 'model': Section 4 is dropped entirely (nothing meaningful left to group by) and the composition table drops its "Top brand" column. */
  scopeLevel?: 'brand' | 'model';
  /** All brand/model-scoped pages to show in the nav (besides Internal/Press) — this page's own slug is highlighted active. */
  subsetPages?: SubsetPageLink[];
  /** This page's own slug within subsetPages, so the right nav link is marked active. */
  ownSlug?: string;
  /** Shows a band-tab bar (instead of the dataset tabs) that filters the whole page to one band client-side, so the fleet profile/composition table can be inspected per band. 'battery' bands by battery kWh, 'listPrice' bands by new price (list price + special equipment). */
  bandTabs?: 'battery' | 'listPrice';
}

export function renderInternalDashboard(data: DashboardData, opts: InternalDashboardOptions = {}): string {
  const css = readClientAsset('dashboard.css');
  const js = readClientAsset('dashboard.js');
  const exportDate = new Date(data.generatedAt);
  const exportDateLabel = exportDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const scopeLabel = opts.scopeLabel;
  const subsetPages = opts.subsetPages ?? [];

  const mileageBandCheckboxes = ['0-10k', '10-20k', '20-30k', '30-40k', '40-50k', '50-60k', '60-70k', '70k+']
    .map(
      (label) =>
        `<div class="band-row"><label><input type="checkbox" data-mileage-band="${label}" checked/> ${label}</label><span class="count" data-mileage-count="${label}"></span></div>`,
    )
    .join('');

  const navLinks = [
    `<a href="index.html"${opts.ownSlug === undefined ? ' class="active"' : ''}>Internal</a>`,
    `<a href="residual-value.html"${opts.ownSlug === 'residual-value' ? ' class="active"' : ''}>Residual Value</a>`,
    `<a href="demand.html"${opts.ownSlug === 'demand' ? ' class="active"' : ''}>Demand</a>`,
    `<a href="battery-bands.html"${opts.ownSlug === 'battery-bands' ? ' class="active"' : ''}>Battery Bands</a>`,
    `<a href="list-price-bands.html"${opts.ownSlug === 'list-price-bands' ? ' class="active"' : ''}>List Price Bands</a>`,
    ...subsetPages.map(
      (p) => `<a href="${p.slug}.html"${p.slug === opts.ownSlug ? ' class="active"' : ''}>${escapeHtml(p.label)}</a>`,
    ),
    `<a href="press.html">Press</a>`,
  ].join('');

  const pageTitle = scopeLabel ? `${escapeHtml(scopeLabel)} Auction Price Index` : 'EV Auction Price Index';
  const pageSub = scopeLabel
    ? `Where the market actually clears — ${escapeHtml(scopeLabel)} only. Built from the highest bid on every ${escapeHtml(scopeLabel)} auction on our platform — the price real buyers commit to.`
    : "Where the market actually clears. Built from the highest bid on every electric-vehicle auction on our platform — the price real buyers commit to.";
  const auctionsLabel = scopeLabel ? `${escapeHtml(scopeLabel)} auctions` : 'EV auctions';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${scopeLabel ? `${escapeHtml(scopeLabel)} Auction Price Index` : 'EV Auction Price Index — Internal'}</title>
<style>${css}</style>
</head>
<body>
<div class="nav">${navLinks}</div>

<header class="page-header">
  <div>
    <div class="eyebrow">⚡ Electric Vehicle Market Data</div>
    <h1>${pageTitle}</h1>
    <div class="page-sub">${pageSub}</div>
  </div>
  <div class="export-badge">
    <div><span class="dot"></span>Metabase export ${exportDateLabel}</div>
    <b>${num(data.cleanedN)} ${auctionsLabel}</b>
  </div>
</header>

${
  opts.bandTabs === 'battery'
    ? `<div class="dataset-tabs" id="band-tabs">
  <button class="dataset-tab active" data-band="all">All bands</button>
  <button class="dataset-tab" data-band="&lt;20 kWh">&lt;20 kWh</button>
  <button class="dataset-tab" data-band="20-40 kWh">20-40 kWh</button>
  <button class="dataset-tab" data-band="40-60 kWh">40-60 kWh</button>
  <button class="dataset-tab" data-band="60-80 kWh">60-80 kWh</button>
  <button class="dataset-tab" data-band="80-100 kWh">80-100 kWh</button>
  <button class="dataset-tab" data-band="100+ kWh">100+ kWh</button>
  <span class="dataset-tabs-note" id="dataset-tabs-note"></span>
</div>`
    : opts.bandTabs === 'listPrice'
      ? `<div class="dataset-tabs" id="band-tabs">
  <button class="dataset-tab active" data-band="all">All bands</button>
  <button class="dataset-tab" data-band="&lt;25k">&lt;25k</button>
  <button class="dataset-tab" data-band="25-35k">25-35k</button>
  <button class="dataset-tab" data-band="35-45k">35-45k</button>
  <button class="dataset-tab" data-band="45-60k">45-60k</button>
  <button class="dataset-tab" data-band="60-80k">60-80k</button>
  <button class="dataset-tab" data-band="80k+">80k+</button>
  <span class="dataset-tabs-note" id="dataset-tabs-note"></span>
</div>`
      : `<div class="dataset-tabs">
  <button class="dataset-tab active" data-dataset="all">All auctions</button>
  <button class="dataset-tab" data-dataset="comparable">Comparable period <span id="removed-count-badge"></span></button>
  <span class="dataset-tabs-note" id="dataset-tabs-note"></span>
</div>`
}

<main>
  <aside class="filters-panel">
    <h3>Filters</h3>
    <h4>Refine the sample</h4>
    <p class="desc">Everything is included by default. Every change updates the charts and table live.</p>
    <div class="btn-row">
      <button class="btn primary" id="btn-preset-robust">Robust index preset</button>
      <button class="btn" id="btn-reset">Reset</button>
    </div>
    <p class="preset-note">≥2 bids · accident-free · list price ≤ €60k</p>

    <div class="filter-group">
      <div class="filter-group-title">Accidents</div>
      <div class="segmented">
        <button data-accident="all" class="active">All</button>
        <button data-accident="free">Accident-free</button>
        <button data-accident="with">With accident</button>
      </div>
    </div>

    <div class="filter-group">
      <div class="filter-group-title">Mileage bands <span class="all-link">all</span></div>
      ${mileageBandCheckboxes}
    </div>

    <div class="filter-group">
      <div class="filter-group-title">Minimum number of bids</div>
      <input type="number" class="number-input" id="input-min-bids" min="0" value="0"/>
    </div>

    <div class="csv-toggle" id="csv-load-toggle">▸ Load your own data (CSV)</div>
    <div class="csv-panel" id="csv-load-panel">
      <p>Session only — nothing is uploaded or saved. Needs the same columns as a Metabase "without_filters" export.</p>
      <input type="file" id="csv-file-input" accept=".csv"/>
      <div id="csv-load-status"></div>
    </div>
  </aside>

  <div class="headline-card">
    <div>
      <div class="headline-num" id="headline-index">–</div>
      <div class="headline-num-label">Base Jan '26 = 100 · median highest bid</div>
    </div>
    <div class="headline-right">
      <span class="delta-badge up" id="headline-delta-badge">▲ <span id="headline-delta">–</span></span>
      <p id="headline-text">Computing…</p>
      <div id="chart-headline-spark"></div>
    </div>
  </div>

  <div class="filter-note">
    <span class="pill" id="sample-note">Showing all auctions</span>
  </div>

  <div class="kpi-row">
    <div class="kpi-card"><div class="label">Auctions in sample</div><div class="value" id="kpi-n">–</div></div>
    <div class="kpi-card"><div class="label">Median highest bid</div><div class="value" id="kpi-median">–</div></div>
    <div class="kpi-card"><div class="label">Average highest bid</div><div class="value" id="kpi-mean">–</div></div>
    <div class="kpi-card"><div class="label">Period covered</div><div class="value">${escapeHtml(monthKeyLabel(data.baseMonth))} – ${escapeHtml(monthKeyLabel(data.latestMonth))}</div></div>
  </div>

  <section class="section-card">
    <div class="section-label">Section 1 · Price level</div>
    <h2 class="section-title">Highest bid over time</h2>
    <p class="section-desc">Average and median winning bid per period, in euros. Bars behind show sample size (n). * Latest period is partial if the export cuts off mid-month.</p>
    <div class="btn-row">
      <div class="segmented" style="max-width:220px;"><button data-price-basis="corrected" class="active">Corrected</button><button data-price-basis="raw">Raw</button></div>
      <div class="segmented" style="max-width:180px;"><button data-granularity="month" class="active">Month</button><button data-granularity="quarter">Quarter</button></div>
    </div>
    <div class="legend"><span><span class="legend-swatch" style="background:#0e6b60;"></span>Median</span><span><span class="legend-swatch" style="background:#e0913e;"></span>Average</span><span><span class="legend-swatch" style="background:#dbe4e8;"></span>Sample size (n)</span></div>
    <div id="chart-price-level"></div>
  </section>

  <section class="section-card">
    <div class="section-label">Section 2 · Development</div>
    <h2 class="section-title">Price index — rebased to 100</h2>
    <p class="section-desc">Base period Jan '26 = 100. A value of 104 means +4% vs the base; 96 means -4%.</p>
    <div class="btn-row">
      <div class="segmented" style="max-width:220px;"><button data-index-measure="median" class="active">Median</button><button data-index-measure="average">Average</button><button data-index-measure="both">Both</button></div>
    </div>
    <div id="chart-index"></div>
  </section>

  <section class="section-card">
    <div class="section-label">Section 3 · Fleet profile</div>
    <h2 class="section-title">What's behind the price — the cars themselves</h2>
    <p class="section-desc">Median vehicle characteristics of the auctioned EVs per period. With no filters applied these are the raw fleet values.</p>
    <div class="sub-grid">
      <div class="sub-card"><div class="label">Median age</div><div class="value"><span id="stat-age">–</span> <span class="unit">months</span></div><div id="chart-age"></div></div>
      <div class="sub-card"><div class="label">Median mileage</div><div class="value"><span id="stat-km">–</span> <span class="unit">km</span></div><div id="chart-km"></div></div>
      <div class="sub-card"><div class="label">Median list price (new)</div><div class="value" id="stat-list">–</div><div id="chart-list"></div></div>
      <div class="sub-card"><div class="label">Median battery size</div><div class="value"><span id="stat-battery">–</span> <span class="unit">kWh gross</span></div><div id="chart-battery"></div></div>
      <div class="sub-card"><div class="label">Share accident-free</div><div class="value" id="stat-accidentfree">–</div><div id="chart-accidentfree"></div></div>
    </div>
  </section>

  <section class="section-card">
    <h2 class="section-title">Battery mix — share of auctions per 20 kWh band</h2>
    <p class="section-desc">Share of auctions per battery band. Each column is one period and always sums to 100%.</p>
    <div class="legend" id="legend-battery-mix"></div>
    <div id="chart-battery-mix"></div>
  </section>

  <section class="section-card">
    <h2 class="section-title">DAT-EK mix — share of auctions per price band</h2>
    <p class="section-desc">Dealer-purchase-price proxy (midpoint of the valuation range). DAT-EK coverage varies by month.</p>
    <div class="legend" id="legend-datek-mix"></div>
    <div id="chart-datek-mix"></div>
  </section>

  <div class="context-panel">
    <div class="context-tag">Context</div>
    <h2 class="section-title">Why the fleet profile shifts from April</h2>
    <div class="context-block">
      <div class="k">What changed</div>
      <p>We lowered the valuation for cheap cars — the delta to the DAT-EK valuation was set to −€2,200. Initially for cars with DAT-EK under €15,000, later extended to €20,000.</p>
    </div>
    <div class="context-block">
      <div class="k">Why</div>
      <p>For cheap cars, actual highest bids landed well below the middle of the valuation range — sellers were getting an unrealistic valuation vs. what buyers would actually pay. That mismatch meant fewer deals closed and the platform filled up with very cheap listings that rarely sold. Lowering the valuation better matches the achievable price range: fewer of these cars enter the funnel, the ones that remain have a higher chance of selling, and platform quality goes up.</p>
    </div>
    <div class="context-block">
      <div class="k">Timeline</div>
      <div class="timeline">
        <div class="timeline-item"><b>26 Feb 2026</b>Issue identified &amp; change proposed</div>
        <div class="timeline-item"><b>30 Mar 2026</b>Confirmed as effective — target of lowering the valuation worked</div>
        <div class="timeline-item"><b>08 Apr 2026</b>Extended to cars up to €20,000 DAT-EK</div>
      </div>
    </div>
    <div class="context-block">
      <div class="k">Visible from</div>
      <p>Auction data from <b>April 2026</b>. There are several weeks between valuation (M1) and auction end, so the effect only shows up with a delay. Concretely, the share of auctions with DAT-EK under €20,000 fell from ~44% (Feb/Mar) to ~28% (from April); median battery size, list price, and bid all rose over the same period. A noticeable part of the price rise since January is this deliberate mix shift — not pure market price appreciation.</p>
    </div>
    <span class="directional-tag">Directional — no controlled A/B test comparison against historical data</span>
    <div class="source">Source &amp; details: Notion · "Increase Valuation for cheaper cars"</div>
  </div>

  ${
    opts.scopeLevel === 'model'
      ? ''
      : `<section class="section-card">
    <div class="section-label">Section 4 · ${scopeLabel ? 'Model' : 'Brand &amp; origin'}</div>
    <h2 class="section-title">${scopeLabel ? 'Price &amp; mix by model' : 'Price &amp; mix by brand and country of origin'}</h2>
    <p class="section-desc">${
      scopeLabel
        ? 'Composition over time and key metrics per model.'
        : "Composition over time and key metrics per group. Switch between individual brands and the brand's country of origin."
    }</p>
    ${
      scopeLabel
        ? ''
        : '<div class="segmented" style="max-width:220px; margin-bottom:0.8rem;"><button data-group-by="country" class="active">Country of origin</button><button data-group-by="brand">Brand</button></div>'
    }
    <div class="legend" id="legend-brand-country"></div>
    <div id="chart-brand-country"></div>
    <h3 style="font-size:0.95rem; margin-top:1.3rem;">Metrics per group</h3>
    <p class="section-desc">Base for Δ = Jan 2026 median vs latest period median.</p>
    <table>
      <thead><tr>
        <th data-sort-table="brand-country" data-sort-col="label">Group</th><th data-sort-table="brand-country" data-sort-col="n">n</th><th>Share</th><th data-sort-table="brand-country" data-sort-col="medianBid">Median bid</th><th>Δ vs Jan</th><th>Age (mo)</th><th>Median km</th><th>Battery</th><th>Accident-free</th>
      </tr></thead>
      <tbody id="brand-country-table-body"></tbody>
    </table>
  </section>`
  }

  <section class="section-card">
    <div class="section-label">Breakdown</div>
    <h2 class="section-title">Composition by period</h2>
    <p class="section-desc">${opts.scopeLevel === 'model' ? 'Mileage coverage and price for the filtered sample. Click a header to sort.' : 'Brand mix, mileage coverage, and price for the filtered sample. Click a header to sort.'}</p>
    <div class="segmented" style="max-width:180px; margin-bottom:0.8rem;">
      <button data-granularity="month" class="active">Month</button><button data-granularity="quarter">Quarter</button>
    </div>
    <table>
      <thead><tr>
        <th data-sort-table="composition" data-sort-col="period">Period</th><th data-sort-table="composition" data-sort-col="n">n</th>${opts.scopeLevel === 'model' ? '' : '<th>Top brand</th>'}<th data-sort-table="composition" data-sort-col="pctWithKm">% with km</th><th data-sort-table="composition" data-sort-col="avgKm">Avg km</th><th data-sort-table="composition" data-sort-col="medianKm">Median km</th><th data-sort-table="composition" data-sort-col="avgBid">Avg bid</th><th data-sort-table="composition" data-sort-col="medianBid">Median bid</th>
      </tr></thead>
      <tbody id="composition-table-body"></tbody>
      <tfoot><tr id="composition-total-row"></tr></tfoot>
    </table>
  </section>

  <section class="methodology-note">
    <b>Methodology.</b> This index measures the highest (winning) bid on every EV auction — the clearest market signal we have for what buyers will actually pay. We use the pre-reconciled <b>corrected</b> bid column, which already harmonises the two tax regimes in our data (margin-taxed / Differenzbesteuerung and VAT-deductible / Regelbesteuerung), so gross vs. net is not re-derived here. The headline uses the <b>median</b> because auction prices are right-skewed and the median resists outliers; the average is shown alongside. The index in Section 2 rebases the median to <b>January 2026 = 100</b> (the earliest month in the data). Section 3 tracks the composition of the auctioned fleet (age, mileage, list price, battery, accident-free share) so price moves can be read against what was actually sold. Periods with fewer than 5 auctions are drawn dashed/greyed so small samples aren't over-read. All figures update live from the currently-selected auctions of ${num(data.cleanedN)} total; all filtering and statistics are computed in the browser from the raw rows.
  </section>

  <section class="caveats">
    <b>Caveats</b>
    <ul>
      <li>Selection bias — only cars that entered the auction; not the whole market.</li>
      <li>Wholesale character — auction prices, conservative vs. end-customer price.</li>
      <li>Mix effect — share the overall index only mix-adjusted where possible.</li>
      <li>Special equipment price is only ~51% filled; an empty field is treated as €0 here (open question for Marco/Lukas).</li>
      <li>DAT-EK is only a proxy (midpoint of the valuation range); coverage varies by month.</li>
      <li>The latest month in the export may be partial.</li>
      <li>Mileage is a weak predictor of residual value (R² ~0.06); age and mileage are correlated.</li>
    </ul>
  </section>
</main>

<footer class="page-footer">${pageTitle} · figures reflect the currently applied filters · median used as the headline measure for robustness.</footer>

<script>
window.EV_DASHBOARD = {
  deals: ${JSON.stringify(data.clientDeals)},
  baseMonth: ${JSON.stringify(data.baseMonth)},
  latestMonth: ${JSON.stringify(data.latestMonth)},
  latestMonthPartial: ${JSON.stringify(data.latestMonthPartial)},
  scopeLevel: ${JSON.stringify(opts.scopeLevel ?? null)},
  defaultGroupBy: ${JSON.stringify(opts.scopeLevel === 'brand' ? 'model' : 'country')},
  bandTabs: ${JSON.stringify(opts.bandTabs ?? null)}
};
</script>
<script>${js}</script>
</body>
</html>`;
}

export function renderPressDashboard(data: DashboardData): string {
  const eligibleBrands = data.brandRanking.filter((b) => b.n >= 60);
  const top10 = eligibleBrands.slice(0, 10);

  const brandRows = top10
    .map(
      (b, i) =>
        `<tr><td>${num(i + 1)}</td><td>${escapeHtml(b.brand)}</td><td>${b.medianResidualAt3to4y !== null ? fmtPct(b.medianResidualAt3to4y) : '–'}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>EV Resale Index</title>
<style>${PAGE_STYLE}
  body { text-align: center; }
  .headline { font-size: 2.4rem; font-weight: 800; margin: 1rem 0 0.3rem; }
  .n-anchor { font-size: 1rem; opacity: 0.75; margin-bottom: 2rem; }
  table { max-width: 500px; margin: 1rem auto; }
  th, td { text-align: center; }
</style>
</head>
<body>
<header>
  <div class="nav"><a href="index.html">Intern</a><a href="press.html">Presse</a></div>
  <h1>EV Resale Index</h1>
</header>
<main>
  <div class="n-anchor">${data.cleanedN.toLocaleString('de-DE')} echte Auktionen ausgewertet</div>
  <div class="headline">${data.weightedChangeSinceJan >= 0 ? '+' : ''}${fmtPct(data.weightedChangeSinceJan)}</div>
  <p class="muted">Mix-bereinigter EV-Auktionspreis-Index seit Januar 2026 (Median, kWh-gewichtet)</p>

  ${lineChartSvg(
    data.monthlyIndex.filter((m) => m.indexWeighted !== null).map((m) => ({ x: 0, y: m.indexWeighted as number, label: m.month, reliable: m.reliable })),
    900,
    280,
  )}

  <section>
    <h2>So verlieren EVs an Wert</h2>
    ${residualCurveSvg(data.residualCurve.points, data.residualCurve.exponential, 900, 300)}
    <p class="muted">Restwertkurve über alle Marken, 0–10 Jahre Fahrzeugalter.</p>
  </section>

  <section>
    <h2>Restwert-Ranking nach Marke (bei 3–4 Jahren)</h2>
    <table>
      <thead><tr><th>#</th><th>Marke</th><th>Median-Restwert</th></tr></thead>
      <tbody>${brandRows}</tbody>
    </table>
    <p class="muted">Nur Marken mit mindestens 60 ausgewerteten Auktionen in diesem Altersband.</p>
  </section>

  <p class="muted" style="margin-top: 3rem;">Methodik: Median des höchsten Gebots je Auktion (steuerbereinigt), mix-bereinigt nach Batteriekapazität. Restwert = höchstes Gebot / Neupreis (inkl. Sonderausstattung).</p>
</main>
<footer>EV Resale Index · Aampere</footer>
</body>
</html>`;
}

export function renderResidualValueDashboard(data: DashboardData, subsetPages: SubsetPageLink[] = []): string {
  const css = readClientAsset('dashboard.css');
  const js = readClientAsset('residual-dashboard.js');

  const navLinks = [
    `<a href="index.html">Internal</a>`,
    `<a href="residual-value.html" class="active">Residual Value</a>`,
    `<a href="demand.html">Demand</a>`,
    `<a href="battery-bands.html">Battery Bands</a>`,
    `<a href="list-price-bands.html">List Price Bands</a>`,
    ...subsetPages.map((p) => `<a href="${p.slug}.html">${escapeHtml(p.label)}</a>`),
    `<a href="press.html">Press</a>`,
  ].join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Residual Value Curves — Internal</title>
<style>${css}</style>
</head>
<body>
<div class="nav">${navLinks}</div>

<header class="page-header">
  <div>
    <div class="eyebrow">⚡ Electric Vehicle Market Data</div>
    <h1>Residual Value Curves</h1>
    <div class="page-sub">How EVs lose value with age, split by country of origin or brand. Each curve is a separate exponential fit (RV = a·e^(−b·t)) on that cluster's own auctions — toggle clusters on/off to compare.</div>
  </div>
  <div class="export-badge">
    <b>${num(data.cleanedN)} EV auctions</b>
  </div>
</header>

<main class="full-width">
  <section class="section-card">
    <div class="section-label">Cluster by</div>
    <div class="cluster-controls">
      <div class="segmented" style="max-width:220px;"><button data-cluster-mode="country" class="active">Country of origin</button><button data-cluster-mode="brand">Brand</button></div>
      <button class="btn" id="btn-toggle-all">Show all</button>
      <button class="btn" id="btn-toggle-none">Hide all</button>
      <div class="segmented" style="max-width:260px;"><button data-residual-accident="all" class="active">All</button><button data-residual-accident="free">Accident-free only</button><button data-residual-accident="with">With accident only</button></div>
    </div>
    <div class="cluster-toggles" id="cluster-toggles"></div>
    <div class="legend" id="legend-residual-curves"></div>
    <div id="chart-residual-curves"></div>
    <div class="thin-clusters-note" id="thin-clusters-note"></div>
  </section>

  <section class="methodology-note">
    <b>Methodology.</b> Residual value = highest bid (corrected) / new price (list price + special equipment) × 100, per auction. Each cluster's curve is an exponential fit (RV = a·e^(−b·t), t in years) via log-linear regression on its own auctions, restricted to the 0–10 year age window and 5–120% plausible-residual range (methodology §3/§6) — the same fit the brand ranking on the internal dashboard uses. Clusters with fewer than 15 vehicles in that window aren't fitted (listed below the chart instead) since a curve on that little data isn't reliable. This is a wholesale/auction value — conservative vs. end-customer resale price — so compare shapes and relative ranking, not the absolute level.
  </section>
</main>

<footer class="page-footer">Residual Value Curves · fit per visible cluster, computed live from ${num(data.cleanedN)} auctions.</footer>

<script>
window.EV_DASHBOARD = {
  deals: ${JSON.stringify(data.clientDeals)}
};
</script>
<script>${js}</script>
</body>
</html>`;
}

export function renderDemandDashboard(data: DashboardData, subsetPages: SubsetPageLink[] = []): string {
  const css = readClientAsset('dashboard.css');
  const js = readClientAsset('demand-dashboard.js');

  const navLinks = [
    `<a href="index.html">Internal</a>`,
    `<a href="residual-value.html">Residual Value</a>`,
    `<a href="demand.html" class="active">Demand</a>`,
    `<a href="battery-bands.html">Battery Bands</a>`,
    `<a href="list-price-bands.html">List Price Bands</a>`,
    ...subsetPages.map((p) => `<a href="${p.slug}.html">${escapeHtml(p.label)}</a>`),
    `<a href="press.html">Press</a>`,
  ].join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Demand Ranking — Internal</title>
<style>${css}</style>
</head>
<body>
<div class="nav">${navLinks}</div>

<header class="page-header">
  <div>
    <div class="eyebrow">⚡ Electric Vehicle Market Data</div>
    <h1>Demand Ranking</h1>
    <div class="page-sub">Which cars draw the most competitive bidding — average number of bids per auction, independent of price. A high-priced car that draws few bids isn't necessarily "in demand"; a car that consistently pulls a crowd of bidders is.</div>
  </div>
  <div class="export-badge">
    <b>${num(data.cleanedN)} EV auctions</b>
  </div>
</header>

<main class="full-width">
  <section class="section-card">
    <div class="section-label">View</div>
    <div class="cluster-controls">
      <div class="segmented" style="max-width:220px;"><button data-demand-view="rank" class="active">Ranking</button><button data-demand-view="time">Over time</button></div>
      <div class="segmented" style="max-width:520px;"><button data-demand-mode="model" class="active">Model</button><button data-demand-mode="brand">Brand</button><button data-demand-mode="country">Country of origin</button><button data-demand-mode="km">Mileage</button><button data-demand-mode="age">Age</button></div>
      <div class="segmented" style="max-width:180px;"><button data-demand-metric="mean" class="active">Average</button><button data-demand-metric="median">Median</button></div>
      <div class="segmented" style="max-width:260px;"><button data-demand-accident="all" class="active">All</button><button data-demand-accident="free">Accident-free only</button><button data-demand-accident="with">With accident only</button></div>
    </div>
    <div class="cluster-toggles" id="demand-cluster-toggles" style="display:none;"></div>
    <div class="legend" id="legend-demand-time" style="display:none;"></div>
    <div id="chart-demand-ranking"></div>
    <div class="thin-clusters-note" id="demand-thin-note"></div>
  </section>

  <section class="section-card" id="demand-table-section">
    <h2 class="section-title">Full ranking</h2>
    <table>
      <thead><tr><th>#</th><th>Name</th><th>Avg bids</th><th>n</th></tr></thead>
      <tbody id="demand-table-body"></tbody>
    </table>
  </section>

  <section class="methodology-note">
    <b>Methodology.</b> "Number of bids" counts every bid placed on an auction, regardless of price. This is a demand/desirability signal independent of the price index and residual-value curves — a car can be expensive AND in low demand (few, high bids from committed buyers) or affordable AND in high demand (many competing bids). "Ranking" sorts by average bids; mileage and age are shown as trend bands in their natural order (not ranked) since the question there is "does demand rise or fall along this axis," not "which band wins." "Over time" plots one line per cluster (brand/country/model — mileage/age fall back to brand, since a 3-axis chart isn't legible) across the months in the export, so demand trends can be compared between clusters instead of just seeing the market total; toggle clusters on/off to compare. The accident-free filter applies to every view. Groups below the minimum sample size (30 for brand/country/mileage/age, 20 for model, 15 auctions/month for "Over time" clusters) aren't shown since their average would be too noisy to trust.
  </section>
</main>

<footer class="page-footer">Demand Ranking · average bids per auction, computed live from ${num(data.cleanedN)} auctions.</footer>

<script>
window.EV_DASHBOARD = {
  deals: ${JSON.stringify(data.clientDeals)}
};
</script>
<script>${js}</script>
</body>
</html>`;
}
