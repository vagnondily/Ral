import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Info } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Card, Skeleton, StatusBadge } from '../../components/ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, monthLabel, shortMonthLabel } from '../../lib/format.js';
import { downloadCsv } from '../../lib/csv.js';
import { periodLabel } from '../../lib/period.js';
import { EXPECTED_REASON, EXPECTED_STATUS, expectedKey, expectedWho } from '../../lib/reportExpectation.js';

/** Statuts comptés en tête de la carte, dans l'ordre. */
const CHIPS = ['en_retard', 'attendu', 'interne', 'soumis', 'valide', 'rejete', 'non_applicable_auto', 'non_applicable'];

/**
 * « Rapports attendus » (retour 114 : « pas de planification → pas de rapport (non applicable
 * d'office) ; si c'est nous, un rapport pour nous ») — pour chaque mois de la période : chaque TPM
 * (son rapport n'est attendu que s'il a des visites ce mois-là), et le rapport interne quand l'équipe
 * S&E suit elle-même des visites. Lecture seule, recalculé en direct (GET /api/tpm/reports/expected).
 * Props : { period: { from, to } } — la période des filtres de la page.
 */
export default function ExpectedReports({ period }) {
  const { tr, lang } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(true);
  const [showNa, setShowNa] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    api.expectedReports(period).then((r) => { if (live) setData(r); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [period.from, period.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const list = (data && data.rows) || [];
    return [...list].filter((r) => showNa || expectedKey(r) !== 'non_applicable_auto')
      .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
  }, [data, showNa]);
  const counts = useMemo(() => {
    const c = {};
    for (const r of (data && data.rows) || []) { const k = expectedKey(r); c[k] = (c[k] || 0) + 1; }
    return c;
  }, [data]);
  const why = (r) => {
    const t = EXPECTED_REASON[r.reason];
    return t ? tr(t, { due: monthLabel(r.due) }) : '';
  };

  function exportCsv() {
    const lines = [[tr('Mois'), tr('Qui'), tr('Visites prévues'), tr('Visites réalisées'), tr('Statut'), tr('Pourquoi'), tr('Échéance'), tr('Factures')]];
    for (const r of (data && data.rows) || []) {
      lines.push([r.month, expectedWho(tr, r), r.visits.planned, r.visits.realised, tr(EXPECTED_STATUS[expectedKey(r)].label), why(r), r.due,
        r.reports.map((x) => `${x.contractLabel || ''} ${tr((EXPECTED_STATUS[x.status] || {}).label || x.status)}`.trim()).join(' · ')]);
    }
    downloadCsv(`rapports_attendus_${period.from}_${period.to}.csv`, lines);
  }

  return (
    <Card className="expected-reports">
      <div className="card-header">
        <div>
          <h2 className="card-title">
            <button type="button" className="expander" aria-expanded={open} onClick={() => setOpen((o) => !o)}
              aria-label={open ? tr('Replier : {label}', { label: tr('Rapports attendus') }) : tr('Déplier : {label}', { label: tr('Rapports attendus') })}>
              {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            </button>
            {tr('Rapports attendus')} <span className="muted">· {periodLabel(period, lang)}</span>
          </h2>
          <p className="card-sub">{tr('Un TPM sans visite planifiée un mois n\'a pas de rapport à remettre (non applicable d\'office) ; quand l\'équipe S&E suit elle-même des visites, un rapport interne est attendu. À remettre au plus tard le mois suivant.')}</p>
        </div>
        <div className="exp-actions">
          <label className="tpa-all"><input type="checkbox" checked={showNa} onChange={(e) => setShowNa(e.target.checked)} /> {tr('Afficher les non applicables d\'office')}</label>
          <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!data}>{tr('Exporter (CSV)')}</Button>
        </div>
      </div>
      {error && <div className="card-body"><Alert tone="danger">{error}</Alert></div>}
      {!error && !data && <div className="card-body"><Skeleton height={64} /></div>}
      {data && (
        <div className="card-body exp-chips" role="list" aria-label={tr('Rapports attendus par statut')}>
          {CHIPS.filter((k) => counts[k]).map((k) => (
            <span key={k} role="listitem" className="exp-chip"><StatusBadge def={EXPECTED_STATUS[k]} /> <strong className="tabular">{formatInt(counts[k])}</strong></span>
          ))}
          {!data.rows.length && <span className="muted"><Info size={14} aria-hidden="true" /> {tr('Aucun TPM sous contrat de suivi ni visite sur la période.')}</span>}
        </div>
      )}
      {data && open && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{tr('Mois')}</th>
                <th scope="col">{tr('Qui')}</th>
                <th scope="col" className="num">{tr('Visites')}</th>
                <th scope="col">{tr('Statut')}</th>
                <th scope="col">{tr('Factures du mois')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.month}|${r.unit.kind}|${r.unit.providerId || ''}`}>
                  <td className="nowrap">{shortMonthLabel(r.month)}</td>
                  <td><strong>{expectedWho(tr, r)}</strong></td>
                  <td className="num tabular" title={tr('{p} prévue(s) · {r} réalisée(s)', { p: formatInt(r.visits.planned), r: formatInt(r.visits.realised) })}>
                    {formatInt(r.visits.planned + r.visits.realised)}
                  </td>
                  <td><StatusBadge def={EXPECTED_STATUS[expectedKey(r)]} />{why(r) && <div className="site-meta">{why(r)}</div>}</td>
                  <td>{r.reports.length ? r.reports.map((x) => (
                    <span key={x.id} className="exp-doc">{x.contractLabel ? <span className="mono">{x.contractLabel}</span> : null} <StatusBadge def={EXPECTED_STATUS[x.status]} /></span>
                  )) : <span className="cell-empty">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
