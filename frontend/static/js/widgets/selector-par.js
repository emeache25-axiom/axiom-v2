/**
 * AXIOM — Widget: selector_par (RENDER)
 * ────────────────────────────────────────────────────────────────────────────
 * Cuando Migue pide datos de un par (velas, libro, precio) sin decir exchange
 * ni quote, y NO sigue ninguno en su watchlist, Kepler llama resolver_par y
 * este widget muestra los candidatos para que Migue elija con un clic.
 *
 * CIERRA EL LAZO HACIA KEPLER: al elegir, el widget NO pide los datos por su
 * cuenta —un widget no hace fetch, se acoplaría al backend—. Emite un evento
 * con el par elegido; el chat lo capta y le manda a Kepler un mensaje como si
 * Migue lo hubiera tecleado ("usá ONT/USDT en CoinEx"). Kepler, que tiene el
 * historial, recuerda qué estaba haciendo (velas/libro) y lo pide con el par ya
 * concreto. El widget solo captura la elección; Kepler orquesta.
 *
 * Solo aparece cuando hay que elegir: si resolver_par trae un par en watchlist,
 * Kepler usa ese y no monta este widget.
 *
 * La DECLARACIÓN vive en `backend/domain/widgets.py`.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = (window.AXIOM = window.AXIOM || {});
  const Fmt = NS.Fmt;

  const C = {
    text:   'var(--t1,#F5F0EB)',
    muted:  'var(--t3,#78716C)',
    border: 'var(--w1,#2C2926)',
    surface:'var(--c2,#1A1917)',
    accent: '#2563EB',
  };

  function fmtVol(v) {
    if (v == null) return null;
    const n = Number(v);
    if (!isFinite(n)) return null;
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
  }

  // Un candidato clickeable. Lleva en data-* todo lo que el chat necesita para
  // armar el mensaje de vuelta a Kepler.
  function tarjeta(p) {
    const vol = fmtVol(p.volumen);
    const par = `${(p.base || '').toUpperCase()}/${(p.quote || '').toUpperCase()}`;
    return `
      <button class="selpar-opt"
        data-exchange="${Fmt.esc(p.exchange || '')}"
        data-quote="${Fmt.esc(p.quote || '')}"
        data-base="${Fmt.esc(p.base || '')}"
        data-pair="${Fmt.esc(p.pair_symbol || '')}"
        style="display:flex;align-items:center;justify-content:space-between;gap:10px;
               width:100%;text-align:left;background:${C.surface};
               border:0.5px solid ${C.border};border-radius:8px;padding:9px 12px;
               cursor:pointer;transition:border-color .15s;">
        <span style="display:flex;flex-direction:column;gap:1px;min-width:0;">
          <span style="font-family:var(--f2,monospace);font-size:13px;font-weight:600;
                       color:${C.text};">${Fmt.esc(par)}</span>
          <span style="font-size:10px;color:${C.muted};text-transform:uppercase;
                       letter-spacing:.06em;">${Fmt.esc((p.exchange || '').toUpperCase())}</span>
        </span>
        ${vol ? `<span style="font-family:var(--f2,monospace);font-size:11px;
                   color:${C.muted};white-space:nowrap;">${vol}</span>` : ''}
      </button>`;
  }

  NS.Widgets.render('selector_par', {

    render(datos, ctx) {
      const d = (datos && (datos.resultado || datos)) || {};
      const enWL = Array.isArray(d.en_watchlist) ? d.en_watchlist : [];
      const cand = Array.isArray(d.candidatos) ? d.candidatos : [];

      // Si hay pares en watchlist, Kepler no debería haber montado esto (usa el
      // primero). Pero si llega igual, se priorizan esos: son la preferencia.
      const lista = enWL.length ? enWL : cand;

      if (!lista.length) {
        return `<div style="padding:20px;text-align:center;color:${C.muted};
          font-size:13px;">No se encontraron pares operables para esta coin.</div>`;
      }

      const titulo = enWL.length
        ? 'Seguís estos pares — ¿cuál miramos?'
        : 'Elegí en qué par mirarlo:';

      return `
        <div>
          <div style="font-size:12px;color:${C.muted};padding:2px 2px 9px;">
            ${titulo}
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${lista.map(tarjeta).join('')}
          </div>
        </div>`;
    },

    /**
     * Al elegir, emite el par. El chat arma el mensaje a Kepler; el widget no
     * pide datos por su cuenta.
     */
    mount(el, ctx) {
      el.querySelectorAll('.selpar-opt').forEach((b) => {
        b.onmouseover = () => { b.style.borderColor = C.muted; };
        b.onmouseout  = () => { b.style.borderColor = C.border; };
        b.onclick = () => {
          // Feedback: marcar el elegido, deshabilitar el resto.
          el.querySelectorAll('.selpar-opt').forEach((o) => {
            o.disabled = true;
            o.style.opacity = o === b ? '1' : '.45';
            if (o === b) o.style.borderColor = C.accent;
          });
          el.dispatchEvent(new CustomEvent('axiom:par-elegido', {
            detail: {
              exchange:    b.dataset.exchange,
              quote:       b.dataset.quote,
              base:        b.dataset.base,
              pair_symbol: b.dataset.pair,
            },
            bubbles: true,
          }));
        };
      });
    },
  });
})();
