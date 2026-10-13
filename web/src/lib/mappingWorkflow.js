// « Mapping MEMS » d'une fiche — affichage du cycle de vie (brouillon → soumis →
// validé) et des comptes « mois de collecte ». Les règles (qui peut modifier,
// soumettre, valider) sont calculées par le serveur (mappingWorkflow.js) et
// arrivent dans `actions` : l'écran n'offre que ce que le serveur acceptera.

/** Statut du mapping : couleur + icône + libellé (StatusBadge, clé icon → STATUS_ICONS). */
export const MAPPING_STATUS = {
  brouillon: { label: 'Brouillon', tone: null, icon: 'draft' },
  soumis: { label: 'Soumis', tone: 'blue', icon: 'clock' },
  valide: { label: 'Validé', tone: 'green', icon: 'check' },
};

/** Dimensions de date (mêmes clés que memsMapping.DATE_KEYS côté serveur). */
export const DATE_KEYS = { survey: 'survey_date', upload: 'submitted_at' };

/**
 * Comptes « mois de collecte » d'une fiche, pour la ligne « Date de collecte » :
 * soumissions dont le mois de collecte diffère du mois de réception, et celles
 * dont le mois de réception n'est pas encore connu (importées avant la règle).
 * @param {{ total?: number, withUpload?: number, monthDiffers?: number }|null} dates
 */
export function dateStats(dates) {
  const total = Number(dates?.total) || 0;
  const withUpload = Number(dates?.withUpload) || 0;
  const differs = Number(dates?.monthDiffers) || 0;
  return {
    total,
    differs,
    unknownUpload: Math.max(0, total - withUpload),
    pct: withUpload ? Math.round((differs / withUpload) * 100) : null,
  };
}
