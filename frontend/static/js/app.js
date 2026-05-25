window.Screens = {
  regime:    RegimeScreen,
  market:    MarketScreen,
  watchlist: WatchlistScreen,
  charts:    ChartsScreen,
  news:      NewsScreen,
  bot:       BotScreen,
};

document.addEventListener('DOMContentLoaded', () => {
  Router.init('regime');
});
