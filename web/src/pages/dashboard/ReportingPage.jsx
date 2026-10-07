import React, { useEffect, useState } from 'react';
import { Download, Printer, FileSpreadsheet, MapPin } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Card, CardHeader, EmptyState, Skeleton, Stats } from '../../components/ui.jsx';
import MonthPicker from '../../components/MonthPicker.jsx';
import { formatAr, formatInt, currentMonth } from '../../lib/format.js';

/**
 * Reporting — rapport de synthèse S&E pour une période : situation budgétaire
 * (consolidation) et couverture terrain (visites). Lecture seule, recalculé en
 * direct ; exports CSV + impression (PDF via le navigateur). Rien n'est stocké.
 * Structure COMET : section-gap + page-header + Stats compact + Card/table.
 */
function downloadCsv(name, rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = rows.map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function ReportingPage({ onOpenContract }) {
  const [month, setMonth] = useState(currentMonth);
  const [cons, setCons] = useState(null);
  const [field, setField] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setCons(null);
    Promise.all([api.consolidation(), api.fieldSummary(month)])
      .then(([c, f]) => { if (alive) { setCons(c); setField(f); } })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [month]);

  const t = cons?.totals;
  const ov = field?.overall;

  const exportBudget = () => {
    const rows = [['Contrat', 'Prestataire', 'Budget', 'Planifié', 'Réalisé', 'Taux', 'Restant', 'Projection fin']];
    for (const r of cons.rows) rows.push([r.numero, r.partnerName, Math.round(r.budget), Math.round(r.planned), Math.round(r.actual), `${Math.round((r.actualRate || 0) * 100)}%`, Math.round(r.remaining), Math.round(r.projectedTotal)]);
    downloadCsv(`synthese-budget-${month}.csv`, rows);
  };
  const exportCoverage = () => {
    const rows = [['District', 'Planifiées', 'Réalisées', 'Annulées', 'Taux couverture']];
    for (const d of field.byDistrict) rows.push([d.label, d.planifie, d.realise, d.annule, `${Math.round(d.rate * 100)}%`]);
    downloadCsv(`couverture-terrain-${month}.csv`, rows);
  };

  return (
    <div className="section-gap">
      <div className="page-header">
        <div>
          <h1 className="page-title">Rapport de synthèse S&amp;E</h1>
          <p className="page-desc">Situation budgétaire et couverture terrain pour la période, recalculées en direct. Exportez en CSV ou imprimez (PDF).</p>
        </div>
        <div className="header-actions">
          <MonthPicker value={month} onChange={setMonth} />
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Imprimer / PDF</Button>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <Stats compact items={[
        { label: 'Budget de suivi', value: cons ? formatAr(t.budget) : '—', foot: cons ? `${t.contracts} contrat(s)` : 'Consolidation' },
        { label: 'Réalisé (justifié)', value: cons ? formatAr(t.actual) : '—', foot: cons ? `${Math.round((t.actualRate || 0) * 100)} % du budget` : 'Factures validées' },
        { label: 'Budget restant', value: cons ? formatAr(t.remaining) : '—', foot: 'Disponible' },
        { label: 'Couverture terrain', value: ov ? `${Math.round((ov.rate || 0) * 100)} %` : '—', foot: ov ? `${ov.realise}/${ov.active} visites` : 'Mois courant' },
      ]} />

      <Card aria-labelledby="rep-budget">
        <CardHeader id="rep-budget" title="Situation budgétaire par contrat" subtitle="Budget ↔ Planifié ↔ Réalisé, taux de consommation, restant et projection de fin.">
          {cons && cons.rows.length > 0 && <Button size="sm" variant="secondary" icon={FileSpreadsheet} onClick={exportBudget}>Exporter CSV</Button>}
        </CardHeader>
        {cons === null ? (
          <div className="card-body"><Skeleton height={160} /></div>
        ) : cons.rows.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title="Aucun contrat de suivi actif">La synthèse budgétaire s'affiche dès qu'un contrat actif porte un budget « Suivi ».</EmptyState>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr>
              <th scope="col">Contrat</th><th scope="col">Prestataire</th><th scope="col" className="num">Budget</th>
              <th scope="col" className="num">Planifié</th><th scope="col" className="num">Réalisé</th><th scope="col" className="num">Taux</th>
              <th scope="col" className="num">Restant</th><th scope="col" className="num">Projection fin</th>
            </tr></thead>
            <tbody>
              {cons.rows.map((r) => (
                <tr key={r.contractId} className="clickable" onClick={() => onOpenContract && onOpenContract(r.contractId)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpenContract && onOpenContract(r.contractId); }} tabIndex={0}>
                  <td><strong>{r.numero}</strong></td><td>{r.partnerName}</td>
                  <td className="num mono">{formatAr(r.budget)}</td>
                  <td className="num mono">{formatAr(r.planned)}</td>
                  <td className="num mono">{formatAr(r.actual)}</td>
                  <td className="num mono" style={{ color: r.overspent ? 'var(--red)' : undefined }}>{Math.round((r.actualRate || 0) * 100)} %</td>
                  <td className="num mono">{formatAr(r.remaining)}</td>
                  <td className="num mono">{formatAr(r.projectedTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td colSpan={2}><strong>Total</strong></td>
              <td className="num mono"><strong>{formatAr(t.budget)}</strong></td>
              <td className="num mono"><strong>{formatAr(t.planned)}</strong></td>
              <td className="num mono"><strong>{formatAr(t.actual)}</strong></td>
              <td className="num mono"><strong>{Math.round((t.actualRate || 0) * 100)} %</strong></td>
              <td className="num mono"><strong>{formatAr(t.remaining)}</strong></td>
              <td />
            </tr></tfoot>
          </table></div>
        )}
      </Card>

      <Card aria-labelledby="rep-cover">
        <CardHeader id="rep-cover" title={`Couverture terrain par district — ${month}`} subtitle="Visites planifiées, réalisées et annulées du mois ; taux = réalisées ÷ (planifiées + réalisées).">
          {field?.byDistrict?.length > 0 && <Button size="sm" variant="secondary" icon={Download} onClick={exportCoverage}>Exporter CSV</Button>}
        </CardHeader>
        {cons === null ? (
          <div className="card-body"><Skeleton height={140} /></div>
        ) : field?.byDistrict?.length > 0 ? (
          <div className="table-wrap"><table className="table">
            <thead><tr>
              <th scope="col">District</th><th scope="col" className="num">Planifiées</th><th scope="col" className="num">Réalisées</th>
              <th scope="col" className="num">Annulées</th><th scope="col" className="num">Taux</th>
            </tr></thead>
            <tbody>
              {field.byDistrict.map((d) => (
                <tr key={d.key}><td><strong>{d.label}</strong></td>
                  <td className="num mono">{formatInt(d.planifie)}</td>
                  <td className="num mono">{formatInt(d.realise)}</td>
                  <td className="num mono">{formatInt(d.annule)}</td>
                  <td className="num mono">{Math.round(d.rate * 100)} %</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td><strong>Total</strong></td>
              <td className="num mono"><strong>{formatInt(ov.planifie)}</strong></td>
              <td className="num mono"><strong>{formatInt(ov.realise)}</strong></td>
              <td className="num mono"><strong>{formatInt(ov.annule)}</strong></td>
              <td className="num mono"><strong>{Math.round((ov.rate || 0) * 100)} %</strong></td>
            </tr></tfoot>
          </table></div>
        ) : (
          <EmptyState icon={MapPin} title="Aucune visite ce mois-ci">Aucune visite planifiée ou réalisée pour {month}.</EmptyState>
        )}
      </Card>
    </div>
  );
}
