import React, { useEffect, useMemo, useState } from 'react';
import { Download, Printer, FileSpreadsheet, Wallet, CheckCircle2, MapPin } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, PageHeader, Skeleton } from '../../components/ui.jsx';
import MonthPicker from '../../components/MonthPicker.jsx';
import { formatAr, formatInt, currentMonth } from '../../lib/format.js';

/**
 * Reporting — rapport de synthèse S&E pour une période : situation budgétaire
 * (consolidation) et couverture terrain (visites). Lecture seule, recalculé en
 * direct ; exports CSV + impression (PDF via le navigateur). Rien n'est stocké.
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

  if (error) return <div className="page"><PageHeader title="Reporting" /><Alert tone="error">{error}</Alert></div>;

  return (
    <div className="page">
      <PageHeader title="Rapport de synthèse S&E" description="Situation budgétaire et couverture terrain pour la période, recalculées en direct. Exportez en CSV ou imprimez (PDF).">
        <MonthPicker value={month} onChange={setMonth} />
        <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Imprimer / PDF</Button>
      </PageHeader>

      {cons === null ? <Skeleton height={320} /> : (
        <div className="section-gap" style={{ display: 'grid', gap: 18 }}>
          <div className="biz-kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
            <Kpi icon={Wallet} tone="blue" label="Budget de suivi" value={formatAr(t.budget)} foot={`${t.contracts} contrat(s)`} />
            <Kpi icon={CheckCircle2} tone="green" label="Réalisé (justifié)" value={formatAr(t.actual)} foot={`${Math.round((t.actualRate || 0) * 100)} % du budget`} />
            <Kpi icon={Wallet} tone={t.remaining < 0 ? 'red' : 'blue'} label="Budget restant" value={formatAr(t.remaining)} foot="Disponible" />
            <Kpi icon={MapPin} tone="amber" label="Couverture terrain" value={ov ? `${Math.round((ov.rate || 0) * 100)} %` : '—'} foot={ov ? `${ov.realise}/${ov.active} visites` : 'mois courant'} />
          </div>

          <div className="card biz-card">
            <div className="card-header"><div className="card-title">Situation budgétaire par contrat</div>
              <Button size="sm" variant="ghost" icon={FileSpreadsheet} onClick={exportBudget}>Exporter CSV</Button></div>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Contrat</th><th>Prestataire</th><th className="num">Budget</th><th className="num">Planifié</th><th className="num">Réalisé</th><th className="num">Taux</th><th className="num">Restant</th><th className="num">Projection fin</th></tr></thead>
              <tbody>
                {cons.rows.map((r) => (
                  <tr key={r.contractId} onClick={() => onOpenContract && onOpenContract(r.contractId)} style={{ cursor: 'pointer' }}>
                    <td><strong>{r.numero}</strong></td><td>{r.partnerName}</td>
                    <td className="num tabular">{formatAr(r.budget)}</td>
                    <td className="num tabular">{formatAr(r.planned)}</td>
                    <td className="num tabular">{formatAr(r.actual)}</td>
                    <td className="num tabular" style={{ color: r.overspent ? 'var(--red)' : undefined }}>{Math.round((r.actualRate || 0) * 100)} %</td>
                    <td className="num tabular">{formatAr(r.remaining)}</td>
                    <td className="num tabular">{formatAr(r.projectedTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td colSpan={2} style={{ textAlign: 'right' }}><strong>Total</strong></td>
                <td className="num tabular"><strong>{formatAr(t.budget)}</strong></td>
                <td className="num tabular"><strong>{formatAr(t.planned)}</strong></td>
                <td className="num tabular"><strong>{formatAr(t.actual)}</strong></td>
                <td className="num tabular"><strong>{Math.round((t.actualRate || 0) * 100)} %</strong></td>
                <td className="num tabular"><strong>{formatAr(t.remaining)}</strong></td>
                <td />
              </tr></tfoot>
            </table></div>
          </div>

          <div className="card biz-card">
            <div className="card-header"><div className="card-title">Couverture terrain par district — {month}</div>
              {field?.byDistrict?.length > 0 && <Button size="sm" variant="ghost" icon={Download} onClick={exportCoverage}>Exporter CSV</Button>}</div>
            {field?.byDistrict?.length > 0 ? (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>District</th><th className="num">Planifiées</th><th className="num">Réalisées</th><th className="num">Annulées</th><th className="num">Taux</th></tr></thead>
                <tbody>
                  {field.byDistrict.map((d) => (
                    <tr key={d.key}><td><strong>{d.label}</strong></td>
                      <td className="num tabular">{formatInt(d.planifie)}</td>
                      <td className="num tabular">{formatInt(d.realise)}</td>
                      <td className="num tabular">{formatInt(d.annule)}</td>
                      <td className="num tabular">{Math.round(d.rate * 100)} %</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td style={{ textAlign: 'right' }}><strong>Total</strong></td>
                  <td className="num tabular"><strong>{formatInt(ov.planifie)}</strong></td>
                  <td className="num tabular"><strong>{formatInt(ov.realise)}</strong></td>
                  <td className="num tabular"><strong>{formatInt(ov.annule)}</strong></td>
                  <td className="num tabular"><strong>{Math.round((ov.rate || 0) * 100)} %</strong></td>
                </tr></tfoot>
              </table></div>
            ) : <div className="card-body"><p className="muted">Aucune visite planifiée pour {month}.</p></div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, foot, tone }) {
  return (
    <div className="biz-kpi">
      <div className={`biz-kpi-ic ${tone || ''}`}><Icon size={18} aria-hidden="true" /></div>
      <div className="biz-kpi-body">
        <div className="biz-kpi-label">{label}</div>
        <div className="biz-kpi-value tabular">{value}</div>
        {foot && <div className="biz-kpi-foot">{foot}</div>}
      </div>
    </div>
  );
}
