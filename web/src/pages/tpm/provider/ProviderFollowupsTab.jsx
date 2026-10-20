import React, { useEffect, useMemo, useState } from 'react';
import { MapPin, ClipboardList } from 'lucide-react';
import { api } from '../../../api/client.js';
import { Alert, EmptyState, Skeleton } from '../../../components/ui.jsx';
import PeriodSelect from '../../../components/PeriodSelect.jsx';
import { formatInt, monthLabel } from '../../../lib/format.js';
import { PERIOD_CAPS } from '../../../lib/periodCaps.js';
import { pct } from '../../../lib/partners.js';
import { useI18n } from '../../../lib/i18n.jsx';

/**
 * Suivis effectués par le prestataire sur une période (12 derniers mois par défaut) :
 * visites de terrain par mois (prévues, réalisées, annulées, sites visités) et formulaires
 * reçus qui lui sont reliés (correspondances des formulaires), par mois et par fiche.
 */
export default function ProviderFollowupsTab({ providerId, onNavigate }) {
  const { tr } = useI18n();
  const [period, setPeriod] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    api.partnerFollowups(providerId, period).then((d) => { setData(d); setError(null); }).catch((e) => { setError(e.message); setData({}); });
  }, [providerId, period && period.from, period && period.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!data || !data.months) return [];
    const v = new Map((data.visits || []).map((x) => [x.month, x]));
    const s = new Map((data.submissions || []).map((x) => [x.month, x]));
    return data.months.map((m) => ({ month: m, ...(v.get(m) || { planned: 0, realised: 0, cancelled: 0, sites: 0 }), valid: (s.get(m) || {}).valid || 0 }))
      .filter((r) => r.planned || r.realised || r.cancelled || r.valid).reverse();
  }, [data]);
  const total = rows.reduce((a, r) => ({ planned: a.planned + r.planned, realised: a.realised + r.realised, cancelled: a.cancelled + r.cancelled, valid: a.valid + r.valid }),
    { planned: 0, realised: 0, cancelled: 0, valid: 0 });

  const current = period || (data && data.period) || null;
  return (
    <>
      <div className="data-toolbar">
        <div className="data-toolbar-left">
          <span className="cfilter-label">{tr('Période')}</span>
          {current && <PeriodSelect value={current} onChange={(p) => p && setPeriod(p)} maxSpan={PERIOD_CAPS.facts} countLabel="{n} formulaire(s) reçu(s) sur la période" ariaLabel={tr('Période des suivis')} />}
        </div>
      </div>
      {error && <div className="card-body"><Alert tone="error">{error}</Alert></div>}
      {!data ? <div className="card-body"><Skeleton height={140} /></div> : (
        <div className="card-body pv-stack">
          <section aria-labelledby="pv-visits">
            <h3 className="pv-panel-title" id="pv-visits"><MapPin size={16} aria-hidden="true" />{tr('Visites de terrain et formulaires reçus, par mois')}</h3>
            {rows.length === 0 ? <p className="muted">{tr('Aucune visite ni formulaire sur la période.')}</p> : (
              <div className="table-wrap"><table className="table grid">
                <thead><tr>
                  <th scope="col">{tr('Mois')}</th><th scope="col" className="num">{tr('Visites prévues')}</th><th scope="col" className="num">{tr('Réalisées')}</th>
                  <th scope="col" className="num">{tr('Annulées')}</th><th scope="col" className="num">{tr('Exécution du plan')}</th>
                  <th scope="col" className="num">{tr('Sites visités')}</th><th scope="col" className="num">{tr('Formulaires reçus')}</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const exec = pct(r.realised, r.planned + r.realised);
                    return (
                      <tr key={r.month}>
                        <td>{monthLabel(r.month)}</td>
                        <td className="num tabular">{r.planned + r.realised || <span className="cell-empty">0</span>}</td>
                        <td className="num tabular">{r.realised}</td>
                        <td className="num tabular">{r.cancelled || <span className="cell-empty">0</span>}</td>
                        <td className="num tabular">{exec == null ? <span className="cell-empty">{tr('— aucun plan')}</span> : tr('{p} %', { p: exec })}</td>
                        <td className="num tabular">{r.sites}</td>
                        <td className="num tabular">{formatInt(r.valid)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr>
                  <th scope="row">{tr('Total')}</th>
                  <td className="num tabular">{total.planned + total.realised}</td><td className="num tabular">{total.realised}</td>
                  <td className="num tabular">{total.cancelled}</td>
                  <td className="num tabular">{pct(total.realised, total.planned + total.realised) == null ? '—' : tr('{p} %', { p: pct(total.realised, total.planned + total.realised) })}</td>
                  <td /><td className="num tabular">{formatInt(total.valid)}</td>
                </tr></tfoot>
              </table></div>
            )}
            <p className="field-hint">{tr('Visites prévues = planifiées + réalisées (les annulées sont exclues) ; exécution du plan = réalisées ÷ prévues.')}</p>
          </section>

          <section aria-labelledby="pv-forms">
            <h3 className="pv-panel-title" id="pv-forms"><ClipboardList size={16} aria-hidden="true" />{tr('Formulaires reçus par fiche')}</h3>
            {(data.forms || []).length === 0 ? (
              <EmptyState icon={ClipboardList} title={tr('Aucun formulaire relié à ce partenaire')}>
                {tr('Un formulaire reçu est relié au partenaire par la colonne « partenaire » de la fiche (Données & indicateurs › Mapping MEMS › Correspondances).')}
              </EmptyState>
            ) : (
              <div className="table-wrap"><table className="table grid">
                <thead><tr>
                  <th scope="col">{tr('Fiche de suivi')}</th><th scope="col" className="num">{tr('Formulaires valides')}</th><th scope="col" className="num">{tr('Écartés')}</th>
                  <th scope="col" className="num">{tr('Agents reconnus')}</th><th scope="col" className="num">{tr('Sites')}</th><th scope="col">{tr('Période des données')}</th>
                </tr></thead>
                <tbody>
                  {data.forms.map((f) => (
                    <tr key={f.formId}>
                      <td><button type="button" className="inline-link pv-left" onClick={() => onNavigate('processus', 'donnees', f.formId)}>{f.label}</button><span className="pv-sub mono">{f.code}</span></td>
                      <td className="num tabular">{formatInt(f.valid)}</td>
                      <td className="num tabular">{f.excluded || <span className="cell-empty">0</span>}</td>
                      <td className="num tabular">{f.agents || <span className="cell-empty">0</span>}</td>
                      <td className="num tabular">{f.sites || <span className="cell-empty">0</span>}</td>
                      <td className="tabular">{f.firstMonth === f.lastMonth ? monthLabel(f.firstMonth) : `${monthLabel(f.firstMonth)} – ${monthLabel(f.lastMonth)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
