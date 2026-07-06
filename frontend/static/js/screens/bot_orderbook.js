/* ────────────────────────────────────────────────────────────────────────────
 * AXIOM v2 — BOT / Order Book (microestructura)
 *
 * Tab dentro de la pantalla BOT. Muestra, para los pares capturados (ONT/ROSE):
 *   - El libro actual con profundidad (bids/asks + barras de volumen).
 *   - La evolución de spread e imbalance en el tiempo (SVG liviano, sin libs).
 *
 * Lee de /api/orderbook/*. Precios en satoshis. Estilo Stone Dark (vars de AXIOM).
 * Se engancha en bot.js como una tab más (ver instrucciones de integración).
 * ──────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const NS = (window.AXIOM = window.AXIOM || {});

  // ── API del módulo ─────────────────────────────────────────────────────────
  const obApi = {
    pairs:  ()               => fetch('/api/orderbook/pairs').then(r => r.json()),
    latest: (pair)           => fetch(`/api/orderbook/latest/${pair}`).then(r => r.json()),
    series: (pair, mins=60)  => fetch(`/api/orderbook/series/${pair}?minutes=${mins}`).then(r => r.json()),
  };

  // ── Helpers de formato ───────────────────────────────────────────────────────
  const fmtSat = (v) => v == null ? '—' : Number(v).toFixed(2);
  const fmtVol = (v) => {
    if (v == null) return '—';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return Number(v).toFixed(0);
  };
  const fmtPct = (v) => v == null ? '—' : Number(v).toFixed(3) + '%';

  // ── Mini-gráfico de línea en SVG (sin librerías) ─────────────────────────────
  function sparkPath(values, w, h, pad = 2) {
    const vals = values.filter(v => v != null);
    if (vals.length < 2) return '';
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = (max - min) || 1;
    const n = values.length;
    const pts = values.map((v, i) => {
      if (v == null) return null;
      const x = pad + (i / (n - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / range) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).filter(Boolean).join(' ');
    return pts;
  }

  function lineChart(values, w, h, color, label, fmtFn, zeroLine = false) {
    const vals = values.filter(v => v != null);
    const cur = vals.length ? vals[vals.length - 1] : null;
    const min = vals.length ? Math.min(...vals) : 0;
    const max = vals.length ? Math.max(...vals) : 0;
    const pts = sparkPath(values, w, h);
    // línea de cero (útil para imbalance ∈ [-1,1])
    let zeroEl = '';
    if (zeroLine && vals.length) {
      const range = (max - min) || 1;
      if (min < 0 && max > 0) {
        const y = h - 2 - ((0 - min) / range) * (h - 4);
        zeroEl = `<line x1="0" y1="${y.toFixed(1)}" x2="${w}" y2="${y.toFixed(1)}" stroke="var(--w1)" stroke-width="0.5" stroke-dasharray="3,3"/>`;
      }
    }
    return `
      <div style="background:var(--surface);border:0.5px solid var(--w1);border-radius:10px;padding:12px;flex:1;min-width:260px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
          <span style="font-size:12px;color:var(--t3);font-weight:600;">${label}</span>
          <span style="font-size:15px;color:${color};font-family:var(--f2,monospace);font-weight:600;">${fmtFn(cur)}</span>
        </div>
        <svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block;">
          ${zeroEl}
          <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/>
        </svg>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t3);margin-top:4px;font-family:var(--f2,monospace);">
          <span>min ${fmtFn(min)}</span><span>max ${fmtFn(max)}</span>
        </div>
      </div>`;
  }

  // ── Libro de órdenes con barras de profundidad ───────────────────────────────
  function renderBook(data) {
    if (!data || !data.bids || !data.asks) {
      return `<div style="color:var(--t3);font-size:13px;padding:20px;text-align:center;">Sin datos del libro todavía.</div>`;
    }
    const maxVol = Math.max(
      ...data.bids.map(b => b.volume),
      ...data.asks.map(a => a.volume),
      1
    );
    // asks de mayor a menor precio (los más lejanos arriba), bids de mayor a menor
    const asksDesc = [...data.asks].reverse();
    const rowAsk = (lvl) => {
      const pctW = (lvl.volume / maxVol * 100).toFixed(0);
      return `<div style="position:relative;display:flex;justify-content:space-between;padding:3px 8px;font-size:12px;font-family:var(--f2,monospace);">
        <div style="position:absolute;right:0;top:0;bottom:0;width:${pctW}%;background:rgba(217,59,59,0.10);"></div>
        <span style="color:#D93B3B;position:relative;">${fmtSat(lvl.price_sat)}</span>
        <span style="color:var(--t2,#b5afa8);position:relative;">${fmtVol(lvl.volume)}</span>
      </div>`;
    };
    const rowBid = (lvl) => {
      const pctW = (lvl.volume / maxVol * 100).toFixed(0);
      return `<div style="position:relative;display:flex;justify-content:space-between;padding:3px 8px;font-size:12px;font-family:var(--f2,monospace);">
        <div style="position:absolute;right:0;top:0;bottom:0;width:${pctW}%;background:rgba(86,161,79,0.10);"></div>
        <span style="color:#56A14F;position:relative;">${fmtSat(lvl.price_sat)}</span>
        <span style="color:var(--t2,#b5afa8);position:relative;">${fmtVol(lvl.volume)}</span>
      </div>`;
    };
    const spreadRow = `
      <div style="display:flex;justify-content:space-between;padding:6px 8px;margin:4px 0;
                  background:var(--c2,#26231f);border-radius:6px;font-size:11px;">
        <span style="color:var(--t3);">spread</span>
        <span style="color:var(--cy,#d8a657);font-family:var(--f2,monospace);font-weight:600;">${fmtPct(data.spread_pct)}</span>
      </div>`;
    return `
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t3);padding:0 8px 6px;text-transform:uppercase;letter-spacing:0.05em;">
        <span>precio (sat)</span><span>volumen</span>
      </div>
      ${asksDesc.map(rowAsk).join('')}
      ${spreadRow}
      ${data.bids.map(rowBid).join('')}`;
  }

  // ── Módulo de la tab ─────────────────────────────────────────────────────────
  NS.BotOrderBook = {
    _pair: null,
    _pairs: [],
    _timer: null,

    async render(containerId) {
      const el = document.getElementById(containerId);
      if (!el) return;
      el.innerHTML = `<div style="color:var(--t3);font-size:13px;padding:20px;">Cargando order book…</div>`;

      try {
        const res = await obApi.pairs();
        this._pairs = res.pairs || [];
      } catch (e) {
        el.innerHTML = `<div style="color:#D93B3B;font-size:13px;padding:20px;">No se pudo leer el order book. ¿El capturador está corriendo?</div>`;
        return;
      }
      if (!this._pairs.length) {
        el.innerHTML = `<div style="color:var(--t3);font-size:13px;padding:20px;">Todavía no hay datos capturados. El capturador acaba de arrancar; volvé en unos minutos.</div>`;
        return;
      }
      if (!this._pair) this._pair = this._pairs[0].pair;

      el.innerHTML = `
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
          ${this._pairs.map(p => `
            <button data-ob-pair="${p.pair}" style="padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;
              border:0.5px solid ${p.pair === this._pair ? 'var(--cy,#d8a657)' : 'var(--w1)'};
              background:${p.pair === this._pair ? 'var(--cyg,rgba(216,166,87,0.12))' : 'transparent'};
              color:${p.pair === this._pair ? 'var(--cy,#d8a657)' : 'var(--t3)'};">
              ${p.pair} · ${(p.snapshots||0).toLocaleString()} snaps
            </button>`).join('')}
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
          <div style="flex:1;min-width:280px;max-width:380px;background:var(--surface);border:0.5px solid var(--w1);border-radius:12px;padding:14px;">
            <div style="font-size:13px;font-weight:600;color:var(--t1);margin-bottom:10px;">Libro · <span id="ob-pair-label">${this._pair}</span></div>
            <div id="ob-book"></div>
          </div>
          <div style="flex:2;min-width:300px;display:flex;flex-direction:column;gap:12px;">
            <div style="display:flex;gap:12px;flex-wrap:wrap;" id="ob-charts"></div>
            <div style="font-size:11px;color:var(--t3);">Ventana: última hora · actualiza cada 5 s</div>
          </div>
        </div>`;

      el.querySelectorAll('[data-ob-pair]').forEach(b => {
        b.onclick = () => { this._pair = b.dataset.obPair; this.render(containerId); };
      });

      await this._refresh();
      this._startPolling(containerId);
    },

    async _refresh() {
      try {
        const [book, series] = await Promise.all([
          obApi.latest(this._pair),
          obApi.series(this._pair, 60),
        ]);
        const bookEl = document.getElementById('ob-book');
        if (bookEl) bookEl.innerHTML = renderBook(book);

        const pts = (series.points || []);
        const spreads = pts.map(p => p.spread_pct);
        const imbs    = pts.map(p => p.imbalance);
        const mids    = pts.map(p => p.mid_sat);
        const chartsEl = document.getElementById('ob-charts');
        if (chartsEl) {
          chartsEl.innerHTML =
            lineChart(mids,    260, 70, 'var(--cy,#d8a657)', 'Precio medio (sat)', fmtSat) +
            lineChart(spreads, 260, 70, '#4A9DB8',           'Spread',             fmtPct) +
            lineChart(imbs,    260, 70, '#B87A4A',           'Desequilibrio',      (v)=>v==null?'—':Number(v).toFixed(3), true);
        }
      } catch (e) {
        // silencioso: el próximo ciclo reintenta
      }
    },

    _startPolling(containerId) {
      this._stopPolling();
      this._timer = setInterval(() => {
        // si la tab ya no está visible, dejar de refrescar
        if (!document.getElementById('ob-book')) { this._stopPolling(); return; }
        this._refresh();
      }, 5000);
    },

    _stopPolling() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },
  };
})();
