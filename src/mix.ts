import type { Deal } from './load.js';

export const DATEK_BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: '<15k', min: -Infinity, max: 15000 },
  { label: '15-20k', min: 15000, max: 20000 },
  { label: '20-30k', min: 20000, max: 30000 },
  { label: '30-40k', min: 30000, max: 40000 },
  { label: '40-50k', min: 40000, max: 50000 },
  { label: '50-60k', min: 50000, max: 60000 },
  { label: '60k+', min: 60000, max: Infinity },
];

export const KM_BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: '0-10k', min: 0, max: 10000 },
  { label: '10-20k', min: 10000, max: 20000 },
  { label: '20-30k', min: 20000, max: 30000 },
  { label: '30-40k', min: 30000, max: 40000 },
  { label: '40-50k', min: 40000, max: 50000 },
  { label: '50-60k', min: 50000, max: 60000 },
  { label: '60-70k', min: 60000, max: 70000 },
  { label: '70k+', min: 70000, max: Infinity },
];

export function bandLabel(bands: Array<{ label: string; min: number; max: number }>, value: number): string {
  const band = bands.find((b) => value >= b.min && value < b.max);
  if (band) return band.label;
  const last = bands[bands.length - 1];
  return last ? last.label : '';
}

/** Brand-of-origin country mapping (methodology §10). Contested cases documented in the source spec. */
const BRAND_COUNTRY: Record<string, string> = {
  Volkswagen: 'DE',
  BMW: 'DE',
  'Mercedes-Benz': 'DE',
  Audi: 'DE',
  Opel: 'DE',
  Smart: 'DE',
  Porsche: 'DE',
  Hyundai: 'KR',
  Kia: 'KR',
  Genesis: 'KR',
  Ssangyong: 'KR',
  Renault: 'FR',
  Peugeot: 'FR',
  Citroën: 'FR',
  'DS Automobiles': 'FR',
  Fiat: 'IT',
  Abarth: 'IT',
  'Alfa Romeo': 'IT',
  Maserati: 'IT',
  MG: 'CN',
  Aiways: 'CN',
  BYD: 'CN',
  Xpeng: 'CN',
  Nio: 'CN',
  DFSK: 'CN',
  Maxus: 'CN',
  GWM: 'CN',
  Leapmotor: 'CN',
  Volvo: 'SE',
  Polestar: 'SE',
  Tesla: 'USA',
  Ford: 'USA',
  Jeep: 'USA',
  Cadillac: 'USA',
  Nissan: 'JP',
  Mazda: 'JP',
  Toyota: 'JP',
  Honda: 'JP',
  Subaru: 'JP',
  Lexus: 'JP',
  MINI: 'UK',
  Jaguar: 'UK',
  Lotus: 'UK',
  Cupra: 'ES',
  Seat: 'ES',
  Skoda: 'CZ',
  Dacia: 'RO',
};

export function brandCountry(brand: string): string {
  return BRAND_COUNTRY[brand] ?? 'Other';
}

export interface BandCount {
  label: string;
  n: number;
  share: number;
}

export function countByBand(
  deals: Deal[],
  bands: Array<{ label: string; min: number; max: number }>,
  getValue: (d: Deal) => number,
): BandCount[] {
  const counts = new Map<string, number>(bands.map((b) => [b.label, 0]));
  for (const deal of deals) {
    const label = bandLabel(bands, getValue(deal));
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const total = deals.length || 1;
  return bands.map((b) => ({ label: b.label, n: counts.get(b.label) ?? 0, share: (counts.get(b.label) ?? 0) / total }));
}

export function countByCountry(deals: Deal[]): BandCount[] {
  const counts = new Map<string, number>();
  for (const deal of deals) {
    const c = brandCountry(deal.brand);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const total = deals.length || 1;
  return [...counts.entries()]
    .map(([label, n]) => ({ label, n, share: n / total }))
    .sort((a, b) => b.n - a.n);
}
