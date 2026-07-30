/**
 * AXIOM — Widget: tabla_pares (RENDER)
 * ────────────────────────────────────────────────────────────────────────────
 * Solo el render. La DECLARACIÓN —qué capacidad consume, qué campos en cada
 * densidad, por qué columnas se puede ordenar— vive en el backend
 * (`backend/domain/widgets.py`) y llega por `/api/capacidades/_/widgets`.
 *
 * Así, un cliente en otra plataforma lee el mismo catálogo y solo escribe su
 * propio render. Y el backend puede validar que las columnas ordenables sean
 * las que la capacidad realmente admite.
 *
 * Este archivo sabe CÓMO se dibuja cada campo; no decide CUÁLES se muestran.
 *
 * QUÉ RESUELVE, además de ser reutilizable: el encabezado fijo. La tabla no
 * podía tenerlo porque con 11 columnas necesitaba scroll horizontal, y
 * `position: sticky` no atraviesa un ancestro con `overflow`. Con densidades,
 * en compacto y normal entran pocas columnas SIN scroll horizontal, así que el
 * sticky funciona sin trucos.
 *
 * ORDENAMIENTO: el widget no hace fetch (por contrato). Al hacer clic en un
 * encabezado emite el evento `axiom:widget-orden`. Quien lo montó puede
 * escucharlo para coordinar (por ejemplo, volver a la página 1); si nadie lo
 * cancela, el propio widget pide los datos nuevos al montador.
 *
 * Ver AXIOM_sistema_widgets.md
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = (window.AXIOM = window.AXIOM || {});
  const Fmt = NS.Fmt;

  // ── Columnas ────────────────────────────────────────────────────────────────
  // `orden` es la clave que entiende el backend; `get` extrae el valor del dato
  // aceptando los dos nombres posibles (capacidad vs endpoint).
  const COLS = {
    par: {
      label: 'Par', ancho: '112px', align: 'left', dir: 'asc', orden: 'par',
      get: p => Fmt.esc(p.par || p.pair_symbol || ''),
      clase: 'w-par',
    },
    exchange: {
      label: 'Exch', ancho: '62px', align: 'left', dir: 'asc', orden: 'exchange',
      get: p => Fmt.esc(p.exchange || ''),
      estilo: 'font-size:10px;color:var(--t3,#78716C);',
    },
    precio: {
      label: 'Precio', ancho: '96px', align: 'right', dir: 'desc', orden: 'precio',
      get: p => Fmt.precio(Fmt.campo(p, 'precio', 'last_price')),
    },
    volumen: {
      label: 'Vol 24h', ancho: '92px', align: 'right', dir: 'desc', orden: 'volumen',
      get: p => '$' + Fmt.volumen(Fmt.campo(p, 'volumen_24h', 'volume_24h')),
    },
    cambio: {
      label: '24h', ancho: '64px', align: 'right', dir: 'desc', orden: 'cambio',
      get: p => Fmt.pct(Fmt.campo(p, 'cambio_24h', 'change_24h'), 2, true),
      color: p => Fmt.colorSigno(Fmt.campo(p, 'cambio_24h', 'change_24h')),
    },
    volatilidad: {
      label: 'Rango', ancho: '68px', align: 'right', dir: 'desc', orden: 'volatilidad',
      get: p => Fmt.pct(Fmt.campo(p, 'volatilidad', 'rango_diario_pct', 'volatility_30d')),
      metrica: true,
    },
    desvio: {
      label: 'Desvío', ancho: '64px', align: 'right', dir: 'desc', orden: 'desvio',
      get: p => Fmt.pct(Fmt.campo(p, 'desvio', 'desvio_retornos_pct', 'volatility_std')),
      metrica: true,
    },
    repetible: {
      label: 'Repetible', ancho: '76px', align: 'right', dir: 'desc', orden: 'repetible',
      get: p => Fmt.pct(Fmt.campo(p, 'dias_repetible_pct', 'range_days_pct'), 0),
      metrica: true,
    },
    impulso: {
      label: 'Impulso', ancho: '70px', align: 'right', dir: 'desc', orden: 'impulso',
      get: p => Fmt.pct(Fmt.campo(p, 'impulso_pct', 'impulso_oh')),
      metrica: true,
      // Cuánto sube desde la apertura hasta el máximo del día. A diferencia
      // del rango, mide solo el tramo alcista: un par que abre arriba y cae
      // tiene rango alto pero impulso bajo.
    },
    impulso_rep: {
      label: 'Imp.rep', ancho: '68px', align: 'right', dir: 'desc', orden: 'impulso_rep',
      get: p => Fmt.pct(Fmt.campo(p, 'impulso_dias_pct'), 0),
      metrica: true,
    },
    spread: {
      label: 'Spread', ancho: '66px', align: 'right', dir: 'asc', orden: 'spread',
      get: p => Fmt.pct(Fmt.campo(p, 'spread_pct'), 3),
      metrica: true,
    },
    velas: {
      label: 'Velas', ancho: '50px', align: 'right', dir: 'desc', orden: 'velas',
      get: p => Fmt.campo(p, 'velas', 'candles_count') || Fmt.NADA,
      estilo: 'font-size:10px;color:var(--t3,#78716C);',
    },
    coin: {
      label: 'Coin', ancho: '1fr', align: 'left', dir: 'asc', orden: 'coin',
      get: p => renderCoin(p),
    },
  };

  /**
   * Info de la coin, o "sin información" cuando su base no está en el catálogo
   * de CoinGecko. Esos pares se muestran igual: siguen siendo operables.
   */
  function renderCoin(p) {
    const c = p.coin;
    const tiene = p.tiene_info !== undefined ? p.tiene_info : !!c;
    if (!tiene || !c) {
      return `<span style="font-family:var(--f2,monospace);font-size:11px;
        color:var(--t3,#78716C);font-style:italic;">sin información</span>`;
    }
    const img = c.image
      ? `<img src="${Fmt.esc(c.image)}" style="width:16px;height:16px;border-radius:50%;flex-shrink:0;">`
      : '';
    const rank = c.rank
      ? `<span style="font-family:var(--f2,monospace);font-size:10px;
           color:var(--t3,#78716C);flex-shrink:0;">#${c.rank}</span>`
      : '';
    return `<span style="display:flex;align-items:center;gap:6px;min-width:0;">
      ${img}
      <span style="color:var(--t2,#A8A29E);font-size:12px;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap;">${Fmt.esc(c.nombre || c.name || p.base)}</span>
      ${rank}
    </span>`;
  }

  // ── El widget ───────────────────────────────────────────────────────────────

  NS.Widgets.render('tabla_pares', {

    render(datos, ctx) {
      const pares = (datos && (datos.pares || datos)) || [];
      if (!Array.isArray(pares) || !pares.length) {
        return `<div style="padding:24px;text-align:center;color:var(--t3,#78716C);
          font-size:13px;">Ningún par cumple estos filtros.</div>`;
      }

      const orden = (ctx.args && ctx.args.orden) || 'volumen';
      const dir   = (ctx.args && ctx.args.dir)   || '';
      // Qué columnas mostrar lo decide la declaración (backend), no este
      // archivo: llega resuelto en ctx.campos.
      const cols  = (ctx.campos || []).filter(k => COLS[k]);
      const grid  = cols.map(k => COLS[k].ancho).join(' ');

      // En amplio puede hacer falta scroll horizontal; en las otras no, y por
      // eso el encabezado puede quedar fijo.
      const necesitaScroll = ctx.densidad === 'amplio';
      const anchoMin = necesitaScroll ? 'min-width:1080px;' : '';

      // Con pocas columnas visibles no hay encabezados donde hacer clic para
      // las métricas ocultas: sin este selector, la tabla quedaría sin forma
      // de reordenarse en el celular.
      const selector = ctx.densidad === 'amplio'
        ? ''
        : selectorOrden(orden, dir, ctx.ordenables);

      return `
        ${selector}
        <div style="${necesitaScroll ? 'overflow-x:auto;' : ''}">
          <div style="${anchoMin}">
            ${cabecera(cols, grid, orden, dir, necesitaScroll, ctx.offsetTop || 0)}
            <div data-tp-body>
              ${pares.map(p => fila(p, cols, grid)).join('')}
            </div>
          </div>
        </div>`;
    },

    /** Engancha el ordenamiento: por encabezado y por selector. */
    mount(el, ctx) {
      const ordenActual = (ctx.args && ctx.args.orden) || 'volumen';
      const dirActual   = (ctx.args && ctx.args.dir) || '';

      /**
       * Comunica el nuevo orden. Se avisa a quien montó el widget: puede
       * necesitar coordinar (volver a la página 1, por ejemplo). Si nadie
       * cancela el evento, el widget pide los datos nuevos por su cuenta —
       * así funciona igual montado en el chat, donde no hay pantalla que
       * coordine.
       */
      const aplicar = (nuevo) => {
        const ev = new CustomEvent('axiom:widget-orden', {
          detail: nuevo, bubbles: true, cancelable: true,
        });
        const seguir = el.dispatchEvent(ev);
        if (seguir && NS.WidgetMount) NS.WidgetMount.refiltrar(el, nuevo);
      };

      // Clic en encabezado: mismo campo invierte, otro campo usa su default.
      el.querySelectorAll('[data-tp-col]').forEach(th => {
        th.onclick = () => {
          const col = COLS[th.dataset.tpCol];
          if (!col || !col.orden) return;
          aplicar({
            orden: col.orden,
            dir: (ordenActual === col.orden)
                   ? ((dirActual || col.dir) === 'asc' ? 'desc' : 'asc')
                   : col.dir,
          });
        };
      });

      // Selector de métrica (densidades reducidas)
      const sel = el.querySelector('[data-tp-orden]');
      if (sel) sel.onchange = () => {
        const col = COLS[sel.value];
        aplicar({ orden: sel.value, dir: (col && col.dir) || 'desc' });
      };

      // Botón de invertir dirección
      const btnDir = el.querySelector('[data-tp-dir]');
      if (btnDir) btnDir.onclick = () => {
        const actual = dirActual || (COLS[ordenActual] && COLS[ordenActual].dir) || 'desc';
        aplicar({ orden: ordenActual, dir: actual === 'asc' ? 'desc' : 'asc' });
      };
    },
  });

  // ── Piezas de render ────────────────────────────────────────────────────────

  /**
   * Selector de orden para densidades reducidas. Con 3 o 6 columnas visibles,
   * las métricas ocultas no tienen encabezado donde hacer clic — sin esto la
   * tabla no se podría reordenar desde el celular.
   */
  function selectorOrden(ordenActual, dirActual, ordenables) {
    // Las opciones vienen de la declaración, no de este archivo: el backend ya
    // validó que la capacidad las admita. Cuando las dos listas vivían por
    // separado se desincronizaron y ordenar por 'coin' devolvía 400.
    const cols = (ordenables && ordenables.length)
      ? ordenables.filter(k => COLS[k])
      : Object.keys(COLS).filter(k => COLS[k].orden);
    const opciones = cols
      .map(k => `<option value="${k}" ${k === ordenActual ? 'selected' : ''}>${COLS[k].label}</option>`)
      .join('');

    const dir = dirActual || (COLS[ordenActual] && COLS[ordenActual].dir) || 'desc';
    const icono = dir === 'asc' ? 'ti-arrow-up' : 'ti-arrow-down';
    const titulo = dir === 'asc' ? 'ascendente' : 'descendente';

    return `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;
                  border-bottom:0.5px solid var(--w1,#2C2926);">
        <span style="font-family:var(--f2,monospace);font-size:9px;
                     text-transform:uppercase;letter-spacing:.1em;
                     color:var(--t3,#78716C);">Ordenar por</span>
        <select data-tp-orden
          style="flex:1;min-width:0;background:var(--c2,#1A1917);
                 border:0.5px solid var(--w1,#2C2926);border-radius:5px;
                 padding:5px 8px;color:var(--t1,#F5F0EB);
                 font-family:var(--f2,monospace);font-size:11px;outline:none;
                 cursor:pointer;">${opciones}</select>
        <button data-tp-dir title="${titulo}"
          style="background:var(--c2,#1A1917);border:0.5px solid var(--w1,#2C2926);
                 border-radius:5px;padding:5px 9px;color:var(--cy,#C9A84C);
                 cursor:pointer;line-height:1;">
          <i class="ti ${icono}" style="font-size:13px;"></i>
        </button>
      </div>`;
  }

  function cabecera(cols, grid, orden, dir, hayScrollH, offsetTop) {
    const celdas = cols.map((k, i) => {
      const col    = COLS[k];
      const activa = col.orden === orden;
      const arriba = activa ? (dir || col.dir) === 'asc' : col.dir === 'asc';
      const icono  = arriba ? 'ti-arrow-up' : 'ti-arrow-down';
      const just   = col.align === 'right' ? 'flex-end' : 'flex-start';

      // Primera columna fija al scroll horizontal (solo aplica en amplio).
      const fija = (i === 0 && hayScrollH)
        ? 'position:sticky;left:0;z-index:4;background:var(--c1,#12110F);' +
          'padding-left:16px;margin-left:-16px;padding-right:8px;'
        : '';

      return `
        <span data-tp-col="${k}"
          style="display:flex;align-items:center;gap:3px;justify-content:${just};
                 cursor:pointer;user-select:none;${fija}
                 ${activa ? 'font-weight:600;color:var(--cy,#C9A84C);' : 'color:var(--t3,#78716C);'}">
          <span>${col.label}</span>
          <i class="ti ${icono}" style="font-size:11px;opacity:${activa ? 1 : 0.35};"></i>
        </span>`;
    }).join('');

    // El encabezado se fija al scroll vertical SALVO cuando hay scroll
    // horizontal: `position:sticky` no atraviesa un ancestro con `overflow`,
    // así que en densidad amplia no se puede (y tampoco hace falta: ahí hay
    // pantalla de sobra).
    //
    // `top` es el offset que informa el montador, no 0: pegarse a cero lo
    // esconde detrás del nav fijo de la app.
    const fijarArriba = hayScrollH
      ? ''
      : `position:sticky;top:${offsetTop}px;z-index:3;`;

    return `
      <div style="display:grid;grid-template-columns:${grid};gap:8px;
                  padding:10px 16px;border-bottom:1px solid var(--w1,#2C2926);
                  background:var(--c1,#12110F);
                  ${fijarArriba}
                  font-family:var(--f2,monospace);font-size:9px;
                  text-transform:uppercase;letter-spacing:.1em;">
        ${celdas}
      </div>`;
  }

  function fila(p, cols, grid) {
    // Un par sin velas no tiene métricas: se atenúan para distinguirlo de uno
    // que sí las tiene pero resultó poco volátil.
    const sinVelas = !Fmt.campo(p, 'velas', 'candles_count');

    const celdas = cols.map((k, i) => {
      const col   = COLS[k];
      const valor = col.get(p);
      const alin  = col.align === 'right' ? 'text-align:right;' : '';
      const color = col.color ? `color:${col.color(p)};` : '';
      const dim   = (col.metrica && sinVelas) ? 'opacity:.35;' : '';
      const fija  = i === 0
        ? 'position:sticky;left:0;z-index:1;background:var(--c1,#12110F);' +
          'padding-left:16px;margin-left:-16px;padding-right:8px;font-weight:500;'
        : '';
      const base  = k === 'coin' ? '' : 'font-family:var(--f2,monospace);';

      return `<span style="${base}${alin}${color}${dim}${fija}
        ${!color && k !== 'coin' ? 'color:var(--t2,#A8A29E);' : ''}">${valor}</span>`;
    }).join('');

    return `
      <div style="display:grid;grid-template-columns:${grid};gap:8px;
                  padding:9px 16px;border-bottom:0.5px solid var(--w1,#2C2926);
                  align-items:center;font-size:12px;">
        ${celdas}
      </div>`;
  }
})();
