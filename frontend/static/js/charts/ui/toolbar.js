/**
 * AXIOM v2 — Charts / UI / Toolbar
 * Toolbar vertical de herramientas de dibujo. Se genera desde el registry,
 * así que agregar una herramienta nueva la hace aparecer automáticamente.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS    = window.AXIOM.Charts;
  const Reg   = NS.Drawings;
  const Store = NS.Store;

  NS.Toolbar = {
    mount(containerId) {
      this._el = document.getElementById(containerId);
      if (!this._el) return;
      // Re-render cuando cambia la herramienta activa
      Store.on('tool:selected', () => this.render());
      this.render();
    },

    render() {
      if (!this._el) return;
      const active = Store.activeTool;
      let html = '';
      for (const def of Reg.list()) {
        const on = active === def.type;
        html += `<button title="${def.label}" data-tool="${def.type}"
          style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:5px;
          border:0.5px solid ${on ? '#2563EB' : 'transparent'};
          background:${on ? '#1D3A6E' : 'transparent'};
          color:${on ? '#3B82F6' : '#78716C'};cursor:pointer;transition:all .15s;margin-bottom:2px;">
          <i class="ti ${def.icon}" style="font-size:14px;pointer-events:none;"></i></button>`;
      }
      html += `<div style="width:24px;height:0.5px;background:#2C2926;margin:4px 3px;"></div>`;
      html += `<button title="Borrar todos" data-action="clear"
        style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:5px;border:0.5px solid transparent;background:transparent;color:#57534E;cursor:pointer;"
        ><i class="ti ti-trash" style="font-size:13px;pointer-events:none;"></i></button>`;
      this._el.innerHTML = html;

      // Listeners
      this._el.querySelectorAll('[data-tool]').forEach((btn) => {
        btn.onclick = () => {
          const t = btn.dataset.tool;
          Store.setActiveTool(Store.activeTool === t ? null : t);
        };
        btn.onmouseover = () => { if (Store.activeTool !== btn.dataset.tool) { btn.style.background = '#2C2926'; btn.style.color = '#F5F0EB'; } };
        btn.onmouseout  = () => { if (Store.activeTool !== btn.dataset.tool) { btn.style.background = 'transparent'; btn.style.color = '#78716C'; } };
      });
      const clearBtn = this._el.querySelector('[data-action="clear"]');
      if (clearBtn) {
        clearBtn.onclick = () => NS.DrawingManager.clearAll();
        clearBtn.onmouseover = () => { clearBtn.style.background = '#2C2926'; clearBtn.style.color = '#D93B3B'; };
        clearBtn.onmouseout  = () => { clearBtn.style.background = 'transparent'; clearBtn.style.color = '#57534E'; };
      }
    },
  };
})();
