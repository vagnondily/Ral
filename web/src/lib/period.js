/**
 * Période = plage de mois (lot 1b, retour n° 47) — logique PURE, sans React ni
 * navigateur (testée depuis server/test/webPeriod.test.js).
 *
 * UN modèle, le même que le serveur (server/src/modules/common/period.js) :
 * { from: 'AAAA-MM', to: 'AAAA-MM' }, bornes incluses ; un mois seul s'écrit
 * from = to ; null = « toutes les périodes » (là où l'écran le propose).
 * Le libellé (periodLabel) est le jumeau exact de celui du serveur — parité testée.
 */
import { MONTH_NAMES, MONTH_SHORT } from './format.js';
import { PERIOD_CAPS } from './periodCaps.js';

/** Durée maximale d'une période (60 mois : budget, documents) — common/periodCaps côté serveur. */
export const MAX_SPAN = PERIOD_CAPS.document;
export const SESSION_KEY = 'mems.period.v1';
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isMonth = (m) => typeof m === 'string' && MONTH_RE.test(m);
export const isPeriod = (p) => !!p && isMonth(p.from) && isMonth(p.to) && p.from <= p.to;

/** Rang absolu d'un mois (y × 12 + m − 1). */
export const monthIndex = (m) => { const [y, mm] = String(m).split('-').map(Number); return y * 12 + (mm - 1); };

