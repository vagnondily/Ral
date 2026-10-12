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

/** Compteurs des deux bandeaux de KPI, sur le périmètre (déjà filtré). */
function boardKpis(sites) {
  const sum = (k) => sites.reduce((a, s) => a + (s[k] || 0), 0);
  const required = sum('required'); const done = sum('done');
  return {
    total: sites.length,
    active: sites.filter((s) => !s.forbidden).length,
    planned: sites.filter((s) => s.planned > 0).length,
    toVisit: sites.filter((s) => s.remaining > 0 && !s.forbidden).length,
    followed: sites.filter((s) => s.done > 0).length,
    fed: sites.filter((s) => (s.dataCount || 0) > 0).length,
    remainingVisits: sum('remaining'),
    notYetPlanned: sum('toPlan'),
    withoutPlan: sites.filter((s) => !s.forbidden && s.planned === 0 && s.done === 0).length,
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

module.exports = { mmrLookup, requiredVisits, siteCounters, rankSites, boardKpis, normalizeChanges, norm };
