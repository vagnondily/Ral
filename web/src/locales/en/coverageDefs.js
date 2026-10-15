// Mesures de couverture (retour 110) : Synthèse du suivi de processus et « Couverture & performance »
// (lib/coverageDefs.js, components/CoverageUniverse.jsx, components/ActivityCoverageCard.jsx).
export default {
  // Univers énoncé une fois par page
  'Univers : {n} sites actifs sur {p} (grille des sites actifs) ; {k} sites du registre sans « Oui » ne sont pas comptés':
    'Universe: {n} active sites over {p} (active-sites grid); {k} registry sites without a “Yes” are not counted',
  'Univers : {n} sites actifs sur {p} (grille des sites actifs)': 'Universe: {n} active sites over {p} (active-sites grid)',
  'Univers : {n} sites actifs sur {p} — tout le registre : une année de la période n\'a pas de grille des sites actifs':
    'Universe: {n} active sites over {p} — the whole registry: one year of the period has no active-sites grid',
  'Univers : {n} sites actifs sur {p} — tout le registre (aucune grille des sites actifs)':
    'Universe: {n} active sites over {p} — the whole registry (no active-sites grid)',
  '{f} en zone interdite': '{f} in a no-go area',
  'Renseigner': 'Fill in',
  'Renseigner la grille': 'Fill in the grid',
  // Suivi = visite déclarée ou données reçues
  'dont {d} par données reçues · {v} par visites déclarées': 'of which {d} by data received · {v} by declared visits',
  '({b} par les deux)': '({b} by both)',
  '{c} / {u} sites actifs suivis': '{c} / {u} active sites monitored',
  '{c} / {p} visites prévues suivies dans leur mois': '{c} / {p} planned visits monitored in their month',
  '{n} à venir': '{n} upcoming',
  '{due} à suivre / {n} sites actifs au {m}': '{due} due for monitoring / {n} active sites in {m}',
  'aucun site actif au {m}': 'no active site in {m}',
  '{agents} agent(s) · {c} / {t} communes de l\'univers avec données': '{agents} agent(s) · {c} / {t} universe communes with data',
  // Plan vs Réalisé
  'prévues (mois échus) → suivies dans leur mois, par visite déclarée ou données reçues':
    'planned (past months) → monitored in their month, by declared visit or data received',
  'sites de l\'univers avec une visite prévue (mois échus) → suivis': 'universe sites with a planned visit (past months) → monitored',
  'communes des sites de l\'univers → communes avec des données reçues': 'communes of the universe sites → communes with data received',
  'Soumissions reçues · communes avec données': 'Submissions received · communes with data',
  'Districts dont l\'exécution du plan (visites prévues suivies) est < 80 %': 'Districts where plan execution (planned visits monitored) is < 80%',
  'Toutes les zones avec des visites prévues sont à 80 % ou plus.': 'All areas with planned visits are at 80% or more.',
  // Bulletin
  'Sur la période, {submissions} soumission(s) ont été versées par {agents} agent(s), réparties sur {forms} fiche(s) de suivi ({indicators} indicateurs) ; {c} commune(s) sur {t} de l\'univers ont reçu des données.':
    'Over the period, {submissions} submission(s) were sent by {agents} agent(s), across {forms} monitoring form(s) ({indicators} indicators); {c} of the {t} universe commune(s) received data.',
  'Aucune visite de terrain n\'est prévue sur les mois échus de la période (exécution du plan non mesurable), et le RBM signale {due} site(s) à suivre au {m} sur {total} actif(s) ce mois-là.':
    'No field visit is planned in the past months of the period (plan execution cannot be measured), and RBM flags {due} site(s) due for monitoring in {m} out of {total} active that month.',
  'L\'exécution du plan atteint {execution} ({c} visite(s) prévue(s) suivie(s) sur {p}), et le RBM signale {due} site(s) à suivre au {m} sur {total} actif(s) ce mois-là.':
    'Plan execution reaches {execution} ({c} of {p} planned visit(s) monitored), and RBM flags {due} site(s) due for monitoring in {m} out of {total} active that month.',
  'La couverture des sites atteint {coverage} ({c} site(s) suivi(s) sur {u} actif(s), dont {d} par données reçues et {v} par visites déclarées).':
    'Site coverage reaches {coverage} ({c} of {u} active site(s) monitored, of which {d} by data received and {v} by declared visits).',
  // Synthèse
  'Les données reçues viennent des fiches importées (Kobo/ODK/CSV) dans « Données & indicateurs » ; un site est suivi par une visite déclarée (« Affectation & visites ») ou par des données reçues rattachées à lui ; les sites à suivre viennent du RBM. Un bureau est celui auquel le site est rattaché (Paramétrage › Bureaux).':
    'Data received comes from the forms imported (Kobo/ODK/CSV) in “Data & indicators”; a site is monitored by a declared visit (“Assignment & visits”) or by data received linked to it; sites due for monitoring come from RBM. An office is the one the site is attached to (Settings › Offices).',
  'Visites prévues suivies · sites actifs suivis · formulaires reçus': 'Planned visits monitored · active sites monitored · forms received',
  '{n} site(s) à suivre sur {t} actifs au {m} (RBM)': '{n} site(s) due for monitoring out of {t} active in {m} (RBM)',
  // Couverture par activité
  'Sites actifs de la période ; suivi = visite déclarée ou données reçues · couverture = suivis ÷ actifs · exécution = prévus suivis ÷ prévus (mois échus)':
    'Active sites of the period; monitored = declared visit or data received · coverage = monitored ÷ active · execution = planned monitored ÷ planned (past months)',
  'Suivis': 'Monitored',
  'dont par données reçues': 'of which by data received',
  'dont par visites déclarées': 'of which by declared visits',
  'Une ligne par libellé d\'activité du registre des sites : deux libellés différents restent deux lignes tant que le référentiel des activités ne les relie pas.':
    'One row per activity label of the site registry: two different labels stay two rows until the activities referential links them.',
};
