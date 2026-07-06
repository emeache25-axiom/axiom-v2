/**
 * AXIOM v2 — Pantalla Bot v2 (estrategias / paper-trading).
 *
 * 3 TABS:
 *   1. Activas       — estrategias instanciadas que operan en vivo + detalle/config/pares
 *   2. Estadísticas  — métricas de eficiencia (forward testing real) de las activas
 *   3. Backtesting   — laboratorio independiente: cualquier estrategia/par/tf/params/capital
 *
 * El tab Backtesting usa el endpoint independiente POST /api/strat/backtest.
 */
const BotScreen = (function () {
  'use strict';

  const fmt = (v, d = 2) => v == null ? '—' :
    (Math.abs(v) >= 1
      ? Number(v).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d })
      : Number(v).toPrecision(4));
  const pct = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + fmt(v) + '%';
  const money = (v) => v == null ? '—' : '$' + fmt(v);
  const col = (v) => v == null ? 'var(--t2)' : (v >= 0 ? '#56A14F' : '#D93B3B');

  const api = {
    catalog:    () => fetch('/api/strat/catalog').then(r => r.json()),
    list:       () => fetch('/api/strat/strategies').then(r => r.json()),
    create:     (b) => fetch('/api/strat/strategies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
    update:     (id, b) => fetch(`/api/strat/strategies/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
    remove:     (id) => fetch(`/api/strat/strategies/${id}`, { method: 'DELETE' }).then(r => r.json()),
    reset:      (id) => fetch(`/api/strat/strategies/${id}/reset`, { method: 'POST' }).then(r => r.json()),
    stats:      (id) => fetch(`/api/strat/strategies/${id}/stats`).then(r => r.json()),
    positions:  (id, s) => fetch(`/api/strat/strategies/${id}/positions${s ? '?status=' + s : ''}`).then(r => r.json()),
    pairs:      (id) => fetch(`/api/strat/strategies/${id}/pairs`).then(r => r.json()),
    setPairs:   (id, ids) => fetch(`/api/strat/strategies/${id}/pairs`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ watchlist_ids: ids }) }).then(r => r.json()),
    run:        () => fetch('/api/strat/run', { method: 'POST' }).then(r => r.json()),
    operablePairs:  () => fetch('/api/strat/pairs').then(r => r.json()),
    backtestFree:   (body) => fetch('/api/strat/backtest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
    allBacktests:   () => fetch('/api/strat/backtests').then(r => r.json()),
    getBacktest:    (btId) => fetch(`/api/strat/backtests/${btId}`).then(r => r.json()),
    deleteBacktest: (btId) => fetch(`/api/strat/backtests/${btId}`, { method: 'DELETE' }).then(r => r.json()),
  };

  function sparkline(curve, w = 120, h = 32) {
    if (!curve || curve.length < 2) return '';
    const min = Math.min(...curve), max = Math.max(...curve);
    const range = max - min || 1;
    const pts = curve.map((v, i) => {
      const x = (i / (curve.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const up = curve[curve.length - 1] >= curve[0];
    const stroke = up ? '#56A14F' : '#D93B3B';
    return `<svg width="${w}" height="${h}" style="display:block;width:100%;" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.5"/></svg>`;
  }

  const TABS = [
    { id: 'activas', label: 'Activas' },
    { id: 'stats', label: 'Estadísticas' },
    { id: 'backtest', label: 'Backtesting' },
    { id: 'orderbook', label: 'Order Book' },
  ];

  return {
    _tab: 'activas',
    _selectedId: null,
    _catalog: [],
    _pollTimer: null,

    async onEnter() {
      const el = document.getElementById('screen-bot');
      el.innerHTML = `<div class="placeholder"><i class="ti ti-robot"></i><p>Cargando...</p></div>`;
      try { this._catalog = (await api.catalog()).catalog || []; } catch (e) { this._catalog = []; }
      this._renderShell();
      this._switchTab(this._tab);
      this._pollTimer = setInterval(() => {
        if (this._tab === 'activas' || this._tab === 'stats') this._refreshActive();
      }, 20000);
    },

    onLeave() {
      if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
      window.AXIOM?.BotOrderBook?._stopPolling(); 
   },

    _renderShell() {
      const el = document.getElementById('screen-bot');
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:4px;border-bottom:0.5px solid var(--w1);margin-bottom:18px;">
          ${TABS.map(t => `<button id="bot-tab-${t.id}" data-tab="${t.id}" style="background:none;border:none;border-bottom:2px solid transparent;color:var(--t3);font-size:13px;font-weight:600;padding:10px 16px;cursor:pointer;">${t.label}</button>`).join('')}
        </div>
        <div id="bot-tab-content"></div>`;
      el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => this._switchTab(b.dataset.tab));
    },

    _switchTab(tab) {
      this._tab = tab;
      TABS.forEach(t => {
        const btn = document.getElementById(`bot-tab-${t.id}`);
        if (btn) {
          const active = t.id === tab;
          btn.style.borderBottomColor = active ? '#2563EB' : 'transparent';
          btn.style.color = active ? 'var(--t1)' : 'var(--t3)';
        }
      });
      if (tab === 'activas') this._renderActivas();
      else if (tab === 'stats') this._renderStats();
      else if (tab === 'backtest') this._renderBacktestLab();
    },

   _switchTab(tab) {
      // al salir de la tab order book, cortar su refresco
      if (this._tab === 'orderbook' && tab !== 'orderbook') {
        window.AXIOM?.BotOrderBook?._stopPolling();
      }
      this._tab = tab;
      TABS.forEach(t => {
        const btn = document.getElementById(`bot-tab-${t.id}`);
        if (btn) {
          const active = t.id === tab;
          btn.style.borderBottomColor = active ? '#2563EB' : 'transparent';
          btn.style.color = active ? 'var(--t1)' : 'var(--t3)';
        }
      });
      if (tab === 'activas') this._renderActivas();
      else if (tab === 'stats') this._renderStats();
      else if (tab === 'backtest') this._renderBacktestLab();
      else if (tab === 'orderbook') window.AXIOM.BotOrderBook.render('bot-tab-content');
    },    // ── TAB 1 — ACTIVAS ──────────────────────────────────────────────
    async _renderActivas() {
      const cont = document.getElementById('bot-tab-content');
      cont.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
          <div><div style="font-size:16px;font-weight:600;color:var(--t1);">Estrategias activas</div>
            <div style="font-size:12px;color:var(--t3);">Paper-trading en vivo</div></div>
          <button id="new-strat" style="padding:8px 16px;border-radius:8px;border:none;background:#2563EB;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">+ Nueva estrategia</button>
        </div>
        <div id="strat-dashboard" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;"></div>
        <div id="strat-detail"></div>`;
      document.getElementById('new-strat').onclick = () => this._openCatalog();

      let strategies = [];
      try { strategies = (await api.list()).strategies || []; } catch (e) {}
      if (this._selectedId == null && strategies.length) this._selectedId = strategies[0].id;

      this._renderDashboard(strategies);
      if (this._selectedId != null && strategies.length) {
        await this._renderDetail(this._selectedId);
      } else {
        document.getElementById('strat-detail').innerHTML =
          `<div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:12px;padding:32px;text-align:center;color:var(--t3);">No hay estrategias todavía. Creá una para empezar a operar en paper-trading.</div>`;
      }
    },

    _renderDashboard(strategies) {
      const cont = document.getElementById('strat-dashboard');
      if (!cont) return;
      if (!strategies.length) { cont.innerHTML = ''; return; }
      cont.innerHTML = strategies.map(s => {
        const st = s.stats || {};
        const sel = s.id === this._selectedId;
        const on = s.enabled;
        return `<div data-strat-card="${s.id}" style="cursor:pointer;flex:1;min-width:240px;max-width:340px;background:var(--surface);border:1px solid ${sel ? '#2563EB' : 'var(--w1)'};border-radius:12px;padding:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:7px;min-width:0;">
              <span style="width:8px;height:8px;border-radius:50%;background:${on ? '#56A14F' : '#57534E'};flex-shrink:0;"></span>
              <span style="font-size:13px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name}</span>
            </div>
            <span style="font-size:10px;color:var(--t3);white-space:nowrap;">${s.timeframe || ''}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8px;">
            <div><div style="font-size:11px;color:var(--t3);">Equity</div>
              <div style="font-size:18px;font-weight:600;color:var(--t1);font-family:var(--f2);">${money(st.equity)}</div></div>
            <div style="text-align:right;"><div style="font-size:15px;font-weight:600;font-family:var(--f2);color:${col(st.total_return)};">${pct(st.total_return)}</div></div>
          </div>
          ${sparkline(st.equity_curve)}
          <div style="display:flex;gap:12px;margin-top:8px;font-size:11px;color:var(--t3);">
            <span>Win <b style="color:var(--t2);">${fmt(st.win_rate, 1)}%</b></span>
            <span>PF <b style="color:var(--t2);">${st.profit_factor != null ? fmt(st.profit_factor) : '—'}</b></span>
            <span>Trades <b style="color:var(--t2);">${st.trades_total ?? 0}</b></span>
          </div>
        </div>`;
      }).join('');
      cont.querySelectorAll('[data-strat-card]').forEach(c =>
        c.onclick = () => { this._selectedId = +c.dataset.stratCard; this._renderActivas(); });
    },

    async _renderDetail(id) {
      const cont = document.getElementById('strat-detail');
      if (!cont) return;
      cont.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3);">Cargando detalle...</div>`;
      let stats = {}, openPos = [], pairs = [];
      try {
        const [s, op, pr] = await Promise.all([api.stats(id), api.positions(id, 'open'), api.pairs(id)]);
        stats = s.stats || {}; openPos = op.positions || []; pairs = pr.pairs || [];
      } catch (e) {}
      cont.innerHTML = `${this._detailHeader(id, stats)}${this._pairsSection(id, pairs)}${this._positionsSection(openPos)}`;
      this._wireDetail(id, stats);
    },

    _detailHeader(id, stats) {
      const on = stats.enabled;
      return `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:0.5px solid var(--w1);">
        <div style="font-size:15px;font-weight:600;color:var(--t1);">${stats.name || 'Estrategia'}</div>
        <div style="display:flex;gap:8px;">
          <button id="d-toggle" style="padding:7px 14px;border-radius:7px;border:none;font-size:12px;font-weight:600;cursor:pointer;background:${on ? '#D93B3B' : '#56A14F'};color:#fff;">${on ? 'Detener' : 'Iniciar'}</button>
          <button id="d-config" style="padding:7px 11px;border-radius:7px;border:0.5px solid var(--w1);background:transparent;color:var(--t3);font-size:12px;cursor:pointer;"><i class="ti ti-settings"></i></button>
          <button id="d-run" title="Ejecutar ciclo ahora" style="padding:7px 11px;border-radius:7px;border:0.5px solid var(--w1);background:transparent;color:var(--t2);font-size:12px;cursor:pointer;"><i class="ti ti-player-play"></i></button>
          <button id="d-reset" title="Reiniciar" style="padding:7px 11px;border-radius:7px;border:0.5px solid var(--w1);background:transparent;color:#D93B3B;font-size:12px;cursor:pointer;"><i class="ti ti-refresh"></i></button>
          <button id="d-delete" title="Eliminar" style="padding:7px 11px;border-radius:7px;border:0.5px solid var(--w1);background:transparent;color:#D93B3B;font-size:12px;cursor:pointer;"><i class="ti ti-trash"></i></button>
        </div></div>`;
    },

    _pairsSection(id, pairs) {
      const rows = pairs.length ? pairs.map(p => `
        <label style="display:flex;align-items:center;gap:9px;padding:8px 12px;border-bottom:0.5px solid var(--w1);cursor:pointer;">
          <input type="checkbox" data-pair="${p.watchlist_id}" ${p.associated ? 'checked' : ''} style="width:15px;height:15px;accent-color:#2563EB;cursor:pointer;">
          <span style="flex:1;font-size:13px;color:var(--t1);">${p.base}/${p.quote}</span>
          <span style="font-size:11px;color:var(--t3);">${p.exchange}</span>
          ${p.bot_enabled ? '' : '<span style="font-size:10px;color:#C77;">bot off</span>'}
        </label>`).join('')
        : `<div style="padding:16px;text-align:center;color:var(--t3);font-size:12px;">No hay pares operables. Agregalos en la Watchlist (mexc/coinex).</div>`;
      return `<div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:13px;font-weight:600;color:var(--t1);">Pares operados</span>
          <button id="save-pairs" style="font-size:11px;border:none;background:var(--c2);color:var(--t1);border-radius:6px;padding:5px 12px;cursor:pointer;">Guardar selección</button>
        </div>
        <div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:10px;overflow:hidden;">${rows}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:6px;">El bot opera los pares tildados que además tengan el ícono de bot activo en la Watchlist.</div></div>`;
    },

    _positionsSection(positions) {
      const body = positions.length ? positions.map(p => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 13px;border-bottom:0.5px solid var(--w1);font-size:12px;">
          <span style="flex:1;font-weight:600;color:var(--t1);">${p.base}/${p.quote} <span style="font-weight:400;color:var(--t3);">${p.exchange}</span></span>
          <span style="font-family:var(--f2);color:var(--t2);">Entr ${money(p.entry_price)}</span>
          <span style="font-family:var(--f2);color:var(--t3);">Stop ${money(p.stop_price)}</span>
          ${p.take_price ? `<span style="font-family:var(--f2);color:var(--t3);">TP ${money(p.take_price)}</span>` : ''}
        </div>`).join('') : `<div style="padding:16px;text-align:center;color:var(--t3);font-size:12px;">Sin posiciones abiertas</div>`;
      return `<div style="margin-bottom:20px;">
        <div style="font-size:13px;font-weight:600;color:var(--t1);margin-bottom:8px;">Posiciones abiertas</div>
        <div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:10px;overflow:hidden;">${body}</div></div>`;
    },

    _wireDetail(id, stats) {
      document.getElementById('d-toggle').onclick = async () => { await api.update(id, { enabled: !stats.enabled }); this._renderActivas(); };
      document.getElementById('d-config').onclick = () => this._openConfig(id);
      document.getElementById('d-run').onclick = async (e) => {
        const b = e.currentTarget; b.disabled = true; b.innerHTML = '<i class="ti ti-loader"></i>';
        await api.run().catch(() => {});
        await this._renderDetail(id);
      };
      document.getElementById('d-reset').onclick = async () => {
        if (confirm('¿Reiniciar esta estrategia? Se borran sus posiciones e historial.')) { await api.reset(id); this._renderActivas(); }
      };
      document.getElementById('d-delete').onclick = async () => {
        if (confirm('¿Eliminar esta estrategia y todo su historial?')) { await api.remove(id); this._selectedId = null; this._renderActivas(); }
      };
      const saveBtn = document.getElementById('save-pairs');
      if (saveBtn) saveBtn.onclick = async () => {
        const ids = [...document.querySelectorAll('[data-pair]:checked')].map(c => +c.dataset.pair);
        await api.setPairs(id, ids);
        saveBtn.textContent = '✓ Guardado';
        setTimeout(() => { saveBtn.textContent = 'Guardar selección'; }, 1500);
      };
    },

    async _refreshActive() {
      if (this._tab === 'activas') {
        try { this._renderDashboard((await api.list()).strategies || []); } catch (e) {}
      } else if (this._tab === 'stats') {
        this._renderStats();
      }
    },

    // ── TAB 2 — ESTADÍSTICAS ─────────────────────────────────────────
    async _renderStats() {
      const cont = document.getElementById('bot-tab-content');
      cont.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3);">Cargando estadísticas...</div>`;
      let strategies = [];
      try { strategies = (await api.list()).strategies || []; } catch (e) {}
      if (!strategies.length) {
        cont.innerHTML = `<div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:12px;padding:32px;text-align:center;color:var(--t3);">No hay estrategias activas para mostrar estadísticas.</div>`;
        return;
      }
      const blocks = strategies.map(s => {
        const st = s.stats || {};
        return `<div style="margin-bottom:24px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${s.enabled ? '#56A14F' : '#57534E'};"></span>
            <span style="font-size:14px;font-weight:600;color:var(--t1);">${s.name}</span>
            <span style="font-size:11px;color:var(--t3);">${s.timeframe || ''}</span>
          </div>
          ${this._metricsGrid(st)}
          ${st.equity_curve && st.equity_curve.length > 1 ? `<div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:10px;padding:14px;margin-top:10px;"><div style="font-size:11px;color:var(--t3);margin-bottom:6px;">Curva de equity (forward testing real)</div>${sparkline(st.equity_curve, 600, 80)}</div>` : ''}
        </div>`;
      }).join('');
      cont.innerHTML = `
        <div style="font-size:16px;font-weight:600;color:var(--t1);margin-bottom:4px;">Estadísticas de eficiencia</div>
        <div style="font-size:12px;color:var(--t3);margin-bottom:18px;">Resultados reales de las estrategias operando en vivo.</div>${blocks}`;
    },

    _metricsGrid(s) {
      const m = (label, val, c) => `<div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:9px;padding:11px 13px;"><div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;">${label}</div><div style="font-size:15px;font-weight:600;font-family:var(--f2);color:${c || 'var(--t1)'};">${val}</div></div>`;
      return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;">
        ${m('Equity', money(s.equity))}
        ${m('Balance libre', money(s.balance))}
        ${m('Retorno', pct(s.total_return), col(s.total_return))}
        ${m('P&L realizado', money(s.realized_pnl), col(s.realized_pnl))}
        ${m('P&L no real.', money(s.unrealized_pnl), col(s.unrealized_pnl))}
        ${m('Win rate', fmt(s.win_rate, 1) + '%')}
        ${m('Profit factor', s.profit_factor != null ? fmt(s.profit_factor) : '∞')}
        ${m('Expectancy', money(s.expectancy), col(s.expectancy))}
        ${m('Max drawdown', fmt(s.max_drawdown, 1) + '%', '#D93B3B')}
        ${m('Sharpe', fmt(s.sharpe))}
        ${m('Mejor trade', money(s.best_trade), '#56A14F')}
        ${m('Peor trade', money(s.worst_trade), '#D93B3B')}
        ${m('Racha + / −', `${s.max_win_streak ?? 0} / ${s.max_loss_streak ?? 0}`)}
        ${m('Duración media', (s.avg_duration_min ?? 0) + ' min')}
        ${m('Trades', `${s.trades_total ?? 0} (${s.trades_open ?? 0} ab.)`)}
      </div>`;
    },

    // ── TAB 3 — BACKTESTING (laboratorio) ────────────────────────────
    async _renderBacktestLab() {
      const cont = document.getElementById('bot-tab-content');
      let known = [];
      try { known = (await api.operablePairs()).pairs || []; } catch (e) {}
      const catOptions = this._catalog.map(c => `<option value="${c.key}">${c.name}</option>`).join('');
      const tfOptions = ['1m','5m','15m','30m','1h','4h','1d'].map(t => `<option value="${t}">${t}</option>`).join('');
      const pairDatalist = known.map(p => `<option value="${p.pair_symbol}">`).join('');

      cont.innerHTML = `
        <div style="font-size:16px;font-weight:600;color:var(--t1);margin-bottom:4px;">Laboratorio de backtesting</div>
        <div style="font-size:12px;color:var(--t3);margin-bottom:18px;">Probá cualquier estrategia sobre cualquier par y temporalidad. Independiente del bot en vivo.</div>
        <div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:12px;padding:16px;margin-bottom:16px;">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px;">
            <div><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Estrategia</label>
              <select id="lab-strat" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;">${catOptions}</select></div>
            <div><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Par (símbolo)</label>
              <input id="lab-pair" list="lab-pairs" placeholder="BTCUSDT" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;font-family:var(--f2);text-transform:uppercase;">
              <datalist id="lab-pairs">${pairDatalist}</datalist></div>
            <div><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Exchange</label>
              <select id="lab-ex" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;"><option value="mexc">mexc</option><option value="coinex">coinex</option></select></div>
            <div><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Temporalidad</label>
              <select id="lab-tf" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;">${tfOptions}</select></div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:14px;">
            <div><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Capital inicial</label>
              <input id="lab-cap" type="number" value="10000" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;"></div>
            <div><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Monto/trade</label>
              <input id="lab-amt" type="number" value="250" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;"></div>
            <div><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Stop %</label>
              <input id="lab-sl" type="number" step="0.1" value="2.0" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;"></div>
            <div><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Profundidad</label>
              <select id="lab-target" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;"><option value="3000">~3k velas</option><option value="5000">~5k velas</option><option value="10000" selected>~10k velas</option><option value="20000">~20k velas</option></select></div>
          </div>
          <div id="lab-params" style="margin-bottom:14px;"></div>
          <button id="lab-run" style="padding:9px 20px;border-radius:8px;border:none;background:#2563EB;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">Correr backtest</button>
        </div>
        <div id="lab-result" style="margin-bottom:18px;"></div>
        <div id="lab-history"></div>`;

      const stratSel = document.getElementById('lab-strat');
      const renderParams = () => {
        const plugin = this._catalog.find(c => c.key === stratSel.value);
        const pc = document.getElementById('lab-params');
        if (!plugin) { pc.innerHTML = ''; return; }
        document.getElementById('lab-tf').value = plugin.timeframe;
        pc.innerHTML = `<div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:8px;">Parámetros</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;">
          ${plugin.params.map(p => `<div style="display:flex;align-items:center;gap:8px;"><label style="flex:1;font-size:12px;color:var(--t2);">${p.label}</label><input data-lparam="${p.key}" type="number" step="${p.step || 1}" value="${p.default}" style="width:80px;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:5px 8px;font-size:12px;font-family:var(--f2);"></div>`).join('')}</div>`;
      };
      stratSel.onchange = renderParams;
      renderParams();
      document.getElementById('lab-run').onclick = () => this._runLabBacktest();
      this._loadLabHistory();
    },

    async _runLabBacktest() {
      const btn = document.getElementById('lab-run');
      const out = document.getElementById('lab-result');
      const pair = (document.getElementById('lab-pair').value || '').trim().toUpperCase();
      if (!pair) { out.innerHTML = `<div style="color:#D93B3B;font-size:12px;">Ingresá un par (ej. BTCUSDT)</div>`; return; }
      const params = {};
      document.querySelectorAll('[data-lparam]').forEach(i => params[i.dataset.lparam] = parseFloat(i.value));
      const body = {
        strategy_key: document.getElementById('lab-strat').value,
        pair_symbol: pair,
        exchange: document.getElementById('lab-ex').value,
        timeframe: document.getElementById('lab-tf').value,
        params,
        initial_balance: parseFloat(document.getElementById('lab-cap').value),
        trade_amount: parseFloat(document.getElementById('lab-amt').value),
        stop_loss_pct: parseFloat(document.getElementById('lab-sl').value),
        target: parseInt(document.getElementById('lab-target').value),
        save: true,
      };
      btn.disabled = true; btn.textContent = 'Corriendo...';
      out.innerHTML = `<div style="padding:16px;text-align:center;color:var(--t3);font-size:12px;">Trayendo histórico y simulando...</div>`;
      try {
        const r = await api.backtestFree(body);
        const bt = r.backtest || {};
        if (bt.error || r.detail) {
          out.innerHTML = `<div style="padding:14px;color:#D93B3B;font-size:12px;">${bt.error || r.detail}</div>`;
        } else {
          this._renderBtResult(out, bt);
          this._loadLabHistory();
        }
      } catch (e) {
        out.innerHTML = `<div style="padding:14px;color:#D93B3B;font-size:12px;">Error al correr el backtest</div>`;
      }
      btn.disabled = false; btn.textContent = 'Correr backtest';
    },

    _renderBtResult(out, bt) {
      if (!out) return;
      const m = (label, val, c) => `<div style="background:var(--bg);border:0.5px solid var(--w1);border-radius:8px;padding:9px 11px;"><div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.03em;margin-bottom:3px;">${label}</div><div style="font-size:14px;font-weight:600;font-family:var(--f2);color:${c || 'var(--t1)'};">${val}</div></div>`;
      const period = (bt.period_from && bt.period_to) ? `${new Date(bt.period_from).toLocaleDateString('es-AR')} → ${new Date(bt.period_to).toLocaleDateString('es-AR')}` : '';
      out.innerHTML = `
        <div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:10px;padding:14px;">
          <div style="font-size:11px;color:var(--t3);margin-bottom:10px;">${bt.pair_symbol} · ${bt.exchange} · ${bt.timeframe} · ${bt.candles_used} velas · ${period}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:12px;">
            ${m('Retorno', pct(bt.total_return), col(bt.total_return))}
            ${m('Trades', bt.trades_total)}
            ${m('Win rate', fmt(bt.win_rate, 1) + '%')}
            ${m('Profit factor', bt.profit_factor != null ? fmt(bt.profit_factor) : '∞', (bt.profit_factor >= 1 ? '#56A14F' : '#D93B3B'))}
            ${m('Expectancy', money(bt.expectancy), col(bt.expectancy))}
            ${m('Max DD', fmt(bt.max_drawdown, 1) + '%', '#D93B3B')}
            ${m('Sharpe', fmt(bt.sharpe))}
            ${m('Mejor/Peor', money(bt.best_trade) + ' / ' + money(bt.worst_trade))}
          </div>
          ${bt.equity_curve && bt.equity_curve.length > 1 ? `<div style="margin-bottom:10px;">${sparkline(bt.equity_curve, 600, 80)}</div>` : ''}
          ${this._tradesTable(bt.trades || [])}
        </div>`;
    },

    _tradesTable(trades) {
      if (!trades.length) return `<div style="color:var(--t3);font-size:12px;">Sin trades en el período.</div>`;
      const rows = trades.slice(-50).reverse().map(t => {
        const fd = (ts) => new Date(ts * 1000).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:0.5px solid var(--w1);font-size:11px;">
          <span style="color:var(--t3);font-family:var(--f2);">${fd(t.entry_time)}</span>
          <span style="flex:1;color:var(--t3);font-family:var(--f2);">${money(t.entry_price)}→${money(t.exit_price)}</span>
          <span style="min-width:60px;text-align:right;font-family:var(--f2);color:${col(t.pnl)};">${money(t.pnl)}</span>
          <span style="min-width:54px;text-align:right;font-family:var(--f2);color:${col(t.pnl)};">${pct(t.pnl_pct)}</span>
          <span style="min-width:70px;text-align:right;color:var(--t3);font-size:10px;">${t.reason || ''}</span>
        </div>`;
      }).join('');
      return `<div style="max-height:240px;overflow-y:auto;border-top:0.5px solid var(--w1);padding-top:8px;"><div style="font-size:11px;color:var(--t3);margin-bottom:4px;">Últimos trades (${trades.length} total)</div>${rows}</div>`;
    },

    async _loadLabHistory() {
      const cont = document.getElementById('lab-history');
      if (!cont) return;
      let list = [];
      try { list = (await api.allBacktests()).backtests || []; } catch (e) {}
      if (!list.length) { cont.innerHTML = ''; return; }
      const rows = list.map(b => {
        const pf = b.profit_factor != null ? fmt(b.profit_factor) : '∞';
        const d = new Date(b.created_at).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:0.5px solid var(--w1);font-size:11px;">
          <span data-bt-view="${b.id}" style="flex:1;cursor:pointer;color:var(--t2);">${d} · <b style="color:var(--t1);">${b.strategy_name || b.strategy_key}</b> · ${b.pair_symbol} ${b.timeframe} · ${b.trades_total} tr</span>
          <span style="min-width:60px;text-align:right;font-family:var(--f2);color:${col(b.total_return)};">${pct(b.total_return)}</span>
          <span style="min-width:50px;text-align:right;font-family:var(--f2);color:${(b.profit_factor>=1?'#56A14F':'#D93B3B')};">PF ${pf}</span>
          <i data-bt-del="${b.id}" class="ti ti-x" style="cursor:pointer;color:#D93B3B;font-size:13px;"></i>
        </div>`;
      }).join('');
      cont.innerHTML = `<div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:10px;overflow:hidden;"><div style="padding:9px 11px;font-size:12px;font-weight:600;color:var(--t1);border-bottom:0.5px solid var(--w1);">Backtests guardados</div>${rows}</div>`;
      cont.querySelectorAll('[data-bt-view]').forEach(el => el.onclick = async () => {
        const r = await api.getBacktest(+el.dataset.btView).catch(() => ({}));
        if (r.backtest) { this._renderBtResult(document.getElementById('lab-result'), r.backtest); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      });
      cont.querySelectorAll('[data-bt-del]').forEach(el => el.onclick = async () => {
        await api.deleteBacktest(+el.dataset.btDel).catch(() => {});
        this._loadLabHistory();
      });
    },

    // ── Modales ──────────────────────────────────────────────────────
    _openCatalog() {
      const m = document.createElement('div');
      m.style.cssText = 'position:fixed;inset:0;z-index:800;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
      const cards = this._catalog.map(c => `<div data-pick="${c.key}" style="cursor:pointer;border:0.5px solid var(--w1);border-radius:10px;padding:14px;margin-bottom:10px;background:var(--bg);"><div style="font-size:14px;font-weight:600;color:var(--t1);margin-bottom:3px;">${c.name}</div><div style="font-size:11px;color:var(--t3);margin-bottom:4px;">${c.timeframe} · ${c.params.length} parámetros</div><div style="font-size:12px;color:var(--t2);">${c.description}</div></div>`).join('');
      m.innerHTML = `<div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:12px;width:min(480px,100%);max-height:calc(100vh - 80px);display:flex;flex-direction:column;"><div style="padding:16px 18px;border-bottom:0.5px solid var(--w1);display:flex;justify-content:space-between;align-items:center;"><span style="font-size:14px;font-weight:600;color:var(--t1);">Elegí una estrategia</span><button id="cat-x" style="border:none;background:var(--c2);color:var(--t3);width:26px;height:26px;border-radius:50%;cursor:pointer;">✕</button></div><div style="padding:16px;overflow-y:auto;">${cards || '<div style="color:var(--t3);text-align:center;">Sin estrategias disponibles</div>'}</div></div>`;
      document.body.appendChild(m);
      m.onclick = (e) => { if (e.target === m) m.remove(); };
      m.querySelector('#cat-x').onclick = () => m.remove();
      m.querySelectorAll('[data-pick]').forEach(c => c.onclick = () => { m.remove(); this._openCreate(c.dataset.pick); });
    },

    _openCreate(key) {
      const plugin = this._catalog.find(c => c.key === key);
      if (!plugin) return;
      const m = document.createElement('div');
      m.style.cssText = 'position:fixed;inset:0;z-index:800;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
      m.innerHTML = `<div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:12px;width:min(420px,100%);max-height:calc(100vh - 80px);display:flex;flex-direction:column;">
        <div style="padding:16px 18px;border-bottom:0.5px solid var(--w1);font-size:14px;font-weight:600;color:var(--t1);">Nueva: ${plugin.name}</div>
        <div style="padding:18px;overflow-y:auto;">
          <label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Nombre</label>
          <input id="c-name" value="${plugin.name}" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;margin-bottom:14px;">
          <div style="display:flex;gap:10px;margin-bottom:14px;">
            <div style="flex:1;"><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Capital inicial</label><input id="c-cap" type="number" value="10000" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;"></div>
            <div style="flex:1;"><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Monto/trade</label><input id="c-amt" type="number" value="200" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;"></div>
            <div style="flex:1;"><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Máx pos.</label><input id="c-max" type="number" value="5" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;"></div>
          </div>
          <div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:8px;">Parámetros de la estrategia</div>
          <div id="c-params">${plugin.params.map(p => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><label style="flex:1;font-size:12px;color:var(--t2);">${p.label}</label><input data-param="${p.key}" type="number" step="${p.step || 1}" value="${p.default}" style="width:90px;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:5px 8px;font-size:12px;font-family:var(--f2);"></div>`).join('')}</div>
        </div>
        <div style="padding:14px 18px;border-top:0.5px solid var(--w1);display:flex;gap:8px;justify-content:flex-end;">
          <button id="c-cancel" style="padding:7px 14px;border-radius:6px;border:0.5px solid var(--w1);background:transparent;color:var(--t3);font-size:12px;cursor:pointer;">Cancelar</button>
          <button id="c-save" style="padding:7px 16px;border-radius:6px;border:none;background:#2563EB;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Crear</button>
        </div></div>`;
      document.body.appendChild(m);
      m.onclick = (e) => { if (e.target === m) m.remove(); };
      m.querySelector('#c-cancel').onclick = () => m.remove();
      m.querySelector('#c-save').onclick = async () => {
        const params = {};
        m.querySelectorAll('[data-param]').forEach(i => params[i.dataset.param] = parseFloat(i.value));
        const body = {
          key, name: m.querySelector('#c-name').value.trim() || plugin.name,
          initial_balance: parseFloat(m.querySelector('#c-cap').value),
          trade_amount: parseFloat(m.querySelector('#c-amt').value),
          max_positions: parseInt(m.querySelector('#c-max').value),
          params,
        };
        const res = await api.create(body);
        m.remove();
        if (res.strategy) this._selectedId = res.strategy.id;
        this._renderActivas();
      };
    },

    _openConfig(id) {
      api.list().then(({ strategies }) => {
        const s = (strategies || []).find(x => x.id === id);
        if (!s) return;
        const plugin = this._catalog.find(c => c.key === s.key);
        const m = document.createElement('div');
        m.style.cssText = 'position:fixed;inset:0;z-index:800;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
        m.innerHTML = `<div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:12px;width:min(420px,100%);max-height:calc(100vh - 80px);display:flex;flex-direction:column;">
          <div style="padding:16px 18px;border-bottom:0.5px solid var(--w1);font-size:14px;font-weight:600;color:var(--t1);">Configurar: ${s.name}</div>
          <div style="padding:18px;overflow-y:auto;">
            <div style="display:flex;gap:10px;margin-bottom:14px;">
              <div style="flex:1;"><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Monto/trade</label><input id="e-amt" type="number" value="${s.trade_amount}" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;"></div>
              <div style="flex:1;"><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Máx pos.</label><input id="e-max" type="number" value="${s.max_positions}" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;"></div>
              <div style="flex:1;"><label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Stop %</label><input id="e-sl" type="number" step="0.1" value="${s.stop_loss_pct}" style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;"></div>
            </div>
            <div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:8px;">Parámetros</div>
            <div>${(plugin ? plugin.params : []).map(p => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><label style="flex:1;font-size:12px;color:var(--t2);">${p.label}</label><input data-eparam="${p.key}" type="number" step="${p.step || 1}" value="${s.params[p.key] ?? p.default}" style="width:90px;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:5px 8px;font-size:12px;font-family:var(--f2);"></div>`).join('')}</div>
          </div>
          <div style="padding:14px 18px;border-top:0.5px solid var(--w1);display:flex;gap:8px;justify-content:flex-end;">
            <button id="e-cancel" style="padding:7px 14px;border-radius:6px;border:0.5px solid var(--w1);background:transparent;color:var(--t3);font-size:12px;cursor:pointer;">Cancelar</button>
            <button id="e-save" style="padding:7px 16px;border-radius:6px;border:none;background:#2563EB;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Guardar</button>
          </div></div>`;
        document.body.appendChild(m);
        m.onclick = (e) => { if (e.target === m) m.remove(); };
        m.querySelector('#e-cancel').onclick = () => m.remove();
        m.querySelector('#e-save').onclick = async () => {
          const params = {};
          m.querySelectorAll('[data-eparam]').forEach(i => params[i.dataset.eparam] = parseFloat(i.value));
          await api.update(id, {
            trade_amount: parseFloat(m.querySelector('#e-amt').value),
            max_positions: parseInt(m.querySelector('#e-max').value),
            stop_loss_pct: parseFloat(m.querySelector('#e-sl').value),
            params,
          });
          m.remove();
          this._renderDetail(id);
        };
      });
    },
  };
})();
