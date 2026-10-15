/**
 * Planification automatique (lot 5, §§ 6–7) — règles métier : paramètres, aperçu, application.
 *
 * Aperçu : rien n'est écrit. Chargeur (SQL, plan.repository) → assemblage pur (planInputs) →
 * calcul pur selon la stratégie — « besoins » (défaut, planNeeds.scheduleNeeds : le plan suit
 * le MMR) ou « capacite » (planGenerator : le plan reste dans la capacité déclarée) — →
 * ressources nécessaires (planNeeds.resourceNeeds : agents, véhicules, jours de terrain) →
 * empreinte des entrées (planFingerprint) → mise en forme (planResult). Mesuré : 2 200 à 3 000 sites × 12 mois, calcul ≈ 75–90 ms (p95 ≤ 200 ms) +
 * assemblage ≈ 50 ms (banc `npm run perf:plan`) : sous le seuil de 300 ms fixé pour rester
 * dans la requête, donc pas de fil de calcul ni de file BullMQ (le calcul est pur et
 * clonable : il peut y partir tel quel si les volumes l'exigent un jour).
 *
 * Application (« Appliquer ») : UNE transaction — verrous des mois concernés pris D'ABORD
 * (même clé que « Générer depuis le RBM » et le Plan de suivi), rechargement des entrées et
 * nouvelle empreinte (409 plan_inputs_changed avec les sections qui ont changé), générateur
 * relancé (déterministe : mêmes entrées → mêmes propositions ; seules les propositions de ce
 * résultat sont acceptées), coches manuelles par le chemin commun (field.planMonthsTx), puis
 * visites générées par lots multi-lignes avec garde-fous re-vérifiés en base. Tout ou rien.
 */
const { performance } = require('node:perf_hooks');
const { withTenantTransaction } = require('../../config/db');
const repo = require('./plan.repository');
const fieldRepo = require('./field.repository');
const S = require('./planSettings');
const { assemble } = require('./planInputs');
const { generatePlan } = require('./planGenerator');
const { scheduleNeeds, resourceNeeds } = require('./planNeeds');
const { fingerprintInputs, changedSections } = require('./planFingerprint');
const { shapePreview, runSummary, runNeeds, poolSnapshot } = require('./planResult');
const { badRequest, conflict } = require('../../middleware/errors');

