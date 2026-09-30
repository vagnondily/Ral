const { withTenantTransaction } = require('../../config/db');
const { badRequest, conflict, forbidden, notFound } = require('../../middleware/errors');
const { nudgeOutbox } = require('../../jobs/outbox');
const repo = require('./contracts.repository');
const d = require('./contracts.domain');
const { buildBudgetWorkbook } = require('./budgetXlsx');

/**
 * Contrats — business rules. Partner comes from the Paramètres registry,
 * activities from the configurable list, and the budget is the real FLA
 * matrix (cost line × activity). Consumption on the monitoring line comes
 * from validated TPM financial reports (expenses moved to the TPM module).
 * Every operation is one transaction: state change + history + event.
 */

const TIMEZONE = process.env.APP_TIMEZONE || 'Indian/Antananarivo';
const WRITE_ROLES = ['admin', 'manager'];

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
}
function canWrite(actor) { return WRITE_ROLES.includes(actor.role); }
function assertCanWrite(actor) { if (!canWrite(actor)) throw forbidden('Votre rôle ne permet pas de modifier les contrats.'); }

async function loadForUpdate(client, tenantId, id) {
  const contract = await repo.getContract(client, tenantId, id, { forUpdate: true });
  if (!contract) throw notFound('Contrat introuvable');
  return contract;
}
function assertVersion(contract, version) {
  if (version !== undefined && version !== contract.version) {
    throw conflict('Ce contrat a été modifié entre-temps par un autre utilisateur. Rechargez la page.');
  }
}
async function saveContract(client, tenantId, contract, fields) {
  const ok = await repo.updateContract(client, tenantId, contract.id, contract.version, fields);
  if (!ok) throw conflict('Ce contrat a été modifié entre-temps par un autre utilisateur. Rechargez la page.');
}
function transition(action, contract) {
  const to = d.transitionTarget(action, contract.status);
  if (!to) throw conflict(`Action impossible : le contrat est au statut « ${d.STATUS_LABELS[contract.status]} ».`);
  return to;
}
async function assertValidator(client, tenantId, validatorId, actor) {
  if (validatorId === actor.userId) throw badRequest('Le valideur doit être une autre personne que vous (séparation des tâches).');
  const validators = await repo.listValidators(client, tenantId);
  if (!validators.some((v) => v.id === validatorId)) throw badRequest('Valideur inconnu ou non habilité.');
}

/** Resolve partner + activities, and clean the budget items against them. */
async function resolveInputs(client, tenantId, input) {
  const partner = await repo.getPartner(client, tenantId, input.partnerId);
  if (!partner) throw badRequest('Partenaire inconnu ou inactif.');
  const activityIds = await repo.validActivityIds(client, tenantId, input.activityIds || []);
  if (activityIds.length !== (input.activityIds || []).length) throw badRequest('Une activité sélectionnée est inconnue ou inactive.');
  let items;
  try {
    items = d.normalizeBudgetItems(input.budget || [], activityIds);
  } catch (err) {
    throw badRequest(err.message);
  }
  const feePct = input.managementFeePct === undefined ? d.DEFAULT_FEE_PCT : Number(input.managementFeePct);
  if (!Number.isFinite(feePct) || feePct < 0 || feePct > 1) throw badRequest('Commission de gestion invalide (0 à 100 %).');
  // Areas are chosen from the tenant's admin breakdown (no free text): the
  // client sends admin_area ids, we resolve them to their canonical path.
  const areaIds = [...new Set((input.areas || []).map((a) => a.adminAreaId).filter(Boolean))];
  const resolved = await repo.getAdminAreasByIds(client, tenantId, areaIds);
  if (resolved.length !== areaIds.length) throw badRequest('Une zone sélectionnée est inconnue pour ce pays.');
  const areas = resolved.map((a) => ({ adminAreaId: a.adminAreaId, path: a.path, depth: a.depth }));
  return { partner, activityIds, items, feePct, areas };
}

// --------------------------------------------------------------- reads

async function listContracts(tenantId, filters) {
  return withTenantTransaction(tenantId, async (client) => {
    const rows = await repo.listContracts(client, tenantId, filters);
    return rows.map((c) => {
      const months = c.periodMonths || d.monthsBetween(c.dateDebut, c.dateFin);
      return {
        ...c,
        reference: d.displayReference(c.numeroFla, c.amendmentCount),
        remainingTotal: c.budgetTotal - c.spentTotal,
        monitoringRemaining: c.monitoringBudget - c.spentTotal,
        monthlyCeiling: d.monthlyCeiling(c.budgetTotal, months),
        periodMonths: months,
        amendmentRequired: c.spentTotal > c.monitoringBudget && c.monitoringBudget > 0,
        expired: c.status === 'actif' && c.dateFin < today(),
      };
    });
  });
}

