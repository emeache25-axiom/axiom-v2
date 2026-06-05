const API = {
  async getLatestRegime() {
    const r = await fetch('/api/regime/latest');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getCurrentRegime() {
    const r = await fetch('/api/regime/current');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getMarketOverview(minMcap=100000000) {
    const r = await fetch(`/api/market/overview?min_mcap=${minMcap}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getMarketCategories() {
    const r = await fetch('/api/market/categories');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getSupercatCoins(supercatId, limit=10) {
    const r = await fetch(`/api/market/categories/${supercatId}/coins?limit=${limit}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getMarketNetworks() {
    const r = await fetch('/api/market/networks');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getNetworkCoins(networkId, limit=10) {
    const r = await fetch(`/api/market/networks/${networkId}/coins?limit=${limit}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getCoins(page=1, perPage=25) {
    const r = await fetch(`/api/market/coins?page=${page}&per_page=${perPage}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getCapitalSuggestion() {
    const r = await fetch('/api/capital/suggestion');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getNews(limit=60, source=null) {
    const params = new URLSearchParams({limit});
    if (source) params.append('source', source);
    const r = await fetch(`/api/news/?${params}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getNewsSources() {
    const r = await fetch('/api/news/sources');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getWatchlist() {
    const r = await fetch('/api/watchlist/');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getWatchlistPrices() {
    const r = await fetch('/api/watchlist/prices');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async searchCoins(q, limit=8) {
    const r = await fetch(`/api/watchlist/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async addToWatchlist(coinId, exchange='coingecko', notes='') {
    const r = await fetch('/api/watchlist/', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({coin_id:coinId, exchange, notes}),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async updateWatchlistItem(id, data) {
    const r = await fetch(`/api/watchlist/${id}`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getWatchlistSuggested() {
    const r = await fetch(`/api/watchlist/suggested`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getScreener(params={}) {
    const qs = new URLSearchParams(params).toString();
    const r  = await fetch(`/api/watchlist/screener?${qs}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async removeFromWatchlist(id) {
    const r = await fetch(`/api/watchlist/${id}`, {method:'DELETE'});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  // ── Charts ────────────────────────────────────────────────────────────────
  async getChartOHLCV(coinId, timeframe='1d', limit=300) {
    const r = await fetch(`/api/charts/ohlcv?coin_id=${coinId}&timeframe=${timeframe}&limit=${limit}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getChartState() {
    const r = await fetch('/api/charts/state');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getChartDrawings(coinId, timeframe='') {
    const r = await fetch(`/api/charts/drawings/${coinId}?timeframe=${timeframe}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async saveDrawing(data) {
    const r = await fetch('/api/charts/drawings', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async updateDrawing(id, data) {
    const r = await fetch(`/api/charts/drawings/${id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async deleteDrawing(id) {
    const r = await fetch(`/api/charts/drawings/${id}`, {method:'DELETE'});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getIndicators() {
    const r = await fetch('/api/charts/indicators');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async saveIndicator(data) {
    const r = await fetch('/api/charts/indicators', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
};