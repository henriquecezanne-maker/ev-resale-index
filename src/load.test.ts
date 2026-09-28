import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findLatestCsv, isRemovedAuction, loadDeals, loadRemovedAuctionKeys, monthKey } from './load.js';

const HEADER = [
  'ID',
  'Deal ID',
  'End Time',
  'Status',
  'Updated At',
  'Auction Sequence',
  'Highest Bid Amount',
  'Number Of Bids',
  'Lost Reason',
  'Auction Reason ID',
  'Highest Bid corrected',
  'Deal → ID',
  'Valuation Range → Max',
  'Valuation Range → Min',
  'Valuation Range → Type',
  'Deal → Created At',
  'Deal → Updated At',
  'Deal → Pipedrive Deal ID',
  'Deal → Cardetails ID',
  'Deal → Selling Details ID',
  'Deal → Short Name',
  'Deal → Make',
  'Deal → Model',
  'Deal → Variant',
  'Deal → First Registration',
  'Deal → Mileage',
  'Deal → Battery Capacity Brutto',
  'Deal → Battery Capacity Netto',
  'Deal → Power Kw',
  'Deal → Power Ps',
  'Deal → Vin',
  'Deal → Tuv Until',
  'Deal → Selling Country',
  'Deal → Seller Type',
  'Deal → Accident Free Seller',
  'Deal → List Price',
  'Deal → Special Equipment Price',
  'Deal → Service Maintained',
  'Deal → Tesla Autopilot',
  'Deal → Heatpump',
  'Deal → Trailer Hitch',
  'Deal → Trailer Hitch Seller',
  'Deal → Drive Type',
  'Deal → Conditions',
  'Deal → Equipment',
  'Deal → Form Of Ownership',
  'Deal → Taxation',
  'Deal → Valuation Range',
  'Deal → Dat Ecode',
  'Deal → Equipment Original',
  'Deal → Listing ID',
  'Deal → Acc',
  'Deal → Accident Free Cardentity',
];

function makeRow(overrides: Record<string, string>): string {
  const values = HEADER.map((col) => overrides[col] ?? '');
  return values.map((v) => (v.includes(',') ? `"${v}"` : v)).join(',');
}

function writeCsv(dir: string, filename: string, rows: string[]): void {
  writeFileSync(join(dir, filename), [HEADER.join(','), ...rows].join('\n'), 'utf-8');
}

