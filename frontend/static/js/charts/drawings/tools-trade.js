/**
 * AXIOM v2 — Charts / Drawings / Tools: Trade (Long / Short)
 * Posición con entrada (punto 1), target (punto 2), stop simétrico calculado.
 * Muestra zonas de ganancia/pérdida y ratio R:R.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const R   = window.AXIOM.Charts.Drawings;
  const Geo = window.AXIOM.Charts.DrawingGeo;

  function makeTrade(type, dir, label, icon, entryColor) {
    R.register({
      type, label, icon, numPoints: 2,
      defaults: { color: entryColor, lineWidth: 1, textColor: '#F5F0EB', textSize: 10, textPos: 'left' },
      fields: [
        { key: 'lineWidth', label: 'Grosor',       type: 'range',  min: 0.5, max: 3, step: 0.5 },
        { key: 'textColor', label: 'Color texto',  type: 'color' },
        { key: 'textSize',  label: 'Tamaño texto', type: 'number', min: 7, max: 18, step: 1 },
        { key: 'textPos',   label: 'Posición',     type: 'select', options: [
          { v: 'left', l: 'Izquierda' }, { v: 'center', l: 'Centro' }, { v: 'right', l: 'Derecha' } ] },
      ],
      render(ctx, px, s, st) {
        const [p1, p2] = px;
        const coords = st.coords;
        const r1 = st.points[0], r2 = st.points[1];
        const entry = r1.price;
        const target = r2.price;
        const risk = Math.abs(target - entry);
        const stop = dir === 'long' ? entry - risk : entry + risk;

        const yEntry  = coords.priceToY(entry);
        const yTarget = coords.priceToY(target);
        const yStop   = coords.priceToY(stop);
        if (yEntry == null || yTarget == null || yStop == null) return;

        const cEntry = entryColor;
        const cTarget = dir === 'long' ? '#56A14F22' : '#D93B3B22';
        const cStop   = dir === 'long' ? '#D93B3B22' : '#56A14F22';
        // Ancho fijo entre los dos puntos (estilo TradingView)
        const xL = Math.min(p1.x, p2.x);
        const xR = Math.max(p1.x, p2.x);
        const w = xR - xL;

        ctx.setLineDash([]);
        // Zona target (ganancia)
        ctx.fillStyle = cTarget;
        ctx.fillRect(xL, Math.min(yEntry, yTarget), w, Math.abs(yTarget - yEntry));
        // Zona stop (pérdida)
        ctx.fillStyle = cStop;
        ctx.fillRect(xL, Math.min(yEntry, yStop), w, Math.abs(yStop - yEntry));
        // Borde de las zonas
        ctx.strokeStyle = (dir === 'long' ? '#56A14F' : '#D93B3B') + '60';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(xL, Math.min(yEntry, yTarget), w, Math.abs(yTarget - yEntry));
        ctx.strokeStyle = (dir === 'long' ? '#D93B3B' : '#56A14F') + '60';
        ctx.strokeRect(xL, Math.min(yEntry, yStop), w, Math.abs(yStop - yEntry));
        // Línea de entrada (resaltada)
        ctx.beginPath();
        ctx.strokeStyle = st.selected ? '#F5F0EB' : cEntry;
        ctx.lineWidth = (s.lineWidth || 1) + (st.hovered ? 0.5 : 0);
        ctx.moveTo(xL, yEntry); ctx.lineTo(xR, yEntry);
        ctx.stroke();

        // Labels con estilo configurable
        const tSize  = s.textSize || 10;
        const tColor = s.textColor || '#F5F0EB';
        const tPos   = s.textPos || 'left';
        ctx.font = `${tSize}px IBM Plex Mono,monospace`;
        const rr = risk > 0 ? (Math.abs(target - entry) / risk).toFixed(1) : '—';

        const lblEntry  = `${dir.toUpperCase()}  ${Geo.fmtPrice(entry)}`;
        const lblTarget = `TP ${Geo.fmtPrice(target)}  R:R ${rr}`;
        const lblStop   = `SL ${Geo.fmtPrice(stop)}`;
        const xFor = (lbl) => {
          if (tPos === 'right')  return xR - ctx.measureText(lbl).width - 4;
          if (tPos === 'center') return xL + (w - ctx.measureText(lbl).width) / 2;
          return xL + 4;
        };

        ctx.fillStyle = tColor;
        ctx.fillText(lblEntry, xFor(lblEntry), yEntry - 4);
        ctx.fillText(lblTarget, xFor(lblTarget), Math.min(yEntry, yTarget) + 11);
        ctx.fillText(lblStop, xFor(lblStop), Math.max(yEntry, yStop) - 4);
      },
      hitTest(mx, my, px) {
        const h = Geo.hitHandle(mx, my, px);
        if (h >= 0) return { handle: h };
        if (px.length < 2) return null;
        const minX = Math.min(px[0].x, px[1].x), maxX = Math.max(px[0].x, px[1].x);
        const minY = Math.min(px[0].y, px[1].y), maxY = Math.max(px[0].y, px[1].y);
        return (mx >= minX - 6 && mx <= maxX + 6 && my >= minY - 6 && my <= maxY + 6)
          ? { body: true } : null;
      },
    });
  }

  makeTrade('long',  'long',  'Entrada largo', 'ti-arrow-bar-up',   '#56A14F');
  makeTrade('short', 'short', 'Entrada corto', 'ti-arrow-bar-down', '#D93B3B');
})();
