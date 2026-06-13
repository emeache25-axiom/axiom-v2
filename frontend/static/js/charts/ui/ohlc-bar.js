/**
 * AXIOM v2 — Charts / UI / OHLC Bar
 * ────────────────────────────────────────────────────────────────────────────
 * Barra de valores O/H/L/C + variación de la vela bajo el crosshair (o la
 * última vela si no hay crosshair), estilo TradingView. Se inserta dentro del
 * pane principal vía getHTMLElement, arriba de la leyenda de indicadores.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS     = window.AXIOM.Charts;
  const Store  = NS.Store;
  const Engine = NS.Engine;
  const Geo    = NS.DrawingGeo;

  NS.OHLCBar = {
    _el: null,
    _crosshairTime: null,
    _unsubs: [],

    mount() {
      this._unsubs.forEach((u) => u());
      this._unsubs = [
        Store.on('candles:loaded', () => { this._ensure(); this._update(); }),
        Store.on('candle:updated', () => this._update()),
      ];
      if (Engine.chart) {
        Engine.chart.subscribeCrosshairMove((param) => {
          this._crosshairTime = (param && param.time) ? param.time : null;
          this._update();
        });
      }
      this._ensure();
      this._update();
    },

    /** Crea el contenedor dentro del pane principal si no existe. */
    _ensure() {
      document.querySelectorAll('.axiom-ohlc-bar').forEach((e) => e.remove());
      let pane0El = null;
      try { pane0El = Engine.chart.panes()[0].getHTMLElement(); } catch (e) {}
      if (!pane0El) { requestAnimationFrame(() => { this._ensure(); this._update(); }); return; }
      if (getComputedStyle(pane0El).position === 'static') pane0El.style.position = 'relative';

      const el = document.createElement('div');
      el.className = 'axiom-ohlc-bar';
      el.style.cssText = `position:absolute;top:6px;left:6px;z-index:16;pointer-events:none;
        font:11px 'IBM Plex Mono',monospace;color:#A8A29E;white-space:nowrap;
        display:flex;align-items:center;gap:10px;`;
      pane0El.appendChild(el);
      this._el = el;

      // Empujar la leyenda de indicadores hacia abajo para no solaparse
      this._offsetLegend(pane0El);
    },

    _offsetLegend(pane0El) {
      // La leyenda del pane 0 arranca en top:6px; si está, la bajamos.
      const lg = pane0El.querySelector('.axiom-pane-legend');
      if (lg) lg.style.top = '26px';
    },

    _update() {
      if (!this._el) return;
      const candles = Store.candles;
      if (!candles.length) { this._el.innerHTML = ''; return; }

      const time = this._crosshairTime;
      let idx = candles.length - 1;
      if (time) {
        const found = candles.findIndex((c) => c.time === time);
        if (found >= 0) idx = found;
      }
      const c = candles[idx];
      const prev = idx > 0 ? candles[idx - 1] : null;
      if (!c) return;

      const chg = prev ? c.close - prev.close : 0;
      const chgPct = prev && prev.close ? (chg / prev.close * 100) : 0;
      const up = chg >= 0;
      const col = up ? '#56A14F' : '#D93B3B';
      const f = (v) => Geo.fmtPrice(v);

      this._el.innerHTML = `
        <span>O<span style="color:${col};margin-left:3px;">${f(c.open)}</span></span>
        <span>H<span style="color:${col};margin-left:3px;">${f(c.high)}</span></span>
        <span>L<span style="color:${col};margin-left:3px;">${f(c.low)}</span></span>
        <span>C<span style="color:${col};margin-left:3px;">${f(c.close)}</span></span>
        <span style="color:${col};">${up ? '+' : ''}${f(chg)} (${up ? '+' : ''}${chgPct.toFixed(2)}%)</span>
      `;

      // Reasegurar el offset de la leyenda (puede haberse re-renderizado)
      try { this._offsetLegend(Engine.chart.panes()[0].getHTMLElement()); } catch (e) {}
    },
  };
})();
