/**
 * AXIOM — Widgets / Registry
 * ────────────────────────────────────────────────────────────────────────────
 * Registro central de widgets. Cada widget es un objeto autocontenido que se
 * registra al cargarse su <script>. El core nunca se modifica para agregar uno
 * nuevo — mismo patrón que IndicatorRegistry, subido un nivel: del "indicador
 * dentro del gráfico" al "widget dentro de cualquier vista".
 *
 * Gemelo del REGISTRO DE CAPACIDADES del backend: aquel dice QUÉ SABE HACER
 * AXIOM, este dice CÓMO SE MUESTRA. Kepler los conecta.
 *
 * CONTRATO de un widget:
 * {
 *   id:      'tabla_pares',            // id único
 *   label:   'Screener de pares',      // nombre visible
 *   grupo:   'Mercado',                // agrupación en selectores
 *   icono:   'ti-arrows-exchange',     // opcional
 *
 *   capacidad:   'buscar_pares',       // qué capacidad del backend consume
 *   argsDefault: { quote: 'BTC' },     // args por defecto de esa capacidad
 *
 *   contextos: ['pantalla','panel','chat','dashboard'],
 *
 *   // Qué se muestra según el ancho del CONTENEDOR (no de la ventana).
 *   // `false` en un nivel = el widget no se muestra útilmente ahí.
 *   densidades: {
 *     compacto: { hasta: 480,  campos: ['par','precio','metrica_activa'] },
 *     normal:   { hasta: 900,  campos: [...] },
 *     amplio:   { hasta: null, campos: '*' },
 *   },
 *
 *   render(datos, ctx) -> string HTML     // ctx = {densidad,contexto,ancho,epistemico,args}
 *   mount(el, ctx)                        // opcional: engancha eventos tras insertar
 *   unmount(el)                           // opcional: limpieza
 * }
 *
 * Ver AXIOM_sistema_widgets.md
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS = (window.AXIOM = window.AXIOM || {});

  const NIVELES = ['compacto', 'normal', 'amplio'];
  const CONTEXTOS = ['pantalla', 'panel', 'chat', 'dashboard'];

  // Umbrales por defecto si el widget no declara densidades propias.
  const DENSIDADES_DEFAULT = {
    compacto: { hasta: 480,  campos: '*' },
    normal:   { hasta: 900,  campos: '*' },
    amplio:   { hasta: null, campos: '*' },
  };

  class WidgetRegistry {
    constructor() { this._map = {}; }

    /**
     * Registra un widget. Valida el contrato: un widget mal declarado avisa en
     * consola y NO se registra, en vez de fallar al montarse.
     */
    register(def) {
      const err = this._validar(def);
      if (err) { console.error('[widgets] contrato inválido:', err, def); return; }

      if (this._map[def.id]) {
        console.warn('[widgets] id duplicado, se reemplaza:', def.id);
      }

      // Defaults del contrato
      def.grupo      = def.grupo || 'Otros';
      def.contextos  = def.contextos || ['pantalla'];
      def.argsDefault = def.argsDefault || {};
      def.densidades = this._normalizarDensidades(def.densidades);

      this._map[def.id] = def;
      return def;
    }

    _validar(def) {
      if (!def || typeof def !== 'object') return 'no es un objeto';
      if (!def.id)    return 'falta `id`';
      if (!def.label) return `[${def.id}] falta \`label\``;
      if (typeof def.render !== 'function') return `[${def.id}] \`render\` debe ser función`;

      if (def.contextos) {
        const malos = def.contextos.filter(c => !CONTEXTOS.includes(c));
        if (malos.length) return `[${def.id}] contextos desconocidos: ${malos}`;
      }
      if (def.densidades) {
        const malos = Object.keys(def.densidades).filter(n => !NIVELES.includes(n));
        if (malos.length) return `[${def.id}] densidades desconocidas: ${malos}`;
      }
      return null;
    }

    /** Completa los niveles que el widget no declaró. */
    _normalizarDensidades(d) {
      const out = {};
      for (const nivel of NIVELES) {
        const declarado = d ? d[nivel] : undefined;
        if (declarado === false) { out[nivel] = false; continue; }   // no aplica
        out[nivel] = Object.assign({}, DENSIDADES_DEFAULT[nivel], declarado || {});
      }
      return out;
    }

    // ── Consulta ──────────────────────────────────────────────────────────────

    get(id)  { return this._map[id] || null; }
    has(id)  { return !!this._map[id]; }
    list()   { return Object.values(this._map); }

    /** Agrupados por categoría, para selectores: { grupo: [def, ...] } */
    grouped() {
      const out = {};
      for (const def of this.list()) (out[def.grupo] = out[def.grupo] || []).push(def);
      return out;
    }

    /** Widgets que pueden montarse en cierto contexto. */
    porContexto(contexto) {
      return this.list().filter(d => d.contextos.includes(contexto));
    }

    /**
     * Widgets que consumen cierta capacidad del backend. Es el mapeo que usa
     * Kepler: si ejecutó `buscar_pares`, los candidatos a montar son estos.
     */
    porCapacidad(capacidad) {
      return this.list().filter(d => d.capacidad === capacidad);
    }

    /**
     * Catálogo serializable — lo que se puede enviar al backend para que el
     * chat sepa qué widgets existen y cuál corresponde a cada capacidad.
     */
    catalogo() {
      return this.list().map(d => ({
        id: d.id,
        label: d.label,
        grupo: d.grupo,
        capacidad: d.capacidad || null,
        contextos: d.contextos,
        densidades: Object.keys(d.densidades).filter(n => d.densidades[n] !== false),
      }));
    }

    /**
     * Resuelve qué densidad corresponde a un ancho, para un widget dado.
     * Devuelve el nombre del nivel, o null si el widget no se muestra a ese ancho.
     *
     * Se mide el ancho del CONTENEDOR, no de la ventana: es lo que permite que
     * el mismo widget esté compacto en un panel de 300px y amplio en pantalla
     * completa, simultáneamente.
     */
    densidadPara(id, ancho) {
      const def = this.get(id);
      if (!def) return null;

      // 1) Qué nivel CORRESPONDE por ancho. Los umbrales se toman del widget
      //    si los declaró, o de los defaults si ese nivel está deshabilitado
      //    (un nivel en `false` sigue ocupando su franja de anchos).
      let nivel = null;
      for (const n of NIVELES) {
        const d = def.densidades[n];
        const hasta = (d === false) ? DENSIDADES_DEFAULT[n].hasta : d.hasta;
        if (hasta == null || ancho < hasta) { nivel = n; break; }
      }

      // 2) ¿El widget se muestra útilmente en ese nivel? Si declaró `false`,
      //    NO se sube al siguiente: se devuelve null y el montador pinta
      //    "necesita más espacio". Renderizar un widget en un espacio donde
      //    dijo que no funciona es peor que no mostrarlo.
      if (!nivel || def.densidades[nivel] === false) return null;
      return nivel;
    }

    /** Campos visibles de un widget en cierta densidad. '*' = todos. */
    camposPara(id, densidad) {
      const def = this.get(id);
      if (!def) return '*';
      const d = def.densidades[densidad];
      return (d && d.campos) || '*';
    }
  }

  NS.Widgets = new WidgetRegistry();
  NS.Widgets.NIVELES = NIVELES;
  NS.Widgets.CONTEXTOS = CONTEXTOS;
})();
