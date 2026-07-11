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
    _inWatchlist: false,   // si el par actual ya está en la watchlist

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

      // Panel de watchlist (lateral colapsable)
      if (NS.WatchlistPanel) {
        NS.WatchlistPanel.mount();
        // Mantener el highlight sincronizado con el coin activo
        Store.on('coin:changed', () => {
          if (NS.WatchlistPanel._renderRows) NS.WatchlistPanel._renderRows();
        });
      }

      // Estado inicial (último coin/timeframe)
      if (this._pendingPair) {
        const pp = this._pendingPair;
        this._pendingPair = null;
        Store.setCoin({ id: pp.coinId, name: pp.name, symbol: pp.symbol,
                        image: pp.image, exchange: pp.exchange, exSymbol: pp.exSymbol });
        this._updateTfButtons();
        await this._loadChart();
        return;
      }

      const state = await API.getChartState().catch(() => null);
      if (state && state.coin_id) {
        // Restaurar el PAR completo, no solo el coin_id. Sin exchange/exSymbol
        // el /history caía al par por defecto (/USDT) y se perdía el /BTC.
        Store.setCoin({
          id:       state.coin_id,
          exchange: state.exchange  || null,
          exSymbol: state.ex_symbol || null,
        });
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
        // Refrescar el estado del botón de watchlist según el par ya cargado
        this._refreshWatchlistBtn();
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
          const coins = data.results || data.coins || [];
          if (!coins.length) { dd.style.display = 'none'; return; }

          // Expandir cada coin a sus pares (una fila por par+exchange),
          // agrupados por coin con un encabezado. mexc/coinex del mismo par
          // aparecen como filas separadas (son entradas distintas en `pairs`).
          let html = '';
          for (const c of coins) {
            const sym   = (c.symbol || '').toUpperCase();
            const pairs = c.pairs || [];
            if (!pairs.length) continue;

            // Encabezado del grupo (coin)
            html += `
              <div style="display:flex;align-items:center;gap:8px;padding:7px 10px 4px;position:sticky;top:0;background:#0F0E0D;">
                ${c.image ? `<img src="${c.image}" style="width:16px;height:16px;border-radius:50%;">` : ''}
                <span style="font-size:11px;color:#F5F0EB;font-weight:600;">${c.name}</span>
                <span style="font-size:9px;color:#57534E;">${sym}</span>
              </div>`;

            // Una fila por par (base/quote · exchange)
            for (const p of pairs) {
              const exLabel = (p.exchange || '').toUpperCase();
              const quote   = (p.quote || '').toUpperCase();
              const base    = (p.base || sym).toUpperCase();
              const dot     = p.operable ? '#56A14F' : '#78716C';
              html += `
                <div class="chart-search-item"
                  data-id="${c.id}"
                  data-name="${c.name}"
                  data-sym="${sym}"
                  data-image="${c.image || ''}"
                  data-exchange="${p.exchange || ''}"
                  data-exsymbol="${p.pair_symbol || ''}"
                  style="display:flex;align-items:center;gap:8px;padding:7px 10px 7px 30px;cursor:pointer;border-bottom:0.5px solid #1A1917;">
                  <span style="width:6px;height:6px;border-radius:50%;background:${dot};flex:none;"></span>
                  <span style="font-size:12px;color:#F5F0EB;font-family:'IBM Plex Mono',monospace;">${base}/${quote}</span>
                  <span style="font-size:9px;color:#78716C;margin-left:auto;">${exLabel}</span>
                </div>`;
            }
          }

          if (!html) { dd.style.display = 'none'; return; }
          dd.innerHTML = html;
          dd.style.display = 'block';

          dd.querySelectorAll('.chart-search-item').forEach((item) => {
            item.onclick = () => this._selectCoin(
              item.dataset.id,
              item.dataset.name,
              item.dataset.sym,
              item.dataset.image || null,
              item.dataset.exchange || null,
              item.dataset.exsymbol || null,
            );
            item.onmouseover = () => item.style.background = '#2C2926';
            item.onmouseout  = () => item.style.background = 'transparent';
          });
        } catch (e) { dd.style.display = 'none'; }
      }, 250);
    },

    _openIndicatorsModal() { NS.IndicatorsModal.open(); },

    // ── Watchlist: agregar el par actual ───────────────────────────────────────────
    // Reusa POST /api/watchlist/ con el par exacto que se está viendo.
    // El `quote` se deriva del exSymbol (pair_symbol real) respetando el par;
    // para coingecko se fija en USD (solo seguimiento, no operable).
    _deriveQuote(exSymbol, base, exchange) {
      const ex   = (exchange || '').toLowerCase();
      const sym  = (exSymbol || '').toUpperCase();
      const b    = (base || '').toUpperCase();
      if (ex === 'coingecko') return 'USD';
      // pair_symbol = base + quote  →  quote = lo que sigue al prefijo base
      if (sym && b && sym.startsWith(b) && sym.length > b.length) {
        return sym.slice(b.length);
      }
      // Fallbacks razonables
      if (sym.endsWith('USDT')) return 'USDT';
      if (sym.endsWith('BTC'))  return 'BTC';
      return 'USDT';
    },

    // Pinta el botón según si el par ACTUAL (coin+exchange+pair_symbol) ya está
    // en la watchlist. Consulta /api/watchlist/ para saberlo tras recargar/cambiar.
    async _refreshWatchlistBtn() {
      const btn = document.getElementById('chart-add-wl');
      if (!btn) return;
      const coin = Store.coin || {};
      const base     = (coin.symbol || '').toUpperCase();
      const exchange = coin.exchange || 'coingecko';
      const exSymbol = (coin.exSymbol || `${base}USDT`).toUpperCase();

      let found = false;
      try {
        const data  = await fetch('/api/watchlist/').then((r) => r.json());
        const items = data.items || [];
        found = items.some((it) =>
          it.coin_id === coin.id &&
          (it.exchange || '') === exchange &&
          (it.pair_symbol || '').toUpperCase() === exSymbol
        );
      } catch (e) { found = false; }

      this._inWatchlist = found;
      if (found) {
        btn.innerHTML = `<i class="ti ti-check" style="font-size:13px;"></i>`;
        btn.style.color = '#56A14F';
        btn.style.cursor = 'default';
        btn.title = 'Ya está en la watchlist';
      } else {
        btn.innerHTML = `<i class="ti ti-star" style="font-size:13px;"></i>`;
        btn.style.color = '#78716C';
        btn.style.cursor = 'pointer';
        btn.title = 'Agregar a watchlist';
      }
    },

    async _addCurrentToWatchlist() {
      // Si ya está en la lista, no hacer nada (evita duplicar).
      if (this._inWatchlist) return;

      const coin = Store.coin || {};
      const btn  = document.getElementById('chart-add-wl');
      if (!coin.id) return;

      const base     = (coin.symbol || '').toUpperCase();
      const exchange = coin.exchange || 'coingecko';
      const exSymbol = coin.exSymbol || `${base}USDT`;
      const quote    = this._deriveQuote(exSymbol, base, exchange);

      const setBtn = (icon, color, title, cursor) => {
        if (!btn) return;
        btn.innerHTML = `<i class="ti ti-${icon}" style="font-size:13px;"></i>`;
        btn.style.color = color;
        btn.style.cursor = cursor || 'pointer';
        btn.title = title;
      };

      setBtn('loader-2', '#78716C', 'Agregando...', 'default');
      try {
        const r = await fetch('/api/watchlist/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coin_id:     coin.id,
            base,
            quote,
            exchange,
            pair_symbol: exSymbol,
          }),
        });
        if (r.status === 409) {
          // Ya existía: tratarlo como "ya está"
          this._inWatchlist = true;
          setBtn('check', '#56A14F', 'Ya está en la watchlist', 'default');
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        this._inWatchlist = true;
        setBtn('check', '#56A14F', 'Agregado a la watchlist', 'default');
        // Refrescar el panel lateral si está montado
        if (NS.WatchlistPanel && NS.WatchlistPanel._load) {
          NS.WatchlistPanel._load();
        }
      } catch (e) {
        console.error('[charts] add to watchlist:', e);
        setBtn('alert-triangle', '#D93B3B', 'Error al agregar', 'pointer');
        setTimeout(() => this._refreshWatchlistBtn(), 2500);
      }
    },

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
            <button id="chart-add-wl" onclick="AXIOM.Charts.Screen._addCurrentToWatchlist()" title="Agregar a watchlist" style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;border:0.5px solid #2C2926;background:transparent;color:#78716C;cursor:pointer;transition:all .15s;">
              <i class="ti ti-star" style="font-size:13px;"></i>
            </button>
          </div>
          <div style="width:1px;height:24px;background:#2C2926;"></div>
          <div style="display:flex;align-items:center;gap:2px;">${tfBtns}</div>
          <div style="width:1px;height:24px;background:#2C2926;"></div>
          <button onclick="AXIOM.Charts.Screen._openIndicatorsModal()" style="display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:6px;border:0.5px solid #2C2926;background:transparent;color:#78716C;font-size:12px;cursor:pointer;">
            <i class="ti ti-activity" style="font-size:13px;"></i> Indicadores
            <span id="chart-ind-count" style="background:#C9A84C;color:#0F0E0D;border-radius:10px;padding:1px 5px;font-size:10px;font-weight:700;display:none;">0</span>
          </button>
          <button onclick="AXIOM.Charts.Alerts.openPanel()" title="Alertas de precio" style="display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:6px;border:0.5px solid #2C2926;background:transparent;color:#78716C;font-size:12px;cursor:pointer;">
            <i class="ti ti-bell" style="font-size:13px;"></i> Alertas
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
          <div id="wl-panel-host" style="width:240px;flex-shrink:0;transition:width .15s;"></div>
        </div>
      </div>`;
    },
  };

  NS.Screen = ChartsScreen;
  // Compatibilidad con el router existente que llama ChartsScreen.onEnter()
  window.ChartsScreen = ChartsScreen;
})();
