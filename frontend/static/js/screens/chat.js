/**
 * AXIOM v2 — Pantalla de Chat (prototipo v3)
 * ────────────────────────────────────────────────────────────────────────────
 * Mesa de análisis conversacional: se le pregunta a AXIOM en lenguaje natural
 * y Kepler responde consultando las capacidades del propio sistema (tool use).
 *
 * Prototipo: UI mínima para validar la experiencia, no la versión final.
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
    '¿Cómo viene ONT?',
    'Analizá ethereum',
    '¿Bitcoin está fuerte o débil?',
  ];

  const ChatScreen = {
    _historial: [],
    _enviando: false,

    onEnter() {
      this._render();
    },

    onLeave() {},

    _render() {
      const root = document.getElementById('screen-chat');
      if (!root) return;

      root.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;max-width:820px;margin:0 auto;padding:0 16px;">
          <div style="padding:16px 0 12px;border-bottom:0.5px solid ${C.border};">
            <div style="font-size:15px;font-weight:600;color:${C.text};">Kepler</div>
            <div style="font-size:11px;color:${C.muted};margin-top:2px;">
              Mesa de análisis · consulta el régimen y las coins del sistema
            </div>
          </div>

          <div id="chat-msgs" style="flex:1;overflow-y:auto;padding:16px 0;display:flex;flex-direction:column;gap:14px;"></div>

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

      div.innerHTML = `
        ${toolsHtml}
        <div style="max-width:88%;background:${esUser ? C.accent : C.surface};
                    border:${esUser ? 'none' : `0.5px solid ${C.border}`};
                    border-radius:10px;padding:10px 13px;color:${esUser ? '#fff' : C.text};
                    font-size:13px;line-height:1.55;white-space:pre-wrap;">${this._escapar(texto)}</div>`;
      cont.appendChild(div);
      cont.scrollTop = cont.scrollHeight;
      return div;
    },

    _escapar(s) {
      const d = document.createElement('div');
      d.textContent = s == null ? '' : String(s);
      return d.innerHTML;
    },

    async _enviar() {
      if (this._enviando) return;
      const input = document.getElementById('chat-input');
      const texto = (input.value || '').trim();
      if (!texto) return;

      input.value = '';
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
