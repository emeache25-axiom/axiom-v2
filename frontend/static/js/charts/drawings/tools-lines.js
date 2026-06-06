/**
 * AXIOM v2 — Charts / Drawings / Tools: Líneas
 * hline (horizontal), vline (vertical), tline (tendencia con extensión).
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const R   = window.AXIOM.Charts.Drawings;
  const Geo = window.AXIOM.Charts.DrawingGeo;

  // ── Línea horizontal ────────────────────────────────────────────────────────
  R.register({
    type: 'hline', label: 'Línea horizontal', icon: 'ti-minus', numPoints: 1,
    defaults: { color: '#78716C', lineWidth: 1, lineStyle: 'solid', label: '' },
    fields: [
      { key: 'color',     label: 'Color',   type: 'color' },
      { key: 'lineWidth', label: 'Grosor',  type: 'range', min: 0.5, max: 4, step: 0.5 },
      { key: 'lineStyle', label: 'Estilo',  type: 'select', options: [
        { v: 'solid', l: 'Sólida' }, { v: 'dashed', l: 'Punteada' }] },
      { key: 'label',     label: 'Etiqueta',type: 'text' },
    ],
    render(ctx, px, s, st) {
      const y = px[0].y;
      ctx.beginPath();
      ctx.strokeStyle = st.selected ? '#F5F0EB' : (s.color || '#78716C');
      ctx.lineWidth = (s.lineWidth || 1) + (st.hovered ? 0.5 : 0);
      ctx.setLineDash(s.lineStyle === 'dashed' ? [5, 4] : []);
      ctx.moveTo(0, y); ctx.lineTo(st.chartW, y);
      ctx.stroke();
      if (s.label) {
        ctx.setLineDash([]);
        ctx.font = '10px IBM Plex Mono,monospace';
        ctx.fillStyle = s.color || '#78716C';
        ctx.fillText(s.label, 6, y - 4);
      }
    },
    hitTest(mx, my, px) {
      const h = Geo.hitHandle(mx, my, px);
      if (h >= 0) return { handle: h };
      return Geo.hitHLine(mx, my, px[0].y) ? { body: true } : null;
    },
  });

  // ── Línea vertical ──────────────────────────────────────────────────────────
  R.register({
    type: 'vline', label: 'Línea vertical', icon: 'ti-border-vertical', numPoints: 1,
    defaults: { color: '#78716C', lineWidth: 1, lineStyle: 'dashed' },
    fields: [
      { key: 'color',     label: 'Color',  type: 'color' },
      { key: 'lineWidth', label: 'Grosor', type: 'range', min: 0.5, max: 4, step: 0.5 },
      { key: 'lineStyle', label: 'Estilo', type: 'select', options: [
        { v: 'solid', l: 'Sólida' }, { v: 'dashed', l: 'Punteada' }] },
    ],
    render(ctx, px, s, st) {
      const x = px[0].x;
      ctx.beginPath();
      ctx.strokeStyle = st.selected ? '#F5F0EB' : (s.color || '#78716C');
      ctx.lineWidth = (s.lineWidth || 1) + (st.hovered ? 0.5 : 0);
      ctx.setLineDash(s.lineStyle === 'dashed' ? [5, 4] : []);
      ctx.moveTo(x, 0); ctx.lineTo(x, st.chartH);
      ctx.stroke();
    },
    hitTest(mx, my, px) {
      const h = Geo.hitHandle(mx, my, px);
      if (h >= 0) return { handle: h };
      return Geo.hitVLine(mx, my, px[0].x) ? { body: true } : null;
    },
  });

  // ── Línea de tendencia ──────────────────────────────────────────────────────
  R.register({
    type: 'tline', label: 'Línea de tendencia', icon: 'ti-trending-up', numPoints: 2,
    defaults: { color: '#2563EB', lineWidth: 1.5, lineStyle: 'solid', extend: 'none' },
    fields: [
      { key: 'color',     label: 'Color',     type: 'color' },
      { key: 'lineWidth', label: 'Grosor',    type: 'range', min: 0.5, max: 4, step: 0.5 },
      { key: 'lineStyle', label: 'Estilo',    type: 'select', options: [
        { v: 'solid', l: 'Sólida' }, { v: 'dashed', l: 'Punteada' }] },
      { key: 'extend',    label: 'Extensión', type: 'select', options: [
        { v: 'none',  l: 'Solo segmento' },
        { v: 'right', l: 'Extender derecha' },
        { v: 'left',  l: 'Extender izquierda' },
        { v: 'both',  l: 'Extender ambos' }] },
    ],
    render(ctx, px, s, st) {
      const [p1, p2] = px;
      const dx = p2.x - p1.x;
      ctx.strokeStyle = st.selected ? '#F5F0EB' : (s.color || '#2563EB');
      ctx.lineWidth = (s.lineWidth || 1.5) + (st.hovered ? 0.5 : 0);
      ctx.setLineDash(s.lineStyle === 'dashed' ? [6, 4] : []);

      const ext = s.extend || 'none';
      let ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y;

      if (Math.abs(dx) >= 0.001) {
        const slope = (p2.y - p1.y) / dx;
        const yAt = (x) => p1.y + slope * (x - p1.x);
        if (ext === 'left' || ext === 'both') { ax = 0; ay = yAt(0); }
        if (ext === 'right' || ext === 'both') { bx = st.chartW; by = yAt(st.chartW); }
      }

      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.stroke();
    },
    hitTest(mx, my, px) {
      const h = Geo.hitHandle(mx, my, px);
      if (h >= 0) return { handle: h };
      if (px.length < 2) return null;
      return Geo.hitSegment(mx, my, px[0], px[1]) ? { body: true } : null;
    },
  });
})();
