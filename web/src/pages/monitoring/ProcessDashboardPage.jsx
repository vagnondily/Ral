import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, ShieldCheck, Database, ListChecks, MapPin, Activity, AlertTriangle, AlertCircle, Info, ArrowRight } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, PageHeader, Skeleton } from '../../components/ui.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import TrendChart from '../../components/charts/TrendChart.jsx';
import CodeLabel from '../../components/CodeLabel.jsx';
import { ActivationNote, PeriodBanner, SessionPeriodNote, usePeriod } from '../../components/PeriodBanner.jsx';
import { formatInt, monthLabel } from '../../lib/format.js';
import { periodLabel, single, spanMonths } from '../../lib/period.js';
import { useI18n } from '../../lib/i18n.jsx';

/** Durée maximale des endpoints d'analyse (overview, coverage-dashboard, field/summary) : 24 mois. */
const ANALYSIS_MAX_SPAN = 24;

/**
 * Dashboard « Suivi de processus » — Synthèse. Recalculé en direct (rien de
 * stocké) à partir de trois sources déjà en place :
 *   • Données versées + conformité  ← Suivi de processus (fiches + indicateurs)
 *   • Couverture / sites à jour      ← Affectation & visites + RBM
 * Objectif : voir d'un coup l'état du suivi, PAR BUREAU (visites et données
 * reçues), et les bureaux à surveiller.
 *
 * Période = plage de mois (lot 1b, retour n° 47) : URL, puis période de travail de
 * la session, puis la règle commune (dernier mois substantiel avec des données, dite
 * par PeriodBanner). Sur une plage : soumissions et visites SOMMÉES, sites et agents
 * DISTINCTS, état RBM au DERNIER mois. Deux taux terrain distincts :
 *   - Couverture (sites) = sites actifs réalisés ÷ sites actifs (distincts sur la période) ;
 *   - Exécution du plan (visites) = visites réalisées ÷ visites prévues ; « — aucun plan ».
 * Bureaux : toujours par leur NOM (bureau MEMS ou libellé de la fiche) ; un
 * code non relié est montré comme tel, avec le lien pour le relier.
 * Fiabilité de l'affichage : chaque source est chargée indépendamment — si
 * l'une échoue, les cartes des autres restent affichées.
 */
