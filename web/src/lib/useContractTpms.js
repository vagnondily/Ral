import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

/**
 * TPM de chaque contrat de suivi pour un mois (retour 58 : TPM rattaché par plan / facture, sinon
 * titulaire — GET /api/tpm/attribution/providers). Rend `tpmsOf(contractId)` → [{ id, name }] ;
 * liste vide tant que la réponse n'est pas arrivée, ou si `enabled` est faux.
 */
export default function useContractTpms(month, enabled = true) {
  const [map, setMap] = useState({});
  useEffect(() => {
    if (!enabled || !month) return undefined;
    let alive = true;
    const m = String(month).slice(0, 7);
    api.tpmAttributionProviders({ from: m, to: m }).then((r) => { if (alive) setMap(r.contractTpms || {}); }).catch(() => {});
    return () => { alive = false; };
  }, [enabled, month]);
  return (contractId) => map[contractId] || [];
}
