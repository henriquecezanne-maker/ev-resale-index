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

const teslaDeals = deals.filter((d) => d.brand === 'Tesla');
const teslaData = computeDashboardData(teslaDeals, teslaDeals.length, 0, removedAuctionKeys);

mkdirSync(outputsDir, { recursive: true });
writeFileSync(join(outputsDir, 'index.html'), renderInternalDashboard(data), 'utf-8');
writeFileSync(join(outputsDir, 'tesla.html'), renderInternalDashboard(teslaData, { brand: 'Tesla' }), 'utf-8');
writeFileSync(join(outputsDir, 'press.html'), renderPressDashboard(data), 'utf-8');

console.log(`Wrote ${join(outputsDir, 'index.html')}`);
console.log(`Wrote ${join(outputsDir, 'tesla.html')} (${teslaDeals.length.toString()} Tesla auctions)`);
console.log(`Wrote ${join(outputsDir, 'press.html')}`);
console.log(
  `Index since Jan 2026: raw ${data.rawChangeSinceJan >= 0 ? '+' : ''}${data.rawChangeSinceJan.toFixed(1)}%, mix-adjusted ${data.weightedChangeSinceJan >= 0 ? '+' : ''}${data.weightedChangeSinceJan.toFixed(1)}%.`,
);
