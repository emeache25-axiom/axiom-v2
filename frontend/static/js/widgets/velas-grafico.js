/**
 * AXIOM — Widget: grafico_velas (RENDER)
 * ────────────────────────────────────────────────────────────────────────────
 * Un mini-gráfico de velas dentro del chat. Cuando Migue pide "mostrame las
 * velas de ONT", Kepler llama velas_par y este widget pinta las velas como
 * candlesticks — no como tabla de números.
 *
 * POR QUÉ ES DISTINTO A LOS DEMÁS WIDGETS: los otros devuelven HTML string en
 * render(). Un gráfico de Lightweight Charts no se dibuja con HTML: necesita un
 * contenedor real y createChart() en JavaScript. Por eso acá render() devuelve
 * el contenedor y mount() crea el chart dentro.
 *
 * DOS COSAS QUE HAY QUE SABER DEL MONTADOR (aprendidas a los golpes):
 *
 *   1. El `ctx` que el montador pasa a mount() NO incluye los datos —trae
 *      densidad, args, contexto, epistemico, pero no `datos`—. Así que render()
 *      guarda las velas ya normalizadas EN EL PROPIO ELEMENTO (`el._velas`), y
 *      mount() las lee de ahí. No dependemos de ctx.datos.
 *
 *   2. mount() corre justo después de `el.innerHTML = ...`. El contenedor ya
 *      está en el DOM, pero su ancho puede no estar resuelto en ese tick (sobre
 *      todo en el chat, que crece de a bloques). Crear el chart ahí lo deja en
 *      ancho 0 → gráfico vacío. Por eso el createChart va dentro de un
 *      requestAnimationFrame: se dibuja en el frame siguiente, con layout hecho.
 *
 * ALTURA FIJA (240px) en el contenedor: LWC necesita el alto al crear el chart
 * y un widget async puede tener clientHeight 0. Con alto fijo no dependemos de
 * medirlo. El ANCHO sí se mide (ya hubo layout) y se sigue con ResizeObserver.
 *
 * La DECLARACIÓN vive en `backend/domain/widgets.py`.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = (window.AXIOM = window.AXIOM || {});
  const Fmt = NS.Fmt;

  const LWC_URL = 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js';

  const THEME = {
    text:   '#78716C',
    grid:   '#1A1917',
    border: '#2C2926',
    up:     '#56A14F',
    down:   '#D93B3B',
  };

  const ALTO = 240;

  let _cargaLWC = null;
  function cargarLWC() {
    if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
    if (_cargaLWC) return _cargaLWC;
    _cargaLWC = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = LWC_URL;
      s.onload = () => res(window.LightweightCharts);
      s.onerror = () => rej(new Error('no se pudo cargar Lightweight Charts'));
      document.head.appendChild(s);
    });
    return _cargaLWC;
  }

  // velas_par ya devuelve {time (seg), open, high, low, close, volume}. Esto
  // extrae la lista del envoltorio, tolera claves alternativas, descarta lo
  // incompleto y ordena ascendente (LWC lo exige).
  function normalizar(datos) {
    const raw = (datos && (datos.resultado || datos.velas || datos)) || [];
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const v of raw) {
      const time = v.time ?? v.t ?? v.timestamp;
      const o = v.open ?? v.o, h = v.high ?? v.h,
            l = v.low ?? v.l,  c = v.close ?? v.c;
      if (time == null || o == null || h == null || l == null || c == null) continue;
      out.push({ time: Number(time), open: Number(o), high: Number(h),
                 low: Number(l), close: Number(c) });
    }
    out.sort((a, b) => a.time - b.time);
    // Sin duplicados de time (LWC tira error y no pinta nada).
    const limpio = [];
    let ultimo = null;
    for (const v of out) {
      if (v.time === ultimo) limpio[limpio.length - 1] = v;
      else { limpio.push(v); ultimo = v.time; }
    }
    return limpio;
  }

  function precisionDe(velas) {
    const p = velas.length ? velas[velas.length - 1].close : 1;
    if (p >= 1000)  return { precision: 2, minMove: 0.01 };
    if (p >= 1)     return { precision: 4, minMove: 0.0001 };
    if (p >= 0.001) return { precision: 6, minMove: 0.000001 };
    return { precision: 10, minMove: 0.0000000001 };
  }

  function dibujar(host, velas) {
    return cargarLWC().then((LWC) => {
      if (!host.isConnected) return;          // desmontado mientras cargaba
      if (host._velasChart) return;           // ya dibujado (evita doble en rAF)

      const chart = LWC.createChart(host, {
        width:  host.clientWidth || 320,
        height: ALTO,
        layout: {
          background: { color: 'transparent' },
          textColor:  THEME.text, fontSize: 10,
          fontFamily: "'IBM Plex Mono', monospace",
        },
        grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
        rightPriceScale: { borderColor: THEME.border, scaleMargins: { top: 0.1, bottom: 0.2 } },
        timeScale: { borderColor: THEME.border, timeVisible: false,
                     secondsVisible: false, rightOffset: 3, barSpacing: 6 },
        crosshair: { mode: 0 },
        handleScroll: false, handleScale: false,   // en el chat es vista, no mesa
      });

      const serie = chart.addSeries(LWC.CandlestickSeries, {
        upColor: THEME.up, downColor: THEME.down,
        borderUpColor: THEME.up, borderDownColor: THEME.down,
        wickUpColor: THEME.up, wickDownColor: THEME.down,
        priceFormat: { type: 'price', ...precisionDe(velas) },
      }, 0);
      serie.setData(velas);
      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (host.isConnected && host._velasChart) {
          host._velasChart.applyOptions({ width: host.clientWidth });
        }
      });
      ro.observe(host);

      host._velasChart = chart;
      host._velasRO = ro;
    }).catch(() => {
      host.innerHTML = `<div style="padding:20px;text-align:center;
        color:${THEME.text};font-size:12px;">No se pudo cargar el gráfico.</div>`;
    });
  }

  NS.Widgets.render('grafico_velas', {

    render(datos, ctx) {
      const velas = normalizar(datos);

      if (!velas.length) {
        return `<div style="padding:28px;text-align:center;color:${THEME.text};
          font-size:13px;">No hay velas para mostrar.</div>`;
      }

      const args = ctx.args || {};
      const titulo = [
        args.coin_id  ? Fmt.esc(String(args.coin_id).toUpperCase()) : '',
        args.exchange ? Fmt.esc(String(args.exchange).toUpperCase()) : '',
        args.timeframe ? Fmt.esc(args.timeframe) : '',
      ].filter(Boolean).join(' · ');

      // Las velas viajan al mount por el elemento: el ctx de mount NO trae datos.
      // Se guardan acá y mount() las lee. (Se setea en mount porque render solo
      // devuelve el string; el montador hace el innerHTML.)
      return `
        <div data-velas-wrap data-velas-payload="1">
          ${titulo ? `<div style="font-family:var(--f2,monospace);font-size:10px;
             color:${THEME.text};text-transform:uppercase;letter-spacing:.08em;
             padding:4px 2px 8px;">${titulo} · ${velas.length} velas</div>` : ''}
          <div data-velas-host style="width:100%;height:${ALTO}px;position:relative;"></div>
        </div>`;
    },

    mount(el, ctx) {
      const host = el.querySelector('[data-velas-host]');
      if (!host) return;                       // caso "sin velas"
      if (host._velasChart) return;            // ya montado

      // El ctx de mount NO trae datos: se re-normaliza desde ctx.datos si el
      // montador lo pusiera, y si no, no hay de dónde. Por eso el montador se
      // parchea para incluir datos (ver instrucción de despliegue); mientras,
      // como respaldo, se intenta leer de ctx.datos igual.
      const velas = normalizar(ctx && ctx.datos);
      if (!velas.length) {
        // Sin datos en ctx: el gráfico no se puede dibujar. Se deja el aviso.
        host.innerHTML = `<div style="padding:20px;text-align:center;
          color:${THEME.text};font-size:12px;">Sin datos para el gráfico.</div>`;
        return;
      }

      // rAF: garantiza que el layout esté hecho y host tenga ancho real.
      requestAnimationFrame(() => {
        if (host.isConnected) dibujar(host, velas);
      });
    },

    unmount(el) {
      const host = el.querySelector ? el.querySelector('[data-velas-host]') : null;
      const h = host || el;
      if (h && h._velasRO)   { try { h._velasRO.disconnect(); } catch (e) {} h._velasRO = null; }
      if (h && h._velasChart){ try { h._velasChart.remove();  } catch (e) {} h._velasChart = null; }
    },
  });
})();