async function listValidators(tenantId, actor) {
  return withTenantTransaction(tenantId, async (client) =>
    (await repo.listValidators(client, tenantId)).filter((v) => v.id !== actor.userId)
  );
}

function allowedActions(contract, ctx, actor) {
  const write = canWrite(actor);
  const pending = ctx.amendments.find((a) => a.status === 'en_validation');
  const isActive = contract.status === 'actif';
  return {
    edit: write && d.isEditable(contract.status),
    submit: write && Boolean(d.transitionTarget('submit', contract.status)),
    decide: contract.status === 'en_validation' && contract.validatorId === actor.userId,
    amend: write && isActive && !pending,
    decideAmendment: Boolean(pending) && pending.validatorId === actor.userId,
    renew: write && isActive && !ctx.renewal && d.renewalWindowOpen(contract.dateFin, today()),
    terminate: write && isActive,
  };
}

async function getContractDetail(tenantId, id, actor) {
  return withTenantTransaction(tenantId, async (client) => {
    const contract = await repo.getContract(client, tenantId, id);
    if (!contract) throw notFound('Contrat introuvable');
    const activities = await repo.getContractActivities(client, tenantId, id);
    const items = await repo.getBudgetItems(client, tenantId, id);
    const areas = await repo.getContractAreas(client, tenantId, id);
    const spent = await repo.monitoringSpent(client, tenantId, id);
    const amendments = await repo.listAmendments(client, tenantId, id);
    const renewal = await repo.findRenewal(client, tenantId, id);
    let renewedFrom = null;
    if (contract.renewedFromId) {
      const prev = await repo.getContract(client, tenantId, contract.renewedFromId);
      renewedFrom = prev && { id: prev.id, numero: prev.numero };
    }
    const feePct = Number(contract.managementFeePct);
    const budget = d.computeBudget(items, activities, feePct, spent);
    const months = contract.periodMonths || d.monthsBetween(contract.dateDebut, contract.dateFin);
    const today_ = today();
    return {
      contract: {
        ...contract,
        managementFeePct: feePct,
        periodMonths: months,
        monthlyCeiling: d.monthlyCeiling(budget.total.grand, months),
        reference: d.displayReference(contract.numeroFla, contract.amendmentCount),
        expired: contract.status === 'actif' && contract.dateFin < today_,
        daysToEnd: d.daysBetween(today_, contract.dateFin),
        renewalWindowDays: d.RENEWAL_WINDOW_DAYS,
      },
      activities,
      areas,
      budget,
      amendments,
      renewal,
      renewedFrom,
      actions: allowedActions(contract, { amendments, renewal }, actor),
    };
  });
}

async function budgetWorkbook(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const contract = await repo.getContract(client, tenantId, id);
    if (!contract) throw notFound('Contrat introuvable');
    const activities = await repo.getContractActivities(client, tenantId, id);
    const items = await repo.getBudgetItems(client, tenantId, id);
    const months = contract.periodMonths || d.monthsBetween(contract.dateDebut, contract.dateFin);
    const reference = d.displayReference(contract.numeroFla, contract.amendmentCount);
    const wb = buildBudgetWorkbook({
      contract: { ...contract, reference }, activities, items,
      feePct: Number(contract.managementFeePct), months,
    });
    const buffer = await wb.xlsx.writeBuffer();
    return { buffer, filename: `Budget_${reference || contract.numero}.xlsx` };
  });
}

async function getHistory(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await repo.getContract(client, tenantId, id))) throw notFound('Contrat introuvable');
    return repo.listHistory(client, tenantId, id);
  });
}

// -------------------------------------------------------------- writes

