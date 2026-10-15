import React from 'react';
import { Download } from 'lucide-react';
import { Button } from './ui.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { formatInt } from '../lib/format.js';
import { downloadCsv } from '../lib/csv.js';
import { activityTableRows, barPct, rateText, waysText } from '../lib/coverageDefs.js';

const barColor = (pct) => (pct >= 80 ? 'var(--green)' : (pct >= 50 ? 'var(--blue-600)' : 'var(--orange)'));
const pctOf = (rate) => (rate == null ? '' : Math.round(rate * 1000) / 10);

/**
 * Couverture par activité (retours 54, 76, 110) : une ligne par libellé d'activité du registre, sur
 * l'univers de la page et avec le même « suivi » que les tuiles (visite déclarée ou données reçues) ;
 * la ligne Total = les tuiles = la somme des lignes. Partagée par la Synthèse et « Couverture &
 * performance » (GET /api/dashboards/coverage) : les deux pages montrent les mêmes chiffres.
 */
export default function ActivityCoverageCard({ cov, error, periodText, className = 'syn-full' }) {
  const { tr, lang } = useI18n();
  const { rows, total } = activityTableRows(cov);
  const exportCsv = () => downloadCsv(`couverture_par_activite_${periodText || ''}.csv`.replace(/\s+/g, '_'), [
    [tr('Activité'), tr('Sites actifs'), tr('Sites prévus'), tr('Sites suivis'), tr('dont par données reçues'), tr('dont par visites déclarées'),
      tr('Couverture (sites) %'), tr('Exécution (sites) %')],
    ...rows.map((r) => [r.label || tr('Sans activité'), r.sites, r.planned, r.covered, r.byData, r.byVisit, pctOf(r.coverage), pctOf(r.execution)]),
    [tr('Total (sites distincts)'), total.sites, total.planned, total.covered, total.byData, total.byVisit, pctOf(total.coverage), pctOf(total.execution)],
  ]);
  const rateCell = (rate, num, den, none) => {
    const pct = barPct(rate);
    if (pct == null) return <span className="muted">{none}</span>;
    return (
      <span className="syn-bar-cell"><span className="biz-bar"><span style={{ width: `${pct}%`, background: barColor(pct) }} /></span>
        <span className="tabular syn-pct">{rateText(rate, lang)}<span className="syn-sub">{formatInt(num)}/{formatInt(den)}</span></span></span>
    );
  };
  const ways = (r) => waysText(tr, { covered: r.covered, byData: r.byData, byVisit: r.byVisit, both: r.both }, formatInt) || undefined;
  return (
    <div className={`card biz-card ${className}`}>
      <div className="card-header">
        <div><div className="card-title">{tr('Couverture par activité')}</div>
          <div className="card-sub">{tr('Sites actifs de la période ; suivi = visite déclarée ou données reçues · couverture = suivis ÷ actifs · exécution = prévus suivis ÷ prévus (mois échus)')}</div></div>
        {!error && rows.length > 0 && <Button size="sm" variant="ghost" icon={Download} onClick={exportCsv}>CSV</Button>}
      </div>
      {error ? <div className="card-body"><p className="muted" role="alert">{error}</p></div> : rows.length === 0 ? (
        <div className="card-body"><p className="muted">{tr('Aucun site actif sur la période.')}</p></div>
      ) : (
        <>
          <div className="table-wrap syn-scroll">
            <table className="table syn-table act-table">
              <thead><tr>
                <th scope="col">{tr('Activité')}</th>
                <th scope="col" className="num">{tr('Sites actifs')}</th>
                <th scope="col" className="num">{tr('Prévus')}</th>
                <th scope="col" className="num">{tr('Suivis')}</th>
                <th scope="col">{tr('Couverture (sites)')}</th>
                <th scope="col">{tr('Exécution (sites)')}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label || <span className="muted">{tr('Sans activité')}</span>}</td>
                    <td className="num tabular">{formatInt(r.sites)}</td>
                    <td className="num tabular">{r.planned ? formatInt(r.planned) : <span className="cell-empty">—</span>}</td>
                    <td className="num tabular" title={ways(r)}>{r.covered ? formatInt(r.covered) : <span className="cell-empty">—</span>}</td>
                    <td className="syn-cov">{rateCell(r.coverage, r.covered, r.sites, '—')}</td>
                    <td className="syn-cov">{rateCell(r.execution, r.plannedCovered, r.planned, tr('— aucun plan'))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td>{tr('Total (sites distincts)')}</td>
                <td className="num tabular">{formatInt(total.sites)}</td>
                <td className="num tabular">{formatInt(total.planned)}</td>
                <td className="num tabular" title={ways(total)}>{formatInt(total.covered)}</td>
                <td className="tabular">{total.coverage == null ? '—' : rateText(total.coverage, lang)}</td>
                <td className="tabular">{total.execution == null ? <span className="muted">{tr('— aucun plan')}</span> : rateText(total.execution, lang)}</td>
              </tr></tfoot>
            </table>
          </div>
          <p className="card-foot-note muted">{tr('Une ligne par libellé d\'activité du registre des sites : deux libellés différents restent deux lignes tant que le référentiel des activités ne les relie pas.')}</p>
        </>
      )}
    </div>
  );
}
