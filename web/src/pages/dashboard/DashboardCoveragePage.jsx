import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, ShieldCheck, Database, TrendingUp, LayoutGrid, LayoutList, Map as MapIcon, FileText } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, PageHeader, Skeleton } from '../../components/ui.jsx';
import MonthSelect from '../../components/MonthSelect.jsx';
import { currentMonth, formatInt } from '../../lib/format.js';
import { MAP, project } from '../../lib/madagascarMap.js';

/**
 * Dashboard décisionnel › « Couverture & performance du suivi ».
 * Reproduit (dans le design system de l'app, branding neutre) la synthèse du
 * suivi de processus : couverture, données versées, conformité en 5 bandes,
 * plan vs réalisé, et un détail par activité (= fiche) — dimensions, top/flop
 * d'indicateurs, tendance, bureaux. Tout est recalculé en direct :
 *   • conformité/indicateurs ← /monitoring/coverage-dashboard
 *   • couverture terrain      ← /tpm/field/summary
 *   • sites à suivre (RBM)     ← /tpm/field/rbm/sites
 */

const BANDS = [
  { k: 'exc', label: 'Excellent' },
  { k: 'sat', label: 'Satisfaisant' },
  { k: 'imp', label: 'À améliorer' },
  { k: 'urg', label: 'Action urgente' },
  { k: 'na', label: 'Non évalué' },
];

const VIEWS = [
  { id: 'synthese', label: 'Synthèse', icon: Gauge },
  { id: 'controle', label: 'Salle de contrôle', icon: LayoutList },
  { id: 'carte', label: 'Carte', icon: MapIcon },
  { id: 'bulletin', label: 'Bulletin', icon: FileText },
];

