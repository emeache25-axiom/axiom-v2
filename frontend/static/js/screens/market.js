/**
 * AXIOM v2 — MarketScreen  (COMPONENTE, no una pantalla)
 * ────────────────────────────────────────────────────────────────────────────
 * NO es una pantalla independiente ni tiene botón de navegación propio.
 * Es la maquinaria de la sub-pestaña "Mercado" DENTRO de la pantalla de régimen.
 *
 * Lo usa regime.js:
 *   _loadMarket() → MarketScreen.renderShell() + MarketScreen.switchView('general')
 *
 * Provee: vistas General / Categorías / Redes, drill-downs y paginación.
 *
 * El nombre "...Screen" es histórico y engañoso (es una view/componente). No
 * está en window.Screens y eso es correcto: no se navega a él directamente.
 * Un relevamiento lo marcó por error como "pantalla huérfana" el 20/07; es
 * código VIVO y en uso. Ver AXIOM_mapa_codigo.md §7.2.
 * ──────────────────────────────────────────────────────────────────────────── */

const MarketScreen = {
  activeView:   'general',
  loaded:       {general: false, categories: false, networks: false},
  cache:        {general: null,  categories: null,  networks: null},
  cacheTime:    {general: null,  categories: null,  networks: null},
  cacheTTL:     {general: 5,     categories: 30,    networks: 30},
  coinsPage:    1,
  coinsLoading: false,
  drillLimit:   10,
  drillCache:   {},
  networkCache: {},
  networkLimit: 10,
  minMcap:      100000000,

  onEnter() {},

  _fmt(n) {
    if (n===null||n===undefined) return '—';
    if (n>=1e12) return `$${(n/1e12).toFixed(2)}T`;
    if (n>=1e9)  return `$${(n/1e9).toFixed(1)}B`;
    if (n>=1e6)  return `$${(n/1e6).toFixed(1)}M`;
    return `$${n.toLocaleString('es-AR')}`;
  },

  _price(n) {
    if (!n) return '—';
    return n>=1
      ? `$${n.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})}`
      : `$${n.toPrecision(4)}`;
  },

  _change(n) {
    if (n===null||n===undefined) return '—';
    const color = n>0 ? '#56A14F' : n<0 ? '#D93B3B' : '#78716C';
    const sign  = n>0 ? '+' : '';
    return `<span style="font-family:var(--f2);font-size:12px;font-weight:600;color:${color};">${sign}${n.toFixed(2)}%</span>`;
  },

  _avatar(symbol, imageUrl) {
    if (imageUrl) {
      return `<div style="display:flex;flex-shrink:0;">
        <img src="${imageUrl}" alt="${symbol}"
          style="width:28px;height:28px;border-radius:50%;object-fit:cover;"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
        <div style="display:none;width:28px;height:28px;border-radius:50%;
          background:var(--c3);align-items:center;justify-content:center;
          font-family:var(--f2);font-size:9px;font-weight:600;color:var(--t2);">
          ${symbol.slice(0,4)}</div>
      </div>`;
    }
    return `<div style="width:28px;height:28px;border-radius:50%;background:var(--c3);
      display:flex;align-items:center;justify-content:center;
      font-family:var(--f2);font-size:9px;font-weight:600;color:var(--t2);
      flex-shrink:0;">${symbol.slice(0,4)}</div>`;
  },

  _sectionHeader(icon, label, color) {
    return `
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:14px;">
      <div style="width:30px;height:30px;border-radius:7px;background:${color}22;
                  display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <i class="ti ${icon}" style="font-size:15px;color:${color};" aria-hidden="true"></i>
      </div>
      <span style="font-size:14px;font-weight:600;color:#F5F0EB;">${label}</span>
    </div>`;
  },

  _refreshBtn(view) {
    const label = {general:'5 min', categories:'30 min', networks:'30 min'}[view];
    return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
      <button onclick="MarketScreen.refreshView('${view}')"
        style="display:flex;align-items:center;gap:5px;padding:4px 10px;
               border-radius:4px;border:0.5px solid var(--w1);
               background:transparent;color:var(--t3);font-size:11px;
               font-family:var(--f2);cursor:pointer;"
        onmouseover="this.style.color='#F5F0EB'"
        onmouseout="this.style.color='var(--t3)'">
        <i class="ti ti-refresh" style="font-size:11px;" aria-hidden="true"></i>
        Actualizar · cache ${label}
      </button>
    </div>`;
  },

  renderShell() {
    const views = [
      {id:'general',    icon:'ti-layout-grid',    label:'General'},
      {id:'categories', icon:'ti-chart-pie',       label:'Categorías'},
      {id:'networks',   icon:'ti-topology-star-3', label:'Redes'},
    ];
    const sidebarBtns = views.map(v => `
      <button onclick="MarketScreen.switchView('${v.id}')"
        id="market-nav-${v.id}" class="market-nav-btn"
        style="display:flex;align-items:center;gap:8px;width:100%;
               padding:9px 12px;border:none;border-radius:var(--radius-s);
               background:transparent;color:var(--t3);font-size:13px;
               cursor:pointer;transition:all .15s;margin-bottom:4px;text-align:left;">
        <i class="ti ${v.icon}" style="font-size:15px;" aria-hidden="true"></i>
        ${v.label}
      </button>`).join('');
    const mobileTabs = views.map(v => `
      <button onclick="MarketScreen.switchView('${v.id}')"
        id="market-tab-${v.id}" class="market-nav-btn"
        style="display:flex;align-items:center;gap:5px;flex:1;justify-content:center;
               padding:8px 4px;border:none;background:transparent;
               color:var(--t3);font-size:12px;cursor:pointer;
               border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s;">
        <i class="ti ${v.icon}" style="font-size:13px;" aria-hidden="true"></i>
        ${v.label}
      </button>`).join('');
    return `
    <div class="market-mobile-tabs"
         style="display:none;border-bottom:1px solid var(--w1);margin-bottom:16px;">
      ${mobileTabs}
    </div>
    <div class="market-desktop-layout" style="display:flex;gap:0;min-height:400px;">
      <div id="market-sidebar"
           style="width:160px;flex-shrink:0;border-right:1px solid var(--w1);
                  padding-right:16px;margin-right:24px;">
        ${sidebarBtns}
      </div>
      <div id="market-content" style="flex:1;min-width:0;">
        <div class="placeholder"><i class="ti ti-refresh"></i><p>Cargando...</p></div>
      </div>
    </div>`;
  },

  switchView(view) {
    this.activeView = view;
    ['general','categories','networks'].forEach(v => {
      const btn = document.getElementById(`market-nav-${v}`);
      if (btn) {
        btn.style.background = v===view ? 'var(--c2)' : 'transparent';
        btn.style.color      = v===view ? '#F5F0EB'   : 'var(--t3)';
      }
      const tab = document.getElementById(`market-tab-${v}`);
      if (tab) {
        tab.style.color             = v===view ? '#F5F0EB' : 'var(--t3)';
        tab.style.borderBottomColor = v===view ? '#F5F0EB' : 'transparent';
      }
    });
    this._loadView(view);
  },

  // Las vistas con widget no cachean HTML: el widget se remonta con datos
  // frescos (y su propio ResizeObserver). Solo se cachea el HTML de las vistas
  // que siguen siendo render plano.
  _isCacheValid(view) {
    if (view === 'categories') return false;
    if (!this.cache[view] || !this.cacheTime[view]) return false;
    return (Date.now() - this.cacheTime[view]) / 1000 / 60 < this.cacheTTL[view];
  },

  async refreshView(view) {
    this.cache[view]     = null;
    this.cacheTime[view] = null;
    this.loaded[view]    = false;
    await this._loadView(view);
  },

  async _changeMcap(value) {
    this.minMcap           = value;
    this.cache.general     = null;
    this.cacheTime.general = null;
    this.loaded.general    = false;
    await this._loadView('general');
  },

  async _loadView(view) {
    const el = document.getElementById('market-content');
    if (!el) return;
    if (this._isCacheValid(view)) {
      el.innerHTML = this.cache[view];
      if (view === 'general') {
        this._montarGainersLosers();
        setTimeout(() => this._loadCoinsPage(this.coinsPage || 1), 50);
      }
      return;
    }
    el.innerHTML = `<div class="placeholder"><i class="ti ti-refresh"></i><p>Cargando...</p></div>`;
    try {
      let html = '';
      if (view === 'general') {
        const data = await API.getMarketOverview(this.minMcap);
        html = this._renderGeneral(data);
      } else if (view === 'categories') {
        // El widget `mapa_sectores` consume la CAPACIDAD, no el endpoint viejo
        // /api/market/categories. Esa diferencia importa: el endpoint no
        // pondera por capitalización (daba lecturas invertidas), no tiene
        // mediana ni dispersión, y rankea sectores de 12 coins igual que los
        // de 400. Ver AXIOM_registro_capacidades.md.
        el.innerHTML = this._refreshBtn('categories') + '<div id="market-sectores"></div>';
        const r = await fetch('/api/capacidades/mapa_sectores', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: '{}',
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const res = await r.json();
        const host = document.getElementById('market-sectores');
        await AXIOM.WidgetMount.mount(host, 'mapa_sectores', {
          datos: res.resultado,
          contexto: 'pantalla',
          epistemico: res.epistemico,
        });

        // El widget avisa cuando se toca un sector; acá se abre su detalle.
        // Montado en el chat nadie escucha y no pasa nada, que es lo correcto.
        if (!host._secBound) {
          host._secBound = true;
          host.addEventListener('axiom:sector-abrir', (ev) => {
            const sc = ev.detail && ev.detail.supercategoria;
            if (sc) this._loadDrilldown(sc);
          });
        }
        this.cache[view]     = null;   // el widget se remonta, no se cachea HTML
        this.cacheTime[view] = Date.now();
        this.loaded[view]    = true;
        return;
      } else if (view === 'networks') {
        const data = await API.getMarketNetworks();
        html = this._renderNetworks(data);
      }
      this.cache[view]     = html;
      this.cacheTime[view] = Date.now();
      this.loaded[view]    = true;
      el.innerHTML         = html;
      if (view === 'general') {
        this._montarGainersLosers();
        setTimeout(() => this._loadCoinsPage(1), 50);
      }
    } catch(e) {
      el.innerHTML = `<div class="placeholder"><i class="ti ti-alert-circle"></i><p>Error al cargar datos</p></div>`;
    }
  },

  // ── General ──────────────────────────────────────────────────────────────
  // _coinRow (las filas de ganadoras/perdedoras) se reemplazó por el widget
  // tabla_coins montado en _montarGainersLosers.

  _sparkline(prices, change7d) {
    if (!prices || prices.length < 2) return '<span style="color:var(--t3);font-size:10px;">—</span>';
    const color = change7d >= 0 ? '#56A14F' : '#D93B3B';
    const min = Math.min(...prices), max = Math.max(...prices);
    const range = max - min || 1;
    const w = 80, h = 32;
    const pts = prices.map((p,i) => `${((i/(prices.length-1))*w).toFixed(1)},${(h-((p-min)/range)*h).toFixed(1)}`).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  },

  _tableHeader() {
    return `
    <div style="display:grid;grid-template-columns:36px minmax(140px,1fr) 90px 65px 65px 80px 90px 90px;
                gap:6px;font-family:var(--f2);font-size:9px;color:var(--t3);
                text-transform:uppercase;letter-spacing:.08em;
                padding-bottom:6px;border-bottom:1px solid var(--w1);">
      <span style="text-align:right;position:sticky;left:0;background:var(--c1);z-index:1;">#</span>
      <span style="position:sticky;left:36px;background:var(--c1);z-index:1;">Activo</span>
      <span style="text-align:right;">Precio</span>
      <span style="text-align:right;">24h</span>
      <span style="text-align:right;">7d</span>
      <span style="text-align:center;">7d Graf</span>
      <span style="text-align:right;">MCap</span>
      <span style="text-align:right;">Volumen</span>
    </div>`;
  },

  _tableRow(c, i) {
    return `
    <div style="display:grid;grid-template-columns:36px minmax(140px,1fr) 90px 65px 65px 80px 90px 90px;
                gap:6px;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--w1);">
      <span style="font-family:var(--f2);font-size:10px;color:var(--t3);text-align:right;padding-right:4px;
                   position:sticky;left:0;background:var(--c1);z-index:1;">${c.rank||i+1}</span>
      <div style="display:flex;align-items:center;gap:6px;min-width:0;
                  position:sticky;left:36px;background:var(--c1);z-index:1;">
        ${this._avatar(c.symbol, c.image)}
        <div style="min-width:0;">
          <div style="font-weight:500;color:var(--t1);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.name}</div>
          <div style="font-family:var(--f2);font-size:9px;color:var(--t3);">${c.symbol}</div>
        </div>
      </div>
      <span style="font-family:var(--f2);font-size:11px;color:var(--t1);text-align:right;">${this._price(c.price)}</span>
      <span style="text-align:right;">${this._change(c.change_24h)}</span>
      <span style="text-align:right;">${this._change(c.change_7d)}</span>
      <div style="display:flex;justify-content:center;">${this._sparkline(c.sparkline||[], c.change_7d)}</div>
      <span style="font-family:var(--f2);font-size:11px;color:var(--t3);text-align:right;">${this._fmt(c.market_cap)}</span>
      <span style="font-family:var(--f2);font-size:11px;color:var(--t3);text-align:right;">${this._fmt(c.volume_24h)}</span>
    </div>`;
  },

  _scrollTable(rows) {
    return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <div style="min-width:620px;">
        ${this._tableHeader()}
        ${rows}
      </div>
    </div>`;
  },

  async _loadCoinsPage(page) {
    if (this.coinsLoading) return;
    this.coinsLoading = true;
    this.coinsPage    = page;
    const tbody = document.getElementById('coins-tbody');
    const info  = document.getElementById('coins-page-info');
    if (!tbody) { this.coinsLoading = false; return; }
    tbody.style.opacity    = '0.3';
    tbody.style.transition = 'opacity .15s';
    try {
      const data = await API.getCoins(page, 25);
      tbody.innerHTML     = data.coins.map((c,i) => this._tableRow(c,i)).join('');
      tbody.style.opacity = '1';
      if (info) info.textContent = `Página ${page}`;
      const prev = document.getElementById('coins-prev');
      const next = document.getElementById('coins-next');
      if (prev) prev.disabled = page <= 1;
      if (next) next.disabled = data.coins.length < 25;
    } catch(e) {
      tbody.innerHTML     = `<div style="padding:20px;color:var(--re);font-size:13px;">Error al cargar</div>`;
      tbody.style.opacity = '1';
    }
    this.coinsLoading = false;
  },

  // Monta ganadoras y perdedoras como widget tabla_coins. Antes eran _coinRow
  // (render propio); ahora es el mismo widget del chat, con criterio change_24h
  // y dirección opuesta. Reemplaza a _coinRow.
  async _montarGainersLosers() {
    if (!window.AXIOM?.WidgetMount) return;
    const pedir = async (host, dir) => {
      if (!host) return;
      try {
        const r = await fetch('/api/capacidades/top_coins', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ criterio: 'change_24h', n: 5, dir, min_mcap: this.minMcap }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const res = await r.json();
        await AXIOM.WidgetMount.mount(host, 'tabla_coins', {
          datos: res.resultado,
          args: { criterio: 'change_24h' },
          contexto: 'pantalla',
          epistemico: res.epistemico,
        });
      } catch (e) {
        host.innerHTML = `<div style="padding:14px;color:var(--t3);font-size:12px;">No se pudo cargar.</div>`;
      }
    };
    await pedir(document.getElementById('market-gainers'), 'desc');
    await pedir(document.getElementById('market-losers'), 'asc');
  },

  _renderGeneral(data) {
    const mcapOptions = [
      {value:0,           label:'Sin filtro'},
      {value:10000000,    label:'> $10M'},
      {value:100000000,   label:'> $100M'},
      {value:1000000000,  label:'> $1B'},
      {value:10000000000, label:'> $10B'},
    ].map(o => `<option value="${o.value}" ${o.value===this.minMcap?'selected':''}>${o.label}</option>`).join('');

    return this._refreshBtn('general') + `
    <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-bottom:12px;">
      <span style="font-family:var(--f2);font-size:11px;color:var(--t3);">Market cap mín.</span>
      <select onchange="MarketScreen._changeMcap(parseInt(this.value))"
        style="padding:4px 8px;border-radius:4px;border:0.5px solid var(--w1);
               background:var(--c2);color:var(--t1);font-size:12px;font-family:var(--f2);cursor:pointer;">
        ${mcapOptions}
      </select>
    </div>
    <div class="market-gl-grid" style="margin-bottom:14px;">
      <div class="card" style="border-top:2px solid #56A14F;border-left:1px solid #56A14F40;border-right:1px solid #56A14F40;border-bottom:1px solid #56A14F40;">
        ${this._sectionHeader('ti-trending-up','Top ganadoras 24h','#56A14F')}
        <div id="market-gainers"></div>
      </div>
      <div class="card" style="border-top:2px solid #D93B3B;border-left:1px solid #D93B3B40;border-right:1px solid #D93B3B40;border-bottom:1px solid #D93B3B40;">
        ${this._sectionHeader('ti-trending-down','Top perdedoras 24h','#D93B3B')}
        <div id="market-losers"></div>
      </div>
    </div>
    <div class="card" style="border-top:2px solid #B47514;border-left:1px solid #B4751440;border-right:1px solid #B4751440;border-bottom:1px solid #B4751440;">
      ${this._sectionHeader('ti-list-numbers','Por capitalización','#B47514')}
      ${this._scrollTable('<div id="coins-tbody"></div>')}
      <div style="display:flex;align-items:center;justify-content:space-between;
                  margin-top:12px;padding-top:10px;border-top:0.5px solid var(--w1);">
        <button id="coins-prev" onclick="MarketScreen._loadCoinsPage(MarketScreen.coinsPage-1)"
          style="display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:var(--radius-s);
                 border:0.5px solid var(--w1);background:transparent;color:var(--t2);font-size:12px;cursor:pointer;"
          onmouseover="this.style.background='var(--c2)'" onmouseout="this.style.background='transparent'">
          <i class="ti ti-chevron-left" style="font-size:13px;"></i> Anterior
        </button>
        <span id="coins-page-info" style="font-family:var(--f2);font-size:11px;color:var(--t3);">Página 1</span>
        <button id="coins-next" onclick="MarketScreen._loadCoinsPage(MarketScreen.coinsPage+1)"
          style="display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:var(--radius-s);
                 border:0.5px solid var(--w1);background:transparent;color:var(--t2);font-size:12px;cursor:pointer;"
          onmouseover="this.style.background='var(--c2)'" onmouseout="this.style.background='transparent'">
          Siguiente <i class="ti ti-chevron-right" style="font-size:13px;"></i>
        </button>
      </div>
    </div>`;
  },

  // ── Drill-down categorías ─────────────────────────────────────────────────
  async _loadDrilldown(supercatId) {
    const el = document.getElementById('market-content');
    if (!el) return;
    // El drill-down reemplaza el contenido, incluido el contenedor del widget:
    // hay que desmontarlo para que no quede su ResizeObserver observando un
    // elemento que ya no está en el DOM.
    const host = document.getElementById('market-sectores');
    if (host && window.AXIOM?.WidgetMount) AXIOM.WidgetMount.unmount(host);
    const cacheKey = `${supercatId}_${this.drillLimit}`;
    if (this.drillCache[cacheKey]) { el.innerHTML = this.drillCache[cacheKey]; return; }
    el.innerHTML = `<div class="placeholder"><i class="ti ti-refresh"></i><p>Cargando...</p></div>`;
    try {
      const data = await API.getSupercatCoins(supercatId, this.drillLimit);
      const html  = this._renderDrilldown(data, supercatId);
      this.drillCache[cacheKey] = html;
      const el2 = document.getElementById('market-content');
      if (el2) el2.innerHTML = html;
    } catch(e) {
      const el2 = document.getElementById('market-content');
      if (el2) el2.innerHTML = `<div class="placeholder"><i class="ti ti-alert-circle"></i><p>Error al cargar</p></div>`;
    }
  },

  _drillHeader(label, color, backView, backLabel, limitOptions, entityId, changeFn) {
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <button onclick="MarketScreen.switchView('${backView}')"
          style="display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:var(--radius-s);
                 border:0.5px solid var(--w1);background:transparent;color:var(--t3);font-size:12px;cursor:pointer;"
          onmouseover="this.style.color='#F5F0EB'" onmouseout="this.style.color='var(--t3)'">
          <i class="ti ti-chevron-left" style="font-size:13px;"></i> ${backLabel}
        </button>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></div>
          <span style="font-size:16px;font-weight:600;color:#F5F0EB;">${label}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-family:var(--f2);font-size:11px;color:var(--t3);">Mostrar</span>
        <select onchange="${changeFn}(parseInt(this.value),'${entityId}')"
          style="padding:4px 8px;border-radius:4px;border:0.5px solid var(--w1);
                 background:var(--c2);color:var(--t1);font-size:12px;font-family:var(--f2);cursor:pointer;">
          ${limitOptions}
        </select>
        <span style="font-family:var(--f2);font-size:11px;color:var(--t3);">cryptos</span>
      </div>
    </div>`;
  },

  _renderDrilldown(data, supercatId) {
    const sc   = data.supercat;
    const rows = data.coins.map((c,i) => this._tableRow(c,i)).join('');
    const limitOptions = [10,20,30,50].map(n =>
      `<option value="${n}" ${n===this.drillLimit?'selected':''}>${n}</option>`).join('');
    return this._drillHeader(sc.label, sc.color, 'categories', 'Categorías', limitOptions, supercatId, 'MarketScreen._changeDrillLimit') + `
    <p style="font-size:12px;color:var(--t3);line-height:1.5;margin-bottom:16px;
              padding:10px 12px;background:var(--c2);border-radius:var(--radius-s);
              border-left:3px solid ${sc.color};">${sc.info}</p>
    <div class="card" style="border-top:2px solid ${sc.color};border-left:1px solid ${sc.color}40;border-right:1px solid ${sc.color}40;border-bottom:1px solid ${sc.color}40;">
      ${this._scrollTable(rows)}
    </div>`;
  },

  async _changeDrillLimit(value, supercatId) {
    this.drillLimit = value;
    this.drillCache = {};
    await this._loadDrilldown(supercatId);
  },

  // ── Drill-down redes ──────────────────────────────────────────────────────
  async _loadNetworkDrilldown(networkId) {
    const el = document.getElementById('market-content');
    if (!el) return;
    const cacheKey = `${networkId}_${this.networkLimit}`;
    if (this.networkCache[cacheKey]) { el.innerHTML = this.networkCache[cacheKey]; return; }
    el.innerHTML = `<div class="placeholder"><i class="ti ti-refresh"></i><p>Cargando...</p></div>`;
    try {
      const data = await API.getNetworkCoins(networkId, this.networkLimit);
      const html  = this._renderNetworkDrilldown(data, networkId);
      this.networkCache[cacheKey] = html;
      const el2 = document.getElementById('market-content');
      if (el2) el2.innerHTML = html;
    } catch(e) {
      const el2 = document.getElementById('market-content');
      if (el2) el2.innerHTML = `<div class="placeholder"><i class="ti ti-alert-circle"></i><p>Error al cargar</p></div>`;
    }
  },

  _renderNetworkDrilldown(data, networkId) {
    const net  = data.network;
    const rows = data.coins.map((c,i) => this._tableRow(c,i)).join('');
    const limitOptions = [10,20,30,50].map(n =>
      `<option value="${n}" ${n===this.networkLimit?'selected':''}>${n}</option>`).join('');
    return this._drillHeader(net.label, net.color, 'networks', 'Redes', limitOptions, networkId, 'MarketScreen._changeNetworkLimit') + `
    <p style="font-size:12px;color:var(--t3);line-height:1.5;margin-bottom:16px;
              padding:10px 12px;background:var(--c2);border-radius:var(--radius-s);
              border-left:3px solid ${net.color};">${net.info}</p>
    <div class="card" style="border-top:2px solid ${net.color};border-left:1px solid ${net.color}40;border-right:1px solid ${net.color}40;border-bottom:1px solid ${net.color}40;">
      ${this._scrollTable(rows)}
    </div>`;
  },

  async _changeNetworkLimit(value, networkId) {
    this.networkLimit = value;
    this.networkCache = {};
    await this._loadNetworkDrilldown(networkId);
  },

  // ── Categorías ────────────────────────────────────────────────────────────
  // _renderCategories se movió al widget `mapa_sectores`
  // (frontend/static/js/widgets/mapa-sectores.js).
  //
  // No fue solo un refactor: esta vista consumía /api/market/categories, que
  // no pondera por capitalización, no calcula mediana ni dispersión, y no
  // aplica el umbral de relevancia del ranking. Mostraba lecturas que el
  // backend ya había corregido — por ejemplo, sectores marcados como fuertes
  // cuando por capital estaban cayendo.

  _renderNetworks(data) {
    const max    = data.networks[0]?.pct || 1;
    const ethL2  = data.networks.filter(n => n.group === 'ethereum_l2');
    const others = data.networks.filter(n => n.group !== 'ethereum_l2');

    return this._refreshBtn('networks') + `
    <div class="card" style="border-top:2px solid #627EEA;border-left:1px solid #627EEA40;border-right:1px solid #627EEA40;border-bottom:1px solid #627EEA40;margin-bottom:14px;">
      ${this._sectionHeader('ti-topology-star-3','Ethereum + L2s','#627EEA')}
      <div style="font-family:var(--f2);font-size:10px;color:var(--t3);margin-bottom:12px;">
        Total ecosistema: ${this._fmt(data.eth_l2_total)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 70px 70px 60px 90px;gap:8px;
                  font-family:var(--f2);font-size:9px;color:var(--t3);
                  text-transform:uppercase;letter-spacing:.08em;
                  padding-bottom:6px;border-bottom:1px solid var(--w1);margin-bottom:12px;">
        <span>Red</span>
        <span style="text-align:right;">24h</span>
        <span style="text-align:right;">7d</span>
        <span style="text-align:right;">%MCap</span>
        <span style="text-align:right;">MCap</span>
      </div>
      ${ethL2.map(n => this._renderNetworkRow(n, max)).join('')}
    </div>
    <div class="card" style="border-top:2px solid var(--w2);">
      ${this._sectionHeader('ti-topology-star-3','Otras redes','var(--t3)')}
      <div style="display:grid;grid-template-columns:1fr 70px 70px 60px 90px;gap:8px;
                  font-family:var(--f2);font-size:9px;color:var(--t3);
                  text-transform:uppercase;letter-spacing:.08em;
                  padding-bottom:6px;border-bottom:1px solid var(--w1);margin-bottom:12px;">
        <span>Red</span>
        <span style="text-align:right;">24h</span>
        <span style="text-align:right;">7d</span>
        <span style="text-align:right;">%MCap</span>
        <span style="text-align:right;">MCap</span>
      </div>
      ${others.map(n => this._renderNetworkRow(n, max)).join('')}
    </div>`;
  },

  render(data) { return this.renderShell(); },
};
