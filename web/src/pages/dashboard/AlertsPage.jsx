import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, AlertCircle, Clock } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, PageHeader, Skeleton } from '../../components/ui.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import { SessionPeriodNote, usePeriod } from '../../components/PeriodBanner.jsx';
import { samePeriod, single } from '../../lib/period.js';
import SeverityBadge, { SEV_ICON } from '../../components/SeverityBadge.jsx';
import { SEVERITY, alertText, alertsState, goArgs, sourceList } from '../../lib/alerts.js';
import { useI18n } from '../../lib/i18n.jsx';
import { PERIOD_CAPS } from '../../lib/periodCaps.js';

/**
 * Centre d'alertes — la vue « ce qui demande mon attention » du responsable
 * S&E. Les règles sont calculées UNE fois côté serveur (GET /api/alerts,
 * dashboards/alertsMath.js) : cette page et la cloche de l'en-tête affichent
 * la même liste. Dépassements/projections budgétaires (consolidation),
 * rapports à valider, avenants et contrats en validation, contrats arrivant à
 * échéance et faible couverture terrain du mois. Chaque alerte ouvre le module concerné.
 * Jamais « tout est au vert » quand une source n'a pas pu être lue (alertsState).
 * Sur téléphone, le tableau passe en cartes empilées (styles.css, .alerts-table).
 *
 * Période (lot 1b) : le mois courant par défaut — exactement la liste de la cloche (aucun
 * paramètre envoyé). Une autre période (URL seulement, jamais la période de session) vaut
 * pour le terrain (visites de la période) et les rapports à valider (période chevauchante) ;
 * les alertes budgétaires et d'échéance restent calculées à date, et chaque ligne le dit.
 */
const ALERTS_MAX_SPAN = PERIOD_CAPS.facts; // comme GET /api/alerts (lib/periodCaps, la table du serveur)

export default function AlertsPage({ onNavigate }) {
  const { tr } = useI18n();
  const { period, ready, today, source, capped, setPeriod, resetToDefault } = usePeriod({ scope: 'local', defaultRule: 'current', maxSpan: ALERTS_MAX_SPAN });
  const isBell = !period || samePeriod(period, single(today));
  const key = period ? `${period.from}|${period.to}` : '';
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    setState({ loading: true });
    // Mois courant : la requête de la cloche, sans paramètre (mêmes alertes, mêmes compteurs).
    api.alerts(isBell ? undefined : period).then((data) => {
      if (!alive) return;
      setState({ loading: false, data });
      try { if (typeof performance !== 'undefined' && performance.mark) performance.mark('period:rendered'); } catch { /* sans incidence */ }
    }, (e) => alive && setState({ loading: false, error: e.message }));
    return () => { alive = false; };
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <PageHeader title={tr('Centre d\'alertes')} description={tr('Tout ce qui demande votre attention, recalculé en direct : budget, rapports à valider, contrats et couverture terrain.')}>
      {ready && (
        <span className="alerts-period">
          <span className="alerts-period-label">{tr('Période (terrain et rapports)')}</span>
          <PeriodSelect value={period} onChange={setPeriod} today={today} maxSpan={ALERTS_MAX_SPAN} align="right" ariaLabel={tr('Période (terrain et rapports)')} />
        </span>
      )}
    </PageHeader>
  );
  const note = (
    <>
      <SessionPeriodNote source={source} capped={capped} onReset={resetToDefault} />
      <p className="period-session-note">
        <Clock size={14} aria-hidden="true" />
        <span>{tr('Les alertes budgétaires et d\'échéance sont calculées à date.')}</span>
      </p>
    </>
  );

  if (state.loading) return <div className="page">{header}{note}<Skeleton height={320} /></div>;

  const items = state.data?.items || [];
  const counts = state.data?.counts || { critical: 0, warning: 0, info: 0 };
  const { status, unavailable } = alertsState(state.data);
  const open = (a) => { const args = goArgs(a.go); if (args && onNavigate) onNavigate(...args); };

  return (
    <div className="page">
      {header}
      {note}

      {state.error && <Alert tone="error" icon={AlertCircle}>{state.error}</Alert>}
      {status === 'alerts' && unavailable.length > 0 && (
        <Alert tone="warning" icon={AlertTriangle}>
          {tr('Certaines sources n\'ont pas pu être lues : {list}. Les autres alertes restent à jour.', { list: sourceList(tr, unavailable) })}
        </Alert>
      )}

      <div className="biz-kpis alerts-kpis">
        {['critical', 'warning', 'info'].map((s) => {
          const Icon = SEV_ICON[s];
          return (
            <div className="biz-kpi" key={s}>
              <div className={`biz-kpi-ic sev-${s}`}><Icon size={18} aria-hidden="true" /></div>
              <div className="biz-kpi-body"><div className="biz-kpi-label">{tr(SEVERITY[s].label)}</div><div className="biz-kpi-value tabular">{counts[s]}</div></div>
            </div>
          );
        })}
      </div>

      {!state.error && status === 'clear' && (
        <Alert tone="success" icon={CheckCircle2}>{tr('Aucune alerte : budget, rapports, contrats et couverture terrain sont au vert.')}</Alert>
      )}
      {!state.error && status === 'partial' && (
        <Alert tone="warning" icon={AlertTriangle}>
          {tr('Aucune alerte dans les sources lues, mais ces sources n\'ont pas pu être lues : {list}. Impossible de dire que tout est au vert ; réessayez plus tard.', { list: sourceList(tr, unavailable) })}
        </Alert>
      )}
      {items.length > 0 && (
        <div className="card biz-card">
          {/* Rôles explicites : la sémantique de tableau reste lue même quand le téléphone empile les cellules. */}
          <div className="table-wrap"><table className="table alerts-table" role="table">
            <thead><tr role="row">
              <th role="columnheader" className="al-sev">{tr('Niveau')}</th><th role="columnheader" className="al-cat">{tr('Catégorie')}</th>
              <th role="columnheader" className="al-title">{tr('Alerte')}</th><th role="columnheader" className="al-detail">{tr('Détail')}</th>
              <th role="columnheader" className="al-go" aria-label={tr('Ouvrir')} />
            </tr></thead>
            <tbody>
              {items.map((a, i) => {
                const { title, detail } = alertText(tr, a);
                return (
                  <tr role="row" key={`${a.kind}-${i}`} onClick={() => open(a)} style={{ cursor: 'pointer' }}>
                    <td role="cell" className="al-sev"><SeverityBadge sev={a.sev} /></td>
                    <td role="cell" className="al-cat">{tr(a.cat)}{!isBell && a.scope === 'a_date' && <span className="muted"> · {tr('à date')}</span>}</td>
                    <td role="cell" className="al-title"><strong>{title}</strong></td>
                    <td role="cell" className="al-detail muted">{detail}</td>
                    <td role="cell" className="al-go">
                      <button type="button" className="icon-link" aria-label={tr('Ouvrir')} onClick={(e) => { e.stopPropagation(); open(a); }}>
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
