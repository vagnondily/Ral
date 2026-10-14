import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, Info } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Card, EmptyState, PageHeader, Skeleton } from '../../components/ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';
import { downloadCsv } from '../../lib/csv.js';

/**
 * Dashboard décisionnel › Rapport trimestriel (retour 54) : par activité et par trimestre,
 * sites uniques actifs / prévus / réalisés, Couverture (réalisés ÷ actifs) et Taux
 * d'exécution (réalisés ÷ prévus), ligne Total et colonne Année — fidèle au classeur MMR.
 * Tout vient du service des faits site × mois (mêmes chiffres que la carte et la tuile
 * Couverture) ; rien n'est stocké. Les taux sont colorés du rouge au vert ET écrits.
 */
const METRICS = [
  { key: 'active', label: 'Actifs', title: 'Sites uniques actifs' },
  { key: 'planned', label: 'Prévus', title: 'Sites uniques prévus' },
  { key: 'realised', label: 'Réalisés', title: 'Sites uniques réalisés' },
  { key: 'coverage', label: 'Couv.', title: 'Couverture = réalisés ÷ actifs', rate: true },
  { key: 'execution', label: 'Exéc.', title: 'Taux d\'exécution = réalisés ÷ prévus', rate: true },
];
const pct = (r) => (r == null ? '—' : `${(Math.round(r * 1000) / 10).toLocaleString('fr-FR')} %`);

export default function QuarterlyReportPage() {
  const { tr } = useI18n();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [officeId, setOfficeId] = useState('');
  const [offices, setOffices] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.listOffices().then((o) => setOffices(o || [])).catch(() => setOffices([])); }, []);
  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    api.quarterlyReport({ year, officeId: officeId || undefined })
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [year, officeId]);

  const periodLabelOf = (p) => (p.key === 'year' ? tr('Année {y}', { y: year }) : `${p.key} ${year}`);
  const rows = useMemo(() => (data ? [...data.rows.map((r) => ({ ...r, name: r.label || tr('Sans activité') })), { name: tr('Total (sites distincts)'), cells: data.total, total: true }] : []), [data, tr]);

  function exportCsv() {
    const head = [tr('Activité')];
    for (const p of data.periods) for (const m of METRICS) head.push(`${periodLabelOf(p)} — ${tr(m.title)}`);
    const out = [head];
    for (const r of rows) {
      const line = [r.name];
      for (const p of data.periods) for (const m of METRICS) { const v = r.cells[p.key][m.key]; line.push(m.rate ? (v == null ? '' : Math.round(v * 1000) / 10) : v); }
      out.push(line);
    }
    downloadCsv(`rapport_trimestriel_${year}.csv`, out);
  }
  async function exportXlsx() {
    setBusy(true);
    try { await api.quarterlyReportXlsx({ year, officeId: officeId || undefined }); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="section-gap">
      <PageHeader title={tr('Rapport trimestriel par activité')}
        description={tr('Sites uniques actifs, prévus et réalisés par activité et par trimestre ; couverture et taux d\'exécution.')}>
        <div className="year-nav" role="group" aria-label={tr('Année')}>
          <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label={tr('Année précédente')} onClick={() => setYear((y) => y - 1)} />
          <strong className="tabular">{year}</strong>
          <Button size="sm" variant="ghost" icon={ChevronRight} aria-label={tr('Année suivante')} onClick={() => setYear((y) => y + 1)} />
        </div>
        <select className="select" value={officeId} onChange={(e) => setOfficeId(e.target.value)} aria-label={tr('Bureau')}>
          <option value="">{tr('Tous les bureaux')}</option>
          {offices.map((o) => <option key={o.id} value={o.id}>{o.parentId ? '— ' : ''}{o.name}</option>)}
        </select>
        <Button size="sm" variant="secondary" icon={Download} disabled={!data} onClick={exportCsv}>CSV</Button>
        <Button size="sm" variant="secondary" icon={FileSpreadsheet} disabled={!data} loading={busy} onClick={exportXlsx}>Excel</Button>
      </PageHeader>

      {error && <Alert tone="danger">{error}</Alert>}
      {!data && !error ? <Card><div className="card-body"><Skeleton height={260} /></div></Card> : null}
      {data && rows.length <= 1 && <Card><EmptyState title={tr('Aucun site dans le registre')}>{tr('Importez le registre des sites (Paramétrage › Localités › Sites).')}</EmptyState></Card>}
      {data && rows.length > 1 && (
        <Card>
          <div className="table-wrap quarterly-wrap">
            <table className="table quarterly-table">
              <thead>
                <tr>
                  <th rowSpan={2} scope="col" className="q-first">{tr('Activité')}</th>
                  {data.periods.map((p) => (
                    <th key={p.key} colSpan={METRICS.length} scope="colgroup" className={`q-group${p.key === 'year' ? ' is-year' : ''}`}>
                      {periodLabelOf(p)}{p.upcoming ? <span className="q-upcoming"> · {tr('à venir')}</span> : null}
                    </th>
                  ))}
                </tr>
                <tr>
                  {data.periods.map((p) => METRICS.map((m, i) => (
                    <th key={`${p.key}-${m.key}`} scope="col" title={tr(m.title)} className={`num${i === 0 ? ' q-start' : ''}`}>{tr(m.label)}</th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className={r.total ? 'is-total' : ''}>
                    <th scope="row" className="q-first">{r.name}</th>
                    {data.periods.map((p) => METRICS.map((m, i) => {
                      const c = r.cells[p.key];
                      if (!m.rate) return <td key={`${p.key}-${m.key}`} className={`num tabular${i === 0 ? ' q-start' : ''}`}>{formatInt(c[m.key])}</td>;
                      const b = c[`${m.key}Band`];
                      return <td key={`${p.key}-${m.key}`} className={`num tabular q-rate band-${b}`} title={tr(m.title)}>{pct(c[m.key])}</td>;
                    }))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="note" style={{ margin: 16 }}>
            <Info size={16} aria-hidden="true" />
            <span>
              {tr('Sites comptés une fois par trimestre. Réalisé = visite réalisée ou soumission rattachée au site, pendant un mois où il est actif. Couverture = réalisés ÷ actifs ; Taux d\'exécution = réalisés ÷ prévus ; « — » quand il n\'y a aucun site actif ou prévu.')}
              {' '}{tr('Couleurs : moins de 40 %, 40–59 %, 60–79 %, 80 % et plus.')}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
