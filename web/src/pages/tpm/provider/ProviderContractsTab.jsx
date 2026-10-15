import React, { useEffect, useState } from 'react';
import { FileSignature, Info } from 'lucide-react';
import { api } from '../../../api/client.js';
import { Alert, Badge, EmptyState, Skeleton, StatusBadge, Usage } from '../../../components/ui.jsx';
import { CONTRACT_STATUS, periodLabel } from '../../../lib/contracts.js';
import { formatAr } from '../../../lib/format.js';
import { VIA_LABELS } from '../../../lib/partners.js';
import { useI18n } from '../../../lib/i18n.jsx';

/**
 * Contrats du prestataire : ceux dont il est titulaire ET ceux auxquels il est rattaché par ses
 * plans, ses rapports ou ses visites (règle « prestataire actif », retour 30). Budget suivi,
 * Réalisé validé du prestataire et consommation du contrat (Consolidation).
 */
export default function ProviderContractsTab({ providerId, onOpenContract }) {
  const { tr } = useI18n();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.partnerContracts(providerId).then(setRows).catch((e) => { setError(e.message); setRows([]); }); }, [providerId]);

  if (rows === null) return <div className="card-body"><Skeleton height={120} /></div>;
  if (error) return <div className="card-body"><Alert tone="error">{error}</Alert></div>;
  if (!rows.length) {
    return <EmptyState icon={FileSignature} title={tr('Aucun contrat rattaché')}>{tr('Un prestataire est rattaché à un contrat comme titulaire, ou par un plan de collecte, un rapport ou une visite qui porte ce contrat.')}</EmptyState>;
  }
  return (
    <>
      <div className="card-body pv-intro">
        <Info size={16} aria-hidden="true" />
        <span>{tr('« Couvre ce mois » : le contrat est actif et sa période inclut le mois courant — le prestataire est alors sélectionnable partout (plan de suivi, formations, évaluations, rapports).')}</span>
      </div>
      <div className="table-wrap">
        <table className="table grid">
          <thead><tr>
            <th scope="col">{tr('Contrat')}</th>
            <th scope="col">{tr('Rattachement')}</th>
            <th scope="col">{tr('Période')}</th>
            <th scope="col">{tr('Statut')}</th>
            <th scope="col" className="num">{tr('Budget suivi')}</th>
            <th scope="col" className="num">{tr('Réalisé (ce prestataire)')}</th>
            <th scope="col" style={{ minWidth: 170 }}>{tr('Consommation du contrat')}</th>
          </tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <button type="button" className="inline-link mono pv-nowrap" onClick={() => onOpenContract(c.id)}>{c.numero}</button>
                  <span className="pv-sub">{c.isHolder ? tr('Titulaire : ce prestataire') : tr('Titulaire : {name}', { name: c.holderName })}</span>
                </td>
                <td>{c.via.map((x) => <Badge key={x}>{tr(VIA_LABELS[x] || x)}</Badge>)}</td>
                <td className="tabular pv-nowrap">{periodLabel(c.dateDebut, c.status === 'resilie' && c.terminationDate ? c.terminationDate : c.dateFin, tr)}</td>
                <td>
                  <div className="pv-status-cell">
                    <StatusBadge map={CONTRACT_STATUS} value={c.status} />
                    {c.coversMonth && <span className="pv-status-period text-ok pv-nowrap">{tr('Couvre ce mois')}</span>}
                  </div>
                </td>
                <td className="num tabular">{c.monitoring ? formatAr(c.monitoringBudget) : <span className="cell-empty">{tr('— pas de ligne de suivi')}</span>}</td>
                <td className="num tabular">
                  {formatAr(c.providerActual)}
                  {c.providerPending > 0 && <span className="pv-sub">{tr('+ {amount} en attente', { amount: formatAr(c.providerPending) })}</span>}
                </td>
                <td>{c.consumption == null ? <span className="cell-empty">—</span> : <Usage rate={c.consumption / 100} />}
                  {c.consumption != null && c.remaining != null && <span className="pv-sub">{c.remaining >= 0 ? tr('Restant : {amount}', { amount: formatAr(c.remaining) }) : tr('Dépassement : {amount}', { amount: formatAr(-c.remaining) })}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
