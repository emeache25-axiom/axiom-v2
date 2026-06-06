/**
 * AXIOM v2 — Charts / Indicators / Special
 * Indicadores que no se dibujan como líneas normales:
 *   - PSAR: puntos (markers via createSeriesMarkers)
 *   - S/R:  líneas de precio horizontales (createPriceLine)
 *
 * Estos definen `customRender(ctx)` en lugar de devolver series specs de línea.
 * El IndicatorManager detecta `kind:'markers'` y `kind:'pricelines'` y los
 * maneja con la API correspondiente de LWC.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const R = window.AXIOM.Charts.Indicators;

  // ── Parabolic SAR ─────────────────────────────────────────────────────────
  R.register({
    type: 'PSAR', label: 'Parabolic SAR', pane: 'main', group: 'Tendencia',
    defaults: { step: 0.02, max: 0.2, colorBull: '#56A14F', colorBear: '#D93B3B' },
    fields: [
      { key: 'step',      label: 'Paso AF',       type: 'number', min: 0.001, max: 0.1, step: 0.001 },
      { key: 'max',       label: 'Máx AF',        type: 'number', min: 0.1,   max: 0.5, step: 0.01 },
      { key: 'colorBull', label: 'Color alcista', type: 'color' },
      { key: 'colorBear', label: 'Color bajista', type: 'color' },
    ],
    summary: () => 'PSAR',
    calc: (candles, p) => {
      const n = candles.length;
      if (n < 3) return [{ kind: 'markers', markers: [] }];
      const highs = candles.map((c) => c.high);
      const lows  = candles.map((c) => c.low);
      const closes = candles.map((c) => c.close);

      let bullish = closes[1] > closes[0];
      let af = p.step;
      let ep = bullish ? highs[0] : lows[0];
      let sar = bullish ? Math.min(lows[0], lows[1]) : Math.max(highs[0], highs[1]);

      const markers = [];
      for (let i = 2; i < n; i++) {
        sar = sar + af * (ep - sar);
        if (bullish) {
          sar = Math.min(sar, lows[i - 1], lows[i - 2]);
          if (lows[i] < sar) { bullish = false; sar = ep; ep = lows[i]; af = p.step; }
          else {
            if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + p.step, p.max); }
            markers.push({ time: candles[i].time, price: sar,
              position: 'atPriceBottom', color: p.colorBull, shape: 'circle', size: 0.5 });
          }
        } else {
          sar = Math.max(sar, highs[i - 1], highs[i - 2]);
          if (highs[i] > sar) { bullish = true; sar = ep; ep = highs[i]; af = p.step; }
          else {
            if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + p.step, p.max); }
            markers.push({ time: candles[i].time, price: sar,
              position: 'atPriceTop', color: p.colorBear, shape: 'circle', size: 0.5 });
          }
        }
      }
      return [{ kind: 'markers', markers }];
    },
  });

  // ── Soportes y Resistencias ───────────────────────────────────────────────
  R.register({
    type: 'SR', label: 'Soportes y Resistencias', pane: 'main', group: 'Estructura',
    defaults: { tolerance: 0.015, minTouches: 2, lookback: 100,
                colorSupport: '#56A14F80', colorResist: '#D93B3B80' },
    fields: [
      { key: 'tolerance',    label: 'Tolerancia %',    type: 'number', min: 0.001, max: 0.05, step: 0.001 },
      { key: 'minTouches',   label: 'Toques mín.',     type: 'number', min: 2,     max: 10,   step: 1 },
      { key: 'lookback',     label: 'Velas a analizar',type: 'number', min: 20,    max: 500,  step: 10 },
      { key: 'colorSupport', label: 'Color soporte',   type: 'color' },
      { key: 'colorResist',  label: 'Color resist.',   type: 'color' },
    ],
    summary: () => 'S/R',
    calc: (candles, p) => {
      const n = candles.length;
      const start = Math.max(0, n - p.lookback);
      const slice = candles.slice(start);
      if (slice.length < 5) return [{ kind: 'pricelines', lines: [] }];

      // Detectar pivotes (máximos/mínimos locales en ventana de 5)
      const pivots = [];
      for (let i = 2; i < slice.length - 2; i++) {
        const h = slice[i].high, l = slice[i].low;
        const isHigh = h > slice[i-1].high && h > slice[i-2].high && h > slice[i+1].high && h > slice[i+2].high;
        const isLow  = l < slice[i-1].low  && l < slice[i-2].low  && l < slice[i+1].low  && l < slice[i+2].low;
        if (isHigh) pivots.push({ price: h, type: 'resist' });
        if (isLow)  pivots.push({ price: l, type: 'support' });
      }

      // Agrupar pivotes cercanos (dentro de tolerance)
      const zones = [];
      for (const piv of pivots) {
        let found = null;
        for (const z of zones) {
          if (Math.abs(z.price - piv.price) / z.price <= p.tolerance && z.type === piv.type) {
            found = z; break;
          }
        }
        if (found) { found.touches++; found.price = (found.price + piv.price) / 2; }
        else zones.push({ price: piv.price, type: piv.type, touches: 1 });
      }

      const lines = zones
        .filter((z) => z.touches >= p.minTouches)
        .map((z) => ({
          price: z.price,
          color: z.type === 'support' ? p.colorSupport : p.colorResist,
          title: z.type === 'support' ? 'S' : 'R',
        }));
      return [{ kind: 'pricelines', lines }];
    },
  });
})();
