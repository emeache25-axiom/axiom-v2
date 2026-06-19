/**
 * AXIOM v2 — Pantalla Bot (paper-trading)
 * Estado/config, stats (balance, equity, P&L, win rate), posiciones abiertas
 * con P&L en vivo, historial de cerradas, y constructor de reglas entry/exit.
 */
const BotScreen = (function () {
  'use strict';

  // Campos disponibles para construir condiciones
  const REGIMES_LM = ['ACUMULACION', 'ALCISTA_A', 'ALCISTA_B', 'DISTRIBUCION', 'BAJISTA'];
  const REGIMES_C  = ['ALCISTA', 'LATERAL', 'BAJISTA'];
  const FIELDS = {
    regimen_largo:    { label: 'Régimen largo',    type: 'regime', regimes: REGIMES_LM },
    regimen_medio:    { label: 'Régimen medio',    type: 'regime', regimes: REGIMES_LM },
    regimen_corto:    { label: 'Régimen corto',    type: 'regime', regimes: REGIMES_C },
    conviccion_largo: { label: 'Convicción largo', type: 'num' },
    conviccion_medio: { label: 'Convicción medio', type: 'num' },
    conviccion_corto: { label: 'Convicción corto', type: 'num' },
    dist_soporte:     { label: 'Dist. a soporte %',    type: 'num' },
    dist_resistencia: { label: 'Dist. a resistencia %',type: 'num' },
    rsi:              { label: 'RSI',               type: 'num' },
  };

  const fmt = (v, d = 2) => v == null ? '—' :
    (Math.abs(v) >= 1 ? Number(v).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d })
                      : Number(v).toPrecision(4));

  const api = {
    config:    () => fetch('/api/bot/config').then(r => r.json()),
    setConfig: (b) => fetch('/api/bot/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
    stats:     () => fetch('/api/bot/stats').then(r => r.json()),
    rules:     () => fetch('/api/bot/rules').then(r => r.json()),
    createRule:(b) => fetch('/api/bot/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
    updateRule:(id, b) => fetch(`/api/bot/rules/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
    deleteRule:(id) => fetch(`/api/bot/rules/${id}`, { method: 'DELETE' }).then(r => r.json()),
    positions: (s) => fetch(`/api/bot/positions${s ? '?status=' + s : ''}`).then(r => r.json()),
    reset:     () => fetch('/api/bot/reset', { method: 'POST' }).then(r => r.json()),
  };

  return {
    _pollTimer: null,
    _ruleDraft: [],

    async onEnter() {
      const el = document.getElementById('screen-bot');
      el.innerHTML = `<div class="placeholder"><i class="ti ti-refresh"></i><p>Cargando bot...</p></div>`;
      await this._render();
      this._pollTimer = setInterval(() => this._refreshLive(), 20000);
    },

    onLeave() {
      if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    },

    async _render() {
      const el = document.getElementById('screen-bot');
      let cfg, stats, rules, openPos, closedPos;
      try {
        [cfg, stats, rules, openPos, closedPos] = await Promise.all([
          api.config(), api.stats(), api.rules(),
          api.positions('open'), api.positions('closed'),
        ]);
      } catch (e) {
        el.innerHTML = `<div class="placeholder"><i class="ti ti-alert-circle"></i><p>Error al cargar el bot</p></div>`;
        return;
      }
      const c = cfg.config || {};
      const s = stats.stats || {};
      el.innerHTML = `
        ${this._headerHTML(c, s)}
        ${this._statsHTML(s)}
        ${this._positionsHTML(openPos.positions || [])}
        ${this._rulesHTML(rules.rules || [])}
        ${this._historyHTML(closedPos.positions || [])}
      `;
      this._wire(c);
    },

    // Header: on/off + config rápida
    _headerHTML(c, s) {
      const on = c.enabled;
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:42px;height:42px;border-radius:10px;background:var(--c2);display:flex;align-items:center;justify-content:center;">
            <i class="ti ti-robot" style="font-size:22px;color:${on ? '#56A14F' : '#78716C'};"></i>
          </div>
          <div>
            <div style="font-size:17px;font-weight:600;color:var(--t1);">Bot de Paper-Trading</div>
            <div style="font-size:12px;color:var(--t3);">Simulación · ${on ? '<span style="color:#56A14F;">Activo</span>' : '<span style="color:#78716C;">Detenido</span>'}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="bot-toggle" style="padding:8px 16px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;
            background:${on ? '#D93B3B' : '#56A14F'};color:#fff;">
            ${on ? 'Detener' : 'Iniciar'}
          </button>
          <button id="bot-config-btn" style="padding:8px 12px;border-radius:8px;border:0.5px solid var(--w1);background:transparent;color:var(--t3);font-size:13px;cursor:pointer;">
            <i class="ti ti-settings"></i>
          </button>
          <button id="bot-reset-btn" title="Reiniciar simulación" style="padding:8px 12px;border-radius:8px;border:0.5px solid var(--w1);background:transparent;color:#D93B3B;font-size:13px;cursor:pointer;">
            <i class="ti ti-refresh"></i>
          </button>
        </div>
      </div>`;
    },

    // Stats cards
    _statsHTML(s) {
      const card = (label, value, color, statKey) => `
        <div style="flex:1;min-width:130px;background:var(--surface);border:0.5px solid var(--w1);border-radius:10px;padding:14px;">
          <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">${label}</div>
          <div ${statKey ? `data-stat="${statKey}"` : ''} style="font-size:20px;font-weight:600;color:${color || 'var(--t1)'};font-family:var(--f2);">${value}</div>
        </div>`;
      const ret = s.total_return ?? 0;
      const retCol = ret >= 0 ? '#56A14F' : '#D93B3B';
      const unrl = s.unrealized_pnl ?? 0;
      const unrlCol = unrl >= 0 ? '#56A14F' : '#D93B3B';
      return `
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;">
        ${card('Equity', '$' + fmt(s.equity), null, 'equity')}
        ${card('Balance libre', '$' + fmt(s.balance), null)}
        ${card('Retorno total', (ret >= 0 ? '+' : '') + fmt(ret) + '%', retCol)}
        ${card('P&L no realizado', (unrl >= 0 ? '+$' : '-$') + fmt(Math.abs(unrl)), unrlCol, 'unrl')}
        ${card('Win rate', fmt(s.win_rate, 1) + '%', null)}
        ${card('Operaciones', (s.open_count ?? 0) + ' abiertas / ' + (s.closed_count ?? 0) + ' cerradas', null)}
      </div>`;
    },

    // Posiciones abiertas
    _positionsHTML(positions) {
      if (!positions.length) {
        return `<div style="margin-bottom:24px;">
          <div style="font-size:14px;font-weight:600;color:var(--t1);margin-bottom:10px;">Posiciones abiertas</div>
          <div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:10px;padding:20px;text-align:center;color:var(--t3);font-size:13px;">Sin posiciones abiertas</div>
        </div>`;
      }
      const rows = positions.map(p => {
        const pnl = p.pnl_pct;
        return `<div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:0.5px solid var(--w1);">
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:600;color:var(--t1);">${p.symbol}</div>
            <div style="font-size:11px;color:var(--t3);">${p.entry_reason || ''} · ${p.exchange}</div>
          </div>
          <div style="text-align:right;font-family:var(--f2);">
            <div style="font-size:12px;color:var(--t2);">Entrada $${fmt(p.entry_price)}</div>
            <div style="font-size:11px;color:var(--t3);">Stop $${fmt(p.stop_price)}</div>
          </div>
          <div data-live-pnl="${p.id}" style="text-align:right;min-width:80px;font-family:var(--f2);font-size:13px;color:var(--t3);">…</div>
        </div>`;
      }).join('');
      return `<div style="margin-bottom:24px;">
        <div style="font-size:14px;font-weight:600;color:var(--t1);margin-bottom:10px;">Posiciones abiertas</div>
        <div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:10px;overflow:hidden;">${rows}</div>
      </div>`;
    },

    // Reglas (entrada y salida)
    _rulesHTML(rules) {
      const entry = rules.filter(r => (r.kind || 'entry') === 'entry');
      const exit  = rules.filter(r => r.kind === 'exit');
      const ruleRow = (r) => `
        <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:0.5px solid var(--w1);">
          <i class="ti ti-${r.active ? 'circle-check' : 'circle'}" data-rule-toggle="${r.id}" style="cursor:pointer;color:${r.active ? '#56A14F' : '#57534E'};font-size:16px;"></i>
          <div style="flex:1;">
            <div style="font-size:13px;color:var(--t1);">${r.name}</div>
            <div style="font-size:11px;color:var(--t3);">${(r.conditions || []).map(this._condLabel).join('  ·  ') || 'sin condiciones'}</div>
          </div>
          <i class="ti ti-trash" data-rule-del="${r.id}" style="cursor:pointer;color:#D93B3B;font-size:14px;"></i>
        </div>`;
      const block = (title, list, kind, color) => `
        <div style="flex:1;min-width:280px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:600;color:${color};">${title}</span>
            <button data-new-rule="${kind}" style="font-size:11px;border:none;background:var(--c2);color:var(--t1);border-radius:6px;padding:4px 10px;cursor:pointer;">+ Regla</button>
          </div>
          <div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:10px;overflow:hidden;">
            ${list.length ? list.map(ruleRow).join('') : `<div style="padding:16px;text-align:center;color:var(--t3);font-size:12px;">Sin reglas de ${kind === 'entry' ? 'entrada' : 'salida'}</div>`}
          </div>
        </div>`;
      return `<div style="margin-bottom:24px;">
        <div style="font-size:14px;font-weight:600;color:var(--t1);margin-bottom:10px;">Reglas</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          ${block('Entradas (compra)', entry, 'entry', '#56A14F')}
          ${block('Salidas (venta)', exit, 'exit', '#D93B3B')}
        </div>
        <div style="font-size:11px;color:var(--t3);margin-top:8px;">Una posición se abre si se cumple alguna regla de entrada; se cierra si se cumple alguna de salida o toca el stop loss.</div>
      </div>`;
    },

    _condLabel(c) {
      const f = FIELDS[c.field];
      const label = f ? f.label : c.field;
      const op = { es: '=', no_es: '≠', gt: '>', lt: '<' }[c.op] || c.op;
      return `${label} ${op} ${c.value}`;
    },

    // Historial de cerradas
    _historyHTML(positions) {
      if (!positions.length) return '';
      const rows = positions.slice(0, 30).map(p => {
        const win = (p.pnl ?? 0) >= 0;
        const col = win ? '#56A14F' : '#D93B3B';
        const d = p.closed_at ? new Date(p.closed_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '';
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:0.5px solid var(--w1);font-size:12px;">
          <span style="flex:1;color:var(--t1);font-weight:500;">${p.symbol}</span>
          <span style="color:var(--t3);font-family:var(--f2);">$${fmt(p.entry_price)} → $${fmt(p.exit_price)}</span>
          <span style="min-width:70px;text-align:right;color:${col};font-family:var(--f2);">${win ? '+' : ''}$${fmt(p.pnl)}</span>
          <span style="min-width:56px;text-align:right;color:${col};font-family:var(--f2);">${win ? '+' : ''}${fmt(p.pnl_pct)}%</span>
          <span style="min-width:50px;text-align:right;color:var(--t3);">${p.exit_reason === 'stop_loss' ? 'SL' : 'regla'}</span>
          <span style="min-width:42px;text-align:right;color:var(--t3);">${d}</span>
        </div>`;
      }).join('');
      return `<div style="margin-bottom:24px;">
        <div style="font-size:14px;font-weight:600;color:var(--t1);margin-bottom:10px;">Historial</div>
        <div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:10px;overflow:hidden;">${rows}</div>
      </div>`;
    },

    // ── Eventos ─────────────────────────────────────────────────────────────────
    _wire(c) {
      document.getElementById('bot-toggle').onclick = async () => {
        await api.setConfig({ enabled: !c.enabled });
        this._render();
      };
      document.getElementById('bot-config-btn').onclick = () => this._openConfig(c);
      document.getElementById('bot-reset-btn').onclick = async () => {
        if (confirm('¿Reiniciar la simulación? Se borran posiciones e historial y el balance vuelve al inicial.')) {
          await api.reset();
          this._render();
        }
      };
      document.querySelectorAll('[data-new-rule]').forEach(b =>
        b.onclick = () => this._openRuleBuilder(b.dataset.newRule));
      document.querySelectorAll('[data-rule-del]').forEach(b =>
        b.onclick = async () => { await api.deleteRule(+b.dataset.ruleDel); this._render(); });
      document.querySelectorAll('[data-rule-toggle]').forEach(b =>
        b.onclick = async () => {
          const id = +b.dataset.ruleToggle;
          const active = b.classList.contains('ti-circle-check');
          await api.updateRule(id, { active: !active });
          this._render();
        });
      this._refreshLive();
    },

    async _refreshLive() {
      // Actualiza stats y P&L en vivo de cada posición abierta
      try {
        const [stats, openPos] = await Promise.all([api.stats(), api.positions('open')]);
        // Actualizar tarjetas de stats sin re-render completo
        const s = stats.stats || {};
        this._updateStatCards(s);
        for (const p of (openPos.positions || [])) {
          const el = document.querySelector(`[data-live-pnl="${p.id}"]`);
          if (!el) continue;
          if (p.live_pnl == null) {
            el.textContent = '—';
            el.style.color = 'var(--t3)';
          } else {
            const win = p.live_pnl >= 0;
            el.innerHTML = `<div>${win ? '+' : ''}$${fmt(p.live_pnl)}</div>
              <div style="font-size:11px;">${win ? '+' : ''}${fmt(p.live_pnl_pct)}%</div>`;
            el.style.color = win ? '#56A14F' : '#D93B3B';
          }
        }
      } catch (e) {}
    },

    _updateStatCards(s) {
      // Actualiza solo los valores numéricos si las tarjetas existen (sin re-render)
      const eq = document.querySelector('[data-stat="equity"]');
      if (eq) eq.textContent = '$' + fmt(s.equity);
      const un = document.querySelector('[data-stat="unrl"]');
      if (un) {
        const v = s.unrealized_pnl ?? 0;
        un.textContent = (v >= 0 ? '+$' : '-$') + fmt(Math.abs(v));
        un.style.color = v >= 0 ? '#56A14F' : '#D93B3B';
      }
    },

    // ── Config modal ──────────────────────────────────────────────────────────────
    _openConfig(c) {
      const m = document.createElement('div');
      m.style.cssText = 'position:fixed;inset:0;z-index:800;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
      m.innerHTML = `
        <div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:12px;width:min(360px,calc(100vw - 24px));padding:18px;">
          <div style="font-size:14px;font-weight:600;color:var(--t1);margin-bottom:14px;">Configuración del bot</div>
          ${this._cfgField('Monto por operación ($)', 'trade_amount', c.trade_amount)}
          ${this._cfgField('Stop loss (%)', 'stop_loss_pct', c.stop_loss_pct)}
          ${this._cfgField('Máx. posiciones simultáneas', 'max_positions', c.max_positions)}
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
            <button id="cfg-cancel" style="padding:7px 14px;border-radius:6px;border:0.5px solid var(--w1);background:transparent;color:var(--t3);font-size:12px;cursor:pointer;">Cancelar</button>
            <button id="cfg-save" style="padding:7px 16px;border-radius:6px;border:none;background:#2563EB;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Guardar</button>
          </div>
        </div>`;
      document.body.appendChild(m);
      m.onclick = (e) => { if (e.target === m) m.remove(); };
      m.querySelector('#cfg-cancel').onclick = () => m.remove();
      m.querySelector('#cfg-save').onclick = async () => {
        const body = {
          trade_amount:  parseFloat(m.querySelector('[data-cfg="trade_amount"]').value),
          stop_loss_pct: parseFloat(m.querySelector('[data-cfg="stop_loss_pct"]').value),
          max_positions: parseInt(m.querySelector('[data-cfg="max_positions"]').value),
        };
        await api.setConfig(body);
        m.remove();
        this._render();
      };
    },

    _cfgField(label, key, val) {
      return `<div style="margin-bottom:12px;">
        <label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">${label}</label>
        <input type="number" step="any" data-cfg="${key}" value="${val ?? ''}"
          style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;font-family:var(--f2);">
      </div>`;
    },

    // ── Constructor de reglas ───────────────────────────────────────────────────
    _openRuleBuilder(kind) {
      this._ruleDraft = [];
      const m = document.createElement('div');
      m.id = 'rule-builder';
      m.style.cssText = 'position:fixed;inset:0;z-index:800;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
      m.innerHTML = `
        <div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:12px;width:min(460px,calc(100vw - 24px));max-height:calc(100vh - 80px);display:flex;flex-direction:column;">
          <div style="padding:16px 18px;border-bottom:0.5px solid var(--w1);">
            <div style="font-size:14px;font-weight:600;color:var(--t1);">Nueva regla de ${kind === 'entry' ? 'entrada' : 'salida'}</div>
          </div>
          <div style="padding:18px;overflow-y:auto;">
            <label style="display:block;font-size:11px;color:var(--t3);margin-bottom:4px;">Nombre</label>
            <input id="rule-name" type="text" placeholder="ej: ${kind === 'entry' ? 'Soporte + RSI bajo' : 'Régimen bajista'}"
              style="width:100%;background:var(--bg);border:0.5px solid var(--w1);color:var(--t1);border-radius:6px;padding:7px 10px;font-size:13px;margin-bottom:16px;">
            <div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:8px;">Condiciones (todas deben cumplirse)</div>
            <div id="rule-conds" style="margin-bottom:10px;"></div>
            ${this._condEditor()}
            <button id="cond-add" style="width:100%;margin-top:8px;padding:7px;border-radius:6px;border:0.5px dashed var(--w1);background:transparent;color:var(--t3);font-size:12px;cursor:pointer;">+ Agregar condición</button>
          </div>
          <div style="padding:14px 18px;border-top:0.5px solid var(--w1);display:flex;gap:8px;justify-content:flex-end;">
            <button id="rule-cancel" style="padding:7px 14px;border-radius:6px;border:0.5px solid var(--w1);background:transparent;color:var(--t3);font-size:12px;cursor:pointer;">Cancelar</button>
            <button id="rule-save" style="padding:7px 16px;border-radius:6px;border:none;background:#2563EB;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Crear regla</button>
          </div>
        </div>`;
      document.body.appendChild(m);
      this._wireFieldChange(m);
      this._renderDraft();

      m.onclick = (e) => { if (e.target === m) m.remove(); };
      m.querySelector('#rule-cancel').onclick = () => m.remove();
      m.querySelector('#cond-add').onclick = () => this._addCondFromEditor(m);
      m.querySelector('#rule-save').onclick = async () => {
        const name = m.querySelector('#rule-name').value.trim();
        if (!name || !this._ruleDraft.length) {
          m.querySelector('#rule-name').style.borderColor = '#D93B3B';
          return;
        }
        await api.createRule({ name, kind, conditions: this._ruleDraft });
        m.remove();
        this._render();
      };
    },

    _condEditor() {
      const fieldOpts = Object.entries(FIELDS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('');
      return `<div style="display:flex;gap:6px;align-items:center;background:var(--bg);border:0.5px solid var(--w1);border-radius:8px;padding:8px;">
        <select id="ce-field" style="flex:1;background:var(--surface);border:0.5px solid var(--w1);color:var(--t1);border-radius:5px;padding:5px;font-size:12px;">${fieldOpts}</select>
        <select id="ce-op" style="background:var(--surface);border:0.5px solid var(--w1);color:var(--t1);border-radius:5px;padding:5px;font-size:12px;"></select>
        <span id="ce-value-wrap" style="flex:1;"></span>
      </div>`;
    },

    _wireFieldChange(m) {
      const fieldSel = m.querySelector('#ce-field');
      const update = () => {
        const f = FIELDS[fieldSel.value];
        const opSel = m.querySelector('#ce-op');
        const valWrap = m.querySelector('#ce-value-wrap');
        if (f.type === 'regime') {
          opSel.innerHTML = `<option value="es">es</option><option value="no_es">no es</option>`;
          valWrap.innerHTML = `<select id="ce-value" style="width:100%;background:var(--surface);border:0.5px solid var(--w1);color:var(--t1);border-radius:5px;padding:5px;font-size:12px;">${f.regimes.map(r => `<option value="${r}">${r}</option>`).join('')}</select>`;
        } else {
          opSel.innerHTML = `<option value="gt">&gt;</option><option value="lt">&lt;</option>`;
          valWrap.innerHTML = `<input id="ce-value" type="number" step="any" placeholder="valor" style="width:100%;background:var(--surface);border:0.5px solid var(--w1);color:var(--t1);border-radius:5px;padding:5px;font-size:12px;">`;
        }
      };
      fieldSel.onchange = update;
      update();
    },

    _addCondFromEditor(m) {
      const field = m.querySelector('#ce-field').value;
      const op = m.querySelector('#ce-op').value;
      const valEl = m.querySelector('#ce-value');
      const value = valEl ? valEl.value : '';
      if (value === '' || value == null) { valEl.style.borderColor = '#D93B3B'; return; }
      this._ruleDraft.push({ field, op, value });
      this._renderDraft();
    },

    _renderDraft() {
      const cont = document.getElementById('rule-conds');
      if (!cont) return;
      if (!this._ruleDraft.length) {
        cont.innerHTML = `<div style="font-size:12px;color:var(--t3);padding:6px 0;">Aún no agregaste condiciones.</div>`;
        return;
      }
      cont.innerHTML = this._ruleDraft.map((c, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg);border-radius:6px;margin-bottom:5px;">
          <span style="flex:1;font-size:12px;color:var(--t1);">${this._condLabel(c)}</span>
          <i class="ti ti-x" data-cond-rm="${i}" style="cursor:pointer;color:#D93B3B;font-size:13px;"></i>
        </div>`).join('');
      cont.querySelectorAll('[data-cond-rm]').forEach(b =>
        b.onclick = () => { this._ruleDraft.splice(+b.dataset.condRm, 1); this._renderDraft(); });
    },
  };
})();
