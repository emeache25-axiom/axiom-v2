/**
 * AXIOM v2 — Charts / UI / Drawing Dialogs
 * Diálogo de configuración de un dibujo con pestañas estilo TradingView
 * (Estilo · Coordenadas) + menú contextual.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = window.AXIOM.Charts;
  const Reg = NS.Drawings;
  const Geo = NS.DrawingGeo;

  function fieldControl(f, val) {
    if (f.type === 'color')
      return `<input type="color" data-key="${f.key}" value="${val || '#78716C'}" style="border:none;background:none;cursor:pointer;width:38px;height:26px;border-radius:4px;">`;
    if (f.type === 'range')
      return `<div style="display:flex;align-items:center;gap:8px;flex:1;"><input type="range" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${val ?? 1}" style="flex:1;"><span style="font-size:10px;color:#78716C;width:24px;text-align:right;">${val ?? 1}</span></div>`;
    if (f.type === 'number')
      return `<input type="number" data-key="${f.key}" min="${f.min ?? ''}" max="${f.max ?? ''}" step="${f.step ?? 1}" value="${val ?? 0}" style="flex:1;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:4px;padding:5px 8px;font-size:12px;">`;
    if (f.type === 'select')
      return `<select data-key="${f.key}" style="flex:1;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:4px;padding:5px 8px;font-size:12px;">${f.options.map((o) => `<option value="${o.v}" ${val === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select>`;
    return `<input type="text" data-key="${f.key}" value="${val ?? ''}" style="flex:1;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:4px;padding:5px 8px;font-size:12px;">`;
  }
  function fieldRow(label, control) {
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;"><label style="font-size:11px;color:#A8A29E;width:96px;flex-shrink:0;">${label}</label>${control}</div>`;
  }

  NS.DrawingEditDialog = {
    open(drawing) {
      const def = Reg.get(drawing.type);
      if (!def) return;
      document.getElementById('drawing-edit-modal')?.remove();

      const styleFields = def.fields.map((f) => fieldRow(f.label, fieldControl(f, drawing.style[f.key]))).join('');

      let coordFields = '';
      drawing.points.forEach((p, i) => {
        const d = new Date(p.time * 1000);
        const dateStr = d.toISOString().slice(0, 16);
        coordFields += `<div style="margin-bottom:14px;">
          <div style="font-size:10px;color:#57534E;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">Punto ${i + 1}</div>
          ${fieldRow('Precio', `<input type="number" data-coord="price" data-idx="${i}" value="${p.price}" step="any" style="flex:1;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:4px;padding:5px 8px;font-size:12px;">`)}
          ${fieldRow('Fecha/hora', `<input type="datetime-local" data-coord="time" data-idx="${i}" value="${dateStr}" style="flex:1;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:4px;padding:5px 8px;font-size:12px;">`)}
        </div>`;
      });

      const modal = document.createElement('div');
      modal.id = 'drawing-edit-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;';
      modal.innerHTML = `
        <div style="background:#1A1917;border:0.5px solid #2C2926;border-radius:12px;width:min(380px,calc(100vw - 24px));box-shadow:0 24px 64px rgba(0,0,0,.7);overflow:hidden;">
          <div style="padding:13px 16px;border-bottom:0.5px solid #2C2926;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:13px;font-weight:600;color:#F5F0EB;">${def.label}</span>
            <button id="dw-x" style="border:none;background:#2C2926;color:#78716C;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:12px;">✕</button>
          </div>
          <div style="display:flex;border-bottom:0.5px solid #2C2926;">
            <button class="dw-tab" data-tab="style"  style="flex:1;padding:9px;background:#1A1917;border:none;border-bottom:2px solid #2563EB;color:#F5F0EB;font-size:12px;cursor:pointer;">Estilo</button>
            <button class="dw-tab" data-tab="coords" style="flex:1;padding:9px;background:#1A1917;border:none;border-bottom:2px solid transparent;color:#78716C;font-size:12px;cursor:pointer;">Coordenadas</button>
          </div>
          <div style="padding:16px;max-height:50vh;overflow-y:auto;">
            <div class="dw-panel" data-panel="style">${styleFields || '<div style="color:#57534E;font-size:12px;">Sin opciones de estilo.</div>'}</div>
            <div class="dw-panel" data-panel="coords" style="display:none;">${coordFields}</div>
          </div>
          <div style="padding:12px 16px;border-top:0.5px solid #2C2926;display:flex;gap:8px;justify-content:flex-end;">
            <button id="dw-del" style="padding:7px 14px;border-radius:6px;border:0.5px solid #D93B3B;background:transparent;color:#D93B3B;font-size:12px;cursor:pointer;">Eliminar</button>
            <button id="dw-save" style="padding:7px 16px;border-radius:6px;border:none;background:#2563EB;color:#fff;font-size:12px;cursor:pointer;font-weight:600;">Guardar</button>
          </div>
        </div>`;
      document.body.appendChild(modal);

      modal.querySelectorAll('.dw-tab').forEach((tab) => {
        tab.onclick = () => {
          modal.querySelectorAll('.dw-tab').forEach((t) => {
            const on = t === tab;
            t.style.borderBottomColor = on ? '#2563EB' : 'transparent';
            t.style.color = on ? '#F5F0EB' : '#78716C';
          });
          modal.querySelectorAll('.dw-panel').forEach((p) => {
            p.style.display = p.dataset.panel === tab.dataset.tab ? 'block' : 'none';
          });
        };
      });

      modal.querySelectorAll('input[type="range"]').forEach((r) => {
        r.oninput = () => { const s = r.parentElement.querySelector('span'); if (s) s.textContent = r.value; };
      });

      modal.querySelector('#dw-x').onclick = () => modal.remove();
      modal.querySelector('#dw-del').onclick = () => { modal.remove(); NS.DrawingManager.deleteDrawing(drawing.id); };
      modal.querySelector('#dw-save').onclick = () => {
        const style = {};
        modal.querySelectorAll('[data-key]').forEach((inp) => {
          style[inp.dataset.key] = (inp.type === 'range' || inp.type === 'number') ? parseFloat(inp.value) : inp.value;
        });
        NS.DrawingManager.applyStyle(drawing.id, style);
        const d = NS.DrawingManager._drawings.find((x) => x.id === drawing.id);
        if (d) {
          modal.querySelectorAll('[data-coord]').forEach((inp) => {
            const idx = +inp.dataset.idx;
            if (!d.points[idx]) return;
            if (inp.dataset.coord === 'price') d.points[idx].price = parseFloat(inp.value);
            if (inp.dataset.coord === 'time')  d.points[idx].time = Math.floor(new Date(inp.value).getTime() / 1000);
          });
          NS.DrawingManager._primitive.setDrawings(NS.DrawingManager._drawings);
          NS.DrawingManager._persist(d);
        }
        modal.remove();
      };
      modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    },
  };

  NS.DrawingContextMenu = {
    open(clientX, clientY, drawing) {
      document.getElementById('drawing-ctx-menu')?.remove();
      const menu = document.createElement('div');
      menu.id = 'drawing-ctx-menu';
      menu.style.cssText = `position:fixed;left:${clientX}px;top:${clientY}px;background:#1A1917;border:0.5px solid #2C2926;border-radius:7px;z-index:800;box-shadow:0 8px 32px rgba(0,0,0,.6);overflow:hidden;min-width:160px;padding:4px;`;
      const items = [
        { label: '<i class="ti ti-settings"></i> Configurar', fn: () => NS.DrawingEditDialog.open(drawing) },
        { label: drawing.locked ? '<i class="ti ti-lock-open"></i> Desbloquear' : '<i class="ti ti-lock"></i> Bloquear',
          fn: () => { drawing.locked = !drawing.locked; NS.DrawingManager._persist(drawing); } },
        { sep: true },
        { label: '<i class="ti ti-trash"></i> Eliminar', fn: () => NS.DrawingManager.deleteDrawing(drawing.id), danger: true },
      ];
      for (const it of items) {
        if (it.sep) {
          const s = document.createElement('div');
          s.style.cssText = 'height:0.5px;background:#2C2926;margin:4px 0;';
          menu.appendChild(s); continue;
        }
        const b = document.createElement('button');
        b.innerHTML = it.label;
        b.style.cssText = `display:flex;align-items:center;gap:8px;width:100%;padding:7px 12px;background:none;border:none;border-radius:5px;color:${it.danger ? '#D93B3B' : '#F5F0EB'};font-size:12px;text-align:left;cursor:pointer;`;
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
