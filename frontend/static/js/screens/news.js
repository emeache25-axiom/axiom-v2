const NewsScreen = {
  loaded:       false,
  sources:      [],
  activeSource: null,

  async onEnter() {
    if (!this.loaded) await this.load();
  },

  async load() {
    const el = document.getElementById('screen-news');
    el.innerHTML = `<div class="placeholder"><i class="ti ti-refresh"></i><p>Cargando noticias...</p></div>`;
    try {
      const [newsData, sourcesData] = await Promise.all([
        API.getNews(60),
        API.getNewsSources(),
      ]);
      this.sources = sourcesData.sources;
      el.innerHTML = this.render(newsData);
      this.loaded = true;
    } catch(e) {
      el.innerHTML = `<div class="placeholder"><i class="ti ti-alert-circle"></i><p>Error al cargar noticias</p></div>`;
    }
  },

  async filterBySource(source) {
    this.activeSource = source;
    const grid = document.getElementById('news-grid');
    if (!grid) return;
    grid.innerHTML = `<div style="color:var(--t3);font-size:13px;padding:20px 0;">Cargando...</div>`;
    try {
      const data = await API.getNews(60, source === 'Todas' ? null : source);
      grid.innerHTML = this._renderGrid(data.articles);
      document.querySelectorAll('.news-src-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.source === source));
    } catch(e) {
      grid.innerHTML = `<div style="color:var(--re);font-size:13px;">Error al filtrar</div>`;
    }
  },

  _timeAgo(isoStr) {
    if (!isoStr) return '';
    const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
    if (diff < 3600)  return `${Math.floor(diff/60)}m`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h`;
    return `${Math.floor(diff/86400)}d`;
  },

  _fallbackImg() {
    return '/static/img/news-default.svg';
  },



  _renderCard(a) {
    const fallback       = this._fallbackImg();
    const hasImage       = !!a.image;
    const imgSrc         = a.image || fallback;
    const time           = this._timeAgo(a.published);
    const justifyContent = 'flex-end';
    const padding        = '14px';
    return `
    <a href="${a.link}" target="_blank" rel="noopener"
       style="text-decoration:none;display:block;" class="news-card-link">
      <div class="news-card">
        <!-- Imagen de fondo con overlay -->
        <div style="position:relative;width:100%;height:100%;min-height:200px;">
          <img src="${imgSrc}" alt="" 
               style="width:100%;height:100%;object-fit:cover;display:block;
                      min-height:200px;"
               onerror="this.src='${fallback}'">
          <!-- Overlay gradiente oscuro -->
          <div style="position:absolute;inset:0;
                      background:linear-gradient(to top,
                        rgba(10,9,8,.95) 0%,
                        rgba(10,9,8,.6) 50%,
                        rgba(10,9,8,.1) 100%);">
          </div>
          <!-- Contenido sobre el overlay -->
          <div style="position:absolute;inset:0;padding:${padding};
                      display:flex;flex-direction:column;justify-content:${justifyContent};">
            <!-- Badge fuente arriba -->
            <div style="position:absolute;top:10px;left:10px;display:flex;gap:5px;
                        align-items:center;flex-wrap:wrap;">
              <span style="padding:2px 8px;background:rgba(15,14,13,.8);
                           border:0.5px solid rgba(37,99,235,.4);border-radius:3px;
                           font-family:var(--f2);font-size:9px;color:var(--cy);">
                ${a.source}
              </span>
              ${a.category !== 'General' ? `
              <span style="padding:2px 7px;background:rgba(37,99,235,.15);
                           border-radius:3px;font-family:var(--f2);
                           font-size:9px;color:var(--cy);">
                ${a.category}
              </span>` : ''}
            </div>
            <!-- Título -->
            <div class="news-title"
                 style="font-size:14px;font-weight:600;color:#F5F0EB;line-height:1.4;
                        margin-bottom:6px;
                        display:-webkit-box;-webkit-line-clamp:4;
                        -webkit-box-orient:vertical;overflow:hidden;">
              ${a.title}
            </div>
            <!-- Tiempo -->
            <div style="font-family:var(--f2);font-size:10px;color:rgba(245,240,235,.4);">
              ${time}
            </div>
          </div>
        </div>
      </div>
    </a>`;
  },

  _renderGrid(articles) {
    if (!articles.length) {
      return `<div style="color:var(--t3);font-size:13px;padding:20px 0;">
        No hay artículos disponibles.</div>`;
    }
    return `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;"
         class="news-grid-inner">
      ${articles.map(a => this._renderCard(a)).join('')}
    </div>`;
  },

  _renderSourceFilter() {
    const all = ['Todas', ...this.sources];
    return `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
      ${all.map(s => `
      <button class="news-src-btn ${s === 'Todas' ? 'active' : ''}"
        data-source="${s}"
        onclick="NewsScreen.filterBySource('${s}')"
        style="padding:4px 10px;border-radius:4px;border:0.5px solid var(--w1);
               background:transparent;color:var(--t3);
               font-size:11px;font-family:var(--f2);cursor:pointer;
               transition:all .15s;">
        ${s}
      </button>`).join('')}
    </div>`;
  },

  render(data) {
    const ts = new Date(data.last_updated).toLocaleString('es-AR',{
      dateStyle:'short', timeStyle:'short'
    });
    return `
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;
                  margin-bottom:16px;flex-wrap:wrap;gap:8px;">
        <h1 style="display:flex;align-items:center;gap:8px;font-size:18px;
                   font-weight:600;color:var(--t1);letter-spacing:-.01em;">
          <i class="ti ti-news" style="font-size:18px;color:var(--cy);" aria-hidden="true"></i>
          Noticias
        </h1>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-family:var(--f2);font-size:11px;color:var(--t3);">
            ${data.total} artículos · ${ts}
          </span>
          <button onclick="NewsScreen._refresh()"
            style="padding:4px 10px;border-radius:4px;border:0.5px solid var(--w1);
                   background:transparent;color:var(--t3);font-size:11px;
                   font-family:var(--f2);cursor:pointer;">
            <i class="ti ti-refresh" style="font-size:11px;"></i> Actualizar
          </button>
        </div>
      </div>
      ${this._renderSourceFilter()}
      <div id="news-grid">
        ${this._renderGrid(data.articles)}
      </div>
    </div>`;
  },

  async _refresh() {
    await fetch('/api/news/refresh', {method:'POST'});
    this.loaded = false;
    await this.load();
  },
};
