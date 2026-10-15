/**
 * Jeu synthétique DÉTERMINISTE (graine fixe) pour le générateur de plan (lot 5) : lignes
 * « comme le chargeur » (plan.repository.loadPlanInputsTx), assemblées ensuite par
 * planInputs.assemble — toute la chaîne pure est donc mesurée et testée.
 *
 * Structure proche du registre d'activation réel (≈ 30 districts, 10 communes par district,
 * lieux portant une ou deux activités), 7 activités, 4 bureaux racines + 4 antennes, plan
 * général + dérogations, risques surtout « élevé », quelques recommandations urgentes et zones
 * interdites, grille d'activation partielle, visites existantes (réalisées, prévues, annulées).
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACTIVITIES = [
  ['School meal activities', 0.6, { operationDuration: 10, riskLevel: 2, feasible: 52, visitsPerDay: 3 }],
  ['Nutrition treatment activities', 0.2, { operationDuration: 12, riskLevel: 2, feasible: 27, visitsPerDay: 2 }],
  ['Malnutrition prevention activities', 0.06, { operationDuration: 6, riskLevel: 1, feasible: 4, visitsPerDay: 3 }],
  ['Unconditional resource transfers to support access to food', 0.05, { operationDuration: 6, riskLevel: 2, feasible: 4, visitsPerDay: 1 }],
  ['Climate adaptation and risk management activities', 0.04, { operationDuration: 0, riskLevel: 1, feasible: 12, visitsPerDay: 3 }],
  ['Smallholder agricultural market support activities', 0.03, { operationDuration: 3, riskLevel: 1, feasible: 2, visitsPerDay: null }],
  ['Asset creation and livelihood support activities', 0.02, { operationDuration: 3, riskLevel: 1, feasible: 1, visitsPerDay: 1.5 }],
];

const uuid = (prefix, n) => `${prefix}${String(n).padStart(12, '0')}`.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');

/**
 * @param {{ n?: number, seed?: number, year?: number, districts?: number, gridShare?: number }} opts
 * @returns raw (lignes du chargeur)
 */
function synthRaw({ n = 2200, seed = 42, year = 2027, districts = 30, gridShare = 0.5, persons = false } = {}) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const offices = [];
  for (let i = 0; i < 4; i += 1) offices.push({ id: uuid('aaaaaaaa', i + 1), parentId: null, name: `Bureau ${i + 1}`, code: `B${i + 1}` });
  for (let i = 0; i < 4; i += 1) offices.push({ id: uuid('aaaaaaab', i + 1), parentId: offices[i].id, name: `Antenne ${i + 1}`, code: `A${i + 1}` });
  const mmr = [];
  ACTIVITIES.forEach(([cat, , p], i) => {
    mmr.push({ id: uuid('bbbbbbbb', i + 1), fieldOfficeId: null, activityCategory: cat, numberOfSites: Math.round(n * 0.2), personsToDeploy: persons ? 3 : null, workingDays: persons ? 18 : null, ...p });
    // Dérogation du bureau 1 (capacité propre)
    mmr.push({ id: uuid('bbbbbbbc', i + 1), fieldOfficeId: offices[0].id, activityCategory: cat, numberOfSites: Math.round(n * 0.05), personsToDeploy: null, workingDays: null, ...p, feasible: Math.max(1, Math.round(p.feasible / 2)) });
  });
  const sites = []; const grid = []; const visits = []; const lastBefore = []; const data = [];
  const gridKnown = rnd() < gridShare || gridShare >= 1;
  let k = 0; let place = 0;
  while (sites.length < n) {
    const d = Math.floor(rnd() * districts);
    const c = Math.floor(rnd() * 10);
    place += 1;
    const multi = rnd() < 0.3 ? 2 : 1;
    const used = new Set();
    for (let j = 0; j < multi && sites.length < n; j += 1) {
      let act; let r = rnd(); let acc = 0;
      for (const a of ACTIVITIES) { acc += a[1]; if (r <= acc) { act = a[0]; break; } }
      act = act || ACTIVITIES[0][0];
      if (used.has(act)) continue;
      used.add(act);
      k += 1;
      const id = uuid('cccccccc', k);
      const office = offices[(d % 4) + (rnd() < 0.4 ? 4 : 0)];
      r = rnd();
      const risk = r < 0.8 ? 'elevee' : r < 0.9 ? 'moyenne' : 'faible';
      const security = rnd() < 0.005 ? 99 : rnd() < 0.01 ? 3 : rnd() < 0.1 ? 1 : 0;
      sites.push({
        id, code: `S-${String(k).padStart(5, '0')}`, name: `Lieu ${place}`, locationId: null, activity: act, fieldOfficeId: office.id,
        adm1: `Region ${Math.floor(d / 8)}`, adm2: `District ${d}`, district: `District ${d}`, adm3: `Commune ${d}-${c}`, commune: `Commune ${d}-${c}`,
        pcodeName: null, pcodeRegion: null, riskLevel: risk, security,
        synergies: rnd() < 0.3 ? 1 : 0, beneficiaryOver200: rnd() < 0.4 ? 1 : 0, beneficiaryNumber: null, newPartner: rnd() < 0.2 ? 1 : 0,
        experiencedPartner: pick([0, 0, 0, 1, 2]), issuesProcess: rnd() < 0.01 ? 2 : 0, issuesPartnerReport: 0, issuesCFM: rnd() < 0.005 ? 2 : 0,
        fraud: rnd() < 0.003 ? 1 : 0, lastVisitDate: null,
      });
      if (gridKnown) for (let m = 1; m <= 12; m += 1) if (rnd() < 0.9) grid.push({ siteId: id, month: m, active: rnd() < 0.92 });
      for (let m = 1; m <= 12; m += 1) {
        const x = rnd();
        if (x < 0.02) visits.push({ siteId: id, month: m, status: 'realise' });
        else if (x < 0.035) visits.push({ siteId: id, month: m, status: 'planifie' });
        else if (x < 0.04) visits.push({ siteId: id, month: m, status: 'annule' });
      }
      if (rnd() < 0.3) lastBefore.push({ siteId: id, month: `${year - 1 - Math.floor(rnd() * 2)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}` });
      if (rnd() < 0.02) data.push({ siteId: id, before: null, months: [`${year}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}`] });
    }
  }
  return { offices, sites, grid, gridKnown, visits, lastBefore, data, mmr };
}

module.exports = { synthRaw, mulberry32, ACTIVITIES };
