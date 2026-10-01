import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, ShieldCheck, Database, CalendarClock, MapPin, Activity, AlertTriangle } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, PageHeader, Skeleton } from '../../components/ui.jsx';
import MonthPicker from '../../components/MonthPicker.jsx';
import { currentMonth, formatInt } from '../../lib/format.js';

/**
 * Dashboard « Suivi de processus » — Synthèse. Recalculé en direct (rien de
 * stocké) à partir de trois sources déjà en place :
 *   • Données versées + conformité  ← Suivi de processus (fiches + indicateurs)
 *   • Couverture / sites à jour      ← Suivi terrain (visites) + RBM
 * Objectif : voir d'un coup l'état du suivi (couverture, données, conformité)
 * et les zones à surveiller, comparé à la planification des visites.
 */
export default function ProcessDashboardPage({ onNavigate }) {
  const [month, setMonth] = useState(currentMonth);
  const [ov, setOv] = useState(null);
  const [field, setField] = useState(null);
  const [rbm, setRbm] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setOv(null); setField(null); setRbm(null); setError(null);
    Promise.all([api.monOverview(month), api.fieldSummary(month), api.rbmSites(month)])
      .then(([o, f, r]) => { setOv(o); setField(f); setRbm(r); })
      .catch((e) => setError(e.message));
  }, [month]);

  const rbmStats = useMemo(() => {
    const s = { total: 0, due: 0, elevee: 0, moyenne: 0, faible: 0 };
    for (const x of rbm || []) { s.total += 1; s[x.riskLevel] = (s[x.riskLevel] || 0) + 1; if (x.due) s.due += 1; }
    return s;
  }, [rbm]);

  const cov = field?.overall;
  const loading = !ov || !field || !rbm;
  // Districts à surveiller : couverture < 80 % (triés du plus faible).
  const watch = useMemo(() => (field?.byDistrict || []).filter((d) => d.active > 0 && d.rate < 0.8).sort((a, b) => a.rate - b.rate).slice(0, 8), [field]);

  return (
    <div className="page">
      <PageHeader title="Suivi de processus — Synthèse"
        description="Vue d'ensemble du suivi : données collectées et conformité (fiches & indicateurs), couverture terrain et sites à suivre (RBM), zones à surveiller. Recalculé en direct.">
        <MonthPicker value={month} onChange={setMonth} />
      </PageHeader>

      {error && <Alert tone="error">{error}</Alert>}
      {loading && !error ? <Skeleton height={320} /> : !error && (
        <>
          <div className="biz-kpis">
            <Kpi icon={Gauge} tone="blue" label="Couverture terrain"
              value={`${Math.round((cov?.rate || 0) * 100)} %`} foot={`${formatInt(cov?.realise || 0)} / ${formatInt(cov?.active || 0)} visites`} />
            <Kpi icon={ShieldCheck} tone={rbmStats.due ? 'amber' : 'green'} label="Sites à jour"
              value={formatInt(rbmStats.total - rbmStats.due)} foot={`${formatInt(rbmStats.due)} à suivre / ${formatInt(rbmStats.total)}`} />
            <Kpi icon={Database} tone="blue" label="Données versées"
              value={formatInt(ov.totals.submissions)} foot={`${formatInt(ov.totals.sites)} site(s) · ${formatInt(ov.totals.agents)} agent(s)`} />
            <Kpi icon={Activity} tone="blue" label="Indice de conformité"
              value={ov.conformityIndex == null ? '—' : `${ov.conformityIndex}`} foot={ov.conformityIndex == null ? 'Aucun indicateur %' : 'sur 100 (indicateurs %)'} />
            <Kpi icon={CalendarClock} tone="blue" label="Visites planifiées"
              value={formatInt(cov?.planifie || 0)} foot={`${formatInt(cov?.annule || 0)} annulée(s)`} />
            <Kpi icon={MapPin} tone="blue" label="Fiches · indicateurs"
              value={formatInt(ov.totals.forms)} foot={`${formatInt(ov.totals.indicators)} indicateur(s)`} />
          </div>

          <div className="biz-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            <TrendCard title="Données versées — tendance mensuelle" trend={ov.trend} />
            <GaugeCard title="Couverture terrain par district" rows={(field.byDistrict || []).slice(0, 8).map((d) => ({ key: d.key, label: d.label, rate: d.rate, a: d.realise, b: d.active }))} empty="Aucune visite." />
            <RiskCard stats={rbmStats} />
          </div>

          <div className="biz-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', marginTop: 16 }}>
            <GaugeCard title="Conformité par fiche" rows={(ov.perForm || []).map((f) => ({ key: f.id, label: f.label, rate: (f.index || 0) / 100, a: f.submissions, b: null, suffix: f.index == null ? '—' : `${f.index}/100` }))} empty="Aucune fiche active." />
            <WatchCard rows={watch} onNavigate={onNavigate} />
          </div>

          <div className="note" style={{ marginTop: 16 }}>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>Les données versées proviennent des fiches importées (Kobo/ODK/CSV) dans « Données & indicateurs » ; la couverture et les sites à suivre viennent de « Sites & visites » et du RBM. Comparez la couverture par district au planning pour cibler les zones à renforcer.</span>
          </div>
        </>
      )}
    </div>
  );
}

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

function GaugeCard({ title, rows, empty }) {
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{title}</div></div>
      <div className="card-body biz-gauges">
        {(!rows || rows.length === 0) ? <p className="muted">{empty}</p> : rows.map((r) => {
          const pct = Math.round((r.rate || 0) * 100);
          return (
            <div className="biz-gauge" key={r.key}>
              <div className="biz-gauge-head"><span>{r.label}</span><span className="tabular">{r.suffix || `${r.a}/${r.b} · ${pct} %`}</span></div>
              <div className="biz-bar"><span style={{ width: `${Math.min(100, pct)}%`, background: pct >= 80 ? 'var(--green)' : (pct >= 50 ? 'var(--blue-600)' : 'var(--orange)') }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RiskCard({ stats }) {
  const items = [
    { k: 'elevee', label: 'Risque élevé', n: stats.elevee, color: 'var(--red)' },
    { k: 'moyenne', label: 'Risque moyen', n: stats.moyenne, color: 'var(--orange)' },
    { k: 'faible', label: 'Risque faible', n: stats.faible, color: 'var(--green)' },
  ];
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">Répartition des sites par risque</div>
        <div className="card-sub">{formatInt(stats.due)} site(s) à suivre ce mois (RBM)</div></div>
      <div className="card-body biz-gauges">
        {items.map((i) => (
          <div className="biz-gauge" key={i.k}>
            <div className="biz-gauge-head"><span>{i.label}</span><span className="tabular">{formatInt(i.n)}</span></div>
            <div className="biz-bar"><span style={{ width: `${(i.n / max) * 100}%`, background: i.color }} /></div>
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
            <button type="button" className="biz-gauge" key={d.key} onClick={() => onNavigate && onNavigate('processus', 'sites')} title="Ouvrir Sites & visites">
              <div className="biz-gauge-head"><span>{d.label}</span><span className="tabular">{d.realise}/{d.active} · {pct} %</span></div>
              <div className="biz-bar"><span style={{ width: `${Math.min(100, pct)}%`, background: pct < 50 ? 'var(--red)' : 'var(--orange)' }} /></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Mini courbe SVG (dépendance zéro) de la tendance mensuelle des soumissions. */
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
