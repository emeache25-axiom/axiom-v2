/**
 * AXIOM v2 — Charts / Indicators / Oscillators
 * Indicadores que van en pane separado: RSI, MACD.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const R   = window.AXIOM.Charts.Indicators;
  const Lib = window.AXIOM.Charts.IndicatorLib;

  // ── RSI ─────────────────────────────────────────────────────────────────────
  R.register({
    type: 'RSI', label: 'RSI', pane: 'separate', group: 'Momentum',
    defaults: { period: 14, color: '#B47514', lineWidth: 1.5 },
    fields: [
      { key: 'period',    label: 'Período', type: 'number', min: 2, max: 100, step: 1 },
      { key: 'color',     label: 'Color',   type: 'color' },
      { key: 'lineWidth', label: 'Grosor',  type: 'range',  min: 0.5, max: 4, step: 0.5 },
    ],
    summary: (p) => `RSI ${p.period}`,
    calc: (candles, p) => {
      const closes = candles.map((c) => c.close);
      const vals = Lib.rsi(closes, p.period);
      const line = [], ob = [], os = [], mid = [];
      for (let i = 0; i < candles.length; i++) {
        if (vals[i] == null) continue;
        const t = candles[i].time;
        line.push({ time: t, value: vals[i] });
        ob.push({ time: t, value: 70 });
        os.push({ time: t, value: 30 });
        mid.push({ time: t, value: 50 });
      }
      return [
        { kind: 'line', data: line, color: p.color,    lineWidth: p.lineWidth },
        { kind: 'line', data: ob,   color: '#D93B3B60', lineWidth: 1, lineStyle: 2 },
        { kind: 'line', data: os,   color: '#56A14F60', lineWidth: 1, lineStyle: 2 },
        { kind: 'line', data: mid,  color: '#2C292680', lineWidth: 1, lineStyle: 2 },
      ];
    },
  });

  // ── MACD ────────────────────────────────────────────────────────────────────
  R.register({
    type: 'MACD', label: 'MACD', pane: 'separate', group: 'Momentum',
    defaults: { fast: 12, slow: 26, signal: 9,
                colorMACD: '#2563EB', colorSignal: '#D86326', colorHist: '#56A14F' },
    fields: [
      { key: 'fast',        label: 'Rápida',       type: 'number', min: 2, max: 100, step: 1 },
      { key: 'slow',        label: 'Lenta',        type: 'number', min: 2, max: 200, step: 1 },
      { key: 'signal',      label: 'Señal',        type: 'number', min: 2, max: 100, step: 1 },
      { key: 'colorMACD',   label: 'Color MACD',   type: 'color' },
      { key: 'colorSignal', label: 'Color Señal',  type: 'color' },
      { key: 'colorHist',   label: 'Color Hist.',  type: 'color' },
    ],
    summary: (p) => `MACD ${p.fast},${p.slow},${p.signal}`,
    calc: (candles, p) => {
      const closes = candles.map((c) => c.close);
      const emaFast = Lib.ema(closes, p.fast);
      const emaSlow = Lib.ema(closes, p.slow);
      const macdLine = [];
      const macdVals = new Array(candles.length).fill(null);
      for (let i = 0; i < candles.length; i++) {
        if (emaFast[i] == null || emaSlow[i] == null) continue;
        macdVals[i] = emaFast[i] - emaSlow[i];
      }
      // Señal = EMA del MACD (solo sobre los valores definidos)
      const defined = macdVals.map((v) => (v == null ? 0 : v));
      const signalVals = Lib.ema(defined, p.signal);

      const macd = [], signal = [], hist = [];
      for (let i = 0; i < candles.length; i++) {
        if (macdVals[i] == null) continue;
        const t = candles[i].time;
        macd.push({ time: t, value: macdVals[i] });
        if (signalVals[i] != null) {
          signal.push({ time: t, value: signalVals[i] });
          const h = macdVals[i] - signalVals[i];
          hist.push({ time: t, value: h, color: h >= 0 ? p.colorHist + 'CC' : '#D93B3BCC' });
        }
      }
      return [
        { kind: 'line',      data: macd,   color: p.colorMACD,   lineWidth: 1.5 },
        { kind: 'line',      data: signal, color: p.colorSignal, lineWidth: 1.5 },
        { kind: 'histogram', data: hist,   color: p.colorHist },
      ];
    },
  });
})();