const pad = (m) => String(m).padStart(2, '0');
const monthOf = (now) => `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
const ms = (x) => Math.round(x * 10) / 10;

function describeSettings(row) {
  const settings = S.fromRow(row);
  return {
    settings, defaults: S.DEFAULTS, sources: S.SOURCES, readOnly: S.READ_ONLY, bounds: S.BOUNDS, fixed: S.FIXED, changed: S.changedKeys(settings),
    revision: row ? row.revision : 0, updatedAt: row ? row.updated_at : null, updatedBy: row ? row.updated_by_name || null : null,
  };
}

async function getSettings(tenantId) {
  return withTenantTransaction(tenantId, async (client) => describeSettings(await repo.getSettingsTx(client, tenantId)));
}

/** Remplace les paramètres du compte (verrou optimiste : `revision` lue → 409 si périmée). */
async function saveSettings(tenantId, userId, { revision, ...values }) {
  const settings = S.withOverrides(S.fromRow(null), values);
  const errors = S.validateSettings(settings);
  if (errors.length) throw badRequest('Paramètres de planification invalides.', { errors });
  return withTenantTransaction(tenantId, async (client) => {
    const current = await repo.lockSettingsTx(client, tenantId);
    if (current !== revision) {
      throw conflict('Les paramètres ont été modifiés par quelqu\'un d\'autre entre-temps : rechargez-les avant d\'enregistrer.', { code: 'revision', current });
    }
    await repo.saveSettingsTx(client, tenantId, userId, settings);
    return describeSettings(await repo.getSettingsTx(client, tenantId));
  });
}

/**
 * Charge, assemble et calcule (dans la transaction de l'appelant). Les choix du compte peuvent
 * être changés pour CET aperçu (`body.params`, jamais enregistrés) et les exceptions du mois
 * notées (`body.adjust` : communes inaccessibles) : revalidés ici, ils font partie de
 * l'empreinte (section « parametres »).
 */
async function computeTx(client, tenantId, body, now) {
  const t0 = performance.now();
  const saved = S.fromRow(await repo.getSettingsTx(client, tenantId));
  const settings = S.withOverrides(saved, body.params || {});
  const errors = S.validateSettings(settings);
  const { adjust, errors: adjustErrors } = S.normalizeAdjust(body.adjust || {});
  if (errors.length || adjustErrors.length) throw badRequest('Critères de planification invalides.', { errors: [...errors, ...adjustErrors] });
  const overridden = S.KEYS.filter((k) => JSON.stringify(settings[k]) !== JSON.stringify(saved[k]));
  const raw = await repo.loadPlanInputsTx(client, tenantId, { year: body.year });
  const t1 = performance.now();
  const scope = { officeId: body.officeId || null, activity: body.activity || null, district: body.district || null };
  const gp = S.generatorParams(settings);
  const a = assemble(raw, { year: body.year, todayMonth: monthOf(now), from: body.from, to: body.to, scope, settings: gp, adjust });
  const r = gp.strategy === 'capacite' ? generatePlan(a.input) : scheduleNeeds(a.input);
  const needs = resourceNeeds(r, a.poolInfo, { year: body.year, agentsPerVehicle: gp.agentsPerVehicle, fieldDaysPerMonth: gp.fieldDaysPerMonth });
  const fp = fingerprintInputs(a.input, { scope, adjust });
  const t2 = performance.now();
  return { raw, a, r, fp, needs, settings, overridden, scope, adjust, timings: { loadMs: ms(t1 - t0), computeMs: ms(t2 - t1) } };
}

/** Aperçu : propositions, projection, raisons de report. Rien n'est écrit. */
async function preview(tenantId, body, { now = new Date() } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const { a, r, fp, needs, settings, overridden, scope, adjust, timings } = await computeTx(client, tenantId, body, now);
    return shapePreview(a, r, fp, { settings, overridden, scope, adjust, needs, timings });
  });
}

const keyOf = (siteId, month) => `${siteId}|${month}`;

/**
 * Applique l'aperçu (propositions gardées après les décochages) et les coches manuelles, tout
 * ou rien. @returns {{ runId, created, skipped, manual }}
 */
async function apply(tenantId, userId, body, { now = new Date() } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const months = [...body.keep, ...body.changes].map((k) => `${body.year}-${pad(k.month)}`);
    await repo.lockMonthsTx(client, tenantId, months);
    const { a, r, fp, needs, adjust } = await computeTx(client, tenantId, body, now);
    if (fp.fingerprint !== body.fingerprint) {
      throw conflict('Les données ont changé depuis l\'aperçu (visites, registre, MMR, paramètres ou mois courant) : relancez l\'aperçu.',
        { code: 'plan_inputs_changed', sections: changedSections(body.sections || {}, fp.sections) });
    }
    const proposed = new Map(r.proposals.map((p) => [keyOf(p.siteId, p.month), p]));
    const manualKeys = new Set(body.changes.map((c) => keyOf(c.siteId, c.month)));
    const kept = []; const seen = new Set();
    for (const k of body.keep) {
      const key = keyOf(k.siteId, k.month);
      if (seen.has(key) || manualKeys.has(key)) continue; // une coche manuelle sur la même case l'emporte
      seen.add(key);
      const p = proposed.get(key);
      if (!p) throw badRequest('Visite proposée inconnue de l\'aperçu : relancez l\'aperçu.', { code: 'proposition_inconnue', siteId: k.siteId, month: k.month });
      kept.push(p);
    }
    const manual = body.changes.length
      ? await fieldRepo.planMonthsTx(client, tenantId, userId, body.year, body.changes)
      : { added: 0, removed: 0, skippedInactive: 0 };
    if (!kept.length) return { runId: null, created: 0, skipped: 0, manual };
    const preview = shapePreview(a, r, fp, { adjust, needs });
    const runId = await repo.insertRunTx(client, tenantId, userId, {
      year: body.year, fromMonth: a.input.fromMonth, toMonth: a.input.toMonth, strategy: a.input.params.strategy,
      scope: { officeId: body.officeId || null, activity: body.activity || null, district: body.district || null },
      params: { ...a.input.params, excludedCommunes: adjust.excludedCommunes }, pools: poolSnapshot(a.poolInfo), summary: runSummary(preview), needs: runNeeds(needs), fingerprint: fp.fingerprint,
      proposed: r.proposals.length, kept: kept.length, manualChanges: body.changes.length,
    });
    // Jour de terrain, rôle générique et date : la répartition des journées entre les agents nécessaires.
    const created = await repo.insertGeneratedTx(client, tenantId, userId, {
      year: body.year, runId,
      visits: kept.map((p) => {
        const sl = needs.slots[keyOf(p.siteId, p.month)] || null;
        return { siteId: p.siteId, month: p.month, why: p.why, tour: p.tour, day: sl ? sl.fieldDay : p.day,
          agent: sl ? `Agent ${sl.agent}` : null, date: sl ? sl.date : null,
          detail: { reason: p.reason, level: p.level, anchor: p.anchor || null, since: p.detail.since, last: p.detail.last, gate: p.detail.gate,
            risk: p.detail.risk, required: p.detail.required ?? null, visitNo: p.detail.visitNo ?? null } };
      }),
    });
    await repo.setRunCreatedTx(client, tenantId, runId, created);
    return { runId, created, skipped: kept.length - created, manual };
  });
}

module.exports = { getSettings, saveSettings, preview, apply, describeSettings };
