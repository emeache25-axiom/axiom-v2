const WatchlistScreen = {
  // ── Estado ────────────────────────────────────────────────────────────────
  _epistemico: null,        // declaración de mi_watchlist, para el widget
  _epiSugeridas: null,      // declaración de coins_sugeridas
  _sugeridas: null,         // último resultado, para re-montar
  items:        [],
  pollInterval: null,
  POLL_MS:      15000,
  activeTab:    'list',   // 'list' | 'suggested'

  // Screener state

  // ── Ciclo de vida ──────────────────────────────────────────────────────────
  async onEnter() {
    const el = document.getElementById('screen-watchlist');
    if (!el.querySelector('.watchlist-shell')) {
      el.innerHTML = this._renderShell();
    }
    this._switchTab(this.activeTab);
  },

  onLeave() {
    this._stopPolling();
    // El widget tiene un ResizeObserver vivo: si no se desmonta, sigue
    // observando un contenedor que ya no se ve.
    if (window.AXIOM?.WidgetMount) {
      ['wl-tbody', 'wl-panel-suggested'].forEach(id => {
        const el = document.getElementById(id);
        if (el) AXIOM.WidgetMount.unmount(el);
      });
    }
  },

  // ── Tabs ──────────────────────────────────────────────────────────────────
  _switchTab(tab) {
    this.activeTab = tab;
    ['list','suggested'].forEach(t => {
      const btn   = document.getElementById(`wl-tab-${t}`);
      const panel = document.getElementById(`wl-panel-${t}`);
      const active = t === tab;
      if (btn) {
        btn.style.borderBottomColor = active ? 'var(--cy)' : 'transparent';
        btn.style.color             = active ? 'var(--cy)' : 'var(--t3)';
      }
      if (panel) panel.style.display = active ? 'block' : 'none';
    });

    this._stopPolling();

    if (tab === 'list') {
      this._loadList();
      this._startPolling();
    } else if (tab === 'suggested') {
      this._loadSuggested();
    }
  },

  // ── Precios (fuente única: PriceService por WebSocket) ──────────────────────
  _startPolling() {
    this._stopPolling();
    // Suscripción a la fuente única. El callback recibe {coin_id: {price,quote,...}}
    window.AXIOM.PriceService.subscribe('watchlist', (byCoin) => this._applyPrices(byCoin));
  },
  _stopPolling() {
    window.AXIOM.PriceService.unsubscribe('watchlist');
  },

  _applyPrices(byCoin) {
    if (!this.items.length) return;
    this.items.forEach(item => {
      const p = byCoin[item.coin_id];
      if (!p) return;
      const row = document.getElementById(`wl-row-${item.id}`);
      if (row) {
        const priceEl  = row.querySelector('.wl-price');
        const changeEl = row.querySelector('.wl-change');
        if (priceEl  && p.price != null) priceEl.textContent = this._price(p.price, priceEl.dataset.quote);
        if (changeEl && p.change_24h != null) {
          changeEl.textContent = `${p.change_24h > 0 ? '+' : ''}${p.change_24h.toFixed(2)}%`;
          changeEl.style.color = this._chgColor(p.change_24h);
        }
      }
      item.price = p.price;
      if (p.change_24h != null) item.change_24h = p.change_24h;
    });
    const ts = document.getElementById('wl-last-update');
    if (ts) ts.textContent = `Actualizado: ${new Date().toLocaleTimeString('es-AR')}`;
  },

  // ── Tab Lista ──────────────────────────────────────────────────────────────
  // La tabla ya no vive acá: es el widget `lista_watchlist`, montado en
  // #wl-tbody. Esta pantalla conserva lo que es propio de la GESTIÓN —el CRUD,
  // los modales, los grupos— y le pasa los datos al widget.
  //
  // El widget no conoce esta pantalla: cuando se toca una acción emite
  // `axiom:watchlist-accion` y acá se decide qué hacer. Por eso el mismo
  // widget funciona montado en un panel o en una respuesta de Kepler, donde
  // se muestra sin acciones.
  async _loadList() {
    const cont = document.getElementById('wl-tbody');
    if (!cont) return;
    try {
      const data = await API.getWatchlist();
      this.items = data.items || [];

      if (!this._epistemico) this._cargarEpistemico();

      await AXIOM.WidgetMount.mount(cont, 'lista_watchlist', {
        datos: { items: this.items },
        contexto: 'pantalla',
        epistemico: this._epistemico,
      });
      this._bindAccionesWidget(cont);
    } catch(e) {
      cont.innerHTML = `<div style="padding:20px;color:var(--re);font-size:13px;">
        Error al cargar: ${e.message}</div>`;
    }
  },

  /** Traduce las acciones que emite el widget a los métodos de esta pantalla. */
  _bindAccionesWidget(cont) {
    if (cont._wlBound) return;      // una sola vez por contenedor
    cont._wlBound = true;
    cont.addEventListener('axiom:watchlist-accion', (ev) => {
      const { accion, id, valor, nombre } = ev.detail || {};
      if (accion === 'bot')      this._toggleBot(id, valor);
      else if (accion === 'editar')   this._editItem(id);
      else if (accion === 'eliminar') this._removeItem(id, nombre);
      else if (accion === 'abrir')    this._openInCharts(id);
    });
  },

  /** Declaración epistémica de `mi_watchlist`, para que el widget la exponga. */
  async _cargarEpistemico() {
    try {
      const r = await fetch('/api/capacidades/mi_watchlist');
      if (!r.ok) return;
      this._epistemico = (await r.json()).epistemico || null;
      const cont = document.getElementById('wl-tbody');
      if (cont && this._epistemico) {
        AXIOM.WidgetMount.actualizar(cont, { items: this.items }, this._epistemico);
        this._bindAccionesWidget(cont);
      }
    } catch(e) { /* sin declaración: el widget se muestra sin la nota */ }
  },

  // ── Tab Coins sugeridas ───────────────────────────────────────────────────
  // El render se movió al widget `canastas_sugeridas`. Acá queda la carga y la
  // acción de agregar a la watchlist, que es gestión y no viaja con el widget:
  // montado en el chat, las canastas se ven sin el botón de agregar.
  async _loadSuggested() {
    const panel = document.getElementById('wl-panel-suggested');
    if (!panel) return;
    try {
      const data = await API.getWatchlistSuggested();
      this._sugeridas = data;

      if (!this._epiSugeridas) this._cargarEpiSugeridas();

      await AXIOM.WidgetMount.mount(panel, 'canastas_sugeridas', {
        datos: data,
        contexto: 'pantalla',
        epistemico: this._epiSugeridas,
      });
      this._bindSugeridas(panel);
    } catch(e) {
      panel.innerHTML = `<div style="padding:20px;color:var(--re);font-size:13px;">
        Error al cargar sugeridas: ${e.message}</div>`;
    }
  },

  /** El widget avisa cuando se pide agregar una coin; acá se ejecuta. */
  _bindSugeridas(panel) {
    if (panel._sugBound) return;
    panel._sugBound = true;
    panel.addEventListener('axiom:sugerida-agregar', (ev) => {
      const { id, nombre, symbol } = ev.detail || {};
      this._quickAdd(id, nombre, symbol);
    });
  },

  /**
   * Declaración epistémica de `coins_sugeridas`. Importa más que en otras
   * capacidades: acá la selección ENTERA es una inferencia, no una medición.
   */
  async _cargarEpiSugeridas() {
    try {
      const r = await fetch('/api/capacidades/coins_sugeridas');
      if (!r.ok) return;
      this._epiSugeridas = (await r.json()).epistemico || null;
      const panel = document.getElementById('wl-panel-suggested');
      if (panel && this._epiSugeridas && this._sugeridas) {
        AXIOM.WidgetMount.actualizar(panel, this._sugeridas, this._epiSugeridas);
        this._bindSugeridas(panel);
      }
    } catch(e) { /* sin declaración: el widget se muestra sin la nota */ }
  },

  async _quickAdd(coinId, name, symbol) {
    try {
      await API.addToWatchlist(coinId, 'coingecko');
      // Feedback visual: marcar como agregada.
      // Se buscan las dos formas de botón que conviven: los del screener, que
      // todavía llaman a _quickAdd por onclick, y los del widget de canastas,
      // que emiten evento y se identifican por data-sug-id.
      const btns = document.querySelectorAll(
        `[onclick*="_quickAdd('${coinId}'"], [data-sug-id="${coinId}"]`);
      btns.forEach(btn => {
        btn.innerHTML = '<i class="ti ti-check"></i>';
        btn.style.borderColor = '#56A14F';
        btn.style.color       = '#56A14F';
        btn.style.background  = '#56A14F18';
        btn.disabled = true;
      });
    } catch(e) {
      if (e.status === 409 || (e.message || '').includes('409')) {
        this._showDialog({
          icon: '<i class="ti ti-info-circle" style="color:var(--cy);"></i>',
          title: 'Ya en watchlist',
          body: `<p style="font-size:13px;color:var(--t2);">
                   <strong style="color:var(--t1);">${name}</strong> ya está en tu lista de seguimiento.
                 </p>`,
          buttons: [
            { label: 'Entendido', style: 'primary', action: () => this._closeDialog() },
          ],
        });
      } else {
        console.error('[quickAdd]', e);
      }
    }
  },

  // ── Tab Screener: ELIMINADO (30/07/2026) ──────────────────────────────────
  //
  // Tenía dos modos, y los dos quedaron redundantes:
  //
  //   · BASIC filtraba COINS del catálogo de CoinGecko por sector y variación.
  //     Es el universo viejo: AXIOM opera sobre PARES tradeables, y filtrar
  //     coins que quizá no se pueden comprar dejó de tener sentido. Lo que sí
  //     cubre —ver el mercado por sector— está en `mapa_sectores` y `top_coins`.
  //
  //   · OPEN→HIGH medía cuánto sube un activo desde la apertura hasta el
  //     máximo del día. Esa métrica se incorporó al screener de PARES como
  //     `impulso_oh` e `impulso_dias_pct` (migración 006), calculada sobre el
  //     par que se va a operar en vez de sobre el precio agregado en USD.
  //
  // El screener vive ahora en la pantalla Pares, con más métricas y sobre el
  // universo correcto.

  // ── Shell principal con tabs ───────────────────────────────────────────────
  _renderShell() {
    return `
    <div class="watchlist-shell">

      <!-- Header + tabs -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  margin-bottom:0;flex-wrap:wrap;gap:8px;">
        <h1 style="display:flex;align-items:center;gap:8px;font-size:18px;
                   font-weight:600;color:var(--t1);letter-spacing:-.01em;">
          <i class="ti ti-list" style="font-size:18px;color:var(--cy);" aria-hidden="true"></i>
          Watchlist
        </h1>
        <div style="display:flex;align-items:center;gap:10px;">
          <span id="wl-last-update" style="font-family:var(--f2);font-size:11px;color:var(--t3);"></span>
          <button id="wl-add-fab" onclick="WatchlistScreen._openAddModal()"
            style="display:flex;align-items:center;gap:5px;padding:6px 12px;
                   border-radius:var(--radius-s);border:0.5px solid var(--cy);
                   background:var(--cyg);color:var(--cy);font-size:12px;cursor:pointer;">
            <i class="ti ti-plus" style="font-size:13px;"></i> Agregar
          </button>
        </div>
      </div>

      <!-- Sub-tabs -->
      <div style="display:flex;gap:0;border-bottom:1px solid var(--w1);
                  margin-top:14px;margin-bottom:16px;">
        <button id="wl-tab-list"
          onclick="WatchlistScreen._switchTab('list')"
          style="display:flex;align-items:center;gap:6px;padding:8px 16px;
                 border:none;background:transparent;cursor:pointer;
                 font-size:13px;font-weight:500;color:var(--cy);
                 border-bottom:2px solid var(--cy);margin-bottom:-1px;transition:all .15s;">
          <i class="ti ti-list-check" style="font-size:13px;"></i> Lista de seguimiento
        </button>
        <button id="wl-tab-suggested"
          onclick="WatchlistScreen._switchTab('suggested')"
          style="display:flex;align-items:center;gap:6px;padding:8px 16px;
                 border:none;background:transparent;cursor:pointer;
                 font-size:13px;font-weight:500;color:var(--t3);
                 border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s;">
          <i class="ti ti-star" style="font-size:13px;"></i> Coins sugeridas
        </button>
      </div>

      <!-- Panel: Lista -->
      <div id="wl-panel-list">
        <div class="card" style="border-top:2px solid var(--cy);
                                  border-left:1px solid var(--cy)40;
                                  border-right:1px solid var(--cy)40;
                                  border-bottom:1px solid var(--cy)40;
                                  padding:0;overflow:hidden;">
          <div style="display:grid;grid-template-columns:1fr 100px 80px 80px 80px 90px 80px;
                      gap:8px;padding:10px 16px;border-bottom:1px solid var(--w1);
                      font-family:var(--f2);font-size:9px;color:var(--t3);
                      text-transform:uppercase;letter-spacing:.1em;">
            <span>Activo</span>
            <span style="text-align:right;">Precio</span>
            <span style="text-align:right;">24h</span>
            <span style="text-align:right;">7d</span>
            <span style="text-align:right;">Vol 24h</span>
            <span style="text-align:center;">Exchange</span>
            <span style="text-align:center;">Acciones</span>
          </div>
          <div id="wl-tbody"></div>
        </div>
      </div>

      <!-- Panel: Coins sugeridas -->
      <div id="wl-panel-suggested" style="display:none;"></div>


      <!-- Modal genérico: confirm / alert / edit -->
      <div id="wl-dialog" style="display:none;position:fixed;inset:0;z-index:600;
                                   background:rgba(0,0,0,.75);backdrop-filter:blur(4px);
                                   align-items:center;justify-content:center;">
        <div style="background:var(--c1);border:0.5px solid var(--w1);border-radius:14px;
                    padding:0;width:min(420px,calc(100vw - 32px));
                    box-shadow:0 24px 60px rgba(0,0,0,.6);">
          <!-- Header -->
          <div id="wl-dialog-header"
               style="padding:18px 20px 0;display:flex;align-items:center;gap:10px;">
            <span id="wl-dialog-icon" style="font-size:18px;"></span>
            <span id="wl-dialog-title"
                  style="font-size:15px;font-weight:600;color:var(--t1);"></span>
          </div>
          <!-- Body -->
          <div id="wl-dialog-body" style="padding:12px 20px 0;"></div>
          <!-- Footer -->
          <div id="wl-dialog-footer"
               style="padding:16px 20px;display:flex;justify-content:flex-end;gap:8px;"></div>
        </div>
      </div>

      <!-- Modal agregar -->
      <div id="wl-modal" style="display:none;position:fixed;inset:0;z-index:500;
                                  background:rgba(0,0,0,.75);backdrop-filter:blur(4px);
                                  align-items:center;justify-content:center;">
        <div style="background:var(--c1);border:0.5px solid var(--w1);border-radius:14px;
                    padding:0;width:min(480px,calc(100vw - 32px));max-height:90vh;overflow-y:auto;
                    box-shadow:0 24px 60px rgba(0,0,0,.6);">
          <!-- Header del modal -->
          <div style="display:flex;justify-content:space-between;align-items:center;
                      padding:18px 20px 0;">
            <div style="display:flex;align-items:center;gap:8px;">
              <i class="ti ti-plus" style="font-size:15px;color:var(--cy);"></i>
              <span style="font-size:15px;font-weight:600;color:var(--t1);">Agregar a watchlist</span>
            </div>
            <button onclick="WatchlistScreen._closeModal()"
              style="border:none;background:var(--c2);color:var(--t3);width:28px;height:28px;
                     border-radius:50%;font-size:14px;cursor:pointer;display:flex;
                     align-items:center;justify-content:center;transition:all .15s;"
              onmouseover="this.style.background='var(--c3)';this.style.color='var(--t1)'"
              onmouseout="this.style.background='var(--c2)';this.style.color='var(--t3)'">✕</button>
          </div>
          <div style="padding:16px 20px 20px;">
          <input id="wl-search" type="text" placeholder="Buscar par: ONT, ONTBTC, Ontology..."
            oninput="WatchlistScreen._onSearch(this.value)"
            style="width:100%;padding:8px 12px;border-radius:var(--radius-s);
                   border:0.5px solid var(--w1);background:var(--c2);
                   color:var(--t1);font-size:13px;margin-bottom:8px;box-sizing:border-box;">
          <div id="wl-search-results" style="margin-bottom:12px;"></div>
          <div id="wl-exchange-section" style="display:none;">
            <div style="font-family:var(--f2);font-size:10px;color:var(--t3);
                        text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">Par disponible</div>
            <div id="wl-pairs-list" style="display:flex;flex-direction:column;gap:6px;"></div>
          </div>
          <div id="wl-selected-coin" style="display:none;margin-top:12px;"></div>
          <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end;">
            <button onclick="WatchlistScreen._closeModal()"
              style="padding:7px 18px;border-radius:var(--radius-s);border:0.5px solid var(--w1);
                     background:transparent;color:var(--t3);font-size:13px;cursor:pointer;
                     transition:all .15s;"
              onmouseover="this.style.borderColor='var(--t3)';this.style.color='var(--t1)'"
              onmouseout="this.style.borderColor='var(--w1)';this.style.color='var(--t3)'">
              Cancelar
            </button>
            <button id="wl-add-btn" onclick="WatchlistScreen._confirmAdd()" disabled
              style="padding:7px 18px;border-radius:var(--radius-s);border:none;
                     background:var(--cy);color:#0F0E0D;font-size:13px;font-weight:600;
                     cursor:pointer;opacity:0.4;transition:all .15s;">
              <i class="ti ti-plus" style="font-size:12px;"></i> Agregar
            </button>
          </div>
          </div><!-- /padding wrapper -->
        </div>
      </div>

    </div>`;
  },

  // ── Helpers visuales ──────────────────────────────────────────────────────
  _chgColor(n) {
    return n > 0 ? '#56A14F' : n < 0 ? '#D93B3B' : '#78716C';
  },

  _price(n, quote) {
    if (n == null || n === 0) return '—';
    const q = (quote || 'USDT').toUpperCase();
    // Pares no-USDT (ej. /BTC): mostrar el valor tal cual, con sus decimales,
    // sin signo $. Para /BTC los precios son muy chicos (0.00000073).
    if (q !== 'USDT' && q !== 'USDC' && q !== 'USD') {
      let s = n.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
      return `${s} ${q}`;
    }
    return n >= 1
      ? `$${n.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})}`
      : `$${n.toPrecision(4)}`;
  },

  _fmt(n) {
    if (!n) return '—';
    if (n >= 1e9) return `$${(n/1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
    return `$${n.toLocaleString('es-AR')}`;
  },

  _renderEmpty() {
    return `
    <div style="padding:40px;text-align:center;">
      <i class="ti ti-list-search" style="font-size:36px;color:var(--t4);display:block;margin-bottom:12px;"></i>
      <p style="color:var(--t3);font-size:13px;margin-bottom:12px;">Tu watchlist está vacía</p>
      <button onclick="WatchlistScreen._openAddModal()"
        style="padding:6px 16px;border-radius:var(--radius-s);border:0.5px solid var(--cy);
               background:var(--cyg);color:var(--cy);font-size:12px;cursor:pointer;">
        <i class="ti ti-plus"></i> Agregar primera coin
      </button>
    </div>`;
  },

  async _addPair(pair) {
    const r = await fetch('/api/watchlist/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pair),
    });
    if (!r.ok) {
      const err = new Error('HTTP ' + r.status);
      err.status = r.status;
      throw err;
    }
    // Seguir el par en caliente si el exchange es operable en tiempo real.
    if (pair.exchange && pair.exchange !== 'coingecko' && pair.pair_symbol) {
      window.AXIOM.PriceService.track(pair.exchange, pair.pair_symbol,
                                      pair.coin_id, pair.quote, 'watchlist');
    }
    return r.json();
  },

  _openInCharts(id) {
    const it = (this.items || []).find(x => x.id === id);
    if (!it) return;
    const CS = window.Screens && window.Screens.charts;
    if (!CS) return;
    const ex = (it.exchange === 'mexc' || it.exchange === 'coinex') ? it.exchange : undefined;
    CS._pendingPair = {
      coinId: it.coin_id,
      name: it.name,
      symbol: it.base,
      image: it.image,
      exchange: ex,
      exSymbol: ex ? it.pair_symbol : undefined,
    };
    Router.go('charts');
  },

  async _toggleBot(id, enable) {
    try {
      const r = await fetch(`/api/watchlist/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_enabled: enable }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        alert(err.detail || 'No se pudo cambiar el estado del bot');
        return;
      }
      await this._loadList();
    } catch (e) {
      alert('Error de red al cambiar el bot');
    }
  },

  // _renderRow se movió al widget `lista_watchlist`
  // (frontend/static/js/widgets/lista-watchlist.js). Acá quedaba atado a esta
  // pantalla por los onclick inline; como widget se puede montar en cualquier
  // lado y las acciones viajan por evento.

  // ── Modal agregar ──────────────────────────────────────────────────────────
  // Se busca directamente en el catálogo de PARES: un solo paso, sin el rodeo
  // de elegir coin y después descubrir sus pares en los exchanges.
  _parElegido:    null,     // el par seleccionado del resultado
  _resultados:    [],       // última búsqueda
  _searchTimeout: null,

  _openAddModal() {
    this._parElegido = null;
    this._resultados = [];
    document.getElementById('wl-modal').style.display      = 'flex';
    document.getElementById('wl-search').value             = '';
    document.getElementById('wl-search-results').innerHTML = '';
    const secEx = document.getElementById('wl-exchange-section');
    if (secEx) secEx.style.display = 'none';
    const secCoin = document.getElementById('wl-selected-coin');
    if (secCoin) secCoin.style.display = 'none';
    document.getElementById('wl-add-btn').disabled         = true;
    document.getElementById('wl-add-btn').style.opacity    = '0.5';
    setTimeout(() => document.getElementById('wl-search').focus(), 100);
  },

  _closeModal() {
    document.getElementById('wl-modal').style.display = 'none';
  },

  /**
   * Busca PARES tradeables, no coins.
   *
   * Antes el alta era en dos pasos: se buscaba una coin en el catálogo de
   * CoinGecko y después se descubrían sus pares en vivo. Pero el universo de
   * AXIOM son los pares operables de MEXC y CoinEx, que ya están todos en la
   * tabla `pairs` con su volumen y sus métricas. Buscar ahí es un paso menos,
   * es instantáneo (no llama a los exchanges) y solo ofrece lo que realmente
   * se puede operar.
   */
  _onSearch(q) {
    clearTimeout(this._searchTimeout);
    const el = document.getElementById('wl-search-results');
    if (q.trim().length < 2) { if (el) el.innerHTML = ''; return; }

    this._searchTimeout = setTimeout(async () => {
      if (el) el.innerHTML = `<div style="color:var(--t3);font-size:12px;padding:8px 0;">
        Buscando…</div>`;
      try {
        const qs = new URLSearchParams({
          q: q.trim(), limit: 25, orden: 'volumen', dir: 'desc', min_volumen: 0,
        });
        const r = await fetch(`/api/pairs/?${qs}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        this._resultados = data.pares || [];

        if (!this._resultados.length) {
          el.innerHTML = `<div style="color:var(--t3);font-size:13px;padding:8px 0;">
            Ningún par coincide. Se buscan pares de MEXC y CoinEx.</div>`;
          return;
        }
        el.innerHTML = this._resultados.map((p, i) => this._filaResultado(p, i)).join('');
      } catch(e) {
        el.innerHTML = `<div style="color:var(--re);font-size:12px;padding:8px 0;">
          Error al buscar: ${e.message}</div>`;
      }
    }, 300);
  },

  /** Una fila de resultado: el par, su exchange, volumen y la coin si existe. */
  _filaResultado(p, i) {
    const c = p.coin;
    const img = (c && c.image)
      ? `<img src="${c.image}" style="width:24px;height:24px;border-radius:50%;flex-shrink:0;">`
      : `<div style="width:24px;height:24px;border-radius:50%;background:var(--c3);
           display:flex;align-items:center;justify-content:center;flex-shrink:0;
           font-family:var(--f2);font-size:8px;color:var(--t3);">${(p.base||'').slice(0,3)}</div>`;

    const nombre = p.tiene_info && c
      ? c.nombre
      : `<span style="font-style:italic;color:var(--t3);">sin información</span>`;

    const vol = p.volumen_24h != null
      ? `$${AXIOM.Fmt.volumen(p.volumen_24h)}`
      : '—';

    return `
      <div id="wl-res-${i}" onclick="WatchlistScreen._selectResultado(${i})"
           style="display:flex;align-items:center;gap:10px;padding:8px 10px;
                  border:0.5px solid transparent;border-radius:var(--radius-s);
                  cursor:pointer;margin-bottom:2px;"
           onmouseover="if(!this.dataset.sel)this.style.background='var(--c2)'"
           onmouseout="if(!this.dataset.sel)this.style.background='transparent'">
        ${img}
        <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-family:var(--f2);font-weight:600;color:var(--t1);
              font-size:13px;">${p.par}</span>
            <span style="font-family:var(--f2);font-size:10px;color:var(--t3);
              text-transform:uppercase;">${p.exchange}</span>
          </div>
          <div style="font-size:11px;color:var(--t2);overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap;">${nombre}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-family:var(--f2);font-size:11px;color:var(--t2);">${vol}</div>
          ${c && c.rank ? `<div style="font-family:var(--f2);font-size:9px;
            color:var(--t4);">#${c.rank}</div>` : ''}
        </div>
      </div>`;
  },

  /** Marca el par elegido y habilita el botón de agregar. */
  _selectResultado(i) {
    const p = (this._resultados || [])[i];
    if (!p) return;
    this._parElegido = p;

    (this._resultados || []).forEach((_, j) => {
      const el = document.getElementById(`wl-res-${j}`);
      if (!el) return;
      const sel = j === i;
      el.dataset.sel = sel ? '1' : '';
      el.style.borderColor = sel ? 'var(--cy)' : 'transparent';
      el.style.background  = sel ? 'rgba(201,168,76,0.10)' : 'transparent';
    });

    const btn = document.getElementById('wl-add-btn');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  },

  async _confirmAdd() {
    const p = this._parElegido;
    if (!p) return;
    const btn = document.getElementById('wl-add-btn');
    btn.disabled = true; btn.textContent = 'Agregando...';
    try {
      // El par ya trae todo lo necesario: no hace falta resolver nada más.
      // `coin_id` puede ser null —hay pares operables que CoinGecko no indexa—
      // y eso es válido: el par existe igual.
      await this._addPair({
        coin_id: p.coin ? p.coin.id : null,
        base: p.base, quote: p.quote,
        exchange: p.exchange, pair_symbol: p.par,
      });
      this._closeModal();
      await this._loadList();
    } catch(e) {
      const ya = e.status === 409 || (e.message || '').includes('409');
      btn.textContent = ya ? 'Ya está en la lista' : 'Error';
      setTimeout(() => { btn.textContent = 'Agregar'; btn.disabled = false; }, 2000);
    }
  },

  // ── Editar y eliminar ──────────────────────────────────────────────────────
  async _editItem(id) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    this._showDialog({
      icon: '<i class="ti ti-pencil" style="color:var(--cy);"></i>',
      title: `Editar ${item.name}`,
      body: `
        <div style="margin-bottom:12px;">
          <div style="font-family:var(--f2);font-size:10px;color:var(--t3);
                      text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px;">Exchange</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;" id="dlg-exchange-btns">
            ${['binance','mexc','coinex','coingecko'].map(ex => `
            <button onclick="WatchlistScreen._dlgSelectExchange('${ex}')"
              id="dlg-ex-${ex}"
              style="padding:6px 14px;border-radius:4px;
                     border:0.5px solid ${ex===item.exchange ? 'var(--cy)' : 'var(--w1)'};
                     background:${ex===item.exchange ? 'var(--cy)' : 'transparent'};
                     color:${ex===item.exchange ? '#0F0E0D' : 'var(--t3)'};
                     font-size:12px;font-family:var(--f2);cursor:pointer;transition:all .15s;">
              ${ex}
            </button>`).join('')}
          </div>
        </div>`,
      buttons: [
        { label: 'Cancelar', style: 'secondary', action: () => this._closeDialog() },
        { label: '<i class="ti ti-check"></i> Guardar', style: 'primary', action: async () => {
            const ex = this._dlgSelectedExchange || item.exchange;
            if (ex === item.exchange) { this._closeDialog(); return; }
            this._closeDialog();
            await API.updateWatchlistItem(id, {exchange: ex});
            await this._loadList();
          }
        },
      ],
    });
    this._dlgSelectedExchange = item.exchange;
  },

  _dlgSelectedExchange: null,
  _dlgSelectExchange(ex) {
    this._dlgSelectedExchange = ex;
    ['binance','mexc','coinex','coingecko'].forEach(e => {
      const btn = document.getElementById(`dlg-ex-${e}`);
      if (!btn) return;
      btn.style.background   = e===ex ? 'var(--cy)' : 'transparent';
      btn.style.color        = e===ex ? '#0F0E0D'   : 'var(--t3)';
      btn.style.borderColor  = e===ex ? 'var(--cy)' : 'var(--w1)';
    });
  },

  async _removeItem(id, name) {
    this._showDialog({
      icon: '<i class="ti ti-trash" style="color:var(--re);"></i>',
      title: 'Eliminar de watchlist',
      body: `<p style="font-size:13px;color:var(--t2);line-height:1.5;">
               ¿Eliminar <strong style="color:var(--t1);">${name}</strong> de tu watchlist?
             </p>`,
      buttons: [
        { label: 'Cancelar', style: 'secondary', action: () => this._closeDialog() },
        { label: '<i class="ti ti-trash"></i> Eliminar', style: 'danger', action: async () => {
            this._closeDialog();
            const it = this.items.find(i => i.id === id);
            await API.removeFromWatchlist(id);
            // Dejar de seguir el par (quita el motivo "watchlist").
            if (it && it.exchange && it.exchange !== 'coingecko' && it.pair_symbol) {
              window.AXIOM.PriceService.untrack(it.exchange, it.pair_symbol, 'watchlist');
            }
            this.items = this.items.filter(i => i.id !== id);
            const row = document.getElementById(`wl-row-${id}`);
            if (row) row.remove();
            if (!this.items.length) document.getElementById('wl-tbody').innerHTML = this._renderEmpty();
          }
        },
      ],
    });
  },
  // ── Sistema de diálogos ───────────────────────────────────────────────────
  _showDialog({ icon='', title='', body='', buttons=[] }) {
    const dlg = document.getElementById('wl-dialog');
    if (!dlg) return;

    document.getElementById('wl-dialog-icon').innerHTML  = icon;
    document.getElementById('wl-dialog-title').textContent = title;
    document.getElementById('wl-dialog-body').innerHTML  = body;

    const footer = document.getElementById('wl-dialog-footer');
    footer.innerHTML = buttons.map((btn, i) => {
      const styleMap = {
        primary:   'background:var(--cy);color:#0F0E0D;border:none;font-weight:600;',
        secondary: 'background:transparent;color:var(--t3);border:0.5px solid var(--w1);',
        danger:    'background:#D93B3B18;color:#D93B3B;border:0.5px solid #D93B3B40;',
      };
      const s = styleMap[btn.style] || styleMap.secondary;
      return `<button id="wl-dlg-btn-${i}"
        style="padding:7px 18px;border-radius:var(--radius-s);font-size:13px;
               cursor:pointer;transition:all .15s;${s}">
        ${btn.label}
      </button>`;
    }).join('');

    // Asignar acciones después de insertar en el DOM
    buttons.forEach((btn, i) => {
      const el = document.getElementById(`wl-dlg-btn-${i}`);
      if (el) el.addEventListener('click', btn.action);
    });

    dlg.style.display = 'flex';
    // Cerrar al click en backdrop
    dlg.onclick = (e) => { if (e.target === dlg) this._closeDialog(); };
  },

  _closeDialog() {
    const dlg = document.getElementById('wl-dialog');
    if (dlg) dlg.style.display = 'none';
  },
};