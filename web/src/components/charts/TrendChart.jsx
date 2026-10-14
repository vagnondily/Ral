import React, { useEffect, useRef, useState } from 'react';
import { formatInt, monthLabel, shortMonthLabel } from '../../lib/format.js';
import { pickTicks, yScale } from '../../lib/chartAxis.js';

/**
 * Courbe mensuelle partagée (Synthèse, Couverture & performance) — sans
 * dépendance. Une seule mesure, donc un seul axe des valeurs.
 *
 * Lisible à toutes les tailles : la largeur RÉELLE est mesurée (ResizeObserver)
 * et sert de viewBox en pixels, le texte n'est donc jamais agrandi ni rétréci ;
 * chaque étiquette de mois est MESURÉE (police de l'axe, gras pour le mois
 * choisi) et chartAxis.pickTicks ne garde que des étiquettes qui ne se touchent
 * pas : le mois choisi et le dernier mois sont toujours étiquetés, leurs
 * voisines trop proches sont retirées ; mois en clair et traduits
 * (shortMonthLabel) ; graduations horizontales discrètes ; survol = repère
 * vertical + info-bulle (et <title> pour les lecteurs d'écran).
 *
 * `selected` : un mois « AAAA-MM », ou une période { from, to } (lot 1b) — les mois de la
 * période sont surlignés par une bande de fond et leurs points marqués ; le premier et le
 * dernier mois de la période sont toujours étiquetés.
 *
 * @param {{ data: {month:string}[], valueKey?:string, selected?:string|{from:string,to:string}, height?:number,
 *           label:string, unit?:string, empty:React.ReactNode, format?:(n:number)=>string }} props
 */
const AXIS_PX = 11;  // taille de police de .trend-axis (styles.css)
const LABEL_GAP = 8; // écart minimal entre deux étiquettes de mois (px)
const FALLBACK_FONT = "'Inter', system-ui, sans-serif";

let measureCtx = null;
/** Largeur (px) d'une étiquette d'axe dans sa police ; estimation prudente sans canvas. */
function textWidth(text, bold, family) {
  try {
    if (!measureCtx && typeof document !== 'undefined') measureCtx = document.createElement('canvas').getContext('2d');
  } catch { measureCtx = null; }
  if (measureCtx) {
    measureCtx.font = `${bold ? 700 : 400} ${AXIS_PX}px ${family || FALLBACK_FONT}`;
    const w = measureCtx.measureText(text).width;
    if (w > 0) return Math.ceil(w);
  }
  return Math.ceil(text.length * AXIS_PX * (bold ? 0.66 : 0.62));
}

