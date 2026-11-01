/**
 * N° AFFICHÉ d'un contrat, en SQL — jumeau de la liste des contrats : contracts.service renvoie
 * `reference = contracts.domain.displayReference(numero_fla, amendment_count)` (n° FLA suivi du code de
 * son dernier avenant, « …-AM03 »), et l'écran affiche `reference || numeroFla || numero`
 * (web/src/lib/roles.contractNo d'une ligne de contrat ; alertsMath.shownNo). Un n° FLA vide compte comme
 * absent (« !numeroFla » en JS). Parité vérifiée en base (test/tpmReportsCrossDb.test.js).
 * @param {string} c  alias de contracts
 */

/** Référence du contrat (n° FLA + code d'avenant), NULL sans n° FLA — la colonne `reference` de la liste. */
const contractReferenceSql = (c = 'c') => `(CASE WHEN NULLIF(${c}.numero_fla, '') IS NULL THEN NULL
    WHEN COALESCE(${c}.amendment_count, 0) > 0
      THEN ${c}.numero_fla || '-AM' || lpad(${c}.amendment_count::text, GREATEST(2, length(${c}.amendment_count::text)), '0')
    ELSE ${c}.numero_fla END)`;

/** N° affiché : la référence, sinon le n° interne CTR-… (jamais le CTR-… quand un n° FLA existe). */
const contractShownNoSql = (c = 'c') => `COALESCE(${contractReferenceSql(c)}, ${c}.numero)`;

module.exports = { contractReferenceSql, contractShownNoSql };
