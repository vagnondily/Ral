import React, { useEffect, useMemo, useState } from 'react';
import { FileText, ExternalLink } from 'lucide-react';
import { api } from '../../../api/client.js';
import { Alert, Badge, Button, EmptyState, Skeleton, StatusBadge } from '../../../components/ui.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { REPORT_KIND } from '../../../lib/contracts.js';
import { autoNotApplicableWhy, reportStatusDef } from '../../../lib/reportExpectation.js';
import { formatAr, monthLabel } from '../../../lib/format.js';
import { ROLE_LABELS, contractNo } from '../../../lib/roles.js';
import { useI18n } from '../../../lib/i18n.jsx';
import FactureDrawer from '../FactureDrawer.jsx';

const PLAN_STATUS = { brouillon: { label: 'Brouillon', tone: 'yellow', icon: 'draft' }, valide: { label: 'Validé', tone: 'green', icon: 'check' } };

/**
 * Plans, factures et rapports d'un partenaire (retours 28.1 et 113) : ceux qu'il établit comme TPM et
 * ceux des contrats dont il est titulaire (établis par leur TPM). Chaque facture ou rapport OUVRE le
 * vrai document dans le même tiroir que « Rapports & dépenses » ; un plan renvoie à
 * « Planification & budget ». Contrat = n° FLA · titulaire, partout.
 */
export default function ProviderReportsTab({ providerId, role, onNavigate, onChanged }) {
  const { tr } = useI18n();
  const toast = useToast();
  const isTpm = role === 'tpm';
  const [rows, setRows] = useState(null);
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState(null);
  const [context, setContext] = useState(null);
  const [open, setOpen] = useState(null);
  const [kind, setKind] = useState('');

  const load = () => Promise.all([api.partnerReports(providerId), api.partnerPlans(providerId)])
    .then(([r, p]) => { setRows(r); setPlans(p); })
    .catch((e) => { setError(e.message); setRows([]); setPlans([]); });
  useEffect(() => { load(); }, [providerId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openReport(r) {
    try {
      const ctx = context || await api.reportsContext();
      setContext(ctx);
      setOpen(r);
    } catch (e) { toast.error(e.message); }
  }

  const shown = useMemo(() => (rows || []).filter((r) => !kind || r.kind === kind), [rows, kind]);
  if (rows === null) return <div className="card-body"><Skeleton height={120} /></div>;
  if (error) return <div className="card-body"><Alert tone="error">{error}</Alert></div>;
  const contractCell = (r) => (
    <><span className="mono pv-nowrap">{contractNo(r)}</span>{r.holderName && <span className="pv-sub">{r.holderName}</span>}</>
  );

  return (
    <>
      <div className="data-toolbar">
        <div className="data-toolbar-left">
          <div className="segmented" role="group" aria-label={tr('Type de document')}>
            {[['', 'Tous les rapports'], ['financier', 'Factures (financier)'], ['technique', 'Rapports techniques'], ['plan', 'Plans de collecte']].map(([k, label]) => (
              <button key={k || 'all'} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {tr(label)}{k === 'plan' && plans && plans.length > 0 && <span className="count"> {plans.length}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="data-toolbar-right">
          {kind === 'plan'
            ? <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => onNavigate('tpm', 'budget')}>{tr('Ouvrir Planification & budget')}</Button>
            : <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => onNavigate('tpm', 'rapports')}>{tr('Ouvrir Rapports & dépenses')}</Button>}
        </div>
      </div>
      {kind === 'plan' ? (
        !plans || plans.length === 0 ? (
          <EmptyState icon={FileText} title={tr('Aucun plan de collecte')}>{tr('Les plans de collecte (budget prévisionnel du suivi) apparaîtront ici dès leur enregistrement.')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table grid">
              <thead><tr>
                <th scope="col">{tr('Mois')}</th><th scope="col">{tr('Contrat')}</th>{!isTpm && <th scope="col">{tr(ROLE_LABELS.tpm)}</th>}
                <th scope="col">{tr('Intitulé')}</th><th scope="col" className="num">{tr('Planifié (bailleur)')}</th><th scope="col">{tr('Statut')}</th>
              </tr></thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td className="tabular">{monthLabel(p.month)}</td>
                    <td>{contractCell(p)}</td>
                    {!isTpm && <td>{p.tpmName || <span className="cell-empty">—</span>}</td>}
                    <td>{p.title || <span className="cell-empty">—</span>}</td>
                    <td className="num tabular">{formatAr(p.plannedFunder || 0)}</td>
                    <td><StatusBadge map={PLAN_STATUS} value={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : shown.length === 0 ? (
        <EmptyState icon={FileText} title={tr('Aucun rapport')}>{tr(isTpm ? 'Les factures et rapports techniques de ce TPM apparaîtront ici dès leur enregistrement.' : 'Les factures et rapports techniques des TPM sur les contrats de ce partenaire apparaîtront ici.')}</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table grid">
            <thead><tr>
              <th scope="col">{tr('Mois')}</th><th scope="col">{tr('Type')}</th><th scope="col">{tr('Contrat')}</th>
              {!isTpm && <th scope="col">{tr(ROLE_LABELS.tpm)}</th>}
              <th scope="col">{tr('N° facture')}</th><th scope="col" className="num">{tr('Réalisé (bailleur)')}</th>
              <th scope="col">{tr('Statut')}</th><th scope="col" />
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="clickable" onDoubleClick={() => openReport(r)}>
                  <td className="tabular">{monthLabel(r.month)}</td>
                  <td><Badge tone={REPORT_KIND[r.kind].tone}>{tr(REPORT_KIND[r.kind].label)}</Badge></td>
                  <td>{contractCell(r)}</td>
                  {!isTpm && <td>{r.tpmName || <span className="cell-empty">—</span>}</td>}
                  <td className="mono">{r.invoiceNo || <span className="cell-empty">—</span>}</td>
                  <td className="num tabular">{r.kind === 'financier' ? formatAr(r.reportedAmount || 0) : <span className="cell-empty">—</span>}</td>
                  {/* Gabarit sans visite planifiée, ou d'un partenaire qui n'est plus TPM : « non applicable d'office »
                      (retour 114, décision D-b ; même règle et même bulle d'aide que Rapports). */}
                  <td>{r.autoNotApplicable
                    ? <span title={tr(autoNotApplicableWhy(r))}><StatusBadge def={reportStatusDef(r)} /></span>
                    : <StatusBadge def={reportStatusDef(r)} />}</td>
                  <td style={{ textAlign: 'right' }}><Button size="sm" variant="secondary" onClick={() => openReport(r)}>{tr('Ouvrir')}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <FactureDrawer reportId={open.id} kind={open.kind} context={context} month={open.month}
          onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); onChanged(); }} />
      )}
    </>
  );
}
