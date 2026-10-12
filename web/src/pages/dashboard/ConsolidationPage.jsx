import React, { useEffect, useMemo, useState } from 'react';
import { Download, AlertCircle, TriangleAlert, Layers, Coins, Wallet } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Skeleton, Stats, Usage } from '../../components/ui.jsx';
import { formatAr, formatInt, monthLabel } from '../../lib/format.js';
import { downloadCsv } from '../../lib/csv.js';
import { useI18n } from '../../lib/i18n.jsx';

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
  const { tr } = useI18n();
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
    const head = [tr('Prestataire TPM'), tr('Contrat'), tr('Budget Suivi (Ar)'), tr('Planifié (Ar)'), tr('Réalisé (Ar)'),
      tr('Taux conso'), tr('Écart plan/réel'), tr('Mois restants'), tr('Restant (Ar)'), tr('Projection fin (Ar)')];
    const lines = rows.map((r) => [
      r.partnerName, r.numero, Math.round(r.budget), Math.round(r.planned), Math.round(r.actual),
      pct(r.actualRate), pct(r.planVsActual), r.monthsRemaining, Math.round(r.remaining), Math.round(r.projectedTotal),
    ]);
    downloadCsv('suivi-budgetaire-consolide.csv', [head, ...lines]);
  }

  return (
    <div className="section-gap">
      <PageHeader
        title={tr('Suivi budgétaire consolidé')}
        description={tr('Vue d\'ensemble par prestataire TPM : le Budget de suivi (contrat), le Planifié et le Réalisé (rapports) réunis pour suivre la consommation, les écarts et la projection de fin de contrat.')}
      >
        <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!rows.length}>{tr('Exporter (CSV)')}</Button>
      </PageHeader>

      <Stats items={[
        { label: tr('Budget de suivi (total)'), value: data ? formatInt(t.budget) : '—', suffix: 'Ar', foot: tr('{n} contrat(s) de suivi', { n: data ? t.contracts : '—' }) },
        { label: tr('Planifié'), value: data ? formatInt(t.planned) : '—', suffix: 'Ar', foot: tr('Taux {rate} du budget', { rate: data ? pct(t.plannedRate) : '—' }) },
        { label: tr('Réalisé (factures validées)'), value: data ? formatInt(t.actual) : '—', suffix: 'Ar',
          foot: data && t.pendingValidation > 0
            ? tr('Consommation {rate} · {amount} Ar en attente de validation', { rate: pct(t.actualRate), amount: formatInt(t.pendingValidation) })
            : tr('Consommation {rate}', { rate: data ? pct(t.actualRate) : '—' }) },
        { label: tr('Budget restant'), value: data ? formatInt(t.remaining) : '—', suffix: 'Ar', foot: t.overspent ? tr('Dépassement') : tr('Disponible') },
      ]} />

      {error && <Alert tone="error" icon={AlertCircle}>{error}</Alert>}

      {alerts.length > 0 && (
        <Alert tone="warning" icon={TriangleAlert}>
          {tr('{n} prestataire(s) en dépassement ou en projection de dépassement du budget de suivi : {names}.', { n: alerts.length, names: alerts.map((r) => r.partnerName).join(', ') })}
        </Alert>
      )}

      {/* Overview — une ligne par contrat de suivi */}
      <Card aria-labelledby="cons-title">
        <CardHeader id="cons-title" title={tr('Vue d\'ensemble par prestataire')} subtitle={tr('Budget ↔ Planifié ↔ Réalisé, avec taux de consommation, écart et projection de fin de contrat.')} />
        {data === null ? (
          <div className="card-body"><Skeleton height={160} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Layers} title={tr('Aucun contrat de suivi actif')}>
            {tr('La consolidation s\'affiche dès qu\'un contrat actif porte un budget « Suivi » (section IV) et que des rapports sont saisis.')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tr('Prestataire TPM')}</th>
                  <th scope="col">{tr('Contrat')}</th>
                  <th scope="col" className="num">{tr('Budget suivi')}</th>
                  <th scope="col" className="num">{tr('Planifié')}</th>
                  <th scope="col" className="num">{tr('Réalisé')}</th>
                  <th scope="col">{tr('Consommation')}</th>
                  <th scope="col" className="num">{tr('Plan / Réel')}</th>
                  <th scope="col" className="num">{tr('Mois rest.')}</th>
                  <th scope="col" className="num">{tr('Restant')}</th>
                  <th scope="col" className="num">{tr('Projection fin')}</th>
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
                        ? <span title={tr('Dépassement projeté de {amount}', { amount: formatAr(r.projectedOverrun) })}><Badge tone="orange">{formatAr(r.projectedTotal)}</Badge></span>
                        : formatAr(r.projectedTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}><strong>{tr('Total portefeuille')}</strong></td>
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
          <CardHeader id="matrix-title" title={tr('Suivi mensuel')} subtitle={tr('Montants par mois et par prestataire, sur la période des contrats.')}>
            <div className="seg" role="tablist" aria-label={tr('Vue de la matrice')}>
              {MATRIX_VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={view === v.id}
                  className={view === v.id ? 'is-active' : ''}
                  onClick={() => setView(v.id)}
                >
                  {tr(v.label)}
                </button>
              ))}
            </div>
          </CardHeader>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tr('Prestataire')}</th>
                  {months.map((m) => <th key={m} scope="col" className="num">{monthLabel(m).replace(/ \d{4}$/, '')}</th>)}
                  <th scope="col" className="num">{tr('Total')}</th>
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
                  <td><strong>{tr('Total')}</strong></td>
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
          <strong>{tr('Budget')}</strong> {tr('= ligne « Suivi » (section IV) du contrat')} · <Coins size={12} aria-hidden="true" />{' '}
          <strong>{tr('Planifié')}</strong> &amp; <strong>{tr('Réalisé')}</strong> {tr('= rapports mensuels du prestataire. Tout est recalculé en direct depuis les contrats et les rapports.')}
        </span>
      </p>
    </div>
  );
}
