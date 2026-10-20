/**
 * Planification automatique sur une période (retour n° 82) — règles et transactions.
 * Couches : planAuto.routes (zod) → ce service → planAuto.repository (SQL) ; le calcul est pur
 * (planAuto.generatePlan) et l'empreinte des entrées aussi (planFingerprint).
 *
 * Aperçu : une transaction de lecture — entrées du Plan de suivi, calcul, empreinte. Ne renvoie
 * que les totaux et un ÉCHANTILLON d'affectations (jamais tout le plan).
 * Appliquer : UNE transaction — lock_timeout 20 s → verrou de la planification automatique →
 * verrous des 12 mois de l'exercice (visitLocks, croissants : mêmes clés que « Générer depuis le
 * RBM » et les coches du Plan de suivi) → relecture des entrées sur le MÊME client → calcul →
 * contrôle de l'empreinte (409 plan_inputs_changed, sections nommées) → écriture → TPM de zone
 * (restampVisitsTx, verrou d'attribution pris EN DERNIER). Effacer suit le même ordre de verrous.
 * Le tenant vient toujours de req.auth (routes), jamais du corps.
 */
const { withTenantTransaction } = require('../../config/db');
const { badRequest, conflict } = require('../../middleware/errors');
const { currentMonth } = require('./rbmMath');
const { lockVisitMonthsTx } = require('./visitLocks');
const { generatePlan, firstPlannableMonth, normalizeSettings } = require('./planAuto');
const { fingerprintInputs, changedSections } = require('./planFingerprint');
const repo = require('./planAuto.repository');

const SAMPLE_SIZE = 200;        // affectations renvoyées par l'aperçu (échantillon)
const UNCOVERED_SAMPLE = 50;    // sites non couverts renvoyés avec leur raison
const ym = (year, m) => `${year}-${String(m).padStart(2, '0')}`;

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

/** Entrées + plan + empreinte, sur le client de l'appelant. */
async function computeTx(client, tenantId, body, now) {
  const { year, months } = effectivePeriod(body, now);
  const settings = normalizeSettings(body.settings || {});
  const scope = scopeOf(body);
  // « Limiter à la capacité déclarée » : exigences et intervalle AJUSTÉS du MMR (CO adjusted).
  const inputs = await repo.loadInputsTx(client, tenantId, { year, adjusted: settings.adjusted, scope });
  const plan = generatePlan(inputs.sites, inputs.mmrByKey, settings, months, year,
    { yearHasGrid: inputs.yearHasGrid, fromMonth: now });
  const writeSchedule = Boolean(body.settings && body.settings.writeSchedule);
  const fp = fingerprintInputs(inputs, {
    year, requested: months, months: plan.months, fromMonth: now, settings: plan.settings, scope, writeSchedule,
  });
  return { inputs, plan, fp, year, writeSchedule };
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

async function preview(tenantId, body, { now = currentMonth() } = {}) {
  return withTenantTransaction(tenantId, async (client) => previewView(await computeTx(client, tenantId, body, now)));
}

/**
 * Écrit le plan prévisualisé, en UNE transaction sous les verrous ; 409 plan_inputs_changed si
 * les entrées ont changé depuis l'aperçu (sections nommées). Renvoie les visites créées, celles
 * prévues par le calcul et, pour l'écart, la raison relue en base.
 */
async function apply(tenantId, userId, body, { now = currentMonth() } = {}) {
  const { year } = effectivePeriod(body, now);
  return withTenantTransaction(tenantId, async (client) => {
    await client.query("SET LOCAL lock_timeout = '20s'");
    await repo.lockPlanAutoTx(client, tenantId);
    // Les 12 mois de l'exercice : l'intervalle se lit sur toute l'année, aucune autre écriture de
    // plan ne doit la changer entre la lecture et l'écriture.
    await lockVisitMonthsTx(client, tenantId, Array.from({ length: 12 }, (_, i) => ym(year, i + 1)));
    const computed = await computeTx(client, tenantId, body, now);
    const { plan, fp } = computed;
    if (fp.fingerprint !== body.fingerprint) {
      const sections = changedSections(body.sections || {}, fp.sections);
      throw conflict('Les données ont changé depuis l\'aperçu : relancez l\'aperçu avant d\'appliquer.',
        { code: 'plan_inputs_changed', sections: sections.length ? sections : ['parametres'] });
    }
    // Option « Écrire les dates et les agents » : chaque visite reçoit le jour de terrain de son
    // créneau et un rôle générique (« Agent N ») ; sinon le mois seul (dates et agents à saisir).
    const toWrite = computed.writeSchedule
      ? plan.assignments.map((a) => {
        const slot = plan.slots[`${a.siteId}|${a.month}`];
        return slot ? { ...a, date: slot.date, agent: `Agent ${slot.agent}` } : a;
      })
      : plan.assignments;
    const res = await repo.insertVisitsTx(client, tenantId, userId, toWrite);
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
async function clearPlanned(tenantId, { year, from, to, risk } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query("SET LOCAL lock_timeout = '20s'");
    await repo.lockPlanAutoTx(client, tenantId);
    const months = [];
    for (let m = Number(from); m <= Number(to); m += 1) months.push(ym(year, m));
    await lockVisitMonthsTx(client, tenantId, months);
    return repo.clearPlannedTx(client, tenantId, { year, from, to, risk });
  });
}

module.exports = { preview, apply, clearPlanned, effectivePeriod, periodMonths, SAMPLE_SIZE, UNCOVERED_SAMPLE };
