import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, ShieldCheck, Database, ListChecks, MapPin, Activity, AlertTriangle, AlertCircle, Info, ArrowRight } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, PageHeader, Skeleton } from '../../components/ui.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import TrendChart from '../../components/charts/TrendChart.jsx';
import CodeLabel from '../../components/CodeLabel.jsx';
import ActivityCoverageCard from '../../components/ActivityCoverageCard.jsx';
import CoverageUniverse from '../../components/CoverageUniverse.jsx';
import { PeriodBanner, SessionPeriodNote, usePeriod } from '../../components/PeriodBanner.jsx';
import { formatDecimal, formatInt, monthLabel } from '../../lib/format.js';
import { periodLabel, single, spanMonths } from '../../lib/period.js';
import { useI18n } from '../../lib/i18n.jsx';
import { PERIOD_CAPS } from '../../lib/periodCaps.js';
import { barPct, rateText, upcomingText, upToDateParts, waysText, watchList } from '../../lib/coverageDefs.js';

/** Durée maximale de l'écran : la plus courte de ses endpoints (overview = analyse ; couverture = faits) — lib/periodCaps. */
const ANALYSIS_MAX_SPAN = Math.min(PERIOD_CAPS.analysis, PERIOD_CAPS.facts);

/**
 * Dashboard « Suivi de processus » — Synthèse. Recalculé en direct (rien de
 * stocké) à partir de deux sources :
 *   • Données versées + conformité  ← Suivi de processus (fiches + indicateurs)
 *   • Couverture, exécution, sites à jour, par bureau et par activité ← GET /api/dashboards/coverage,
 *     la MÊME réponse que « Couverture & performance du suivi » (retour 110 : une définition par
 *     mesure, lib/coverageDefs, serveur dashboards/coverageDefinitions)
 * Objectif : voir d'un coup l'état du suivi, PAR BUREAU (visites et données
 * reçues), et les bureaux à surveiller.
 *
 * Période = plage de mois (lot 1b, retour n° 47) : URL, puis période de travail de
 * la session, puis la règle commune (dernier mois substantiel avec des données, dite
 * par PeriodBanner). Univers = sites actifs de la période (énoncé sous les chiffres clés) ;
 * « suivi » = visite déclarée OU données reçues rattachées au site ; état RBM au DERNIER mois,
 * parmi les sites actifs ce mois-là :
 *   - Couverture (sites) = sites suivis ÷ sites actifs ;
 *   - Exécution du plan (visites) = visites prévues (mois échus) suivies dans leur mois ÷ prévues ; « — aucun plan ».
 * Bureaux : toujours par leur NOM (bureau MEMS ou libellé de la fiche) ; un
 * code non relié est montré comme tel, avec le lien pour le relier.
 * Fiabilité de l'affichage : chaque source est chargée indépendamment — si
 * l'une échoue, les cartes des autres restent affichées.
 */
