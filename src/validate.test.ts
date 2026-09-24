import { describe, expect, it } from 'vitest';
import { bootstrapMedianCI, coefficientOfVariation, interquartileRange, mannWhitneyU, trafficLight } from './validate.js';

describe('bootstrapMedianCI', () => {
  it('centers the CI on the true median and keeps it within the data range', () => {
    const values = Array.from({ length: 200 }, (_, i) => i + 1);
    const result = bootstrapMedianCI(values, 500);
    expect(result.median).toBe(100.5);
    expect(result.ciLow).toBeLessThanOrEqual(result.median);
    expect(result.ciHigh).toBeGreaterThanOrEqual(result.median);
    expect(result.ciLow).toBeGreaterThan(0);
    expect(result.ciHigh).toBeLessThan(201);
  });

  it('is deterministic for a fixed seed', () => {
    const values = [10, 12, 14, 16, 18, 20];
    const a = bootstrapMedianCI(values, 300, 7);
    const b = bootstrapMedianCI(values, 300, 7);
    expect(a).toEqual(b);
  });
});

describe('mannWhitneyU', () => {
  it('finds no significant difference for identical distributions', () => {
    const a = [10, 20, 30, 40, 50];
    const b = [10, 20, 30, 40, 50];
    const result = mannWhitneyU(a, b);
    expect(result.p).toBeGreaterThan(0.5);
  });

  it('finds a significant difference for clearly separated distributions', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const b = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
    const result = mannWhitneyU(a, b);
    expect(result.p).toBeLessThan(0.001);
    expect(Math.abs(result.effectSizeRankBiserial)).toBeCloseTo(1, 5);
  });
});

describe('coefficientOfVariation', () => {
  it('is zero for constant values', () => {
    expect(coefficientOfVariation([5, 5, 5])).toBe(0);
  });
});

describe('interquartileRange', () => {
  it('computes Q3 - Q1', () => {
    expect(interquartileRange([1, 2, 3, 4, 5, 6, 7, 8])).toBeCloseTo(3.5, 5);
  });
});

describe('trafficLight', () => {
  it('is green for large, separated, significant, relevant comparisons', () => {
    expect(
      trafficLight({ n: 150, ciSeparated: true, ciTouching: false, pValue: 0.001, effectSize: 0.3 }),
    ).toBe('green');
  });

  it('is red for small samples regardless of significance', () => {
    expect(
      trafficLight({ n: 10, ciSeparated: true, ciTouching: false, pValue: 0.001, effectSize: 0.3 }),
    ).toBe('red');
  });

  it('is red for non-significant results', () => {
    expect(
      trafficLight({ n: 150, ciSeparated: false, ciTouching: true, pValue: 0.3, effectSize: 0.05 }),
    ).toBe('red');
  });

  it('is yellow for the middle ground', () => {
    expect(
      trafficLight({ n: 50, ciSeparated: true, ciTouching: false, pValue: 0.02, effectSize: 0.2 }),
    ).toBe('yellow');
  });
});
