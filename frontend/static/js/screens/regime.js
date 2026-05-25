const RegimeScreen = {
  activeTab: 'regime',
  regimeLoaded: false,
  marketLoaded: false,
  capitalLoaded: false,

  onEnter() {
    const el = document.getElementById('screen-regime');
    if (!el.querySelector('.sub-tabs')) this._renderShell();
    this._activateTab(this.activeTab);
  },

  _renderShell() {
    document.getElementById('screen-regime').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;
                margin-bottom:16px;flex-wrap:wrap;gap:8px;">
      <h1 style="display:flex;align-items:center;gap:8px;font-size:18px;
                 font-weight:600;color:var(--t1);letter-spacing:-.01em;">
        <i class="ti ti-chart-bar" style="font-size:18px;color:var(--cy);" aria-hidden="true"></i>
        Régimen
      </h1>
      <span id="regime-ts" style="font-family:var(--f2);font-size:11px;color:var(--t3);"></span>
    </div>
    <div class="sub-tabs">
      <button class="sub-tab" data-tab="regime" onclick="RegimeScreen._activateTab('regime')">
        <i class="ti ti-activity" aria-hidden="true"></i> Régimen de mercado
      </button>
      <button class="sub-tab" data-tab="market" onclick="RegimeScreen._activateTab('market')">
        <i class="ti ti-world" aria-hidden="true"></i> Mapa del mercado
      </button>
      <button class="sub-tab" data-tab="capital" onclick="RegimeScreen._activateTab('capital')">
        <i class="ti ti-adjustments" aria-hidden="true"></i> Capital
      </button>
    </div>
    <div id="sub-regime"></div>
    <div id="sub-market" style="display:none;"></div>
    <div id="sub-capital" style="display:none;"></div>`;
  },

  _activateTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.sub-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('sub-regime').style.display  = tab==='regime'  ? '' : 'none';
    document.getElementById('sub-market').style.display  = tab==='market'  ? '' : 'none';
    document.getElementById('sub-capital').style.display = tab==='capital' ? '' : 'none';
    if (tab==='regime'  && !this.regimeLoaded)  this._loadRegime();
    if (tab==='market'  && !this.marketLoaded)  this._loadMarket();
    if (tab==='capital' && !this.capitalLoaded) this._loadCapital();
  },

  async _loadRegime() {
    const el = document.getElementById('sub-regime');
    el.innerHTML = `<div class="placeholder"><i class="ti ti-refresh"></i><p>Cargando...</p></div>`;
    try {
      const data = await API.getLatestRegime();
      const ts = new Date(data.created_at).toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'});
      const price = data.btc_price
        ? `$${Number(data.btc_price).toLocaleString('es-AR')}` : '—';
      document.getElementById('regime-ts').textContent = `BTC ${price} · ${ts}`;
      el.innerHTML = this._renderRegime(data);
      this.regimeLoaded = true;
    } catch(e) {
      el.innerHTML = `<div class="placeholder"><i class="ti ti-alert-circle"></i><p>Error al cargar</p></div>`;
    }
  },

  async _loadCapital() {
    const el = document.getElementById('sub-capital');
    el.innerHTML = `<div class="placeholder"><i class="ti ti-refresh"></i><p>Cargando...</p></div>`;
    try {
      const data = await API.getCapitalSuggestion();
      el.innerHTML = CapitalScreen.render(data);
      this.capitalLoaded = true;
    } catch(e) {
      el.innerHTML = `<div class="placeholder"><i class="ti ti-alert-circle"></i><p>Error al cargar</p></div>`;
    }
  },

  async _loadMarket() {
    const el = document.getElementById('sub-market');
    el.innerHTML = `<div class="placeholder"><i class="ti ti-refresh"></i><p>Cargando mercado...</p></div>`;
    try {
      const data = await API.getMarketOverview();
      el.innerHTML = MarketScreen.render(data);
      this.marketLoaded = true;
    } catch(e) {
      el.innerHTML = `<div class="placeholder"><i class="ti ti-alert-circle"></i><p>Error al cargar</p></div>`;
    }
  },

  // Config por temporalidad (borde + ícono)
  _tfCfg: {
    largo: {icon:'ti-clock-hour-4', color:'#2563EB', bg:'rgba(37,99,235,.15)', label:'Largo plazo'},
    medio: {icon:'ti-calendar-week',color:'#56A14F', bg:'rgba(86,161,79,.15)',  label:'Medio plazo'},
    corto: {icon:'ti-bolt',         color:'#B47514', bg:'rgba(180,117,20,.15)', label:'Corto plazo'},
  },

  // Color del nombre del régimen
  _regimeColor(r) {
    return {
      ACUMULACION:'#2563EB', ALCISTA_A:'#56A14F', ALCISTA_B:'#B47514',
      DISTRIBUCION:'#D86326', BAJISTA:'#D93B3B',
      ALCISTA:'#56A14F', LATERAL:'#78716C',
    }[r] || '#78716C';
  },

  _regimeLabel(r) {
    return {
      ACUMULACION:'Acumulación', ALCISTA_A:'Alcista temprano',
      ALCISTA_B:'Alcista tardío', DISTRIBUCION:'Distribución',
      BAJISTA:'Bajista', ALCISTA:'Alcista', LATERAL:'Lateral',
    }[r] || r;
  },

  // SVG arc doble con glow — estilo futurista
  _arcSVG(pct, color, totalSignals, consensus) {
    const id   = 'glow' + Math.random().toString(36).slice(2,7);
    const r1   = 28, r2 = 20;
    const c1   = 2 * Math.PI * r1;
    const c2   = 2 * Math.PI * r2;
    const off1 = c1 * (1 - pct / 100);
    const off2 = c2 * (1 - pct / 100);

    const segs = Array.from({length: totalSignals}, (_, i) => {
      const filled = i < consensus;
      return `<div style="width:9px;height:9px;border-radius:2px;
        background:${filled ? color : '#2C2926'};"></div>`;
    }).join('');

    return `
    <div style="display:flex;align-items:center;gap:14px;">
      <svg width="72" height="72" viewBox="0 0 72 72" style="flex-shrink:0;overflow:visible;">
        <defs>
          <filter id="${id}" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <!-- Track exterior -->
        <circle cx="36" cy="36" r="${r1}" fill="none" stroke="#1A1917" stroke-width="5"/>
        <!-- Arc exterior (glow) -->
        <circle cx="36" cy="36" r="${r1}" fill="none" stroke="${color}" stroke-width="2"
          stroke-dasharray="${c1.toFixed(2)}" stroke-dashoffset="${off1.toFixed(2)}"
          stroke-linecap="round" transform="rotate(-90 36 36)"
          filter="url(#${id})" opacity="0.55"/>
        <!-- Arc exterior (sólido) -->
        <circle cx="36" cy="36" r="${r1}" fill="none" stroke="${color}" stroke-width="2"
          stroke-dasharray="${c1.toFixed(2)}" stroke-dashoffset="${off1.toFixed(2)}"
          stroke-linecap="round" transform="rotate(-90 36 36)"/>
        <!-- Track interior -->
        <circle cx="36" cy="36" r="${r2}" fill="none" stroke="#1A1917" stroke-width="4"/>
        <!-- Arc interior (glow) -->
        <circle cx="36" cy="36" r="${r2}" fill="none" stroke="${color}" stroke-width="3"
          stroke-dasharray="${c2.toFixed(2)}" stroke-dashoffset="${off2.toFixed(2)}"
          stroke-linecap="round" transform="rotate(-90 36 36)"
          filter="url(#${id})" opacity="0.6"/>
        <!-- Arc interior (sólido) -->
        <circle cx="36" cy="36" r="${r2}" fill="none" stroke="${color}" stroke-width="3"
          stroke-dasharray="${c2.toFixed(2)}" stroke-dashoffset="${off2.toFixed(2)}"
          stroke-linecap="round" transform="rotate(-90 36 36)"/>
        <!-- Texto central -->
        <text x="36" y="40" text-anchor="middle"
          font-family="'IBM Plex Mono',monospace" font-size="12"
          font-weight="600" fill="#F5F0EB">${pct}%</text>
      </svg>
      <div>
        <div style="font-family:var(--f2);font-size:10px;color:var(--t3);margin-bottom:5px;">
          Convicción
        </div>
        <div style="display:flex;gap:3px;flex-wrap:wrap;max-width:80px;">
          ${segs}
        </div>
        <div style="font-family:var(--f2);font-size:10px;color:var(--t3);margin-top:4px;">
          ${consensus} / ${totalSignals} señales
        </div>
      </div>
    </div>`;
  },

  _renderRegimeCard(tf, r) {
    const cfg    = this._tfCfg[tf];
    const rColor = this._regimeColor(r.regime);
    const rLabel = this._regimeLabel(r.regime);
    const conf   = r.is_confirmed
      ? `<span style="font-family:var(--f2);font-size:10px;color:#56A14F;">✓ Confirmado</span>`
      : `<span style="font-family:var(--f2);font-size:10px;color:var(--t3);">Sin confirmar</span>`;
    const miss = r.missing_signals?.length
      ? `<p style="font-size:10px;color:#B47514;margin-top:6px;font-family:var(--f2);">
           ⚠ Faltan: ${r.missing_signals.join(', ')}</p>` : '';

    return `
    <div class="card" style="border-top:3px solid ${cfg.color};border-left:1px solid ${cfg.color}40;border-right:1px solid ${cfg.color}40;border-bottom:1px solid ${cfg.color}40;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="width:26px;height:26px;border-radius:6px;background:${cfg.bg};
                      display:flex;align-items:center;justify-content:center;">
            <i class="ti ${cfg.icon}" style="font-size:13px;color:${cfg.color};" aria-hidden="true"></i>
          </div>
          <span style="font-size:13px;font-weight:600;color:#F5F0EB;
                       letter-spacing:-.01em;">${cfg.label}</span>
        </div>
        <span class="badge badge-${r.regime}">${r.regime.replace('_',' ')}</span>
      </div>

      <div style="font-size:20px;font-weight:700;letter-spacing:-.02em;
                  margin-bottom:14px;color:${rColor};">
        ${rLabel}
      </div>

      ${this._arcSVG(r.conviction, rColor, r.signals_expected, r.consensus)}

      <div style="margin-top:10px;">${conf}</div>
      ${miss}
    </div>`;
  },

  _renderSignalCards(signals) {
    const core = signals?.core || [];
    const byTf = {largo:[],medio:[],corto:[]};
    core.forEach(s => { if (byTf[s.timeframe]) byTf[s.timeframe].push(s); });

    const card = (tf, list) => {
      const cfg = this._tfCfg[tf];
      const rows = list.map(s => {
        const val   = s.raw_value !== null ? Number(s.raw_value).toPrecision(4) : '—';
        const rCol  = this._regimeColor(s.voted_regime);
        const rLbl  = (s.voted_regime||'—').replace('_','·');
        return `
        <div class="signal-row">
          <span style="font-family:var(--f2);font-size:11px;color:var(--t2);">${s.signal_id}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-family:var(--f2);font-size:10px;color:var(--t3);">${val}</span>
            <span style="font-family:var(--f2);font-size:10px;font-weight:500;color:${rCol};">
              ${rLbl}
            </span>
          </div>
        </div>`;
      }).join('');

      return `
      <div class="card" style="border-top:2px solid ${cfg.color};border-left:1px solid ${cfg.color}40;border-right:1px solid ${cfg.color}40;border-bottom:1px solid ${cfg.color}40;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;
                    padding-bottom:8px;border-bottom:0.5px solid var(--w1);">
          <i class="ti ${cfg.icon}" style="font-size:13px;color:${cfg.color};" aria-hidden="true"></i>
          <span style="font-size:14px;font-weight:600;color:#F5F0EB;
                       letter-spacing:-.01em;">${cfg.label}</span>
        </div>
        ${rows || '<span style="font-size:12px;color:var(--t3);">Sin datos</span>'}
      </div>`;
    };

    return `
    <div style="font-family:var(--f2);font-size:9px;color:var(--t3);
                text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px;">
      Señales núcleo
    </div>
    <div class="signal-cards-grid">
      ${card('largo', byTf.largo)}
      ${card('medio', byTf.medio)}
      ${card('corto', byTf.corto)}
    </div>`;
  },

  _renderRegime(data) {
    return `
    <div class="regime-grid">
      ${this._renderRegimeCard('largo', data.regimes.largo)}
      ${this._renderRegimeCard('medio', data.regimes.medio)}
      ${this._renderRegimeCard('corto', data.regimes.corto)}
    </div>
    ${this._renderSignalCards(data.signals)}`;
  },
};
