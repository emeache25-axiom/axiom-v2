const MarketScreen = {
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
    return `<span style="font-family:'IBM Plex Mono',monospace;font-size:12px;
                         font-weight:600;color:${color};">${sign}${n.toFixed(2)}%</span>`;
  },

  _avatar(symbol, imageUrl) {
    if (imageUrl) {
      return `<img src="${imageUrl}" alt="${symbol}"
        style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
        <div style="display:none;width:28px;height:28px;border-radius:50%;
          background:var(--c3);align-items:center;justify-content:center;
          font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:600;
          color:var(--t2);flex-shrink:0;">${symbol.slice(0,4)}</div>`;
    }
    return `<div style="width:28px;height:28px;border-radius:50%;
      background:var(--c3);display:flex;align-items:center;justify-content:center;
      font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:600;
      color:var(--t2);flex-shrink:0;">${symbol.slice(0,4)}</div>`;
  },

  _sectionHeader(icon, label, color) {
    return `
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:14px;">
      <div style="width:30px;height:30px;border-radius:7px;
                  background:${color}22;display:flex;align-items:center;justify-content:center;
                  flex-shrink:0;">
        <i class="ti ${icon}" style="font-size:15px;color:${color};" aria-hidden="true"></i>
      </div>
      <span style="font-size:14px;font-weight:600;color:#F5F0EB;
                   letter-spacing:-.01em;">${label}</span>
    </div>`;
  },

  _coinRow(c) {
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:8px 0;border-bottom:0.5px solid var(--w1);">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;">
        <div style="display:flex;flex-shrink:0;">
          ${this._avatar(c.symbol, c.image)}
        </div>
        <div style="min-width:0;">
          <div style="font-size:12px;font-weight:500;color:var(--t1);
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.name}</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;
                      color:var(--t3);">${this._price(c.price)}</div>
        </div>
      </div>
      ${this._change(c.change_24h)}
    </div>`;
  },

  _renderGainersLosers(gainers, losers) {
    return `
    <div class="market-gl-grid" style="margin-bottom:14px;">
      <div class="card" style="border-top:2px solid #56A14F;border-left:1px solid #56A14F40;
                                border-right:1px solid #56A14F40;border-bottom:1px solid #56A14F40;">
        ${this._sectionHeader('ti-trending-up', 'Top ganadoras 24h', '#56A14F')}
        ${gainers.map(c => this._coinRow(c)).join('')}
      </div>
      <div class="card" style="border-top:2px solid #D93B3B;border-left:1px solid #D93B3B40;
                                border-right:1px solid #D93B3B40;border-bottom:1px solid #D93B3B40;">
        ${this._sectionHeader('ti-trending-down', 'Top perdedoras 24h', '#D93B3B')}
        ${losers.map(c => this._coinRow(c)).join('')}
      </div>
    </div>`;
  },

  _renderTop10(coins) {
    const rows = coins.map((c,i) => `
    <div style="display:grid;grid-template-columns:24px 1fr 90px 70px 80px;gap:8px;
                align-items:center;padding:8px 0;border-bottom:0.5px solid var(--w1);">
      <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;
                   color:var(--t3);">${i+1}</span>
      <div style="display:flex;align-items:center;gap:6px;min-width:0;">
        <div style="display:flex;flex-shrink:0;">
          ${this._avatar(c.symbol, c.image)}
        </div>
        <span style="font-weight:500;color:var(--t1);font-size:12px;
                     white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.name}</span>
      </div>
      <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;
                   color:var(--t1);text-align:right;">${this._price(c.price)}</span>
      <span style="text-align:right;">${this._change(c.change_24h)}</span>
      <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;
                   color:var(--t3);text-align:right;">${this._fmt(c.market_cap)}</span>
    </div>`).join('');

    return `
    <div class="card" style="margin-bottom:14px;border-top:2px solid #B47514;
                              border-left:1px solid #B4751440;border-right:1px solid #B4751440;
                              border-bottom:1px solid #B4751440;">
      ${this._sectionHeader('ti-trophy', 'Top 10 por capitalización', '#B47514')}
      <div style="display:grid;grid-template-columns:24px 1fr 90px 70px 80px;gap:8px;
                  font-family:'IBM Plex Mono',monospace;font-size:9px;color:var(--t3);
                  text-transform:uppercase;letter-spacing:.08em;
                  padding-bottom:6px;border-bottom:1px solid var(--w1);">
        <span>#</span><span>Activo</span>
        <span style="text-align:right;">Precio</span>
        <span style="text-align:right;">24h</span>
        <span style="text-align:right;">MCap</span>
      </div>
      ${rows}
    </div>`;
  },

  _renderCategories(cats) {
    const max = cats[0]?.pct || 1;
    const rows = cats.map(c => `
    <div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
        <span style="font-size:12px;color:var(--t1);">${c.label}</span>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--t3);">
          ${c.pct}% · ${this._fmt(c.mcap)}
        </span>
      </div>
      <div style="height:4px;background:var(--c3);border-radius:2px;">
        <div style="height:4px;width:${(c.pct/max*100).toFixed(1)}%;
                    background:var(--cy);border-radius:2px;transition:width .4s;"></div>
      </div>
    </div>`).join('');

    return `
    <div class="card" style="border-top:2px solid #2563EB;border-left:1px solid #2563EB40;
                              border-right:1px solid #2563EB40;border-bottom:1px solid #2563EB40;">
      ${this._sectionHeader('ti-chart-pie', 'Distribución por categoría', '#2563EB')}
      ${rows}
    </div>`;
  },

  render(data) {
    return `
    <div style="max-width:900px;margin:0 auto;">
      ${this._renderGainersLosers(data.gainers, data.losers)}
      ${this._renderTop10(data.top10)}
      ${this._renderCategories(data.categories)}
    </div>`;
  },
};
