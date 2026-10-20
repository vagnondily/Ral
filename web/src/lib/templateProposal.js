/**
 * Affichage des propositions du modèle d'indicateurs (retours 66 et 85) : la
 * règle elle-même est au serveur (server/src/modules/monitoring/indicatorProposals.js) ;
 * ici seulement les mots et les valeurs lisibles. Phrases françaises traduites par tr().
 */
import { formatInt } from './format.js';

/** Méthodes de calcul (mêmes mots que l'éditeur d'indicateur). */
export const AGG_LABEL = { percent_yes: '% de « oui »', percent_value: '% = valeur', mean: 'Moyenne', sum: 'Somme', count: 'Nombre' };

/** Ce qui diffère entre un indicateur créé et le modèle actuel (indicatorProposals.templateDrift). */
export const DRIFT_KEY_LABEL = {
  sourceField: 'variable',
  agg: 'méthode',
  positiveValue: 'valeur comptée',
  naValues: 'réponses hors base',
  target: 'cible',
  direction: 'sens',
  label: 'libellé',
};

/** Valeur lisible d'un élément de l'écart (méthode, sens, liste de codes, vide). */
export function driftValue(key, value, tr) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
  if (key === 'agg') return tr(AGG_LABEL[value] || value);
  if (key === 'direction') return tr(value === 'lower_better' ? '↓ mieux' : '↑ mieux');
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/** Part des éléments d'un modèle trouvés dans la fiche, en pourcentage entier (0–100). */
export function coveragePct(ratio) {
  return formatInt(Math.round((Number(ratio) || 0) * 100));
}
