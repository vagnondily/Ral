/**
 * Calculs PURS confiés aux fils de calcul (common/cpuPool) : nom → fonction.
 * Une tâche reçoit des données sérialisables (un fichier arrive en ArrayBuffer
 * transféré, sans copie) et rend des données sérialisables ; elle ne touche
 * jamais la base. Liste fermée : un fil n'exécute que ce qui est déclaré ici.
 */
const TASKS = {
  /** Lecture d'un fichier de soumissions (CSV, XLSX, SPSS .sav, zip Kobo) — submissionsImport.parseSubmissions. */
  parseSubmissions: (bytes, opts) => require('../monitoring/submissionsImport').parseSubmissions(asBuffer(bytes), opts || {}),
  /** Lecture d'un XLSForm (définition d'un formulaire) — monitoring/xlsformFile.readXlsformBuffer. */
  parseXlsform: (bytes, opts) => require('../monitoring/xlsformFile').readXlsformBuffer(asBuffer(bytes), opts || {}),
  /** Lecture d'un découpage administratif (.csv, .dbf, .zip de shapefile, XLSForm) — settings/adminImport.parseUpload. */
  parseAdminUpload: (bytes, filename) => require('../settings/adminImport').parseUpload(asBuffer(bytes), String(filename || '')),
  /** Tâches de test du pool (tests unitaires seulement). */
  'test.echo': (x) => x,
  'test.sum': (bytes) => { const b = asBuffer(bytes); let s = 0; for (const v of b) s += v; return s; },
  'test.fail': (statusCode) => { const e = new Error('échec de test'); e.statusCode = statusCode; e.details = { code: 'test' }; throw e; },
  'test.spin': (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* calcul */ } return ms; },
  'test.crash': () => { process.exit(3); },
  'test.rows': (n, width) => ({
    meta: { n, width },
    rows: Array.from({ length: n }, (_, i) => Object.fromEntries(Array.from({ length: width }, (__, k) => [`c${k}`, `${i}:${k}`]))),
  }),
};

/** ArrayBuffer / vue transférés → Buffer (sans copie). */
function asBuffer(x) {
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof ArrayBuffer) return Buffer.from(x);
  if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  return Buffer.from(x || []);
}

module.exports = { TASKS, asBuffer };
