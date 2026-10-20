const crypto = require('node:crypto');
const { withTenantTransaction } = require('../../config/db');
const { badRequest, conflict, notFound } = require('../../middleware/errors');
const { checkReason, REASON_MESSAGES } = require('../common/reasonText');
const { monthsOf, periodLabel } = require('../common/period');
const { currentMonth } = require('./rbmMath');
const rule = require('./tpmAttribution');
const repo = require('./tpmAttribution.repository');

/**
 * Affectation des TPM par zone (retour 58) — règles et transactions. Les décisions sont prises
 * par la règle pure (tpmAttribution.js) ; le dépôt lit et écrit. Toute écriture tient le verrou
 * d'attribution du compte AVANT toute lecture (lockAttributionTx) : chaque instruction suivante
 * voit ce qui a été validé avant, et deux décisions sur les mêmes zones se suivent.
 * Le tenant vient toujours de req.auth (contrôleur), jamais du corps.
 */

/** Raison nettoyée (common/reasonText) ou 400 avec details.code. */
function reasonOf(raw, { required }) {
  const r = checkReason(raw, { required });
  if (!r.ok) throw badRequest(r.message, { code: r.code });
  return r.reason;
}

const providerName = (inputs, id) => (id ? ((inputs.partners.find((p) => p.id === id) || {}).name || null) : null);

/** Résumé d'une cellule pour l'écran (sans la valeur par défaut complète). */
function cellView(c) {
  if (!c) return null;
  const o = c.override;
  return {
    state: c.state, providerId: c.providerId || null, providerName: c.providerName || null,
    monitoredBy: c.monitoredBy || (c.providerId ? 'tpm' : 'interne'),
    contractId: c.contractId || null, numero: c.numero || null, contractLabel: c.contractLabel || null, flags: c.flags || [],
    detached: c.detached || undefined,
    // Suivi interne expliqué (retour 114) : contrats sans TPM (D1), TPM indisponible(s) et leur motif.
    noTpm: c.state === 'sans_tpm' && c.default && (c.default.noTpm || []).length ? c.default.noTpm : undefined,
    unavailable: (c.unavailable || []).length ? c.unavailable : undefined,
    override: o ? {
      id: o.id, reason: o.reason, by: o.updatedByName || null, at: o.updatedAt, expectedLabel: o.expectedLabel || null,
      expectedState: o.expectedState, batchId: o.batchId || null,
    } : null,
  };
}

/** Ce que dit le contrat (cellule par défaut) pour l'écran. */
function defaultView(def, inputs) {
  return {
    state: def.state, providerId: def.providerId || null, providerName: providerName(inputs, def.providerId),
    contractId: def.contractId || null, numero: def.numero || null, contractLabel: def.contractLabel || null, partiel: Boolean(def.partiel),
    candidates: def.candidates.map((x) => ({ ...x, providerName: providerName(inputs, x.providerId) || x.providerName })),
    noTpm: def.noTpm || [],
  };
}

/** Segments (mois consécutifs identiques) du « selon contrat » d'une aire. */
function contractSegments(cells, inputs) {
  const out = [];
  for (const c of cells) {
    const d = c.default;
    const key = `${d.state}|${d.providerId || ''}|${d.contractId || ''}|${d.candidates.map((x) => x.contractId).join(',')}|${(d.noTpm || []).map((x) => x.contractId).join(',')}`;
    const last = out[out.length - 1];
    if (last && last.key === key) { last.to = c.month; last.months += 1; continue; }
    out.push({ key, from: c.month, to: c.month, months: 1, ...defaultView(d, inputs) });
  }
  return out.map(({ key: _k, ...s }) => s);
}

/**
 * Onglet « Affectation des TPM » : lignes région › district (› commune quand un contrat ou une
 * modification y descend), pour chaque ligne le TPM selon contrat et le TPM retenu par segments
 * de mois, les sites, les visites de la période (prévues, réalisées, écarts) ; bannières de qualité.
 */
