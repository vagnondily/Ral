import React, { useEffect, useState } from 'react';
import { FileSignature, Info } from 'lucide-react';
import { api } from '../../../api/client.js';
import { Alert, Badge, EmptyState, Skeleton, StatusBadge, Usage } from '../../../components/ui.jsx';
import { CONTRACT_STATUS, periodLabel } from '../../../lib/contracts.js';
import { formatAr } from '../../../lib/format.js';
import { VIA_LABELS } from '../../../lib/partners.js';
import { ROLE_LABELS, contractNo, internalNo } from '../../../lib/roles.js';
import { useI18n } from '../../../lib/i18n.jsx';

/**
 * Contrats d'un partenaire (règle « prestataire actif », retour 30 ; rôles, retour 113) :
 *  - TPM : les contrats qu'il SUIT (rattaché par ses plans, ses factures ou ses visites) et leur
 *    titulaire, plus un contrat qu'il tiendrait lui-même ; son Réalisé validé ;
 *  - titulaire : ses contrats et le TPM de chacun ; le Réalisé validé de tous les TPM.
 * Budget suivi et consommation du contrat (Consolidation).
 */
export default function ProviderContractsTab({ providerId, role, onOpenContract, onOpenPartner }) {
  const { tr } = useI18n();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const isTpm = role === 'tpm';
  useEffect(() => { api.partnerContracts(providerId).then(setRows).catch((e) => { setError(e.message); setRows([]); }); }, [providerId]);

  if (rows === null) return <div className="card-body"><Skeleton height={120} /></div>;
  if (error) return <div className="card-body"><Alert tone="error">{error}</Alert></div>;
  if (!rows.length) {
    return <EmptyState icon={FileSignature} title={tr('Aucun contrat rattaché')}>{tr('Un partenaire est rattaché à un contrat comme titulaire, ou — pour un TPM — par un plan de collecte, une facture ou une visite qui porte ce contrat.')}</EmptyState>;
  }
  const partnerLink = (id, name) => (id && onOpenPartner
    ? <button type="button" className="inline-link" onClick={() => onOpenPartner(id)}>{name}</button> : name);
  return (
    <>
      <div className="card-body pv-intro">
        <Info size={16} aria-hidden="true" />
        <span>{tr('« Couvre ce mois » : le contrat est actif et sa période inclut le mois courant — le partenaire est alors sélectionnable partout (plan de suivi, formations, évaluations, rapports).')}</span>
      </div>
      <div className="table-wrap">
        <table className="table grid">
          <thead><tr>
            <th scope="col">{tr('Contrat')}</th>
            <th scope="col">{tr(isTpm ? ROLE_LABELS.holder : ROLE_LABELS.tpm)}</th>
            {isTpm && <th scope="col">{tr('Rattachement')}</th>}
            <th scope="col">{tr('Période')}</th>
            <th scope="col">{tr('Statut')}</th>
            <th scope="col" className="num">{tr('Budget suivi')}</th>
            <th scope="col" className="num">{tr(isTpm ? 'Réalisé (ce TPM)' : 'Réalisé validé (TPM)')}</th>
            <th scope="col" style={{ minWidth: 170 }}>{tr('Consommation du contrat')}</th>
          </tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <button type="button" className="inline-link mono pv-nowrap" onClick={() => onOpenContract(c.id)}>{contractNo(c)}</button>
                  {internalNo(c) && <span className="pv-sub mono">{internalNo(c)}</span>}
                </td>
                <td>
                  {isTpm
                    ? (c.isHolder ? <span className="muted">{tr('son propre contrat')}</span> : partnerLink(c.holderId, c.holderName))
                    : (c.tpm.tpms.length
                      ? c.tpm.tpms.map((t, i) => <span key={t.id}>{i > 0 && ', '}{partnerLink(t.id, t.name)}</span>)
                      : <span className="cell-empty">{tr(ROLE_LABELS.noTpm)}</span>)}
                </td>
                {isTpm && <td>{c.via.filter((x) => x !== 'titulaire' || c.isHolder).map((x) => <Badge key={x}>{tr(VIA_LABELS[x] || x)}</Badge>)}</td>}
                <td className="tabular pv-nowrap">{periodLabel(c.dateDebut, c.status === 'resilie' && c.terminationDate ? c.terminationDate : c.dateFin, tr)}</td>
                <td>
                  <div className="pv-status-cell">
                    <StatusBadge map={CONTRACT_STATUS} value={c.status} />
                    {c.coversMonth && <span className="pv-status-period text-ok pv-nowrap">{tr('Couvre ce mois')}</span>}
                  </div>
                </td>
                <td className="num tabular">{c.monitoring ? formatAr(c.monitoringBudget) : <span className="cell-empty">{tr('— pas de ligne de suivi')}</span>}</td>
                <td className="num tabular">
                  {formatAr(isTpm ? c.providerActual : c.contractActual)}
                  {isTpm && c.providerPending > 0 && <span className="pv-sub">{tr('+ {amount} en attente', { amount: formatAr(c.providerPending) })}</span>}
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
