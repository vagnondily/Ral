import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Wallet, CheckCircle2, AlertTriangle, Users, FileSignature } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Skeleton, PageHeader } from '../../components/ui.jsx';
import { formatAr, formatInt, currentMonth } from '../../lib/format.js';

/**
 * Tableau de bord décisionnel « façon Power BI » : cartes KPI, barres groupées
 * Budget / Planifié / Réalisé par contrat, tendance mensuelle, répartition du
 * réalisé par prestataire, jauges de consommation et alertes. Tout est
 * recalculé en direct depuis la consolidation (contrats + plans + factures).
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
const fmtM = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)} Md`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)} M`;
  if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)} k`;
  return String(Math.round(v));
};
const monthLabel = (m) => {
  const [y, mo] = String(m).split('-');
  const names = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return `${names[Number(mo) - 1] || mo} ${String(y).slice(2)}`;
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

/** Grouped vertical bars: Budget / Planifié / Réalisé per contract. */
function GroupedBars({ rows, onTip, onOpen }) {
  const W = 720; const H = 260; const padL = 46; const padB = 54; const padT = 12;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.budget, r.planned, r.actual)));
  const plot = H - padB - padT; const innerW = W - padL - 8;
  const groupW = innerW / rows.length; const barW = Math.min(26, (groupW - 16) / 3);
  const y = (v) => padT + plot - (v / max) * plot;
  const series = [['budget', C.budget], ['planned', C.planned], ['actual', C.actual]];
  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="biz-svg" role="img" aria-label="Budget, planifié et réalisé par contrat">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i; const yy = y(v);
        return (
          <g key={i}>
            <line x1={padL} x2={W - 8} y1={yy} y2={yy} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 8} y={yy + 4} textAnchor="end" className="biz-axis">{fmtM(v)}</text>
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
                  onMouseMove={(e) => onTip({ x: e.clientX, y: e.clientY, title: `${r.partnerName} · ${r.numero}`, rows: [
                    { label: 'Budget', value: formatAr(r.budget), color: C.budget },
                    { label: 'Planifié', value: formatAr(r.planned), color: C.planned },
                    { label: 'Réalisé', value: formatAr(r.actual), color: C.actual },
                  ] })}
                  onMouseLeave={() => onTip(null)}
                />
              );
            })}
            <text x={gx + (barW * 3 + 6) / 2} y={H - padB + 18} textAnchor="middle" className="biz-axis biz-cat">{r.numero}</text>
            <text x={gx + (barW * 3 + 6) / 2} y={H - padB + 34} textAnchor="middle" className="biz-axis biz-muted">{r.partnerName.slice(0, 16)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Monthly trend: Planifié vs Réalisé lines with a crosshair tooltip. */
function TrendLines({ months, monthly, onTip }) {
  const W = 720; const H = 240; const padL = 46; const padB = 34; const padT = 12; const padR = 10;
  const data = months.map((m) => monthly.find((x) => x.month === m) || { month: m, planned: 0, actual: 0 });
  const max = Math.max(1, ...data.map((d) => Math.max(d.planned, d.actual)));
  const plot = H - padB - padT; const innerW = W - padL - padR;
  const x = (i) => padL + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v) => padT + plot - (v / max) * plot;
  const path = (key) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="biz-svg" role="img" aria-label="Tendance mensuelle planifié vs réalisé">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i; const yy = y(v);
        return (<g key={i}><line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="var(--border)" strokeWidth="1" /><text x={padL - 8} y={yy + 4} textAnchor="end" className="biz-axis">{fmtM(v)}</text></g>);
      })}
      <path d={path('planned')} fill="none" stroke={C.planned} strokeWidth="2" />
      <path d={path('actual')} fill="none" stroke={C.actual} strokeWidth="2" />
      {data.map((d, i) => (
        <g key={d.month}>
          {[['planned', C.planned], ['actual', C.actual]].map(([k, col]) => (
            <circle key={k} cx={x(i)} cy={y(d[k])} r="3.5" fill={col} stroke="var(--surface)" strokeWidth="1.5" />
          ))}
          <rect x={x(i) - innerW / (data.length * 2)} y={padT} width={innerW / data.length} height={plot} fill="transparent"
            onMouseMove={(e) => onTip({ x: e.clientX, y: e.clientY, title: monthLabel(d.month), rows: [
              { label: 'Planifié', value: formatAr(d.planned), color: C.planned },
              { label: 'Réalisé', value: formatAr(d.actual), color: C.actual },
            ] })}
            onMouseLeave={() => onTip(null)} />
          <text x={x(i)} y={H - 12} textAnchor="middle" className="biz-axis">{monthLabel(d.month)}</text>
        </g>
      ))}
    </svg>
  );
}

