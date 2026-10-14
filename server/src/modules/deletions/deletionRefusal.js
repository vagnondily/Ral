/**
 * Erreur HTTP d'un refus de suppression (retour n° 56) : statut, message FR et
 * détails tirés de la politique commune (common/deletionPolicy). Le détail
 * `{ reason, linked | min }` permet à l'écran d'afficher un message traduit et
 * la liste des données reliées.
 */
const { AppError } = require('../../middleware/errors');
const { refusalStatus, refusalMessage, refusalDetails } = require('../common/deletionPolicy');

/**
 * @param {string} reason  code de refus de decideDocumentDeletion
 * @param {object} [o]
 * @param {string} [o.subject]  « ce contrat », « ce plan de collecte »…
 * @param {{key:string,count:number,label:string}[]} [o.linked]
 * @param {string} [o.hint]
 */
function deletionRefusal(reason, { subject, linked = [], hint } = {}) {
  return new AppError(
    refusalStatus(reason),
    refusalMessage(reason, { subject, linked, hint }),
    refusalDetails(reason, linked)
  );
}

module.exports = { deletionRefusal };
