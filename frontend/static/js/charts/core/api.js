/**
 * AXIOM v2 — Charts / Core / API
 * Cliente de los endpoints de charts. Aislado para que el resto del código no
 * haga fetch directo.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS = (window.AXIOM = window.AXIOM || {});
  NS.Charts = NS.Charts || {};

  async function jget(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  async function jsend(url, method, body) {
    const r = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  NS.Charts.API = {
    // Estado
    getChartState: () => jget('/api/charts/state'),

    // Búsqueda de coins (el endpoint vive en el router de watchlist)
    searchCoins: (q, limit = 8) => jget(`/api/watchlist/search?q=${encodeURIComponent(q)}&limit=${limit}`),

    // Indicadores (globales)
    getIndicators:    () => jget('/api/charts/indicators'),
    saveIndicator:    (data) => jsend('/api/charts/indicators', 'POST', data),
    updateIndicator:  (id, data) => jsend(`/api/charts/indicators/${id}`, 'PUT', data),
    deleteIndicator:  (id) => jsend(`/api/charts/indicators/${id}`, 'DELETE', {}),

    // Dibujos (por coin)
    getChartDrawings: (coinId) => jget(`/api/charts/drawings/${coinId}`),
    saveDrawing:      (data) => jsend('/api/charts/drawings', 'POST', data),
    updateDrawing:    (id, data) => jsend(`/api/charts/drawings/${id}`, 'PUT', data),
    deleteDrawing:    (id) => jsend(`/api/charts/drawings/${id}`, 'DELETE', {}),
  };
})();