describe('loadDeals', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('canonicalizes duplicate brand spellings, methodology §2', () => {
    dir = mkdtempSync(join(tmpdir(), 'ev-resale-test-'));
    const row = makeRow({
      'End Time': '2026-03-01T10:00:00Z',
      'Deal → Make': 'vw',
      'Deal → Model': 'ID.3',
      'Deal → First Registration': '2023-01-01',
      'Highest Bid corrected': '20000',
      'Deal → List Price': '30000',
      'Deal → Special Equipment Price': '0',
      'Deal → Accident Free Seller': 'true',
      'Deal → Accident Free Cardentity': 'true',
    });
    writeCsv(dir, 'export.csv', [row]);
    const { deals } = loadDeals(join(dir, 'export.csv'));
    expect(deals).toHaveLength(1);
    expect(deals[0]?.brand).toBe('Volkswagen');
  });

  it('drops rows failing the cleaning filter, methodology §3', () => {
    dir = mkdtempSync(join(tmpdir(), 'ev-resale-test-'));
    const validRow = makeRow({
      'End Time': '2026-03-01T10:00:00Z',
      'Deal → Make': 'Tesla',
      'Deal → Model': 'Model 3',
      'Deal → First Registration': '2023-01-01',
      'Highest Bid corrected': '20000',
      'Deal → List Price': '30000',
      'Deal → Accident Free Seller': 'true',
      'Deal → Accident Free Cardentity': 'true',
    });
    const noMake = makeRow({
      'End Time': '2026-03-01T10:00:00Z',
      'Deal → Make': '',
      'Deal → First Registration': '2023-01-01',
      'Highest Bid corrected': '20000',
      'Deal → List Price': '30000',
    });
    const zeroBid = makeRow({
      'End Time': '2026-03-01T10:00:00Z',
      'Deal → Make': 'Tesla',
      'Deal → First Registration': '2023-01-01',
      'Highest Bid corrected': '0',
      'Deal → List Price': '30000',
    });
    const zeroListPrice = makeRow({
      'End Time': '2026-03-01T10:00:00Z',
      'Deal → Make': 'Tesla',
      'Deal → First Registration': '2023-01-01',
      'Highest Bid corrected': '20000',
      'Deal → List Price': '0',
    });
    writeCsv(dir, 'export.csv', [validRow, noMake, zeroBid, zeroListPrice]);
    const { deals, totalRows, droppedRows } = loadDeals(join(dir, 'export.csv'));
    expect(totalRows).toBe(4);
    expect(deals).toHaveLength(1);
    expect(droppedRows).toBe(3);
  });

  it('computes new_price = list_price + special_equipment, methodology §2/§6', () => {
    dir = mkdtempSync(join(tmpdir(), 'ev-resale-test-'));
    const row = makeRow({
      'End Time': '2026-03-01T10:00:00Z',
      'Deal → Make': 'BMW',
      'Deal → First Registration': '2023-01-01',
      'Highest Bid corrected': '22000',
      'Deal → List Price': '40000',
      'Deal → Special Equipment Price': '5000',
    });
    writeCsv(dir, 'export.csv', [row]);
    const { deals } = loadDeals(join(dir, 'export.csv'));
    expect(deals[0]?.newPrice).toBe(45000);
    expect(deals[0]?.residualPct).toBeCloseTo((22000 / 45000) * 100, 5);
  });

  it('requires both accident-free flags true (conservative AND), methodology §2', () => {
    dir = mkdtempSync(join(tmpdir(), 'ev-resale-test-'));
    const row = makeRow({
      'End Time': '2026-03-01T10:00:00Z',
      'Deal → Make': 'BMW',
      'Deal → First Registration': '2023-01-01',
      'Highest Bid corrected': '22000',
      'Deal → List Price': '40000',
      'Deal → Accident Free Seller': 'true',
      'Deal → Accident Free Cardentity': 'false',
    });
    writeCsv(dir, 'export.csv', [row]);
    const { deals } = loadDeals(join(dir, 'export.csv'));
    expect(deals[0]?.accidentFree).toBe(false);
  });
});

describe('findLatestCsv', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('picks the lexicographically latest CSV filename', () => {
    dir = mkdtempSync(join(tmpdir(), 'ev-resale-test-'));
    writeFileSync(join(dir, 'export_2026-01-01.csv'), 'a', 'utf-8');
    writeFileSync(join(dir, 'export_2026-06-01.csv'), 'b', 'utf-8');
    writeFileSync(join(dir, 'notes.txt'), 'c', 'utf-8');
    expect(findLatestCsv(dir)).toBe(join(dir, 'export_2026-06-01.csv'));
  });

  it('throws a friendly error when no CSV exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'ev-resale-test-'));
    expect(() => findLatestCsv(dir)).toThrow('No CSV file found');
  });
});

describe('monthKey', () => {
  it('formats as YYYY-MM in UTC', () => {
    expect(monthKey(new Date('2026-09-18T09:00:00Z'))).toBe('2026-09');
  });
});

