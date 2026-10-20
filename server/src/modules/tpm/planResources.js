/**
 * Ressources NÉCESSAIRES d'un plan de suivi (retour 108) — module PUR, déterministe, en unités
 * ENTIÈRES (aucun flottant cumulé). Testé (test/planResources.test.js).
 *
 * « À partir d'une telle répartition, on calcule le nombre d'agents […] et le nombre de véhicules
 * pour un suivi bien fait. » Règles (une seule définition, utilisée partout : aperçu, totaux,
 * export « base de budget ») :
 *  - une journée-agent = U unités ; une visite d'une activité à `suivis/jour` = ⌈U ÷ suivis/jour⌉
 *    unités (colonne « Suivis/j » du MMR ; vide → 1 visite par journée, signalé « à paramétrer ») ;
 *  - journées d'une COMMUNE (la même clé de regroupement que le moteur : commune de son district,
 *    casse et espaces ignorés, GPS en second) = visites de la commune, toutes activités confondues,
 *    remplies jour après jour (une journée = un agent dans une commune ; une visite de plus d'une
 *    journée prend des jours consécutifs du même agent) ;
 *  - jours de terrain d'un mois : du lundi au vendredi (au samedi quand les jours voulus dépassent
 *    les jours de semaine), jours ouvrés du MMR (le plus petit des activités présentes), à défaut le
 *    paramètre « jours de terrain par mois » ; le mois EN COURS ne compte que les jours restants à
 *    partir d'aujourd'hui (`today`) — jamais une date passée ;
 *  - par unité (TPM de la zone, ou le bureau en suivi interne) et par mois : agents = le plus petit
 *    effectif où toutes les journées tiennent dans les jours de terrain (au moins ⌈journées ÷ jours de
 *    terrain⌉, plus un agent par visite plus longue que le mois), les journées étant données dans
 *    l'ordre des tournées (district, puis commune) à l'agent libre le plus tôt ;
 *  - un créneau DÉJÀ écrit (visite prévue ou réalisée datée, « Agent N ») est réservé sur TOUTE sa
 *    durée (une visite à moins d'un suivi par jour couvre plusieurs jours à partir de sa date) : les
 *    nouvelles journées de cet agent viennent après, jamais le même jour (aucun agent à deux endroits) ;
 *  - véhicules d'un jour = Σ par district ⌈agents du district ce jour ÷ agents par véhicule⌉ (un
 *    agent compté une fois par jour) ; pic et moyenne sur les jours de terrain utilisés ;
 *  - comparaison aux personnes déclarées au MMR : une INFORMATION (écart signalé), jamais une limite.
 * Les visites nouvelles reçoivent leur créneau (agent, jour de terrain, date, tournée).
 */

/** Une journée-agent en unités (divisible par 1 à 10, 12, 0,5…) : calculs exacts en entiers. */
const U = 252000;
const BUREAU = 'bureau:none';
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

/** Numéro d'un agent générique (« Agent 3 » → 3) ; null pour un nom propre ou vide. */
function agentNumber(agent) {
  const m = /^\s*agent\s+(\d{1,4})\s*$/i.exec(String(agent == null ? '' : agent));
  return m ? Number(m[1]) : null;
}

/** Jour 'AAAA-MM-JJ' → { year, month, day } (null si illisible). */
function parseDay(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

/**
 * Jours de terrain UTILISABLES d'un mois (numéros de jour, croissants) : pour le mois en cours,
 * seulement à partir d'aujourd'hui (au moins aujourd'hui s'il ne reste aucun jour de terrain).
 */
function usableDays(year, month, wanted, today = null) {
  const list = fieldDays(year, month, wanted);
  const t = parseDay(today);
  if (!t || t.year !== year || t.month !== month) return list;
  const rest = list.filter((d) => d >= t.day);
  return rest.length ? rest : [t.day];
}

/** Tas binaire minimal sur [clé, agent] (clé puis numéro d'agent : l'agent libre le plus tôt, le plus petit numéro). */
const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
function heapPush(h, e) {
  h.push(e);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!before(h[i], h[p])) break;
    [h[i], h[p]] = [h[p], h[i]]; i = p;
  }
}
function heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1; const r = l + 1; let m = i;
      if (l < h.length && before(h[l], h[m])) m = l;
      if (r < h.length && before(h[r], h[m])) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m], h[i]]; i = m;
    }
  }
  return top;
}

