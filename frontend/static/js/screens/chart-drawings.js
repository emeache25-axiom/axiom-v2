/**
 * AXIOM v2 — Chart Drawing Tools
 * Herramientas gráficas sobre canvas overlay
 * Coordenadas internas: {time (unix), price (float)}
 */

const DrawingManager = {

  // ── Estado ─────────────────────────────────────────────────────────────────
  _chart:        null,
  _lwc:          null,
  _candleSeries: null,
  _canvas:       null,
  _ctx:          null,
  _container:    null,
  _coinId:       null,
  _timeframe:    null,
  _drawings:     [],        // [{id, type, points, style, _render}]
  _activeTool:   null,      // 'hline'|'tline'|'vline'|'fib'|'text'|'long'|'short'|'ruler'|null
  _drawing:      null,      // dibujo en progreso
  _hover:        null,      // {id, handleIdx} dibujo bajo el cursor
  _dragging:     null,      // {id, handleIdx, startX, startY, origPoints}
  _raf:          null,
  _resizeObs:    null,

  // Colores por defecto Stone Dark
  DEFAULTS: {
    hline:  { color:'#78716C', lineWidth:1, lineStyle:'solid', label:'' },
    tline:  { color:'#2563EB', lineWidth:1, lineStyle:'solid', extend:'none' },
    vline:  { color:'#78716C', lineWidth:1, lineStyle:'dashed' },
    fib:    { colorLine:'#B47514', colorLevels:'#B4751480', lineWidth:1,
              levels:[0,0.236,0.382,0.5,0.618,0.786,1] },
    text:   { color:'#F5F0EB', fontSize:12, text:'Nota' },
    long:   { colorEntry:'#56A14F', colorTarget:'#56A14F40', colorStop:'#D93B3B40' },
    short:  { colorEntry:'#D93B3B', colorTarget:'#D93B3B40', colorStop:'#56A14F40' },
    ruler:  { color:'#C9A84C', lineWidth:1 },
  },

  // ── Init / Destroy ─────────────────────────────────────────────────────────
  init(chart, lwc, container, coinId, timeframe, candleSeries) {
    this._chart        = chart;
    this._lwc          = lwc;
    this._candleSeries = candleSeries || null;
    this._container    = container;
    this._coinId    = coinId;
    this._timeframe = timeframe;
    this._drawings  = [];
    this._activeTool = null;
    this._drawing   = null;
    this._hover     = null;
    this._dragging  = null;

    // Canvas
    this._canvas = document.createElement('canvas');
    this._canvas.style.cssText = 'position:absolute;inset:0;z-index:20;pointer-events:none;';
    container.appendChild(this._canvas);
    this._ctx = this._canvas.getContext('2d');
    this._resizeCanvas();

    // Resize observer
    this._resizeObs = new ResizeObserver(() => { this._resizeCanvas(); this._render(); });
    this._resizeObs.observe(container);

    // Eventos del container
    container.addEventListener('mousedown',  e => this._onMouseDown(e));
    container.addEventListener('mousemove',  e => this._onMouseMove(e));
    container.addEventListener('mouseup',    e => this._onMouseUp(e));
    container.addEventListener('dblclick',   e => this._onDblClick(e));
    container.addEventListener('contextmenu',e => this._onContextMenu(e));
    // Delete/Backspace elimina el dibujo hover
    this._keyHandler = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this._hover) { this.deleteDrawing(this._hover.id); this._hover = null; }
        if (this._activeTool) { this.cancelTool(); }
      }
      if (e.key === 'Escape') { this.cancelTool(); }
    };
    document.addEventListener('keydown', this._keyHandler);

    // Re-render en scroll/zoom del chart
    chart.timeScale().subscribeVisibleTimeRangeChange(() => this._render());

    this._render();
  },

  destroy() {
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    if (this._canvas && this._canvas.parentNode)
      this._canvas.parentNode.removeChild(this._canvas);
    if (this._resizeObs) this._resizeObs.disconnect();
    this._drawings   = [];
    this._activeTool = null;
    this._drawing    = null;
    this._canvas     = null;
    this._ctx        = null;
  },

  // ── Herramienta activa ─────────────────────────────────────────────────────
  setTool(tool) {
    this._activeTool = tool;
    this._drawing    = null;
    if (this._canvas) {
      this._canvas.style.pointerEvents = tool ? 'auto' : 'none';
      this._canvas.style.cursor = tool ? 'crosshair' : 'default';
    }
    this._renderToolbar();
  },

  cancelTool() {
    this._drawing    = null;
    this._activeTool = null;
    if (this._canvas) {
      this._canvas.style.pointerEvents = 'none';
      this._canvas.style.cursor = 'default';
    }
    this._renderToolbar();
    this._render();
  },

  // ── Carga desde DB ─────────────────────────────────────────────────────────
  async loadFromDB(coinId, timeframe) {
    this._coinId    = coinId;
    this._timeframe = timeframe;
    this._drawings  = [];
    try {
      const data = await API.getChartDrawings(coinId, timeframe);
      for (const row of (data.drawings || [])) {
        const pts = typeof row.points === 'string' ? JSON.parse(row.points) : row.points;
        const sty = typeof row.style  === 'string' ? JSON.parse(row.style)  : row.style;
        this._drawings.push({ id: row.id, type: row.type,
          points: pts, style: Object.assign({}, this.DEFAULTS[row.type]||{}, sty) });
      }
    } catch(e) { console.warn('[drawings] loadFromDB:', e); }
    this._render();
  },

  // ── Coordenadas chart ↔ canvas ─────────────────────────────────────────────
  _chartWidth() {
    try { return this._canvas.width - this._chart.priceScale('right').width(); }
    catch(e) { return this._canvas.width - 88; }
  },

  _chartHeight() {
    try { return this._chart.panes()[0].getHeight(); }
    catch(e) { return this._canvas.height; }
  },

  _clipChart(ctx) {
    ctx.beginPath();
    ctx.rect(0, 0, this._chartWidth(), this._chartHeight());
    ctx.clip();
  },

  _toCanvas(time, price) {
    try {
      const x = this._chart.timeScale().timeToCoordinate(time);
      const y = this._candleSeries.priceToCoordinate(price);
      return (x != null && y != null) ? {x, y} : null;
    } catch(e) { return null; }
  },

  _fromCanvas(x, y) {
    try {
      const time  = this._chart.timeScale().coordinateToTime(x);
      const price = this._candleSeries.coordinateToPrice(y);
      return (time != null && price != null) ? {time, price} : null;
    } catch(e) { return null; }
  },

  _evPos(e) {
    const rect = this._canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  },

  _resizeCanvas() {
    if (!this._canvas || !this._container) return;
    this._canvas.width  = this._container.clientWidth;
    this._canvas.height = this._container.clientHeight;
  },

  // ── Mouse events ───────────────────────────────────────────────────────────
  _onMouseDown(e) {
    if (e.button !== 0) return;
    const pos   = this._evPos(e);
    console.log('[dm] mousedown pos:', pos, 'activeTool:', this._activeTool, 'pointerEvents:', this._canvas.style.pointerEvents);
    const coord = this._fromCanvas(pos.x, pos.y);
    console.log('[dm] coord:', coord);
    if (!coord) return;

    // Si hay herramienta activa → dibujar
    if (this._activeTool) {
      this._handleDrawClick(pos, coord, e);
      return;
    }

    // Si no → intentar seleccionar/arrastrar handle
    const hit = this._hitTest(pos);
    if (hit) {
      this._dragging = { id: hit.id, handleIdx: hit.handleIdx,
        startX: pos.x, startY: pos.y,
        origPoints: JSON.parse(JSON.stringify(
          this._drawings.find(d => d.id === hit.id).points)) };
      this._canvas.style.pointerEvents = 'auto';
      this._canvas.style.cursor = 'grabbing';
      e.stopPropagation();
    }
  },

  _onMouseMove(e) {
    const pos   = this._evPos(e);
    const coord = this._fromCanvas(pos.x, pos.y);
    if (!coord) return;

    // Si estamos dibujando, actualizar punto dinámico
    if (this._activeTool && this._drawing) {
      this._drawing.preview = coord;
      this._render();
      return;
    }

    // Si estamos arrastrando un handle
    if (this._dragging) {
      const d = this._drawings.find(d => d.id === this._dragging.id);
      if (d) {
        const dx = pos.x - this._dragging.startX;
        const dy = pos.y - this._dragging.startY;
        if (this._dragging.handleIdx === -1) {
          // Mover todo el dibujo
          d.points = this._dragging.origPoints.map(p => {
            const orig = this._toCanvas(p.time, p.price);
            if (!orig) return p;
            const newCoord = this._fromCanvas(orig.x + dx, orig.y + dy);
            return newCoord || p;
          });
        } else {
          // Mover handle específico
          const orig = this._dragging.origPoints[this._dragging.handleIdx];
          const origPx = this._toCanvas(orig.time, orig.price);
          if (origPx) {
            const newCoord = this._fromCanvas(origPx.x + dx, origPx.y + dy);
            if (newCoord) d.points[this._dragging.handleIdx] = newCoord;
          }
        }
        this._render();
      }
      return;
    }

    // Hover hit test
    const hit = this._hitTest(pos);
    const prevHover = this._hover;
    this._hover = hit;
    if (hit) {
      this._canvas.style.pointerEvents = 'auto';
      this._canvas.style.cursor = hit.handleIdx >= 0 ? 'nwse-resize' : 'grab';
    } else {
      if (!this._activeTool) {
        this._canvas.style.pointerEvents = 'none';
        this._canvas.style.cursor = 'default';
      }
    }
    if (JSON.stringify(prevHover) !== JSON.stringify(hit)) this._render();
  },

  _onMouseUp(e) {
    if (this._dragging) {
      const d = this._drawings.find(d => d.id === this._dragging.id);
      if (d) this._saveDrawing(d);
      this._dragging = null;
      if (!this._activeTool) {
        this._canvas.style.pointerEvents = 'none';
        this._canvas.style.cursor = 'default';
      }
      this._render();
    }
  },

  _onDblClick(e) {
    if (this._activeTool) return;
    const pos = this._evPos(e);
    const hit = this._hitTest(pos);
    if (hit) this._openEditDialog(hit.id);
  },

  _onContextMenu(e) {
    e.preventDefault();
    if (this._activeTool) { this.cancelTool(); return; }
    const pos = this._evPos(e);
    const hit = this._hitTest(pos);
    if (hit) this._showContextMenu(pos, hit.id);
  },

  // ── Click al dibujar ───────────────────────────────────────────────────────
  _handleDrawClick(pos, coord, e) {
    const tool = this._activeTool;

    // Herramientas de 1 click (hline, vline, text)
    if (tool === 'hline') {
      this._finalizeDrawing({ type:'hline', points:[coord],
        style: Object.assign({}, this.DEFAULTS.hline) });
      return;
    }
    if (tool === 'vline') {
      this._finalizeDrawing({ type:'vline', points:[coord],
        style: Object.assign({}, this.DEFAULTS.vline) });
      return;
    }
    if (tool === 'text') {
      const text = prompt('Texto:', 'Nota');
      if (!text) return;
      this._finalizeDrawing({ type:'text', points:[coord],
        style: Object.assign({}, this.DEFAULTS.text, {text}) });
      return;
    }

    // Herramientas de 2 clicks (tline, fib, ruler, long, short)
    const two = ['tline','fib','ruler','long','short'];
    if (two.includes(tool)) {
      if (!this._drawing) {
        this._drawing = { type: tool, points: [coord], preview: coord };
      } else {
        this._drawing.points.push(coord);
        this._finalizeDrawing({ type: tool, points: this._drawing.points,
          style: Object.assign({}, this.DEFAULTS[tool]) });
      }
      return;
    }
  },

  async _finalizeDrawing(d) {
    console.log('[dm] _finalizeDrawing', d);
    this._drawing = null;
    // Guardar en DB
    try {
      const res = await API.saveDrawing({
        coin_id: this._coinId,
        type:    d.type,
        timeframes: [],
        points:  d.points,
        style:   d.style,
      });
      d.id = res.id;
    } catch(e) { console.log("[dm] saveDrawing error:", e); d.id = Date.now(); } // fallback local id
    this._drawings.push(d);
    this.cancelTool();
    this._render();
  },

  // ── Guardar/Borrar ─────────────────────────────────────────────────────────
  async _saveDrawing(d) {
    try {
      await API.updateDrawing(d.id, { points: d.points, style: d.style });
    } catch(e) {}
  },

  async deleteDrawing(id) {
    this._drawings = this._drawings.filter(d => d.id !== id);
    try { await API.deleteDrawing(id); } catch(e) {}
    this._render();
  },

  async clearAll() {
    if (!confirm('¿Borrar todos los dibujos?')) return;
    const ids = this._drawings.map(d => d.id);
    this._drawings = [];
    this._render();
    for (const id of ids) {
      try { await API.deleteDrawing(id); } catch(e) {}
    }
  },

  // ── Hit test ───────────────────────────────────────────────────────────────
  _hitTest(pos) {
    const HANDLE_R = 7, LINE_THRESH = 6;
    // Recorrer en reversa (último dibujado = prioridad)
    for (let i = this._drawings.length - 1; i >= 0; i--) {
      const d = this._drawings[i];
      const pts = d.points.map(p => this._toCanvas(p.time, p.price)).filter(Boolean);
      if (!pts.length) continue;

      // Test handles
      for (let hi = 0; hi < pts.length; hi++) {
        const dx = pos.x - pts[hi].x, dy = pos.y - pts[hi].y;
        if (Math.sqrt(dx*dx+dy*dy) <= HANDLE_R) return {id: d.id, handleIdx: hi};
      }

      // Test línea/cuerpo
      if (this._hitLine(pos, d, pts, LINE_THRESH)) return {id: d.id, handleIdx: -1};
    }
    return null;
  },

  _hitLine(pos, d, pts, thresh) {
    if (!pts.length) return false;
    const type = d.type;

    if (type === 'hline') {
      return Math.abs(pos.y - pts[0].y) < thresh;
    }
    if (type === 'vline') {
      return Math.abs(pos.x - pts[0].x) < thresh;
    }
    if (type === 'tline' || type === 'ruler') {
      if (pts.length < 2) return false;
      return this._distToSegment(pos, pts[0], pts[1]) < thresh;
    }
    if (type === 'fib' || type === 'long' || type === 'short') {
      if (pts.length < 2) return false;
      const minY = Math.min(pts[0].y, pts[1].y), maxY = Math.max(pts[0].y, pts[1].y);
      return pos.x >= Math.min(pts[0].x, pts[1].x) - 10 &&
             pos.x <= Math.max(pts[0].x, pts[1].x) + 10 &&
             pos.y >= minY - thresh && pos.y <= maxY + thresh;
    }
    if (type === 'text') {
      return Math.abs(pos.x - pts[0].x) < 60 && Math.abs(pos.y - pts[0].y) < 16;
    }
    return false;
  },

  _distToSegment(p, a, b) {
    const dx = b.x-a.x, dy = b.y-a.y;
    const len2 = dx*dx+dy*dy;
    if (len2 === 0) return Math.hypot(p.x-a.x, p.y-a.y);
    const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));
    return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
  },

  // ── Render ─────────────────────────────────────────────────────────────────
  _render() {
    if (!this._ctx || !this._canvas) return;
    const ctx = this._ctx;
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

    // Dibujar todos
    for (const d of this._drawings) {
      const isHovered = this._hover && this._hover.id === d.id;
      this._renderDrawing(ctx, d, isHovered, false);
    }

    // Preview en progreso
    if (this._drawing && this._drawing.preview) {
      const preview = Object.assign({}, this._drawing,
        { points: [...this._drawing.points, this._drawing.preview] });
      this._renderDrawing(ctx, preview, false, true);
    }
  },

  _renderDrawing(ctx, d, hovered, preview) {
    const pts = d.points.map(p => this._toCanvas(p.time, p.price)).filter(Boolean);
    if (!pts.length) return;
    const s = d.style || {};
    const alpha = preview ? 0.6 : 1;

    ctx.save();
    this._clipChart(ctx);
    ctx.globalAlpha = alpha;
    ctx.lineWidth   = s.lineWidth || 1;

    const setStroke = (color) => {
      ctx.strokeStyle = color || '#78716C';
      if ((s.lineStyle||'solid') === 'dashed') ctx.setLineDash([4,4]);
      else ctx.setLineDash([]);
    };

    switch(d.type) {
      case 'hline': this._drawHLine(ctx, pts[0], s, hovered); break;
      case 'vline': this._drawVLine(ctx, pts[0], s, hovered); break;
      case 'tline': if(pts.length>=2) this._drawTLine(ctx, pts, s, hovered); break;
      case 'fib':   if(pts.length>=2) this._drawFib(ctx, d.points, pts, s, hovered); break;
      case 'text':  this._drawText(ctx, pts[0], s, hovered); break;
      case 'long':  if(pts.length>=2) this._drawTrade(ctx, d.points, pts, s, 'long', hovered); break;
      case 'short': if(pts.length>=2) this._drawTrade(ctx, d.points, pts, s, 'short', hovered); break;
      case 'ruler': if(pts.length>=2) this._drawRuler(ctx, d.points, pts, s, hovered); break;
    }

    // Handles si hovered
    if (hovered && !preview) {
      for (const pt of pts) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5, 0, Math.PI*2);
        ctx.fillStyle = '#F5F0EB';
        ctx.fill();
        ctx.strokeStyle = '#2C2926';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.restore();
  },

  _drawHLine(ctx, pt, s, hovered) {
    const w = this._chartWidth();
    ctx.beginPath();
    ctx.strokeStyle = hovered ? '#F5F0EB' : (s.color||'#78716C');
    ctx.lineWidth   = hovered ? 1.5 : (s.lineWidth||1);
    if ((s.lineStyle||'solid')==='dashed') ctx.setLineDash([5,4]); else ctx.setLineDash([]);
    ctx.moveTo(0, pt.y); ctx.lineTo(w, pt.y);
    ctx.stroke();
    if (s.label) {
      ctx.font = '10px IBM Plex Mono, monospace';
      ctx.fillStyle = s.color||'#78716C';
      ctx.fillText(s.label, 6, pt.y - 4);
    }
    // precio en label derecha
    const price = this._candleSeries.coordinateToPrice(pt.y);
    if (price != null) {
      const lbl = price >= 1 ? price.toFixed(2) : price.toPrecision(4);
      ctx.font = '9px IBM Plex Mono, monospace';
      ctx.fillStyle = s.color||'#78716C';
      ctx.fillText(lbl, w - 58, pt.y - 3);
    }
  },

  _drawVLine(ctx, pt, s, hovered) {
    const h = this._canvas.height;
    ctx.beginPath();
    ctx.strokeStyle = hovered ? '#F5F0EB' : (s.color||'#78716C');
    ctx.lineWidth   = hovered ? 1.5 : (s.lineWidth||1);
    if ((s.lineStyle||'dashed')==='dashed') ctx.setLineDash([5,4]); else ctx.setLineDash([]);
    ctx.moveTo(pt.x, 0); ctx.lineTo(pt.x, h);
    ctx.stroke();
  },

  _drawTLine(ctx, pts, s, hovered) {
    const w = this._chartWidth();
    const h = this._chartHeight();
    const [p1, p2] = pts;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    ctx.strokeStyle = hovered ? '#F5F0EB' : (s.color||'#2563EB');
    ctx.lineWidth   = hovered ? 2 : (s.lineWidth||1);
    ctx.setLineDash([]);

    const extend = s.extend || 'none'; // 'none'|'left'|'right'|'both'

    if (extend === 'none') {
      // Solo entre los dos puntos
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    } else {
      // Calcular intersecciones con el área del chart
      if (Math.abs(dx) < 0.001) {
        // Vertical
        ctx.beginPath();
        ctx.moveTo(p1.x, 0); ctx.lineTo(p1.x, h);
        ctx.stroke();
      } else {
        const slope = dy / dx;
        const yAt = (x) => p1.y + slope * (x - p1.x);
        const xAt = (y) => p1.x + (y - p1.y) / slope;
        // Puntos de extensión según dirección
        let lx = extend === 'right' ? p1.x : 0;
        let ly = extend === 'right' ? p1.y : yAt(0);
        let rx = extend === 'left'  ? p2.x : w;
        let ry = extend === 'left'  ? p2.y : yAt(w);
        ctx.beginPath();
        ctx.moveTo(lx, ly); ctx.lineTo(rx, ry);
        ctx.stroke();
      }
    }

    // Líneas punteadas de extensión si extend !== none
    if (extend !== 'none') {
      ctx.setLineDash([3,4]);
      ctx.globalAlpha *= 0.4;
      if (extend === 'both' || extend === 'right') {
        const slope = Math.abs(dx) > 0.001 ? dy/dx : 0;
        ctx.beginPath();
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(w, p2.y + slope * (w - p2.x));
        ctx.stroke();
      }
      if (extend === 'both' || extend === 'left') {
        const slope = Math.abs(dx) > 0.001 ? dy/dx : 0;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(0, p1.y - slope * p1.x);
        ctx.stroke();
      }
      ctx.globalAlpha /= 0.4;
      ctx.setLineDash([]);
    }
  },

  _drawFib(ctx, rawPts, pts, s, hovered) {
    const [p1, p2] = pts;
    const [r1, r2] = rawPts;
    const w = this._chartWidth();
    const levels = s.levels || [0,0.236,0.382,0.5,0.618,0.786,1];
    const priceHigh = Math.max(r1.price, r2.price);
    const priceLow  = Math.min(r1.price, r2.price);
    const COLORS = {
      0:     '#78716C', 0.236:'#2563EB', 0.382:'#56A14F',
      0.5:   '#C9A84C', 0.618:'#D86326', 0.786:'#D93B3B', 1:'#78716C'
    };

    for (const lvl of levels) {
      const price = priceHigh - (priceHigh - priceLow) * lvl;
      const c = this._toCanvas(r1.time, price);
      if (!c) continue;
      const color = COLORS[lvl] || (s.colorLine||'#B47514');
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 0.75;
      ctx.setLineDash([3,3]);
      ctx.moveTo(Math.min(p1.x,p2.x), c.y);
      ctx.lineTo(w - 64, c.y);
      ctx.stroke();
      // Label
      ctx.font = '9px IBM Plex Mono, monospace';
      ctx.fillStyle = color;
      const priceLbl = price >= 1 ? price.toFixed(2) : price.toPrecision(4);
      ctx.fillText(`${(lvl*100).toFixed(1)}%  ${priceLbl}`, w - 62, c.y - 2);
    }
    // Línea vertical entre los dos puntos
    ctx.beginPath();
    ctx.strokeStyle = s.colorLine||'#B47514';
    ctx.lineWidth   = hovered ? 1.5 : 1;
    ctx.setLineDash([]);
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p1.x, p2.y);
    ctx.stroke();
  },

  _drawText(ctx, pt, s, hovered) {
    const text = s.text || 'Nota';
    ctx.font = `${s.fontSize||12}px IBM Plex Mono, monospace`;
    const w = ctx.measureText(text).width;
    // Fondo
    ctx.fillStyle = hovered ? 'rgba(44,41,38,.9)' : 'rgba(26,25,23,.8)';
    ctx.beginPath();
    ctx.roundRect(pt.x - 4, pt.y - (s.fontSize||12) - 2, w + 10, (s.fontSize||12) + 8, 3);
    ctx.fill();
    // Borde
    ctx.strokeStyle = hovered ? '#F5F0EB' : (s.color||'#C9A84C');
    ctx.lineWidth = 0.5; ctx.setLineDash([]);
    ctx.stroke();
    // Texto
    ctx.fillStyle = s.color || '#F5F0EB';
    ctx.fillText(text, pt.x + 2, pt.y);
    // Handle punto
    ctx.beginPath();
    ctx.arc(pt.x, pt.y + 4, 2.5, 0, Math.PI*2);
    ctx.fillStyle = s.color || '#C9A84C';
    ctx.fill();
  },

  _drawTrade(ctx, rawPts, pts, s, dir, hovered) {
    const [p1, p2] = pts;
    const [r1, r2] = rawPts;
    const w = this._chartWidth();
    const entry  = r1.price;
    const target = r2.price;
    // Stop = simétrico al otro lado
    const risk   = Math.abs(target - entry);
    const stop   = dir === 'long' ? entry - risk : entry + risk;
    const cEntry  = this._toCanvas(r1.time, entry);
    const cTarget = this._toCanvas(r1.time, target);
    const cStop   = this._toCanvas(r1.time, stop);
    if (!cEntry || !cTarget || !cStop) return;

    const colorEntry  = s.colorEntry  || (dir==='long' ? '#56A14F' : '#D93B3B');
    const colorTarget = s.colorTarget || (dir==='long' ? '#56A14F30' : '#D93B3B30');
    const colorStop   = s.colorStop   || (dir==='long' ? '#D93B3B30' : '#56A14F30');
    const xStart = Math.min(p1.x, p2.x);

    // Zona target
    ctx.fillStyle = colorTarget;
    ctx.fillRect(xStart, Math.min(cEntry.y, cTarget.y),
                 w - xStart, Math.abs(cTarget.y - cEntry.y));
    // Zona stop
    ctx.fillStyle = colorStop;
    ctx.fillRect(xStart, Math.min(cEntry.y, cStop.y),
                 w - xStart, Math.abs(cStop.y - cEntry.y));
    // Línea entry
    ctx.beginPath();
    ctx.strokeStyle = colorEntry;
    ctx.lineWidth   = hovered ? 1.5 : 1;
    ctx.setLineDash([4,3]);
    ctx.moveTo(xStart, cEntry.y); ctx.lineTo(w, cEntry.y);
    ctx.stroke();

    // Labels
    ctx.font = '10px IBM Plex Mono, monospace';
    ctx.setLineDash([]);
    const fmtP = p => p >= 1 ? p.toFixed(2) : p.toPrecision(4);
    const rr   = risk > 0 ? (Math.abs(target-entry)/risk).toFixed(1) : '—';
    ctx.fillStyle = colorEntry;
    ctx.fillText(`${dir.toUpperCase()}  ${fmtP(entry)}`, xStart + 6, cEntry.y - 4);
    ctx.fillStyle = dir==='long' ? '#56A14F' : '#D93B3B';
    ctx.fillText(`TP  ${fmtP(target)}  R:R ${rr}`, xStart + 6, cTarget.y - 4);
    ctx.fillStyle = dir==='long' ? '#D93B3B' : '#56A14F';
    ctx.fillText(`SL  ${fmtP(stop)}`, xStart + 6, cStop.y - 4);
  },

  _drawRuler(ctx, rawPts, pts, s, hovered) {
    const [p1, p2] = pts;
    const [r1, r2] = rawPts;
    const color = s.color || '#C9A84C';

    // Línea principal
    ctx.beginPath();
    ctx.strokeStyle = hovered ? '#F5F0EB' : color;
    ctx.lineWidth   = hovered ? 1.5 : 1;
    ctx.setLineDash([4,3]);
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Líneas de extensión verticales
    ctx.beginPath();
    ctx.strokeStyle = color + '60';
    ctx.lineWidth = 0.5;
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p1.x, p2.y);
    ctx.moveTo(p2.x, p1.y); ctx.lineTo(p2.x, p2.y);
    ctx.moveTo(p1.x, p2.y); ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    // Calcular diferencia
    const priceDiff = r2.price - r1.price;
    const pct = r1.price > 0 ? (priceDiff / r1.price * 100) : 0;
    const sign = priceDiff >= 0 ? '+' : '';
    const fmtP = p => Math.abs(p) >= 1 ? p.toFixed(2) : p.toPrecision(4);

    // Label central
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const label = `${sign}${fmtP(priceDiff)}  ${sign}${pct.toFixed(2)}%`;
    ctx.font = '11px IBM Plex Mono, monospace';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(15,14,13,.85)';
    ctx.beginPath();
    ctx.roundRect(mx - tw/2 - 6, my - 10, tw + 12, 18, 3);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.fillStyle = priceDiff >= 0 ? '#56A14F' : '#D93B3B';
    ctx.fillText(label, mx - tw/2, my + 4);
  },

  // ── Context menu ───────────────────────────────────────────────────────────
  _showContextMenu(pos, id) {
    document.getElementById('drawing-ctx-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'drawing-ctx-menu';
    menu.style.cssText = `position:fixed;left:${pos.x + this._container.getBoundingClientRect().left}px;top:${pos.y + this._container.getBoundingClientRect().top}px;background:#1A1917;border:0.5px solid #2C2926;border-radius:6px;z-index:800;box-shadow:0 8px 32px rgba(0,0,0,.6);overflow:hidden;min-width:140px;`;
    const items = [
      { label:'<i class="ti ti-pencil"></i> Editar',  fn: () => this._openEditDialog(id) },
      { label:'<i class="ti ti-trash"></i> Eliminar', fn: () => this.deleteDrawing(id), danger: true },
    ];
    for (const item of items) {
      const btn = document.createElement('button');
      btn.innerHTML = item.label;
      btn.style.cssText = `display:block;width:100%;padding:8px 14px;background:none;border:none;color:${item.danger?'#D93B3B':'#F5F0EB'};font-size:12px;font-family:var(--f1,sans-serif);text-align:left;cursor:pointer;`;
      btn.onmouseover = () => btn.style.background = '#2C2926';
      btn.onmouseout  = () => btn.style.background = 'none';
      btn.onclick = () => { menu.remove(); item.fn(); };
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); }};
    setTimeout(() => document.addEventListener('mousedown', close), 50);
  },

  // ── Edit dialog ────────────────────────────────────────────────────────────
  _openEditDialog(id) {
    const d = this._drawings.find(d => d.id === id);
    if (!d) return;
    document.getElementById('drawing-edit-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'drawing-edit-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';

    let fields = '';
    if (d.style.color !== undefined)
      fields += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><label style="font-size:11px;color:#78716C;width:90px;">Color</label><input type="color" data-key="color" value="${d.style.color||'#78716C'}" style="border:none;background:none;cursor:pointer;width:36px;height:24px;"></div>`;
    if (d.style.lineWidth !== undefined)
      fields += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><label style="font-size:11px;color:#78716C;width:90px;">Grosor</label><input type="range" data-key="lineWidth" min="0.5" max="4" step="0.5" value="${d.style.lineWidth||1}" style="flex:1;"></div>`;
    if (d.style.label !== undefined)
      fields += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><label style="font-size:11px;color:#78716C;width:90px;">Etiqueta</label><input type="text" data-key="label" value="${d.style.label||''}" style="flex:1;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:4px;padding:4px 8px;font-size:12px;"></div>`;
    if (d.style.text !== undefined)
      fields += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><label style="font-size:11px;color:#78716C;width:90px;">Texto</label><input type="text" data-key="text" value="${d.style.text||''}" style="flex:1;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:4px;padding:4px 8px;font-size:12px;"></div>`;
    if (d.style.lineStyle !== undefined)
      fields += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><label style="font-size:11px;color:#78716C;width:90px;">Estilo</label><select data-key="lineStyle" style="flex:1;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:4px;padding:4px 8px;font-size:12px;"><option value="solid" ${d.style.lineStyle==='solid'?'selected':''}>Sólida</option><option value="dashed" ${d.style.lineStyle==='dashed'?'selected':''}>Punteada</option></select></div>`;
    if (d.style.extend !== undefined)
      fields += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><label style="font-size:11px;color:#78716C;width:90px;">Extensión</label><select data-key="extend" style="flex:1;background:#0F0E0D;border:0.5px solid #2C2926;color:#F5F0EB;border-radius:4px;padding:4px 8px;font-size:12px;"><option value="none" ${(d.style.extend||'none')==='none'?'selected':''}>Solo segmento</option><option value="right" ${d.style.extend==='right'?'selected':''}>Extender derecha</option><option value="left" ${d.style.extend==='left'?'selected':''}>Extender izquierda</option><option value="both" ${d.style.extend==='both'?'selected':''}>Extender ambos</option></select></div>`;

    modal.innerHTML = `
      <div style="background:#1A1917;border:0.5px solid #2C2926;border-radius:10px;width:min(340px,calc(100vw - 24px));box-shadow:0 16px 48px rgba(0,0,0,.7);">
        <div style="padding:12px 16px;border-bottom:0.5px solid #2C2926;display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:13px;font-weight:600;color:#F5F0EB;">Editar dibujo</span>
          <button onclick="document.getElementById('drawing-edit-modal').remove()" style="border:none;background:#2C2926;color:#78716C;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:12px;">✕</button>
        </div>
        <div style="padding:16px;">${fields}</div>
        <div style="padding:12px 16px;border-top:0.5px solid #2C2926;display:flex;gap:8px;justify-content:flex-end;">
          <button id="dw-del-btn" style="padding:6px 14px;border-radius:6px;border:0.5px solid #D93B3B;background:transparent;color:#D93B3B;font-size:12px;cursor:pointer;">Eliminar</button>
          <button id="dw-save-btn" style="padding:6px 14px;border-radius:6px;border:none;background:#2563EB;color:#fff;font-size:12px;cursor:pointer;">Guardar</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    modal.querySelector('#dw-del-btn').onclick = () => {
      modal.remove();
      this.deleteDrawing(id);
    };
    modal.querySelector('#dw-save-btn').onclick = () => {
      modal.querySelectorAll('[data-key]').forEach(inp => {
        const key = inp.dataset.key;
        const val = inp.type === 'range' ? parseFloat(inp.value) : inp.value;
        d.style[key] = val;
      });
      this._saveDrawing(d);
      modal.remove();
      this._render();
    };
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
  },

  // ── Toolbar ────────────────────────────────────────────────────────────────
  _renderToolbar() {
    const tb = document.getElementById('chart-drawing-toolbar');
    if (!tb) return;
    const tools = [
      { id:'hline',  icon:'ti-minus',              title:'Línea horizontal' },
      { id:'vline',  icon:'ti-border-vertical',    title:'Línea vertical' },
      { id:'tline',  icon:'ti-trending-up',         title:'Línea de tendencia' },
      { id:'fib',    icon:'ti-wave-square',         title:'Fibonacci' },
      { id:'ruler',  icon:'ti-ruler',              title:'Regla de precio' },
      { id:'long',   icon:'ti-arrow-bar-up',        title:'Entrada largo' },
      { id:'short',  icon:'ti-arrow-bar-down',      title:'Entrada corto' },
      { id:'text',   icon:'ti-typography',          title:'Etiqueta / Texto' },
    ];

    let html = '';
    for (const t of tools) {
      const active = this._activeTool === t.id;
      html += `<button title="${t.title}" onclick="DrawingManager.setTool('${t.id}')"
        style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:5px;border:0.5px solid ${active?'#2563EB':'transparent'};background:${active?'#1D3A6E':'transparent'};color:${active?'#3B82F6':'#78716C'};cursor:pointer;transition:all .15s;"
        onmouseover="if(!${active})this.style.background='#2C2926';this.style.color='#F5F0EB';"
        onmouseout="if(!${active})this.style.background='transparent';this.style.color='${active?'#3B82F6':'#78716C'}';">
        <i class="ti ${t.icon}" style="font-size:14px;"></i></button>`;
    }

    // Separador + borrar todo
    html += `<div style="width:24px;height:0.5px;background:#2C2926;margin:4px 3px;"></div>`;
    html += `<button title="Borrar todos los dibujos" onclick="DrawingManager.clearAll()"
      style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:5px;border:0.5px solid transparent;background:transparent;color:#57534E;cursor:pointer;"
      onmouseover="this.style.background='#2C2926';this.style.color='#D93B3B';"
      onmouseout="this.style.background='transparent';this.style.color='#57534E';">
      <i class="ti ti-trash" style="font-size:13px;"></i></button>`;

    tb.innerHTML = html;
  },

  renderToolbar() { this._renderToolbar(); },

};
