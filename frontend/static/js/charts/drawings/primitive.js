/**
 * AXIOM v2 — Charts / Drawings / Primitive
 * ────────────────────────────────────────────────────────────────────────────
 * El ÚNICO Series Primitive de LWC que renderiza TODOS los dibujos. Al ser un
 * primitive nativo, sus coordenadas se recalculan automáticamente en cada
 * repintado del chart (zoom, scroll, resize) — sin canvas overlay ni hacks.
 *
 * El primitive no decide CÓMO se ve cada dibujo: delega en la herramienta
 * registrada (def.render). Solo se encarga de:
 *   - convertir puntos lógicos {time,price} → píxeles {x,y} (via Coords)
 *   - recortar al área del chart (clip)
 *   - pasar el ctx + estado a cada def.render
 *   - dibujar los handles de la selección
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS = window.AXIOM.Charts;
  const Coords = NS.Coords;
  const Reg    = NS.Drawings;

  // ── Renderer ────────────────────────────────────────────────────────────────
  class DrawingsRenderer {
    constructor(state) { this._s = state; }

    draw(target) {
      target.useMediaCoordinateSpace((scope) => {
        const ctx = scope.context;
        const W = scope.mediaSize.width;
        const H = scope.mediaSize.height;
        // chartW: ancho del área sin price scale. Preferimos el valor del state
        // (calculado en updateAllViews via paneSize). Si no está disponible aún,
        // lo pedimos directo al chart; último recurso, el ancho completo.
        let chartW = this._s.chartW;
        if (!chartW && this._s.chart) {
          try { const ps = this._s.chart.paneSize; if (ps && ps.width) chartW = ps.width; } catch (e) {}
        }
        if (!chartW) chartW = W;
        const chartH = H;

        ctx.save();
        // Clip al área del chart (sin price scale a la derecha)
        ctx.beginPath();
        ctx.rect(0, 0, chartW, chartH);
        ctx.clip();

        const list = this._s.drawings.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        for (const d of list) this._drawOne(ctx, d, chartW, chartH);

        // Dibujo en progreso (preview)
        if (this._s.preview) this._drawOne(ctx, this._s.preview, chartW, chartH, true);

        ctx.restore();
      });
    }

    _drawOne(ctx, d, chartW, chartH, isPreview) {
      const def = Reg.get(d.type);
      if (!def) return;
      const px = d.points.map((p) => Coords.toPixel(p.time, p.price)).filter(Boolean);
      if (px.length < d.points.length) {
        // Algún punto no se pudo convertir; si es preview o crítico, abortar
        if (px.length === 0) return;
      }

      const st = {
        hovered:  !isPreview && this._s.hoverId === d.id,
        selected: !isPreview && this._s.selectedId === d.id,
        chartW, chartH,
        coords: Coords,
        points: d.points,         // puntos lógicos (para tools que necesitan precio)
        preview: !!isPreview,
      };

      ctx.save();
      try { def.render(ctx, px, d.style || {}, st); }
      catch (e) { /* silencioso por frame */ }
      ctx.restore();

      // Handles de selección/hover
      if ((st.selected || st.hovered) && !isPreview) {
        ctx.save();
        ctx.setLineDash([]);
        for (const pt of px) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#F5F0EB';
          ctx.fill();
          ctx.strokeStyle = '#1A1917';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // ── Pane view ───────────────────────────────────────────────────────────────
  class DrawingsPaneView {
    constructor(primitive) { this._p = primitive; }
    zOrder() { return 'top'; }
    renderer() { return new DrawingsRenderer(this._p._state); }
  }

  // ── Primitive ───────────────────────────────────────────────────────────────
  class DrawingsPrimitive {
    constructor() {
      this._state = {
        drawings: [], preview: null,
        hoverId: null, selectedId: null,
        chartW: 0, chart: null,
      };
      this._views = [new DrawingsPaneView(this)];
      this._requestUpdate = null;
      this._chart = null;
      this._series = null;
    }

    attached({ chart, series, requestUpdate }) {
      this._chart = chart;
      this._series = series;
      this._state.chart = chart;
      this._requestUpdate = requestUpdate;
    }
    detached() { this._chart = null; this._series = null; this._requestUpdate = null; }

    paneViews() { return this._views; }
    updateAllViews() { this._updateChartW(); }

    _updateChartW() {
      try {
        // paneSize es un getter en v5: { width, height } del área de chart,
        // que YA excluye price scale y time scale. No restamos nada más.
        const ps = this._chart.paneSize;
        if (ps && ps.width) this._state.chartW = ps.width;
      } catch (e) {}
      // Fallback: si no se pudo, el renderer usa el ancho del canvas completo
    }

    // API para el manager
    setDrawings(list)   { this._state.drawings = list || []; this.redraw(); }
    setPreview(d)       { this._state.preview = d; this.redraw(); }
    setHover(id)        { if (this._state.hoverId !== id) { this._state.hoverId = id; this.redraw(); } }
    setSelected(id)     { if (this._state.selectedId !== id) { this._state.selectedId = id; this.redraw(); } }
    redraw()            { this._requestUpdate && this._requestUpdate(); }
  }

  NS.DrawingsPrimitive = DrawingsPrimitive;
})();
