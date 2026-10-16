// Planification automatique du plan de suivi (« Générer le plan de suivi », retour 82) —
// garde-fous du 16/10 : période jamais échue, empreinte de l'aperçu, raisons, règle unique
// « actif au mois M », lignes MMR « à vérifier ».
export default {
  '{n} visite(s) créée(s) sur {m} prévue(s).': '{n} visit(s) created out of {m} planned.',
  'Non créées : {why}.': 'Not created: {why}.',
  'déjà planifiées entre-temps': 'already planned in the meantime',
  'Les données ont changé : relancez l\'aperçu.': 'The data has changed: run the preview again.',
  'Période entièrement échue : choisissez des mois à partir de {m}.': 'The period is entirely past: choose months from {m} onwards.',
  'Exercice {y} échu : aucune visite ne se planifie dans un mois passé.': 'Fiscal year {y} is over: no visit can be planned in a past month.',
  'Les mois échus de la période ne sont jamais planifiés : le plan commence en {m}.': 'Past months of the period are never planned: the plan starts in {m}.',
  'Changé depuis l\'aperçu : {list}.': 'Changed since the preview: {list}.',
  'Relancer l\'aperçu': 'Run the preview again',
  '{n} mois échu(s) non planifié(s) : le plan commence en {m}.': '{n} past month(s) not planned: the plan starts in {m}.',
  'Visites non placées': 'Visits not placed',
  'Déjà prévues ou réalisées sur la période': 'Already planned or done in the period',
  'Sites inactifs toute la période': 'Sites inactive for the whole period',
  '{n} site(s) non couvert(s) sur la période, par raison :': '{n} site(s) not covered in the period, by reason:',
  'Capacité : augmentez la capacité (faisable) des activités concernées dans la Configuration MMR, ou décochez « Respecter la capacité mensuelle du MMR » dans les options.':
    'Capacity: increase the (feasible) capacity of the activities concerned in the MMR configuration, or untick “Respect the MMR monthly capacity” in the options.',
  'Sites non couverts et leur raison ({n} sur {total})': 'Sites not covered and their reason ({n} of {total})',
  'Visites dues': 'Visits due',
  'Échantillon · le plan complet compte {v} visite(s) et couvre {n} site(s).': 'Sample · the full plan has {v} visit(s) and covers {n} site(s).',
  '« Appliquer » crée ces visites comme « planifiées », exactement celles de cet aperçu (si les données ont changé entre-temps, rien n\'est écrit). Idempotent : un site déjà prévu ce mois n\'est pas dupliqué, et l\'intervalle est respecté face aux visites existantes.':
    '“Apply” creates these visits as “planned”, exactly those of this preview (if the data changed in the meantime, nothing is written). Idempotent: a site already planned that month is not duplicated, and the interval is kept with the existing visits.',
  // Raisons d'un site non couvert / d'une visite non placée
  'capacité du mois atteinte': 'monthly capacity reached',
  'mois inactifs (grille Sites actifs / inactifs)': 'inactive months (Active / inactive sites grid)',
  'mois d\'une visite annulée': 'month of a cancelled visit',
  'intervalle avec une visite existante': 'interval with an existing visit',
  'période trop courte ou mois exclus': 'period too short or excluded months',
  // Raisons d'une affectation non écrite
  'déjà une visite ce mois': 'already a visit this month',
  'mois inactif': 'inactive month',
  'zone interdite': 'forbidden area',
  // Sections de l'empreinte
  'registre des sites': 'site registry',
  'sites actifs / inactifs': 'active / inactive sites',
  'paramètres MMR': 'MMR parameters',
  'TPM des zones': 'zone TPMs',
  'période ou réglages': 'period or settings',
  // Plan de suivi : règle unique « actif au mois M »
  'Non renseigné (non planifiable)': 'Not set (cannot be planned)',
  'Mois non renseigné : non planifiable': 'Month not set: cannot be planned',
  // MMR : lignes ajoutées depuis le référentiel
  '{a} activité(s) ajoutée(s) « à vérifier » (durée et risque à renseigner), {s} ligne(s) alignée(s). Pensez à enregistrer.':
    '{a} activit(y/ies) added “to check” (duration and risk to fill in), {s} row(s) aligned. Remember to save.',
  'à vérifier': 'to check',
  '— à renseigner —': '— to fill in —',
};
