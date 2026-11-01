/**
 * Activités de programme (suivi de processus) › sous-activités — règles métier (migration 105).
 *
 * - Une saisie ne crée JAMAIS d'activité : seul le Paramétrage le fait ; ailleurs, un texte
 *   inconnu est refusé avec des propositions (resolveForWrite).
 * - Renommer ou changer le code garde l'ancienne clé comme alias : rien ne se détache.
 * - Supprimer : refusé dès qu'une donnée désigne l'activité (409, « Utilisé par » détaillé).
 * - Fusionner / ranger comme sous-activité / relier un libellé changent ce que désignent des
 *   textes existants : ces écritures prennent le verrou des rattachements (withSubmissionLinks)
 *   et ré-appliquent le rattachement des formulaires reçus à leurs sites (l'activité de la fiche
 *   délimite les sites candidats).
 * Le tenant vient toujours de req.auth (jamais du corps).
 */
const { withTenantTransaction } = require('../../config/db');
const { withSubmissionLinks, applySubmissionSitesTx } = require('../settings/placeMatch.repository');
const { badRequest, conflict, notFound } = require('../../middleware/errors');
const repo = require('./programmeActivities.repository');
const { activityKey, aliasKeyOf, cleanLabel, codeFromLabel, uniqueCode, CODE_RE } = require('./activityKey');
const {
  buildResolver, suggestActivities, unknownActivityMessage, unknownActivityDetails, subActivityMismatchMessage,
  usageSummary, usageText, isUsed, checkKeyFree, checkMerge, mergeInfo, mergeRefusalMessage,
} = require('./activityRef');

const BUCKET_REFUSED = '« À classer » est un rangement d\'attente : il ne se modifie pas.';

// ---- Lecture ---------------------------------------------------------------------------
/** Listes de saisie : activités (hors « À classer ») et leurs sous-activités. */
async function listForSelect(tenantId) {
  return withTenantTransaction(tenantId, (client) => repo.listForSelectTx(client, tenantId));
}

/**
 * Écran Paramétrage › Activités : activités avec « Utilisé par », alias (« aussi reconnu
 * sous »), sous-activités avec le nombre de sites qui portent leur code, « À classer » et
 * libellés non reconnus.
 */
async function referential(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { activities, aliases, subActivities } = await repo.loadResolverTx(client, tenantId);
    const { usage, unresolved } = await repo.usageTx(client, tenantId);
    const tags = await repo.tagUsageTx(client, tenantId);
    const counts = new Map(activities.map((a) => [a.id, {}]));
    for (const u of usage) {
      const c = counts.get(u.id);
      if (c) c[u.module] = (c[u.module] || 0) + u.n;
    }
    const subsOf = new Map(activities.map((a) => [a.id, []]));
    for (const s of subActivities) {
      const list = subsOf.get(s.programmeActivityId);
      if (list) list.push({ ...s, siteCount: tags.get(activityKey(s.code)) || 0 });
    }
    const aliasesOf = new Map(activities.map((a) => [a.id, []]));
    for (const al of aliases) {
      const list = aliasesOf.get(al.programmeActivityId);
      if (list) list.push({ key: al.aliasKey, source: al.source, label: al.label });
    }
    const out = activities.map((a) => {
      const c = counts.get(a.id);
      const subs = subsOf.get(a.id);
      const ownKeys = new Set([aliasKeyOf(a.label), aliasKeyOf(a.code)]);
      return {
        ...a,
        usage: { sites: c.sites || 0, mmr: c.mmr || 0, forms: c.forms || 0, visits: c.visits || 0, pdd: c.pdd || 0 },
        subActivities: subs,
        // « Aussi reconnu sous » : anciens libellés, graphies et codes reliés (hors libellé et code actuels).
        aliases: aliasesOf.get(a.id).filter((al) => !ownKeys.has(al.key)),
      };
    });
    // Libellés non reconnus, regroupés par clé (graphie la plus fréquente), comptes par module.
    const byKey = new Map();
    for (const u of unresolved) {
      const g = byKey.get(u.key) || { key: u.key, label: u.label, best: 0, usage: {} };
      g.usage[u.module] = (g.usage[u.module] || 0) + u.n;
      if (u.n > g.best) { g.best = u.n; g.label = u.label; }
      byKey.set(u.key, g);
    }
    return {
      activities: out,
      unresolved: [...byKey.values()].map((g) => ({ key: g.key, label: g.label, usage: g.usage })).sort((x, y) => x.label.localeCompare(y.label, 'fr')),
    };
  });
}

