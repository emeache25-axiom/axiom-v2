window.Screens = {
  regime:    RegimeScreen,
  market:    MarketScreen,
  watchlist: WatchlistScreen,
  charts:    ChartsScreen,
  news:      NewsScreen,
  bot:       BotScreen,
  pairs:     PairsScreen,
  chat:      ChatScreen,
};

document.addEventListener('DOMContentLoaded', () => {
  Router.init('regime');
});
