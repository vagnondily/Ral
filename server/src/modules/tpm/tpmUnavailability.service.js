const crypto = require('node:crypto');
const { withTenantTransaction } = require('../../config/db');
const { badRequest, conflict } = require('../../middleware/errors');
const { checkReason, REASON_MESSAGES } = require('../common/reasonText');
const { monthsOf } = require('../common/period');
const { currentMonth } = require('./rbmMath');
const { lockVisitMonthsTx } = require('./visitLocks');
const rule = require('./tpmAttribution');
const off = require('./tpmUnavailability');
const repo = require('./tpmAttribution.repository');

/**
 * Indisponibilités des TPM (retour 114) — onglet « Affectation des TPM ». Décisions prises par les
 * règles pures (tpmUnavailability.js, tpmAttribution.js) ; le dépôt (tpmAttribution.repository) lit
 * et écrit. Une écriture tient, dans l'ordre (aucun interblocage avec les écrivains du plan) : les
 * verrous des mois (visitLocks), puis le verrou d'attribution du compte, puis lit, contrôle
 * l'empreinte de l'aperçu, écrit (une instruction), ré-estampille les visites prévues des mois et
 * inscrit le journal — une seule transaction. Le tenant vient de req.auth (contrôleur).
 */

const STALE = 'Les indisponibilités de ce TPM ont changé entre-temps (autre utilisateur) : rechargez l\'aperçu.';

/** Raison nettoyée (common/reasonText) ou 400 avec details.code. */
function reasonOf(raw, { required }) {
  const r = checkReason(raw, { required });
  if (!r.ok) throw badRequest(r.message, { code: r.code });
  return r.reason;
}

/** Partenaires actifs de type TPM (choix du dialogue), ordre du nom. */
const tpmsOf = (partners) => partners.filter((p) => p.typeCode === 'tpm' && p.active !== false)
  .map((p) => ({ id: p.id, name: p.name })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));

/**
 * Périodes d'indisponibilité qui chevauchent la période (onglet), ENTIÈRES (lues sur la fenêtre
 * listWindow, U6 : une période coupée au bord ferait agir « Mettre fin » sur une partie seulement),
 * et les TPM qu'on peut déclarer.
 */
async function list(tenantId, { period }) {
  return withTenantTransaction(tenantId, async (client) => {
    const rows = await repo.unavailabilityTx(client, tenantId, off.listWindow(period, rule.MAX_SPAN_MONTHS));
    const partners = await repo.partnersTx(client, tenantId);
    return { period: { from: period.from, to: period.to }, periods: off.periodsOverlapping(rows, period), tpms: tpmsOf(partners) };
  });
}

/**
 * Prépare une décision (aperçu et enregistrement, MÊMES étapes) : TPM contrôlé (partenaire de type
 * TPM du compte, actif pour une déclaration), indisponibilités existantes, empreinte, plan, tables de
 * zones avant / après (simulation), visites prévues ré-estampillables dont le TPM changerait.
 */
async function prepareTx(client, tenantId, { providerId, from, to, mode, reason }) {
  const period = { from, to };
  const months = monthsOf(period, { max: rule.MAX_SPAN_MONTHS });
  const inputs = await repo.loadInputsTx(client, tenantId, period);
  const provider = inputs.partners.find((p) => p.id === providerId);
  // Déclarer : un TPM du compte. Mettre fin : tout partenaire du compte (un TPM devenu partenaire de mise
  // en œuvre garde des mois indisponibles, sans effet, qu'on doit pouvoir retirer).
  if (!provider || (mode === 'poser' && provider.typeCode !== 'tpm')) throw badRequest('Choisissez un TPM (partenaire de type TPM) de ce compte.', { code: 'not_tpm' });
  if (mode === 'poser' && provider.active === false) throw badRequest('Ce TPM est désactivé : il n\'est le TPM d\'aucune zone.', { code: 'tpm_inactive' });
  const existing = inputs.unavailability.filter((u) => u.providerId === providerId);
  const stamp = off.stampOf(providerId, months, existing);
  const plan = off.planUnavailability({ mode, months, existing, reason });

  // Visites prévues de la plage et zones à comparer (districts et communes des visites, communes portées).
  const visits = await repo.plannedRangeVisitsTx(client, tenantId, period);
  const ids = new Set(repo.communeRowIds(inputs));
  for (const v of visits) { if (v.districtId) ids.add(v.districtId); if (v.communeId) ids.add(v.communeId); }
  const zoneRows = await repo.zoneRowsTx(client, tenantId, { inputs });
  for (const a of zoneRows.areas) ids.add(a.id);
  const areas = await repo.areasTx(client, tenantId, [...ids]);
  const today = currentMonth();
  const before = rule.buildZoneTable({ areas, months, ...inputs, today });
  const after = rule.buildZoneTable({ areas, months, ...inputs, unavailability: off.simulate(inputs.unavailability, plan, { providerId, reason }), today });
  const summary = rule.summarizeRestamp(rule.restampPlan(visits, after));
  const nameOf = (id) => (id ? ((inputs.partners.find((p) => p.id === id) || {}).name || null) : null);
  summary.moves = summary.moves.map((m) => ({ ...m, fromName: nameOf(m.fromProviderId), toName: nameOf(m.toProviderId) }));
  const zones = off.zoneMoves(before, after, providerId, new Map(areas.map((a) => [a.id, a])));
  const warnings = [];
  const plans = await repo.monthPlanStatusesTx(client, tenantId, months);
  const validated = plans.filter((p) => p.status === 'valide').map((p) => p.month);
  if (validated.length) warnings.push({ code: 'plan_valide', months: validated });
  return { period, months, provider: { id: provider.id, name: provider.name }, stamp, plan, visits: summary, zones, warnings };
}

