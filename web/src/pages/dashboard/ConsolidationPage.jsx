import React, { useEffect, useMemo, useState } from 'react';
import { Download, AlertCircle, TriangleAlert, Layers, Coins, Wallet } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Skeleton, Stats, Usage } from '../../components/ui.jsx';
import { formatAr, formatInt, monthLabel } from '../../lib/format.js';

const MATRIX_VIEWS = [
  { id: 'actual', label: 'Réalisé' },
  { id: 'planned', label: 'Planifié' },
  { id: 'ecart', label: 'Écart (Réel − Prévu)' },
];

function pct(rate) {
  return `${Math.round((Number(rate) || 0) * 100)} %`;
}

/**
 * Dashboard décisionnel — Suivi budgétaire consolidé.
 *
 * Reproduces "Suivi_Budget_TPM_BT.xlsx" and is the interliaison layer of the
 * app: per prestataire TPM (contrat de suivi) it puts side by side the Budget
 * (contrat), le Planifié (rapports) et le Réalisé (rapports), then derives the
 * variance / consumption / projection columns.
 */
export default function ConsolidationPage({ onOpenContract }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('actual');

  useEffect(() => {
    let alive = true;
    setError(null);
    api.consolidation()
      .then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) { setError(err.message); setData((d) => d || { rows: [], totals: {}, months: [], monthlyTotals: [] }); } });
    return () => { alive = false; };
  }, []);

  const t = data?.totals || {};
  const rows = data?.rows || [];
  const months = data?.months || [];

  const alerts = useMemo(() => rows.filter((r) => r.overspent || r.projectedOverrun > 0), [rows]);

  function cellValue(row, month) {
    const m = row.monthly?.[month];
    if (!m) return null;
    if (view === 'planned') return m.planned;
    if (view === 'ecart') return m.ecart;
    return m.actual;
  }

  function exportCsv() {
    const head = ['Prestataire TPM', 'Contrat', 'Budget Suivi (Ar)', 'Planifié (Ar)', 'Réalisé (Ar)',
      'Taux conso', 'Écart plan/réel', 'Mois restants', 'Restant (Ar)', 'Projection fin (Ar)'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [
      r.partnerName, r.numero, Math.round(r.budget), Math.round(r.planned), Math.round(r.actual),
      pct(r.actualRate), pct(r.planVsActual), r.monthsRemaining, Math.round(r.remaining), Math.round(r.projectedTotal),
    ].map(esc).join(';'));
    const blob = new Blob(['﻿' + [head.map(esc).join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url; el.download = 'suivi-budgetaire-consolide.csv';
    document.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url);
  }

  return (
    <div className="section-gap">
      <PageHeader
        title="Suivi budgétaire consolidé"
        description="Vue d'ensemble par prestataire TPM : le Budget de suivi (contrat), le Planifié et le Réalisé (rapports) réunis pour suivre la consommation, les écarts et la projection de fin de contrat."
      >
        <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!rows.length}>Exporter (CSV)</Button>
      </PageHeader>

      <Stats items={[
        { label: 'Budget de suivi (total)', value: data ? formatInt(t.budget) : '—', suffix: 'Ar', foot: `${data ? t.contracts : '—'} contrat(s) de suivi` },
        { label: 'Planifié', value: data ? formatInt(t.planned) : '—', suffix: 'Ar', foot: `Taux ${data ? pct(t.plannedRate) : '—'} du budget` },
        { label: 'Réalisé (justifié)', value: data ? formatInt(t.actual) : '—', suffix: 'Ar', foot: `Consommation ${data ? pct(t.actualRate) : '—'}` },
        { label: 'Budget restant', value: data ? formatInt(t.remaining) : '—', suffix: 'Ar', foot: t.overspent ? 'Dépassement' : 'Disponible' },
      ]} />

      {error && <Alert tone="error" icon={AlertCircle}>{error}</Alert>}

      {alerts.length > 0 && (
        <Alert tone="warning" icon={TriangleAlert}>
          {alerts.length} prestataire(s) en dépassement ou en projection de dépassement du budget de suivi :{' '}
          {alerts.map((r) => r.partnerName).join(', ')}.
        </Alert>
      )}

      {/* Overview — une ligne par contrat de suivi */}
      <Card aria-labelledby="cons-title">
        <CardHeader id="cons-title" title="Vue d'ensemble par prestataire" subtitle="Budget ↔ Planifié ↔ Réalisé, avec taux de consommation, écart et projection de fin de contrat." />
        {data === null ? (
          <div className="card-body"><Skeleton height={160} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Layers} title="Aucun contrat de suivi actif">
            La consolidation s'affiche dès qu'un contrat actif porte un budget « Suivi » (section IV) et que des rapports sont saisis.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Prestataire TPM</th>
                  <th scope="col">Contrat</th>
                  <th scope="col" className="num">Budget suivi</th>
                  <th scope="col" className="num">Planifié</th>
                  <th scope="col" className="num">Réalisé</th>
                  <th scope="col">Consommation</th>
                  <th scope="col" className="num">Plan / Réel</th>
                  <th scope="col" className="num">Mois rest.</th>
                  <th scope="col" className="num">Restant</th>
                  <th scope="col" className="num">Projection fin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.contractId}>
                    <td><strong>{r.partnerName}</strong></td>
                    <td>
                      <button type="button" className="link-cell" onClick={() => onOpenContract?.(r.contractId)}>{r.numero}</button>
                      <div className="site-meta mono">{r.dateDebut} → {r.dateFin}</div>
                    </td>
                    <td className="num mono">{formatAr(r.budget)}</td>
                    <td className="num mono">{formatAr(r.planned)}</td>
                    <td className="num mono">{formatAr(r.actual)}</td>
                    <td style={{ minWidth: 120 }}><Usage rate={r.actualRate} /></td>
                    <td className="num mono">{r.planned > 0 ? pct(r.planVsActual) : <span className="cell-empty">—</span>}</td>
                    <td className="num mono">{r.monthsRemaining}</td>
                    <td className="num mono">
                      {r.overspent ? <Badge tone="red">{formatAr(r.remaining)}</Badge> : formatAr(r.remaining)}
                    </td>
                    <td className="num mono">
                      {r.projectedOverrun > 0
                        ? <span title={`Dépassement projeté de ${formatAr(r.projectedOverrun)}`}><Badge tone="orange">{formatAr(r.projectedTotal)}</Badge></span>
                        : formatAr(r.projectedTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}><strong>Total portefeuille</strong></td>
                  <td className="num mono"><strong>{formatAr(t.budget)}</strong></td>
                  <td className="num mono"><strong>{formatAr(t.planned)}</strong></td>
                  <td className="num mono"><strong>{formatAr(t.actual)}</strong></td>
                  <td><Usage rate={t.actualRate} /></td>
                  <td className="num mono">{t.planned > 0 ? pct(t.planVsActual) : '—'}</td>
                  <td className="num" />
                  <td className="num mono"><strong>{formatAr(t.remaining)}</strong></td>
                  <td className="num" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Recap / Analysis — matrice mensuelle */}
      {rows.length > 0 && months.length > 0 && (
        <Card aria-labelledby="matrix-title">
          <CardHeader id="matrix-title" title="Suivi mensuel" subtitle="Montants par mois et par prestataire, sur la période des contrats.">
            <div className="seg" role="tablist" aria-label="Vue de la matrice">
              {MATRIX_VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={view === v.id}
                  className={view === v.id ? 'is-active' : ''}
                  onClick={() => setView(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Prestataire</th>
                  {months.map((m) => <th key={m} scope="col" className="num">{monthLabel(m).replace(/ \d{4}$/, '')}</th>)}
                  <th scope="col" className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const total = view === 'planned' ? r.planned : view === 'ecart' ? (r.actual - r.planned) : r.actual;
                  return (
                    <tr key={r.contractId}>
                      <td><strong>{r.partnerName}</strong></td>
                      {months.map((m) => {
                        const v = cellValue(r, m);
                        return (
                          <td key={m} className="num mono">
                            {v == null || v === 0 ? <span className="cell-empty">—</span> : formatInt(v)}
                          </td>
                        );
                      })}
                      <td className="num mono"><strong>{formatInt(total)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Total</strong></td>
                  {(data.monthlyTotals || []).map((mt) => {
                    const v = view === 'planned' ? mt.planned : view === 'ecart' ? mt.ecart : mt.actual;
                    return <td key={mt.month} className="num mono"><strong>{v ? formatInt(v) : '—'}</strong></td>;
                  })}
                  <td className="num mono">
                    <strong>{formatInt(view === 'planned' ? t.planned : view === 'ecart' ? (t.actual - t.planned) : t.actual)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      <p className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Wallet size={14} aria-hidden="true" />
        <span>
          <strong>Budget</strong> = ligne « Suivi » (section IV) du contrat · <Coins size={12} aria-hidden="true" />{' '}
          <strong>Planifié</strong> &amp; <strong>Réalisé</strong> = rapports mensuels du prestataire. Tout est recalculé en direct depuis les contrats et les rapports.
        </span>
      </p>
    </div>
  );
}
