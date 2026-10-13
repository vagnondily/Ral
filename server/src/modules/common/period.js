/**
 * Période par défaut des écrans d'analyse (Synthèse, Couverture & performance…)
 * — logique PURE, sans I/O, testée (server/test/period.test.js).
 *
 * Règle unique (retour n° 16) : l'écran s'ouvre sur le DERNIER MOIS « SUBSTANTIEL »
 * ayant des données et qui n'est pas dans le futur, et il dit où et pourquoi :
 *   - les mois futurs sont ignorés (date de tablette aberrante, pas des données du jour) ;
 *   - un mois est substantiel quand son volume atteint `minShare` (25 %) de la
 *     médiane des `lookback` (6) mois avec données qui le précèdent — un mois de
 *     queue à 2 formulaires après 73 n'est pas « le dernier mois avec des données » ;
 *   - à défaut, le dernier mois avec des données ; sans aucune donnée, le mois courant.
 * Raisons renvoyées : 'current' (le mois courant convient), 'latest' (dernier
 * mois avec des données, le mois courant étant vide), 'latest_substantial'
 * (le mois courant ou les derniers mois n'ont que quelques données), 'none'.
 */

const { z } = require('zod');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Vrai pour un mois « AAAA-MM » valide. */
const isMonth = (m) => typeof m === 'string' && MONTH_RE.test(m);

/** « AAAA-MM » décalé de `delta` mois. */
function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Mois par défaut.
 * @param {{month:string, n:number}[]} monthCounts volume de données par mois (ordre quelconque)
 * @param {string} todayMonth mois courant « AAAA-MM »
 * @param {{minShare?:number, lookback?:number}} [opts]
 * @returns {{ month:string, reason:'current'|'latest'|'latest_substantial'|'none',
 *             today:string, latestMonth:string|null, n:number, todayCount:number }}
 */
function defaultPeriod(monthCounts, todayMonth, { minShare = 0.25, lookback = 6 } = {}) {
  if (!isMonth(todayMonth)) throw new Error(`Mois courant invalide : ${todayMonth}`);
  const byMonth = new Map();
  for (const r of monthCounts || []) {
    const n = Math.max(0, Math.round(Number(r && r.n) || 0));
    if (!r || !isMonth(r.month) || r.month > todayMonth || n === 0) continue; // futurs et vides ignorés
    byMonth.set(r.month, (byMonth.get(r.month) || 0) + n);
  }
  const months = [...byMonth.keys()].sort();
  const todayCount = byMonth.get(todayMonth) || 0;
  const latestMonth = months.length ? months[months.length - 1] : null;
  if (!latestMonth) return { month: todayMonth, reason: 'none', today: todayMonth, latestMonth: null, n: 0, todayCount: 0 };

  // Du plus récent au plus ancien : premier mois dont le volume est substantiel.
  for (let i = months.length - 1; i >= 0; i -= 1) {
    const prev = months.slice(Math.max(0, i - lookback), i).map((m) => byMonth.get(m));
    const n = byMonth.get(months[i]);
    if (!prev.length || n >= minShare * median(prev)) {
      const month = months[i];
      const reason = month === todayMonth ? 'current' : (month === latestMonth && todayCount === 0 ? 'latest' : 'latest_substantial');
      return { month, reason, today: todayMonth, latestMonth, n, todayCount };
    }
  }
  // Inatteignable (le plus ancien mois n'a pas de prédécesseur) — repli sûr.
  return { month: latestMonth, reason: 'latest', today: todayMonth, latestMonth, n: byMonth.get(latestMonth), todayCount };
}

// ---- Période = plage de mois (lot 1b, retour n° 47) ---------------------------
/*
 * UN modèle : { from: 'AAAA-MM', to: 'AAAA-MM' }, bornes incluses ; un mois seul
 * s'écrit from = to ; null = « toutes les périodes » (là où l'écran le propose).
 * Lu au bord HTTP par parsePeriod (via middleware/period.readPeriod), traduit en
 * SQL par common/periodSql (intervalle semi-ouvert), libellé par periodLabel.
 */
/** Durée maximale d'une période (mois) — le même plafond que consolidation.monthRange. */
const MAX_SPAN = 60;
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;
// « AAAA-MM » ou « AAAA-MM-JJ » (l'ancien ?month=2026-07-15 passait : tronqué au mois).
const MONTH_OR_DAY_RE = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/;

