/**
 * AXIOM — Widget: mapa_sectores (RENDER)
 * ────────────────────────────────────────────────────────────────────────────
 * El mercado por supercategoría, con su fuerza relativa.
 *
 * Quinto widget del sistema. A diferencia de los anteriores, este NO es solo un
 * refactor: la pantalla de Categorías consumía `/api/market/categories`, el
 * endpoint viejo, y por eso no mostraba ninguna de las correcciones del mapa:
 *
 *   · la variación estaba SIN PONDERAR por capitalización, lo que daba
 *     lecturas invertidas (privacy figuraba "+9,5% fuerte" cuando por capital
 *     caía -6%);
 *   · no existía la MEDIANA, que es lo que revela si el movimiento fue parejo
 *     o lo traccionaron unas pocas grandes;
 *   · los sectores de 12 coins rankeaban igual que los de 400.
 *
 * Este widget consume la capacidad `mapa_sectores`, así que muestra todo eso.
 *
 * CÓMO LEER LAS TRES CIFRAS:
 *   Pond.  — cuánto se movió el CAPITAL del sector (la lectura principal)
 *   Mediana— cómo le fue a la coin TÍPICA, inmune a valores extremos
 *   Disp.  — promedio simple menos ponderado: si es alta y positiva, se
 *            movieron las chicas; si es negativa, las grandes
 *
 * La DECLARACIÓN vive en `backend/domain/widgets.py`.
 * Ver AXIOM_sistema_widgets.md
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = (window.AXIOM = window.AXIOM || {});
  const Fmt = NS.Fmt;

  const COLORES = {
    bitcoin:'#F7931A', smart_platforms:'#627EEA', layer2:'#8247E5',
    stablecoins:'#26A17B', defi:'#2563EB', rwa:'#B47514', exchange:'#F0B90B',
    ai:'#10B981', memes:'#D86326', gaming:'#8B5CF6', privacy:'#78716C',
    infrastructure:'#0EA5E9', desoc:'#EC4899', staking:'#14B8A6',
    launchpads:'#F59E0B', sec_securities:'#DC2626', political:'#6366F1',
    payments:'#059669', wrapped:'#57534E', otros:'#44403C',
  };

  const ETIQUETAS = {
    bitcoin:'Bitcoin', smart_platforms:'Smart platforms', layer2:'Layer 2',
    stablecoins:'Stablecoins', defi:'DeFi', rwa:'RWA', exchange:'Exchange',
    ai:'IA', memes:'Memes', gaming:'Gaming', privacy:'Privacidad',
    infrastructure:'Infraestructura', desoc:'DeSoc', staking:'Staking',
    launchpads:'Launchpads', sec_securities:'Securities', political:'Político',
    payments:'Pagos', wrapped:'Envueltos', otros:'Sin clasificar',
  };

  const LECTURA = {
    sector_fuerte:  { txt:'fuerte',  col:'#56A14F' },
    sector_debil:   { txt:'débil',   col:'#D93B3B' },
    sector_neutral: { txt:'neutral', col:'#78716C' },
    muestra_chica:  { txt:'muestra chica', col:'#B47514' },
    sin_clasificar: { txt:'sin clasificar', col:'#57534E' },
    derivado:       { txt:'derivado', col:'#57534E' },
  };

  const color  = s => COLORES[s]  || '#78716C';
  const nombre = s => ETIQUETAS[s] || s;

  const ANCHOS = {
    sector: '1fr', pond: '78px', mediana: '78px',
    disp: '70px', peso: '64px', coins: '58px', lectura: '110px',
  };

  const ETIQ_COL = {
    sector:'Sector', pond:'Pond. 7d', mediana:'Mediana',
    disp:'Disp.', peso:'Peso', coins:'Coins', lectura:'',
  };

  const DERECHA = new Set(['pond', 'mediana', 'disp', 'peso', 'coins']);

  function pct(v, dec = 2) {
    return v == null ? Fmt.NADA : (v >= 0 ? '+' : '') + Number(v).toFixed(dec) + '%';
  }

  function celda(campo, c, maxPeso) {
    switch (campo) {
      case 'sector': {
        // La barra da escala visual del peso sin ocupar una columna aparte.
        const ancho = maxPeso > 0 ? (c.peso_pct / maxPeso * 100).toFixed(1) : 0;
        const col = color(c.supercategoria);
        // 'otros' y 'wrapped' no se abren: no son sectores reales, así que
        // listar sus coins no responde a ninguna pregunta útil.
        const abrible = c.clasificado !== false;
        return `
          <div style="min-width:0;">
            <div ${abrible ? `data-sec-abrir="${Fmt.esc(c.supercategoria)}"` : ''}
                 style="font-size:13px;font-weight:500;color:var(--t1,#F5F0EB);
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                        margin-bottom:4px;${abrible ? 'cursor:pointer;' : ''}"
                 ${abrible ? `onmouseover="this.style.color='${col}'"
                              onmouseout="this.style.color='var(--t1,#F5F0EB)'"` : ''}
              >${Fmt.esc(nombre(c.supercategoria))}${
                abrible ? ` <i class="ti ti-chevron-right"
                  style="font-size:10px;opacity:.45;"></i>` : ''}</div>
            <div style="height:4px;background:var(--c3,#2C2926);border-radius:2px;">
              <div style="height:4px;width:${ancho}%;background:${color(c.supercategoria)};
                          border-radius:2px;"></div>
            </div>
          </div>`;
      }
      case 'pond':
        return `<span style="font-family:var(--f2,monospace);font-size:12px;
          font-weight:600;color:${Fmt.colorSigno(c.change_7d)};">${pct(c.change_7d)}</span>`;

      case 'mediana':
        return `<span style="font-family:var(--f2,monospace);font-size:11px;
          color:${Fmt.colorSigno(c.mediana_7d)};opacity:.85;">${pct(c.mediana_7d)}</span>`;

      case 'disp': {
        // Solo se destaca cuando es grande: una dispersión alta avisa que el
        // agregado no representa al sector entero.
        const v = c.dispersion;
        const fuerte = v != null && Math.abs(v) > 10;
        return `<span title="${fuerte ? 'El movimiento no fue parejo' : ''}"
          style="font-family:var(--f2,monospace);font-size:11px;
          color:${fuerte ? '#B47514' : 'var(--t3,#78716C)'};">${pct(v, 1)}</span>`;
      }
      case 'peso':
        return `<span style="font-family:var(--f2,monospace);font-size:11px;
          color:var(--t3,#78716C);">${(c.peso_pct ?? 0).toFixed(2)}%</span>`;

      case 'coins':
        return `<span style="font-family:var(--f2,monospace);font-size:11px;
          color:var(--t3,#78716C);">${c.coin_count ?? Fmt.NADA}</span>`;

      case 'lectura': {
        const l = LECTURA[c.lectura] || LECTURA.sector_neutral;
        return `<span style="font-family:var(--f2,monospace);font-size:10px;
          padding:2px 7px;border-radius:3px;white-space:nowrap;
          background:${l.col}22;color:${l.col};">${l.txt}</span>`;
      }
      default: return '';
    }
  }

  function fila(c, campos, grid, maxPeso, rank) {
    const celdas = campos.map(k => {
      const alin = DERECHA.has(k) ? 'text-align:right;' : '';
      return `<div style="${alin}min-width:0;">${celda(k, c, maxPeso)}</div>`;
    }).join('');

    return `
      <div style="display:grid;grid-template-columns:${grid};gap:10px;
                  padding:9px 14px;border-bottom:0.5px solid var(--w1,#2C2926);
                  align-items:center;">
        ${celdas}
      </div>`;
  }

  function encabezado(campos, grid) {
    const celdas = campos.map(k => {
      const alin = DERECHA.has(k) ? 'text-align:right;' : '';
      return `<span style="${alin}">${ETIQ_COL[k] || ''}</span>`;
    }).join('');
    return `
      <div style="display:grid;grid-template-columns:${grid};gap:10px;
                  padding:9px 14px;border-bottom:1px solid var(--w1,#2C2926);
                  font-family:var(--f2,monospace);font-size:9px;
                  color:var(--t3,#78716C);text-transform:uppercase;
                  letter-spacing:.1em;">${celdas}</div>`;
  }

  // ── El widget ───────────────────────────────────────────────────────────────

  NS.Widgets.render('mapa_sectores', {

    render(datos, ctx) {
      const d = (datos && (datos.resultado || datos)) || {};
      const cats = d.categorias || [];
      if (!cats.length) {
        return `<div style="padding:24px;text-align:center;color:var(--t3,#78716C);
          font-size:13px;">No hay datos de sectores.</div>`;
      }

      const campos = (ctx.campos || []).filter(k => ANCHOS[k]);
      const grid   = campos.map(k => ANCHOS[k]).join(' ');

      // Rankeados y no rankeados van SEPARADOS, no mezclados: si un sector de
      // 12 coins aparece en la misma lista que uno de 400, la marca de
      // "muestra chica" se pierde de vista y vuelve a parecer comparable.
      const rank = cats.filter(c => c.fuerza_rank);
      const resto = cats.filter(c => !c.fuerza_rank);
      const maxPeso = Math.max(...cats.map(c => c.peso_pct || 0), 1);

      const u = d.umbral_ranking;
      const nota = u
        ? `Rankean los sectores con al menos ${u.min_coins} coins y ${u.min_peso_pct}% del mercado.`
        : '';

      let html = `
        <div style="font-family:var(--f2,monospace);font-size:10px;
             color:var(--t3,#78716C);margin-bottom:10px;line-height:1.5;">
          Variación a 7 días ponderada por capitalización. ${nota}
        </div>
        <div class="card" style="padding:0;overflow:hidden;">
          ${encabezado(campos, grid)}
          ${rank.map((c, i) => fila(c, campos, grid, maxPeso, i + 1)).join('')}
        </div>`;

      if (resto.length) {
        html += `
          <div style="font-family:var(--f2,monospace);font-size:10px;
               color:var(--t3,#78716C);margin:14px 0 8px;">
            Fuera del ranking — muestra o peso insuficiente para comparar
          </div>
          <div class="card" style="padding:0;overflow:hidden;opacity:.72;">
            ${resto.map(c => fila(c, campos, grid, maxPeso)).join('')}
          </div>`;
      }

      return html;
    },

    /**
     * Clic en un sector: pide abrir su detalle. El widget no conoce la
     * pantalla —montado en el chat no habría a dónde navegar—, así que emite
     * un evento y quien lo montó decide si hace algo.
     */
    mount(el, ctx) {
      el.querySelectorAll('[data-sec-abrir]').forEach(n => {
        n.onclick = () => {
          el.dispatchEvent(new CustomEvent('axiom:sector-abrir', {
            detail: { supercategoria: n.dataset.secAbrir },
            bubbles: true,
          }));
        };
      });
    },
  });
})();