/**
 * Journées données une à une à l'agent libre le plus tôt (tas : O(journées × log agents)).
 * `reserved` : agent → dernier jour de terrain déjà pris par une visite écrite ; ses nouvelles
 * journées commencent après.
 * @returns {{item, agent, fieldDay}[]}
 */
function assignDays(items, agents, reserved = new Map()) {
  const heap = [];
  for (let a = 1; a <= agents; a += 1) heapPush(heap, [(reserved.get(a) || 0) + 1, a]);
  return items.map((d) => {
    const [f, a] = heapPop(heap);
    heapPush(heap, [f + d.span, a]);
    return { item: d, agent: a, fieldDay: f };
  });
}

/**
 * Ressources d'un mois pour une unité. `items` = journées dans l'ordre des tournées. Agents = le
 * plus petit effectif pour lequel chaque journée tient dans les jours de terrain (une visite plus
 * longue que le mois, seule sur son agent, commence le 1ᵉʳ jour) : borne basse ⌈journées qui
 * tiennent ÷ jours de terrain⌉ + une par visite plus longue que le mois, puis recherche
 * exponentielle et dichotomique (la place d'une journée ne recule jamais avec un agent de plus).
 * @param {Map<number, number>} reserved créneaux déjà écrits (agent → dernier jour pris)
 * @returns {{ agents, agentDays, assign: {item, agent, fieldDay}[] }}
 */
function scheduleUnit(items, workingDays, reserved = new Map()) {
  const W = Math.max(1, workingDays);
  const agentDays = items.reduce((a, d) => a + d.span, 0);
  if (!agentDays) return { agents: 0, agentDays: 0, assign: [] };
  const fits = (assign) => assign.every((x) => x.fieldDay + x.item.span - 1 <= Math.max(W, x.item.span));
  const long = items.filter((d) => d.span > W).length;
  const shortDays = items.reduce((a, d) => a + (d.span > W ? 0 : d.span), 0);
  const maxReserved = reserved.size ? Math.max(...reserved.keys()) : 0;
  // Toujours faisable : chaque journée a un agent libre dès le 1ᵉʳ jour.
  const hi0 = items.length + maxReserved;
  let lo = Math.max(1, Math.min(hi0, long + Math.ceil(shortDays / W)));
  let probe = lo; let step = 1; let assign = assignDays(items, probe, reserved);
  while (!fits(assign) && probe < hi0) {
    lo = probe + 1;
    probe = Math.min(hi0, probe + step); step *= 2;
    assign = assignDays(items, probe, reserved);
  }
  let hi = probe; let best = assign;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const a = assignDays(items, mid, reserved);
    if (fits(a)) { hi = mid; best = a; } else lo = mid + 1;
  }
  return { agents: hi, agentDays, assign: best };
}

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

/**
 * @param {Array<{siteId, month:'AAAA-MM', unitKey, unitName, officeName, assigned, district, commune,
 *                 clusterKey, districtKey, activityKey, visitsPerDay, workingDays, isNew, date?, agent?}>} visits
 *   visites À FAIRE (prévues existantes et nouvelles ; une visite réalisée n'appelle plus de
 *   ressources) ; `date` / `agent` d'une visite existante déjà datée et affectée réservent son créneau
 * @param {{ agentsPerVehicle?: number, fieldDaysPerMonth?: number, declared?: Record<string, number>, today?: string }} opts
 *   declared : personnes déclarées au MMR par activité ; today : 'AAAA-MM-JJ' (le mois en cours
 *   commence à ce jour)
 * @returns {{ months, units, slots, peak, activities, agentsPerVehicle, fieldDaysPerMonth }}
 */
