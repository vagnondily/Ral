// Dictionnaire anglais — retour 113 : glossaire des rôles (titulaire / partenaire de mise en œuvre /
// TPM), identité des contrats « n° · titulaire », espace « Partenaires & TPM » à onglets, fiche 360°
// selon le rôle, référentiel de Paramétrage › Partenaires. Clé = phrase française exacte.
export default {
  // Glossaire (web/src/lib/roles.js)
  'Titulaire': 'Holder',
  'Titulaires': 'Holders',
  'Type de titulaire': 'Holder type',
  'Partenaire de mise en œuvre': 'Implementing partner',
  'Partenaires de mise en œuvre': 'Implementing partners',
  'TPM — tierce partie de suivi': 'TPM — third-party monitor',
  'Tous les titulaires': 'All holders',
  'Aucun TPM rattaché': 'No TPM attached',
  'Suivi interne (équipe S&E) : aucun TPM rattaché à ce contrat.': 'Internal monitoring (M&E team): no TPM attached to this contract.',
  'Interne — suivi par l\'équipe S&E tant qu\'aucun TPM n\'est rattaché (un TPM l\'est dès qu\'il a un plan de collecte ou une facture sur ce contrat).': 'Internal — monitored by the M&E team until a TPM is attached (a TPM is attached as soon as it has a collection plan or an invoice on this contract).',
  'Autres partenaires': 'Other partners',
  'Liste des partenaires': 'Partner list',
  'Rôle des partenaires': 'Partner roles',

  // Liste « Partenaires & TPM »
  'Aucun contrat actif': 'No active contract',
  '+{n} autre(s)': '+{n} more',
  'Nom, sigle, n° FLA…': 'Name, acronym, FLA no.…',
  'Les partenaires de mise en œuvre tiennent les contrats (FLA) et mettent le programme en œuvre sur les sites ; les TPM (tierces parties de suivi) suivent cette mise en œuvre. Ouvrez une ligne pour voir la fiche complète.':
    'Implementing partners hold the contracts (FLA) and implement the programme at the sites; TPMs (third-party monitors) monitor that implementation. Open a row to see the full profile.',
  '{n} contrat(s) actif(s)': '{n} active contract(s)',
  'dont {n} actif(s) selon contrat': '{n} active under contract',
  'Agents des TPM': 'TPM agents',
  'Aucun partenaire de mise en œuvre': 'No implementing partner',
  'Créez dans Paramétrage › Partenaires les partenaires qui tiennent les contrats (type « Partenaire de mise en œuvre »).':
    'Create in Settings › Partners the partners who hold the contracts (type “Implementing partner”).',
  'Créez dans Paramétrage › Partenaires les tierces parties de suivi (type « TPM »), puis leurs agents dans leur fiche.':
    'Create in Settings › Partners the third-party monitors (type “TPM”), then their agents in their profile.',
  'Aucun autre partenaire': 'No other partner',

  // Contrats : identité, TPM, zones
  '{n} zone(s) d\'intervention du contrat': '{n} contract area(s)',
  'Zones d\'intervention du contrat': 'Contract areas',
  'un TPM est rattaché dès qu\'il a un plan de collecte ou une facture sur ce contrat.': 'a TPM is attached as soon as it has a collection plan or an invoice on this contract.',
  'Le partenaire qui signe le contrat (partenaire de mise en œuvre, ou TPM pour son propre contrat). Configuré dans Paramétrage › Partenaires.':
    'The partner who signs the contract (an implementing partner, or a TPM for its own contract). Configured in Settings › Partners.',
  'son propre contrat': 'its own contract',
  'plan de collecte': 'collection plan',
  'factures et rapports': 'invoices and reports',
  'suit les {n} zones du contrat': 'monitors the {n} contract areas',
  'suit la zone du contrat': 'monitors the contract area',
  'Aucun TPM n\'est rattaché à ce contrat par un plan de collecte ou une facture.': 'No TPM is attached to this contract by a collection plan or an invoice.',
  'Titulaire, TPM, FLA, PO, Vendor…': 'Holder, TPM, FLA, PO, Vendor…',
  'Contrat · titulaire': 'Contract · holder',
  'Titulaire · TPM': 'Holder · TPM',
  'TPM : {names}': 'TPM: {names}',
  'N° interne : {n}': 'Internal no.: {n}',

  // Consolidation, Reporting
  'Vue d\'ensemble par contrat de suivi : le Budget de suivi (ligne IV du contrat), le Planifié et le Réalisé (plans de collecte et factures du TPM) réunis pour suivre la consommation, les écarts et la projection de fin de contrat.':
    'Overview by monitoring contract: the monitoring Budget (line IV of the contract), the Planned and the Actual (the TPM’s collection plans and invoices) side by side to follow consumption, variances and the end-of-contract projection.',
  '{n} contrat(s) en dépassement ou en projection de dépassement du budget de suivi : {names}.': '{n} contract(s) over or projected over the monitoring budget: {names}.',
  'Vue d\'ensemble par contrat': 'Overview by contract',
  'Montants par mois et par contrat, sur la période choisie ({p}).': 'Amounts by month and by contract, over the selected period ({p}).',
  'Montants par mois et par contrat, sur la période des contrats.': 'Amounts by month and by contract, over the contract period.',
  '= plans de collecte et factures du TPM. Tout est recalculé en direct depuis les contrats, les plans et les factures.':
    '= the TPM’s collection plans and invoices. Everything is recomputed live from the contracts, plans and invoices.',

  // Suivi de processus
  'Jours de collecte d\'un TPM = visites datées non annulées + jours de déplacement saisis.': 'Collection days of a TPM = dated, non-cancelled visits + entered travel days.',
  'Exécution des visites déclarées par TPM': 'Declared-visit execution by TPM',
  'Combien de sites sont couverts, par niveau de risque (MMR), par programme et par TPM. Recalculé en direct depuis les sites et les visites.':
    'How many sites are covered, by risk level (MMR), by programme and by TPM. Recomputed live from sites and visits.',
  'Part des visites réalisées (vs planifiées + réalisées), par TPM, mois par mois.': 'Share of visits done (vs planned + done), by TPM, month by month.',
  'Exécution du plan par TPM et par mois : visites réalisées ÷ (prévues + réalisées). « — » = aucune visite.': 'Plan execution by TPM and by month: visits done ÷ (planned + done). “—” = no visit.',
  '{n} partenaire(s)': '{n} partner(s)',
  'Ce partenaire n\'est pas sélectionnable en {m} (ni sous contrat de suivi, ni TPM actif).': 'This partner cannot be selected in {m} (neither under a monitoring contract nor an active TPM).',
  'Visites exigées par le MMR, faites, prévues et restantes, avec le TPM affecté.': 'Visits required by the MMR, done, planned and remaining, with the assigned TPM.',
  'TPM désactivé': 'TPM deactivated',
  'Capacité insuffisante du TPM': 'Insufficient TPM capacity',
  'Autres TPM (hors contrat)': 'Other TPMs (outside contract)',

  // Paramétrage › Partenaires
  'Utilisée pour les montants des contrats': 'Used for contract amounts',
  'Le référentiel : nom et type de chaque partenaire — partenaires de mise en œuvre (titulaires des contrats), TPM (tierces parties de suivi) et autres. Fiche complète, agents des TPM et évaluations : Partenaires & TPM.':
    'The reference list: name and type of each partner — implementing partners (contract holders), TPMs (third-party monitors) and others. Full profile, TPM agents and evaluations: Partners & TPM.',
  'Ouvrir la fiche': 'Open profile',
  'Partenaire {name} mis à jour.': 'Partner {name} updated.',
  'Modifier le partenaire — {name}': 'Edit partner — {name}',
  'Changer le type change le rôle du partenaire partout : un TPM suit des contrats et a des agents ; un partenaire de mise en œuvre tient des contrats.':
    'Changing the type changes the partner’s role everywhere: a TPM monitors contracts and has agents; an implementing partner holds contracts.',
  'Partenaire actif (proposé dans les listes de choix)': 'Active partner (offered in pick lists)',
  'Catégorisation des partenaires. Ex. partenaire de mise en œuvre, TPM, cabinet.': 'Partner categories. E.g. implementing partner, TPM, firm.',
  'Catégories de partenaire (partenaire de mise en œuvre, TPM, cabinet…).': 'Partner categories (implementing partner, TPM, firm…).',

  // Formations, évaluation, rapports, planification
  'Agent, TPM…': 'Agent, TPM…',
  'Saisissez d\'abord les agents dans la fiche de chaque TPM (Partenaires & TPM).': 'First enter the agents in each TPM’s profile (Partners & TPM).',
  'Les sessions de formation des agents TPM : thèmes couverts, TPM et agents participants, présence, résultats des tests et avis des participants.':
    'Training sessions for TPM agents: themes covered, participating TPMs and agents, attendance, test results and participant feedback.',
  'TPM formés': 'TPMs trained',
  'Formation, thème, TPM…': 'Training, theme, TPM…',
  'Budget prévisionnel des vagues de collecte : postes prévus par TPM et contrat. La part bailleur alimente le « Planifié » de la consolidation et sert de base à la facture.':
    'Provisional budget of the collection rounds: planned items by TPM and contract. The funder share feeds the consolidation’s “Planned” and is the basis of the invoice.',
  'TPM, contrat…': 'TPM, contract…',
  'Rapports financiers (facture / état des dépenses) et techniques des TPM, rattachés au budget mensuel du suivi. Le « Réalisé » validé alimente la consommation du contrat.':
    'Financial (invoice / statement of expenditure) and technical reports of the TPMs, linked to the monthly monitoring budget. The validated “Actual” feeds the contract’s consumption.',
  'Enregistrez les rapports financiers (facture) et techniques des TPM pour ce mois.': 'Record the TPMs’ financial (invoice) and technical reports for this month.',
  'Choisissez le contrat et le TPM.': 'Choose the contract and the TPM.',
  'Le rapport repassera à corriger côté TPM.': 'The report will go back to the TPM for correction.',
  '{n} TPM': '{n} TPM(s)',
  'Sans TPM': 'No TPM',
  'TPM et agents participants': 'Participating TPMs and agents',
  'Aucun participant pour l\'instant. Ajoutez les agents d\'un TPM.': 'No participant yet. Add the agents of a TPM.',

  // Fiche 360° selon le rôle
  'Retour aux partenaires': 'Back to partners',
  'Modifier le partenaire': 'Edit partner',
  'Partenaire mis à jour.': 'Partner updated.',
  'Évaluer le TPM': 'Evaluate the TPM',
  'Budget suivi des contrats suivis': 'Monitoring budget of monitored contracts',
  '{n} contrat(s) suivi(s)': '{n} monitored contract(s)',
  'Réalisé validé (ce TPM)': 'Validated actual (this TPM)',
  'Réalisé (ce TPM)': 'Actual (this TPM)',
  'Note du TPM': 'TPM score',
  '{n} contrat(s) comme titulaire': '{n} contract(s) as holder',
  'Payé au TPM sur facture validée': 'Paid to the TPM on validated invoices',
  'Réalisé validé (TPM)': 'Validated actual (TPM)',
  '{p} % du budget suivi': '{p} % of the monitoring budget',
  'Sections du partenaire': 'Partner sections',
  'rattaché par : {v}': 'attached by: {v}',
  'Voir le détail des contrats': 'See contract details',
  'Aucun contrat rattaché à ce partenaire (titulaire, plan de collecte, rapport ou visite).': 'No contract attached to this partner (holder, collection plan, report or visit).',
  'Consommation du budget suivi (tous TPM)': 'Monitoring budget consumption (all TPMs)',
  'Plans, factures et rapports': 'Plans, invoices and reports',
  'Contrats et TPM': 'Contracts and TPMs',
  'Ce TPM ne suit encore aucun contrat : il y est rattaché dès son premier plan de collecte ou sa première facture.':
    'This TPM does not monitor any contract yet: it is attached at its first collection plan or invoice.',
  'Aucun contrat comme titulaire.': 'No contract as holder.',
  'Aucun rapport enregistré pour ce TPM.': 'No report recorded for this TPM.',
  'Aucun rapport sur les contrats de ce partenaire.': 'No report on this partner’s contracts.',
  'Aucun agent enregistré pour ce TPM.': 'No agent recorded for this TPM.',
  'Un partenaire est rattaché à un contrat comme titulaire, ou — pour un TPM — par un plan de collecte, une facture ou une visite qui porte ce contrat.':
    'A partner is attached to a contract as its holder, or — for a TPM — by a collection plan, an invoice or a visit on that contract.',
  '« Couvre ce mois » : le contrat est actif et sa période inclut le mois courant — le partenaire est alors sélectionnable partout (plan de suivi, formations, évaluations, rapports).':
    '“Covers this month”: the contract is active and its period includes the current month — the partner can then be selected everywhere (monitoring plan, trainings, evaluations, reports).',
  'Grille d\'appréciation du TPM et moyenne des notes de ses agents sur la période.': 'Appraisal grid of the TPM and average score of its agents over the period.',
  'À la validation, la note du TPM combinera la grille ({g} %) et la moyenne de ses {n} agent(s) notés sur la période ({q} %) : aperçu {score}.':
    'On validation, the TPM score will combine the grid ({g} %) and the average of its {n} scored agent(s) over the period ({q} %): preview {score}.',
  'Aucun agent de ce TPM n\'a de note sur la période : la note du TPM sera celle de la grille.': 'No agent of this TPM has a score over the period: the TPM score will be the grid score.',
  'Grille du TPM : {s}': 'TPM grid: {s}',
  'Aucun formulaire relié à ce partenaire': 'No form linked to this partner',
  'Un formulaire reçu est relié au partenaire par la colonne « partenaire » de la fiche (Données & indicateurs › Mapping MEMS › Correspondances).':
    'A received form is linked to the partner by the form’s “partner” column (Data & indicators › MEMS mapping › Correspondences).',
  'Type de document': 'Document type',
  'Tous les rapports': 'All reports',
  'Ouvrir Planification & budget': 'Open Planning & budget',
  'Aucun plan de collecte': 'No collection plan',
  'Les plans de collecte (budget prévisionnel du suivi) apparaîtront ici dès leur enregistrement.': 'Collection plans (provisional monitoring budget) will appear here once recorded.',
  'Plans de collecte': 'Collection plans',
  'Les factures et rapports techniques de ce TPM apparaîtront ici dès leur enregistrement.': 'This TPM’s invoices and technical reports will appear here once recorded.',
  'Les factures et rapports techniques des TPM sur les contrats de ce partenaire apparaîtront ici.': 'The TPMs’ invoices and technical reports on this partner’s contracts will appear here.',
  'Formations suivies par les agents de ce TPM.': 'Trainings attended by this TPM’s agents.',
  'Aucun agent de ce TPM n\'a encore participé à une formation.': 'No agent of this TPM has attended a training yet.',

  // Phrases du serveur (alertes, santé du paramétrage, carte, concepteur de rapport, erreurs)
  'Sites planifiés sans TPM ce mois': 'Sites planned without a TPM this month',
  'Sites planifiés sans TPM ({m})': 'Sites planned without a TPM ({m})',
  'Sites planifiés sans TPM sur la période': 'Sites planned without a TPM over the period',
  '{n} TPM actif(s).': '{n} active TPM(s).',
  'Aucun TPM (tierce partie de suivi) actif.': 'No active TPM (third-party monitor).',
  '{n} TPM sans agent.': '{n} TPM(s) without agents.',
  'Chaque TPM a des agents.': 'Every TPM has agents.',
  '{n} TPM sans contrat actif.': '{n} TPM(s) without an active contract.',
  'Chaque TPM a un contrat actif.': 'Every TPM has an active contract.',
  '{n} contrat(s) actif(s) de TPM sans poste « IV. Suivi » : ils n\'apparaissent pas dans le suivi budgétaire.':
    '{n} active TPM contract(s) without an “IV. Monitoring” item: they do not appear in budget tracking.',
  '{n} visite(s) sans TPM': '{n} visit(s) without a TPM',
  'Ce partenaire n\'est pas sélectionnable au mois de la visite (ni titulaire d\'un contrat de suivi, ni TPM actif).':
    'This partner cannot be selected in the visit month (neither holder of a monitoring contract nor an active TPM).',
  'Un plan existe déjà pour ce TPM, ce contrat et ce mois.': 'A plan already exists for this TPM, contract and month.',
  'Choisissez des agents ou un TPM.': 'Choose agents or a TPM.',
  'Ce code d\'enquêteur est déjà utilisé par un autre agent de ce TPM.': 'This enumerator code is already used by another agent of this TPM.',
  'TPM inconnu.': 'Unknown TPM.',
  'Réalisé par titulaire': 'Actual by holder',
  'Réalisé par titulaire — {p}': 'Actual by holder — {p}',
  'Répartition du réalisé par titulaire': 'Actual broken down by holder',
  'titulaires': 'holders',
  'Visites par TPM': 'Visits by TPM',
  'Matrice mensuelle par programme ou TPM': 'Monthly matrix by programme or TPM',
  'Programme ou TPM': 'Programme or TPM',
  'Jours de collecte par TPM': 'Collection days by TPM',
  'Partenaires & TPM › Fiche du partenaire': 'Partners & TPM › Partner profile',
  'TPM (agents, formations)': 'TPMs (agents, trainings)',

  // Écrans du lot design (Planification & budget, facture, Affectation & visites) : phrases du
  // glossaire qu'ils prennent à la fusion du lot 8 (renommage fait par la session principale).
  'Liste des TPM indisponible : {e}': 'TPM list unavailable: {e}',
  'Autres TPM': 'Other TPMs',
  'Rechercher un TPM…': 'Search a TPM…',
  'Choisissez un TPM.': 'Select a TPM.',
  'Choisissez d\'abord le TPM et le contrat.': 'Select the TPM and the contract first.',
  'Aucun plan de collecte de ce TPM pour ce contrat et ce mois.': 'No collection plan from this TPM for this contract and month.',
  'Ce TPM n\'est pas celui de ce contrat ({p}) : vérifiez le couple TPM × contrat.':
    'This TPM is not the one of this contract ({p}): check the TPM × contract pair.',
  'Aucun site affecté à ce TPM pour ce mois : affectez les visites dans « Suivi de processus › Affectation & visites » ; elles justifieront ce budget.':
    'No site assigned to this TPM for this month: assign the visits in “Process monitoring › Assignment & visits”; they will justify this budget.',
  'Exécution du plan par TPM': 'Plan execution by TPM',
  'Jours de visite = visites datées ; + jours de déplacement (saisie manuelle) = total des jours à budgéter par TPM.':
    'Visit days = dated visits; + travel days (manual entry) = total days to budget per TPM.',
  "L'écran unique du suivi terrain : planifiez les visites du mois (depuis le RBM), affectez les TPM, suivez les jours/budget, la couverture et les données réelles. Choisissez un mois pour ouvrir son plan.":
    "The single field-monitoring screen: plan the month's visits (from the RBM), assign the TPMs, track days/budget, coverage and actual data. Choose a month to open its plan.",
  "Les sites à visiter ce mois (district › commune › établissement › activité) : affectez le TPM et le rôle, datez les visites ; les onglets couvrent le budget-jours, la couverture et les données réelles.":
    'Sites to visit this month (district › commune › facility › activity): assign the TPM and role, date the visits; the tabs cover the days-based budget, coverage and actual data.',
};