async function createContract(tenantId, actor, input) {
  assertCanWrite(actor);
  const id = await withTenantTransaction(tenantId, async (client) => {
    const { partner, activityIds, items, feePct, areas } = await resolveInputs(client, tenantId, input);
    const year = Number(today().slice(0, 4));
    const numero = d.contractNumber(year, await repo.nextSequence(client, tenantId, year));
    const contractId = await repo.insertContract(client, tenantId, {
      numero, partnerId: partner.id, partnerName: partner.name, activityCodes: [],
      numeroFla: input.numeroFla, numeroPo: input.numeroPo, numeroVendor: input.numeroVendor,
      dateDebut: input.dateDebut, dateFin: input.dateFin, createdBy: actor.userId,
      managementFeePct: feePct, periodMonths: d.monthsBetween(input.dateDebut, input.dateFin),
    });
    await repo.setContractActivities(client, tenantId, contractId, activityIds);
    await repo.replaceBudget(client, tenantId, contractId, items);
    await repo.replaceAreas(client, tenantId, contractId, areas);
    await repo.addHistory(client, tenantId, contractId, { action: 'creation', actorId: actor.userId, details: { numero, partner: partner.name } });
    return contractId;
  });
  return { id };
}

async function updateDraft(tenantId, actor, id, input) {
  assertCanWrite(actor);
  await withTenantTransaction(tenantId, async (client) => {
    const contract = await loadForUpdate(client, tenantId, id);
    assertVersion(contract, input.version);
    if (!d.isEditable(contract.status)) {
      throw conflict(`Contrat non modifiable au statut « ${d.STATUS_LABELS[contract.status]} ». Passez par un avenant.`);
    }
    const { partner, activityIds, items, feePct, areas } = await resolveInputs(client, tenantId, input);
    await saveContract(client, tenantId, contract, {
      partnerId: partner.id, partnerName: partner.name,
      numeroFla: input.numeroFla || null, numeroPo: input.numeroPo || null, numeroVendor: input.numeroVendor || null,
      dateDebut: input.dateDebut, dateFin: input.dateFin,
      managementFeePct: feePct, periodMonths: d.monthsBetween(input.dateDebut, input.dateFin),
    });
    await repo.setContractActivities(client, tenantId, id, activityIds);
    await repo.replaceBudget(client, tenantId, id, items);
    await repo.replaceAreas(client, tenantId, id, areas);
    await repo.addHistory(client, tenantId, id, { action: 'modification', actorId: actor.userId });
  });
}

async function submit(tenantId, actor, id, { validatorId, comment, version }) {
  assertCanWrite(actor);
  await withTenantTransaction(tenantId, async (client) => {
    const contract = await loadForUpdate(client, tenantId, id);
    assertVersion(contract, version);
    const to = transition('submit', contract);
    await assertValidator(client, tenantId, validatorId, actor);
    const items = await repo.getBudgetItems(client, tenantId, id);
    if (d.directTotal(items) <= 0) throw badRequest('Renseignez le budget avant de soumettre.');
    await saveContract(client, tenantId, contract, {
      status: to, validatorId, submittedBy: actor.userId, submittedAt: new Date(), decidedBy: null, decidedAt: null,
    });
    await repo.addHistory(client, tenantId, id, { action: 'soumission', actorId: actor.userId, comment, details: { validatorId } });
  });
}

async function decide(tenantId, actor, id, { approve, comment, version }) {
  let activated = false;
  await withTenantTransaction(tenantId, async (client) => {
    const contract = await loadForUpdate(client, tenantId, id);
    assertVersion(contract, version);
    const to = transition(approve ? 'approve' : 'reject', contract);
    if (contract.validatorId !== actor.userId) throw forbidden('Seul le valideur assigné peut statuer sur ce contrat.');
    if (!approve && !comment) throw badRequest('Un motif est obligatoire pour rejeter.');
    await saveContract(client, tenantId, contract, { status: to, decidedBy: actor.userId, decidedAt: new Date() });
    await repo.addHistory(client, tenantId, id, { action: approve ? 'approbation' : 'rejet', actorId: actor.userId, comment });
    if (approve) {
      const items = await repo.getBudgetItems(client, tenantId, id);
      await repo.addEvent(client, tenantId, 'ContratActive', id, {
        contractId: id, tenantId, numero: contract.numero, partner: contract.partnerName,
        dateDebut: contract.dateDebut, dateFin: contract.dateFin,
        budgetTotal: d.grandTotal(items, contract.managementFeePct),
      });
      activated = true;
    }
  });
  if (activated) nudgeOutbox();
}

