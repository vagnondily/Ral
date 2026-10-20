/**
 * Planification automatique sur une période (retour n° 82) — règles et transactions.
 * Couches : planAuto.routes (zod) → ce service → planAuto.repository (SQL) ; le calcul est pur
 * (planAuto.generatePlan) et l'empreinte des entrées aussi (planFingerprint).
 *
 * Aperçu : une transaction de lecture — entrées du Plan de suivi, calcul, empreinte. Ne renvoie
 * que les totaux et un ÉCHANTILLON d'affectations (jamais tout le plan).
 * Appliquer : le calcul (lourd) se fait HORS verrous — relecture, calcul, empreinte comparée à celle
 * de l'aperçu (409 plan_inputs_changed, sections nommées) ; puis UNE transaction d'écriture :
 * verrou de la planification automatique → verrous des mois de l'exercice ET des exercices voisins
 * (visitLocks, croissants : mêmes clés que « Générer depuis le RBM », les coches et la modification
 * groupée du Plan de suivi), sous UNE échéance de 20 s pour toute la phase (puis 503) → relecture
 * des entrées sur le MÊME client et empreinte recalculée : identique, le plan calculé (fonction pure
 * des entrées) est exactement celui qu'on écrirait — sinon 409 → sites verrouillés en partage de clé
 * (un site supprimé entre-temps : 409 « registre ») → écriture → TPM de zone (restampVisitsTx,
 * verrou d'attribution pris EN DERNIER). Effacer suit le même ordre de verrous.
 * Le tenant vient toujours de req.auth (routes), jamais du corps.
 */
const { withTenantTransaction } = require('../../config/db');
const { badRequest, conflict } = require('../../middleware/errors');
const { currentMonth } = require('./rbmMath');
const { lockVisitMonthsTx, LOCK_WAIT_MS } = require('./visitLocks');
const { generatePlan, firstPlannableMonth, normalizeSettings } = require('./planAuto');
const { fingerprintInputs, changedSections } = require('./planFingerprint');
const repo = require('./planAuto.repository');

const SAMPLE_SIZE = 200;        // affectations renvoyées par l'aperçu (échantillon)
const UNCOVERED_SAMPLE = 50;    // sites non couverts renvoyés avec leur raison
const ym = (year, m) => `${year}-${String(m).padStart(2, '0')}`;

/**
 * Horloge du calcul : mois courant (premier mois planifiable) et jour courant (le mois en cours ne
 * compte que ses jours de terrain restants ; jamais une date de visite passée). Un mois donné sans
 * jour (tests, reprises) part du 1ᵉʳ de ce mois. Les deux entrent dans l'empreinte.
 */
function clockOf({ now, today } = {}) {
  const d = new Date().toISOString().slice(0, 10);   // même horloge (UTC) que rbmMath.currentMonth
  const month = now || currentMonth();
  const day = today && String(today).slice(0, 7) === month ? String(today).slice(0, 10) : (month === d.slice(0, 7) ? d : `${month}-01`);
  return { now: month, today: day };
}

/** Mois (1..12) d'une période { from, to } d'un même exercice. */
function periodMonths({ from, to }) {
  const year = Number(from.slice(0, 4));
  const months = [];
  for (let m = Number(from.slice(5, 7)); m <= Number(to.slice(5, 7)); m += 1) months.push(m);
  return { year, months };
}

/** Période effective : jamais un mois échu (le plan commence au mois courant). 400 si tout est échu. */
function effectivePeriod(body, now) {
  const { year, months } = periodMonths(body);
  const first = firstPlannableMonth(year, now);
  const open = months.filter((m) => m >= first);
  if (!open.length) {
    throw badRequest(`La période choisie est entièrement échue : choisissez des mois à partir de ${now}.`, { code: 'period_past', from: now });
  }
  return { year, months, open, past: months.filter((m) => m < first) };
}

