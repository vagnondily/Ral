import React, { useEffect, useState } from 'react';
import { Download, Printer, FileSpreadsheet, MapPin } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Card, CardHeader, EmptyState, Skeleton, Stats } from '../../components/ui.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import { ActivationNote, PeriodBanner, SessionPeriodNote, usePeriod } from '../../components/PeriodBanner.jsx';
import { formatAr, formatInt } from '../../lib/format.js';
import { periodLabel, single } from '../../lib/period.js';
import { useI18n } from '../../lib/i18n.jsx';
import { PERIOD_CAPS } from '../../lib/periodCaps.js';
import { downloadCsv } from '../../lib/csv.js';
import { coveragePct } from '../../lib/coverage.js';

/** Plafond commun à la consolidation de la période et aux faits terrain (field/summary) : lib/periodCaps.facts. */
const REPORT_MAX_SPAN = Math.min(PERIOD_CAPS.document, PERIOD_CAPS.facts);

/**
 * Reporting — rapport de synthèse S&E pour une PÉRIODE (lot 1b : plage de mois, défaut =
 * dernier mois avec des données) : situation budgétaire de la période (budget de la
 * période, planifié, réalisé ; restant et projection à date) et visites de terrain par
 * district (exécution du plan et couverture des sites). Lecture seule, recalculé en
 * direct ; exports CSV nommés par la période + impression (PDF via le navigateur).
 * Rien n'est stocké. Structure COMET : section-gap + page-header + Stats compact + Card/table.
 * Exports CSV : écrivain partagé (formules neutralisées), lib/csv.js.
 * Exécution sans visite planifiée : « — aucun plan », jamais 0 % (lib/coverage.js).
 */

