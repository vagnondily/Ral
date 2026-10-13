import React, { useEffect, useRef, useState } from 'react';
import { formatInt, monthLabel, shortMonthLabel } from '../../lib/format.js';
import { tickIndexes, yScale } from '../../lib/chartAxis.js';

/**
 * Courbe mensuelle partagée (Synthèse, Couverture & performance) — sans
 * dépendance. Une seule mesure, donc un seul axe des valeurs.
 *
 * Lisible à toutes les tailles : la largeur RÉELLE est mesurée (ResizeObserver)
 * et sert de viewBox en pixels, le texte n'est donc jamais agrandi ni rétréci ;
 * le nombre d'étiquettes de mois découle de cette largeur (chartAxis.tickIndexes,
 * ancrées sur le dernier mois = le mois choisi, jamais de chevauchement) ;
 * mois en clair et traduits (shortMonthLabel) ; graduations horizontales
 * discrètes ; survol = repère vertical + info-bulle (et <title> pour les
 * lecteurs d'écran).
 *
 * @param {{ data: {month:string}[], valueKey?:string, selected?:string, height?:number,
 *           label:string, unit?:string, empty:React.ReactNode, format?:(n:number)=>string }} props
 */
const LABEL_W = 52; // place réservée par étiquette de mois (« sept. 26 » + marge)

export default function TrendChart({ data, valueKey = 'submissions', selected, height = 168, label, unit = '', empty, format = formatInt }) {
  const wrap = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
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
  // Au plus une étiquette par LABEL_W pixels : deux étiquettes voisines ne se touchent jamais.
  const marks = tickIndexes(n, Math.max(1, Math.floor(plotW / LABEL_W)));
  const anchor = (i) => (x(i) - LABEL_W / 2 < 0 ? 'start' : x(i) + LABEL_W / 2 > w ? 'end' : 'middle');
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
        <polygon className="trend-area" points={area} />
        <polyline className="trend-line" points={pts} />
        {hover != null && <line className="trend-cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + plotH} />}
        {values.map((v, i) => (
          <circle key={rows[i].month} className={`trend-dot${rows[i].month === selected ? ' is-selected' : ''}`}
            cx={x(i)} cy={y(v)} r={rows[i].month === selected || hover === i ? 5 : 3.5}>
            <title>{tipFor(i)}</title>
          </circle>
        ))}
        {marks.map((i) => (
          <text key={`t${rows[i].month}`} className={`trend-axis${rows[i].month === selected ? ' is-selected' : ''}`}
            x={x(i)} y={height - 7} textAnchor={anchor(i)}>{shortMonthLabel(rows[i].month)}</text>
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
