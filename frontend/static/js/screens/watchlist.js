const WatchlistScreen = {
  // ── Estado ────────────────────────────────────────────────────────────────
  items:        [],
  pollInterval: null,
  POLL_MS:      15000,
  activeTab:    'list',   // 'list' | 'suggested' | 'screener'

  // Screener state
  screenerFilters: { supercat:'', min_change:-999, max_change:999, sort_by:'rank', sort_dir:'asc' },
  screenerData:    [],
  screenerLoading: false,

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
  },

  // ── Tabs ──────────────────────────────────────────────────────────────────
  _switchTab(tab) {
    this.activeTab = tab;
    ['list','suggested','screener'].forEach(t => {
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
    } else if (tab === 'screener') {
      this._loadScreener();
    }
  },

  // ── Polling (lista) ────────────────────────────────────────────────────────
  _startPolling() {
    this._stopPolling();
    this.pollInterval = setInterval(() => this._pollPrices(), this.POLL_MS);
  },
  _stopPolling() {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
  },

  async _pollPrices() {
    if (!this.items.length) return;
    try {
      const data = await API.getWatchlistPrices();
      data.prices.forEach(p => {
        const row = document.getElementById(`wl-row-${p.id}`);
        if (!row) return;
        const priceEl  = row.querySelector('.wl-price');
        const changeEl = row.querySelector('.wl-change');
        const exchEl   = row.querySelector('.wl-exchange');
        if (priceEl  && p.price      != null) priceEl.textContent  = this._price(p.price);
        if (changeEl && p.change_24h != null) {
          changeEl.textContent = `${p.change_24h > 0 ? '+' : ''}${p.change_24h.toFixed(2)}%`;
          changeEl.style.color = this._chgColor(p.change_24h);
        }
        if (exchEl) exchEl.textContent = p.exchange;
        const item = this.items.find(i => i.id === p.id);
        if (item) { item.price = p.price; item.change_24h = p.change_24h; item.exchange = p.exchange; }
      });
      const ts = document.getElementById('wl-last-update');
      if (ts) ts.textContent = `Actualizado: ${new Date().toLocaleTimeString('es-AR')}`;
    } catch(e) { console.warn('[watchlist] poll error:', e.message); }
  },

  // ── Tab Lista ──────────────────────────────────────────────────────────────
  async _loadList() {
    const tbody = document.getElementById('wl-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px;">
      <i class="ti ti-refresh"></i> Cargando...</div>`;
    try {
      const data = await API.getWatchlist();
      this.items = data.items;
      tbody.innerHTML = this.items.length
        ? this.items.map(item => this._renderRow(item)).join('')
        : this._renderEmpty();
    } catch(e) {
      tbody.innerHTML = `<div style="padding:20px;color:var(--re);font-size:13px;">Error al cargar</div>`;
    }
  },

  // ── Tab Coins sugeridas ───────────────────────────────────────────────────
  async _loadSuggested() {
    const panel = document.getElementById('wl-panel-suggested');
    if (!panel) return;
    panel.innerHTML = `<div style="padding:32px;text-align:center;color:var(--t3);font-size:13px;">
      <i class="ti ti-refresh"></i> Cargando...</div>`;
    try {
      const data = await API.getWatchlistSuggested();
      panel.innerHTML = this._renderSuggested(data);
    } catch(e) {
      panel.innerHTML = `<div style="padding:20px;color:var(--re);font-size:13px;">Error al cargar sugeridas</div>`;
    }
  },

  // Colores por régimen
  _regimeColor(r) {
    const map = {
      ACUMULACION:'#2563EB', ALCISTA_A:'#56A14F', ALCISTA_B:'#B47514',
      DISTRIBUCION:'#D86326', BAJISTA:'#D93B3B', LATERAL:'#78716C',
    };
    return map[r] || '#78716C';
  },

  _renderSuggested(data) {
    const regime       = data.regime       || 'ACUMULACION';
    const ctx          = data.context      || {};
    const regimesByTf  = data.regimes_by_tf || {};
    const riskColors   = { 'MODERADO-BAJO':'#56A14F', MODERADO:'#B47514', ALTO:'#D86326', 'MUY ALTO':'#D93B3B', EXTREMO:'#D93B3B' };
    const riskColor    = riskColors[ctx.risk_level] || '#78716C';
    const regimeColor  = this._regimeColor(regime);

    // ── Banner de contexto ──────────────────────────────────────────────────
    // Formatear timestamp de coins
    const coinsTs = data.coins_updated_at
      ? (() => {
          const d = new Date(data.coins_updated_at);
          const now = new Date();
          const diffMin = Math.round((now - d) / 60000);
          const diffH   = Math.round(diffMin / 60);
          const ago = diffMin < 60
            ? `hace ${diffMin} min`
            : diffH < 24
              ? `hace ${diffH}h`
              : `hace ${Math.round(diffH/24)}d`;
          return `${d.toLocaleString('es-AR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} (${ago})`;
        })()
      : '—';

    const banner = `
    <div class="card" style="padding:14px 16px;margin-bottom:16px;
                              border-left:3px solid ${regimeColor};
                              border-top:0.5px solid var(--w1);
                              border-right:0.5px solid var(--w1);
                              border-bottom:0.5px solid var(--w1);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;
                  gap:12px;flex-wrap:wrap;">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="font-family:var(--f2);font-size:9px;text-transform:uppercase;
                         letter-spacing:.1em;color:var(--t3);">Régimen actual</span>
            <span style="font-family:var(--f2);font-size:11px;font-weight:700;
                         color:${regimeColor};">${regime}</span>
            <span style="font-family:var(--f2);font-size:9px;color:var(--t4);">·</span>
            <i class="ti ti-database" style="font-size:10px;color:var(--t4);"></i>
            <span style="font-family:var(--f2);font-size:9px;color:var(--t4);">
              Precios actualizados: ${coinsTs}
            </span>
          </div>
          <div style="font-size:13px;color:var(--t2);line-height:1.4;">${ctx.summary || ''}</div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;">
          ${Object.entries(regimesByTf).map(([tf, r]) => `
          <div style="text-align:center;">
            <div style="font-family:var(--f2);font-size:9px;color:var(--t3);
                        text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;">${tf}</div>
            <div style="font-family:var(--f2);font-size:10px;font-weight:700;
                        color:${this._regimeColor(r)};">${r}</div>
          </div>`).join('')}
          <div style="width:1px;background:var(--w1);margin:0 4px;"></div>
          <div style="text-align:center;">
            <div style="font-family:var(--f2);font-size:9px;color:var(--t3);
                        text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;">Riesgo</div>
            <div style="font-family:var(--f2);font-size:10px;font-weight:700;
                        color:${riskColor};">${ctx.risk_level || '—'}</div>
          </div>
        </div>
      </div>
    </div>`;

    // ── Sección largo ───────────────────────────────────────────────────────
    const largoData = data.largo || {};
    const largoRows = (largoData.assets || []).map(c => {
      const signalDot = c.has_signal
        ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;
                        background:#56A14F;margin-right:5px;flex-shrink:0;
                        box-shadow:0 0 5px #56A14F80;"></span>`
        : `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;
                        background:var(--t4);margin-right:5px;flex-shrink:0;"></span>`;
      const metBar = Array.from({length:4}, (_,i) =>
        `<span style="display:inline-block;width:10px;height:3px;border-radius:1px;
                      background:${i < c.conditions_met ? '#56A14F' : 'var(--w1)'};
                      margin-right:2px;"></span>`
      ).join('');
      return `
      <div style="display:grid;grid-template-columns:1fr 90px 70px 70px 1fr 80px;
                  gap:8px;padding:10px 14px;border-bottom:0.5px solid var(--w1);
                  align-items:center;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          ${c.image ? `<img src="${c.image}" style="width:28px;height:28px;border-radius:50%;flex-shrink:0;">` : ''}
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--t1);">${c.name}</div>
            <div style="font-family:var(--f2);font-size:10px;color:var(--t3);">${c.symbol}</div>
          </div>
        </div>
        <div style="font-family:var(--f2);font-size:12px;color:var(--t1);text-align:right;">
          ${this._price(c.price)}
        </div>
        <div style="font-family:var(--f2);font-size:12px;font-weight:600;
                    text-align:right;color:${this._chgColor(c.change_24h)};">
          ${c.change_24h != null ? `${c.change_24h > 0 ? '+' : ''}${c.change_24h.toFixed(2)}%` : '—'}
        </div>
        <div style="font-family:var(--f2);font-size:12px;font-weight:600;
                    text-align:right;color:${this._chgColor(c.change_7d)};">
          ${c.change_7d != null ? `${c.change_7d > 0 ? '+' : ''}${c.change_7d.toFixed(2)}%` : '—'}
        </div>
        <div style="min-width:0;">
          <div style="display:flex;align-items:center;margin-bottom:3px;">
            ${signalDot}
            <span style="font-family:var(--f2);font-size:10px;color:var(--t3);
                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.status}</span>
          </div>
          <div style="display:flex;align-items:center;gap:0;">
            ${metBar}
            <span style="font-family:var(--f2);font-size:9px;color:var(--t4);margin-left:4px;">
              ${c.conditions_met}/4
            </span>
          </div>
        </div>
        <div style="text-align:center;">
          <button onclick="WatchlistScreen._quickAdd('${c.id}','${c.name}','${c.symbol}')"
            style="border:0.5px solid var(--cy);background:var(--cyg);color:var(--cy);
                   border-radius:4px;padding:3px 9px;font-size:11px;cursor:pointer;">
            <i class="ti ti-plus"></i>
          </button>
        </div>
      </div>`;
    }).join('');

    const largoCard = `
    <div class="card" style="border-top:2px solid #2563EB;
                              border-left:1px solid #2563EB40;border-right:1px solid #2563EB40;
                              border-bottom:1px solid #2563EB40;padding:0;overflow:hidden;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                  border-bottom:1px solid var(--w1);">
        <i class="ti ti-clock" style="color:#2563EB;font-size:14px;"></i>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--t1);">${largoData.title || 'Largo Plazo'}</div>
          <div style="font-family:var(--f2);font-size:10px;color:var(--t3);">
            ${largoData.horizon} · ${largoData.technique}
          </div>
        </div>
        <div style="margin-left:auto;font-family:var(--f2);font-size:10px;color:var(--t3);
                    text-align:right;max-width:220px;">${ctx.largo_note || ''}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 90px 70px 70px 1fr 80px;
                  gap:8px;padding:7px 14px;border-bottom:0.5px solid var(--w1);
                  font-family:var(--f2);font-size:9px;color:var(--t4);
                  text-transform:uppercase;letter-spacing:.1em;">
        <span>Activo</span>
        <span style="text-align:right;">Precio</span>
        <span style="text-align:right;">24h</span>
        <span style="text-align:right;">7d</span>
        <span>Señal</span>
        <span style="text-align:center;">+Watch</span>
      </div>
      ${largoRows}
    </div>`;

    // ── Sección genérica medio/corto ────────────────────────────────────────
    const altSection = (sectionData, color, icon, noteKey) => {
      const assets = sectionData.assets || [];
      if (!assets.length) {
        return `
        <div class="card" style="border-top:2px solid ${color};
                                  border-left:1px solid ${color}40;border-right:1px solid ${color}40;
                                  border-bottom:1px solid ${color}40;padding:0;overflow:hidden;margin-bottom:16px;">
          <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                      border-bottom:1px solid var(--w1);">
            <i class="ti ${icon}" style="color:${color};font-size:14px;"></i>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--t1);">${sectionData.title}</div>
              <div style="font-family:var(--f2);font-size:10px;color:var(--t3);">
                ${sectionData.horizon} · ${sectionData.technique}
              </div>
            </div>
          </div>
          <div style="padding:24px;text-align:center;color:var(--t3);font-size:12px;">
            ${sectionData.empty_msg || 'Sin activos en este momento'}
          </div>
        </div>`;
      }

      const rows = assets.map(c => {
        const note = c.catalyst || c.volatility_note || '';
        return `
        <div style="display:grid;grid-template-columns:1fr 90px 70px 70px 1fr 80px;
                    gap:8px;padding:9px 14px;border-bottom:0.5px solid var(--w1);
                    align-items:center;">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            ${c.image
              ? `<img src="${c.image}" style="width:26px;height:26px;border-radius:50%;flex-shrink:0;">`
              : `<div style="width:26px;height:26px;border-radius:50%;background:var(--c3);
                   display:flex;align-items:center;justify-content:center;
                   font-size:8px;font-family:var(--f2);color:var(--t2);">${c.symbol.slice(0,4)}</div>`}
            <div style="min-width:0;">
              <div style="font-size:13px;font-weight:500;color:var(--t1);
                          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.name}</div>
              <div style="font-family:var(--f2);font-size:10px;color:var(--t3);">${c.symbol}</div>
            </div>
          </div>
          <div style="font-family:var(--f2);font-size:12px;color:var(--t1);text-align:right;">
            ${this._price(c.price)}
          </div>
          <div style="font-family:var(--f2);font-size:12px;font-weight:600;
                      text-align:right;color:${this._chgColor(c.change_24h)};">
            ${c.change_24h != null ? `${c.change_24h > 0 ? '+' : ''}${c.change_24h.toFixed(2)}%` : '—'}
          </div>
          <div style="font-family:var(--f2);font-size:12px;font-weight:600;
                      text-align:right;color:${this._chgColor(c.change_7d)};">
            ${c.change_7d != null ? `${c.change_7d > 0 ? '+' : ''}${c.change_7d.toFixed(2)}%` : '—'}
          </div>
          <div style="font-family:var(--f2);font-size:10px;color:var(--t3);
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${note}</div>
          <div style="text-align:center;">
            <button onclick="WatchlistScreen._quickAdd('${c.id}','${c.name}','${c.symbol}')"
              style="border:0.5px solid var(--cy);background:var(--cyg);color:var(--cy);
                     border-radius:4px;padding:3px 9px;font-size:11px;cursor:pointer;">
              <i class="ti ti-plus"></i>
            </button>
          </div>
        </div>`;
      }).join('');

      return `
      <div class="card" style="border-top:2px solid ${color};
                                border-left:1px solid ${color}40;border-right:1px solid ${color}40;
                                border-bottom:1px solid ${color}40;padding:0;overflow:hidden;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                    border-bottom:1px solid var(--w1);">
          <i class="ti ${icon}" style="color:${color};font-size:14px;"></i>
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--t1);">${sectionData.title}</div>
            <div style="font-family:var(--f2);font-size:10px;color:var(--t3);">
              ${sectionData.horizon} · ${sectionData.technique}
            </div>
          </div>
          <div style="margin-left:auto;font-family:var(--f2);font-size:10px;color:var(--t3);
                      text-align:right;max-width:220px;">${ctx[noteKey] || ''}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 90px 70px 70px 1fr 80px;
                    gap:8px;padding:7px 14px;border-bottom:0.5px solid var(--w1);
                    font-family:var(--f2);font-size:9px;color:var(--t4);
                    text-transform:uppercase;letter-spacing:.1em;">
          <span>Activo</span>
          <span style="text-align:right;">Precio</span>
          <span style="text-align:right;">24h</span>
          <span style="text-align:right;">7d</span>
          <span>Nota</span>
          <span style="text-align:center;">+Watch</span>
        </div>
        ${rows}
      </div>`;
    };

    return `
    <div style="padding-top:4px;">
      ${banner}
      ${largoCard}
      ${altSection(data.medio || {}, '#56A14F', 'ti-trending-up',  'medio_note')}
      ${altSection(data.corto || {}, '#B47514', 'ti-bolt',         'corto_note')}
    </div>`;
  },

  async _quickAdd(coinId, name, symbol) {
    try {
      await API.addToWatchlist(coinId, 'coingecko');
      // Feedback visual rápido
      const btns = document.querySelectorAll(`[onclick*="_quickAdd('${coinId}'"]`);
      btns.forEach(btn => {
        btn.innerHTML = '<i class="ti ti-check"></i>';
        btn.style.borderColor = '#56A14F';
        btn.style.color       = '#56A14F';
        btn.style.background  = '#56A14F18';
        btn.disabled = true;
      });
    } catch(e) {
      if (e.message.includes('409')) {
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

  // ── Tab Screener ───────────────────────────────────────────────────────────
  async _loadScreener() {
    const panel = document.getElementById('wl-panel-screener');
    if (!panel) return;
    if (!panel.querySelector('.screener-content')) {
      panel.innerHTML = this._renderScreenerShell();
    }
    await this._runScreener();
  },

  _renderScreenerShell() {
    const supercats = [
      ['', 'Todas'],
      ['bitcoin','Bitcoin'], ['smart_platforms','Smart Platforms'],
      ['layer2','Layer 2'],  ['stablecoins','Stablecoins'],
      ['defi','DeFi'],       ['rwa','RWA'],
      ['exchange','Exchange Tokens'], ['ai','AI'],
      ['memes','Memes'],     ['gaming','Gaming & NFT'],
      ['privacy','Privacy'], ['infrastructure','Infrastructure'],
      ['desoc','DeSoc & Web3'], ['staking','Staking & Liquid'],
      ['payments','Payments'], ['political','Political'],
    ];

    return `
    <div class="screener-content">
      <!-- Filtros -->
      <div class="card" style="padding:14px 16px;margin-bottom:14px;
                                border:0.5px solid var(--w1);">
        <div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px;">

          <!-- Categoría -->
          <div>
            <div style="font-family:var(--f2);font-size:9px;color:var(--t3);
                        text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;">Categoría</div>
            <select id="sc-supercat"
              onchange="WatchlistScreen._onFilterChange()"
              style="padding:6px 10px;border-radius:var(--radius-s);border:0.5px solid var(--w1);
                     background:var(--c2);color:var(--t1);font-size:12px;cursor:pointer;min-width:140px;">
              ${supercats.map(([v,l]) =>
                `<option value="${v}">${l}</option>`
              ).join('')}
            </select>
          </div>

          <!-- Cambio 24h -->
          <div>
            <div style="font-family:var(--f2);font-size:9px;color:var(--t3);
                        text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;">Cambio 24h (%)</div>
            <div style="display:flex;align-items:center;gap:6px;">
              <input id="sc-min-change" type="number" placeholder="Min"
                value="" step="1"
                onchange="WatchlistScreen._onFilterChange()"
                style="width:64px;padding:5px 8px;border-radius:var(--radius-s);
                       border:0.5px solid var(--w1);background:var(--c2);
                       color:var(--t1);font-size:12px;text-align:center;">
              <span style="color:var(--t3);font-size:11px;">a</span>
              <input id="sc-max-change" type="number" placeholder="Max"
                value="" step="1"
                onchange="WatchlistScreen._onFilterChange()"
                style="width:64px;padding:5px 8px;border-radius:var(--radius-s);
                       border:0.5px solid var(--w1);background:var(--c2);
                       color:var(--t1);font-size:12px;text-align:center;">
            </div>
          </div>

          <!-- Ordenar por -->
          <div>
            <div style="font-family:var(--f2);font-size:9px;color:var(--t3);
                        text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;">Ordenar por</div>
            <div style="display:flex;gap:6px;">
              <select id="sc-sort-by"
                onchange="WatchlistScreen._onFilterChange()"
                style="padding:6px 10px;border-radius:var(--radius-s);border:0.5px solid var(--w1);
                       background:var(--c2);color:var(--t1);font-size:12px;cursor:pointer;">
                <option value="rank">Rank</option>
                <option value="change_24h">Cambio 24h</option>
                <option value="change_7d">Cambio 7d</option>
                <option value="volume_24h">Volumen</option>
                <option value="market_cap">Market Cap</option>
              </select>
              <select id="sc-sort-dir"
                onchange="WatchlistScreen._onFilterChange()"
                style="padding:6px 8px;border-radius:var(--radius-s);border:0.5px solid var(--w1);
                       background:var(--c2);color:var(--t1);font-size:12px;cursor:pointer;">
                <option value="asc">↑ ASC</option>
                <option value="desc">↓ DESC</option>
              </select>
            </div>
          </div>

          <!-- Botón aplicar + reset -->
          <div style="display:flex;gap:6px;margin-left:auto;">
            <button onclick="WatchlistScreen._resetScreener()"
              style="padding:6px 12px;border-radius:var(--radius-s);border:0.5px solid var(--w1);
                     background:transparent;color:var(--t3);font-size:12px;cursor:pointer;">
              Reset
            </button>
            <button onclick="WatchlistScreen._runScreener()"
              style="padding:6px 14px;border-radius:var(--radius-s);border:none;
                     background:var(--cy);color:#fff;font-size:12px;cursor:pointer;">
              <i class="ti ti-search"></i> Filtrar
            </button>
          </div>

        </div>
      </div>

      <!-- Resultados -->
      <div id="sc-results"></div>
    </div>`;
  },

  _onFilterChange() {
    // Actualiza estado interno sin disparar fetch todavía
    const supercat   = document.getElementById('sc-supercat')?.value   || '';
    const minChange  = parseFloat(document.getElementById('sc-min-change')?.value) || -999;
    const maxChange  = parseFloat(document.getElementById('sc-max-change')?.value) || 999;
    const sortBy     = document.getElementById('sc-sort-by')?.value    || 'rank';
    const sortDir    = document.getElementById('sc-sort-dir')?.value   || 'asc';
    this.screenerFilters = { supercat, min_change: minChange, max_change: maxChange,
                             sort_by: sortBy, sort_dir: sortDir };
  },

  _resetScreener() {
    this.screenerFilters = { supercat:'', min_change:-999, max_change:999, sort_by:'rank', sort_dir:'asc' };
    const el = id => document.getElementById(id);
    if (el('sc-supercat'))   el('sc-supercat').value   = '';
    if (el('sc-min-change')) el('sc-min-change').value  = '';
    if (el('sc-max-change')) el('sc-max-change').value  = '';
    if (el('sc-sort-by'))    el('sc-sort-by').value     = 'rank';
    if (el('sc-sort-dir'))   el('sc-sort-dir').value    = 'asc';
    this._runScreener();
  },

  async _runScreener() {
    if (this.screenerLoading) return;
    this.screenerLoading = true;
    this._onFilterChange();

    const resultsEl = document.getElementById('sc-results');
    if (!resultsEl) { this.screenerLoading = false; return; }

    resultsEl.innerHTML = `<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px;">
      <i class="ti ti-refresh"></i> Buscando...</div>`;
    try {
      const params = { ...this.screenerFilters, limit: 100 };
      // limpiar valores default para no saturar la URL
      if (params.min_change === -999) delete params.min_change;
      if (params.max_change ===  999) delete params.max_change;
      if (!params.supercat) delete params.supercat;

      const data = await API.getScreener(params);
      resultsEl.innerHTML = this._renderScreenerResults(data);
    } catch(e) {
      resultsEl.innerHTML = `<div style="padding:20px;color:var(--re);font-size:13px;">Error al filtrar</div>`;
    } finally {
      this.screenerLoading = false;
    }
  },

  _renderScreenerResults(data) {
    if (!data.results.length) {
      return `<div style="padding:40px;text-align:center;color:var(--t3);font-size:13px;">
        <i class="ti ti-filter-off" style="font-size:28px;display:block;margin-bottom:8px;"></i>
        Sin resultados con esos filtros</div>`;
    }

    const rows = data.results.map(c => `
    <div style="display:grid;
                grid-template-columns:32px 1fr 90px 70px 70px 90px 90px 80px;
                gap:8px;padding:8px 14px;border-bottom:0.5px solid var(--w1);
                align-items:center;">
      <!-- Rank -->
      <div style="font-family:var(--f2);font-size:10px;color:var(--t4);text-align:center;">
        ${c.rank ?? '—'}
      </div>
      <!-- Activo -->
      <div style="display:flex;align-items:center;gap:8px;min-width:0;">
        ${c.image
          ? `<img src="${c.image}" style="width:24px;height:24px;border-radius:50%;flex-shrink:0;">`
          : `<div style="width:24px;height:24px;border-radius:50%;background:var(--c3);
               display:flex;align-items:center;justify-content:center;
               font-size:8px;font-family:var(--f2);color:var(--t2);">${c.symbol.slice(0,4)}</div>`}
        <div style="min-width:0;">
          <div style="font-size:13px;font-weight:500;color:var(--t1);
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.name}</div>
          <div style="font-family:var(--f2);font-size:10px;color:var(--t3);">${c.symbol}</div>
        </div>
      </div>
      <!-- Precio -->
      <div style="font-family:var(--f2);font-size:12px;color:var(--t1);text-align:right;">
        ${this._price(c.price)}
      </div>
      <!-- 24h -->
      <div style="font-family:var(--f2);font-size:12px;font-weight:600;
                  text-align:right;color:${this._chgColor(c.change_24h)};">
        ${c.change_24h != null ? `${c.change_24h > 0 ? '+' : ''}${c.change_24h.toFixed(2)}%` : '—'}
      </div>
      <!-- 7d -->
      <div style="font-family:var(--f2);font-size:12px;font-weight:600;
                  text-align:right;color:${this._chgColor(c.change_7d)};">
        ${c.change_7d != null ? `${c.change_7d > 0 ? '+' : ''}${c.change_7d.toFixed(2)}%` : '—'}
      </div>
      <!-- Vol -->
      <div style="font-family:var(--f2);font-size:11px;color:var(--t3);text-align:right;">
        ${this._fmt(c.volume_24h)}
      </div>
      <!-- Mcap -->
      <div style="font-family:var(--f2);font-size:11px;color:var(--t3);text-align:right;">
        ${this._fmt(c.market_cap)}
      </div>
      <!-- Acción -->
      <div style="text-align:center;">
        <button onclick="WatchlistScreen._quickAdd('${c.id}','${c.name}','${c.symbol}')"
          title="Agregar a watchlist"
          style="border:0.5px solid var(--cy);background:var(--cyg);color:var(--cy);
                 border-radius:4px;padding:3px 9px;font-size:11px;cursor:pointer;">
          <i class="ti ti-plus"></i>
        </button>
      </div>
    </div>`).join('');

    return `
    <div class="card" style="padding:0;overflow:hidden;border:0.5px solid var(--w1);">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;
                  border-bottom:1px solid var(--w1);">
        <i class="ti ti-filter" style="color:var(--cy);font-size:14px;"></i>
        <span style="font-size:13px;font-weight:600;color:var(--t1);">Resultados</span>
        <span style="font-family:var(--f2);font-size:10px;color:var(--t3);margin-left:auto;">
          ${data.total} coins
        </span>
      </div>
      <!-- Header columnas -->
      <div style="display:grid;
                  grid-template-columns:32px 1fr 90px 70px 70px 90px 90px 80px;
                  gap:8px;padding:7px 14px;border-bottom:0.5px solid var(--w1);
                  font-family:var(--f2);font-size:9px;color:var(--t4);
                  text-transform:uppercase;letter-spacing:.1em;">
        <span>#</span>
        <span>Activo</span>
        <span style="text-align:right;">Precio</span>
        <span style="text-align:right;">24h</span>
        <span style="text-align:right;">7d</span>
        <span style="text-align:right;">Vol 24h</span>
        <span style="text-align:right;">Mcap</span>
        <span style="text-align:center;">+Watch</span>
      </div>
      ${rows}
    </div>`;
  },

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
        <button id="wl-tab-screener"
          onclick="WatchlistScreen._switchTab('screener')"
          style="display:flex;align-items:center;gap:6px;padding:8px 16px;
                 border:none;background:transparent;cursor:pointer;
                 font-size:13px;font-weight:500;color:var(--t3);
                 border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s;">
          <i class="ti ti-filter" style="font-size:13px;"></i> Screener
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

      <!-- Panel: Screener -->
      <div id="wl-panel-screener" style="display:none;"></div>

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
          <input id="wl-search" type="text" placeholder="Buscar por nombre o símbolo..."
            oninput="WatchlistScreen._onSearch(this.value)"
            style="width:100%;padding:8px 12px;border-radius:var(--radius-s);
                   border:0.5px solid var(--w1);background:var(--c2);
                   color:var(--t1);font-size:13px;margin-bottom:8px;box-sizing:border-box;">
          <div id="wl-search-results" style="margin-bottom:12px;"></div>
          <div id="wl-exchange-section" style="display:none;">
            <div style="font-family:var(--f2);font-size:10px;color:var(--t3);
                        text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">Exchange</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${['binance','mexc','coinex','coingecko'].map(ex => `
              <button onclick="WatchlistScreen._selectExchange('${ex}')"
                id="wl-ex-${ex}"
                style="padding:5px 12px;border-radius:4px;border:0.5px solid var(--w1);
                       background:transparent;color:var(--t3);font-size:12px;
                       font-family:var(--f2);cursor:pointer;transition:all .15s;">
                ${ex}
              </button>`).join('')}
            </div>
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

  _price(n) {
    if (!n) return '—';
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

  _renderRow(item) {
    const chg24Color = this._chgColor(item.change_24h);
    const chg7Color  = this._chgColor(item.change_7d);
    const avatar = item.image
      ? `<img src="${item.image}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
      : `<div style="width:28px;height:28px;border-radius:50%;background:var(--c3);
           display:flex;align-items:center;justify-content:center;
           font-family:var(--f2);font-size:9px;font-weight:600;color:var(--t2);">
           ${item.symbol.slice(0,4)}</div>`;
    return `
    <div id="wl-row-${item.id}"
         style="display:grid;grid-template-columns:1fr 100px 80px 80px 80px 90px 80px;
                gap:8px;padding:10px 16px;border-bottom:0.5px solid var(--w1);align-items:center;">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;">
        ${avatar}
        <div style="min-width:0;">
          <div style="font-weight:500;color:var(--t1);font-size:13px;
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</div>
          <div style="font-family:var(--f2);font-size:10px;color:var(--t3);">${item.symbol}</div>
        </div>
      </div>
      <div class="wl-price" style="font-family:var(--f2);font-size:12px;color:var(--t1);text-align:right;">
        ${this._price(item.price)}
      </div>
      <div class="wl-change" style="font-family:var(--f2);font-size:12px;font-weight:600;
                                     text-align:right;color:${chg24Color};">
        ${item.change_24h !== null ? `${item.change_24h > 0 ? '+' : ''}${item.change_24h.toFixed(2)}%` : '—'}
      </div>
      <div style="font-family:var(--f2);font-size:12px;font-weight:600;
                  text-align:right;color:${chg7Color};">
        ${item.change_7d !== null ? `${item.change_7d > 0 ? '+' : ''}${item.change_7d.toFixed(2)}%` : '—'}
      </div>
      <div style="font-family:var(--f2);font-size:11px;color:var(--t3);text-align:right;">
        ${this._fmt(item.volume_24h)}
      </div>
      <div class="wl-exchange" style="font-family:var(--f2);font-size:10px;color:var(--t3);
                                       text-align:center;text-transform:uppercase;">
        ${item.exchange}
      </div>
      <div style="display:flex;align-items:center;justify-content:center;gap:6px;">
        <button onclick="WatchlistScreen._editItem(${item.id})" title="Editar"
          style="border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:14px;padding:2px;"
          onmouseover="this.style.color='#F5F0EB'" onmouseout="this.style.color='var(--t3)'">
          <i class="ti ti-pencil" aria-hidden="true"></i>
        </button>
        <button onclick="WatchlistScreen._removeItem(${item.id},'${item.name}')" title="Eliminar"
          style="border:none;background:transparent;color:var(--t3);cursor:pointer;font-size:14px;padding:2px;"
          onmouseover="this.style.color='var(--re)'" onmouseout="this.style.color='var(--t3)'">
          <i class="ti ti-trash" aria-hidden="true"></i>
        </button>
      </div>
    </div>`;
  },

  // ── Modal agregar ──────────────────────────────────────────────────────────
  _selectedCoin:     null,
  _selectedExchange: 'coingecko',
  _searchTimeout:    null,

  _openAddModal() {
    this._selectedCoin     = null;
    this._selectedExchange = 'coingecko';
    document.getElementById('wl-modal').style.display      = 'flex';
    document.getElementById('wl-search').value             = '';
    document.getElementById('wl-search-results').innerHTML = '';
    document.getElementById('wl-exchange-section').style.display = 'none';
    document.getElementById('wl-selected-coin').style.display    = 'none';
    document.getElementById('wl-add-btn').disabled         = true;
    document.getElementById('wl-add-btn').style.opacity    = '0.5';
    setTimeout(() => document.getElementById('wl-search').focus(), 100);
  },

  _closeModal() {
    document.getElementById('wl-modal').style.display = 'none';
  },

  _onSearch(q) {
    clearTimeout(this._searchTimeout);
    if (q.length < 2) { document.getElementById('wl-search-results').innerHTML = ''; return; }
    this._searchTimeout = setTimeout(async () => {
      const data = await API.searchCoins(q);
      const el   = document.getElementById('wl-search-results');
      if (!data.results.length) {
        el.innerHTML = `<div style="color:var(--t3);font-size:13px;padding:8px 0;">Sin resultados</div>`;
        return;
      }
      el.innerHTML = data.results.map(c => `
        <div onclick="WatchlistScreen._selectCoin(${JSON.stringify(c).replace(/"/g,'&quot;')})"
             style="display:flex;align-items:center;gap:8px;padding:8px;
                    border-radius:var(--radius-s);cursor:pointer;margin-bottom:2px;"
             onmouseover="this.style.background='var(--c2)'"
             onmouseout="this.style.background='transparent'">
          ${c.image ? `<img src="${c.image}" style="width:24px;height:24px;border-radius:50%;">` : ''}
          <div>
            <span style="font-weight:500;color:var(--t1);font-size:13px;">${c.name}</span>
            <span style="font-family:var(--f2);font-size:10px;color:var(--t3);margin-left:6px;">${c.symbol}</span>
          </div>
          ${c.rank ? `<span style="font-family:var(--f2);font-size:10px;color:var(--t4);margin-left:auto;">#${c.rank}</span>` : ''}
        </div>`).join('');
    }, 300);
  },

  _selectCoin(coin) {
    this._selectedCoin = coin;
    document.getElementById('wl-search').value = `${coin.name} (${coin.symbol})`;
    document.getElementById('wl-search-results').innerHTML = '';
    document.getElementById('wl-exchange-section').style.display = 'block';
    document.getElementById('wl-selected-coin').style.display    = 'none';
    document.getElementById('wl-add-btn').disabled    = false;
    document.getElementById('wl-add-btn').style.opacity = '1';
    this._selectExchange('coingecko');
  },

  _selectExchange(ex) {
    this._selectedExchange = ex;
    ['binance','mexc','coinex','coingecko'].forEach(e => {
      const btn = document.getElementById(`wl-ex-${e}`);
      if (!btn) return;
      btn.style.background  = e===ex ? 'var(--cy)' : 'transparent';
      btn.style.color       = e===ex ? '#fff'       : 'var(--t3)';
      btn.style.borderColor = e===ex ? 'var(--cy)' : 'var(--w1)';
    });
  },

  async _confirmAdd() {
    if (!this._selectedCoin) return;
    const btn = document.getElementById('wl-add-btn');
    btn.disabled = true; btn.textContent = 'Agregando...';
    try {
      await API.addToWatchlist(this._selectedCoin.id, this._selectedExchange);
      this._closeModal();
      await this._loadList();
    } catch(e) {
      if (e.message.includes('409')) {
        btn.textContent = 'Ya está en la lista';
        setTimeout(() => { btn.textContent = 'Agregar'; btn.disabled = false; }, 2000);
      } else {
        btn.textContent = 'Error';
        setTimeout(() => { btn.textContent = 'Agregar'; btn.disabled = false; }, 2000);
      }
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
            await API.removeFromWatchlist(id);
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