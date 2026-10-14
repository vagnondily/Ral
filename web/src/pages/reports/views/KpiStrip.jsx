import React from 'react';
import { useI18n } from '../../../lib/i18n.jsx';
import { Empty, colLabel, formatCell, num } from './common.jsx';

/**
 * Tuiles de chiffres clés : valeur en chiffres tabulaires, libellé, raison quand la valeur
 * manque (« — » + raison, jamais « 0 % »).
 *  - bloc « kpis » : `values` / `notes` du serveur, `labels` / `units` du catalogue ;
 *  - jeu de données en vue « tuile » : la 1re ligne, une tuile par colonne (8 au plus).
 */
export function KpiTiles({ data, labels, units }) {
  const { tr } = useI18n();
  if (!data || !data.values) return null;
  return (
    <div className="rb-kpis" style={{ '--n': Object.keys(data.values).length }}>
      {Object.entries(data.values).map(([k, v]) => {
        const unit = units && units[k];
        const note = data.notes && data.notes[k];
        return (
          <div key={k} className="rb-kpi">
            <span className="rb-kpi-v">{v == null ? '—' : unit === 'pct' ? `${num(v, 1)} %` : unit === 'rate' ? `${num(v * 100, 1)} %` : num(v, unit === 'dec' || unit === 'mt' ? 1 : 0)}</span>
            <span className="rb-kpi-l">{tr(labels[k] || k)}</span>
            {v == null && note && <span className="rb-kpi-n">{note}</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function KpiStrip({ data, columns: pick }) {
  const { tr } = useI18n();
  if (!data || !data.rows.length) return <Empty note={data && data.meta && data.meta.note} />;
  const row = data.rows[0];
  const cols = (pick && pick.length ? data.columns.filter((c) => pick.includes(c.key)) : data.columns).filter((c) => c.type !== 'text' || row[c.key] != null).slice(0, 8);
  return (
    <div className="rb-kpis">
      {cols.map((c) => (
        <div key={c.key} className="rb-kpi">
          <span className="rb-kpi-v">{formatCell(c.type === 'money' ? 'money' : c.type, row[c.key], tr)}</span>
          <span className="rb-kpi-l">{colLabel(c, tr)}</span>
        </div>
      ))}
    </div>
  );
}