async function getTable(tenantId, { period, regionId = null, all = false }) {
  return withTenantTransaction(tenantId, async (client) => {
    const months = monthsOf(period);
    const today = currentMonth();
    const inputs = await repo.loadInputsTx(client, tenantId, period);
    const { areas, siteCounts } = await repo.zoneRowsTx(client, tenantId, { all, inputs });
    const table = rule.buildZoneTable({ areas, months, ...inputs, today });
    const groups = await repo.visitGroupsTx(client, tenantId, period);
    const counts = await repo.attributionCountsTx(client, tenantId, { fromMonth: today });

    const sitesByArea = new Map();
    for (const s of siteCounts) {
      if (s.districtId) sitesByArea.set(s.districtId, (sitesByArea.get(s.districtId) || 0) + s.n);
      if (s.communeId) sitesByArea.set(s.communeId, (sitesByArea.get(s.communeId) || 0) + s.n);
    }
    // Visites rangées dans la ligne qui décide de leur TPM (commune portée, sinon district).
    const visitsByArea = new Map();
    let unknownVisits = 0;
    for (const g of groups) {
      const cell = rule.cellForSite(g, g.month, table);
      if (!cell || !cell.areaId) { unknownVisits += g.n; continue; }
      const k = `${cell.areaId}|${g.month}`;
      if (!visitsByArea.has(k)) visitsByArea.set(k, { planned: 0, realised: 0, cancelled: 0, divergent: 0, reprise: 0 });
      const v = visitsByArea.get(k);
      if (g.status === 'planifie') v.planned += g.n; else if (g.status === 'realise') v.realised += g.n; else v.cancelled += g.n;
      if (g.status !== 'annule' && g.source === 'reprise') v.reprise += g.n;
      // Écart = visite PRÉVUE dont le TPM diffère de celui de sa zone (écart motivé, ou saisi avant la
      // règle et déjà facturé) ; une visite réalisée garde le TPM qui l'a faite : ce n'est pas un écart à traiter.
      const frozen = g.source === 'zone' && g.zoneState === 'anterieur';
      if (g.status === 'planifie' && !frozen && (g.providerId || null) !== (cell.providerId || null)) v.divergent += g.n;
    }
    const rows = areas
      .filter((a) => !regionId || a.regionId === regionId)
      .map((a) => {
        const cells = months.map((m) => table.cells.get(`${a.id}|${m}`));
        const visits = months.map((m) => visitsByArea.get(`${a.id}|${m}`) || { planned: 0, realised: 0, cancelled: 0, divergent: 0, reprise: 0 });
        return {
          id: a.id, depth: a.depth, name: a.name, path: a.path, regionId: a.regionId, regionName: a.regionName,
          districtId: a.depth === 3 ? a.districtId : a.id, sites: sitesByArea.get(a.id) || 0,
          own: cells.map((c) => c.own),
          cells: cells.map(cellView),
          contract: cells.map((c) => defaultView(c.default, inputs)),
          segments: rule.segments(cells).map((s) => ({ from: s.from, to: s.to, months: s.months, ...cellView(s.cell) })),
          contractSegments: contractSegments(cells, inputs),
          visits,
        };
      })
      // Une commune n'a de ligne que si, au moins un mois, elle décide du TPM de ses sites.
      .filter((r) => r.depth === 2 || r.own.some(Boolean))
      .sort((x, y) => x.regionName.localeCompare(y.regionName, 'fr') || (x.districtId === y.districtId
        ? (x.depth - y.depth) || x.name.localeCompare(y.name, 'fr')
        : (areaName(areas, x.districtId)).localeCompare(areaName(areas, y.districtId), 'fr')));
    const regions = [...new Map(areas.map((a) => [a.regionId, { id: a.regionId, name: a.regionName }])).values()]
      .sort((x, y) => x.name.localeCompare(y.name, 'fr'));
    return {
      period: { from: period.from, to: period.to }, months, today, regions, rows,
      quality: { ...table.quality, sitesWithoutDistrict: counts.sitesWithoutDistrict, plannedReprise: counts.plannedReprise, unknownVisits, pending: counts.pending },
    };
  });
}
const areaName = (areas, id) => (areas.find((a) => a.id === id) || { name: '' }).name;