async function requestAmendment(tenantId, actor, id, input) {
  assertCanWrite(actor);
  return withTenantTransaction(tenantId, async (client) => {
    const contract = await loadForUpdate(client, tenantId, id);
    if (contract.status !== 'actif') throw conflict('Un avenant ne peut concerner qu\'un contrat actif.');
    const amendments = await repo.listAmendments(client, tenantId, id);
    if (amendments.some((a) => a.status === 'en_validation')) throw conflict('Un avenant est déjà en cours de validation.');
    await assertValidator(client, tenantId, input.validatorId, actor);
    if (!input.justification || !String(input.justification).trim()) throw badRequest('Une justification est obligatoire.');
    if (input.dateFin <= input.dateDebut) throw badRequest('La date de fin doit suivre la date de début.');
    // An amendment follows the SAME process as a new contract: it carries the
    // full revised detail (partner, activities, districts, budget postes,
    // dates, commission). The whole revised state is validated now and applied
    // wholesale on approval.
    const { partner, activityIds, items, feePct, areas } = await resolveInputs(client, tenantId, input);
    // Snapshot AVANT (état courant) pour permettre le contrôle « ce qui a changé ».
    const curActs = await repo.getContractActivities(client, tenantId, id);
    const curItems = await repo.getBudgetItems(client, tenantId, id);
    const curAreas = await repo.getContractAreas(client, tenantId, id);
    const summarize = (its) => its.map((it) => ({ lineCode: it.lineCode, description: it.description, unitCount: Number(it.unitCount), unitCost: Number(it.unitCost) }));
    const before = {
      activityLabels: curActs.map((x) => x.label),
      areaPaths: curAreas.map((x) => x.path),
      items: summarize(curItems), feePct: Number(contract.managementFeePct),
      dateDebut: contract.dateDebut, dateFin: contract.dateFin,
      numeroFla: contract.numeroFla, numeroPo: contract.numeroPo, numeroVendor: contract.numeroVendor,
      directTotal: d.directTotal(curItems), grandTotal: d.grandTotal(curItems, contract.managementFeePct),
    };
    const afterLabels = await repo.activityLabels(client, tenantId, activityIds);
    const after = {
      // applicable (pour decideAmendment)
      partnerId: partner.id, partnerName: partner.name, activityIds, items, areas, feePct,
      dateDebut: input.dateDebut, dateFin: input.dateFin,
      numeroFla: input.numeroFla || null, numeroPo: input.numeroPo || null, numeroVendor: input.numeroVendor || null,
      // affichage (pour le diff)
      activityLabels: afterLabels.map((x) => x.label),
      areaPaths: areas.map((x) => x.path),
      directTotal: d.directTotal(items), grandTotal: d.grandTotal(items, feePct),
    };
    const number = await repo.nextAmendmentNumber(client, tenantId, id);
    const amendmentId = await repo.insertAmendment(client, tenantId, id, {
      number, justification: input.justification, newDateFin: input.dateFin || null, changes: { before, after },
      validatorId: input.validatorId, createdBy: actor.userId,
    });
    await repo.addHistory(client, tenantId, id, {
      action: 'avenant_demande', actorId: actor.userId, comment: input.justification, details: { code: d.amendmentCode(number) },
    });
    return { id: amendmentId, code: d.amendmentCode(number) };
  });
}

async function decideAmendment(tenantId, actor, id, amendmentId, { approve, comment }) {
  let modified = false;
  await withTenantTransaction(tenantId, async (client) => {
    const contract = await loadForUpdate(client, tenantId, id);
    const amendment = await repo.getAmendment(client, tenantId, id, amendmentId);
    if (!amendment) throw notFound('Avenant introuvable');
    if (amendment.status !== 'en_validation') throw conflict('Cet avenant a déjà été traité.');
    if (amendment.validatorId !== actor.userId) throw forbidden('Seul le valideur assigné peut statuer sur cet avenant.');
    if (!approve && !comment) throw badRequest('Un motif est obligatoire pour rejeter.');
    if (approve && contract.status !== 'actif') throw conflict('Le contrat n\'est plus actif : l\'avenant ne peut pas être appliqué.');

    await repo.decideAmendment(client, tenantId, amendmentId, approve ? 'approuve' : 'rejete', actor.userId, comment);
    const code = d.amendmentCode(amendment.number);
    if (approve) {
      const raw = amendment.budgetChanges || {};
      const snap = raw.after || raw; // nouveau format { before, after } ou ancien plat
      const dateDebut = snap.dateDebut || contract.dateDebut;
      const dateFin = snap.dateFin || amendment.newDateFin || contract.dateFin;
      const fields = {
        amendmentCount: contract.amendmentCount + 1,
        dateDebut, dateFin, periodMonths: d.monthsBetween(dateDebut, dateFin),
      };
      if (snap.partnerId) { fields.partnerId = snap.partnerId; fields.partnerName = snap.partnerName; }
      if (snap.feePct !== undefined && snap.feePct !== null) fields.managementFeePct = snap.feePct;
      if ('numeroFla' in snap) fields.numeroFla = snap.numeroFla;
      if ('numeroPo' in snap) fields.numeroPo = snap.numeroPo;
      if ('numeroVendor' in snap) fields.numeroVendor = snap.numeroVendor;
      await saveContract(client, tenantId, contract, fields);
      // Apply the full revised detail (activities, budget postes, districts).
      if (Array.isArray(snap.activityIds)) await repo.setContractActivities(client, tenantId, id, snap.activityIds);
      if (Array.isArray(snap.items)) await repo.replaceBudget(client, tenantId, id, snap.items);
      if (Array.isArray(snap.areas)) await repo.replaceAreas(client, tenantId, id, snap.areas);
      await repo.addEvent(client, tenantId, 'ContratModifie', id, {
        contractId: id, tenantId, amendment: code, newDateFin: dateFin,
        newFeePct: snap.feePct ?? null,
      });
      modified = true;
    }
    await repo.addHistory(client, tenantId, id, {
      action: approve ? 'avenant_approuve' : 'avenant_rejete', actorId: actor.userId, comment, details: { code },
    });
  });
  if (modified) nudgeOutbox();
}

