import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, ShieldCheck, Database, TrendingUp, LayoutGrid, LayoutList, ListChecks, Map as MapIcon, FileText, HelpCircle, Info, SlidersHorizontal, Sparkles, Link2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, PageHeader, Skeleton } from '../../components/ui.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import TrendChart from '../../components/charts/TrendChart.jsx';
import CodeLabel from '../../components/CodeLabel.jsx';
import { PeriodBanner, SessionPeriodNote, usePeriod } from '../../components/PeriodBanner.jsx';
import ActivityCoverageCard from '../../components/ActivityCoverageCard.jsx';
import CoverageUniverse from '../../components/CoverageUniverse.jsx';
import { formatInt, monthLabel } from '../../lib/format.js';
import { periodLabel, single } from '../../lib/period.js';
import MapExplorer, { peekMapOpen, forgetMapOpen } from '../../components/map/MapExplorer.jsx';
import { groupNaReasons } from '../../lib/naReasons.js';
import { shortFormLabel as shortLabel } from '../../lib/formLabel.js';
import { useI18n } from '../../lib/i18n.jsx';
import { barPct, planVsRealRows, rateText, waysText, watchList } from '../../lib/coverageDefs.js';

/** Durée maximale des endpoints de la page (coverage-dashboard, dashboards/coverage) : 24 mois. */
const ANALYSIS_MAX_SPAN = 24;

/**
 * Dashboard décisionnel › « Couverture & performance du suivi ».
 * Reproduit (dans le design system de l'app, branding neutre) la synthèse du
 * suivi de processus : couverture, données versées, conformité en 5 bandes,
 * plan vs réalisé, et un détail par activité (= fiche) — dimensions, top/flop
 * d'indicateurs, tendance, bureaux. Tout est recalculé en direct :
 *   • conformité/indicateurs ← /monitoring/coverage-dashboard
 *   • couverture, exécution du plan, sites prévus, sites à jour (RBM), communes, par activité
 *     et par district ← /dashboards/coverage : la MÊME réponse que la Synthèse du suivi de
 *     processus (retour 110 : une définition par mesure, lib/coverageDefs), calculée par le même
 *     service de faits que la vue Carte (même couverture, vérifiée par test/coverageDb.test.js)
 * Période = plage de mois (lot 1b, retour n° 47) : URL, puis période de travail de la
 * session, puis la règle commune (dernier mois substantiel avec des données, dite par
 * PeriodBanner). Univers = sites actifs de la période, énoncé sous les chiffres clés ;
 * « suivi » = visite déclarée OU données reçues rattachées au site ; état RBM au dernier
 * mois de la période, parmi les sites actifs ce mois-là. Couverture (sites) = sites suivis
 * ÷ sites actifs ; Exécution du plan (visites) = visites prévues (mois échus) suivies dans
 * leur mois ÷ prévues — sans plan, « — aucun plan », jamais 0 % ni « Situation critique ».
 * « Ouvrir la carte » (Vue d'ensemble) passe la période par l'URL
 * (#/dashboard/couverture?from=…&to=…, lue par usePeriod) et le thème / les filtres par
 * sessionStorage['mems.map.open'].
 */

const BANDS = [
  { k: 'exc', label: 'Excellent' },
  { k: 'sat', label: 'Satisfaisant' },
  { k: 'imp', label: 'À améliorer' },
  { k: 'urg', label: 'Action urgente' },
  { k: 'na', label: 'Non évalué' },
];

const BAND_LABEL = Object.fromEntries(BANDS.map((b) => [b.k, b.label]));

const VIEWS = [
  { id: 'synthese', label: 'Synthèse', icon: Gauge },
  { id: 'controle', label: 'Salle de contrôle', icon: LayoutList },
  { id: 'carte', label: 'Carte', icon: MapIcon },
  { id: 'bulletin', label: 'Bulletin', icon: FileText },
];