export default function TrendChart({ data, valueKey = 'submissions', selected, height = 168, label, unit = '', empty, format = formatInt }) {
  const wrap = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);
  const [family, setFamily] = useState(FALLBACK_FONT);
  const [, setFontGen] = useState(0);

  // La largeur d'une étiquette dépend de la police : re-mesurer quand une police finit de charger.
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (!fonts) return undefined;
    let alive = true;
    const bump = () => { if (alive) setFontGen((g) => g + 1); };
    if (fonts.ready) fonts.ready.then(bump, () => {});
    if (fonts.addEventListener) fonts.addEventListener('loadingdone', bump);
    return () => { alive = false; if (fonts.removeEventListener) fonts.removeEventListener('loadingdone', bump); };
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    // Police réelle de l'axe (.trend-axis hérite de la police de l'interface).
    if (typeof getComputedStyle === 'function') setFamily(getComputedStyle(el).fontFamily || FALLBACK_FONT);
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = data || [];
  const values = rows.map((d) => Math.max(0, Number(d[valueKey]) || 0));
  const total = values.reduce((a, b) => a + b, 0);
  // Le conteneur mesuré est toujours le même élément (l'observateur ne le perd pas quand les données arrivent).
  if (rows.length === 0 || total === 0) return <div ref={wrap} className="trend-chart"><p className="trend-empty muted">{empty}</p></div>;

  const w = Math.max(160, width || 320);
  const { max, ticks } = yScale(Math.max(...values));
  const yLabelW = Math.max(18, String(format(max)).length * 7 + 6);
  const pad = { l: yLabelW + 6, r: 10, t: 10, b: 24 };
  const plotW = w - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const n = rows.length;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const x = (i) => pad.l + (n > 1 ? i * step : plotW / 2);
  const y = (v) => pad.t + plotH * (1 - v / max);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${y(0)} ${pts} ${x(n - 1).toFixed(1)},${y(0)}`;
  // Étiquettes mesurées puis choisies sans chevauchement (mois choisi, puis dernier mois, toujours montrés).
  const texts = rows.map((r) => shortMonthLabel(r.month));
  const range = selected && typeof selected === 'object' ? selected : (selected ? { from: selected, to: selected } : null);
  const isSel = (m) => !!range && m >= range.from && m <= range.to;
  const selIdx = rows.map((r, i) => (isSel(r.month) ? i : -1)).filter((i) => i >= 0);
  const selFirst = selIdx.length ? selIdx[0] : -1;
  const selLast = selIdx.length ? selIdx[selIdx.length - 1] : -1;
  const marks = pickTicks(rows.map((r, i) => x(i)), texts.map((tx, i) => textWidth(tx, isSel(rows[i].month), family)),
    { width: w, forced: [selFirst, selLast, n - 1], gap: LABEL_GAP });
  // Bande de la période : de la moitié de l'intervalle avant le premier mois à la moitié après le dernier.
  const half = n > 1 ? step / 2 : 12;
  const band = selIdx.length > 1 || (selIdx.length === 1 && range.from !== range.to)
    ? { x0: Math.max(pad.l, x(selFirst) - half), x1: Math.min(w - pad.r, x(selLast) + half) } : null;
  const tipFor = (i) => `${monthLabel(rows[i].month)} : ${format(values[i])}${unit ? ` ${unit}` : ''}`;

  return (
    <div ref={wrap} className="trend-chart" onMouseLeave={() => setHover(null)}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={label}>
        {ticks.map((tv) => (
          <g key={`g${tv}`}>
            <line className="trend-grid" x1={pad.l} x2={w - pad.r} y1={y(tv)} y2={y(tv)} />
            <text className="trend-axis" x={pad.l - 6} y={y(tv) + 3.5} textAnchor="end">{format(tv)}</text>
          </g>
        ))}
        {band && <rect className="trend-band" x={band.x0} y={pad.t} width={Math.max(0, band.x1 - band.x0)} height={plotH} />}
        <polygon className="trend-area" points={area} />
        <polyline className="trend-line" points={pts} />
        {hover != null && <line className="trend-cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + plotH} />}
        {values.map((v, i) => (
          <circle key={rows[i].month} className={`trend-dot${isSel(rows[i].month) ? ' is-selected' : ''}`}
            cx={x(i)} cy={y(v)} r={isSel(rows[i].month) || hover === i ? 5 : 3.5}>
            <title>{tipFor(i)}</title>
          </circle>
        ))}
        {marks.map(({ index: i, anchor }) => (
          <text key={`t${rows[i].month}`} className={`trend-axis trend-month${isSel(rows[i].month) ? ' is-selected' : ''}`}
            x={x(i)} y={height - 7} textAnchor={anchor}>{texts[i]}</text>
        ))}
        {/* Zones de survol plus larges que les points (une colonne par mois). */}
        {values.map((v, i) => (
          <rect key={`h${rows[i].month}`} className="trend-hit" x={x(i) - Math.max(step, 12) / 2} y={pad.t}
            width={Math.max(step, 12)} height={plotH} onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover != null && (
        <div className="trend-tip" style={{ left: Math.min(Math.max(x(hover), 70), w - 70), top: Math.max(0, y(values[hover]) - 44) }} role="status">
          <div className="trend-tip-m">{monthLabel(rows[hover].month)}</div>
          <div className="tabular">{format(values[hover])}{unit ? ` ${unit}` : ''}</div>
        </div>
      )}
    </div>
  );
}
