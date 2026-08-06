/**
 * AXIOM — Widget: ficha_proyecto (RENDER)
 * ────────────────────────────────────────────────────────────────────────────
 * La ficha de un proyecto: qué es, su emisión, sus máximos/mínimos históricos y
 * sus enlaces. Es la vista de info_proyecto — antes Kepler volcaba todo esto en
 * texto (descripción larga + URLs crudas); acá es una tarjeta navegable.
 *
 * Los links vienen como objeto con claves variables (homepage, github, twitter,
 * whitepaper, explorer, chat, subreddit, facebook...). Se muestran solo los que
 * están poblados, cada uno con su ícono y etiqueta.
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
  };

  // Links conocidos → ícono (tabler) + etiqueta. El orden acá es el orden de
  // aparición; los que no estén en el map se muestran al final con ícono genérico.
  const LINKS = {
    homepage:   { icon: 'ti-world',        label: 'Web' },
    whitepaper: { icon: 'ti-file-text',    label: 'Whitepaper' },
    github:     { icon: 'ti-brand-github', label: 'GitHub' },
    twitter:    { icon: 'ti-brand-x',      label: 'X' },
    explorer:   { icon: 'ti-search',       label: 'Explorer' },
    chat:       { icon: 'ti-brand-discord',label: 'Discord' },
    subreddit:  { icon: 'ti-brand-reddit', label: 'Reddit' },
    facebook:   { icon: 'ti-brand-facebook',label: 'Facebook' },
    telegram:   { icon: 'ti-brand-telegram',label: 'Telegram' },
  };
  const ORDEN_LINKS = ['homepage', 'whitepaper', 'github', 'twitter', 'explorer',
                       'chat', 'telegram', 'subreddit', 'facebook'];

  function money(n) {
    if (n == null) return null;
    const v = Number(n);
    if (!isFinite(v)) return null;
    if (v >= 1e12) return (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9)  return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6)  return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3)  return (v / 1e3).toFixed(1) + 'K';
    return String(v);
  }

  function precio(n) {
    if (n == null) return Fmt.NADA;
    const v = Number(n);
    if (!isFinite(v)) return Fmt.NADA;
    return v >= 1 ? '$' + v.toLocaleString('es-AR', { maximumFractionDigits: 2 })
                  : '$' + v.toPrecision(4);
  }

  function fecha(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('es-AR', { year: 'numeric', month: 'short' });
    } catch (e) { return ''; }
  }

  // Dato en una grilla (label arriba, valor abajo).
  function dato(label, valor, sub) {
    return `
      <div style="min-width:0;">
        <div style="font-family:var(--f2,monospace);font-size:9px;color:${C.muted};
                    text-transform:uppercase;letter-spacing:.06em;">${label}</div>
        <div style="font-family:var(--f2,monospace);font-size:12px;color:${C.text};margin-top:2px;">${valor}</div>
        ${sub ? `<div style="font-size:9px;color:${C.faint};margin-top:1px;">${sub}</div>` : ''}
      </div>`;
  }

  NS.Widgets.render('ficha_proyecto', {

    render(datos, ctx) {
      const d = (datos && (datos.resultado || datos)) || {};

      const tieneAlgo = d.descripcion || d.links || d.supply_circulante != null || d.ath != null;
      if (!tieneAlgo) {
        return `<div style="padding:24px;text-align:center;color:${C.muted};
          font-size:13px;">No hay ficha de proyecto para esta coin.</div>`;
      }

      // ── Descripción (con ver más si es larga) ──
      let descHtml = '';
      const desc = (d.descripcion || '').trim();
      if (desc) {
        const corta = desc.length > 260;
        const idioma = d.descripcion_lang && d.descripcion_lang !== 'es'
          ? ` <span style="color:${C.faint};font-size:9px;">(${d.descripcion_lang})</span>` : '';
        const id = 'desc' + Math.random().toString(36).slice(2, 7);
        descHtml = `
          <div style="font-size:12px;line-height:1.55;color:${C.text2};margin-bottom:13px;">
            <span id="${id}-short">${Fmt.esc(corta ? desc.slice(0, 260) + '…' : desc)}${idioma}</span>
            ${corta ? `<span id="${id}-full" style="display:none;">${Fmt.esc(desc)}${idioma}</span>
              <a href="javascript:void(0)" data-desc-toggle="${id}"
                 style="color:#6E9BF5;text-decoration:none;font-size:11px;margin-left:4px;
                        white-space:nowrap;">ver más</a>` : ''}
          </div>`;
      }

      // ── Supply ──
      const supHtml = (d.supply_circulante != null || d.supply_total != null) ? `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;
                    padding:11px;background:${C.panel};border-radius:8px;margin-bottom:11px;">
          ${dato('Circulante', money(d.supply_circulante) || Fmt.NADA)}
          ${dato('Total', money(d.supply_total) || Fmt.NADA)}
          ${dato('Máximo', money(d.supply_max) || 'Sin límite')}
        </div>` : '';

      // ── ATH / ATL ──
      const athSub = d.ath_change_pct != null
        ? `${Number(d.ath_change_pct).toFixed(1)}% desde el ATH` : '';
      const athHtml = (d.ath != null || d.atl != null) ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;
                    padding:11px;background:${C.panel};border-radius:8px;margin-bottom:11px;">
          ${dato('Máximo histórico', precio(d.ath),
                 [fecha(d.ath_date), athSub].filter(Boolean).join(' · '))}
          ${dato('Mínimo histórico', precio(d.atl), fecha(d.atl_date))}
        </div>` : '';

      // ── Categorías (chips) ──
      const cats = Array.isArray(d.categories) ? d.categories.filter(Boolean) : [];
      const catsHtml = cats.length ? `
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:11px;">
          ${cats.slice(0, 6).map(c => `<span style="font-size:10px;color:${C.text2};
             background:${C.panel};border:0.5px solid ${C.border};border-radius:11px;
             padding:2px 9px;">${Fmt.esc(c)}</span>`).join('')}
        </div>` : '';

      // ── Genesis ──
      const genHtml = d.genesis_date ? `
        <div style="font-family:var(--f2,monospace);font-size:10px;color:${C.muted};
                    margin-bottom:11px;">Génesis: ${Fmt.esc(d.genesis_date)}</div>` : '';

      // ── Links (botones) ──
      const links = d.links && typeof d.links === 'object' ? d.links : {};
      const clavesOrdenadas = [
        ...ORDEN_LINKS.filter(k => links[k]),
        ...Object.keys(links).filter(k => !ORDEN_LINKS.includes(k) && links[k]),
      ];
      const linksHtml = clavesOrdenadas.length ? `
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:11px;
                    border-top:0.5px solid ${C.border};">
          ${clavesOrdenadas.map(k => {
            const meta = LINKS[k] || { icon: 'ti-link', label: k };
            const url = links[k];
            return `<a href="${Fmt.esc(url)}" target="_blank" rel="noopener noreferrer"
              style="display:inline-flex;align-items:center;gap:5px;font-size:11px;
                     color:${C.text2};background:${C.panel};border:0.5px solid ${C.border};
                     border-radius:7px;padding:5px 10px;text-decoration:none;
                     transition:border-color .15s;"
              onmouseover="this.style.borderColor='${C.muted}'"
              onmouseout="this.style.borderColor='${C.border}'">
              <i class="ti ${meta.icon}" style="font-size:13px;"></i>${meta.label}</a>`;
          }).join('')}
        </div>` : '';

      return `
        <div style="padding:2px;">
          ${descHtml}
          ${supHtml}
          ${athHtml}
          ${catsHtml}
          ${genHtml}
          ${linksHtml}
        </div>`;
    },

    mount(el, ctx) {
      // Toggle "ver más" de la descripción.
      el.querySelectorAll('[data-desc-toggle]').forEach(a => {
        a.onclick = () => {
          const id = a.dataset.descToggle;
          const short = el.querySelector('#' + id + '-short');
          const full  = el.querySelector('#' + id + '-full');
          if (!short || !full) return;
          const abierto = full.style.display !== 'none';
          full.style.display  = abierto ? 'none' : 'inline';
          short.style.display = abierto ? 'inline' : 'none';
          a.textContent = abierto ? 'ver más' : 'ver menos';
        };
      });
    },
  });
})();
