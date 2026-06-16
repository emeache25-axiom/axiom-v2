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
    defaults: { step: 0.02, max: 0.2, pointSize: 0.25,
                colorBull: '#56A14F', colorBear: '#D93B3B' },
    fields: [
      { key: 'step',      label: 'Paso AF',       type: 'number', min: 0.001, max: 0.1, step: 0.001 },
      { key: 'max',       label: 'Máx AF',        type: 'number', min: 0.1,   max: 0.5, step: 0.01 },
      { key: 'pointSize', label: 'Tamaño puntos', type: 'range',  min: 0.05,  max: 2,   step: 0.05 },
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
              position: 'atPriceBottom', color: p.colorBull, shape: 'circle', size: p.pointSize || 0.5 });
          }
        } else {
          sar = Math.max(sar, highs[i - 1], highs[i - 2]);
          if (highs[i] > sar) { bullish = true; sar = ep; ep = highs[i]; af = p.step; }
          else {
            if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + p.step, p.max); }
            markers.push({ time: candles[i].time, price: sar,
              position: 'atPriceTop', color: p.colorBear, shape: 'circle', size: p.pointSize || 0.5 });
          }
        }
      }
      return [{ kind: 'markers', markers }];
    },
  });

  // ── Soportes y Resistencias ───────────────────────────────────────────────
  R.register({
    type: 'SR', label: 'Soportes y Resistencias', pane: 'main', group: 'Estructura',
    // Multi-timeframe: 3 horizontes detectados con ventanas de pivote distintas.
    // Largo plazo = ventana ancha (niveles mayores, los más fuertes).
    // Corto plazo = ventana angosta (niveles operativos inmediatos).
    // Los niveles se muestran exista el precio por arriba o por abajo: un nivel
    // de largo plazo sigue siendo válido aunque el precio lo haya cruzado.
    defaults: {
      tolerance: 0.012, minTouches: 2,
      // Ventana de pivote (velas a cada lado) por horizonte
      winLong: 25, winMid: 10, winShort: 4,
      // Cantidad de niveles a mostrar por horizonte
      countLong: 3, countMid: 4, countShort: 5,
      // Toggles de visibilidad por horizonte
      showLong: 'si', showMid: 'si', showShort: 'si',
      colorLong: '#D93B3B', colorMid: '#C9A84C', colorShort: '#2563EB',
    },
    fields: [
      { key: 'tolerance',  label: 'Tolerancia %',  type: 'number', min: 0.002, max: 0.05, step: 0.002 },
      { key: 'minTouches', label: 'Toques mín.',   type: 'number', min: 1, max: 10, step: 1 },
      { key: 'showLong',   label: 'Mostrar largo', type: 'select', options: [{ v: 'si', l: 'Sí' }, { v: 'no', l: 'No' }] },
      { key: 'winLong',    label: 'Ventana largo', type: 'number', min: 10, max: 60, step: 1 },
      { key: 'countLong',  label: 'Niveles largo', type: 'number', min: 0, max: 8, step: 1 },
      { key: 'showMid',    label: 'Mostrar medio', type: 'select', options: [{ v: 'si', l: 'Sí' }, { v: 'no', l: 'No' }] },
      { key: 'winMid',     label: 'Ventana medio', type: 'number', min: 5,  max: 30, step: 1 },
      { key: 'countMid',   label: 'Niveles medio', type: 'number', min: 0, max: 8, step: 1 },
      { key: 'showShort',  label: 'Mostrar corto', type: 'select', options: [{ v: 'si', l: 'Sí' }, { v: 'no', l: 'No' }] },
      { key: 'winShort',   label: 'Ventana corto', type: 'number', min: 2,  max: 15, step: 1 },
      { key: 'countShort', label: 'Niveles corto', type: 'number', min: 0, max: 8, step: 1 },
      { key: 'colorLong',  label: 'Color largo',   type: 'color' },
      { key: 'colorMid',   label: 'Color medio',   type: 'color' },
      { key: 'colorShort', label: 'Color corto',   type: 'color' },
    ],
    summary: () => 'S/R',
    calc: (candles, p) => {
      const n = candles.length;
      if (n < 10) return [{ kind: 'pricelines', lines: [] }];
      const price = candles[n - 1].close;
      const fmt = (v) => (Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(4));

      // Detecta niveles para un horizonte dado por su ventana de pivote.
      // Una vela es pivote-alto si su high supera el de las `win` velas a cada
      // lado; pivote-bajo análogo. Ventana grande → solo sobreviven los
      // extremos realmente significativos (niveles de largo plazo).
      const detect = (win) => {
        const raw = [];
        for (let i = win; i < n - win; i++) {
          const h = candles[i].high, l = candles[i].low;
          let isHigh = true, isLow = true;
          for (let j = i - win; j <= i + win; j++) {
            if (j === i) continue;
            if (candles[j].high >= h) isHigh = false;
            if (candles[j].low  <= l) isLow  = false;
            if (!isHigh && !isLow) break;
          }
          if (isHigh) raw.push(h);
          if (isLow)  raw.push(l);
        }
        // Agrupar por cercanía (tolerance), promediando y contando toques
        const zones = [];
        for (const pv of raw) {
          let f = null;
          for (const z of zones) {
            if (Math.abs(z.price - pv) / z.price <= p.tolerance) { f = z; break; }
          }
          if (f) { f.touches++; f.price = (f.price * (f.touches - 1) + pv) / f.touches; }
          else zones.push({ price: pv, touches: 1 });
        }
        return zones.filter((z) => z.touches >= p.minTouches);
      };

      // Construye las líneas de un horizonte: toma los `count` niveles más
      // cercanos al precio actual (combinando arriba y abajo), con etiqueta
      // neutra que incluye el precio.
      const build = (zones, count, color, tag) => {
        if (!count) return [];
        return zones
          .slice()
          .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))
          .slice(0, count)
          .map((z) => ({ price: z.price, color, title: `${tag} ${fmt(z.price)}` }));
      };

      // Largo primero (se dibujan todos juntos; el orden no afecta el render)
      const lines = [
        ...(p.showLong  !== 'no' ? build(detect(p.winLong),  p.countLong,  p.colorLong,  'LP') : []),
        ...(p.showMid   !== 'no' ? build(detect(p.winMid),   p.countMid,   p.colorMid,   'MP') : []),
        ...(p.showShort !== 'no' ? build(detect(p.winShort), p.countShort, p.colorShort, 'CP') : []),
      ];
      return [{ kind: 'pricelines', lines }];
    },
  });
})();