export default function DashboardCoveragePage({ onNavigate }) {
  const { tr, lang } = useI18n();
  const { period, ready, auto, counts, periods, latest, today, source, setPeriod, resetToDefault } = usePeriod({ scope: 'analysis', defaultRule: 'data', maxSpan: ANALYSIS_MAX_SPAN });
  const pick = (m) => setPeriod(single(m));
  const key = period ? `${period.from}|${period.to}` : '';
  const [cd, setCd] = useState(null);
  // Mesures de couverture (retour 110) : la même réponse que la Synthèse du suivi de processus.
  const [cov, setCov] = useState(null);
  const [error, setError] = useState(null);
  // « Ouvrir la carte » (Vue d'ensemble) : même thème et mêmes filtres, lus une fois ; la
  // période arrive par l'URL (usePeriod).
  const [opened] = useState(() => peekMapOpen());
  useEffect(() => { forgetMapOpen(); }, []);
  const [view, setView] = useState(opened ? 'carte' : 'synthese');
  const [tab, setTab] = useState('_OV');

  useEffect(() => {
    if (!ready || !period) return undefined;
    let alive = true;
    setCd(null); setCov(null); setError(null);
    // Couverture : univers, suivis, exécution, sites prévus, état RBM au dernier mois de la période.
    Promise.all([api.monCoverageDashboard(period), api.dashCoverage(period)])
      .then(([c, v]) => {
        if (!alive) return;
        setCd(c); setCov(v);
        try { if (typeof performance !== 'undefined' && performance.mark) performance.mark('period:rendered'); } catch { /* sans incidence */ }
      })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapInitial = useMemo(() => (opened ? { theme: opened.theme, officeId: opened.officeId, activity: opened.activity } : {}), [opened]);

  const loading = !cd || !cov;
  const forms = cd?.forms || [];
  const activeForm = tab === '_OV' ? null : forms.find((f) => f.id === tab);

  return (
    <div className="page">
      <PageHeader title={tr('Couverture & performance du suivi')}
        description={tr('Vue analytique du suivi de processus : couverture terrain, données versées, conformité par bande, plan vs réalisé, et détail par activité (dimensions, indicateurs). Recalculé en direct.')}>
        {ready && <PeriodSelect value={period} onChange={setPeriod} counts={counts} latest={latest} today={today} maxSpan={ANALYSIS_MAX_SPAN} align="right" />}
      </PageHeader>

      {/* Retour 85 : la période (et la mention de session, en dessous) à gauche, le choix de la vue à
          droite — plus de mention collée au sélecteur de vue. */}
      <div className="cd-headbar">
        <div className="cd-headbar-period">
          <PeriodBanner auto={auto} period={period} />
          <SessionPeriodNote source={source} onReset={resetToDefault} />
        </div>
        <div className="cd-views" role="tablist" aria-label={tr('Vues')}>
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id}
              className={`cd-view${view === v.id ? ' is-active' : ''}`} onClick={() => setView(v.id)}>
              <v.icon size={15} aria-hidden="true" />{tr(v.label)}
            </button>
          ))}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {!auto && cd && period && (cd.totals?.submissions || 0) === 0 && (
        <div className="period-banner"><Alert tone="info" icon={Info}>
          {tr('Aucune donnée reçue sur la période ({p}).', { p: periodLabel(period, lang) })}
          {periods?.latestMonth && (periods.latestMonth < period.from || periods.latestMonth > period.to) && (
            <>{' '}{tr('Dernières données : {last}.', { last: monthLabel(periods.latestMonth) })}{' '}
              <button type="button" className="inline-link" onClick={() => pick(periods.default?.month || periods.latestMonth)}>{tr('Voir {m}', { m: monthLabel(periods.default?.month || periods.latestMonth) })}</button></>
          )}
        </Alert></div>
      )}
      {loading && !error ? <Skeleton height={360} /> : !error && (
        <>
          {view === 'synthese' && (
            <>
              <div className="cd-tabs" role="tablist" aria-label={tr('Activités')}>
                <TabBtn id="_OV" label={tr('Vue d\'ensemble')} active={tab === '_OV'} onClick={setTab} />
                {forms.map((f) => (
                  <TabBtn key={f.id} id={f.id} label={shortLabel(f.label)} active={tab === f.id} onClick={setTab} />
                ))}
              </div>
              {tab === '_OV'
                ? <Overview cd={cd} cov={cov} period={period} onNavigate={onNavigate} />
                : activeForm && <ActivityView form={activeForm} period={period} periods={periods} onPick={pick} onNavigate={onNavigate} />}
            </>
          )}
          {view === 'controle' && <ControlRoom cd={cd} />}
          {view === 'carte' && <MapExplorer variant="full" period={period || undefined} onNavigate={onNavigate} initial={mapInitial} />}
          {view === 'bulletin' && <Bulletin cd={cd} cov={cov} period={period} />}
        </>
      )}
    </div>
  );
}

function TabBtn({ id, label, active, onClick }) {
  return (
    <button type="button" role="tab" aria-selected={active}
      className={`cd-tab${active ? ' is-active' : ''}`} onClick={() => onClick(id)}>{label}</button>
  );
}

