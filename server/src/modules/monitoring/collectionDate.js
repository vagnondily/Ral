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
 *
 * MOIS DE COLLECTE (règle unifiée, `collectionMonth`) : une soumission
 * appartient au mois de sa DATE D'ENQUÊTE (SvyDate, today, start…), pas au mois
 * où le serveur Kobo l'a reçue (_submission_time) — sauf si la date d'enquête
 * n'est pas plausible : postérieure à la réception, ou plus de 92 jours avant
 * (horloge de tablette restée en 2024…). On prend alors le mois de réception.
 * Une seule date connue : c'est elle.
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
const dayOfMs = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function fromNumber(n) {
  if (!Number.isFinite(n)) return null;
  for (const toMs of NUMERIC_CODINGS) {
    const ms = toMs(n);
    if (ms >= MIN_MS && ms < MAX_MS) return { ok: true, date: new Date(ms), month: monthOfMs(ms), day: dayOfMs(ms) };
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
  if (D == null) return { ok: true, date: new Date(Date.UTC(y, mo - 1, 1)), month, day: month };
  const d = Number(D);
  if (d < 1 || d > daysIn(y, mo)) return null;
  const day = `${Y}-${M}-${D}`; // jour ÉCRIT (heure locale du collecteur), comme le mois
  if (h == null) return { ok: true, date: new Date(Date.UTC(y, mo - 1, d)), month, day };
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
  return Number.isNaN(date.getTime()) ? null : { ok: true, date, month, day };
}

const EMPTY = Object.freeze({ ok: true, date: null, month: null, day: null });
const REFUSED = Object.freeze({ ok: false });

/** Lecture complète, avec le jour écrit (`day`, AAAA-MM-JJ) qui sert à mesurer un écart en jours. */
function readDate(value) {
  if (value == null) return EMPTY;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? REFUSED : { ok: true, date: new Date(t), month: monthOfMs(t), day: dayOfMs(t) };
  }
  if (typeof value === 'number') return fromNumber(value) || REFUSED;
  const s = String(value).trim();
  if (!s) return EMPTY;
  if (/^\d+(?:\.\d+)?$/.test(s)) return fromNumber(Number(s)) || REFUSED;
  return fromIso(s) || REFUSED;
}

/**
 * @param {*} value  valeur brute de la cellule / du champ
 * @returns {{ok:true,date:Date|null,month:string|null}|{ok:false}}
 */
function parseCollectionDate(value) {
  const r = readDate(value);
  return r.ok ? { ok: true, date: r.date, month: r.month } : { ok: false };
}

// ---- Mois de collecte ----------------------------------------------------------------------

/** Écart maximal (jours) entre l'enquête et la réception pour garder le mois de l'enquête. */
const MAX_LAG_DAYS = 92;
/**
 * Tolérance (jours) d'une date d'enquête « après » la réception : _submission_time est écrit
 * en UTC, la date d'enquête en heure locale (UTC+3) — une enquête faite le 1ᵉʳ à 1 h et envoyée
 * aussitôt est « reçue » la veille. Au-delà d'un jour, la date d'enquête est fausse.
 */
const CLOCK_TOLERANCE_DAYS = 1;

const dayNumber = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS;

/**
 * Mois de collecte d'une soumission — LA règle, la même à l'import, à la relecture
 * (« Appliquer aux soumissions ») et dans la réparation des données déjà importées :
 *  - date d'enquête et date de réception connues : mois de l'ENQUÊTE quand
 *    0 ≤ réception − enquête ≤ 92 jours (à un jour près, voir CLOCK_TOLERANCE_DAYS),
 *    sinon mois de RÉCEPTION (`issue` dit pourquoi) ;
 *  - une seule des deux connue : celle-là ;
 *  - date d'enquête illisible mais réception lisible : mois de réception, signalé
 *    (`issue: 'survey_unreadable'`) — jamais un refus : ces fichiers s'importaient
 *    avant (seule la date de réception était lue) ;
 *  - date de réception illisible, ou date d'enquête illisible sans réception :
 *    `{ ok: false, field }` (l'import répond 400 avec la ligne et la colonne, comme avant).
 * @param {{ surveyDate?: *, uploadDate?: *, maxLagDays?: number }} p  valeurs BRUTES
 * @returns {{ ok: true, month: string|null, date: Date|null, source: 'survey'|'upload'|null,
 *   issue: null|'survey_unreadable'|'survey_too_old'|'survey_after_upload',
 *   surveyMonth: string|null, uploadMonth: string|null, lagDays: number|null }
 *   | { ok: false, field: 'survey'|'upload' }}
 */
