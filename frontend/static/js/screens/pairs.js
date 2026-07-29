/**
 * AXIOM — Pantalla PARES
 * ────────────────────────────────────────────────────────────────────────────
 * La tabla ya NO vive acá: es el widget `tabla_pares`, montado en un contenedor.
 * Esta pantalla se queda con lo que es propio de la vista y no viajaría con el
 * widget a otro contexto:
 *   · la barra de filtros (cotización, exchange, volumen mínimo)
 *   · la paginación
 *
 * Por qué la división es así: el widget es lo reutilizable —podría montarse en
 * un panel del gráfico o en una respuesta de Kepler—, mientras que paginar 3.200
 * pares solo tiene sentido en una pantalla dedicada.
 *
 * Los datos los pide la pantalla a `/api/pairs/` (que tiene paginación) y se los
 * pasa al widget ya obtenidos. El widget acepta datos de ahí o de la capacidad
 * `buscar_pares` indistintamente.
 *
 * Ver AXIOM_sistema_widgets.md
 * ──────────────────────────────────────────────────────────────────────────── */

const PairsScreen = {
  loaded: false,
  pares: [],
  epistemico: null,

  filtros: {
    quote: '',
    exchange: '',
    min_volumen: 1000,
    orden: 'volumen',
    dir: 'desc',
    limit: 100,
    offset: 0,
  },

  pag: { total: 0, paginas: 0, pagina: 1 },

  onEnter() {
    const el = document.getElementById('screen-pairs');
    if (!el.querySelector('#pairs-controls')) this._renderShell();
    if (!this.loaded) this._load();
  },

  onLeave() {
    // Desmontar el widget corta su ResizeObserver: si no, sigue vivo en una
    // pantalla que no se ve.
    const cont = document.getElementById('pairs-widget');
    if (cont && window.AXIOM?.WidgetMount) AXIOM.WidgetMount.unmount(cont);
    this.loaded = false;
  },

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
          <input id="pairs-minvol" type="number" value="1000" min="0" step="500"
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

    <div id="pairs-pager-top" style="margin-bottom:10px;"></div>

    <!-- Contenedor del widget. Su ANCHO es lo que resuelve la densidad. -->
    <div class="card" style="padding:0;">
      <div id="pairs-widget"></div>
    </div>

    <div id="pairs-pager-bottom" style="margin-top:10px;"></div>`;

    this._bind();
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
        this.filtros.offset = 0;          // cambiar filtro → página 1
        this._marcarActivos();
        this._load();
      };
    });

    const apply = document.getElementById('pairs-apply');
    if (apply) apply.onclick = () => {
      const v = parseFloat(document.getElementById('pairs-minvol').value);
      this.filtros.min_volumen = isNaN(v) ? 0 : v;
      this.filtros.offset = 0;
      this._load();
    };
    const input = document.getElementById('pairs-minvol');
    if (input) input.onkeydown = e => { if (e.key === 'Enter') apply.click(); };

    // El widget avisa cuando se hace clic en un encabezado. Se intercepta para
    // coordinar con la paginación: reordenar debe volver a la página 1, y el
    // widget solo no sabe nada de páginas.
    const cont = document.getElementById('pairs-widget');
    if (cont) {
      cont.addEventListener('axiom:widget-orden', ev => {
        ev.preventDefault();            // el widget no refiltra por su cuenta
        this.filtros.orden = ev.detail.orden;
        this.filtros.dir   = ev.detail.dir;
        this.filtros.offset = 0;
        this._load({ scrollArriba: true });
      });
    }

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
  _numerosPagina(actual, total) {
    if (total <= 9) return Array.from({ length: total }, (_, i) => i + 1);
    const nums = new Set([1, total, actual]);
    for (let d = 1; d <= 2; d++) {
      if (actual - d >= 1) nums.add(actual - d);
      if (actual + d <= total) nums.add(actual + d);
    }
    const out = []; let prev = 0;
    for (const n of [...nums].sort((a, b) => a - b)) {
      if (prev && n - prev > 1) out.push('…');
      out.push(n); prev = n;
    }
    return out;
  },

  _renderPager() {
    const { total, paginas, pagina } = this.pag;
    const { limit, offset } = this.filtros;
    const desde = total ? offset + 1 : 0;
    const hasta = Math.min(offset + limit, total);

    const btn = (label, p, o = {}) => {
      if (label === '…') return `<span style="padding:5px 4px;color:var(--t3);
        font-family:var(--f2);font-size:11px;">…</span>`;
      const base = 'border-radius:5px;padding:5px 10px;font-family:var(--f2);font-size:11px;min-width:30px;';
      if (o.off) return `<button disabled style="${base}background:transparent;
        border:0.5px solid var(--w1);color:var(--t3);opacity:.35;cursor:default;">${label}</button>`;
      if (o.on) return `<button data-pagina="${p}" style="${base}background:var(--cy);
        border:0.5px solid var(--cy);color:#0F0E0D;font-weight:600;cursor:pointer;">${label}</button>`;
      return `<button data-pagina="${p}" style="${base}background:transparent;
        border:0.5px solid var(--w1);color:var(--t2);cursor:pointer;">${label}</button>`;
    };

    const sel = [50, 100, 200, 500]
      .map(n => `<option value="${n}" ${n === limit ? 'selected' : ''}>${n}</option>`).join('');

    const html = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <span style="font-family:var(--f2);font-size:11px;color:var(--t3);">
        ${desde}–${hasta} de ${total}
      </span>
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
        ${btn('‹', pagina - 1, { off: pagina <= 1 })}
        ${this._numerosPagina(pagina, paginas).map(n =>
            n === '…' ? btn('…') : btn(String(n), n, { on: n === pagina })).join('')}
        ${btn('›', pagina + 1, { off: pagina >= paginas })}
      </div>
      <span style="display:flex;align-items:center;gap:6px;font-family:var(--f2);
                   font-size:11px;color:var(--t3);">
        por página
        <select data-porpagina style="background:var(--c2);border:0.5px solid var(--w1);
          border-radius:5px;padding:3px 6px;color:var(--t2);font-family:var(--f2);
          font-size:11px;outline:none;cursor:pointer;">${sel}</select>
      </span>
    </div>`;

    ['pairs-pager-top', 'pairs-pager-bottom'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });

    document.querySelectorAll('[data-pagina]').forEach(b => {
      b.onclick = () => {
        const n = parseInt(b.dataset.pagina, 10);
        if (n < 1 || (this.pag.paginas && n > this.pag.paginas)) return;
        this.filtros.offset = (n - 1) * this.filtros.limit;
        this._load({ scrollArriba: true });
      };
    });
    document.querySelectorAll('[data-porpagina]').forEach(s => {
      s.onchange = () => {
        this.filtros.limit = parseInt(s.value, 10);
        this.filtros.offset = 0;
        this._load();
      };
    });
  },

  // ── Carga ─────────────────────────────────────────────────────────────────
  async _load(opts = {}) {
    const cont = document.getElementById('pairs-widget');
    if (!cont) return;

    const f = this.filtros;
    const qs = new URLSearchParams({
      orden: f.orden, dir: f.dir, limit: f.limit,
      offset: f.offset, min_volumen: f.min_volumen,
    });
    if (f.quote)    qs.set('quote', f.quote);
    if (f.exchange) qs.set('exchange', f.exchange);

    try {
      const r = await fetch(`/api/pairs/?${qs.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      this.pares  = data.pares || [];
      this.loaded = true;
      this.pag = {
        total:   data.total   || 0,
        paginas: data.paginas || 0,
        pagina:  data.pagina  || 1,
      };

      // La declaración epistémica de la capacidad que produce estos datos.
      // Se pide una vez y se reusa: el widget la necesita para exponer los
      // límites de lo que muestra (requisito, no opcional).
      if (!this.epistemico) this._cargarEpistemico();

      const meta = document.getElementById('pairs-meta');
      if (meta) {
        const conInfo = this.pares.filter(p => p.tiene_info).length;
        meta.textContent = `${this.pag.total} pares · ${conInfo}/${this.pares.length} `
          + `con info en esta página · volumen ≥ $${AXIOM.Fmt.volumen(f.min_volumen)}`;
      }

      // Montar (o remontar) el widget con los datos ya obtenidos.
      await AXIOM.WidgetMount.mount(cont, 'tabla_pares', {
        datos: { pares: this.pares },
        args: { orden: f.orden, dir: f.dir, quote: f.quote, min_volumen: f.min_volumen },
        contexto: 'pantalla',
        epistemico: this.epistemico,
      });

      this._renderPager();

      if (opts.scrollArriba) {
        const top = document.getElementById('pairs-pager-top');
        if (top) top.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } catch (e) {
      cont.innerHTML = `<div style="padding:24px;color:var(--re);font-size:13px;">
        Error al cargar: ${e.message}</div>`;
    }
  },

  /** Trae la declaración epistémica de `buscar_pares` del registro. */
  async _cargarEpistemico() {
    try {
      const r = await fetch('/api/capacidades/buscar_pares');
      if (!r.ok) return;
      const d = await r.json();
      this.epistemico = d.epistemico || null;
      // Si ya hay un widget montado, actualizarlo para que muestre los límites
      const cont = document.getElementById('pairs-widget');
      if (cont && this.epistemico) {
        AXIOM.WidgetMount.actualizar(cont, { pares: this.pares }, this.epistemico);
      }
    } catch (e) { /* sin declaración: el widget se muestra sin la nota */ }
  },
};

window.PairsScreen = PairsScreen;
