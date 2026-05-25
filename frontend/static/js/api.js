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
  async getMarketOverview() {
    const r = await fetch('/api/market/overview');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getCapitalSuggestion() {
    const r = await fetch('/api/capital/suggestion');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async getNews(limit=50, source=null) {
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
