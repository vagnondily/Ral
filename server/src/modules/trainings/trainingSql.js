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
/** La session a eu lieu : réalisée, ou commencée (début passé ou du jour). Une seule expression. */
const heldSql = (s) => `(${s}.status = 'realisee' OR ${s}.start_date <= current_date)`;
const followedSql = (s, p) => `(${notCancelledNorAbsent(s, p)} AND ${heldSql(s)})`;

/**
 * Frise d'un partenaire : les formations suivies ET celles à venir — ni annulées, ni absent ; le
 * libellé (« suivie par » / « prévue pour ») suit heldSql, la MÊME règle que les compteurs : une
 * session « réalisée » datée dans le futur est « suivie » partout.
 */
const timelineTrainingSql = (s, p) => `(${notCancelledNorAbsent(s, p)})`;

module.exports = { followedSql, timelineTrainingSql, heldSql };
