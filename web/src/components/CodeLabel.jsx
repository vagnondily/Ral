import React from 'react';
import { AlertTriangle, Link2Off } from 'lucide-react';
import { Badge } from './ui.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { shortFormLabel } from '../lib/formLabel.js';

/**
 * « Jamais un code sans son nom » (retour n° 19) : affiche une valeur codée
 * résolue par le serveur (common/codeLabel) — { status, name, code, formId, formLabel } :
 *   relie     → le nom du bureau MEMS ;
 *   libelle   → le libellé donné par la fiche, marqué « non relié à MEMS » ;
 *   non_relie → « Code 6 » + badge « non relié » (icône + libellé) + la fiche,
 *               et un lien « Relier » vers les Correspondances de CETTE fiche ;
 *   vide      → « Non renseigné ».
 */
export default function CodeLabel({ row, onNavigate, showForm = false }) {
  const { tr } = useI18n();
  if (!row || row.status === 'vide') return <span className="muted">{tr('Non renseigné')}</span>;
  if (row.status === 'relie') return <span className="code-label">{row.name}</span>;
  if (row.status === 'libelle') {
    return (
      <span className="code-label" title={tr('Libellé de la fiche, pas encore relié à un bureau MEMS')}>
        {row.name} <Link2Off size={12} aria-label={tr('non relié à MEMS')} className="code-label-ic" />
      </span>
    );
  }
  const relier = row.formId && onNavigate
    ? <button type="button" className="inline-link" onClick={(e) => { e.stopPropagation(); onNavigate('processus', 'donnees', row.formId, 'mapping'); }}>{tr('Relier')}</button>
    : null;
  return (
    <span className="code-label is-code" title={row.formLabel || undefined}>
      {/* Un code numérique se lit « Code 6 » ; un texte saisi (« Bureau terrain Sud ») tel quel. */}
      <span className="code-label-code">{/^\d+$/.test(String(row.code || '')) ? tr('Code {code}', { code: row.code }) : row.code}</span>
      <Badge tone="orange" icon={AlertTriangle}>{tr('non relié')}</Badge>
      {showForm && row.formLabel && <span className="muted code-label-form">{shortFormLabel(row.formLabel)}</span>}
      {relier}
    </span>
  );
}