/** Rang absolu d'un mois (y × 12 + m − 1) : différence = nombre de mois. */
const monthIndex = (m) => { const [y, mm] = String(m).split('-').map(Number); return y * 12 + (mm - 1); };
/** Nombre de mois d'une période (bornes incluses). */
const spanMonths = ({ from, to }) => monthIndex(to) - monthIndex(from) + 1;
/** Période d'un seul mois. */
const single = (m) => ({ from: m, to: m });

/**
 * Mois d'une période, du plus ancien au plus récent (['2026-01', …, '2026-06']).
 * Refuse au-delà de `max` mois (jamais une troncature silencieuse).
 */
function monthsOf(p, { max = MAX_SPAN } = {}) {
  if (!p) return [];
  const n = spanMonths(p);
  if (!(n >= 1)) return [];
  if (n > max) throw new RangeError(`Période trop longue : ${n} mois (${max} au plus).`);
  return Array.from({ length: n }, (_, i) => addMonths(p.from, i));
}

/** Bornes SQL d'une période : lo inclus, hiExcl exclu (1er du mois après `to`), hi = 1er du mois `to`. */
function periodBounds(p) {
  return { lo: `${p.from}-01`, hiExcl: `${addMonths(p.to, 1)}-01`, hi: `${p.to}-01` };
}

/**
 * Fenêtre des tendances : au moins `min` mois finissant à `to`, étendue vers le
 * passé quand la période est plus longue. Sans période : `min` mois finissant
 * au mois courant (comportement du lot 1).
 */
function trendWindow(p, todayMonth, min = 12) {
  const to = p ? p.to : todayMonth;
  const back = addMonths(to, -(min - 1));
  return { from: p && p.from < back ? p.from : back, to };
}

/**
 * Vrai si l'intervalle [start, end ?? start] (mois ou dates) chevauche la période —
 * jumeau pur de periodSql.spanOverlaps, pour les filtres côté JS. Sans période : vrai.
 */
function overlaps(p, start, end) {
  if (!p) return true;
  if (!start) return false;
  const s = String(start).slice(0, 7);
  const e = end ? String(end).slice(0, 7) : s;
  return s <= p.to && e >= p.from;
}

/** Messages (français) et codes des erreurs de période — `details.code` pour l'interface. */
const PERIOD_MESSAGES = {
  period_format: () => 'Période invalide : mois attendu au format AAAA-MM (ex. 2026-01).',
  period_partial: () => 'Période incomplète : précisez le début (from) et la fin (to).',
  period_ambiguous: () => 'Période ambiguë : utilisez soit month, soit from et to.',
  period_order: ({ from, to }) => `Période invalide : le début (${from}) est après la fin (${to}).`,
  period_span: ({ maxSpan, span }) => `Période trop longue : ${maxSpan} mois au plus (demandé : ${span}).`,
  period_year: () => `Période hors limites : années ${YEAR_MIN} à ${YEAR_MAX}.`,
  period_required: () => 'Période requise.',
};
const fail = (code, details = {}) => ({ ok: false, code, message: PERIOD_MESSAGES[code](details), details });
// null / undefined / '' (ou blancs) = absent (un champ JSON envoyé à null vaut absent).
const isAbsent = (v) => v == null || (typeof v === 'string' && v.trim() === '');

/**
 * Lit une période dans une requête (query ou corps) — règle unique, dans cet ordre :
 *  1. tout absent ou vide → null (ou period_required si `required`) ;
 *  2. valeur qui n'est pas une chaîne (?month=a&month=b) → period_format ;
 *  3. month avec from ou to → period_ambiguous ;
 *  4. from sans to, ou l'inverse → period_partial ;
 *  5. AAAA-MM, ou AAAA-MM-JJ tronqué au mois → sinon period_format (champ fautif) ;
 *  6. années 2000 à 2100 → sinon period_year ;
 *  7. from ≤ to → sinon period_order ;
 *  8. au plus `maxSpan` mois (60 par défaut) → sinon period_span.
 * @returns {{ok:true, period:{from:string,to:string}|null} | {ok:false, code:string, message:string, details:object}}
 */
