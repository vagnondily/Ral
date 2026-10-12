/**
 * Définition UNIQUE du « Réalisé » d'un budget de suivi : la part bailleur des
 * factures (rapports financiers) VALIDÉES. Une facture soumise est « en attente
 * de validation » : montrée à part, jamais additionnée au Réalisé. Utilisée par
 * la fiche contrat, son onglet Prévision, la consolidation et ses dérivés
 * (tableaux de bord, alertes, rapports) — tous affichent le même montant.
 * (Le cumul imprimé SUR une facture compte, lui, les factures émises : c'est
 * un document, pas un indicateur de consommation.)
 */
const REALISED_STATUS = 'valide';
const PENDING_STATUS = 'soumis';

module.exports = { REALISED_STATUS, PENDING_STATUS };