/**
 * Prestataires actifs (titulaires) et sélectionnables sur une plage, avec leurs mois et contrats
 * (règle commune du lot 8) ; chaque contrat porte en plus son libellé d'écran (n° FLA, sinon numéro) ;
 * `contractTpms` : contrat de suivi → son ou ses TPM (règle unique du retour 58).
 */
async function providers(tenantId, { period }) {
  return withTenantTransaction(tenantId, async (client) => {
    const months = monthsOf(period);
    const inputs = await repo.loadInputsTx(client, tenantId, period);
    const out = rule.tpmSelectable({ links: inputs.links, partners: inputs.partners, months, unavailability: inputs.unavailability });
    const label = new Map(inputs.contracts.map((c) => [c.id, c.numeroFla || c.numero]));
    for (const g of out.groups || []) {
      for (const p of g.providers || []) p.contracts = (p.contracts || []).map((c) => ({ ...c, contractLabel: label.get(c.id) || c.numero }));
    }
    // TPM de chaque contrat de suivi de la plage (rule.contractTpms, D1 : TPM rattaché par plan ou
    // facture, sinon titulaire s'il est un TPM actif ; sinon aucun — « Interne ») — la valeur par
    // défaut des formulaires prestataire × contrat.
    out.contractTpms = Object.fromEntries(inputs.contracts.filter((c) => rule.isMonitoringContract(c))
      .map((c) => [c.id, rule.contractTpms(c).map((p) => ({ id: p.id, name: p.name }))]));
    return out;
  });
}

/** TPM d'un site pour un mois (formulaire de visite) : valeur, origine, contrat, sélectionnables. */
async function resolve(tenantId, { siteId, month }) {
  return withTenantTransaction(tenantId, async (client) => {
    const site = await repo.siteZoneTx(client, tenantId, siteId);
    if (!site) throw notFound('Site introuvable');
    const { table, inputs, areas } = await repo.tableForSitesTx(client, tenantId, { zones: [site], months: [month] });
    const cell = rule.cellForSite(site, month, table);
    const area = cell && cell.areaId ? areas.find((a) => a.id === cell.areaId) : null;
    return {
      siteId, month, area: area ? { id: area.id, name: area.name, path: area.path, depth: area.depth } : null,
      ...cellView(cell), contract: cell && cell.default ? defaultView(cell.default, inputs) : null,
      selectable: rule.tpmSelectable({ links: inputs.links, partners: inputs.partners, months: [month], unavailability: inputs.unavailability }),
    };
  });
}

/**
 * Prépare un changement (aperçu et enregistrement, MÊMES étapes) : aires contrôlées dans le
 * découpage du compte (district ou commune), table avant, empreinte, plan d'écriture, table après
 * simulation, visites prévues dont le TPM changerait, avertissements.
 */
