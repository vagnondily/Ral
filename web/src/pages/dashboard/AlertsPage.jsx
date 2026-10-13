import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, AlertCircle } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, PageHeader, Skeleton } from '../../components/ui.jsx';
import SeverityBadge, { SEV_ICON } from '../../components/SeverityBadge.jsx';
import { SEVERITY, alertText, alertsState, goArgs, sourceList } from '../../lib/alerts.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Centre d'alertes — la vue « ce qui demande mon attention » du responsable
 * S&E. Les règles sont calculées UNE fois côté serveur (GET /api/alerts,
 * dashboards/alertsMath.js) : cette page et la cloche de l'en-tête affichent
 * la même liste. Dépassements/projections budgétaires (consolidation),
 * rapports à valider, avenants et contrats en validation, contrats arrivant à
 * échéance et faible couverture terrain du mois. Chaque alerte ouvre le module concerné.
 * Jamais « tout est au vert » quand une source n'a pas pu être lue (alertsState).
 * Sur téléphone, le tableau passe en cartes empilées (styles.css, .alerts-table).
 */
export default function AlertsPage({ onNavigate }) {
  const { tr } = useI18n();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    api.alerts().then((data) => alive && setState({ loading: false, data }), (e) => alive && setState({ loading: false, error: e.message }));
    return () => { alive = false; };
  }, []);

  if (state.loading) return <div className="page"><PageHeader title={tr('Centre d\'alertes')} /><Skeleton height={320} /></div>;

  const items = state.data?.items || [];
  const counts = state.data?.counts || { critical: 0, warning: 0, info: 0 };
  const { status, unavailable } = alertsState(state.data);
  const open = (a) => { const args = goArgs(a.go); if (args && onNavigate) onNavigate(...args); };

  return (
    <div className="page">
      <PageHeader title={tr('Centre d\'alertes')} description={tr('Tout ce qui demande votre attention, recalculé en direct : budget, rapports à valider, contrats et couverture terrain.')} />

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
                    <td role="cell" className="al-cat">{tr(a.cat)}</td>
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
