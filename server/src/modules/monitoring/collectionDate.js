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
 * antérieure à 1900. Une année ISO plausible mais lointaine (2024, 1970) reste
 * acceptée, comme avant : ce n'est pas une erreur de lecture (le mois de
 * collecte, lui, la met de côté si elle est trop loin de l'envoi).
 *
 * Mois de période : celui écrit dans la valeur ISO (heure locale du collecteur,
 * comme avant) ; pour un nombre ou une Date, le mois UTC.
 *
 * MOIS DE COLLECTE (règle unifiée, `collectionMonth`) : une soumission
 * appartient au mois de sa DATE D'ENQUÊTE (SvyDate, today, start, end : la
 * première LISIBLE), pas au mois où le serveur Kobo l'a reçue (_submission_time)
 * — sauf si la date d'enquête n'est pas plausible : postérieure à l'envoi, ou
 * plus de 2 ans avant (MAX_SURVEY_LAG_DAYS). On prend alors le mois de l'envoi,
 * signalé « à vérifier ». Un envoi tardif (export réel SMP : 153 collectes
 * envoyées 109 à 225 jours après l'enquête, dont 152 de septembre à décembre 2025
 * reçues en avril 2026) reste au mois de l'enquête ; il est seulement compté pour
 * information (LATE_UPLOAD_DAYS). Une seule date connue : c'est elle.
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

/**
 * Écart maximal (jours) entre l'enquête et l'envoi pour garder le mois de l'enquête : 2 ans.
 * Les collectes envoyées tard appartiennent bien au mois de l'enquête (export réel SMP :
 * 153 collectes envoyées 109 à 225 jours après l'enquête, dont 152 de septembre à décembre
 * 2025 reçues en avril 2026 ; les 16 qui portent un début de formulaire « start » l'ont dans
 * le mois de l'enquête). Ce ne sont pas des horloges déréglées : l'ancienne fenêtre de
 * 92 jours les rangeait à tort au mois de l'envoi. Au-delà de 2 ans, la date d'enquête est
 * suspecte : mois de l'envoi, signalé « à vérifier » (`survey_too_old`).
 */
const MAX_SURVEY_LAG_DAYS = 730;
/** Information seulement : envoi plus de 92 jours après l'enquête (« envoi tardif »), mois de l'enquête gardé. */
const LATE_UPLOAD_DAYS = 92;
/**
 * Tolérance (jours) d'une date d'enquête « après » la réception : _submission_time est écrit
 * en UTC, la date d'enquête en heure locale (UTC+3) — une enquête faite le 1ᵉʳ à 1 h et envoyée
 * aussitôt est « reçue » la veille. Au-delà d'un jour, la date d'enquête est fausse.
 */
const CLOCK_TOLERANCE_DAYS = 1;

const dayNumber = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS;

/**
 * Date d'enquête retenue parmi les colonnes candidates, dans l'ordre de priorité (SvyDate,
 * today, start, end — ou la colonne choisie dans « Mapping MEMS » et ses variantes de casse) :
 * la première LISIBLE. Une candidate illisible (« 15/01/2026 ») ne masque pas une suivante
 * lisible. Aucune lisible : la première renseignée, qui sera dite illisible ; aucune
 * renseignée : index -1.
 * @param {Array<*>} values  valeurs brutes, dans l'ordre de priorité
 * @returns {{ index: number, read: object }}
 */
function pickSurveyDate(values) {
  let firstBad = null;
  for (let i = 0; i < (values || []).length; i += 1) {
    const r = readDate(values[i]);
    if (r.ok && r.date) return { index: i, read: r };
    if (!r.ok && !firstBad) firstBad = { index: i, read: r };
  }
  return firstBad || { index: -1, read: EMPTY };
}

/**
 * Mois de collecte d'une soumission — LA règle, la même à l'import, à la vérification avant
 * import, à la relecture (« Appliquer aux soumissions ») et dans la réparation des données :
 *  - date d'enquête = la première candidate LISIBLE (`surveyDates`, voir pickSurveyDate) ;
 *  - date d'enquête et date d'envoi connues : mois de l'ENQUÊTE quand
 *    0 ≤ envoi − enquête ≤ 730 jours (à un jour près, voir CLOCK_TOLERANCE_DAYS), sinon
 *    mois de l'ENVOI (`issue` dit pourquoi) ; au-delà de 92 jours, `late` (information) ;
 *  - une seule des deux connue : celle-là ;
 *  - aucune date d'enquête lisible mais envoi lisible : mois de l'envoi, signalé
 *    (`issue: 'survey_unreadable'`) — jamais un refus : ces fichiers s'importaient
 *    avant (seule la date de réception était lue) ;
 *  - date d'envoi illisible, ou aucune date d'enquête lisible sans envoi :
 *    `{ ok: false, field }` (l'import répond 400 avec la ligne et la colonne, comme avant ;
 *    `surveyIndex` = la candidate illisible en cause).
 * @param {{ surveyDate?: *, surveyDates?: Array<*>, uploadDate?: *, maxLagDays?: number }} p
 *   valeurs BRUTES ; `surveyDates` (candidates, par priorité) remplace `surveyDate`
 * @returns {{ ok: true, month: string|null, date: Date|null, source: 'survey'|'upload'|null,
 *   issue: null|'survey_unreadable'|'survey_too_old'|'survey_after_upload', late: boolean,
 *   surveyIndex: number, surveyMonth: string|null, uploadMonth: string|null, lagDays: number|null }
 *   | { ok: false, field: 'survey'|'upload', surveyIndex?: number }}
 */
