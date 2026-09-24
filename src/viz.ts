import type { Deal } from './load.js';
import { monthKey } from './load.js';
import { buildMonthlyIndex, KWH_BANDS } from './pricing.js';
import { brandResidualRanking, fitExponential, fitLinear, residualPoints } from './residual.js';
import { countByBand, countByCountry, DATEK_BANDS, KM_BANDS } from './mix.js';
import { bootstrapMedianCI, mannWhitneyU, trafficLight } from './validate.js';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Explicit number->string conversion for template literals (avoids implicit-coercion lint errors). */
function num(n: number): string {
  return n.toString();
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' €';
}

function fmtPct(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', ',') + ' %';
}

interface DashboardData {
  generatedAt: string;
  totalRows: number;
  droppedRows: number;
  cleanedN: number;
  monthlyIndex: ReturnType<typeof buildMonthlyIndex>;
  rawChangeSinceJan: number;
  weightedChangeSinceJan: number;
  residualCurve: {
    exponential: ReturnType<typeof fitExponential>;
    linear: ReturnType<typeof fitLinear>;
    n: number;
    points: Array<{ t: number; rv: number }>;
  };
  brandRanking: ReturnType<typeof brandResidualRanking>;
  kwhMix: ReturnType<typeof countByBand>;
  datekMix: ReturnType<typeof countByBand>;
  kmMix: ReturnType<typeof countByBand>;
  countryMix: ReturnType<typeof countByCountry>;
  teslaValidation: {
    q1: { n: number; medianVal: number; ciLow: number; ciHigh: number };
    q3: { n: number; medianVal: number; ciLow: number; ciHigh: number };
    p: number;
    effectSize: number;
    light: string;
  } | null;
}

