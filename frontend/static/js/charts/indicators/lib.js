/**
 * AXIOM v2 — Charts / Indicators / Lib
 * ────────────────────────────────────────────────────────────────────────────
 * Funciones de cálculo puras y reutilizables. Los indicadores las comparten
 * para no duplicar lógica (p.ej. BB usa sma + stddev; MACD usa ema).
 * Todas operan sobre arrays de números y devuelven arrays alineados por índice
 * (con null en las posiciones sin valor suficiente).
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS = (window.AXIOM = window.AXIOM || {});
  NS.Charts = NS.Charts || {};

  const Lib = {
    /** Media móvil simple. period > 0. */
    sma(values, period) {
      const out = new Array(values.length).fill(null);
      let sum = 0;
      for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= period) sum -= values[i - period];
        if (i >= period - 1) out[i] = sum / period;
      }
      return out;
    },

    /** Media móvil exponencial. */
    ema(values, period) {
      const out = new Array(values.length).fill(null);
      const k = 2 / (period + 1);
      let prev = null;
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (prev == null) {
          // Sembrar con SMA del primer tramo
          if (i >= period - 1) {
            let s = 0;
            for (let j = i - period + 1; j <= i; j++) s += values[j];
            prev = s / period;
            out[i] = prev;
          }
        } else {
          prev = v * k + prev * (1 - k);
          out[i] = prev;
        }
      }
      return out;
    },

    /** Desviación estándar móvil (poblacional) sobre period. */
    stddev(values, period) {
      const out = new Array(values.length).fill(null);
      for (let i = period - 1; i < values.length; i++) {
        let mean = 0;
        for (let j = i - period + 1; j <= i; j++) mean += values[j];
        mean /= period;
        let variance = 0;
        for (let j = i - period + 1; j <= i; j++) {
          const d = values[j] - mean;
          variance += d * d;
        }
        out[i] = Math.sqrt(variance / period);
      }
      return out;
    },

    /** RSI clásico (Wilder smoothing). */
    rsi(closes, period) {
      const out = new Array(closes.length).fill(null);
      if (closes.length <= period) return out;
      let gain = 0, loss = 0;
      for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) gain += d; else loss -= d;
      }
      gain /= period; loss /= period;
      out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        const g = d > 0 ? d : 0;
        const l = d < 0 ? -d : 0;
        gain = (gain * (period - 1) + g) / period;
        loss = (loss * (period - 1) + l) / period;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      }
      return out;
    },
  };

  NS.Charts.IndicatorLib = Lib;
})();
