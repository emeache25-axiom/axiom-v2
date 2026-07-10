/**
 * AXIOM v2 — Price Service (fuente única de precio en vivo, vía WebSocket)
 * ────────────────────────────────────────────────────────────────────────────
 * Una sola fuente de precio para watchlist, panel lateral y header del gráfico.
 * Se conecta al WebSocket /api/prices/ws (empujado por el backend en tiempo real)
 * y reparte a los suscriptores. Todas las vistas muestran EXACTAMENTE el mismo
 * número porque leen el mismo estado.
 *
 * Interfaz pública (no cambia respecto a la versión polling):
 *   AXIOM.PriceService.subscribe(name, cb)   // cb recibe el mapa de precios
 *   AXIOM.PriceService.getPrice(exchange, pair)  // último precio, sincrónico
 *   AXIOM.PriceService.format(price, quote)
 *   AXIOM.PriceService.unsubscribe(name)
 *
 * El mapa de precios se indexa por "exchange:PAIR" (ej. "coinex:ONTBTC"), y
 * también se expone un índice por coin_id cuando esté disponible.
 * ──────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const NS = (window.AXIOM = window.AXIOM || {});

  const PriceService = {
    _prices:      {},      // { "exchange:PAIR": {...} }
    _byCoin:      {},      // { coin_id: {...} }  índice por coin para las vistas
    _subscribers: {},
    _ws:          null,
    _reconnect:   null,
    _backoff:     1000,

    subscribe(name, cb) {
      this._subscribers[name] = cb;
      if (Object.keys(this._byCoin).length) {
        try { cb(this._byCoin); } catch (e) {}
      }
      this._connect();
    },

    unsubscribe(name) {
      delete this._subscribers[name];
    },

    /** Último precio por coin_id (lo que usan las vistas). */
    getByCoin(coinId) {
      return coinId ? (this._byCoin[coinId] || null) : null;
    },

    /** Último precio por exchange+par. */
    getPrice(exchange, pairSymbol) {
      if (exchange && pairSymbol) {
        return this._prices[`${exchange}:${pairSymbol.toUpperCase()}`] || null;
      }
      return null;
    },

    /** Todo el mapa por coin_id. */
    getAllByCoin() { return this._byCoin; },

    _connect() {
      if (this._ws && (this._ws.readyState === 0 || this._ws.readyState === 1)) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${location.host}/api/prices/ws`;
      try {
        this._ws = new WebSocket(url);
      } catch (e) { this._scheduleReconnect(); return; }

      this._ws.onopen = () => { this._backoff = 1000; };
      this._ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'prices') {
            const map = {};
            const byCoin = {};
            (msg.prices || []).forEach((p) => {
              map[`${p.exchange}:${p.pair_symbol}`] = p;
              if (p.coin_id) byCoin[p.coin_id] = p;
            });
            this._prices = map;
            this._byCoin = byCoin;
            this._notify();
          }
        } catch (e) {}
      };
      this._ws.onclose = () => { this._scheduleReconnect(); };
      this._ws.onerror = () => { try { this._ws.close(); } catch (e) {} };
    },

    _scheduleReconnect() {
      if (this._reconnect) return;
      this._reconnect = setTimeout(() => {
        this._reconnect = null;
        this._backoff = Math.min(this._backoff * 2, 30000);
        this._connect();
      }, this._backoff);
    },

    _notify() {
      for (const name in this._subscribers) {
        try { this._subscribers[name](this._byCoin); } catch (e) {}
      }
    },

    format(price, quote) {
      if (price == null || price === 0) return '—';
      const q = (quote || 'USDT').toUpperCase();
      if (q !== 'USDT' && q !== 'USDC' && q !== 'USD') {
        const s = Number(price).toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
        return `${s} ${q}`;
      }
      if (price >= 1) return '$' + Number(price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return '$' + Number(price).toPrecision(4);
    },
  };

  NS.PriceService = PriceService;
})();