/** Donut: share of « Réalisé » by prestataire. */
function Donut({ items, onTip }) {
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
    <svg viewBox="0 0 180 180" className="biz-donut" role="img" aria-label="Répartition du réalisé par prestataire">
      {items.map((it, i) => (
        <path key={it.label} d={arc(it.value / total)} fill={it.color} stroke="var(--surface)" strokeWidth="2"
          onMouseMove={(e) => onTip({ x: e.clientX, y: e.clientY, title: it.label, rows: [
            { label: 'Réalisé', value: formatAr(it.value), color: it.color },
            { label: 'Part', value: `${Math.round((it.value / total) * 100)} %`, color: it.color },
          ] })}
          onMouseLeave={() => onTip(null)} />
      ))}
      <text x="90" y="86" textAnchor="middle" className="biz-donut-tot">{fmtM(total)}</text>
      <text x="90" y="104" textAnchor="middle" className="biz-donut-lab">Ar réalisé</text>
    </svg>
  );
}

export default function DashboardBIPage({ onOpenContract }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [field, setField] = useState(null); // couverture terrain du mois courant
  const [tip, setTip] = useState(null);

  useEffect(() => { api.consolidation().then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(() => { api.fieldSummary(currentMonth()).then(setField).catch(() => setField(null)); }, []);

  const donutItems = useMemo(() => {
    if (!data) return [];
    const byPartner = new Map();
    for (const r of data.rows) byPartner.set(r.partnerName, (byPartner.get(r.partnerName) || 0) + r.actual);
    return [...byPartner.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({ label, value, color: CAT[i % CAT.length] }));
  }, [data]);

  if (error) return <div className="page"><PageHeader title="Tableau de bord" /><Alert tone="error" icon={AlertTriangle}>{error}</Alert></div>;
  if (!data) return <div className="page"><PageHeader title="Tableau de bord" /><Skeleton height={320} /></div>;

  const { rows, totals, months, monthlyTotals } = data;
  const alerts = rows.filter((r) => r.overspent || (r.projectedOverrun && r.projectedOverrun > 0));

  return (
    <div className="page" onMouseLeave={() => setTip(null)}>
      <PageHeader title="Tableau de bord décisionnel" description="Vue analytique du suivi budgétaire TPM — budget, planifié, réalisé, tendance et alertes, recalculés en direct." />

      <div className="biz-kpis">
        <Kpi icon={Wallet} label="Budget de suivi" value={fmtM(totals.budget)} suffix="Ar" foot={`${totals.contracts} contrat(s)`} tone="blue" />
        <Kpi icon={TrendingUp} label="Planifié" value={fmtM(totals.planned)} suffix="Ar" foot={`${Math.round((totals.plannedRate || 0) * 100)} % du budget`} tone="amber" />
        <Kpi icon={CheckCircle2} label="Réalisé (justifié)" value={fmtM(totals.actual)} suffix="Ar" foot={`${Math.round((totals.actualRate || 0) * 100)} % du budget`} tone="blue" />
        <Kpi icon={Wallet} label="Budget restant" value={fmtM(totals.remaining)} suffix="Ar" foot="Disponible" tone={totals.remaining < 0 ? 'red' : 'green'} />
        <Kpi icon={AlertTriangle} label="Alertes" value={formatInt(alerts.length)} foot="Dépassement / projection" tone={alerts.length ? 'red' : 'green'} />
        <Kpi icon={Users} label="Taux global" value={`${Math.round((totals.actualRate || 0) * 100)}`} suffix="%" foot="Consommation" tone="blue" />
      </div>

      <div className="biz-grid">
        <div className="card biz-card biz-span2">
          <div className="card-header"><div className="card-title">Budget · Planifié · Réalisé par contrat</div>
            <Legend items={[['Budget', C.budget], ['Planifié', C.planned], ['Réalisé', C.actual]]} /></div>
          <div className="card-body"><GroupedBars rows={rows} onTip={setTip} onOpen={onOpenContract} /></div>
        </div>

        <div className="card biz-card">
          <div className="card-header"><div className="card-title">Réalisé par prestataire</div></div>
          <div className="card-body biz-donut-wrap">
            {donutItems.length ? <Donut items={donutItems} onTip={setTip} /> : <p className="muted">Aucun réalisé.</p>}
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
          <div className="card-header"><div className="card-title">Tendance mensuelle</div>
            <Legend items={[['Planifié', C.planned], ['Réalisé', C.actual]]} /></div>
          <div className="card-body">
            {months.length ? <TrendLines months={months} monthly={monthlyTotals} onTip={setTip} /> : <p className="muted">Aucune donnée mensuelle.</p>}
          </div>
        </div>

        <div className="card biz-card">
          <div className="card-header"><div className="card-title">Consommation par contrat</div></div>
          <div className="card-body biz-gauges">
            {rows.map((r) => {
              const rate = Math.min(1.2, r.actualRate || 0);
              const col = r.overspent ? 'var(--red)' : rate >= 0.85 ? 'var(--orange)' : C.actual;
              return (
                <button type="button" key={r.contractId} className="biz-gauge" onClick={() => onOpenContract && onOpenContract(r.contractId)}>
                  <div className="biz-gauge-head"><span>{r.numero}</span><span className="tabular" style={{ color: col }}>{Math.round((r.actualRate || 0) * 100)} %</span></div>
                  <div className="biz-bar"><span style={{ width: `${Math.min(100, (r.actualRate || 0) * 100)}%`, background: col }} /></div>
                  <div className="biz-gauge-foot">{r.partnerName} · reste {formatAr(r.remaining)}</div>
                </button>
              );
            })}
          </div>
        </div>

        {field?.overall?.total > 0 && (
          <div className="card biz-card biz-span2">
            <div className="card-header"><div className="card-title">Couverture terrain — mois courant</div>
              <div className="card-sub">Visites réalisées / planifiées par district ({field.overall.realise}/{field.overall.active} · {Math.round((field.overall.rate || 0) * 100)} %).</div></div>
            <div className="card-body biz-gauges" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', display: 'grid', gap: 14 }}>
              {field.byDistrict.map((d) => {
                const col = d.rate >= 0.8 ? 'var(--green)' : d.rate >= 0.5 ? 'var(--blue-600)' : 'var(--orange)';
                return (
                  <div className="biz-gauge" key={d.key}>
                    <div className="biz-gauge-head"><span>{d.label}</span><span className="tabular" style={{ color: col }}>{d.realise}/{d.active} · {Math.round(d.rate * 100)} %</span></div>
                    <div className="biz-bar"><span style={{ width: `${Math.round(d.rate * 100)}%`, background: col }} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="card biz-card" style={{ marginTop: 16 }}>
          <div className="card-header"><div className="card-title">Alertes budgétaires</div>
            <div className="card-sub">Contrats en dépassement ou en projection de dépassement du budget de suivi.</div></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Contrat</th><th>Prestataire</th><th className="num">Réalisé</th><th className="num">Budget</th><th className="num">Projection fin</th><th>État</th></tr></thead>
            <tbody>{alerts.map((r) => (
              <tr key={r.contractId} onClick={() => onOpenContract && onOpenContract(r.contractId)} style={{ cursor: 'pointer' }}>
                <td><strong>{r.numero}</strong></td><td>{r.partnerName}</td>
                <td className="num tabular">{formatAr(r.actual)}</td>
                <td className="num tabular">{formatAr(r.budget)}</td>
                <td className="num tabular">{formatAr(r.projectedTotal)}</td>
                <td><span className="badge" style={{ background: 'var(--red-bg)', color: 'var(--red-text)' }}><span className="dot" style={{ background: 'var(--red)' }} />{r.overspent ? 'Dépassé' : 'Projection'}</span></td>
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
