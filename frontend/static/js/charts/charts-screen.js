/**
 * AXIOM v2 — Charts / Screen (Orquestador)
 * ────────────────────────────────────────────────────────────────────────────
 * Punto de entrada de la pantalla de gráficos. Arma el shell HTML, inicializa
 * el engine, los managers (indicadores, dibujos) y la UI (toolbar, modales),
 * y maneja el ciclo de vida onEnter/onLeave del router de AXIOM.
 *
 * Es el ÚNICO que conoce a todos los módulos; los demás se comunican por el
 * Store. Para agregar un indicador o herramienta nueva NO se toca este archivo.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS     = window.AXIOM.Charts;
  const Store  = NS.Store;
  const Engine = NS.Engine;
  const API    = NS.API;

  const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];

  const ChartsScreen = {
    _booted: false,
    _searchTimer: null,

    async onEnter() {
      const el = document.getElementById('screen-charts');
      if (!el.querySelector('.charts-shell')) el.innerHTML = this._shell();

      await Engine.loadLib();

      // Inicializar managers una sola vez
      if (!this._booted) {
        NS.IndicatorManager.init();
        NS.IndicatorsModal.mount();
        this._booted = true;
      }

      // Estado inicial (último coin/timeframe)
      const state = await API.getChartState().catch(() => null);
      if (state && state.coin_id) {
        Store.setCoin({ id: state.coin_id });
        Store.setTimeframe(state.timeframe || '1d');
      }
      this._updateTfButtons();

      await this._loadChart();
    },

    onLeave() {
      NS.IndicatorManager.flushPaneHeights();
      NS.DrawingManager.destroy();
      Engine.destroyChart();
    },

    // ── Carga / recarga del chart ───────────────────────────────────────────────
    async _loadChart() {
      this._setLoading(true);
      try {
        // Persistir alturas de pane antes de destruir el chart actual
        NS.IndicatorManager.flushPaneHeights();
        // Destruir y recrear (cambio de coin/timeframe)
        NS.DrawingManager.destroy();
        const container = document.getElementById('chart-container');
        Engine.createChart(container);

        await Engine.loadInitial(Store.coin.id, Store.timeframe);

        // Montar toolbar (necesita el primitive ya disponible)
        NS.DrawingManager.init();
        NS.Toolbar.mount('chart-drawing-toolbar');

        // Cargar indicadores (globales) y dibujos (por coin)
        await NS.IndicatorManager.loadFromDB();
        await NS.DrawingManager.loadFromDB(Store.coin.id);

        // Montar leyenda de indicadores (por pane) y barra OHLC
        NS.Legend.mount();
        NS.OHLCBar.mount();

        Engine.wsConnect();
        this._updateHeader();
      } catch (e) {
        console.error('[charts]', e);
        this._showError(e.message);
      } finally {
        this._setLoading(false);
      }
    },

    // ── Acciones de UI ────────────────────────────────────────────────────────────
    async _setTimeframe(tf) {
      if (tf === Store.timeframe) return;
      Store.setTimeframe(tf);
      this._updateTfButtons();
      await this._loadChart();
    },

    async _selectCoin(coinId, name, symbol, image, exchange, exSymbol) {
      Store.setCoin({ id: coinId, name, symbol, image, exchange, exSymbol });
      document.getElementById('chart-search-dd').style.display = 'none';
      document.getElementById('chart-search-input').value = '';
      await this._loadChart();
    },

    _onSearchInput(q) {
      clearTimeout(this._searchTimer);
      const dd = document.getElementById('chart-search-dd');
      if (!q || q.length < 2) { dd.style.display = 'none'; return; }
      this._searchTimer = setTimeout(async () => {
        try {
          const data = await API.searchCoins(q);
          const results = data.results || data.coins || [];
          if (!results.length) { dd.style.display = 'none'; return; }
          dd.innerHTML = results.map((c) => `
            <div class="chart-search-item" data-id="${c.id}" data-name="${c.name}" data-sym="${c.symbol}"
              style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;border-bottom:0.5px solid #1A1917;">
              ${c.image ? `<img src="${c.image}" style="width:18px;height:18px;border-radius:50%;">` : ''}
              <span style="font-size:12px;color:#F5F0EB;">${c.name}</span>
              <span style="font-size:10px;color:#78716C;">${(c.symbol || '').toUpperCase()}</span>
            </div>`).join('');
          dd.style.display = 'block';
          dd.querySelectorAll('.chart-search-item').forEach((item) => {
            item.onclick = () => this._selectCoin(item.dataset.id, item.dataset.name, item.dataset.sym);
            item.onmouseover = () => item.style.background = '#2C2926';
            item.onmouseout  = () => item.style.background = 'transparent';
          });
        } catch (e) { dd.style.display = 'none'; }
      }, 250);
    },

    _openIndicatorsModal() { NS.IndicatorsModal.open(); },

    // ── Header / estado ────────────────────────────────────────────────────────────
    _updateHeader() {
      const c = Store.candles;
      const last = c.length ? c[c.length - 1] : null;
      const nameEl = document.getElementById('chart-coin-name');
      if (nameEl) nameEl.textContent = `${Store.coin.name || Store.coin.id} · ${(Store.coin.symbol || '').toUpperCase()}`;
      if (last) {
        const priceEl = document.getElementById('chart-coin-price');
        if (priceEl) priceEl.textContent = NS.DrawingGeo.fmtPrice(last.close);
      }
    },

    _updateTfButtons() {
      for (const tf of TIMEFRAMES) {
        const b = document.getElementById('chart-tf-' + tf);
        if (!b) continue;
        const on = tf === Store.timeframe;
        b.style.background = on ? '#1D3A6E' : 'transparent';
        b.style.color = on ? '#3B82F6' : '#78716C';
        b.style.borderColor = on ? '#2563EB' : 'transparent';
      }
    },

    _setLoading(v) {
      const el = document.getElementById('chart-loading');
      if (el) el.style.display = v ? 'flex' : 'none';
    },

    _showError(msg) {
      const el = document.getElementById('chart-loading');
      if (el) {
        el.style.display = 'flex';
        el.innerHTML = `<div style="text-align:center;"><i class="ti ti-alert-circle" style="font-size:28px;color:#D93B3B;display:block;margin-bottom:8px;"></i><div style="color:#D93B3B;font-size:13px;">${msg}</div></div>`;
      }
    },

    // ── Shell HTML ───────────────────────────────────────────────────────────────
    _shell() {
      let tfBtns = '';
      for (const tf of TIMEFRAMES) {
        tfBtns += `<button id="chart-tf-${tf}" onclick="AXIOM.Charts.Screen._setTimeframe('${tf}')"
          style="padding:4px 8px;border-radius:4px;border:0.5px solid transparent;background:transparent;color:#78716C;font-size:11px;font-family:'IBM Plex Mono',monospace;cursor:pointer;transition:all .15s;">${tf}</button>`;
      }
      return `<div class="charts-shell" style="display:flex;flex-direction:column;height:100%;">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding-bottom:10px;border-bottom:0.5px solid #2C2926;margin-bottom:10px;">
          <div style="position:relative;">
            <div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border:0.5px solid #2C2926;border-radius:6px;background:#1A1917;min-width:180px;">
              <i class="ti ti-search" style="font-size:12px;color:#78716C;"></i>
              <input id="chart-search-input" type="text" placeholder="Buscar coin..." oninput="AXIOM.Charts.Screen._onSearchInput(this.value)" onfocus="this.select()" style="border:none;background:transparent;color:#F5F0EB;font-size:12px;outline:none;width:100%;">
            </div>
            <div id="chart-search-dd" style="display:none;position:absolute;top:calc(100% + 4px);left:0;min-width:260px;background:#0F0E0D;border:0.5px solid #2C2926;border-radius:6px;z-index:200;box-shadow:0 8px 32px rgba(0,0,0,.5);max-height:320px;overflow-y:auto;"></div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <img id="chart-coin-img" src="" alt="" style="display:none;width:26px;height:26px;border-radius:50%;">
            <div>
              <div id="chart-coin-name" style="font-size:13px;font-weight:600;color:#F5F0EB;line-height:1.2;">Bitcoin · BTC</div>
              <div style="display:flex;align-items:center;gap:6px;">
                <span id="chart-coin-price" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#A8A29E;"></span>
              </div>
            </div>
          </div>
          <div style="width:1px;height:24px;background:#2C2926;"></div>
          <div style="display:flex;align-items:center;gap:2px;">${tfBtns}</div>
          <div style="width:1px;height:24px;background:#2C2926;"></div>
          <button onclick="AXIOM.Charts.Screen._openIndicatorsModal()" style="display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:6px;border:0.5px solid #2C2926;background:transparent;color:#78716C;font-size:12px;cursor:pointer;">
            <i class="ti ti-activity" style="font-size:13px;"></i> Indicadores
            <span id="chart-ind-count" style="background:#C9A84C;color:#0F0E0D;border-radius:10px;padding:1px 5px;font-size:10px;font-weight:700;display:none;">0</span>
          </button>
        </div>
        <div style="position:relative;flex:1;min-height:0;display:flex;border:0.5px solid #2C2926;border-radius:6px;overflow:hidden;background:#0F0E0D;">
          <div id="chart-drawing-toolbar" style="display:flex;flex-direction:column;align-items:center;padding:6px 3px;background:#0F0E0D;border-right:0.5px solid #1A1917;z-index:30;flex-shrink:0;"></div>
          <div style="position:relative;flex:1;min-height:0;overflow:hidden;">
            <div id="chart-container" style="width:100%;height:100%;"></div>
            <div id="chart-loading" style="display:flex;position:absolute;inset:0;background:rgba(15,14,13,.85);align-items:center;justify-content:center;z-index:10;">
              <div style="text-align:center;"><i class="ti ti-refresh" style="font-size:24px;color:#C9A84C;display:block;margin-bottom:8px;animation:spin 1s linear infinite;"></i><div style="font-size:12px;color:#78716C;">Cargando...</div></div>
            </div>
          </div>
        </div>
      </div>`;
    },
  };

  NS.Screen = ChartsScreen;
  // Compatibilidad con el router existente que llama ChartsScreen.onEnter()
  window.ChartsScreen = ChartsScreen;
})();
