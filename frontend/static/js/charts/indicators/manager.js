/**
 * AXIOM v2 — Charts / Indicators / Manager
 * ────────────────────────────────────────────────────────────────────────────
 * Toma las definiciones del registry + los specs que devuelve calc() y los
 * aplica al chart usando la API correcta de LWC según el kind:
 *   - line / histogram → addSeries + setData
 *   - markers          → createSeriesMarkers (PSAR)
 *   - pricelines       → createPriceLine (S/R)
 *
 * Maneja panes separados, actualización en tiempo real, y persistencia.
 * Un indicador activo se representa como:
 *   { id, type, params, visible, paneIndex, series:[], markersPlugin, priceLines:[] }
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS     = window.AXIOM.Charts;
  const Store  = NS.Store;
  const Engine = NS.Engine;
  const Reg    = NS.Indicators;

  /**
   * Primitive de relleno entre dos series de puntos (p.ej. bandas de Bollinger).
   * Se attacha a una serie del mismo pane y dibuja el polígono entre upper y
   * lower usando las coordenadas de esa serie — siempre sincronizado con LWC.
   */
  class BandPrimitive {
    constructor(upper, lower, color) {
      this._upper = upper || [];
      this._lower = lower || [];
      this._color = color || '#78716C20';
      this._chart = null;
      this._series = null;
      this._requestUpdate = null;
      const self = this;
      this._views = [{
        zOrder: () => 'bottom',
        renderer: () => ({
          draw(target) {
            target.useMediaCoordinateSpace((scope) => {
              const ctx = scope.context;
              const chart = self._chart, series = self._series;
              if (!chart || !series || self._upper.length < 2) return;
              const ts = chart.timeScale();
              ctx.save();
              ctx.beginPath();
              let started = false;
              for (const pt of self._upper) {
                const x = ts.timeToCoordinate(pt.time);
                const y = series.priceToCoordinate(pt.value);
                if (x == null || y == null) continue;
                if (!started) { ctx.moveTo(x, y); started = true; }
                else ctx.lineTo(x, y);
              }
              for (let i = self._lower.length - 1; i >= 0; i--) {
                const pt = self._lower[i];
                const x = ts.timeToCoordinate(pt.time);
                const y = series.priceToCoordinate(pt.value);
                if (x == null || y == null) continue;
                ctx.lineTo(x, y);
              }
              ctx.closePath();
              ctx.fillStyle = self._color;
              ctx.fill();
              ctx.restore();
            });
          },
        }),
      }];
    }
    attached({ chart, series, requestUpdate }) {
      this._chart = chart; this._series = series; this._requestUpdate = requestUpdate;
    }
    detached() { this._chart = null; this._series = null; this._requestUpdate = null; }
    paneViews() { return this._views; }
    updateAllViews() {}
    setData(upper, lower, color) {
      this._upper = upper || [];
      this._lower = lower || [];
      if (color) this._color = color;
      this._requestUpdate && this._requestUpdate();
    }
  }

  class IndicatorManager {
    constructor() {
      this._active = [];   // indicadores activos (instancias)
    }

    init() {
      // Recarga completa de velas → rebuild total (cambia coin/timeframe)
      Store.on('candles:loaded', () => this._recalcAll());
      // Tick en tiempo real → update incremental (NO rebuild: preserva panes,
      // alturas y es muchísimo más liviano)
      Store.on('candle:updated', () => this._updateLast());
    }

    get active() { return this._active; }

    // ── Carga desde DB ────────────────────────────────────────────────────────
    async loadFromDB() {
      // Limpiar lo que haya
      for (const ind of this._active.slice()) this._teardown(ind);
      this._active = [];

      let rows = [];
      try {
        const data = await NS.API.getIndicators();
        rows = data.indicators || [];
      } catch (e) { console.warn('[ind] loadFromDB', e); }

      for (const row of rows) {
        const def = Reg.get(row.type);
        if (!def) continue;
        // asyncpg puede devolver jsonb como string: parsear antes de mergear,
        // si no Object.assign ignora los params guardados y quedan defaults.
        let saved = row.params || {};
        if (typeof saved === 'string') {
          try { saved = JSON.parse(saved); } catch (e) { saved = {}; }
        }
        const params = Object.assign({}, def.defaults, saved);
        const ind = {
          id: row.id, type: row.type, params,
          visible: row.visible !== false,
          paneIndex: 0, series: [], markersPlugin: null, priceLines: [],
        };
        this._active.push(ind);
        if (ind.visible) this._build(ind);
      }
      Store.setIndicators(this._active);
    }

    // ── Alta / baja / edición ───────────────────────────────────────────────────
    async add(type, params) {
      const def = Reg.get(type);
      if (!def) return null;
      const merged = Object.assign({}, def.defaults, params || {});
      let id = Date.now();
      try {
        const res = await NS.API.saveIndicator({
          type, params: merged, timeframes: [], visible: true,
          position: def.pane, style: {},
        });
        id = res.id;
      } catch (e) {}
      const ind = { id, type, params: merged, visible: true,
        paneIndex: 0, series: [], markersPlugin: null, priceLines: [] };
      this._active.push(ind);
      this._build(ind);
      Store.setIndicators(this._active);
      return ind;
    }

    async remove(id) {
      const ind = this._active.find((i) => i.id === id);
      if (!ind) return;
      this._teardown(ind);
      this._active = this._active.filter((i) => i.id !== id);
      this._syncPaneIndexes();   // LWC compacta índices al remover panes
      try { await NS.API.deleteIndicator(id); } catch (e) {}
      Store.setIndicators(this._active);
    }

    /**
     * Re-lee el índice real del pane de cada indicador desde su serie.
     * Necesario porque LWC compacta los índices cuando un pane intermedio
     * desaparece, y nuestro paneIndex guardado queda obsoleto.
     */
    _syncPaneIndexes() {
      for (const ind of this._active) {
        if (!ind.series.length) continue;
        try {
          const pane = ind.series[0].getPane();
          if (pane && typeof pane.paneIndex === 'function') {
            ind.paneIndex = pane.paneIndex();
          }
        } catch (e) {}
      }
    }

    async updateParams(id, params) {
      const ind = this._active.find((i) => i.id === id);
      if (!ind) return;
      ind.params = Object.assign({}, ind.params, params);
      this._rebuildInPlace(ind);
      try { await NS.API.updateIndicator(id, { params: ind.params }); } catch (e) {}
      Store.setIndicators(this._active);
    }

    /**
     * Rebuild sin destruir el pane: crea las series nuevas ANTES de remover
     * las viejas, así el pane nunca queda vacío y LWC conserva su altura.
     */
    _rebuildInPlace(ind) {
      const def = Reg.get(ind.type);
      const chart = Engine.chart, lwc = Engine.lwc;
      if (!def || !chart || !lwc) return;
      const candles = Store.candles;
      if (candles.length < 3) return;

      let specs;
      try { specs = def.calc(candles, ind.params); } catch (e) { return; }
      if (!specs || !specs.length) return;

      const oldSeries     = ind.series.slice();
      const oldMarkers    = ind.markersPlugin;
      const oldPriceLines = ind.priceLines.slice();
      const oldBand       = ind.bandPrimitive;
      const oldBandHost   = oldSeries[0] || null;
      ind.series = []; ind.markersPlugin = null; ind.priceLines = []; ind.bandPrimitive = null;

      // Crear lo nuevo en el MISMO paneIndex
      let bandSpec = null;
      for (const spec of specs) {
        if (spec.kind === 'band') { bandSpec = spec; continue; }
        if (spec.kind === 'markers') {
          if (lwc.createSeriesMarkers) {
            ind.markersPlugin = lwc.createSeriesMarkers(Engine.series, this._toMarkers(spec.markers));
          }
        } else if (spec.kind === 'pricelines') {
          for (const ln of spec.lines) {
            const pl = Engine.series.createPriceLine({
              price: ln.price, color: ln.color, lineWidth: 1, lineStyle: 2,
              axisLabelVisible: true, title: ln.title || '',
            });
            ind.priceLines.push(pl);
          }
        } else {
          const seriesType = spec.kind === 'histogram' ? lwc.HistogramSeries : lwc.LineSeries;
          const opts = spec.kind === 'histogram'
            ? { color: spec.color, priceFormat: { type: 'price' } }
            : { color: spec.color, lineWidth: spec.lineWidth || 1.5,
                lineStyle: spec.lineStyle || 0, priceLineVisible: false, lastValueVisible: false };
          const series = chart.addSeries(seriesType, opts, ind.paneIndex);
          series.setData(spec.data || []);
          ind.series.push(series);
        }
      }

      // Sombreado nuevo en la primera serie nueva
      if (bandSpec && ind.series.length) {
        ind.bandPrimitive = new BandPrimitive(bandSpec.upper, bandSpec.lower, bandSpec.color);
        try { ind.series[0].attachPrimitive(ind.bandPrimitive); } catch (e) { ind.bandPrimitive = null; }
      }

      // Recién ahora remover lo viejo (el pane nunca quedó vacío)
      if (oldBand && oldBandHost) { try { oldBandHost.detachPrimitive(oldBand); } catch (e) {} }
      for (const s of oldSeries) { try { chart.removeSeries(s); } catch (e) {} }
      if (oldMarkers) { try { oldMarkers.setMarkers([]); } catch (e) {} }
      for (const pl of oldPriceLines) { try { Engine.series.removePriceLine(pl); } catch (e) {} }
    }

    async toggleVisible(id) {
      const ind = this._active.find((i) => i.id === id);
      if (!ind) return;
      ind.visible = !ind.visible;
      if (ind.visible) this._build(ind); else this._teardown(ind);
      this._syncPaneIndexes();
      try { await NS.API.updateIndicator(id, { visible: ind.visible }); } catch (e) {}
      Store.setIndicators(this._active);
    }

    // ── Construcción de series en el chart ──────────────────────────────────────
    _build(ind) {
      const def = Reg.get(ind.type);
      const chart = Engine.chart, lwc = Engine.lwc;
      if (!def || !chart || !lwc) return;
      const candles = Store.candles;
      if (candles.length < 3) return;

      let specs;
      try { specs = def.calc(candles, ind.params); } catch (e) { console.warn('[ind] calc', ind.type, e); return; }
      if (!specs || !specs.length) return;

      // Pane: separado o principal
      ind.paneIndex = def.pane === 'separate' ? Engine.allocPane() : 0;

      let bandSpec = null;
      for (const spec of specs) {
        if (spec.kind === 'band') { bandSpec = spec; continue; }
        if (spec.kind === 'markers') {
          if (lwc.createSeriesMarkers) {
            ind.markersPlugin = lwc.createSeriesMarkers(Engine.series, this._toMarkers(spec.markers));
          }
        } else if (spec.kind === 'pricelines') {
          for (const ln of spec.lines) {
            const pl = Engine.series.createPriceLine({
              price: ln.price, color: ln.color, lineWidth: 1, lineStyle: 2,
              axisLabelVisible: true, title: ln.title || '',
            });
            ind.priceLines.push(pl);
          }
        } else {
          // line / histogram
          const seriesType = spec.kind === 'histogram' ? lwc.HistogramSeries : lwc.LineSeries;
          const opts = spec.kind === 'histogram'
            ? { color: spec.color, priceFormat: { type: 'price' } }
            : { color: spec.color, lineWidth: spec.lineWidth || 1.5,
                lineStyle: spec.lineStyle || 0, priceLineVisible: false, lastValueVisible: false };
          const series = chart.addSeries(seriesType, opts, ind.paneIndex);
          series.setData(spec.data || []);
          ind.series.push(series);
        }
      }

      // Sombreado (band): attachar a la primera serie de línea del indicador
      if (bandSpec && ind.series.length) {
        ind.bandPrimitive = new BandPrimitive(bandSpec.upper, bandSpec.lower, bandSpec.color);
        try { ind.series[0].attachPrimitive(ind.bandPrimitive); } catch (e) { ind.bandPrimitive = null; }
      }
    }

    _teardown(ind) {
      const chart = Engine.chart;
      if (ind.bandPrimitive && ind.series.length) {
        try { ind.series[0].detachPrimitive(ind.bandPrimitive); } catch (e) {}
        ind.bandPrimitive = null;
      }
      for (const s of ind.series) { try { chart.removeSeries(s); } catch (e) {} }
      ind.series = [];
      if (ind.markersPlugin) { try { ind.markersPlugin.setMarkers([]); } catch (e) {} ind.markersPlugin = null; }
      for (const pl of ind.priceLines) { try { Engine.series.removePriceLine(pl); } catch (e) {} }
      ind.priceLines = [];
      if (ind.paneIndex > 0) { Engine.freePane(ind.paneIndex); ind.paneIndex = 0; }
    }

    _toMarkers(markers) {
      return (markers || []).map((m) => ({
        time: m.time, position: m.position, color: m.color,
        shape: m.shape || 'circle', size: m.size || 0.5, price: m.price,
      })).sort((a, b) => a.time - b.time);
    }

    // ── Recalcular (recarga completa de velas: cambio de coin/timeframe) ────────
    _recalcAll() {
      for (const ind of this._active) {
        if (!ind.visible) continue;
        this._teardown(ind);
        this._build(ind);
      }
    }

    // ── Update incremental (tick): solo el último punto, sin destruir nada ──────
    _updateLast() {
      const candles = Store.candles;
      if (candles.length < 3) return;
      for (const ind of this._active) {
        if (!ind.visible) continue;
        const def = Reg.get(ind.type);
        if (!def) continue;

        // PSAR y S/R: recalcular es barato pero su render usa plugins;
        // solo el PSAR necesita refrescar markers (S/R no cambia con un tick).
        if (ind.markersPlugin) {
          try {
            const specs = def.calc(candles, ind.params);
            const mSpec = specs.find((s) => s.kind === 'markers');
            if (mSpec) ind.markersPlugin.setMarkers(this._toMarkers(mSpec.markers));
          } catch (e) {}
          continue;
        }
        if (ind.priceLines.length) continue;   // S/R: skip en ticks

        // Series de línea/histograma: update() del último punto por serie
        if (!ind.series.length) continue;
        try {
          const specs = def.calc(candles, ind.params);
          let si = 0;
          for (const spec of specs) {
            if (spec.kind === 'markers' || spec.kind === 'pricelines') continue;
            if (spec.kind === 'band') {
              if (ind.bandPrimitive) ind.bandPrimitive.setData(spec.upper, spec.lower, spec.color);
              continue;
            }
            const series = ind.series[si++];
            if (!series || !spec.data || !spec.data.length) continue;
            const last = spec.data[spec.data.length - 1];
            series.update(last);
          }
        } catch (e) {}
      }
    }
  }

  NS.IndicatorManager = new IndicatorManager();
})();
