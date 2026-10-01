// Client-side residual-value dashboard — overlays exponential decay curves per
// country-of-origin cluster (or individual brand) on the same chart, computed
// live in the browser from the embedded deal data. Mirrors the fit methodology
// in src/residual.ts (log-linear regression for the exponential fit) so the
// numbers here match what the main dashboard's brand ranking uses.
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

  function fmtNum(n) {
    if (!isFinite(n)) return '–';
    return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.round(n));
  }

  // ---- Curve fitting (mirrors src/residual.ts) ----------------------------

  function rSquared(actual, predicted) {
    var yMean = actual.reduce(function (s, v) { return s + v; }, 0) / actual.length;
    var ssTot = actual.reduce(function (s, v) { return s + Math.pow(v - yMean, 2); }, 0);
    var ssRes = actual.reduce(function (s, v, i) { return s + Math.pow(v - predicted[i], 2); }, 0);
    return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  }

  // Exponential fit RV = 100 * e^(-b*t), anchored at 100% (new price) at t=0 by
  // definition rather than fitted — t=0 isn't a measured point (nothing sells brand
  // new at auction), so letting the intercept float lets noise in the youngest
  // vehicles drag the curve's start away from the one value we know is exactly right.
  // Single-parameter log-linear regression through the origin: ln(RV/100) = -b*t.
  function fitExponential(points) {
    var n = points.length;
    var sumTT = 0, sumTLog = 0;
    for (var i = 0; i < n; i++) {
      var t = points[i].t;
      var logRatio = Math.log(points[i].rv / 100);
      sumTT += t * t; sumTLog += t * logRatio;
    }
    var b = sumTT === 0 ? 0 : -sumTLog / sumTT;
    var predicted = points.map(function (p) { return 100 * Math.exp(-b * p.t); });
    return { a: 100, b: b, r2: rSquared(points.map(function (p) { return p.rv; }), predicted) };
  }

  // ---- SVG chart primitives (subset of dashboard.js's, self-contained) ----

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
      span.appendChild(document.createTextNode(e.label + ' (n=' + fmtNum(e.n) + ', R²=' + e.r2.toFixed(2) + ')'));
      el.appendChild(span);
    });
  }

  function residualCurvesSvg(container, curves, opts) {
    // curves: [{ label, color, fit, points, n }]
    clearChart(container);
    var width = (opts && opts.width) || container.clientWidth || 1000;
    var height = (opts && opts.height) || 360;
    var padding = { top: 20, right: 20, bottom: 30, left: 50 };
    var tMax = 10;
    var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + height, width: '100%', height: height });

    // All curves are anchored at exactly 100% at t=0, so a fixed 0-100% axis
    // compresses every curve's differences into the last few percentage points of
    // chart height. Zooming the y-axis to the data's actual range (still always
    // including 100, since every curve touches it at t=0) makes brand differences
    // in decay speed visible instead of all lines looking like they're on top of
    // each other near the top of the chart.
    var yMax = 100;
    var yMin = 0;
    if (curves.length > 0) {
      var endValues = curves.map(function (c) { return c.fit.a * Math.exp(-c.fit.b * tMax); });
      yMin = Math.max(0, Math.floor(Math.min.apply(null, endValues) / 5) * 5 - 5);
    }

    var toX = function (t) { return padding.left + (t / tMax) * (width - padding.left - padding.right); };
    var toY = function (rv) { return padding.top + (1 - (rv - yMin) / (yMax - yMin)) * (height - padding.top - padding.bottom); };

    // y-axis gridlines every 10 percentage points across the zoomed range.
    var tickStep = 10;
    for (var rv = Math.ceil(yMin / tickStep) * tickStep; rv <= yMax; rv += tickStep) {
      var y = toY(rv);
      svg.appendChild(svgEl('line', { x1: padding.left, x2: width - padding.right, y1: y, y2: y, stroke: 'rgba(128,128,128,0.15)' }));
      var text = svgEl('text', { x: padding.left - 8, y: y + 4, 'font-size': 10, 'text-anchor': 'end', fill: '#7a838a' });
      text.textContent = rv + '%';
      svg.appendChild(text);
    }
    for (var t = 0; t <= tMax; t += 2) {
      var x = toX(t);
      var label = svgEl('text', { x: x, y: height - 8, 'font-size': 10, 'text-anchor': 'middle', fill: '#7a838a' });
      label.textContent = t + 'y';
      svg.appendChild(label);
    }

    curves.forEach(function (curve) {
      // Scatter (thinned to keep page weight down on the largest clusters).
      var maxDots = 300;
      var stride = Math.max(1, Math.ceil(curve.points.length / maxDots));
      curve.points.forEach(function (p, i) {
        if (i % stride !== 0) return;
        svg.appendChild(svgEl('circle', { cx: toX(p.t), cy: toY(p.rv), r: 2, fill: curve.color, opacity: 0.25 }));
      });

      // Fitted curve line.
      var curvePoints = [];
      for (var tt = 0; tt <= tMax; tt += 0.2) {
        var rv = curve.fit.a * Math.exp(-curve.fit.b * tt);
        curvePoints.push(toX(tt).toFixed(1) + ',' + toY(rv).toFixed(1));
      }
      var polyline = svgEl('polyline', { points: curvePoints.join(' '), fill: 'none', stroke: curve.color, 'stroke-width': 3 });
      var title = svgEl('title', {});
      title.textContent = curve.label + ': RV = ' + curve.fit.a.toFixed(1) + '% · e^(-' + curve.fit.b.toFixed(3) + '·t)';
      polyline.appendChild(title);
      svg.appendChild(polyline);
    });

    container.appendChild(svg);
  }

  // ---- Main -----------------------------------------------------------------

  var ALL_DATA = window.EV_DASHBOARD.deals;
  var MIN_N_FOR_FIT = 15; // methodology §6: fit needs at least 15 vehicles to be shown

  function residualPoints(deals) {
    return deals
      .filter(function (d) { return d.rv >= 5 && d.rv <= 120 && d.ag >= 0 && d.ag <= 10; })
      .map(function (d) { return { t: d.ag, rv: d.rv }; });
  }

  function accidentFiltered(data) {
    if (state.accident === 'free') return data.filter(function (d) { return d.af; });
    if (state.accident === 'with') return data.filter(function (d) { return !d.af; });
    return data;
  }

  function groupsFromMode(mode) {
    var groupFn = mode === 'brand' ? function (d) { return d.b; }
      : mode === 'konzern' ? function (d) { return brandGroupName(d.b); }
      : function (d) { return brandCountry(d.b); };
    var groups = {};
    accidentFiltered(ALL_DATA).forEach(function (d) {
      var g = groupFn(d);
      if (!groups[g]) groups[g] = [];
      groups[g].push(d);
    });
    var names = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length; });
    if (mode === 'brand') names = names.slice(0, 12); // cap — dozens of thin brands would clutter the chart
    return names.map(function (name, i) {
      var points = residualPoints(groups[name]);
      return {
        name: name,
        n: points.length,
        points: points,
        color: mode === 'country' ? (COUNTRY_COLORS[name] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]) : FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      };
    });
  }

  var state = {
    mode: 'country', // country | brand | konzern
    active: null, // null = all groups shown; otherwise a Set of active group names
    accident: 'all', // all | free | with
  };

  function render() {
    var groups = groupsFromMode(state.mode);
    var eligible = groups.filter(function (g) { return g.n >= MIN_N_FOR_FIT; });
    var tooThin = groups.filter(function (g) { return g.n < MIN_N_FOR_FIT; });

    if (state.active === null) {
      state.active = new Set(eligible.map(function (g) { return g.name; }));
    }

    renderToggleButtons(eligible);

    var shown = eligible.filter(function (g) { return state.active.has(g.name); });
    var curves = shown.map(function (g) {
      return { label: g.name, color: g.color, fit: fitExponential(g.points), points: g.points, n: g.n };
    });

    residualCurvesSvg(document.getElementById('chart-residual-curves'), curves, { height: 420 });
    renderLegend('legend-residual-curves', curves.map(function (c) { return { label: c.label, color: c.color, n: c.n, r2: c.fit.r2 }; }));

    var note = document.getElementById('thin-clusters-note');
    if (note) {
      note.textContent = tooThin.length > 0
        ? 'Not shown (fewer than ' + MIN_N_FOR_FIT + ' vehicles in the 0–10y window): ' + tooThin.map(function (g) { return g.name + ' (n=' + g.n + ')'; }).join(', ') + '.'
        : '';
    }
  }

  function renderToggleButtons(eligible) {
    var container = document.getElementById('cluster-toggles');
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);
    eligible.forEach(function (g) {
      var btn = document.createElement('button');
      btn.className = 'cluster-toggle' + (state.active.has(g.name) ? ' active' : '');
      btn.style.setProperty('--toggle-color', g.color);
      btn.textContent = g.name + ' (' + fmtNum(g.n) + ')';
      btn.addEventListener('click', function () {
        if (state.active.has(g.name)) state.active.delete(g.name);
        else state.active.add(g.name);
        render();
      });
      container.appendChild(btn);
    });
  }

  function wireControls() {
    document.querySelectorAll('[data-cluster-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.mode = btn.getAttribute('data-cluster-mode');
        state.active = null; // reset selection — the previous mode's groups don't apply to the new one
        document.querySelectorAll('[data-cluster-mode]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-cluster-mode') === state.mode);
        });
        render();
      });
    });

    var allBtn = document.getElementById('btn-toggle-all');
    if (allBtn) {
      allBtn.addEventListener('click', function () {
        var groups = groupsFromMode(state.mode).filter(function (g) { return g.n >= MIN_N_FOR_FIT; });
        state.active = new Set(groups.map(function (g) { return g.name; }));
        render();
      });
    }
    var noneBtn = document.getElementById('btn-toggle-none');
    if (noneBtn) {
      noneBtn.addEventListener('click', function () {
        state.active = new Set();
        render();
      });
    }

    document.querySelectorAll('[data-residual-accident]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.accident = btn.getAttribute('data-residual-accident');
        document.querySelectorAll('[data-residual-accident]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-residual-accident') === state.accident);
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
