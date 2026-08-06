/**
 * AXIOM v2 — Charts / UI / Watchlist Panel
 * ────────────────────────────────────────────────────────────────────────────
 * Panel lateral colapsable con la lista de seguimiento, estilo TradingView.
 *
 * Las FILAS ya no se dibujan acá: las monta el widget `lista_watchlist`
 * (contexto 'panel'). A 240px el sistema resuelve densidad 'compacto' y el
 * widget se dibuja apilado, con sparkline. El panel conserva solo lo suyo —el
 * header con colapsar y buscar/agregar— y le pasa los datos al widget.
 *
 * El sparkline lo decide la DENSIDAD, no el panel: aparece en 'compacto'
 * (angosto) y no en pantallas anchas, en todos los contextos por igual.
 *
 * Antes tenía render de filas, formateo de precio y sparkline propios,
 * duplicados de otros archivos. Todo eso se fue al widget y a `Fmt`.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS    = window.AXIOM.Charts;
  const Store = NS.Store;

  const WL = {
    list:   () => fetch('/api/watchlist/').then((r) => r.json()),
    add:    (pair) => fetch('/api/watchlist/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pair),
    }).then((r) => r.json()),
    remove: (id) => fetch(`/api/watchlist/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    search: (q) => fetch(`/api/watchlist/search?q=${encodeURIComponent(q)}&limit=8`).then((r) => r.json()),
  };

  const WIDGET_ID = 'lista_watchlist';

  NS.WatchlistPanel = {
    _items: [],
    _collapsed: false,
    _searchTimer: null,
    _mounted: false,
    _epistemico: null,

    mount() {
      if (this._mounted) { this._load(); return; }
      this._mounted = true;
      this._cargarEpistemico();
      this._load();
      // Precios: fuente única compartida (mismo dato que watchlist y header).
      // En cada tick se actualizan los items y se re-pinta el widget sin
      // desmontarlo (actualizar preserva el ResizeObserver y no colapsa el alto).
      window.AXIOM.PriceService.subscribe('wl-panel', (byCoin) => {
        let cambio = false;
        for (const it of this._items) {
          const p = byCoin[it.coin_id];
          if (p) {
            it.price = p.price;
            if (p.change_24h != null) it.change_24h = p.change_24h;
            cambio = true;
          }
        }
        if (cambio) this._refrescarWidget();
      });
    },

    unmount() {
      window.AXIOM.PriceService.unsubscribe('wl-panel');
      const host = document.getElementById('wl-widget-host');
      if (host && window.AXIOM.WidgetMount) {
        try { window.AXIOM.WidgetMount.unmount(host); } catch (e) {}
      }
    },

    async _load() {
      try {
        const data = await WL.list();
        this._items = data.items || [];
      } catch (e) { this._items = []; }
      this.render();
    },

    /** Declaración epistémica de mi_watchlist, para que el widget la exponga. */
    async _cargarEpistemico() {
      try {
        const r = await fetch('/api/capacidades/mi_watchlist');
        if (r.ok) this._epistemico = (await r.json()).epistemico || null;
      } catch (e) { /* sin declaración: el widget se muestra sin la nota */ }
    },

    toggle() {
      this._collapsed = !this._collapsed;
      this.render();
    },

    render() {
      const host = document.getElementById('wl-panel-host');
      if (!host) return;

      if (this._collapsed) {
        host.style.width = '32px';
        host.innerHTML = `
          <button id="wl-expand" title="Lista de seguimiento"
            style="width:32px;height:100%;border:none;border-left:0.5px solid #2C2926;
            background:#0F0E0D;color:#78716C;cursor:pointer;display:flex;
            align-items:center;justify-content:center;">
            <i class="ti ti-star" style="font-size:15px;"></i>
          </button>`;
        document.getElementById('wl-expand').onclick = () => this.toggle();
        return;
      }

      host.style.width = '240px';
      host.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;
                    border-left:0.5px solid #2C2926;background:#0F0E0D;">
          <div style="display:flex;align-items:center;justify-content:space-between;
                      padding:8px 10px;border-bottom:0.5px solid #2C2926;">
            <span style="font-size:11px;font-weight:600;color:#F5F0EB;
                         text-transform:uppercase;letter-spacing:.04em;">Seguimiento</span>
            <div style="display:flex;gap:4px;">
              <button id="wl-add-btn" title="Agregar"
                style="border:none;background:#1A1917;color:#56A14F;
                       width:24px;height:24px;border-radius:5px;cursor:pointer;">
                <i class="ti ti-plus" style="font-size:13px;"></i></button>
              <button id="wl-collapse" title="Colapsar"
                style="border:none;background:#1A1917;color:#78716C;
                       width:24px;height:24px;border-radius:5px;cursor:pointer;">
                <i class="ti ti-chevron-right" style="font-size:13px;"></i></button>
            </div>
          </div>

          <div id="wl-search-box" style="display:none;padding:8px 10px;
                                          border-bottom:0.5px solid #2C2926;">
            <input id="wl-search-input" type="text" placeholder="Buscar para agregar..."
              style="width:100%;background:#1A1917;border:0.5px solid #2C2926;color:#F5F0EB;
                     border-radius:5px;padding:5px 8px;font-size:12px;outline:none;">
            <div id="wl-search-results" style="margin-top:4px;"></div>
          </div>

          <div id="wl-widget-host" style="flex:1;overflow-y:auto;"></div>
        </div>`;

      document.getElementById('wl-collapse').onclick = () => this.toggle();
      document.getElementById('wl-add-btn').onclick  = () => this._toggleSearch();

      this._montarWidget();
      this._bindAcciones();
    },

    /** Monta (o re-monta) el widget en el host, con los datos actuales. */
    async _montarWidget() {
      const host = document.getElementById('wl-widget-host');
      if (!host || !window.AXIOM.WidgetMount) return;
      await window.AXIOM.WidgetMount.mount(host, WIDGET_ID, {
        datos:      { items: this._items },
        contexto:   'panel',
        epistemico: this._epistemico,
      });
      this._marcarActiva();
    },

    /** Re-pinta el widget con datos nuevos sin desmontarlo (ticks de precio). */
    _refrescarWidget() {
      const host = document.getElementById('wl-widget-host');
      if (!host || !window.AXIOM.WidgetMount) return;
      window.AXIOM.WidgetMount.actualizar(host, { items: this._items }, this._epistemico);
      this._marcarActiva();
    },

    /** Resalta la fila del par que está cargado en el gráfico. */
    _marcarActiva() {
      const host = document.getElementById('wl-widget-host');
      if (!host) return;
      const activeId = Store.coin && Store.coin.id;
      host.querySelectorAll('[data-wl-row]').forEach(row => {
        const activa = row.dataset.wlCoin && row.dataset.wlCoin === activeId;
        row.style.background = activa ? '#1A1917' : 'transparent';
      });
    },

    /**
     * Traduce las acciones del widget. En 'panel' el widget solo emite 'abrir'
     * (cargar en el gráfico); 'eliminar' se conserva por si se agrega un gesto
     * de quitar en el futuro.
     */
    _bindAcciones() {
      const host = document.getElementById('wl-widget-host');
      if (!host || host._wlBound) return;
      host._wlBound = true;
      host.addEventListener('axiom:watchlist-accion', (ev) => {
        const d = ev.detail || {};
        if (d.accion === 'abrir') {
          const exRaw = d.exchange;
          const ex    = (exRaw === 'mexc' || exRaw === 'coinex') ? exRaw : undefined;
          const exSym = ex ? (d.ex_symbol || undefined) : undefined;
          NS.Screen._selectCoin(d.coin_id, d.name, d.symbol, null, ex, exSym);
          this._marcarActiva();
        } else if (d.accion === 'eliminar') {
          this._remove(d.id);
        }
      });
    },

    async _remove(itemId) {
      const it = this._items.find((x) => x.id === itemId);
      await WL.remove(itemId).catch(() => {});
      if (it && it.exchange && it.exchange !== 'coingecko' && it.pair_symbol) {
        window.AXIOM.PriceService.untrack(it.exchange, it.pair_symbol, 'watchlist');
      }
      this._items = this._items.filter((x) => x.id !== itemId);
      this._refrescarWidget();
    },

    // ── Buscar / agregar ──────────────────────────────────────────────────────

    _toggleSearch() {
      const box = document.getElementById('wl-search-box');
      if (!box) return;
      const show = box.style.display === 'none';
      box.style.display = show ? 'block' : 'none';
      if (show) {
        const inp = document.getElementById('wl-search-input');
        inp.focus();
        inp.oninput = () => this._onSearch(inp.value);
      }
    },

    _onSearch(q) {
      clearTimeout(this._searchTimer);
      const res = document.getElementById('wl-search-results');
      if (!q || q.length < 2) { res.innerHTML = ''; return; }
      this._searchTimer = setTimeout(async () => {
        try {
          const data = await WL.search(q);
          const results = data.results || [];
          res.innerHTML = results.map((c) => `
            <div class="wl-sr" data-id="${c.id}" data-sym="${(c.symbol || '').toUpperCase()}"
              style="display:flex;align-items:center;gap:6px;padding:6px 4px;cursor:pointer;
                     border-bottom:0.5px solid #1A1917;">
              ${c.image ? `<img src="${c.image}" style="width:16px;height:16px;border-radius:50%;">` : ''}
              <span style="font-size:12px;color:#F5F0EB;">${c.name}</span>
              <span style="font-size:10px;color:#78716C;">${(c.symbol || '').toUpperCase()}</span>
            </div>`).join('');
          res.querySelectorAll('.wl-sr').forEach((el) => {
            el.onclick = async () => {
              const sym = el.dataset.sym || '';
              await WL.add({ coin_id: el.dataset.id, base: sym, quote: 'USDT',
                             exchange: 'coingecko', pair_symbol: sym }).catch(() => {});
              document.getElementById('wl-search-input').value = '';
              res.innerHTML = '';
              this._toggleSearch();
              await this._load();
            };
            el.onmouseover = () => el.style.background = '#2C2926';
            el.onmouseout  = () => el.style.background = 'transparent';
          });
        } catch (e) {}
      }, 250);
    },
  };
})();
