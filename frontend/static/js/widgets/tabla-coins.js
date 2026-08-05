/**
 * AXIOM — Widget: tabla_coins (RENDER)
 * ────────────────────────────────────────────────────────────────────────────
 * Las coins que encabezan el mercado por un criterio (capitalización, volumen,
 * variación 24h o 7d). Consume top_coins. Reutilizable: sirve para "las 10 que
 * más subieron" en el chat y para la tabla por capitalización de la pantalla
 * Mercado — el mismo widget, distinta densidad.
 *
 * VALOR POLIMÓRFICO: top_coins devuelve un campo `valor` que ES el criterio
 * pedido (mcap, volumen o un %). La columna de valor se formatea según el
 * `criterio` que viene en el resultado — un % no se muestra como un $.
 *
 * Al clickear una fila emite `axiom:coin-abrir` con el coin_id; quien monta
 * decide (abrir en el gráfico, etc.). En el chat nadie escucha y no pasa nada.
 *
 * La DECLARACIÓN vive en `backend/domain/widgets.py`.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = (window.AXIOM = window.AXIOM || {});
  const Fmt = NS.Fmt;

  // Anchos por campo para el layout de columnas.
  const ANCHOS = {
    pos:       '32px',
    coin:      '1fr',
    valor:     '96px',
    precio:    '90px',
    cambio_24h:'70px',
    cambio_7d: '70px',
    spark:     '60px',
    mcap:      '90px',
    volumen:   '90px',
  };

  const DERECHA = new Set(['valor', 'precio', 'cambio_24h', 'cambio_7d', 'mcap', 'volumen']);
  const CENTRO  = new Set(['spark']);

  // Etiqueta de la columna de valor según el criterio del resultado.
  const ETIQ_VALOR = {
    market_cap: 'MCap',
    volume_24h: 'Volumen',
    change_24h: '24h',
    change_7d:  '7d',
  };

  function money(n) {
    if (n == null) return Fmt.NADA;
    const v = Number(n);
    if (!isFinite(v)) return Fmt.NADA;
    if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9)  return '$' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6)  return '$' + (v / 1e6).toFixed(1) + 'M';
    return '$' + v.toLocaleString('es-AR');
  }

  function precio(n) {
    if (n == null) return Fmt.NADA;
    const v = Number(n);
    if (!isFinite(v)) return Fmt.NADA;
    return v >= 1
      ? '$' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '$' + v.toPrecision(4);
  }

  // El valor del criterio, formateado como corresponde.
  function fmtValor(valor, criterio) {
    if (criterio === 'change_24h' || criterio === 'change_7d') {
      return `<span style="color:${Fmt.colorSigno(valor)};">${Fmt.pct(valor, 2, true)}</span>`;
    }
    return money(valor);   // market_cap o volume_24h
  }

  function avatar(c) {
    if (c.image) {
      return `<img src="${Fmt.esc(c.image)}" style="width:22px;height:22px;
        border-radius:50%;object-fit:cover;flex-shrink:0;">`;
    }
    const ini = String(c.symbol || '').slice(0, 3).toUpperCase();
    return `<div style="width:22px;height:22px;border-radius:50%;
      background:var(--c3,#2C2926);display:flex;align-items:center;
      justify-content:center;font-family:var(--f2,monospace);font-size:8px;
      font-weight:600;color:var(--t2,#A8A29E);flex-shrink:0;">${Fmt.esc(ini)}</div>`;
  }

  function celda(campo, c, criterio) {
    switch (campo) {
      case 'pos':
        return `<span style="font-family:var(--f2,monospace);font-size:10px;
          color:var(--t3,#78716C);text-align:right;">${c.posicion ?? c.rank ?? ''}</span>`;
      case 'coin':
        return `<div style="display:flex;align-items:center;gap:7px;min-width:0;">
          ${avatar(c)}
          <div style="min-width:0;">
            <div style="font-weight:500;color:var(--t1,#F5F0EB);font-size:12px;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${Fmt.esc(c.name || '')}</div>
            <div style="font-family:var(--f2,monospace);font-size:9px;
              color:var(--t3,#78716C);">${Fmt.esc((c.symbol || '').toUpperCase())}</div>
          </div>
        </div>`;
      case 'valor':
        return `<span style="font-family:var(--f2,monospace);font-size:11px;
          color:var(--t2,#A8A29E);">${fmtValor(c.valor, criterio)}</span>`;
      case 'precio':
        return `<span style="font-family:var(--f2,monospace);font-size:11px;
          color:var(--t1,#F5F0EB);">${precio(c.price)}</span>`;
      case 'cambio_24h':
        return `<span style="font-family:var(--f2,monospace);font-size:11px;font-weight:600;
          color:${Fmt.colorSigno(c.change_24h)};">${Fmt.pct(c.change_24h, 2, true)}</span>`;
      case 'cambio_7d':
        return `<span style="font-family:var(--f2,monospace);font-size:11px;font-weight:600;
          color:${Fmt.colorSigno(c.change_7d)};">${Fmt.pct(c.change_7d, 2, true)}</span>`;
      case 'spark':
        return Fmt.sparkline(c.sparkline, c.change_7d == null ? null : Number(c.change_7d) >= 0);
      case 'mcap':
        return `<span style="font-family:var(--f2,monospace);font-size:11px;
          color:var(--t3,#78716C);">${money(c.market_cap)}</span>`;
      case 'volumen':
        return `<span style="font-family:var(--f2,monospace);font-size:11px;
          color:var(--t3,#78716C);">${money(c.volume_24h)}</span>`;
      default:
        return '';
    }
  }

  const ETIQUETAS = {
    pos: '#', coin: 'Activo', valor: 'Valor', precio: 'Precio',
    cambio_24h: '24h', cambio_7d: '7d', spark: '7d', mcap: 'MCap', volumen: 'Volumen',
  };

  function cabecera(campos, grid, criterio) {
    const celdas = campos.map(c => {
      const just = DERECHA.has(c) ? 'text-align:right;'
                 : CENTRO.has(c)  ? 'text-align:center;'
                 : c === 'pos'    ? 'text-align:right;' : '';
      const label = c === 'valor' ? (ETIQ_VALOR[criterio] || 'Valor') : (ETIQUETAS[c] || '');
      return `<span style="${just}">${label}</span>`;
    }).join('');
    return `
      <div style="display:grid;grid-template-columns:${grid};gap:6px;
                  padding:8px 14px;border-bottom:1px solid var(--w1,#2C2926);
                  background:var(--c1,#12110F);font-family:var(--f2,monospace);
                  font-size:9px;color:var(--t3,#78716C);text-transform:uppercase;
                  letter-spacing:.08em;">${celdas}</div>`;
  }

  function fila(c, campos, grid, criterio) {
    const celdas = campos.map(campo => {
      const just = DERECHA.has(campo) ? 'text-align:right;'
                 : CENTRO.has(campo)  ? 'display:flex;justify-content:center;'
                 : campo === 'pos'    ? 'text-align:right;' : '';
      return `<div style="${just}min-width:0;">${celda(campo, c, criterio)}</div>`;
    }).join('');
    return `
      <div data-coin-row="${Fmt.esc(c.coin_id || '')}"
           data-coin-name="${Fmt.esc(c.name || c.symbol || '')}"
           data-coin-sym="${Fmt.esc(c.symbol || '')}"
           style="display:grid;grid-template-columns:${grid};gap:6px;
                  padding:8px 14px;border-bottom:0.5px solid var(--w1,#2C2926);
                  align-items:center;cursor:pointer;">${celdas}</div>`;
  }

  NS.Widgets.render('tabla_coins', {

    render(datos, ctx) {
      const d = (datos && (datos.resultado || datos)) || {};
      const coins = Array.isArray(d.coins) ? d.coins
                  : Array.isArray(d) ? d : [];
      const criterio = d.criterio || (ctx.args && ctx.args.criterio) || 'market_cap';

      if (!coins.length) {
        return `<div style="padding:24px;text-align:center;color:var(--t3,#78716C);
          font-size:13px;">No hay coins para mostrar.</div>`;
      }

      // La columna `valor` muestra la métrica del criterio. Pero si esa métrica
      // YA tiene su propia columna visible (ordenar por 24h con la columna 24h
      // presente), `valor` sería idéntica y redundante — se veían dos columnas
      // de +4763%. En ese caso se quita `valor`; solo aporta cuando el criterio
      // no está a la vista.
      const COLUMNA_DE = {
        change_24h: 'cambio_24h', change_7d: 'cambio_7d',
        market_cap: 'mcap',       volume_24h: 'volumen',
      };
      let campos = (ctx.campos || []).filter(c => ANCHOS[c]);
      const propia = COLUMNA_DE[criterio];
      if (propia && campos.includes(propia)) {
        campos = campos.filter(c => c !== 'valor');
      }

      const grid = campos.map(c => ANCHOS[c]).join(' ');

      return `
        ${cabecera(campos, grid, criterio)}
        <div data-coins-body>
          ${coins.map(c => fila(c, campos, grid, criterio)).join('')}
        </div>`;
    },

    mount(el, ctx) {
      el.querySelectorAll('[data-coin-row]').forEach(row => {
        row.onclick = () => {
          const id = row.dataset.coinRow;
          if (!id) return;
          el.dispatchEvent(new CustomEvent('axiom:coin-abrir', {
            detail: { coin_id: id, name: row.dataset.coinName, symbol: row.dataset.coinSym },
            bubbles: true,
          }));
        };
      });
    },
  });
})();
