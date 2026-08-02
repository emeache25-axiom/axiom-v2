const RegimeScreen = {
  activeTab: 'regime',
  _epistemico: null,        // declaración de regimen_mercado, para el widget
  regimeLoaded: false,
  marketLoaded: false,

  onEnter() {
    const el = document.getElementById('screen-regime');
    if (!el.querySelector('.sub-tabs')) this._renderShell();
    this._activateTab(this.activeTab);
  },

  onLeave() {
    // El widget tiene un ResizeObserver vivo: si no se desmonta, sigue
    // observando un contenedor que ya no se ve. Al volver, _activateTab
    // detecta que no hay instancia y lo remonta.
    const w = document.getElementById('regime-widget');
    if (w && window.AXIOM?.WidgetMount) AXIOM.WidgetMount.unmount(w);
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
    </div>
    <div id="sub-regime"></div>
    <div id="sub-market" style="display:none;"></div>`;
  },

  _activateTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.sub-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('sub-regime').style.display = tab==='regime' ? '' : 'none';
    document.getElementById('sub-market').style.display = tab==='market' ? '' : 'none';
    // Se recarga si no hay datos, O si el widget quedó desmontado: al salir de
    // la pantalla se desmonta para cortar su ResizeObserver, y volver con
    // `regimeLoaded=true` dejaba el contenedor vacío.
    if (tab === 'regime') {
      const w = document.getElementById('regime-widget');
      const montado = w && window.AXIOM?.WidgetMount?.instancia(w);
      if (!this.regimeLoaded || !montado) this._loadRegime();
    }
    if (tab==='market' && !this.marketLoaded) this._loadMarket();
  },

  async _loadRegime() {
    const el = document.getElementById('sub-regime');
    if (!el.querySelector('#regime-widget')) {
      // Estructura fija: el widget se monta en su contenedor y lo demás
      // (señales, capital) se pinta alrededor. Así al recargar no se
      // reconstruye todo ni salta el scroll.
      el.innerHTML = `
        <div id="regime-widget" style="margin-bottom:20px;"></div>
        <div id="regime-signals"></div>
        <div id="capital-section" style="margin-top:8px;">
          <div class="placeholder" style="min-height:80px;">
            <i class="ti ti-refresh" style="font-size:24px;"></i>
          </div>
        </div>`;
    }

    try {
      const data = await API.getLatestRegime();
      const ts = new Date(data.created_at).toLocaleString('es-AR',
        {dateStyle:'short', timeStyle:'short'});
      document.getElementById('regime-ts').textContent = ts;

      if (!this._epistemico) this._cargarEpistemico();

      // Las tarjetas de régimen son el widget `regimen_mercado`: se montan acá
      // y Kepler puede montar el mismo en el chat.
      await AXIOM.WidgetMount.mount(
        document.getElementById('regime-widget'), 'regimen_mercado', {
          datos: data.regimes || data,
          contexto: 'pantalla',
          epistemico: this._epistemico,
        });

      // Las señales núcleo quedan en la pantalla: son el detalle de CÓMO se
      // llegó a ese régimen, no la lectura en sí.
      const sig = document.getElementById('regime-signals');
      if (sig) sig.innerHTML = this._renderSignalCards(data.signals);

      this.regimeLoaded = true;

      this._renderCapital().then(html => {
        const cap = document.getElementById('capital-section');
        if (cap && html) cap.innerHTML = html;
      });
    } catch(e) {
      el.innerHTML = `<div class="placeholder"><i class="ti ti-alert-circle"></i>
        <p>Error al cargar: ${e.message}</p></div>`;
    }
  },

  /** Declaración epistémica de `regimen_mercado`, para que el widget la exponga. */
  async _cargarEpistemico() {
    try {
      const r = await fetch('/api/capacidades/regimen_mercado');
      if (r.ok) this._epistemico = (await r.json()).epistemico || null;
    } catch(e) { /* sin declaración: el widget se muestra sin la nota */ }
  },

  async _loadMarket() {
    const el = document.getElementById('sub-market');
    el.innerHTML = MarketScreen.renderShell();
    this.marketLoaded = true;
    // Esperar a que el DOM procese el shell antes de cargar datos
    requestAnimationFrame(() => {
      MarketScreen.switchView('general');
    });
  },

  // Las tarjetas de régimen, el arco de convicción y los colores se movieron
  // al widget `regimen_mercado` (frontend/static/js/widgets/regimen.js).
  // Acá quedaban atados a esta pantalla; como widget, Kepler puede montarlos
  // en el chat y se adaptan al ancho del contenedor.
  //
  // _regimeColor y _regimeLabel se conservan porque los usan las cards de
  // señales, que siguen siendo propias de esta vista.
  _regimeColor(r) {
    return {
      ACUMULACION:'#2563EB', ALCISTA_A:'#56A14F', ALCISTA_B:'#B47514',
      DISTRIBUCION:'#D86326', BAJISTA:'#D93B3B',
      ALCISTA:'#56A14F', LATERAL:'#78716C',
    }[r] || '#78716C';
  },

  _tfCfg: {
    largo: {icon:'ti-clock-hour-4', color:'#2563EB', label:'Largo plazo'},
    medio: {icon:'ti-calendar-week',color:'#56A14F', label:'Medio plazo'},
    corto: {icon:'ti-bolt',         color:'#B47514', label:'Corto plazo'},
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

  async _renderCapital() {
    try {
      const data = await API.getCapitalSuggestion();
      return CapitalScreen.render(data);
    } catch(e) {
      return '';
    }
  },

};