// ---- Résolution pour les écritures des autres modules ------------------------------------
/**
 * Résolveur du compte, dans la transaction de l'écriture (bornée : quelques dizaines de lignes).
 * @returns {Promise<ReturnType<typeof buildResolver>>}
 */
async function resolverTx(client, tenantId) {
  return buildResolver(await repo.loadResolverTx(client, tenantId));
}

/**
 * Activité de programme d'une saisie : libellé officiel à enregistrer, ou 400 avec propositions.
 * Vide → null (pas d'activité) quand `optional`, sinon 400.
 * @returns {Promise<{ id, label, code } | null>}
 */
async function resolveForWrite(client, tenantId, text, { optional = true, resolver = null } = {}) {
  if (text == null || cleanLabel(text) === '') {
    if (optional) return null;
    throw badRequest('Activité requise : choisissez-la dans la liste (Paramétrage › Activités).', { code: 'activity_required' });
  }
  const r = resolver || await resolverTx(client, tenantId);
  const a = r.resolve(text);
  if (!a) {
    const suggestions = suggestActivities(text, r);
    throw badRequest(unknownActivityMessage(text, suggestions), unknownActivityDetails(text, suggestions));
  }
  return { id: a.id, label: a.label, code: a.code };
}

/**
 * Sous-activité (Activity_tag) d'un site : code connu, et cohérent avec l'activité choisie (une
 * sous-activité encore « À classer » est acceptée). Vide → null.
 * @param {{ id, label }|null} activity  activité résolue du site
 * @returns {{ code, label, programmeActivityId } | null}
 */
function resolveSubForWrite(resolver, code, activity) {
  if (code == null || cleanLabel(code) === '') return null;
  const sub = resolver.resolveSub(code);
  if (!sub) {
    throw badRequest(`Sous-activité inconnue « ${cleanLabel(code).slice(0, 60)} ». Créez-la dans Paramétrage › Activités.`,
      { code: 'unknown_sub_activity', value: cleanLabel(code).slice(0, 60) });
  }
  const owner = resolver.byId.get(sub.programmeActivityId); // undefined = « À classer »
  if (activity && owner && owner.id !== activity.id) {
    throw badRequest(subActivityMismatchMessage(sub.code, activity.label, owner.label),
      { code: 'sub_activity_mismatch', value: sub.code, activity: activity.label, owner: owner.label });
  }
  return { code: sub.code, label: sub.label, programmeActivityId: sub.programmeActivityId };
}

// ---- Écritures du référentiel ------------------------------------------------------------
const takenMessage = (what, text, owner) => `${what} « ${cleanLabel(text)} » désigne déjà l'activité « ${owner.label} »${
  aliasKeyOf(owner.label) === aliasKeyOf(text) ? '' : ' (ancien libellé, code ou graphie reliée)'}.`;

/** Clé libre, ou 409 qui nomme l'activité qui la porte. */
async function assertKeyFree(client, tenantId, text, selfId, what) {
  const key = aliasKeyOf(text);
  const ownerId = key ? await repo.aliasOwnerTx(client, tenantId, key) : null;
  const check = checkKeyFree(text, ownerId, selfId);
  if (check.ok) return check.key;
  if (check.reason === 'empty') throw badRequest(`${what} : au moins une lettre ou un chiffre.`);
  const owner = await repo.activityByIdTx(client, tenantId, ownerId);
  throw conflict(takenMessage(what, text, owner || { label: '?' }), { code: 'key_taken', ownerId });
}

/** Crée une activité de programme (code proposé depuis le libellé s'il est omis). */
async function createActivity(tenantId, input, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    const label = cleanLabel(input.label);
    const code = input.code ? input.code.trim() : uniqueCode(codeFromLabel(label), await repo.activityCodesTx(client, tenantId));
    if (!CODE_RE.test(code)) throw badRequest('Code : lettre ou chiffre en tête, puis lettres, chiffres, « . », « _ » ou « - » (30 au plus).');
    const labelKey = await assertKeyFree(client, tenantId, label, null, 'Le libellé');
    const codeKey = await assertKeyFree(client, tenantId, code, null, 'Le code');
    const id = await repo.insertActivityTx(client, tenantId, { ...input, label, code }, userId);
    await repo.addAliasTx(client, tenantId, { key: labelKey, activityId: id, source: 'libelle', label }, userId);
    await repo.addAliasTx(client, tenantId, { key: codeKey, activityId: id, source: 'code', label: code }, userId);
    return { id, code, label };
  });
}

