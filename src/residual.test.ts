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
  it('recovers an exact exponential relationship RV = a * e^(-b*t)', () => {
    const a = 80;
    const b = 0.15;
    const points = Array.from({ length: 10 }, (_, i) => ({ t: i, rv: a * Math.exp(-b * i) }));
    const fit = fitExponential(points);
    expect(fit.a).toBeCloseTo(a, 3);
    expect(fit.b).toBeCloseTo(b, 3);
    expect(fit.r2).toBeCloseTo(1, 5);
  });
});
