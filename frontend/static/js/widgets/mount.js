/**
 * AXIOM — Widgets / Mount
 * ────────────────────────────────────────────────────────────────────────────
 * Monta widgets en cualquier contenedor y los mantiene adaptados a su espacio.
 *
 * Lo central: la densidad se resuelve por el ancho del CONTENEDOR, no de la
 * ventana. Un ResizeObserver vigila cada contenedor montado; cuando el ancho
 * cruza un umbral, el widget se re-renderiza con los campos de la nueva
 * densidad. Eso permite que el mismo widget esté compacto en un panel de 300px
 * y amplio en una pantalla de 1400px, al mismo tiempo.
 *
 * Uso:
 *   AXIOM.WidgetMount.mount(el, 'tabla_pares', {
 *     datos: {...},              // si no se pasan, se piden a la capacidad
 *     args: { quote: 'BTC' },
 *     contexto: 'pantalla',
 *     epistemico: {...},         // declaración de la capacidad (ver §6 del diseño)
 *   });
 *
 *   AXIOM.WidgetMount.unmount(el);
 *
 * Ver AXIOM_sistema_widgets.md
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = (window.AXIOM = window.AXIOM || {});
  const Reg = NS.Widgets;

  // Instancias montadas, indexadas por elemento contenedor.
  const _montados = new Map();

  // Espera tras un resize antes de re-evaluar. Evita recalcular en cada píxel
  // mientras se arrastra el borde de un panel.
  const _DEBOUNCE_MS = 120;

  class WidgetMount {

    /**
     * Monta un widget en un contenedor.
     * Si ya había uno montado ahí, lo desmonta antes.
     */
    async mount(el, widgetId, opts = {}) {
      if (!el) { console.error('[widgets] contenedor nulo'); return null; }

      // Las declaraciones viven en el backend: hay que tenerlas antes de montar.
      if (!Reg.listo) { this._pintarCargando(el); await Reg.cargar(); }

      const def = Reg.get(widgetId);
      if (!def) { console.error('[widgets] no registrado:', widgetId); return null; }

      // Si YA está montado el mismo widget acá, no se desmonta: se actualizan
      // los datos y se vuelve a pintar. Desmontar vacía el contenedor, su alto
      // colapsa a cero y la página salta — se notaba al recargar la watchlist
      // después de agregar un par.
      const previa = _montados.get(el);
      if (previa && previa.def.id === widgetId) {
        Object.assign(previa.args, opts.args || {});
        if (opts.datos) previa.datos = opts.datos;
        if (opts.epistemico) previa.epistemico = opts.epistemico;
        this._render(previa);
        return previa;
      }

      const contexto = opts.contexto || 'pantalla';
      if (!def.contextos.includes(contexto)) {
        console.warn(`[widgets] ${widgetId} no declara el contexto '${contexto}'`);
      }

      this.unmount(el);

      const inst = {
        el, def, contexto,
        args: Object.assign({}, def.argsDefault, opts.args || {}),
        datos: opts.datos || null,
        epistemico: opts.epistemico || null,
        densidad: null,
        observer: null,
        timer: null,
      };
      _montados.set(el, inst);

      // Datos: o vienen dados (caso Kepler) o se piden a la capacidad.
      if (!inst.datos && def.capacidad) {
        this._pintarCargando(el);
        try {
          const r = await this._pedirDatos(def.capacidad, inst.args);
          inst.datos      = r.resultado;
          inst.epistemico = inst.epistemico || r.epistemico;
        } catch (e) {
          this._pintarError(el, e.message);
          return inst;
        }
      }

      this._render(inst);
      this._observar(inst);
      return inst;
    }

    /** Desmonta y limpia: corta el observer y llama al unmount del widget. */
    unmount(el) {
      const inst = _montados.get(el);
      if (!inst) return;
      if (inst.observer) { try { inst.observer.disconnect(); } catch (e) {} }
      if (inst.timer) clearTimeout(inst.timer);
      if (typeof inst.def.unmount === 'function') {
        try { inst.def.unmount(el); } catch (e) { console.warn('[widgets] unmount', e); }
      }
      el.innerHTML = '';
      _montados.delete(el);
    }

    /** Reemplaza los datos de un widget montado y lo vuelve a pintar. */
    actualizar(el, datos, epistemico) {
      const inst = _montados.get(el);
      if (!inst) return;
      inst.datos = datos;
      if (epistemico) inst.epistemico = epistemico;
      this._render(inst);
    }

    /** Cambia los args y vuelve a pedir los datos. */
    async refiltrar(el, args) {
      const inst = _montados.get(el);
      if (!inst || !inst.def.capacidad) return;

      const argsPrevios = Object.assign({}, inst.args);
      Object.assign(inst.args, args || {});
      try {
        const r = await this._pedirDatos(inst.def.capacidad, inst.args);
        inst.datos      = r.resultado;
        inst.epistemico = r.epistemico;
        this._render(inst);
      } catch (e) {
        // Un refiltrado fallido NO debe destruir lo que ya se estaba viendo:
        // se revierten los args, se vuelve a pintar lo anterior y el error se
        // muestra como aviso encima.
        inst.args = argsPrevios;
        this._render(inst);
        this._avisar(el, e.message);
      }
    }

    /** Aviso temporal sobre el widget, sin reemplazar su contenido. */
    _avisar(el, msg) {
      const aviso = document.createElement('div');
      aviso.style.cssText = `padding:8px 14px;background:rgba(217,59,59,.12);
        border-bottom:0.5px solid var(--re,#D93B3B);color:var(--re,#D93B3B);
        font-size:11px;font-family:var(--f2,monospace);`;
      aviso.textContent = msg;
      el.insertBefore(aviso, el.firstChild);
      setTimeout(() => aviso.remove(), 6000);
    }

    instancia(el) { return _montados.get(el) || null; }

    /**
     * Altura ocupada por barras fijas ancladas arriba de la ventana.
     *
     * Un widget con encabezado `position: sticky` no puede pegarse a `top: 0`:
     * ahí está el nav fijo (52 px, z-index 100) y el encabezado queda escondido
     * detrás. Pero el widget no debería saber nada del layout de la app — así
     * que lo mide el montador y lo pasa en el contexto.
     *
     * Detecta cualquier elemento `position: fixed` pegado al borde superior, así
     * que funciona igual si el nav cambia de alto, o si en móvil no existe y
     * solo hay barra inferior (devuelve 0).
     */
    offsetSuperior() {
      let max = 0;
      for (const el of document.body.children) {
        const s = getComputedStyle(el);
        if (s.position !== 'fixed' || s.display === 'none') continue;
        const r = el.getBoundingClientRect();
        // Anclado arriba (tolerancia de 2px) y con altura visible
        if (r.top <= 2 && r.height > 0 && r.bottom > max) max = r.bottom;
      }
      return Math.round(max);
    }

    // ── Densidad ──────────────────────────────────────────────────────────────

    _observar(inst) {
      if (typeof ResizeObserver === 'undefined') return;   // navegador viejo: queda fijo
      inst.observer = new ResizeObserver(entries => {
        for (const entry of entries) {
          const ancho = entry.contentRect.width;
          if (inst.timer) clearTimeout(inst.timer);
          inst.timer = setTimeout(() => this._evaluarDensidad(inst, ancho), _DEBOUNCE_MS);
        }
      });
      inst.observer.observe(inst.el);
    }

    /** Re-renderiza SOLO si la densidad cambió de nivel. */
    _evaluarDensidad(inst, ancho) {
      const nueva = Reg.densidadPara(inst.def.id, ancho);
      if (nueva === inst.densidad) return;
      this._render(inst, ancho);
    }

    // ── Render ────────────────────────────────────────────────────────────────

    _render(inst, anchoConocido) {
      const el = inst.el;
      const ancho = anchoConocido || el.clientWidth || window.innerWidth;
      const densidad = Reg.densidadPara(inst.def.id, ancho);

      if (!densidad) {
        el.innerHTML = this._sinEspacio(inst.def);
        return;
      }
      inst.densidad = densidad;

      const ctx = {
        densidad,
        contexto:   inst.contexto,
        ancho,
        // Los datos crudos, para los widgets que dibujan en mount() sobre un
        // canvas (ej. un gráfico LWC) en vez de en el HTML de render(): esos no
        // pueden leer los datos del string, los necesitan en el ctx de mount.
        datos:      inst.datos,
        // Los campos se resuelven acá, no en el widget: la decisión de qué
        // información sobrevive en cada tamaño está declarada en el backend.
        campos:     Reg.camposPara(inst.def.id, densidad,
                                   (inst.args || {}).orden),
        args:       inst.args,
        epistemico: inst.epistemico,
        // Por qué columnas se puede ordenar, según la declaración. El widget
        // no debería inventar su propia lista: el backend ya validó que estas
        // sean las que la capacidad admite.
        ordenables: inst.def.ordenable_por || [],
        // Altura ocupada por barras fijas arriba. Un widget con encabezado
        // sticky lo necesita: pegarse a top:0 lo esconde detrás del nav.
        offsetTop:  this.offsetSuperior(),
      };

      let html;
      try {
        html = inst.def.render(inst.datos, ctx) || '';
      } catch (e) {
        console.error('[widgets] error en render de', inst.def.id, e);
        this._pintarError(el, `error al dibujar: ${e.message}`);
        return;
      }

      // La declaración epistémica NO es opcional: un widget que muestra datos
      // derivados sin sus límites presenta inferencias como hechos.
      // Ver AXIOM_principios_fundacionales.md §3 y sistema_widgets §6.
      el.innerHTML = html + this._epistemicoHTML(inst.epistemico, densidad, inst.def.id);
      el.dataset.widget   = inst.def.id;
      el.dataset.densidad = densidad;

      this._bindEpistemico(el);

      if (typeof inst.def.mount === 'function') {
        try { inst.def.mount(el, ctx); } catch (e) {
          console.warn('[widgets] mount de', inst.def.id, e);
        }
      }
    }

    /**
     * Bloque epistémico según densidad:
     *   amplio   → nota visible al pie
     *   normal   → ícono que despliega
     *   compacto → ícono, siempre presente
     */
    _epistemicoHTML(epi, densidad, widgetId) {
      if (!epi) return '';
      const id = `epi-${widgetId}-${Math.random().toString(36).slice(2, 7)}`;

      const detalle = `
        <div id="${id}" style="display:none;margin-top:8px;padding:10px 12px;
             background:var(--c2,#1A1917);border:0.5px solid var(--w1,#2C2926);
             border-radius:6px;font-size:11px;line-height:1.55;color:var(--t3,#78716C);">
          ${epi.mide    ? `<div style="margin-bottom:6px;"><b style="color:var(--t2,#A8A29E);">Mide (hecho):</b> ${epi.mide}</div>` : ''}
          ${epi.infiere ? `<div style="margin-bottom:6px;"><b style="color:var(--t2,#A8A29E);">Infiere (lectura):</b> ${epi.infiere}</div>` : ''}
          ${epi.no_sabe ? `<div style="margin-bottom:6px;"><b style="color:var(--t2,#A8A29E);">No puede saber:</b> ${epi.no_sabe}</div>` : ''}
          ${epi.fuente  ? `<div style="opacity:.8;"><b>Fuente:</b> ${epi.fuente}</div>` : ''}
          ${epi.metodo  ? `<div style="opacity:.8;"><b>Método:</b> ${epi.metodo}</div>` : ''}
        </div>`;

      const boton = `
        <button data-epi-toggle="${id}"
          style="display:inline-flex;align-items:center;gap:5px;background:none;border:none;
                 padding:6px 0;color:var(--t3,#78716C);font-family:var(--f2,monospace);
                 font-size:10px;cursor:pointer;">
          <i class="ti ti-info-circle" style="font-size:12px;"></i>
          <span>qué mide y qué no</span>
        </button>`;

      if (densidad === 'amplio' && epi.no_sabe) {
        // En pantalla amplia el límite se muestra directo: es lo que evita leer
        // la tabla como una recomendación.
        return `
          <div style="margin-top:10px;padding-top:8px;border-top:0.5px solid var(--w1,#2C2926);">
            <div style="font-size:10px;color:var(--t3,#78716C);line-height:1.5;">
              <b style="color:var(--t2,#A8A29E);">Límites:</b> ${epi.no_sabe}
            </div>
            ${boton}${detalle}
          </div>`;
      }
      return `<div style="margin-top:6px;">${boton}${detalle}</div>`;
    }

    _bindEpistemico(el) {
      el.querySelectorAll('[data-epi-toggle]').forEach(b => {
        b.onclick = () => {
          const d = document.getElementById(b.dataset.epiToggle);
          if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
        };
      });
    }

    // ── Datos ─────────────────────────────────────────────────────────────────

    async _pedirDatos(capacidad, args) {
      const r = await fetch(`/api/capacidades/${capacidad}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {}),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`${r.status} ${t.slice(0, 120)}`);
      }
      return r.json();
    }

    // ── Estados ───────────────────────────────────────────────────────────────

    _pintarCargando(el) {
      el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--t3,#78716C);
        font-size:13px;">Cargando…</div>`;
    }

    _pintarError(el, msg) {
      el.innerHTML = `<div style="padding:20px;color:var(--re,#D93B3B);font-size:12px;">
        No se pudo mostrar: ${msg}</div>`;
    }

    _sinEspacio(def) {
      return `<div style="padding:16px;text-align:center;color:var(--t3,#78716C);font-size:12px;">
        <i class="ti ti-arrows-maximize" style="font-size:20px;opacity:.5;display:block;margin-bottom:6px;"></i>
        ${def.label} necesita más espacio del disponible.
      </div>`;
    }
  }

  NS.WidgetMount = new WidgetMount();
})();
