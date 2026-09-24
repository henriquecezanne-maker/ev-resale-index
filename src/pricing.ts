import type { Deal } from './load.js';
import { monthKey } from './load.js';

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface MonthlyIndexPoint {
  month: string;
  n: number;
  medianBid: number;
  meanBid: number;
  indexRaw: number;
  indexWeighted: number | null;
  reliable: boolean;
}

/** kWh bands used for post-stratification weighting and mix charts (methodology §7). */
export const KWH_BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: '<20', min: -Infinity, max: 20 },
  { label: '20-40', min: 20, max: 40 },
  { label: '40-60', min: 40, max: 60 },
  { label: '60-80', min: 60, max: 80 },
  { label: '80-100', min: 80, max: 100 },
  { label: '100+', min: 100, max: Infinity },
];

const LAST_KWH_BAND = KWH_BANDS[KWH_BANDS.length - 1] as { label: string; min: number; max: number };

export function kwhBand(kwh: number): string {
  const band = KWH_BANDS.find((b) => kwh >= b.min && kwh < b.max);
  return band ? band.label : LAST_KWH_BAND.label;
}

/**
 * Reference basket = median band share across Apr-Sep (deliberately excludes the
 * distorted Feb/Mar months, methodology §5b). Weight = reference share / month share,
 * capped to [0.2, 5.0] so thin cells don't produce extreme weights.
 */
export function computeMixWeights(deals: Deal[]): Map<string, number> {
  const referenceMonths = new Set(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  const referenceDeals = deals.filter((d) => referenceMonths.has(monthKey(d.endDate)));

  const referenceShare = bandShare(referenceDeals);
  const monthlyShares = new Map<string, Map<string, number>>();
  for (const deal of deals) {
    const m = monthKey(deal.endDate);
    if (!monthlyShares.has(m)) {
      monthlyShares.set(
        m,
        bandShare(deals.filter((d) => monthKey(d.endDate) === m)),
      );
    }
  }

  const weights = new Map<string, number>();
  for (const deal of deals) {
    const m = monthKey(deal.endDate);
    const band = kwhBand(deal.batteryKwh);
    const monthShare = monthlyShares.get(m)?.get(band) ?? 0;
    const refShare = referenceShare.get(band) ?? 0;
    const rawWeight = monthShare > 0 ? refShare / monthShare : 1;
    const capped = Math.min(5.0, Math.max(0.2, rawWeight));
    weights.set(dealKey(deal), capped);
  }
  return weights;
}

function bandShare(deals: Deal[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const deal of deals) {
    const band = kwhBand(deal.batteryKwh);
    counts.set(band, (counts.get(band) ?? 0) + 1);
  }
  const total = deals.length || 1;
  const shares = new Map<string, number>();
  for (const [band, count] of counts) shares.set(band, count / total);
  return shares;
}

function dealKey(deal: Deal): string {
  return `${deal.endDate.toISOString()}|${deal.brand}|${deal.model}|${deal.highestBid.toString()}`;
}

function weightedMedian(values: Array<{ value: number; weight: number }>): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((s, v) => s + v.weight, 0);
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= totalWeight / 2) return item.value;
  }
  return (sorted[sorted.length - 1] as { value: number }).value;
}

/** Monthly median price index, rebased so January 2026 = 100 (methodology §4), plus kWh-weighted mix-adjusted line (§5b). */
export function buildMonthlyIndex(deals: Deal[]): MonthlyIndexPoint[] {
  const weights = computeMixWeights(deals);
  const byMonth = new Map<string, Deal[]>();
  for (const deal of deals) {
    const m = monthKey(deal.endDate);
    const bucket = byMonth.get(m);
    if (bucket) {
      bucket.push(deal);
    } else {
      byMonth.set(m, [deal]);
    }
  }

  const months = [...byMonth.keys()].sort();
  const baseMonth = '2026-01';
  const baseDeals = byMonth.get(baseMonth) ?? [];
  const baseMedian = median(baseDeals.map((d) => d.highestBid));
  const baseWeightedMedian = weightedMedian(
    baseDeals.map((d) => ({ value: d.highestBid, weight: weights.get(dealKey(d)) ?? 1 })),
  );

  return months.map((month) => {
    const monthDeals = byMonth.get(month) ?? [];
    const bids = monthDeals.map((d) => d.highestBid);
    const medianBid = median(bids);
    const meanBid = mean(bids);
    const weightedMed = weightedMedian(
      monthDeals.map((d) => ({ value: d.highestBid, weight: weights.get(dealKey(d)) ?? 1 })),
    );
    return {
      month,
      n: monthDeals.length,
      medianBid,
      meanBid,
      indexRaw: (medianBid / baseMedian) * 100,
      indexWeighted: Number.isFinite(baseWeightedMedian) ? (weightedMed / baseWeightedMedian) * 100 : null,
      // Methodology §4: periods with n < 5 are visually marked as unreliable.
      reliable: monthDeals.length >= 5,
    };
  });
}
