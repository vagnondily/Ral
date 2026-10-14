import React, { useEffect, useMemo, useState } from 'react';
import { Download, AlertCircle, TriangleAlert, Layers, Coins, Wallet } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Skeleton, Stats, Usage } from '../../components/ui.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import { SessionPeriodNote, usePeriod } from '../../components/PeriodBanner.jsx';
import { formatAr, formatInt, monthLabel } from '../../lib/format.js';
import { periodLabel } from '../../lib/period.js';
import { downloadCsv } from '../../lib/csv.js';
import { useI18n } from '../../lib/i18n.jsx';
import { PERIOD_CAPS } from '../../lib/periodCaps.js';

const MATRIX_VIEWS = [
  { id: 'actual', label: 'Réalisé' },
  { id: 'planned', label: 'Planifié' },
  { id: 'ecart', label: 'Écart (Réel − Prévu)' },
];

function pct(rate) {
  return `${Math.round((Number(rate) || 0) * 100)} %`;
}
/** Taux d'une colonne « période » : « — » quand la base est nulle (jamais 0 %). */
const pctOrDash = (rate) => (rate == null ? '—' : pct(rate));

/**
 * Dashboard décisionnel — Suivi budgétaire consolidé.
 *
 * Reproduces "Suivi_Budget_TPM_BT.xlsx" and is the interliaison layer of the
 * app: per prestataire TPM (contrat de suivi) it puts side by side the Budget
 * (contrat), le Planifié (rapports) et le Réalisé (rapports), then derives the
 * variance / consumption / projection columns.
 *
 * Période (lot 1b) : par défaut toute la durée des contrats (cumul, comportement
 * historique). Une période choisie ajoute les colonnes « Période » (budget de la période
 * = parts mensuelles en centimes sur les mois communs, planifié, réalisé, taux) à côté
 * du cumul « à date », limite la matrice mensuelle aux mois de la période et nomme les
 * CSV par la période.
 */
