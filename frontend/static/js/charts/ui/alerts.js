/**
 * AXIOM v2 — Charts / UI / Alerts
 * ────────────────────────────────────────────────────────────────────────────
 * Creación y gestión de alertas de precio desde el gráfico.
 * - Diálogo de creación: precio objetivo, dirección, recurrente, nota
 * - Panel de alertas: lista con estado, reactivar, borrar
 * Reusa /api/alerts/* (backend evalúa cada 1 min y notifica por Telegram).
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS    = window.AXIOM.Charts;
  const Store = NS.Store;
  const Geo   = NS.DrawingGeo;

  const API = {
    list:   (coinId) => fetch(`/api/alerts/?coin_id=${coinId}`).then((r) => r.json()),
    listAll:() => fetch('/api/alerts/').then((r) => r.json()),
    create: (body) => fetch('/api/alerts/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json()),
    update: (id, body) => fetch(`/api/alerts/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json()),
    remove: (id) => fetch(`/api/alerts/${id}`, { method: 'DELETE' }).then((r) => r.json()),
  };

  NS.Alerts = {
    // ── Diálogo de creación ─────────────────────────────────────────────────────
    openCreate(prefillPrice) {
      document.getElementById('alert-create-modal')?.remove();
      const coin = Store.coin;
      const candles = Store.candles;
      const cur = candles.length ? candles[candles.length - 1].close : 0;
      const price = prefillPrice != null ? prefillPrice : cur;
      // Dirección sugerida: si el objetivo está arriba del precio actual → above
      const dir = price >= cur ? 'above' : 'below';

      const modal = document.createElement('div');
      modal.id = 'alert-create-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:720;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;';
      modal.innerHTML = `
        <div style="background:#1A1917;border:0.5px solid #2C2926;border-radius:12px;width:min(360px,calc(100vw - 24px));box-shadow:0 24px 64px rgba(0,0,0,.7);overflow:hidden;">
          <div style="padding:13px 16px;border-bottom:0.5px solid #2C2926;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:13px;font-weight:600;color:#F5F0EB;">Nueva alerta · ${(coin.symbol || '').toUpperCase()}</span>
            <button id="al-x" style="border:none;background:#2C2926;color:#78716C;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:12px;">✕</button>
          </div>
          <div style="padding:16px;">
            <div style="font-size:11px;color:#78716C;margin-bottom:4px;">Precio actual: <span style="color:#A8A29E;font-family:'IBM Plex Mono',monospace;">${Geo.fmtPrice(cur)}</span></div>

            <label style="display:block;font-size:11px;color:#A8A29E;margin:10px 0 4px;">Precio objetivo</label>
            <input id="al-price" type="number" step="any" value="${price}" style="width:100%;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:6px;padding:8px 10px;font-size:13px;font-family:'IBM Plex Mono',monospace;outline:none;">

            <label style="display:block;font-size:11px;color:#A8A29E;margin:12px 0 4px;">Condición</label>
            <div style="display:flex;gap:6px;">
              <button class="al-dir" data-dir="above" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid ${dir==='above'?'#56A14F':'#2C2926'};background:${dir==='above'?'#1A2E1A':'transparent'};color:${dir==='above'?'#56A14F':'#78716C'};font-size:12px;cursor:pointer;">▲ Cruza arriba</button>
              <button class="al-dir" data-dir="below" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid ${dir==='below'?'#D93B3B':'#2C2926'};background:${dir==='below'?'#2E1A1A':'transparent'};color:${dir==='below'?'#D93B3B':'#78716C'};font-size:12px;cursor:pointer;">▼ Cruza abajo</button>
            </div>

            <label style="display:flex;align-items:center;gap:8px;margin:14px 0 0;cursor:pointer;">
              <input id="al-recurring" type="checkbox" style="cursor:pointer;">
              <span style="font-size:12px;color:#A8A29E;">Recurrente (no se desactiva al dispararse)</span>
            </label>

            <label style="display:block;font-size:11px;color:#A8A29E;margin:12px 0 4px;">Nota (opcional)</label>
            <input id="al-note" type="text" placeholder="ej: zona de soporte clave" style="width:100%;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:6px;padding:8px 10px;font-size:12px;outline:none;">
          </div>
          <div style="padding:12px 16px;border-top:0.5px solid #2C2926;display:flex;gap:8px;justify-content:flex-end;">
            <button id="al-cancel" style="padding:7px 14px;border-radius:6px;border:0.5px solid #2C2926;background:transparent;color:#78716C;font-size:12px;cursor:pointer;">Cancelar</button>
            <button id="al-save" style="padding:7px 16px;border-radius:6px;border:none;background:#2563EB;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Crear alerta</button>
          </div>
        </div>`;
      document.body.appendChild(modal);

      let direction = dir;
      modal.querySelectorAll('.al-dir').forEach((b) => {
        b.onclick = () => {
          direction = b.dataset.dir;
          modal.querySelectorAll('.al-dir').forEach((x) => {
            const on = x.dataset.dir === direction;
            const isAbove = x.dataset.dir === 'above';
            const col = isAbove ? '#56A14F' : '#D93B3B';
            const bg  = isAbove ? '#1A2E1A' : '#2E1A1A';
            x.style.borderColor = on ? col : '#2C2926';
            x.style.background  = on ? bg : 'transparent';
            x.style.color       = on ? col : '#78716C';
          });
        };
      });

      const close = () => modal.remove();
      modal.querySelector('#al-x').onclick = close;
      modal.querySelector('#al-cancel').onclick = close;
      modal.onclick = (e) => { if (e.target === modal) close(); };
      modal.querySelector('#al-save').onclick = async () => {
        const target = parseFloat(modal.querySelector('#al-price').value);
        if (!isFinite(target) || target <= 0) { modal.querySelector('#al-price').style.borderColor = '#D93B3B'; return; }
        const body = {
          coin_id: coin.id, symbol: coin.symbol || coin.id,
          exchange: coin.exchange || 'coingecko',
          direction, target_price: target,
          recurring: modal.querySelector('#al-recurring').checked,
          note: modal.querySelector('#al-note').value.trim() || null,
        };
        try { await API.create(body); } catch (e) {}
        close();
        // Si el panel está abierto detrás, refrescar solo su lista
        if (document.getElementById('alerts-panel-modal')) this._renderPanelList();
      };
    },

    // ── Panel de gestión ────────────────────────────────────────────────────────
    async openPanel() {
      document.getElementById('alerts-panel-modal')?.remove();

      const modal = document.createElement('div');
      modal.id = 'alerts-panel-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:710;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);display:flex;align-items:flex-start;justify-content:center;padding-top:56px;';
      modal.innerHTML = `
        <div style="background:#1A1917;border:0.5px solid #2C2926;border-radius:12px;width:min(420px,calc(100vw - 24px));max-height:calc(100vh - 112px);display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.7);">
          <div style="padding:13px 16px;border-bottom:0.5px solid #2C2926;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:13px;font-weight:600;color:#F5F0EB;">Alertas de precio</span>
            <div style="display:flex;gap:6px;">
              <button id="alp-new" style="border:none;background:#2563EB;color:#fff;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;">+ Nueva</button>
              <button id="alp-x" style="border:none;background:#2C2926;color:#78716C;width:28px;height:28px;border-radius:50%;cursor:pointer;">✕</button>
            </div>
          </div>
          <div id="alp-list" style="overflow-y:auto;"></div>
        </div>`;
      document.body.appendChild(modal);

      modal.querySelector('#alp-x').onclick = () => modal.remove();
      modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
      modal.querySelector('#alp-new').onclick = () => this.openCreate();

      this._renderPanelList();
    },

    /** Re-renderiza SOLO la lista de alertas dentro del panel ya abierto. */
    async _renderPanelList() {
      const cont = document.getElementById('alp-list');
      if (!cont) return;
      let alerts = [];
      try { const d = await API.listAll(); alerts = d.alerts || []; } catch (e) {}

      if (!alerts.length) {
        cont.innerHTML = `<div style="padding:20px;text-align:center;color:#57534E;font-size:12px;">Sin alertas todavía.</div>`;
        return;
      }
      cont.innerHTML = alerts.map((a) => {
        const up = a.direction === 'above';
        const arrow = up ? '▲' : '▼';
        const col = up ? '#56A14F' : '#D93B3B';
        const stateCol = a.active ? '#56A14F' : '#57534E';
        const stateTxt = a.active ? 'activa' : 'inactiva';
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:0.5px solid #1A1917;">
          <span style="color:${col};font-size:12px;">${arrow}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;color:#F5F0EB;">${a.symbol} ${up ? '≥' : '≤'} <span style="font-family:'IBM Plex Mono',monospace;">${Geo.fmtPrice(a.target_price)}</span></div>
            <div style="font-size:10px;color:#57534E;">${a.recurring ? 'recurrente' : 'una vez'} · <span style="color:${stateCol};">${stateTxt}</span>${a.note ? ' · ' + a.note : ''}</div>
          </div>
          ${a.active ? '' : `<button class="al-reactivate" data-id="${a.id}" title="Reactivar" style="border:none;background:none;color:#56A14F;cursor:pointer;font-size:13px;"><i class="ti ti-refresh"></i></button>`}
          <button class="al-del" data-id="${a.id}" title="Eliminar" style="border:none;background:none;color:#D93B3B;cursor:pointer;font-size:13px;"><i class="ti ti-trash"></i></button>
        </div>`;
      }).join('');

      cont.querySelectorAll('.al-del').forEach((b) => b.onclick = async () => {
        await API.remove(+b.dataset.id).catch(() => {});
        this._renderPanelList();   // solo refresca la lista, no el modal
      });
      cont.querySelectorAll('.al-reactivate').forEach((b) => b.onclick = async () => {
        await API.update(+b.dataset.id, { active: true }).catch(() => {});
        this._renderPanelList();
      });
    },
  };
})();
