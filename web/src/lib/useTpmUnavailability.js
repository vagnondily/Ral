import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

/**
 * Indisponibilités des TPM (retour 114) du mois courant aux 11 suivants — GET
 * /api/tpm/attribution/unavailability, une requête par écran ; à lire avec
 * tpmAttribution.unavailabilityOf(data, providerId). null tant que la réponse n'est pas arrivée
 * (ou si `enabled` est faux) : l'écran s'affiche sans badge, jamais bloqué.
 */
export default function useTpmUnavailability(enabled = true) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    api.tpmUnavailability().then((r) => { if (alive) setData(r); }).catch(() => {});
    return () => { alive = false; };
  }, [enabled]);
  return data;
}
