const { AppError, badRequest } = require('../../middleware/errors');
const { zipLimitsFromEnv } = require('../common/zipGuard');
const { runCpu } = require('../common/cpuPool');

/**
 * Lecture d'un fichier de soumissions (CSV, XLSX, SPSS .sav, zip Kobo) — même règle pour
 * la vérification avant import et pour l'import (tâche de fond). La lecture elle-même
 * (submissionsImport.parseSubmissions, pure) tourne sur un FIL DE CALCUL (common/cpuPool) :
 * un classeur de 5 000 lignes ne bloque plus les autres requêtes pendant 12 s ; les soumissions
 * lues reviennent par paquets (décodage réparti sur plusieurs tours de boucle).
 *
 * Erreurs : celles de la lecture gardent leur statut (400 format ou date, 413 taille ou
 * mémoire, 503 serveur occupé) ; toute autre erreur de lecture → 400 « fichier illisible ».
 * Le Buffer est TRANSFÉRÉ au fil de calcul : l'appelant ne le relit plus.
 * @param {Buffer} buffer
 * @param {{ log?: object }} [opts]
 * @returns {Promise<{ submissions: object[], headers: string[], variables: object[]|null, source: string }>}
 */
async function readSubmissionsBuffer(buffer, { log } = {}) {
  if (!buffer || !buffer.length) throw badRequest('Fichier vide.');
  let parsed;
  try {
    // Soumissions renvoyées par paquets de 250 : le fil principal ne décode jamais tout d'un bloc.
    parsed = await runCpu('parseSubmissions', [buffer, { zipLimits: zipLimitsFromEnv(process.env) }], { transfer: true, chunkField: 'submissions' });
  } catch (err) {
    if (err instanceof AppError) throw err; // 400 (format, date), 413 (taille), 503 (occupé, trop long)
    if (log) log.warn({ err }, 'import de soumissions : fichier illisible');
    throw badRequest('Fichier illisible : fournissez un CSV, XLSX, SPSS .sav ou un .zip Kobo.');
  }
  if (!parsed.submissions.length) throw badRequest('Aucune soumission trouvée dans le fichier.');
  return parsed;
}

/** Colonnes du fichier (variables SPSS si présentes) et leur nombre — même règle que l'import. */
const fileColumns = (parsed) => (parsed.variables ? parsed.variables.map((v) => v.name) : parsed.headers);

module.exports = { readSubmissionsBuffer, fileColumns };
