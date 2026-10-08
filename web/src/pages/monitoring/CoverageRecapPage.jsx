import React, { useEffect, useMemo, useState } from 'react';
import { MapPin, ShieldCheck, Repeat, Target, LayoutGrid, Boxes, Handshake, TrendingUp } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, PageHeader, Skeleton } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatInt } from '../../lib/format.js';

const RISK = {
  elevee: { label: 'Risque élevé', tone: 'red', color: 'var(--red)', bg: 'var(--red-bg)', text: 'var(--red-text)' },
  moyenne: { label: 'Risque moyen', tone: 'amber', color: 'var(--orange)', bg: 'var(--orange-bg)', text: 'var(--orange-text)' },
  faible: { label: 'Risque faible', tone: 'green', color: 'var(--green)', bg: 'var(--green-bg)', text: 'var(--green-text)' },
};
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
const compTone = (x) => (x >= 0.8 ? 'green' : x >= 0.5 ? 'amber' : 'red');

// Palette catégorielle validée (dataviz) — identité par couleur + libellé.
const CAT = ['#0f6cbd', '#7c3aed', '#0f7b40', '#c77700', '#d13438', '#0891b2', '#be185d', '#4d7c0f', '#6d28d9', '#b45309'];
const MO = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const moShort = (m) => MO[Number(String(m).split('-')[1]) - 1] || m;

const TABS = [
  { id: 'mmr', label: 'Par site (MMR)', icon: LayoutGrid },
  { id: 'program', label: 'Programme', icon: Boxes },
  { id: 'partner', label: 'Partenaire / TPM', icon: Handshake },
];

/**
 * Couverture du suivi — trois lectures d'une même réalité (sites + visites) :
 *  • Par site (MMR) : sites visités 1/2/3/4+ fois vs exigences minimales ;
 *  • Programme : taux de couverture mensuel par activité (tendance + matrice) ;
 *  • Partenaire / TPM : idem par prestataire.
 * Tout est recalculé en direct ; aucune donnée stockée.
 */
export default function CoverageRecapPage() {
  const [tab, setTab] = useState('mmr');
  return (
    <div className="section-gap">
      <PageHeader title="Couverture du suivi" description="Combien de sites sont couverts, par niveau de risque (MMR), par programme et par prestataire. Recalculé en direct depuis les sites et les visites." />
      <div className="seg" role="tablist" aria-label="Vue de couverture">
        {TABS.map((x) => { const Icon = x.icon; return (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'is-active' : ''} onClick={() => setTab(x.id)}>
            <Icon size={15} aria-hidden="true" /> {x.label}
          </button>
        ); })}
      </div>
      {tab === 'mmr' && <SiteMmrTab />}
      {tab === 'program' && <CoverageMatrixView by="activity" groupHead="Programme" />}
      {tab === 'partner' && <CoverageMatrixView by="provider" groupHead="Prestataire TPM" />}
    </div>
  );
}

