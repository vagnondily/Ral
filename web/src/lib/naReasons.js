// Raisons d'un indicateur « Non évalué » — codes calculés par le serveur
// (monitoringMath.naReason) ; ici seulement le texte (phrase française, traduite
// à l'affichage) et l'action proposée. Ordre = ordre d'affichage.
export const NA_REASONS = {
  no_data: {
    label: 'Aucune donnée sur la période',
    hint: 'Aucun formulaire reçu pour cette fiche sur la période choisie.',
    action: 'period',
  },
  variable_absent: {
    label: 'Variable absente des données de la période',
    hint: 'Les formulaires reçus ne contiennent pas cette question : elle vient d\'une autre version du formulaire, ou le nom de variable de l\'indicateur est à corriger.',
    action: 'config',
  },
  only_na: {
    label: 'Seulement des réponses « hors base »',
    hint: 'Toutes les réponses sont des codes exclus du calcul (Sans objet, Ne sait pas…).',
    action: null,
  },
  no_answer: {
    label: 'Question présente mais jamais répondue',
    hint: 'La variable existe dans les formulaires de la période, mais elle est toujours vide.',
    action: null,
  },
  no_target: {
    label: 'Moyenne, somme ou nombre sans cible',
    hint: 'La valeur est calculée et affichée, mais sans cible aucune bande ne s\'applique : ajoutez une cible pour la classer.',
    action: 'config',
  },
  unknown: {
    label: 'Non évalué',
    hint: 'Aucune réponse comptée pour cet indicateur sur la période.',
    action: null,
  },
};

/** Codes de raison dans l'ordre d'affichage. */
export const NA_REASON_ORDER = Object.keys(NA_REASONS);

/**
 * Indicateurs notés « Non évalué » regroupés par raison (ordre fixe), pour le
 * détail d'une fiche. Les indicateurs hors indice (scored = false) sont à part,
 * comme dans la répartition des bandes.
 * @param {{ cls:string, reason:string|null, scored?:boolean, label:string }[]} indicators
 */
export function groupNaReasons(indicators) {
  const groups = new Map();
  for (const ind of indicators || []) {
    if (!ind || ind.scored === false || ind.cls !== 'na') continue;
    const k = NA_REASONS[ind.reason] ? ind.reason : 'unknown';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(ind);
  }
  return NA_REASON_ORDER.filter((k) => groups.has(k)).map((k) => ({ reason: k, ...NA_REASONS[k], indicators: groups.get(k) }));
}
