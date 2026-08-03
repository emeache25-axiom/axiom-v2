/**
 * AXIOM — Widget: libro_par (RENDER)
 * ────────────────────────────────────────────────────────────────────────────
 * El libro de órdenes de un par: bids (compras) y asks (ventas) con barras de
 * profundidad. Cuando Migue pide "mostrame el libro de ONT", Kepler llama
 * libro_par y esto lo pinta.
 *
 * A diferencia del gráfico de velas, esto es HTML puro: no hay canvas ni LWC,
 * así que va todo en render() y no hace falta mount(). Cada nivel es una fila
 * con precio, cantidad y una barra proporcional al volumen ACUMULADO hacia el
 * borde — la forma clásica del libro, que deja ver de un vistazo dónde se
 * concentra la liquidez.
 *
 * RIGOR: el libro es una foto de un instante y la profundidad visible no es
 * liquidez garantizada (puede haber órdenes que se retiran). El bloque
 * epistémico de libro_par ya lo dice; acá no se agrega lectura, solo se muestran
 * los datos tal como vienen.
 *
 * La DECLARACIÓN vive en `backend/domain/widgets.py`.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = (window.AXIOM = window.AXIOM || {});
  const Fmt = NS.Fmt;

  const COL = {
    bid:     '#56A14F',
    bidBar:  'rgba(86,161,79,.14)',
    ask:     '#D93B3B',
    askBar:  'rgba(217,59,59,.14)',
    text:    'var(--t1,#F5F0EB)',
    muted:   'var(--t3,#78716C)',
    border:  'var(--w1,#2C2926)',
  };

  // Precio con decimales según magnitud (los pares /BTC van en satoshis).
  function fmtPrecio(p) {
    const n = Number(p);
    if (!isFinite(n)) return Fmt.NADA;
    if (n >= 1000)  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
    if (n >= 1)     return n.toFixed(4);
    if (n >= 0.001) return n.toFixed(6);
    return n.toFixed(10);
  }

  // Cantidad abreviada (puede ser grande: millones de tokens).
  function fmtCant(q) {
    const n = Number(q);
    if (!isFinite(n)) return Fmt.NADA;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    if (n >= 1)   return n.toFixed(2);
    return n.toFixed(4);
  }

  // Normaliza un lado del libro a [{precio, cantidad}], tolerando formatos
  // ([precio,cant] en array, o {price,size}/{p,q} en objeto).
  function lado(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    for (const it of items) {
      let precio, cant;
      if (Array.isArray(it)) { precio = it[0]; cant = it[1]; }
      else if (it && typeof it === 'object') {
        precio = it.precio ?? it.price ?? it.p;
        cant   = it.cantidad ?? it.size ?? it.qty ?? it.q ?? it.amount;
      }
      const pn = Number(precio), cn = Number(cant);
      if (!isFinite(pn) || !isFinite(cn)) continue;
      out.push({ precio: pn, cantidad: cn });
    }
    return out;
  }

  // Una fila del libro. `pctAcum` (0..1) es el ancho de la barra de profundidad;
  // `lado` decide color y de qué borde crece la barra.
  function fila(nivel, pctAcum, esBid) {
    const barColor = esBid ? COL.bidBar : COL.askBar;
    const txtColor = esBid ? COL.bid : COL.ask;
    const origen   = esBid ? 'right' : 'left';   // bids crecen desde la derecha
    const ancho    = Math.max(2, Math.round(pctAcum * 100));

    return `
      <div style="position:relative;display:grid;grid-template-columns:1fr 1fr;
                  gap:8px;padding:3px 10px;font-family:var(--f2,monospace);
                  font-size:11px;">
        <div style="position:absolute;top:0;bottom:0;${origen}:0;width:${ancho}%;
                    background:${barColor};"></div>
        <span style="position:relative;color:${txtColor};${esBid ? '' : 'order:2;text-align:right;'}"
          >${fmtPrecio(nivel.precio)}</span>
        <span style="position:relative;color:${COL.muted};${esBid ? 'text-align:right;' : 'order:1;'}"
          >${fmtCant(nivel.cantidad)}</span>
      </div>`;
  }

  // Columna (bids o asks) con barras de profundidad acumulada.
  function columna(niveles, esBid) {
    if (!niveles.length) {
      return `<div style="padding:16px;text-align:center;color:${COL.muted};
        font-size:11px;">Sin ${esBid ? 'compras' : 'ventas'}</div>`;
    }
    // Acumular volumen para las barras; normalizar por el total del lado.
    let acum = 0;
    const total = niveles.reduce((s, n) => s + n.cantidad, 0) || 1;
    const filas = niveles.map((n) => {
      acum += n.cantidad;
      return fila(n, acum / total, esBid);
    });
    return filas.join('');
  }

  NS.Widgets.render('libro_orden', {

    render(datos, ctx) {
      const d = (datos && (datos.resultado || datos)) || {};
      const bids = lado(d.bids).sort((a, b) => b.precio - a.precio);  // mayor arriba
      const asks = lado(d.asks).sort((a, b) => a.precio - b.precio);  // menor arriba

      if (!bids.length && !asks.length) {
        const noSop = d._no_soportado;
        return `<div style="padding:24px;text-align:center;color:${COL.muted};
          font-size:13px;">${noSop
            ? 'Este exchange no expone el libro de órdenes.'
            : 'El libro de órdenes vino vacío.'}</div>`;
      }

      // Spread entre el mejor bid y el mejor ask.
      const mejorBid = bids.length ? bids[0].precio : null;
      const mejorAsk = asks.length ? asks[0].precio : null;
      let spreadHtml = '';
      if (mejorBid != null && mejorAsk != null && mejorAsk > 0) {
        const spreadPct = ((mejorAsk - mejorBid) / mejorAsk) * 100;
        spreadHtml = `
          <div style="text-align:center;padding:5px 0;font-family:var(--f2,monospace);
                      font-size:10px;color:${COL.muted};
                      border-top:0.5px solid ${COL.border};
                      border-bottom:0.5px solid ${COL.border};margin:0 0 2px;">
            spread <b style="color:${COL.text};">${spreadPct.toFixed(3)}%</b>
            · ${fmtPrecio(mejorBid)} / ${fmtPrecio(mejorAsk)}
          </div>`;
      }

      const args = ctx.args || {};
      const titulo = [
        args.coin_id  ? Fmt.esc(String(args.coin_id).toUpperCase()) : '',
        args.exchange ? Fmt.esc(String(args.exchange).toUpperCase()) : '',
      ].filter(Boolean).join(' · ');

      // Los asks se muestran de mayor a menor precio ARRIBA (clásico: el precio
      // sube hacia arriba). Para eso se invierte el orden de dibujo del lado ask.
      const asksArriba = asks.slice().reverse();

      return `
        <div>
          ${titulo ? `<div style="font-family:var(--f2,monospace);font-size:10px;
             color:${COL.muted};text-transform:uppercase;letter-spacing:.08em;
             padding:4px 2px 8px;">libro · ${titulo}</div>` : ''}

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;
                      padding:2px 10px 5px;font-family:var(--f2,monospace);
                      font-size:9px;color:${COL.muted};text-transform:uppercase;
                      letter-spacing:.08em;">
            <span>Precio</span>
            <span style="text-align:right;">Cantidad (compra)</span>
          </div>
          ${columna(bids, true)}

          ${spreadHtml}

          ${columna(asksArriba, false)}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;
                      padding:5px 10px 2px;font-family:var(--f2,monospace);
                      font-size:9px;color:${COL.muted};text-transform:uppercase;
                      letter-spacing:.08em;">
            <span style="order:2;text-align:right;">Precio</span>
            <span style="order:1;">Cantidad (venta)</span>
          </div>
        </div>`;
    },
  });
})();
