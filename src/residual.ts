import type { Deal } from './load.js';
import { isInResidualAgeWindow, isPlausibleResidual } from './load.js';
import { median } from './pricing.js';

export interface CurveFit {
  type: 'exponential' | 'linear';
  // exponential: RV = a * e^(-b*t); linear: RV = a - b*t
  a: number;
  b: number;
  r2: number;
}

function rSquared(actual: number[], predicted: number[]): number {
  const yMean = actual.reduce((s, v) => s + v, 0) / actual.length;
  const ssTot = actual.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = actual.reduce((s, v, i) => s + (v - (predicted[i] as number)) ** 2, 0);
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

/** Linear least-squares fit: RV = a - b*t (methodology §6). */
export function fitLinear(points: Array<{ t: number; rv: number }>): CurveFit {
  const n = points.length;
  const sumT = points.reduce((s, p) => s + p.t, 0);
  const sumRv = points.reduce((s, p) => s + p.rv, 0);
  const sumTT = points.reduce((s, p) => s + p.t * p.t, 0);
  const sumTRv = points.reduce((s, p) => s + p.t * p.rv, 0);
  const denom = n * sumTT - sumT * sumT;
  const slope = denom === 0 ? 0 : (n * sumTRv - sumT * sumRv) / denom;
  const intercept = (sumRv - slope * sumT) / n;
  const predicted = points.map((p) => intercept + slope * p.t);
  return { type: 'linear', a: intercept, b: -slope, r2: rSquared(points.map((p) => p.rv), predicted) };
}

/**
 * Exponential fit RV = 100 * e^(-b*t), anchored at 100% (new price) at t=0 by
 * definition rather than fitted — t=0 isn't a measured point (nothing sells brand
 * new at auction), so letting the intercept float lets noise in the youngest
 * vehicles drag the curve's start away from the one value we know is exactly right.
 * Single-parameter log-linear regression through the origin: ln(RV/100) = -b*t.
 * Requires rv > 0 for all points (guaranteed by the 5-120% clip in load.ts).
 */
export function fitExponential(points: Array<{ t: number; rv: number }>): CurveFit {
  const sumTT = points.reduce((s, p) => s + p.t * p.t, 0);
  const sumTLogRatio = points.reduce((s, p) => s + p.t * Math.log(p.rv / 100), 0);
  const b = sumTT === 0 ? 0 : -sumTLogRatio / sumTT;
  const predicted = points.map((p) => 100 * Math.exp(-b * p.t));
  return { type: 'exponential', a: 100, b, r2: rSquared(points.map((p) => p.rv), predicted) };
}

/** Residual-value dataset filtered per methodology §3/§6: plausible RV, 0-10y age window, fit on individual vehicles. */
export function residualPoints(deals: Deal[]): Array<{ t: number; rv: number }> {
  return deals
    .filter((d) => isPlausibleResidual(d) && isInResidualAgeWindow(d))
    .map((d) => ({ t: d.ageYears, rv: d.residualPct }));
}

export interface BrandResidual {
  brand: string;
  n: number;
  medianResidualAt3to4y: number | null;
  linearFit: CurveFit | null;
}

/** Brand ranking at 3-4 years, methodology §6: only brands with n >= 60 in that age band are robust enough to rank. */
export function brandResidualRanking(deals: Deal[], minN = 60): BrandResidual[] {
  const byBrand = new Map<string, Deal[]>();
  for (const deal of deals) {
    if (!isPlausibleResidual(deal) || !isInResidualAgeWindow(deal)) continue;
    const bucket = byBrand.get(deal.brand);
    if (bucket) {
      bucket.push(deal);
    } else {
      byBrand.set(deal.brand, [deal]);
    }
  }

  const results: BrandResidual[] = [];
  for (const [brand, brandDeals] of byBrand) {
    const in3to4 = brandDeals.filter((d) => d.ageYears >= 3 && d.ageYears < 4);
    const points = brandDeals.map((d) => ({ t: d.ageYears, rv: d.residualPct }));
    results.push({
      brand,
      n: brandDeals.length,
      medianResidualAt3to4y: in3to4.length >= minN ? median(in3to4.map((d) => d.residualPct)) : null,
      linearFit: brandDeals.length >= 15 ? fitLinear(points) : null,
    });
  }

  return results
    .filter((r) => r.medianResidualAt3to4y !== null)
    .sort((a, b) => (b.medianResidualAt3to4y as number) - (a.medianResidualAt3to4y as number));
}
