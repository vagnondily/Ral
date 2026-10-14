import React from 'react';
import { zeroScale } from '../../../lib/reportViz.js';
import { formatInt } from '../../../lib/format.js';
import { ChartSvg, Legend, clip, useChartData } from './chartParts.jsx';
import { Empty, colLabel, formatCell } from './common.jsx';
import { DataTable } from './DataTable.jsx';

/**
 * Colonnes VERTICALES (évolution, mois en abscisse) : axe à zéro, séries groupées (≤ 3),
 * prévu / réalisé en ambre et bleu, étiquettes de valeur seulement quand il y a la place,
 * étiquettes d'abscisse espacées (une sur k) pour ne jamais se chevaucher.
 */
export default function ColumnChart({ def, data, measure, title }) {
  const c = useChartData(def, data, measure, { others: false });
  if (!data || !data.rows.length) return <Empty note={data && data.meta && data.meta.note} />;
  if (!c.series.length || !c.x) return <DataTable data={data} />;
  const pct = c.series.every((s) => s.type === 'pct');
  const sc = zeroScale(c.rows.flatMap((r) => c.series.map((s) => Number(r[s.key]) || 0)), { percent: pct });
  const W = 640; const H = 240; const pad = { l: 46, r: 10, t: 14, b: 40 };
  const n = c.rows.length;
  const groupW = (W - pad.l - pad.r) / n;
  const barW = Math.max(3, Math.min(26, (groupW - 6) / c.series.length));
  const span = sc.max - sc.min || 1;
  const yOf = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - sc.min) / span);
  const every = Math.max(1, Math.ceil(n / 12));
  const showVals = barW >= 16;
  const desc = c.rows.map((r) => `${c.label(r)} : ${c.series.map((s) => formatCell(s.type, r[s.key], c.tr)).join(' / ')}`).join(' ; ');
  return (
    <figure className="rb-chart">
      <ChartSvg width={W} height={H} title={title || c.tr('Graphique en colonnes')} desc={desc}>
        {sc.ticks.map((tv) => (
          <g key={tv}>
            <line x1={pad.l} x2={W - pad.r} y1={yOf(tv)} y2={yOf(tv)} className={tv === 0 ? 'rb-zero' : 'rb-grid'} />
            <text x={pad.l - 6} y={yOf(tv) + 4} className="rb-axis" textAnchor="end">{pct ? `${formatInt(tv)} %` : formatInt(tv)}</text>
          </g>
        ))}
        {c.rows.map((r, i) => {
          const gx = pad.l + i * groupW + (groupW - barW * c.series.length) / 2;
          // Dernière catégorie toujours étiquetée (ancrage sur le dernier mois).
          const labelled = (n - 1 - i) % every === 0;
          return (
            <g key={r._key || i}>
              {c.series.map((s, k) => {
                const v = Number(r[s.key]);
                if (!Number.isFinite(v)) return null;
                const y0 = yOf(0); const y1 = yOf(v);
                return (
                  <g key={s.key}>
                    <rect x={gx + k * barW} y={Math.min(y0, y1)} width={barW - 2} height={Math.max(1, Math.abs(y1 - y0))} rx="2" fill={c.colors[s.key]}>
                      <title>{`${c.label(r)} · ${colLabel(s, c.tr)} : ${formatCell(s.type, v, c.tr)}`}</title>
                    </rect>
                    {showVals && <text x={gx + k * barW + (barW - 2) / 2} y={(v >= 0 ? y1 - 3 : y1 + 10)} className="rb-val" textAnchor="middle">{formatCell(s.type, v, c.tr)}</text>}
                  </g>
                );
              })}
              {labelled && <text x={gx + (barW * c.series.length) / 2} y={H - pad.b + 14} className="rb-axis" textAnchor="middle"><title>{c.label(r)}</title>{clip(c.label(r), 12)}</text>}
            </g>
          );
        })}
      </ChartSvg>
      <Legend items={c.legend} />
    </figure>
  );
}