function planResources(visits = [], { agentsPerVehicle = 4, fieldDaysPerMonth = 20, declared = {}, today = null } = {}) {
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
      // Jours de terrain : jours ouvrés du MMR (le plus petit des activités présentes), sinon le
      // paramètre ; le mois en cours à partir d'aujourd'hui.
      const wds = uv.filter((v) => !v.reserveOnly).map((v) => Number(v.workingDays)).filter((x) => x > 0);
      const wanted = wds.length ? Math.min(...wds) : fdm;
      const dayList = usableDays(year, M, wanted, today);
      const workingDays = Math.max(1, Math.min(wanted, dayList.length));
      const dates = dayList.map((d) => `${year}-${pad(M)}-${pad(d)}`);   // une fois par unité et par mois
      const dateOf = (f) => dates[Math.max(1, Math.min(f, dates.length)) - 1];
      const dayIndex = new Map(dates.map((d, i) => [d, i + 1]));
      // Créneaux déjà écrits (« Agent N » daté) : réservés sur TOUTE leur durée — une visite à moins
      // d'un suivi par jour prend ⌈coût ÷ U⌉ jours de terrain consécutifs à partir de sa date (on ne
      // stocke que la date de début) ; comptés sur le calendrier complet du mois, puis ceux encore
      // utilisables : une visite de deux jours commencée hier réserve aujourd'hui.
      const fullDates = fieldDays(year, M, wanted).map((d) => `${year}-${pad(M)}-${pad(d)}`);
      const fullIndex = new Map(fullDates.map((d, i) => [d, i]));
      const coveredOf = (v) => {
        const n = agentNumber(v.agent);
        const i0 = n != null && v.date ? fullIndex.get(String(v.date)) : undefined;
        if (i0 === undefined) return null;
        const span = Math.max(1, Math.ceil(visitCost(v.visitsPerDay).cost / U));
        const fds = [];
        for (let k = 0; k < span && i0 + k < fullDates.length; k += 1) {
          const fd = dayIndex.get(fullDates[i0 + k]);
          if (fd != null) fds.push(fd);
        }
        return fds.length ? { agentNo: n, fieldDays: fds } : null;
      };
      const reserved = new Map(); const fixedCells = new Set(); const fixed = [];
      const reserve = (c) => reserved.set(c.agentNo, Math.max(reserved.get(c.agentNo) || 0, ...c.fieldDays));
      // Créneau d'une visite RÉALISÉE (datée, « Agent N ») : seulement réservé — ni visite à faire,
      // ni agent à compter.
      const todo = [];
      for (const v of uv) {
        if (!v.reserveOnly) { todo.push(v); continue; }
        const c = coveredOf(v);
        if (c) reserve(c);
      }
      if (!todo.length) continue;
      // Tournées : district, puis commune (clé du moteur) ; visites d'une commune par activité puis site.
      const communes = new Map();
      for (const v of todo) {
        const { cost, unknown } = visitCost(v.visitsPerDay);
        if (unknown) unknownRate += 1;
        actKeys.add(v.activityKey || null);
        const a = activities.get(v.activityKey || '') || { agentUnits: new Map(), visits: new Map(), workingDays: v.workingDays || null };
        a.agentUnits.set(month, (a.agentUnits.get(month) || 0) + cost);
        a.visits.set(month, (a.visits.get(month) || 0) + 1);
        activities.set(v.activityKey || '', a);
        const dk = v.districtKey != null ? String(v.districtKey) : norm(v.district);
        const ck = v.clusterKey || `${dk}|c:${norm(v.commune)}`;
        const c = !v.isNew ? coveredOf(v) : null;
        if (c) {
          fixed.push({ ...v, agentNo: c.agentNo, fieldDays: c.fieldDays, districtKey: dk, clusterKey: ck });
          reserve(c);
          for (const fd of c.fieldDays) fixedCells.add(`${c.agentNo}|${fd}`);
          continue;
        }
        if (!communes.has(ck)) communes.set(ck, { districtKey: dk, district: v.district || null, commune: v.commune || null, clusterKey: ck, visits: [] });
        // Objet léger (le site, nouvelle ou non, l'activité, le coût) : pas de copie de la visite entière.
        communes.get(ck).visits.push({ siteId: v.siteId, isNew: Boolean(v.isNew), activityKey: v.activityKey || '', cost });
      }
      const ordered = [...communes.values()].sort((a, b) => cmp(a.districtKey, b.districtKey) || cmp(a.clusterKey, b.clusterKey));
      const districtRank = new Map(); const districtLabel = new Map();
      for (const c of [...ordered, ...fixed].sort((a, b) => cmp(a.districtKey, b.districtKey))) {
        if (!districtRank.has(c.districtKey)) districtRank.set(c.districtKey, districtRank.size + 1);
        if (!districtLabel.has(c.districtKey) && c.district) districtLabel.set(c.districtKey, c.district);
      }
      const items = [];
      for (const c of ordered) {
        c.visits.sort((a, b) => cmp(String(a.activityKey), String(b.activityKey)) || cmp(String(a.siteId), String(b.siteId)));
        for (const d of communeDays(c.visits)) items.push({ ...d, districtKey: c.districtKey, clusterKey: c.clusterKey, commune: c.commune, tour: districtRank.get(c.districtKey) });
      }
      const sched = scheduleUnit(items, workingDays, reserved);
      // Agents : ceux des journées à faire et des créneaux prévus déjà écrits (pas ceux d'une visite
      // seulement réalisée).
      const used = new Set(fixed.map((f) => f.agentNo));
      for (const x of sched.assign) used.add(x.agent);
      const agents = items.length || fixed.length ? used.size : 0;
      const agentDays = sched.agentDays + fixedCells.size;
      const byDay = new Map(); // date → Map(district → Set(agent))
      const mark = (date, dk, agent) => {
        if (!byDay.has(date)) byDay.set(date, new Map());
        const dm = byDay.get(date);
        if (!dm.has(dk)) dm.set(dk, new Set());
        dm.get(dk).add(agent);
      };
      const zone = (dk, ck, communeLabel, days, nVisits) => {
        const z = zones.get(dk) || { district: districtLabel.get(dk) || null, agentDays: 0, visits: 0, communes: new Map() };
        z.agentDays += days; z.visits += nVisits;
        const cz = z.communes.get(ck) || { commune: communeLabel || null, agentDays: 0, visits: 0 };
        cz.agentDays += days; cz.visits += nVisits;
        z.communes.set(ck, cz); zones.set(dk, z);
      };
      for (const x of sched.assign) {
        // Un agent compté une fois par jour ; une visite plus longue que le mois s'arrête au dernier jour.
        for (let k = 0; k < x.item.span && x.fieldDay + k <= dayList.length; k += 1) mark(dateOf(x.fieldDay + k), x.item.districtKey, x.agent);
        const date = dateOf(x.fieldDay);
        for (const v of x.item.visits) {
          if (v.isNew) slots[`${v.siteId}|${month}`] = { agent: x.agent, fieldDay: x.fieldDay, date, tour: x.item.tour };
        }
        zone(x.item.districtKey, x.item.clusterKey, x.item.commune, x.item.span, x.item.visits.length);
      }
      // Visites écrites : chaque jour couvert compte (agent-jours, véhicules), une seule fois par agent.
      const fixedDays = new Set();
      for (const f of fixed) {
        let fresh = 0;
        for (const fd of f.fieldDays) {
          mark(dateOf(fd), f.districtKey, f.agentNo);
          const cell = `${f.agentNo}|${fd}`;
          if (!fixedDays.has(cell)) { fixedDays.add(cell); fresh += 1; }
        }
        zone(f.districtKey, f.clusterKey, f.commune, fresh, 1);
      }
      const perDay = [...byDay.entries()].map(([date, dm]) => [date, [...dm.values()].reduce((a, set) => a + Math.ceil(set.size / apv), 0)]);
      for (const [date, n] of perDay) vehiclesByDate.set(date, (vehiclesByDate.get(date) || 0) + n);
      const vPeak = perDay.reduce((a, [, n]) => Math.max(a, n), 0);
      const vSum = perDay.reduce((a, [, n]) => a + n, 0);
      const row = {
        month, visits: todo.length, newVisits: todo.filter((v) => v.isNew).length, agentDays, agentsNeeded: agents,
        workingDays, workingDaysSource: wds.length ? 'mmr' : 'parametre', firstFieldDate: dateOf(1), reservedSlots: fixed.length,
        communes: communes.size, districts: districtRank.size,
        vehiclesPeak: vPeak, vehiclesAvg: perDay.length ? round1(vSum / perDay.length) : 0, fieldDaysUsed: byDay.size,
      };
      if (!unitRows.has(unitKey)) {
        unitRows.set(unitKey, { unitKey, name: todo[0].unitName || null, officeName: todo[0].officeName || null, assigned: Boolean(todo[0].assigned), months: [], sites: new Set(), newSites: new Set() });
      }
      const ur = unitRows.get(unitKey);
      ur.months.push(row);
      for (const v of todo) { ur.sites.add(v.siteId); if (v.isNew) ur.newSites.add(v.siteId); }
      mAgents += agents; mAgentDays += agentDays; mVisits += todo.length; mNew += row.newVisits;
    }
    const vehicles = [...vehiclesByDate.values()];
    const dec = [...actKeys].map((k) => Number(declared[k || ''])).filter((n) => n > 0);
    const declaredTotal = dec.length ? dec.reduce((a, n) => a + n, 0) : null;
    months.push({
      month, visits: mVisits, newVisits: mNew, agentDays: mAgentDays, agentsNeeded: mAgents,
      declared: declaredTotal, gap: declaredTotal == null ? null : mAgents - declaredTotal,
      vehiclesPeak: vehicles.length ? Math.max(...vehicles) : 0,
      vehiclesAvg: vehicles.length ? round1(vehicles.reduce((a, n) => a + n, 0) / vehicles.length) : 0,
      zones: [...zones.entries()].sort((a, b) => cmp(a[0], b[0])).map(([, z]) => ({
        district: z.district, agentDays: z.agentDays, visits: z.visits,
        sitesPerDay: z.agentDays ? round1(z.visits / z.agentDays) : null,
        communes: [...z.communes.entries()].sort((a, b) => cmp(a[0], b[0]))
          .map(([, c]) => ({ ...c, sitesPerDay: c.agentDays ? round1(c.visits / c.agentDays) : null })),
      })),
    });
  }
  const units = [...unitRows.values()].map(({ sites, newSites, ...u }) => {
    const active = u.months.filter((r) => r.agentsNeeded > 0);
    return {
      ...u,
      sites: sites.size,                 // sites de l'unité avec une visite à faire (prévue ou nouvelle)
      newSites: newSites.size,           // dont avec une visite nouvelle
      visits: u.months.reduce((a, r) => a + r.visits, 0),
      newVisits: u.months.reduce((a, r) => a + r.newVisits, 0),
      agentDays: u.months.reduce((a, r) => a + r.agentDays, 0),
      agentsPeak: u.months.reduce((a, r) => Math.max(a, r.agentsNeeded), 0),
      agentsAvg: active.length ? round1(active.reduce((a, r) => a + r.agentsNeeded, 0) / active.length) : 0,
      vehiclesPeak: u.months.reduce((a, r) => Math.max(a, r.vehiclesPeak), 0),
      workingDaysSource: u.months.some((r) => r.workingDaysSource === 'parametre') ? 'parametre' : 'mmr',
    };
  }).sort((a, b) => Number(b.assigned) - Number(a.assigned) || (b.visits - a.visits) || cmp(String(a.name || a.officeName || ''), String(b.name || b.officeName || '')) || cmp(a.unitKey, b.unitKey));
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

module.exports = { U, visitCost, fieldDays, fieldDate, usableDays, agentNumber, communeDays, assignDays, scheduleUnit, planResources };