function parsePeriod(src, { required = false, maxSpan = MAX_SPAN } = {}) {
  const q = src || {};
  const raw = { month: q.month, from: q.from, to: q.to };
  const present = Object.keys(raw).filter((k) => !isAbsent(raw[k]));
  if (!present.length) return required ? fail('period_required') : { ok: true, period: null };
  for (const k of present) if (typeof raw[k] !== 'string') return fail('period_format', { field: k });
  const has = (k) => present.includes(k);
  if (has('month') && (has('from') || has('to'))) return fail('period_ambiguous');
  if (!has('month') && has('from') !== has('to')) return fail('period_partial', { field: has('from') ? 'to' : 'from' });
  const fields = has('month') ? ['month'] : ['from', 'to'];
  const val = {};
  for (const k of fields) {
    const m = MONTH_OR_DAY_RE.exec(raw[k].trim());
    if (!m) return fail('period_format', { field: k });
    val[k] = `${m[1]}-${m[2]}`;
  }
  for (const k of fields) {
    const y = Number(val[k].slice(0, 4));
    if (y < YEAR_MIN || y > YEAR_MAX) return fail('period_year', { field: k });
  }
  const period = has('month') ? single(val.month) : { from: val.from, to: val.to };
  if (period.from > period.to) return fail('period_order', { from: period.from, to: period.to });
  const span = spanMonths(period);
  if (span > maxSpan) return fail('period_span', { maxSpan, span });
  return { ok: true, period };
}

/**
 * Période d'un appel interne (déjà validé) : { month } | { from, to } | null →
 * { from, to } | null. Une période partielle est un bug d'appelant : erreur.
 */
function toPeriod(legacy) {
  if (!legacy) return null;
  const m7 = (v) => String(v).slice(0, 7);
  if (legacy.month) return single(m7(legacy.month));
  if (legacy.from && legacy.to) return { from: m7(legacy.from), to: m7(legacy.to) };
  if (legacy.from || legacy.to) throw new Error('Période partielle : from et to sont requis ensemble.');
  return null;
}

/** Période d'une réponse d'API : { from, to, months } | null. */
const periodInfo = (p) => (p ? { from: p.from, to: p.to, months: spanMonths(p) } : null);

const MONTHS_LONG = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
// Mêmes abréviations que web/src/lib/format.js (MONTH_SHORT) — parité testée (webPeriod.test.js).
const MONTHS_SHORT = {
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/**
 * Libellé d'une période dans la langue voulue (fr par défaut, en).
 *  - forme longue (rapports, bandeaux) : « Juillet 2026 », « Janvier à juin 2026 »,
 *    « Année 2026 », « Octobre 2025 à mars 2026 » ; « January to June 2026 » ;
 *  - forme courte (bouton) : « Juil. 2026 », « Janv. – juin 2026 », « Nov. 2025 – oct. 2026 ».
 * Jumeau exact de web/src/lib/period.js periodLabel (parité testée).
 */
function periodLabel({ from, to }, lang = 'fr', { short = false } = {}) {
  const en = lang === 'en';
  const names = (short ? MONTHS_SHORT : MONTHS_LONG)[en ? 'en' : 'fr'];
  const lab = (m) => { const [y, mm] = m.split('-').map(Number); return { y, name: names[mm - 1] }; };
  const a = lab(from); const b = lab(to);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  if (from === to) return `${cap(a.name)} ${a.y}`;
  if (a.y === b.y && from.endsWith('-01') && to.endsWith('-12')) return `${en ? 'Year' : 'Année'} ${a.y}`;
  const sep = short ? '–' : (en ? 'to' : 'à');
  return a.y === b.y ? `${cap(a.name)} ${sep} ${b.name} ${a.y}` : `${cap(a.name)} ${a.y} ${sep} ${b.name} ${b.y}`;
}

const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
/**
 * Schéma zod d'une période déjà normalisée { from, to } (concepteur de rapport…) :
 * ordre, années et durée contrôlés par la même règle que parsePeriod.
 */
const periodSchema = z.object({ from: monthStr, to: monthStr }).superRefine((p, ctx) => {
  const r = parsePeriod(p);
  if (!r.ok) ctx.addIssue({ code: 'custom', message: r.message, path: r.details.field ? [r.details.field] : [], params: { code: r.code } });
});
/**
 * Schéma zod des paramètres de période d'une requête ({ month } ou { from, to }),
 * issues codées ({ params: { code } }) comme les autres règles métier.
 */
const periodQuerySchema = z.object({ month: z.any().optional(), from: z.any().optional(), to: z.any().optional() })
  .passthrough().superRefine((q, ctx) => {
    const r = parsePeriod(q);
    if (!r.ok) ctx.addIssue({ code: 'custom', message: r.message, path: r.details.field ? [r.details.field] : [], params: { code: r.code } });
  });

module.exports = {
  defaultPeriod, isMonth, addMonths, median,
  MAX_SPAN, monthIndex, spanMonths, single, monthsOf, periodBounds, trendWindow, overlaps,
  parsePeriod, toPeriod, periodInfo, periodLabel, periodSchema, periodQuerySchema, PERIOD_MESSAGES,
};
