/**
 * AXIOM — Widget: lista_watchlist (RENDER)
 * ────────────────────────────────────────────────────────────────────────────
 * Los pares en seguimiento. Segundo widget del sistema, y el que pone a prueba
 * si el contrato generaliza: a diferencia de la tabla de pares —solo lectura—
 * este tiene ACCIONES (activar bot, editar, eliminar).
 *
 * DOS DISPOSICIONES, no solo columnas distintas:
 *   - compacto (panel angosto, ~240px): layout APILADO. Nombre y par a la
 *     izquierda, sparkline al medio, % a la derecha. El precio va DEBAJO del
 *     nombre. Sin columnas que compitan el ancho — antes, en grid, el nombre y
 *     el precio se superponían a 240px. Mismo criterio que regimen_mercado: a
 *     poco ancho cambia la disposición, no qué columnas caben.
 *   - normal / amplio: grid de columnas, como el resto de las tablas.
 * Qué campos hay en cada nivel lo decide la densidad (backend); el widget solo
 * elige la disposición según el nivel resuelto.
 *
 * ACCIONES según CONTEXTO, no densidad: en 'pantalla' se muestran; en panel o
 * chat el widget es de consulta. Los clics emiten `axiom:watchlist-accion` y
 * quien montó decide; si nadie escucha, no pasa nada.
 *
 * ABRIR EN EL GRÁFICO: la fila emite el paquete completo del par (coin_id,
 * exchange, ex_symbol), no el id de la fila — cargar en el gráfico necesita
 * saber cuál y en qué exchange. Gesto por contexto: clic simple en 'panel'
 * (lista de navegación), doble clic en 'pantalla' (evita abrir por error al
 * gestionar).
 *
 * La DECLARACIÓN vive en `backend/domain/widgets.py`.
 * Ver AXIOM_sistema_widgets.md
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = (window.AXIOM = window.AXIOM || {});
  const Fmt = NS.Fmt;

  // Anchos para el layout de COLUMNAS (normal / amplio). `coin` toma el resto.
  const ANCHOS = {
    coin:       '1fr',
    sparkline:  '48px',
    precio:     '100px',
    cambio_24h: '80px',
    cambio_7d:  '80px',
    volumen:    '90px',
    exchange:   '70px',
    acciones:   '92px',
  };

  const ETIQUETAS = {
    coin: 'Par', sparkline: '', precio: 'Precio', cambio_24h: '24h',
    cambio_7d: '7d', volumen: 'Vol 24h', exchange: 'Exch', acciones: '',
  };

  const DERECHA = new Set(['precio', 'cambio_24h', 'cambio_7d', 'volumen']);
  const CENTRO  = new Set(['sparkline', 'exchange', 'acciones']);

  // ── Helpers de datos ──────────────────────────────────────────────────────

  /** Precio con la precisión de la cotización: /BTC en satoshis, /USDT normal. */
  function precioSegunQuote(valor, quote) {
    if (valor == null) return Fmt.NADA;
    const n = Number(valor);
    if (!isFinite(n)) return Fmt.NADA;
    if ((quote || '').toUpperCase() === 'BTC') return n.toFixed(10);
    return Fmt.precio(n);
  }

  function avatar(item, size = 28) {
    const img = item.image;
    if (img) {
      return `<img src="${Fmt.esc(img)}" style="width:${size}px;height:${size}px;
        border-radius:50%;object-fit:cover;flex-shrink:0;">`;
    }
    const ini = String(item.base || item.symbol || '').slice(0, 4);
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;
      background:var(--c3,#2C2926);display:flex;align-items:center;
      justify-content:center;font-family:var(--f2,monospace);font-size:9px;
      font-weight:600;color:var(--t2,#A8A29E);flex-shrink:0;">${Fmt.esc(ini)}</div>`;
  }

  function nombreYpar(item) {
    return {
      nombre: item.name || item.nombre || item.symbol || '',
      par: item.label || `${item.base || item.symbol || ''}/${item.quote || ''}`,
    };
  }

  // Los data-attrs que una fila necesita para abrirse en el gráfico.
  function attrsFila(item, abrirGesto) {
    const tip = abrirGesto === 'click'
      ? 'Click para ver en Gráficos' : 'Doble clic para ver en Gráficos';
    return `data-wl-row="${item.id}" id="wl-row-${item.id}"
      data-wl-abrir="${abrirGesto}"
      data-wl-coin="${Fmt.esc(item.coin_id || '')}"
      data-wl-name="${Fmt.esc(item.name || item.symbol || '')}"
      data-wl-sym="${Fmt.esc(item.base || item.symbol || '')}"
      data-wl-exchange="${Fmt.esc(item.exchange || '')}"
      data-wl-exsymbol="${Fmt.esc(item.pair_symbol || item.ex_symbol || '')}"
      title="${tip}"`;
  }

  // ── Celdas del layout de COLUMNAS ─────────────────────────────────────────

  function celda(campo, item, conAcciones) {
    switch (campo) {
      case 'coin': {
        const { nombre, par } = nombreYpar(item);
        return `<div style="display:flex;align-items:center;gap:8px;min-width:0;">
          ${avatar(item)}
          <div style="min-width:0;">
            <div style="font-weight:500;color:var(--t1,#F5F0EB);font-size:13px;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${Fmt.esc(nombre)}</div>
            <div style="font-family:var(--f2,monospace);font-size:10px;
              color:var(--t3,#78716C);">${Fmt.esc(par)}</div>
          </div>
        </div>`;
      }
      case 'sparkline': {
        const v24 = Fmt.campo(item, 'change_24h', 'cambio_24h');
        return Fmt.sparkline(item.sparkline, v24 == null ? null : Number(v24) >= 0);
      }
      case 'precio':
        return `<span class="wl-price" data-quote="${Fmt.esc(item.quote || 'USDT')}"
          style="font-family:var(--f2,monospace);font-size:12px;color:var(--t1,#F5F0EB);"
          >${precioSegunQuote(item.price ?? item.precio, item.quote)}</span>`;
      case 'cambio_24h': {
        const v = Fmt.campo(item, 'change_24h', 'cambio_24h');
        return `<span class="wl-change" style="font-family:var(--f2,monospace);
          font-size:12px;font-weight:600;color:${Fmt.colorSigno(v)};"
          >${Fmt.pct(v, 2, true)}</span>`;
      }
      case 'cambio_7d': {
        const v = Fmt.campo(item, 'change_7d', 'cambio_7d');
        return `<span style="font-family:var(--f2,monospace);font-size:12px;
          font-weight:600;color:${Fmt.colorSigno(v)};">${Fmt.pct(v, 2, true)}</span>`;
      }
      case 'volumen':
        return `<span style="font-family:var(--f2,monospace);font-size:11px;
          color:var(--t3,#78716C);">$${Fmt.volumen(
            Fmt.campo(item, 'volume_24h', 'volumen_24h'))}</span>`;
      case 'exchange':
        return `<span class="wl-exchange" style="font-family:var(--f2,monospace);
          font-size:10px;color:var(--t3,#78716C);text-transform:uppercase;"
          >${Fmt.esc(item.exchange || '')}</span>`;
      case 'acciones':
        return conAcciones ? acciones(item) : '';
      default:
        return '';
    }
  }

  function acciones(item) {
    const bot = item.operable
      ? `<button data-wl-accion="bot" data-wl-id="${item.id}"
           data-wl-valor="${item.bot_enabled ? 'false' : 'true'}"
           title="${item.bot_enabled ? 'Bot activo — click para desactivar' : 'Activar bot'}"
           style="border:none;background:transparent;cursor:pointer;font-size:15px;
                  padding:2px;color:${item.bot_enabled ? '#56A14F' : 'var(--t3,#78716C)'};">
           <i class="ti ti-robot"></i></button>`
      : `<span title="Par no operable (solo MEXC y CoinEx)"
           style="display:inline-flex;color:var(--t4,#57534E);font-size:15px;
                  padding:2px;cursor:not-allowed;"><i class="ti ti-robot-off"></i></span>`;

    return `<div style="display:flex;align-items:center;justify-content:center;gap:6px;">
      ${bot}
      <button data-wl-accion="editar" data-wl-id="${item.id}" title="Editar"
        style="border:none;background:transparent;color:var(--t3,#78716C);
               cursor:pointer;font-size:14px;padding:2px;"><i class="ti ti-pencil"></i></button>
      <button data-wl-accion="eliminar" data-wl-id="${item.id}"
        data-wl-nombre="${Fmt.esc(item.name || item.symbol || '')}" title="Eliminar"
        style="border:none;background:transparent;color:var(--t3,#78716C);
               cursor:pointer;font-size:14px;padding:2px;"><i class="ti ti-trash"></i></button>
    </div>`;
  }

  // ── Layout COLUMNAS (normal / amplio) ─────────────────────────────────────

  function cabeceraCols(campos, grid) {
    const celdas = campos.map(c => {
      const just = DERECHA.has(c) ? 'text-align:right;'
                 : CENTRO.has(c)  ? 'text-align:center;' : '';
      return `<span style="${just}">${ETIQUETAS[c] || ''}</span>`;
    }).join('');
    return `
      <div style="display:grid;grid-template-columns:${grid};gap:8px;
                  padding:10px 16px;border-bottom:1px solid var(--w1,#2C2926);
                  background:var(--c1,#12110F);
                  font-family:var(--f2,monospace);font-size:9px;
                  color:var(--t3,#78716C);text-transform:uppercase;
                  letter-spacing:.1em;">${celdas}</div>`;
  }

  function filaCols(item, campos, grid, conAcciones, abrirGesto) {
    const celdas = campos.map(c => {
      const just = DERECHA.has(c) ? 'text-align:right;'
                 : CENTRO.has(c)  ? 'text-align:center;' : '';
      return `<div style="${just}min-width:0;">${celda(c, item, conAcciones)}</div>`;
    }).join('');
    return `
      <div ${attrsFila(item, abrirGesto)}
           style="display:grid;grid-template-columns:${grid};gap:8px;
                  padding:10px 16px;border-bottom:0.5px solid var(--w1,#2C2926);
                  align-items:center;cursor:pointer;">${celdas}</div>`;
  }

  // ── Layout APILADO (compacto / panel) ─────────────────────────────────────
  // El nombre ocupa su propia línea (todo el ancho de su bloque), el precio va
  // debajo. Sparkline al medio, % a la derecha. Nada compite el ancho del
  // nombre — por eso deja de superponerse.

  function filaApilada(item, campos, abrirGesto) {
    const { par } = nombreYpar(item);
    const v24 = Fmt.campo(item, 'change_24h', 'cambio_24h');
    const precio = precioSegunQuote(item.price ?? item.precio, item.quote);

    const spark = campos.includes('sparkline')
      ? Fmt.sparkline(item.sparkline, v24 == null ? null : Number(v24) >= 0)
      : '';

    const derecha = campos.includes('cambio_24h')
      ? `<span class="wl-change" style="font-family:var(--f2,monospace);font-size:11px;
           font-weight:600;color:${Fmt.colorSigno(v24)};">${Fmt.pct(v24, 2, true)}</span>`
      : '';

    return `
      <div ${attrsFila(item, abrirGesto)}
           style="display:flex;align-items:center;gap:8px;padding:8px 11px;
                  border-bottom:0.5px solid var(--w1,#2C2926);cursor:pointer;">
        ${avatar(item, 24)}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:12px;color:var(--t1,#F5F0EB);
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
               >${Fmt.esc(par)}</div>
          <div class="wl-price" data-quote="${Fmt.esc(item.quote || 'USDT')}"
               style="font-family:var(--f2,monospace);font-size:10px;color:var(--t3,#78716C);"
               >${precio}</div>
        </div>
        ${spark}
        ${derecha ? `<div style="text-align:right;flex-shrink:0;min-width:46px;">${derecha}</div>` : ''}
      </div>`;
  }

  // ── El widget ───────────────────────────────────────────────────────────────

  NS.Widgets.render('lista_watchlist', {

    render(datos, ctx) {
      const items = Array.isArray(datos) ? datos
                  : (datos && (datos.items || datos.pares || datos.resultado)) || [];

      if (!items.length) {
        return `<div style="padding:32px;text-align:center;color:var(--t3,#78716C);">
          <i class="ti ti-list" style="font-size:32px;opacity:.3;display:block;
             margin-bottom:8px;"></i>
          <div style="font-size:13px;">No hay pares en seguimiento.</div>
        </div>`;
      }

      const abrirGesto = ctx.contexto === 'panel' ? 'click' : 'dblclick';
      const campos = (ctx.campos || []).slice();

      // Compacto → apilado (sin encabezado). El resto → columnas.
      if (ctx.densidad === 'compacto') {
        return `<div data-wl-body>
          ${items.map(it => filaApilada(it, campos, abrirGesto)).join('')}
        </div>`;
      }

      const conAcciones = ctx.contexto === 'pantalla';
      const cols = campos.filter(c => ANCHOS[c])
        .filter(c => c !== 'acciones' || conAcciones);
      const grid = cols.map(c => ANCHOS[c]).join(' ');

      return `
        ${cabeceraCols(cols, grid)}
        <div data-wl-body>
          ${items.map(it => filaCols(it, cols, grid, conAcciones, abrirGesto)).join('')}
        </div>`;
    },

    /**
     * Engancha acciones y apertura. El widget no conoce la pantalla: emite un
     * evento y quien lo montó decide.
     */
    mount(el, ctx) {
      el.querySelectorAll('[data-wl-accion]').forEach(b => {
        b.onclick = (e) => {
          e.stopPropagation();
          el.dispatchEvent(new CustomEvent('axiom:watchlist-accion', {
            detail: {
              accion: b.dataset.wlAccion,
              id: parseInt(b.dataset.wlId, 10),
              valor: b.dataset.wlValor === 'true' ? true
                   : b.dataset.wlValor === 'false' ? false : undefined,
              nombre: b.dataset.wlNombre,
            },
            bubbles: true,
          }));
        };
      });

      const emitirAbrir = (row) => {
        el.dispatchEvent(new CustomEvent('axiom:watchlist-accion', {
          detail: {
            accion:    'abrir',
            id:        parseInt(row.dataset.wlRow, 10),
            coin_id:   row.dataset.wlCoin || '',
            name:      row.dataset.wlName || '',
            symbol:    row.dataset.wlSym || '',
            exchange:  row.dataset.wlExchange || '',
            ex_symbol: row.dataset.wlExsymbol || '',
          },
          bubbles: true,
        }));
      };

      el.querySelectorAll('[data-wl-row]').forEach(row => {
        const gesto = row.dataset.wlAbrir || 'dblclick';
        row[gesto === 'click' ? 'onclick' : 'ondblclick'] = (e) => {
          if (e.target.closest('[data-wl-accion]')) return;   // botón de acción
          emitirAbrir(row);
        };
      });
    },
  });
})();
