import React from 'react';
import { AlertTriangle, AlertOctagon, Info } from 'lucide-react';
import { Badge } from './ui.jsx';
import { SEVERITY } from '../lib/alerts.js';
import { useI18n } from '../lib/i18n.jsx';

/** Icône de chaque gravité d'alerte (Critique · À surveiller · À traiter). */
export const SEV_ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info };

/** Gravité d'une alerte : couleur + icône + libellé (Centre d'alertes et cloche de l'en-tête). */
export default function SeverityBadge({ sev }) {
  const { tr } = useI18n();
  const S = SEVERITY[sev];
  if (!S) return null;
  return <Badge tone={S.tone} icon={SEV_ICON[sev]}>{tr(S.label)}</Badge>;
}
