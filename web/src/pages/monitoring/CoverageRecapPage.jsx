import React, { useEffect, useMemo, useState } from 'react';
import { MapPin, ShieldCheck, Repeat, Target } from 'lucide-react';
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

/**
 * Récap de couverture (feuille « Site Coverage Recap » du Plan de suivi) : par
 * niveau de risque, sites actifs, visités 1/2/3/4+ fois, couverture (≥1 visite)
 * et conformité MMR (sites ayant atteint le nombre de visites requis sur la
 * durée d'opération). Recalculé en direct depuis les sites + visites réalisées.
 */
export default function CoverageRecapPage() {
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
    <div className="page">
      <PageHeader title="Récap de couverture des sites" description="Combien de sites ont été visités (1, 2, 3, 4 fois ou plus) par rapport aux exigences minimales de suivi (MMR). Recalculé en direct depuis les sites et les visites réalisées.">
        <select className="select" value={district} onChange={(e) => setDistrict(e.target.value)} aria-label="District">
          <option value="">Tous les districts</option>
          {districts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="select" value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Durée d'opération">
          {[3, 6, 9, 12].map((m) => <option key={m} value={m}>Durée {m} mois</option>)}
        </select>
      </PageHeader>

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