// ---- Par site (MMR) : récap existant --------------------------------------
function SiteMmrTab() {
  const toast = useToast();
  const [district, setDistrict] = useState('');
  const [months, setMonths] = useState(12);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    api.fieldCoverageRecap({ district, operationMonths: months })
      .then(setData).catch((e) => { setError(e.message); toast.error(e.message); });
    /* eslint-disable-next-line */
  }, [district, months]);

  const districts = useMemo(() => data?.districts || [], [data]);
  const groups = data?.groups || [];
  const total = data?.total;

  return (
    <>
      <div className="comet-filters">
        <div className="field"><span className="field-label">District</span>
          <select className="select" value={district} onChange={(e) => setDistrict(e.target.value)} aria-label="District">
            <option value="">Tous les districts</option>
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="field"><span className="field-label">Durée d'opération</span>
          <select className="select" value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Durée d'opération">
            {[3, 6, 9, 12].map((m) => <option key={m} value={m}>{m} mois</option>)}
          </select>
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {data === null ? <Skeleton height={320} /> : (
        <>
          <div className="biz-kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
            <Kpi icon={MapPin} tone="blue" label="Sites actifs" value={formatInt(total.active)} foot={`${district || 'tous districts'}`} />
            <Kpi icon={Repeat} tone="blue" label="Visités au moins une fois" value={formatInt(total.visitedToDate)} foot={pct(total.coverageRate)} />
            <Kpi icon={Target} tone="amber" label="Jamais visités" value={formatInt(total.notVisited)} foot="à planifier" />
            <Kpi icon={ShieldCheck} tone={compTone(total.compliance)} label="Conformité MMR" value={pct(total.compliance)} foot="sites au nombre de visites requis" />
          </div>
          <div className="card biz-card">
            <div className="table-wrap"><table className="table">
              <thead><tr>
                <th>Niveau de risque</th>
                <th className="num">Visites requises</th>
                <th className="num">Sites actifs</th>
                <th className="num">Jamais visités</th>
                <th className="num">1 fois</th><th className="num">2 fois</th><th className="num">3 fois</th><th className="num">4 fois +</th>
                <th className="num">Couverture</th><th className="num">Conformité MMR</th>
              </tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.riskLevel}>
                    <td><span className="badge" style={{ background: RISK[g.riskLevel]?.bg, color: RISK[g.riskLevel]?.text }}><span className="dot" style={{ background: RISK[g.riskLevel]?.color }} />{RISK[g.riskLevel]?.label}</span></td>
                    <td className="num tabular"><strong>{g.required}</strong></td>
                    <td className="num tabular">{formatInt(g.active)}</td>
                    <td className="num tabular">{g.notVisited ? <span style={{ color: 'var(--red)' }}>{formatInt(g.notVisited)}</span> : '—'}</td>
                    <td className="num tabular">{formatInt(g.once)}</td>
                    <td className="num tabular">{formatInt(g.twice)}</td>
                    <td className="num tabular">{formatInt(g.thrice)}</td>
                    <td className="num tabular">{formatInt(g.fourPlus)}</td>
                    <td className="num tabular">{pct(g.coverageRate)}</td>
                    <td className="num"><span className="badge" style={{ background: `var(--${compTone(g.compliance)}-bg)`, color: `var(--${compTone(g.compliance)}-text)` }}>{pct(g.compliance)}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td><strong>Total</strong></td>
                <td className="num" />
                <td className="num tabular"><strong>{formatInt(total.active)}</strong></td>
                <td className="num tabular"><strong>{formatInt(total.notVisited)}</strong></td>
                <td className="num tabular"><strong>{formatInt(total.once)}</strong></td>
                <td className="num tabular"><strong>{formatInt(total.twice)}</strong></td>
                <td className="num tabular"><strong>{formatInt(total.thrice)}</strong></td>
                <td className="num tabular"><strong>{formatInt(total.fourPlus)}</strong></td>
                <td className="num tabular"><strong>{pct(total.coverageRate)}</strong></td>
                <td className="num"><strong>{pct(total.compliance)}</strong></td>
              </tr></tfoot>
            </table></div>
          </div>
          <div className="note"><Target size={18} aria-hidden="true" /><span>Visites requises = durée d'opération ÷ intervalle MMR (élevé&nbsp;: 1 mois · moyen&nbsp;: 2 · faible&nbsp;: 3). Un site est conforme s'il a atteint ce nombre de visites réalisées. Couverture = part des sites visités au moins une fois.</span></div>
        </>
      )}
    </>
  );
}

