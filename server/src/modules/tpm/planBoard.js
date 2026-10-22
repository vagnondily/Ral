const { deriveMmr } = require('./mmrMath');

/**
 * Plan de suivi « type Excel » — logique PURE (testée, sans I/O).
 *
 * Pour un exercice (année) et chaque site :
 *   exigées  = fréquence minimale MMR de la ligne bureau × activité du site
 *              (dérogation du bureau du site, sinon de son bureau parent, sinon
 *              plan général) — option : fréquence « CO adjusted », arrondie au-dessus ;
 *   faites   = visites réalisées dans l'exercice ;
 *   prévues  = visites planifiées non réalisées dans l'exercice ;
 *   reste    = max(exigées − faites, 0) ; à planifier = max(reste − prévues, 0).
 * Classement des « sites proposés » : reste ↓, priorité ↓, ancienneté de la
 * dernière visite (jamais visité d'abord).
 */
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Index MMR : (bureau, activité) → ligne, avec repli parent puis plan général. */
function mmrLookup(mmrRows = []) {
  const general = new Map(); const byOffice = new Map();
  for (const r of mmrRows) {
    const k = norm(r.activityCategory);
    if (!r.fieldOfficeId) general.set(k, r); else byOffice.set(`${r.fieldOfficeId}|${k}`, r);
  }
  return (officeId, parentId, activity) => {
    const k = norm(activity);
    if (!k) return null;
    return (officeId && byOffice.get(`${officeId}|${k}`)) || (parentId && byOffice.get(`${parentId}|${k}`)) || general.get(k) || null;
  };
}

/** Visites exigées sur l'exercice pour une ligne MMR (null = activité non paramétrée). */
function requiredVisits(mmrRow, { adjusted = false } = {}) {
  if (!mmrRow) return null;
  const d = deriveMmr(mmrRow);
  if (adjusted && d.adjustedFrequency != null) return Math.ceil(d.adjustedFrequency - 1e-9);
  return d.frequency ? Math.round(d.frequency) : 0;
}

const PRIORITY_RANK = { Haute: 2, Moyenne: 1, Basse: 0 };

/**
 * @param {object} site  { months: [{ month: 1..12, status }], lastVisitMonth, priority, forbidden, dataCount }
 * @param {object|null} mmrRow
 */
function siteCounters(site, mmrRow, opts) {
  const months = site.months || [];
  const done = months.filter((m) => m.status === 'realise').length;
  const planned = months.filter((m) => m.status === 'planifie').length;
  const required = requiredVisits(mmrRow, opts);
  const remaining = required == null ? 0 : Math.max(required - done, 0);
  return { required, done, planned, remaining, toPlan: Math.max(remaining - planned, 0), parametered: required != null };
}

/** Tri des sites proposés (copie triée). */
function rankSites(sites) {
  const last = (s) => (s.lastVisitMonth ? s.lastVisitMonth : '');
  return [...sites].sort((a, b) => (b.remaining - a.remaining)
    || ((PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0))
    || last(a).localeCompare(last(b)) // '' (jamais visité) avant toute date, puis la plus ancienne
    || String(a.name).localeCompare(String(b.name), 'fr'));
}

/** Statut courant = dernier mois renseigné de l'exercice (comme la colonne Status du classeur). */
function currentStatus(monthStatus) {
  if (!monthStatus) return null;
  const months = Object.keys(monthStatus).map(Number).filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
  if (!months.length) return null;
  return monthStatus[months[months.length - 1]] ? 'Active' : 'Inactive';
}

