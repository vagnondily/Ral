import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Wallet, CheckCircle2, AlertTriangle, Users, FileSignature, Info } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Skeleton, PageHeader } from '../../components/ui.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import { SessionPeriodNote, clampPeriod, usePeriod } from '../../components/PeriodBanner.jsx';
import MapExplorer, { MAP_OPEN_KEY } from '../../components/map/MapExplorer.jsx';
import { formatAr, formatDecimal, formatInt } from '../../lib/format.js';
import { periodLabel, single, spanMonths, writeHashPeriod } from '../../lib/period.js';
import { useI18n } from '../../lib/i18n.jsx';
import { ROLE_LABELS, contractIdentity, contractNo, tpmNames } from '../../lib/roles.js';

/**
 * Plafond de la carte du suivi sur cette page : celui de Couverture & performance (analyse,
 * 24 mois), pour que « Ouvrir la carte » y montre exactement la même période.
 */
const MAP_PAGE_SPAN = 24;

/**
 * Tableau de bord décisionnel « façon Power BI » : cartes KPI, barres groupées
 * Budget / Planifié / Réalisé par contrat, tendance mensuelle, répartition du
 * réalisé par titulaire, jauges de consommation et alertes. Tout est
 * recalculé en direct depuis la consolidation (contrats + plans + factures).
 *
 * Période (lot 1b) : par défaut le cumul de toute la durée des contrats (comportement
 * historique) ; une période choisie (URL, session ou sélecteur) donne le budget DE LA
 * PÉRIODE (parts mensuelles en centimes), le planifié et le réalisé de ses mois, la
 * tendance limitée à ses mois et la carte du suivi de la période ; le budget restant, la
 * projection, les alertes et la consommation par contrat restent « à date ».
 *
 * Carte du suivi (lot 6a) : la PÉRIODE DE LA PAGE (ramenée aux 24 derniers mois, plafond
 * de l'analyse) ; « toutes les périodes » (cumul budgétaire) n'a pas de sens pour des sites
 * actifs : la carte montre alors le dernier mois avec des données, et le dit. Elle remplace
 * l'ancienne carte « Couverture terrain » (une seule règle : Couverture = sites actifs
 * réalisés ÷ actifs, même service que Couverture & performance).
 *
 * Couleurs validées (dataviz) : Réalisé = bleu #0f6cbd, Planifié = ambre
 * #c77700, Budget = gris de référence ; palette catégorielle pour la
 * répartition. Légendes + étiquettes directes → l'identité ne repose jamais
 * sur la seule couleur.
 */
