import React from 'react';
import { zeroScale, axisLabelLayout } from '../../../lib/reportViz.js';
import { formatInt } from '../../../lib/format.js';
import { ChartSvg, Legend, XLabels, useChartData } from './chartParts.jsx';
import { Empty, colLabel, formatCell } from './common.jsx';
import { DataTable } from './DataTable.jsx';

/**
 * Colonnes VERTICALES (évolution, mois en abscisse) : axe à zéro, séries groupées (≤ 3),
 * prévu / réalisé en ambre et bleu, légende au-dessus dès 2 séries, étiquettes de valeur quand
 * il y a la place. Abscisse : mois abrégés (« oct. 25 »), toutes droites si elles tiennent,
 * sinon inclinées, sinon une sur k ancrée sur le dernier mois — jamais de chevauchement.
 */
export default function ColumnChart({ def, data, measure, title }) {
  const c = useChartData(def, data, measure, { others: false });
  if (!data || !data.rows.length) return <Empty note={data && data.meta && data.meta.note} />;
  if (!c.series.length || !c.x) return <DataTable data={data} />;
  const pct = c.series.every((s) => s.type === 'pct');
  const sc = zeroScale(c.rows.flatMap((r) => c.series.map((s) => Number(r[s.key]) || 0)), { percent: pct });
  const W = 640; const plotH = 190;
  const n = c.rows.length;
  const padL = 46; const padR = 10; const padT = 16;
  const plotW = W - padL - padR;
  const groupW = plotW / n;
  const labels = c.rows.map((r) => c.axisLabel(r));
  const layout = axisLabelLayout(labels, { plotW, slot: groupW });
  const padB = layout.height + 8;
  const H = padT + plotH + padB;
  const barW = Math.max(3, Math.min(28, (groupW - 8) / c.series.length));
  const span = sc.max - sc.min || 1;
  const yOf = (v) => padT + plotH * (1 - (v - sc.min) / span);
  // Valeurs écrites quand la colonne est assez large pour son nombre (sinon : au survol et dans le tableau).
  const showVals = barW >= 15;
  // Beaucoup de catégories : un zéro n'est pas écrit (colonne absente, valeur au survol et dans le tableau).
  const hideZero = n > 6;
  const xs = c.rows.map((r, i) => padL + i * groupW + groupW / 2);
  const desc = c.rows.map((r) => `${c.label(r)} : ${c.series.map((s) => formatCell(s.type, r[s.key], c.tr)).join(' / ')}`).join(' ; ');
  return (
    <figure className="rb-chart">
      <Legend items={c.legend} />
      <ChartSvg width={W} height={H} title={title || c.tr('Graphique en colonnes')} desc={desc}>
        {sc.ticks.map((tv) => (
          <g key={tv}>
            <line x1={padL} x2={W - padR} y1={yOf(tv)} y2={yOf(tv)} className={tv === 0 ? 'rb-zero' : 'rb-grid'} />
            <text x={padL - 6} y={yOf(tv) + 4} className="rb-axis" textAnchor="end">{pct ? `${formatInt(tv)} %` : formatInt(tv)}</text>
          </g>
        ))}
        {c.rows.map((r, i) => {
          const gx = xs[i] - (barW * c.series.length) / 2;
          return (
            <g key={r._key || i}>
              {c.series.map((s, k) => {
                const v = Number(r[s.key]);
                if (r[s.key] == null || !Number.isFinite(v)) return null;
                const y0 = yOf(0); const y1 = yOf(v);
                return (
                  <g key={s.key}>
                    <rect x={gx + k * barW + 1} y={Math.min(y0, y1)} width={barW - 2} height={Math.max(1, Math.abs(y1 - y0))} rx="2" fill={c.colors[s.key]}>
                      <title>{`${c.label(r)} · ${colLabel(s, c.tr)} : ${formatCell(s.type, v, c.tr)}`}</title>
                    </rect>
                    {showVals && !(hideZero && v === 0) && <text x={gx + k * barW + barW / 2} y={(v >= 0 ? y1 - 4 : y1 + 11)} className="rb-val" textAnchor="middle">{formatCell(s.type, v, c.tr)}</text>}
                  </g>
                );
              })}
            </g>
          );
        })}
        <XLabels width={W} layout={layout} xs={xs} y={padT + plotH + 15} labels={labels} full={c.rows.map((r) => c.label(r))} />
      </ChartSvg>
    </figure>
  );
}
