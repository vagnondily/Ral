// Dictionnaire anglais — période = plage de mois (lot 1b, retour 47) : sélecteur
// « du … au … » (components/PeriodSelect.jsx), période de travail de la session
// (components/PeriodBanner.jsx usePeriod), erreurs de période du serveur
// (lib/period.js PERIOD_ERRORS) et libellés des écrans passés à la plage.
// Déjà ailleurs : « Annuler », « Période », « {n} mois », « Année {y} », « Du »,
// « Appliquer », « Toutes les périodes ».
export default {
  // ---- Sélecteur
  'Choisir la période': 'Choose the period',
  'Préréglages': 'Presets',
  'Personnalisée': 'Custom',
  'Au': 'To',
  'Dernier mois avec des données': 'Latest month with data',
  'Ce mois-ci': 'This month',
  'Mois dernier': 'Last month',
  'Trimestre en cours': 'Current quarter',
  'Trimestre précédent': 'Previous quarter',
  'Semestre en cours': 'Current half-year',
  'Semestre précédent': 'Previous half-year',
  'Janvier – juin {y}': 'January – June {y}',
  'Année en cours': 'Year to date',
  '12 derniers mois': 'Last 12 months',
  'T{q} {y}': 'Q{q} {y}',
  'S{h} {y}': 'H{h} {y}',
  '{n} formulaire(s) reçu(s) sur la période': '{n} form(s) received over the period',
  'chaque mois a des données': 'every month has data',
  '{n} mois sans données': '{n} month(s) without data',
  '{n} mois au plus': '{n} months at most',
  'période conservée de la session': 'period kept from this session',
  'Revenir au dernier mois avec des données': 'Back to the latest month with data',

  // ---- Erreurs de période renvoyées par le serveur (details.code)
  'Période invalide : mois attendu au format AAAA-MM (ex. 2026-01).': 'Invalid period: month expected as YYYY-MM (e.g. 2026-01).',
  'Période incomplète : précisez le début (from) et la fin (to).': 'Incomplete period: give both the start (from) and the end (to).',
  'Période ambiguë : utilisez soit month, soit from et to.': 'Ambiguous period: use either month, or from and to.',
  'Période invalide : le début ({from}) est après la fin ({to}).': 'Invalid period: the start ({from}) is after the end ({to}).',
  'Période trop longue : {maxSpan} mois au plus (demandé : {span}).': 'Period too long: {maxSpan} months at most (requested: {span}).',
  'Période hors limites : années 2000 à 2100.': 'Period out of range: years 2000 to 2100.',
  'Période requise.': 'A period is required.',

  // ---- Écrans passés à la plage (Synthèse, Couverture & performance, décisionnel, alertes)
  'Aucune donnée reçue sur la période ({p}).': 'No data received over the period ({p}).',
  'Couverture (sites)': 'Coverage (sites)',
  '{r} / {a} sites actifs · distincts sur la période': '{r} / {a} active sites · distinct over the period',
  'sites actifs : tout le registre (aucune grille d\'activation)': 'active sites: whole register (no activation grid)',
  'grille d\'activation non importée : taux calculé sur tout le registre': 'activation grid not imported: rate computed on the whole register',
  'Exécution du plan': 'Plan execution',
  'Exécution du plan (visites)': 'Plan execution (visits)',
  '{done} / {planned} visites prévues': '{done} / {planned} planned visits',
  '— aucun plan': '— no plan',
  'état au {m}': 'as of {m}',
  'à date': 'to date',
  'Budget de la période': 'Budget for the period',
  'cumul sur la période': 'cumulative over the period',
  'pic mensuel ({m})': 'monthly peak ({m})',
  'Période (terrain et rapports)': 'Period (field and reports)',
  'Les alertes budgétaires et d\'échéance sont calculées à date.': 'Budget and deadline alerts are computed as of today.',
  'Fil du mois de {m}': 'Flow for {m}',
  'hors périmètre actif': 'outside the active scope',
  'dont {n} visite(s) à venir': 'including {n} upcoming visit(s)',
  'sites (données)': 'sites (data)',

  // ---- Centre d'alertes et cloche : le taux terrain est l'exécution du plan (visites)
  'Exécution du plan faible ce mois': 'Low plan execution this month',
  'Exécution du plan faible sur la période': 'Low plan execution over the period',
  'Sites planifiés sans prestataire TPM sur la période': 'Sites planned without a TPM provider over the period',
};
