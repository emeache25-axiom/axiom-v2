/**
 * AXIOM v2 — Charts / Drawings / Manager
 * ────────────────────────────────────────────────────────────────────────────
 * Orquesta la interacción de dibujo con fidelidad estilo TradingView:
 *   - Estados: IDLE · CREATING · DRAGGING_HANDLE · DRAGGING_BODY
 *   - Eventos capturados (capture:true) para interceptar antes que el pan de LWC
 *   - Hover highlight, selección, arrastre de vértices y de cuerpo entero
 *   - Persistencia en DB (por coin)
 *
 * Conversión de coordenadas: SIEMPRE via Coords (núcleo). Cero extrapolación
 * local duplicada.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS     = window.AXIOM.Charts;
  const Store  = NS.Store;
  const Engine = NS.Engine;
  const Coords = NS.Coords;
  const Reg    = NS.Drawings;

  const STATE = { IDLE: 0, CREATING: 1, DRAG_HANDLE: 2, DRAG_BODY: 3 };

  class DrawingManager {
    constructor() {
      this._primitive = null;
      this._drawings  = [];
      this._coinId    = null;
      this._state     = STATE.IDLE;

      this._creating  = null;   // { type, points:[], preview }
      this._drag      = null;   // { id, handleIdx, startTime, startPrice, orig }
      this._selectedId = null;
      this._hoverId    = null;

      this._evTarget  = null;
      this._handlers  = {};
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────────
    init() {
      // Crear primitive y attachar a la serie
      this._primitive = new NS.DrawingsPrimitive();
      Engine.series.attachPrimitive(this._primitive);

      // Eventos de mouse con capture para ganarle al pan de LWC
      const target = document.getElementById('chart-container');
      this._evTarget = target;
      this._handlers.down = (e) => this._onDown(e);
      this._handlers.move = (e) => this._onMove(e);
      this._handlers.up   = (e) => this._onUp(e);
      this._handlers.dbl  = (e) => this._onDblClick(e);
      this._handlers.ctx  = (e) => this._onContextMenu(e);
      target.addEventListener('mousedown',   this._handlers.down, true);
      target.addEventListener('mousemove',   this._handlers.move, true);
      target.addEventListener('mouseup',     this._handlers.up,   true);
      target.addEventListener('dblclick',    this._handlers.dbl,  true);
      target.addEventListener('contextmenu', this._handlers.ctx,  true);

      // Teclado: Escape cancela, Delete/Backspace borra selección
      this._handlers.key = (e) => {
        if (e.key === 'Escape') this.cancelTool();
        if ((e.key === 'Delete' || e.key === 'Backspace') && this._selectedId) {
          this.deleteDrawing(this._selectedId);
        }
      };
      document.addEventListener('keydown', this._handlers.key);

      // Reaccionar a cambio de herramienta desde el Store (toolbar)
      Store.on('tool:selected', ({ toolId }) => this._onToolChange(toolId));
    }

    destroy() {
      if (this._primitive && Engine.series) {
        try { Engine.series.detachPrimitive(this._primitive); } catch (e) {}
      }
      const t = this._evTarget;
      if (t) {
        t.removeEventListener('mousedown',   this._handlers.down, true);
        t.removeEventListener('mousemove',   this._handlers.move, true);
        t.removeEventListener('mouseup',     this._handlers.up,   true);
        t.removeEventListener('dblclick',    this._handlers.dbl,  true);
        t.removeEventListener('contextmenu', this._handlers.ctx,  true);
      }
      document.removeEventListener('keydown', this._handlers.key);
      this._primitive = null;
      this._drawings  = [];
    }

    // ── Carga desde DB ───────────────────────────────────────────────────────────
    async loadFromDB(coinId) {
      this._coinId = coinId;
      this._drawings = [];
      this._selectedId = null;
      try {
        const data = await NS.API.getChartDrawings(coinId);
        for (const row of (data.drawings || [])) {
          const def = Reg.get(row.type);
          if (!def) continue;
          const points = typeof row.points === 'string' ? JSON.parse(row.points) : row.points;
          const style  = typeof row.style  === 'string' ? JSON.parse(row.style)  : row.style;
          this._drawings.push({
            id: row.id, type: row.type, points,
            style: Object.assign({}, def.defaults, style || {}),
            zIndex: row.z_index || 0, locked: !!row.locked,
          });
        }
      } catch (e) { console.warn('[drawings] loadFromDB', e); }
      this._primitive.setDrawings(this._drawings);
      Store.setDrawings(this._drawings);
    }

    // ── Herramienta activa ────────────────────────────────────────────────────────
    _onToolChange(toolId) {
      this._creating = null;
      this._state = STATE.IDLE;
      this._primitive.setPreview(null);
      if (this._evTarget) this._evTarget.style.cursor = toolId ? 'crosshair' : 'default';
    }

    cancelTool() {
      this._creating = null;
      this._state = STATE.IDLE;
      this._primitive.setPreview(null);
      Store.setActiveTool(null);
    }

    // ── Conversión de evento → coord lógica ───────────────────────────────────────
    _coordFromEvent(e) {
      const rect = this._evTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const logical = Coords.fromPixel(x, y);
      return logical ? { x, y, time: logical.time, price: logical.price } : null;
    }

    // ── Hit test sobre todos los dibujos ──────────────────────────────────────────
    _hitTest(mx, my) {
      // De arriba hacia abajo (mayor zIndex primero)
      const list = this._drawings.slice().sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
      for (const d of list) {
        if (d.locked) continue;
        const def = Reg.get(d.type);
        if (!def) continue;
        const px = d.points.map((p) => Coords.toPixel(p.time, p.price)).filter(Boolean);
        if (px.length < d.points.length) continue;
        const hit = def.hitTest(mx, my, px, d.style);
        if (hit) return { drawing: d, hit };
      }
      return null;
    }

    // ── Mouse handlers ─────────────────────────────────────────────────────────────
    _onDown(e) {
      if (e.button !== 0) return;
      const c = this._coordFromEvent(e);
      if (!c) return;
      const tool = Store.activeTool;

      // Modo creación
      if (tool) {
        e.stopPropagation(); e.preventDefault();
        this._handleCreateClick(tool, c);
        return;
      }

      // Modo edición: ¿toca algo?
      const found = this._hitTest(c.x, c.y);
      if (found) {
        e.stopPropagation(); e.preventDefault();
        this._selectedId = found.drawing.id;
        this._primitive.setSelected(this._selectedId);
        if (found.hit.handle != null && found.hit.handle >= 0) {
          this._state = STATE.DRAG_HANDLE;
          this._drag = { id: found.drawing.id, handleIdx: found.hit.handle };
        } else {
          this._state = STATE.DRAG_BODY;
          this._drag = {
            id: found.drawing.id, handleIdx: -1,
            startTime: c.time, startPrice: c.price,
            orig: JSON.parse(JSON.stringify(found.drawing.points)),
          };
        }
        this._evTarget.style.cursor = 'grabbing';
      } else {
        // Click en vacío: deseleccionar
        if (this._selectedId) {
          this._selectedId = null;
          this._primitive.setSelected(null);
        }
      }
    }

    _onMove(e) {
      const c = this._coordFromEvent(e);
      if (!c) return;

      // Preview de creación
      if (Store.activeTool && this._creating) {
        e.stopPropagation();
        this._creating.preview = { time: c.time, price: c.price };
        this._primitive.setPreview({
          id: '__preview__', type: this._creating.type,
          points: [...this._creating.points, this._creating.preview],
          style: Object.assign({}, (Reg.get(this._creating.type) || {}).defaults, { _preview: true }),
        });
        return;
      }

      // Drag de handle
      if (this._state === STATE.DRAG_HANDLE && this._drag) {
        e.stopPropagation(); e.preventDefault();
        const d = this._drawings.find((x) => x.id === this._drag.id);
        if (d) {
          d.points[this._drag.handleIdx] = { time: c.time, price: c.price };
          this._primitive.setDrawings(this._drawings);
        }
        return;
      }

      // Drag de cuerpo
      if (this._state === STATE.DRAG_BODY && this._drag) {
        e.stopPropagation(); e.preventDefault();
        const d = this._drawings.find((x) => x.id === this._drag.id);
        if (d) {
          const dt = c.time - this._drag.startTime;
          const dp = c.price - this._drag.startPrice;
          d.points = this._drag.orig.map((p) => ({ time: p.time + dt, price: p.price + dp }));
          this._primitive.setDrawings(this._drawings);
        }
        return;
      }

      // Hover
      const found = this._hitTest(c.x, c.y);
      const id = found ? found.drawing.id : null;
      if (id !== this._hoverId) {
        this._hoverId = id;
        this._primitive.setHover(id);
        if (!Store.activeTool) {
          this._evTarget.style.cursor = found
            ? (found.hit.handle >= 0 ? 'nwse-resize' : 'grab')
            : 'default';
        }
      }
    }

    _onUp(e) {
      if (this._state === STATE.DRAG_HANDLE || this._state === STATE.DRAG_BODY) {
        const d = this._drawings.find((x) => x.id === this._drag.id);
        if (d) this._persist(d);
        this._state = STATE.IDLE;
        this._drag = null;
        this._evTarget.style.cursor = Store.activeTool ? 'crosshair' : 'default';
      }
    }

    _onDblClick(e) {
      if (Store.activeTool) return;
      const c = this._coordFromEvent(e);
      if (!c) return;
      const found = this._hitTest(c.x, c.y);
      if (found) { e.stopPropagation(); NS.DrawingEditDialog.open(found.drawing); }
    }

    _onContextMenu(e) {
      e.preventDefault();
      if (Store.activeTool) { this.cancelTool(); return; }
      const c = this._coordFromEvent(e);
      if (!c) return;
      const found = this._hitTest(c.x, c.y);
      if (found) NS.DrawingContextMenu.open(e.clientX, e.clientY, found.drawing);
    }

    // ── Creación ─────────────────────────────────────────────────────────────────
    _handleCreateClick(tool, c) {
      const def = Reg.get(tool);
      if (!def) return;
      const pt = { time: c.time, price: c.price };

      if (def.numPoints === 1) {
        if (tool === 'text') {
          // Editor de texto inline (estilo TradingView): input flotante en el punto
          this._startInlineText(pt, c);
        } else {
          this._finalize(tool, [pt], {});
        }
        return;
      }

      // Multi-punto
      if (!this._creating) {
        this._creating = { type: tool, points: [pt], preview: pt };
        this._state = STATE.CREATING;
      } else {
        this._creating.points.push(pt);
        if (this._creating.points.length >= def.numPoints) {
          this._finalize(tool, this._creating.points.slice(), {});
          this._creating = null;
          this._state = STATE.IDLE;
          this._primitive.setPreview(null);
        }
      }
    }

    // Editor de texto inline: input flotante posicionado en el punto del click.
    _startInlineText(pt, coord) {
      document.getElementById('drawing-inline-text')?.remove();
      const rect = this._evTarget.getBoundingClientRect();
      const input = document.createElement('input');
      input.id = 'drawing-inline-text';
      input.type = 'text';
      input.placeholder = 'Escribí y Enter…';
      input.style.cssText = `position:fixed;left:${rect.left + coord.x}px;top:${rect.top + coord.y - 10}px;
        z-index:900;background:rgba(26,25,23,.95);border:1px solid #2563EB;border-radius:4px;
        color:#F5F0EB;font:12px 'IBM Plex Mono',monospace;padding:3px 6px;outline:none;min-width:120px;`;
      document.body.appendChild(input);
      input.focus();

      const commit = (save) => {
        const text = input.value.trim();
        input.remove();
        // Salir del modo herramienta
        this.cancelTool();
        if (save && text) this._finalize('text', [pt], { text });
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter')  commit(true);
        if (e.key === 'Escape') commit(false);
      });
      input.addEventListener('blur', () => commit(true));
    }

    async _finalize(type, points, styleOverrides) {
      const def = Reg.get(type);
      const style = Object.assign({}, def.defaults, styleOverrides);
      const zIndex = this._drawings.reduce((m, d) => Math.max(m, d.zIndex || 0), 0) + 1;
      let id = Date.now();
      try {
        const res = await NS.API.saveDrawing({
          coin_id: this._coinId, type, timeframes: [], points, style, z_index: zIndex,
        });
        id = res.id;
      } catch (e) {}
      this._drawings.push({ id, type, points, style, zIndex, locked: false });
      this._primitive.setDrawings(this._drawings);
      this._primitive.setPreview(null);
      Store.setDrawings(this._drawings);
      this.cancelTool();
    }

    // ── Persistencia ───────────────────────────────────────────────────────────────
    async _persist(d) {
      try { await NS.API.updateDrawing(d.id, { points: d.points, style: d.style }); } catch (e) {}
    }

    async deleteDrawing(id) {
      this._drawings = this._drawings.filter((d) => d.id !== id);
      if (this._selectedId === id) { this._selectedId = null; this._primitive.setSelected(null); }
      this._primitive.setDrawings(this._drawings);
      Store.setDrawings(this._drawings);
      try { await NS.API.deleteDrawing(id); } catch (e) {}
    }

    async clearAll() {
      if (!confirm('¿Borrar todos los dibujos?')) return;
      const ids = this._drawings.map((d) => d.id);
      this._drawings = [];
      this._selectedId = null;
      this._primitive.setDrawings(this._drawings);
      this._primitive.setSelected(null);
      Store.setDrawings(this._drawings);
      for (const id of ids) { try { await NS.API.deleteDrawing(id); } catch (e) {} }
    }

    // Llamado por el edit dialog tras cambiar estilo
    applyStyle(id, style) {
      const d = this._drawings.find((x) => x.id === id);
      if (!d) return;
      d.style = Object.assign({}, d.style, style);
      this._primitive.setDrawings(this._drawings);
      this._persist(d);
    }
  }

  NS.DrawingManager = new DrawingManager();
})();
