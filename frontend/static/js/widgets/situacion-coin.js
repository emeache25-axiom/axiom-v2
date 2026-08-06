/**
 * AXIOM — Widget: situacion_coin (RENDER)
 * ────────────────────────────────────────────────────────────────────────────
 * La situación de una coin de un vistazo: cómo se para en el mercado. Es la
 * vista de analizar_coin —la pregunta más común, "¿cómo viene X?"—.
 *
 * Tres bloques, tal como los devuelve regimen_relativo:
 *   · Contexto global  — el régimen del mercado (largo/medio/corto) que la coin
 *     habita. NO es un régimen propio de la coin: es el clima general, que ella
 *     consume como contexto.
 *   · Fuerza vs BTC    — si la coin le gana, empata o pierde a Bitcoin. El campo
 *     fuente_calculo dice si salió del par /BTC directo o derivado (transparencia).
 *   · Posición sectorial — cómo viene el sector de la coin y dónde se ubica en el
 *     ranking de sectores.
 *
 * Reutiliza la paleta de regímenes del widget regimen_mercado para que los
 * colores signifiquen lo mismo en todo el sistema.
 *
 * La DECLARACIÓN vive en `backend/domain/widgets.py`.
 * ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const NS  = (window.AXIOM = window.AXIOM || {});
  const Fmt = NS.Fmt;

  // Misma paleta y nombres que regimen_mercado — un régimen se ve igual en todo
  // el sistema.
  const REGIME_COLOR = {
    ACUMULACION: '#2563EB', ALCISTA_A: '#56A14F', ALCISTA_B: '#B47514',
    DISTRIBUCION: '#D86326', BAJISTA: '#D93B3B',
    ALCISTA: '#56A14F', LATERAL: '#78716C',
  };
  const REGIME_NOMBRE = {
    ACUMULACION: 'Acumulación', ALCISTA_A: 'Alcista temprano',
    ALCISTA_B: 'Alcista tardío', DISTRIBUCION: 'Distribución',
    BAJISTA: 'Bajista', ALCISTA: 'Alcista', LATERAL: 'Lateral',
  };
  const rColor  = r => REGIME_COLOR[r]  || '#78716C';
  const rNombre = r => REGIME_NOMBRE[r] || r || '—';

  // Lecturas interpretativas → color + texto legible.
  const LECTURA = {
    lider:          { c: '#56A14F', t: 'Líder frente a BTC' },
    neutral:        { c: '#78716C', t: 'Neutral frente a BTC' },
    rezagada:       { c: '#D93B3B', t: 'Rezagada frente a BTC' },
    sector_fuerte:  { c: '#56A14F', t: 'Sector fuerte' },
    sector_neutral: { c: '#78716C', t: 'Sector neutral' },
    sector_debil:   { c: '#D93B3B', t: 'Sector débil' },
  };
  const lee = k => LECTURA[k] || { c: '#78716C', t: k || '—' };

  const SECTOR_NOMBRE = {
    bitcoin: 'Bitcoin', smart_platforms: 'Smart Platforms', layer2: 'Layer 2',
    stablecoins: 'Stablecoins', defi: 'DeFi', rwa: 'RWA', exchange: 'Exchange',
    ai: 'IA', memes: 'Memes', gaming: 'Gaming', privacy: 'Privacidad',
    infrastructure: 'Infraestructura', desoc: 'DeSoc', staking: 'Staking',
    launchpads: 'Launchpads', sec_securities: 'Securities', political: 'Political',
    payments: 'Pagos', otros: 'Otros',
  };
  const sectorNombre = s => SECTOR_NOMBRE[s] || s || '—';

  function money(n) {
    if (n == null) return Fmt.NADA;
    const v = Number(n);
    if (!isFinite(v)) return Fmt.NADA;
    if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9)  return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6)  return '$' + (v / 1e6).toFixed(1) + 'M';
    return '$' + v.toLocaleString('es-AR');
  }

  function avatar(m) {
    if (m.image) {
      return `<img src="${Fmt.esc(m.image)}" style="width:34px;height:34px;
        border-radius:50%;object-fit:cover;flex-shrink:0;">`;
    }
    const ini = String(m.symbol || '').slice(0, 3);
    return `<div style="width:34px;height:34px;border-radius:50%;
      background:var(--c3,#2C2926);display:flex;align-items:center;
      justify-content:center;font-family:var(--f2,monospace);font-size:11px;
      font-weight:600;color:var(--t2,#A8A29E);flex-shrink:0;">${Fmt.esc(ini)}</div>`;
  }

  // Cabecera: identidad + números de mercado.
  function cabecera(m) {
    return `
      <div style="display:flex;align-items:center;gap:11px;padding-bottom:12px;
                  border-bottom:0.5px solid var(--w1,#2C2926);margin-bottom:12px;">
        ${avatar(m)}
        <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:baseline;gap:7px;">
            <span style="font-size:15px;font-weight:600;color:var(--t1,#F5F0EB);">${Fmt.esc(m.name || '')}</span>
            <span style="font-family:var(--f2,monospace);font-size:11px;color:var(--t3,#78716C);">${Fmt.esc((m.symbol || '').toUpperCase())}</span>
            ${m.rank ? `<span style="font-family:var(--f2,monospace);font-size:10px;color:var(--t3,#78716C);">#${m.rank}</span>` : ''}
          </div>
          <div style="font-family:var(--f2,monospace);font-size:10px;color:var(--t3,#78716C);margin-top:2px;">
            MCap ${money(m.market_cap)} · Vol ${money(m.volume_24h)}
          </div>
        </div>
      </div>`;
  }

  // Un plazo del contexto global (largo/medio/corto).
  function plazo(label, r) {
    if (!r) return '';
    const col = rColor(r.regime);
    return `
      <div style="flex:1;text-align:center;padding:8px 4px;
                  background:var(--c1,#12110F);border-radius:7px;">
        <div style="font-family:var(--f2,monospace);font-size:9px;color:var(--t3,#78716C);
                    text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">${label}</div>
        <div style="font-size:12px;font-weight:600;color:${col};line-height:1.2;">${rNombre(r.regime)}</div>
        <div style="font-family:var(--f2,monospace);font-size:9px;color:var(--t3,#78716C);margin-top:3px;">
          conv ${r.conviction ?? '—'}${r.is_confirmed ? '' : ' ·no conf'}</div>
      </div>`;
  }

  // Bloque: título + contenido.
  function bloque(titulo, contenido) {
    return `
      <div style="margin-bottom:12px;">
        <div style="font-family:var(--f2,monospace);font-size:9px;color:var(--t3,#78716C);
                    text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">${titulo}</div>
        ${contenido}
      </div>`;
  }

  function pctTxt(v) {
    if (v == null) return Fmt.NADA;
    const n = Number(v);
    if (!isFinite(n)) return Fmt.NADA;
    const c = n >= 0 ? '#56A14F' : '#D93B3B';
    return `<span style="color:${c};">${n >= 0 ? '+' : ''}${n.toFixed(2)}%</span>`;
  }

  NS.Widgets.render('situacion_coin', {

    render(datos, ctx) {
      const d = (datos && (datos.resultado || datos)) || {};
      const m = d.metadata_mercado || {};
      const rel = d.regimen_relativo || {};
      const glob = rel.contexto_global || {};
      const fuerza = rel.fuerza_vs_btc || {};
      const sect = rel.posicion_sectorial || {};

      if (!m.symbol && !rel.contexto_global) {
        return `<div style="padding:24px;text-align:center;color:var(--t3,#78716C);
          font-size:13px;">No hay datos de situación para esta coin.</div>`;
      }

      // Contexto global: los tres plazos.
      const contextoGlobal = bloque('Régimen del mercado', `
        <div style="display:flex;gap:6px;">
          ${plazo('Largo', glob.largo)}
          ${plazo('Medio', glob.medio)}
          ${plazo('Corto', glob.corto)}
        </div>`);

      // Fuerza vs BTC.
      const lf = lee(fuerza.lectura);
      const fuenteTxt = fuerza.fuente_calculo === 'par_btc'
        ? 'par /BTC directo'
        : fuerza.fuente_calculo === 'derivado' ? 'derivado (COIN/USDT ÷ BTC/USDT)'
        : '';
      const fuerzaBloque = bloque('Fuerza frente a Bitcoin', `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;
                    padding:9px 11px;background:var(--c1,#12110F);border-radius:7px;">
          <span style="font-size:12px;font-weight:600;color:${lf.c};">${lf.t}</span>
          <span style="font-family:var(--f2,monospace);font-size:11px;color:var(--t2,#A8A29E);">
            7d ${pctTxt(fuerza.ratio_change_7d)} · 24h ${pctTxt(fuerza.ratio_change_24h)}
          </span>
        </div>
        ${fuenteTxt ? `<div style="font-family:var(--f2,monospace);font-size:9px;
           color:var(--t4,#57534E);margin-top:4px;">medido sobre ${fuenteTxt}</div>` : ''}`);

      // Posición sectorial.
      const ls = lee(sect.lectura);
      const rankTxt = sect.sector_rank != null && sect.total_sectores
        ? `#${sect.sector_rank} de ${sect.total_sectores}` : '';
      const sectorBloque = bloque('Posición del sector', `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;
                    padding:9px 11px;background:var(--c1,#12110F);border-radius:7px;">
          <span style="display:flex;flex-direction:column;gap:1px;min-width:0;">
            <span style="font-size:12px;font-weight:600;color:${ls.c};">${sectorNombre(sect.supercategoria)}</span>
            <span style="font-size:10px;color:var(--t3,#78716C);">${ls.t}${rankTxt ? ' · ' + rankTxt : ''}</span>
          </span>
          <span style="font-family:var(--f2,monospace);font-size:11px;color:var(--t2,#A8A29E);text-align:right;">
            7d ${pctTxt(sect.sector_change_7d)}
            ${sect.sector_mediana_7d != null ? `<br><span style="font-size:9px;color:var(--t4,#57534E);">mediana ${pctTxt(sect.sector_mediana_7d)}</span>` : ''}
          </span>
        </div>`);

      return `
        <div style="padding:2px;">
          ${cabecera(m)}
          ${contextoGlobal}
          ${fuerzaBloque}
          ${sectorBloque}
        </div>`;
    },
  });
})();