export default function ProcessDashboardPage({ onNavigate }) {
  const { tr, lang } = useI18n();
  const { period, ready, auto, counts, latest, today, source, capped, setPeriod, resetToDefault } = usePeriod({ scope: 'analysis', defaultRule: 'data', maxSpan: ANALYSIS_MAX_SPAN });
  const [res, setRes] = useState(null);       // { ov, cov } : { data } | { error }
  const key = period ? `${period.from}|${period.to}` : '';

  useEffect(() => {
    if (!ready || !period) return undefined;
    let alive = true;
    setRes(null);
    const settle = (p) => p.then((data) => ({ data }), (e) => ({ error: e.message }));
    // Couverture (retour 110) : la même réponse que « Couverture & performance » ; RBM lu au dernier mois.
    Promise.all([settle(api.monOverview(period)), settle(api.dashCoverage(period))])
      .then(([ov, cov]) => {
        if (!alive) return;
        setRes({ ov, cov });
        try { if (typeof performance !== 'undefined' && performance.mark) performance.mark('period:rendered'); } catch { /* sans incidence */ }
      });
    return () => { alive = false; };
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ov = res?.ov.data;
  const covData = res?.cov.data;

  // Par bureau : couverture et exécution (sites de l'univers rattachés au bureau MEMS, mêmes
  // définitions que les tuiles) et formulaires reçus. Seul un bureau MEMS (relié) se rapproche de ses
  // sites, par son nom ; un libellé ou un code non relié reste sa propre ligne.
  const offices = useMemo(() => {
    const m = new Map();
    const get = (k, init) => {
      if (!m.has(k)) m.set(k, { key: k, execution: null, coverage: null, sites: 0, submissions: 0, dataSites: 0, ...init });
      return m.get(k);
    };
    const none = { status: 'relie', name: tr('Sans bureau') }; // sites sans bureau + formulaires sans bureau déclaré
    for (const g of covData?.byOffice || []) {
      const r = g.key === '—' ? get('none', { row: none }) : get(`name:${g.label}`, { row: { status: 'relie', name: g.label } });
      r.sites = g.sites; r.execution = g.execution; r.coverage = g.coverage;
    }
    for (const b of ov?.byBureau || []) {
      const k = b.status === 'vide' ? 'none' : b.status === 'relie' ? `name:${b.name}` : b.key;
      const r = get(k, { row: b.status === 'vide' ? none : b });
      r.submissions += b.submissions; r.dataSites += b.sites;
    }
    return [...m.values()].sort((a, b) => (b.sites - a.sites) || (b.submissions - a.submissions));
  }, [covData, ov, tr]);
  const watch = watchList(offices);

  const o = covData?.overall;
  const empty = ov && ov.totals.submissions === 0;
  const go = (mod, sub) => onNavigate && onNavigate(mod, sub);
  const pLabel = period ? periodLabel(period, lang) : '';
  const toLabel = period ? monthLabel(period.to) : '';
  const months = period ? spanMonths(period) : 0;

  return (
    <div className="section-gap">
      <PageHeader title={tr('Suivi de processus — Synthèse')}
        description={tr("Vue d'ensemble du suivi par bureau : visites réalisées, données reçues et conformité (fiches & indicateurs), sites à suivre (RBM). Recalculé en direct.")}>
        {ready && <PeriodSelect value={period} onChange={setPeriod} counts={counts} latest={latest} today={today} maxSpan={ANALYSIS_MAX_SPAN} align="right" />}
      </PageHeader>

      <PeriodBanner auto={auto} period={period} />
      <SessionPeriodNote source={source} capped={capped} onReset={resetToDefault} />
      {!auto && empty && (
        <div className="period-banner"><Alert tone="info" icon={Info}>
          {ov.latestMonth
            ? <>{tr('Aucune donnée reçue sur la période ({p}).', { p: pLabel })} {tr('Dernières données : {last}.', { last: monthLabel(ov.latestMonth) })}{' '}
              <button type="button" className="inline-link" onClick={() => setPeriod(single(ov.latestMonth))}>{tr('Voir {m}', { m: monthLabel(ov.latestMonth) })}</button></>
            : <>{tr('Aucune donnée reçue pour l\'instant.')}{' '}
              <button type="button" className="inline-link" onClick={() => go('processus', 'donnees')}>{tr('Importer des données')}</button></>}
        </Alert></div>
      )}

      {!res ? <Skeleton height={320} /> : (
        <>
          <div className="biz-kpis">
            {/* Couverture = sites de l'univers suivis (visite déclarée ou données reçues) ÷ sites actifs. */}
            <Kpi icon={Gauge} tone={o && o.coverage.rate != null ? 'blue' : ''} label={tr('Couverture (sites)')} error={res.cov.error}
              value={o ? rateText(o.coverage.rate, lang) : '—'}
              foot={o && <>
                {tr('{c} / {u} sites actifs suivis', { c: formatInt(o.coverage.covered), u: formatInt(o.sites) })}
                {o.coverage.covered > 0 && <span className="cov-ways">{waysText(tr, o.coverage, formatInt)}</span>}
              </>} />
            {/* Exécution du plan = visites prévues (mois échus) suivies dans leur mois ÷ prévues ; sans plan, « — aucun plan », jamais 0 %. */}
            <Kpi icon={ListChecks} tone={o?.execution.rate == null ? '' : 'blue'} label={tr('Exécution du plan (visites)')} error={res.cov.error}
              value={o?.execution.rate == null ? tr('— aucun plan') : rateText(o.execution.rate, lang)} textValue={o?.execution.rate == null}
              foot={o && <>
                {tr('{c} / {p} visites prévues suivies dans leur mois', { c: formatInt(o.execution.covered), p: formatInt(o.execution.planned) })}
                {upcomingText(tr, o.execution, formatInt) && <> · {upcomingText(tr, o.execution, formatInt)}</>}
                {o.execution.covered > 0 && <span className="cov-ways">{waysText(tr, o.execution, formatInt)}</span>}
              </>} />
            {/* Sites à jour = parmi les sites actifs au dernier mois de la période, ceux qui ne sont pas « à suivre » (RBM). */}
            <Kpi icon={ShieldCheck} tone={o?.rbm.due ? 'amber' : 'green'} label={tr('Sites à jour')} error={res.cov.error}
              value={upToDateValue(o && upToDateParts(o.rbm, lang, formatInt))}
              foot={o && <>
                {o.rbm.sites > 0
                  ? tr('{due} à suivre / {n} sites actifs au {m}', { due: formatInt(o.rbm.due), n: formatInt(o.rbm.sites), m: toLabel })
                  : tr('aucun site actif au {m}', { m: toLabel })}
                <span className="cov-ways">{tr('règle RBM : visite réalisée, données de la commune ou date du registre')}</span>
              </>} />
            <Kpi icon={Database} tone="blue" label={tr('Données reçues')} error={res.ov.error}
              value={formatInt(ov?.totals.submissions || 0)}
              foot={<>{tr('{n} sites (données)', { n: formatInt(ov?.totals.sites || 0) })} · {tr('{n} agent(s)', { n: formatInt(ov?.totals.agents || 0) })} · {tr('{n} mois', { n: months })}</>} />
            <Kpi icon={Activity} tone="blue" label={tr('Indice de conformité')} error={res.ov.error}
              value={formatDecimal(ov?.conformityIndex)}
              foot={ov?.conformityIndex != null ? tr('sur 100 (indicateurs %)') : ov?.totals.indicators ? tr('Aucune donnée notée sur la période') : tr('Aucun indicateur défini')} />
            <Kpi icon={MapPin} tone="blue" label={tr('Fiches · indicateurs')} error={res.ov.error}
              value={formatInt(ov?.totals.forms || 0)} foot={tr('{n} indicateur(s)', { n: formatInt(ov?.totals.indicators || 0) })} />
          </div>
          {covData && <CoverageUniverse cov={covData} period={period} onNavigate={onNavigate} />}

          <div className="syn-grid">
            <OfficesCard rows={offices} overall={o} error={res.cov.error || res.ov.error} onOpen={() => go('processus', 'sites')} onNavigate={onNavigate} />
            <div className="syn-side">
              <div className="card biz-card">
                <div className="card-header"><div className="card-title">{tr('Données reçues par mois')}</div></div>
                <div className="card-body syn-body">
                  {res.ov.error ? <CardError error={res.ov.error} /> : (
                    <TrendChart data={ov?.trend} selected={period} height={150} unit={tr('formulaire(s)')}
                      label={tr('Formulaires reçus par mois, {n} mois finissant en {m} ; période surlignée : {p}', { n: (ov?.trend || []).length, m: toLabel, p: pLabel })}
                      empty={tr('Aucune donnée reçue sur ces mois.')} />
                  )}
                </div>
              </div>
              <RiskCard rbm={o?.rbm} error={res.cov.error} asOf={toLabel} />
              <WatchCard rows={watch} error={res.cov.error} onNavigate={onNavigate} />
            </div>
            <ActivityCoverageCard cov={covData} error={res.cov.error} periodText={pLabel} />
            <FormsCard forms={ov?.perForm} error={res.ov.error} onOpen={() => go('processus', 'donnees')} />
          </div>

          <div className="note" style={{ marginTop: 16 }}>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{tr('Les données reçues viennent des fiches importées (Kobo/ODK/CSV) dans « Données & indicateurs » ; un site est suivi par une visite déclarée (« Affectation & visites ») ou par des données reçues rattachées à lui ; les sites à suivre viennent du RBM. Un bureau est celui auquel le site est rattaché (Paramétrage › Bureaux).')}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** Message d'erreur d'une source, à la place de la carte qui en dépend. */
function CardError({ error }) {
  return <p className="muted" role="alert"><AlertCircle size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />{error}</p>;
}

/** « Sites à jour » : le nombre, le taux en petit (.biz-kpi-value small) — même rendu sur Couverture & performance. */
const upToDateValue = (p) => (p ? <span className="kpi-split">{p.n} <small>({p.pct})</small></span> : '—');

function Kpi({ icon: Icon, label, value, foot, tone, error, textValue = false }) {
  const { tr } = useI18n();
  return (
    <div className="biz-kpi">
      <div className={`biz-kpi-ic ${error ? 'amber' : tone || ''}`}><Icon size={18} aria-hidden="true" /></div>
      <div className="biz-kpi-body">
        <div className="biz-kpi-label">{label}</div>
        <div className={`biz-kpi-value tabular${textValue && !error ? ' is-text' : ''}`}>{error ? '—' : value}</div>
        {error ? <div className="biz-kpi-foot text-warn" title={error}>{tr('Indisponible')}</div> : foot && <div className="biz-kpi-foot">{foot}</div>}
      </div>
    </div>
  );
}

const barColor = (pct) => (pct >= 80 ? 'var(--green)' : (pct >= 50 ? 'var(--blue-600)' : 'var(--orange)'));

/** Cellule « taux » : barre courte, taux (« 0,5 % ») et « n/d » dessous ; « — aucun plan » / « — » sans dénominateur. */
function RateCell({ rate, num, den, none }) {
  const { lang } = useI18n();
  const pct = barPct(rate);
  if (pct == null) return <span className="muted">{none}</span>;
  return (
    <span className="syn-bar-cell"><span className="biz-bar"><span style={{ width: `${pct}%`, background: barColor(pct) }} /></span>
      <span className="tabular syn-pct">{rateText(rate, lang)}<span className="syn-sub">{formatInt(num)}/{formatInt(den)}</span></span></span>
  );
}

/**
 * Par bureau : exécution du plan (visites prévues suivies dans leur mois), couverture des sites
 * (sites suivis ÷ sites actifs) — mêmes définitions et même univers que les tuiles — et
 * formulaires reçus ; table dense. Total = les tuiles.
 */
function OfficesCard({ rows, overall, error, onOpen, onNavigate }) {
  const { tr } = useI18n();
  const submissions = rows.reduce((a, r) => a + r.submissions, 0);
  return (
    <div className="card biz-card syn-main">
      <div className="card-header"><div className="card-title">{tr('Suivi par bureau')}</div>
        <div className="card-sub">{tr('Visites prévues suivies · sites actifs suivis · formulaires reçus')}</div></div>
      {error ? <div className="card-body"><CardError error={error} /></div> : rows.length === 0 ? (
        <div className="card-body"><p className="muted">{tr('Aucune visite planifiée ni donnée reçue sur la période.')}{' '}
          <button type="button" className="inline-link" onClick={onOpen}>{tr('Planifier les visites')}</button></p></div>
      ) : (
        <div className="table-wrap syn-scroll">
          <table className="table syn-table">
            <thead><tr>
              <th scope="col">{tr('Bureau')}</th>
              <th scope="col">{tr('Exécution du plan (visites)')}</th>
              <th scope="col">{tr('Couverture (sites)')}</th>
              <th scope="col" className="num">{tr('Formulaires reçus')}</th>
              <th scope="col" className="num">{tr('Sites (données)')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><CodeLabel row={r.row} onNavigate={onNavigate} showForm /></td>
                  <td className="syn-cov">{r.execution
                    ? <RateCell rate={r.execution.rate} num={r.execution.covered} den={r.execution.planned} none={tr('— aucun plan')} />
                    : <span className="muted">{tr('— aucun plan')}</span>}</td>
                  <td className="syn-cov">{r.coverage
                    ? <RateCell rate={r.coverage.rate} num={r.coverage.covered} den={r.sites} none="—" />
                    : <span className="muted">—</span>}</td>
                  <td className="num tabular">{formatInt(r.submissions)}</td>
                  <td className="num tabular">{r.dataSites ? formatInt(r.dataSites) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td>{tr('Total')}</td>
              <td className="syn-cov">{overall
                ? <RateCell rate={overall.execution.rate} num={overall.execution.covered} den={overall.execution.planned} none={tr('— aucun plan')} />
                : <span className="muted">{tr('— aucun plan')}</span>}</td>
              <td className="syn-cov">{overall ? <RateCell rate={overall.coverage.rate} num={overall.coverage.covered} den={overall.sites} none="—" /> : '—'}</td>
              <td className="num tabular">{formatInt(submissions)}</td>
              <td />
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/** Conformité par fiche ; une fiche sans indicateur ou non rattachée dit quoi faire. */
function FormsCard({ forms, error, onOpen }) {
  const { tr } = useI18n();
  return (
    <div className="card biz-card syn-full">
      <div className="card-header"><div className="card-title">{tr('Conformité par fiche')}</div>
        <div className="card-sub">{tr('Indice sur 100, calculé à partir des indicateurs de chaque fiche')}</div></div>
      {error ? <div className="card-body"><CardError error={error} /></div> : !forms || forms.length === 0 ? (
        <div className="card-body"><p className="muted">{tr('Aucune fiche active.')}{' '}<button type="button" className="inline-link" onClick={onOpen}>{tr('Créer ou importer une fiche')}</button></p></div>
      ) : (
        <div className="table-wrap">
          <table className="table syn-table">
            <thead><tr>
              <th scope="col">{tr('Fiche')}</th>
              <th scope="col" className="num">{tr('Formulaires reçus')}</th>
              <th scope="col" className="num">{tr('Indicateurs')}</th>
              <th scope="col">{tr('Indice de conformité')}</th>
              <th scope="col">{tr('À faire')}</th>
            </tr></thead>
            <tbody>
              {forms.map((f) => {
                const todo = !f.indicators ? tr('aucun indicateur défini') : f.index == null ? tr('aucune donnée notée sur la période') : null;
                return (
                  <tr key={f.id}>
                    <td><strong title={f.label}>{f.label}</strong></td>
                    <td className="num tabular">{formatInt(f.submissions)}</td>
                    <td className="num tabular">{formatInt(f.indicators)}</td>
                    <td className="syn-cov">
                      {f.index == null ? <span className="muted">—</span> : (
                        <span className="syn-bar-cell"><span className="biz-bar"><span style={{ width: `${Math.min(100, f.index)}%`, background: barColor(f.index) }} /></span>
                          <span className="tabular">{formatDecimal(f.index)}/100</span></span>
                      )}
                    </td>
                    <td>
                      {todo && <span className="text-warn">{todo}</span>}
                      {!f.activityCategory && <>{todo ? ' · ' : ''}<span className="text-warn">{tr('non rattachée à une activité')}</span></>}
                      {(!f.indicators || !f.activityCategory) && <> · <button type="button" className="inline-link" onClick={onOpen}>{tr('Compléter la fiche')} <ArrowRight size={12} aria-hidden="true" /></button></>}
                      {!todo && f.activityCategory && f.indicators > 0 && <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Sites actifs au dernier mois de la période, par niveau de risque (RBM) — les mêmes que « Sites à jour ». */
function RiskCard({ rbm, error, asOf }) {
  const { tr } = useI18n();
  const by = (rbm && rbm.byRisk) || {};
  const items = [
    { k: 'elevee', label: tr('Risque élevé'), n: by.elevee || 0, color: 'var(--red)' },
    { k: 'moyenne', label: tr('Risque moyen'), n: by.moyenne || 0, color: 'var(--orange)' },
    { k: 'faible', label: tr('Risque faible'), n: by.faible || 0, color: 'var(--green)' },
  ];
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{tr('Répartition des sites par risque')}</div>
        <div className="card-sub">{tr('{n} site(s) à suivre sur {t} actifs au {m} (RBM)', { n: formatInt((rbm && rbm.due) || 0), t: formatInt((rbm && rbm.sites) || 0), m: asOf })}</div></div>
      <div className="card-body syn-body biz-gauges syn-compact">
        {error ? <CardError error={error} /> : items.map((i) => (
          <div className="biz-gauge" key={i.k}>
            <div className="biz-gauge-head"><span>{i.label}</span><span className="tabular">{formatInt(i.n)}</span></div>
            <div className="biz-bar"><span style={{ width: `${(i.n / max) * 100}%`, background: i.color }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WatchCard({ rows, error, onNavigate }) {
  const { tr, lang } = useI18n();
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{tr('Bureaux à surveiller — exécution du plan')}</div>
        <div className="card-sub">{tr('Bureaux dont l\'exécution du plan (visites) est < 80 %')}</div></div>
      <div className="card-body syn-body biz-gauges syn-compact">
        {error ? <CardError error={error} /> : (!rows || rows.length === 0) ? <p className="muted">{tr('Tous les bureaux avec des visites planifiées sont à 80 % ou plus.')}</p> : rows.map((d) => {
          const pct = barPct(d.execution.rate) || 0;
          return (
            <button type="button" className="biz-gauge" key={d.key} onClick={() => onNavigate && onNavigate('processus', 'sites')} title={tr('Ouvrir Affectation & visites')}>
              <div className="biz-gauge-head"><span>{d.row?.name || tr('Sans bureau')}</span><span className="tabular">{formatInt(d.execution.covered)}/{formatInt(d.execution.planned)} · {rateText(d.execution.rate, lang)}</span></div>
              <div className="biz-bar"><span style={{ width: `${pct}%`, background: pct < 50 ? 'var(--red)' : 'var(--orange)' }} /></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
