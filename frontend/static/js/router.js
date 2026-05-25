const Router = {
  current: null,

  init(defaultScreen) {
    this.go(defaultScreen);
  },

  go(screenId) {
    // Desactivar pantallas
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn, .bot-btn').forEach(b => b.classList.remove('active'));

    // Activar pantalla
    const screen = document.getElementById(`screen-${screenId}`);
    if (screen) screen.classList.add('active');

    // Activar botones de nav
    document.querySelectorAll(`[data-screen="${screenId}"]`).forEach(b => b.classList.add('active'));

    this.current = screenId;

    // Notificar a la pantalla que se activó
    if (window.Screens && window.Screens[screenId]) {
      window.Screens[screenId].onEnter?.();
    }
  },
};
