/**
 * AXIOM v2 — Charts / Indicators / Registry
 * ────────────────────────────────────────────────────────────────────────────
 * Registro central de indicadores. Cada indicador es un objeto autocontenido
 * que se registra al cargarse su <script>. El core nunca se modifica para
 * agregar uno nuevo.
 *
 * CONTRATO de un indicador:
 * {
 *   type:     'SMA',                    // id único
 *   label:    'Media Móvil Simple',     // nombre visible
 *   pane:     'main' | 'separate',      // dónde se dibuja
 *   group:    'Tendencia',              // categoría en el modal
 *   defaults: { period: 20, color: '#..' },
 *   fields:   [ { key, label, type, min, max, step } ],  // editor de params
 *   summary:  (params) => 'SMA 20',     // texto corto para el badge
 *
 *   // Devuelve un array de "series specs". Cada spec describe UNA línea/histograma.
 *   //   { kind:'line'|'histogram', data:[{time,value,color?}], color, lineWidth, ... }
 *   calc:     (candles, params) => [ spec, ... ],
 * }
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS = (window.AXIOM = window.AXIOM || {});
  NS.Charts = NS.Charts || {};

  class IndicatorRegistry {
    constructor() { this._map = {}; }

    register(def) {
      if (!def || !def.type) { console.warn('[indicators] def inválida', def); return; }
      if (this._map[def.type]) { console.warn('[indicators] type duplicado:', def.type); }
      // Defaults del contrato
      def.pane   = def.pane   || 'main';
      def.group  = def.group  || 'Otros';
      def.fields = def.fields || [];
      def.defaults = def.defaults || {};
      this._map[def.type] = def;
    }

    get(type)  { return this._map[type] || null; }
    has(type)  { return !!this._map[type]; }
    list()     { return Object.values(this._map); }

    /** Agrupados por categoría para el modal: { grupo: [def, ...] } */
    grouped() {
      const out = {};
      for (const def of this.list()) {
        (out[def.group] = out[def.group] || []).push(def);
      }
      return out;
    }
  }

  NS.Charts.Indicators = new IndicatorRegistry();
})();
