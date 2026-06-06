/**
 * AXIOM v2 — Charts / Indicators / Overlays
 * Indicadores que se dibujan sobre el pane principal (sobre las velas):
 * SMA, EMA, Bollinger Bands.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const R   = window.AXIOM.Charts.Indicators;
  const Lib = window.AXIOM.Charts.IndicatorLib;

  // ── SMA ─────────────────────────────────────────────────────────────────────
  R.register({
    type: 'SMA', label: 'Media Móvil Simple', pane: 'main', group: 'Tendencia',
    defaults: { period: 20, color: '#C9A84C', lineWidth: 1.5 },
    fields: [
      { key: 'period',    label: 'Período', type: 'number', min: 2, max: 400, step: 1 },
      { key: 'color',     label: 'Color',   type: 'color' },
      { key: 'lineWidth', label: 'Grosor',  type: 'range',  min: 0.5, max: 4, step: 0.5 },
    ],
    summary: (p) => `SMA ${p.period}`,
    calc: (candles, p) => {
      const closes = candles.map((c) => c.close);
      const vals = Lib.sma(closes, p.period);
      const data = [];
      for (let i = 0; i < candles.length; i++)
        if (vals[i] != null) data.push({ time: candles[i].time, value: vals[i] });
      return [{ kind: 'line', data, color: p.color, lineWidth: p.lineWidth }];
    },
  });

  // ── EMA ─────────────────────────────────────────────────────────────────────
  R.register({
    type: 'EMA', label: 'Media Móvil Exponencial', pane: 'main', group: 'Tendencia',
    defaults: { period: 20, color: '#2563EB', lineWidth: 1.5 },
    fields: [
      { key: 'period',    label: 'Período', type: 'number', min: 2, max: 400, step: 1 },
      { key: 'color',     label: 'Color',   type: 'color' },
      { key: 'lineWidth', label: 'Grosor',  type: 'range',  min: 0.5, max: 4, step: 0.5 },
    ],
    summary: (p) => `EMA ${p.period}`,
    calc: (candles, p) => {
      const closes = candles.map((c) => c.close);
      const vals = Lib.ema(closes, p.period);
      const data = [];
      for (let i = 0; i < candles.length; i++)
        if (vals[i] != null) data.push({ time: candles[i].time, value: vals[i] });
      return [{ kind: 'line', data, color: p.color, lineWidth: p.lineWidth }];
    },
  });

  // ── Bollinger Bands ─────────────────────────────────────────────────────────
  R.register({
    type: 'BB', label: 'Bandas de Bollinger', pane: 'main', group: 'Volatilidad',
    defaults: { period: 20, mult: 2, color: '#78716C', lineWidth: 1 },
    fields: [
      { key: 'period',    label: 'Período',     type: 'number', min: 2,   max: 200, step: 1 },
      { key: 'mult',      label: 'Desv. (×)',   type: 'number', min: 0.5, max: 5,   step: 0.1 },
      { key: 'color',     label: 'Color',       type: 'color' },
      { key: 'lineWidth', label: 'Grosor',      type: 'range',  min: 0.5, max: 3, step: 0.5 },
    ],
    summary: (p) => `BB ${p.period},${p.mult}`,
    calc: (candles, p) => {
      const closes = candles.map((c) => c.close);
      const mid = Lib.sma(closes, p.period);
      const sd  = Lib.stddev(closes, p.period);
      const upper = [], middle = [], lower = [];
      for (let i = 0; i < candles.length; i++) {
        if (mid[i] == null || sd[i] == null) continue;
        const t = candles[i].time;
        upper.push({ time: t, value: mid[i] + p.mult * sd[i] });
        middle.push({ time: t, value: mid[i] });
        lower.push({ time: t, value: mid[i] - p.mult * sd[i] });
      }
      return [
        { kind: 'line', data: upper,  color: p.color,      lineWidth: p.lineWidth, lineStyle: 2 },
        { kind: 'line', data: middle, color: p.color + 'AA', lineWidth: p.lineWidth },
        { kind: 'line', data: lower,  color: p.color,      lineWidth: p.lineWidth, lineStyle: 2 },
      ];
    },
  });
})();
