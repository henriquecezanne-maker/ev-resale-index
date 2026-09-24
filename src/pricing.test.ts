import { describe, expect, it } from 'vitest';
import { kwhBand, mean, median } from './pricing.js';

describe('median', () => {
  it('returns the middle value for odd-length arrays', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for even-length arrays', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns NaN for an empty array', () => {
    expect(median([])).toBeNaN();
  });
});

describe('mean', () => {
  it('computes the arithmetic mean', () => {
    expect(mean([1, 2, 3])).toBe(2);
  });

  it('returns NaN for an empty array', () => {
    expect(mean([])).toBeNaN();
  });
});

describe('kwhBand', () => {
  it('assigns values to the correct band, methodology §7', () => {
    expect(kwhBand(10)).toBe('<20');
    expect(kwhBand(20)).toBe('20-40');
    expect(kwhBand(75)).toBe('60-80');
    expect(kwhBand(150)).toBe('100+');
  });
});