describe('loadRemovedAuctionKeys / isRemovedAuction', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('matches deals removed by the valuation-algorithm change on month+brand+bid+listPrice+km', () => {
    dir = mkdtempSync(join(tmpdir(), 'ev-resale-test-'));
    const removedCsv = [
      'Monat,Marke,Modell,Variante,DAT EK (Proxy),Höchstgebot,Listenpreis,Batterie kWh,km,Leistung kW',
      '2026-02,Smart,forfour,EQ(453.091),5600.0,3700.0,22031,17.6,50000,60.0',
    ].join('\n');
    writeFileSync(join(dir, 'entfernte_auktionen.csv'), removedCsv, 'utf-8');

    const keys = loadRemovedAuctionKeys(join(dir, 'entfernte_auktionen.csv'));
    expect(keys.size).toBe(1);

    const row = makeRow({
      'End Time': '2026-02-15T10:00:00Z',
      'Deal → Make': 'Smart',
      'Deal → First Registration': '2023-01-01',
      'Highest Bid corrected': '3700',
      'Deal → List Price': '22031',
      'Deal → Mileage': '50000',
    });
    writeCsv(dir, 'export.csv', [row]);
    const { deals } = loadDeals(join(dir, 'export.csv'));
    expect(deals).toHaveLength(1);
    for (const deal of deals) {
      expect(isRemovedAuction(deal, keys)).toBe(true);
    }
  });

  it('does not match deals in a different month or with a different highest bid', () => {
    dir = mkdtempSync(join(tmpdir(), 'ev-resale-test-'));
    const removedCsv = [
      'Monat,Marke,Modell,Variante,DAT EK (Proxy),Höchstgebot,Listenpreis,Batterie kWh,km,Leistung kW',
      '2026-02,Smart,forfour,EQ(453.091),5600.0,3700.0,22031,17.6,50000,60.0',
    ].join('\n');
    writeFileSync(join(dir, 'entfernte_auktionen.csv'), removedCsv, 'utf-8');
    const keys = loadRemovedAuctionKeys(join(dir, 'entfernte_auktionen.csv'));

    const differentMonth = makeRow({
      'End Time': '2026-03-15T10:00:00Z',
      'Deal → Make': 'Smart',
      'Deal → First Registration': '2023-01-01',
      'Highest Bid corrected': '3700',
      'Deal → List Price': '22031',
      'Deal → Mileage': '50000',
    });
    const differentBid = makeRow({
      'End Time': '2026-02-15T10:00:00Z',
      'Deal → Make': 'Smart',
      'Deal → First Registration': '2023-01-01',
      'Highest Bid corrected': '3701',
      'Deal → List Price': '22031',
      'Deal → Mileage': '50000',
    });
    writeCsv(dir, 'export.csv', [differentMonth, differentBid]);
    const { deals } = loadDeals(join(dir, 'export.csv'));
    expect(deals).toHaveLength(2);
    expect(deals.every((d) => !isRemovedAuction(d, keys))).toBe(true);
  });

  it('disambiguates two deals sharing month+brand+highestBid by list price and mileage', () => {
    dir = mkdtempSync(join(tmpdir(), 'ev-resale-test-'));
    const removedCsv = [
      'Monat,Marke,Modell,Variante,DAT EK (Proxy),Höchstgebot,Listenpreis,Batterie kWh,km,Leistung kW',
      '2026-02,Renault,Zoe,Life,10100.0,8400.0,29990,44.1,27500,80.0',
    ].join('\n');
    writeFileSync(join(dir, 'entfernte_auktionen.csv'), removedCsv, 'utf-8');
    const keys = loadRemovedAuctionKeys(join(dir, 'entfernte_auktionen.csv'));

    // Same month/brand/bid as the removed row, but a different car (different list price + km) — must NOT match.
    const lookalike = makeRow({
      'End Time': '2026-02-10T10:00:00Z',
      'Deal → Make': 'Renault',
      'Deal → First Registration': '2023-01-01',
      'Highest Bid corrected': '8400',
      'Deal → List Price': '37812',
      'Deal → Mileage': '63000',
    });
    const actualRemoved = makeRow({
      'End Time': '2026-02-20T10:00:00Z',
      'Deal → Make': 'Renault',
      'Deal → First Registration': '2023-01-01',
      'Highest Bid corrected': '8400',
      'Deal → List Price': '29990',
      'Deal → Mileage': '27500',
    });
    writeCsv(dir, 'export.csv', [lookalike, actualRemoved]);
    const { deals } = loadDeals(join(dir, 'export.csv'));
    expect(deals).toHaveLength(2);
    const flagged = deals.filter((d) => isRemovedAuction(d, keys));
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.listPrice).toBe(29990);
  });
});
