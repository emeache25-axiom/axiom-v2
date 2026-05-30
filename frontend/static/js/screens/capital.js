const CapitalScreen = {
  onEnter() {},

  _regimeLabel(r) {
    return {
      ACUMULACION:'Acumulación', ALCISTA_A:'Alcista temprano',
      ALCISTA_B:'Alcista tardío', DISTRIBUCION:'Distribución',
      BAJISTA:'Bajista', ALCISTA:'Alcista', LATERAL:'Lateral',
    }[r] || r;
  },

  _regimeColor(r) {
    return {
      ACUMULACION:'#2563EB', ALCISTA_A:'#56A14F', ALCISTA_B:'#B47514',
      DISTRIBUCION:'#D86326', BAJISTA:'#D93B3B',
      ALCISTA:'#56A14F', LATERAL:'#78716C',
    }[r] || '#78716C';
  },

  _tfCfg: {
    largo: {icon:'ti-clock-hour-4', color:'#2563EB', label:'Largo plazo'},
    medio: {icon:'ti-calendar-week', color:'#56A14F', label:'Medio plazo'},
    corto: {icon:'ti-bolt',          color:'#B47514', label:'Corto plazo'},
  },

  _allocationColor(key) {
    return {
      largo:'#2563EB', medio:'#56A14F',
      corto:'#B47514', stables:'#78716C',
    }[key] || '#78716C';
  },

  _allocationLabel(key) {
    return {
      largo:'Largo plazo', medio:'Medio plazo',
      corto:'Corto plazo', stables:'Stables',
    }[key] || key;
  },

  _allocationIcon(key) {
    return {
      largo:'ti-clock-hour-4', medio:'ti-calendar-week',
      corto:'ti-bolt',         stables:'ti-shield',
    }[key] || 'ti-circle';
  },

  _renderAllocation(allocation) {
    const order = ['largo','medio','corto','stables'];
    const bars  = order.map(key => {
      const pct   = allocation[key];
      const color = this._allocationColor(key);
      const label = this._allocationLabel(key);
      const icon  = this._allocationIcon(key);
      return `
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;
                    margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:7px;">
            <div style="width:24px;height:24px;border-radius:5px;
                        background:${color}22;display:flex;align-items:center;
                        justify-content:center;flex-shrink:0;">
              <i class="ti ${icon}" style="font-size:12px;color:${color};"
                 aria-hidden="true"></i>
            </div>
            <span style="font-size:13px;font-weight:500;color:#F5F0EB;">${label}</span>
          </div>
          <span style="font-family:'IBM Plex Mono',monospace;font-size:16px;
                       font-weight:700;color:${color};">${pct}%</span>
        </div>
        <div style="height:6px;background:var(--c3);border-radius:3px;">
          <div style="height:6px;width:${pct}%;background:${color};
                      border-radius:3px;transition:width .5s ease;"></div>
        </div>
      </div>`;
    }).join('');

    return `
    <div class="card" style="border-top:2px solid #2563EB;border-left:1px solid #2563EB40;
                              border-right:1px solid #2563EB40;border-bottom:1px solid #2563EB40;
                              margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:20px;">
        <div style="width:30px;height:30px;border-radius:7px;background:#2563EB22;
                    display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="ti ti-adjustments" style="font-size:15px;color:#2563EB;"
             aria-hidden="true"></i>
        </div>
        <span style="font-size:14px;font-weight:600;color:#F5F0EB;">
          Distribución sugerida
        </span>
      </div>
      ${bars}
    </div>`;
  },

  _renderContext(context, regime) {
    const color = this._regimeColor(regime);
    return `
    <div class="card" style="border-top:2px solid ${color};border-left:1px solid ${color}40;
                              border-right:1px solid ${color}40;border-bottom:1px solid ${color}40;
                              margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:14px;">
        <div style="width:30px;height:30px;border-radius:7px;background:${color}22;
                    display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="ti ti-info-circle" style="font-size:15px;color:${color};"
             aria-hidden="true"></i>
        </div>
        <span style="font-size:14px;font-weight:600;color:#F5F0EB;">
          Por qué esta distribución
        </span>
      </div>
      <p style="font-size:13px;color:var(--t2);line-height:1.6;">${context}</p>
    </div>`;
  },

  _renderRegimeSummary(regimes) {
    const order = ['largo','medio','corto'];
    const items = order.map(tf => {
      const r    = regimes[tf];
      const cfg  = this._tfCfg[tf];
      const rCol = this._regimeColor(r.regime);
      const conf = r.is_confirmed
        ? `<span style="font-size:10px;color:#56A14F;font-family:'IBM Plex Mono',monospace;">
             ✓</span>`
        : '';
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:10px 0;border-bottom:0.5px solid var(--w1);">
        <div style="display:flex;align-items:center;gap:7px;">
          <i class="ti ${cfg.icon}" style="font-size:13px;color:${cfg.color};"
             aria-hidden="true"></i>
          <span style="font-size:12px;color:var(--t3);font-family:'IBM Plex Mono',monospace;
                       text-transform:uppercase;letter-spacing:.08em;">${cfg.label}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:13px;font-weight:600;color:${rCol};">
            ${this._regimeLabel(r.regime)}
          </span>
          <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;
                       color:var(--t3);">${r.conviction}%</span>
          ${conf}
        </div>
      </div>`;
    }).join('');

    return `
    <div class="card" style="border-top:2px solid var(--w2);margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:14px;">
        <div style="width:30px;height:30px;border-radius:7px;background:var(--c3);
                    display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="ti ti-chart-bar" style="font-size:15px;color:var(--t3);"
             aria-hidden="true"></i>
        </div>
        <span style="font-size:14px;font-weight:600;color:#F5F0EB;">
          Contexto de regímenes
        </span>
      </div>
      ${items}
    </div>`;
  },

  render(data) {
    const rLargo = this._regimeLabel(data.regimes.largo.regime);
    const rColor = this._regimeColor(data.regimes.largo.regime);

    return `
    <div style="max-width:700px;margin:0 auto;">
      <div style="margin-bottom:20px;">
        <div style="font-size:12px;color:var(--t3);margin-bottom:4px;">
          Basado en régimen largo
        </div>
        <div style="font-size:22px;font-weight:700;color:${rColor};">
          ${rLargo}
        </div>
      </div>
      ${this._renderAllocation(data.allocation)}
      ${this._renderContext(data.context, data.regimes.largo.regime)}
      ${this._renderRegimeSummary(data.regimes)}
    </div>`;
  },
};