const previewView = (p) => ({
  stamp: p.stamp, months: p.months, provider: p.provider, counts: p.plan.counts, visits: p.visits, zones: p.zones, warnings: p.warnings,
});

/** Aperçu d'une décision, sans verrou ni écriture. */
async function preview(tenantId, { providerId, from, to, mode, reason = null }) {
  const clean = mode === 'retirer' ? null : (checkReason(reason, { required: false }).reason || null);
  return withTenantTransaction(tenantId, async (client) => previewView(await prepareTx(client, tenantId, { providerId, from, to, mode, reason: clean })));
}

/**
 * Lignes du journal : un lot + une ligne par TPM × mois qui change. Le libellé du lot = le NOM du TPM
 * seul : la période est dans month_from / month_to, que l'écran écrit dans la langue de l'utilisateur
 * (rangeLabel) — jamais une période figée en français dans le libellé.
 */
function logRows({ batchId, prep, action, reason, visitsUpdated }) {
  const name = prep.provider.name || '—';
  return [
    { batch_id: batchId, scope: 'lot', action, label: name.slice(0, 300),
      month_from: prep.period.from, month_to: prep.period.to, visits_updated: visitsUpdated, reason },
    ...prep.plan.log.map((l) => ({
      batch_id: batchId, scope: 'tpm', action: l.action, label: name.slice(0, 300), period_month: l.month,
      old_state: l.oldState, old_provider_id: prep.provider.id, new_state: l.newState, new_provider_id: prep.provider.id,
      old_reason: l.oldReason, reason: l.action === 'indispo_retirer' ? reason : l.newReason,
    })),
  ];
}

/** Écriture commune (déclarer / mettre fin) : verrous, contrôles, plan, écritures, estampille, journal. */
async function write(tenantId, actor, { providerId, from, to, mode, reason, stamp }) {
  return withTenantTransaction(tenantId, async (client) => {
    await lockVisitMonthsTx(client, tenantId, monthsOf({ from, to }, { max: rule.MAX_SPAN_MONTHS }));
    await repo.lockAttributionTx(client, tenantId);
    const prep = await prepareTx(client, tenantId, { providerId, from, to, mode, reason });
    if (prep.stamp !== stamp) throw conflict(STALE, { code: 'stale' });
    const { plan } = prep;
    if (!plan.action) return { unchanged: true, counts: plan.counts, visits: { changed: 0, byState: {}, moves: [] } };
    const batchId = crypto.randomUUID();
    await repo.deleteUnavailabilityTx(client, tenantId, plan.deletes);
    await repo.upsertUnavailabilityTx(client, tenantId, { actorId: actor.userId, providerId, batchId, reason, months: plan.upserts });
    const visits = await repo.restampVisitsTx(client, tenantId, { from, to });
    await repo.insertLogTx(client, tenantId, actor.userId, logRows({ batchId, prep, action: plan.action, reason, visitsUpdated: visits.changed }));
    return { batchId, counts: plan.counts, visits };
  });
}

/** Déclarer un TPM indisponible sur des mois (motif obligatoire, 10 à 500 caractères). */
async function setUnavailable(tenantId, actor, { providerId, from, to, reason, stamp }) {
  const clean = reasonOf(reason, { required: true });
  if (!clean) throw badRequest(REASON_MESSAGES.reason_required, { code: 'reason_required' });
  return write(tenantId, actor, { providerId, from, to, mode: 'poser', reason: clean, stamp });
}

/** Mettre fin à l'indisponibilité d'un TPM sur des mois (raison facultative). */
async function endUnavailable(tenantId, actor, { providerId, from, to, reason, stamp }) {
  const clean = reasonOf(reason, { required: false });
  return write(tenantId, actor, { providerId, from, to, mode: 'retirer', reason: clean, stamp });
}

module.exports = { list, preview, setUnavailable, endUnavailable, prepareTx, logRows };