/** Périmètre normalisé (bureau, activité, district, risque) : il fait partie de l'empreinte. */
function scopeOf(body) {
  const sc = body.scope || {};
  return {
    fieldOfficeId: sc.fieldOfficeId || null,
    activity: sc.activity ? String(sc.activity).trim() : null,
    district: sc.district ? String(sc.district).trim() : null,
    risk: body.risk || sc.risk || null,
  };
}

/**
 * Entrées + empreinte (sans calcul), sur le client de l'appelant. L'empreinte couvre TOUT ce que
 * lit le moteur (entrées, période, mois courant, réglages normalisés, périmètre, option d'écriture) :
 * deux empreintes égales donnent le même plan.
 */
async function readTx(client, tenantId, body, clock) {
  const { now, today } = clock;
  const { year, months, open } = effectivePeriod(body, now);
  const settings = normalizeSettings(body.settings || {});
  const scope = scopeOf(body);
  // « Limiter à la capacité déclarée » : exigences et intervalle AJUSTÉS du MMR (CO adjusted).
  const inputs = await repo.loadInputsTx(client, tenantId, { year, adjusted: settings.adjusted, scope });
  const writeSchedule = Boolean(body.settings && body.settings.writeSchedule);
  const fp = fingerprintInputs(inputs, {
    year, requested: months, months: open, fromMonth: now, today, settings, scope, writeSchedule,
  });
  return { inputs, fp, year, months, settings, writeSchedule };
}

/** Entrées + plan + empreinte, sur le client de l'appelant. */
async function computeTx(client, tenantId, body, clock) {
  const read = await readTx(client, tenantId, body, clock);
  const { inputs, settings, months, year } = read;
  const plan = generatePlan(inputs.sites, inputs.mmrByKey, settings, months, year,
    { yearHasGrid: inputs.yearHasGrid, fromMonth: clock.now, today: clock.today });
  return { ...read, plan };
}

/** 409 « relancez l'aperçu », avec les sections d'entrées qui ont changé. */
function inputsChanged(body, fp, sections = null) {
  const changed = sections || changedSections(body.sections || {}, fp.sections);
  return conflict('Les données ont changé depuis l\'aperçu : relancez l\'aperçu avant d\'appliquer.',
    { code: 'plan_inputs_changed', sections: changed.length ? changed : ['parametres'] });
}

function labelsOf(inputs) {
  return new Map(inputs.sites.map((s) => [s.id, { name: s.name, district: s.district, commune: s.commune }]));
}

/** Réponse de l'aperçu : totaux, répartitions et échantillons (jamais tout le plan). */
function previewView({ inputs, plan, fp, year, writeSchedule }) {
  const label = labelsOf(inputs);
  const { assignments, uncovered, slots, ...rest } = plan;
  return {
    ...rest,
    writeSchedule,
    period: {
      from: plan.months.length ? ym(year, plan.months[0]) : null,
      to: plan.months.length ? ym(year, plan.months[plan.months.length - 1]) : null,
      pastMonths: plan.pastMonths,               // mois demandés mais échus : jamais planifiés
    },
    // Échantillon : chaque visite avec son créneau (agent générique, jour de terrain, date).
    sample: assignments.slice(0, SAMPLE_SIZE).map((a) => {
      const slot = slots[`${a.siteId}|${a.month}`] || null;
      return { ...a, ...(label.get(a.siteId) || {}), agent: slot ? `Agent ${slot.agent}` : null, date: slot ? slot.date : null, tour: slot ? slot.tour : null };
    }),
    sampleTotal: assignments.length,
    uncovered: uncovered.slice(0, UNCOVERED_SAMPLE).map((u) => ({ ...u, ...(label.get(u.siteId) || {}) })),
    uncoveredTotal: uncovered.length,
    fingerprint: fp.fingerprint,
    sections: fp.sections,
  };
}

async function preview(tenantId, body, opts = {}) {
  const clock = clockOf(opts);
  return withTenantTransaction(tenantId, async (client) => previewView(await computeTx(client, tenantId, body, clock)));
}