export default function DashboardCoveragePage({ onNavigate }) {
  const [month, setMonth] = useState(currentMonth);
  const [cd, setCd] = useState(null);
  const [field, setField] = useState(null);
  const [rbm, setRbm] = useState(null);
  const [map, setMap] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('synthese');
  const [tab, setTab] = useState('_OV');

  useEffect(() => {
    setCd(null); setField(null); setRbm(null); setError(null);
    Promise.all([api.monCoverageDashboard(month), api.fieldSummary(month), api.rbmSites(month)])
      .then(([c, f, r]) => { setCd(c); setField(f); setRbm(r); })
      .catch((e) => setError(e.message));
  }, [month]);

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
      <PageHeader title="Couverture & performance du suivi"
        description="Vue analytique du suivi de processus : couverture terrain, données versées, conformité par bande, plan vs réalisé, et détail par activité (dimensions, indicateurs). Recalculé en direct.">
        <MonthSelect value={month} onChange={setMonth} />
      </PageHeader>

      <div className="cd-views" role="tablist" aria-label="Vues">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={view === v.id}
            className={`cd-view${view === v.id ? ' is-active' : ''}`} onClick={() => setView(v.id)}>
            <v.icon size={15} aria-hidden="true" />{v.label}
          </button>
        ))}
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {loading && !error ? <Skeleton height={360} /> : !error && (
        <>
          {view === 'synthese' && (
            <>
              <div className="cd-tabs" role="tablist" aria-label="Activités">
                <TabBtn id="_OV" label="Vue d'ensemble" active={tab === '_OV'} onClick={setTab} />
                {forms.map((f) => (
                  <TabBtn key={f.id} id={f.id} label={shortLabel(f.label)} active={tab === f.id} onClick={setTab} />
                ))}
              </div>
              {tab === '_OV'
                ? <Overview cd={cd} cov={cov} field={field} rbmStats={rbmStats} onNavigate={onNavigate} />
                : activeForm && <ActivityView form={activeForm} />}
            </>
          )}
          {view === 'controle' && <ControlRoom cd={cd} />}
          {view === 'carte' && <MapView map={map} regions={cd.regions || []} rbmStats={rbmStats} />}
          {view === 'bulletin' && <Bulletin cd={cd} cov={cov} rbmStats={rbmStats} />}
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
function Overview({ cd, cov, field, rbmStats, onNavigate }) {
  const covPct = Math.round((cov?.rate || 0) * 100);
  const upToDate = rbmStats.total - rbmStats.due;
  const sitesPct = rbmStats.total ? Math.round((upToDate / rbmStats.total) * 100) : 0;
  const cls = cd.classes || {};
  const urgentPct = cls.scored ? Math.round((cls.urg / cls.scored) * 100) : 0;

  // Plan vs réalisé — trois sources (visites, sites RBM, soumissions).
  const received = cd.totals?.communes || 0;
  const pvr = [
    { label: 'Visites de terrain', sub: 'planifiées → réalisées ce mois',
      planned: (cov?.realise || 0) + (cov?.planifie || 0), done: cov?.realise || 0, unit: 'visite(s)' },
    { label: 'Sites à suivre (RBM)', sub: 'dus ce mois → visités (terrain)',
      planned: rbmStats.due, done: cov?.realise || 0, unit: 'site(s)' },
    { label: 'Données versées', sub: 'communes attendues (RBM) → ayant versé',
      planned: rbmStats.due, done: received, unit: 'commune(s)' },
  ];

  const byActivity = (cd.forms || []).map((f) => ({
    key: f.id, label: shortLabel(f.label),
    pct: f.index == null ? 0 : Math.round(f.index),
    urgent: (f.classes && f.classes.urg) || 0,
  }));
  const regions = (cd.regions || []).slice(0, 8);
  const watch = (field?.byDistrict || []).filter((d) => d.active > 0 && d.rate < 0.8).sort((a, b) => a.rate - b.rate).slice(0, 8);

  return (
    <>
      <div className="biz-kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <DonutKpi icon={Gauge} label="Couverture" pct={covPct} foot={`${formatInt(cov?.realise || 0)} / ${formatInt((cov?.realise || 0) + (cov?.planifie || 0))} visites`} />
        <DonutKpi icon={ShieldCheck} label="Sites à jour" pct={sitesPct} tone={rbmStats.due ? 'amber' : 'green'}
          foot={`${formatInt(rbmStats.due)} à suivre / ${formatInt(rbmStats.total)}`} />
        <Kpi icon={Database} label="Données versées" value={formatInt(cd.totals?.submissions || 0)}
          foot={`${formatInt(cd.totals?.communes || 0)} commune(s) · ${formatInt(cd.totals?.agents || 0)} agent(s)`} />
        <Kpi icon={LayoutGrid} label="Fiches · indicateurs" value={formatInt(cd.totals?.forms || 0)}
          foot={`${formatInt(cd.totals?.indicators || 0)} indicateur(s)`} />
      </div>

      {/* Bande conformité : indice + répartition 5 bandes + action urgente */}
      <div className="card biz-card cd-conf">
        <div className="cd-conf-idx">
          <div className="cd-conf-n tabular">{cd.conformityIndex == null ? '—' : cd.conformityIndex}<small>/100</small></div>
          <div className="cd-conf-l">Indice de conformité</div>
          <div className="biz-kpi-foot">{formatInt(cls.scored || 0)} indicateur(s) noté(s)</div>
        </div>
        <div className="cd-conf-dist">
          <div className="card-title">Répartition des indicateurs</div>
          <ClassBar classes={cls} />
          <ClassLegend classes={cls} />
        </div>
        <div className="cd-conf-urg">
          <div className="cd-conf-n tabular" style={{ color: 'var(--cd-urg)' }}>{urgentPct}<small>%</small></div>
          <div className="cd-conf-l">Action urgente</div>
          <div className="biz-kpi-foot">{formatInt(cls.urg || 0)} sur {formatInt(cls.scored || 0)}</div>
        </div>
      </div>

      <div className="biz-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
        <PlanVsReal rows={pvr} />
        <BarsCard title="Performance par activité" sub="Indice de conformité par fiche"
          rows={byActivity.map((a) => ({ key: a.key, label: a.label, pct: a.pct, right: `${a.pct} · ${a.urgent ? `${a.urgent} urgent` : 'ok'}` }))}
          empty="Aucune fiche active." />
      </div>

      <div className="biz-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
        <RegionsCard regions={regions} />
        <WatchCard rows={watch} onNavigate={onNavigate} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Activité (fiche)
function ActivityView({ form }) {
  const cls = form.classes || {};
  return (
    <>
      <div className="biz-kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <Kpi icon={Database} label="Données versées" value={formatInt(form.submissions || 0)} foot="soumissions de la fiche" />
        <Kpi icon={TrendingUp} label="Indice de conformité" value={form.index == null ? '—' : `${form.index}`} foot="sur 100 (indicateurs %)" />
        <Kpi icon={ShieldCheck} label="Indicateurs notés" value={formatInt(cls.scored || 0)}
          foot={`${formatInt(cls.urg || 0)} en action urgente`} />
      </div>

      <div className="card biz-card" style={{ marginTop: 16 }}>
        <div className="card-header"><div className="card-title">Répartition des indicateurs</div></div>
        <div className="card-body">
          <ClassBar classes={cls} />
          <ClassLegend classes={cls} />
        </div>
      </div>

      <div className="biz-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
        <DimsCard dims={form.dims || []} />
        <div className="biz-grid" style={{ gridTemplateColumns: '1fr', gap: 16 }}>
          <IndListCard title="Indicateurs les plus faibles" rows={form.flop || []} tone="low" />
          <IndListCard title="Points forts" rows={form.top || []} tone="ok" />
        </div>
      </div>

      <div className="biz-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
        <TrendCard title="Données versées — tendance mensuelle" trend={form.trend} />
        <BarsCard title="Données par bureau" sub="soumissions sur le mois"
          rows={(form.byBureau || []).map((b) => ({ key: b.bureau, label: b.bureau, count: b.submissions, right: `${formatInt(b.submissions)}` }))}
          mode="count" empty="Aucune donnée." />
      </div>
    </>
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

/** KPI avec anneau de progression (donut SVG, dépendance zéro). */
function DonutKpi({ icon: Icon, label, pct, foot, tone }) {
  const v = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const R = 22; const C = 2 * Math.PI * R;
  const color = tone === 'green' || v >= 80 ? 'var(--green)' : (tone === 'amber' || v >= 50 ? 'var(--orange)' : 'var(--red)');
  return (
    <div className="biz-kpi cd-donutkpi">
      <svg className="cd-ring" viewBox="0 0 56 56" role="img" aria-label={`${label} ${v}%`}>
        <circle cx="28" cy="28" r={R} fill="none" stroke="var(--canvas-sunken)" strokeWidth="6" />
        <circle cx="28" cy="28" r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(v / 100) * C} ${C}`} transform="rotate(-90 28 28)" />
        <text x="28" y="31" textAnchor="middle" className="cd-ring-t tabular">{v}%</text>
      </svg>
      <div className="biz-kpi-body">
        <div className="biz-kpi-label"><Icon size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 5 }} />{label}</div>
        {foot && <div className="biz-kpi-foot" style={{ marginTop: 4 }}>{foot}</div>}
      </div>
    </div>
  );
}

/** Barre empilée des 5 bandes de conformité. */
function ClassBar({ classes }) {
  const total = BANDS.reduce((a, b) => a + (classes[b.k] || 0), 0) || 1;
  return (
    <div className="cd-stack" role="img" aria-label="Répartition des indicateurs par bande">
      {BANDS.map((b) => {
        const n = classes[b.k] || 0;
        if (!n) return null;
        return <span key={b.k} className={`cd-seg cd-${b.k}`} style={{ width: `${(n / total) * 100}%` }} title={`${b.label}: ${n}`} />;
      })}
    </div>
  );
}

function ClassLegend({ classes }) {
  return (
    <div className="cd-legend">
      {BANDS.map((b) => (
        <span key={b.k}><i className={`cd-dot cd-${b.k}`} />{b.label} <b className="tabular">{formatInt(classes[b.k] || 0)}</b></span>
      ))}
    </div>
  );
}

/** Carte « Plan vs Réalisé » — une ligne par source, barre d'avancement. */
function PlanVsReal({ rows }) {
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">Plan vs Réalisé</div>
        <div className="card-sub">Avancement du mois par rapport au plan</div></div>
      <div className="card-body cd-pvr">
        {rows.map((r) => {
          const pct = r.planned > 0 ? Math.round((Math.max(0, r.done) / r.planned) * 100) : 0;
          const tone = pct >= 80 ? 'var(--green)' : (pct >= 50 ? 'var(--orange)' : 'var(--red)');
          return (
            <div className="cd-pvr-row" key={r.label}>
              <div className="cd-pvr-head">
                <span className="cd-pvr-name">{r.label}</span>
                <span className="tabular cd-pvr-v">{formatInt(r.done)} / {formatInt(r.planned)} {r.unit} · <b style={{ color: tone }}>{pct}%</b></span>
              </div>
              <div className="cd-pvr-sub">{r.sub}</div>
              <div className="biz-bar"><span style={{ width: `${Math.min(100, pct)}%`, background: tone }} /></div>
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
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">Dimensions du suivi</div>
        <div className="card-sub">Score moyen par dimension (les plus faibles d'abord)</div></div>
      <div className="card-body biz-gauges">
        {(!dims || dims.length === 0) ? <p className="muted">Aucun indicateur en pourcentage.</p> : dims.map((d) => {
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
  const max = Math.max(1, ...regions.map((r) => r.submissions || 0));
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">Données versées par région</div>
        <div className="card-sub">Soumissions collectées · communes couvertes</div></div>
      <div className="card-body biz-gauges">
        {regions.length === 0 ? <p className="muted">Aucune donnée.</p> : regions.map((r) => (
          <div className="biz-gauge" key={r.region}>
            <div className="biz-gauge-head"><span>{r.region}</span><span className="tabular">{formatInt(r.submissions)} · {formatInt(r.communes)} com.</span></div>
            <div className="biz-bar"><span style={{ width: `${(r.submissions / max) * 100}%`, background: 'var(--blue-600)' }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WatchCard({ rows, onNavigate }) {
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">Zones à surveiller</div>
        <div className="card-sub">Districts dont la couverture terrain est &lt; 80 %</div></div>
      <div className="card-body biz-gauges">
        {(!rows || rows.length === 0) ? <p className="muted">Toutes les zones couvertes sont ≥ 80 %.</p> : rows.map((d) => {
          const pct = Math.round((d.rate || 0) * 100);
          return (
            <button type="button" className="biz-gauge" key={d.key} onClick={() => onNavigate && onNavigate('processus', 'sites')} title="Ouvrir Affectation & visites">
              <div className="biz-gauge-head"><span>{d.label}</span><span className="tabular">{d.realise}/{d.active} · {pct} %</span></div>
              <div className="biz-bar"><span style={{ width: `${Math.min(100, pct)}%`, background: pct < 50 ? 'var(--red)' : 'var(--orange)' }} /></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TrendCard({ title, trend }) {
  const data = trend || [];
  const w = 320; const h = 150; const pad = { l: 8, r: 8, t: 12, b: 22 };
  const max = Math.max(1, ...data.map((d) => d.submissions));
  const n = data.length;
  const x = (i) => pad.l + (n <= 1 ? 0 : (i * (w - pad.l - pad.r)) / (n - 1));
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / max);
  const pts = data.map((d, i) => `${x(i)},${y(d.submissions)}`).join(' ');
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{title}</div></div>
      <div className="card-body">
        {n === 0 ? <p className="muted">Aucune donnée versée.</p> : (
          <svg className="biz-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title}>
            <polyline fill="none" stroke="var(--blue-600)" strokeWidth="2" points={pts} />
            {data.map((d, i) => <circle key={d.month} cx={x(i)} cy={y(d.submissions)} r="3" fill="var(--blue-600)" />)}
            {data.map((d, i) => (i % Math.ceil(n / 6 || 1) === 0 || i === n - 1)
              ? <text key={`t${d.month}`} className="biz-axis biz-muted" x={x(i)} y={h - 6} textAnchor="middle">{d.month.slice(2)}</text> : null)}
          </svg>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- Salle de contrôle
/** Mur d'indicateurs : toutes les fiches, chaque indicateur en cellule colorée
 * par bande de conformité. Lecture d'un coup d'œil de ce qui va / ne va pas. */
function ControlRoom({ cd }) {
  const forms = (cd.forms || []).filter((f) => (f.indicators || []).length);
  if (!forms.length) return <p className="muted">Aucun indicateur à afficher pour ce mois.</p>;
  return (
    <>
      <div className="cd-legend" style={{ marginBottom: 14 }}>
        {BANDS.map((b) => <span key={b.k}><i className={`cd-dot cd-${b.k}`} />{b.label}</span>)}
      </div>
      {forms.map((f) => {
        const c = f.classes || {};
        return (
          <div className="card biz-card cd-crmod" key={f.id}>
            <div className="card-header">
              <div className="card-title">{shortLabel(f.label)}</div>
              <div className="card-sub">{formatInt(f.submissions)} soumission(s) · indice {f.index == null ? '—' : f.index}/100
                {c.urg ? ` · ${c.urg} action(s) urgente(s)` : ''}</div>
            </div>
            <div className="card-body">
              <div className="cd-wall">
                {(f.indicators || []).map((ind, i) => (
                  <div className={`cd-cell cd-b-${ind.cls}`} key={`${ind.code || ind.label}-${i}`} title={`${ind.label} — ${fmtVal(ind)}`}>
                    <span className="cd-cell-l">{ind.label}</span>
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
  const points = (map?.points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  return (
    <div className="biz-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="card biz-card">
        <div className="card-header"><div className="card-title">Sites de suivi — Sud Madagascar</div>
          <div className="card-sub">{formatInt(points.length)} site(s) géolocalisé(s) · couleur = niveau de risque</div></div>
        <div className="card-body">
          <svg className="cd-map" viewBox={`0 0 ${MAP.W} ${MAP.H}`} role="img" aria-label="Carte des sites de suivi">
            <path d={MAP.outline} fill="var(--canvas-sunken)" stroke="var(--border-strong)" strokeWidth="1.5" />
            {points.map((p) => {
              const [x, y] = project(p.lat, p.lng);
              return <circle key={p.id} cx={x.toFixed(1)} cy={y.toFixed(1)} r="4" fill={RISK_COLOR[p.riskLevel] || 'var(--blue-600)'} fillOpacity="0.85" stroke="#fff" strokeWidth="0.8" />;
            })}
          </svg>
          <div className="cd-legend" style={{ marginTop: 10 }}>
            <span><i className="cd-dot" style={{ background: 'var(--red)' }} />Risque élevé <b className="tabular">{formatInt(rbmStats.elevee)}</b></span>
            <span><i className="cd-dot" style={{ background: 'var(--orange)' }} />Risque moyen <b className="tabular">{formatInt(rbmStats.moyenne)}</b></span>
            <span><i className="cd-dot" style={{ background: 'var(--green)' }} />Risque faible <b className="tabular">{formatInt(rbmStats.faible)}</b></span>
          </div>
          {points.length < rbmStats.total && (
            <div className="biz-kpi-foot" style={{ marginTop: 8 }}>
              {formatInt(points.length)} site(s) sur {formatInt(rbmStats.total)} ont des coordonnées GPS ; la carte se densifie à mesure que le référentiel est géocodé (import Master Data).
            </div>
          )}
        </div>
      </div>
      <RegionsCard regions={regions.slice(0, 10)} />
    </div>
  );
}

// ---------------------------------------------------------------------- Bulletin
/** Bulletin narratif : synthèse en clair générée à partir des chiffres. */
function Bulletin({ cd, cov, rbmStats }) {
  const cls = cd.classes || {};
  const idx = cd.conformityIndex;
  const covPct = Math.round((cov?.rate || 0) * 100);
  const urgentPct = cls.scored ? Math.round((cls.urg / cls.scored) * 100) : 0;
  const topRegions = (cd.regions || []).filter((r) => r.region !== '(non renseigné)').slice(0, 3);
  // Indicateurs les plus faibles, toutes fiches confondues.
  const weak = [];
  for (const f of cd.forms || []) for (const ind of f.flop || []) weak.push({ ...ind, form: shortLabel(f.label) });
  weak.sort((a, b) => a.pct - b.pct);
  const verdict = (idx == null) ? 'indéterminée'
    : (idx < 50 || covPct < 40) ? 'critique'
      : (idx < 65 || covPct < 65) ? 'à surveiller' : 'satisfaisante';

  return (
    <div className="card biz-card cd-bull">
      <div className="card-body">
        <div className="cd-bk">Bulletin de suivi · {cd.month || 'toutes périodes'}</div>
        <h3>Situation {verdict}</h3>
        <p>
          Sur la période, <b>{formatInt(cd.totals?.submissions || 0)}</b> soumission(s) ont été versées
          par <b>{formatInt(cd.totals?.agents || 0)}</b> agent(s) sur <b>{formatInt(cd.totals?.communes || 0)}</b> commune(s),
          réparties sur <b>{formatInt(cd.totals?.forms || 0)}</b> fiche(s) de suivi
          (<b>{formatInt(cd.totals?.indicators || 0)}</b> indicateurs). La couverture terrain atteint
          <b> {covPct} %</b> ({formatInt(cov?.realise || 0)} visite(s) réalisée(s)), et le RBM signale
          <b> {formatInt(rbmStats.due)}</b> site(s) à suivre ce mois sur {formatInt(rbmStats.total)}.
        </p>
        <p>
          L'indice de conformité global est de <b>{idx == null ? '—' : `${idx}/100`}</b>.
          Sur {formatInt(cls.scored || 0)} indicateur(s) noté(s), <b>{formatInt(cls.exc || 0)}</b> sont au vert (excellent),
          <b> {formatInt(cls.sat || 0)}</b> satisfaisant(s), <b>{formatInt(cls.imp || 0)}</b> à améliorer et
          <b> {formatInt(cls.urg || 0)}</b> en action urgente (<b>{urgentPct} %</b>).
        </p>
        {weak.length > 0 && (
          <p>
            Les points d'attention prioritaires : {weak.slice(0, 4).map((w, i) => (
              <span key={`${w.form}-${w.label}-${i}`}>{i > 0 ? ', ' : ''}<b>{w.label}</b> ({w.pct}% · {w.form})</span>
            ))}.
          </p>
        )}
        {topRegions.length > 0 && (
          <p>
            Les régions les plus actives en remontée de données :
            {topRegions.map((r, i) => <span key={r.region}>{i > 0 ? ', ' : ' '}<b>{r.region}</b> ({formatInt(r.submissions)})</span>)}.
          </p>
        )}
        <p className="cd-bull-foot">Bulletin recalculé en direct à partir des fiches, indicateurs, visites et du RBM — aucun chiffre saisi à la main.</p>
      </div>
    </div>
  );
}

function shortLabel(s) {
  if (!s) return '';
  // « Suivi de processus — Résilience SAMS (données réelles) » → « Résilience SAMS »
  let t = String(s).replace(/^Suivi de processus\s*[—-]\s*/i, '');
  t = t.replace(/\s*\((données réelles|démo|demo)\)\s*$/i, '');
  return t.trim() || String(s);
}