// ---------------------------------------------------------------- Vue d'ensemble
function Overview({ cd, cov, period, onNavigate }) {
  const { tr, lang } = useI18n();
  // Mesures de couverture (retour 110) : une définition par mesure, la même réponse que la Synthèse.
  const o = cov.overall;
  const toLabel = period ? monthLabel(period.to) : '';
  const cls = cd.classes || {};
  const urgentPct = cls.scored ? Math.round((cls.urg / cls.scored) * 100) : 0;
  const ways = (m) => (m && m.covered > 0 ? <span className="cov-ways">{waysText(tr, m, formatInt)}</span> : null);

  // Plan vs réalisé : visites prévues → suivies dans leur mois ; sites prévus → suivis ; communes de
  // l'univers → communes avec des données (la même unité des deux côtés).
  const [pv, ps, pc] = planVsRealRows(cov);
  const pvr = [
    { label: tr('Visites de terrain'), sub: tr('prévues (mois échus) → suivies dans leur mois, par visite déclarée ou données reçues'),
      ...pv, unit: tr('visite(s)'), ways: ways(pv.ways), extra: pv.upcoming > 0 ? tr('{n} à venir', { n: formatInt(pv.upcoming) }) : null },
    { label: tr('Sites prévus'), sub: tr('sites de l\'univers avec une visite prévue (mois échus) → suivis'),
      ...ps, unit: tr('site(s)'), ways: ways(ps.ways) },
    { label: tr('Données versées'), sub: tr('communes des sites de l\'univers → communes avec des données reçues'),
      ...pc, unit: tr('commune(s)'), ways: null },
  ];

  const byActivity = (cd.forms || []).map((f) => ({
    key: f.id, label: shortLabel(f.label),
    pct: f.index == null ? 0 : Math.round(f.index),
    urgent: (f.classes && f.classes.urg) || 0,
    noIndicator: !f.indicatorCount,
    noData: f.index == null,
  }));
  const regions = (cd.regions || []).slice(0, 8);
  const watch = watchList(cov.byDistrict);

  return (
    <>
      <div className="biz-kpis cd-kpis-5">
        <DonutKpi icon={Gauge} label={tr('Couverture (sites)')} pct={barPct(o.coverage.rate)} display={rateText(o.coverage.rate, lang)}
          foot={o.sites > 0
            ? <>{tr('{c} / {u} sites actifs suivis', { c: formatInt(o.coverage.covered), u: formatInt(o.sites) })}{ways(o.coverage)}</>
            : tr('aucun site actif sur la période')} />
        <DonutKpi icon={ListChecks} label={tr('Exécution du plan (visites)')} pct={barPct(o.execution.rate)} display={rateText(o.execution.rate, lang)} noneLabel={tr('— aucun plan')}
          foot={<>
            {tr('{c} / {p} visites prévues suivies dans leur mois', { c: formatInt(o.execution.covered), p: formatInt(o.execution.planned) })}
            {o.execution.upcoming > 0 && <> · {tr('{n} à venir', { n: formatInt(o.execution.upcoming) })}</>}
            {ways(o.execution)}
          </>} />
        <DonutKpi icon={ShieldCheck} label={tr('Sites à jour')} pct={barPct(o.rbm.rate)} display={rateText(o.rbm.rate, lang)} tone={o.rbm.due ? 'amber' : 'green'}
          foot={o.rbm.sites > 0
            ? tr('{due} à suivre / {n} sites actifs au {m}', { due: formatInt(o.rbm.due), n: formatInt(o.rbm.sites), m: toLabel })
            : tr('aucun site actif au {m}', { m: toLabel })} />
        <Kpi icon={Database} label={tr('Données versées')} value={formatInt(cd.totals?.submissions || 0)}
          foot={tr('{agents} agent(s) · {c} / {t} communes de l\'univers avec données', { agents: formatInt(cd.totals?.agents || 0), c: formatInt(cov.communes.withData), t: formatInt(cov.communes.total) })} />
        <Kpi icon={LayoutGrid} label={tr('Fiches · indicateurs')} value={formatInt(cd.totals?.forms || 0)}
          foot={tr('{n} indicateur(s)', { n: formatInt(cd.totals?.indicators || 0) })} />
      </div>
      <CoverageUniverse cov={cov} period={period} onNavigate={onNavigate} />

      {/* Bande conformité : indice + répartition 5 bandes + action urgente */}
      <div className="card biz-card cd-conf">
        <div className="cd-conf-idx">
          <div className="cd-conf-n tabular">{cd.conformityIndex == null ? '—' : cd.conformityIndex}<small>/100</small></div>
          <div className="cd-conf-l">{tr('Indice de conformité')}</div>
          <div className="biz-kpi-foot">{tr('{n} indicateur(s) noté(s)', { n: formatInt(cls.scored || 0) })}</div>
        </div>
        <div className="cd-conf-dist">
          <div className="card-title">{tr('Répartition des indicateurs')}</div>
          <ClassBar classes={cls} />
          <ClassLegend classes={cls} />
        </div>
        <div className="cd-conf-urg">
          <div className="cd-conf-n tabular" style={{ color: 'var(--cd-urg)' }}>{urgentPct}<small>%</small></div>
          <div className="cd-conf-l">{tr('Action urgente')}</div>
          <div className="biz-kpi-foot">{tr('{n} sur {total}', { n: formatInt(cls.urg || 0), total: formatInt(cls.scored || 0) })}</div>
        </div>
      </div>

      <div className="biz-grid cd-grid-2">
        <PlanVsReal rows={pvr} />
        <BarsCard fill title={tr('Performance par activité')} sub={tr('Indice de conformité par fiche')}
          rows={byActivity.map((a) => ({
            key: a.key, label: a.label, pct: a.pct,
            // Sans indicateur (ou sans donnée notée) : le dire, au lieu d'un « 0 · ok » trompeur.
            right: a.noIndicator ? tr('Aucun indicateur défini') : a.noData ? tr('Aucune donnée notée')
              : `${a.pct} · ${a.urgent ? tr('{n} urgent', { n: a.urgent }) : 'ok'}`,
          }))}
          empty={tr('Aucune fiche active.')} />
      </div>

      <div className="biz-grid cd-grid-2">
        <RegionsCard regions={regions} />
        <WatchCard rows={watch} onNavigate={onNavigate} />
      </div>

      <ActivityCoverageCard cov={cov} periodText={period ? periodLabel(period, lang) : ''} className="cd-actcov" />
    </>
  );
}

