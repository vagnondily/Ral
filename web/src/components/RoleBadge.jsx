import { Building2, Eye, Handshake } from 'lucide-react';
import { Badge } from './ui.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { PARTNER_ROLE } from '../lib/roles.js';

// Rôle d'un partenaire (retour 113) : couleur + icône + libellé, jamais la couleur seule.
const ROLE_ICONS = { tpm: Eye, mise_en_oeuvre: Building2, autre: Handshake };

export default function RoleBadge({ role }) {
  const { tr } = useI18n();
  const def = PARTNER_ROLE[role] || PARTNER_ROLE.autre;
  return <Badge tone={def.tone} icon={ROLE_ICONS[role] || Handshake}>{tr(def.label)}</Badge>;
}
