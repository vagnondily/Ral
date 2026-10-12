/**
 * Garde de décompression — logique pure, sans I/O, testée.
 *
 * Un zip de quelques Mo peut contenir des centaines de Mo (l'export SPSS de
 * l'enquête CP : 9,6 Mo → data.sav de 216 Mo), assez pour saturer la mémoire
 * et arrêter l'API pour tous les utilisateurs. On décide donc AVANT de
 * décompresser, à partir des tailles DÉCLARÉES dans le répertoire central
 * (`fileSniff.zipEntries`). C'est suffisant : adm-zip plafonne ensuite chaque
 * décompression à la taille déclarée de l'entrée — une entrée qui ment sur sa
 * taille échoue au lieu de gonfler.
 *
 * Deux règles, réglables par l'environnement :
 *  - taille décompressée totale des entrées lues ≤ IMPORT_MAX_UNZIPPED_MB
 *    (150 Mo par défaut) ;
 *  - taux de compression ≤ IMPORT_MAX_ZIP_RATIO (100 par défaut), contrôlé
 *    seulement au-delà de 10 Mo décompressés : en dessous, rien ne peut nuire,
 *    et un petit fichier très répétitif reste accepté.
 */

const { badRequest, payloadTooLarge } = require('../../middleware/errors');

const MO = 1e6; // méga-octet décimal, l'unité affichée à l'utilisateur

const DEFAULT_ZIP_LIMITS = Object.freeze({ maxBytes: 150 * MO, maxRatio: 100, ratioFloorBytes: 10 * MO });

/** Limites lues dans l'environnement ; une valeur absente ou invalide garde le défaut. */
function zipLimitsFromEnv(env = {}) {
  const positive = (v, d) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n > 0 ? n : d; };
  return {
    maxBytes: positive(env.IMPORT_MAX_UNZIPPED_MB, DEFAULT_ZIP_LIMITS.maxBytes / MO) * MO,
    maxRatio: positive(env.IMPORT_MAX_ZIP_RATIO, DEFAULT_ZIP_LIMITS.maxRatio),
    ratioFloorBytes: DEFAULT_ZIP_LIMITS.ratioFloorBytes,
  };
}

/** Taille lisible, à la française : « 216 Mo », « 9,6 Mo », « 1 234 Mo ». */
function formatMo(bytes) {
  const mo = Math.max(0, Number(bytes) || 0) / MO;
  if (mo >= 100) return `${String(Math.round(mo)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Mo`;
  const r = Math.round(mo * 10) / 10;
  return `${(r === 0 && mo > 0 ? 0.1 : r).toString().replace('.', ',')} Mo`;
}

/**
 * Vérifie les entrées qu'on s'apprête à décompresser.
 * @param {Array<{name:string,size:number,compressedSize:number,isDirectory?:boolean}>} entries
 * @param {{maxBytes:number,maxRatio:number,ratioFloorBytes:number}} [limits]
 * @param {{archiveBytes?:number}} [ctx]  taille du fichier reçu, citée dans le message
 * @returns {{ok:true,totalBytes:number,ratio:number}
 *          |{ok:false,reason:'size'|'ratio',totalBytes:number,ratio:number,message:string}}
 */
function checkZipEntries(entries, limits = DEFAULT_ZIP_LIMITS, { archiveBytes } = {}) {
  const files = (entries || []).filter((e) => !e.isDirectory);
  const totalBytes = files.reduce((s, e) => s + Math.max(0, Number(e.size) || 0), 0);
  const packed = files.reduce((s, e) => s + Math.max(0, Number(e.compressedSize) || 0), 0);
  const ratio = totalBytes / Math.max(1, packed);
  const subject = files.length === 1 ? `« ${files[0].name.split('/').pop()} »` : 'son contenu';
  const from = archiveBytes ? ` (fichier reçu : ${formatMo(archiveBytes)})` : '';

  if (totalBytes > limits.maxBytes) {
    return {
      ok: false, reason: 'size', totalBytes, ratio,
      message: `Fichier trop volumineux une fois décompressé : ${subject} ferait ${formatMo(totalBytes)}${from}, `
        + `au-delà du plafond de ${formatMo(limits.maxBytes)}. Exportez une période plus courte ou moins de colonnes, puis réessayez.`,
    };
  }
  if (totalBytes > limits.ratioFloorBytes && ratio > limits.maxRatio) {
    return {
      ok: false, reason: 'ratio', totalBytes, ratio,
      message: `Archive refusée par sécurité : ${subject} se décompresse ${Math.round(ratio)} fois (${formatMo(totalBytes)}${from}), `
        + `bien au-delà d'un export normal (${limits.maxRatio} fois au plus). Réexportez le fichier depuis Kobo ou Ona.`,
    };
  }
  return { ok: true, totalBytes, ratio };
}

/**
 * Même contrôle, sous forme d'erreur HTTP prête à lever : 413 si le contenu
 * décompressé dépasse le plafond, 400 si le taux de compression est suspect.
 */
function assertZipEntries(entries, limits = DEFAULT_ZIP_LIMITS, ctx = {}) {
  const verdict = checkZipEntries(entries, limits, ctx);
  if (verdict.ok) return verdict;
  throw verdict.reason === 'size' ? payloadTooLarge(verdict.message) : badRequest(verdict.message);
}

module.exports = { checkZipEntries, assertZipEntries, zipLimitsFromEnv, formatMo, DEFAULT_ZIP_LIMITS };
