/**
 * AXIOM — Widget: regimen_mercado (RENDER)
 * ────────────────────────────────────────────────────────────────────────────
 * El régimen vigente en tres temporalidades, con su convicción.
 *
 * Cuarto widget del sistema, y el que Kepler más va a usar: cada pregunta
 * sobre el estado del mercado pasa por acá.
 *
 * QUÉ MUESTRA EL ARCO: el porcentaje es la CONVICCIÓN —cuánto coinciden las
 * señales entre sí—, y los segmentos de al lado son cuántas votaron igual
 * sobre el total. Esa distinción importa: 100% de convicción con 4 señales no
 * es lo mismo que 72% con 12, y sin los segmentos el número solo engaña.
 *
 * La DECLARACIÓN vive en `backend/domain/widgets.py`.
 * Ver AXIOM_sistema_widgets.md
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = (window.AXIOM = window.AXIOM || {});
  const Fmt = NS.Fmt;

  const TF = {
    largo: { icon: 'ti-clock-hour-4',  color: '#2563EB',
             bg: 'rgba(37,99,235,.15)',  label: 'Largo plazo' },
    medio: { icon: 'ti-calendar-week', color: '#56A14F',
             bg: 'rgba(86,161,79,.15)',  label: 'Medio plazo' },
    corto: { icon: 'ti-bolt',          color: '#B47514',
             bg: 'rgba(180,117,20,.15)', label: 'Corto plazo' },
  };

  const COLOR = {
    ACUMULACION: '#2563EB', ALCISTA_A: '#56A14F', ALCISTA_B: '#B47514',
    DISTRIBUCION: '#D86326', BAJISTA: '#D93B3B',
    ALCISTA: '#56A14F', LATERAL: '#78716C',
  };

  const NOMBRE = {
    ACUMULACION: 'Acumulación', ALCISTA_A: 'Alcista temprano',
    ALCISTA_B: 'Alcista tardío', DISTRIBUCION: 'Distribución',
    BAJISTA: 'Bajista', ALCISTA: 'Alcista', LATERAL: 'Lateral',
  };

  const color  = r => COLOR[r]  || '#78716C';
  const nombre = r => NOMBRE[r] || r || '—';

  /**
   * Arco doble con glow. El número del centro es la convicción; los cuadraditos
   * de la derecha, cuántas señales coincidieron sobre el total.
   */
  function arco(pct, col, total, consenso, compacto) {
    const id = 'g' + Math.random().toString(36).slice(2, 7);
    const p  = Math.max(0, Math.min(100, Number(pct) || 0));
    const r1 = compacto ? 22 : 28;
    const r2 = compacto ? 15 : 20;
    const size = compacto ? 58 : 72;
    const c1 = 2 * Math.PI * r1, c2 = 2 * Math.PI * r2;
    const o1 = c1 * (1 - p / 100), o2 = c2 * (1 - p / 100);
    const cx = size / 2;

    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
           style="flex-shrink:0;overflow:visible;">
        <defs>
          <filter id="${id}" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <circle cx="${cx}" cy="${cx}" r="${r1}" fill="none" stroke="#1A1917" stroke-width="5"/>
        <circle cx="${cx}" cy="${cx}" r="${r1}" fill="none" stroke="${col}" stroke-width="2"
          stroke-dasharray="${c1.toFixed(2)}" stroke-dashoffset="${o1.toFixed(2)}"
          stroke-linecap="round" transform="rotate(-90 ${cx} ${cx})"
          filter="url(#${id})" opacity="0.55"/>
        <circle cx="${cx}" cy="${cx}" r="${r1}" fill="none" stroke="${col}" stroke-width="2"
          stroke-dasharray="${c1.toFixed(2)}" stroke-dashoffset="${o1.toFixed(2)}"
          stroke-linecap="round" transform="rotate(-90 ${cx} ${cx})"/>
        <circle cx="${cx}" cy="${cx}" r="${r2}" fill="none" stroke="#1A1917" stroke-width="4"/>
        <circle cx="${cx}" cy="${cx}" r="${r2}" fill="none" stroke="${col}" stroke-width="3"
          stroke-dasharray="${c2.toFixed(2)}" stroke-dashoffset="${o2.toFixed(2)}"
          stroke-linecap="round" transform="rotate(-90 ${cx} ${cx})"
          filter="url(#${id})" opacity="0.6"/>
        <circle cx="${cx}" cy="${cx}" r="${r2}" fill="none" stroke="${col}" stroke-width="3"
          stroke-dasharray="${c2.toFixed(2)}" stroke-dashoffset="${o2.toFixed(2)}"
          stroke-linecap="round" transform="rotate(-90 ${cx} ${cx})"/>
        <text x="${cx}" y="${cx + 4}" text-anchor="middle"
          font-family="'IBM Plex Mono',monospace" font-size="${compacto ? 11 : 12}"
          font-weight="600" fill="#F5F0EB">${Math.round(p)}%</text>
      </svg>`;

    // Sin dato de consenso el arco va solo: mejor eso que inventar segmentos.
    if (compacto || !total) return svg;

    const segs = Array.from({ length: total }, (_, i) =>
      `<div style="width:9px;height:9px;border-radius:2px;
        background:${i < (consenso || 0) ? col : '#2C2926'};"></div>`).join('');

    return `
      <div style="display:flex;align-items:center;gap:14px;">
        ${svg}
        <div>
          <div style="font-family:var(--f2,monospace);font-size:10px;
            color:var(--t3,#78716C);margin-bottom:5px;">Convicción</div>
          <div style="display:flex;gap:3px;flex-wrap:wrap;max-width:80px;">${segs}</div>
          <div style="font-family:var(--f2,monospace);font-size:10px;
            color:var(--t3,#78716C);margin-top:4px;"
            >${consenso || 0} / ${total} señales</div>
        </div>
      </div>`;
  }

  /** Tarjeta de una temporalidad. */
  function tarjeta(tf, r, compacto) {
    const cfg = TF[tf];
    const col = color(r.regime);

    const confirmado = r.is_confirmed
      ? `<span style="font-family:var(--f2,monospace);font-size:10px;color:#56A14F;">✓ Confirmado</span>`
      : `<span style="font-family:var(--f2,monospace);font-size:10px;color:var(--t3,#78716C);">Sin confirmar</span>`;

    return `
      <div class="card" style="border-top:3px solid ${cfg.color};
           border-left:1px solid ${cfg.color}40;border-right:1px solid ${cfg.color}40;
           border-bottom:1px solid ${cfg.color}40;${compacto ? 'padding:12px;' : ''}">
        <div style="display:flex;align-items:center;justify-content:space-between;
                    margin-bottom:${compacto ? 8 : 12}px;gap:8px;">
          <div style="display:flex;align-items:center;gap:6px;min-width:0;">
            <div style="width:26px;height:26px;border-radius:6px;background:${cfg.bg};
                        display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <i class="ti ${cfg.icon}" style="font-size:13px;color:${cfg.color};"></i>
            </div>
            <span style="font-size:13px;font-weight:600;color:#F5F0EB;
              letter-spacing:-.01em;white-space:nowrap;">${cfg.label}</span>
          </div>
        </div>

        <div style="font-size:${compacto ? 16 : 20}px;font-weight:700;
             letter-spacing:-.02em;margin-bottom:${compacto ? 10 : 14}px;color:${col};"
          >${Fmt.esc(nombre(r.regime))}</div>

        ${arco(r.conviction, col, r.signals_expected, r.consensus, compacto)}
        ${compacto ? '' : `<div style="margin-top:10px;">${confirmado}</div>`}
      </div>`;
  }

  // ── El widget ───────────────────────────────────────────────────────────────

  NS.Widgets.render('regimen_mercado', {

    render(datos, ctx) {
      const d = (datos && (datos.resultado || datos.regimes || datos)) || {};
      if (!d.largo && !d.medio && !d.corto) {
        return `<div style="padding:24px;text-align:center;color:var(--t3,#78716C);
          font-size:13px;">No hay un snapshot de régimen disponible.</div>`;
      }

      const compacto = ctx.densidad === 'compacto';
      // En compacto las tarjetas van apiladas; con más espacio, en fila.
      const cols = compacto ? '1fr' : 'repeat(3,1fr)';

      const tarjetas = ['largo', 'medio', 'corto']
        .filter(tf => d[tf])
        .map(tf => tarjeta(tf, d[tf], compacto))
        .join('');

      const pie = [];
      if (d.btc_price != null) {
        pie.push(`BTC $${Number(d.btc_price).toLocaleString('es-AR', {maximumFractionDigits: 0})}`);
      }
      if (d.created_at) {
        const min = Math.round((Date.now() - new Date(d.created_at)) / 60000);
        pie.push(min < 60 ? `hace ${min} min` : `hace ${Math.round(min / 60)}h`);
      }

      return `
        <div style="display:grid;grid-template-columns:${cols};gap:14px;">
          ${tarjetas}
        </div>
        ${pie.length ? `<div style="font-family:var(--f2,monospace);font-size:10px;
          color:var(--t3,#78716C);margin-top:10px;text-align:right;"
          >${pie.join(' · ')}</div>` : ''}`;
    },
  });
})();
