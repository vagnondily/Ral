import React from 'react';
import { Download } from 'lucide-react';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';
import { formatRate } from '../../lib/mapScale.js';
import { downloadCsv } from '../../lib/csv.js';

const rateCell = (r, lang, tr) => (r.reason === 'aucun_plan' ? tr('— aucun plan') : r.value == null ? '—' : formatRate(r.value, lang));

/**
 * « Voir en tableau » (lot 6a) : l'alternative accessible de la carte — un contour par
 * ligne avec tous ses comptes et taux, puis les lignes « région seulement » et le
 * total ; export CSV (mêmes valeurs, formules neutralisées par lib/csv).
 */
export default function MapTable({ data, periodText, fileName }) {
  const { tr, lang } = useI18n();
  const rows = [
    ...data.shapes.map((s) => ({ name: s.districts.map((d) => d.name).join(' + '), region: s.region, z: s })),
    ...(data.regionOnly || []).map((r) => ({ name: tr('{r} — région seulement', { r: r.name }), region: r.name, z: r })),
  ];
  const cols = [
    [tr('Sites actifs'), (z) => z.counts.active],
    [tr('Réalisés'), (z) => z.counts.realised],
    [tr('dont par les données'), (z) => z.counts.realisedData],
    [tr('Couverture'), (z) => rateCell(z.rates.coverage, lang, tr), true],
    [tr('Prévus'), (z) => z.counts.planned],
    [tr('Planification'), (z) => rateCell(z.rates.planning, lang, tr), true],
    [tr('Visites prévues'), (z) => z.counts.visitsPlanned],
    [tr('Exécution du plan'), (z) => rateCell(z.rates.execution, lang, tr), true],
    [tr('Hors plan'), (z) => z.counts.visitsOffPlan],
    [tr('Risque élevé'), (z) => z.counts.riskHigh],
    [tr('Jamais visités'), (z) => z.counts.neverVisited],
    [tr('Données versées'), (z) => z.counts.submissions],
    [tr('dont au site'), (z) => z.counts.submissionsSite],
  ];
  const exportCsv = () => {
    const head = [tr('District'), tr('Région'), ...cols.map((c) => c[0])];
    const body = rows.map((r) => [r.name, r.region || '', ...cols.map((c) => c[1](r.z))]);
    body.push([tr('Total'), '', ...cols.map((c) => c[1](data.totals))]);
    downloadCsv(`${fileName}.csv`, [head, ...body]);
  };
  return (
    <div className="card biz-card mapx-table">
      <div className="card-header">
        <div><div className="card-title">{tr('Carte du suivi — tableau')}</div><div className="card-sub">{tr('Un contour par ligne · {p} · sites distincts sur la période', { p: periodText })}</div></div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv}><Download size={14} aria-hidden="true" />{tr('Exporter CSV')}</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{tr('District')}</th><th>{tr('Région')}</th>{cols.map((c) => <th key={c[0]} className="num">{c[0]}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td><strong>{r.name}</strong></td><td>{r.region || '—'}</td>
                {cols.map((c) => <td key={c[0]} className="num tabular">{c[2] ? c[1](r.z) : formatInt(c[1](r.z))}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td><strong>{tr('Total')}</strong></td><td />{cols.map((c) => <td key={c[0]} className="num tabular">{c[2] ? c[1](data.totals) : formatInt(c[1](data.totals))}</td>)}</tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
