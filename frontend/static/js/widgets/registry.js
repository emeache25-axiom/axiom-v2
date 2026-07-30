/**
 * AXIOM — Widgets / Registry
 * ────────────────────────────────────────────────────────────────────────────
 * Registro de widgets del frontend. Ya NO contiene la declaración: esa vive en
 * el backend (`backend/domain/widgets.py`) y se carga por HTTP.
 *
 * POR QUÉ ESTÁ PARTIDO ASÍ:
 *   · La DECLARACIÓN (qué capacidad consume, qué campos por densidad) son datos
 *     y son decisiones de producto. Deberían ser las mismas en la web y en
 *     cualquier otro cliente — si mañana hay una app en Flutter, lee el mismo
 *     catálogo y solo escribe cómo dibuja.
 *   · El RENDER es lo único intrínsecamente específico de la plataforma.
 *
 * Cada archivo de widget aporta solo su render:
 *     AXIOM.Widgets.render('tabla_pares', { render, mount, unmount });
 *
 * Ver AXIOM_sistema_widgets.md
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS = (window.AXIOM = window.AXIOM || {});

  const NIVELES = ['compacto', 'normal', 'amplio'];

  class WidgetRegistry {
    constructor() {
      this._decl = {};        // id → declaración (del backend)
      this._impl = {};        // id → { render, mount, unmount }
      this._cargando = null;  // promesa en curso, para no pedir dos veces
      this.listo = false;
    }

    // ── Declaraciones (backend) ───────────────────────────────────────────────

    /**
     * Trae el catálogo del backend. Idempotente: llamadas simultáneas comparten
     * la misma promesa.
     */
    async cargar() {
      if (this.listo) return this._decl;
      if (this._cargando) return this._cargando;

      this._cargando = (async () => {
        try {
          const r = await fetch('/api/capacidades/_/widgets');
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          for (const w of data.widgets || []) this._decl[w.id] = w;
          this.listo = true;
          const sinImpl = Object.keys(this._decl).filter(id => !this._impl[id]);
          if (sinImpl.length) {
            console.warn('[widgets] declarados sin render en el frontend:', sinImpl);
          }
          return this._decl;
        } catch (e) {
          console.error('[widgets] no se pudo cargar el catálogo:', e.message);
          this.listo = true;      // no reintentar en bucle
          return this._decl;
        } finally {
          this._cargando = null;
        }
      })();
      return this._cargando;
    }

    // ── Implementaciones (frontend) ───────────────────────────────────────────

    /**
     * Registra el render de un widget. Se llama al cargar su <script>, antes
     * de que exista el catálogo: las dos mitades se juntan en `get()`.
     */
    render(id, impl) {
      if (!id || !impl || typeof impl.render !== 'function') {
        console.error('[widgets] render inválido para', id);
        return;
      }
      this._impl[id] = impl;
    }

    // ── Consulta ──────────────────────────────────────────────────────────────

    /** Declaración + implementación fusionadas. null si falta alguna mitad. */
    get(id) {
      const d = this._decl[id];
      const i = this._impl[id];
      if (!d) return null;
      if (!i) {
        console.warn(`[widgets] '${id}' está declarado pero no tiene render`);
        return null;
      }
      return Object.assign({}, d, i);
    }

    has(id) { return !!(this._decl[id] && this._impl[id]); }

    list() {
      return Object.keys(this._decl)
        .filter(id => this._impl[id])
        .map(id => this.get(id));
    }

    grouped() {
      const out = {};
      for (const w of this.list()) (out[w.grupo] = out[w.grupo] || []).push(w);
      return out;
    }

    porContexto(contexto) {
      return this.list().filter(w => (w.contextos || []).includes(contexto));
    }

    /**
     * Widgets que consumen cierta capacidad. Es el mapeo que usa el chat: si
     * Kepler ejecutó `buscar_pares`, los candidatos a montar son estos.
     */
    porCapacidad(capacidad) {
      return this.list().filter(w => w.capacidad === capacidad);
    }

    // ── Densidad ──────────────────────────────────────────────────────────────

    /**
     * Nivel de densidad que corresponde a un ancho, o null si el widget no se
     * muestra útilmente ahí.
     *
     * Se mide el ancho del CONTENEDOR, no de la ventana: es lo que permite el
     * mismo widget compacto en un panel de 300px y amplio en pantalla completa,
     * al mismo tiempo.
     */
    densidadPara(id, ancho) {
      const d = this._decl[id];
      if (!d || !d.densidades) return null;

      // 1) Qué nivel corresponde por ancho
      let nivel = null;
      for (const n of NIVELES) {
        const dd = d.densidades[n];
        if (!dd) continue;
        if (dd.hasta == null || ancho < dd.hasta) { nivel = n; break; }
      }
      // 2) ¿Está disponible ahí? Si no, NO se sube al siguiente: se devuelve
      //    null y el montador avisa que falta espacio. Renderizar un widget
      //    donde declaró que no funciona es peor que no mostrarlo.
      if (!nivel) return null;
      return d.densidades[nivel].disponible === false ? null : nivel;
    }

    /**
     * Campos visibles en cierta densidad, resolviendo los slots de métrica.
     *
     * La CANTIDAD es constante: lo que cambia es qué métrica ocupa cada slot.
     * Si variara, la tabla saltaría de ancho en cada clic de ordenamiento.
     */
    camposPara(id, densidad, ordenActual) {
      const d = this._decl[id];
      if (!d) return [];
      const dd = (d.densidades || {})[densidad];
      if (!dd) return [];

      if (dd.campos) return dd.campos.slice();      // lista fija

      const fijas = (dd.fijas || []).slice();
      const slots = dd.slots_metrica || 0;
      if (!slots) return fijas;

      const metricas = d.metricas || [];
      const pref     = d.metricas_pref || metricas;

      // 1) QUÉ métricas se muestran. La que se está ordenando siempre entra:
      //    en pantalla chica, ver la que estás ordenando es lo único que hace
      //    usable la tabla.
      const elegidas = new Set();
      if (ordenActual && metricas.includes(ordenActual) && !fijas.includes(ordenActual)) {
        elegidas.add(ordenActual);
      }
      for (const m of pref) {
        if (elegidas.size >= slots) break;
        if (!elegidas.has(m) && !fijas.includes(m)) elegidas.add(m);
      }

      // 2) EN QUÉ POSICIÓN. Siempre en el orden de preferencia, sin importar
      //    cuál se ordena: si la métrica ordenada se adelantara, las columnas
      //    intercambiarían lugar en cada clic y la tabla bailaría.
      //    Cambia QUÉ se muestra, no DÓNDE.
      const ordenadas = pref.filter(m => elegidas.has(m));
      for (const m of elegidas) {
        if (!ordenadas.includes(m)) ordenadas.push(m);   // fuera de pref, al final
      }

      return fijas.concat(ordenadas.slice(0, slots));
    }
  }

  NS.Widgets = new WidgetRegistry();
  NS.Widgets.NIVELES = NIVELES;
})();
