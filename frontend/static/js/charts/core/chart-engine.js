/**
 * AXIOM v2 — Charts / Core / Engine
 * ────────────────────────────────────────────────────────────────────────────
 * Wrapper sobre Lightweight Charts v5.2. Responsabilidades:
 *   - Cargar la librería LWC (lazy)
 *   - Crear/destruir el chart y la serie de velas + volumen
 *   - Fetch de histórico (UDF) y paginación hacia atrás (scroll izquierda)
 *   - WebSocket de tiempo real (multiplexado en el backend)
 *   - Gestión de panes para indicadores en sub-paneles
 *
 * NO sabe de indicadores ni dibujos concretos: solo expone el chart/serie y
 * emite eventos por el Store. Los demás módulos reaccionan.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS = (window.AXIOM = window.AXIOM || {});
  NS.Charts = NS.Charts || {};
  const Store  = NS.Charts.Store;
  const Coords = NS.Charts.Coords;

  const LWC_URL = 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js';

  const THEME = {
    bg:       '#0F0E0D',
    text:     '#78716C',
    grid:     '#1A1917',
    border:   '#2C2926',
    up:       '#56A14F',
    down:     '#D93B3B',
  };

  const TF_SECONDS = {
    '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '4h': 14400, '1d': 86400,
    '1w': 604800, '1M': 2592000,
  };

  class Engine {
    constructor() {
      this._lwc          = null;
      this._chart        = null;
      this._candleSeries = null;
      this._volumeSeries = null;
      this._container    = null;
      this._resizeObs    = null;

      this._allCandles   = [];
      this._oldestTime   = null;
      this._loadingMore  = false;
      this._noMoreData   = false;

      this._ws           = null;
      this._wsTimer      = null;
      this._wsBackoff    = 1;

      this._panes        = {};   // { paneIndex: true } reservados por indicadores
    }

    get chart()        { return this._chart; }
    get series()       { return this._candleSeries; }
    get volumeSeries() { return this._volumeSeries; }
    get lwc()          { return this._lwc; }

    // ── Carga de librería ───────────────────────────────────────────────────────
    async loadLib() {
      if (window.LightweightCharts) { this._lwc = window.LightweightCharts; return; }
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = LWC_URL;
        s.onload = () => { this._lwc = window.LightweightCharts; res(); };
        s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    // ── Crear chart ─────────────────────────────────────────────────────────────
    createChart(container) {
      if (!this._lwc) throw new Error('LWC no cargado');
      this._container = container;
      this.destroyChart();

      this._chart = this._lwc.createChart(container, {
        layout: {
          background: { color: THEME.bg },
          textColor:  THEME.text,
          fontSize:   11,
          fontFamily: "'IBM Plex Mono', monospace",
          panes:      { enableResize: true, separatorColor: THEME.border, separatorHoverColor: '#3C3936' },
        },
        grid: {
          vertLines: { color: THEME.grid, style: 1 },
          horzLines: { color: THEME.grid, style: 1 },
        },
        crosshair: {
          mode: 0,  // 0 = Normal (libre); 1 = Magnet (se pega a velas/series)
          vertLine: { color: THEME.border, labelBackgroundColor: '#1A1917' },
          horzLine: { color: THEME.border, labelBackgroundColor: '#1A1917' },
        },
        rightPriceScale: { borderColor: THEME.border, scaleMargins: { top: 0.08, bottom: 0.25 } },
        timeScale: {
          borderColor: THEME.border, timeVisible: true, secondsVisible: false,
          rightOffset: 8, barSpacing: 8,
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale:  { mouseWheel: true, pinch: true },
      });

      this._candleSeries = this._chart.addSeries(this._lwc.CandlestickSeries, {
        upColor: THEME.up, downColor: THEME.down,
        borderUpColor: THEME.up, borderDownColor: THEME.down,
        wickUpColor: THEME.up, wickDownColor: THEME.down,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      }, 0);

      this._volumeSeries = this._chart.addSeries(this._lwc.HistogramSeries, {
        priceFormat: { type: 'volume' }, priceScaleId: 'volume',
      }, 0);
      this._chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

      // Vincular coords
      Coords.bind(this._chart, this._candleSeries);

      // Paginación al hacer scroll a la izquierda
      this._chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range || this._loadingMore || this._noMoreData) return;
        if (range.from < 10) this._loadMore();
      });

      // Resize
      this._resizeObs = new ResizeObserver(() => {
        if (this._chart && this._container) {
          this._chart.applyOptions({
            width: this._container.clientWidth,
            height: this._container.clientHeight,
          });
        }
      });
      this._resizeObs.observe(container);

      Store.emit('chart:recreated', { chart: this._chart, series: this._candleSeries });
      return this._chart;
    }

    destroyChart() {
      this._wsDisconnect();
      if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
      if (this._chart) { try { this._chart.remove(); } catch (e) {} this._chart = null; }
      this._candleSeries = null;
      this._volumeSeries = null;
      this._panes = {};
      this._allCandles = [];
      this._oldestTime = null;
      this._noMoreData = false;
    }

    // ── Gestión de panes (para indicadores en sub-paneles) ──────────────────────
    /**
     * Devuelve el índice donde crear un pane nuevo: el final de la lista real.
     * No llevamos contabilidad propia porque LWC compacta los índices al
     * remover panes intermedios y cualquier registro local se desincroniza.
     */
    allocPane() {
      try { return this._chart.panes().length; }
      catch (e) { return 1; }
    }

    /** LWC elimina automáticamente los panes que quedan vacíos. */
    freePane(idx) {}

    // ── Carga de datos ──────────────────────────────────────────────────────────
    async loadInitial(coinId, timeframe) {
      const data = await this._fetchHistory(coinId, timeframe, 0, 0, 500);
      const candles = data.candles || [];
      this._allCandles = candles;
      this._oldestTime = candles.length ? candles[0].time : null;
      this._noMoreData = false;

      // La respuesta de /history trae metadata del coin: la propagamos al Store
      // para que el WebSocket sepa el exchange y el header muestre nombre/símbolo.
      if (data.coin_id) {
        Store.setCoin({
          id:       data.coin_id,
          name:     data.name   || Store.coin.name,
          symbol:   data.symbol || Store.coin.symbol,
          image:    data.image  || null,
          exchange: data.exchange || null,
          exSymbol: data.ex_symbol || null,
        });
      }

      // Aplicar formato de precio según magnitud
      const lastPrice = candles.length ? candles[candles.length - 1].close : 0;
      this._candleSeries.applyOptions({ priceFormat: this._priceFormat(lastPrice) });

      this._candleSeries.setData(candles);
      this._volumeSeries.setData(candles.map((c) => ({
        time: c.time, value: c.volume,
        color: c.close >= c.open ? '#56A14F40' : '#D93B3B40',
      })));

      Coords.setCandles(candles);
      Store.setCandles(candles);
      return candles;
    }

    async _loadMore() {
      if (this._loadingMore || this._noMoreData || !this._oldestTime) return;
      this._loadingMore = true;
      try {
        const tf = Store.timeframe;
        const toTs = this._oldestTime - 1;
        const data = await this._fetchHistory(Store.coin.id, tf, 0, toTs, 500);
        const older = data.candles || [];
        if (!older.length) { this._noMoreData = true; return; }

        // Prepend evitando duplicados
        const existing = new Set(this._allCandles.map((c) => c.time));
        const merged = older.filter((c) => !existing.has(c.time)).concat(this._allCandles);
        this._allCandles = merged;
        this._oldestTime = merged[0].time;

        this._candleSeries.setData(merged);
        this._volumeSeries.setData(merged.map((c) => ({
          time: c.time, value: c.volume,
          color: c.close >= c.open ? '#56A14F40' : '#D93B3B40',
        })));

        Coords.setCandles(merged);
        Store.setCandles(merged);
      } catch (e) {
        console.warn('[engine] loadMore:', e);
      } finally {
        this._loadingMore = false;
      }
    }

    async _fetchHistory(coinId, timeframe, fromTs, toTs, limit = 500) {
      let url = `/api/charts/history?coin_id=${coinId}&timeframe=${timeframe}&limit=${limit}`;
      if (fromTs) url += `&from_ts=${fromTs}`;
      if (toTs)   url += `&to_ts=${toTs}`;
      // Enviar el par específico si el Store lo conoce (respeta /BTC vs /USDT)
      const ex  = Store.coin.exchange;
      const sym = Store.coin.exSymbol;
      if (ex  && ex !== 'coingecko') url += `&exchange=${encodeURIComponent(ex)}`;
      if (sym)                       url += `&ex_symbol=${encodeURIComponent(sym)}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }

    _priceFormat(price) {
      if (!price || price <= 0) return { type: 'price', precision: 2, minMove: 0.01 };
      if (price >= 1000)  return { type: 'price', precision: 2, minMove: 0.01 };
      if (price >= 10)    return { type: 'price', precision: 3, minMove: 0.001 };
      if (price >= 1)     return { type: 'price', precision: 4, minMove: 0.0001 };
      if (price >= 0.01)  return { type: 'price', precision: 5, minMove: 0.00001 };
      if (price >= 0.001) return { type: 'price', precision: 6, minMove: 0.000001 };
      return                { type: 'price', precision: 8, minMove: 0.00000001 };
    }

    // ── WebSocket tiempo real ─────────────────────────────────────────────────
    wsConnect() {
      this._wsDisconnect();
      const coin = Store.coin;
      if (!coin.exchange || coin.exchange === 'coingecko') return;

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${location.host}/api/charts/ws/${coin.id}?timeframe=${Store.timeframe}`;
      try {
        this._ws = new WebSocket(url);
      } catch (e) { return; }

      this._ws.onopen = () => { this._wsBackoff = 1; };
      this._ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          // El backend envía: heartbeat, fallback, o tick (datos en nivel raíz)
          if (msg.type === 'heartbeat') { this._ws.send('ping'); return; }
          if (msg.type === 'fallback')  return;
          if (msg.type === 'tick')      this._onTick(msg);
        } catch (e) {}
      };
      this._ws.onclose = () => { this._wsReconnect(); };
      this._ws.onerror = () => { try { this._ws.close(); } catch (e) {} };
    }

    _onTick(tick) {
      // El tick es de Binance kline_1m. Filtramos por símbolo porque el WS
      // multiplexado puede recibir ticks de otras coins suscritas.
      const exSym = (Store.coin.exSymbol || '').toUpperCase();
      if (tick.symbol && exSym && tick.symbol !== exSym) return;

      const n = this._allCandles.length;
      if (!n) return;
      const last = this._allCandles[n - 1];

      // Combinar el tick con la última vela del timeframe actual
      const updated = {
        time:  last.time,
        open:  last.open,
        high:  Math.max(last.high, tick.high),
        low:   Math.min(last.low,  tick.low),
        close: tick.close,
        volume: tick.volume != null ? tick.volume : last.volume,
      };
      try {
        this._candleSeries.update(updated);
        this._volumeSeries.update({
          time: updated.time, value: updated.volume,
          color: updated.close >= updated.open ? '#56A14F40' : '#D93B3B40',
        });
      } catch (e) {}

      this._allCandles[n - 1] = updated;
      Coords.setCandles(this._allCandles);
      Store.updateCandle(updated);
    }

    _wsReconnect() {
      if (this._wsTimer) return;
      const delay = Math.min(this._wsBackoff * 1000, 30000);
      this._wsTimer = setTimeout(() => {
        this._wsTimer = null;
        this._wsBackoff = Math.min(this._wsBackoff * 2, 32);
        this.wsConnect();
      }, delay);
    }

    _wsDisconnect() {
      if (this._wsTimer) { clearTimeout(this._wsTimer); this._wsTimer = null; }
      if (this._ws) { try { this._ws.close(); } catch (e) {} this._ws = null; }
    }

    tfSeconds(tf) { return TF_SECONDS[tf] || 86400; }
  }

  NS.Charts.Engine = new Engine();
  NS.Charts.THEME  = THEME;
})();
