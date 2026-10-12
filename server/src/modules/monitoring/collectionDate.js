/**
 * Lecture STRICTE d'une date de collecte importée — logique pure, sans I/O, testée.
 *
 * Avant : `new Date(valeur)` laissait passer « Invalid Date » jusqu'à
 * PostgreSQL (erreur 22007 → 500, import entier perdu), lisait « 05/03/2026 »
 * comme le 3 mai (convention américaine) et prenait les secondes SPSS pour des
 * millisecondes (dates de 1970). Désormais une valeur est acceptée seulement
 * si sa lecture est sans ambiguïté ; sinon `{ ok: false }`, et l'import
 * renvoie 400 avec la ligne et la colonne.
 *
 * Acceptés :
 *  - vide (null, '', espaces) → pas de date ;
 *  - objet Date valide (cellule date d'un .xlsx) ;
 *  - ISO 8601 : AAAA-MM, AAAA-MM-JJ, AAAA-MM-JJ[T ]hh:mm[:ss[.fff]][Z|±hh[:mm]]
 *    (format des exports Kobo/ODK), avec contrôle du calendrier (pas de 31/04) ;
 *  - nombre (ou texte numérique) dont UN des codages connus tombe entre 2000 et
 *    2100 — les fenêtres sont disjointes, donc la lecture est univoque :
 *    série Excel (jours depuis 1899-12-30), secondes Unix, secondes SPSS
 *    (depuis le 14/10/1582) et millisecondes Unix.
 * Refusés : tout le reste, notamment « 30/01/2026 » ou « 05/03/2026 »
 * (jour et mois indiscernables), « hier », « 2026-02-30 », une année ISO
 * antérieure à 1900. Une année ISO plausible mais lointaine (horloge de
 * tablette remise à 1970) reste acceptée, comme avant : ce n'est pas une
 * erreur de lecture.
 *
 * Mois de période : celui écrit dans la valeur ISO (heure locale du collecteur,
 * comme avant) ; pour un nombre ou une Date, le mois UTC.
 */

const DAY_MS = 86400000;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const SPSS_TO_UNIX_S = 12219379200; // secondes entre le 14/10/1582 et le 01/01/1970
const MIN_MS = Date.UTC(2000, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);

const NUMERIC_CODINGS = [
  (n) => EXCEL_EPOCH_MS + n * DAY_MS,     // série Excel (jours)
  (n) => n * 1000,                         // secondes Unix
  (n) => (n - SPSS_TO_UNIX_S) * 1000,      // secondes SPSS
  (n) => n,                                // millisecondes Unix
];

const ISO = /^(\d{4})-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?)?$/i;

const pad = (n) => String(n).padStart(2, '0');
const monthOfMs = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`; };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function fromNumber(n) {
  if (!Number.isFinite(n)) return null;
  for (const toMs of NUMERIC_CODINGS) {
    const ms = toMs(n);
    if (ms >= MIN_MS && ms < MAX_MS) return { ok: true, date: new Date(ms), month: monthOfMs(ms) };
  }
  return null;
}

function fromIso(s) {
  const m = ISO.exec(s);
  if (!m) return null;
  const [, Y, M, D, h, mi, sec, frac, zone] = m;
  const y = Number(Y); const mo = Number(M);
  if (y < 1900 || mo < 1 || mo > 12) return null; // avant 1900 : JS confondrait 0050 avec 1950
  const month = `${Y}-${M}-01`;
  if (D == null) return { ok: true, date: new Date(Date.UTC(y, mo - 1, 1)), month };
  const d = Number(D);
  if (d < 1 || d > daysIn(y, mo)) return null;
  if (h == null) return { ok: true, date: new Date(Date.UTC(y, mo - 1, d)), month };
  const H = Number(h); const Mi = Number(mi); const S = Number(sec || 0);
  if (H > 23 || Mi > 59 || S > 59) return null;
  const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
  let date;
  if (!zone) {
    // Sans fuseau : heure locale, exactement comme new Date('AAAA-MM-JJThh:mm:ss').
    date = new Date(y, mo - 1, d, H, Mi, S, ms);
  } else {
    let offsetMin = 0;
    if (zone.toUpperCase() !== 'Z') {
      const z = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone);
      const zh = Number(z[2]); const zm = Number(z[3] || 0);
      if (zh > 23 || zm > 59) return null;
      offsetMin = (z[1] === '-' ? -1 : 1) * (zh * 60 + zm);
    }
    date = new Date(Date.UTC(y, mo - 1, d, H, Mi, S, ms) - offsetMin * 60000);
  }
  return Number.isNaN(date.getTime()) ? null : { ok: true, date, month };
}

/**
 * @param {*} value  valeur brute de la cellule / du champ
 * @returns {{ok:true,date:Date|null,month:string|null}|{ok:false}}
 */
function parseCollectionDate(value) {
  if (value == null) return { ok: true, date: null, month: null };
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? { ok: false } : { ok: true, date: new Date(t), month: monthOfMs(t) };
  }
  if (typeof value === 'number') return fromNumber(value) || { ok: false };
  const s = String(value).trim();
  if (!s) return { ok: true, date: null, month: null };
  if (/^\d+(?:\.\d+)?$/.test(s)) return fromNumber(Number(s)) || { ok: false };
  return fromIso(s) || { ok: false };
}

module.exports = { parseCollectionDate };