export default function ProcessDashboardPage({ onNavigate }) {
  const { tr, lang } = useI18n();
  const { period, ready, auto, counts, latest, today, source, setPeriod, resetToDefault } = usePeriod({ scope: 'analysis', defaultRule: 'data', maxSpan: ANALYSIS_MAX_SPAN });
  const [res, setRes] = useState(null);       // { ov, field, rbm } : { data } | { error }
  const key = period ? `${period.from}|${period.to}` : '';

  useEffect(() => {
    if (!ready || !period) return undefined;
    let alive = true;
    setRes(null);
    const settle = (p) => p.then((data) => ({ data }), (e) => ({ error: e.message }));
    // RBM : un état, lu au dernier mois de la période (le serveur prend `to`).
    Promise.all([settle(api.monOverview(period)), settle(api.fieldSummary(period)), settle(api.rbmSites(period))])
      .then(([ov, field, rbm]) => {
        if (!alive) return;
        setRes({ ov, field, rbm });
        try { if (typeof performance !== 'undefined' && performance.mark) performance.mark('period:rendered'); } catch { /* sans incidence */ }
      });
    return () => { alive = false; };
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ov = res?.ov.data;
  const field = res?.field.data;
  const rbm = res?.rbm.data;

  const rbmStats = useMemo(() => {
    const s = { total: 0, due: 0, elevee: 0, moyenne: 0, faible: 0 };
    for (const x of rbm || []) { s.total += 1; s[x.riskLevel] = (s[x.riskLevel] || 0) + 1; if (x.due) s.due += 1; }
    return s;
  }, [rbm]);

  // Par bureau : visites (sites rattachés au bureau MEMS) et formulaires reçus. Seul un bureau MEMS
  // (relié) se rapproche de ses visites, par son nom ; un libellé ou un code non relié reste sa propre ligne.
  const offices = useMemo(() => {
    const m = new Map();
    const get = (k, init) => {
      if (!m.has(k)) m.set(k, { key: k, active: 0, realise: 0, rate: null, sitesActive: 0, sitesRealised: 0, coverage: null, submissions: 0, sites: 0, ...init });
      return m.get(k);
    };
    const none = { status: 'relie', name: tr('Sans bureau') }; // sites sans bureau + formulaires sans bureau déclaré
    for (const o of field?.byOffice || []) {
      const r = o.key === '—' ? get('none', { row: none }) : get(`name:${o.label}`, { row: { status: 'relie', name: o.label } });
      r.active = o.active; r.realise = o.realise; r.rate = o.active > 0 ? o.rate : null;
      r.sitesActive = o.sites?.active || 0; r.sitesRealised = o.sites?.realised || 0; r.coverage = o.coverage ?? null;
    }
    for (const b of ov?.byBureau || []) {
      const k = b.status === 'vide' ? 'none' : b.status === 'relie' ? `name:${b.name}` : b.key;
      const r = get(k, { row: b.status === 'vide' ? none : b });
      r.submissions += b.submissions; r.sites += b.sites;
    }
    return [...m.values()].sort((a, b) => (b.active - a.active) || (b.submissions - a.submissions));
  }, [field, ov, tr]);
  const watch = offices.filter((o) => o.rate != null && o.rate < 0.8).sort((a, b) => a.rate - b.rate).slice(0, 8);

  const cov = field?.overall;
  const visits = cov?.visits || {};
  const empty = ov && ov.totals.submissions === 0;
  const go = (mod, sub) => onNavigate && onNavigate(mod, sub);
  const pLabel = period ? periodLabel(period, lang) : '';
  const toLabel = period ? monthLabel(period.to) : '';
  const months = period ? spanMonths(period) : 0;
  const pct = (v) => tr('{p} %', { p: Math.round((v || 0) * 100) });

  return (
    <div className="page">
      <PageHeader title={tr('Suivi de processus — Synthèse')}
        description={tr("Vue d'ensemble du suivi par bureau : visites réalisées, données reçues et conformité (fiches & indicateurs), sites à suivre (RBM). Recalculé en direct.")}>
        {ready && <PeriodSelect value={period} onChange={setPeriod} counts={counts} latest={latest} today={today} maxSpan={ANALYSIS_MAX_SPAN} align="right" />}
      </PageHeader>

      <PeriodBanner auto={auto} onBack={(m) => setPeriod(single(m))} />
      <SessionPeriodNote source={source} onReset={resetToDefault} />
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
            {/* Couverture = sites actifs réalisés ÷ sites actifs, distincts sur la période. */}
            <Kpi icon={Gauge} tone={cov && cov.coverage != null ? 'blue' : ''} label={tr('Couverture (sites)')} error={res.field.error}
              value={cov?.coverage == null ? '—' : pct(cov.coverage)}
              foot={<>
                {tr('{r} / {a} sites actifs · distincts sur la période', { r: formatInt(cov?.sites?.realised || 0), a: formatInt(cov?.sites?.active || 0) })}
                {cov?.sites?.realisedInactive > 0 && <> · {tr('{n} hors périmètre actif', { n: formatInt(cov.sites.realisedInactive) })}</>}
              </>} />
            {/* Exécution du plan = visites réalisées ÷ visites prévues ; sans plan, « — aucun plan », jamais 0 %. */}
            <Kpi icon={ListChecks} tone={cov?.execution == null ? '' : 'blue'} label={tr('Exécution du plan (visites)')} error={res.field.error}
              value={cov?.execution == null ? tr('— aucun plan') : pct(cov.execution)} textValue={cov?.execution == null}
              foot={<>
                {tr('{done} / {planned} visites prévues', { done: formatInt(visits.realised || 0), planned: formatInt(visits.planned || 0) })}
                {visits.upcoming > 0 && <> · {tr('dont {n} visite(s) à venir', { n: formatInt(visits.upcoming) })}</>}
                {cov?.annule > 0 && <> · {tr('{n} annulée(s)', { n: formatInt(cov.annule) })}</>}
              </>} />
            <Kpi icon={ShieldCheck} tone={rbmStats.due ? 'amber' : 'green'} label={tr('Sites à jour')} error={res.rbm.error}
              value={formatInt(rbmStats.total - rbmStats.due)}
              foot={<>{tr('{due} à suivre / {total}', { due: formatInt(rbmStats.due), total: formatInt(rbmStats.total) })} · {tr('état au {m}', { m: toLabel })}</>} />
            <Kpi icon={Database} tone="blue" label={tr('Données reçues')} error={res.ov.error}
              value={formatInt(ov?.totals.submissions || 0)}
              foot={<>{tr('{n} sites (données)', { n: formatInt(ov?.totals.sites || 0) })} · {tr('{n} agent(s)', { n: formatInt(ov?.totals.agents || 0) })} · {tr('{n} mois', { n: months })}</>} />
            <Kpi icon={Activity} tone="blue" label={tr('Indice de conformité')} error={res.ov.error}
              value={ov?.conformityIndex == null ? '—' : `${ov.conformityIndex}`}
              foot={ov?.conformityIndex != null ? tr('sur 100 (indicateurs %)') : ov?.totals.indicators ? tr('Aucune donnée notée sur la période') : tr('Aucun indicateur défini')} />
            <Kpi icon={MapPin} tone="blue" label={tr('Fiches · indicateurs')} error={res.ov.error}
              value={formatInt(ov?.totals.forms || 0)} foot={tr('{n} indicateur(s)', { n: formatInt(ov?.totals.indicators || 0) })} />
          </div>
          <ActivationNote field={field} />

          <div className="syn-grid">
            <OfficesCard rows={offices} error={res.field.error || res.ov.error} onOpen={() => go('processus', 'sites')} onNavigate={onNavigate} />
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
              <RiskCard stats={rbmStats} error={res.rbm.error} asOf={toLabel} />
              <WatchCard rows={watch} error={res.field.error} onNavigate={onNavigate} />
            </div>
            <FormsCard forms={ov?.perForm} error={res.ov.error} onOpen={() => go('processus', 'donnees')} />
          </div>

          <div className="note" style={{ marginTop: 16 }}>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{tr('Les données reçues viennent des fiches importées (Kobo/ODK/CSV) dans « Données & indicateurs » ; la couverture et les sites à suivre viennent de « Affectation & visites » et du RBM. Un bureau est celui auquel le site est rattaché (Paramétrage › Bureaux).')}</span>
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

/**
 * Par bureau : exécution du plan (visites réalisées / prévues), couverture des sites
 * (sites actifs réalisés / sites actifs) et formulaires reçus — table dense.
 */
function OfficesCard({ rows, error, onOpen, onNavigate }) {
  const { tr } = useI18n();
  const tot = rows.reduce((a, r) => ({ active: a.active + r.active, realise: a.realise + r.realise, submissions: a.submissions + r.submissions }), { active: 0, realise: 0, submissions: 0 });
  return (
    <div className="card biz-card syn-main">
      <div className="card-header"><div className="card-title">{tr('Suivi par bureau')}</div>
        <div className="card-sub">{tr('Visites réalisées / prévues · sites actifs réalisés · formulaires reçus')}</div></div>
      {error ? <div className="card-body"><CardError error={error} /></div> : rows.length === 0 ? (
        <div className="card-body"><p className="muted">{tr('Aucune visite planifiée ni donnée reçue sur la période.')}{' '}
          <button type="button" className="inline-link" onClick={onOpen}>{tr('Planifier les visites')}</button></p></div>
      ) : (
        <div className="table-wrap syn-scroll">
          <table className="table syn-table">
            <thead><tr>
              <th scope="col">{tr('Bureau')}</th>
              <th scope="col">{tr('Exécution du plan (visites)')}</th>
              <th scope="col" className="num">{tr('Couverture (sites)')}</th>
              <th scope="col" className="num">{tr('Formulaires reçus')}</th>
              <th scope="col" className="num">{tr('Sites (données)')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.rate == null ? null : Math.round(r.rate * 100);
                return (
                  <tr key={r.key}>
                    <td><CodeLabel row={r.row} onNavigate={onNavigate} showForm /></td>
                    <td className="syn-cov" title={r.active ? tr('{done} / {planned} visites prévues', { done: formatInt(r.realise), planned: formatInt(r.active) }) : undefined}>
                      {pct == null ? <span className="muted">{tr('— aucun plan')}</span> : (
                        <span className="syn-bar-cell"><span className="biz-bar"><span style={{ width: `${Math.min(100, pct)}%`, background: barColor(pct) }} /></span>
                          <span className="tabular">{tr('{p} %', { p: pct })} <span className="muted">· {formatInt(r.realise)}/{formatInt(r.active)}</span></span></span>
                      )}
                    </td>
                    <td className="num tabular" title={tr('{r} / {a} sites actifs · distincts sur la période', { r: formatInt(r.sitesRealised), a: formatInt(r.sitesActive) })}>
                      {r.coverage == null ? '—' : tr('{p} %', { p: Math.round(r.coverage * 100) })}
                    </td>
                    <td className="num tabular">{formatInt(r.submissions)}</td>
                    <td className="num tabular">{r.sites ? formatInt(r.sites) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr>
              <td>{tr('Total')}</td>
              <td className="tabular">{tot.active
                ? <>{tr('{p} %', { p: Math.round((tot.realise / tot.active) * 100) })} <span className="muted">· {formatInt(tot.realise)}/{formatInt(tot.active)}</span></>
                : <span className="muted">{tr('— aucun plan')}</span>}</td>
              <td />
              <td className="num tabular">{formatInt(tot.submissions)}</td>
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
                          <span className="tabular">{f.index}/100</span></span>
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

function RiskCard({ stats, error, asOf }) {
  const { tr } = useI18n();
  const items = [
    { k: 'elevee', label: tr('Risque élevé'), n: stats.elevee, color: 'var(--red)' },
    { k: 'moyenne', label: tr('Risque moyen'), n: stats.moyenne, color: 'var(--orange)' },
    { k: 'faible', label: tr('Risque faible'), n: stats.faible, color: 'var(--green)' },
  ];
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{tr('Répartition des sites par risque')}</div>
        <div className="card-sub">{tr('{n} site(s) à suivre — état au {m} (RBM)', { n: formatInt(stats.due), m: asOf })}</div></div>
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
  const { tr } = useI18n();
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{tr('Bureaux à surveiller — exécution du plan')}</div>
        <div className="card-sub">{tr('Bureaux dont l\'exécution du plan (visites) est < 80 %')}</div></div>
      <div className="card-body syn-body biz-gauges syn-compact">
        {error ? <CardError error={error} /> : (!rows || rows.length === 0) ? <p className="muted">{tr('Tous les bureaux avec des visites planifiées sont à 80 % ou plus.')}</p> : rows.map((d) => {
          const pct = Math.round((d.rate || 0) * 100);
          return (
            <button type="button" className="biz-gauge" key={d.key} onClick={() => onNavigate && onNavigate('processus', 'sites')} title={tr('Ouvrir Affectation & visites')}>
              <div className="biz-gauge-head"><span>{d.row?.name || tr('Sans bureau')}</span><span className="tabular">{d.realise}/{d.active} · {tr('{p} %', { p: pct })}</span></div>
              <div className="biz-bar"><span style={{ width: `${Math.min(100, pct)}%`, background: pct < 50 ? 'var(--red)' : 'var(--orange)' }} /></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
