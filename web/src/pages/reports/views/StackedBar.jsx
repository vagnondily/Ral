import React from 'react';
import { useI18n } from '../../../lib/i18n.jsx';
import { PALETTE, categoryColumn, chartSeries } from '../../../lib/reportViz.js';
import { BAND, Empty, colLabel, formatCell, num } from './common.jsx';
import { Legend } from './chartParts.jsx';
import { DataTable } from './DataTable.jsx';

const CLASS_KEYS = ['exc', 'sat', 'imp', 'urg', 'na'];
const CLASS_COLOR = { exc: 'var(--cd-exc)', sat: 'var(--cd-sat)', imp: 'var(--cd-imp)', urg: 'var(--cd-urg)', na: 'var(--cd-na)' };

/**
 * Barres empilées à 100 % (part d'un tout, plusieurs lignes) : les classes (Excellent →
 * Non évalué) prennent leurs jetons --cd-* et leur libellé ; sinon les mesures déclarées, en
 * ordre fixe de la palette. Chaque segment assez large porte son effectif ; la légende nomme
 * toujours les parts (jamais la couleur seule).
 */
export default function StackedBar({ def, data }) {
  const { tr } = useI18n();
  if (!data || !data.rows.length) return <Empty note={data && data.meta && data.meta.note} />;
  const x = categoryColumn(data);
  const classes = CLASS_KEYS.every((k) => data.columns.some((c) => c.key === k));
  const parts = classes
    ? CLASS_KEYS.map((k) => ({ key: k, label: tr(BAND[k][0]), color: CLASS_COLOR[k], type: 'int' }))
    : chartSeries(def, data, { max: PALETTE.length }).map((s, i) => ({ key: s.key, label: colLabel(s, tr), color: PALETTE[i], type: s.type }));
  if (!x || parts.length < 2) return <DataTable data={data} />;
  return (
    <figure className="rb-chart rb-stacked">
      <Legend items={parts} />
      <div role="img" aria-label={tr('Barres empilées')}>
        {data.rows.map((r, i) => {
          const total = parts.reduce((a, p) => a + (Number(r[p.key]) || 0), 0);
          return (
            <div key={r._key || i} className={`rb-stack-row ${r._total ? 'rb-total' : ''}`}>
              <span className="rb-stack-label" title={formatCell(x.type, r[x.key], tr)}>{formatCell(x.type, r[x.key], tr)}</span>
              <span className="rb-stack-bar">
                {total > 0 ? parts.map((p) => {
                  const v = Number(r[p.key]) || 0;
                  if (!v) return null;
                  const w = (v / total) * 100;
                  return (
                    <span key={p.key} className="rb-stack-seg" style={{ width: `${w}%`, background: p.color }} title={`${p.label} : ${formatCell(p.type, v, tr)} (${num(w, 1)} %)`}>
                      {w >= 9 ? formatCell(p.type, v, tr) : ''}
                    </span>
                  );
                }) : <span className="rb-muted">—</span>}
              </span>
              <span className="rb-stack-total">{formatCell('int', total, tr)}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