export function computeDashboardData(deals: Deal[], totalRows: number, droppedRows: number): DashboardData {
  const monthlyIndex = buildMonthlyIndex(deals);
  const last = monthlyIndex[monthlyIndex.length - 1];
  const rawChangeSinceJan = last ? last.indexRaw - 100 : 0;
  const weightedChangeSinceJan = last?.indexWeighted !== null && last?.indexWeighted !== undefined ? last.indexWeighted - 100 : 0;

  const rvPoints = residualPoints(deals);
  const residualCurve = {
    exponential: fitExponential(rvPoints),
    linear: fitLinear(rvPoints),
    n: rvPoints.length,
    points: rvPoints,
  };

  const brandRanking = brandResidualRanking(deals);

  const kwhMix = countByBand(deals, KWH_BANDS, (d) => d.batteryKwh);
  const datekDeals = deals.filter((d) => d.datekProxy !== null);
  const datekMix = countByBand(datekDeals, DATEK_BANDS, (d) => d.datekProxy as number);
  const kmMix = countByBand(deals, KM_BANDS, (d) => d.km);
  const countryMix = countByCountry(deals);

  // Validation example from methodology §11: Tesla Q1 vs Q3.
  const teslaDeals = deals.filter((d) => d.brand === 'Tesla');
  const q1 = teslaDeals.filter((d) => {
    const m = monthKey(d.endDate);
    return m === '2026-01' || m === '2026-02' || m === '2026-03';
  });
  const q3 = teslaDeals.filter((d) => {
    const m = monthKey(d.endDate);
    return m === '2026-07' || m === '2026-08' || m === '2026-09';
  });

  let teslaValidation: DashboardData['teslaValidation'] = null;
  if (q1.length >= 5 && q3.length >= 5) {
    const q1Bids = q1.map((d) => d.highestBid);
    const q3Bids = q3.map((d) => d.highestBid);
    const q1Ci = bootstrapMedianCI(q1Bids);
    const q3Ci = bootstrapMedianCI(q3Bids);
    const mw = mannWhitneyU(q1Bids, q3Bids);
    const ciSeparated = q1Ci.ciHigh < q3Ci.ciLow || q3Ci.ciHigh < q1Ci.ciLow;
    const ciTouching = !ciSeparated && Math.max(q1Ci.ciLow, q3Ci.ciLow) <= Math.min(q1Ci.ciHigh, q3Ci.ciHigh);
    const light = trafficLight({
      n: Math.min(q1.length, q3.length),
      ciSeparated,
      ciTouching,
      pValue: mw.p,
      effectSize: mw.effectSizeRankBiserial,
    });
    teslaValidation = {
      q1: { n: q1.length, medianVal: q1Ci.median, ciLow: q1Ci.ciLow, ciHigh: q1Ci.ciHigh },
      q3: { n: q3.length, medianVal: q3Ci.median, ciLow: q3Ci.ciLow, ciHigh: q3Ci.ciHigh },
      p: mw.p,
      effectSize: mw.effectSizeRankBiserial,
      light,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    totalRows,
    droppedRows,
    cleanedN: deals.length,
    monthlyIndex,
    rawChangeSinceJan,
    weightedChangeSinceJan,
    residualCurve,
    brandRanking,
    kwhMix,
    datekMix,
    kmMix,
    countryMix,
    teslaValidation,
  };
}

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; background: #0b0e14; color: #e6e8ec; }
  @media (prefers-color-scheme: light) { body { background: #f7f8fa; color: #16181d; } }
  header { padding: 2rem 1.5rem 1rem; max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 0 0 0.3rem; }
  .sub { opacity: 0.7; font-size: 0.9rem; }
  main { max-width: 1100px; margin: 0 auto; padding: 0 1.5rem 3rem; }
  section { margin-top: 2.2rem; }
  h2 { font-size: 1.1rem; border-bottom: 1px solid rgba(128,128,128,0.3); padding-bottom: 0.4rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin-top: 0.8rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid rgba(128,128,128,0.2); }
  th { opacity: 0.7; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-top: 1rem; }
  .card { background: rgba(128,128,128,0.08); border-radius: 10px; padding: 1rem; }
  .card .big { font-size: 1.7rem; font-weight: 700; }
  .card .label { font-size: 0.8rem; opacity: 0.7; }
  .light { display: inline-block; width: 0.7rem; height: 0.7rem; border-radius: 50%; margin-right: 0.4rem; }
  .light.green { background: #2fb85c; }
  .light.yellow { background: #d9a72b; }
  .light.red { background: #d9432b; }
  .muted { opacity: 0.6; font-size: 0.85rem; }
  .unreliable { opacity: 0.5; }
  svg { width: 100%; height: auto; background: rgba(128,128,128,0.05); border-radius: 8px; }
  .nav a { color: inherit; opacity: 0.6; text-decoration: none; margin-right: 1rem; font-size: 0.85rem; }
  .nav a:hover { opacity: 1; }
  footer { max-width: 1100px; margin: 0 auto; padding: 1.5rem; opacity: 0.5; font-size: 0.8rem; }
`;

function lineChartSvg(points: Array<{ x: number; y: number; label: string; reliable: boolean }>, width = 1000, height = 320): string {
  if (points.length === 0) return '<svg viewBox="0 0 1000 320"></svg>';
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const yValues = points.map((p) => p.y);
  const yMin = Math.min(...yValues, 100) - 5;
  const yMax = Math.max(...yValues, 100) + 5;
  const xStep = (width - padding.left - padding.right) / Math.max(1, points.length - 1);

  const toX = (i: number) => padding.left + i * xStep;
  const toY = (y: number) =>
    padding.top + (height - padding.top - padding.bottom) * (1 - (y - yMin) / (yMax - yMin));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.y).toFixed(1)}`).join(' ');
  const basePath = `M ${num(padding.left)} ${toY(100).toFixed(1)} L ${(width - padding.right).toFixed(1)} ${toY(100).toFixed(1)}`;

  const dots = points
    .map(
      (p, i) =>
        `<circle cx="${toX(i).toFixed(1)}" cy="${toY(p.y).toFixed(1)}" r="4" fill="${p.reliable ? '#4f8ff7' : '#888'}" opacity="${p.reliable ? '1' : '0.5'}"><title>${escapeHtml(p.label)}: ${p.y.toFixed(1)}</title></circle>`,
    )
    .join('');
  const labels = points
    .map((p, i) => `<text x="${toX(i).toFixed(1)}" y="${num(height - 12)}" font-size="11" text-anchor="middle" opacity="0.6">${escapeHtml(p.label)}</text>`)
    .join('');

  return `<svg viewBox="0 0 ${num(width)} ${num(height)}" xmlns="http://www.w3.org/2000/svg">
    <path d="${basePath}" stroke="rgba(128,128,128,0.4)" stroke-dasharray="4 3" fill="none" stroke-width="1"/>
    <path d="${linePath}" stroke="#4f8ff7" fill="none" stroke-width="2.5"/>
    ${dots}
    ${labels}
  </svg>`;
}

function barChartSvg(bars: Array<{ label: string; value: number }>, width = 1000, height = 260): string {
  const padding = { top: 20, right: 20, bottom: 40, left: 20 };
  const maxVal = Math.max(...bars.map((b) => b.value), 0.01);
  const barWidth = (width - padding.left - padding.right) / bars.length;
  const bodyHeight = height - padding.top - padding.bottom;

  const rects = bars
    .map((b, i) => {
      const h = (b.value / maxVal) * bodyHeight;
      const x = padding.left + i * barWidth + barWidth * 0.1;
      const y = padding.top + (bodyHeight - h);
      const w = barWidth * 0.8;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#4f8ff7" rx="3"><title>${escapeHtml(b.label)}: ${(b.value * 100).toFixed(1)}%</title></rect>
        <text x="${(x + w / 2).toFixed(1)}" y="${num(height - 12)}" font-size="11" text-anchor="middle" opacity="0.6">${escapeHtml(b.label)}</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${num(width)} ${num(height)}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

function residualCurveSvg(
  points: Array<{ t: number; rv: number }>,
  fit: ReturnType<typeof fitExponential>,
  width = 1000,
  height = 320,
): string {
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const tMax = 10;
  const toX = (t: number) => padding.left + (t / tMax) * (width - padding.left - padding.right);
  const toY = (rv: number) => padding.top + (1 - rv / 100) * (height - padding.top - padding.bottom);

  const curvePoints: string[] = [];
  for (let t = 0; t <= tMax; t += 0.2) {
    const rv = fit.a * Math.exp(-fit.b * t);
    curvePoints.push(`${toX(t).toFixed(1)},${toY(rv).toFixed(1)}`);
  }

  // Thin the scatter for display — the curve fit above already used every point;
  // rendering all of them just bloats the page weight without changing what's visible.
  const maxDots = 600;
  const stride = Math.max(1, Math.ceil(points.length / maxDots));
  const dots = points
    .filter((_, i) => i % stride === 0)
    .map((p) => `<circle cx="${toX(p.t).toFixed(1)}" cy="${toY(p.rv).toFixed(1)}" r="2" fill="#4f8ff7" opacity="0.35"/>`)
    .join('');

  return `<svg viewBox="0 0 ${num(width)} ${num(height)}" xmlns="http://www.w3.org/2000/svg">
    ${dots}
    <polyline points="${curvePoints.join(' ')}" fill="none" stroke="#e0a52f" stroke-width="3"/>
  </svg>`;
}

export function renderInternalDashboard(data: DashboardData): string {
  const chartPoints = data.monthlyIndex.map((m) => ({ x: 0, y: m.indexRaw, label: m.month, reliable: m.reliable }));
  const weightedChartPoints = data.monthlyIndex
    .filter((m) => m.indexWeighted !== null)
    .map((m) => ({ x: 0, y: m.indexWeighted as number, label: m.month, reliable: m.reliable }));

  const brandRows = data.brandRanking
    .slice(0, 30)
    .map(
      (b) => `<tr><td>${escapeHtml(b.brand)}</td><td>${num(b.n)}</td><td>${b.medianResidualAt3to4y !== null ? fmtPct(b.medianResidualAt3to4y) : '–'}</td><td>${b.linearFit ? fmtPct(b.linearFit.b) + '/Jahr' : '–'}</td><td>${b.linearFit ? b.linearFit.r2.toFixed(2) : '–'}</td></tr>`,
    )
    .join('');

  const monthRows = data.monthlyIndex
    .map(
      (m) =>
        `<tr class="${m.reliable ? '' : 'unreliable'}"><td>${m.month}</td><td>${num(m.n)}</td><td>${fmtEur(m.medianBid)}</td><td>${m.indexRaw.toFixed(1)}</td><td>${m.indexWeighted !== null ? m.indexWeighted.toFixed(1) : '–'}</td></tr>`,
    )
    .join('');

  const countryRows = data.countryMix
    .map((c) => `<tr><td>${escapeHtml(c.label)}</td><td>${num(c.n)}</td><td>${fmtPct(c.share * 100)}</td></tr>`)
    .join('');

  const teslaSection = data.teslaValidation
    ? `<section>
        <h2>Validierungsbeispiel: Tesla Q1 vs. Q3</h2>
        <div class="grid">
          <div class="card"><div class="label">Q1 (Jan–Mär), n=${num(data.teslaValidation.q1.n)}</div><div class="big">${fmtEur(data.teslaValidation.q1.medianVal)}</div><div class="muted">KI ${fmtEur(data.teslaValidation.q1.ciLow)} – ${fmtEur(data.teslaValidation.q1.ciHigh)}</div></div>
          <div class="card"><div class="label">Q3 (Jul–Sep), n=${num(data.teslaValidation.q3.n)}</div><div class="big">${fmtEur(data.teslaValidation.q3.medianVal)}</div><div class="muted">KI ${fmtEur(data.teslaValidation.q3.ciLow)} – ${fmtEur(data.teslaValidation.q3.ciHigh)}</div></div>
          <div class="card"><div class="label">Mann-Whitney p-Wert</div><div class="big">${data.teslaValidation.p < 0.001 ? '<0,001' : data.teslaValidation.p.toFixed(3)}</div><div class="muted">Effektstärke ${data.teslaValidation.effectSize.toFixed(2)}</div></div>
          <div class="card"><div class="label">Ampel</div><div class="big"><span class="light ${data.teslaValidation.light}"></span>${data.teslaValidation.light}</div></div>
        </div>
      </section>`
    : '';

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>EV Resale Index — Intern</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<header>
  <div class="nav"><a href="index.html">Intern</a><a href="press.html">Presse</a></div>
  <h1>EV Resale Index — Internes Dashboard</h1>
  <div class="sub">${num(data.cleanedN)} bereinigte Auktionen (von ${num(data.totalRows)} exportierten, ${num(data.droppedRows)} verworfen) · generiert ${new Date(data.generatedAt).toLocaleString('de-DE')}</div>
</header>
<main>

<section>
  <h2>Preisindex (Median, Januar 2026 = 100)</h2>
  <div class="grid">
    <div class="card"><div class="label">Roh, seit Januar</div><div class="big">${data.rawChangeSinceJan >= 0 ? '+' : ''}${fmtPct(data.rawChangeSinceJan)}</div></div>
    <div class="card"><div class="label">Mix-bereinigt (kWh-gewichtet), seit Januar</div><div class="big">${data.weightedChangeSinceJan >= 0 ? '+' : ''}${fmtPct(data.weightedChangeSinceJan)}</div></div>
  </div>
  ${lineChartSvg(chartPoints)}
  <p class="muted">Gestrichelte Linie = Basislinie 100. Graue/blasse Punkte = Monate mit n &lt; 5 (unsicher).</p>
  <h3 style="font-size:0.95rem; margin-top:1.5rem;">Mix-bereinigt (kWh-gewichtet)</h3>
  ${lineChartSvg(weightedChartPoints)}
  <table>
    <thead><tr><th>Monat</th><th>n</th><th>Median-Gebot</th><th>Index roh</th><th>Index gewichtet</th></tr></thead>
    <tbody>${monthRows}</tbody>
  </table>
</section>

<section>
  <h2>Restwertkurve (Markt)</h2>
  <p class="muted">Exponential-Fit: RV = ${data.residualCurve.exponential.a.toFixed(1)} · e^(−${data.residualCurve.exponential.b.toFixed(3)}·t), R² = ${data.residualCurve.exponential.r2.toFixed(2)} · n = ${num(data.residualCurve.n)}</p>
  <p class="muted">Linear: RV = ${data.residualCurve.linear.a.toFixed(1)} − ${data.residualCurve.linear.b.toFixed(2)}·t, R² = ${data.residualCurve.linear.r2.toFixed(2)}</p>
</section>

<section>
  <h2>Restwert je Marke (bei 3–4 Jahren, n ≥ 60)</h2>
  <table>
    <thead><tr><th>Marke</th><th>n</th><th>Median-Restwert 3–4J</th><th>Slope (Verlust/Jahr)</th><th>R²</th></tr></thead>
    <tbody>${brandRows}</tbody>
  </table>
</section>

<section>
  <h2>Mix: Batterie (kWh)</h2>
  ${barChartSvg(data.kwhMix.map((b) => ({ label: b.label, value: b.share })))}
</section>

<section>
  <h2>Mix: DAT-EK-Proxy (€)</h2>
  ${barChartSvg(data.datekMix.map((b) => ({ label: b.label, value: b.share })))}
  <p class="muted">DAT-EK ist ein Näherungswert (Mitte der Valuation Range); Coverage variiert über Monate.</p>
</section>

<section>
  <h2>Mix: Laufleistung (km)</h2>
  ${barChartSvg(data.kmMix.map((b) => ({ label: b.label, value: b.share })))}
</section>

<section>
  <h2>Herkunftsland</h2>
  <table>
    <thead><tr><th>Land</th><th>n</th><th>Anteil</th></tr></thead>
    <tbody>${countryRows}</tbody>
  </table>
</section>

${teslaSection}

<section>
  <h2>Vorbehalte</h2>
  <ul class="muted">
    <li>Selektions-Bias — nur Autos, die in die Auktion kamen; nicht der Gesamtmarkt.</li>
    <li>Wholesale-Charakter — Auktionspreise, konservativ vs. Endkundenpreis.</li>
    <li>Mix-Effekt — Gesamtindex nur bereinigt (mix-adjustiert) teilen.</li>
    <li>Sonderausstattung nur ~51 % befüllt; leeres Feld wird hier als 0 € behandelt (offene Klärung mit Marco/Lukas).</li>
    <li>DAT-EK nur Proxy (Range-Mitte), Coverage variiert.</li>
    <li>September ist ein Teilmonat (bis 18.).</li>
    <li>km ist ein schwacher Prädiktor für Restwert (R² ~0,06); Alter und km sind korreliert.</li>
  </ul>
</section>

</main>
<footer>EV Resale Index · Aampere · intern, nicht für externe Weitergabe ohne Presse-Ansicht</footer>
</body>
</html>`;
}

export function renderPressDashboard(data: DashboardData): string {
  const eligibleBrands = data.brandRanking.filter((b) => b.n >= 60);
  const top10 = eligibleBrands.slice(0, 10);

  const brandRows = top10
    .map(
      (b, i) =>
        `<tr><td>${num(i + 1)}</td><td>${escapeHtml(b.brand)}</td><td>${b.medianResidualAt3to4y !== null ? fmtPct(b.medianResidualAt3to4y) : '–'}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>EV Resale Index</title>
<style>${PAGE_STYLE}
  body { text-align: center; }
  .headline { font-size: 2.4rem; font-weight: 800; margin: 1rem 0 0.3rem; }
  .n-anchor { font-size: 1rem; opacity: 0.75; margin-bottom: 2rem; }
  table { max-width: 500px; margin: 1rem auto; }
  th, td { text-align: center; }
</style>
</head>
<body>
<header>
  <div class="nav"><a href="index.html">Intern</a><a href="press.html">Presse</a></div>
  <h1>EV Resale Index</h1>
</header>
<main>
  <div class="n-anchor">${data.cleanedN.toLocaleString('de-DE')} echte Auktionen ausgewertet</div>
  <div class="headline">${data.weightedChangeSinceJan >= 0 ? '+' : ''}${fmtPct(data.weightedChangeSinceJan)}</div>
  <p class="muted">Mix-bereinigter EV-Auktionspreis-Index seit Januar 2026 (Median, kWh-gewichtet)</p>

  ${lineChartSvg(
    data.monthlyIndex.filter((m) => m.indexWeighted !== null).map((m) => ({ x: 0, y: m.indexWeighted as number, label: m.month, reliable: m.reliable })),
    900,
    280,
  )}

  <section>
    <h2>So verlieren EVs an Wert</h2>
    ${residualCurveSvg(data.residualCurve.points, data.residualCurve.exponential, 900, 300)}
    <p class="muted">Restwertkurve über alle Marken, 0–10 Jahre Fahrzeugalter.</p>
  </section>

  <section>
    <h2>Restwert-Ranking nach Marke (bei 3–4 Jahren)</h2>
    <table>
      <thead><tr><th>#</th><th>Marke</th><th>Median-Restwert</th></tr></thead>
      <tbody>${brandRows}</tbody>
    </table>
    <p class="muted">Nur Marken mit mindestens 60 ausgewerteten Auktionen in diesem Altersband.</p>
  </section>

  <p class="muted" style="margin-top: 3rem;">Methodik: Median des höchsten Gebots je Auktion (steuerbereinigt), mix-bereinigt nach Batteriekapazität. Restwert = höchstes Gebot / Neupreis (inkl. Sonderausstattung).</p>
</main>
<footer>EV Resale Index · Aampere</footer>
</body>
</html>`;
}
