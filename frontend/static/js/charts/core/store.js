/**
 * AXIOM v2 — Charts / Core / Store
 * ────────────────────────────────────────────────────────────────────────────
 * Estado central de la pantalla de gráficos + event bus simple (pub/sub).
 *
 * Por qué: los módulos (toolbar, indicadores, dibujos, engine) no deben
 * conocerse entre sí. Se comunican publicando/escuchando eventos en este bus.
 * Eso es lo que permite agregar un módulo nuevo sin tocar los demás.
 *
 * Eventos que circulan (convención de nombres "dominio:accion"):
 *   coin:changed        { coinId, name, symbol, image, exchange, exSymbol }
 *   timeframe:changed   { timeframe }
 *   candles:loaded      { candles }            (set completo recargado)
 *   candle:updated      { candle }             (tick en tiempo real)
 *   chart:recreated     { chart, series }      (chart nuevo creado)
 *   indicators:changed  { list }               (alta/baja/edición)
 *   drawings:changed    { list }
 *   tool:selected       { toolId | null }
 *   redraw:request      {}                      (forzar repintado de primitives)
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  window.AXIOM = window.AXIOM || {};
  window.AXIOM.Charts = window.AXIOM.Charts || {};

  class Store {
    constructor() {
      // ── Estado ──────────────────────────────────────────────────────────────
      this.coin = {
        id:       'bitcoin',
        name:     'Bitcoin',
        symbol:   'BTC',
        image:    null,
        exchange: null,
        exSymbol: null,
      };
      this.timeframe = '1d';
      this.candles   = [];          // velas actuales (ascendente por time)
      this.indicators = [];         // [{id, type, params, visible, style, ...}]
      this.drawings   = [];         // [{id, type, points, style, zIndex, locked}]
      this.activeTool = null;       // id de herramienta de dibujo activa

      // ── Event bus ─────────────────────────────────────────────────────────────
      this._listeners = {};         // { evento: [fn, ...] }
    }

    // ── Pub/Sub ───────────────────────────────────────────────────────────────
    on(event, fn) {
      (this._listeners[event] = this._listeners[event] || []).push(fn);
      return () => this.off(event, fn);   // devuelve unsubscribe
    }

    off(event, fn) {
      const arr = this._listeners[event];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }

    emit(event, payload) {
      const arr = this._listeners[event];
      if (!arr) return;
      // Copia defensiva por si un handler se desuscribe durante el emit
      for (const fn of arr.slice()) {
        try { fn(payload); }
        catch (e) { console.error(`[store] handler error en "${event}":`, e); }
      }
    }

    // ── Mutadores (emiten eventos) ──────────────────────────────────────────────
    setCoin(coin) {
      this.coin = Object.assign({}, this.coin, coin);
      this.emit('coin:changed', this.coin);
    }

    setTimeframe(tf) {
      this.timeframe = tf;
      this.emit('timeframe:changed', { timeframe: tf });
    }

    setCandles(candles) {
      this.candles = candles || [];
      this.emit('candles:loaded', { candles: this.candles });
    }

    updateCandle(candle) {
      // Reemplaza o agrega la última vela
      const n = this.candles.length;
      if (n && this.candles[n - 1].time === candle.time) {
        this.candles[n - 1] = candle;
      } else if (n && candle.time > this.candles[n - 1].time) {
        this.candles.push(candle);
      }
      this.emit('candle:updated', { candle });
    }

    setIndicators(list) {
      this.indicators = list || [];
      this.emit('indicators:changed', { list: this.indicators });
    }

    setDrawings(list) {
      this.drawings = list || [];
      this.emit('drawings:changed', { list: this.drawings });
    }

    setActiveTool(toolId) {
      this.activeTool = toolId;
      this.emit('tool:selected', { toolId });
    }

    requestRedraw() {
      this.emit('redraw:request', {});
    }
  }

  window.AXIOM.Charts.Store = new Store();
})();
