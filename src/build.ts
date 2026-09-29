import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateEnv } from './env.js';
import { findLatestCsv, loadDeals, loadRemovedAuctionKeys } from './load.js';
import { computeDashboardData, renderInternalDashboard, renderPressDashboard } from './viz.js';

// Always validate secrets first — if something is missing, the app stops here
// with a friendly message instead of crashing somewhere deep inside.
// (This app currently needs no secrets, but every entry point checks anyway.)
validateEnv();

const dataDir = join(process.cwd(), 'data');
const outputsDir = join(process.cwd(), 'outputs');

const csvPath = findLatestCsv(dataDir);
console.log(`Reading ${csvPath}`);

const { deals, totalRows, droppedRows } = loadDeals(csvPath);
console.log(`Loaded ${totalRows.toString()} rows, kept ${deals.length.toString()} after cleaning (${droppedRows.toString()} dropped).`);

// Optional: auctions removed by the valuation-algorithm change (methodology §9).
// Not every export has this file — only present when investigating the mix shift.
const removedAuctionsPath = join(dataDir, 'entfernte_auktionen.csv');
const removedAuctionKeys = existsSync(removedAuctionsPath) ? loadRemovedAuctionKeys(removedAuctionsPath) : new Set<string>();
if (removedAuctionKeys.size > 0) {
  console.log(`Loaded ${removedAuctionKeys.size.toString()} removed-auction keys from ${removedAuctionsPath}`);
}

const data = computeDashboardData(deals, totalRows, droppedRows, removedAuctionKeys);

// Brand/model-scoped pages — each gets the full interactive dashboard, pre-filtered.
// Order here also sets the nav order (besides the fixed Internal/Press ends).
const subsetPages: Array<{ slug: string; label: string; scopeLevel: 'brand' | 'model'; deals: typeof deals }> = [
  { slug: 'tesla', label: 'Tesla', scopeLevel: 'brand', deals: deals.filter((d) => d.brand === 'Tesla') },
  { slug: 'model-y', label: 'Model Y', scopeLevel: 'model', deals: deals.filter((d) => d.brand === 'Tesla' && d.model === 'Model Y') },
  { slug: 'model-3', label: 'Model 3', scopeLevel: 'model', deals: deals.filter((d) => d.brand === 'Tesla' && d.model === 'Model 3') },
];
const navLinks = subsetPages.map((p) => ({ slug: p.slug, label: p.label }));

mkdirSync(outputsDir, { recursive: true });
writeFileSync(join(outputsDir, 'index.html'), renderInternalDashboard(data, { subsetPages: navLinks }), 'utf-8');
console.log(`Wrote ${join(outputsDir, 'index.html')}`);

for (const page of subsetPages) {
  const pageData = computeDashboardData(page.deals, page.deals.length, 0, removedAuctionKeys);
  const html = renderInternalDashboard(pageData, {
    scopeLabel: page.label,
    scopeLevel: page.scopeLevel,
    subsetPages: navLinks,
    ownSlug: page.slug,
  });
  writeFileSync(join(outputsDir, `${page.slug}.html`), html, 'utf-8');
  console.log(`Wrote ${join(outputsDir, `${page.slug}.html`)} (${page.deals.length.toString()} auctions)`);
}

writeFileSync(join(outputsDir, 'press.html'), renderPressDashboard(data), 'utf-8');
console.log(`Wrote ${join(outputsDir, 'press.html')}`);
console.log(
  `Index since Jan 2026: raw ${data.rawChangeSinceJan >= 0 ? '+' : ''}${data.rawChangeSinceJan.toFixed(1)}%, mix-adjusted ${data.weightedChangeSinceJan >= 0 ? '+' : ''}${data.weightedChangeSinceJan.toFixed(1)}%.`,
);
