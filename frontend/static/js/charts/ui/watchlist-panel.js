/**
 * AXIOM v2 — Charts / UI / Watchlist Panel
 * ────────────────────────────────────────────────────────────────────────────
 * Panel lateral colapsable con la lista de seguimiento, estilo TradingView.
 * - Símbolo + precio + % 24h + mini-sparkline por fila
 * - Un clic carga esa cripto en el gráfico
 * - Buscar/agregar y quitar criptos (reusa /api/watchlist/*)
 * - Polling de precios cada 15s
 *
 * Reusa los endpoints del router de watchlist; no duplica backend.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS    = window.AXIOM.Charts;
  const Store = NS.Store;

  // Cliente mínimo a los endpoints de watchlist (no están en Charts.API)
  const WL = {
    list:   () => fetch('/api/watchlist/').then((r) => r.json()),
    prices: () => fetch('/api/watchlist/prices').then((r) => r.json()),
    add:    (pair) => fetch('/api/watchlist/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pair),
    }).then((r) => r.json()),
    remove: (id) => fetch(`/api/watchlist/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    search: (q) => fetch(`/api/watchlist/search?q=${encodeURIComponent(q)}&limit=8`).then((r) => r.json()),
  };

  NS.WatchlistPanel = {
    _items: [],
    _collapsed: false,
    _pollTimer: null,
    _searchTimer: null,
    _mounted: false,

    mount() {
      if (this._mounted) { this._load(); return; }
      this._mounted = true;
      this._load();
      // Precios: fuente única compartida (mismo dato que watchlist y header)
      window.AXIOM.PriceService.subscribe('wl-panel', (byCoin) => {
        for (const it of this._items) {
          const p = byCoin[it.coin_id];
          if (p) { it.price = p.price; if (p.change_24h != null) it.change_24h = p.change_24h; }
        }
        this._renderRows();
      });
    }

    ,unmount() {
      window.AXIOM.PriceService.unsubscribe('wl-panel');
    }

    ,async _load() {
      try {
        const data = await WL.list();
        this._items = data.items || [];
      } catch (e) { this._items = []; }
      this.render();
    }

    ,toggle() {
      this._collapsed = !this._collapsed;
      this.render();
    }

    ,render() {
      const host = document.getElementById('wl-panel-host');
      if (!host) return;

      if (this._collapsed) {
        host.style.width = '32px';
        host.innerHTML = `
          <button id="wl-expand" title="Lista de seguimiento"
            style="width:32px;height:100%;border:none;border-left:0.5px solid #2C2926;
            background:#0F0E0D;color:#78716C;cursor:pointer;display:flex;align-items:center;justify-content:center;">
            <i class="ti ti-star" style="font-size:15px;transform:rotate(0deg);"></i>
          </button>`;
        document.getElementById('wl-expand').onclick = () => this.toggle();
        return;
      }

      host.style.width = '240px';
      host.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;border-left:0.5px solid #2C2926;background:#0F0E0D;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:0.5px solid #2C2926;">
            <span style="font-size:11px;font-weight:600;color:#F5F0EB;text-transform:uppercase;letter-spacing:.04em;">Seguimiento</span>
            <div style="display:flex;gap:4px;">
              <button id="wl-add-btn" title="Agregar" style="border:none;background:#1A1917;color:#56A14F;width:24px;height:24px;border-radius:5px;cursor:pointer;"><i class="ti ti-plus" style="font-size:13px;"></i></button>
              <button id="wl-collapse" title="Colapsar" style="border:none;background:#1A1917;color:#78716C;width:24px;height:24px;border-radius:5px;cursor:pointer;"><i class="ti ti-chevron-right" style="font-size:13px;"></i></button>
            </div>
          </div>
          <div id="wl-search-box" style="display:none;padding:8px 10px;border-bottom:0.5px solid #2C2926;">
            <input id="wl-search-input" type="text" placeholder="Buscar para agregar..."
              style="width:100%;background:#1A1917;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:5px;padding:5px 8px;font-size:12px;outline:none;">
            <div id="wl-search-results" style="margin-top:4px;"></div>
          </div>
          <div id="wl-rows" style="flex:1;overflow-y:auto;"></div>
        </div>`;

      document.getElementById('wl-collapse').onclick = () => this.toggle();
      document.getElementById('wl-add-btn').onclick = () => this._toggleSearch();
      this._renderRows();
    }

    ,_renderRows() {
      const cont = document.getElementById('wl-rows');
      if (!cont) return;
      if (!this._items.length) {
        cont.innerHTML = `<div style="padding:16px;text-align:center;color:#57534E;font-size:12px;">Lista vacía.<br>Usá + para agregar.</div>`;
        return;
      }
      const activeId = Store.coin.id;
      cont.innerHTML = this._items.map((it) => {
        const chg = it.change_24h;
        const up = (chg ?? 0) >= 0;
        const col = up ? '#56A14F' : '#D93B3B';
        const price = it.price != null ? this._fmtPrice(it.price, it.quote) : '—';
        const chgTxt = chg != null ? `${up ? '+' : ''}${chg.toFixed(2)}%` : '';
        const spark = this._sparkline(it.sparkline, up);
        const isActive = it.coin_id === activeId;
        return `<div class="wl-row" data-id="${it.coin_id}" data-name="${it.name}" data-sym="${it.base || it.symbol}" data-item="${it.id}" data-exchange="${it.exchange || ''}" data-exsymbol="${it.pair_symbol || ''}"
          style="display:flex;align-items:center;gap:6px;padding:7px 10px;cursor:pointer;border-bottom:0.5px solid #1A1917;
          background:${isActive ? '#1A1917' : 'transparent'};position:relative;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:#F5F0EB;">${it.label || (it.base || it.symbol || '').toUpperCase()}</div>
            <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#A8A29E;">${price}</div>
          </div>
          ${spark}
          <div style="text-align:right;min-width:48px;">
            <div style="font-size:10px;color:${col};font-family:'IBM Plex Mono',monospace;">${chgTxt}</div>
          </div>
          <button class="wl-del" data-item="${it.id}" title="Quitar"
            style="border:none;background:none;color:#57534E;cursor:pointer;padding:2px;opacity:0;transition:opacity .15s;">
            <i class="ti ti-x" style="font-size:12px;"></i></button>
        </div>`;
      }).join('');

      // Listeners
      cont.querySelectorAll('.wl-row').forEach((row) => {
        row.onmouseenter = () => { const d = row.querySelector('.wl-del'); if (d) d.style.opacity = '1'; };
        row.onmouseleave = () => { const d = row.querySelector('.wl-del'); if (d) d.style.opacity = '0'; };
        row.onclick = (e) => {
          if (e.target.closest('.wl-del')) return;   // el botón maneja lo suyo
          const exRaw = row.dataset.exchange;
          const ex = (exRaw === 'mexc' || exRaw === 'coinex') ? exRaw : undefined;
          const exSym = ex ? (row.dataset.exsymbol || undefined) : undefined;
          NS.Screen._selectCoin(row.dataset.id, row.dataset.name, row.dataset.sym, null, ex, exSym);
          this._renderRows();   // refrescar el highlight
        };
      });
      cont.querySelectorAll('.wl-del').forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const itemId = +btn.dataset.item;
          await WL.remove(itemId).catch(() => {});
          this._items = this._items.filter((x) => x.id !== itemId);
          this._renderRows();
        };
      });
    }

    ,_fmtPrice(n, quote) {
      if (n == null || n === 0) return '—';
      const q = (quote || 'USDT').toUpperCase();
      // Pares no-USDT (ej. /BTC): valor tal cual, con decimales, sin $.
      if (q !== 'USDT' && q !== 'USDC' && q !== 'USD') {
        let s = n.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
        return `${s} ${q}`;
      }
      // /USDT: reusar el formateo de precio del chart si existe
      try { return NS.DrawingGeo.fmtPrice(n); } catch (e) { return '$' + n; }
    }

    ,_sparkline(data, up) {
      if (!data || !data.length) return '';
      const w = 44, h = 20;
      const min = Math.min(...data), max = Math.max(...data);
      const range = max - min || 1;
      const step = w / (data.length - 1);
      const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(' ');
      const col = up ? '#56A14F' : '#D93B3B';
      return `<svg width="${w}" height="${h}" style="flex-shrink:0;"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1"/></svg>`;
    }

    ,_toggleSearch() {
      const box = document.getElementById('wl-search-box');
      if (!box) return;
      const show = box.style.display === 'none';
      box.style.display = show ? 'block' : 'none';
      if (show) {
        const inp = document.getElementById('wl-search-input');
        inp.focus();
        inp.oninput = () => this._onSearch(inp.value);
      }
    }

    ,_onSearch(q) {
      clearTimeout(this._searchTimer);
      const res = document.getElementById('wl-search-results');
      if (!q || q.length < 2) { res.innerHTML = ''; return; }
      this._searchTimer = setTimeout(async () => {
        try {
          const data = await WL.search(q);
          const results = data.results || [];
          res.innerHTML = results.map((c) => `
            <div class="wl-sr" data-id="${c.id}" data-sym="${(c.symbol || '').toUpperCase()}"
              style="display:flex;align-items:center;gap:6px;padding:6px 4px;cursor:pointer;border-bottom:0.5px solid #1A1917;">
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
    }
  };
})();
