import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, ShieldCheck, Database, TrendingUp, LayoutGrid, LayoutList, ListChecks, Map as MapIcon, FileText, HelpCircle, Info } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, PageHeader, Skeleton } from '../../components/ui.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import TrendChart from '../../components/charts/TrendChart.jsx';
import CodeLabel from '../../components/CodeLabel.jsx';
import { ActivationNote, PeriodBanner, SessionPeriodNote, usePeriod } from '../../components/PeriodBanner.jsx';
import { formatInt, monthLabel } from '../../lib/format.js';
import { periodLabel, single } from '../../lib/period.js';
import { MAP, project } from '../../lib/madagascarMap.js';
import { groupNaReasons } from '../../lib/naReasons.js';
import { shortFormLabel as shortLabel } from '../../lib/formLabel.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Dashboard décisionnel › « Couverture & performance du suivi ».
 * Reproduit (dans le design system de l'app, branding neutre) la synthèse du
 * suivi de processus : couverture, données versées, conformité en 5 bandes,
 * plan vs réalisé, et un détail par activité (= fiche) — dimensions, top/flop
 * d'indicateurs, tendance, bureaux. Tout est recalculé en direct :
 *   • conformité/indicateurs ← /monitoring/coverage-dashboard
 *   • couverture terrain      ← /tpm/field/summary
 *   • sites à suivre (RBM)     ← /tpm/field/rbm/sites
 * Période = plage de mois (lot 1b, retour n° 47) : URL, puis période de travail de la
 * session, puis la règle commune (dernier mois substantiel avec des données, dite par
 * PeriodBanner). Flux sommés, sites distincts, état RBM au dernier mois de la période.
 * Deux taux terrain : Couverture (sites) = sites actifs réalisés ÷ sites actifs ;
 * Exécution du plan (visites) = visites réalisées ÷ prévues — sans plan, « — aucun
 * plan », jamais 0 % ni « Situation critique ».
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
  const { period, ready, auto, counts, periods, latest, today, source, setPeriod, resetToDefault } = usePeriod({ scope: 'analysis', defaultRule: 'data' });
  const pick = (m) => setPeriod(single(m));
  const key = period ? `${period.from}|${period.to}` : '';
  const [cd, setCd] = useState(null);
  const [field, setField] = useState(null);
  const [rbm, setRbm] = useState(null);
  const [map, setMap] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('synthese');
  const [tab, setTab] = useState('_OV');

  useEffect(() => {
    if (!ready || !period) return undefined;
    let alive = true;
    setCd(null); setField(null); setRbm(null); setError(null);
    // RBM : un état, lu au dernier mois de la période (le serveur prend `to`).
    Promise.all([api.monCoverageDashboard(period), api.fieldSummary(period), api.rbmSites(period)])
      .then(([c, f, r]) => {
        if (!alive) return;
        setCd(c); setField(f); setRbm(r);
        try { if (typeof performance !== 'undefined' && performance.mark) performance.mark('period:rendered'); } catch { /* sans incidence */ }
      })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carte : référentiel de sites géolocalisés (indépendant du mois), chargé une fois.
  useEffect(() => { api.fieldMap().then(setMap).catch(() => setMap({ communes: [], points: [] })); }, []);

  const rbmStats = useMemo(() => {
    const s = { total: 0, due: 0, elevee: 0, moyenne: 0, faible: 0 };
    for (const x of rbm || []) { s.total += 1; s[x.riskLevel] = (s[x.riskLevel] || 0) + 1; if (x.due) s.due += 1; }
    return s;
  }, [rbm]);

  const cov = field?.overall;
  const loading = !cd || !field || !rbm;
  const forms = cd?.forms || [];
  const activeForm = tab === '_OV' ? null : forms.find((f) => f.id === tab);

  return (
    <div className="page">
      <PageHeader title={tr('Couverture & performance du suivi')}
        description={tr('Vue analytique du suivi de processus : couverture terrain, données versées, conformité par bande, plan vs réalisé, et détail par activité (dimensions, indicateurs). Recalculé en direct.')}>
        {ready && <PeriodSelect value={period} onChange={setPeriod} counts={counts} latest={latest} today={today} align="right" />}
      </PageHeader>
      <PeriodBanner auto={auto} onBack={pick} />
      <SessionPeriodNote source={source} onReset={resetToDefault} />

      <div className="cd-views" role="tablist" aria-label={tr('Vues')}>
        {VIEWS.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={view === v.id}
            className={`cd-view${view === v.id ? ' is-active' : ''}`} onClick={() => setView(v.id)}>
            <v.icon size={15} aria-hidden="true" />{tr(v.label)}
          </button>
        ))}
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
                ? <Overview cd={cd} cov={cov} field={field} rbmStats={rbmStats} period={period} onNavigate={onNavigate} />
                : activeForm && <ActivityView form={activeForm} period={period} periods={periods} onPick={pick} onNavigate={onNavigate} />}
            </>
          )}
          {view === 'controle' && <ControlRoom cd={cd} />}
          {view === 'carte' && <MapView map={map} regions={cd.regions || []} rbmStats={rbmStats} />}
          {view === 'bulletin' && <Bulletin cd={cd} cov={cov} field={field} rbmStats={rbmStats} period={period} />}
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
function Overview({ cd, cov, field, rbmStats, period, onNavigate }) {
  const { tr } = useI18n();
  // Couverture (sites) et exécution du plan (visites) : null = « — » / « — aucun plan », jamais 0 %.
  const covPct = cov?.coverage == null ? null : Math.round(cov.coverage * 100);
  const execPct = cov?.execution == null ? null : Math.round(cov.execution * 100);
  const sites = cov?.sites || {};
  const visits = cov?.visits || {};
  const toLabel = period ? monthLabel(period.to) : '';
  const upToDate = rbmStats.total - rbmStats.due;
  const sitesPct = rbmStats.total ? Math.round((upToDate / rbmStats.total) * 100) : 0;
  const cls = cd.classes || {};
  const urgentPct = cls.scored ? Math.round((cls.urg / cls.scored) * 100) : 0;

  // Plan vs réalisé — trois sources (visites, sites prévus, soumissions), sur la période.
  const received = cd.totals?.communes || 0;
  const pvr = [
    { label: tr('Visites de terrain'), sub: tr('prévues → réalisées sur la période (site × mois)'),
      planned: visits.planned || 0, done: visits.realised || 0, unit: tr('visite(s)') },
    { label: tr('Sites prévus'), sub: tr('sites distincts prévus → réalisés pendant un mois actif'),
      planned: sites.planned || 0, done: sites.realised || 0, unit: tr('site(s)') },
    { label: tr('Données versées'), sub: tr('communes attendues (RBM, état au {m}) → ayant versé sur la période', { m: toLabel }),
      planned: rbmStats.due, done: received, unit: tr('commune(s)') },
  ];

  const byActivity = (cd.forms || []).map((f) => ({
    key: f.id, label: shortLabel(f.label),
    pct: f.index == null ? 0 : Math.round(f.index),
    urgent: (f.classes && f.classes.urg) || 0,
    noIndicator: !f.indicatorCount,
    noData: f.index == null,
  }));
  const regions = (cd.regions || []).slice(0, 8);
  const watch = (field?.byDistrict || []).filter((d) => d.active > 0 && d.rate < 0.8).sort((a, b) => a.rate - b.rate).slice(0, 8);

  return (
    <>
      <div className="biz-kpis cd-kpis-5">
        <DonutKpi icon={Gauge} label={tr('Couverture (sites)')} pct={covPct}
          foot={tr('{r} / {a} sites actifs · distincts sur la période', { r: formatInt(sites.realised || 0), a: formatInt(sites.active || 0) })} />
        <DonutKpi icon={ListChecks} label={tr('Exécution du plan (visites)')} pct={execPct} noneLabel={tr('— aucun plan')}
          foot={<>
            {tr('{done} / {planned} visites prévues', { done: formatInt(visits.realised || 0), planned: formatInt(visits.planned || 0) })}
            {visits.upcoming > 0 && <> · {tr('dont {n} visite(s) à venir', { n: formatInt(visits.upcoming) })}</>}
          </>} />
        <DonutKpi icon={ShieldCheck} label={tr('Sites à jour')} pct={sitesPct} tone={rbmStats.due ? 'amber' : 'green'}
          foot={<>{tr('{due} à suivre / {total}', { due: formatInt(rbmStats.due), total: formatInt(rbmStats.total) })} · {tr('état au {m}', { m: toLabel })}</>} />
        <Kpi icon={Database} label={tr('Données versées')} value={formatInt(cd.totals?.submissions || 0)}
          foot={tr('{communes} commune(s) · {agents} agent(s)', { communes: formatInt(cd.totals?.communes || 0), agents: formatInt(cd.totals?.agents || 0) })} />
        <Kpi icon={LayoutGrid} label={tr('Fiches · indicateurs')} value={formatInt(cd.totals?.forms || 0)}
          foot={tr('{n} indicateur(s)', { n: formatInt(cd.totals?.indicators || 0) })} />
      </div>
      <ActivationNote field={field} />

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
        <BarsCard title={tr('Performance par activité')} sub={tr('Indice de conformité par fiche')}
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
        <div className="card biz-card">
          <div className="card-header"><div className="card-title">{tr('Données versées — tendance mensuelle')}</div></div>
          <div className="card-body">
            <TrendChart data={form.trend} selected={period} height={160} unit={tr('formulaire(s)')}
              label={tr('Formulaires reçus par mois, {n} mois finissant en {m} ; période surlignée : {p}', { n: (form.trend || []).length, m: period ? monthLabel(period.to) : '', p: pLabel })}
              empty={tr('Aucune donnée versée.')} />
          </div>
        </div>
        <BureauCard rows={form.byBureau || []} onNavigate={onNavigate} />
      </div>
    </>
  );
}

