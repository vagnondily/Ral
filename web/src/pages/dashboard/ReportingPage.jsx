import React, { useEffect, useState } from 'react';
import { Download, Printer, FileSpreadsheet, MapPin } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Card, CardHeader, EmptyState, Skeleton, Stats } from '../../components/ui.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import { PeriodBanner, SessionPeriodNote, usePeriod } from '../../components/PeriodBanner.jsx';
import CoverageUniverse from '../../components/CoverageUniverse.jsx';
import { formatAr, formatInt } from '../../lib/format.js';
import { periodLabel } from '../../lib/period.js';
import { useI18n } from '../../lib/i18n.jsx';
import { ROLE_LABELS, contractNo, tpmNames } from '../../lib/roles.js';
import { PERIOD_CAPS } from '../../lib/periodCaps.js';
import { csvPercent, downloadCsv } from '../../lib/csv.js';
import { rateText, waysText } from '../../lib/coverageDefs.js';

/** Plafond commun à la consolidation de la période et aux mesures de couverture (faits site × mois) : lib/periodCaps.facts. */
const REPORT_MAX_SPAN = Math.min(PERIOD_CAPS.document, PERIOD_CAPS.facts);

/**
 * Reporting — rapport de synthèse S&E pour une PÉRIODE (lot 1b : plage de mois, défaut =
 * dernier mois avec des données) : situation budgétaire de la période (budget de la
 * période, planifié, réalisé ; restant et projection à date) et suivi de terrain par
 * district — les MÊMES mesures que la Synthèse et « Couverture & performance »
 * (GET /api/dashboards/coverage, retour 110 : univers = sites actifs de la période, « suivi » =
 * visite déclarée ou données reçues). Lecture seule, recalculé en direct ; exports CSV nommés
 * par la période + impression (PDF via le navigateur). Rien n'est stocké. Structure COMET :
 * section-gap + page-header + Stats compact + Card/table. Chaque source est lue à part : une
 * couverture indisponible ne masque pas le budget.
 * Exports CSV : écrivain partagé (formules neutralisées), lib/csv.js.
 * Exécution sans visite prévue : « — aucun plan », jamais 0 %.
 */

