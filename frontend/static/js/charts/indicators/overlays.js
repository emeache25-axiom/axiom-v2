/**
 * AXIOM v2 — Charts / Indicators / Overlays
 * Indicadores que se dibujan sobre el pane principal (sobre las velas):
 * SMA, EMA, Bollinger Bands. Todos con color, grosor y tipo de línea
 * configurables.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const R   = window.AXIOM.Charts.Indicators;
  const Lib = window.AXIOM.Charts.IndicatorLib;

  // ── SMA ─────────────────────────────────────────────────────────────────────
  R.register({
    type: 'SMA', label: 'Media Móvil Simple', pane: 'main', group: 'Tendencia',
    defaults: { period: 20, color: '#C9A84C', lineWidth: 1.5, lineStyle: 'solid' },
    fields: [
      { key: 'period',    label: 'Período', type: 'number', min: 2, max: 400, step: 1 },
      { key: 'color',     label: 'Color',   type: 'color' },
      { key: 'lineWidth', label: 'Grosor',  type: 'range',  min: 0.5, max: 4, step: 0.5 },
      Lib.LINE_STYLE_FIELD,
    ],
    summary: (p) => `SMA ${p.period}`,
    calc: (candles, p) => {
      const closes = candles.map((c) => c.close);
      const vals = Lib.sma(closes, p.period);
      const data = [];
      for (let i = 0; i < candles.length; i++)
        if (vals[i] != null) data.push({ time: candles[i].time, value: vals[i] });
      return [{ kind: 'line', data, color: p.color, lineWidth: p.lineWidth,
                lineStyle: Lib.lineStyle(p.lineStyle) }];
    },
  });

  // ── EMA ─────────────────────────────────────────────────────────────────────
  R.register({
    type: 'EMA', label: 'Media Móvil Exponencial', pane: 'main', group: 'Tendencia',
    defaults: { period: 20, color: '#2563EB', lineWidth: 1.5, lineStyle: 'solid' },
    fields: [
      { key: 'period',    label: 'Período', type: 'number', min: 2, max: 400, step: 1 },
      { key: 'color',     label: 'Color',   type: 'color' },
      { key: 'lineWidth', label: 'Grosor',  type: 'range',  min: 0.5, max: 4, step: 0.5 },
      Lib.LINE_STYLE_FIELD,
    ],
    summary: (p) => `EMA ${p.period}`,
    calc: (candles, p) => {
      const closes = candles.map((c) => c.close);
      const vals = Lib.ema(closes, p.period);
      const data = [];
      for (let i = 0; i < candles.length; i++)
        if (vals[i] != null) data.push({ time: candles[i].time, value: vals[i] });
      return [{ kind: 'line', data, color: p.color, lineWidth: p.lineWidth,
                lineStyle: Lib.lineStyle(p.lineStyle) }];
    },
  });

  // ── Bollinger Bands ─────────────────────────────────────────────────────────
  R.register({
    type: 'BB', label: 'Bandas de Bollinger', pane: 'main', group: 'Volatilidad',
    defaults: { period: 20, mult: 2, color: '#78716C', colorMid: '#78716C',
                lineWidth: 1, lineStyle: 'dashed', lineStyleMid: 'solid',
                colorFill: '#78716C', fillOpacity: 0.08 },
    fields: [
      { key: 'period',       label: 'Período',       type: 'number', min: 2,   max: 200, step: 1 },
      { key: 'mult',         label: 'Desv. (×)',     type: 'number', min: 0.5, max: 5,   step: 0.1 },
      { key: 'color',        label: 'Color bandas',  type: 'color' },
      { key: 'colorMid',     label: 'Color media',   type: 'color' },
      { key: 'colorFill',    label: 'Color sombra',  type: 'color' },
      { key: 'fillOpacity',  label: 'Opacidad sombra', type: 'range', min: 0, max: 0.5, step: 0.02 },
      { key: 'lineWidth',    label: 'Grosor',        type: 'range',  min: 0.5, max: 3, step: 0.5 },
      { key: 'lineStyle',    label: 'Línea bandas',  type: 'select', options: [
        { v: 'solid', l: 'Sólida' }, { v: 'dashed', l: 'Guiones' }, { v: 'dotted', l: 'Punteada' } ] },
      { key: 'lineStyleMid', label: 'Línea media',   type: 'select', options: [
        { v: 'solid', l: 'Sólida' }, { v: 'dashed', l: 'Guiones' }, { v: 'dotted', l: 'Punteada' } ] },
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
      const lsBands = Lib.lineStyle(p.lineStyle);
      const lsMid   = Lib.lineStyle(p.lineStyleMid);
      const out = [
        { kind: 'line', data: upper,  color: p.color,    lineWidth: p.lineWidth, lineStyle: lsBands },
        { kind: 'line', data: middle, color: p.colorMid, lineWidth: p.lineWidth, lineStyle: lsMid },
        { kind: 'line', data: lower,  color: p.color,    lineWidth: p.lineWidth, lineStyle: lsBands },
      ];
      // Sombreado interno entre las bandas (opcional via fillOpacity > 0)
      const op = p.fillOpacity ?? 0.08;
      if (op > 0) {
        const alpha = Math.round(op * 255).toString(16).padStart(2, '0');
        out.push({ kind: 'band', upper, lower, color: (p.colorFill || '#78716C') + alpha });
      }
      return out;
    },
  });
})();
