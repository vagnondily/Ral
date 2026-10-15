const { badRequest } = require('../../middleware/errors');
const { parseXlsformRows } = require('./xlsformImport');
const { readXls, XlsError } = require('./xlsReader');
const { sniffFile } = require('../common/fileSniff');
const { zipLimitsFromEnv } = require('../common/zipGuard');
const { loadWorkbook, isRefusal } = require('../common/xlsxGuard');
const { sheetTable } = require('../common/sheetRows');

/**
 * Lecture d'un XLSForm (définition d'un formulaire : feuilles survey / choices / settings)
 * — PURE (aucun accès à la base) : tourne sur un fil de calcul (common/cpuTasks
 * « parseXlsform »). Mêmes refus qu'avant, au mot près : format reconnu par le contenu
 * (.xlsx après la garde de décompression, .xls par le lecteur intégré), feuille survey
 * absente, aucun champ.
 * @param {Buffer} buffer
 * @param {{ zipLimits?: object }} [opts]
 * @returns {Promise<{ fields: object[], choices: object, formId: string|null, title: string|null }>}
 */
async function readXlsformBuffer(buffer, { zipLimits = zipLimitsFromEnv(process.env) } = {}) {
  if (!buffer || !buffer.length) throw badRequest('Fichier vide.');
  const sniff = sniffFile(buffer);
  if (sniff.kind !== 'ole' && sniff.kind !== 'xlsx') {
    const data = ['text', 'sav', 'zsav', 'zip'].includes(sniff.kind)
      ? ' Pour des données collectées, ouvrez la fiche puis « Importer un fichier ».' : '';
    throw badRequest(`Ce fichier n'est pas un XLSForm (format reconnu : ${sniff.label}). `
      + `Fournissez la définition du formulaire : un .xlsx ou .xls avec les feuilles « survey » et « choices ».${data}`);
  }
  let sheetRows;
  if (sniff.kind === 'ole') {
    let xls;
    try { xls = readXls(buffer); } catch (err) { throw badRequest(err instanceof XlsError ? err.message : 'Fichier .xls illisible.'); }
    const byName = new Map(Object.entries(xls.sheets).map(([k, v]) => [k.trim().toLowerCase(), v]));
    sheetRows = (name) => byName.get(name) || [];
  } else {
    let wb;
    try { wb = await loadWorkbook(buffer, { zipLimits }); }
    catch (err) { if (isRefusal(err)) throw err; throw badRequest('Fichier illisible : fournissez un XLSForm .xlsx ou .xls (feuilles survey/choices/settings).'); }
    sheetRows = (name) => {
      const ws = wb.worksheets.find((w) => w.name.trim().toLowerCase() === name);
      return ws ? sheetTable(ws) : [];
    };
  }
  const survey = sheetRows('survey');
  if (survey.length < 2) {
    throw badRequest('Feuille « survey » introuvable ou vide — ce n\'est pas un XLSForm. '
      + 'Pour des données collectées, ouvrez la fiche puis « Importer un fichier ».');
  }
  const parsed = parseXlsformRows(survey, sheetRows('choices'), sheetRows('settings'));
  if (parsed.fields.length === 0) throw badRequest('Aucun champ de données trouvé dans la feuille survey.');
  return parsed;
}

module.exports = { readXlsformBuffer };
