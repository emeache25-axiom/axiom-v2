/**
 * AXIOM v2 — Charts / Core / Coords
 * ────────────────────────────────────────────────────────────────────────────
 * ÚNICA fuente de verdad para convertir entre:
 *   - tiempo (unix segundos)  ↔  coordenada X (píxeles)
 *   - precio (float)          ↔  coordenada Y (píxeles)
 *
 * El problema clásico de LWC: timeToCoordinate() y coordinateToTime() devuelven
 * null fuera del rango de datos (p.ej. tiempos futuros donde el usuario quiere
 * extender una línea de tendencia). Acá lo resolvemos usando el LOGICAL INDEX,
 * que no tiene esa limitación, combinado con el intervalo promedio entre velas.
 *
 * Todo el sistema (render de primitives, hit-testing, drag) usa SOLO estas
 * funciones. Nunca se llama a timeToCoordinate/priceToCoordinate directamente
 * desde otro lado.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  window.AXIOM = window.AXIOM || {};
  window.AXIOM.Charts = window.AXIOM.Charts || {};

  /**
   * Coords se instancia con referencias al chart y la serie principal.
   * Se re-vincula cuando el chart se recrea (cambio de coin/timeframe).
   */
  class Coords {
    constructor() {
      this._chart  = null;
      this._series = null;
      this._candles = [];        // referencia a las velas actuales (orden ascendente por time)
      this._avgInterval = 86400; // intervalo promedio entre velas en segundos (fallback: 1 día)
    }

    /** Vincular con un chart + serie. Llamar tras crear el chart. */
    bind(chart, series) {
      this._chart  = chart;
      this._series = series;
    }

    /** Actualizar el set de velas (para extrapolación). Orden ascendente por time. */
    setCandles(candles) {
      this._candles = candles || [];
      const n = this._candles.length;
      if (n >= 2) {
        this._avgInterval =
          (this._candles[n - 1].time - this._candles[0].time) / (n - 1);
      }
    }

    /** ¿Está listo para convertir? */
    get ready() {
      return !!(this._chart && this._series);
    }

    // ── time → x ──────────────────────────────────────────────────────────────
    /**
     * Convierte un tiempo (unix s) a coordenada X en píxeles.
     * Funciona también para tiempos fuera del rango de datos (futuro/pasado)
     * mediante extrapolación por logical index.
     * @returns {number|null}
     */
    timeToX(time) {
      if (!this.ready) return null;
      const ts = this._chart.timeScale();

      // Camino rápido: dentro del rango de datos
      let x = ts.timeToCoordinate(time);
      if (x != null) return x;

      // Camino lento: extrapolación por logical index
      const logical = this._timeToLogical(time);
      if (logical == null) return null;
      return this._logicalToX(logical, ts);
    }

    // ── x → time ──────────────────────────────────────────────────────────────
    /**
     * Convierte una coordenada X (píxeles) a tiempo (unix s).
     * Funciona también más allá de la última vela (extrapola tiempo futuro).
     * @returns {number|null}
     */
    xToTime(x) {
      if (!this.ready) return null;
      const ts = this._chart.timeScale();

      // Camino rápido
      let time = ts.coordinateToTime(x);
      if (time != null) return time;

      // Camino lento: x → logical → time
      const logical = ts.coordinateToLogical(x);
      if (logical == null) return null;
      return this._logicalToTime(logical);
    }

    // ── price → y ─────────────────────────────────────────────────────────────
    priceToY(price) {
      if (!this.ready) return null;
      const y = this._series.priceToCoordinate(price);
      return (y == null) ? null : y;
    }

    // ── y → price ─────────────────────────────────────────────────────────────
    yToPrice(y) {
      if (!this.ready) return null;
      const p = this._series.coordinateToPrice(y);
      return (p == null) ? null : p;
    }

    // ── Conversión combinada (atajo) ───────────────────────────────────────────
    /** {time, price} → {x, y} | null  (null si CUALQUIERA falla) */
    toPixel(time, price) {
      const x = this.timeToX(time);
      const y = this.priceToY(price);
      return (x != null && y != null) ? { x, y } : null;
    }

    /** {x, y} → {time, price} | null */
    fromPixel(x, y) {
      const time  = this.xToTime(x);
      const price = this.yToPrice(y);
      return (time != null && price != null) ? { time, price } : null;
    }

    // ── Internos: extrapolación por logical index ──────────────────────────────

    /** tiempo → logical index (float). Usa velas reales + intervalo promedio. */
    _timeToLogical(time) {
      const c = this._candles;
      const n = c.length;
      if (n < 2) return null;

      if (time >= c[n - 1].time) {
        // Futuro: extender desde la última vela
        return (n - 1) + (time - c[n - 1].time) / this._avgInterval;
      } else if (time <= c[0].time) {
        // Pasado: extender desde la primera vela
        return (time - c[0].time) / this._avgInterval;
      } else {
        // Dentro del rango: búsqueda binaria + interpolación lineal
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (c[mid].time <= time) lo = mid; else hi = mid;
        }
        const span = c[hi].time - c[lo].time;
        const frac = span > 0 ? (time - c[lo].time) / span : 0;
        return lo + frac;
      }
    }

    /** logical index → tiempo (unix s). */
    _logicalToTime(logical) {
      const c = this._candles;
      const n = c.length;
      if (n < 2) return null;

      if (logical >= n - 1) {
        return Math.round(c[n - 1].time + (logical - (n - 1)) * this._avgInterval);
      } else if (logical <= 0) {
        return Math.round(c[0].time + logical * this._avgInterval);
      } else {
        const idx  = Math.floor(logical);
        const frac = logical - idx;
        const t1 = c[idx].time;
        const t2 = c[Math.min(idx + 1, n - 1)].time;
        return Math.round(t1 + frac * (t2 - t1));
      }
    }

    /**
     * logical index → coordenada X.
     * logicalToCoordinate() de LWC falla (devuelve 0) para índices fuera del
     * rango visible, así que calculamos px-por-logical desde el rango visible
     * y extrapolamos linealmente.
     */
    _logicalToX(logical, ts) {
      // Intento directo
      const direct = ts.logicalToCoordinate(logical);
      if (direct != null && direct !== 0) return direct;

      // Extrapolación: dos puntos de referencia del rango visible
      const lr = ts.getVisibleLogicalRange();
      if (!lr) return null;
      const xFrom = ts.logicalToCoordinate(lr.from);
      const xTo   = ts.logicalToCoordinate(lr.to);
      if (xFrom == null || xTo == null) return null;
      const span = lr.to - lr.from;
      if (Math.abs(span) < 1e-9) return null;
      const pxPerLogical = (xTo - xFrom) / span;
      return xFrom + (logical - lr.from) * pxPerLogical;
    }
  }

  // Exponer como singleton (un solo chart activo a la vez)
  window.AXIOM.Charts.Coords = new Coords();
})();
