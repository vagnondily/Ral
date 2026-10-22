/**
 * Plan de suivi — calculs d'affichage côté écran, MIROIR de
 * server/src/modules/tpm/planBoard.js (boardKpis) : les compteurs et KPI se
 * recalculent en direct sur le périmètre filtré et sur les coches non encore
 * enregistrées. Le serveur reste la référence (il recalcule à l'enregistrement).
 */

/** Clé d'une coche en attente. */
export const pendingKey = (siteId, month) => `${siteId}|${month}`;

/**
 * Applique les coches en attente ({ 'siteId|mois': true|false }) aux sites :
 * ajoute/retire les mois « planifie » (jamais une visite réalisée), puis
 * recalcule Prévues et « à planifier ». Renvoie de nouveaux objets site.
 */
export function applyPending(sites, pending) {
  const bySite = new Map();
  for (const [k, planned] of Object.entries(pending)) {
    const [id, m] = k.split('|');
    if (!bySite.has(id)) bySite.set(id, []);
    bySite.get(id).push([Number(m), planned]);
  }
  if (!bySite.size) return sites;
  return sites.map((s) => {
    const changes = bySite.get(s.id);
    if (!changes) return s;
    let months = [...(s.months || [])];
    for (const [m, planned] of changes) {
      const cur = months.find((x) => x.month === m);
      if (planned && !cur) months.push({ month: m, status: 'planifie', pending: true });
      if (!planned && cur && cur.status === 'planifie') months = months.filter((x) => x.month !== m);
    }
    months.sort((a, b) => a.month - b.month);
    const planned = months.filter((x) => x.status === 'planifie').length;
    return { ...s, months, planned, toPlan: Math.max((s.remaining || 0) - planned, 0) };
  });
}

/** Bandeaux de KPI sur le périmètre (déjà filtré) — identique au serveur. */
export function boardKpis(sites) {
  const sum = (k) => sites.reduce((a, s) => a + (s[k] || 0), 0);
  const required = sum('required'); const done = sum('done');
  const live = (s) => !s.forbidden && !s.inactive;
  return {
    total: sites.length,
    active: sites.filter(live).length,
    planned: sites.filter((s) => s.planned > 0).length,
    toVisit: sites.filter((s) => s.remaining > 0 && live(s)).length,
    // « Sites suivis » = suivi EFFECTIF : visite déclarée réalisée OU données reçues rattachées au site
    // (retour 48). Doit rester identique au serveur (tpm/planBoard.boardKpis).
    followed: sites.filter((s) => s.done > 0 || (s.dataCount || 0) > 0).length,
    fed: sites.filter((s) => (s.dataCount || 0) > 0).length,
    remainingVisits: sum('remaining'),
    notYetPlanned: sum('toPlan'),
    withoutPlan: sites.filter((s) => live(s) && s.planned === 0 && s.done === 0).length,
    neverVisited: sites.filter((s) => !s.lastVisitMonth && !(s.dataCount > 0)).length,
    unparametered: sites.filter((s) => !s.parametered).length,
    requiredVisits: required, doneVisits: done,
    mmrRate: required > 0 ? Math.round((Math.min(done, required) / required) * 1000) / 10 : null,
  };
}

/** Seuils de couleur du classeur RBM : < 50 % rouge, < 90 % ambre, ≥ 90 % vert. */
export const rateTone = (pct) => (pct == null ? 'na' : pct >= 90 ? 'ok' : pct >= 50 ? 'warn' : 'bad');

/**
 * Pied de grille : par mois, visites prévues ou réalisées du périmètre, face au
 * ciblé par mois (J) et au faisable (K) des lignes MMR présentes dans le périmètre.
 */
export function monthTotals(sites, capacity = {}) {
  const keys = new Set(sites.map((s) => s.mmrKey).filter(Boolean));
  let targeted = 0; let feasible = 0; let hasFeasible = false;
  for (const k of keys) {
    const c = capacity[k];
    if (!c) continue;
    targeted += c.targeted || 0;
    if (c.feasible != null) { feasible += c.feasible; hasFeasible = true; }
  }
  const counts = Array(12).fill(0);
  for (const s of sites) for (const m of s.months || []) if (m.month >= 1 && m.month <= 12) counts[m.month - 1] += 1;
  return counts.map((n, i) => ({
    month: i + 1, count: n, targeted: targeted ? Math.round(targeted * 10) / 10 : null, feasible: hasFeasible ? Math.round(feasible * 10) / 10 : null,
    rate: targeted > 0 ? Math.round((n / targeted) * 1000) / 10 : null, overCapacity: hasFeasible && n > feasible,
  }));
}

/** % des visites de l'exercice réalisées (réalisées ÷ (réalisées + prévues)) — couleur des points de la carte. */
export function visitRate(s) {
  const total = (s.done || 0) + (s.planned || 0);
  return total ? Math.round(((s.done || 0) / total) * 1000) / 10 : null;
}
