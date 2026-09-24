import { describe, expect, it } from 'vitest';
import { brandCountry, DATEK_BANDS, bandLabel } from './mix.js';

describe('brandCountry', () => {
  it('maps documented contested cases per methodology §10', () => {
    expect(brandCountry('MG')).toBe('CN');
    expect(brandCountry('Polestar')).toBe('SE');
    expect(brandCountry('Volvo')).toBe('SE');
    expect(brandCountry('MINI')).toBe('UK');
    expect(brandCountry('Opel')).toBe('DE');
    expect(brandCountry('Smart')).toBe('DE');
    expect(brandCountry('Dacia')).toBe('RO');
  });

  it('falls back to Other for unmapped brands', () => {
    expect(brandCountry('SomeUnknownBrand')).toBe('Other');
  });
});

describe('bandLabel', () => {
  it('assigns DAT-EK values to the correct band, methodology §7', () => {
    expect(bandLabel(DATEK_BANDS, 10000)).toBe('<15k');
    expect(bandLabel(DATEK_BANDS, 15000)).toBe('15-20k');
    expect(bandLabel(DATEK_BANDS, 65000)).toBe('60k+');
  });
});
