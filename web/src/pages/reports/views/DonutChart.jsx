import React from 'react';
import { PALETTE, groupOthers, categoryColumn, chartSeries } from '../../../lib/reportViz.js';
import { useI18n } from '../../../lib/i18n.jsx';
import { ChartSvg } from './chartParts.jsx';
import { Empty, formatCell, num } from './common.jsx';
import { DataTable } from './DataTable.jsx';

/**
 * Anneau (part d'un tout) : une mesure, ses parts en ordre fixe de la palette ; au-delà de 5 parts
 * le volet « Présentation » conseille des barres ; au-delà de 7, « Autres ». La légende porte la
 * valeur et la part (étiquettes directes : la couleur n'est jamais seule).
 */
export default function DonutChart({ def, data, measure, title }) {
  const { tr } = useI18n();
  if (!data || !data.rows.length) return <Empty note={data && data.meta && data.meta.note} />;
  const x = categoryColumn(data);
  const [s] = chartSeries(def, data, { measure, max: 1 });
  if (!x || !s) return <DataTable data={data} />;
  const rows = groupOthers(data.rows.filter((r) => Number(r[s.key]) > 0), { valueKeys: [s.key], labelKey: x.key, othersLabel: tr('Autres') });
  const total = rows.reduce((a, r) => a + Number(r[s.key]), 0);
  if (!total) return <Empty note={data.meta && data.meta.note} />;
  const R = 70; const r0 = 44; const C = 90;
  let a0 = -Math.PI / 2;
  const arcs = rows.map((r, i) => {
    const v = Number(r[s.key]);
    const a1 = a0 + (v / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a, rad) => [C + rad * Math.cos(a), C + rad * Math.sin(a)];
    const [x0, y0] = p(a0, R); const [x1, y1] = p(a1, R); const [x2, y2] = p(a1, r0); const [x3, y3] = p(a0, r0);
    const d = rows.length === 1
      ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} L ${C - 0.01} ${C - r0} A ${r0} ${r0} 0 1 0 ${C} ${C - r0} Z`
      : `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`;
    a0 = a1;
    return { r, v, d, color: PALETTE[i % PALETTE.length], share: (v / total) * 100, label: formatCell(x.type, r[x.key], tr) };
  });
  return (
    <figure className="rb-chart rb-donut">
      <ChartSvg width={180} height={180} title={title || tr('Graphique en anneau')} desc={arcs.map((a) => `${a.label} : ${formatCell(s.type, a.v, tr)} (${num(a.share, 1)} %)`).join(' ; ')}>
        {arcs.map((a, i) => <path key={i} d={a.d} fill={a.color} stroke="#fff" strokeWidth="1.5"><title>{`${a.label} : ${formatCell(s.type, a.v, tr)}`}</title></path>)}
        <text x={C} y={C - 2} textAnchor="middle" className="rb-donut-total">{formatCell(s.type, total, tr)}</text>
        <text x={C} y={C + 14} textAnchor="middle" className="rb-axis">{tr('Total')}</text>
      </ChartSvg>
      <ul className="rb-donut-legend">
        {arcs.map((a, i) => <li key={i}><i style={{ background: a.color }} aria-hidden="true" /><span>{a.label}</span><b>{formatCell(s.type, a.v, tr)}</b><em>{num(a.share, 1)} %</em></li>)}
      </ul>
    </figure>
  );
}
