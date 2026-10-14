import React from 'react';
import { zeroScale, seriesColors, axisLabelLayout, PALETTE } from '../../../lib/reportViz.js';
import { formatInt, monthLabel, shortMonthLabel } from '../../../lib/format.js';
import { ChartSvg, Legend, XLabels, useChartData } from './chartParts.jsx';
import { Empty, colLabel, formatCell } from './common.jsx';
import { DataTable } from './DataTable.jsx';

/**
 * Courbes (évolution). Deux formes de données :
 *  - colonnes mensuelles « m:AAAA-MM » : une courbe par LIGNE (ex. complétude par activité),
 *    7 au plus (palette en ordre fixe) ;
 *  - lignes par mois : une courbe par MESURE (ex. indice de conformité, plan et réalisé).
 * Axe à zéro (pourcentages sur 0–100), points marqués, légende au-dessus dès 2 courbes, DERNIÈRE
 * valeur de chaque courbe écrite au bout jusqu'à 3 courbes (étiquettes écartées pour ne pas se
 * chevaucher), toutes les valeurs au survol. Abscisse : mois abrégés, droites, inclinées ou une sur k.
 */
export default function LineChart({ def, data, measure, title }) {
  const c = useChartData(def, data, measure, { others: false });
  if (!data || !data.rows.length) return <Empty note={data && data.meta && data.meta.note} />;
  const months = data.columns.filter((col) => col.key.startsWith('m:'));
  let xs; let full; let lines;
  if (months.length) {
    const rows = data.rows.filter((r) => !r._total).slice(0, PALETTE.length);
    const labelKey = data.columns[0].key;
    const colors = seriesColors(rows.map((r, i) => `r${i}`));
    xs = months.map((m) => shortMonthLabel(m.key.slice(2)));
    full = months.map((m) => monthLabel(m.key.slice(2)));
    lines = rows.map((r, i) => ({ key: `r${i}`, label: String(r[labelKey]), color: colors[`r${i}`], type: 'pct', values: months.map((m) => (r[m.key] == null ? null : Number(r[m.key]))) }));
  } else {
    if (!c.series.length || !c.x) return <DataTable data={data} />;
    const rows = data.rows.filter((r) => !r._total);
    xs = rows.map((r) => c.axisLabel(r));
    full = rows.map((r) => c.label(r));
    lines = c.series.map((s) => ({ key: s.key, label: colLabel(s, c.tr), color: c.colors[s.key], type: s.type, values: rows.map((r) => (r[s.key] == null ? null : Number(r[s.key]))) }));
  }
  const pct = lines.every((l) => l.type === 'pct');
  const sc = zeroScale(lines.flatMap((l) => l.values.filter((v) => v != null)), { percent: pct });
  const fmt = (l, v) => formatCell(l.type, v, c.tr);
  const W = 640; const plotH = 190;
  const n = xs.length;
  // Dernière valeur écrite au bout de chaque courbe (3 courbes au plus : au-delà, la légende et le
  // survol suffisent, les étiquettes se gêneraient) ; place réservée à droite.
  const labelEnds = lines.length <= 3;
  const endW = !labelEnds ? 0 : Math.min(64, 10 + Math.max(0, ...lines.map((l) => { const v = [...l.values].reverse().find((x) => x != null); return v == null ? 0 : fmt(l, v).length * 5.6; })));
  const padL = 46; const padR = endW + 8; const padT = 12;
  const plotW = W - padL - padR;
  const xOf = (i) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const layout = axisLabelLayout(xs, { plotW, slot: n > 1 ? plotW / (n - 1) : plotW });
  const padB = layout.height + 8;
  const H = padT + plotH + padB;
  const span = sc.max - sc.min || 1;
  const yOf = (v) => padT + plotH * (1 - (v - sc.min) / span);
  // Dernières valeurs : écartées d'au moins 11 px verticalement, dans l'ordre de leur hauteur, et
  // gardées dans le tracé (remontées si la dernière déborde sous l'axe).
  const ends = !labelEnds ? [] : lines.map((l) => {
    let i = l.values.length - 1;
    while (i >= 0 && l.values[i] == null) i -= 1;
    return i < 0 ? null : { key: l.key, i, v: l.values[i], y: yOf(l.values[i]), text: fmt(l, l.values[i]) };
  }).filter(Boolean).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k += 1) if (ends[k].y - ends[k - 1].y < 11) ends[k].y = ends[k - 1].y + 11;
  const overflow = ends.length ? ends[ends.length - 1].y - (padT + plotH) : 0;
  if (overflow > 0) ends.forEach((e) => { e.y -= overflow; });
  return (
    <figure className="rb-chart">
      <Legend items={lines.map((l) => ({ key: l.key, label: l.label, color: l.color }))} line />
      <ChartSvg width={W} height={H} title={title || c.tr('Graphique en courbes')} desc={lines.map((l) => `${l.label} : ${l.values.map((v, i) => `${full[i]} ${v == null ? '—' : fmt(l, v)}`).join(', ')}`).join(' ; ')}>
        {sc.ticks.map((tv) => (
          <g key={tv}>
            <line x1={padL} x2={padL + plotW} y1={yOf(tv)} y2={yOf(tv)} className={tv === 0 ? 'rb-zero' : 'rb-grid'} />
            <text x={padL - 6} y={yOf(tv) + 4} className="rb-axis" textAnchor="end">{pct ? `${formatInt(tv)} %` : formatInt(tv)}</text>
          </g>
        ))}
        <XLabels width={W} layout={layout} xs={xs.map((_, i) => xOf(i))} y={padT + plotH + 15} labels={xs} full={full} />
        {lines.map((l) => {
          // Segments continus : une valeur absente coupe la courbe (jamais un faux zéro).
          const segs = []; let cur = [];
          l.values.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([xOf(i), yOf(v)]); });
          if (cur.length) segs.push(cur);
          return (
            <g key={l.key}>
              {segs.map((sg, k) => <polyline key={k} points={sg.map((p) => p.join(',')).join(' ')} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" />)}
              {l.values.map((v, i) => (v == null ? null : <circle key={i} cx={xOf(i)} cy={yOf(v)} r="2.8" fill={l.color}><title>{`${l.label} · ${full[i]} : ${fmt(l, v)}`}</title></circle>))}
            </g>
          );
        })}
        {ends.map((e) => (
          <text key={e.key} x={xOf(e.i) + 7} y={e.y + 3.5} className="rb-val rb-end">{e.text}</text>
        ))}
      </ChartSvg>
    </figure>
  );
}
