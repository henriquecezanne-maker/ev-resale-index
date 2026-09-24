import { median } from './pricing.js';

// Deterministic PRNG (mulberry32) — Math.random() would make bootstrap results
// non-reproducible between builds of the same data, which we don't want.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapResult {
  median: number;
  ciLow: number;
  ciHigh: number;
}

/** Bootstrap 95% confidence interval of the median (methodology §11.1). */
export function bootstrapMedianCI(values: number[], iterations = 2000, seed = 42): BootstrapResult {
  const rand = mulberry32(seed);
  const n = values.length;
  const medians: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const sample: number[] = [];
    for (let j = 0; j < n; j++) {
      sample.push(values[Math.floor(rand() * n)] as number);
    }
    medians.push(median(sample));
  }
  medians.sort((a, b) => a - b);
  const lowIdx = Math.floor(0.025 * iterations);
  const highIdx = Math.floor(0.975 * iterations);
  return {
    median: median(values),
    ciLow: medians[lowIdx] as number,
    ciHigh: medians[highIdx] as number,
  };
}

export interface MannWhitneyResult {
  u: number;
  p: number;
  effectSizeRankBiserial: number;
}

/**
 * Mann-Whitney U test with normal approximation (methodology §11.2 — nonparametric,
 * used instead of a t-test because auction prices are right-skewed) plus rank-biserial
 * effect size (§11.3, since large n makes almost everything "significant").
 */
export function mannWhitneyU(a: number[], b: number[]): MannWhitneyResult {
  const combined = [...a.map((v) => ({ v, group: 'a' as const })), ...b.map((v) => ({ v, group: 'b' as const }))];
  combined.sort((x, y) => x.v - y.v);

  const ranks = new Array<number>(combined.length).fill(0);
  let i = 0;
  while (i < combined.length) {
    const iValue = combined[i]?.v;
    let j = i;
    while (j < combined.length && combined[j]?.v === iValue) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[k] = avgRank;
    i = j;
  }

  let rankSumA = 0;
  combined.forEach((item, idx) => {
    if (item.group === 'a') rankSumA += ranks[idx] ?? 0;
  });

  const n1 = a.length;
  const n2 = b.length;
  const u1 = rankSumA - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const u = Math.min(u1, u2);

  const meanU = (n1 * n2) / 2;
  const stdU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = stdU === 0 ? 0 : (u - meanU) / stdU;
  const p = 2 * (1 - normalCdf(Math.abs(z)));

  // Rank-biserial correlation: 1 - 2U/(n1*n2), ranges [-1, 1].
  const effectSizeRankBiserial = 1 - (2 * u1) / (n1 * n2);

  return { u, p: Math.min(1, Math.max(0, p)), effectSizeRankBiserial };
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  // Abramowitz-Stegun approximation.
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

export function standardErrorOfMedian(values: number[]): number {
  // Approximation: SE(median) ~= 1.2533 * SE(mean), valid for roughly normal-shaped data.
  const n = values.length;
  if (n === 0) return NaN;
  const m = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1 || 1);
  return 1.2533 * Math.sqrt(variance / n);
}

export function coefficientOfVariation(values: number[]): number {
  const n = values.length;
  if (n === 0) return NaN;
  const m = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / n;
  return m === 0 ? NaN : Math.sqrt(variance) / m;
}

export function interquartileRange(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return q3 - q1;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = sorted[base] as number;
  const upper = sorted[base + 1];
  return upper === undefined ? lower : lower + rest * (upper - lower);
}

export type TrafficLight = 'green' | 'yellow' | 'red';

/** Traffic-light readiness system for sharing a comparison externally (methodology §11 "Ampel"). */
export function trafficLight(params: {
  n: number;
  ciSeparated: boolean;
  ciTouching: boolean;
  pValue: number;
  effectSize: number;
}): TrafficLight {
  const { n, ciSeparated, ciTouching, pValue, effectSize } = params;
  const nGreen = n > 100;
  const nRed = n < 30;
  const statsGreen = pValue < 0.05 && Math.abs(effectSize) >= 0.1 && ciSeparated;
  const statsRed = pValue >= 0.05 || (ciTouching && !ciSeparated);

  if (nRed || statsRed) return 'red';
  if (nGreen && statsGreen) return 'green';
  return 'yellow';
}
