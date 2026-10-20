import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

/**
 * TPM de chaque contrat de suivi pour un mois (retour 58 : TPM rattaché par plan / facture, sinon
 * titulaire — GET /api/tpm/attribution/providers). Rend `tpmsOf(contractId)` → [{ id, name }] ;
 * liste vide tant que la réponse n'est pas arrivée, ou si `enabled` est faux.
 * `tpmsOf.isActive(partnerId)` : prestataire actif ce mois-là selon la règle commune « prestataire
 * actif au mois M » (retour 30 — groupe « contrat » de la même réponse) : il passe en tête des listes.
 */
export default function useContractTpms(month, enabled = true) {
  const [data, setData] = useState({ map: {}, active: new Set() });
  useEffect(() => {
    if (!enabled || !month) return undefined;
    let alive = true;
    const m = String(month).slice(0, 7);
    api.tpmAttributionProviders({ from: m, to: m }).then((r) => {
      if (!alive) return;
      const contrat = (r.groups || []).find((g) => g.key === 'contrat');
      setData({ map: r.contractTpms || {}, active: new Set(((contrat && contrat.providers) || []).map((p) => p.id)) });
    }).catch(() => {});
    return () => { alive = false; };
  }, [enabled, month]);
  return useMemo(() => {
    const tpmsOf = (contractId) => data.map[contractId] || [];
    tpmsOf.isActive = (partnerId) => data.active.has(partnerId);
    return tpmsOf;
  }, [data]);
}
