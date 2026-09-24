import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Papa from 'papaparse';

export interface Deal {
  brand: string;
  model: string;
  endDate: Date;
  bids: number;
  km: number;
  ageYears: number;
  batteryKwh: number;
  powerKw: number;
  listPrice: number;
  specialEquipment: number;
  newPrice: number;
  highestBid: number;
  highestBidRaw: number;
  accidentFree: boolean;
  taxation: string;
  datekProxy: number | null;
  valuationMin: number | null;
  valuationMax: number | null;
  residualPct: number;
}

// Duplicate spellings that Metabase exports under different casings — merge to one canonical name (methodology §2).
const BRAND_CANONICALIZATION: Record<string, string> = {
  vw: 'Volkswagen',
  mercedes: 'Mercedes-Benz',
  mini: 'MINI',
  citroen: 'Citroën',
  xpeng: 'Xpeng',
  XPeng: 'Xpeng',
  MAXUS: 'Maxus',
  ds: 'DS Automobiles',
  'gwm (great wall motor)': 'GWM',
};

function canonicalizeBrand(raw: string): string {
  const trimmed = raw.trim();
  return BRAND_CANONICALIZATION[trimmed] ?? BRAND_CANONICALIZATION[trimmed.toLowerCase()] ?? trimmed;
}

function toNumber(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Finds the newest CSV file in `data/` (by filename, which Metabase timestamps). */
export function findLatestCsv(dataDir: string): string {
  const files = readdirSync(dataDir).filter((f) => f.toLowerCase().endsWith('.csv'));
  if (files.length === 0) {
    throw new Error(`No CSV file found in ${dataDir}. Drop a Metabase export there first.`);
  }
  files.sort();
  return join(dataDir, files[files.length - 1] as string);
}

interface RawRow {
  'End Time': string;
  'Number Of Bids': string;
  'Highest Bid corrected': string;
  'Highest Bid Amount': string;
  'Deal → Make': string;
  'Deal → Model': string;
  'Deal → First Registration': string;
  'Deal → Mileage': string;
  'Deal → Battery Capacity Brutto': string;
  'Deal → Power Kw': string;
  'Deal → List Price': string;
  'Deal → Special Equipment Price': string;
  'Deal → Accident Free Seller': string;
  'Deal → Accident Free Cardentity': string;
  'Deal → Taxation': string;
  'Valuation Range → Min': string;
  'Valuation Range → Max': string;
}

/** Parses and cleans a Metabase "without_filters" export into analysis-ready Deal rows (methodology §2-3). */
export function loadDeals(csvPath: string): { deals: Deal[]; totalRows: number; droppedRows: number } {
  const raw = readFileSync(csvPath, 'utf-8');
  const parsed = Papa.parse<RawRow>(raw, { header: true, skipEmptyLines: true });
  const rows = parsed.data;
  const totalRows = rows.length;

  const deals: Deal[] = [];
  for (const row of rows) {
    const make = row['Deal → Make'].trim();
    const endTimeRaw = row['End Time'].trim();
    const highestBid = toNumber(row['Highest Bid corrected']);
    const listPrice = toNumber(row['Deal → List Price']);

    // Cleaning filter (methodology §3): valid End Time, Make present, Highest Bid corrected > 0, List Price > 0.
    if (!make || !endTimeRaw || highestBid <= 0 || listPrice <= 0) continue;

    const endDate = new Date(endTimeRaw);
    if (Number.isNaN(endDate.getTime())) continue;

    const firstRegRaw = row['Deal → First Registration'].trim();
    const firstReg = firstRegRaw ? new Date(firstRegRaw) : null;
    if (!firstReg || Number.isNaN(firstReg.getTime())) continue;

    const ageYears = (endDate.getTime() - firstReg.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

    const specialEquipment = Math.max(0, toNumber(row['Deal → Special Equipment Price']));
    const newPrice = listPrice + specialEquipment;
    const residualPct = (highestBid / newPrice) * 100;

    const vMin = toNullableNumber(row['Valuation Range → Min']);
    const vMax = toNullableNumber(row['Valuation Range → Max']);

    deals.push({
      brand: canonicalizeBrand(make),
      model: row['Deal → Model'].trim(),
      endDate,
      bids: toNumber(row['Number Of Bids']),
      km: toNumber(row['Deal → Mileage']),
      ageYears,
      batteryKwh: toNumber(row['Deal → Battery Capacity Brutto']),
      powerKw: toNumber(row['Deal → Power Kw']),
      listPrice,
      specialEquipment,
      newPrice,
      highestBid,
      highestBidRaw: toNumber(row['Highest Bid Amount']),
      accidentFree:
        row['Deal → Accident Free Seller'].trim() === 'true' &&
        row['Deal → Accident Free Cardentity'].trim() === 'true',
      taxation: row['Deal → Taxation'].trim(),
      datekProxy: vMin !== null && vMax !== null ? (vMin + vMax) / 2 : null,
      valuationMin: vMin,
      valuationMax: vMax,
      residualPct,
    });
  }

  return { deals, totalRows, droppedRows: totalRows - deals.length };
}

/** Residual value clipped to the plausible range (methodology §3: 5%-120%). */
export function isPlausibleResidual(deal: Deal): boolean {
  return deal.residualPct >= 5 && deal.residualPct <= 120;
}

/** Age window for residual-value analysis (methodology §3: 0-10 years). */
export function isInResidualAgeWindow(deal: Deal): boolean {
  return deal.ageYears >= 0 && deal.ageYears <= 10;
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear().toString()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Compact per-deal row shape embedded into the internal dashboard for client-side filtering. Short keys keep the payload small across ~4,800 rows. */
export interface ClientDeal {
  b: string; // brand
  m: string; // model
  mo: string; // month key (YYYY-MM)
  bi: number; // bids
  km: number;
  ag: number; // age years
  bk: number; // battery kWh
  pk: number; // power kW
  lp: number; // list price
  se: number; // special equipment
  np: number; // new price
  hb: number; // highest bid corrected
  hr: number; // highest bid raw
  af: boolean; // accident free
  tx: string; // taxation
  dk: number | null; // datek proxy
  rv: number; // residual %
}

export function toClientDeal(deal: Deal): ClientDeal {
  return {
    b: deal.brand,
    m: deal.model,
    mo: monthKey(deal.endDate),
    bi: deal.bids,
    km: deal.km,
    ag: Math.round(deal.ageYears * 100) / 100,
    bk: deal.batteryKwh,
    pk: deal.powerKw,
    lp: deal.listPrice,
    se: deal.specialEquipment,
    np: deal.newPrice,
    hb: deal.highestBid,
    hr: deal.highestBidRaw,
    af: deal.accidentFree,
    tx: deal.taxation,
    dk: deal.datekProxy,
    rv: Math.round(deal.residualPct * 100) / 100,
  };
}