async function renew(tenantId, actor, id, { newDateFin, numeroFla }) {
  assertCanWrite(actor);
  return withTenantTransaction(tenantId, async (client) => {
    const contract = await loadForUpdate(client, tenantId, id);
    if (contract.status !== 'actif') throw conflict('Seul un contrat actif peut être renouvelé.');
    if (await repo.findRenewal(client, tenantId, id)) throw conflict('Ce contrat a déjà été renouvelé.');
    if (!d.renewalWindowOpen(contract.dateFin, today())) {
      throw conflict(`Renouvellement possible uniquement dans les ${d.RENEWAL_WINDOW_DAYS} jours avant l'échéance.`);
    }
    const dateDebut = d.addDays(contract.dateFin, 1);
    if (newDateFin <= dateDebut) throw badRequest(`La nouvelle date de fin doit être après le ${dateDebut}.`);

    const year = Number(today().slice(0, 4));
    const numero = d.contractNumber(year, await repo.nextSequence(client, tenantId, year));
    const activities = await repo.getContractActivities(client, tenantId, id);
    const items = await repo.getBudgetItems(client, tenantId, id);
    const newId = await repo.insertContract(client, tenantId, {
      numero, partnerId: contract.partnerId, partnerName: contract.partnerName, activityCodes: [],
      numeroFla: numeroFla || null, numeroPo: contract.numeroPo, numeroVendor: contract.numeroVendor,
      dateDebut, dateFin: newDateFin, createdBy: actor.userId, renewedFromId: id,
      managementFeePct: contract.managementFeePct, periodMonths: d.monthsBetween(dateDebut, newDateFin),
    });
    await repo.setContractActivities(client, tenantId, newId, activities.map((a) => a.id));
    await repo.replaceBudget(client, tenantId, newId, items);
    await repo.addHistory(client, tenantId, newId, { action: 'creation', actorId: actor.userId, details: { numero, renewedFrom: contract.numero } });
    await repo.addHistory(client, tenantId, id, { action: 'renouvellement', actorId: actor.userId, details: { newContract: numero } });
    return { id: newId, numero };
  });
}

async function terminate(tenantId, actor, id, { reason, effectiveDate, version }) {
  assertCanWrite(actor);
  await withTenantTransaction(tenantId, async (client) => {
    const contract = await loadForUpdate(client, tenantId, id);
    assertVersion(contract, version);
    const to = transition('terminate', contract);
    if (effectiveDate < contract.dateDebut || effectiveDate > contract.dateFin) {
      throw badRequest('La date d\'effet doit être comprise dans la période du contrat.');
    }
    await saveContract(client, tenantId, contract, { status: to, terminationReason: reason, terminationDate: effectiveDate });
    await repo.addHistory(client, tenantId, id, { action: 'resiliation', actorId: actor.userId, comment: reason, details: { effectiveDate } });
    await repo.addEvent(client, tenantId, 'ContratResilie', id, { contractId: id, tenantId, dateEffet: effectiveDate, motif: reason });
  });
  nudgeOutbox();
}

module.exports = {
  listContracts, listValidators, getContractDetail, getHistory, budgetWorkbook,
  createContract, updateDraft, submit, decide, requestAmendment, decideAmendment, renew, terminate,
  allowedActions,
};
