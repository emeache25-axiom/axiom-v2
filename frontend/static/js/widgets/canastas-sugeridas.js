/**
 * AXIOM — Widget: canastas_sugeridas (RENDER)
 * ────────────────────────────────────────────────────────────────────────────
 * Las coins que el sistema sugiere según el régimen vigente, en tres canastas
 * por horizonte: largo (12-36 meses), medio (2-12 semanas) y corto (horas a
 * días).
 *
 * Tercer widget del sistema, y el primero que NO es una tabla: son secciones
 * con encabezado propio y filas dentro. Sirve para verificar que el contrato
 * no esté atado al formato tabular.
 *
 * IMPORTANTE — esto es lo más cerca que AXIOM está de "recomendar", así que la
 * declaración epistémica pesa: la selección ENTERA es una inferencia (reglas
 * heurísticas condicionadas al régimen), no una medición. El montador la
 * expone automáticamente; acá se refuerza con el encabezado, que dice que son
 * candidatas a analizar y no una recomendación de compra.
 *
 * La DECLARACIÓN vive en `backend/domain/widgets.py`.
 * Ver AXIOM_sistema_widgets.md y AXIOM_principios_fundacionales.md §3.4
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = (window.AXIOM = window.AXIOM || {});
  const Fmt = NS.Fmt;

  const CANASTAS = [
    { clave: 'largo', color: '#2563EB', icono: 'ti-clock-hour-4' },
    { clave: 'medio', color: '#56A14F', icono: 'ti-calendar-week' },
    { clave: 'corto', color: '#B47514', icono: 'ti-bolt' },
  ];

  const COLOR_REGIMEN = {
    ACUMULACION: '#2563EB', ALCISTA_A: '#56A14F', ALCISTA_B: '#B47514',
    DISTRIBUCION: '#D86326', BAJISTA: '#D93B3B',
    ALCISTA: '#56A14F', LATERAL: '#78716C',
  };

  const COLOR_RIESGO = {
    'MODERADO-BAJO': '#56A14F', 'MODERADO': '#B47514', 'ALTO': '#D86326',
    'MUY ALTO': '#D93B3B', 'EXTREMO': '#D93B3B',
  };

  const ANCHOS = {
    coin: '1fr', precio: '90px', cambio_24h: '70px',
    cambio_7d: '70px', estado: '1fr', agregar: '70px',
  };

  /** Hace cuánto se actualizaron los datos, en lenguaje natural. */
  function hace(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    const min = Math.round((Date.now() - d) / 60000);
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    return h < 24 ? `hace ${h}h` : `hace ${Math.round(h / 24)}d`;
  }

  // ── Piezas ──────────────────────────────────────────────────────────────────

  function banner(data) {
    const regimen = data.regime || 'ACUMULACION';
    const ctx     = data.context || {};
    const cReg    = COLOR_REGIMEN[regimen] || '#78716C';
    const cRiesgo = COLOR_RIESGO[ctx.risk_level] || '#78716C';
    const ts      = hace(data.coins_updated_at);

    const riesgo = ctx.risk_level
      ? `<span style="display:inline-flex;align-items:center;gap:5px;">
           <span style="font-family:var(--f2,monospace);font-size:10px;
             color:var(--t3,#78716C);">RIESGO</span>
           <span style="font-family:var(--f2,monospace);font-size:11px;
             font-weight:600;color:${cRiesgo};">${Fmt.esc(ctx.risk_level)}</span>
         </span>` : '';

    return `
      <div class="card" style="padding:14px 16px;margin-bottom:16px;
           border-left:3px solid ${cReg};border-top:0.5px solid var(--w1,#2C2926);
           border-right:0.5px solid var(--w1,#2C2926);
           border-bottom:0.5px solid var(--w1,#2C2926);">
        <div style="display:flex;align-items:center;justify-content:space-between;
                    gap:12px;flex-wrap:wrap;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-family:var(--f2,monospace);font-size:9px;
              text-transform:uppercase;letter-spacing:.12em;
              color:var(--t3,#78716C);">Régimen</span>
            <span style="font-size:14px;font-weight:700;color:${cReg};"
              >${Fmt.esc(String(regimen).replace('_', ' '))}</span>
          </div>
          ${riesgo}
        </div>
        ${ctx.summary ? `<p style="font-size:12px;color:var(--t2,#A8A29E);
          line-height:1.55;margin:0;">${Fmt.esc(ctx.summary)}</p>` : ''}
        ${ts ? `<div style="font-family:var(--f2,monospace);font-size:10px;
          color:var(--t3,#78716C);margin-top:8px;">Datos de mercado: ${ts}</div>` : ''}
      </div>`;
  }

  /** Fila de un activo. Las columnas visibles las decide la densidad. */
  function fila(c, campos, grid, conAgregar) {
    const celda = (campo) => {
      switch (campo) {
        case 'coin':
          return `<div style="display:flex;align-items:center;gap:8px;min-width:0;">
            ${c.image ? `<img src="${Fmt.esc(c.image)}" style="width:28px;height:28px;
              border-radius:50%;flex-shrink:0;">` : ''}
            <div style="min-width:0;">
              <div style="font-size:13px;font-weight:600;color:var(--t1,#F5F0EB);
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                >${Fmt.esc(c.name || '')}</div>
              <div style="font-family:var(--f2,monospace);font-size:10px;
                color:var(--t3,#78716C);">${Fmt.esc(c.symbol || '')}</div>
            </div>
          </div>`;

        case 'precio':
          return `<div style="text-align:right;font-family:var(--f2,monospace);
            font-size:12px;color:var(--t1,#F5F0EB);">${Fmt.precio(c.price)}</div>`;

        case 'cambio_24h':
        case 'cambio_7d': {
          const v = campo === 'cambio_24h' ? c.change_24h : c.change_7d;
          return `<div style="text-align:right;font-family:var(--f2,monospace);
            font-size:12px;font-weight:600;color:${Fmt.colorSigno(v)};"
            >${Fmt.pct(v, 2, true)}</div>`;
        }

        case 'estado':
          return `<div style="min-width:0;">${estado(c)}</div>`;

        case 'agregar':
          return conAgregar
            ? `<div style="text-align:center;">
                 <button data-sug-add data-sug-id="${Fmt.esc(c.id || '')}"
                   data-sug-name="${Fmt.esc(c.name || '')}"
                   data-sug-symbol="${Fmt.esc(c.symbol || '')}"
                   title="Agregar a la watchlist"
                   style="border:0.5px solid var(--cy,#C9A84C);background:var(--cyg,transparent);
                          color:var(--cy,#C9A84C);border-radius:4px;padding:3px 9px;
                          font-size:11px;cursor:pointer;"><i class="ti ti-plus"></i></button>
               </div>` : '';

        default: return '';
      }
    };

    return `
      <div style="display:grid;grid-template-columns:${grid};gap:8px;
                  padding:10px 14px;border-bottom:0.5px solid var(--w1,#2C2926);
                  align-items:center;">
        ${campos.map(celda).join('')}
      </div>`;
  }

  /**
   * Columna de estado: qué señal tiene el activo y cuántas condiciones cumple.
   * En las canastas de medio y corto plazo, en vez de condiciones viene una
   * nota (catalizador o comentario de volatilidad).
   */
  function estado(c) {
    const nota = c.catalyst || c.volatility_note;
    if (nota) {
      return `<span style="font-size:11px;color:var(--t3,#78716C);line-height:1.4;
        display:block;overflow:hidden;text-overflow:ellipsis;">${Fmt.esc(nota)}</span>`;
    }

    const punto = `<span style="display:inline-block;width:7px;height:7px;
      border-radius:50%;flex-shrink:0;margin-right:5px;
      background:${c.has_signal ? '#56A14F' : 'var(--t4,#57534E)'};
      ${c.has_signal ? 'box-shadow:0 0 5px #56A14F80;' : ''}"></span>`;

    const cumplidas = Number(c.conditions_met) || 0;
    const barras = Array.from({ length: 4 }, (_, i) =>
      `<span style="display:inline-block;width:10px;height:3px;border-radius:1px;
        margin-right:2px;background:${i < cumplidas ? '#56A14F' : 'var(--w1,#2C2926)'};"></span>`
    ).join('');

    return `
      <div style="display:flex;align-items:center;margin-bottom:3px;">
        ${punto}
        <span style="font-family:var(--f2,monospace);font-size:10px;
          color:var(--t3,#78716C);white-space:nowrap;overflow:hidden;
          text-overflow:ellipsis;">${Fmt.esc(c.status || '')}</span>
      </div>
      <div style="display:flex;align-items:center;">
        ${barras}
        <span style="font-family:var(--f2,monospace);font-size:9px;
          color:var(--t4,#57534E);margin-left:4px;">${cumplidas}/4</span>
      </div>`;
  }

  /**
   * Una canasta con su encabezado y sus activos.
   * El original tenía dos versiones casi idénticas —una para largo y otra
   * "genérica" para medio/corto—; acá es una sola.
   */
  function canasta(cfg, datos, campos, grid, conAgregar) {
    if (!datos) return '';
    const assets = datos.assets || [];

    const cabecera = `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                  border-bottom:1px solid var(--w1,#2C2926);">
        <i class="ti ${cfg.icono}" style="color:${cfg.color};font-size:14px;"></i>
        <div style="min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--t1,#F5F0EB);"
            >${Fmt.esc(datos.title || cfg.clave)}</div>
          <div style="font-family:var(--f2,monospace);font-size:10px;
            color:var(--t3,#78716C);">${Fmt.esc(datos.horizon || '')}${
              datos.technique ? ' · ' + Fmt.esc(datos.technique) : ''}</div>
        </div>
      </div>`;

    const cuerpo = assets.length
      ? assets.map(c => fila(c, campos, grid, conAgregar)).join('')
      : `<div style="padding:24px;text-align:center;color:var(--t3,#78716C);
           font-size:12px;">${Fmt.esc(datos.empty_msg || 'Sin activos en este momento')}</div>`;

    return `
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:16px;
           border-top:2px solid ${cfg.color};
           border-left:1px solid ${cfg.color}40;
           border-right:1px solid ${cfg.color}40;
           border-bottom:1px solid ${cfg.color}40;">
        ${cabecera}${cuerpo}
      </div>`;
  }

  // ── El widget ───────────────────────────────────────────────────────────────

  NS.Widgets.render('canastas_sugeridas', {

    render(datos, ctx) {
      const data = (datos && (datos.resultado || datos)) || {};
      if (!data.largo && !data.medio && !data.corto) {
        return `<div style="padding:24px;text-align:center;color:var(--t3,#78716C);
          font-size:13px;">No hay sugerencias disponibles.</div>`;
      }

      // Agregar a la watchlist es una acción de gestión: solo en su pantalla.
      const conAgregar = ctx.contexto === 'pantalla';

      const campos = (ctx.campos || []).filter(c => ANCHOS[c])
        .filter(c => c !== 'agregar' || conAgregar);
      const grid = campos.map(c => ANCHOS[c]).join(' ');

      const canastas = CANASTAS
        .map(cfg => canasta(cfg, data[cfg.clave], campos, grid, conAgregar))
        .join('');

      // La aclaración va arriba, antes de que se lean los nombres: estas coins
      // son candidatas a analizar, no una recomendación de compra.
      const aviso = `
        <div style="font-family:var(--f2,monospace);font-size:10px;
             color:var(--t3,#78716C);margin-bottom:10px;line-height:1.5;">
          Candidatas a analizar según el régimen vigente. La selección es una
          lectura del sistema, no una recomendación de compra.
        </div>`;

      return aviso + banner(data) + canastas;
    },

    mount(el, ctx) {
      el.querySelectorAll('[data-sug-add]').forEach(b => {
        b.onclick = (e) => {
          e.stopPropagation();
          el.dispatchEvent(new CustomEvent('axiom:sugerida-agregar', {
            detail: {
              id: b.dataset.sugId,
              nombre: b.dataset.sugName,
              symbol: b.dataset.sugSymbol,
            },
            bubbles: true,
          }));
        };
      });
    },
  });
})();
