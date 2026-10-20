/**
 * « Formation suivie » — LA définition SQL commune (lot 8, retour 28.2) de tous les compteurs et
 * listes de formations d'un agent ou d'un TPM (fiche 360°, liste des partenaires, agents, frise,
 * Évaluation des agents, catalogue de rapports) : une participation compte quand la session n'est
 * pas annulée et que le participant n'est pas noté absent (présence non saisie = comptée).
 * @param {string} s  alias de training_sessions
 * @param {string} p  alias de training_participants
 */
const followedSql = (s, p) => `(${s}.status <> 'annulee' AND (${p}.attendance IS NULL OR ${p}.attendance <> 'absent'))`;

module.exports = { followedSql };