/**
 * Écrit le plan prévisualisé ; 409 plan_inputs_changed si les entrées ont changé depuis l'aperçu
 * (sections nommées). Renvoie les visites créées, celles prévues par le calcul et, pour l'écart, la
 * raison relue en base.
 */
async function apply(tenantId, userId, body, opts = {}) {
  const clock = clockOf(opts);
  const { year } = effectivePeriod(body, clock.now);
  // 1. Calcul HORS verrous (lecture seule) : les écrivains du Plan de suivi ne l'attendent pas.
  const computed = await withTenantTransaction(tenantId, (client) => computeTx(client, tenantId, body, clock));
  const { plan } = computed;
  if (computed.fp.fingerprint !== body.fingerprint) throw inputsChanged(body, computed.fp);
  // 2. Écriture sous les verrous, entrées relues et empreinte recomparée sur le même client.
  return withTenantTransaction(tenantId, async (client) => {
    const deadline = Date.now() + LOCK_WAIT_MS;   // une échéance pour TOUTE la phase des verrous
    await repo.lockPlanAutoTx(client, tenantId, { deadline });
    // Mois de l'exercice et des exercices voisins : l'intervalle se lit d'une année sur l'autre,
    // aucune autre écriture de plan ne doit le changer entre la lecture et l'écriture.
    await lockVisitMonthsTx(client, tenantId, repo.windowMonths(year), { deadline });
    await client.query("SET LOCAL lock_timeout = '20s'");
    const { fp } = await readTx(client, tenantId, body, clock);
    if (fp.fingerprint !== body.fingerprint) throw inputsChanged(body, fp);
    // Un site supprimé du registre depuis la relecture : 409 « registre », jamais une erreur de clé.
    const present = await repo.lockPlanSitesTx(client, tenantId, plan.assignments.map((a) => a.siteId));
    if (plan.assignments.some((a) => !present.has(a.siteId))) throw inputsChanged(body, fp, ['registre']);
    // Option « Écrire les dates et les agents » : chaque visite reçoit le jour de terrain de son
    // créneau et un rôle générique (« Agent N ») ; sinon le mois seul (dates et agents à saisir).
    const toWrite = computed.writeSchedule
      ? plan.assignments.map((a) => {
        const slot = plan.slots[`${a.siteId}|${a.month}`];
        return slot ? { ...a, date: slot.date, agent: `Agent ${slot.agent}` } : a;
      })
      : plan.assignments;
    let res;
    try {
      res = await repo.insertVisitsTx(client, tenantId, userId, toWrite);
    } catch (err) {
      if (err && err.code === '23503') throw inputsChanged(body, fp, ['registre']); // filet : clé étrangère
      throw err;
    }
    return {
      created: res.created,
      planned: plan.assignments.length,
      skipped: res.skipped,
      writeSchedule: computed.writeSchedule,
      summary: plan.summary,
      perMonth: plan.perMonth,
      pastMonths: plan.pastMonths,
    };
  });
}

/** Efface les visites prévues libres de la période (même ordre de verrous qu'« Appliquer »). */
async function clearPlanned(tenantId, { year, from, to, risk, scope = {} } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const deadline = Date.now() + LOCK_WAIT_MS;
    await repo.lockPlanAutoTx(client, tenantId, { deadline });
    const months = [];
    for (let m = Number(from); m <= Number(to); m += 1) months.push(ym(year, m));
    await lockVisitMonthsTx(client, tenantId, months, { deadline });
    await client.query("SET LOCAL lock_timeout = '20s'");
    return repo.clearPlannedTx(client, tenantId, { year, from, to, risk, scope });
  });
}

module.exports = { preview, apply, clearPlanned, effectivePeriod, periodMonths, scopeOf, clockOf, SAMPLE_SIZE, UNCOVERED_SAMPLE };