/** Compteurs des deux bandeaux de KPI, sur le périmètre (déjà filtré). */
function boardKpis(sites) {
  const sum = (k) => sites.reduce((a, s) => a + (s[k] || 0), 0);
  const required = sum('required'); const done = sum('done');
  return {
    total: sites.length,
    active: sites.filter((s) => !s.forbidden && !s.inactive).length,
    planned: sites.filter((s) => s.planned > 0).length,
    toVisit: sites.filter((s) => s.remaining > 0 && !s.forbidden && !s.inactive).length,
    // « Sites suivis » = suivi EFFECTIF : une visite déclarée réalisée OU des données reçues rattachées
    // au site (retour 48 : la dernière visite effective est la plus récente des deux). Cohérent avec
    // « Jamais visités » (qui exclut déjà les sites alimentés) et avec la couverture des tableaux de bord.
    followed: sites.filter((s) => s.done > 0 || (s.dataCount || 0) > 0).length,
    fed: sites.filter((s) => (s.dataCount || 0) > 0).length,
    remainingVisits: sum('remaining'),
    notYetPlanned: sum('toPlan'),
    withoutPlan: sites.filter((s) => !s.forbidden && !s.inactive && s.planned === 0 && s.done === 0).length,
    neverVisited: sites.filter((s) => !s.lastVisitMonth && !(s.dataCount > 0)).length,
    unparametered: sites.filter((s) => !s.parametered).length,
    requiredVisits: required, doneVisits: done,
    mmrRate: required > 0 ? Math.round((Math.min(done, required) / required) * 1000) / 10 : null,
  };
}

/**
 * Normalise un lot de changements de planification : dédoublonne (dernier
 * gagne), valide les mois 1..12. Renvoie { add: [[siteId, month]], remove: [...] }.
 */
function normalizeChanges(changes = []) {
  const last = new Map();
  for (const c of changes) {
    const m = Number(c.month);
    if (!c.siteId || !Number.isInteger(m) || m < 1 || m > 12) continue;
    last.set(`${c.siteId}|${m}`, { siteId: c.siteId, month: m, planned: Boolean(c.planned) });
  }
  const add = []; const remove = [];
  for (const c of last.values()) (c.planned ? add : remove).push([c.siteId, c.month]);
  return { add, remove };
}

/** Clé MMR d'un site (bureau × activité) — celle de la ligne MMR retenue, pour regrouper les totaux mensuels. */
const mmrKeyOf = (mmrRow) => (mmrRow ? `${mmrRow.fieldOfficeId || ''}|${norm(mmrRow.activityCategory)}` : null);

/**
 * Capacité mensuelle de chaque ligne MMR : ciblé par mois (J) et faisable par
 * mois (K), pour comparer le total prévu d'un mois (pied de grille). Valeurs
 * exactes du classeur ; null quand la division est impossible.
 */
function mmrCapacity(mmrRows = []) {
  const out = {};
  for (const r of mmrRows) {
    const d = deriveMmr(r);
    out[mmrKeyOf(r)] = { fieldOfficeId: r.fieldOfficeId || null, activity: r.activityCategory, targeted: d.targetedPerMonth, feasible: d.feasible ?? null };
  }
  return out;
}

/**
 * « Planifier selon le MMR » : choisit `toPlan` mois répartis régulièrement à
 * partir de `fromMonth`, hors mois déjà occupés (prévus ou réalisés) et hors mois
 * inactifs. S'il reste moins de mois libres que de visites, tous sont pris.
 * @returns {number[]} mois 1..12 croissants
 */
function autoPlanMonths({ toPlan, fromMonth = 1, busy = [], inactive = [] }) {
  const n = Math.max(0, Math.floor(Number(toPlan) || 0));
  if (!n) return [];
  const taken = new Set([...busy, ...inactive].map(Number));
  const free = [];
  for (let m = Math.max(1, Math.min(12, Number(fromMonth) || 1)); m <= 12; m += 1) if (!taken.has(m)) free.push(m);
  if (n >= free.length) return free;
  // Milieu de chaque tranche : 1 visite sur 12 mois libres → mois 7 ; 2 → 4 et 10 ; 4 → 2, 5, 8, 11.
  return Array.from({ length: n }, (_, i) => free[Math.floor(((i + 0.5) * free.length) / n)]);
}

module.exports = { mmrLookup, requiredVisits, siteCounters, rankSites, boardKpis, normalizeChanges, currentStatus, norm, mmrKeyOf, mmrCapacity, autoPlanMonths };
