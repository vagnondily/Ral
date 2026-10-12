import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, AlertOctagon, Info, CheckCircle2, ChevronRight } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, PageHeader, Skeleton } from '../../components/ui.jsx';
import { formatAr } from '../../lib/format.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Centre d'alertes — la vue « ce qui demande mon attention » du responsable
 * S&E. Agrège en direct, sans stockage : dépassements/​projections budgétaires
 * (consolidation), rapports à valider, avenants en validation, contrats
 * arrivant à échéance et faible couverture terrain du mois. Chaque alerte est
 * cliquable vers le module concerné.
 */
const SEV = {
  critical: { rank: 0, label: 'Critique', color: 'var(--red)', bg: 'var(--red-bg)', text: 'var(--red-text)', icon: AlertOctagon },
  warning: { rank: 1, label: 'À surveiller', color: 'var(--orange)', bg: 'var(--orange-bg)', text: 'var(--orange-text)', icon: AlertTriangle },
  info: { rank: 2, label: 'À traiter', color: 'var(--blue-600)', bg: 'var(--blue-50)', text: 'var(--blue-700)', icon: Info },
};
const daysUntil = (iso) => Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
const monthNow = () => new Date().toISOString().slice(0, 7);

export default function AlertsPage({ onNavigate, onOpenContract }) {
  const { tr } = useI18n();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      api.consolidation(), api.listContracts(), api.listReports({}), api.fieldSummary(monthNow()),
    ]).then(([cons, contracts, reports, field]) => {
      if (!alive) return;
      setState({
        loading: false,
        cons: cons.status === 'fulfilled' ? cons.value : null,
        contracts: contracts.status === 'fulfilled' ? contracts.value : [],
        reports: reports.status === 'fulfilled' ? (reports.value.items || reports.value) : [],
        field: field.status === 'fulfilled' ? field.value : null,
      });
    });
    return () => { alive = false; };
  }, []);

  const alerts = useMemo(() => {
    if (state.loading) return [];
    const out = [];
    // Budget: dépassements & projections
    for (const r of state.cons?.rows || []) {
      if (r.overspent) out.push({ sev: 'critical', cat: 'Budget', title: tr('Budget de suivi dépassé — {numero}', { numero: r.numero }), detail: tr('{partner} · réalisé {actual} / budget {budget}', { partner: r.partnerName, actual: formatAr(r.actual), budget: formatAr(r.budget) }), go: () => onOpenContract(r.contractId) });
      // Factures soumises non encore validées qui, une fois validées, feraient dépasser le budget.
      else if (r.pendingValidation > 0 && r.budget != null && r.actual + r.pendingValidation > r.budget) out.push({ sev: 'warning', cat: 'Budget', title: tr('Dépassement si validation — {numero}', { numero: r.numero }), detail: tr('{partner} · réalisé {actual} + en attente {pending} > budget {budget}', { partner: r.partnerName, actual: formatAr(r.actual), pending: formatAr(r.pendingValidation), budget: formatAr(r.budget) }), go: () => onOpenContract(r.contractId) });
      else if (r.projectedOverrun > 0) out.push({ sev: 'warning', cat: 'Budget', title: tr('Projection de dépassement — {numero}', { numero: r.numero }), detail: tr('{partner} · projection fin {projected} > budget {budget}', { partner: r.partnerName, projected: formatAr(r.projectedTotal), budget: formatAr(r.budget) }), go: () => onOpenContract(r.contractId) });
    }
    // Rapports à valider
    const pending = (state.reports || []).filter((x) => x.status === 'soumis');
    for (const r of pending) out.push({ sev: 'info', cat: 'Rapports', title: r.kind === 'technique' ? tr('Rapport technique à valider') : tr('Rapport financier à valider'), detail: `${r.partnerName || r.contractPartner} · ${r.contractNumero} · ${String(r.periodMonth).slice(0, 7)}`, go: () => onNavigate('tpm', 'rapports') });
    // Contrats : avenants en validation & échéances
    for (const c of state.contracts || []) {
      if (c.amendmentPending) out.push({ sev: 'info', cat: 'Contrats', title: tr('Avenant en validation — {numero}', { numero: c.numero }), detail: c.partnerName, go: () => onOpenContract(c.id) });
      if (c.status === 'en_validation') out.push({ sev: 'info', cat: 'Contrats', title: tr('Contrat en validation — {numero}', { numero: c.numero }), detail: c.partnerName, go: () => onOpenContract(c.id) });
      if (c.status === 'actif' && c.dateFin) {
        const d = daysUntil(c.dateFin);
        if (d < 0) out.push({ sev: 'warning', cat: 'Contrats', title: tr('Contrat expiré — {numero}', { numero: c.numero }), detail: tr('{partner} · fin le {date}', { partner: c.partnerName, date: c.dateFin }), go: () => onOpenContract(c.id) });
        else if (d <= 90) out.push({ sev: 'warning', cat: 'Contrats', title: tr('Échéance proche — {numero}', { numero: c.numero }), detail: tr('{partner} · fin dans {d} j (renouvellement possible)', { partner: c.partnerName, d }), go: () => onOpenContract(c.id) });
      }
    }
    // Couverture terrain faible (mois courant)
    const ov = state.field?.overall;
    if (ov && ov.active > 0 && ov.rate < 0.5) out.push({ sev: 'warning', cat: 'Terrain', title: tr('Couverture terrain faible ce mois'), detail: tr('{done}/{active} visites réalisées ({p} %)', { done: ov.realise, active: ov.active, p: Math.round(ov.rate * 100) }), go: () => onNavigate('processus', 'sites') });
    for (const p of state.field?.byProvider || []) {
      if (p.key !== 'non_affecte' && p.active >= 3 && p.rate < 0.4) out.push({ sev: 'info', cat: 'Terrain', title: tr('Retard de visites — {provider}', { provider: p.label }), detail: tr('{done}/{active} réalisées ({p} %)', { done: p.realise, active: p.active, p: Math.round(p.rate * 100) }), go: () => onNavigate('processus', 'sites') });
    }
    const naf = (state.field?.byProvider || []).find((p) => p.key === 'non_affecte');
    if (naf && naf.total > 0) out.push({ sev: 'info', cat: 'Terrain', title: tr('{n} visite(s) non affectée(s)', { n: naf.total }), detail: tr('Sites planifiés sans prestataire TPM ce mois'), go: () => onNavigate('processus', 'sites') });

    return out.sort((a, b) => SEV[a.sev].rank - SEV[b.sev].rank);
  }, [state, onNavigate, onOpenContract, tr]);

  if (state.loading) return <div className="page"><PageHeader title={tr('Centre d\'alertes')} /><Skeleton height={320} /></div>;

  const counts = { critical: 0, warning: 0, info: 0 };
  for (const a of alerts) counts[a.sev] += 1;

  return (
    <div className="page">
      <PageHeader title={tr('Centre d\'alertes')} description={tr('Tout ce qui demande votre attention, recalculé en direct : budget, rapports à valider, contrats et couverture terrain.')} />

      <div className="biz-kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        {['critical', 'warning', 'info'].map((s) => {
          const S = SEV[s]; const Icon = S.icon;
          return (
            <div className="biz-kpi" key={s}>
              <div className="biz-kpi-ic" style={{ background: S.bg, color: S.text }}><Icon size={18} aria-hidden="true" /></div>
              <div className="biz-kpi-body"><div className="biz-kpi-label">{tr(S.label)}</div><div className="biz-kpi-value tabular">{counts[s]}</div></div>
            </div>
          );
        })}
      </div>

      {alerts.length === 0 ? (
        <Alert tone="success" icon={CheckCircle2}>{tr('Aucune alerte : budget, rapports, contrats et couverture terrain sont au vert.')}</Alert>
      ) : (
        <div className="card biz-card">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{tr('Niveau')}</th><th>{tr('Catégorie')}</th><th>{tr('Alerte')}</th><th>{tr('Détail')}</th><th aria-label={tr('Ouvrir')} /></tr></thead>
            <tbody>
              {alerts.map((a, i) => {
                const S = SEV[a.sev]; const Icon = S.icon;
                return (
                  <tr key={i} onClick={a.go} style={{ cursor: 'pointer' }}>
                    <td><span className="badge" style={{ background: S.bg, color: S.text }}><Icon size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -2 }} />{tr(S.label)}</span></td>
                    <td>{tr(a.cat)}</td>
                    <td><strong>{a.title}</strong></td>
                    <td className="muted">{a.detail}</td>
                    <td style={{ textAlign: 'right' }}><ChevronRight size={16} aria-hidden="true" className="muted" /></td>
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