export default function ReportingPage({ onOpenContract }) {
  const { tr, lang } = useI18n();
  const { period, ready, auto, counts, latest, today, source, capped, setPeriod, resetToDefault } = usePeriod({ scope: 'analysis', defaultRule: 'data', maxSpan: REPORT_MAX_SPAN });
  const key = period ? `${period.from}|${period.to}` : '';
  const [cons, setCons] = useState(null);
  const [field, setField] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ready || !period) return undefined;
    let alive = true;
    setCons(null); setError(null);
    Promise.all([api.consolidation({ period }), api.fieldSummary(period)])
      .then(([c, f]) => {
        if (!alive) return;
        setCons(c); setField(f);
        try { if (typeof performance !== 'undefined' && performance.mark) performance.mark('period:rendered'); } catch { /* sans incidence */ }
      })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = cons?.totals;
  const tp = t?.period;
  const ov = field?.overall;
  const ovPct = coveragePct(ov);
  const pLabel = period ? periodLabel(period, lang) : '';
  const suffix = period ? `${period.from}_${period.to}` : '';
  const ratePct = (rate) => (rate == null ? '—' : `${Math.round(rate * 100)} %`);
  // Cellule « Exécution » : « — aucun plan » sans visite planifiée (jamais 0 %).
  const pctCell = (cov) => {
    const p = coveragePct(cov);
    return p == null ? <span className="muted">{tr('— aucun plan')}</span> : `${p} %`;
  };
  const sitesCell = (d) => (d.coverage == null ? '—' : `${formatInt(d.sites.realised)} / ${formatInt(d.sites.active)} · ${Math.round(d.coverage * 100)} %`);

  const exportBudget = () => {
    const rows = [[tr('Contrat'), tr('Prestataire'), tr('Budget de la période'), tr('Planifié'), tr('Réalisé'), tr('Taux'), tr('Restant (à date)'), tr('Projection fin (à date)')]];
    for (const r of cons.rows) {
      rows.push([r.numero, r.partnerName, r.period.budget == null ? '' : Math.round(r.period.budget), Math.round(r.period.planned), Math.round(r.period.actual),
        r.period.actualRate == null ? '' : `${Math.round(r.period.actualRate * 100)}%`, Math.round(r.remaining), Math.round(r.projectedTotal)]);
    }
    downloadCsv(`synthese-budget_${suffix}.csv`, rows);
  };
  const exportCoverage = () => {
    const rows = [[tr('District'), tr('Planifiées'), tr('Réalisées'), tr('Annulées'), tr('Exécution du plan (visites)'), tr('Sites actifs'), tr('Sites réalisés'), tr('Couverture (sites)')]];
    for (const d of field.byDistrict) {
      const p = coveragePct(d);
      rows.push([d.label, d.planifie, d.realise, d.annule, p == null ? tr('aucun plan') : `${p}%`,
        d.sites.active, d.sites.realised, d.coverage == null ? '' : `${Math.round(d.coverage * 100)}%`]);
    }
    downloadCsv(`visites-terrain_${suffix}.csv`, rows);
  };

  return (
    <div className="section-gap">
      <div className="page-header">
        <div>
          <h1 className="page-title">{tr('Rapport de synthèse S&E')}</h1>
          <p className="page-desc">{tr('Situation budgétaire et couverture terrain pour la période, recalculées en direct. Exportez en CSV ou imprimez (PDF).')}</p>
        </div>
        <div className="header-actions">
          {ready && <PeriodSelect value={period} onChange={setPeriod} counts={counts} latest={latest} today={today} maxSpan={REPORT_MAX_SPAN} align="right" />}
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>{tr('Imprimer / PDF')}</Button>
        </div>
      </div>

      <PeriodBanner auto={auto} onBack={(m) => setPeriod(single(m))} />
      <SessionPeriodNote source={source} capped={capped} onReset={resetToDefault} />
      {error && <Alert tone="error">{error}</Alert>}

      <Stats compact items={[
        { label: tr('Budget de la période'), value: tp ? formatAr(tp.budget) : '—',
          foot: cons ? tr('{n} mois · budget total {amount} Ar', { n: tp?.months || 0, amount: formatInt(t.budget) }) : tr('Consolidation') },
        { label: tr('Réalisé (factures validées)'), value: tp ? formatAr(tp.actual) : '—',
          foot: !tp ? tr('Factures validées')
            : tp.pending > 0 ? tr('{p} du budget de la période · {amount} Ar en attente de validation', { p: ratePct(tp.actualRate), amount: formatInt(tp.pending) })
              : tr('{p} du budget de la période', { p: ratePct(tp.actualRate) }) },
        { label: tr('Budget restant'), value: cons ? formatAr(t.remaining) : '—', foot: tr('à date') },
        { label: tr('Exécution du plan (visites)'), value: ovPct == null ? (ov ? tr('— aucun plan') : '—') : `${ovPct} %`,
          foot: ov && ovPct != null ? tr('{done}/{active} visites', { done: ov.realise, active: ov.active }) : pLabel },
        { label: tr('Couverture (sites)'), value: ov?.coverage == null ? '—' : `${Math.round(ov.coverage * 100)} %`,
          foot: ov ? tr('{r} / {a} sites actifs · distincts sur la période', { r: formatInt(ov.sites.realised), a: formatInt(ov.sites.active) }) : pLabel },
      ]} />
      <ActivationNote field={field} />

      <Card aria-labelledby="rep-budget">
        <CardHeader id="rep-budget" title={tr('Situation budgétaire par contrat — {p}', { p: pLabel })}
          subtitle={tr('Budget de la période ↔ Planifié ↔ Réalisé de la période et taux ; restant et projection de fin à date.')}>
          {cons && cons.rows.length > 0 && <Button size="sm" variant="secondary" icon={FileSpreadsheet} onClick={exportBudget}>{tr('Exporter CSV')}</Button>}
        </CardHeader>
        {cons === null ? (
          <div className="card-body"><Skeleton height={160} /></div>
        ) : cons.rows.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title={tr('Aucun contrat de suivi actif')}>{tr('La synthèse budgétaire s\'affiche dès qu\'un contrat actif porte un budget « Suivi ».')}</EmptyState>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr>
              <th scope="col">{tr('Contrat')}</th><th scope="col">{tr('Prestataire')}</th><th scope="col" className="num">{tr('Budget de la période')}</th>
              <th scope="col" className="num">{tr('Planifié')}</th><th scope="col" className="num">{tr('Réalisé')}</th><th scope="col" className="num">{tr('Taux')}</th>
              <th scope="col" className="num">{tr('Restant (à date)')}</th><th scope="col" className="num">{tr('Projection fin (à date)')}</th>
            </tr></thead>
            <tbody>
              {cons.rows.map((r) => (
                <tr key={r.contractId} className="clickable" onClick={() => onOpenContract && onOpenContract(r.contractId)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpenContract && onOpenContract(r.contractId); }} tabIndex={0}>
                  <td><strong>{r.numero}</strong></td><td>{r.partnerName}</td>
                  <td className="num mono">{r.period.budget == null ? <span className="cell-empty" title={tr('période du contrat inconnue')}>—</span> : formatAr(r.period.budget)}</td>
                  <td className="num mono">{formatAr(r.period.planned)}</td>
                  <td className="num mono">{formatAr(r.period.actual)}</td>
                  <td className="num mono" style={{ color: r.period.actualRate > 1 ? 'var(--red)' : undefined }}>{ratePct(r.period.actualRate)}</td>
                  <td className="num mono">{formatAr(r.remaining)}</td>
                  <td className="num mono">{formatAr(r.projectedTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td colSpan={2}><strong>{tr('Total')}</strong></td>
              <td className="num mono"><strong>{formatAr(tp.budget)}</strong></td>
              <td className="num mono"><strong>{formatAr(tp.planned)}</strong></td>
              <td className="num mono"><strong>{formatAr(tp.actual)}</strong></td>
              <td className="num mono"><strong>{ratePct(tp.actualRate)}</strong></td>
              <td className="num mono"><strong>{formatAr(t.remaining)}</strong></td>
              <td />
            </tr></tfoot>
          </table></div>
        )}
      </Card>

      <Card aria-labelledby="rep-cover">
        <CardHeader id="rep-cover" title={tr('Visites de terrain par district — {p}', { p: pLabel })}
          subtitle={tr('Visites prévues, réalisées et annulées de la période ; exécution du plan = réalisées ÷ (prévues + réalisées) ; couverture = sites actifs réalisés ÷ sites actifs.')}>
          {field?.byDistrict?.length > 0 && <Button size="sm" variant="secondary" icon={Download} onClick={exportCoverage}>{tr('Exporter CSV')}</Button>}
        </CardHeader>
        {cons === null ? (
          <div className="card-body"><Skeleton height={140} /></div>
        ) : field?.byDistrict?.length > 0 ? (
          <div className="table-wrap"><table className="table">
            <thead><tr>
              <th scope="col">{tr('District')}</th><th scope="col" className="num">{tr('Planifiées')}</th><th scope="col" className="num">{tr('Réalisées')}</th>
              <th scope="col" className="num">{tr('Annulées')}</th><th scope="col" className="num">{tr('Exécution du plan')}</th>
              <th scope="col" className="num">{tr('Couverture (sites)')}</th>
            </tr></thead>
            <tbody>
              {field.byDistrict.map((d) => (
                <tr key={d.key}><td><strong>{d.label}</strong></td>
                  <td className="num mono">{formatInt(d.planifie)}</td>
                  <td className="num mono">{formatInt(d.realise)}</td>
                  <td className="num mono">{formatInt(d.annule)}</td>
                  <td className="num mono">{pctCell(d)}</td>
                  <td className="num mono">{sitesCell(d)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td><strong>{tr('Total')}</strong></td>
              <td className="num mono"><strong>{formatInt(ov.planifie)}</strong></td>
              <td className="num mono"><strong>{formatInt(ov.realise)}</strong></td>
              <td className="num mono"><strong>{formatInt(ov.annule)}</strong></td>
              <td className="num mono"><strong>{pctCell(ov)}</strong></td>
              <td className="num mono"><strong>{sitesCell(ov)}</strong></td>
            </tr></tfoot>
          </table></div>
        ) : (
          <EmptyState icon={MapPin} title={tr('Aucune visite sur la période')}>{tr('Aucune visite planifiée ou réalisée pour {month}.', { month: pLabel })}</EmptyState>
        )}
      </Card>
    </div>
  );
}
