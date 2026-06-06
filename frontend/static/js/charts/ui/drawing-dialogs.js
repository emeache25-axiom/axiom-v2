/**
 * AXIOM v2 — Charts / UI / Drawing Dialogs
 * Editor de estilo de un dibujo + menú contextual (editar/eliminar/bloquear/capas).
 * Los campos se generan a partir de def.fields de cada herramienta.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = window.AXIOM.Charts;
  const Reg = NS.Drawings;

  // ── Edit dialog ───────────────────────────────────────────────────────────────
  NS.DrawingEditDialog = {
    open(drawing) {
      const def = Reg.get(drawing.type);
      if (!def) return;
      document.getElementById('drawing-edit-modal')?.remove();

      const field = (f) => {
        const val = drawing.style[f.key];
        if (f.type === 'color')
          return row(f.label, `<input type="color" data-key="${f.key}" value="${val || '#78716C'}" style="border:none;background:none;cursor:pointer;width:36px;height:24px;">`);
        if (f.type === 'range')
          return row(f.label, `<input type="range" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${val ?? 1}" style="flex:1;">`);
        if (f.type === 'number')
          return row(f.label, `<input type="number" data-key="${f.key}" min="${f.min ?? ''}" max="${f.max ?? ''}" step="${f.step ?? 1}" value="${val ?? 0}" style="flex:1;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:4px;padding:4px 8px;font-size:12px;">`);
        if (f.type === 'select')
          return row(f.label, `<select data-key="${f.key}" style="flex:1;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:4px;padding:4px 8px;font-size:12px;">${f.options.map((o) => `<option value="${o.v}" ${val === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select>`);
        // text
        return row(f.label, `<input type="text" data-key="${f.key}" value="${val ?? ''}" style="flex:1;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:4px;padding:4px 8px;font-size:12px;">`);
      };
      function row(label, control) {
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><label style="font-size:11px;color:#78716C;width:90px;">${label}</label>${control}</div>`;
      }

      const fields = def.fields.map(field).join('');
      const modal = document.createElement('div');
      modal.id = 'drawing-edit-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
      modal.innerHTML = `
        <div style="background:#1A1917;border:0.5px solid #2C2926;border-radius:10px;width:min(340px,calc(100vw - 24px));box-shadow:0 16px 48px rgba(0,0,0,.7);">
          <div style="padding:12px 16px;border-bottom:0.5px solid #2C2926;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:13px;font-weight:600;color:#F5F0EB;">${def.label}</span>
            <button id="dw-x" style="border:none;background:#2C2926;color:#78716C;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:12px;">✕</button>
          </div>
          <div style="padding:16px;">${fields}</div>
          <div style="padding:12px 16px;border-top:0.5px solid #2C2926;display:flex;gap:8px;justify-content:flex-end;">
            <button id="dw-del" style="padding:6px 14px;border-radius:6px;border:0.5px solid #D93B3B;background:transparent;color:#D93B3B;font-size:12px;cursor:pointer;">Eliminar</button>
            <button id="dw-save" style="padding:6px 14px;border-radius:6px;border:none;background:#2563EB;color:#fff;font-size:12px;cursor:pointer;">Guardar</button>
          </div>
        </div>`;
      document.body.appendChild(modal);

      modal.querySelector('#dw-x').onclick = () => modal.remove();
      modal.querySelector('#dw-del').onclick = () => { modal.remove(); NS.DrawingManager.deleteDrawing(drawing.id); };
      modal.querySelector('#dw-save').onclick = () => {
        const style = {};
        modal.querySelectorAll('[data-key]').forEach((inp) => {
          style[inp.dataset.key] = (inp.type === 'range' || inp.type === 'number')
            ? parseFloat(inp.value) : inp.value;
        });
        NS.DrawingManager.applyStyle(drawing.id, style);
        modal.remove();
      };
      modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    },
  };

  // ── Context menu ──────────────────────────────────────────────────────────────
  NS.DrawingContextMenu = {
    open(clientX, clientY, drawing) {
      document.getElementById('drawing-ctx-menu')?.remove();
      const menu = document.createElement('div');
      menu.id = 'drawing-ctx-menu';
      menu.style.cssText = `position:fixed;left:${clientX}px;top:${clientY}px;background:#1A1917;border:0.5px solid #2C2926;border-radius:6px;z-index:800;box-shadow:0 8px 32px rgba(0,0,0,.6);overflow:hidden;min-width:150px;`;
      const items = [
        { label: '<i class="ti ti-pencil"></i> Editar', fn: () => NS.DrawingEditDialog.open(drawing) },
        { label: drawing.locked ? '<i class="ti ti-lock-open"></i> Desbloquear' : '<i class="ti ti-lock"></i> Bloquear',
          fn: () => { drawing.locked = !drawing.locked; NS.DrawingManager._persist(drawing); } },
        { label: '<i class="ti ti-trash"></i> Eliminar', fn: () => NS.DrawingManager.deleteDrawing(drawing.id), danger: true },
      ];
      for (const it of items) {
        const b = document.createElement('button');
        b.innerHTML = it.label;
        b.style.cssText = `display:flex;align-items:center;gap:8px;width:100%;padding:8px 14px;background:none;border:none;color:${it.danger ? '#D93B3B' : '#F5F0EB'};font-size:12px;text-align:left;cursor:pointer;`;
        b.onmouseover = () => b.style.background = '#2C2926';
        b.onmouseout  = () => b.style.background = 'none';
        b.onclick = () => { menu.remove(); it.fn(); };
        menu.appendChild(b);
      }
      document.body.appendChild(menu);
      const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
      setTimeout(() => document.addEventListener('mousedown', close), 50);
    },
  };
})();
