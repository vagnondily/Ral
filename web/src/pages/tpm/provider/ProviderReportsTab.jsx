import React, { useEffect, useMemo, useState } from 'react';
import { FileText, ExternalLink } from 'lucide-react';
import { api } from '../../../api/client.js';
import { Alert, Badge, Button, EmptyState, Skeleton, StatusBadge } from '../../../components/ui.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { REPORT_KIND, REPORT_STATUS } from '../../../lib/contracts.js';
import { formatAr, monthLabel } from '../../../lib/format.js';
import { useI18n } from '../../../lib/i18n.jsx';
import FactureDrawer from '../FactureDrawer.jsx';

/**
 * Rapports et factures du prestataire : chaque ligne OUVRE le vrai document (facture = état des
 * dépenses, rapport technique) dans le même tiroir que « Rapports & dépenses ».
 */
export default function ProviderReportsTab({ providerId, onNavigate, onChanged }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [context, setContext] = useState(null);
  const [open, setOpen] = useState(null);
  const [kind, setKind] = useState('');

  const load = () => api.partnerReports(providerId).then(setRows).catch((e) => { setError(e.message); setRows([]); });
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

  return (
    <>
      <div className="data-toolbar">
        <div className="data-toolbar-left">
          <div className="segmented" role="group" aria-label={tr('Type de rapport')}>
            {[['', 'Tous'], ['financier', 'Factures (financier)'], ['technique', 'Rapports techniques']].map(([k, label]) => (
              <button key={k || 'all'} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{tr(label)}</button>
            ))}
          </div>
        </div>
        <div className="data-toolbar-right">
          <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => onNavigate('tpm', 'rapports')}>{tr('Ouvrir Rapports & dépenses')}</Button>
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={FileText} title={tr('Aucun rapport')}>{tr('Les factures et rapports techniques de ce prestataire apparaîtront ici dès leur enregistrement.')}</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table grid">
            <thead><tr>
              <th scope="col">{tr('Mois')}</th><th scope="col">{tr('Type')}</th><th scope="col">{tr('Contrat')}</th>
              <th scope="col">{tr('N° facture')}</th><th scope="col" className="num">{tr('Réalisé (bailleur)')}</th>
              <th scope="col">{tr('Statut')}</th><th scope="col" />
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="clickable" onDoubleClick={() => openReport(r)}>
                  <td className="tabular">{monthLabel(r.month)}</td>
                  <td><Badge tone={REPORT_KIND[r.kind].tone}>{tr(REPORT_KIND[r.kind].label)}</Badge></td>
                  <td className="mono">{r.contractNumero}</td>
                  <td className="mono">{r.invoiceNo || <span className="cell-empty">—</span>}</td>
                  <td className="num tabular">{r.kind === 'financier' ? formatAr(r.reportedAmount || 0) : <span className="cell-empty">—</span>}</td>
                  <td><StatusBadge map={REPORT_STATUS} value={r.status} /></td>
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
