/**
 * AXIOM v2 — Pantalla PARES
 * ────────────────────────────────────────────────────────────────────────────
 * El screener del universo tradeable: todos los pares de MEXC y CoinEx.
 *
 * Tabla ordenable por CUALQUIER columna: cada encabezado tiene una flecha que
 * indica el sentido. La columna activa se resalta; al hacer clic en ella se
 * invierte el orden; al hacer clic en otra, esa pasa a ser la activa con su
 * sentido por defecto.
 *
 * La primera columna (Par) queda FIJA al hacer scroll horizontal.
 *
 * Tres métricas de volatilidad, calculadas sobre las velas diarias:
 *   · Rango     — rango diario promedio (high-low)/low %   ← default de orden
 *   · Desvío    — desviación estándar de retornos diarios %
 *   · Repetible — % de días cuyo rango supera el umbral
 *
 * Los pares cuya base no está en el catálogo de CoinGecko se muestran igual
 * (siguen siendo operables) con "sin información" en la columna de la coin.
 * ──────────────────────────────────────────────────────────────────────────── */

const PairsScreen = {
  loaded: false,
  pares: [],

  filtros: {
    quote: '',
    exchange: '',
    min_volumen: 10000,
    orden: 'volumen',
    dir: 'desc',
    limit: 100,
    offset: 0,
  },

  // Metadata de la última respuesta (para armar la paginación)
  pag: { total: 0, paginas: 0, pagina: 1 },

  // Definición de columnas: clave, etiqueta, ancho, alineación y sentido inicial.
  // El orden de este array define el orden visual y el grid-template-columns.
  _COLS: [
    { key:'par',         label:'Par',       w:'112px', align:'left',  dir:'asc'  },
    { key:'exchange',    label:'Exch',      w:'62px',  align:'left',  dir:'asc'  },
    { key:'precio',      label:'Precio',    w:'96px',  align:'right', dir:'desc' },
    { key:'volumen',     label:'Vol 24h',   w:'92px',  align:'right', dir:'desc' },
    { key:'cambio',      label:'24h',       w:'64px',  align:'right', dir:'desc' },
    { key:'volatilidad', label:'Rango',     w:'68px',  align:'right', dir:'desc' },
    { key:'desvio',      label:'Desvío',    w:'64px',  align:'right', dir:'desc' },
    { key:'repetible',   label:'Repetible', w:'76px',  align:'right', dir:'desc' },
    { key:'spread',      label:'Spread',    w:'66px',  align:'right', dir:'asc'  },
    { key:'velas',       label:'Velas',     w:'50px',  align:'right', dir:'desc' },
    { key:'coin',        label:'Coin',      w:'1fr',   align:'left',  dir:'asc'  },
  ],

  get _grid() { return this._COLS.map(c => c.w).join(' '); },

  onEnter() {
    const el = document.getElementById('screen-pairs');
    if (!el.querySelector('#pairs-controls')) this._renderShell();
    if (!this.loaded) this._load();
  },

  onLeave() {},

  // ── Shell ─────────────────────────────────────────────────────────────────
  _renderShell() {
    document.getElementById('screen-pairs').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;
                margin-bottom:16px;flex-wrap:wrap;gap:8px;">
      <h1 style="display:flex;align-items:center;gap:8px;font-size:18px;
                 font-weight:600;color:var(--t1);letter-spacing:-.01em;">
        <i class="ti ti-arrows-exchange" style="font-size:18px;color:var(--cy);" aria-hidden="true"></i>
        Pares
      </h1>
      <span id="pairs-meta" style="font-family:var(--f2);font-size:11px;color:var(--t3);"></span>
    </div>

    <div id="pairs-controls" class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end;">
        <div>
          <div class="section-label" style="margin-bottom:6px;">Cotización</div>
          <div style="display:flex;gap:4px;">
            ${this._btnGroup('quote', [['','Todas'],['BTC','BTC'],['USDT','USDT']])}
          </div>
        </div>
        <div>
          <div class="section-label" style="margin-bottom:6px;">Exchange</div>
          <div style="display:flex;gap:4px;">
            ${this._btnGroup('exchange', [['','Todos'],['mexc','MEXC'],['coinex','CoinEx']])}
          </div>
        </div>
        <div>
          <div class="section-label" style="margin-bottom:6px;">Volumen 24h mínimo (USD)</div>
          <input id="pairs-minvol" type="number" value="10000" min="0" step="1000"
            style="background:var(--c2);border:0.5px solid var(--w1);border-radius:6px;
                   padding:6px 10px;color:var(--t1);font-family:var(--f2);font-size:12px;
                   width:120px;outline:none;">
        </div>
        <button id="pairs-apply"
          style="background:var(--cy);border:none;border-radius:6px;padding:7px 16px;
                 color:#0F0E0D;font-size:12px;font-weight:600;cursor:pointer;">
          Aplicar
        </button>
      </div>
    </div>

    <!-- Paginación superior -->
    <div id="pairs-pager-top" style="margin-bottom:10px;"></div>

    <!-- Tabla con scroll horizontal. La primera columna queda fija.
         NOTA: el encabezado no puede ser sticky vertical mientras el scroll
         horizontal viva en este contenedor (position:sticky no atraviesa
         ancestros con overflow). Se resuelve con el sistema de componentes
         adaptables — ver AXIOM_estado_y_foco.md. -->
    <div class="card" style="padding:0;overflow-x:auto;">
      <div style="min-width:1100px;">
        <div id="pairs-thead"></div>
        <div id="pairs-tbody"></div>
      </div>
    </div>

    <!-- Paginación inferior -->
    <div id="pairs-pager-bottom" style="margin-top:10px;"></div>`;

    this._bind();
    this._renderHead();
  },

  _btnGroup(campo, opciones) {
    return opciones.map(([val, label]) => `
      <button class="pairs-btn" data-campo="${campo}" data-val="${val}"
        style="background:transparent;border:0.5px solid var(--w1);border-radius:6px;
               padding:6px 11px;color:var(--t3);font-family:var(--f2);font-size:11px;
               cursor:pointer;white-space:nowrap;">${label}</button>`).join('');
  },

  _bind() {
    document.querySelectorAll('.pairs-btn').forEach(b => {
      b.onclick = () => {
        this.filtros[b.dataset.campo] = b.dataset.val;
        this.filtros.offset = 0;      // cambiar filtro → página 1
        this._marcarActivos();
        this._load();
      };
    });

    const apply = document.getElementById('pairs-apply');
    if (apply) apply.onclick = () => {
      const v = parseFloat(document.getElementById('pairs-minvol').value);
      this.filtros.min_volumen = isNaN(v) ? 0 : v;
      this.filtros.offset = 0;        // cambiar filtro → página 1
      this._load();
    };
    const input = document.getElementById('pairs-minvol');
    if (input) input.onkeydown = (e) => { if (e.key === 'Enter') apply.click(); };

    this._marcarActivos();
  },

  _marcarActivos() {
    document.querySelectorAll('.pairs-btn').forEach(b => {
      const activo = String(this.filtros[b.dataset.campo] ?? '') === b.dataset.val;
      b.style.background  = activo ? 'var(--t1)' : 'transparent';
      b.style.color       = activo ? '#0F0E0D' : 'var(--t3)';
      b.style.borderColor = activo ? 'var(--t1)' : 'var(--w1)';
    });
  },

  // ── Paginación ────────────────────────────────────────────────────────────
  /**
   * Números de página a mostrar: primera, última, y una ventana alrededor de
   * la actual. Los saltos se marcan con '…'.
   * Ej. con 22 páginas estando en la 9: 1 … 7 8 [9] 10 11 … 22
   */
  _numerosPagina(actual, total) {
    if (total <= 9) return Array.from({ length: total }, (_, i) => i + 1);
    const nums = new Set([1, total, actual]);
    for (let d = 1; d <= 2; d++) {
      if (actual - d >= 1) nums.add(actual - d);
      if (actual + d <= total) nums.add(actual + d);
    }
    const orden = [...nums].sort((a, b) => a - b);
    const out = [];
    let prev = 0;
    for (const n of orden) {
      if (prev && n - prev > 1) out.push('…');
      out.push(n);
      prev = n;
    }
    return out;
  },

  _renderPager() {
    const { total, paginas, pagina } = this.pag;
    const html = paginas <= 1 && total <= this.filtros.limit
      ? this._pagerResumen()
      : this._pagerCompleto();

    ['pairs-pager-top', 'pairs-pager-bottom'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });

    document.querySelectorAll('[data-pagina]').forEach(b => {
      b.onclick = () => this.irAPagina(parseInt(b.dataset.pagina, 10));
    });
    document.querySelectorAll('[data-porpagina]').forEach(s => {
      s.onchange = () => {
        this.filtros.limit = parseInt(s.value, 10);
        this.filtros.offset = 0;
        this._load();
      };
    });
  },

  _pagerResumen() {
    const { total } = this.pag;
    return `<div style="display:flex;justify-content:space-between;align-items:center;
                        font-family:var(--f2);font-size:11px;color:var(--t3);">
      <span>${total} ${total === 1 ? 'par' : 'pares'}</span>
      ${this._selectPorPagina()}
    </div>`;
  },

  _selectPorPagina() {
    const opts = [50, 100, 200, 500]
      .map(n => `<option value="${n}" ${n === this.filtros.limit ? 'selected' : ''}>${n}</option>`)
      .join('');
    return `<span style="display:flex;align-items:center;gap:6px;">
      <span>por página</span>
      <select data-porpagina
        style="background:var(--c2);border:0.5px solid var(--w1);border-radius:5px;
               padding:3px 6px;color:var(--t2);font-family:var(--f2);font-size:11px;
               outline:none;cursor:pointer;">${opts}</select>
    </span>`;
  },

  _btnPag(label, pagina, opts = {}) {
    const { activo = false, deshabilitado = false } = opts;
    if (label === '…') {
      return `<span style="padding:5px 4px;color:var(--t3);font-family:var(--f2);
                           font-size:11px;">…</span>`;
    }
    const base = `border-radius:5px;padding:5px 10px;font-family:var(--f2);
                  font-size:11px;min-width:30px;`;
    if (deshabilitado) {
      return `<button disabled style="${base}background:transparent;
        border:0.5px solid var(--w1);color:var(--t3);opacity:.35;cursor:default;">${label}</button>`;
    }
    if (activo) {
      return `<button data-pagina="${pagina}" style="${base}background:var(--cy);
        border:0.5px solid var(--cy);color:#0F0E0D;font-weight:600;cursor:pointer;">${label}</button>`;
    }
    return `<button data-pagina="${pagina}" style="${base}background:transparent;
      border:0.5px solid var(--w1);color:var(--t2);cursor:pointer;">${label}</button>`;
  },

  _pagerCompleto() {
    const { total, paginas, pagina } = this.pag;
    const { limit, offset } = this.filtros;
    const desde = total ? offset + 1 : 0;
    const hasta = Math.min(offset + limit, total);

    const nums = this._numerosPagina(pagina, paginas)
      .map(n => n === '…'
        ? this._btnPag('…')
        : this._btnPag(String(n), n, { activo: n === pagina }))
      .join('');

    return `
    <div style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;flex-wrap:wrap;">
      <span style="font-family:var(--f2);font-size:11px;color:var(--t3);">
        ${desde}–${hasta} de ${total}
      </span>
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
        ${this._btnPag('‹', pagina - 1, { deshabilitado: pagina <= 1 })}
        ${nums}
        ${this._btnPag('›', pagina + 1, { deshabilitado: pagina >= paginas })}
      </div>
      <span style="font-family:var(--f2);font-size:11px;color:var(--t3);">
        ${this._selectPorPagina()}
      </span>
    </div>`;
  },

  irAPagina(n) {
    const { paginas } = this.pag;
    if (n < 1 || (paginas && n > paginas)) return;
    this.filtros.offset = (n - 1) * this.filtros.limit;
    this._load({ mantenerFilas: true, scrollArriba: true });
  },

  // ── Ordenamiento por columna ──────────────────────────────────────────────
  /**
   * Clic en un encabezado:
   *  · si ya es la columna activa → invierte el sentido
   *  · si es otra → pasa a ser la activa, con su sentido por defecto
   */
  ordenarPor(key) {
    const col = this._COLS.find(c => c.key === key);
    if (!col) return;
    if (this.filtros.orden === key) {
      this.filtros.dir = this.filtros.dir === 'asc' ? 'desc' : 'asc';
    } else {
      this.filtros.orden = key;
      this.filtros.dir = col.dir;
    }
    // Reordenar vuelve a la primera página: seguir en la 15 tras cambiar el
    // criterio no tendría sentido.
    this.filtros.offset = 0;
    // No se vacía la tabla: si se reemplazaran las filas por el mensaje de
    // carga, la página se acortaría de golpe y el navegador movería el scroll.
    this._load({ mantenerFilas: true, scrollArriba: true });
  },

  _renderHead() {
    const { orden, dir } = this.filtros;

    const celdas = this._COLS.map((c, i) => {
      const activa = c.key === orden;
      // Flecha: la de la columna activa marca el sentido real; en las demás
      // se muestra tenue el sentido que aplicaría al elegirlas.
      const arriba = activa ? dir === 'asc' : c.dir === 'asc';
      const icono  = arriba ? 'ti-arrow-up' : 'ti-arrow-down';
      const color  = activa ? 'var(--cy)' : 'var(--t4, var(--t3))';
      const peso   = activa ? 'font-weight:600;' : '';
      const op     = activa ? '1' : '.35';

      // La primera columna queda fija al scrollear horizontalmente
      const sticky = i === 0
        ? 'position:sticky;left:0;z-index:4;background:var(--c1);' +
          'padding-left:16px;margin-left:-16px;padding-right:8px;'
        : '';

      const just = c.align === 'right' ? 'flex-end' : 'flex-start';

      return `
        <span data-col="${c.key}"
          style="display:flex;align-items:center;gap:3px;justify-content:${just};
                 cursor:pointer;user-select:none;${peso}${sticky}
                 color:${activa ? 'var(--cy)' : 'var(--t3)'};">
          <span>${c.label}</span>
          <i class="ti ${icono}" style="font-size:11px;color:${color};opacity:${op};"
             aria-hidden="true"></i>
        </span>`;
    }).join('');

    const thead = document.getElementById('pairs-thead');
    thead.innerHTML = `
      <div style="display:grid;grid-template-columns:${this._grid};gap:8px;
                  padding:10px 16px;border-bottom:1px solid var(--w1);
                  background:var(--c1);position:relative;z-index:3;
                  font-family:var(--f2);font-size:9px;
                  text-transform:uppercase;letter-spacing:.1em;">
        ${celdas}
      </div>`;

    thead.querySelectorAll('[data-col]').forEach(el => {
      el.onclick = () => this.ordenarPor(el.dataset.col);
    });
  },

  // ── Formato ───────────────────────────────────────────────────────────────
  _fmtPrecio(p) {
    if (p == null) return '—';
    if (p >= 1000)  return p.toLocaleString('es-AR', { maximumFractionDigits: 2 });
    if (p >= 1)     return p.toFixed(4);
    if (p >= 0.001) return p.toFixed(6);
    return p.toFixed(10);
  },

  _fmtVol(v) {
    if (v == null) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toFixed(0);
  },

  _fmtPct(v, dec = 2) {
    return v == null ? '—' : v.toFixed(dec) + '%';
  },

  _renderRow(p) {
    const chCol = p.cambio_24h == null ? 'var(--t3)'
                : p.cambio_24h >= 0 ? '#56A14F' : 'var(--re)';
    const chTxt = p.cambio_24h == null ? '—'
                : (p.cambio_24h >= 0 ? '+' : '') + p.cambio_24h.toFixed(2) + '%';

    const coin = p.tiene_info
      ? `<span style="display:flex;align-items:center;gap:6px;min-width:0;">
           ${p.coin.image ? `<img src="${p.coin.image}" style="width:16px;height:16px;border-radius:50%;flex-shrink:0;">` : ''}
           <span style="color:var(--t2);font-size:12px;overflow:hidden;
                        text-overflow:ellipsis;white-space:nowrap;">${p.coin.nombre || p.base}</span>
           ${p.coin.rank ? `<span style="font-family:var(--f2);font-size:10px;color:var(--t3);flex-shrink:0;">#${p.coin.rank}</span>` : ''}
         </span>`
      : `<span style="font-family:var(--f2);font-size:11px;color:var(--t3);
                      font-style:italic;">sin información</span>`;

    // La celda del par lleva fondo propio: sin él, al scrollear se vería el
    // contenido de las otras columnas pasando por debajo.
    return `
      <div class="pairs-row"
           style="display:grid;grid-template-columns:${this._grid};gap:8px;
                  padding:9px 16px;border-bottom:0.5px solid var(--w1);
                  align-items:center;font-size:12px;">
        <span style="font-family:var(--f2);font-weight:500;color:var(--t1);
                     position:sticky;left:0;z-index:1;background:var(--c1);
                     padding-left:16px;margin-left:-16px;padding-right:8px;">${p.par}</span>
        <span style="font-family:var(--f2);font-size:10px;color:var(--t3);">${p.exchange}</span>
        <span style="text-align:right;font-family:var(--f2);color:var(--t2);">${this._fmtPrecio(p.precio)}</span>
        <span style="text-align:right;font-family:var(--f2);color:var(--t2);">$${this._fmtVol(p.volumen_24h)}</span>
        <span style="text-align:right;font-family:var(--f2);color:${chCol};">${chTxt}</span>
        <span style="text-align:right;font-family:var(--f2);color:var(--t1);">${this._fmtPct(p.volatilidad)}</span>
        <span style="text-align:right;font-family:var(--f2);color:var(--t2);">${this._fmtPct(p.desvio)}</span>
        <span style="text-align:right;font-family:var(--f2);color:var(--t2);">${this._fmtPct(p.dias_repetible_pct, 0)}</span>
        <span style="text-align:right;font-family:var(--f2);color:var(--t2);">${this._fmtPct(p.spread_pct, 3)}</span>
        <span style="text-align:right;font-family:var(--f2);font-size:10px;color:var(--t3);">${p.velas || 0}</span>
        ${coin}
      </div>`;
  },

  // ── Carga ─────────────────────────────────────────────────────────────────
  async _load(opts = {}) {
    const tbody = document.getElementById('pairs-tbody');
    if (!tbody) return;
    this._renderHead();

    const mantener = opts.mantenerFilas && tbody.children.length > 0;
    if (mantener) {
      // Reordenamiento: se conservan las filas (y con ellas el alto de la
      // página) y solo se atenúan mientras llega la respuesta.
      tbody.style.opacity = '.45';
      tbody.style.transition = 'opacity .15s';
    } else {
      tbody.innerHTML = `<div style="padding:28px;text-align:center;color:var(--t3);font-size:13px;">
        Cargando pares…</div>`;
    }

    const f = this.filtros;
    const qs = new URLSearchParams({
      orden: f.orden,
      dir: f.dir,
      limit: f.limit,
      offset: f.offset,
      min_volumen: f.min_volumen,
    });
    if (f.quote)    qs.set('quote', f.quote);
    if (f.exchange) qs.set('exchange', f.exchange);

    try {
      const r = await fetch(`/api/pairs/?${qs.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      this.pares = data.pares || [];
      this.loaded = true;
      this.pag = {
        total: data.total || 0,
        paginas: data.paginas || 0,
        pagina: data.pagina || 1,
      };

      const meta = document.getElementById('pairs-meta');
      if (meta) {
        const conInfo = this.pares.filter(p => p.tiene_info).length;
        meta.textContent =
          `${this.pag.total} pares · ${conInfo}/${this.pares.length} con info en esta página · ` +
          `volumen ≥ $${this._fmtVol(f.min_volumen)}`;
      }

      tbody.innerHTML = this.pares.length
        ? this.pares.map(p => this._renderRow(p)).join('')
        : `<div style="padding:28px;text-align:center;color:var(--t3);font-size:13px;">
             Ningún par cumple estos filtros. Probá bajando el volumen mínimo.</div>`;

      this._renderPager();

      // Al cambiar de página, llevar la vista al inicio de la tabla
      if (opts.scrollArriba) {
        const top = document.getElementById('pairs-pager-top');
        if (top) top.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } catch (e) {
      tbody.innerHTML = `<div style="padding:24px;color:var(--re);font-size:13px;">
        Error al cargar: ${e.message}</div>`;
    } finally {
      tbody.style.opacity = '1';
    }
  },
};

window.PairsScreen = PairsScreen;
