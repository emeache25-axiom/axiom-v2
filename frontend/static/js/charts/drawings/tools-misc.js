/**
 * AXIOM v2 — Charts / Drawings / Tools: Fibonacci, Regla, Texto
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const R   = window.AXIOM.Charts.Drawings;
  const Geo = window.AXIOM.Charts.DrawingGeo;

  // ── Fibonacci Retracement ───────────────────────────────────────────────────
  R.register({
    type: 'fib', label: 'Fibonacci', icon: 'ti-wave-square', numPoints: 2,
    defaults: { lineWidth: 1, levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] },
    fields: [
      { key: 'lineWidth', label: 'Grosor', type: 'range', min: 0.5, max: 3, step: 0.5 },
    ],
    render(ctx, px, s, st) {
      const [p1, p2] = px;
      const coords = st.coords;
      // precios de los dos puntos (los recuperamos de los puntos lógicos)
      const r1 = st.points[0], r2 = st.points[1];
      const priceHigh = Math.max(r1.price, r2.price);
      const priceLow  = Math.min(r1.price, r2.price);
      const levels = s.levels || [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      const COLORS = {
        0: '#78716C', 0.236: '#2563EB', 0.382: '#56A14F',
        0.5: '#C9A84C', 0.618: '#D86326', 0.786: '#D93B3B', 1: '#78716C',
      };
      const xLeft = Math.min(p1.x, p2.x);
      const xRight = st.chartW - 4;

      for (const lvl of levels) {
        const price = priceHigh - (priceHigh - priceLow) * lvl;
        const y = coords.priceToY(price);
        if (y == null) continue;
        const color = COLORS[lvl] || '#B47514';
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.75;
        ctx.setLineDash([3, 3]);
        ctx.moveTo(xLeft, y); ctx.lineTo(xRight - 70, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '9px IBM Plex Mono,monospace';
        ctx.fillStyle = color;
        ctx.fillText(`${(lvl * 100).toFixed(1)}%  ${Geo.fmtPrice(price)}`, xRight - 68, y - 2);
      }
      // Línea vertical de anclaje entre los dos puntos
      ctx.beginPath();
      ctx.strokeStyle = st.selected ? '#F5F0EB' : '#B47514';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p1.x, p2.y);
      ctx.stroke();
    },
    hitTest(mx, my, px) {
      const h = Geo.hitHandle(mx, my, px);
      if (h >= 0) return { handle: h };
      if (px.length < 2) return null;
      const minX = Math.min(px[0].x, px[1].x), maxX = Math.max(px[0].x, px[1].x);
      const minY = Math.min(px[0].y, px[1].y), maxY = Math.max(px[0].y, px[1].y);
      return (mx >= minX - 10 && mx <= maxX + 10 && my >= minY - 6 && my <= maxY + 6)
        ? { body: true } : null;
    },
  });

  // ── Regla de precio (ruler) ─────────────────────────────────────────────────
  R.register({
    type: 'ruler', label: 'Regla de precio', icon: 'ti-ruler-2', numPoints: 2,
    defaults: { color: '#C9A84C', lineWidth: 1 },
    fields: [
      { key: 'color',     label: 'Color',  type: 'color' },
      { key: 'lineWidth', label: 'Grosor', type: 'range', min: 0.5, max: 3, step: 0.5 },
    ],
    render(ctx, px, s, st) {
      const [p1, p2] = px;
      const r1 = st.points[0], r2 = st.points[1];
      const color = s.color || '#C9A84C';

      ctx.beginPath();
      ctx.strokeStyle = st.selected ? '#F5F0EB' : color;
      ctx.lineWidth = s.lineWidth || 1;
      ctx.setLineDash([4, 3]);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      // Extensiones del rectángulo
      ctx.beginPath();
      ctx.strokeStyle = color + '50';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([]);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p1.x, p2.y);
      ctx.moveTo(p2.x, p1.y); ctx.lineTo(p2.x, p2.y);
      ctx.moveTo(p1.x, p2.y); ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      const priceDiff = r2.price - r1.price;
      const pct = r1.price > 0 ? (priceDiff / r1.price * 100) : 0;
      const sign = priceDiff >= 0 ? '+' : '';
      const label = `${sign}${Geo.fmtPrice(priceDiff)}  ${sign}${pct.toFixed(2)}%`;
      ctx.font = '11px IBM Plex Mono,monospace';
      const tw = ctx.measureText(label).width;
      const mx = (p1.x + p2.x) / 2, myc = (p1.y + p2.y) / 2;
      ctx.fillStyle = 'rgba(15,14,13,.9)';
      ctx.beginPath();
      ctx.roundRect(mx - tw / 2 - 6, myc - 10, tw + 12, 18, 3);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.fillStyle = priceDiff >= 0 ? '#56A14F' : '#D93B3B';
      ctx.fillText(label, mx - tw / 2, myc + 4);
    },
    hitTest(mx, my, px) {
      const h = Geo.hitHandle(mx, my, px);
      if (h >= 0) return { handle: h };
      if (px.length < 2) return null;
      return Geo.hitSegment(mx, my, px[0], px[1]) ? { body: true } : null;
    },
  });

  // ── Texto / Etiqueta ────────────────────────────────────────────────────────
  R.register({
    type: 'text', label: 'Etiqueta / Texto', icon: 'ti-typography', numPoints: 1,
    defaults: { color: '#C9A84C', fontSize: 12, text: 'Nota' },
    fields: [
      { key: 'text',     label: 'Texto',  type: 'text' },
      { key: 'color',    label: 'Color',  type: 'color' },
      { key: 'fontSize', label: 'Tamaño', type: 'number', min: 8, max: 24, step: 1 },
    ],
    render(ctx, px, s, st) {
      const pt = px[0];
      const text = s.text || 'Nota';
      const fs = s.fontSize || 12;
      ctx.font = `${fs}px IBM Plex Mono,monospace`;
      ctx.setLineDash([]);
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = st.hovered || st.selected ? 'rgba(44,41,38,.95)' : 'rgba(26,25,23,.85)';
      ctx.beginPath();
      ctx.roundRect(pt.x - 4, pt.y - fs - 2, tw + 10, fs + 8, 3);
      ctx.fill();
      ctx.strokeStyle = st.selected ? '#F5F0EB' : (s.color || '#C9A84C');
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.fillStyle = s.color || '#F5F0EB';
      ctx.fillText(text, pt.x + 2, pt.y);
    },
    hitTest(mx, my, px) {
      const h = Geo.hitHandle(mx, my, px);
      if (h >= 0) return { handle: h };
      return (Math.abs(mx - px[0].x) < 60 && Math.abs(my - px[0].y) < 16) ? { body: true } : null;
    },
  });
})();
