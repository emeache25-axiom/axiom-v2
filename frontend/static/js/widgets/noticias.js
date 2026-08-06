/**
 * AXIOM — Widget: noticias (RENDER)
 * ────────────────────────────────────────────────────────────────────────────
 * Las noticias como tarjetas navegables, en vez de una lista de títulos con URLs
 * crudas. Sirve a las dos capacidades de noticias (de una coin y del mercado):
 * ambas devuelven la misma forma de artículo.
 *
 * Cada tarjeta: imagen (si hay), título que enlaza a la nota, fuente y cuándo se
 * publicó, y un extracto del resumen. El link abre en pestaña nueva.
 *
 * La DECLARACIÓN vive en `backend/domain/widgets.py`.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = (window.AXIOM = window.AXIOM || {});
  const Fmt = NS.Fmt;

  const C = {
    text:   'var(--t1,#F5F0EB)',
    text2:  'var(--t2,#A8A29E)',
    muted:  'var(--t3,#78716C)',
    faint:  'var(--t4,#57534E)',
    border: 'var(--w1,#2C2926)',
    panel:  'var(--c1,#12110F)',
    link:   '#6E9BF5',
  };

  // "hace 3 h", "hace 2 d", o la fecha si es viejo.
  function cuando(art) {
    const ts = art.published_ts
      ? Number(art.published_ts) * 1000
      : (art.published ? Date.parse(art.published) : NaN);
    if (!isFinite(ts)) return '';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1)  return 'recién';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24)   return `hace ${h} h`;
    const d = Math.floor(h / 24);
    if (d < 7)    return `hace ${d} d`;
    try {
      return new Date(ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
    } catch (e) { return ''; }
  }

  function recorte(s, n) {
    if (!s) return '';
    const t = String(s).trim();
    return t.length > n ? t.slice(0, n).trimEnd() + '…' : t;
  }

  function tarjeta(art) {
    const url = art.link || art.url || '';
    const titulo = art.title || art.titulo || '(sin título)';
    const resumen = recorte(art.summary || art.resumen || '', 160);
    const fuente = art.source || art.fuente || '';
    const ts = cuando(art);
    const img = art.image || art.imagen;

    const imgHtml = img
      ? `<img src="${Fmt.esc(img)}" loading="lazy"
           style="width:82px;height:82px;object-fit:cover;border-radius:8px;
                  flex-shrink:0;background:${C.panel};"
           onerror="this.style.display='none'">`
      : '';

    return `
      <a href="${Fmt.esc(url)}" target="_blank" rel="noopener noreferrer"
         style="display:flex;gap:11px;padding:11px;background:${C.panel};
                border:0.5px solid ${C.border};border-radius:10px;
                text-decoration:none;transition:border-color .15s;"
         onmouseover="this.style.borderColor='${C.muted}'"
         onmouseout="this.style.borderColor='${C.border}'">
        ${imgHtml}
        <div style="min-width:0;flex:1;display:flex;flex-direction:column;">
          <div style="font-size:13px;font-weight:600;color:${C.text};line-height:1.35;
                      margin-bottom:4px;">${Fmt.esc(titulo)}</div>
          ${resumen ? `<div style="font-size:11px;color:${C.text2};line-height:1.45;
             margin-bottom:6px;">${Fmt.esc(resumen)}</div>` : ''}
          <div style="margin-top:auto;font-family:var(--f2,monospace);font-size:10px;
                      color:${C.muted};display:flex;gap:7px;align-items:center;">
            ${fuente ? `<span style="color:${C.link};">${Fmt.esc(fuente)}</span>` : ''}
            ${fuente && ts ? '·' : ''}
            ${ts ? `<span>${ts}</span>` : ''}
          </div>
        </div>
      </a>`;
  }

  // Se registra bajo los dos IDs: noticias de una coin y del mercado comparten
  // el mismo render (misma forma de artículo). El registro busca el render por
  // ID del widget, así que ambos IDs apuntan a este mismo impl.
  const impl = {

    render(datos, ctx) {
      const d = (datos && (datos.resultado || datos)) || {};
      const arts = Array.isArray(d.articulos) ? d.articulos
                 : Array.isArray(d.noticias) ? d.noticias
                 : Array.isArray(d) ? d : [];

      if (!arts.length) {
        return `<div style="padding:24px;text-align:center;color:${C.muted};
          font-size:13px;">No hay noticias recientes para mostrar.</div>`;
      }

      const tope = ctx.contexto === 'panel' ? 4 : 8;

      return `
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${arts.slice(0, tope).map(tarjeta).join('')}
        </div>`;
    },
  };

  NS.Widgets.render('noticias_coin_w', impl);
  NS.Widgets.render('noticias_mercado_w', impl);
})();