/** Données par bureau d'une fiche : chaque bureau par son nom ; un code non relié propose de le relier. */
function BureauCard({ rows, onNavigate }) {
  const { tr } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.submissions || 0));
  return (
    <div className="card biz-card">
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

/** KPI avec anneau de progression (donut SVG, dépendance zéro) ; sans base, « — » (ou `noneLabel`). */
function DonutKpi({ icon: Icon, label, pct, foot, tone, noneLabel }) {
  const none = pct == null; // pas de dénominateur (aucun plan) : anneau vide et « — », pas de couleur d'alerte
  const v = none ? 0 : Math.max(0, Math.min(100, Math.round(pct)));
  const R = 22; const C = 2 * Math.PI * R;
  const color = tone === 'green' || v >= 80 ? 'var(--green)' : (tone === 'amber' || v >= 50 ? 'var(--orange)' : 'var(--red)');
  return (
    <div className="biz-kpi cd-donutkpi">
      <svg className="cd-ring" viewBox="0 0 56 56" role="img" aria-label={none ? `${label} —` : `${label} ${v}%`}>
        <circle cx="28" cy="28" r={R} fill="none" stroke="var(--canvas-sunken)" strokeWidth="6" />
        {!none && <circle cx="28" cy="28" r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(v / 100) * C} ${C}`} transform="rotate(-90 28 28)" />}
        <text x="28" y="31" textAnchor="middle" className="cd-ring-t tabular">{none ? '—' : `${v}%`}</text>
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

/** Carte « Plan vs Réalisé » — une ligne par source, barre d'avancement. */
function PlanVsReal({ rows }) {
  const { tr } = useI18n();
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{tr('Plan vs Réalisé')}</div>
        <div className="card-sub">{tr('Avancement de la période par rapport au plan')}</div></div>
      <div className="card-body cd-pvr">
        {rows.map((r) => {
          const pct = r.planned > 0 ? Math.round((Math.max(0, r.done) / r.planned) * 100) : null;
          const tone = pct == null ? 'var(--text-faint)' : pct >= 80 ? 'var(--green)' : (pct >= 50 ? 'var(--orange)' : 'var(--red)');
          return (
            <div className="cd-pvr-row" key={r.label}>
              <div className="cd-pvr-head">
                <span className="cd-pvr-name">{r.label}</span>
                {pct == null
                  ? <span className="cd-pvr-v muted">{tr('— aucun plan')}{r.done ? ` · ${formatInt(r.done)} ${r.unit}` : ''}</span>
                  : <span className="tabular cd-pvr-v">{formatInt(r.done)} / {formatInt(r.planned)} {r.unit} · <b style={{ color: tone }}>{pct}%</b></span>}
              </div>
              <div className="cd-pvr-sub">{r.sub}</div>
              <div className="biz-bar"><span style={{ width: `${Math.min(100, pct || 0)}%`, background: tone }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Carte à barres horizontales génériques (pct 0–100 ou count relatif). */
function BarsCard({ title, sub, rows, empty, mode = 'pct' }) {
  const max = mode === 'count' ? Math.max(1, ...rows.map((r) => r.count || 0)) : 100;
  return (
    <div className="card biz-card">
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
    <div className="card biz-card">
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
        <div className="card-sub">{tr('Soumissions collectées · communes couvertes')}</div></div>
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
  const { tr } = useI18n();
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{tr('Zones à surveiller')}</div>
        <div className="card-sub">{tr('Districts dont l\'exécution du plan (visites) est < 80 %')}</div></div>
      <div className="card-body biz-gauges">
        {(!rows || rows.length === 0) ? <p className="muted">{tr('Toutes les zones couvertes sont ≥ 80 %.')}</p> : rows.map((d) => {
          const pct = Math.round((d.rate || 0) * 100);
          return (
            <button type="button" className="biz-gauge" key={d.key} onClick={() => onNavigate && onNavigate('processus', 'sites')} title={tr('Ouvrir Affectation & visites')}>
              <div className="biz-gauge-head"><span>{d.label}</span><span className="tabular">{d.realise}/{d.active} · {pct} %</span></div>
              <div className="biz-bar"><span style={{ width: `${Math.min(100, pct)}%`, background: pct < 50 ? 'var(--red)' : 'var(--orange)' }} /></div>
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

// ------------------------------------------------------------------------- Carte
const RISK_COLOR = { elevee: 'var(--red)', moyenne: 'var(--orange)', faible: 'var(--green)' };
/** Carte SVG de Madagascar (silhouette fournie par le métier, sans dépendance)
 * avec les sites géolocalisés réels en points, colorés par niveau de risque.
 * À côté : données versées par région. */
function MapView({ map, regions, rbmStats }) {
  const { tr } = useI18n();
  const points = (map?.points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  return (
    <div className="biz-grid cd-grid-2 cd-grid-flush">
      <div className="card biz-card">
        <div className="card-header"><div className="card-title">{tr('Sites de suivi — Sud Madagascar')}</div>
          <div className="card-sub">{tr('{n} site(s) géolocalisé(s) · couleur = niveau de risque', { n: formatInt(points.length) })}</div></div>
        <div className="card-body">
          <svg className="cd-map" viewBox={`0 0 ${MAP.W} ${MAP.H}`} role="img" aria-label={tr('Carte des sites de suivi')}>
            <path d={MAP.outline} fill="var(--canvas-sunken)" stroke="var(--border-strong)" strokeWidth="1.5" />
            {points.map((p) => {
              const [x, y] = project(p.lat, p.lng);
              return <circle key={p.id} cx={x.toFixed(1)} cy={y.toFixed(1)} r="4" fill={RISK_COLOR[p.riskLevel] || 'var(--blue-600)'} fillOpacity="0.85" stroke="#fff" strokeWidth="0.8" />;
            })}
          </svg>
          <div className="cd-legend" style={{ marginTop: 10 }}>
            <span><i className="cd-dot" style={{ background: 'var(--red)' }} />{tr('Risque élevé')} <b className="tabular">{formatInt(rbmStats.elevee)}</b></span>
            <span><i className="cd-dot" style={{ background: 'var(--orange)' }} />{tr('Risque moyen')} <b className="tabular">{formatInt(rbmStats.moyenne)}</b></span>
            <span><i className="cd-dot" style={{ background: 'var(--green)' }} />{tr('Risque faible')} <b className="tabular">{formatInt(rbmStats.faible)}</b></span>
          </div>
          {points.length < rbmStats.total && (
            <div className="biz-kpi-foot" style={{ marginTop: 8 }}>
              {tr('{n} site(s) sur {total} ont des coordonnées GPS ; la carte se densifie à mesure que le référentiel est géocodé (import Master Data).', { n: formatInt(points.length), total: formatInt(rbmStats.total) })}
            </div>
          )}
        </div>
      </div>
      <RegionsCard regions={regions.slice(0, 10)} />
    </div>
  );
}

// ---------------------------------------------------------------------- Bulletin
/** Phrase traduite dont les {variables} sont remplacées par des nœuds React
 * (chiffres en gras du bulletin) : chaque phrase reste entière pour la traduction. */
function richText(template, vars) {
  return template.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <React.Fragment key={i}>{vars[part]}</React.Fragment> : part));
}

/**
 * Bulletin narratif : synthèse en clair générée à partir des chiffres de la période.
 * Le verdict lit l'exécution du plan (visites), comme avant ; la couverture des sites
 * est dite à côté. Sans visite planifiée, l'exécution est inconnue (« aucun plan ») :
 * elle n'entre pas dans le verdict.
 */
function Bulletin({ cd, cov, field, rbmStats, period }) {
  const { tr, lang } = useI18n();
  const cls = cd.classes || {};
  const idx = cd.conformityIndex;
  const covPct = cov?.execution == null ? null : Math.round(cov.execution * 100);
  const sitesCov = cov?.coverage == null ? null : Math.round(cov.coverage * 100);
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
          {richText(tr('Sur la période, {submissions} soumission(s) ont été versées par {agents} agent(s) sur {communes} commune(s), réparties sur {forms} fiche(s) de suivi ({indicators} indicateurs).'), {
            submissions: bold(cd.totals?.submissions), agents: bold(cd.totals?.agents), communes: bold(cd.totals?.communes),
            forms: bold(cd.totals?.forms), indicators: bold(cd.totals?.indicators),
          })}{' '}
          {covPct == null
            ? richText(tr('Aucune visite de terrain n\'est planifiée sur la période (exécution du plan non mesurable), et le RBM signale {due} site(s) à suivre au {m} sur {total}.'), {
              due: bold(rbmStats.due), total: formatInt(rbmStats.total), m: toLabel,
            })
            : richText(tr('L\'exécution du plan atteint {execution} ({visits} visite(s) réalisée(s)), et le RBM signale {due} site(s) à suivre au {m} sur {total}.'), {
              execution: <b>{tr('{p} %', { p: covPct })}</b>, visits: formatInt(cov?.visits?.realised || 0), due: bold(rbmStats.due), total: formatInt(rbmStats.total), m: toLabel,
            })}{' '}
          {sitesCov != null && richText(tr('La couverture des sites atteint {coverage} ({r} site(s) réalisé(s) sur {a} actif(s)).'), {
            coverage: <b>{tr('{p} %', { p: sitesCov })}</b>, r: formatInt(cov?.sites?.realised || 0), a: formatInt(cov?.sites?.active || 0),
          })}
          {field && field.activationKnown === false && <>{' '}{tr('sites actifs : tout le registre (aucune grille d\'activation)')}.</>}
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

