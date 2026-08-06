/**
 * AXIOM v2 — Pantalla de Chat (prototipo v4)
 * ────────────────────────────────────────────────────────────────────────────
 * Mesa de análisis conversacional: se le pregunta a AXIOM en lenguaje natural
 * y Kepler responde consultando las capacidades del propio sistema (tool use).
 * Cuando existe un widget para la capacidad ejecutada, se monta con los datos
 * ya analizados (ver `_montarWidgets`).
 *
 * Cambios respecto de v3 (dos, y NINGUNO toca el montaje de widgets):
 *   1. MARKDOWN → HTML. El modelo responde en Markdown; antes se pintaba con
 *      `_escapar()` + `white-space:pre-wrap`, así que se veían los asteriscos
 *      crudos. Ahora hay un conversor propio (sin dependencias: el frontend no
 *      tiene build) que emite listas, tablas, títulos, código y citas.
 *   2. ALTURA. El shell arrancaba aplastado porque `height:100%` no resuelve
 *      sin un padre con altura. Se le da altura MÍNIMA al shell, sin darle
 *      scroll propio a `#chat-msgs`: la PÁGINA sigue siendo la que scrollea
 *      —de eso depende el `scrollIntoView` del montaje de widgets—.
 *
 * Seguridad: el texto se escapa SIEMPRE antes de aplicar Markdown. Las únicas
 * etiquetas que llegan al DOM son las que genera el conversor — nada de lo que
 * mande el modelo se interpreta como HTML.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS = (window.AXIOM = window.AXIOM || {});

  const C = {
    bg:      '#0F0E0D',
    surface: '#1A1917',
    border:  '#2C2926',
    text:    '#F5F0EB',
    muted:   '#78716C',
    accent:  '#2563EB',
    green:   '#56A14F',
  };

  const SUGERENCIAS = [
    '¿Cómo está el mercado hoy?',
    'Pares /BTC que oscilen con spread bajo',
    '¿Qué sectores están fuertes?',
    '¿Cómo viene ONT?',
  ];

  /* ══════════════════════════════════════════════════════════════════════════
     MD — conversor de Markdown a HTML
     ──────────────────────────────────────────────────────────────────────────
     Markdown acotado y controlado: solo lo que el modelo realmente emite.
     Sin librería externa, para no meterle dependencias a un frontend sin build.
     Soporta: títulos, negrita, itálica, tachado, código en línea y en bloque,
     listas (anidadas, ordenadas y no), tablas con alineación, citas, reglas
     horizontales y enlaces. Escapa SIEMPRE antes de aplicar formato.
     ══════════════════════════════════════════════════════════════════════════ */
  const MD = (function () {

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function inline(txt) {
      // El código en línea se aparta ANTES de escapar, para que ningún otro
      // reemplazo lo toque (un `a*b*c` no debe volverse itálica).
      const codigos = [];
      let s = String(txt == null ? '' : txt).replace(/`([^`]+)`/g, (m, c) => {
        codigos.push(c);
        return '\u0000' + (codigos.length - 1) + '\u0000';
      });

      s = esc(s);

      s = s.replace(/\[([^\]\n]+)\]\(\s*(https?:\/\/[^\s)]+)\s*\)/g,
                    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
      s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
      // El contenido no puede empezar ni terminar con espacio: así "3 * 4 * 5"
      // sigue siendo multiplicación y no una itálica.
      s = s.replace(/(^|[^*\w])\*(?!\s)([^*\n]*[^*\s])\*(?!\w)/g, '$1<em>$2</em>');
      s = s.replace(/(^|[^_\w])_(?!\s)([^_\n]*[^_\s])_(?!\w)/g, '$1<em>$2</em>');
      s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

      return s.replace(/\u0000(\d+)\u0000/g, (m, n) => '<code>' + esc(codigos[+n]) + '</code>');
    }

    const RX_FENCE  = /^\s*```/;
    const RX_TITULO = /^\s{0,3}(#{1,6})\s+(.+)$/;
    const RX_REGLA  = /^\s{0,3}(-{3,}|_{3,}|\*{3,})\s*$/;
    const RX_ITEM   = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    const RX_CITA   = /^\s*>\s?/;

    function esTabla(lineas, i) {
      const cab = lineas[i], sep = lineas[i + 1];
      if (!cab || !sep) return false;
      if (cab.indexOf('|') === -1 || sep.indexOf('|') === -1) return false;
      return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(sep);
    }

    function esInicioDeBloque(l) {
      return RX_FENCE.test(l) || RX_TITULO.test(l) || RX_REGLA.test(l)
          || RX_ITEM.test(l)  || RX_CITA.test(l);
    }

    function celdas(fila) {
      return fila.trim().replace(/^\|/, '').replace(/\|$/, '')
                 .split('|').map((c) => c.trim());
    }

    function lista(lineas, i) {
      const primero  = lineas[i].match(RX_ITEM);
      const sangria  = primero[1].length;
      const ordenada = /\d/.test(primero[2]);
      const items    = [];

      while (i < lineas.length) {
        const l = lineas[i];

        if (!l.trim()) {
          let j = i + 1;
          while (j < lineas.length && !lineas[j].trim()) j++;
          const sig = j < lineas.length ? lineas[j].match(RX_ITEM) : null;
          if (sig && sig[1].length >= sangria) { i = j; continue; }
          break;
        }

        const m = l.match(RX_ITEM);
        if (!m) {
          if (items.length && l.search(/\S/) > sangria) {
            items[items.length - 1].sub.push(l);
            i++; continue;
          }
          break;
        }
        if (m[1].length < sangria) break;
        if (m[1].length > sangria) {
          if (!items.length) break;
          items[items.length - 1].sub.push(l);
          i++; continue;
        }
        if (/\d/.test(m[2]) !== ordenada) break;

        items.push({ texto: m[3], sub: [] });
        i++;
      }

      const cuerpo = items.map((it) => {
        let dentro = inline(it.texto);
        if (it.sub.length) {
          const conTexto = it.sub.filter((l) => l.trim());
          const min = conTexto.length ? Math.min.apply(null, conTexto.map((l) => l.search(/\S/))) : 0;
          dentro += bloques(it.sub.map((l) => l.slice(min)));
        }
        return '<li>' + dentro + '</li>';
      }).join('');

      const tag = ordenada ? 'ol' : 'ul';
      return { html: '<' + tag + '>' + cuerpo + '</' + tag + '>', i: i };
    }

    function bloques(lineas) {
      const out = [];
      let i = 0;

      while (i < lineas.length) {
        const linea = lineas[i];
        if (!linea.trim()) { i++; continue; }

        if (RX_FENCE.test(linea)) {
          const buf = [];
          i++;
          while (i < lineas.length && !RX_FENCE.test(lineas[i])) { buf.push(lineas[i]); i++; }
          i++;
          out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
          continue;
        }

        if (RX_REGLA.test(linea)) { out.push('<hr>'); i++; continue; }

        const t = linea.match(RX_TITULO);
        if (t) {
          const n = Math.min(t[1].length + 2, 6);   // ## del modelo → h4 acá
          out.push('<h' + n + '>' + inline(t[2].trim()) + '</h' + n + '>');
          i++; continue;
        }

        if (esTabla(lineas, i)) {
          const cab = celdas(lineas[i]);
          const ali = celdas(lineas[i + 1]).map((s) =>
            /^:.*:$/.test(s) ? 'center' : /:$/.test(s) ? 'right' : 'left');
          i += 2;
          const filas = [];
          while (i < lineas.length && lineas[i].trim() && lineas[i].indexOf('|') !== -1) {
            filas.push(celdas(lineas[i])); i++;
          }
          const th = cab.map((c, k) =>
            '<th style="text-align:' + (ali[k] || 'left') + '">' + inline(c) + '</th>').join('');
          const tb = filas.map((f) =>
            '<tr>' + cab.map((_, k) =>
              '<td style="text-align:' + (ali[k] || 'left') + '">' + inline(f[k] || '') + '</td>'
            ).join('') + '</tr>').join('');
          out.push('<table><thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table>');
          continue;
        }

        if (RX_CITA.test(linea)) {
          const buf = [];
          while (i < lineas.length && RX_CITA.test(lineas[i])) {
            buf.push(lineas[i].replace(RX_CITA, '')); i++;
          }
          out.push('<blockquote>' + bloques(buf) + '</blockquote>');
          continue;
        }

        if (RX_ITEM.test(linea)) {
          const r = lista(lineas, i);
          out.push(r.html);
          i = r.i;
          continue;
        }

        const buf = [];
        while (i < lineas.length && lineas[i].trim()
               && !esInicioDeBloque(lineas[i]) && !esTabla(lineas, i)) {
          buf.push(lineas[i].trim()); i++;
        }
        out.push('<p>' + buf.map(inline).join('<br>') + '</p>');
      }

      return out.join('');
    }

    function render(texto) {
      const src = String(texto == null ? '' : texto)
        .replace(/\r\n?/g, '\n')
        .replace(/\t/g, '    ');
      return bloques(src.split('\n'));
    }

    return { render: render, esc: esc };
  })();

  /* ══════════════════════════════════════════════════════════════════════════
     Estilos — altura del shell + tipografía de los mensajes de Kepler
     ──────────────────────────────────────────────────────────────────────────
     Van acá (no en layout.css) para que la pantalla sea autocontenida.
     La PÁGINA scrollea, no `#chat-msgs`: de eso depende el scrollIntoView del
     montaje de widgets. Por eso el shell recibe min-height, no height fija.
     ══════════════════════════════════════════════════════════════════════════ */
  const CSS = `
#screen-chat.active{display:block;}
.chat-shell{
  display:flex;flex-direction:column;
  min-height:calc(100vh - var(--nav-h) - 48px);
}
@media(max-width:640px){
  .chat-shell{min-height:calc(100vh - var(--nav-h) - var(--bot-h) - 32px);}
}
#chat-msgs{flex:1;}

.kmsg{font-size:13px;line-height:1.6;color:${C.text};}
.kmsg > :first-child{margin-top:0;}
.kmsg > :last-child{margin-bottom:0;}
.kmsg p{margin:0 0 9px;}
.kmsg h4,.kmsg h5,.kmsg h6{
  margin:14px 0 7px;font-weight:600;color:${C.text};letter-spacing:-.01em;
}
.kmsg h4{font-size:14px;}
.kmsg h5{font-size:13px;}
.kmsg h6{font-size:12px;color:${C.muted};text-transform:uppercase;letter-spacing:.06em;}
.kmsg ul,.kmsg ol{margin:6px 0 10px;padding-left:19px;}
.kmsg li{margin:3px 0;}
.kmsg li > ul,.kmsg li > ol{margin:3px 0 2px;}
.kmsg ul{list-style:disc;}
.kmsg ul ul{list-style:circle;}
.kmsg ol{list-style:decimal;}
.kmsg strong{font-weight:600;color:#FFFDFA;}
.kmsg em{font-style:italic;color:#E7DFD6;}
.kmsg a{color:#6E9BF5;text-decoration:none;border-bottom:0.5px solid rgba(110,155,245,.4);}
.kmsg a:hover{border-bottom-color:#6E9BF5;}
.kmsg hr{border:none;border-top:0.5px solid ${C.border};margin:13px 0;}
.kmsg blockquote{
  margin:9px 0;padding:2px 0 2px 11px;
  border-left:2px solid ${C.border};color:${C.muted};
}
.kmsg code{
  font-family:var(--f2, 'IBM Plex Mono', monospace);
  font-size:12px;background:#241F1C;border-radius:4px;padding:1px 5px;color:#E9C89A;
}
.kmsg pre{
  background:${C.bg};border:0.5px solid ${C.border};border-radius:8px;
  padding:10px 12px;margin:10px 0;overflow-x:auto;
}
.kmsg pre code{background:none;padding:0;color:${C.text};font-size:12px;line-height:1.5;}
.kmsg .tabla-wrap{overflow-x:auto;margin:10px 0;}
.kmsg table{
  border-collapse:collapse;width:100%;
  font-family:var(--f2, 'IBM Plex Mono', monospace);font-size:11.5px;
}
.kmsg th,.kmsg td{border:0.5px solid ${C.border};padding:6px 9px;}
.kmsg th{background:#211E1C;font-weight:600;color:${C.text};white-space:nowrap;}
.kmsg td{color:#DED6CD;}
.kmsg tbody tr:nth-child(even){background:rgba(255,255,255,.018);}

.umsg{font-size:13px;line-height:1.55;color:#fff;white-space:pre-wrap;}
.chat-sug:hover{border-color:${C.muted};color:${C.text};}
`;

  function inyectarCSS() {
    if (document.getElementById('axiom-chat-css')) return;
    const st = document.createElement('style');
    st.id = 'axiom-chat-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const ChatScreen = {
    _historial: [],
    _enviando: false,
    _widgets: [],          // contenedores de widgets montados, para desmontar

    onEnter() {
      inyectarCSS();
      this._render();
    },

    onLeave() {
      // Cada widget montado tiene un ResizeObserver activo: si no se desmonta,
      // sigue vivo en una pantalla que ya no se ve.
      this._desmontarWidgets();
    },

    _desmontarWidgets() {
      if (!NS.WidgetMount) return;
      this._widgets.forEach(el => { try { NS.WidgetMount.unmount(el); } catch (e) {} });
      this._widgets = [];
    },

    _render() {
      const root = document.getElementById('screen-chat');
      if (!root) return;
      this._desmontarWidgets();

      root.innerHTML = `
        <div class="chat-shell" style="max-width:860px;margin:0 auto;padding:0 16px;">
          <div style="padding:14px 0 12px;border-bottom:0.5px solid ${C.border};">
            <div style="font-size:15px;font-weight:600;color:${C.text};">Kepler</div>
            <div style="font-size:11px;color:${C.muted};margin-top:2px;">
              Mesa de análisis · consulta el régimen y las coins del sistema
            </div>
          </div>

          <div id="chat-msgs" style="padding:16px 0;display:flex;flex-direction:column;gap:16px;"></div>

          <div id="chat-sugerencias" style="display:flex;flex-wrap:wrap;gap:6px;padding-bottom:10px;"></div>

          <div style="display:flex;gap:8px;padding-bottom:16px;">
            <input id="chat-input" type="text" placeholder="Preguntale algo a AXIOM…"
              style="flex:1;background:${C.surface};border:0.5px solid ${C.border};border-radius:8px;
                     padding:11px 14px;color:${C.text};font-size:13px;font-family:inherit;outline:none;">
            <button id="chat-send"
              style="background:${C.accent};border:none;border-radius:8px;padding:0 18px;
                     color:#fff;font-size:13px;cursor:pointer;font-weight:500;">Enviar</button>
          </div>
        </div>`;

      this._renderSugerencias();
      this._bind();

      if (!this._historial.length) {
        this._pintarMensaje('assistant',
          'Hola Migue. Puedo consultar el régimen de mercado y analizar cómo se sitúa cualquier coin. ¿Qué querés saber?');
      }
    },

    _renderSugerencias() {
      const cont = document.getElementById('chat-sugerencias');
      if (!cont) return;
      cont.innerHTML = SUGERENCIAS.map((s) =>
        `<button class="chat-sug" data-q="${s.replace(/"/g, '&quot;')}"
           style="background:transparent;border:0.5px solid ${C.border};border-radius:14px;
                  padding:5px 11px;color:${C.muted};font-size:11px;cursor:pointer;">${s}</button>`
      ).join('');
      cont.querySelectorAll('.chat-sug').forEach((b) => {
        b.onclick = () => {
          document.getElementById('chat-input').value = b.dataset.q;
          this._enviar();
        };
      });
    },

    _bind() {
      const input = document.getElementById('chat-input');
      const send  = document.getElementById('chat-send');
      if (send)  send.onclick = () => this._enviar();
      if (input) input.onkeydown = (e) => { if (e.key === 'Enter') this._enviar(); };
    },

    _pintarMensaje(role, texto, tools) {
      const cont = document.getElementById('chat-msgs');
      if (!cont) return null;
      const esUser = role === 'user';
      const div = document.createElement('div');
      div.style.cssText = `display:flex;flex-direction:column;align-items:${esUser ? 'flex-end' : 'flex-start'};`;

      let toolsHtml = '';
      if (tools && tools.length) {
        toolsHtml = `<div style="font-size:10px;color:${C.green};margin-bottom:5px;display:flex;gap:6px;flex-wrap:wrap;">
          ${tools.map((t) => `<span style="border:0.5px solid ${C.border};border-radius:10px;padding:2px 7px;">⚙ ${t.tool}</span>`).join('')}
        </div>`;
      }

      // El usuario escribe texto plano; Kepler responde en Markdown.
      const cuerpo = esUser
        ? `<div class="umsg">${MD.esc(texto)}</div>`
        : `<div class="kmsg">${MD.render(texto)}</div>`;

      div.innerHTML = `
        ${toolsHtml}
        <div style="max-width:${esUser ? '88%' : '100%'};width:${esUser ? 'auto' : '100%'};
                    background:${esUser ? C.accent : C.surface};
                    border:${esUser ? 'none' : `0.5px solid ${C.border}`};
                    border-radius:10px;padding:11px 14px;">${cuerpo}</div>`;

      // Las tablas anchas hacen scroll propio en vez de estirar la burbuja.
      div.querySelectorAll('table').forEach((tb) => {
        const wrap = document.createElement('div');
        wrap.className = 'tabla-wrap';
        tb.parentNode.insertBefore(wrap, tb);
        wrap.appendChild(tb);
      });

      cont.appendChild(div);
      cont.scrollTop = cont.scrollHeight;
      return div;
    },

    /**
     * Monta widgets para las capacidades que Kepler ejecutó.
     *
     * El backend NO decide qué widget usar — no conoce el catálogo del
     * frontend. Solo informa qué capacidad corrió, con qué argumentos y qué
     * devolvió. Acá se busca si hay un widget que declare esa capacidad y el
     * contexto 'chat'; si no lo hay, queda solo el texto.
     *
     * Los datos son los que el modelo YA analizó: si el widget los pidiera de
     * nuevo podría recibir otros (los tickers se refrescan cada 15 min) y el
     * texto diría una cosa mientras la tabla muestra otra.
     */
    async _montarWidgets(tools) {
      if (!tools || !tools.length || !NS.Widgets || !NS.WidgetMount) return;
      const cont = document.getElementById('chat-msgs');
      if (!cont) return;

      // Las declaraciones de widgets viven en el backend y se cargan async.
      // Si se entra directo al chat sin pasar por otra pantalla que ya las
      // haya pedido, el catálogo está vacío y no habría candidatos: parecería
      // que el widget no existe cuando en realidad todavía no llegó.
      if (!NS.Widgets.listo) await NS.Widgets.cargar();

      // Kepler puede llamar varias veces a la misma capacidad refinando la
      // búsqueda (primero sin filtro de spread, después con). Las llamadas
      // intermedias son pasos de su razonamiento, no resultados: se monta solo
      // la última de cada capacidad.
      const ultimas = new Map();
      for (const t of tools) if (t.resultado) ultimas.set(t.tool, t);

      // El selector de par (resolver_par) solo tiene sentido cuando Kepler se
      // DETUVO a preguntar. Si en la misma respuesta también pidió datos de un
      // par (velas/libro/precio), ya eligió: mostrar el selector además sería
      // ofrecer una decisión que Kepler ya tomó. Se lo quita del montaje.
      const PIDIO_DATOS_PAR = ['velas_par', 'libro_par', 'precio_par'];
      if (ultimas.has('resolver_par') &&
          PIDIO_DATOS_PAR.some(cap => ultimas.has(cap))) {
        ultimas.delete('resolver_par');
      }

      let ultimoBloque = null;
      for (const t of ultimas.values()) {
        const def = NS.Widgets.porCapacidad(t.tool)
                              .find(w => w.contextos.includes('chat'));
        if (!def) continue;      // sin widget para esta capacidad: solo texto

        const bloque = document.createElement('div');
        bloque.style.cssText = 'width:100%;margin-top:2px;';
        bloque.innerHTML = `
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;
                      font-family:var(--f2,monospace);font-size:10px;
                      text-transform:uppercase;letter-spacing:.1em;color:${C.muted};">
            ${def.icono ? `<i class="ti ${def.icono}" style="font-size:12px;"></i>` : ''}
            <span>${def.label}</span>
          </div>
          <div data-widget-host
               style="background:${C.surface};border:0.5px solid ${C.border};
                      border-radius:10px;overflow:hidden;"></div>`;
        cont.appendChild(bloque);

        const host = bloque.querySelector('[data-widget-host]');
        // Se ESPERA el montaje: si no, el scroll de abajo corre antes de que
        // la tabla ocupe su alto y el widget queda fuera de vista — parecía
        // que no se montaba, y en realidad estaba abajo del scroll.
        await NS.WidgetMount.mount(host, def.id, {
          datos:      t.resultado,
          args:       t.input || {},
          contexto:   'chat',
          epistemico: t.epistemico,
        });
        this._widgets.push(host);
        ultimoBloque = bloque;

        // El selector de par (resolver_par sin par en watchlist) devuelve la
        // elección hacia Kepler: se arma un mensaje con el par concreto y se
        // envía como si Migue lo hubiera tecleado. Kepler, con el historial,
        // recuerda qué estaba haciendo (velas/libro) y lo pide ya con exchange
        // y quote. El widget NO pide datos por su cuenta: solo devuelve la
        // elección a la conversación.
        if (def.id === 'selector_par') {
          this._engancharSeleccionPar(host);
        }
      }

      // `#chat-msgs` no tiene scroll propio: crece y scrollea la PÁGINA. Por
      // eso mover su scrollTop no hacía nada y la tabla quedaba fuera de vista.
      if (ultimoBloque) {
        ultimoBloque.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    },

    /**
     * Cierra el lazo del selector de par: la elección del usuario vuelve a
     * Kepler como un mensaje. No se pide el dato acá —eso rompería el modelo
     * conversacional—: Kepler recibe el par concreto y orquesta.
     */
    _engancharSeleccionPar(host) {
      if (host._selparBound) return;
      host._selparBound = true;
      host.addEventListener('axiom:par-elegido', (ev) => {
        const d = ev.detail || {};
        const base  = (d.base || '').toUpperCase();
        const quote = (d.quote || '').toUpperCase();
        const ex    = (d.exchange || '').toUpperCase();
        if (!base || !quote || !ex) return;
        // Mensaje genérico: Kepler sabe por el historial si era velas/libro.
        this._enviar(`Usá el par ${base}/${quote} en ${ex}.`);
      });
    },

    _escapar(s) {
      const d = document.createElement('div');
      d.textContent = s == null ? '' : String(s);
      return d.innerHTML;
    },

    async _enviar(textoDirecto) {
      if (this._enviando) return;
      const input = document.getElementById('chat-input');
      // Si viene texto directo (ej. del selector de par), se usa ese; si no, el
      // del input. Así el mismo método sirve para lo que teclea Migue y para la
      // elección de un widget.
      const texto = (textoDirecto != null ? textoDirecto : (input.value || '')).trim();
      if (!texto) return;

      if (textoDirecto == null) input.value = '';
      this._enviando = true;
      this._pintarMensaje('user', texto);

      const pensando = this._pintarMensaje('assistant', 'Consultando el sistema…');

      try {
        const r = await fetch('/api/chat/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mensaje: texto, historial: this._historial }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();

        if (pensando) pensando.remove();
        this._pintarMensaje('assistant', data.respuesta || '(sin respuesta)', data.tools_usadas);
        await this._montarWidgets(data.tools_usadas);
        this._historial = data.historial || this._historial;
      } catch (e) {
        if (pensando) pensando.remove();
        this._pintarMensaje('assistant', `Error: ${e.message}`);
      } finally {
        this._enviando = false;
      }
    },
  };

  NS.Screens = NS.Screens || {};
  NS.Screens.chat = ChatScreen;
  window.ChatScreen = ChatScreen;
})();
