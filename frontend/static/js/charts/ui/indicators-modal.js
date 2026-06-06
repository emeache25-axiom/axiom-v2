/**
 * AXIOM v2 — Charts / UI / Indicators Modal
 * Modal para agregar indicadores (lista del registry agrupada) + panel de
 * indicadores activos con toggle de visibilidad, edición y borrado.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS    = window.AXIOM.Charts;
  const Reg   = NS.Indicators;
  const Mgr   = NS.IndicatorManager;
  const Store = NS.Store;

  NS.IndicatorsModal = {
    mount() {
      // Re-render del badge/lista activa cuando cambian
      Store.on('indicators:changed', () => this._renderActive());
    },

    open() {
      document.getElementById('ind-modal')?.remove();
      const grouped = Reg.grouped();
      let groupsHtml = '';
      for (const [group, defs] of Object.entries(grouped)) {
        groupsHtml += `<div style="margin-bottom:14px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#57534E;margin-bottom:6px;">${group}</div>`;
        for (const def of defs) {
          groupsHtml += `<button data-add="${def.type}" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;background:#0F0E0D;border:0.5px solid #2C2926;border-radius:6px;color:#F5F0EB;font-size:12px;text-align:left;cursor:pointer;margin-bottom:4px;">
            <i class="ti ti-plus" style="font-size:12px;color:#56A14F;"></i> ${def.label}</button>`;
        }
        groupsHtml += `</div>`;
      }

      const modal = document.createElement('div');
      modal.id = 'ind-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,.6);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding-top:48px;';
      modal.innerHTML = `
        <div style="background:#1A1917;border:0.5px solid #2C2926;border-radius:12px;width:min(520px,calc(100vw - 24px));max-height:calc(100vh - 96px);display:flex;flex-direction:column;box-shadow:0 32px 80px rgba(0,0,0,.7);">
          <div style="padding:14px 16px;border-bottom:0.5px solid #2C2926;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:14px;font-weight:600;color:#F5F0EB;">Indicadores</span>
            <button id="ind-x" style="border:none;background:#2C2926;color:#78716C;width:30px;height:30px;border-radius:50%;cursor:pointer;">✕</button>
          </div>
          <div style="display:flex;gap:16px;padding:16px;overflow-y:auto;">
            <div style="flex:1;min-width:0;"><div style="font-size:11px;color:#78716C;margin-bottom:8px;">Disponibles</div>${groupsHtml}</div>
            <div style="flex:1;min-width:0;border-left:0.5px solid #2C2926;padding-left:16px;"><div style="font-size:11px;color:#78716C;margin-bottom:8px;">Activos</div><div id="ind-active-list"></div></div>
          </div>
        </div>`;
      document.body.appendChild(modal);

      modal.querySelector('#ind-x').onclick = () => modal.remove();
      modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
      modal.querySelectorAll('[data-add]').forEach((btn) => {
        btn.onclick = async () => { await Mgr.add(btn.dataset.add); this._renderActiveList(modal.querySelector('#ind-active-list')); };
      });

      this._renderActiveList(modal.querySelector('#ind-active-list'));
    },

    _renderActiveList(el) {
      if (!el) return;
      const active = Mgr.active;
      if (!active.length) {
        el.innerHTML = `<div style="color:#57534E;font-size:12px;padding:12px 0;">Sin indicadores activos</div>`;
        return;
      }
      let html = '';
      for (const ind of active) {
        const def = Reg.get(ind.type);
        const summary = def && def.summary ? def.summary(ind.params) : ind.type;
        html += `<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:#0F0E0D;border:0.5px solid #2C2926;border-radius:6px;margin-bottom:4px;">
          <span style="flex:1;font-size:12px;color:#F5F0EB;">${summary}</span>
          <button data-vis="${ind.id}" title="Visibilidad" style="border:none;background:none;color:${ind.visible ? '#56A14F' : '#57534E'};cursor:pointer;font-size:13px;"><i class="ti ti-eye${ind.visible ? '' : '-off'}"></i></button>
          <button data-edit="${ind.id}" title="Editar" style="border:none;background:none;color:#78716C;cursor:pointer;font-size:13px;"><i class="ti ti-settings"></i></button>
          <button data-del="${ind.id}" title="Eliminar" style="border:none;background:none;color:#D93B3B;cursor:pointer;font-size:13px;"><i class="ti ti-trash"></i></button>
        </div>`;
      }
      el.innerHTML = html;
      el.querySelectorAll('[data-vis]').forEach((b) => b.onclick = async () => { await Mgr.toggleVisible(+b.dataset.vis); this._renderActiveList(el); });
      el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { await Mgr.remove(+b.dataset.del); this._renderActiveList(el); });
      el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => this._openParamsEditor(+b.dataset.edit, el));
    },

    _openParamsEditor(id, listEl) {
      const ind = Mgr.active.find((i) => i.id === id);
      if (!ind) return;
      const def = Reg.get(ind.type);
      if (!def || !def.fields.length) return;
      document.getElementById('ind-params-modal')?.remove();

      const field = (f) => {
        const val = ind.params[f.key];
        let ctrl;
        if (f.type === 'color') ctrl = `<input type="color" data-key="${f.key}" value="${val || '#78716C'}" style="border:none;background:none;cursor:pointer;width:36px;height:24px;">`;
        else if (f.type === 'range') ctrl = `<input type="range" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${val ?? 1}" style="flex:1;">`;
        else ctrl = `<input type="number" data-key="${f.key}" min="${f.min ?? ''}" max="${f.max ?? ''}" step="${f.step ?? 1}" value="${val ?? 0}" style="flex:1;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:4px;padding:4px 8px;font-size:12px;">`;
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><label style="font-size:11px;color:#78716C;width:90px;">${f.label}</label>${ctrl}</div>`;
      };

      const pm = document.createElement('div');
      pm.id = 'ind-params-modal';
      pm.style.cssText = 'position:fixed;inset:0;z-index:650;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
      pm.innerHTML = `<div style="background:#1A1917;border:0.5px solid #2C2926;border-radius:10px;width:min(320px,calc(100vw - 24px));">
        <div style="padding:12px 16px;border-bottom:0.5px solid #2C2926;font-size:13px;font-weight:600;color:#F5F0EB;">${def.label}</div>
        <div style="padding:16px;">${def.fields.map(field).join('')}</div>
        <div style="padding:12px 16px;border-top:0.5px solid #2C2926;display:flex;gap:8px;justify-content:flex-end;">
          <button id="ipm-x" style="padding:6px 14px;border-radius:6px;border:0.5px solid #2C2926;background:transparent;color:#78716C;font-size:12px;cursor:pointer;">Cancelar</button>
          <button id="ipm-save" style="padding:6px 14px;border-radius:6px;border:none;background:#2563EB;color:#fff;font-size:12px;cursor:pointer;">Aplicar</button>
        </div></div>`;
      document.body.appendChild(pm);
      pm.querySelector('#ipm-x').onclick = () => pm.remove();
      pm.onclick = (e) => { if (e.target === pm) pm.remove(); };
      pm.querySelector('#ipm-save').onclick = async () => {
        const params = {};
        pm.querySelectorAll('[data-key]').forEach((inp) => {
          params[inp.dataset.key] = (inp.type === 'range' || inp.type === 'number') ? parseFloat(inp.value) : inp.value;
        });
        await Mgr.updateParams(id, params);
        pm.remove();
        this._renderActiveList(listEl);
      };
    },

    _renderActive() {
      // Actualizar badge contador en el botón de la toolbar
      const badge = document.getElementById('chart-ind-count');
      if (badge) {
        const n = Mgr.active.length;
        badge.textContent = n;
        badge.style.display = n ? 'inline-block' : 'none';
      }
    },
  };
})();
