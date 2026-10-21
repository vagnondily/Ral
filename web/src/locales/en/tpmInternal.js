// Dictionnaire anglais — retour 114 : suivi interne (« Interne », équipe S&E), indisponibilités des TPM,
// rapports attendus (non applicable d'office, rapport interne). Clé = phrase française exacte.
export default {
  // Pourquoi « Interne » (lib/tpmAttribution.js)
  'aucun contrat de suivi': 'no monitoring contract',
  'contrat sans TPM': 'contract without a TPM',
  'TPM indisponible': 'TPM unavailable',
  'décidé, avec une raison': 'decided, with a reason',
  'contrat sans TPM : {c}': 'contract without a TPM: {c}',
  'contrat de suivi sans TPM': 'monitoring contract without a TPM',
  'TPM indisponible : {list}': 'TPM unavailable: {list}',
  'TPM du contrat indisponible ce mois': 'contract TPM unavailable this month',
  'décidé : {r}': 'decided: {r}',
  'aucun contrat de suivi sur la zone': 'no monitoring contract on the area',
  'aucun contrat de suivi sur cette zone ({m})': 'no monitoring contract on this area ({m})',
  'Suivi interne (équipe S&E) : aucun TPM retenu pour cette zone ce mois-là. Pour la confier à un TPM : onglet Affectation des TPM.':
    'Internal monitoring (M&E team): no TPM retained for this area that month. To give it to a TPM: TPM assignment tab.',
  'Modification suspendue (TPM indisponible)': 'Change suspended (TPM unavailable)',
  'Un TPM du contrat est indisponible': 'A contract TPM is unavailable',
  'Interne — aucun contrat de suivi': 'Internal — no monitoring contract',
  'Interne — contrat sans TPM': 'Internal — contract without a TPM',
  'Interne — TPM indisponible': 'Internal — TPM unavailable',
  'Interne — décidé pour la zone': 'Internal — decided for the area',
  'Interne — district inconnu': 'Internal — unknown district',
  'Interne — choisi pour cette visite': 'Internal — chosen for this visit',
  'Interne (équipe S&E)': 'Internal (M&E team)',
  '— Interne (équipe S&E) —': '— Internal (M&E team) —',
  'Interne (équipe S&E) ces mois-là': 'Internal (M&E team) for those months',
  'Suivi interne': 'Internal monitoring',
  'indisponible : {m}': 'unavailable: {m}',
  'Équipe S&E : aucun TPM sur la zone': 'M&E team: no TPM on the area',
  'Interne : l\'équipe S&E suit la zone {z} ce mois ({w}). Pour la confier à un TPM, utilisez l\'onglet Affectation des TPM.':
    'Internal: the M&E team monitors area {z} this month ({w}). To give it to a TPM, use the TPM assignment tab.',
  'Ce partenaire n\'est pas sélectionnable en {m} : ce n\'est pas un TPM actif, ou il est déclaré indisponible.':
    'This partner cannot be selected in {m}: it is not an active TPM, or it is declared unavailable.',
  'Règle : le TPM d\'un site est celui du contrat de suivi actif qui couvre son district (ou sa commune) ce mois-là — le TPM qui facture sur ce contrat, sinon son titulaire s\'il est lui-même un TPM ; sans TPM, le suivi est interne (équipe S&E) ; une modification exige une raison.':
    'Rule: a site\'s TPM is the one of the active monitoring contract covering its district (or commune) that month — the TPM invoicing on that contract, otherwise its holder if it is itself a TPM; without a TPM, monitoring is internal (M&E team); any change requires a reason.',
  'Pour la confier à un TPM : ajoutez cette zone aux zones d\'intervention d\'un contrat de suivi actif qui a un TPM (Contrats), ou choisissez un TPM avec une raison (onglet Affectation des TPM, ou crayon d\'une visite).':
    'To give it to a TPM: add this area to the contract areas of an active monitoring contract that has a TPM (Contracts), or choose a TPM with a reason (TPM assignment tab, or a visit\'s pencil).',
  'Le TPM de chaque visite vient du contrat de suivi qui couvre la zone du site ce mois-là : rien à saisir. Sans TPM (aucun contrat, contrat sans TPM, TPM indisponible), la visite est suivie en interne par l\'équipe S&E. Un autre TPM se motive (crayon).':
    'Each visit\'s TPM comes from the monitoring contract covering the site\'s area that month: nothing to enter. Without a TPM (no contract, contract without a TPM, TPM unavailable), the visit is monitored internally by the M&E team. Another TPM must be justified (pencil).',

  // Onglet « Affectation des TPM »
  'Pourquoi interne': 'Why internal',
  'Indisponibilités': 'Unavailability',
  'Par défaut, le TPM d\'une zone est celui du contrat de suivi qui la couvre ce mois-là (le TPM qui facture sur ce contrat, sinon son titulaire s\'il est lui-même un TPM). Sans TPM — aucun contrat, contrat sans TPM, TPM indisponible — la zone est suivie en interne par l\'équipe S&E. Tout changement exige une raison et reste au journal ; les visites prévues reprennent le TPM de leur zone.':
    'By default, an area\'s TPM is the one of the monitoring contract covering it that month (the TPM invoicing on that contract, otherwise its holder if it is itself a TPM). Without a TPM — no contract, contract without a TPM, TPM unavailable — the area is monitored internally by the M&E team. Every change requires a reason and stays in the log; planned visits take their area\'s TPM.',
  'Sites en suivi interne ({m})': 'Sites under internal monitoring ({m})',
  'équipe S&E : aucun TPM sur leur zone': 'M&E team: no TPM on their area',
  '{n} contrat(s) de suivi sans TPM (aucun plan de collecte ni facture d\'un TPM, titulaire qui n\'est pas un TPM) : leurs zones sont suivies en interne par l\'équipe S&E, sauf si un autre contrat y a un TPM.':
    '{n} monitoring contract(s) without a TPM (no TPM collection plan or invoice, holder that is not a TPM): their areas are monitored internally by the M&E team, unless another contract has a TPM there.',
  '{n} site(s) sans district reconnu n\'héritent d\'aucun TPM : suivis en interne tant qu\'ils ne sont pas rapprochés.':
    '{n} site(s) without a recognised district inherit no TPM: monitored internally until they are matched.',

  // Indisponibilités des TPM (TpmUnavailabilityView)
  'Disponible': 'Available',
  'Indisponible': 'Unavailable',
  'TPM déclaré indisponible': 'TPM declared unavailable',
  'Motif d\'indisponibilité modifié': 'Unavailability reason changed',
  'Fin d\'indisponibilité': 'End of unavailability',
  'Équipe mobilisée sur une autre mission': 'Team assigned to another mission',
  'Contrat du TPM suspendu': 'TPM contract suspended',
  'Le': 'On',
  'Un TPM indisponible ne suit plus ses zones pendant ces mois : la zone passe à l\'autre TPM de son contrat s\'il y en a un, sinon en suivi interne (équipe S&E). Les visites prévues suivent ; les visites réalisées, annulées ou déjà facturées ne changent jamais.':
    'An unavailable TPM no longer monitors its areas during those months: the area goes to the other TPM of its contract if there is one, otherwise to internal monitoring (M&E team). Planned visits follow; done, cancelled or already invoiced visits never change.',
  'Déclarer une indisponibilité…': 'Declare unavailability…',
  'Aucune indisponibilité': 'No unavailability',
  'Aucun TPM n\'est déclaré indisponible de {p}. Les zones suivent leurs contrats.': 'No TPM is declared unavailable in {p}. Areas follow their contracts.',
  'Changer le motif…': 'Change the reason…',
  'Changer le motif · {p}': 'Change the reason · {p}',
  'Mettre fin…': 'End…',
  'Mettre fin · {p}': 'End · {p}',
  'Rien à enregistrer : ces mois sont déjà dans cet état.': 'Nothing to save: these months are already in that state.',
  'Enregistré : {m} mois, {v} visite(s) prévue(s) mise(s) à jour.': 'Saved: {m} month(s), {v} planned visit(s) updated.',
  'Mettre fin à l\'indisponibilité': 'End the unavailability',
  'Changer le motif d\'indisponibilité': 'Change the unavailability reason',
  'Déclarer un TPM indisponible': 'Declare a TPM unavailable',
  'Mettre fin': 'End',
  '{n} mois redeviennent disponibles.': '{n} month(s) become available again.',
  '{n} mois deviennent indisponibles.': '{n} month(s) become unavailable.',
  '{n} mois déjà indisponibles changent de motif.': '{n} month(s) already unavailable change reason.',
  '{n} mois portent déjà ce motif.': '{n} month(s) already carry this reason.',
  '{n} mois n\'étaient pas indisponibles.': '{n} month(s) were not unavailable.',
  '{n} zone-mois reviennent à ce TPM.': '{n} area-month(s) go back to this TPM.',
  '{i} zone-mois passent en suivi interne (équipe S&E), {o} à un autre TPM du contrat.': '{i} area-month(s) go to internal monitoring (M&E team), {o} to another TPM of the contract.',
  'Pourquoi y mettre fin ? Ex. équipe de retour, contrat repris…': 'Why end it? E.g. team back, contract resumed…',
  'Facultative : la fin est journalisée avec le motif d\'origine.': 'Optional: the end is logged with the original reason.',
  'Pourquoi ce TPM est-il indisponible ? Ex. équipe mobilisée ailleurs, contrat suspendu…': 'Why is this TPM unavailable? E.g. team assigned elsewhere, contract suspended…',
  'Suggestions de motif': 'Reason suggestions',
  'Les indisponibilités de ce TPM ont changé entre-temps : l\'aperçu a été relu, vérifiez-le puis enregistrez.':
    'This TPM\'s unavailability changed in the meantime: the preview was reloaded, check it then save.',

  // Rapports attendus (pages/tpm/ExpectedReports.jsx, lib/reportExpectation.js)
  'En retard': 'Late',
  'Non applicable d\'office': 'Not applicable (automatic)',
  'Rapport interne attendu': 'Internal report expected',
  '{i} — équipe S&E ({o})': '{i} — M&E team ({o})',
  '{i} — équipe S&E': '{i} — M&E team',
  'aucune visite planifiée ce mois': 'no visit planned this month',
  'TPM déclaré indisponible ce mois': 'TPM declared unavailable this month',
  'déclaré non applicable': 'declared not applicable',
  'à remettre au plus tard en {due}': 'due by {due} at the latest',
  'échéance dépassée ({due})': 'deadline passed ({due})',
  'à produire par l\'équipe S&E': 'to be produced by the M&E team',
  'Rapports attendus': 'Expected reports',
  'Un TPM sans visite planifiée un mois n\'a pas de rapport à remettre (non applicable d\'office) ; quand l\'équipe S&E suit elle-même des visites, un rapport interne est attendu. À remettre au plus tard le mois suivant.':
    'A TPM with no planned visit in a month has no report to submit (automatically not applicable); when the M&E team monitors visits itself, an internal report is expected. Due by the following month at the latest.',
  'Afficher les non applicables d\'office': 'Show automatic not-applicable rows',
  'Rapports attendus par statut': 'Expected reports by status',
  'Aucun TPM sous contrat de suivi ni visite sur la période.': 'No TPM under a monitoring contract and no visit in the period.',
  'Factures du mois': 'Invoices of the month',
  '{p} prévue(s) · {r} réalisée(s)': '{p} planned · {r} done',

  'contrat à préciser': 'contract to be specified',
  'Aucune visite planifiée de ce TPM sur ce contrat ce mois-là : pas de rapport à remettre.': 'No visit of this TPM planned on this contract that month: no report to submit.',
  'Non affecté': 'Unassigned',

  // Centre d'alertes (server/src/modules/dashboards/alertsMath.js)
  '{month} · contrat {contract} · {n} visite(s) ; à remettre au plus tard en {due}': '{month} · contract {contract} · {n} visit(s); due by {due} at the latest',
  'Rapports en retard : sans période choisie, les {n} derniers mois (mois courant compris).': 'Late reports: with no period chosen, the last {n} months (current month included).',
  'Rapport en retard — {provider}': 'Late report — {provider}',
  '{month} · {n} visite(s) ; à remettre au plus tard en {due}': '{month} · {n} visit(s); due by {due} at the latest',
  'Retard de visites — suivi interne (équipe S&E)': 'Visits behind schedule — internal monitoring (M&E team)',
  // Vue Indisponibilités (U3 à U8)
  'Indisponibilités qui touchent {p}.': 'Unavailability periods that overlap {p}.',
  'Plage limitée à {n} mois : choisissez une période plus courte pour voir au-delà.': 'Range limited to {n} months: choose a shorter period to see further.',
  'plus TPM actif': 'no longer an active TPM',
  '{n} (plus TPM actif)': '{n} (no longer an active TPM)',
  'Ce partenaire n\'est plus un TPM actif : on peut seulement mettre fin à son indisponibilité.': 'This partner is no longer an active TPM: its unavailability can only be ended.',
  'Retirer cette indisponibilité (mois passés)…': 'Withdraw this unavailability (past months)…',
  'Retirer · {p}': 'Withdraw · {p}',
  'Retirer l\'indisponibilité': 'Withdraw the unavailability',
  'Déclarée par erreur ? Ex. mois saisis par erreur, TPM finalement disponible…': 'Declared by mistake? E.g. months entered by mistake, TPM available after all…',
  // Relecture croisée (D-b) : partenaire qui n'est plus un TPM
  'ce partenaire n\'est plus un TPM': 'this partner is no longer a TPM',
  // Relecture croisée (D-c) : facture d'un TPM déclaré indisponible
  'Ce TPM est déclaré indisponible en {m} : la facture reste possible si le travail a bien été fait — vérifiez avant de la soumettre.':
    'This TPM is declared unavailable in {m}: the invoice is still possible if the work was actually done — check before submitting it.',
};
