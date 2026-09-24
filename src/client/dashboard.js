// Client-side dashboard engine for the EV Resale Index internal view.
// Runs entirely in the browser against the embedded DEAL_DATA (or a
// user-loaded CSV) — no backend, no build step, matches the static-site
// architecture decision in docs/architecture.md.
(function () {
  'use strict';

  var COUNTRY_COLORS = {
    USA: '#0b4f4a',
    Germany: '#14877e',
    'South Korea': '#e09a3e',
    France: '#5fb3ac',
    China: '#8a5fc9',
    Japan: '#c9515f',
    Sweden: '#3f7f3a',
    Spain: '#b98d2a',
    'Czech Rep.': '#2a5fb9',
    Other: '#9aa3ab',
  };

  var BRAND_COUNTRY = {
    Volkswagen: 'Germany', BMW: 'Germany', 'Mercedes-Benz': 'Germany', Audi: 'Germany',
    Opel: 'Germany', Smart: 'Germany', Porsche: 'Germany',
    Hyundai: 'South Korea', Kia: 'South Korea', Genesis: 'South Korea', Ssangyong: 'South Korea',
    Renault: 'France', Peugeot: 'France', 'Citroën': 'France', 'DS Automobiles': 'France',
    Fiat: 'Italy', Abarth: 'Italy', 'Alfa Romeo': 'Italy', Maserati: 'Italy',
    MG: 'China', Aiways: 'China', BYD: 'China', Xpeng: 'China', Nio: 'China',
    DFSK: 'China', Maxus: 'China', GWM: 'China', Leapmotor: 'China',
    Volvo: 'Sweden', Polestar: 'Sweden',
    Tesla: 'USA', Ford: 'USA', Jeep: 'USA', Cadillac: 'USA',
    Nissan: 'Japan', Mazda: 'Japan', Toyota: 'Japan', Honda: 'Japan', Subaru: 'Japan', Lexus: 'Japan',
    MINI: 'UK', Jaguar: 'UK', Lotus: 'UK',
    Cupra: 'Spain', Seat: 'Spain',
    Skoda: 'Czech Rep.', Dacia: 'Romania',
  };

  function brandCountry(brand) {
    return BRAND_COUNTRY[brand] || 'Other';
  }

  function median(values) {
    if (values.length === 0) return NaN;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  function mean(values) {
    if (values.length === 0) return NaN;
    var sum = 0;
    for (var i = 0; i < values.length; i++) sum += values[i];
    return sum / values.length;
  }

  function fmtEur(n) {
    if (!isFinite(n)) return '–';
    return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' €';
  }

  function fmtPct(n, digits) {
    if (!isFinite(n)) return '–';
    return (digits === undefined ? n.toFixed(1) : n.toFixed(digits)).replace('.', ',') + ' %';
  }

  function fmtNum(n) {
    if (!isFinite(n)) return '–';
    return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.round(n));
  }

  function monthLabel(mo) {
    var parts = mo.split('-');
    var names = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    var isPartial = mo === window.EV_DASHBOARD.latestMonth && window.EV_DASHBOARD.latestMonthPartial;
    return names[parseInt(parts[1], 10) - 1] + " '" + parts[0].slice(2) + (isPartial ? '*' : '');
  }

  function quarterKey(mo) {
    var parts = mo.split('-');
    var q = Math.floor((parseInt(parts[1], 10) - 1) / 3) + 1;
    return parts[0] + '-Q' + q;
  }

  function quarterLabel(qk) {
    var parts = qk.split('-Q');
    return 'Q' + parts[1] + " '" + parts[0].slice(2);
  }

  // ---- Filter state ----------------------------------------------------

  var ALL_DATA = window.EV_DASHBOARD.deals;
  var BASE_MONTH = window.EV_DASHBOARD.baseMonth;

  var kmMax = 0, ageMax = 0, batteryMax = 0, powerMax = 0, listMax = 0, bidMax = 0, bidMin = Infinity, batteryMin = Infinity;
  ALL_DATA.forEach(function (d) {
    if (d.km > kmMax) kmMax = d.km;
    if (d.ag > ageMax) ageMax = d.ag;
    if (d.bk > batteryMax) batteryMax = d.bk;
    if (d.bk < batteryMin) batteryMin = d.bk;
    if (d.pk > powerMax) powerMax = d.pk;
    if (d.lp > listMax) listMax = d.lp;
    if (d.hb > bidMax) bidMax = d.hb;
    if (d.hb < bidMin) bidMin = d.hb;
  });

  var state = {
    accident: 'all', // all | free | with
    mileageBands: null, // null = all
    ageRange: [0, Math.ceil(ageMax * 12) / 12],
    batteryRange: [Math.floor(batteryMin), Math.ceil(batteryMax)],
    powerRange: [0, Math.ceil(powerMax)],
    listRange: [0, Math.ceil(listMax)],
    bidRange: [Math.floor(bidMin), Math.ceil(bidMax)],
    minBids: 0,
    priceBasis: 'corrected', // corrected | raw
    periodGranularity: 'month', // month | quarter
    indexMeasure: 'median', // median | average | both
    groupBy: 'country', // country | brand
  };

  var MILEAGE_BANDS = [
    { label: '0-10k', min: 0, max: 10000 },
    { label: '10-20k', min: 10000, max: 20000 },
    { label: '20-30k', min: 20000, max: 30000 },
    { label: '30-40k', min: 30000, max: 40000 },
    { label: '40-50k', min: 40000, max: 50000 },
    { label: '50-60k', min: 50000, max: 60000 },
    { label: '60-70k', min: 60000, max: 70000 },
    { label: '70k+', min: 70000, max: Infinity },
  ];

  var BATTERY_BANDS = [
    { label: '<20 kWh', min: -Infinity, max: 20 },
    { label: '20-40 kWh', min: 20, max: 40 },
    { label: '40-60 kWh', min: 40, max: 60 },
    { label: '60-80 kWh', min: 60, max: 80 },
    { label: '80-100 kWh', min: 80, max: 100 },
    { label: '100+ kWh', min: 100, max: Infinity },
  ];

  var DATEK_BANDS = [
    { label: '<15k', min: -Infinity, max: 15000 },
    { label: '15-20k', min: 15000, max: 20000 },
    { label: '20-30k', min: 20000, max: 30000 },
    { label: '30-40k', min: 30000, max: 40000 },
    { label: '40-50k', min: 40000, max: 50000 },
    { label: '50-60k', min: 50000, max: 60000 },
    { label: '60k+', min: 60000, max: Infinity },
  ];

  function bandOf(bands, value) {
    for (var i = 0; i < bands.length; i++) {
      if (value >= bands[i].min && value < bands[i].max) return bands[i].label;
    }
    return bands[bands.length - 1].label;
  }

  function applyFilters() {
    return ALL_DATA.filter(function (d) {
      if (state.accident === 'free' && !d.af) return false;
      if (state.accident === 'with' && d.af) return false;
      if (state.mileageBands) {
        var band = bandOf(MILEAGE_BANDS, d.km);
        if (state.mileageBands.indexOf(band) === -1) return false;
      }
      if (d.ag < state.ageRange[0] || d.ag > state.ageRange[1]) return false;
      if (d.bk < state.batteryRange[0] || d.bk > state.batteryRange[1]) return false;
      if (d.pk < state.powerRange[0] || d.pk > state.powerRange[1]) return false;
      if (d.lp < state.listRange[0] || d.lp > state.listRange[1]) return false;
      var bidValue = state.priceBasis === 'raw' ? d.hr : d.hb;
      if (bidValue < state.bidRange[0] || bidValue > state.bidRange[1]) return false;
      if (d.bi < state.minBids) return false;
      return true;
    });
  }

  function bidOf(d) {
    return state.priceBasis === 'raw' ? d.hr : d.hb;
  }

  // ---- Presets -----------------------------------------------------------

  function applyPreset(name) {
    if (name === 'robust') {
      state.minBids = 2;
      state.accident = 'free';
      state.listRange = [0, Math.min(listMax, 60000)];
    } else if (name === 'reset') {
      state.accident = 'all';
      state.mileageBands = null;
      state.ageRange = [0, Math.ceil(ageMax * 12) / 12];
      state.batteryRange = [Math.floor(batteryMin), Math.ceil(batteryMax)];
      state.powerRange = [0, Math.ceil(powerMax)];
      state.listRange = [0, Math.ceil(listMax)];
      state.bidRange = [Math.floor(bidMin), Math.ceil(bidMax)];
      state.minBids = 0;
    }
    syncControlsFromState();
    render();
  }

  // ---- Grouping helpers ---------------------------------------------------

  function groupByPeriod(deals, granularity) {
    var keyFn = granularity === 'quarter' ? function (d) { return quarterKey(d.mo); } : function (d) { return d.mo; };
    var map = {};
    deals.forEach(function (d) {
      var k = keyFn(d);
      if (!map[k]) map[k] = [];
      map[k].push(d);
    });
    return map;
  }

  function sortedKeys(map) {
    return Object.keys(map).sort();
  }

  // ---- SVG chart primitives ------------------------------------------------

  function svgEl(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, attrs[k]);
    return el;
  }

  function clearChart(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  function lineBarChart(container, opts) {
    // opts: { labels, series: [{label, values, color}], bars: values|null, width, height, yFormat, basisLine }
    clearChart(container);
    var width = opts.width || container.clientWidth || 900;
    var height = opts.height || 300;
    var padding = { top: 24, right: 20, bottom: 30, left: 56 };
    var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + height, width: '100%', height: height });

    var n = opts.labels.length;
    if (n === 0) {
      container.appendChild(svg);
      return;
    }
    var xStep = n > 1 ? (width - padding.left - padding.right) / (n - 1) : 0;
    var toX = function (i) { return padding.left + i * xStep; };
    // Thin labels/value-tags when there isn't enough horizontal room per point —
    // otherwise adjacent points overlap into unreadable text on narrow/compact charts.
    var minPxPerLabel = 46;
    var labelStride = Math.max(1, Math.ceil(minPxPerLabel / (xStep || minPxPerLabel)));
    var showAt = function (i) { return i % labelStride === 0 || i === n - 1; };

    var allValues = [];
    opts.series.forEach(function (s) {
      s.values.forEach(function (v) { if (isFinite(v)) allValues.push(v); });
    });
    if (opts.basisLine !== undefined) allValues.push(opts.basisLine);
    var yMin = Math.min.apply(null, allValues.concat([0]));
    var yMax = Math.max.apply(null, allValues.concat([1]));
    if (opts.basisLine === undefined) yMin = Math.min.apply(null, allValues);
    var yPad = (yMax - yMin) * 0.12 || 1;
    yMin -= yPad;
    yMax += yPad;
    var toY = function (v) {
      return padding.top + (height - padding.top - padding.bottom) * (1 - (v - yMin) / (yMax - yMin));
    };

    // bar layer (sample size) behind lines
    if (opts.bars) {
      var barMax = Math.max.apply(null, opts.bars.concat([1]));
      var barAreaTop = padding.top;
      var barAreaBottom = height - padding.bottom;
      var barW = Math.max(6, xStep * 0.5);
      opts.bars.forEach(function (v, i) {
        var h = (v / barMax) * (barAreaBottom - barAreaTop) * 0.9;
        var rect = svgEl('rect', {
          x: toX(i) - barW / 2, y: barAreaBottom - h, width: barW, height: h,
          fill: '#dbe4e8', rx: 2,
        });
        var title = svgEl('title', {});
        title.textContent = opts.labels[i] + ': n=' + v;
        rect.appendChild(title);
        svg.appendChild(rect);
      });
    }

    if (opts.basisLine !== undefined) {
      var basisY = toY(opts.basisLine);
      svg.appendChild(svgEl('line', {
        x1: padding.left, x2: width - padding.right, y1: basisY, y2: basisY,
        stroke: '#b6bfc4', 'stroke-dasharray': '4 3',
      }));
    }

    opts.series.forEach(function (s) {
      var pathD = '';
      s.values.forEach(function (v, i) {
        if (!isFinite(v)) return;
        pathD += (pathD === '' ? 'M ' : 'L ') + toX(i).toFixed(1) + ' ' + toY(v).toFixed(1) + ' ';
      });
      svg.appendChild(svgEl('path', { d: pathD, fill: 'none', stroke: s.color, 'stroke-width': 2.5 }));
      s.values.forEach(function (v, i) {
        if (!isFinite(v)) return;
        var circle = svgEl('circle', { cx: toX(i), cy: toY(v), r: 4, fill: s.color });
        var title = svgEl('title', {});
        title.textContent = opts.labels[i] + ' ' + s.label + ': ' + (opts.yFormat ? opts.yFormat(v) : v.toFixed(1));
        circle.appendChild(title);
        svg.appendChild(circle);
        if (opts.showValues && showAt(i)) {
          var text = svgEl('text', {
            x: toX(i), y: toY(v) - 10, 'font-size': opts.compact ? 9 : 11, 'text-anchor': 'middle', fill: s.color,
          });
          text.textContent = opts.yFormat ? opts.yFormat(v) : v.toFixed(1);
          svg.appendChild(text);
        }
      });
    });

    opts.labels.forEach(function (label, i) {
      if (!showAt(i)) return;
      var text = svgEl('text', {
        x: toX(i), y: height - 8, 'font-size': 11, 'text-anchor': 'middle', fill: '#7a838a',
      });
      text.textContent = label;
      svg.appendChild(text);
    });

    container.appendChild(svg);
  }

  function renderLegend(legendId, seriesLabels, seriesColors) {
    var el = document.getElementById(legendId);
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    seriesLabels.forEach(function (label, i) {
      var span = document.createElement('span');
      var swatch = document.createElement('span');
      swatch.className = 'legend-swatch';
      swatch.style.background = seriesColors[i];
      span.appendChild(swatch);
      span.appendChild(document.createTextNode(label));
      el.appendChild(span);
    });
  }

  function stackedBarChart(container, opts) {
    // opts: { labels, seriesLabels, seriesColors, matrix (labels.length x seriesLabels.length shares 0..1), width, height, legendId }
    clearChart(container);
    if (opts.legendId) renderLegend(opts.legendId, opts.seriesLabels, opts.seriesColors);
    var width = opts.width || container.clientWidth || 900;
    var height = opts.height || 260;
    var padding = { top: 10, right: 10, bottom: 26, left: 10 };
    var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + height, width: '100%', height: height });

    var n = opts.labels.length;
    if (n === 0) {
      container.appendChild(svg);
      return;
    }
    var barAreaW = width - padding.left - padding.right;
    var barW = (barAreaW / n) * 0.72;
    var gap = (barAreaW / n) * 0.28;
    var bodyTop = padding.top;
    var bodyBottom = height - padding.bottom;
    var bodyH = bodyBottom - bodyTop;

    opts.labels.forEach(function (label, i) {
      var x = padding.left + i * (barW + gap) + gap / 2;
      var yCursor = bodyBottom;
      opts.seriesLabels.forEach(function (sLabel, si) {
        var share = opts.matrix[i][si] || 0;
        var h = share * bodyH;
        var rect = svgEl('rect', {
          x: x, y: yCursor - h, width: barW, height: h, fill: opts.seriesColors[si],
        });
        var title = svgEl('title', {});
        title.textContent = label + ' · ' + sLabel + ': ' + (share * 100).toFixed(0) + '%';
        rect.appendChild(title);
        svg.appendChild(rect);
        if (h > 16) {
          var text = svgEl('text', {
            x: x + barW / 2, y: yCursor - h / 2 + 4, 'font-size': 10, 'text-anchor': 'middle', fill: '#fff',
          });
          text.textContent = Math.round(share * 100) + '%';
          svg.appendChild(text);
        }
        yCursor -= h;
      });
      var labelText = svgEl('text', {
        x: x + barW / 2, y: height - 8, 'font-size': 11, 'text-anchor': 'middle', fill: '#7a838a',
      });
      labelText.textContent = label;
      svg.appendChild(labelText);
    });

    container.appendChild(svg);
  }

  // ---- Section renderers --------------------------------------------------

  function renderKpis(filtered) {
    var bids = filtered.map(bidOf);
    document.getElementById('kpi-n').textContent = fmtNum(filtered.length);
    document.getElementById('kpi-median').textContent = fmtEur(median(bids));
    document.getElementById('kpi-mean').textContent = fmtEur(mean(bids));
    document.getElementById('sample-note').textContent =
      filtered.length === ALL_DATA.length
        ? 'Showing all ' + fmtNum(ALL_DATA.length) + ' auctions — no filters applied'
        : 'Showing ' + fmtNum(filtered.length) + ' of ' + fmtNum(ALL_DATA.length) + ' auctions';
  }

  function applyFiltersExceptMileage() {
    return ALL_DATA.filter(function (d) {
      if (state.accident === 'free' && !d.af) return false;
      if (state.accident === 'with' && d.af) return false;
      if (d.ag < state.ageRange[0] || d.ag > state.ageRange[1]) return false;
      if (d.bk < state.batteryRange[0] || d.bk > state.batteryRange[1]) return false;
      if (d.pk < state.powerRange[0] || d.pk > state.powerRange[1]) return false;
      if (d.lp < state.listRange[0] || d.lp > state.listRange[1]) return false;
      var bidValue = state.priceBasis === 'raw' ? d.hr : d.hb;
      if (bidValue < state.bidRange[0] || bidValue > state.bidRange[1]) return false;
      if (d.bi < state.minBids) return false;
      return true;
    });
  }

  function renderMileageCounts() {
    var base = applyFiltersExceptMileage();
    MILEAGE_BANDS.forEach(function (band) {
      var count = base.filter(function (d) { return bandOf(MILEAGE_BANDS, d.km) === band.label; }).length;
      var el = document.querySelector('[data-mileage-count="' + band.label + '"]');
      if (el) el.textContent = fmtNum(count);
    });
  }

  function computeIndex(filtered) {
    var granularity = state.periodGranularity;
    var byPeriod = groupByPeriod(filtered, granularity);
    var keys = sortedKeys(byPeriod);
    var baseKey = granularity === 'quarter' ? quarterKey(BASE_MONTH) : BASE_MONTH;
    var baseDeals = byPeriod[baseKey] || [];
    var baseMedian = median(baseDeals.map(bidOf));
    var baseMean = mean(baseDeals.map(bidOf));

    var points = keys.map(function (k) {
      var deals = byPeriod[k];
      var bids = deals.map(bidOf);
      var med = median(bids);
      var avg = mean(bids);
      return {
        key: k,
        label: granularity === 'quarter' ? quarterLabel(k) : monthLabel(k),
        n: deals.length,
        median: med,
        mean: avg,
        indexMedian: isFinite(baseMedian) && baseMedian !== 0 ? (med / baseMedian) * 100 : NaN,
        indexMean: isFinite(baseMean) && baseMean !== 0 ? (avg / baseMean) * 100 : NaN,
      };
    });
    return points;
  }

  function renderPriceLevelChart(filtered) {
    var points = computeIndex(filtered);
    lineBarChart(document.getElementById('chart-price-level'), {
      labels: points.map(function (p) { return p.label; }),
      series: [
        { label: 'Median', values: points.map(function (p) { return p.median; }), color: '#0e6b60' },
        { label: 'Durchschnitt', values: points.map(function (p) { return p.mean; }), color: '#e0913e' },
      ],
      bars: points.map(function (p) { return p.n; }),
      yFormat: fmtEur,
      height: 280,
    });
  }

  function renderIndexChart(filtered) {
    var points = computeIndex(filtered);
    var series = [];
    if (state.indexMeasure === 'median' || state.indexMeasure === 'both') {
      series.push({ label: 'Median-Index', values: points.map(function (p) { return p.indexMedian; }), color: '#0e6b60' });
    }
    if (state.indexMeasure === 'average' || state.indexMeasure === 'both') {
      series.push({ label: 'Durchschnitt-Index', values: points.map(function (p) { return p.indexMean; }), color: '#e0913e' });
    }
    lineBarChart(document.getElementById('chart-index'), {
      labels: points.map(function (p) { return p.label; }),
      series: series,
      bars: points.map(function (p) { return p.n; }),
      basisLine: 100,
      yFormat: function (v) { return v.toFixed(1); },
      showValues: true,
      height: 300,
    });

    var last = points[points.length - 1];
    if (last) {
      var pct = last.indexMedian - 100;
      document.getElementById('headline-index').textContent = last.indexMedian.toFixed(1);
      document.getElementById('headline-delta').textContent = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
      document.getElementById('headline-delta-badge').className = 'delta-badge ' + (pct >= 0 ? 'up' : 'down');
      document.getElementById('headline-text').textContent =
        'Since Jan \'26, the median winning bid on our EV auctions has ' +
        (pct >= 0 ? 'risen ' : 'fallen ') + Math.abs(pct).toFixed(1) + '%, to an index of ' + last.indexMedian.toFixed(1) +
        ' as of ' + last.label + (window.EV_DASHBOARD.latestMonthPartial ? '*' : '') + '.';
      renderMiniSparkline(points);
    }
  }

  function renderMiniSparkline(points) {
    lineBarChart(document.getElementById('chart-headline-spark'), {
      labels: points.map(function (p) { return p.label; }),
      series: [{ label: 'Median-Index', values: points.map(function (p) { return p.indexMedian; }), color: '#5fe0c9' }],
      height: 90,
      yFormat: function (v) { return v.toFixed(1); },
    });
  }

  function renderFleetProfile(filtered) {
    var points = computeIndex(filtered).map(function (p) { return p.key; });
    var byPeriod = groupByPeriod(filtered, state.periodGranularity);
    var keys = sortedKeys(byPeriod);
    var labels = keys.map(function (k) { return state.periodGranularity === 'quarter' ? quarterLabel(k) : monthLabel(k); });

    var ageSeries = keys.map(function (k) { return mean(byPeriod[k].map(function (d) { return d.ag * 12; })); });
    var kmSeries = keys.map(function (k) { return median(byPeriod[k].map(function (d) { return d.km; })); });
    var listSeries = keys.map(function (k) { return median(byPeriod[k].map(function (d) { return d.lp; })); });
    var batterySeries = keys.map(function (k) { return median(byPeriod[k].map(function (d) { return d.bk; })); });
    var accidentFreeSeries = keys.map(function (k) {
      var d = byPeriod[k];
      var free = d.filter(function (x) { return x.af; }).length;
      return (free / d.length) * 100;
    });

    var miniWidth = 280;
    var miniHeight = 150;
    lineBarChart(document.getElementById('chart-age'), { labels: labels, series: [{ label: 'Alter (Monate)', values: ageSeries, color: '#0e6b60' }], width: miniWidth, height: miniHeight, showValues: true, compact: true, yFormat: function (v) { return v.toFixed(1); } });
    lineBarChart(document.getElementById('chart-km'), { labels: labels, series: [{ label: 'km', values: kmSeries, color: '#3fb8c9' }], width: miniWidth, height: miniHeight, showValues: true, compact: true, yFormat: fmtNum });
    lineBarChart(document.getElementById('chart-list'), { labels: labels, series: [{ label: 'Listenpreis', values: listSeries, color: '#e0913e' }], width: miniWidth, height: miniHeight, showValues: true, compact: true, yFormat: fmtEur });
    lineBarChart(document.getElementById('chart-battery'), { labels: labels, series: [{ label: 'Batterie', values: batterySeries, color: '#555' }], width: miniWidth, height: miniHeight, showValues: true, compact: true, yFormat: function (v) { return v.toFixed(0); } });
    lineBarChart(document.getElementById('chart-accidentfree'), { labels: labels, series: [{ label: 'Unfallfrei', values: accidentFreeSeries, color: '#0e6b60' }], width: miniWidth, height: miniHeight, showValues: true, compact: true, yFormat: function (v) { return v.toFixed(0) + '%'; } });

    var lastAge = ageSeries[ageSeries.length - 1];
    var lastKm = kmSeries[kmSeries.length - 1];
    var lastList = listSeries[listSeries.length - 1];
    var lastBattery = batterySeries[batterySeries.length - 1];
    var lastAf = accidentFreeSeries[accidentFreeSeries.length - 1];
    document.getElementById('stat-age').textContent = isFinite(lastAge) ? lastAge.toFixed(1) : '–';
    document.getElementById('stat-km').textContent = isFinite(lastKm) ? fmtNum(lastKm) : '–';
    document.getElementById('stat-list').textContent = isFinite(lastList) ? fmtEur(lastList) : '–';
    document.getElementById('stat-battery').textContent = isFinite(lastBattery) ? lastBattery.toFixed(1) : '–';
    document.getElementById('stat-accidentfree').textContent = isFinite(lastAf) ? lastAf.toFixed(1) + '%' : '–';

    void points;
  }

  function renderMixCharts(filtered) {
    var byPeriod = groupByPeriod(filtered, state.periodGranularity);
    var keys = sortedKeys(byPeriod);
    var labels = keys.map(function (k) { return state.periodGranularity === 'quarter' ? quarterLabel(k) : monthLabel(k); });

    var batteryColors = ['#bfe3f2', '#5fb3c9', '#2f8f88', '#e0913e', '#c9515f', '#5c3d99'];
    var batteryMatrix = keys.map(function (k) {
      var deals = byPeriod[k];
      var total = deals.length || 1;
      return BATTERY_BANDS.map(function (band) {
        return deals.filter(function (d) { return bandOf(BATTERY_BANDS, d.bk) === band.label; }).length / total;
      });
    });
    stackedBarChart(document.getElementById('chart-battery-mix'), {
      labels: labels, seriesLabels: BATTERY_BANDS.map(function (b) { return b.label; }), seriesColors: batteryColors, matrix: batteryMatrix,
      legendId: 'legend-battery-mix',
    });

    var datekColors = ['#bfe3f2', '#5fb3c9', '#2f8f88', '#8cb93e', '#e0913e', '#c9515f', '#5c3d99'];
    var datekMatrix = keys.map(function (k) {
      var deals = byPeriod[k].filter(function (d) { return d.dk !== null; });
      var total = deals.length || 1;
      return DATEK_BANDS.map(function (band) {
        return deals.filter(function (d) { return bandOf(DATEK_BANDS, d.dk) === band.label; }).length / total;
      });
    });
    stackedBarChart(document.getElementById('chart-datek-mix'), {
      labels: labels, seriesLabels: DATEK_BANDS.map(function (b) { return b.label; }), seriesColors: datekColors, matrix: datekMatrix,
      legendId: 'legend-datek-mix',
    });
  }

  function renderBrandCountry(filtered) {
    var byPeriod = groupByPeriod(filtered, state.periodGranularity);
    var keys = sortedKeys(byPeriod);
    var labels = keys.map(function (k) { return state.periodGranularity === 'quarter' ? quarterLabel(k) : monthLabel(k); });

    var groupFn = state.groupBy === 'country'
      ? function (d) { return brandCountry(d.b); }
      : function (d) { return d.b; };
    var groups = {};
    filtered.forEach(function (d) {
      var g = groupFn(d);
      if (!groups[g]) groups[g] = [];
      groups[g].push(d);
    });
    var groupNames = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length; });
    var topGroups = state.groupBy === 'brand' ? groupNames.slice(0, 10) : groupNames;
    var colors = topGroups.map(function (g, i) {
      return COUNTRY_COLORS[g] || ['#0b4f4a', '#14877e', '#e09a3e', '#5fb3ac', '#8a5fc9', '#c9515f', '#3f7f3a', '#b98d2a', '#2a5fb9', '#9aa3ab'][i % 10];
    });

    var matrix = keys.map(function (k) {
      var deals = byPeriod[k];
      var total = deals.length || 1;
      return topGroups.map(function (g) {
        return deals.filter(function (d) { return groupFn(d) === g; }).length / total;
      });
    });
    stackedBarChart(document.getElementById('chart-brand-country'), {
      labels: labels, seriesLabels: topGroups, seriesColors: colors, matrix: matrix, height: 220,
      legendId: 'legend-brand-country',
    });

    var rows = topGroups.map(function (g) {
      var deals = groups[g];
      var bids = deals.map(bidOf);
      var med = median(bids);
      // Only compare against this group's own January baseline — comparing a
      // thin group's overall median against the whole market's January median
      // (apples vs oranges) produced misleading deltas for small groups.
      var baseDeals = deals.filter(function (d) { return d.mo === BASE_MONTH; });
      var baseMed = baseDeals.length >= 5 ? median(baseDeals.map(bidOf)) : NaN;
      var delta = isFinite(baseMed) && baseMed !== 0 ? ((med - baseMed) / baseMed) * 100 : NaN;
      return {
        label: g,
        n: deals.length,
        share: (deals.length / filtered.length) * 100,
        medianBid: med,
        delta: delta,
        age: mean(deals.map(function (d) { return d.ag * 12; })),
        km: median(deals.map(function (d) { return d.km; })),
        battery: median(deals.map(function (d) { return d.bk; })),
        afShare: (deals.filter(function (d) { return d.af; }).length / deals.length) * 100,
      };
    });

    rows.sort(function (a, b) {
      var dir = brandCountrySortState.dir === 'asc' ? 1 : -1;
      var av = a[brandCountrySortState.column];
      var bv = b[brandCountrySortState.column];
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });

    var tbody = document.getElementById('brand-country-table-body');
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + r.label + '</td>' +
        '<td>' + fmtNum(r.n) + '</td>' +
        '<td>' + fmtPct(r.share, 1) + '</td>' +
        '<td>' + fmtEur(r.medianBid) + '</td>' +
        '<td class="' + (r.delta >= 0 ? 'pos' : 'neg') + '">' + (isFinite(r.delta) ? (r.delta >= 0 ? '+' : '') + r.delta.toFixed(1) + '%' : '–') + '</td>' +
        '<td>' + (isFinite(r.age) ? r.age.toFixed(1) : '–') + '</td>' +
        '<td>' + fmtNum(r.km) + '</td>' +
        '<td>' + (isFinite(r.battery) ? r.battery.toFixed(0) + ' kWh' : '–') + '</td>' +
        '<td>' + r.afShare.toFixed(0) + '%</td>';
      tbody.appendChild(tr);
    });
  }

  var brandCountrySortState = { column: 'n', dir: 'desc' };
  var sortState = { column: 'period', dir: 'asc' };

  function renderCompositionTable(filtered) {
    var byPeriod = groupByPeriod(filtered, state.periodGranularity);
    var keys = sortedKeys(byPeriod);
    var rows = keys.map(function (k) {
      var deals = byPeriod[k];
      var bids = deals.map(bidOf);
      var withKm = deals.filter(function (d) { return d.km > 0; }).length;
      var brandCounts = {};
      deals.forEach(function (d) { brandCounts[d.b] = (brandCounts[d.b] || 0) + 1; });
      var topBrand = Object.keys(brandCounts).sort(function (a, b) { return brandCounts[b] - brandCounts[a]; })[0];
      return {
        period: k,
        label: state.periodGranularity === 'quarter' ? quarterLabel(k) : monthLabel(k),
        n: deals.length,
        topBrand: topBrand,
        topBrandShare: topBrand ? (brandCounts[topBrand] / deals.length) * 100 : 0,
        pctWithKm: (withKm / deals.length) * 100,
        avgKm: mean(deals.map(function (d) { return d.km; })),
        medianKm: median(deals.map(function (d) { return d.km; })),
        avgBid: mean(bids),
        medianBid: median(bids),
      };
    });

    rows.sort(function (a, b) {
      var dir = sortState.dir === 'asc' ? 1 : -1;
      var av = a[sortState.column];
      var bv = b[sortState.column];
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });

    var tbody = document.getElementById('composition-table-body');
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + r.label + '</td>' +
        '<td>' + fmtNum(r.n) + '</td>' +
        '<td>' + (r.topBrand || '–') + ' ' + r.topBrandShare.toFixed(0) + '%</td>' +
        '<td>' + r.pctWithKm.toFixed(0) + '%</td>' +
        '<td>' + fmtNum(r.avgKm) + '</td>' +
        '<td>' + fmtNum(r.medianKm) + '</td>' +
        '<td>' + fmtEur(r.avgBid) + '</td>' +
        '<td>' + fmtEur(r.medianBid) + '</td>';
      tbody.appendChild(tr);
    });

    var totalBids = filtered.map(bidOf);
    var totalRow = document.getElementById('composition-total-row');
    totalRow.innerHTML =
      '<td>All periods</td>' +
      '<td>' + fmtNum(filtered.length) + '</td>' +
      '<td></td>' +
      '<td>' + ((filtered.filter(function (d) { return d.km > 0; }).length / filtered.length) * 100).toFixed(0) + '%</td>' +
      '<td>' + fmtNum(mean(filtered.map(function (d) { return d.km; }))) + '</td>' +
      '<td>' + fmtNum(median(filtered.map(function (d) { return d.km; }))) + '</td>' +
      '<td>' + fmtEur(mean(totalBids)) + '</td>' +
      '<td>' + fmtEur(median(totalBids)) + '</td>';
  }

  // ---- Filter panel wiring -------------------------------------------------

  function syncControlsFromState() {
    var accidentButtons = document.querySelectorAll('[data-accident]');
    accidentButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-accident') === state.accident);
    });
    document.querySelectorAll('[data-mileage-band]').forEach(function (cb) {
      cb.checked = !state.mileageBands || state.mileageBands.indexOf(cb.getAttribute('data-mileage-band')) !== -1;
    });
    var minBidsInput = document.getElementById('input-min-bids');
    if (minBidsInput) minBidsInput.value = state.minBids;
  }

  function wireControls() {
    document.querySelectorAll('[data-accident]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.accident = btn.getAttribute('data-accident');
        syncControlsFromState();
        render();
      });
    });

    document.querySelectorAll('[data-mileage-band]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var checked = Array.prototype.filter.call(document.querySelectorAll('[data-mileage-band]'), function (c) { return c.checked; })
          .map(function (c) { return c.getAttribute('data-mileage-band'); });
        state.mileageBands = checked.length === MILEAGE_BANDS.length ? null : checked;
        render();
      });
    });

    var presetBtn = document.getElementById('btn-preset-robust');
    if (presetBtn) presetBtn.addEventListener('click', function () { applyPreset('robust'); });
    var resetBtn = document.getElementById('btn-reset');
    if (resetBtn) resetBtn.addEventListener('click', function () { applyPreset('reset'); });

    var minBidsInput = document.getElementById('input-min-bids');
    if (minBidsInput) {
      minBidsInput.addEventListener('input', function () {
        state.minBids = parseInt(minBidsInput.value, 10) || 0;
        render();
      });
    }

    document.querySelectorAll('[data-price-basis]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.priceBasis = btn.getAttribute('data-price-basis');
        document.querySelectorAll('[data-price-basis]').forEach(function (b) { b.classList.toggle('active', b === btn); });
        render();
      });
    });

    document.querySelectorAll('[data-granularity]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.periodGranularity = btn.getAttribute('data-granularity');
        document.querySelectorAll('[data-granularity]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-granularity') === state.periodGranularity); });
        render();
      });
    });

    document.querySelectorAll('[data-index-measure]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.indexMeasure = btn.getAttribute('data-index-measure');
        document.querySelectorAll('[data-index-measure]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-index-measure') === state.indexMeasure); });
        render();
      });
    });

    document.querySelectorAll('[data-group-by]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.groupBy = btn.getAttribute('data-group-by');
        document.querySelectorAll('[data-group-by]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-group-by') === state.groupBy); });
        render();
      });
    });

    document.querySelectorAll('[data-sort-col]').forEach(function (th) {
      th.addEventListener('click', function () {
        var col = th.getAttribute('data-sort-col');
        var table = th.getAttribute('data-sort-table');
        var target = table === 'brand-country' ? brandCountrySortState : sortState;
        if (target.column === col) {
          target.dir = target.dir === 'asc' ? 'desc' : 'asc';
        } else {
          target.column = col;
          target.dir = 'asc';
        }
        render();
      });
    });

    var csvToggle = document.getElementById('csv-load-toggle');
    var csvPanel = document.getElementById('csv-load-panel');
    if (csvToggle && csvPanel) {
      csvToggle.addEventListener('click', function () {
        csvPanel.classList.toggle('open');
      });
    }
    var csvInput = document.getElementById('csv-file-input');
    if (csvInput) {
      csvInput.addEventListener('change', function (evt) {
        var file = evt.target.files && evt.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var parsed = parseCsvInBrowser(String(reader.result));
            ALL_DATA = parsed;
            document.getElementById('csv-load-status').textContent = 'Loaded ' + parsed.length + ' rows from ' + file.name + ' (session only, not saved).';
            applyPreset('reset');
          } catch (err) {
            document.getElementById('csv-load-status').textContent = 'Could not parse this file: ' + err.message;
          }
        };
        reader.readAsText(file);
      });
    }
  }

  function parseCsvInBrowser(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.length > 0; });
    if (lines.length < 2) throw new Error('empty file');
    var header = splitCsvLine(lines[0]);
    var idx = {};
    header.forEach(function (h, i) { idx[h.replace(/^﻿/, '')] = i; });
    var required = ['End Time', 'Deal → Make', 'Highest Bid corrected', 'Deal → List Price', 'Deal → First Registration'];
    required.forEach(function (col) {
      if (!(col in idx)) throw new Error('missing column: ' + col);
    });

    var out = [];
    for (var i = 1; i < lines.length; i++) {
      var cols = splitCsvLine(lines[i]);
      var get = function (name) { return cols[idx[name]] || ''; };
      var make = get('Deal → Make').trim();
      var endTime = get('End Time').trim();
      var bid = parseFloat(get('Highest Bid corrected')) || 0;
      var listPrice = parseFloat(get('Deal → List Price')) || 0;
      if (!make || !endTime || bid <= 0 || listPrice <= 0) continue;
      var end = new Date(endTime);
      var firstReg = new Date(get('Deal → First Registration').trim());
      if (isNaN(end.getTime()) || isNaN(firstReg.getTime())) continue;
      var ageYears = (end.getTime() - firstReg.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      var se = Math.max(0, parseFloat(get('Deal → Special Equipment Price')) || 0);
      var newPrice = listPrice + se;
      var vMinRaw = get('Valuation Range → Min');
      var vMaxRaw = get('Valuation Range → Max');
      var vMin = vMinRaw !== '' ? parseFloat(vMinRaw) : null;
      var vMax = vMaxRaw !== '' ? parseFloat(vMaxRaw) : null;
      out.push({
        b: make, m: get('Deal → Model').trim(),
        mo: end.getUTCFullYear() + '-' + String(end.getUTCMonth() + 1).padStart(2, '0'),
        bi: parseFloat(get('Number Of Bids')) || 0,
        km: parseFloat(get('Deal → Mileage')) || 0,
        ag: Math.round(ageYears * 100) / 100,
        bk: parseFloat(get('Deal → Battery Capacity Brutto')) || 0,
        pk: parseFloat(get('Deal → Power Kw')) || 0,
        lp: listPrice, se: se, np: newPrice, hb: bid,
        hr: parseFloat(get('Highest Bid Amount')) || 0,
        af: get('Deal → Accident Free Seller').trim() === 'true' && get('Deal → Accident Free Cardentity').trim() === 'true',
        tx: get('Deal → Taxation').trim(),
        dk: vMin !== null && vMax !== null ? (vMin + vMax) / 2 : null,
        rv: newPrice > 0 ? Math.round((bid / newPrice) * 10000) / 100 : 0,
      });
    }
    if (out.length === 0) throw new Error('no valid rows found');
    return out;
  }

  function splitCsvLine(line) {
    var result = [];
    var current = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = false; }
        } else {
          current += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        result.push(current);
        current = '';
      } else {
        current += c;
      }
    }
    result.push(current);
    return result;
  }

  // ---- Main render ---------------------------------------------------------

  function render() {
    var filtered = applyFilters();
    renderKpis(filtered);
    renderMileageCounts();
    renderPriceLevelChart(filtered);
    renderIndexChart(filtered);
    renderFleetProfile(filtered);
    renderMixCharts(filtered);
    renderBrandCountry(filtered);
    renderCompositionTable(filtered);
  }

  document.addEventListener('DOMContentLoaded', function () {
    wireControls();
    syncControlsFromState();
    render();
  });
})();
