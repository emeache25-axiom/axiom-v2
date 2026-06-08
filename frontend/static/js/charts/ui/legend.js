/**
 * AXIOM v2 — Charts / UI / Legend
 * ────────────────────────────────────────────────────────────────────────────
 * Panel de leyenda colapsable de indicadores, posicionado sobre cada pane
 * (estilo TradingView). Los indicadores del pane principal aparecen arriba a
 * la izquierda del chart; los de pane separado, en su propio sub-pane.
 *
 * Cada fila muestra: nombre + valor actual (bajo el crosshair) + controles
 * (visibilidad, settings, borrar) que aparecen al hover.
 *
 * Se reposiciona en cada cambio de layout (resize, alta/baja de indicador) y
 * actualiza valores en cada movimiento del crosshair.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS    = window.AXIOM.Charts;
  const Store = NS.Store;
  const Engine = NS.Engine;
  const Reg   = NS.Indicators;
  const Mgr   = NS.IndicatorManager;

  NS.Legend = {
    _host: null,          // contenedor absoluto sobre el chart
    _collapsed: {},       // { paneIndex: bool }
    _crosshairTime: null, // tiempo bajo el crosshair (para valores)

    mount() {
      const wrap = document.getElementById('chart-container')?.parentElement;
      if (!wrap) return;
      // Host de las leyendas (no intercepta eventos salvo en los controles)
      let host = document.getElementById('chart-legends');
      if (!host) {
        host = document.createElement('div');
        host.id = 'chart-legends';
        host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:25;';
        wrap.appendChild(host);
      }
      this._host = host;

      // Re-render cuando cambian indicadores o el layout
      Store.on('indicators:changed', () => this.render());
      Store.on('candles:loaded', () => this.render());

      // Valores en vivo con el crosshair
      if (Engine.chart) {
        Engine.chart.subscribeCrosshairMove((param) => {
          this._crosshairTime = param && param.time ? param.time : null;
          this._updateValues();
        });
      }

      this.render();
    },

    /** Posición Y (top) acumulada de cada pane. */
    _paneTops() {
      const tops = [];
      let acc = 0;
      try {
        const panes = Engine.chart.panes();
        for (let i = 0; i < panes.length; i++) {
          tops[i] = acc;
          acc += panes[i].getHeight() + 1; // +1 separador
        }
      } catch (e) {}
      return tops;
    },

    render() {
      if (!this._host || !Engine.chart) return;
      const tops = this._paneTops();

      // Agrupar indicadores activos por paneIndex
      const byPane = {};
      for (const ind of Mgr.active) {
        const pi = ind.paneIndex || 0;
        (byPane[pi] = byPane[pi] || []).push(ind);
      }

      let html = '';
      for (const [piStr, inds] of Object.entries(byPane)) {
        const pi = +piStr;
        const top = (tops[pi] || 0) + 6;
        const collapsed = this._collapsed[pi];
        html += `<div class="legend-panel" data-pane="${pi}"
          style="position:absolute;top:${top}px;left:8px;pointer-events:auto;
          background:rgba(15,14,13,.82);border:0.5px solid #2C2926;border-radius:5px;
          font:11px 'IBM Plex Mono',monospace;min-width:90px;overflow:hidden;backdrop-filter:blur(2px);">`;

        // Header colapsable (solo si hay más de uno o siempre, estilo TV)
        html += `<div class="legend-head" data-toggle="${pi}"
          style="display:flex;align-items:center;gap:4px;padding:3px 7px;cursor:pointer;color:#78716C;">
          <i class="ti ti-chevron-${collapsed ? 'right' : 'down'}" style="font-size:11px;"></i>
          <span style="font-size:9px;text-transform:uppercase;letter-spacing:.04em;">${inds.length} ind.</span>
        </div>`;

        if (!collapsed) {
          for (const ind of inds) {
            const def = Reg.get(ind.type);
            const summary = def && def.summary ? def.summary(ind.params) : ind.type;
            const color = ind.params.color || ind.params.colorMACD || ind.params.colorBull || '#C9A84C';
            html += `<div class="legend-row" data-id="${ind.id}"
              style="display:flex;align-items:center;gap:6px;padding:3px 7px;border-top:0.5px solid #1A1917;color:#F5F0EB;white-space:nowrap;">
              <span style="width:7px;height:7px;border-radius:2px;background:${color};flex-shrink:0;"></span>
              <span class="legend-name" style="flex:1;">${summary}</span>
              <span class="legend-val" data-val="${ind.id}" style="color:#A8A29E;min-width:0;"></span>
              <span class="legend-ctrls" style="display:none;align-items:center;gap:4px;">
                <i class="ti ti-eye${ind.visible ? '' : '-off'}" data-act="vis" data-id="${ind.id}" title="Visibilidad" style="cursor:pointer;color:${ind.visible ? '#56A14F' : '#57534E'};"></i>
                <i class="ti ti-settings" data-act="edit" data-id="${ind.id}" title="Configurar" style="cursor:pointer;color:#78716C;"></i>
                <i class="ti ti-trash" data-act="del" data-id="${ind.id}" title="Eliminar" style="cursor:pointer;color:#D93B3B;"></i>
              </span>
            </div>`;
          }
        }
        html += `</div>`;
      }
      this._host.innerHTML = html;
      this._wire();
      this._updateValues();
    },

    _wire() {
      // Toggle colapsar
      this._host.querySelectorAll('[data-toggle]').forEach((el) => {
        el.onclick = () => {
          const pi = +el.dataset.toggle;
          this._collapsed[pi] = !this._collapsed[pi];
          this.render();
        };
      });
      // Hover en filas: mostrar controles
      this._host.querySelectorAll('.legend-row').forEach((row) => {
        const ctrls = row.querySelector('.legend-ctrls');
        const val   = row.querySelector('.legend-val');
        row.onmouseenter = () => { if (ctrls) ctrls.style.display = 'flex'; if (val) val.style.display = 'none'; };
        row.onmouseleave = () => { if (ctrls) ctrls.style.display = 'none'; if (val) val.style.display = 'inline'; };
      });
      // Controles
      this._host.querySelectorAll('[data-act]').forEach((ic) => {
        ic.onclick = async (e) => {
          e.stopPropagation();
          const id = +ic.dataset.id;
          const act = ic.dataset.act;
          if (act === 'vis')  await Mgr.toggleVisible(id);
          if (act === 'del')  await Mgr.remove(id);
          if (act === 'edit') NS.IndicatorsModal._openParamsEditor(id, null);
          this.render();
        };
      });
    },

    /** Actualiza los valores numéricos bajo el crosshair. */
    _updateValues() {
      if (!this._host) return;
      const time = this._crosshairTime;
      const candles = Store.candles;
      // Sin crosshair: usar la última vela
      const ref = time
        ? candles.find((c) => c.time === time)
        : (candles.length ? candles[candles.length - 1] : null);
      if (!ref) return;

      for (const ind of Mgr.active) {
        const el = this._host.querySelector(`[data-val="${ind.id}"]`);
        if (!el) continue;
        const def = Reg.get(ind.type);
        let txt = '';
        try {
          // Recalcular el valor en el punto de referencia
          const specs = def.calc(candles, ind.params);
          const lineSpec = specs.find((s) => s.kind === 'line');
          if (lineSpec && lineSpec.data && lineSpec.data.length) {
            const pt = lineSpec.data.find((d) => d.time === ref.time) || lineSpec.data[lineSpec.data.length - 1];
            if (pt) txt = NS.DrawingGeo.fmtPrice(pt.value);
          }
        } catch (e) {}
        el.textContent = txt;
      }
    },

    reposition() { this.render(); },
  };
})();
