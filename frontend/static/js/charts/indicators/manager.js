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

  class IndicatorManager {
    constructor() {
      this._active = [];   // indicadores activos (instancias)
    }

    init() {
      // Reaccionar a recarga de velas y ticks
      Store.on('candles:loaded', () => this._recalcAll());
      Store.on('candle:updated', () => this._recalcAll(true));
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
        const params = Object.assign({}, def.defaults, row.params || {});
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
      try { await NS.API.deleteIndicator(id); } catch (e) {}
      Store.setIndicators(this._active);
    }

    async updateParams(id, params) {
      const ind = this._active.find((i) => i.id === id);
      if (!ind) return;
      ind.params = Object.assign({}, ind.params, params);
      this._teardown(ind);
      this._build(ind);
      try { await NS.API.updateIndicator(id, { params: ind.params }); } catch (e) {}
      Store.setIndicators(this._active);
    }

    async toggleVisible(id) {
      const ind = this._active.find((i) => i.id === id);
      if (!ind) return;
      ind.visible = !ind.visible;
      if (ind.visible) this._build(ind); else this._teardown(ind);
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

      for (const spec of specs) {
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
    }

    _teardown(ind) {
      const chart = Engine.chart;
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

    // ── Recalcular (recarga de velas / tick) ────────────────────────────────────
    _recalcAll(isTick) {
      for (const ind of this._active) {
        if (!ind.visible) continue;
        // Rebuild simple: teardown + build. Para tick podríamos optimizar,
        // pero rebuild completo es seguro y el dataset es chico.
        this._teardown(ind);
        this._build(ind);
      }
    }
  }

  NS.IndicatorManager = new IndicatorManager();
})();
