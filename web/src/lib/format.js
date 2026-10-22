// Formatting helpers — one place for every user-visible number/date so the
// whole UI stays consistent (Ariary without decimals). The locale follows the
// interface language: I18nProvider calls setFormatLocale() before re-rendering.

let LANG = 'fr';
const LOCALES = { fr: 'fr-FR', en: 'en-GB' };
let nf = new Intl.NumberFormat(LOCALES.fr, { maximumFractionDigits: 0 });

/** Langue des formats (« fr » | « en ») — appelé par I18nProvider. */
export function setFormatLocale(lang) {
  LANG = LOCALES[lang] ? lang : 'fr';
  nf = new Intl.NumberFormat(LOCALES[LANG], { maximumFractionDigits: 0 });
}
export const formatLocale = () => LOCALES[LANG];

// Devise du pays (multi-pays, étape 1) : le suffixe des montants vient du profil du pays, posé une
// fois au chargement par setFormatCurrency (comme la langue). Codes connus -> symbole local ; sinon
// le code ISO ; devise non renseignée -> aucun suffixe (la santé du paramétrage le signale).
const CURRENCY_SYMBOLS = { MGA: 'Ar', USD: '$', EUR: '\u20ac', KES: 'KSh', XOF: 'FCFA', XAF: 'FCFA' };
let CURRENCY_SUFFIX = 'Ar'; // défaut : Ariary, pour ne rien changer tant que le profil n'est pas lu.
/** Fixe la devise des montants depuis le profil du pays ('' = non renseignée -> pas de suffixe). */
export function setFormatCurrency(code) {
  const c = (code || '').toUpperCase().trim();
  CURRENCY_SUFFIX = c ? (CURRENCY_SYMBOLS[c] || c) : '';
}
/** Suffixe de devise courant (pour les rares cas hors formatAr). */
export const currencySuffix = () => CURRENCY_SUFFIX;

/** 450000 -> "450 000 Ar". Normalizes the narrow no-break space Intl emits
 * (U+202F) to a regular no-break space, which every font renders. */
export function formatAr(value) {
  const n = Number(value) || 0;
  const num = nf.format(n).replace(/\u202f/g, '\u00a0');
  return CURRENCY_SUFFIX ? `${num} ${CURRENCY_SUFFIX}` : num;
}

export function formatInt(value) {
  return nf.format(Number(value) || 0).replace(/ /g, ' ');
}

/** Nombre décimal dans la langue de l'interface (« 31,5 » / « 31.5 » ; jamais le point de toFixed dans une
 * interface française), `digits` décimales au plus ; « — » sans valeur. */
export function formatDecimal(value, digits = 1) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat(LOCALES[LANG], { maximumFractionDigits: digits }).format(Number(value)).replace(/\u202f/g, '\u00a0');
}

// Unité des tailles de fichier selon la langue de l'interface (Mo / MB).
const SIZE_UNIT = { fr: 'Mo', en: 'MB' };
/**
 * Taille d'un fichier en mégaoctets, dans la langue de l'interface :
 * « 1,1 Mo » en français, « 1.1 MB » en anglais (une décimale jusqu'à 10, entier au-delà).
 */
export function formatFileSize(bytes) {
  const mb = (Number(bytes) || 0) / (1024 * 1024);
  const digits = mb > 10 ? 0 : 1;
  const n = new Intl.NumberFormat(LOCALES[LANG], { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(mb);
  return `${n.replace(/ /g, ' ')} ${SIZE_UNIT[LANG]}`;
}

// Noms des mois (fr / en) — exportés pour lib/period.js (libellés de période, jumeaux du serveur).
export const MONTH_NAMES = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const months = () => MONTH_NAMES[LANG];

/** "2026-09" -> "Septembre 2026" (explicit table: no dependency on the
 * browser's locale data, and no timezone involved). */
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  const name = months()[m - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

export const MONTH_SHORT = {
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/** "2026-07" -> "juil. 26" : étiquette courte pour un axe de graphique. */
export function shortMonthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${(MONTH_SHORT[LANG] || MONTH_SHORT.fr)[m - 1]} ${String(y).slice(2)}`;
}

/** "2026-09" -> "sept. 2026" : mois abrégé et année entière (légendes des figures). */
export function shortMonthYear(month) {
  const [y, m] = month.split('-').map(Number);
  return `${(MONTH_SHORT[LANG] || MONTH_SHORT.fr)[m - 1]} ${y}`;
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Calendar cells for a month, Monday-first, with leading blanks. */
export function monthGrid(month) {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 0 = Monday
  const cells = Array.from({ length: firstDow }, () => null);
  for (let d = 1; d <= count; d += 1) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    const dow = (firstDow + d - 1) % 7;
    cells.push({ iso, day: d, weekend: dow >= 5 });
  }
  return cells;
}

export function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${months()[m - 1]} ${y}`;
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  const date = d.toLocaleDateString(LOCALES[LANG], { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString(LOCALES[LANG], { hour: '2-digit', minute: '2-digit' });
  return `${date} ${LANG === 'en' ? 'at' : 'à'} ${time}`;
}

// Valeur sans heure : « 2026-09-27 », ou minuit UTC exact (date d'enquête rangée par l'import).
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}(?:[T ]00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)?)?$/;

/** Vrai si la valeur ne porte pas d'heure (date seule, ou minuit UTC exact). */
export function isDateOnly(value) {
  if (value == null || value === '') return false;
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime()) && value.getUTCHours() === 0 && value.getUTCMinutes() === 0
      && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0;
  }
  return DATE_ONLY.test(String(value).trim());
}

/**
 * Date d'une soumission (retour 80) : sans heure, la DATE SEULE, le jour écrit (lu en UTC) —
 * jamais « à 03:00 » ni la veille / le lendemain selon le fuseau du navigateur ; avec une
 * heure, date et heure locales (formatDateTime).
 */
export function formatCollectDate(value) {
  if (!value) return '—';
  if (!isDateOnly(value)) return formatDateTime(value);
  const iso = value instanceof Date ? value.toISOString() : String(value).trim();
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(LOCALES[LANG], { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

export function formatTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString(LOCALES[LANG], { hour: '2-digit', minute: '2-digit' });
}

export function initials(name = '') {
  const parts = name.replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const RISK = {
  faible: { label: 'Faible', tone: 'green' },
  moyenne: { label: 'Moyen', tone: 'orange' },
  elevee: { label: 'Élevé', tone: 'red' },
};

export const ROLE_LABELS = {
  admin: 'Administrateur',
  manager: 'Gestionnaire de suivi',
  viewer: 'Lecture seule',
};

export const PLAN_STATUS = {
  draft: { label: 'Brouillon', tone: 'yellow' },
  submitted: { label: 'Soumis', tone: 'blue' },
  validated: { label: 'Validé', tone: 'green' },
};