async function prepareChangeTx(client, tenantId, { target, mode, providerId = null, reason = null }) {
  const period = { from: target.from, to: target.to };
  const months = monthsOf(period, { max: rule.MAX_SPAN_MONTHS });
  const regionDistricts = await repo.expandRegionsTx(client, tenantId, target.regionIds || []);
  const areaIds = [...new Set([...(target.areaIds || []), ...regionDistricts])];
  if (!areaIds.length) throw badRequest('Choisissez au moins une zone (district ou commune).', { code: 'area_required' });
  if (areaIds.length > rule.MAX_AREAS) throw badRequest(`Trop de zones à la fois (${rule.MAX_AREAS} au plus).`, { code: 'too_many_areas' });
  if (areaIds.length * months.length > rule.MAX_CELLS) {
    throw badRequest(`Trop de cellules à la fois : ${areaIds.length} zones × ${months.length} mois (${rule.MAX_CELLS} au plus). Réduisez la période ou la sélection.`, { code: 'too_many_cells' });
  }
  const targetAreas = await repo.areasTx(client, tenantId, areaIds);
  if (targetAreas.length !== areaIds.length || targetAreas.some((a) => a.depth !== 2 && a.depth !== 3)) {
    throw badRequest('Zone inconnue ou hors district / commune pour ce compte.', { code: 'area_depth' });
  }
  const inputs = await repo.loadInputsTx(client, tenantId, period);
  const visits = await repo.plannedZoneVisitsTx(client, tenantId, { areaIds, months });
  const extra = new Set(repo.communeRowIds(inputs));
  for (const v of visits) { if (v.districtId) extra.add(v.districtId); if (v.communeId) extra.add(v.communeId); }
  for (const a of targetAreas) if (a.depth === 3 && a.districtId) extra.add(a.districtId);
  for (const a of targetAreas) extra.delete(a.id);
  const areas = [...targetAreas, ...(await repo.areasTx(client, tenantId, [...extra]))];
  const today = currentMonth();
  const before = rule.buildZoneTable({ areas, months, ...inputs, today });
  const targets = targetAreas.flatMap((a) => months.map((m) => ({ areaId: a.id, month: m, cell: before.cells.get(`${a.id}|${m}`) })));
  const stamp = rule.stampOf(targets.map((t) => t.cell));
  const plan = mode === 'revenir'
    ? rule.planRevert({ targets, partnersById: before.partnersById })
    : rule.planOverrides({ targets, providerId, reason, partnersById: before.partnersById });

  // Simulation : modifications après le plan (mêmes règles que l'écriture), puis visites qui changent.
  const removed = new Set(plan.deletes);
  const replaced = new Set((plan.upserts || []).map((u) => `${u.areaId}|${u.month}`));
  const overridesAfter = [
    ...inputs.overrides.filter((o) => !removed.has(o.id) && !replaced.has(`${o.adminAreaId}|${o.month}`)),
    ...(plan.upserts || []).map((u, i) => ({ id: `sim-${i}`, adminAreaId: u.areaId, areaDepth: (areas.find((a) => a.id === u.areaId) || {}).depth, month: u.month, providerId: u.providerId, expectedState: u.expectedState, expectedProviderId: u.expectedProviderId, reason })),
  ];
  const after = rule.buildZoneTable({ areas, months, ...inputs, overrides: overridesAfter, today });
  const visitChanges = rule.restampPlan(visits, after);
  const summary = rule.summarizeRestamp(visitChanges);
  summary.moves = summary.moves.map((m) => ({ ...m, fromName: providerName(inputs, m.fromProviderId), toName: providerName(inputs, m.toProviderId) }));

  const selectable = rule.tpmSelectable({ links: inputs.links, partners: inputs.partners, months, unavailability: inputs.unavailability });
  // Choisir la valeur DU CONTRAT pour toutes les zones d'un mois revient au contrat (la modification est
  // supprimée) : toujours permis, même quand ce TPM n'est pas sélectionnable ce mois-là (indisponible —
  // la zone reste alors en suivi interne, retour 114). Avec D1 dans l'estampille, la valeur du contrat
  // est toujours un TPM actif, jamais un partenaire de mise en œuvre.
  const contractValue = (m) => targets.filter((x) => x.month === m)
    .every((x) => x.cell && x.cell.default && x.cell.default.state === 'contrat' && x.cell.default.providerId === providerId);
  const notSelectable = mode === 'revenir' ? [] : rule.notSelectableMonths(providerId, months, selectable).filter((m) => !contractValue(m));
  const warnings = [];
  const plans = await repo.monthPlanStatusesTx(client, tenantId, months);
  const validated = plans.filter((p) => p.status === 'valide').map((p) => p.month);
  if (validated.length) warnings.push({ code: 'plan_valide', months: validated });
  if (mode !== 'revenir' && providerId) {
    const active = (selectable.groups.find((g) => g.key === 'contrat') || { providers: [] }).providers;
    const holderMonths = new Set((active.find((h) => h.id === providerId) || { months: [] }).months);
    const outside = months.filter((m) => !holderMonths.has(m));
    if (outside.length && !notSelectable.length) warnings.push({ code: 'hors_contrat', months: outside, providerName: providerName(inputs, providerId) });
  }
  const contract = targetAreas.map((a) => ({
    areaId: a.id, name: a.name, path: a.path, depth: a.depth,
    segments: contractSegments(months.map((m) => ({ month: m, ...before.cells.get(`${a.id}|${m}`) })), inputs),
  }));
  return { period, months, areaIds, targetAreas, stamp, plan, visits: summary, notSelectable, warnings, contract, inputs };
}

