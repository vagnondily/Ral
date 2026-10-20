/**
 * « Formation suivie » — LA définition SQL commune (lot 8, retour 28.2) de tous les compteurs et
 * listes de formations d'un agent ou d'un TPM (fiche 360°, liste des partenaires, agents,
 * « TPM formés », Évaluation des agents, catalogue de rapports) : une participation compte quand
 * la session a eu lieu (réalisée, ou commencée : date de début passée ou du jour), n'est pas
 * annulée, et que le participant n'est pas noté absent (présence non saisie = comptée). Une session
 * planifiée À VENIR n'est jamais « suivie ».
 * @param {string} s  alias de training_sessions
 * @param {string} p  alias de training_participants
 */
const notCancelledNorAbsent = (s, p) => `${s}.status <> 'annulee' AND (${p}.attendance IS NULL OR ${p}.attendance <> 'absent')`;
const followedSql = (s, p) => `(${notCancelledNorAbsent(s, p)} AND (${s}.status = 'realisee' OR ${s}.start_date <= current_date))`;

/**
 * Frise d'un partenaire : les formations suivies ET celles à venir (affichées « prévue pour … ») —
 * ni annulées, ni absent ; la frise distingue elle-même passé et à venir par la date.
 */
const timelineTrainingSql = (s, p) => `(${notCancelledNorAbsent(s, p)})`;

module.exports = { followedSql, timelineTrainingSql };
