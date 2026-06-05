/**
 * AXIOM v2 — Charts Screen
 * LWC v5.2 + UDF lazy loading + WebSocket real-time
 */
const ChartsScreen = {

  coinId:       'bitcoin',
  coinName:     'Bitcoin',
  coinSymbol:   'BTC',
  coinImage:    null,
  coinExchange: null,
  coinExSymbol: null,
  timeframe:    '1d',

  chart:        null,
  candleSeries: null,
  volumeSeries: null,
  _lwc:         null,
  _searchTimeout:   null,
  _resizeObserver:  null,
  _ws:              null,
  _wsState:         'disconnected',
  _wsReconnectTimer:null,
  _wsBackoff:       1,
  _wsSymbol:        null,
  _oldestTime:      null,
  _loadingMore:     false,
  _allCandles:      [],
  _configTarget:    null,

  TIMEFRAMES: ['5m','15m','30m','1h','4h','1d','1w','1M'],

  // ── Ciclo de vida ──────────────────────────────────────────────────────────
  async onEnter() {
    const el = document.getElementById('screen-charts');
    if (!el.querySelector('.charts-shell')) {
      el.innerHTML = this._renderShell();
    }
    await this._initLWC();
    const state = await API.getChartState().catch(() => null);
    if (state?.coin_id) {
      this.coinId    = state.coin_id;
      this.timeframe = state.timeframe || '1d';
    }
    this._updateTimeframeButtons();
    await this._loadChart();
  },

  onLeave() {
    this._wsDisconnect();
    this._destroyChart();
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
  },

  // ── LWC ───────────────────────────────────────────────────────────────────
  async _initLWC() {
    if (window.LightweightCharts) { this._lwc = window.LightweightCharts; return; }
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js';
      s.onload = () => { this._lwc = window.LightweightCharts; res(); };
      s.onerror = rej;
      document.head.appendChild(s);
    });
  },

  // ── Chart ─────────────────────────────────────────────────────────────────
  _createChart() {
    const container = document.getElementById('chart-container');
    if (!container || !this._lwc) return;
    this._destroyChart();

    this.chart = this._lwc.createChart(container, {
      layout: { background:{color:'#0F0E0D'}, textColor:'#78716C', fontSize:11,
                fontFamily:"'IBM Plex Mono', monospace",
                panes:{ enableResize:true, separatorColor:'#2C2926', separatorHoverColor:'#3C3936' } },
      rightPriceScale: { borderVisible:true, borderColor:'#2C2926' },
      grid:   { vertLines:{color:'#1A1917',style:1}, horzLines:{color:'#1A1917',style:1} },
      crosshair: { mode:1,
        vertLine:{color:'#2C2926',labelBackgroundColor:'#1A1917'},
        horzLine:{color:'#2C2926',labelBackgroundColor:'#1A1917'} },
      rightPriceScale: { borderColor:'#2C2926', scaleMargins:{top:0.08,bottom:0.25} },
      timeScale: { borderColor:'#2C2926', timeVisible:true, secondsVisible:false,
                   rightOffset:8, barSpacing:8 },
      handleScroll: {mouseWheel:true,pressedMouseMove:true},
      handleScale:  {mouseWheel:true,pinch:true},
    });

    this.candleSeries = this.chart.addSeries(this._lwc.CandlestickSeries, {
      upColor:'#56A14F', downColor:'#D93B3B',
      borderUpColor:'#56A14F', borderDownColor:'#D93B3B',
      wickUpColor:'#56A14F', wickDownColor:'#D93B3B',
      priceFormat:{type:'price',precision:2,minMove:0.01},
    }, 0);

    this.volumeSeries = this.chart.addSeries(this._lwc.HistogramSeries, {
      priceFormat:{type:'volume'}, priceScaleId:'volume',
    }, 0);
    this.chart.priceScale('volume').applyOptions({scaleMargins:{top:0.82,bottom:0}});

    this.chart.subscribeCrosshairMove(p => this._onCrosshairMove(p));

    // Init DrawingManager
    const chartContainer = document.getElementById('chart-container')?.parentElement;
    if (chartContainer) {
      DrawingManager.init(this.chart, this._lwc, chartContainer, this.coinId, this.timeframe, this.candleSeries);
      DrawingManager.renderToolbar();
    }

    this.chart.timeScale().subscribeVisibleLogicalRangeChange(r => {
      if (r && r.from < 10) this._loadMore();
    });

    this._resizeObserver = new ResizeObserver(() => {
      const c = document.getElementById('chart-container');
      if (c && this.chart) {
        this.chart.resize(c.clientWidth, c.clientHeight);
        // Re-renderizar overlays cuando cambia el tamaño (incluyendo resize de panes)
        IndicatorManager._scheduleOverlayRender();
      }
    });
    this._resizeObserver.observe(container);

    // Reposicionar overlays solo al soltar el mouse después de resize de pane
    this._paneMouseUpHandler = function() {
      IndicatorManager._scheduleOverlayRender();
    };
    container.addEventListener('mouseup', this._paneMouseUpHandler);
  },

  _destroyChart() {
    DrawingManager.destroy();
    if (this._paneResizeObserver) { this._paneResizeObserver.disconnect(); this._paneResizeObserver = null; }
    const container = document.getElementById('chart-container');
    if (container && this._paneMouseUpHandler) {
      container.removeEventListener('mouseup', this._paneMouseUpHandler);
      this._paneMouseUpHandler = null;
    }
    if (this.chart) { this.chart.remove(); this.chart = null; }
    this.candleSeries = null;
    this.volumeSeries = null;
    this._oldestTime  = null;
    this._loadingMore = false;
  },

  // ── Carga ─────────────────────────────────────────────────────────────────
  async _loadChart() {
    this._setLoading(true);
    this._allCandles = [];
    this._oldestTime = null;
    try {
      const data = await this._fetchHistory(null, null, 500);
      if (!data || data.no_data) { this._showNoData(data?.message || 'Sin datos'); return; }
      this.coinName    = data.name;
      this.coinSymbol  = data.symbol;
      this.coinImage   = data.image;
      this.coinExchange = data.exchange;
      this.coinExSymbol = data.ex_symbol;
      this._updateHeader(data);

      // 1. Limpiar series e indicadores del chart anterior
      if (this.chart) {
        IndicatorManager._clearAll();
      }

      // 2. Crear chart si no existe
      if (!this.chart) this._createChart();

      // 3. Init IndicatorManager con chart actual
      IndicatorManager.init(this.chart, this._lwc, this.candleSeries);

      // 4. Setear velas nuevas
      this._setCandles(data.candles);

      // 5. Mostrar últimas 100 velas + autoescala
      try {
        const total = this._allCandles.length;
        const visible = Math.min(100, total);
        this.chart.timeScale().setVisibleLogicalRange({
          from: total - visible,
          to:   total + 8,
        });
        this.chart.priceScale('right').applyOptions({autoScale:true});
      } catch(e) { this.chart.timeScale().fitContent(); }

      const last = this._allCandles[this._allCandles.length - 1];
      if (last) this._updateInfoBar(last);

      // 6. Cargar indicadores y dibujos con las nuevas velas ya cargadas
      await IndicatorManager.loadFromDB(this.timeframe);
      await DrawingManager.loadFromDB(this.coinId, this.timeframe);
      this._wsConnect();
    } catch(e) {
      console.error('[charts]', e);
      this._showError(e.message);
    } finally {
      this._setLoading(false);
    }
  },

  async _loadMore() {
    if (this._loadingMore || !this._oldestTime) return;
    this._loadingMore = true;
    this._setLoadingMore(true);
    try {
      const data = await this._fetchHistory(null, this._oldestTime - 1, 500);
      if (!data || !data.candles.length) return;
      const seen = new Set();
      const merged = [...data.candles, ...this._allCandles].filter(c => {
        if (seen.has(c.time)) return false;
        seen.add(c.time); return true;
      }).sort((a,b) => a.time - b.time);
      this._setCandles(merged);
    } catch(e) { console.warn('[charts] loadMore:', e); }
    finally { this._loadingMore = false; this._setLoadingMore(false); }
  },

  _setCandles(candles) {
    if (!candles.length || !this.candleSeries) return;
    this._allCandles = candles;
    this._oldestTime = candles[0].time;
    const last = candles[candles.length - 1]?.close || 0;
    this.candleSeries.applyOptions({priceFormat: this._priceFormat(last)});
    this.candleSeries.setData(candles.map(c => ({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close})));
    this.volumeSeries.setData(candles.map(c => ({
      time:c.time, value:c.volume,
      color: c.close >= c.open ? '#56A14F40' : '#D93B3B40',
    })));
    IndicatorManager.setCandles(candles);
  },

  async _fetchHistory(fromTs, toTs, limit=500) {
    let url = '/api/charts/history?coin_id=' + this.coinId + '&timeframe=' + this.timeframe + '&limit=' + limit;
    if (fromTs) url += '&from_ts=' + fromTs;
    if (toTs)   url += '&to_ts='   + toTs;
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  },

  // ── Price format ──────────────────────────────────────────────────────────
  _priceFormat(price) {
    if (!price || price <= 0) return {type:'price',precision:2,minMove:0.01};
    if (price >= 1000)  return {type:'price',precision:2, minMove:0.01};
    if (price >= 10)    return {type:'price',precision:3, minMove:0.001};
    if (price >= 1)     return {type:'price',precision:4, minMove:0.0001};
    if (price >= 0.1)   return {type:'price',precision:4, minMove:0.0001};
    if (price >= 0.01)  return {type:'price',precision:5, minMove:0.00001};
    if (price >= 0.001) return {type:'price',precision:6, minMove:0.000001};
    return               {type:'price',precision:8, minMove:0.00000001};
  },

  // ── WebSocket ─────────────────────────────────────────────────────────────
  _wsConnect() {
    this._wsDisconnect();
    if (!this.coinExchange || this.coinExchange === 'coingecko') {
      this._updateWsStatus('no_ws'); return;
    }
    this._wsState = 'connecting';
    this._updateWsStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url   = proto + '://' + location.host + '/api/charts/ws/' + this.coinId + '?timeframe=' + this.timeframe;
    try {
      this._ws = new WebSocket(url);
      this._ws.onopen = () => {
        this._wsState = 'connected'; this._wsBackoff = 1;
        this._updateWsStatus('connected');
      };
      this._ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'heartbeat') { this._ws.send('ping'); return; }
          if (msg.type === 'fallback')  { this._updateWsStatus('no_ws'); return; }
          if (msg.type === 'tick')      this._onTick(msg);
        } catch(e) {}
      };
      this._ws.onclose = () => {
        this._wsState = 'disconnected';
        this._updateWsStatus('disconnected');
        const delay = Math.min(this._wsBackoff * 1000, 60000);
        this._wsBackoff = Math.min(this._wsBackoff * 2, 60);
        this._wsReconnectTimer = setTimeout(() => { if (this.coinId) this._wsConnect(); }, delay);
      };
      this._ws.onerror = () => {};
    } catch(e) { this._updateWsStatus('no_ws'); }
  },

  _wsDisconnect() {
    if (this._wsReconnectTimer) { clearTimeout(this._wsReconnectTimer); this._wsReconnectTimer = null; }
    if (this._ws) { this._ws.onclose = null; this._ws.close(); this._ws = null; }
    this._wsState = 'disconnected';
  },

  _onTick(tick) {
    if (!this.candleSeries || !this.volumeSeries) return;
    if (tick.symbol !== this.coinExSymbol?.toUpperCase()) return;
    const candles = this._allCandles;
    if (!candles.length) return;
    const last = candles[candles.length - 1];
    const updated = {
      time:  last.time,
      open:  last.open,
      high:  Math.max(last.high, tick.high),
      low:   Math.min(last.low,  tick.low),
      close: tick.close,
    };
    this.candleSeries.update(updated);
    this.volumeSeries.update({
      time: last.time, value: last.volume,
      color: updated.close >= updated.open ? '#56A14F40' : '#D93B3B40',
    });
    this._updatePrice(tick.close);
    candles[candles.length - 1] = Object.assign({}, last, updated);
    // Actualizar indicadores en tiempo real
    IndicatorManager.updateLastCandle(updated);
  },

  // ── Crosshair ─────────────────────────────────────────────────────────────
  _onCrosshairMove(param) {
    if (!param.time || !this.candleSeries) return;
    const c = param.seriesData.get(this.candleSeries);
    if (c) this._updateInfoBar(c);
  },

  _updateInfoBar(c) {
    const el = document.getElementById('chart-info-bar');
    if (!el) return;
    const color  = c.close >= c.open ? '#56A14F' : '#D93B3B';
    const change = c.open > 0 ? ((c.close - c.open) / c.open * 100) : 0;
    const fmt = n => {
      if (n == null) return '—';
      if (n >= 1000) return n.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});
      if (n >= 10)   return n.toLocaleString('es-AR',{minimumFractionDigits:3,maximumFractionDigits:3});
      if (n >= 1)    return n.toFixed(4);
      if (n >= 0.01) return n.toFixed(5);
      return n.toPrecision(8);
    };
    el.innerHTML =
      '<span style="font-family:var(--f2);font-size:11px;color:var(--t3);">O <span style="color:var(--t1);">' + fmt(c.open) + '</span></span>' +
      '<span style="font-family:var(--f2);font-size:11px;color:var(--t3);">H <span style="color:#56A14F;">' + fmt(c.high) + '</span></span>' +
      '<span style="font-family:var(--f2);font-size:11px;color:var(--t3);">L <span style="color:#D93B3B;">' + fmt(c.low)  + '</span></span>' +
      '<span style="font-family:var(--f2);font-size:11px;color:var(--t3);">C <span style="color:var(--t1);">' + fmt(c.close) + '</span></span>' +
      '<span style="font-family:var(--f2);font-size:11px;font-weight:600;color:' + color + ';">' + (change >= 0 ? '+' : '') + change.toFixed(2) + '%</span>';
  },

  // ── Búsqueda ──────────────────────────────────────────────────────────────
  _onSearchInput(q) {
    clearTimeout(this._searchTimeout);
    const dd = document.getElementById('chart-search-dd');
    if (!dd) return;
    if (q.length < 2) { dd.style.display = 'none'; return; }
    this._searchTimeout = setTimeout(async () => {
      const data = await API.searchCoins(q, 8);
      if (!data.results.length) { dd.style.display = 'none'; return; }
      let html = '';
      for (const c of data.results) {
        html += '<div onclick="ChartsScreen._selectCoin(\'' + c.id + '\',\'' + c.name.replace(/'/g,"\\'") + '\',\'' + c.symbol + '\')"';
        html += ' style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-bottom:0.5px solid var(--w1);"';
        html += ' onmouseover="this.style.background=\'var(--c2)\'" onmouseout="this.style.background=\'transparent\'">';
        if (c.image) html += '<img src="' + c.image + '" style="width:22px;height:22px;border-radius:50%;">';
        html += '<span style="font-size:13px;color:var(--t1);font-weight:500;">' + c.name + '</span>';
        html += '<span style="font-family:var(--f2);font-size:10px;color:var(--t3);margin-left:4px;">' + c.symbol + '</span>';
        if (c.rank) html += '<span style="font-family:var(--f2);font-size:10px;color:var(--t4);margin-left:auto;">#' + c.rank + '</span>';
        html += '</div>';
      }
      dd.innerHTML = html;
      dd.style.display = 'block';
    }, 250);
  },

  async _selectCoin(coinId, name, symbol) {
    this.coinId = coinId; this.coinName = name; this.coinSymbol = symbol;
    const inp = document.getElementById('chart-search-input');
    const dd  = document.getElementById('chart-search-dd');
    if (inp) inp.value = name + ' (' + symbol + ')';
    if (dd)  dd.style.display = 'none';
    await this._loadChart();
  },

  // ── Timeframe ─────────────────────────────────────────────────────────────
  async _setTimeframe(tf) {
    this.timeframe = tf;
    this._updateTimeframeButtons();
    this._wsDisconnect();
    await this._loadChart();
  },

  _updateTimeframeButtons() {
    this.TIMEFRAMES.forEach(tf => {
      const btn = document.getElementById('chart-tf-' + tf);
      if (!btn) return;
      const active = tf === this.timeframe;
      btn.style.background  = active ? 'var(--cy)' : 'transparent';
      btn.style.color       = active ? '#0F0E0D'   : 'var(--t3)';
      btn.style.borderColor = active ? 'var(--cy)' : 'transparent';
      btn.style.fontWeight  = active ? '600'       : '400';
    });
  },

  // ── Header ────────────────────────────────────────────────────────────────
  _updateHeader(data) {
    const n = id => document.getElementById(id);
    if (n('chart-coin-name'))  n('chart-coin-name').textContent = data.name + ' · ' + data.symbol;
    if (n('chart-coin-img') && data.image) { n('chart-coin-img').src = data.image; n('chart-coin-img').style.display = 'block'; }
    if (n('chart-exchange-badge')) n('chart-exchange-badge').textContent = (data.exchange || '').toUpperCase();
    if (data.price) this._updatePrice(data.price);
    if (data.change_24h != null) {
      const el = n('chart-coin-chg');
      if (el) { el.textContent = (data.change_24h >= 0 ? '+' : '') + data.change_24h.toFixed(2) + '%'; el.style.color = data.change_24h >= 0 ? '#56A14F' : '#D93B3B'; }
    }
  },

  _updatePrice(price) {
    const el = document.getElementById('chart-coin-price');
    if (!el || !price) return;
    let txt;
    if      (price >= 1000) txt = '$' + price.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});
    else if (price >= 10)   txt = '$' + price.toFixed(3);
    else if (price >= 1)    txt = '$' + price.toFixed(4);
    else if (price >= 0.01) txt = '$' + price.toFixed(5);
    else                    txt = '$' + price.toPrecision(8);
    el.textContent = txt;
  },

  // ── WS status ─────────────────────────────────────────────────────────────
  _updateWsStatus(state) {
    const el = document.getElementById('chart-ws-status');
    if (!el) return;
    const map = {
      connecting:   ['#B47514','ti-refresh','Conectando...'],
      connected:    ['#56A14F','ti-wifi','En vivo'],
      disconnected: ['#D93B3B','ti-wifi-off','Reconectando'],
      no_ws:        ['#78716C','ti-clock','Polling'],
    };
    const [color, icon, label] = map[state] || map.disconnected;
    el.innerHTML = '<i class="ti ' + icon + '" style="font-size:11px;color:' + color + ';"></i>' +
                   '<span style="font-family:var(--f2);font-size:10px;color:' + color + ';">' + label + '</span>';
  },

  // ── Loading ───────────────────────────────────────────────────────────────
  _setLoading(on) {
    const el = document.getElementById('chart-loading');
    if (el) el.style.display = on ? 'flex' : 'none';
  },
  _setLoadingMore(on) {
    const el = document.getElementById('chart-loading-more');
    if (el) el.style.display = on ? 'flex' : 'none';
  },
  _showError(msg) {
    const el = document.getElementById('chart-loading');
    if (!el) return;
    el.style.display = 'flex';
    el.innerHTML = '<div style="text-align:center;"><i class="ti ti-alert-circle" style="font-size:28px;color:var(--re);display:block;margin-bottom:8px;"></i><div style="color:var(--re);font-size:13px;">' + msg + '</div></div>';
  },
  _showNoData(msg) {
    const el = document.getElementById('chart-loading');
    if (!el) return;
    el.style.display = 'flex';
    el.innerHTML = '<div style="text-align:center;"><i class="ti ti-chart-off" style="font-size:28px;color:var(--t4);display:block;margin-bottom:8px;"></i><div style="color:var(--t3);font-size:13px;">' + msg + '</div></div>';
  },

  // ── Modal indicadores ─────────────────────────────────────────────────────
  _openIndicatorsModal(tab, indId) {
    tab   = tab   || 'browse';
    indId = indId || null;
    const modal = document.getElementById('chart-ind-modal');
    if (!modal) return;
    this._renderBrowseList();
    modal.style.display = 'flex';
    if (tab === 'config' && indId) {
      const ind = IndicatorManager.getActive().find(function(i){ return i.id===indId; });
      if (ind) { this._showConfigPanel(ind.id, ind.type, ind.params); return; }
    }
    this._switchIndTab(tab);
    modal.onclick = (e) => { if (e.target === modal) this._closeIndicatorsModal(); };
  },

  _closeIndicatorsModal() {
    const modal = document.getElementById('chart-ind-modal');
    if (modal) modal.style.display = 'none';
  },

  _renderBrowseList() {
    const el = document.getElementById('ind-browse-list');
    if (!el) return;
    let html = '';
    const groups = IndicatorRegistry.groups();
    for (const group in groups) {
      const types = groups[group];
      html += '<div style="padding:6px 0;">';
      html += '<div style="padding:8px 16px 4px;font-family:var(--f2);font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#57534E;">' + group + '</div>';
      for (let ti = 0; ti < types.length; ti++) {
        const type = types[ti];
        const def  = IndicatorRegistry.get(type);
        if (!def) continue;
        const icon     = def.pane === 'main' ? 'trending-up' : 'wave-square';
        const bgBadge  = def.pane === 'main' ? '#1D3A6E' : '#3D2E10';
        const clBadge  = def.pane === 'main' ? '#3B82F6' : '#B47514';
        const lbBadge  = def.pane === 'main' ? 'Principal' : 'Panel';
        html += '<div class="ind-browse-item" data-type="' + type + '"';
        html += ' onclick="ChartsScreen._selectIndicator(\'' + type + '\')"';
        html += ' style="display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;transition:background .1s;"';
        html += ' onmouseover="this.style.background=\'#1F1E1C\'" onmouseout="this.style.background=\'transparent\'">';
        html += '<div style="width:32px;height:32px;border-radius:6px;background:#2C2926;display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
        html += '<i class="ti ti-' + icon + '" style="font-size:15px;color:#A8A29E;"></i></div>';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="font-size:13px;font-weight:500;color:#F5F0EB;">' + def.name + '</div>';
        html += '<div style="font-size:11px;color:#78716C;margin-top:1px;">' + def.label + '</div></div>';
        html += '<span style="font-family:var(--f2);font-size:9px;padding:2px 6px;border-radius:3px;flex-shrink:0;background:' + bgBadge + ';color:' + clBadge + ';">' + lbBadge + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }
    el.innerHTML = html;
  },

  _filterIndicators(q) {
    document.querySelectorAll('.ind-browse-item').forEach(function(item) {
      const def  = IndicatorRegistry.get(item.dataset.type || '');
      const text = ((def ? def.name : '') + ' ' + (def ? def.label : '')).toLowerCase();
      item.style.display = text.includes(q.toLowerCase()) ? 'flex' : 'none';
    });
  },

  _switchIndTab(tab) {
    ['browse','active','config'].forEach(function(t) {
      const btn   = document.getElementById('ind-tab-' + t);
      const panel = document.getElementById('ind-panel-' + t);
      const isActive = t === tab;
      if (btn) {
        btn.style.color             = isActive ? 'var(--cy)' : '#78716C';
        btn.style.fontWeight        = isActive ? '500' : '400';
        btn.style.borderBottomColor = isActive ? 'var(--cy)' : 'transparent';
      }
      if (panel) panel.style.display = isActive ? 'block' : 'none';
    });
    if (tab === 'active') this._renderActiveList();
  },

  _selectIndicator(type) {
    const def = IndicatorRegistry.get(type);
    if (!def) return;
    this._showConfigPanel(null, type, Object.assign({}, def.defaults));
  },

  _showConfigPanel(id, type, params) {
    const def = IndicatorRegistry.get(type);
    if (!def) return;
    this._configTarget = {id: id, type: type, params: Object.assign({}, params)};
    const el = document.getElementById('ind-config-content');
    if (!el) return;
    const backTab = id ? 'active' : 'browse';

    let fieldsHtml = '';
    for (let fi = 0; fi < def.fields.length; fi++) {
      const f = def.fields[fi];
      const val = params[f.key] !== undefined ? params[f.key] : '';
      fieldsHtml += '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px;">';
      fieldsHtml += '<label style="font-size:12px;color:#A8A29E;">' + f.label + '</label>';
      if (f.type === 'color') {
        fieldsHtml += '<div style="display:flex;align-items:center;gap:8px;">';
        fieldsHtml += '<div id="cfg-swatch-' + f.key + '" style="width:32px;height:24px;border-radius:4px;border:0.5px solid #2C2926;cursor:pointer;background:' + val + ';" onclick="document.getElementById(\'cfg-' + f.key + '\').click()"></div>';
        fieldsHtml += '<input type="color" id="cfg-' + f.key + '" value="' + val + '" style="position:absolute;opacity:0;width:0;height:0;" oninput="document.getElementById(\'cfg-swatch-' + f.key + '\').style.background=this.value;document.getElementById(\'cfg-hex-' + f.key + '\').value=this.value;">';
        fieldsHtml += '<input type="text" id="cfg-hex-' + f.key + '" value="' + val + '" maxlength="7" style="width:72px;padding:4px 8px;border:0.5px solid #2C2926;border-radius:4px;background:#0F0E0D;color:#F5F0EB;font-family:var(--f2);font-size:11px;" oninput="if(/^#[0-9A-Fa-f]{6}$/.test(this.value)){document.getElementById(\'cfg-' + f.key + '\').value=this.value;document.getElementById(\'cfg-swatch-' + f.key + '\').style.background=this.value;}">';
        fieldsHtml += '</div>';
      } else {
        fieldsHtml += '<input type="number" id="cfg-' + f.key + '" value="' + val + '"';
        if (f.min !== undefined) fieldsHtml += ' min="' + f.min + '"';
        if (f.max !== undefined) fieldsHtml += ' max="' + f.max + '"';
        if (f.step !== undefined) fieldsHtml += ' step="' + f.step + '"';
        fieldsHtml += ' style="width:80px;padding:5px 8px;border:0.5px solid #2C2926;border-radius:4px;background:#0F0E0D;color:#F5F0EB;font-size:12px;text-align:right;">';
      }
      fieldsHtml += '</div>';
    }

    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">' +
        '<button onclick="ChartsScreen._switchIndTab(\'' + backTab + '\')" style="border:none;background:#2C2926;color:#A8A29E;width:28px;height:28px;border-radius:6px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">←</button>' +
        '<div><div style="font-size:14px;font-weight:600;color:#F5F0EB;">' + def.label + '</div>' +
        '<div style="font-family:var(--f2);font-size:10px;color:#78716C;margin-top:1px;">' + (id ? 'Editar configuración' : 'Configurar y agregar') + '</div></div>' +
      '</div>' +
      fieldsHtml +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;padding-top:16px;border-top:0.5px solid #2C2926;">' +
        '<button onclick="ChartsScreen._switchIndTab(\'' + backTab + '\')" style="padding:7px 16px;border-radius:6px;border:0.5px solid #2C2926;background:transparent;color:#A8A29E;font-size:12px;cursor:pointer;">Cancelar</button>' +
        '<button onclick="ChartsScreen._saveIndicatorConfig()" style="padding:7px 16px;border-radius:6px;border:none;background:var(--cy);color:#0F0E0D;font-size:12px;font-weight:600;cursor:pointer;">' + (id ? 'Guardar' : 'Agregar') + '</button>' +
      '</div>';

    this._switchIndTab('config');
  },

  async _saveIndicatorConfig() {
    if (!this._configTarget) return;
    const id   = this._configTarget.id;
    const type = this._configTarget.type;
    const def  = IndicatorRegistry.get(type);
    if (!def) return;
    const params = {};
    for (let fi = 0; fi < def.fields.length; fi++) {
      const f  = def.fields[fi];
      const key = f.type === 'color' ? ('cfg-hex-' + f.key) : ('cfg-' + f.key);
      const el  = document.getElementById(key) || document.getElementById('cfg-' + f.key);
      if (!el) continue;
      params[f.key] = f.type === 'number' ? parseFloat(el.value) : el.value;
    }
    if (id) {
      await IndicatorManager.updateParams(id, params);
    } else {
      await IndicatorManager.add(type, params);
    }
    this._updateIndCount();
    this._switchIndTab('active');
  },

  _renderActiveList() {
    const el = document.getElementById('ind-active-list');
    if (!el) return;
    const active = IndicatorManager.getActive();
    if (!active.length) {
      el.innerHTML = '<div style="padding:32px;text-align:center;color:#57534E;font-size:13px;"><i class="ti ti-activity" style="font-size:28px;display:block;margin-bottom:8px;"></i>Sin indicadores activos</div>';
      return;
    }
    let html = '';
    for (let i = 0; i < active.length; i++) {
      const ind   = active[i];
      const def   = IndicatorRegistry.get(ind.type);
      const summ  = def ? def.summary(ind.params) : ind.type;
      const color = ind.params.color || ind.params.colorLine || ind.params.colorMACD || ind.params.colorMid || '#78716C';
      const prm   = JSON.stringify(ind.params).replace(/"/g, "'");
      html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;transition:background .1s;" onmouseover="this.style.background=\'#1F1E1C\'" onmouseout="this.style.background=\'transparent\'">';
      html += '<div style="width:10px;height:10px;border-radius:2px;flex-shrink:0;background:' + color + ';"></div>';
      html += '<div style="flex:1;min-width:0;"><div style="font-size:13px;color:#F5F0EB;">' + summ + '</div><div style="font-family:var(--f2);font-size:10px;color:#78716C;">' + (def ? def.label : '') + '</div></div>';
      html += '<div style="display:flex;gap:2px;">';
      html += '<button onclick="ChartsScreen._showConfigPanel(' + ind.id + ',\'' + ind.type + '\',' + prm + ')" title="Configurar" style="border:none;background:transparent;color:#57534E;cursor:pointer;font-size:14px;padding:4px 5px;border-radius:4px;transition:all .1s;" onmouseover="this.style.color=\'#F5F0EB\';this.style.background=\'#2C2926\'" onmouseout="this.style.color=\'#57534E\';this.style.background=\'transparent\'"><i class="ti ti-settings"></i></button>';
      html += '<button onclick="ChartsScreen._toggleIndicator(' + ind.id + ')" title="' + (ind.visible ? 'Ocultar' : 'Mostrar') + '" style="border:none;background:transparent;cursor:pointer;font-size:14px;padding:4px 5px;border-radius:4px;transition:all .1s;color:' + (ind.visible ? '#A8A29E' : '#57534E') + ';" onmouseover="this.style.color=\'#F5F0EB\';this.style.background=\'#2C2926\'" onmouseout="this.style.background=\'transparent\'"><i class="ti ti-eye' + (ind.visible ? '' : '-off') + '"></i></button>';
      html += '<button onclick="ChartsScreen._removeIndicator(' + ind.id + ')" title="Eliminar" style="border:none;background:transparent;color:#57534E;cursor:pointer;font-size:14px;padding:4px 5px;border-radius:4px;transition:all .1s;" onmouseover="this.style.color=\'#ef4444\';this.style.background=\'#2C2926\'" onmouseout="this.style.color=\'#57534E\';this.style.background=\'transparent\'"><i class="ti ti-trash"></i></button>';
      html += '</div></div>';
    }
    el.innerHTML = html;
    const cnt = document.getElementById('ind-active-count');
    if (cnt) cnt.textContent = active.length;
  },

  async _toggleIndicator(id) {
    await IndicatorManager.toggleVisible(id);
    this._renderActiveList();
    this._updateIndCount();
  },

  async _removeIndicator(id) {
    await IndicatorManager.remove(id);
    this._renderActiveList();
    this._updateIndCount();
  },

  _updateIndCount() {
    const count = IndicatorManager.getActive().filter(function(i){ return i.visible; }).length;
    const el    = document.getElementById('chart-ind-count');
    if (!el) return;
    el.textContent   = count;
    el.style.display = count > 0 ? 'inline' : 'none';
  },

  // ── Shell ─────────────────────────────────────────────────────────────────
  _renderShell() {
    let tfBtns = '';
    for (let i = 0; i < this.TIMEFRAMES.length; i++) {
      const tf = this.TIMEFRAMES[i];
      tfBtns += '<button id="chart-tf-' + tf + '" onclick="ChartsScreen._setTimeframe(\'' + tf + '\')"';
      tfBtns += ' style="padding:4px 8px;border-radius:4px;border:0.5px solid transparent;background:transparent;color:var(--t3);font-size:11px;font-family:var(--f2);cursor:pointer;transition:all .15s;">' + tf + '</button>';
    }

    return '<div class="charts-shell">' +

      '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding-bottom:10px;border-bottom:0.5px solid var(--w1);margin-bottom:10px;">' +

        '<div style="position:relative;">' +
          '<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border:0.5px solid var(--w1);border-radius:var(--radius-s);background:var(--c2);min-width:180px;">' +
            '<i class="ti ti-search" style="font-size:12px;color:var(--t3);flex-shrink:0;"></i>' +
            '<input id="chart-search-input" type="text" placeholder="Buscar coin..." oninput="ChartsScreen._onSearchInput(this.value)" onfocus="this.select()" style="border:none;background:transparent;color:var(--t1);font-size:12px;outline:none;width:100%;">' +
          '</div>' +
          '<div id="chart-search-dd" style="display:none;position:absolute;top:calc(100% + 4px);left:0;min-width:260px;background:var(--c1);border:0.5px solid var(--w1);border-radius:var(--radius-s);z-index:200;box-shadow:0 8px 32px rgba(0,0,0,.5);overflow:hidden;max-height:320px;overflow-y:auto;"></div>' +
        '</div>' +

        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<img id="chart-coin-img" src="" alt="" style="display:none;width:26px;height:26px;border-radius:50%;">' +
          '<div>' +
            '<div id="chart-coin-name" style="font-size:13px;font-weight:600;color:var(--t1);line-height:1.2;">Bitcoin · BTC</div>' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
              '<span id="chart-coin-price" style="font-family:var(--f2);font-size:11px;color:var(--t2);"></span>' +
              '<span id="chart-coin-chg"   style="font-family:var(--f2);font-size:11px;font-weight:600;"></span>' +
              '<span id="chart-exchange-badge" style="font-family:var(--f2);font-size:9px;color:var(--t4);border:0.5px solid var(--w1);border-radius:3px;padding:1px 4px;"></span>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div style="width:1px;height:24px;background:var(--w1);"></div>' +
        '<div style="display:flex;align-items:center;gap:2px;">' + tfBtns + '</div>' +
        '<div style="width:1px;height:24px;background:var(--w1);"></div>' +

        '<button onclick="ChartsScreen._openIndicatorsModal()" style="display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:var(--radius-s);border:0.5px solid var(--w1);background:transparent;color:var(--t3);font-size:12px;cursor:pointer;transition:all .15s;" onmouseover="this.style.borderColor=\'var(--cy)\';this.style.color=\'var(--cy)\'" onmouseout="this.style.borderColor=\'var(--w1)\';this.style.color=\'var(--t3)\'">' +
          '<i class="ti ti-activity" style="font-size:13px;"></i> Indicadores' +
          '<span id="chart-ind-count" style="background:var(--cy);color:#0F0E0D;border-radius:10px;padding:1px 5px;font-size:10px;font-weight:700;display:none;">0</span>' +
        '</button>' +

        '<div id="chart-ws-status" style="display:flex;align-items:center;gap:4px;">' +
          '<i class="ti ti-wifi-off" style="font-size:11px;color:var(--t4);"></i>' +
          '<span style="font-family:var(--f2);font-size:10px;color:var(--t4);">—</span>' +
        '</div>' +

        '<div id="chart-info-bar" style="display:flex;align-items:center;gap:8px;margin-left:4px;flex-wrap:wrap;"></div>' +

      '</div>' +

      '<div style="position:relative;flex:1;min-height:0;display:flex;border:0.5px solid var(--w1);border-radius:var(--radius-s);overflow:hidden;background:#0F0E0D;">' +
        '<div id="chart-drawing-toolbar" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 3px;background:#0F0E0D;border-right:0.5px solid #1A1917;z-index:30;flex-shrink:0;"></div>' +
        '<div style="position:relative;flex:1;min-height:0;">' +
        '<div id="chart-container" style="width:100%;height:100%;"></div>' +
        '<div id="chart-ind-overlays" style="position:absolute;inset:0;pointer-events:none;z-index:15;"></div>' +
        '<div id="chart-info-bar" style="position:absolute;top:8px;left:8px;z-index:5;display:flex;align-items:center;gap:8px;flex-wrap:wrap;pointer-events:none;"></div>' +
        '<div id="chart-loading" style="display:flex;position:absolute;inset:0;background:rgba(15,14,13,.85);align-items:center;justify-content:center;z-index:10;">' +
          '<div style="text-align:center;"><i class="ti ti-refresh" style="font-size:24px;color:var(--cy);display:block;margin-bottom:8px;animation:spin 1s linear infinite;"></i><div style="font-size:12px;color:var(--t3);">Cargando...</div></div>' +
        '</div>' +
        '<div id="chart-loading-more" style="display:none;position:absolute;top:8px;left:8px;background:rgba(26,25,23,.9);border:0.5px solid var(--w1);border-radius:4px;padding:4px 10px;z-index:5;align-items:center;gap:6px;">' +
          '<i class="ti ti-refresh" style="font-size:11px;color:var(--cy);animation:spin 1s linear infinite;"></i>' +
          '<span style="font-family:var(--f2);font-size:10px;color:var(--t3);">Cargando histórico...</span>' +
        '</div>' +
      '</div>' +   // cierre div relativo inner
      '</div>' +

      '<div id="chart-ind-modal" style="display:none;position:fixed;inset:0;z-index:600;background:rgba(0,0,0,.6);backdrop-filter:blur(3px);align-items:flex-start;justify-content:center;padding-top:48px;">' +
        '<div style="background:#1A1917;border:0.5px solid #2C2926;border-radius:12px;width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 96px);display:flex;flex-direction:column;box-shadow:0 32px 80px rgba(0,0,0,.7);">' +

          '<div style="padding:14px 16px;border-bottom:0.5px solid #2C2926;flex-shrink:0;">' +
            '<div style="display:flex;align-items:center;gap:10px;">' +
              '<div style="display:flex;align-items:center;gap:8px;flex:1;background:#0F0E0D;border:0.5px solid #2C2926;border-radius:6px;padding:7px 10px;">' +
                '<i class="ti ti-search" style="font-size:13px;color:#78716C;flex-shrink:0;"></i>' +
                '<input id="ind-search" type="text" placeholder="Buscar indicador..." oninput="ChartsScreen._filterIndicators(this.value)" style="border:none;background:transparent;color:#F5F0EB;font-size:13px;outline:none;flex:1;">' +
              '</div>' +
              '<button onclick="ChartsScreen._closeIndicatorsModal()" style="border:none;background:#2C2926;color:#78716C;width:30px;height:30px;border-radius:50%;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;" onmouseover="this.style.background=\'#3C3936\'" onmouseout="this.style.background=\'#2C2926\'">✕</button>' +
            '</div>' +
          '</div>' +

          '<div style="display:flex;border-bottom:0.5px solid #2C2926;flex-shrink:0;padding:0 4px;">' +
            '<button id="ind-tab-browse" onclick="ChartsScreen._switchIndTab(\'browse\')" style="padding:10px 14px;border:none;background:transparent;font-size:12px;color:var(--cy);font-weight:500;cursor:pointer;border-bottom:2px solid var(--cy);margin-bottom:-1px;">Indicadores</button>' +
            '<button id="ind-tab-active" onclick="ChartsScreen._switchIndTab(\'active\')" style="padding:10px 14px;border:none;background:transparent;font-size:12px;color:#78716C;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;">Activos <span id="ind-active-count" style="background:#2C2926;color:#A8A29E;border-radius:10px;padding:1px 6px;font-size:10px;margin-left:4px;">0</span></button>' +
          '</div>' +

          '<div id="ind-panel-browse" style="overflow-y:auto;flex:1;"><div id="ind-browse-list"></div></div>' +
          '<div id="ind-panel-active" style="display:none;overflow-y:auto;flex:1;"><div id="ind-active-list" style="padding:8px 0;"></div></div>' +
          '<div id="ind-panel-config" style="display:none;overflow-y:auto;flex:1;"><div id="ind-config-content" style="padding:16px;"></div></div>' +

        '</div>' +
      '</div>' +

      '<style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>' +

    '</div>';
  },
};
