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
};
