/**
 * AXIOM — Widgets / Format
 * ────────────────────────────────────────────────────────────────────────────
 * Formatadores compartidos. Estaban duplicados en watchlist.js, pairs.js,
 * bot_orderbook.js y watchlist-panel.js, cada copia con variaciones sutiles —
 * lo que hacía que el mismo número se viera distinto según la pantalla.
 *
 * Una sola implementación: si hay que cambiar cómo se muestra un precio en
 * satoshis, se cambia acá y cambia en todos lados.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS = (window.AXIOM = window.AXIOM || {});

  const F = {
    /** Guion para lo que no existe. Nunca 0: un dato ausente no es un cero. */
    NADA: '—',

    /**
     * Precio con decimales según magnitud. Los pares en satoshis necesitan
     * hasta 10 decimales; mostrar 2 los volvería todos "0.00".
     */
    precio(p) {
      if (p == null) return F.NADA;
      const n = Number(p);
      if (!isFinite(n)) return F.NADA;
      if (n >= 1000)  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
      if (n >= 1)     return n.toFixed(4);
      if (n >= 0.001) return n.toFixed(6);
      return n.toFixed(10);
    },

    /** Volumen abreviado: 1.2B, 340.5M, 12.3K */
    volumen(v) {
      if (v == null) return F.NADA;
      const n = Number(v);
      if (!isFinite(n)) return F.NADA;
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return n.toFixed(0);
    },

    /** Porcentaje con signo opcional. */
    pct(v, dec = 2, conSigno = false) {
      if (v == null) return F.NADA;
      const n = Number(v);
      if (!isFinite(n)) return F.NADA;
      const s = conSigno && n >= 0 ? '+' : '';
      return s + n.toFixed(dec) + '%';
    },

    /** Capitalización de mercado abreviada con símbolo. */
    mcap(v) {
      return v == null ? F.NADA : '$' + F.volumen(v);
    },

    /** Color según signo. Verde/rojo del tema, gris si no hay dato. */
    colorSigno(v) {
      if (v == null) return 'var(--t3,#78716C)';
      return Number(v) >= 0 ? '#56A14F' : 'var(--re,#D93B3B)';
    },

    /**
     * Lectura tolerante: la misma métrica llega con nombres distintos según
     * el origen (la capacidad `buscar_pares` usa `rango_diario_pct`, el
     * endpoint `/api/pairs/` usa `volatilidad`).
     * DEUDA: unificar los nombres en el backend y borrar este helper.
     */
    campo(obj, ...nombres) {
      for (const n of nombres) {
        if (obj && obj[n] !== undefined && obj[n] !== null) return obj[n];
      }
      return null;
    },

    /** Escapa texto que viene de datos, para no romper el HTML. */
    esc(s) {
      if (s == null) return '';
      return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[c]));
    },
  };

  NS.Fmt = F;
})();