export default function ReportingPage({ onOpenContract }) {
  const { tr, lang } = useI18n();
  const { period, ready, auto, counts, latest, today, source, capped, setPeriod, resetToDefault } = usePeriod({ scope: 'analysis', defaultRule: 'data', maxSpan: REPORT_MAX_SPAN });
  const key = period ? `${period.from}|${period.to}` : '';
  const [cons, setCons] = useState(null);
  const [cov, setCov] = useState(undefined); // mesures de couverture : undefined = en cours, null = indisponible
  const [error, setError] = useState(null);
  const [covError, setCovError] = useState(null);

  useEffect(() => {
    if (!ready || !period) return undefined;
    let alive = true;
    setCons(null); setCov(undefined); setError(null); setCovError(null);
    api.consolidation({ period })
      .then((c) => {
        if (!alive) return;
        setCons(c);
        try { if (typeof performance !== 'undefined' && performance.mark) performance.mark('period:rendered'); } catch { /* sans incidence */ }
      })
      .catch((e) => alive && setError(e.message));
    api.dashCoverage(period).then((v) => { if (alive) setCov(v); }, (e) => { if (alive) { setCov(null); setCovError(e.message); } });
    return () => { alive = false; };
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = cons?.totals;
  const tp = t?.period;
  const ov = cov?.overall;
  const districts = cov?.byDistrict || [];
  const pLabel = period ? periodLabel(period, lang) : '';
  const suffix = period ? `${period.from}_${period.to}` : '';
  const ratePct = (rate) => (rate == null ? '—' : rateText(rate, lang));
  // Cellule « Exécution » : « — aucun plan » sans visite prévue (jamais 0 %).
  const execCell = (g) => (g.execution.rate == null ? <span className="muted">{tr('— aucun plan')}</span>
    : `${formatInt(g.execution.covered)} / ${formatInt(g.execution.planned)} · ${rateText(g.execution.rate, lang)}`);
  const sitesCell = (g) => (g.coverage.rate == null ? '—' : `${formatInt(g.coverage.covered)} / ${formatInt(g.sites)} · ${rateText(g.coverage.rate, lang)}`);
  // Taux du CSV (« ; », BOM, pour Excel en français) : « 12,3% », lu comme un nombre — jamais « 12.3% » (texte).
  const pctOf = (rate) => csvPercent(rate, 1);

  const exportBudget = () => {
    const rows = [[tr('Contrat'), tr(ROLE_LABELS.holder), tr(ROLE_LABELS.tpm), tr('Budget de la période'), tr('Planifié'), tr('Réalisé'), tr('Taux'), tr('Restant (à date)'), tr('Projection fin (à date)')]];
    for (const r of cons.rows) {
      rows.push([contractNo(r), r.partnerName, tpmNames(r.tpm).join(', ') || tr(ROLE_LABELS.noTpm), r.period.budget == null ? '' : Math.round(r.period.budget), Math.round(r.period.planned), Math.round(r.period.actual),
        r.period.actualRate == null ? '' : `${Math.round(r.period.actualRate * 100)}%`, Math.round(r.remaining), Math.round(r.projectedTotal)]);
    }
    downloadCsv(`synthese-budget_${suffix}.csv`, rows);
  };
  const exportCoverage = () => {
    const rows = [[tr('District'), tr('Sites actifs'), tr('Sites suivis'), tr('dont par données reçues'), tr('dont par visites déclarées'), tr('Couverture (sites)'),
      tr('Visites prévues (mois échus)'), tr('Suivies dans leur mois'), tr('Exécution du plan (visites)'), tr('Annulées')]];
    const line = (label, g) => [label, g.sites, g.coverage.covered, g.coverage.byData, g.coverage.byVisit, pctOf(g.coverage.rate),
      g.execution.planned, g.execution.covered, g.execution.rate == null ? tr('aucun plan') : pctOf(g.execution.rate), g.execution.cancelled];
    for (const d of districts) rows.push(line(d.key === '—' ? tr('District inconnu') : d.label, d));
    rows.push(line(tr('Total'), ov));
    downloadCsv(`suivi-terrain_${suffix}.csv`, rows);
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

      <PeriodBanner auto={auto} period={period} />
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
        { label: tr('Exécution du plan (visites)'), value: !ov ? '—' : ov.execution.rate == null ? tr('— aucun plan') : rateText(ov.execution.rate, lang),
          foot: covError ? tr('Indisponible') : ov && ov.execution.rate != null ? tr('{c} / {p} visites prévues suivies dans leur mois', { c: formatInt(ov.execution.covered), p: formatInt(ov.execution.planned) }) : pLabel },
        { label: tr('Couverture (sites)'), value: !ov ? '—' : rateText(ov.coverage.rate, lang),
          foot: covError ? tr('Indisponible') : ov ? `${tr('{c} / {u} sites actifs suivis', { c: formatInt(ov.coverage.covered), u: formatInt(ov.sites) })}${ov.coverage.covered > 0 ? ` · ${waysText(tr, ov.coverage, formatInt)}` : ''}` : pLabel },
      ]} />
      {cov && <CoverageUniverse cov={cov} period={period} />}

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
              <th scope="col">{tr('Contrat')}</th><th scope="col">{tr(ROLE_LABELS.holder)}</th><th scope="col">{tr(ROLE_LABELS.tpm)}</th>
              <th scope="col" className="num">{tr('Budget de la période')}</th>
              <th scope="col" className="num">{tr('Planifié')}</th><th scope="col" className="num">{tr('Réalisé')}</th><th scope="col" className="num">{tr('Taux')}</th>
              <th scope="col" className="num">{tr('Restant (à date)')}</th><th scope="col" className="num">{tr('Projection fin (à date)')}</th>
            </tr></thead>
            <tbody>
              {cons.rows.map((r) => (
                <tr key={r.contractId} className="clickable" onClick={() => onOpenContract && onOpenContract(r.contractId)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpenContract && onOpenContract(r.contractId); }} tabIndex={0}>
                  <td className="nowrap"><strong className="mono">{contractNo(r)}</strong></td><td>{r.partnerName}</td>
                  <td>{tpmNames(r.tpm).length ? tpmNames(r.tpm).join(', ') : <span className="cell-empty" title={tr(ROLE_LABELS.noTpmHint)}>{tr(ROLE_LABELS.noTpm)}</span>}</td>
                  <td className="num tabular">{r.period.budget == null ? <span className="cell-empty" title={tr('période du contrat inconnue')}>—</span> : formatAr(r.period.budget)}</td>
                  <td className="num tabular">{formatAr(r.period.planned)}</td>
                  <td className="num tabular">{formatAr(r.period.actual)}</td>
                  <td className="num tabular" style={{ color: r.period.actualRate > 1 ? 'var(--red)' : undefined }}>{ratePct(r.period.actualRate)}</td>
                  <td className="num tabular">{formatAr(r.remaining)}</td>
                  <td className="num tabular">{formatAr(r.projectedTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td colSpan={3}><strong>{tr('Total')}</strong></td>
              <td className="num tabular"><strong>{formatAr(tp.budget)}</strong></td>
              <td className="num tabular"><strong>{formatAr(tp.planned)}</strong></td>
              <td className="num tabular"><strong>{formatAr(tp.actual)}</strong></td>
              <td className="num tabular"><strong>{ratePct(tp.actualRate)}</strong></td>
              <td className="num tabular"><strong>{formatAr(t.remaining)}</strong></td>
              <td />
            </tr></tfoot>
          </table></div>
        )}
      </Card>

      <Card aria-labelledby="rep-cover">
        <CardHeader id="rep-cover" title={tr('Suivi de terrain par district — {p}', { p: pLabel })}
          subtitle={tr('Sites actifs de la période ; suivi = visite déclarée ou données reçues · couverture = sites suivis ÷ sites actifs · exécution du plan = visites prévues (mois échus) suivies dans leur mois ÷ prévues.')}>
          {districts.length > 0 && <Button size="sm" variant="secondary" icon={Download} onClick={exportCoverage}>{tr('Exporter CSV')}</Button>}
        </CardHeader>
        {cov === undefined ? (
          <div className="card-body"><Skeleton height={140} /></div>
        ) : covError ? (
          <div className="card-body"><Alert tone="error">{covError}</Alert></div>
        ) : districts.length > 0 ? (
          <div className="table-wrap"><table className="table">
            <thead><tr>
              <th scope="col">{tr('District')}</th><th scope="col" className="num">{tr('Sites actifs')}</th>
              <th scope="col" className="num">{tr('Couverture (sites)')}</th><th scope="col" className="num">{tr('Exécution du plan')}</th>
              <th scope="col" className="num">{tr('Annulées')}</th>
            </tr></thead>
            <tbody>
              {districts.map((d) => (
                <tr key={d.key}><td><strong>{d.key === '—' ? <span className="muted">{tr('District inconnu')}</span> : d.label}</strong></td>
                  <td className="num tabular">{formatInt(d.sites)}</td>
                  <td className="num tabular">{sitesCell(d)}</td>
                  <td className="num tabular">{execCell(d)}</td>
                  <td className="num tabular">{formatInt(d.execution.cancelled)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td><strong>{tr('Total')}</strong></td>
              <td className="num tabular"><strong>{formatInt(ov.sites)}</strong></td>
              <td className="num tabular"><strong>{sitesCell(ov)}</strong></td>
              <td className="num tabular"><strong>{execCell(ov)}</strong></td>
              <td className="num tabular"><strong>{formatInt(ov.execution.cancelled)}</strong></td>
            </tr></tfoot>
          </table></div>
        ) : cov && cov.universe && cov.universe.registry === 0 ? (
          // Registre vide : aucun site à activer — la grille des sites actifs n'y peut rien.
          <EmptyState icon={MapPin} title={tr('Aucun site dans le registre')}>{tr('Ajoutez ou importez les sites dans Paramétrage › Localités › Sites, puis renseignez la grille des sites actifs.')}</EmptyState>
        ) : (
          <EmptyState icon={MapPin} title={tr('Aucun site actif sur la période')}>{tr('Aucun site actif pour {month} : renseignez la grille des sites actifs (RBM › Sites).', { month: pLabel })}</EmptyState>
        )}
      </Card>
    </div>
  );
}