export default function ConsolidationPage({ onOpenContract }) {
  const { tr, lang } = useI18n();
  const { period, ready, counts, latest, today, source, capped, setPeriod, resetToDefault } = usePeriod({ scope: 'analysis', defaultRule: 'all', maxSpan: PERIOD_CAPS.document });
  const key = period ? `${period.from}|${period.to}` : 'all';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('actual');
  // Avec une période, le détail du cumul du contrat (6 colonnes) est replié par défaut : restent
  // « Restant » et « Projection fin » (à date) ; la table tient alors à 1 366 px. Un bouton le déplie.
  const [showCumul, setShowCumul] = useState(false);

  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    setError(null); setData(null);
    api.consolidation({ period })
      .then((d) => {
        if (!alive) return;
        setData(d);
        try { if (typeof performance !== 'undefined' && performance.mark) performance.mark('period:rendered'); } catch { /* sans incidence */ }
      })
      .catch((err) => { if (alive) { setError(err.message); setData((d) => d || { rows: [], totals: {}, months: [], monthlyTotals: [] }); } });
    return () => { alive = false; };
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = data?.totals || {};
  const tp = period ? t.period : null;
  // Détail du cumul du contrat affiché : toujours sans période ; replié par défaut avec une période.
  const cumul = !tp || showCumul;
  const rows = data?.rows || [];
  const months = data?.months || [];
  const pLabel = period ? periodLabel(period, lang) : '';
  const suffix = period ? `_${period.from}_${period.to}` : '';

  const alerts = useMemo(() => rows.filter((r) => r.overspent || r.projectedOverrun > 0), [rows]);

  function cellValue(row, month) {
    const m = row.monthly?.[month];
    if (!m) return null;
    if (view === 'planned') return m.planned;
    if (view === 'ecart') return m.ecart;
    return m.actual;
  }

  function exportCsv() {
    const periodHead = tp ? [tr('Budget de la période (Ar)'), tr('Planifié période (Ar)'), tr('Réalisé période (Ar)'), tr('Taux période')] : [];
    const head = [tr('Prestataire TPM'), tr('Contrat'), ...periodHead, tr('Budget Suivi (Ar)'), tr('Planifié (Ar)'), tr('Réalisé (Ar)'),
      tr('Taux conso'), tr('Écart plan/réel'), tr('Mois restants'), tr('Restant (Ar)'), tr('Projection fin (Ar)')];
    const lines = rows.map((r) => [
      r.partnerName, r.numero,
      ...(tp ? [r.period.budget == null ? '' : Math.round(r.period.budget), Math.round(r.period.planned), Math.round(r.period.actual), pctOrDash(r.period.actualRate)] : []),
      Math.round(r.budget), Math.round(r.planned), Math.round(r.actual),
      pct(r.actualRate), pct(r.planVsActual), r.monthsRemaining, Math.round(r.remaining), Math.round(r.projectedTotal),
    ]);
    downloadCsv(`suivi-budgetaire-consolide${suffix}.csv`, [head, ...lines]);
  }

  return (
    <div className="section-gap">
      <PageHeader
        title={tr('Suivi budgétaire consolidé')}
        description={tr('Vue d\'ensemble par prestataire TPM : le Budget de suivi (contrat), le Planifié et le Réalisé (rapports) réunis pour suivre la consommation, les écarts et la projection de fin de contrat.')}
      >
        {ready && <PeriodSelect value={period} onChange={setPeriod} counts={counts} latest={latest} today={today} allowAll align="right" />}
        <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!rows.length}>{tr('Exporter (CSV)')}</Button>
      </PageHeader>
      <SessionPeriodNote source={source} capped={capped} onReset={resetToDefault} resetLabel={tr('Revenir à toutes les périodes')} />

      {tp ? (
        <Stats items={[
          { label: tr('Budget de la période'), value: formatInt(tp.budget), suffix: 'Ar',
            foot: tp.budgetUnknown ? tr('{n} mois · {u} contrat(s) sans dates (période du contrat inconnue)', { n: tp.months, u: tp.budgetUnknown }) : tr('{n} mois · {c} contrat(s)', { n: tp.months, c: t.contracts }) },
          { label: tr('Planifié'), value: formatInt(tp.planned), suffix: 'Ar', foot: tr('Taux {rate} du budget de la période', { rate: pctOrDash(tp.plannedRate) }) },
          { label: tr('Réalisé (factures validées)'), value: formatInt(tp.actual), suffix: 'Ar',
            foot: tp.pending > 0
              ? tr('Consommation de la période {rate} · {amount} Ar en attente de validation', { rate: pctOrDash(tp.actualRate), amount: formatInt(tp.pending) })
              : tr('Consommation de la période {rate}', { rate: pctOrDash(tp.actualRate) }) },
          { label: tr('Budget restant'), value: formatInt(t.remaining), suffix: 'Ar', foot: `${t.overspent ? tr('Dépassement') : tr('Disponible')} · ${tr('à date')}` },
        ]} />
      ) : <Stats items={[
        { label: tr('Budget de suivi (total)'), value: data ? formatInt(t.budget) : '—', suffix: 'Ar', foot: tr('{n} contrat(s) de suivi', { n: data ? t.contracts : '—' }) },
        { label: tr('Planifié'), value: data ? formatInt(t.planned) : '—', suffix: 'Ar', foot: tr('Taux {rate} du budget', { rate: data ? pct(t.plannedRate) : '—' }) },
        { label: tr('Réalisé (factures validées)'), value: data ? formatInt(t.actual) : '—', suffix: 'Ar',
          foot: data && t.pendingValidation > 0
            ? tr('Consommation {rate} · {amount} Ar en attente de validation', { rate: pct(t.actualRate), amount: formatInt(t.pendingValidation) })
            : tr('Consommation {rate}', { rate: data ? pct(t.actualRate) : '—' }) },
        { label: tr('Budget restant'), value: data ? formatInt(t.remaining) : '—', suffix: 'Ar', foot: t.overspent ? tr('Dépassement') : tr('Disponible') },
      ]} />}

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
            <table className="table cons-table">
              <thead>
                {tp && (
                  <tr className="th-group">
                    <th scope="colgroup" colSpan={2} />
                    <th scope="colgroup" colSpan={4} className="th-group-period">{tr('Période · {p}', { p: pLabel })}</th>
                    <th scope="colgroup" colSpan={cumul ? 8 : 2}>
                      {tr('Cumul du contrat (à date)')}{' '}
                      <button type="button" className="inline-link th-group-toggle" aria-expanded={cumul} onClick={() => setShowCumul((v) => !v)}>
                        {cumul ? tr('Replier') : tr('Tout le cumul (+6 colonnes)')}
                      </button>
                    </th>
                  </tr>
                )}
                <tr>
                  <th scope="col">{tr('Prestataire TPM')}</th>
                  <th scope="col">{tr('Contrat')}</th>
                  {tp && <>
                    <th scope="col" className="num">{tr('Budget de la période')}</th>
                    <th scope="col" className="num">{tr('Planifié')}</th>
                    <th scope="col" className="num">{tr('Réalisé')}</th>
                    <th scope="col" className="num">{tr('Taux')}</th>
                  </>}
                  {cumul && <>
                    <th scope="col" className="num">{tr('Budget suivi')}</th>
                    <th scope="col" className="num">{tr('Planifié')}</th>
                    <th scope="col" className="num">{tr('Réalisé')}</th>
                    <th scope="col">{tr('Consommation')}</th>
                    <th scope="col" className="num">{tr('Plan / Réel')}</th>
                    <th scope="col" className="num">{tr('Mois rest.')}</th>
                  </>}
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
                    {tp && <>
                      <td className="num mono">{r.period.budget == null ? <span className="cell-empty" title={tr('période du contrat inconnue')}>—</span> : formatAr(r.period.budget)}</td>
                      <td className="num mono">{formatAr(r.period.planned)}</td>
                      <td className="num mono">{formatAr(r.period.actual)}</td>
                      <td className="num mono">{r.period.actualRate == null ? <span className="cell-empty">—</span> : pct(r.period.actualRate)}</td>
                    </>}
                    {cumul && <>
                      <td className="num mono">{formatAr(r.budget)}</td>
                      <td className="num mono">{formatAr(r.planned)}</td>
                      <td className="num mono">{formatAr(r.actual)}</td>
                      <td style={{ minWidth: 120 }}><Usage rate={r.actualRate} /></td>
                      <td className="num mono">{r.planned > 0 ? pct(r.planVsActual) : <span className="cell-empty">—</span>}</td>
                      <td className="num mono">{r.monthsRemaining}</td>
                    </>}
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
                  {tp && <>
                    <td className="num mono"><strong>{formatAr(tp.budget)}</strong></td>
                    <td className="num mono"><strong>{formatAr(tp.planned)}</strong></td>
                    <td className="num mono"><strong>{formatAr(tp.actual)}</strong></td>
                    <td className="num mono"><strong>{pctOrDash(tp.actualRate)}</strong></td>
                  </>}
                  {cumul && <>
                    <td className="num mono"><strong>{formatAr(t.budget)}</strong></td>
                    <td className="num mono"><strong>{formatAr(t.planned)}</strong></td>
                    <td className="num mono"><strong>{formatAr(t.actual)}</strong></td>
                    <td><Usage rate={t.actualRate} /></td>
                    <td className="num mono">{t.planned > 0 ? pct(t.planVsActual) : '—'}</td>
                    <td className="num" />
                  </>}
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
          <CardHeader id="matrix-title" title={tr('Suivi mensuel')}
            subtitle={period ? tr('Montants par mois et par prestataire, sur la période choisie ({p}).', { p: pLabel }) : tr('Montants par mois et par prestataire, sur la période des contrats.')}>
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
                  // Total de la ligne : les mois de la matrice (la période si elle est choisie, sinon le cumul).
                  const src = tp ? r.period : r;
                  const total = view === 'planned' ? src.planned : view === 'ecart' ? (src.actual - src.planned) : src.actual;
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
                    <strong>{formatInt(view === 'planned' ? (tp || t).planned : view === 'ecart' ? ((tp || t).actual - (tp || t).planned) : (tp || t).actual)}</strong>
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