function collectionMonth({ surveyDate, uploadDate, maxLagDays = MAX_LAG_DAYS } = {}) {
  const up = readDate(uploadDate);
  if (!up.ok) return { ok: false, field: 'upload' };
  const sv = readDate(surveyDate);
  const base = { surveyMonth: sv.ok ? sv.month : null, uploadMonth: up.month, lagDays: null };
  const fromUpload = (issue, lagDays = null) => ({ ok: true, month: up.month, date: up.date, source: up.date ? 'upload' : null, issue, ...base, lagDays });
  if (!sv.ok) return up.date ? fromUpload('survey_unreadable') : { ok: false, field: 'survey' };
  if (!sv.date) return fromUpload(null);
  const fromSurvey = (lagDays = null) => ({ ok: true, month: sv.month, date: sv.date, source: 'survey', issue: null, ...base, lagDays });
  if (!up.date) return fromSurvey();
  const lagDays = dayNumber(up.day) - dayNumber(sv.day);
  if (lagDays < -CLOCK_TOLERANCE_DAYS) return fromUpload('survey_after_upload', lagDays);
  if (lagDays > maxLagDays) return fromUpload('survey_too_old', lagDays);
  return fromSurvey(lagDays);
}

const filled = (v) => v != null && !(typeof v === 'string' && v.trim() === '');

/** Première valeur renseignée parmi des colonnes (ordre de priorité), comme à l'import. */
function firstFilled(values, columns) {
  if (!values) return undefined;
  for (const c of columns || []) if (Object.prototype.hasOwnProperty.call(values, c) && filled(values[c])) return values[c];
  return undefined;
}

const sameInstant = (a, b) => (a == null || b == null ? a == null && b == null : new Date(a).getTime() === new Date(b).getTime());

/**
 * Soumissions DÉJÀ importées : mois de collecte recalculé depuis leurs réponses brutes
 * (réparation des données, « Appliquer aux soumissions » après un changement de colonne).
 * Seules les lignes qui changent sont renvoyées. Une ligne sans aucune date dans ses
 * réponses (saisie autrement) ou à date illisible garde ses valeurs : jamais effacée.
 * @param {Array<{ id: string, periodMonth: string|null, submittedAt: Date|string|null,
 *   uploadMonth: string|null, dates: object|null }>} rows  `dates` = { colonne: valeur brute }
 * @param {{ surveyCols: string[], uploadCols: string[], maxLagDays?: number }} cols
 * @returns {{ updates: Array<{ id, periodMonth, submittedAt, uploadMonth }>, total, unchanged,
 *   undated, unreadable, monthChanged, fromSurvey, fromUpload }}
 */
function collectionUpdates(rows, { surveyCols = [], uploadCols = [], maxLagDays = MAX_LAG_DAYS } = {}) {
  const out = { updates: [], total: 0, unchanged: 0, undated: 0, unreadable: 0, monthChanged: 0, fromSurvey: 0, fromUpload: 0 };
  for (const row of rows || []) {
    out.total += 1;
    const r = collectionMonth({ surveyDate: firstFilled(row.dates, surveyCols), uploadDate: firstFilled(row.dates, uploadCols), maxLagDays });
    if (!r.ok) { out.unreadable += 1; continue; }
    if (!r.month) { out.undated += 1; continue; }
    if (r.source === 'survey') out.fromSurvey += 1; else out.fromUpload += 1;
    const next = { id: row.id, periodMonth: r.month, submittedAt: r.date.toISOString(), uploadMonth: r.uploadMonth };
    if (next.periodMonth === row.periodMonth && next.uploadMonth === (row.uploadMonth || null)
      && sameInstant(next.submittedAt, row.submittedAt)) {
      out.unchanged += 1;
      continue;
    }
    if (next.periodMonth !== row.periodMonth) out.monthChanged += 1;
    out.updates.push(next);
  }
  return out;
}

module.exports = { parseCollectionDate, collectionMonth, collectionUpdates, firstFilled, MAX_LAG_DAYS, CLOCK_TOLERANCE_DAYS };
