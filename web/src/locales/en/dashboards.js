// Dictionnaire anglais — tableaux de bord partagés (retours 16, 19, 34) :
// période par défaut, courbe mensuelle, bureaux par leur nom, « Non évalué »
// expliqué, Synthèse dense, Centre d'alertes et cloche de l'en-tête.
export default {
  // ---- Période par défaut (components/PeriodBanner.jsx, MonthSelect)
  'Placé sur {shown}, dernier mois avec des données.': 'Showing {shown}, the latest month with data.',
  '{today} : seulement {n} formulaire(s) reçu(s) pour l\'instant.': '{today}: only {n} form(s) received so far.',
  '{today} : aucune donnée ; les mois suivants n\'ont que quelques formulaires.': '{today}: no data; the following months only have a few forms.',
  '{today} : aucune donnée pour l\'instant.': '{today}: no data yet.',
  'Le nombre après le mois : formulaires reçus ce mois-là': 'Number after the month: forms received that month',
  'Aucune donnée reçue pour le mois sélectionné ({m}).': 'No data received for the selected month ({m}).',

  // ---- Valeur codée par son nom (components/CodeLabel.jsx)
  'Libellé de la fiche, pas encore relié à un bureau MEMS': 'Label from the form, not yet linked to a MEMS office',
  'non relié à MEMS': 'not linked to MEMS',
  'Relier': 'Link',
  'Code {code}': 'Code {code}',

  // ---- Synthèse
  'aucun plan pour {m}': 'no plan for {m}',
  'aucun plan pour ce mois': 'no plan this month',
  'aucun plan': 'no plan',
  'Formulaires reçus par mois, 12 mois finissant en {m}': 'Forms received per month, 12 months ending {m}',
  'formulaire(s)': 'form(s)',
  'Formulaires reçus': 'Forms received',
  'Sites (données)': 'Sites (data)',
  'À faire': 'To do',

  // ---- Couverture & performance : « Non évalué » expliqué (lib/naReasons.js)
  'aucun plan ce mois': 'no plan this month',
  '{n} en action urgente · {na} non évalué(s)': '{n} requiring urgent action · {na} not assessed',
  '{n} indicateur(s) complémentaire(s) hors indice, non comptés ici': '{n} supplementary indicator(s) outside the index, not counted here',
  'Pourquoi « Non évalué » ?': 'Why “Not assessed”?',
  '{n} indicateur(s) sans bande sur {m}': '{n} indicator(s) without a band in {m}',
  'Aucune donnée sur la période': 'No data in the period',
  'Aucun formulaire reçu pour cette fiche sur la période choisie.': 'No form was received for this form template in the selected period.',
  'Variable absente des données de la période': 'Variable missing from the period\'s data',
  'Les formulaires reçus ne contiennent pas cette question : elle vient d\'une autre version du formulaire, ou le nom de variable de l\'indicateur est à corriger.':
    'The forms received do not contain this question: it belongs to another version of the form, or the indicator\'s variable name needs fixing.',
  'Seulement des réponses « hors base »': 'Only “out of base” answers',
  'Toutes les réponses sont des codes exclus du calcul (Sans objet, Ne sait pas…).': 'Every answer is a code excluded from the calculation (Not applicable, Don\'t know…).',
  'Question présente mais jamais répondue': 'Question present but never answered',
  'La variable existe dans les formulaires de la période, mais elle est toujours vide.': 'The variable exists in the period\'s forms, but it is always empty.',
  'Moyenne, somme ou nombre sans cible': 'Mean, sum or count without a target',
  'La valeur est calculée et affichée, mais sans cible aucune bande ne s\'applique : ajoutez une cible pour la classer.':
    'The value is calculated and shown, but without a target no band applies: add a target to rate it.',
  'Aucune réponse comptée pour cet indicateur sur la période.': 'No answer counted for this indicator in the period.',
  'Ajouter une cible': 'Add a target',
  'Vérifier la variable': 'Check the variable',
  '+ {n} autre(s)': '+ {n} more',
  'Aucune visite de terrain n\'est planifiée ce mois (couverture non mesurable), et le RBM signale {due} site(s) à suivre ce mois sur {total}.':
    'No field visit is planned this month (coverage cannot be measured), and RBM flags {due} site(s) to monitor this month out of {total}.',

  // ---- Centre d'alertes et cloche de l'en-tête
  'Certaines sources n\'ont pas pu être lues : {list}. Les autres alertes restent à jour.': 'Some sources could not be read: {list}. The other alerts are up to date.',
  '{partner}': '{partner}',
  '{partner} · {numero} · {month}': '{partner} · {numero} · {month}',
  'Alertes : {n} à traiter en priorité': 'Alerts: {n} need attention first',
  '{c} critique(s) · {w} à surveiller · {i} à traiter': '{c} critical · {w} to watch · {i} to handle',
  'Alertes indisponibles pour le moment.': 'Alerts are unavailable right now.',
  'Voir toutes les alertes ({n})': 'See all alerts ({n})',
  'Voir toutes les alertes': 'See all alerts',
};
