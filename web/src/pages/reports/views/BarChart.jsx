import React from 'react';
import { zeroScale } from '../../../lib/reportViz.js';
import { formatInt } from '../../../lib/format.js';
import { ChartSvg, Legend, clip, useChartData } from './chartParts.jsx';
import { Empty, colLabel, formatCell } from './common.jsx';
import { DataTable } from './DataTable.jsx';

/**
 * Barres HORIZONTALES (comparaison) : axe des valeurs à zéro, séries groupées (≤ 3), étiquette
 * de valeur au bout de chaque barre (texte en encre, jamais de la couleur de la série),
 * catégories lisibles à gauche, « Autres » au-delà de 7 catégories.
 */
export default function BarChart({ def, data, measure, title }) {
  const c = useChartData(def, data, measure);
  if (!data || !data.rows.length) return <Empty note={data && data.meta && data.meta.note} />;
  if (!c.series.length || !c.x) return <DataTable data={data} />;
  const pct = c.series.every((s) => s.type === 'pct');
  const sc = zeroScale(c.rows.flatMap((r) => c.series.map((s) => Number(r[s.key]) || 0)), { percent: pct });
  const W = 640; const labelW = 170; const pad = { l: labelW, r: 46, t: 6, b: 22 };
  const barH = Math.max(8, Math.min(18, 30 / c.series.length)); const gap = 8;
  const groupH = barH * c.series.length + gap;
  const H = pad.t + pad.b + groupH * c.rows.length;
  const span = sc.max - sc.min || 1;
  const xOf = (v) => pad.l + ((v - sc.min) / span) * (W - pad.l - pad.r);
  const desc = c.rows.map((r) => `${c.label(r)} : ${c.series.map((s) => formatCell(s.type, r[s.key], c.tr)).join(' / ')}`).join(' ; ');
  return (
    <figure className="rb-chart">
      <ChartSvg width={W} height={H} title={title || c.tr('Graphique en barres')} desc={desc}>
        {sc.ticks.map((tv) => (
          <g key={tv}>
            <line x1={xOf(tv)} x2={xOf(tv)} y1={pad.t} y2={H - pad.b} className={tv === 0 ? 'rb-zero' : 'rb-grid'} />
            <text x={xOf(tv)} y={H - 6} className="rb-axis" textAnchor="middle">{pct ? `${formatInt(tv)} %` : formatInt(tv)}</text>
          </g>
        ))}
        {c.rows.map((r, i) => {
          const y0 = pad.t + i * groupH;
          return (
            <g key={r._key || i}>
              <text x={pad.l - 8} y={y0 + (barH * c.series.length) / 2 + 4} className="rb-axis rb-cat" textAnchor="end"><title>{c.label(r)}</title>{clip(c.label(r), 28)}</text>
              {c.series.map((s, k) => {
                const v = Number(r[s.key]);
                if (!Number.isFinite(v)) return null;
                const x0 = xOf(0); const x1 = xOf(v);
                return (
                  <g key={s.key}>
                    <rect x={Math.min(x0, x1)} y={y0 + k * barH} width={Math.max(1, Math.abs(x1 - x0))} height={barH - 2} rx="2" fill={c.colors[s.key]}>
                      <title>{`${c.label(r)} · ${colLabel(s, c.tr)} : ${formatCell(s.type, v, c.tr)}`}</title>
                    </rect>
                    <text x={v >= 0 ? x1 + 4 : x1 - 4} y={y0 + k * barH + barH - 4} className="rb-val" textAnchor={v >= 0 ? 'start' : 'end'}>{formatCell(s.type, v, c.tr)}</text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </ChartSvg>
      <Legend items={c.legend} />
    </figure>
  );
}
