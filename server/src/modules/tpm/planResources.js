/**
 * Ressources NÉCESSAIRES d'un plan de suivi (retour 108) — module PUR, déterministe, en unités
 * ENTIÈRES (aucun flottant cumulé). Testé (test/planResources.test.js).
 *
 * « À partir d'une telle répartition, on calcule le nombre d'agents […] et le nombre de véhicules
 * pour un suivi bien fait. » Règles (une seule définition, utilisée partout : aperçu, totaux,
 * export « base de budget ») :
 *  - une journée-agent = U unités ; une visite d'une activité à `suivis/jour` = ⌈U ÷ suivis/jour⌉
 *    unités (colonne « Suivis/j » du MMR ; vide → 1 visite par journée, signalé « à paramétrer ») ;
 *  - journées d'une COMMUNE = visites de la commune, toutes activités confondues, remplies jour
 *    après jour (une journée = un agent dans une commune ; une visite de plus d'une journée prend
 *    des jours consécutifs du même agent) ;
 *  - par unité (TPM de la zone, ou « Bureau (suivi interne) » sans TPM) et par mois :
 *    agents = ⌈journées-agent ÷ jours de terrain⌉ (jours ouvrés du MMR, le plus petit des
 *    activités présentes ; à défaut le paramètre « jours de terrain par mois »), les journées
 *    étant données dans l'ordre des tournées (district, puis commune) à l'agent libre le plus tôt —
 *    un agent de plus si une journée dépasserait le mois ;
 *  - véhicules d'un jour = Σ par district ⌈agents du district ce jour ÷ agents par véhicule⌉ ;
 *    pic et moyenne sur les jours de terrain utilisés ;
 *  - comparaison aux personnes déclarées au MMR : une INFORMATION (écart signalé), jamais une limite.
 * Les visites nouvelles reçoivent leur créneau (agent, jour de terrain, date, tournée).
 */

/** Une journée-agent en unités (divisible par 1 à 10, 12, 0,5…) : calculs exacts en entiers. */
const U = 252000;
const BUREAU = 'bureau';
const pad = (m) => String(m).padStart(2, '0');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Coût d'une visite en unités et drapeau « à paramétrer » (suivis/jour inconnu). */
function visitCost(visitsPerDay) {
  const v = Number(visitsPerDay);
  if (!(v > 0)) return { cost: U, unknown: true };
  return { cost: Math.ceil(U / v), unknown: false };
}

/**
 * Jours de terrain d'un mois (numéros de jour), dans l'ordre du calendrier : du lundi au vendredi ;
 * du lundi au samedi quand les jours de terrain dépassent les jours de semaine. Calendrier mis en
 * mémoire par mois (appelé pour chaque créneau).
 */
const CALENDAR = new Map();
function monthCalendar(year, month) {
  const k = `${year}-${month}`;
  let c = CALENDAR.get(k);
  if (!c) {
    const week = []; const six = [];
    const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let d = 1; d <= n; d += 1) {
      const wd = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
      if (wd >= 1 && wd <= 5) week.push(d);
      if (wd >= 1 && wd <= 6) six.push(d);
    }
    c = { week, six };
    if (CALENDAR.size > 600) CALENDAR.clear();
    CALENDAR.set(k, c);
  }
  return c;
}
function fieldDays(year, month, workingDays = 0) {
  const { week, six } = monthCalendar(year, month);
  return workingDays > week.length ? six : week;
}

