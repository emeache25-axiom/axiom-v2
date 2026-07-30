/**
 * AXIOM — Widget: lista_watchlist (RENDER)
 * ────────────────────────────────────────────────────────────────────────────
 * Los pares en seguimiento. Segundo widget del sistema, y el que pone a prueba
 * si el contrato generaliza: a diferencia de la tabla de pares —solo lectura—
 * este tiene ACCIONES (activar bot, editar, eliminar).
 *
 * CÓMO SE RESUELVEN LAS ACCIONES: dependen del contexto, no de la densidad.
 * En 'pantalla' (la vista de gestión) se muestran; montado en el chat, en un
 * panel o en un dashboard, el widget es solo lectura — no tiene sentido
 * eliminar un par desde una respuesta del asistente.
 *
 * Los clics NO llaman a la pantalla directamente (antes era
 * `onclick="WatchlistScreen._editItem(...)"`, que ataba el widget a una
 * pantalla concreta). Emite `axiom:watchlist-accion` y quien lo montó decide
 * qué hacer; si nadie escucha, no pasa nada.
 *
 * La DECLARACIÓN vive en `backend/domain/widgets.py`.
 * Ver AXIOM_sistema_widgets.md
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = (window.AXIOM = window.AXIOM || {});
  const Fmt = NS.Fmt;

  // Ancho de cada columna. El campo `coin` toma el espacio sobrante.
  const ANCHOS = {
    coin:       '1fr',
    precio:     '100px',
    cambio_24h: '80px',
    cambio_7d:  '80px',
    volumen:    '90px',
    exchange:   '70px',
    acciones:   '92px',
  };

  const ETIQUETAS = {
    coin: 'Par', precio: 'Precio', cambio_24h: '24h', cambio_7d: '7d',
    volumen: 'Vol 24h', exchange: 'Exch', acciones: '',
  };

  const DERECHA = new Set(['precio', 'cambio_24h', 'cambio_7d', 'volumen']);
  const CENTRO  = new Set(['exchange', 'acciones']);

  /**
   * Precio con la precisión que corresponde a la cotización: un par contra BTC
   * se mide en satoshis y necesita todos los decimales; contra USDT, dos o
   * cuatro alcanzan.
   */
  function precioSegunQuote(valor, quote) {
    if (valor == null) return Fmt.NADA;
    const n = Number(valor);
    if (!isFinite(n)) return Fmt.NADA;
    if ((quote || '').toUpperCase() === 'BTC') return n.toFixed(10);
    return Fmt.precio(n);
  }

  function avatar(item) {
    const img = item.image;
    if (img) {
      return `<img src="${Fmt.esc(img)}" style="width:28px;height:28px;
        border-radius:50%;object-fit:cover;flex-shrink:0;">`;
    }
    const ini = String(item.base || item.symbol || '').slice(0, 4);
    return `<div style="width:28px;height:28px;border-radius:50%;
      background:var(--c3,#2C2926);display:flex;align-items:center;
      justify-content:center;font-family:var(--f2,monospace);font-size:9px;
      font-weight:600;color:var(--t2,#A8A29E);flex-shrink:0;">${Fmt.esc(ini)}</div>`;
  }

  function celda(campo, item, conAcciones) {
    switch (campo) {
      case 'coin': {
        const nombre = item.name || item.nombre || item.symbol || '';
        const par = item.label ||
          `${item.base || item.symbol || ''}/${item.quote || ''}`;
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

  // ── El widget ───────────────────────────────────────────────────────────────

  NS.Widgets.render('lista_watchlist', {

    render(datos, ctx) {
      // La capacidad devuelve una lista; el endpoint de la pantalla, {items:[]}
      const items = Array.isArray(datos) ? datos
                  : (datos && (datos.items || datos.pares || datos.resultado)) || [];

      if (!items.length) {
        return `<div style="padding:32px;text-align:center;color:var(--t3,#78716C);">
          <i class="ti ti-list" style="font-size:32px;opacity:.3;display:block;
             margin-bottom:8px;"></i>
          <div style="font-size:13px;">No hay pares en seguimiento.</div>
        </div>`;
      }

      // Las acciones son de GESTIÓN: solo tienen sentido en la pantalla propia.
      // Montado en el chat o en un panel, el widget es de consulta.
      const conAcciones = ctx.contexto === 'pantalla';

      const campos = (ctx.campos || []).filter(c => ANCHOS[c])
        .filter(c => c !== 'acciones' || conAcciones);
      const grid = campos.map(c => ANCHOS[c]).join(' ');

      return `
        ${cabecera(campos, grid)}
        <div data-wl-body>
          ${items.map(it => fila(it, campos, grid, conAcciones)).join('')}
        </div>`;
    },

    /**
     * Engancha las acciones. El widget no conoce la pantalla: emite un evento
     * y quien lo montó decide. Así el mismo widget funciona en la vista de
     * gestión, en un panel o en el chat sin cambiar una línea.
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

      // Doble clic en la fila: abrir en gráficos. También por evento.
      el.querySelectorAll('[data-wl-row]').forEach(row => {
        row.ondblclick = () => {
          el.dispatchEvent(new CustomEvent('axiom:watchlist-accion', {
            detail: { accion: 'abrir', id: parseInt(row.dataset.wlRow, 10) },
            bubbles: true,
          }));
        };
      });
    },
  });

  // ── Piezas de render ────────────────────────────────────────────────────────

  function cabecera(campos, grid) {
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
                  letter-spacing:.1em;">
        ${celdas}
      </div>`;
  }

  function fila(item, campos, grid, conAcciones) {
    const celdas = campos.map(c => {
      const just = DERECHA.has(c) ? 'text-align:right;'
                 : CENTRO.has(c)  ? 'text-align:center;' : '';
      return `<div style="${just}min-width:0;">${celda(c, item, conAcciones)}</div>`;
    }).join('');

    return `
      <div data-wl-row="${item.id}" id="wl-row-${item.id}"
           title="${conAcciones ? 'Doble clic para ver en Gráficos' : ''}"
           style="display:grid;grid-template-columns:${grid};gap:8px;
                  padding:10px 16px;border-bottom:0.5px solid var(--w1,#2C2926);
                  align-items:center;${conAcciones ? 'cursor:pointer;' : ''}">
        ${celdas}
      </div>`;
  }
})();
