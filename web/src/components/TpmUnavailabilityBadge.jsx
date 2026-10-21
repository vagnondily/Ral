import React from 'react';
import { Ban } from 'lucide-react';
import { Badge } from './ui.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { TPM_AVAILABILITY, rangeLabel } from '../lib/tpmAttribution.js';

/**
 * Badge d'indisponibilité d'un TPM (couleur + icône + libellé) : « Indisponible oct. 26 – nov. 26 »,
 * orange si le mois courant en fait partie, neutre si elle est à venir ; le motif en info-bulle.
 * @param {{ u: { from, to, reason, current } | null }} props  tpmAttribution.unavailabilityOf
 */
export default function TpmUnavailabilityBadge({ u }) {
  const { tr } = useI18n();
  if (!u) return null;
  const label = tr('Indisponible {period}', { period: rangeLabel(u.from, u.to) });
  return (
    <span title={u.reason ? tr('Indisponibilité déclarée (Affectation des TPM) : {reason}', { reason: u.reason }) : undefined}>
      <Badge tone={u.current ? TPM_AVAILABILITY.indisponible.tone : null} icon={Ban}>{label}</Badge>
    </span>
  );
}
