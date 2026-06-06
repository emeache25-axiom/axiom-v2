/**
 * AXIOM v2 — Charts / Drawings / Geometry
 * Helpers de geometría puros, compartidos por las herramientas para hit-testing.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS = (window.AXIOM = window.AXIOM || {});
  NS.Charts = NS.Charts || {};

  const Geo = {
    HANDLE_R: 7,     // radio de detección de un vértice
    LINE_T:   6,     // grosor de detección de una línea

    /** Distancia de un punto P a un segmento AB. */
    distToSegment(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(px - ax, py - ay);
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    },

    /** ¿(mx,my) cerca de alguno de los vértices px[]? Devuelve idx o -1. */
    hitHandle(mx, my, px) {
      for (let i = 0; i < px.length; i++) {
        if (Math.hypot(mx - px[i].x, my - px[i].y) <= Geo.HANDLE_R) return i;
      }
      return -1;
    },

    /** ¿(mx,my) sobre el segmento p0-p1? */
    hitSegment(mx, my, p0, p1) {
      return Geo.distToSegment(mx, my, p0.x, p0.y, p1.x, p1.y) <= Geo.LINE_T;
    },

    /** ¿(mx,my) sobre una línea horizontal en y0? */
    hitHLine(mx, my, y0) {
      return Math.abs(my - y0) <= Geo.LINE_T;
    },

    /** ¿(mx,my) sobre una línea vertical en x0? */
    hitVLine(mx, my, x0) {
      return Math.abs(mx - x0) <= Geo.LINE_T;
    },

    /** Formato de precio compacto para labels. */
    fmtPrice(p) {
      if (!isFinite(p)) return '—';
      return Math.abs(p) >= 1 ? p.toFixed(2) : p.toPrecision(4);
    },
  };

  NS.Charts.DrawingGeo = Geo;
})();
