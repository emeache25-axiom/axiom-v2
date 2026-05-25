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
};
