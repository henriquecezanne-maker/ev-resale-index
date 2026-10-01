// Client-side demand dashboard — ranks brands/models by how many bids their
// auctions draw on average. This is independent of price: it measures how
// contested an auction is, not what it sells for, so it's a market-desirability
// signal the price index and residual-value curves don't capture on their own.
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

  var FALLBACK_COLORS = ['#0b4f4a', '#14877e', '#e09a3e', '#5fb3ac', '#8a5fc9', '#c9515f', '#3f7f3a', '#b98d2a', '#2a5fb9', '#9aa3ab'];

  // Parent-company groupings, as of 2026. Smart is a Mercedes-Benz/Geely 50-50
  // joint venture — grouped under Mercedes-Benz Group by brand heritage.
  var BRAND_GROUP = {
    Volkswagen: 'Volkswagen Group', Audi: 'Volkswagen Group', Skoda: 'Volkswagen Group',
    Cupra: 'Volkswagen Group', Seat: 'Volkswagen Group', Porsche: 'Volkswagen Group',
    BMW: 'BMW Group', MINI: 'BMW Group',
    'Mercedes-Benz': 'Mercedes-Benz Group', Smart: 'Mercedes-Benz Group',
    Hyundai: 'Hyundai Motor Group', Kia: 'Hyundai Motor Group', Genesis: 'Hyundai Motor Group',
    Renault: 'Renault Group', Dacia: 'Renault Group',
    Opel: 'Stellantis', Fiat: 'Stellantis', Peugeot: 'Stellantis', 'Citroën': 'Stellantis',
    'DS Automobiles': 'Stellantis', Jeep: 'Stellantis', Abarth: 'Stellantis', Maserati: 'Stellantis', 'Alfa Romeo': 'Stellantis',
    Volvo: 'Geely Group', Polestar: 'Geely Group', Lotus: 'Geely Group',
    Toyota: 'Toyota Group', Lexus: 'Toyota Group',
    Tesla: 'Tesla',
    Ford: 'Ford',
    Nissan: 'Nissan', Mazda: 'Mazda', Honda: 'Honda', Subaru: 'Subaru',
    MG: 'SAIC Motor', Aiways: 'Aiways', BYD: 'BYD', Xpeng: 'Xpeng', Nio: 'Nio',
    DFSK: 'DFSK', Maxus: 'SAIC Motor', GWM: 'Great Wall Motor', Leapmotor: 'Leapmotor',
    Jaguar: 'JLR', Ssangyong: 'KG Mobility', Cadillac: 'GM',
  };

  function brandCountry(brand) {
    return BRAND_COUNTRY[brand] || 'Other';
  }

  function brandGroupName(brand) {
    return BRAND_GROUP[brand] || brand;
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

  function fmtNum(n) {
    if (!isFinite(n)) return '–';
    return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.round(n));
  }

  function svgEl(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, attrs[k]);
    return el;
  }

  function clearChart(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  function renderLegend(legendId, entries) {
    var el = document.getElementById(legendId);
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    entries.forEach(function (e) {
      var span = document.createElement('span');
      var swatch = document.createElement('span');
      swatch.className = 'legend-swatch';
      swatch.style.background = e.color;
      span.appendChild(swatch);
      span.appendChild(document.createTextNode(e.label + ' (n=' + fmtNum(e.n) + ')'));
      el.appendChild(span);
    });
  }

  // Horizontal bar ranking — one row per group, sorted by avg bids descending.
  function rankingBarChart(container, rows) {
    clearChart(container);
    var rowH = 32;
    var padding = { top: 10, right: 70, bottom: 10, left: 130 };
    var width = container.clientWidth || 900;
    var height = padding.top + padding.bottom + rows.length * rowH;
    var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + height, width: '100%', height: height });

    var maxVal = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    var barAreaW = width - padding.left - padding.right;
    var toW = function (v) { return (v / maxVal) * barAreaW; };

    rows.forEach(function (r, i) {
      var y = padding.top + i * rowH;
      var barW = toW(r.value);

      var label = svgEl('text', { x: padding.left - 10, y: y + rowH / 2 + 4, 'font-size': 12, 'text-anchor': 'end', fill: '#3a3f45' });
      label.textContent = r.label;
      svg.appendChild(label);

      var track = svgEl('rect', { x: padding.left, y: y + 5, width: barAreaW, height: rowH - 12, fill: 'rgba(128,128,128,0.08)', rx: 4 });
      svg.appendChild(track);

      var bar = svgEl('rect', { x: padding.left, y: y + 5, width: Math.max(2, barW), height: rowH - 12, fill: r.color, rx: 4 });
      var title = svgEl('title', {});
      title.textContent = r.label + ': ' + r.value.toFixed(2) + ' avg bids (n=' + fmtNum(r.n) + ')';
      bar.appendChild(title);
      svg.appendChild(bar);

      var valueText = svgEl('text', { x: padding.left + barW + 8, y: y + rowH / 2 + 4, 'font-size': 12, fill: '#3a3f45' });
      valueText.textContent = r.value.toFixed(2);
      svg.appendChild(valueText);
    });

    container.appendChild(svg);
  }

  // Multi-line time chart — one line per cluster (brand/country/model), each
  // showing that cluster's avg/median bids per month, so demand trends across
  // the year can be compared between clusters instead of just seeing the market total.
  function trendLinesChart(container, series, months) {
    clearChart(container);
    var width = container.clientWidth || 900;
    var height = 420;
    var padding = { top: 20, right: 20, bottom: 34, left: 50 };
    var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + height, width: '100%', height: height });

    if (months.length === 0 || series.length === 0) {
      container.appendChild(svg);
      return;
    }

    var allValues = [];
    series.forEach(function (s) { s.values.forEach(function (v) { if (isFinite(v)) allValues.push(v); }); });
    var yMin = Math.min.apply(null, allValues.concat([0]));
    var yMax = Math.max.apply(null, allValues.concat([1]));
    var yPad = (yMax - yMin) * 0.12 || 1;
    yMin = Math.max(0, yMin - yPad);
    yMax += yPad;

    var xStep = months.length > 1 ? (width - padding.left - padding.right) / (months.length - 1) : 0;
    var toX = function (i) { return padding.left + i * xStep; };
    var toY = function (v) { return padding.top + (height - padding.top - padding.bottom) * (1 - (v - yMin) / (yMax - yMin)); };

    var yTickCount = 4;
    for (var yt = 0; yt <= yTickCount; yt++) {
      var yVal = yMin + ((yMax - yMin) * yt) / yTickCount;
      var yPix = toY(yVal);
      svg.appendChild(svgEl('line', { x1: padding.left, x2: width - padding.right, y1: yPix, y2: yPix, stroke: 'rgba(128,128,128,0.15)' }));
      var yLabel = svgEl('text', { x: padding.left - 8, y: yPix + 4, 'font-size': 10, 'text-anchor': 'end', fill: '#7a838a' });
      yLabel.textContent = yVal.toFixed(1);
      svg.appendChild(yLabel);
    }

    months.forEach(function (m, i) {
      var label = svgEl('text', { x: toX(i), y: height - 10, 'font-size': 11, 'text-anchor': 'middle', fill: '#7a838a' });
      label.textContent = m;
      svg.appendChild(label);
    });

    series.forEach(function (s) {
      var pathD = '';
      s.values.forEach(function (v, i) {
        if (!isFinite(v)) return;
        pathD += (pathD === '' ? 'M ' : 'L ') + toX(i).toFixed(1) + ' ' + toY(v).toFixed(1) + ' ';
      });
      svg.appendChild(svgEl('path', { d: pathD, fill: 'none', stroke: s.color, 'stroke-width': 2.5 }));
      s.values.forEach(function (v, i) {
        if (!isFinite(v)) return;
        var circle = svgEl('circle', { cx: toX(i), cy: toY(v), r: 3.5, fill: s.color });
        var title = svgEl('title', {});
        title.textContent = s.label + ' · ' + months[i] + ': ' + v.toFixed(2) + ' avg bids';
        circle.appendChild(title);
        svg.appendChild(circle);
      });
    });

    container.appendChild(svg);
  }

  var ALL_DATA = window.EV_DASHBOARD.deals;
  // Model rankings need a lower floor than brand/country — most individual models
  // sit in the 20-100 auction range, so a n>=30 floor (right for ~26 brands) would
  // silently drop half the models. n>=20 keeps the ranking honest without gutting it.
  var MIN_N_BY_MODE = { brand: 30, country: 30, model: 20 };
  // Trend lines need more per-month data than a single overall ranking bucket —
  // 15 auctions in a month for one cluster is already a thin slice.
  var MIN_N_PER_MONTH = 15;

  var KM_BANDS = [
    { label: '0-10k', min: 0, max: 10000 },
    { label: '10-20k', min: 10000, max: 20000 },
    { label: '20-30k', min: 20000, max: 30000 },
    { label: '30-40k', min: 30000, max: 40000 },
    { label: '40-50k', min: 40000, max: 50000 },
    { label: '50-60k', min: 50000, max: 60000 },
    { label: '60-70k', min: 60000, max: 70000 },
    { label: '70-80k', min: 70000, max: 80000 },
    { label: '80-90k', min: 80000, max: 90000 },
    { label: '90-100k', min: 90000, max: 100000 },
    { label: '100-120k', min: 100000, max: 120000 },
    { label: '120k+', min: 120000, max: Infinity },
  ];

  var AGE_BANDS = [
    { label: '0-1y', min: 0, max: 1 },
    { label: '1-2y', min: 1, max: 2 },
    { label: '2-3y', min: 2, max: 3 },
    { label: '3-4y', min: 3, max: 4 },
    { label: '4-5y', min: 4, max: 5 },
    { label: '5-6y', min: 5, max: 6 },
    { label: '6-7y', min: 6, max: 7 },
    { label: '7-8y', min: 7, max: 8 },
    { label: '8y+', min: 8, max: Infinity },
  ];

  var MODE_BAND_ORDER = {
    km: ['0-10k', '10-20k', '20-30k', '30-40k', '40-50k', '50-60k', '60-70k', '70-80k', '80-90k', '90-100k', '100-120k', '120k+'],
    age: ['0-1y', '1-2y', '2-3y', '3-4y', '4-5y', '5-6y', '6-7y', '7-8y', '8y+'],
  };

  function bandOf(bands, value) {
    for (var i = 0; i < bands.length; i++) {
      if (value >= bands[i].min && value < bands[i].max) return bands[i].label;
    }
    return bands[bands.length - 1].label;
  }

  // view: 'rank' = single ranking/trend-band chart · 'time' = multi-line chart, one line per cluster in `mode`, over months
  var state = { view: 'rank', mode: 'model', metric: 'mean', accident: 'all', activeClusters: null };

  function accidentFiltered(data) {
    if (state.accident === 'free') return data.filter(function (d) { return d.af; });
    if (state.accident === 'with') return data.filter(function (d) { return !d.af; });
    return data;
  }

  function groupKeyFn(mode) {
    return mode === 'country' ? function (d) { return brandCountry(d.b); }
      : mode === 'konzern' ? function (d) { return brandGroupName(d.b); }
      : mode === 'model' ? function (d) { return d.b + ' ' + d.m; }
      : mode === 'km' ? function (d) { return bandOf(KM_BANDS, d.km); }
      : mode === 'age' ? function (d) { return bandOf(AGE_BANDS, d.ag); }
      : function (d) { return d.b; };
  }

  function groupsFromMode(mode) {
    var groupFn = groupKeyFn(mode);
    var groups = {};
    accidentFiltered(ALL_DATA).forEach(function (d) {
      var g = groupFn(d);
      if (!groups[g]) groups[g] = [];
      groups[g].push(d.bi);
    });
    return groups;
  }

  function renderRankView() {
    var isOrdered = MODE_BAND_ORDER[state.mode] !== undefined;
    var minN = MIN_N_BY_MODE[state.mode] || 30;
    var groups = groupsFromMode(state.mode);
    var names = isOrdered ? MODE_BAND_ORDER[state.mode].filter(function (n) { return groups[n]; }) : Object.keys(groups);
    var rows = names
      .map(function (name, i) {
        var bids = groups[name];
        return {
          label: name,
          n: bids.length,
          value: state.metric === 'median' ? median(bids) : mean(bids),
          color: state.mode === 'country' ? (COUNTRY_COLORS[name] || '#9aa3ab') : FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        };
      })
      .filter(function (r) { return r.n >= minN; });
    if (!isOrdered) rows.sort(function (a, b) { return b.value - a.value; });

    var chartRows = state.mode === 'model' ? rows.slice(0, 15) : rows;
    rankingBarChart(document.getElementById('chart-demand-ranking'), chartRows);

    var tbody = document.getElementById('demand-table-body');
    if (tbody) {
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      rows.forEach(function (r, i) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + (i + 1) + '</td><td>' + r.label + '</td><td>' + r.value.toFixed(2) + '</td><td>' + fmtNum(r.n) + '</td>';
        tbody.appendChild(tr);
      });
    }

    var excludedCount = Object.keys(groups).length - rows.length;
    var note = document.getElementById('demand-thin-note');
    if (note) {
      var parts = [];
      if (state.mode === 'model' && rows.length > chartRows.length) {
        parts.push('Chart shows the top 15 of ' + fmtNum(rows.length) + ' ranked models — see the full table below.');
      }
      if (excludedCount > 0) {
        var unitLabel = state.mode === 'model' ? 'model(s)' : state.mode === 'country' ? 'countries' : 'band(s)/brand(s)';
        parts.push(excludedCount + ' ' + unitLabel + ' excluded (fewer than ' + minN + ' auctions).');
      }
      note.textContent = parts.join(' ');
    }
  }

  function renderTimeView() {
    var clusterMode = state.mode;
    var isBandMode = clusterMode === 'km' || clusterMode === 'age';
    var data = accidentFiltered(ALL_DATA);
    var groupFn = groupKeyFn(clusterMode);

    var byCluster = {};
    data.forEach(function (d) {
      var g = groupFn(d);
      if (!byCluster[g]) byCluster[g] = [];
      byCluster[g].push(d);
    });

    var months = Array.from(new Set(data.map(function (d) { return d.mo; }))).sort();

    // Mileage/age bands keep their natural order (0-10k, 10-20k, ...) so the
    // legend reads as a trend, not a shuffled ranking; brand/country/model still
    // sort by volume since there's no natural order to preserve there.
    var clusterNames = isBandMode
      ? MODE_BAND_ORDER[clusterMode].filter(function (n) { return byCluster[n]; })
      : Object.keys(byCluster).sort(function (a, b) { return byCluster[b].length - byCluster[a].length; });
    if (!isBandMode && clusterMode !== 'country') clusterNames = clusterNames.slice(0, 12); // cap — dozens of thin clusters would clutter the chart

    var eligible = clusterNames
      .map(function (name, i) {
        return {
          name: name,
          n: byCluster[name].length,
          color: clusterMode === 'country' ? (COUNTRY_COLORS[name] || '#9aa3ab') : FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        };
      })
      .filter(function (c) { return c.n >= MIN_N_PER_MONTH; });

    if (state.activeClusters === null) {
      state.activeClusters = new Set(eligible.map(function (c) { return c.name; }));
    }

    renderClusterToggles(eligible);

    var shown = eligible.filter(function (c) { return state.activeClusters.has(c.name); });
    var series = shown.map(function (c) {
      var byMonth = {};
      byCluster[c.name].forEach(function (d) {
        if (!byMonth[d.mo]) byMonth[d.mo] = [];
        byMonth[d.mo].push(d.bi);
      });
      var values = months.map(function (m) {
        var bids = byMonth[m];
        if (!bids || bids.length < MIN_N_PER_MONTH) return NaN;
        return state.metric === 'median' ? median(bids) : mean(bids);
      });
      return { label: c.name, color: c.color, values: values, n: c.n };
    });

    trendLinesChart(document.getElementById('chart-demand-ranking'), series, months);
    renderLegend('legend-demand-time', series.map(function (s) { return { label: s.label, color: s.color, n: s.n }; }));

    var note = document.getElementById('demand-thin-note');
    if (note) {
      var tooThin = clusterNames.length - eligible.length;
      note.textContent = tooThin > 0
        ? tooThin + ' excluded (fewer than ' + MIN_N_PER_MONTH + ' total auctions). Individual months with fewer than ' + MIN_N_PER_MONTH + ' auctions for a cluster show as a gap in that line.'
        : 'Individual months with fewer than ' + MIN_N_PER_MONTH + ' auctions for a cluster show as a gap in that line.';
    }

    var tbody = document.getElementById('demand-table-body');
    if (tbody) tbody.innerHTML = '';
  }

  function renderClusterToggles(eligible) {
    var container = document.getElementById('demand-cluster-toggles');
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);
    eligible.forEach(function (c) {
      var btn = document.createElement('button');
      btn.className = 'cluster-toggle' + (state.activeClusters.has(c.name) ? ' active' : '');
      btn.style.setProperty('--toggle-color', c.color);
      btn.textContent = c.name + ' (' + fmtNum(c.n) + ')';
      btn.addEventListener('click', function () {
        if (state.activeClusters.has(c.name)) state.activeClusters.delete(c.name);
        else state.activeClusters.add(c.name);
        render();
      });
      container.appendChild(btn);
    });
  }

  function render() {
    var toggles = document.getElementById('demand-cluster-toggles');
    var legend = document.getElementById('legend-demand-time');
    var tableSection = document.getElementById('demand-table-section');
    if (state.view === 'time') {
      if (toggles) toggles.style.display = '';
      if (legend) legend.style.display = '';
      if (tableSection) tableSection.style.display = 'none';
      renderTimeView();
    } else {
      if (toggles) toggles.style.display = 'none';
      if (legend) legend.style.display = 'none';
      if (tableSection) tableSection.style.display = '';
      renderRankView();
    }
  }

  function wireControls() {
    document.querySelectorAll('[data-demand-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.view = btn.getAttribute('data-demand-view');
        document.querySelectorAll('[data-demand-view]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-demand-view') === state.view);
        });
        render();
      });
    });
    document.querySelectorAll('[data-demand-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.mode = btn.getAttribute('data-demand-mode');
        state.activeClusters = null; // previous view's cluster selection doesn't carry over to a new mode
        document.querySelectorAll('[data-demand-mode]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-demand-mode') === state.mode);
        });
        render();
      });
    });
    document.querySelectorAll('[data-demand-metric]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.metric = btn.getAttribute('data-demand-metric');
        document.querySelectorAll('[data-demand-metric]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-demand-metric') === state.metric);
        });
        render();
      });
    });
    document.querySelectorAll('[data-demand-accident]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.accident = btn.getAttribute('data-demand-accident');
        document.querySelectorAll('[data-demand-accident]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-demand-accident') === state.accident);
        });
        render();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    wireControls();
    render();
  });
})();