/** « AAAA-MM » décalé de `delta` mois. */
export function addMonths(month, delta) {
  const i = monthIndex(month) + delta;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** Nombre de mois d'une période (bornes incluses). */
export const spanMonths = (p) => monthIndex(p.to) - monthIndex(p.from) + 1;

/*
 * Mois COCHÉS (retour 68) : { from, to, months: ['2026-01', '2026-03'] } — triés, sans doublon, from = le
 * premier, to = le dernier ; une liste qui couvre toute sa plage s'écrit sans `months` (forme canonique,
 * même règle que le serveur). Seuls les écrans qui l'acceptent la proposent (PeriodSelect `allowList`).
 */
export const isMonthList = (p) => !!p && Array.isArray(p.months);

/** Période canonique d'une liste de mois (triés, dédoublonnés) ; null si vide. */
export function periodOfMonths(list) {
  const months = [...new Set((list || []).filter(isMonth))].sort();
  if (!months.length) return null;
  const out = { from: months[0], to: months[months.length - 1] };
  return months.length === spanMonths(out) ? out : { ...out, months };
}

/** Nombre de mois RETENUS (liste : mois cochés ; plage : bornes incluses). */
export const monthCount = (p) => (isMonthList(p) ? p.months.length : spanMonths(p));

/** Mois d'une période, du plus ancien au plus récent (au plus `max`) ; ceux de la liste pour des mois cochés. */
export function monthsOf(p, max = MAX_SPAN) {
  if (!isPeriod(p)) return [];
  if (isMonthList(p)) return p.months.slice(0, max);
  const n = Math.min(spanMonths(p), max);
  return Array.from({ length: n }, (_, i) => addMonths(p.from, i));
}

/** Période remise dans l'ordre (from ≤ to) ; null si invalide. Une liste reste une liste (canonique). */
export function normalize(p) {
  if (isMonthList(p)) return periodOfMonths(p.months);
  if (!p || !isMonth(p.from) || !isMonth(p.to)) return null;
  return p.from <= p.to ? { from: p.from, to: p.to } : { from: p.to, to: p.from };
}

const sameList = (a, b) => (!isMonthList(a) && !isMonthList(b)) || (isMonthList(a) && isMonthList(b) && a.months.join() === b.months.join());
export const samePeriod = (a, b) => (!a && !b) || (!!a && !!b && a.from === b.from && a.to === b.to && sameList(a, b));
export const single = (m) => ({ from: m, to: m });

/**
 * Vrai si l'intervalle [start, end ?? start] (mois ou dates) chevauche la période —
 * jumeau de common/period.overlaps (une facture pluri-mensuelle chevauche). Sans période : vrai.
 */
export function overlaps(p, start, end) {
  if (!p) return true;
  if (!start) return false;
  const s = String(start).slice(0, 7);
  const e = end ? String(end).slice(0, 7) : s;
  if (isMonthList(p)) return p.months.some((m) => m >= s && m <= e);
  return s <= p.to && e >= p.from;
}

/**
 * Période lue d'une vue enregistrée (filtres d'une liste) : { from, to } gardé, ancienne
 * valeur « AAAA-MM » convertie en { from: v, to: v } — jamais rejetée ; sinon '' (aucune).
 */
export function periodFromSaved(v) {
  if (isPeriod(v)) return { from: v.from, to: v.to };
  if (isMonth(v)) return single(v);
  return '';
}

/**
 * Libellé d'une période (fr par défaut, en) — jumeau de common/period.periodLabel :
 *  - longue : « Juillet 2026 », « Janvier à juin 2026 », « Année 2026 », « Octobre 2025 à mars 2026 » ;
 *  - courte (bouton) : « Juil. 2026 », « Janv. – juin 2026 », « Nov. 2025 – oct. 2026 ».
 */
export function periodLabel(p, lang = 'fr', { short = false } = {}) {
  if (isMonthList(p)) return listLabel(p, lang, { short });
  const { from, to } = p;
  const en = lang === 'en';
  const names = (short ? MONTH_SHORT : MONTH_NAMES)[en ? 'en' : 'fr'];
  const lab = (m) => { const [y, mm] = m.split('-').map(Number); return { y, name: names[mm - 1] }; };
  const a = lab(from); const b = lab(to);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  if (from === to) return `${cap(a.name)} ${a.y}`;
  if (a.y === b.y && from.endsWith('-01') && to.endsWith('-12')) return `${en ? 'Year' : 'Année'} ${a.y}`;
  const sep = short ? '–' : (en ? 'to' : 'à');
  return a.y === b.y ? `${cap(a.name)} ${sep} ${b.name} ${a.y}` : `${cap(a.name)} ${a.y} ${sep} ${b.name} ${b.y}`;
}

/**
 * Libellé de mois COCHÉS — jumeau de common/period.listLabel (parité testée) : « Janvier à mars, mai,
 * juin et août 2026 », « Novembre et décembre 2025, janvier 2026 » ; court : « Janv., mars, juin 2026 »,
 * au-delà de 3 mois « 5 mois · janv. – sept. 2026 ».
 */
export function listLabel(p, lang = 'fr', { short = false } = {}) {
  const en = lang === 'en';
  const months = p.months;
  const cap = (x) => x[0].toUpperCase() + x.slice(1);
  if (short) {
    if (months.length > 3) return `${months.length} ${en ? 'months' : 'mois'} · ${periodLabel({ from: p.from, to: p.to }, lang, { short: true }).replace(/^./, (c) => (en ? c : c.toLowerCase()))}`;
    const names = MONTH_SHORT[en ? 'en' : 'fr'];
    const byYear = [];
    for (const m of months) {
      const y = m.slice(0, 4);
      if (!byYear.length || byYear[byYear.length - 1].y !== y) byYear.push({ y, names: [] });
      byYear[byYear.length - 1].names.push(names[Number(m.slice(5, 7)) - 1]);
    }
    return cap(byYear.map((g) => `${g.names.join(', ')} ${g.y}`).join(', '));
  }
  const names = MONTH_NAMES[en ? 'en' : 'fr'];
  const and = en ? 'and' : 'et';
  const to = en ? 'to' : 'à';
  const groups = [];
  for (const m of months) {
    const y = m.slice(0, 4); const i = Number(m.slice(5, 7));
    let g = groups[groups.length - 1];
    if (!g || g.y !== y) { g = { y, runs: [] }; groups.push(g); }
    const run = g.runs[g.runs.length - 1];
    if (run && run[run.length - 1] === i - 1) run.push(i); else g.runs.push([i]);
  }
  const join = (items) => (items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`);
  const parts = groups.map((g) => {
    const items = [];
    for (const r of g.runs) {
      if (r.length >= 3) items.push(`${names[r[0] - 1]} ${to} ${names[r[r.length - 1] - 1]}`);
      else r.forEach((i) => items.push(names[i - 1]));
    }
    return `${join(items)} ${g.y}`;
  });
  return cap(parts.join(', '));
}

const quarterOf = (m) => Math.floor((Number(m.slice(5, 7)) - 1) / 3) + 1;
const halfOf = (m) => (Number(m.slice(5, 7)) <= 6 ? 1 : 2);
const yearOf = (m) => Number(m.slice(0, 4));
const mm = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
// Paramètres des libellés en TEXTE : tr() formate les nombres (« 2 026 » en français).
const txt = (n) => String(n);

/**
 * Préréglages, calculés avec T = mois courant et L = dernier mois avec des données.
 * Aucun ne dépasse T, sauf « Année {y} » (année civile entière), réservée aux
 * documents (`withFullYear`, concepteur de rapport). Chaque entrée :
 * { id, label (phrase française pour tr), params, hint ({ text, params } ou null), period }.
 */
export function presets(today, latest = null, { withFullYear = false } = {}) {
  const T = today;
  const y = yearOf(T);
  const q = quarterOf(T);
  const h = halfOf(T);
  const qStart = mm(y, (q - 1) * 3 + 1);
  const pq = addMonths(qStart, -3);
  const hStart = mm(y, h === 1 ? 1 : 7);
  const ph = addMonths(hStart, -6);
  const janJunYear = Number(T.slice(5, 7)) >= 7 ? y : y - 1;
  const list = [];
  if (isMonth(latest) && latest !== T && latest < T) {
    list.push({ id: 'latest', label: 'Dernier mois avec des données', period: single(latest) });
  }
  list.push(
    { id: 'this_month', label: 'Ce mois-ci', period: single(T) },
    { id: 'last_month', label: 'Mois dernier', period: single(addMonths(T, -1)) },
    { id: 'this_quarter', label: 'Trimestre en cours', hint: { text: 'T{q} {y}', params: { q: txt(q), y: txt(y) } }, period: { from: qStart, to: T } },
    { id: 'prev_quarter', label: 'Trimestre précédent', hint: { text: 'T{q} {y}', params: { q: txt(quarterOf(pq)), y: txt(yearOf(pq)) } }, period: { from: pq, to: addMonths(pq, 2) } },
    { id: 'this_half', label: 'Semestre en cours', hint: { text: 'S{h} {y}', params: { h: txt(h), y: txt(y) } }, period: { from: hStart, to: T } },
  );
  const prevHalf = { from: ph, to: addMonths(ph, 5) };
  const janJun = { from: mm(janJunYear, 1), to: mm(janJunYear, 6) };
  if (!samePeriod(prevHalf, janJun)) {
    list.push({ id: 'prev_half', label: 'Semestre précédent', hint: { text: 'S{h} {y}', params: { h: txt(halfOf(ph)), y: txt(yearOf(ph)) } }, period: prevHalf });
  }
  list.push(
    { id: 'jan_jun', label: 'Janvier – juin {y}', params: { y: txt(janJunYear) }, period: janJun },
    { id: 'ytd', label: 'Année en cours', period: { from: mm(y, 1), to: T } },
    { id: 'last_year', label: 'Année {y}', params: { y: txt(y - 1) }, period: { from: mm(y - 1, 1), to: mm(y - 1, 12) } },
    { id: 'last_12', label: '12 derniers mois', period: { from: addMonths(T, -11), to: T } },
  );
  if (withFullYear) list.push({ id: 'this_year', label: 'Année {y}', params: { y: txt(y) }, period: { from: mm(y, 1), to: mm(y, 12) } });
  return list;
}

/** Identifiant du préréglage qui correspond exactement à la période (le premier), sinon null. */
export function presetOf(period, list) {
  if (!period) return null;
  const hit = (list || []).find((p) => samePeriod(p.period, period));
  return hit ? hit.id : null;
}

// ---- URL (#/route?from=…&to=…) ------------------------------------------------------
function splitHash(hash) {
  const h = String(hash || '');
  const i = h.indexOf('?');
  return i < 0 ? [h, ''] : [h.slice(0, i), h.slice(i + 1)];
}

/** Période d'un hash (« #/dashboard/couverture?from=2026-01&to=2026-06 », ou ?month=) ; null si absente ou invalide. */
export function readHashPeriod(hash) {
  const [, query] = splitHash(hash);
  if (!query) return null;
  const q = new URLSearchParams(query);
  const month = q.get('month');
  const p = month ? single(month) : { from: q.get('from'), to: q.get('to') };
  if (!isPeriod(p) || spanMonths(p) > MAX_SPAN) return null;
  return p;
}

/** Hash avec la période (null = la retire), les autres paramètres gardés. */
export function writeHashPeriod(hash, p) {
  const [route, query] = splitHash(hash);
  const q = new URLSearchParams(query);
  q.delete('month'); q.delete('from'); q.delete('to');
  if (p) { q.set('from', p.from); q.set('to', p.to); }
  const s = q.toString();
  return s ? `${route}?${s}` : route;
}

/** Paramètres d'API d'une période : { from, to } (vide = toutes les périodes). */
export const periodQuery = (p) => (p ? { from: p.from, to: p.to } : {});

/**
 * Paramètres d'API d'une période OU d'un ancien mois (client API, `pq`) : un objet
 * { from, to } donne { from, to } ; une chaîne « AAAA-MM » donne { month } (appelants pas
 * encore passés à la plage — le serveur accepte toujours ?month=) ; rien (null, undefined,
 * '', objet incomplet) donne {} : aucun paramètre, toutes les périodes ou le défaut de l'endpoint.
 */
export function periodParams(p) {
  if (isMonthList(p)) return { months: p.months.join(',') }; // mois cochés : seuls les endpoints qui les acceptent
  if (p && typeof p === 'object') return p.from && p.to ? { from: p.from, to: p.to } : {};
  return typeof p === 'string' && p ? { month: p } : {};
}

// ---- Session (période de travail partagée entre écrans) -----------------------------
/** Période de travail de la session, ou null (stockage indisponible ou valeur invalide). */
export function readSessionPeriod(storage) {
  try {
    const raw = storage && storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return isPeriod(v) && spanMonths(v) <= MAX_SPAN ? { from: v.from, to: v.to } : null;
  } catch { return null; }
}

/** Mémorise (ou efface, p = null) la période de travail de la session. */
export function writeSessionPeriod(storage, p) {
  try {
    if (!storage) return;
    if (p) storage.setItem(SESSION_KEY, JSON.stringify({ from: p.from, to: p.to }));
    else storage.removeItem(SESSION_KEY);
  } catch { /* stockage indisponible : la période vit seulement dans l'URL */ }
}

/**
 * Synthèse d'une période d'après le volume par mois ({ 'AAAA-MM': n }) :
 * { months, submissions, emptyMonths } — « 6 mois · 224 formulaires reçus · 1 mois sans données ».
 */
export function summarizeCounts(p, counts) {
  const ms = monthsOf(p);
  let submissions = 0; let emptyMonths = 0;
  for (const m of ms) {
    const n = Number((counts || {})[m]) || 0;
    submissions += n;
    if (n === 0) emptyMonths += 1;
  }
  return { months: ms.length, submissions, emptyMonths };
}

/**
 * Phrases françaises des erreurs de période du serveur (details.code) — traduites
 * par tr() à l'affichage ; le message du serveur reste en français.
 */
export const PERIOD_ERRORS = {
  period_format: 'Période invalide : mois attendu au format AAAA-MM (ex. 2026-01).',
  period_partial: 'Période incomplète : précisez le début (from) et la fin (to).',
  period_ambiguous: 'Période ambiguë : utilisez soit month, soit from et to.',
  period_order: 'Période invalide : le début ({from}) est après la fin ({to}).',
  period_span: 'Période trop longue : {maxSpan} mois au plus (demandé : {span}).',
  period_year: 'Période hors limites : années 2000 à 2100.',
  period_required: 'Période requise.',
  period_months: 'Liste de mois invalide : mois AAAA-MM séparés par des virgules (ex. 2026-01,2026-03).',
  period_list_unsupported: 'Plusieurs mois non consécutifs : non pris en charge ici ; choisissez une plage « du … au … ».',
};

/** { text, params } de l'erreur de période d'une réponse d'API (err.details), sinon null. */
export function periodError(details) {
  const code = details && details.code;
  if (!code || !PERIOD_ERRORS[code]) return null;
  const { from, to, maxSpan, span } = details;
  return { text: PERIOD_ERRORS[code], params: { from, to, maxSpan, span } };
}