// ---------------------------------------------------------------- Activité (fiche)
function ActivityView({ form, period, periods, onPick, onNavigate }) {
  const { tr, lang } = useI18n();
  const pLabel = period ? periodLabel(period, lang) : tr('Toutes les périodes');
  const inPeriod = (m) => !period || (m >= period.from && m <= period.to);
  const cls = form.classes || {};
  const groups = groupNaReasons(form.indicators);
  const outside = (form.indicators || []).filter((i) => i.scored === false).length;
  // Dernier mois avec des données POUR CETTE FICHE (pour « Aucune donnée sur la période »).
  const formLast = useMemo(() => {
    const ms = (periods?.months || []).filter((m) => !m.future && (m.byForm || {})[form.id] > 0).map((m) => m.month);
    return ms.length ? ms[ms.length - 1] : null;
  }, [periods, form.id]);
  const trendCard = (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{tr('Données versées — tendance mensuelle')}</div></div>
      <div className="card-body">
        <TrendChart data={form.trend} selected={period} height={190} unit={tr('formulaire(s)')}
          label={tr('Formulaires reçus par mois, {n} mois finissant en {m} ; période surlignée : {p}', { n: (form.trend || []).length, m: period ? monthLabel(period.to) : '', p: pLabel })}
          empty={tr('Aucune donnée versée.')} />
      </div>
    </div>
  );

  // Retour 85 : fiche sans indicateur — une seule explication et la marche à suivre, au lieu de
  // zéros, de « — » et de cartes vides ; les cartes qui ont un contenu (données) restent.
  if (!form.indicatorCount) {
    return (
      <>
        <div className="cd-noind">
          <Kpi icon={Database} label={tr('Données versées')} value={formatInt(form.submissions || 0)} foot={tr('soumissions de la fiche')} />
          <NoIndicatorCard form={form} onNavigate={onNavigate} />
        </div>
        <div className="biz-grid cd-grid-2">
          {trendCard}
          <BureauCard rows={form.byBureau || []} onNavigate={onNavigate} />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="biz-kpis cd-kpis-3">
        <Kpi icon={Database} label={tr('Données versées')} value={formatInt(form.submissions || 0)} foot={tr('soumissions de la fiche')} />
        <Kpi icon={TrendingUp} label={tr('Indice de conformité')} value={form.index == null ? '—' : `${form.index}`} foot={tr('sur 100 (indicateurs %)')} />
        <Kpi icon={ShieldCheck} label={tr('Indicateurs notés')} value={formatInt(cls.scored || 0)}
          foot={cls.na
            ? tr('{n} en action urgente · {na} non évalué(s)', { n: formatInt(cls.urg || 0), na: formatInt(cls.na) })
            : tr('{n} en action urgente', { n: formatInt(cls.urg || 0) })} />
      </div>

      <div className="card biz-card">
        <div className="card-header"><div className="card-title">{tr('Répartition des indicateurs')}</div>
          {outside > 0 && <div className="card-sub">{tr('{n} indicateur(s) complémentaire(s) hors indice, non comptés ici', { n: formatInt(outside) })}</div>}</div>
        <div className="card-body">
          <ClassBar classes={cls} />
          <ClassLegend classes={cls} />
        </div>
      </div>

      {groups.length > 0 && (
        <div className="card biz-card cd-why">
          <div className="card-header"><div className="card-title"><HelpCircle size={16} aria-hidden="true" className="cd-why-ic" />{tr('Pourquoi « Non évalué » ?')}</div>
            <div className="card-sub">{tr('{n} indicateur(s) sans bande sur {m}', { n: formatInt(cls.na || 0), m: pLabel })}</div></div>
          <div className="card-body cd-why-list">
            {groups.map((g) => (
              <div className="cd-why-row" key={g.reason}>
                <div className="cd-why-head">
                  <strong>{tr(g.label)}</strong> <span className="badge cd-why-n tabular">{formatInt(g.indicators.length)}</span>
                  {g.action === 'period' && formLast && !inPeriod(formLast) && (
                    <button type="button" className="inline-link" onClick={() => onPick(formLast)}>{tr('Voir {m}', { m: monthLabel(formLast) })}</button>
                  )}
                  {g.action === 'config' && onNavigate && (
                    <button type="button" className="inline-link" onClick={() => onNavigate('processus', 'donnees', form.id, 'config')}>
                      {tr(g.actionLabel || 'Vérifier la variable')}
                    </button>
                  )}
                </div>
                <p className="cd-why-hint">{tr(g.hint)}</p>
                <p className="cd-why-inds">
                  {g.indicators.slice(0, 8).map((i) => (g.showVariable && i.sourceField ? `${i.label} (${i.sourceField})` : i.label)).join(' · ')}
                  {g.indicators.length > 8 && ` · ${tr('+ {n} autre(s)', { n: g.indicators.length - 8 })}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="biz-grid cd-grid-2">
        <DimsCard dims={form.dims || []} />
        <div className="cd-col">
          <IndListCard title={tr('Indicateurs les plus faibles')} rows={form.flop || []} tone="low" />
          <IndListCard title={tr('Points forts')} rows={form.top || []} tone="ok" />
        </div>
      </div>

      <div className="biz-grid cd-grid-2">
        {trendCard}
        <BureauCard rows={form.byBureau || []} onNavigate={onNavigate} />
      </div>
    </>
  );
}

/**
 * Fiche reçue mais sans indicateur (retour 85) : dire pourquoi les résultats sont vides et
 * mener à la configuration — définir les indicateurs, appliquer le modèle de l'activité
 * rattachée, ou d'abord rattacher la fiche à une activité.
 */
function NoIndicatorCard({ form, onNavigate }) {
  const { tr } = useI18n();
  const go = (tab) => onNavigate && onNavigate('processus', 'donnees', form.id, tab);
  return (
    <div className="card biz-card cd-noind-card" role="status">
      <span className="cd-noind-ic" aria-hidden="true"><ListChecks size={20} /></span>
      <div className="cd-noind-body">
        <div className="cd-noind-title">{tr('Aucun indicateur n\'est encore configuré pour cette fiche')}</div>
        <p className="cd-noind-text">
          {(form.submissions || 0) > 0
            ? tr('Les données arrivent ({n} soumission(s) sur la période), mais aucun indicateur ne les transforme encore en résultats : conformité, dimensions et points forts apparaîtront dès qu\'un indicateur sera défini.', { n: formatInt(form.submissions) })
            : tr('Aucun indicateur ne transforme encore les données de cette fiche en résultats : conformité, dimensions et points forts apparaîtront dès qu\'un indicateur sera défini.')}
        </p>
        {onNavigate && (
          <div className="cd-noind-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => go('config')}>
              <SlidersHorizontal size={15} aria-hidden="true" />{tr('Configurer les indicateurs')}
            </button>
            {form.activityCategory
              ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => go('modele')} title={tr('Modèle de l\'activité « {a} »', { a: form.activityCategory })}>
                  <Sparkles size={15} aria-hidden="true" />{tr('Appliquer le modèle d\'activité')}
                </button>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => go(null)}>
                  <Link2 size={15} aria-hidden="true" />{tr('Rattacher à une activité')}
                </button>
              )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Données par bureau d'une fiche : chaque bureau par son nom ; un code non relié propose de le relier. */
function BureauCard({ rows, onNavigate }) {
  const { tr } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.submissions || 0));
  return (
    <div className="card biz-card cd-fill">
      <div className="card-header"><div className="card-title">{tr('Données par bureau')}</div><div className="card-sub">{tr('soumissions sur la période')}</div></div>
      <div className="card-body biz-gauges">
        {rows.length === 0 ? <p className="muted">{tr('Aucune donnée.')}</p> : rows.map((r) => (
          <div className="biz-gauge" key={r.key}>
            <div className="biz-gauge-head"><span><CodeLabel row={r} onNavigate={onNavigate} /></span><span className="tabular">{formatInt(r.submissions)}</span></div>
            <div className="biz-bar"><span style={{ width: `${Math.min(100, ((r.submissions || 0) / max) * 100)}%`, background: 'var(--blue-600)' }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ primitives
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

/**
 * KPI avec anneau de progression (donut SVG, dépendance zéro) ; sans base, « — » (ou `noneLabel`).
 * `display` remplace le texte du centre (ex. « 1,3 % » de formatRate) ; `loading` : anneau vide « … ».
 */
function DonutKpi({ icon: Icon, label, pct, foot, tone, noneLabel, display, loading }) {
  const none = pct == null; // pas de dénominateur (aucun plan) : anneau vide et « — », pas de couleur d'alerte
  const v = none ? 0 : Math.max(0, Math.min(100, Math.round(pct)));
  const R = 22; const C = 2 * Math.PI * R;
  const color = tone === 'green' || v >= 80 ? 'var(--green)' : (tone === 'amber' || v >= 50 ? 'var(--orange)' : 'var(--red)');
  const text = loading ? '…' : none ? '—' : (display || `${v}%`);
  return (
    <div className="biz-kpi cd-donutkpi" aria-busy={loading ? 'true' : undefined}>
      <svg className="cd-ring" viewBox="0 0 56 56" role="img" aria-label={`${label} ${text}`}>
        <circle cx="28" cy="28" r={R} fill="none" stroke="var(--canvas-sunken)" strokeWidth="6" />
        {!none && !loading && <circle cx="28" cy="28" r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(v / 100) * C} ${C}`} transform="rotate(-90 28 28)" />}
        <text x="28" y="31" textAnchor="middle" className="cd-ring-t tabular">{text}</text>
      </svg>
      <div className="biz-kpi-body">
        <div className="biz-kpi-label"><Icon size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 5 }} />{label}</div>
        {none && noneLabel && <div className="biz-kpi-value tabular cd-donut-none">{noneLabel}</div>}
        {foot && <div className="biz-kpi-foot" style={{ marginTop: 4 }}>{foot}</div>}
      </div>
    </div>
  );
}

/** Barre empilée des 5 bandes de conformité. */
function ClassBar({ classes }) {
  const { tr } = useI18n();
  const total = BANDS.reduce((a, b) => a + (classes[b.k] || 0), 0) || 1;
  return (
    <div className="cd-stack" role="img" aria-label={tr('Répartition des indicateurs par bande')}>
      {BANDS.map((b) => {
        const n = classes[b.k] || 0;
        if (!n) return null;
        return <span key={b.k} className={`cd-seg cd-${b.k}`} style={{ width: `${(n / total) * 100}%` }} title={`${tr(b.label)}: ${n}`} />;
      })}
    </div>
  );
}

function ClassLegend({ classes }) {
  const { tr } = useI18n();
  return (
    <div className="cd-legend">
      {BANDS.map((b) => (
        <span key={b.k}><i className={`cd-dot cd-${b.k}`} />{tr(b.label)} <b className="tabular">{formatInt(classes[b.k] || 0)}</b></span>
      ))}
    </div>
  );
}

/**
 * Carte « Plan vs Réalisé » — une ligne par mesure (retour 110 : même unité des deux côtés), barre
 * d'avancement, taux avec une décimale sous 10 % ; « dont … par données reçues · … par visites
 * déclarées » sous la ligne quand elle compte des suivis.
 */
function PlanVsReal({ rows }) {
  const { tr, lang } = useI18n();
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{tr('Plan vs Réalisé')}</div>
        <div className="card-sub">{tr('Avancement de la période par rapport au plan')}</div></div>
      <div className="card-body cd-pvr">
        {rows.map((r) => {
          const pct = barPct(r.rate);
          const tone = pct == null ? 'var(--text-faint)' : pct >= 80 ? 'var(--green)' : (pct >= 50 ? 'var(--orange)' : 'var(--red)');
          return (
            <div className="cd-pvr-row" key={r.id}>
              <div className="cd-pvr-head">
                <span className="cd-pvr-name">{r.label}</span>
                {pct == null
                  ? <span className="cd-pvr-v muted">{tr('— aucun plan')}{r.done ? ` · ${formatInt(r.done)} ${r.unit}` : ''}</span>
                  : <span className="tabular cd-pvr-v">{formatInt(r.done)} / {formatInt(r.planned)} {r.unit} · <b style={{ color: tone }}>{rateText(r.rate, lang)}</b></span>}
              </div>
              <div className="cd-pvr-sub">{r.sub}{r.extra ? ` · ${r.extra}` : ''}{r.ways}</div>
              <div className="biz-bar"><span style={{ width: `${pct || 0}%`, background: tone }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Carte à barres horizontales génériques (pct 0–100 ou count relatif). */
function BarsCard({ title, sub, rows, empty, mode = 'pct', fill = false }) {
  const max = mode === 'count' ? Math.max(1, ...rows.map((r) => r.count || 0)) : 100;
  return (
    <div className={`card biz-card${fill ? ' cd-fill' : ''}`}>
      <div className="card-header"><div className="card-title">{title}</div>{sub && <div className="card-sub">{sub}</div>}</div>
      <div className="card-body biz-gauges">
        {(!rows || rows.length === 0) ? <p className="muted">{empty}</p> : rows.map((r) => {
          const val = mode === 'count' ? r.count || 0 : r.pct || 0;
          const w = Math.min(100, (val / max) * 100);
          const color = mode === 'count' ? 'var(--blue-600)' : (val >= 80 ? 'var(--green)' : (val >= 50 ? 'var(--blue-600)' : 'var(--orange)'));
          return (
            <div className="biz-gauge" key={r.key}>
              <div className="biz-gauge-head"><span>{r.label}</span><span className="tabular">{r.right}</span></div>
              <div className="biz-bar"><span style={{ width: `${w}%`, background: color }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Dimensions (groupes d'indicateurs) avec score moyen. */
function DimsCard({ dims }) {
  const { tr } = useI18n();
  return (
    <div className="card biz-card cd-fill">
      <div className="card-header"><div className="card-title">{tr('Dimensions du suivi')}</div>
        <div className="card-sub">{tr('Score moyen par dimension (les plus faibles d\'abord)')}</div></div>
      <div className="card-body biz-gauges">
        {(!dims || dims.length === 0) ? <p className="muted">{tr('Aucun indicateur en pourcentage.')}</p> : dims.map((d) => {
          const color = d.score >= 80 ? 'var(--green)' : (d.score >= 50 ? 'var(--orange)' : 'var(--red)');
          return (
            <div className="biz-gauge" key={d.name}>
              <div className="biz-gauge-head"><span>{d.name} <span className="muted">· {d.n}</span></span><span className="tabular">{d.score}</span></div>
              <div className="biz-bar"><span style={{ width: `${Math.min(100, d.score)}%`, background: color }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Liste d'indicateurs (top/flop) avec mini-barre. */
function IndListCard({ title, rows, tone }) {
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{title}</div></div>
      <div className="card-body cd-inds">
        {(!rows || rows.length === 0) ? <p className="muted">—</p> : rows.map((r, i) => {
          const color = tone === 'ok' ? 'var(--green)' : (r.pct >= 50 ? 'var(--orange)' : 'var(--red)');
          return (
            <div className="cd-ind" key={`${r.label}-${i}`}>
              <span className="cd-ind-l" title={r.label}>{r.label}</span>
              <span className="cd-ind-t"><span style={{ width: `${Math.min(100, r.pct)}%`, background: color }} /></span>
              <span className="cd-ind-v tabular">{r.pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RegionsCard({ regions }) {
  const { tr } = useI18n();
  const max = Math.max(1, ...regions.map((r) => r.submissions || 0));
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{tr('Données versées par région')}</div>
        <div className="card-sub">{tr('Soumissions reçues · communes avec données')}</div></div>
      <div className="card-body biz-gauges">
        {regions.length === 0 ? <p className="muted">{tr('Aucune donnée.')}</p> : regions.map((r) => (
          <div className="biz-gauge" key={r.region}>
            <div className="biz-gauge-head"><span>{r.region}</span><span className="tabular">{tr('{s} · {c} com.', { s: formatInt(r.submissions), c: formatInt(r.communes) })}</span></div>
            <div className="biz-bar"><span style={{ width: `${(r.submissions / max) * 100}%`, background: 'var(--blue-600)' }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WatchCard({ rows, onNavigate }) {
  const { tr, lang } = useI18n();
  return (
    <div className="card biz-card cd-fill">
      <div className="card-header"><div className="card-title">{tr('Zones à surveiller — exécution du plan')}</div>
        <div className="card-sub">{tr('Districts dont l\'exécution du plan (visites prévues suivies) est < 80 %')}</div></div>
      <div className="card-body biz-gauges">
        {(!rows || rows.length === 0) ? <p className="muted">{tr('Toutes les zones avec des visites prévues sont à 80 % ou plus.')}</p> : rows.map((d) => {
          const pct = barPct(d.execution.rate) || 0;
          return (
            <button type="button" className="biz-gauge" key={d.key} onClick={() => onNavigate && onNavigate('processus', 'sites')} title={tr('Ouvrir Affectation & visites')}>
              <div className="biz-gauge-head"><span>{d.label}</span><span className="tabular">{formatInt(d.execution.covered)}/{formatInt(d.execution.planned)} · {rateText(d.execution.rate, lang)}</span></div>
              <div className="biz-bar"><span style={{ width: `${pct}%`, background: pct < 50 ? 'var(--red)' : 'var(--orange)' }} /></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- Salle de contrôle
/** Mur d'indicateurs : toutes les fiches, chaque indicateur en cellule colorée
 * par bande de conformité. Lecture d'un coup d'œil de ce qui va / ne va pas. */
function ControlRoom({ cd }) {
  const { tr } = useI18n();
  const forms = (cd.forms || []).filter((f) => (f.indicators || []).length);
  if (!forms.length) return <p className="muted">{tr('Aucun indicateur à afficher pour cette période.')}</p>;
  return (
    <>
      <div className="cd-legend" style={{ marginBottom: 14 }}>
        {BANDS.map((b) => <span key={b.k}><i className={`cd-dot cd-${b.k}`} />{tr(b.label)}</span>)}
      </div>
      {forms.map((f) => {
        const c = f.classes || {};
        return (
          <div className="card biz-card cd-crmod" key={f.id}>
            <div className="card-header">
              <div className="card-title">{shortLabel(f.label)}</div>
              <div className="card-sub">{c.urg
                ? tr('{n} soumission(s) · indice {idx}/100 · {urg} action(s) urgente(s)', { n: formatInt(f.submissions), idx: f.index == null ? '—' : String(f.index), urg: c.urg })
                : tr('{n} soumission(s) · indice {idx}/100', { n: formatInt(f.submissions), idx: f.index == null ? '—' : String(f.index) })}</div>
            </div>
            <div className="card-body">
              <div className="cd-wall">
                {(f.indicators || []).map((ind, i) => (
                  <div className={`cd-cell cd-b-${ind.cls}`} key={`${ind.code || ind.label}-${i}`} title={`${ind.label} — ${fmtVal(ind)} — ${tr(BAND_LABEL[ind.cls] || 'Non évalué')}`}>
                    <span className="cd-cell-l">{ind.label}</span>
                    <span className="sr-only">{tr(BAND_LABEL[ind.cls] || 'Non évalué')}</span>
                    <span className="cd-cell-v tabular">{fmtVal(ind)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

function fmtVal(ind) {
  if (ind.value == null) return '—';
  if (ind.agg === 'percent_yes' || ind.agg === 'percent_value') return `${Math.round(ind.value)}%`;
  return formatInt(Math.round(ind.value));
}

// ---------------------------------------------------------------------- Bulletin
/** Phrase traduite dont les {variables} sont remplacées par des nœuds React
 * (chiffres en gras du bulletin) : chaque phrase reste entière pour la traduction. */
function richText(template, vars) {
  return template.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <React.Fragment key={i}>{vars[part]}</React.Fragment> : part));
}

/**
 * Bulletin narratif : synthèse en clair générée à partir des chiffres de la période.
 * Le verdict lit l'exécution du plan (visites prévues suivies), comme avant ; la couverture des
 * sites est dite à côté — mêmes mesures que les tuiles (retour 110). Sans visite planifiée,
 * l'exécution est inconnue (« aucun plan ») : elle n'entre pas dans le verdict.
 */
function Bulletin({ cd, cov, period }) {
  const { tr, lang } = useI18n();
  const cls = cd.classes || {};
  const idx = cd.conformityIndex;
  const o = cov.overall;
  const covPct = o.execution.rate == null ? null : o.execution.rate * 100;
  const toLabel = period ? monthLabel(period.to) : '';
  const urgentPct = cls.scored ? Math.round((cls.urg / cls.scored) * 100) : 0;
  const topRegions = (cd.regions || []).filter((r) => r.region !== '(non renseigné)').slice(0, 3);
  // Indicateurs les plus faibles, toutes fiches confondues.
  const weak = [];
  for (const f of cd.forms || []) for (const ind of f.flop || []) weak.push({ ...ind, form: shortLabel(f.label) });
  weak.sort((a, b) => a.pct - b.pct);
  const covLow = (limit) => covPct != null && covPct < limit;
  const verdict = (idx == null) ? 'Situation indéterminée'
    : (idx < 50 || covLow(40)) ? 'Situation critique'
      : (idx < 65 || covLow(65)) ? 'Situation à surveiller' : 'Situation satisfaisante';
  const bold = (v) => <b>{formatInt(v || 0)}</b>;

  return (
    <div className="card biz-card cd-bull">
      <div className="card-body">
        <div className="cd-bk">{tr('Bulletin de suivi · {period}', { period: period ? periodLabel(period, lang) : tr('toutes périodes') })}</div>
        <h3>{tr(verdict)}</h3>
        <p>
          {richText(tr('Sur la période, {submissions} soumission(s) ont été versées par {agents} agent(s), réparties sur {forms} fiche(s) de suivi ({indicators} indicateurs) ; {c} commune(s) sur {t} de l\'univers ont reçu des données.'), {
            submissions: bold(cd.totals?.submissions), agents: bold(cd.totals?.agents),
            forms: bold(cd.totals?.forms), indicators: bold(cd.totals?.indicators),
            c: bold(cov.communes.withData), t: formatInt(cov.communes.total),
          })}{' '}
          {covPct == null
            ? richText(tr('Aucune visite de terrain n\'est prévue sur les mois échus de la période (exécution du plan non mesurable), et le RBM signale {due} site(s) à suivre au {m} sur {total} actif(s) ce mois-là.'), {
              due: bold(o.rbm.due), total: formatInt(o.rbm.sites), m: toLabel,
            })
            : richText(tr('L\'exécution du plan atteint {execution} ({c} visite(s) prévue(s) suivie(s) sur {p}), et le RBM signale {due} site(s) à suivre au {m} sur {total} actif(s) ce mois-là.'), {
              execution: <b>{rateText(o.execution.rate, lang)}</b>, c: formatInt(o.execution.covered), p: formatInt(o.execution.planned),
              due: bold(o.rbm.due), total: formatInt(o.rbm.sites), m: toLabel,
            })}{' '}
          {o.coverage.rate != null
            ? richText(tr('La couverture des sites atteint {coverage} ({c} site(s) suivi(s) sur {u} actif(s), dont {d} par données reçues et {v} par visites déclarées).'), {
              coverage: <b>{rateText(o.coverage.rate, lang)}</b>, c: formatInt(o.coverage.covered), u: formatInt(o.sites),
              d: formatInt(o.coverage.byData), v: formatInt(o.coverage.byVisit),
            })
            : tr('Aucun site actif sur la période (couverture des sites non mesurable).')}
        </p>
        <p>
          {richText(tr('L\'indice de conformité global est de {index}.'), { index: <b>{idx == null ? '—' : `${idx}/100`}</b> })}{' '}
          {richText(tr('Sur {scored} indicateur(s) noté(s), {exc} sont au vert (excellent), {sat} satisfaisant(s), {imp} à améliorer et {urg} en action urgente ({urgentPct}).'), {
            scored: formatInt(cls.scored || 0), exc: bold(cls.exc), sat: bold(cls.sat), imp: bold(cls.imp), urg: bold(cls.urg),
            urgentPct: <b>{tr('{p} %', { p: urgentPct })}</b>,
          })}
        </p>
        {weak.length > 0 && (
          <p>
            {richText(tr('Les points d\'attention prioritaires : {list}.'), { list: weak.slice(0, 4).map((w, i) => (
              <span key={`${w.form}-${w.label}-${i}`}>{i > 0 ? ', ' : ''}<b>{w.label}</b> ({w.pct}% · {w.form})</span>
            )) })}
          </p>
        )}
        {topRegions.length > 0 && (
          <p>
            {richText(tr('Les régions les plus actives en remontée de données : {list}.'), { list: topRegions.map((r, i) => (
              <span key={r.region}>{i > 0 ? ', ' : ''}<b>{r.region}</b> ({formatInt(r.submissions)})</span>
            )) })}
          </p>
        )}
        <p className="cd-bull-foot">{tr('Bulletin recalculé en direct à partir des fiches, indicateurs, visites et du RBM — aucun chiffre saisi à la main.')}</p>
      </div>
    </div>
  );
}