/** Libellé d'un lot pour le journal : zones (noms) · période. */
function lotLabel(targetAreas, period) {
  const names = targetAreas.map((a) => a.name);
  const head = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} … (${names.length} zones)`;
  return `${head} · ${periodLabel(period)}`.slice(0, 300);
}

const previewView = (p) => ({
  stamp: p.stamp, months: p.months, areas: p.targetAreas.map((a) => ({ id: a.id, name: a.name, path: a.path, depth: a.depth })),
  counts: p.plan.counts, visits: p.visits, warnings: p.warnings, notSelectable: p.notSelectable, contract: p.contract,
});

/** Aperçu d'un changement, sans verrou ni écriture. */
async function preview(tenantId, { target, mode, providerId = null, reason = null }) {
  const clean = mode === 'revenir' ? null : (checkReason(reason, { required: false }).reason || null);
  return withTenantTransaction(tenantId, async (client) => previewView(await prepareChangeTx(client, tenantId, { target, mode, providerId, reason: clean })));
}

/** Lignes du journal d'un changement de zones : un lot + une ligne par zone × mois. */
function zoneLogRows({ batchId, prep, action, reason, visitsUpdated }) {
  const areaById = new Map(prep.targetAreas.map((a) => [a.id, a]));
  return [
    { batch_id: batchId, scope: 'lot', action, label: lotLabel(prep.targetAreas, prep.period), month_from: prep.period.from, month_to: prep.period.to,
      zones_changed: prep.plan.log.length, visits_updated: visitsUpdated, reason },
    ...prep.plan.log.map((l) => ({
      batch_id: batchId, scope: 'zone', action: l.action, label: (areaById.get(l.areaId) || {}).path || '—', admin_area_id: l.areaId,
      period_month: l.month, old_state: l.old.state, old_provider_id: l.old.providerId, new_state: l.new.state, new_provider_id: l.new.providerId,
      contract_label: l.contractLabel, reason: l.action === 'revenir_contrat' ? (reason || null) : reason,
    })),
  ];
}

const STALE = 'L\'affectation a changé entre-temps (autre utilisateur, contrat ou découpage) : rechargez l\'aperçu.';

/**
 * Enregistrer un changement de TPM sur des zones × mois (une transaction) : verrou, contrôles,
 * empreinte de l'aperçu (409 si périmée), sélectionnable chaque mois, plan, écritures (une
 * suppression, un upsert multi-lignes), estampille des visites prévues visées, journal.
 */
async function setOverrides(tenantId, actor, { target, providerId = null, reason, stamp }) {
  const clean = reasonOf(reason, { required: false });
  return withTenantTransaction(tenantId, async (client) => {
    await repo.lockAttributionTx(client, tenantId);
    const prep = await prepareChangeTx(client, tenantId, { target, mode: 'modifier', providerId, reason: clean });
    if (prep.stamp !== stamp) throw conflict(STALE, { code: 'stale' });
    if (providerId && prep.notSelectable.length) {
      throw badRequest(`Ce partenaire n'est pas sélectionnable sur toute la période : ce n'est pas un TPM actif, ou il est déclaré indisponible (${prep.notSelectable.join(', ')}).`,
        { code: 'provider_not_selectable', months: prep.notSelectable });
    }
    const { plan } = prep;
    if (plan.upserts.length && !clean) throw badRequest(REASON_MESSAGES.reason_required, { code: 'reason_required' });
    if (!plan.upserts.length && !plan.deletes.length) return { unchanged: true, counts: plan.counts, visits: { changed: 0, byState: {}, moves: [] } };
    const batchId = crypto.randomUUID();
    await repo.deleteOverridesTx(client, tenantId, plan.deletes);
    await repo.upsertOverridesTx(client, tenantId, { actorId: actor.userId, batchId, reason: clean, rows: plan.upserts });
    const visits = await repo.restampVisitsTx(client, tenantId, { areaIds: prep.areaIds, months: prep.months });
    const action = plan.upserts.length ? (plan.counts.confirmed && !plan.counts.created && !plan.counts.updated ? 'confirmer' : 'modifier') : 'revenir_contrat';
    await repo.insertLogTx(client, tenantId, actor.userId, zoneLogRows({ batchId, prep, action, reason: clean, visitsUpdated: visits.changed }));
    return { batchId, counts: plan.counts, visits };
  });
}

/** « Revenir au contrat » sur des zones × mois : supprime les modifications visées (raison facultative). */
async function revert(tenantId, actor, { target, reason, stamp }) {
  const clean = reasonOf(reason, { required: false });
  return withTenantTransaction(tenantId, async (client) => {
    await repo.lockAttributionTx(client, tenantId);
    const prep = await prepareChangeTx(client, tenantId, { target, mode: 'revenir' });
    if (prep.stamp !== stamp) throw conflict(STALE, { code: 'stale' });
    if (!prep.plan.deletes.length) return { unchanged: true, counts: prep.plan.counts, visits: { changed: 0, byState: {}, moves: [] } };
    const batchId = crypto.randomUUID();
    await repo.deleteOverridesTx(client, tenantId, prep.plan.deletes);
    const visits = await repo.restampVisitsTx(client, tenantId, { areaIds: prep.areaIds, months: prep.months });
    await repo.insertLogTx(client, tenantId, actor.userId, zoneLogRows({ batchId, prep, action: 'revenir_contrat', reason: clean, visitsUpdated: visits.changed }));
    return { batchId, counts: prep.plan.counts, visits };
  });
}

/**
 * « Appliquer les TPM des contrats » sur une période : les visites PRÉVUES dont le TPM n'a pas été
 * choisi à la main avec une raison reprennent celui de leur zone (journalisé, visite par visite) ;
 * réalisées, annulées, antérieures à la règle et déjà facturées gardent leur TPM (compte rendu `kept`).
 */
async function reapply(tenantId, actor, { period, reason }) {
  const clean = reasonOf(reason, { required: false });
  return withTenantTransaction(tenantId, async (client) => ({
    visits: await repo.applyContractsTx(client, tenantId, actor.userId, {
      period, reason: clean, label: `TPM des contrats appliqués aux visites · ${periodLabel(period)}`,
    }),
  }));
}

/** Traduction d'une erreur de règle de visite en 400 (avec le site et le mois quand on les connaît). */
const visitError = (res) => badRequest(rule.visitErrorMessage(res), { code: res.error });

/** TPM de visites (≤ 500) : suivre la zone, poser une autre valeur motivée, ou garder une reprise. */
async function setVisitsProvider(tenantId, actor, { visitIds, action, providerId = null, reason }) {
  const clean = reasonOf(reason, { required: false });
  return withTenantTransaction(tenantId, async (client) => {
    const res = await repo.applyVisitRequestTx(client, tenantId, actor.userId, visitIds, { action, providerId, reason: clean });
    if (res.error) throw visitError(res);
    return res;
  });
}

/**
 * TPM de la zone de chaque site d'une liste pour un mois (Priorités du mois du RBM, autres listes de
 * sites) : `row.tpm` = { state, providerId, providerName, contractLabel, reason, candidates? } — la
 * MÊME règle que l'estampille des visites (cellsForSitesTx). Lecture seule ; les lignes sont rendues
 * telles quelles, complétées. `idOf` : identifiant du site dans la ligne (défaut : row.id).
 */
async function withZoneTpm(tenantId, rows, month, { idOf = (r) => r.id } = {}) {
  const list = rows || [];
  if (!list.length || !/^\d{4}-\d{2}$/.test(String(month || '').slice(0, 7))) return list;
  const m = String(month).slice(0, 7);
  const cells = await withTenantTransaction(tenantId, (client) => repo.cellsForSitesTx(client, tenantId, list.map((r) => ({ siteId: idOf(r), month: m }))));
  return list.map((r) => ({ ...r, tpm: cells.get(`${idOf(r)}|${m}`) || null }));
}

async function listLog(tenantId, filters) {
  return withTenantTransaction(tenantId, (client) => repo.listLogTx(client, tenantId, filters));
}

module.exports = {
  getTable, providers, resolve, preview, setOverrides, revert, reapply, setVisitsProvider, listLog, withZoneTpm,
  prepareChangeTx, reasonOf, visitError, contractSegments,
};
