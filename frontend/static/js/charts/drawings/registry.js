/**
 * AXIOM v2 — Charts / Drawings / Registry
 * ────────────────────────────────────────────────────────────────────────────
 * Registro de herramientas de dibujo. Cada herramienta es un objeto que define
 * su geometría y cómo se renderiza. El motor de interacción y el primitive las
 * usan sin conocer sus detalles.
 *
 * CONTRATO de una herramienta:
 * {
 *   type:      'tline',
 *   label:     'Línea de tendencia',
 *   icon:      'ti-trending-up',
 *   numPoints: 2,                     // cuántos clicks para crearla (1 o 2)
 *   defaults:  { color, lineWidth, ... },
 *   fields:    [ {key,label,type,...} ],   // editor de estilo
 *
 *   // Render: dibuja en el canvas. Recibe ctx + puntos ya convertidos a píxeles
 *   // + estilo + flags de estado. NO hace conversiones (las hizo el primitive).
 *   render: (ctx, px, style, ctx2) => {}
 *     donde px = [{x,y}, ...] y ctx2 = { hovered, selected, chartW, chartH, coords }
 *
 *   // Hit test: ¿el punto (mx,my) toca este dibujo? Devuelve:
 *   //   { handle: idx }   si toca un vértice (idx)
 *   //   { body: true }    si toca el cuerpo (para mover todo)
 *   //   null              si no toca
 *   hitTest: (mx, my, px, style) => ({...}|null)
 *
 *   // Handles arrastrables (vértices). Devuelve los puntos lógicos editables.
 *   // Por defecto son los mismos points; algunas tools agregan handles derivados.
 *   handles: (points) => points   // opcional
 * }
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS = (window.AXIOM = window.AXIOM || {});
  NS.Charts = NS.Charts || {};

  class DrawingRegistry {
    constructor() { this._map = {}; }

    register(def) {
      if (!def || !def.type) { console.warn('[drawings] def inválida', def); return; }
      def.numPoints = def.numPoints || 2;
      def.defaults  = def.defaults  || {};
      def.fields    = def.fields    || [];
      this._map[def.type] = def;
    }

    get(type) { return this._map[type] || null; }
    has(type) { return !!this._map[type]; }
    list()    { return Object.values(this._map); }
  }

  NS.Charts.Drawings = new DrawingRegistry();
})();