const C = {
  budget: '#8b93a1',
  planned: '#c77700',
  actual: '#0f6cbd',
};
const CAT = ['#0f6cbd', '#7c3aed', '#0f7b40', '#c77700', '#d13438', '#0891b2'];
const fmtM = (n, tr) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e9) return tr('{v} Md', { v: formatDecimal(v / 1e9) });
  if (Math.abs(v) >= 1e6) return `${formatDecimal(v / 1e6)} M`;
  if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)} k`;
  return String(Math.round(v));
};
const monthLabel = (m, tr) => {
  const [y, mo] = String(m).split('-');
  const names = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const name = names[Number(mo) - 1];
  return `${name ? tr(name) : mo} ${String(y).slice(2)}`;
};

function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div className="biz-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.title && <div className="biz-tip-title">{tip.title}</div>}
      {tip.rows.map((r, i) => (
        <div className="biz-tip-row" key={i}>
          <span className="biz-tip-key"><span className="biz-dot" style={{ background: r.color }} />{r.label}</span>
          <span className="biz-tip-val tabular">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** KPI hero tile. */
function Kpi({ icon: Icon, label, value, suffix, foot, tone }) {
  return (
    <div className="biz-kpi">
      <div className={`biz-kpi-ic ${tone || ''}`}><Icon size={18} aria-hidden="true" /></div>
      <div className="biz-kpi-body">
        <div className="biz-kpi-label">{label}</div>
        <div className="biz-kpi-value tabular">{value}{suffix && <small> {suffix}</small>}</div>
        {foot && <div className="biz-kpi-foot">{foot}</div>}
      </div>
    </div>
  );
}

/** Texte coupé (« … ») pour tenir dans `width` unités du graphique (≈ 6,5 par caractère, de 6 à 22 caractères). */
const fit = (text, width) => {
  const s = String(text || ''); const n = Math.max(6, Math.min(22, Math.floor(width / 6.5)));
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** Grouped vertical bars: Budget / Planifié / Réalisé per contract. */
function GroupedBars({ rows, onTip, onOpen }) {
  const { tr } = useI18n();
  const W = 720; const H = 260; const padL = 46; const padB = 54; const padT = 12;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.budget, r.planned, r.actual)));
  const plot = H - padB - padT; const innerW = W - padL - 8;
  const groupW = innerW / rows.length; const barW = Math.min(26, (groupW - 16) / 3);
  const y = (v) => padT + plot - (v / max) * plot;
  const series = [['budget', C.budget], ['planned', C.planned], ['actual', C.actual]];
  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="biz-svg" role="img" aria-label={tr('Budget, planifié et réalisé par contrat')}>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i; const yy = y(v);
        return (
          <g key={i}>
            <line x1={padL} x2={W - 8} y1={yy} y2={yy} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 8} y={yy + 4} textAnchor="end" className="biz-axis">{fmtM(v, tr)}</text>
          </g>
        );
      })}
      {rows.map((r, gi) => {
        const gx = padL + gi * groupW + 8;
        return (
          <g key={r.contractId} onClick={() => onOpen && onOpen(r.contractId)} style={{ cursor: onOpen ? 'pointer' : 'default' }}>
            {series.map(([key, color], si) => {
              const v = r[key]; const bx = gx + si * (barW + 3); const by = y(v); const bh = padT + plot - by;
              return (
                <rect
                  key={key} x={bx} y={by} width={barW} height={Math.max(0, bh)} rx="3" fill={color}
                  onMouseMove={(e) => onTip({ x: e.clientX, y: e.clientY, title: contractIdentity(r), rows: [
                    { label: tr('Budget'), value: formatAr(r.budget), color: C.budget },
                    { label: tr('Planifié'), value: formatAr(r.planned), color: C.planned },
                    { label: tr('Réalisé'), value: formatAr(r.actual), color: C.actual },
                  ] })}
                  onMouseLeave={() => onTip(null)}
                />
              );
            })}
            {/* Identité du contrat (retour 113) : n° FLA, puis le titulaire ; coupés à la largeur du groupe. */}
            <text x={gx + (barW * 3 + 6) / 2} y={H - padB + 18} textAnchor="middle" className="biz-axis biz-cat">
              <title>{contractIdentity(r)}</title>{fit(contractNo(r), groupW)}</text>
            <text x={gx + (barW * 3 + 6) / 2} y={H - padB + 34} textAnchor="middle" className="biz-axis biz-muted">{fit(r.partnerName, groupW)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Monthly trend: Planifié vs Réalisé lines with a crosshair tooltip. */
function TrendLines({ months, monthly, onTip }) {
  const { tr } = useI18n();
  const W = 720; const H = 240; const padL = 46; const padB = 34; const padT = 12; const padR = 10;
  const data = months.map((m) => monthly.find((x) => x.month === m) || { month: m, planned: 0, actual: 0 });
  const max = Math.max(1, ...data.map((d) => Math.max(d.planned, d.actual)));
  const plot = H - padB - padT; const innerW = W - padL - padR;
  const x = (i) => padL + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v) => padT + plot - (v / max) * plot;
  const path = (key) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="biz-svg" role="img" aria-label={tr('Tendance mensuelle planifié vs réalisé')}>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i; const yy = y(v);
        return (<g key={i}><line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="var(--border)" strokeWidth="1" /><text x={padL - 8} y={yy + 4} textAnchor="end" className="biz-axis">{fmtM(v, tr)}</text></g>);
      })}
      <path d={path('planned')} fill="none" stroke={C.planned} strokeWidth="2" />
      <path d={path('actual')} fill="none" stroke={C.actual} strokeWidth="2" />
      {data.map((d, i) => (
        <g key={d.month}>
          {[['planned', C.planned], ['actual', C.actual]].map(([k, col]) => (
            <circle key={k} cx={x(i)} cy={y(d[k])} r="3.5" fill={col} stroke="var(--surface)" strokeWidth="1.5" />
          ))}
          <rect x={x(i) - innerW / (data.length * 2)} y={padT} width={innerW / data.length} height={plot} fill="transparent"
            onMouseMove={(e) => onTip({ x: e.clientX, y: e.clientY, title: monthLabel(d.month, tr), rows: [
              { label: tr('Planifié'), value: formatAr(d.planned), color: C.planned },
              { label: tr('Réalisé'), value: formatAr(d.actual), color: C.actual },
            ] })}
            onMouseLeave={() => onTip(null)} />
          <text x={x(i)} y={H - 12} textAnchor="middle" className="biz-axis">{monthLabel(d.month, tr)}</text>
        </g>
      ))}
    </svg>
  );
}

/** Donut: share of « Réalisé » by titulaire (contract holder). */
function Donut({ items, onTip }) {
  const { tr } = useI18n();
  const total = items.reduce((n, it) => n + it.value, 0) || 1;
  const R = 78; const r = 48; const cx = 90; const cy = 90;
  let acc = 0;
  const arc = (frac) => {
    const a0 = acc * 2 * Math.PI - Math.PI / 2; acc += frac; const a1 = acc * 2 * Math.PI - Math.PI / 2;
    const large = frac > 0.5 ? 1 : 0;
    const p = (rad, ang) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const [x0, y0] = p(R, a0); const [x1, y1] = p(R, a1); const [x2, y2] = p(r, a1); const [x3, y3] = p(r, a0);
    return `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z`;
  };
  return (
    <svg viewBox="0 0 180 180" className="biz-donut" role="img" aria-label={tr('Répartition du réalisé par titulaire')}>
      {items.length === 1 && (
        <circle cx={cx} cy={cy} r={(R + r) / 2} fill="none" stroke={items[0].color} strokeWidth={R - r}
          onMouseMove={(e) => onTip({ x: e.clientX, y: e.clientY, title: items[0].label, rows: [
            { label: tr('Réalisé'), value: formatAr(items[0].value), color: items[0].color },
            { label: tr('Part'), value: '100 %', color: items[0].color },
          ] })}
          onMouseLeave={() => onTip(null)} />
      )}
      {items.length > 1 && items.map((it) => (
        <path key={it.label} d={arc(it.value / total)} fill={it.color} stroke="var(--surface)" strokeWidth="2"
          onMouseMove={(e) => onTip({ x: e.clientX, y: e.clientY, title: it.label, rows: [
            { label: tr('Réalisé'), value: formatAr(it.value), color: it.color },
            { label: tr('Part'), value: `${Math.round((it.value / total) * 100)} %`, color: it.color },
          ] })}
          onMouseLeave={() => onTip(null)} />
      ))}
      <text x="90" y="86" textAnchor="middle" className="biz-donut-tot">{fmtM(total, tr)}</text>
      <text x="90" y="104" textAnchor="middle" className="biz-donut-lab">{tr('Ar réalisé')}</text>
    </svg>
  );
}

export default function DashboardBIPage({ onOpenContract, onNavigate }) {
  const { tr, lang } = useI18n();
  const { period, ready, counts, latest, today, periods, source, setPeriod, resetToDefault } = usePeriod({ scope: 'analysis', defaultRule: 'all' });
  const key = period ? `${period.from}|${period.to}` : 'all';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tip, setTip] = useState(null);

  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    setData(null); setError(null);
    api.consolidation({ period }).then((d) => {
      if (!alive) return;
      setData(d);
      try { if (typeof performance !== 'undefined' && performance.mark) performance.mark('period:rendered'); } catch { /* sans incidence */ }
    }, (e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Période de la carte : celle de la page (≤ 24 mois) ; sans période, le dernier mois avec des
  // données (undefined tant qu'il n'est pas connu : la carte attend au lieu d'afficher un mois vide).
  const mapPeriod = useMemo(() => {
    if (!ready) return undefined;
    if (period) return clampPeriod(period, MAP_PAGE_SPAN);
    if (!periods) return undefined;
    return single(latest || today);
  }, [ready, key, periods, latest, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapClamped = !!(period && spanMonths(period) > MAP_PAGE_SPAN);
  // « Ouvrir la carte » : Couverture & performance › Carte avec la MÊME période (dans l'URL : la
  // page la lit par usePeriod, comme un lien partagé) ; thème et filtres passés par la session.
  const openMap = (state) => {
    const { theme, officeId, activity } = state || {};
    try { window.sessionStorage.setItem(MAP_OPEN_KEY, JSON.stringify({ view: 'carte', theme, officeId, activity })); } catch { /* stockage indisponible */ }
    if (mapPeriod) window.location.hash = writeHashPeriod('#/dashboard/couverture', mapPeriod);
    else if (onNavigate) onNavigate('dashboard', 'couverture');
  };

  // Avec une période : les chiffres DE LA PÉRIODE par contrat (budget de la période, planifié, réalisé).
  const shown = useMemo(() => (data ? data.rows.map((r) => (period && r.period
    ? { ...r, budget: r.period.budget || 0, planned: r.period.planned, actual: r.period.actual }
    : r)) : []), [data, period]);

  const donutItems = useMemo(() => {
    // Par TITULAIRE du contrat (retour 113) : le réalisé payé au TPM sur les contrats de chacun.
    const byHolder = new Map();
    for (const r of shown) byHolder.set(r.partnerName, (byHolder.get(r.partnerName) || 0) + r.actual);
    return [...byHolder.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({ label, value, color: CAT[i % CAT.length] }));
  }, [shown]);

  const picker = ready && (
    <PeriodSelect value={period} onChange={setPeriod} counts={counts} latest={latest} today={today} allowAll align="right" />
  );
  if (error) return <div className="section-gap"><PageHeader title={tr('Tableau de bord décisionnel')}>{picker}</PageHeader><Alert tone="error" icon={AlertTriangle}>{error}</Alert></div>;
  if (!data) return <div className="section-gap"><PageHeader title={tr('Tableau de bord décisionnel')}>{picker}</PageHeader><Skeleton height={320} /></div>;

  const { rows, totals, months, monthlyTotals } = data;
  const alerts = rows.filter((r) => r.overspent || (r.projectedOverrun && r.projectedOverrun > 0));
  const tp = period && totals.period;
  const pctOf = (rate) => (rate == null ? '—' : `${Math.round(rate * 100)}`);
  const pLabel = period ? periodLabel(period, lang) : '';
  let mapNote = null;
  if (mapPeriod && !period) mapNote = tr('Toutes les périodes : la carte montre {m}, dernier mois avec des données.', { m: periodLabel(mapPeriod, lang) });
  else if (mapPeriod && mapClamped) mapNote = tr('La carte montre les 24 derniers mois de la période ({p}).', { p: periodLabel(mapPeriod, lang) });

  return (
    <div className="section-gap" onMouseLeave={() => setTip(null)}>
      <PageHeader title={tr('Tableau de bord décisionnel')} description={tr('Vue analytique du suivi budgétaire TPM — budget, planifié, réalisé, tendance et alertes, recalculés en direct.')}>
        {picker}
      </PageHeader>
      <SessionPeriodNote source={source} onReset={resetToDefault} resetLabel={tr('Revenir à toutes les périodes')} />

      {tp ? (
        <div className="biz-kpis">
          <Kpi icon={Wallet} label={tr('Budget de la période')} value={fmtM(tp.budget, tr)} suffix="Ar"
            foot={tr('{n} mois · budget total {amount} Ar', { n: tp.months, amount: fmtM(totals.budget, tr) })} tone="blue" />
          <Kpi icon={TrendingUp} label={tr('Planifié')} value={fmtM(tp.planned, tr)} suffix="Ar"
            foot={tp.plannedRate == null ? tr('— aucun budget sur la période') : tr('{p} % du budget de la période', { p: pctOf(tp.plannedRate) })} tone="amber" />
          <Kpi icon={CheckCircle2} label={tr('Réalisé (factures validées)')} value={fmtM(tp.actual, tr)} suffix="Ar"
            foot={tp.pending > 0
              ? tr('{p} % du budget de la période · {amount} Ar en attente de validation', { p: pctOf(tp.actualRate), amount: formatInt(tp.pending) })
              : tr('{p} % du budget de la période', { p: pctOf(tp.actualRate) })} tone="blue" />
          <Kpi icon={Wallet} label={tr('Budget restant')} value={fmtM(totals.remaining, tr)} suffix="Ar" foot={tr('à date')} tone={totals.remaining < 0 ? 'red' : 'green'} />
          <Kpi icon={AlertTriangle} label={tr('Alertes')} value={formatInt(alerts.length)} foot={tr('Dépassement / projection · à date')} tone={alerts.length ? 'red' : 'green'} />
          <Kpi icon={Users} label={tr('Taux de la période')} value={pctOf(tp.actualRate)} suffix={tp.actualRate == null ? '' : '%'} foot={tr('Réalisé ÷ budget de la période')} tone="blue" />
        </div>
      ) : (
        <div className="biz-kpis">
          <Kpi icon={Wallet} label={tr('Budget de suivi')} value={fmtM(totals.budget, tr)} suffix="Ar" foot={tr('{n} contrat(s)', { n: totals.contracts })} tone="blue" />
          <Kpi icon={TrendingUp} label={tr('Planifié')} value={fmtM(totals.planned, tr)} suffix="Ar" foot={tr('{p} % du budget', { p: Math.round((totals.plannedRate || 0) * 100) })} tone="amber" />
          <Kpi icon={CheckCircle2} label={tr('Réalisé (factures validées)')} value={fmtM(totals.actual, tr)} suffix="Ar"
            foot={totals.pendingValidation > 0
              ? tr('{p} % du budget · {amount} Ar en attente de validation', { p: Math.round((totals.actualRate || 0) * 100), amount: formatInt(totals.pendingValidation) })
              : tr('{p} % du budget', { p: Math.round((totals.actualRate || 0) * 100) })} tone="blue" />
          <Kpi icon={Wallet} label={tr('Budget restant')} value={fmtM(totals.remaining, tr)} suffix="Ar" foot={tr('Disponible')} tone={totals.remaining < 0 ? 'red' : 'green'} />
          <Kpi icon={AlertTriangle} label={tr('Alertes')} value={formatInt(alerts.length)} foot={tr('Dépassement / projection')} tone={alerts.length ? 'red' : 'green'} />
          <Kpi icon={Users} label={tr('Taux global')} value={`${Math.round((totals.actualRate || 0) * 100)}`} suffix="%" foot={tr('Consommation')} tone="blue" />
        </div>
      )}

      {/* Carte du suivi : pleine largeur sous les tuiles, même service que Couverture & performance › Carte
          (remplace « Couverture terrain », ancienne règle visites réalisées ÷ planifiées). */}
      <section className="bi-map" aria-label={tr('Carte du suivi')}>
        {mapNote && <p className="period-session-note"><Info size={14} aria-hidden="true" /><span>{mapNote}</span></p>}
        <MapExplorer variant="compact" period={mapPeriod} onNavigate={onNavigate} onOpenFull={openMap} />
      </section>

      <div className="biz-grid">
        <div className="card biz-card biz-span2">
          <div className="card-header"><div className="card-title">{period ? tr('Budget · Planifié · Réalisé par contrat — {p}', { p: pLabel }) : tr('Budget · Planifié · Réalisé par contrat')}</div>
            <Legend items={[[period ? tr('Budget de la période') : tr('Budget'), C.budget], [tr('Planifié'), C.planned], [tr('Réalisé'), C.actual]]} /></div>
          <div className="card-body"><GroupedBars rows={shown} onTip={setTip} onOpen={onOpenContract} /></div>
        </div>

        <div className="card biz-card">
          <div className="card-header"><div className="card-title">{period ? tr('Réalisé par titulaire — {p}', { p: pLabel }) : tr('Réalisé par titulaire')}</div></div>
          <div className="card-body biz-donut-wrap">
            {donutItems.length ? <Donut items={donutItems} onTip={setTip} /> : <p className="muted">{tr('Aucun réalisé.')}</p>}
            <div className="biz-legend-col">
              {donutItems.map((it) => (
                <div className="biz-legend-item" key={it.label}>
                  <span className="biz-dot" style={{ background: it.color }} />
                  <span className="biz-legend-lab">{it.label}</span>
                  <span className="tabular biz-legend-val">{formatAr(it.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card biz-card biz-span2">
          <div className="card-header"><div className="card-title">{tr('Tendance mensuelle')}</div>
            <Legend items={[[tr('Planifié'), C.planned], [tr('Réalisé'), C.actual]]} /></div>
          <div className="card-body">
            {months.length ? <TrendLines months={months} monthly={monthlyTotals} onTip={setTip} /> : <p className="muted">{tr('Aucune donnée mensuelle.')}</p>}
          </div>
        </div>

        <div className="card biz-card">
          <div className="card-header"><div className="card-title">{tr('Consommation par contrat (à date)')}</div></div>
          <div className="card-body biz-gauges">
            {rows.map((r) => {
              const rate = Math.min(1.2, r.actualRate || 0);
              const col = r.overspent ? 'var(--red)' : rate >= 0.85 ? 'var(--orange)' : C.actual;
              return (
                <button type="button" key={r.contractId} className="biz-gauge" onClick={() => onOpenContract && onOpenContract(r.contractId)}>
                  <div className="biz-gauge-head"><span className="mono">{contractNo(r)}</span><span className="tabular" style={{ color: col }}>{Math.round((r.actualRate || 0) * 100)} %</span></div>
                  <div className="biz-bar"><span style={{ width: `${Math.min(100, (r.actualRate || 0) * 100)}%`, background: col }} /></div>
                  <div className="biz-gauge-foot">{tr('{partner} · reste {amount}', { partner: r.partnerName, amount: formatAr(r.remaining) })}</div>
                </button>
              );
            })}
          </div>
        </div>

      </div>

      {alerts.length > 0 && (
        <div className="card biz-card" style={{ marginTop: 16 }}>
          <div className="card-header"><div className="card-title">{tr('Alertes budgétaires')}</div>
            <div className="card-sub">{tr('Contrats en dépassement ou en projection de dépassement du budget de suivi.')}</div></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{tr('Contrat')}</th><th>{tr(ROLE_LABELS.holder)}</th><th>{tr(ROLE_LABELS.tpm)}</th><th className="num">{tr('Réalisé')}</th><th className="num">{tr('Budget')}</th><th className="num">{tr('Projection fin')}</th><th>{tr('État')}</th></tr></thead>
            <tbody>{alerts.map((r) => (
              <tr key={r.contractId} onClick={() => onOpenContract && onOpenContract(r.contractId)} style={{ cursor: 'pointer' }}>
                <td className="nowrap"><strong className="mono">{contractNo(r)}</strong></td><td>{r.partnerName}</td>
                <td>{tpmNames(r.tpm).length ? tpmNames(r.tpm).join(', ') : <span className="cell-empty" title={tr(ROLE_LABELS.noTpmHint)}>{tr(ROLE_LABELS.noTpm)}</span>}</td>
                <td className="num tabular">{formatAr(r.actual)}</td>
                <td className="num tabular">{formatAr(r.budget)}</td>
                <td className="num tabular">{formatAr(r.projectedTotal)}</td>
                <td><span className="badge" style={{ background: 'var(--red-bg)', color: 'var(--red-text)' }}><span className="dot" style={{ background: 'var(--red)' }} />{r.overspent ? tr('Dépassé') : tr('Projection')}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      <Tip tip={tip} />
    </div>
  );
}

function Legend({ items }) {
  return (
    <div className="biz-legend">
      {items.map(([label, color]) => (
        <span className="biz-legend-item" key={label}><span className="biz-dot" style={{ background: color }} />{label}</span>
      ))}
    </div>
  );
}
