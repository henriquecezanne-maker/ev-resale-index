import { describe, expect, it } from 'vitest';
import { fitExponential, fitLinear } from './residual.js';

describe('fitLinear', () => {
  it('recovers an exact linear relationship RV = a - b*t', () => {
    const points = [
      { t: 0, rv: 100 },
      { t: 1, rv: 90 },
      { t: 2, rv: 80 },
      { t: 3, rv: 70 },
    ];
    const fit = fitLinear(points);
    expect(fit.a).toBeCloseTo(100, 5);
    expect(fit.b).toBeCloseTo(10, 5);
    expect(fit.r2).toBeCloseTo(1, 5);
  });
});

describe('fitExponential', () => {
  it('anchors a at exactly 100 (new-price intercept), regardless of the input data', () => {
    const b = 0.15;
    const points = Array.from({ length: 10 }, (_, i) => ({ t: i, rv: 100 * Math.exp(-b * i) }));
    const fit = fitExponential(points);
    expect(fit.a).toBe(100);
    expect(fit.b).toBeCloseTo(b, 3);
    expect(fit.r2).toBeCloseTo(1, 5);
  });

  it('recovers b even when the data does not pass through 100 at t=0 (a stays fixed at 100)', () => {
    // Real data never actually has a point at t=0 (nothing sells brand-new at
    // auction) — this simulates that by fitting a curve that starts below 100.
    const a = 80;
    const b = 0.15;
    const points = Array.from({ length: 10 }, (_, i) => ({ t: i + 1, rv: a * Math.exp(-b * (i + 1)) }));
    const fit = fitExponential(points);
    expect(fit.a).toBe(100);
    expect(fit.b).toBeGreaterThan(0);
  });
});