/**
 * Modifie une activité. Nouveau libellé ou nouveau code : la clé ne doit désigner aucune autre
 * activité ; l'ancienne reste un alias (les données qui l'écrivent restent rattachées).
 */
async function updateActivity(tenantId, id, patch, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    const cur = (await repo.lockActivitiesTx(client, tenantId, [id])).get(id);
    if (!cur) throw notFound('Activité de programme introuvable');
    if (cur.bucket) throw badRequest(BUCKET_REFUSED);
    const next = { ...patch };
    if (next.label !== undefined) {
      next.label = cleanLabel(next.label);
      if (aliasKeyOf(next.label) !== aliasKeyOf(cur.label)) {
        const key = await assertKeyFree(client, tenantId, next.label, id, 'Le libellé');
        await repo.addAliasTx(client, tenantId, { key, activityId: id, source: 'libelle', label: next.label }, userId);
      }
    }
    if (next.code !== undefined && next.code !== cur.code) {
      if (!CODE_RE.test(next.code)) throw badRequest('Code : lettre ou chiffre en tête, puis lettres, chiffres, « . », « _ » ou « - » (30 au plus).');
      if (aliasKeyOf(next.code) !== aliasKeyOf(cur.code)) {
        const key = await assertKeyFree(client, tenantId, next.code, id, 'Le code');
        await repo.addAliasTx(client, tenantId, { key, activityId: id, source: 'code', label: next.code }, userId);
      }
    }
    await repo.updateActivityTx(client, tenantId, id, next);
    return { id };
  });
}

/** Supprime une activité que rien ne désigne ; sinon 409 avec « Utilisé par ». */
async function deleteActivity(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const cur = (await repo.lockActivitiesTx(client, tenantId, [id])).get(id);
    if (!cur) throw notFound('Activité de programme introuvable');
    const counts = await repo.activityUsageTx(client, tenantId, id);
    if (isUsed(counts)) {
      const linked = usageSummary(counts);
      const hint = cur.bucket ? 'Rangez d\'abord ses sous-activités sous une activité.'
        : 'Fusionnez-la dans une autre activité (ses libellés la suivent), ou désactivez-la.';
      throw conflict(`Cette activité est utilisée (${usageText(linked)}) : suppression impossible. ${hint}`, { reason: 'linked_data', linked });
    }
    await repo.deleteActivityTx(client, tenantId, id);
    return { deleted: true };
  });
}

/** Contrôles d'une fusion, dans la transaction (lignes verrouillées). */
async function checkedMergeTx(client, tenantId, sourceId, targetId) {
  const locked = await repo.lockActivitiesTx(client, tenantId, [sourceId, targetId]);
  const source = locked.get(sourceId) || null; const target = locked.get(targetId) || null;
  const mmr = source && target ? await repo.mmrScopesTx(client, tenantId, [sourceId, targetId]) : [];
  const check = checkMerge({ source, target, mmr });
  if (!check.ok) {
    if (check.reason === 'missing') throw notFound('Activité de programme introuvable');
    const names = check.scopes ? await repo.officeNamesTx(client, tenantId, check.scopes.filter(Boolean)) : new Map();
    throw (check.reason === 'mmr_conflict' ? conflict : badRequest)(
      mergeRefusalMessage(check, { sourceLabel: source.label, targetLabel: target.label, officeName: (s) => names.get(s) || s }),
      { code: check.reason, scopes: check.scopes });
  }
  return { source, target };
}

/**
 * Fusionne `sourceId` dans `targetId` : les textes qui désignaient la source désignent la cible,
 * ses sous-activités la suivent ; aucune donnée n'est réécrite.
 */
async function mergeActivities(tenantId, sourceId, targetId) {
  return withSubmissionLinks(tenantId, async (client) => {
    const { source, target } = await checkedMergeTx(client, tenantId, sourceId, targetId);
    const moved = await repo.mergeActivitiesTx(client, tenantId, sourceId, targetId, mergeInfo(target, source));
    const relinked = await applySubmissionSitesTx(client, tenantId);
    return { merged: true, targetId, moved, relinked };
  });
}

/**
 * « Ranger comme sous-activité de… » : une activité saisie au mauvais niveau (« GD » écrit comme
 * activité de programme) devient une sous-activité de la cible. Fusion (ses textes désignent la
 * cible) + sous-activité de ce code sous la cible (créée, ou déplacée depuis « À classer »).
 */