/** Date ('AAAA-MM-JJ') du f-ième jour de terrain du mois (borné au dernier jour de terrain). */
function fieldDate(year, month, f, workingDays = 0) {
  const list = fieldDays(year, month, workingDays);
  const day = list[Math.max(1, Math.min(f, list.length)) - 1];
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Journées d'une commune : visites remplies jour après jour (une visite > 1 jour : span jours). */
function communeDays(visits) {
  const days = []; let cur = null;
  for (const v of visits) {
    if (v.cost > U) { days.push({ span: Math.ceil(v.cost / U), visits: [v] }); continue; }
    if (!cur || cur.used + v.cost > U) { cur = { span: 1, used: 0, visits: [] }; days.push(cur); }
    cur.used += v.cost; cur.visits.push(v);
  }
  return days;
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Ressources d'un mois pour une unité. `items` = journées dans l'ordre des tournées, données une à
 * une à l'agent libre le plus tôt. Agents = le plus petit nombre (au moins ⌈journées ÷ jours de
 * terrain⌉) pour lequel toutes les journées tiennent dans les jours de terrain du mois — une visite
 * plus longue que le mois, seule sur son agent, commence le 1ᵉʳ jour. Recherche dichotomique (la
 * place d'une journée ne recule jamais avec un agent de plus) : jamais une boucle agent par agent.
 * @returns {{ agents, agentDays, assign: {item, agent, fieldDay}[] }}
 */
function assignDays(items, agents) {
  const free = Array(agents).fill(1);
  return items.map((d) => {
    let a = 0; for (let i = 1; i < agents; i += 1) if (free[i] < free[a]) a = i;
    const f = free[a]; free[a] += d.span;
    return { item: d, agent: a + 1, fieldDay: f };
  });
}
function scheduleUnit(items, workingDays) {
  const agentDays = items.reduce((a, d) => a + d.span, 0);
  if (!agentDays) return { agents: 0, agentDays: 0, assign: [] };
  const fits = (assign) => assign.every((x) => x.fieldDay + x.item.span - 1 <= Math.max(workingDays, x.item.span));
  // Une journée par agent tient toujours : au plus autant d'agents que de journées.
  let hi = items.length;
  let lo = Math.min(hi, Math.max(1, Math.ceil(agentDays / workingDays)));
  let best = assignDays(items, hi);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const a = assignDays(items, mid);
    if (fits(a)) { hi = mid; best = a; } else lo = mid + 1;
  }
  return { agents: hi, agentDays, assign: best };
}

/**
 * @param {Array<{siteId, month:'AAAA-MM', unitKey, unitName, assigned, district, commune,
 *                 activityKey, visitsPerDay, workingDays, isNew}>} visits  visites À FAIRE
 *   (prévues existantes et nouvelles ; une visite réalisée n'appelle plus de ressources)
 * @param {{ agentsPerVehicle?: number, fieldDaysPerMonth?: number, declared?: Record<string, number> }} opts
 *   declared : personnes déclarées au MMR par activité (clé d'activité)
 * @returns {{ months, units, slots, peak, activities, agentsPerVehicle, fieldDaysPerMonth }}
 */
function planResources(visits = [], { agentsPerVehicle = 4, fieldDaysPerMonth = 20, declared = {} } = {}) {
  const apv = Math.min(10, Math.max(1, Math.round(Number(agentsPerVehicle)) || 4));
  const fdm = Math.min(26, Math.max(1, Math.round(Number(fieldDaysPerMonth)) || 20));
  const byMonth = new Map();
  for (const v of visits || []) {
    if (!v || !v.siteId || !/^\d{4}-\d{2}$/.test(String(v.month))) continue;
    if (!byMonth.has(v.month)) byMonth.set(v.month, []);
    byMonth.get(v.month).push(v);
  }
  const slots = {}; const months = []; const unitRows = new Map(); const activities = new Map();
  let unknownRate = 0;
  for (const month of [...byMonth.keys()].sort()) {
    const year = Number(month.slice(0, 4)); const M = Number(month.slice(5, 7));
    const list = byMonth.get(month);
    const byUnit = new Map();
    for (const v of list) {
      const k = v.unitKey || BUREAU;
      if (!byUnit.has(k)) byUnit.set(k, []);
      byUnit.get(k).push(v);
    }
    const vehiclesByDate = new Map(); const zones = new Map();
    let mAgents = 0; let mAgentDays = 0; let mVisits = 0; let mNew = 0;
    const actKeys = new Set();
    for (const unitKey of [...byUnit.keys()].sort()) {
      const uv = byUnit.get(unitKey);
      // Tournées : district, puis commune ; visites d'une commune par activité puis site.
      const communes = new Map();
      for (const v of uv) {
        const { cost, unknown } = visitCost(v.visitsPerDay);
        if (unknown) unknownRate += 1;
        const ck = `${v.district || ''}|${v.commune || ''}`;
        if (!communes.has(ck)) communes.set(ck, { district: v.district || null, commune: v.commune || null, visits: [] });
        communes.get(ck).visits.push({ ...v, cost });
        actKeys.add(v.activityKey || null);
        // Part de l'activité (journées-agent en unités), pour l'aperçu par activité.
        const a = activities.get(v.activityKey || '') || { agentUnits: new Map(), visits: new Map(), workingDays: v.workingDays || null };
        a.agentUnits.set(month, (a.agentUnits.get(month) || 0) + cost);
        a.visits.set(month, (a.visits.get(month) || 0) + 1);
        activities.set(v.activityKey || '', a);
      }
      const ordered = [...communes.values()].sort((a, b) => cmp(String(a.district || ''), String(b.district || '')) || cmp(String(a.commune || ''), String(b.commune || '')));
      const districtRank = new Map();
      for (const c of ordered) if (!districtRank.has(c.district)) districtRank.set(c.district, districtRank.size + 1);
      const items = [];
      for (const c of ordered) {
        c.visits.sort((a, b) => cmp(String(a.activityKey || ''), String(b.activityKey || '')) || cmp(String(a.siteId), String(b.siteId)));
        for (const d of communeDays(c.visits)) items.push({ ...d, district: c.district, commune: c.commune, tour: districtRank.get(c.district) });
      }
      // Jours de terrain : jours ouvrés du MMR (le plus petit des activités présentes), sinon le paramètre.
      const wds = uv.map((v) => Number(v.workingDays)).filter((x) => x > 0);
      const wanted = wds.length ? Math.min(...wds) : fdm;
      const workingDays = Math.min(wanted, fieldDays(year, M, wanted).length);
      const { agents, agentDays, assign } = scheduleUnit(items, workingDays);
      const byDay = new Map(); // date → Map(district → agents)
      for (const x of assign) {
        for (let k = 0; k < x.item.span; k += 1) {
          const date = fieldDate(year, M, x.fieldDay + k, workingDays);
          if (!byDay.has(date)) byDay.set(date, new Map());
          const dm = byDay.get(date); dm.set(x.item.district, (dm.get(x.item.district) || 0) + 1);
        }
        const date = fieldDate(year, M, x.fieldDay, workingDays);
        for (const v of x.item.visits) {
          if (v.isNew) slots[`${v.siteId}|${month}`] = { agent: x.agent, fieldDay: x.fieldDay, date, tour: x.item.tour };
        }
        const z = zones.get(x.item.district || '') || { district: x.item.district, agentDays: 0, visits: 0, communes: new Map() };
        z.agentDays += x.item.span; z.visits += x.item.visits.length;
        const cz = z.communes.get(x.item.commune || '') || { commune: x.item.commune, agentDays: 0, visits: 0 };
        cz.agentDays += x.item.span; cz.visits += x.item.visits.length;
        z.communes.set(x.item.commune || '', cz); zones.set(x.item.district || '', z);
      }
      const perDay = [...byDay.entries()].map(([date, dm]) => [date, [...dm.values()].reduce((a, n) => a + Math.ceil(n / apv), 0)]);
      for (const [date, n] of perDay) vehiclesByDate.set(date, (vehiclesByDate.get(date) || 0) + n);
      const vPeak = perDay.reduce((a, [, n]) => Math.max(a, n), 0);
      const vSum = perDay.reduce((a, [, n]) => a + n, 0);
      const row = {
        month, visits: uv.length, newVisits: uv.filter((v) => v.isNew).length, agentDays, agentsNeeded: agents,
        workingDays, workingDaysSource: wds.length ? 'mmr' : 'parametre',
        communes: communes.size, districts: districtRank.size,
        vehiclesPeak: vPeak, vehiclesAvg: perDay.length ? round1(vSum / perDay.length) : 0, fieldDaysUsed: byDay.size,
      };
      if (!unitRows.has(unitKey)) unitRows.set(unitKey, { unitKey, name: uv[0].unitName || null, assigned: Boolean(uv[0].assigned), months: [] });
      unitRows.get(unitKey).months.push(row);
      mAgents += agents; mAgentDays += agentDays; mVisits += uv.length; mNew += row.newVisits;
    }
    const vehicles = [...vehiclesByDate.values()];
    const dec = [...actKeys].map((k) => Number(declared[k || ''])).filter((n) => n > 0);
    const declaredTotal = dec.length ? dec.reduce((a, n) => a + n, 0) : null;
    months.push({
      month, visits: mVisits, newVisits: mNew, agentDays: mAgentDays, agentsNeeded: mAgents,
      declared: declaredTotal, gap: declaredTotal == null ? null : mAgents - declaredTotal,
      vehiclesPeak: vehicles.length ? Math.max(...vehicles) : 0,
      vehiclesAvg: vehicles.length ? round1(vehicles.reduce((a, n) => a + n, 0) / vehicles.length) : 0,
      zones: [...zones.values()].sort((a, b) => cmp(String(a.district || ''), String(b.district || ''))).map((z) => ({
        district: z.district, agentDays: z.agentDays, visits: z.visits,
        sitesPerDay: z.agentDays ? round1(z.visits / z.agentDays) : null,
        communes: [...z.communes.values()].sort((a, b) => cmp(String(a.commune || ''), String(b.commune || '')))
          .map((c) => ({ ...c, sitesPerDay: c.agentDays ? round1(c.visits / c.agentDays) : null })),
      })),
    });
  }
  const units = [...unitRows.values()].map((u) => {
    const active = u.months.filter((r) => r.agentsNeeded > 0);
    return {
      ...u,
      visits: u.months.reduce((a, r) => a + r.visits, 0),
      newVisits: u.months.reduce((a, r) => a + r.newVisits, 0),
      agentDays: u.months.reduce((a, r) => a + r.agentDays, 0),
      agentsPeak: u.months.reduce((a, r) => Math.max(a, r.agentsNeeded), 0),
      agentsAvg: active.length ? round1(active.reduce((a, r) => a + r.agentsNeeded, 0) / active.length) : 0,
      vehiclesPeak: u.months.reduce((a, r) => Math.max(a, r.vehiclesPeak), 0),
      workingDaysSource: u.months.some((r) => r.workingDaysSource === 'parametre') ? 'parametre' : 'mmr',
    };
  }).sort((a, b) => Number(b.assigned) - Number(a.assigned) || (b.visits - a.visits) || cmp(String(a.name || ''), String(b.name || '')));
  const peakOf = (k) => months.reduce((best, x) => (x[k] > (best ? best[k] : -1) ? x : best), null);
  const pa = peakOf('agentsNeeded'); const pv = peakOf('vehiclesPeak');
  const busyMonths = months.filter((m) => m.agentsNeeded > 0);
  const actOut = {};
  for (const [k, a] of activities) {
    actOut[k] = {
      visits: Object.fromEntries(a.visits),
      // Journées-agent de l'activité (sa part des journées de commune), arrondies au jour supérieur.
      agentDays: Object.fromEntries([...a.agentUnits].map(([m, u]) => [m, Math.ceil(u / U)])),
    };
  }
  return {
    agentsPerVehicle: apv, fieldDaysPerMonth: fdm, months, units, slots, activities: actOut,
    visitsWithoutRate: unknownRate,
    peak: {
      agents: pa ? pa.agentsNeeded : 0, agentsMonth: pa ? pa.month : null,
      agentsAvg: busyMonths.length ? round1(busyMonths.reduce((a, m) => a + m.agentsNeeded, 0) / busyMonths.length) : 0,
      vehicles: pv ? pv.vehiclesPeak : 0, vehiclesMonth: pv ? pv.month : null,
    },
  };
}

module.exports = { U, visitCost, fieldDays, fieldDate, communeDays, assignDays, scheduleUnit, planResources };