function collectionMonth({ surveyDate, surveyDates, uploadDate, maxLagDays = MAX_SURVEY_LAG_DAYS } = {}) {
  const up = readDate(uploadDate);
  if (!up.ok) return { ok: false, field: 'upload' };
  const { index: surveyIndex, read: sv } = pickSurveyDate(surveyDates !== undefined ? surveyDates : [surveyDate]);
  const base = { surveyMonth: sv.ok ? sv.month : null, uploadMonth: up.month, lagDays: null, late: false, surveyIndex };
  const fromUpload = (issue, lagDays = null) => ({ ok: true, month: up.month, date: up.date, source: up.date ? 'upload' : null, issue, ...base, lagDays });
  if (!sv.ok) return up.date ? fromUpload('survey_unreadable') : { ok: false, field: 'survey', surveyIndex };
  if (!sv.date) return fromUpload(null);
  const fromSurvey = (lagDays = null) => ({
    ok: true, month: sv.month, date: sv.date, source: 'survey', issue: null, ...base, lagDays, late: lagDays != null && lagDays > LATE_UPLOAD_DAYS,
  });
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

/** Valeur propre d'une colonne (jamais une clé héritée). */
const own = (values, c) => (values && Object.prototype.hasOwnProperty.call(values, c) ? values[c] : undefined);

/**
 * Soumissions DÉJÀ importées : mois de collecte recalculé depuis leurs réponses brutes
 * (réparation des données, « Appliquer aux soumissions » après un changement de colonne),
 * par la règle de l'import : date d'enquête = première colonne LISIBLE de `surveyCols`,
 * date d'envoi = première colonne renseignée de `uploadCols`.
 * Seules les lignes qui changent sont renvoyées. Une ligne sans aucune date dans ses
 * réponses (saisie autrement) ou à date illisible garde ses valeurs : jamais effacée.
 * Toutes les lignes sont comptées : total = unchanged + updates + undated + unreadable.
 * @param {Array<{ id: string, periodMonth: string|null, submittedAt: Date|string|null,
 *   uploadMonth: string|null, dates: object|null }>} rows  `dates` = { colonne: valeur brute }
 * @param {{ surveyCols: string[], uploadCols: string[], maxLagDays?: number }} cols
 * @returns {{ updates: Array<{ id, periodMonth, submittedAt, uploadMonth }>, total, unchanged,
 *   undated, unreadable, monthChanged, fromSurvey, fromUpload, tooOld, lateUpload, withoutUpload }}
 *   `withoutUpload` : lignes sans date de réception dans leurs réponses (seed, export sans
 *   _submission_time), qu'elles soient datées, sans date ou illisibles — leur mois de réception
 *   reste inconnu, « Appliquer » n'y change rien. `tooOld` / `lateUpload` : parmi les lignes
 *   datées (« à vérifier » : enquête de plus de 2 ans avant l'envoi ; « envoi tardif » : plus de
 *   92 jours après, information seulement).
 */
function collectionUpdates(rows, { surveyCols = [], uploadCols = [], maxLagDays = MAX_SURVEY_LAG_DAYS } = {}) {
  const out = {
    updates: [], total: 0, unchanged: 0, undated: 0, unreadable: 0, monthChanged: 0,
    fromSurvey: 0, fromUpload: 0, tooOld: 0, lateUpload: 0, withoutUpload: 0,
  };
  for (const row of rows || []) {
    out.total += 1;
    const uploadDate = firstFilled(row.dates, uploadCols);
    // Sans date de réception dans ses réponses, quel que soit le reste (illisible, sans date…).
    if (uploadDate === undefined) out.withoutUpload += 1;
    const r = collectionMonth({ surveyDates: surveyCols.map((c) => own(row.dates, c)), uploadDate, maxLagDays });
    if (!r.ok) { out.unreadable += 1; continue; }
    if (!r.month) { out.undated += 1; continue; }
    if (r.source === 'survey') out.fromSurvey += 1; else out.fromUpload += 1;
    if (r.issue === 'survey_too_old') out.tooOld += 1;
    if (r.late) out.lateUpload += 1;
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

module.exports = {
  parseCollectionDate, collectionMonth, collectionUpdates, firstFilled, pickSurveyDate,
  MAX_SURVEY_LAG_DAYS, LATE_UPLOAD_DAYS, CLOCK_TOLERANCE_DAYS,
};