async function convertToSubActivity(tenantId, sourceId, targetId, { code, label } = {}) {
  return withSubmissionLinks(tenantId, async (client) => {
    const { source, target } = await checkedMergeTx(client, tenantId, sourceId, targetId);
    const subCode = cleanLabel(code || source.code);
    if (!aliasKeyOf(subCode) || subCode.length > 60) throw badRequest('Code de sous-activité invalide (1 à 60 caractères, dont une lettre ou un chiffre).');
    const existing = await repo.subActivityByCodeTx(client, tenantId, subCode);
    let subActivity;
    if (existing) {
      const owner = (await repo.lockActivitiesTx(client, tenantId, [existing.programmeActivityId])).get(existing.programmeActivityId);
      if (owner && !owner.bucket && owner.id !== targetId && owner.id !== sourceId) {
        throw conflict(`La sous-activité « ${existing.code} » appartient déjà à « ${owner.label} ».`, { code: 'sub_activity_owned', owner: owner.label });
      }
      await repo.moveSubActivityTx(client, tenantId, existing.id, targetId);
      subActivity = { id: existing.id, code: existing.code, created: false };
    } else {
      const id = await repo.insertSubActivityTx(client, tenantId,
        { programmeActivityId: targetId, code: subCode, label: cleanLabel(label || source.label).slice(0, 160), info: source.description });
      subActivity = { id, code: subCode, created: true };
    }
    const moved = await repo.mergeActivitiesTx(client, tenantId, sourceId, targetId, mergeInfo(target, {}));
    const relinked = await applySubmissionSitesTx(client, tenantId);
    return { converted: true, targetId, subActivity, moved, relinked };
  });
}

/** Relie un libellé non reconnu (ou une graphie) à une activité : alias « manuel ». */
async function linkLabel(tenantId, { label, programmeActivityId }, userId) {
  return withSubmissionLinks(tenantId, async (client) => {
    const target = (await repo.lockActivitiesTx(client, tenantId, [programmeActivityId])).get(programmeActivityId);
    if (!target) throw notFound('Activité de programme introuvable');
    if (target.bucket) throw badRequest(BUCKET_REFUSED);
    const key = await assertKeyFree(client, tenantId, label, programmeActivityId, 'Le libellé');
    const added = await repo.addAliasTx(client, tenantId, { key, activityId: programmeActivityId, source: 'manuel', label: cleanLabel(label) }, userId);
    const relinked = await applySubmissionSitesTx(client, tenantId);
    return { linked: added > 0, key, relinked };
  });
}

/**
 * Retire un alias (graphie reliée par erreur, ancien libellé devenu inutile) — jamais le libellé
 * ni le code actuels, jamais une clé encore écrite dans des données (elles se détacheraient).
 */
async function unlinkAlias(tenantId, programmeActivityId, key) {
  return withSubmissionLinks(tenantId, async (client) => {
    const cur = (await repo.lockActivitiesTx(client, tenantId, [programmeActivityId])).get(programmeActivityId);
    if (!cur) throw notFound('Activité de programme introuvable');
    const alias = await repo.aliasRowTx(client, tenantId, programmeActivityId, key);
    if (!alias) throw notFound('Libellé introuvable pour cette activité');
    if (key === aliasKeyOf(cur.label) || key === aliasKeyOf(cur.code)) {
      throw badRequest('Le libellé et le code actuels d\'une activité restent toujours reconnus.');
    }
    const counts = await repo.keyUsageTx(client, tenantId, key);
    if (isUsed(counts)) {
      const linked = usageSummary(counts);
      throw conflict(`Ce libellé est encore écrit dans des données (${usageText(linked)}) : le retirer les détacherait.`, { reason: 'linked_data', linked });
    }
    await repo.deleteAliasTx(client, tenantId, key);
    return { removed: true };
  });
}

/** Reprend les libellés encore inconnus (une activité « reprise » par clé), sans rien réécrire. */
async function reprise(tenantId) {
  return withSubmissionLinks(tenantId, async (client) => {
    const r = await repo.repriseTx(client, tenantId);
    const relinked = await applySubmissionSitesTx(client, tenantId);
    return { ...r, relinked };
  });
}

module.exports = {
  listForSelect, referential, resolverTx, resolveForWrite, resolveSubForWrite,
  createActivity, updateActivity, deleteActivity, mergeActivities, convertToSubActivity, linkLabel, unlinkAlias, reprise,
};
