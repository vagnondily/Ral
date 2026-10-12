import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, ShieldCheck, Database, CalendarClock, MapPin, Activity, AlertTriangle, AlertCircle, Info, ArrowRight } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, PageHeader, Skeleton } from '../../components/ui.jsx';
import MonthSelect from '../../components/MonthSelect.jsx';
import { currentMonth, formatInt, monthLabel, shortMonthLabel } from '../../lib/format.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Dashboard « Suivi de processus » — Synthèse. Recalculé en direct (rien de
 * stocké) à partir de trois sources déjà en place :
 *   • Données versées + conformité  ← Suivi de processus (fiches + indicateurs)
 *   • Couverture / sites à jour      ← Affectation & visites + RBM
 * Objectif : voir d'un coup l'état du suivi, PAR BUREAU (visites et données
 * reçues), et les bureaux à surveiller.
 *
 * Fiabilité de l'affichage : chaque source est chargée indépendamment — si
 * l'une échoue, les cartes des autres restent affichées, avec le message de
 * l'erreur à la place de la carte concernée. À l'ouverture, si le mois courant
 * n'a encore aucune donnée, la page se place sur le dernier mois qui en a
 * (et le dit), au lieu d'afficher des zéros.
 */
export default function ProcessDashboardPage({ onNavigate }) {
  const { tr } = useI18n();
  const [month, setMonth] = useState(currentMonth);
  const [res, setRes] = useState(null);       // { ov, field, rbm } : { data } | { error }
  const [autoFrom, setAutoFrom] = useState(null); // mois demandé quand la page s'est placée ailleurs
  const firstLoad = useRef(true);

  useEffect(() => {
    let alive = true;
    setRes(null);
    const settle = (p) => p.then((data) => ({ data }), (e) => ({ error: e.message }));
    Promise.all([settle(api.monOverview(month)), settle(api.fieldSummary(month)), settle(api.rbmSites(month))])
      .then(([ov, field, rbm]) => {
        if (!alive) return;
        const o = ov.data;
        if (firstLoad.current && o && o.totals.submissions === 0 && o.latestMonth && o.latestMonth !== month) {
          firstLoad.current = false;
          setAutoFrom(month);
          setMonth(o.latestMonth);
          return;
        }
        firstLoad.current = false;
        setRes({ ov, field, rbm });
      });
    return () => { alive = false; };
  }, [month]);
  // Un mois choisi par l'utilisateur n'est jamais remplacé par le saut automatique du premier chargement.
  const pickMonth = (m) => { firstLoad.current = false; setAutoFrom(null); setMonth(m); };

  const ov = res?.ov.data;
  const field = res?.field.data;
  const rbm = res?.rbm.data;

  const rbmStats = useMemo(() => {
    const s = { total: 0, due: 0, elevee: 0, moyenne: 0, faible: 0 };
    for (const x of rbm || []) { s.total += 1; s[x.riskLevel] = (s[x.riskLevel] || 0) + 1; if (x.due) s.due += 1; }
    return s;
  }, [rbm]);

  // Par bureau : visites (couverture) et formulaires reçus, réunis par nom de bureau.
  const offices = useMemo(() => {
    const m = new Map();
    const get = (name) => { if (!m.has(name)) m.set(name, { key: name, label: name, active: 0, realise: 0, rate: null, submissions: 0 }); return m.get(name); };
    for (const o of field?.byOffice || []) {
      const r = get(o.key === '—' ? tr('Sans bureau') : o.label);
      r.active = o.active; r.realise = o.realise; r.rate = o.active > 0 ? o.rate : null;
    }
    for (const b of ov?.byBureau || []) get(b.bureau === '(non renseigné)' ? tr('Sans bureau') : b.bureau).submissions += b.submissions;
    return [...m.values()].sort((a, b) => (b.active - a.active) || (b.submissions - a.submissions));
  }, [field, ov, tr]);
  const watch = offices.filter((o) => o.rate != null && o.rate < 0.8).sort((a, b) => a.rate - b.rate).slice(0, 8);

  const cov = field?.overall;
  const empty = ov && ov.totals.submissions === 0;
  const go = (mod, sub) => onNavigate && onNavigate(mod, sub);

  return (
    <div className="page">
      <PageHeader title={tr('Suivi de processus — Synthèse')}
        description={tr("Vue d'ensemble du suivi par bureau : visites réalisées, données reçues et conformité (fiches & indicateurs), sites à suivre (RBM). Recalculé en direct.")}>
        <MonthSelect value={month} onChange={pickMonth} />
      </PageHeader>

      {autoFrom && (
        <Alert tone="info" icon={Info}>
          {tr('{asked} n\'a pas encore de données. Mois affiché : {shown}, le dernier avec des données.', { asked: monthLabel(autoFrom), shown: monthLabel(month) })}
          {' '}<button type="button" className="inline-link" onClick={() => pickMonth(autoFrom)}>{tr('Revenir à {m}', { m: monthLabel(autoFrom) })}</button>
        </Alert>
      )}
      {!autoFrom && empty && (
        <Alert tone="info" icon={Info}>
          {ov.latestMonth
            ? <>{tr('Aucune donnée reçue pour le mois sélectionné ({m}). Dernières données : {last}.', { m: monthLabel(month), last: monthLabel(ov.latestMonth) })}{' '}
              <button type="button" className="inline-link" onClick={() => pickMonth(ov.latestMonth)}>{tr('Voir {m}', { m: monthLabel(ov.latestMonth) })}</button></>
            : <>{tr('Aucune donnée reçue pour l\'instant.')}{' '}
              <button type="button" className="inline-link" onClick={() => go('processus', 'donnees')}>{tr('Importer des données')}</button></>}
        </Alert>
      )}

      {!res ? <Skeleton height={320} /> : (
        <>
          <div className="biz-kpis">
            <Kpi icon={Gauge} tone="blue" label={tr('Couverture terrain')} error={res.field.error}
              value={tr('{p} %', { p: Math.round((cov?.rate || 0) * 100) })} foot={tr('{done} / {active} visites', { done: formatInt(cov?.realise || 0), active: formatInt(cov?.active || 0) })} />
            <Kpi icon={ShieldCheck} tone={rbmStats.due ? 'amber' : 'green'} label={tr('Sites à jour')} error={res.rbm.error}
              value={formatInt(rbmStats.total - rbmStats.due)} foot={tr('{due} à suivre / {total}', { due: formatInt(rbmStats.due), total: formatInt(rbmStats.total) })} />
            <Kpi icon={Database} tone="blue" label={tr('Données reçues')} error={res.ov.error}
              value={formatInt(ov?.totals.submissions || 0)} foot={tr('{sites} site(s) · {agents} agent(s)', { sites: formatInt(ov?.totals.sites || 0), agents: formatInt(ov?.totals.agents || 0) })} />
            <Kpi icon={Activity} tone="blue" label={tr('Indice de conformité')} error={res.ov.error}
              value={ov?.conformityIndex == null ? '—' : `${ov.conformityIndex}`}
              foot={ov?.conformityIndex != null ? tr('sur 100 (indicateurs %)') : ov?.totals.indicators ? tr('Aucune donnée notée ce mois') : tr('Aucun indicateur défini')} />
            <Kpi icon={CalendarClock} tone="blue" label={tr('Visites planifiées')} error={res.field.error}
              value={formatInt(cov?.planifie || 0)} foot={tr('{n} annulée(s)', { n: formatInt(cov?.annule || 0) })} />
            <Kpi icon={MapPin} tone="blue" label={tr('Fiches · indicateurs')} error={res.ov.error}
              value={formatInt(ov?.totals.forms || 0)} foot={tr('{n} indicateur(s)', { n: formatInt(ov?.totals.indicators || 0) })} />
          </div>

          <div className="biz-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            <TrendCard title={tr('Données reçues — 12 derniers mois')} trend={ov?.trend} error={res.ov.error} selected={month} />
            <OfficesCard rows={offices} error={res.field.error || res.ov.error} onOpen={() => go('processus', 'sites')} />
            <RiskCard stats={rbmStats} error={res.rbm.error} />
          </div>

          <div className="biz-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', marginTop: 16 }}>
            <FormsCard forms={ov?.perForm} error={res.ov.error} onOpen={() => go('processus', 'donnees')} />
            <WatchCard rows={watch} error={res.field.error} onNavigate={onNavigate} />
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

function Kpi({ icon: Icon, label, value, foot, tone, error }) {
  const { tr } = useI18n();
  return (
    <div className="biz-kpi">
      <div className={`biz-kpi-ic ${error ? 'amber' : tone || ''}`}><Icon size={18} aria-hidden="true" /></div>
      <div className="biz-kpi-body">
        <div className="biz-kpi-label">{label}</div>
        <div className="biz-kpi-value tabular">{error ? '—' : value}</div>
        {error ? <div className="biz-kpi-foot text-warn" title={error}>{tr('Indisponible')}</div> : foot && <div className="biz-kpi-foot">{foot}</div>}
      </div>
    </div>
  );
}

const barColor = (pct) => (pct >= 80 ? 'var(--green)' : (pct >= 50 ? 'var(--blue-600)' : 'var(--orange)'));

/** Par bureau : couverture des visites (réalisées / planifiées) et formulaires reçus. */
function OfficesCard({ rows, error, onOpen }) {
  const { tr } = useI18n();
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{tr('Couverture par bureau')}</div>
        <div className="card-sub">{tr('Visites réalisées / planifiées · formulaires reçus')}</div></div>
      <div className="card-body biz-gauges">
        {error ? <CardError error={error} /> : rows.length === 0 ? (
          <p className="muted">{tr('Aucune visite planifiée ni donnée reçue ce mois.')}{' '}
            <button type="button" className="inline-link" onClick={onOpen}>{tr('Planifier les visites')}</button></p>
        ) : rows.slice(0, 10).map((r) => {
          const pct = r.rate == null ? null : Math.round(r.rate * 100);
          return (
            <div className="biz-gauge" key={r.key}>
              <div className="biz-gauge-head"><span>{r.label}</span>
                <span className="tabular">{pct == null ? tr('aucune visite planifiée') : `${r.realise}/${r.active} · ${tr('{p} %', { p: pct })}`}</span></div>
              <div className="biz-bar"><span style={{ width: `${pct == null ? 0 : Math.min(100, pct)}%`, background: barColor(pct || 0) }} /></div>
              <div className="biz-gauge-foot muted">{tr('{n} formulaire(s) reçu(s)', { n: formatInt(r.submissions) })}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Conformité par fiche ; une fiche sans indicateur ou non rattachée dit quoi faire. */
function FormsCard({ forms, error, onOpen }) {
  const { tr } = useI18n();
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{tr('Conformité par fiche')}</div>
        <div className="card-sub">{tr('Indice sur 100, calculé à partir des indicateurs de chaque fiche')}</div></div>
      <div className="card-body biz-gauges">
        {error ? <CardError error={error} /> : !forms || forms.length === 0 ? (
          <p className="muted">{tr('Aucune fiche active.')}{' '}<button type="button" className="inline-link" onClick={onOpen}>{tr('Créer ou importer une fiche')}</button></p>
        ) : forms.map((f) => {
          const todo = !f.indicators ? tr('aucun indicateur défini') : f.index == null ? tr('aucune donnée notée ce mois') : null;
          return (
            <div className="biz-gauge" key={f.id}>
              <div className="biz-gauge-head"><span title={f.label}>{f.label}</span>
                <span className="tabular">{todo ? '—' : `${f.index}/100`}</span></div>
              <div className="biz-bar"><span style={{ width: `${todo ? 0 : Math.min(100, f.index)}%`, background: barColor(f.index || 0) }} /></div>
              <div className="biz-gauge-foot muted">
                {tr('{n} formulaire(s) reçu(s)', { n: formatInt(f.submissions) })}
                {todo && <> · <span className="text-warn">{todo}</span></>}
                {!f.activityCategory && <> · <span className="text-warn">{tr('non rattachée à une activité')}</span></>}
                {(!f.indicators || !f.activityCategory) && <> · <button type="button" className="inline-link" onClick={onOpen}>{tr('Compléter la fiche')} <ArrowRight size={12} aria-hidden="true" /></button></>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RiskCard({ stats, error }) {
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
        <div className="card-sub">{tr('{n} site(s) à suivre ce mois (RBM)', { n: formatInt(stats.due) })}</div></div>
      <div className="card-body biz-gauges">
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
      <div className="card-header"><div className="card-title">{tr('Bureaux à surveiller')}</div>
        <div className="card-sub">{tr('Bureaux dont la couverture des visites est < 80 %')}</div></div>
      <div className="card-body biz-gauges">
        {error ? <CardError error={error} /> : (!rows || rows.length === 0) ? <p className="muted">{tr('Tous les bureaux avec des visites planifiées sont à 80 % ou plus.')}</p> : rows.map((d) => {
          const pct = Math.round((d.rate || 0) * 100);
          return (
            <button type="button" className="biz-gauge" key={d.key} onClick={() => onNavigate && onNavigate('processus', 'sites')} title={tr('Ouvrir Affectation & visites')}>
              <div className="biz-gauge-head"><span>{d.label}</span><span className="tabular">{d.realise}/{d.active} · {tr('{p} %', { p: pct })}</span></div>
              <div className="biz-bar"><span style={{ width: `${Math.min(100, pct)}%`, background: pct < 50 ? 'var(--red)' : 'var(--orange)' }} /></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Mini courbe SVG (dépendance zéro) des soumissions des 12 mois finissant au mois choisi. */
function TrendCard({ title, trend, error, selected }) {
  const { tr } = useI18n();
  const data = trend || [];
  const w = 320; const h = 150; const pad = { l: 14, r: 14, t: 14, b: 22 };
  const max = Math.max(1, ...data.map((d) => d.submissions));
  const n = data.length;
  const total = data.reduce((a, d) => a + d.submissions, 0);
  const x = (i) => pad.l + (n <= 1 ? 0 : (i * (w - pad.l - pad.r)) / (n - 1));
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / max);
  const pts = data.map((d, i) => `${x(i)},${y(d.submissions)}`).join(' ');
  // Une étiquette sur trois, ancrée sur le dernier mois (le mois choisi) : jamais de chevauchement.
  const step = Math.max(1, Math.ceil(n / 4));
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{title}</div></div>
      <div className="card-body">
        {error ? <CardError error={error} /> : total === 0 ? <p className="muted">{tr('Aucune donnée reçue sur ces 12 mois.')}</p> : (
          <svg className="biz-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title}>
            <polyline fill="none" stroke="var(--blue-600)" strokeWidth="2" points={pts} />
            {data.map((d, i) => (
              <circle key={d.month} cx={x(i)} cy={y(d.submissions)} r={d.month === selected ? 4.5 : 3} fill="var(--blue-600)">
                <title>{`${monthLabel(d.month)} : ${formatInt(d.submissions)}`}</title>
              </circle>
            ))}
            {data.map((d, i) => ((n - 1 - i) % step === 0
              ? <text key={`t${d.month}`} className="biz-axis biz-muted" x={x(i)} y={h - 6} textAnchor={i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>{shortMonthLabel(d.month)}</text> : null))}
          </svg>
        )}
      </div>
    </div>
  );
}