// ---- Programme / Partenaire : tendance mensuelle + matrice ----------------
function CoverageMatrixView({ by, groupHead }) {
  const toast = useToast();
  const [year, setYear] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.fieldCoverageMatrix(year || undefined)
      .then((d) => { setData(d); if (year == null) setYear(d.year); })
      .catch((e) => toast.error(e.message));
    /* eslint-disable-next-line */
  }, [year]);

  const matrix = data ? (by === 'activity' ? data.byActivity : data.byProvider) : null;
  const years = data?.years?.length ? data.years : (data ? [data.year] : []);
  // Couleur stable par groupe (index dans la liste triée).
  const colorOf = (i) => CAT[i % CAT.length];

  return (
    <>
      <div className="comet-filters">
        <div className="field"><span className="field-label">Année</span>
          <select className="select" value={year || ''} onChange={(e) => setYear(Number(e.target.value))} aria-label="Année">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {matrix === null ? <Skeleton height={340} /> : matrix.groups.length === 0 ? (
        <div className="card biz-card"><div className="card-body"><div className="empty"><TrendingUp size={28} aria-hidden="true" /><p>Aucune visite en {year}. Planifiez des visites (Affectation &amp; visites) pour alimenter la couverture.</p></div></div></div>
      ) : (
        <>
          <div className="biz-kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
            <Kpi icon={Boxes} tone="blue" label={by === 'activity' ? 'Programmes suivis' : 'Prestataires'} value={matrix.groups.length} foot={`année ${year}`} />
            <Kpi icon={Repeat} tone="blue" label="Visites réalisées" value={formatInt(matrix.total.realise)} foot={`sur ${formatInt(matrix.total.active)} actives`} />
            <Kpi icon={Target} tone="amber" label="Planifiées restantes" value={formatInt(matrix.total.planifie)} foot="non encore réalisées" />
            <Kpi icon={ShieldCheck} tone={matrix.total.rate == null ? 'blue' : compTone(matrix.total.rate)} label="Taux de couverture" value={pct(matrix.total.rate)} foot="réalisées / actives" />
          </div>

          <div className="card biz-card">
            <div className="card-header">
              <div><div className="card-title"><TrendingUp size={16} aria-hidden="true" /> Tendance mensuelle du taux de couverture</div>
                <div className="card-sub">Part des visites réalisées (vs planifiées + réalisées), par {by === 'activity' ? 'programme' : 'prestataire'}, mois par mois.</div></div>
            </div>
            <div className="card-body">
              <CovTrend matrix={matrix} colorOf={colorOf} />
              <div className="cov-legend">
                {matrix.groups.map((g, i) => (
                  <span key={g.key} className="cov-leg"><span className="cov-dot" style={{ background: colorOf(i) }} />{g.label}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="card biz-card">
            <div className="card-header"><div><div className="card-title"><LayoutGrid size={16} aria-hidden="true" /> Matrice de couverture mensuelle</div>
              <div className="card-sub">Taux par {by === 'activity' ? 'programme' : 'prestataire'} et par mois (réalisées / actives). « — » = aucune visite.</div></div></div>
            <div className="table-wrap">
              <table className="table cov-matrix">
                <thead><tr>
                  <th>{groupHead}</th>
                  {matrix.months.map((m) => <th key={m} className="num">{moShort(m)}</th>)}
                  <th className="num">Total</th>
                </tr></thead>
                <tbody>
                  {matrix.groups.map((g, i) => (
                    <tr key={g.key}>
                      <td><span className="cov-dot" style={{ background: colorOf(i) }} /><strong>{g.label}</strong></td>
                      {g.cells.map((c) => <td key={c.month} className="num"><CovCell cell={c} /></td>)}
                      <td className="num"><CovCell cell={g.total} strong /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td><strong>Tous</strong></td>
                  {matrix.monthlyTotals.map((c) => <td key={c.month} className="num"><CovCell cell={c} strong /></td>)}
                  <td className="num"><CovCell cell={matrix.total} strong /></td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function CovCell({ cell, strong }) {
  if (!cell || cell.rate == null) return <span className="cell-empty">—</span>;
  const tone = compTone(cell.rate);
  return (
    <span className="cov-cell tabular" title={`${cell.realise} réalisée(s) / ${cell.active} active(s)`}
      style={{ background: `var(--${tone}-bg)`, color: `var(--${tone}-text)`, fontWeight: strong ? 700 : 600 }}>
      {Math.round(cell.rate * 100)}%
    </span>
  );
}

function CovTrend({ matrix, colorOf }) {
  const W = 820; const H = 240; const padL = 32; const padR = 14; const padT = 12; const padB = 26;
  const plotW = W - padL - padR; const plotH = H - padT - padB;
  const x = (i) => padL + (plotW * i) / 11;
  const y = (v) => padT + plotH * (1 - v / 100);
  const grid = [0, 25, 50, 75, 100];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cov-svg" role="img" aria-label="Tendance mensuelle du taux de couverture">
      {grid.map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
          <text x={padL - 6} y={y(v) + 3} textAnchor="end" className="cov-axis">{v}</text>
        </g>
      ))}
      {matrix.months.map((m, i) => (
        <text key={m} x={x(i)} y={H - 8} textAnchor="middle" className="cov-axis">{moShort(m).replace('.', '')}</text>
      ))}
      {matrix.groups.map((g, gi) => {
        const col = colorOf(gi);
        // Segments : on relie les points consécutifs non nuls, on coupe sur null.
        const segs = []; let cur = [];
        g.cells.forEach((c, i) => {
          if (c.rate == null) { if (cur.length) segs.push(cur); cur = []; }
          else cur.push([x(i), y(c.rate * 100)]);
        });
        if (cur.length) segs.push(cur);
        return (
          <g key={g.key}>
            {segs.map((pts, si) => (
              <polyline key={si} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                points={pts.map((p) => p.join(',')).join(' ')} />
            ))}
            {g.cells.map((c, i) => (c.rate == null ? null : (
              <circle key={i} cx={x(i)} cy={y(c.rate * 100)} r="2.6" fill={col}>
                <title>{`${g.label} · ${moShort(c.month)} : ${Math.round(c.rate * 100)} % (${c.realise}/${c.active})`}</title>
              </circle>
            )))}
          </g>
        );
      })}
    </svg>
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
