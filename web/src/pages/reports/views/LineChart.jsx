import React from 'react';
import { zeroScale, seriesColors, PALETTE } from '../../../lib/reportViz.js';
import { formatInt, monthLabel } from '../../../lib/format.js';
import { ChartSvg, Legend, clip, useChartData } from './chartParts.jsx';
import { Empty, colLabel, formatCell } from './common.jsx';
import { DataTable } from './DataTable.jsx';

/**
 * Courbes (évolution). Deux formes de données :
 *  - colonnes mensuelles « m:AAAA-MM » : une courbe par LIGNE (ex. complétude par activité),
 *    7 au plus (palette en ordre fixe) ;
 *  - lignes par mois : une courbe par MESURE (ex. indice de conformité, plan et réalisé).
 * Axe à zéro (pourcentages sur 0–100), points marqués, valeur au survol.
 */
export default function LineChart({ def, data, measure, title }) {
  const c = useChartData(def, data, measure, { others: false });
  if (!data || !data.rows.length) return <Empty note={data && data.meta && data.meta.note} />;
  const months = data.columns.filter((col) => col.key.startsWith('m:'));
  let xs; let lines;
  if (months.length) {
    const rows = data.rows.filter((r) => !r._total).slice(0, PALETTE.length);
    const labelKey = data.columns[0].key;
    const colors = seriesColors(rows.map((r, i) => `r${i}`));
    xs = months.map((m) => monthLabel(m.key.slice(2)));
    lines = rows.map((r, i) => ({ key: `r${i}`, label: String(r[labelKey]), color: colors[`r${i}`], type: 'pct', values: months.map((m) => (r[m.key] == null ? null : Number(r[m.key]))) }));
  } else {
    if (!c.series.length || !c.x) return <DataTable data={data} />;
    const rows = data.rows.filter((r) => !r._total);
    xs = rows.map((r) => c.label(r));
    lines = c.series.map((s) => ({ key: s.key, label: colLabel(s, c.tr), color: c.colors[s.key], type: s.type, values: rows.map((r) => (r[s.key] == null ? null : Number(r[s.key]))) }));
  }
  const pct = lines.every((l) => l.type === 'pct');
  const sc = zeroScale(lines.flatMap((l) => l.values.filter((v) => v != null)), { percent: pct });
  const W = 640; const H = 240; const pad = { l: 46, r: 14, t: 12, b: 36 };
  const n = xs.length;
  const xOf = (i) => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (n - 1));
  const span = sc.max - sc.min || 1;
  const yOf = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - sc.min) / span);
  const every = Math.max(1, Math.ceil(n / 10));
  const fmt = (l, v) => formatCell(l.type, v, c.tr);
  return (
    <figure className="rb-chart">
      <ChartSvg width={W} height={H} title={title || c.tr('Graphique en courbes')} desc={lines.map((l) => `${l.label} : ${l.values.map((v, i) => `${xs[i]} ${v == null ? '—' : fmt(l, v)}`).join(', ')}`).join(' ; ')}>
        {sc.ticks.map((tv) => (
          <g key={tv}>
            <line x1={pad.l} x2={W - pad.r} y1={yOf(tv)} y2={yOf(tv)} className={tv === 0 ? 'rb-zero' : 'rb-grid'} />
            <text x={pad.l - 6} y={yOf(tv) + 4} className="rb-axis" textAnchor="end">{pct ? `${formatInt(tv)} %` : formatInt(tv)}</text>
          </g>
        ))}
        {xs.map((x, i) => ((n - 1 - i) % every === 0 ? <text key={i} x={xOf(i)} y={H - pad.b + 16} className="rb-axis" textAnchor="middle"><title>{x}</title>{clip(x, 10)}</text> : null))}
        {lines.map((l) => {
          // Segments continus : une valeur absente coupe la courbe (jamais un faux zéro).
          const segs = []; let cur = [];
          l.values.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([xOf(i), yOf(v)]); });
          if (cur.length) segs.push(cur);
          return (
            <g key={l.key}>
              {segs.map((sg, k) => <polyline key={k} points={sg.map((p) => p.join(',')).join(' ')} fill="none" stroke={l.color} strokeWidth="2" />)}
              {l.values.map((v, i) => (v == null ? null : <circle key={i} cx={xOf(i)} cy={yOf(v)} r="2.8" fill={l.color}><title>{`${l.label} · ${xs[i]} : ${fmt(l, v)}`}</title></circle>))}
            </g>
          );
        })}
      </ChartSvg>
      <Legend items={lines.map((l) => ({ key: l.key, label: l.label, color: l.color }))} />
    </figure>
  );
}
