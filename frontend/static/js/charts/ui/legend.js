/**
 * AXIOM v2 — Charts / UI / Legend
 * ────────────────────────────────────────────────────────────────────────────
 * Leyenda de indicadores por pane, estilo TradingView.
 * Cada leyenda se inserta DENTRO del elemento HTML del propio pane via
 * pane.getHTMLElement() — LWC posiciona el pane y la leyenda lo acompaña
 * automáticamente (resize, reordenado, etc.). Cero cálculo manual de tops.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS     = window.AXIOM.Charts;
  const Store  = NS.Store;
  const Engine = NS.Engine;
  const Reg    = NS.Indicators;
  const Mgr    = NS.IndicatorManager;

  NS.Legend = {
    _collapsed: {},        // { paneIndex: bool }
    _crosshairTime: null,
    _unsubs: [],

    mount() {
      // Re-render cuando cambian indicadores o velas
      this._unsubs.forEach((u) => u());
      this._unsubs = [
        Store.on('indicators:changed', () => this.render()),
        Store.on('candles:loaded',     () => this.render()),
      ];

      // Valores en vivo con el crosshair
      if (Engine.chart) {
        Engine.chart.subscribeCrosshairMove((param) => {
          this._crosshairTime = param && param.time ? param.time : null;
          this._updateValues();
        });
      }
      this.render();
    },

    render() {
      if (!Engine.chart) return;

      // Limpiar leyendas previas de todos los panes
      document.querySelectorAll('.axiom-pane-legend').forEach((el) => el.remove());

      let panes;
      try { panes = Engine.chart.panes(); } catch (e) { return; }

      // Agrupar por el PANE REAL de cada indicador, leído de su serie.
      // No usamos paneIndex guardado: LWC compacta índices al remover panes.
      const byPane = new Map();   // paneIndexReal -> { paneEl, inds: [] }
      let missingPane = false;

      for (const ind of Mgr.active) {
        let pi = 0, paneEl = null;
        if (ind.series.length && ind.series[0].getPane) {
          try {
            const pane = ind.series[0].getPane();
            pi = (typeof pane.paneIndex === 'function') ? pane.paneIndex() : 0;
            paneEl = pane.getHTMLElement ? pane.getHTMLElement() : null;
          } catch (e) {}
        } else {
          // PSAR / S/R: viven sobre la candleSeries → pane principal
          try { paneEl = panes[0] && panes[0].getHTMLElement ? panes[0].getHTMLElement() : null; } catch (e) {}
        }
        if (!paneEl) { missingPane = true; continue; }
        if (!byPane.has(pi)) byPane.set(pi, { paneEl, inds: [] });
        byPane.get(pi).inds.push(ind);
      }

      for (const [pi, group] of byPane) {
        const paneEl = group.paneEl;
        const inds = group.inds;

        // El elemento del pane necesita position para anclar la leyenda
        if (getComputedStyle(paneEl).position === 'static') {
          paneEl.style.position = 'relative';
        }

        const wrap = document.createElement('div');
        wrap.className = 'axiom-pane-legend';
        wrap.style.cssText = `position:absolute;top:6px;left:6px;z-index:15;pointer-events:auto;
          background:rgba(15,14,13,.82);border:0.5px solid #2C2926;border-radius:5px;
          font:11px 'IBM Plex Mono',monospace;min-width:90px;overflow:hidden;backdrop-filter:blur(2px);`;

        // Solo el pane principal (0) agrupa sus indicadores en panel colapsable.
        // Los panes separados (RSI, MACD) muestran su único indicador sin header.
        const isMain = (pi === 0);
        const collapsed = isMain && this._collapsed[0];

        let html = '';
        if (isMain) {
          html += `<div class="legend-head" style="display:flex;align-items:center;gap:4px;padding:3px 7px;cursor:pointer;color:#78716C;${collapsed ? '' : 'border-bottom:0.5px solid #1A1917;'}">
            <i class="ti ti-chevron-${collapsed ? 'right' : 'down'}" style="font-size:11px;"></i>
            <span style="font-size:9px;text-transform:uppercase;letter-spacing:.04em;">Indicadores · ${inds.length}</span>
          </div>`;
        }

        if (!collapsed) {
          for (const ind of inds) {
            const def = Reg.get(ind.type);
            const summary = def && def.summary ? def.summary(ind.params) : ind.type;
            const color = ind.params.color || ind.params.colorMACD || ind.params.colorBull || '#C9A84C';
            html += `<div class="legend-row" data-id="${ind.id}"
              style="display:flex;align-items:center;gap:6px;padding:3px 7px;color:#F5F0EB;white-space:nowrap;">
              <span style="width:7px;height:7px;border-radius:2px;background:${color};flex-shrink:0;"></span>
              <span class="legend-name">${summary}</span>
              <span class="legend-val" data-val="${ind.id}" style="color:#A8A29E;"></span>
              <span class="legend-ctrls" style="display:none;align-items:center;gap:4px;">
                <i class="ti ti-eye${ind.visible ? '' : '-off'}" data-act="vis" data-id="${ind.id}" title="Visibilidad" style="cursor:pointer;color:${ind.visible ? '#56A14F' : '#57534E'};"></i>
                <i class="ti ti-settings" data-act="edit" data-id="${ind.id}" title="Configurar" style="cursor:pointer;color:#78716C;"></i>
                <i class="ti ti-trash" data-act="del" data-id="${ind.id}" title="Eliminar" style="cursor:pointer;color:#D93B3B;"></i>
              </span>
            </div>`;
          }
        }
        wrap.innerHTML = html;
        paneEl.appendChild(wrap);
        this._wire(wrap, pi);
      }
      this._updateValues();

      // Si algún pane aún no existía en el DOM, reintentar (hasta 10 frames)
      if (missingPane) {
        this._retries = (this._retries || 0) + 1;
        if (this._retries <= 10) {
          requestAnimationFrame(() => this.render());
        } else {
          this._retries = 0;
        }
      } else {
        this._retries = 0;
      }
    },

    _wire(wrap, pi) {
      const head = wrap.querySelector('.legend-head');
      if (head) head.onclick = () => {
        this._collapsed[0] = !this._collapsed[0];
        this.render();
      };
      wrap.querySelectorAll('.legend-row').forEach((row) => {
        const ctrls = row.querySelector('.legend-ctrls');
        const val   = row.querySelector('.legend-val');
        row.onmouseenter = () => { if (ctrls) ctrls.style.display = 'flex'; if (val) val.style.display = 'none'; };
        row.onmouseleave = () => { if (ctrls) ctrls.style.display = 'none'; if (val) val.style.display = 'inline'; };
        row.ondblclick = (e) => {
          e.stopPropagation();
          NS.IndicatorsModal._openParamsEditor(+row.dataset.id, null);
        };
      });
      wrap.querySelectorAll('[data-act]').forEach((ic) => {
        ic.onclick = async (e) => {
          e.stopPropagation();
          const id = +ic.dataset.id;
          const act = ic.dataset.act;
          if (act === 'vis')  await Mgr.toggleVisible(id);
          if (act === 'del')  await Mgr.remove(id);
          if (act === 'edit') NS.IndicatorsModal._openParamsEditor(id, null);
        };
      });
    },

    _updateValues() {
      const time = this._crosshairTime;
      const candles = Store.candles;
      const ref = time
        ? candles.find((c) => c.time === time)
        : (candles.length ? candles[candles.length - 1] : null);
      if (!ref) return;

      for (const ind of Mgr.active) {
        const el = document.querySelector(`.axiom-pane-legend [data-val="${ind.id}"]`);
        if (!el) continue;
        const def = Reg.get(ind.type);
        let txt = '';
        try {
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
  };
})();
