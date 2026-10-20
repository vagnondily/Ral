/**
 * « Prestataire actif » (retour 30) — LA règle commune, PURE (aucune I/O), testée
 * (test/activeProvider.test.js). Jumelle SQL : activeProviderSql.js (mêmes règles,
 * pour filtrer dans une requête).
 *
 * Définitions (docs/PLAN_RETOURS_15_37.md, précisées par docs/SPEC_RETOUR_58.md § 3) :
 *
 *  - Contrat de SUIVI : contrat dont la ligne « IV.suivi » est > 0 (même expression que
 *    la Consolidation, MONITORING_LINE). Le booléen `monitoring` est calculé en SQL.
 *  - Contrat qui COUVRE le mois M (« AAAA-MM ») :
 *      • « actif »   et mois(début) ≤ M ≤ mois(fin) ;
 *      • « résilié » et mois(début) ≤ M ≤ mois(résiliation).
 *    Un mois entamé compte. Les dates décident : un contrat échu mais encore « actif »
 *    ne couvre plus le mois. Brouillon, en validation et rejeté ne couvrent jamais. Un
 *    avenant ne compte qu'une fois approuvé (il réécrit alors les dates du contrat).
 *  - Contrats d'un PRESTATAIRE (question D1 de la spec 58, encore ouverte) : ceux dont il
 *    est le titulaire (contracts.partner_id) ET ceux auxquels il est rattaché par ses
 *    plans de collecte, ses rapports / factures ou ses visites (contract_id). Un TPM qui
 *    facture sur le contrat d'un autre partenaire y est donc rattaché (constat du
 *    13/10 : la fiche 360° ne trouvait pas son contrat).
 *  - Prestataire ACTIF au mois M : fiche active, et au moins un de ses contrats de suivi
 *    couvre M.
 *  - TPM d'un CONTRAT (retours 58, 113 et 115 — décision D1 du 20/10, `contractTpmOf`) : les
 *    partenaires ACTIFS de type TPM rattachés par un plan de collecte ou une facture / un rapport
 *    (`tpmsByContract`) ; à défaut, son titulaire SEULEMENT s'il est lui-même un TPM actif ; sinon
 *    le contrat n'a pas de TPM (suivi interne par l'équipe S&E : « Interne »). Un partenaire de mise
 *    en œuvre n'est jamais le TPM d'un contrat — ni à l'affichage, ni dans les listes de choix, ni
 *    dans l'estampille des visites (tpmAttribution.contractTpms et sa jumelle SQL mems_tpm_cells,
 *    retour 114).
 *  - SÉLECTIONNABLE pour des mois (listes de choix d'un TPM) : d'abord les TPM d'un contrat de
 *    suivi qui couvre un des mois (groupe « contrat »), puis les autres partenaires actifs de type
 *    TPM (groupe « tpm », à part, choix hors contrat).
 *
 * Utilisée par les listes de choix d'un TPM (participants d'une formation, rapports attendus,
 * dialogues d'affectation des TPM), par le statut contractuel de la liste et de la fiche d'un
 * partenaire (providerStatus), et exposée aux autres écrans (GET /api/partners/selectable).
 */
const { daysBetween, RENEWAL_WINDOW_DAYS } = require('../contracts/contracts.domain');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const isMonth = (m) => typeof m === 'string' && MONTH_RE.test(m);
const monthOf = (d) => (d ? String(d).slice(0, 7) : null);
/** Statuts qui peuvent couvrir un mois ; la colonne qui en donne la fin. */
const COVERING_STATUS = { actif: 'dateFin', resilie: 'terminationDate' };
const LINK_KINDS = ['titulaire', 'plan', 'rapport', 'visite'];

/**
 * Mois couverts par un contrat : { from, to } (« AAAA-MM »), ou null s'il n'en couvre aucun.
 * @param {{ status: string, dateDebut: string, dateFin: string, terminationDate?: string|null }} c
 */
function coverageOf(c) {
  if (!c || !COVERING_STATUS[c.status]) return null;
  const from = monthOf(c.dateDebut);
  const to = monthOf(c[COVERING_STATUS[c.status]]);
  if (!isMonth(from) || !isMonth(to) || to < from) return null;
  return { from, to };
}

/** Le contrat couvre-t-il le mois M ? (dates et statut seulement ; voir isMonitoringContract) */
function contractCoversMonth(c, m) {
  if (!isMonth(m)) return false;
  const cov = coverageOf(c);
  return !!cov && cov.from <= m && m <= cov.to;
}

/** Contrat de suivi (ligne IV.suivi > 0, booléen calculé en SQL). */
const isMonitoringContract = (c) => !!c && c.monitoring === true;

/** Le TPM d'un lien prestataire ↔ contrat : seul endroit qui dépend de la question D1. */
const linkProvider = (link) => link.partnerId || null;

/** Liens de la règle commune qui désignent le TPM d'un contrat (jamais « visite » : elle en découle). */
const TPM_LINK_KINDS = ['plan', 'rapport'];
const viaOf = (l) => (Array.isArray(l.via) ? l.via : [l.via]);

/**
 * TPM rattachés à chaque contrat, d'après les liens de la règle commune (activeProvider.repository
 * .providerLinksTx) : partenaires ACTIFS de type TPM liés par un plan de collecte ou un rapport /
 * une facture. @returns {Map<string, {id, name}[]>} contractId → TPM (ordre du nom).
 */
function tpmsByContract(links, partners) {
  const byId = new Map((partners || []).map((p) => [p.id, p]));
  const out = new Map();
  for (const l of links || []) {
    const p = byId.get(l.partnerId);
    if (!p || p.active === false || p.typeCode !== 'tpm' || !viaOf(l).some((v) => TPM_LINK_KINDS.includes(v))) continue;
    if (!out.has(l.contractId)) out.set(l.contractId, new Map());
    out.get(l.contractId).set(p.id, { id: p.id, name: p.name });
  }
  return new Map([...out].map(([k, m]) => [k, [...m.values()].sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id))]));
}

/**
 * TPM d'UN contrat — LA règle des écrans ET des listes de choix (retours 113 et 115, décision D1) :
 * ses TPM rattachés ; sinon son titulaire s'il est un TPM actif ; sinon aucun (suivi interne). Un
 * partenaire de mise en œuvre n'est jamais le TPM d'un contrat.
 * @param {{id,name}[]} attached  tpmsByContract(...).get(contractId)
 * @param {{id,name,typeCode,active}|null} holder  fiche du titulaire
 * @returns {{ state: 'rattache'|'titulaire'|'aucun', tpms: {id,name}[] }}
 */
function contractTpmOf(attached, holder) {
  if (attached && attached.length) return { state: 'rattache', tpms: attached };
  if (holder && holder.typeCode === 'tpm' && holder.active !== false) return { state: 'titulaire', tpms: [{ id: holder.id, name: holder.name }] };
  return { state: 'aucun', tpms: [] };
}

/**
 * TPM proposé par défaut pour chaque contrat de suivi (formulaires plan de collecte et facture :
 * GET /api/tpm/attribution/providers → `contractTpms`) — décision D1 : contractTpmOf, jamais un
 * titulaire partenaire de mise en œuvre (sinon le formulaire pré-remplirait AINA comme TPM).
 * @param {Array<{ id, partnerId, monitoring, tpms: {id,name}[] }>} contracts  tpmAttribution.repository.loadInputsTx
 * @param {object[]} partners
 * @returns {Object<string, {id,name}[]>}
 */
function pickerContractTpms(contracts, partners) {
  const byId = new Map((partners || []).map((p) => [p.id, p]));
  return Object.fromEntries((contracts || []).filter(isMonitoringContract)
    .map((c) => [c.id, contractTpmOf(c.tpms, byId.get(c.partnerId) || null).tpms.map((t) => ({ id: t.id, name: t.name }))]));
}

/**
 * TPM de chaque contrat pour les LISTES DE CHOIX : la même règle que l'affichage (contractTpmOf —
 * décision D1 : un titulaire ne compte que s'il est lui-même un TPM actif), la même que
 * tpmAttribution.contractTpms (estampille des visites, retour 114).
 * @returns {Map<string, Set<string>>} contractId → identifiants ; titulaire lu sur les liens.
 */
function tpmIdsByContract(links, partners) {
  const attached = tpmsByContract(links, partners);
  const byId = new Map((partners || []).map((p) => [p.id, p]));
  const holderOf = new Map();
  for (const l of links || []) {
    const h = l.holderId || (viaOf(l).includes('titulaire') ? l.partnerId : null);
    if (h && !holderOf.has(l.contractId)) holderOf.set(l.contractId, h);
  }
  const ids = new Set((links || []).map((l) => l.contractId));
  return new Map([...ids].map((k) => [k, new Set(contractTpmOf(attached.get(k), byId.get(holderOf.get(k)) || null).tpms.map((t) => t.id))]));
}

/**
 * Liens d'un prestataire qui comptent pour la règle : contrats de suivi, prestataire connu.
 * @param {object[]} links  { partnerId, contractId, numero, status, dateDebut, dateFin, terminationDate, monitoring, via: string[] }
 */
const countingLinks = (links) => (links || []).filter((l) => linkProvider(l) && isMonitoringContract(l));

/**
 * Prestataires actifs au mois M (fiche active + au moins un contrat de suivi couvrant M).
 * @returns {Array<{ id, name, shortName, typeCode, contracts: Array<{ id, numero, via, from, to }> }>}
 */
function activeProviders({ links, partners, month }) {
  if (!isMonth(month)) return [];
  const byPartner = new Map();
  for (const l of countingLinks(links)) {
    if (!contractCoversMonth(l, month)) continue;
    const id = linkProvider(l);
    if (!byPartner.has(id)) byPartner.set(id, new Map());
    byPartner.get(id).set(l.contractId, contractRef(l));
  }
  return sortByName((partners || [])
    .filter((p) => p.active !== false && byPartner.has(p.id))
    .map((p) => ({ ...partnerRef(p), contracts: sortContracts([...byPartner.get(p.id).values()]) })));
}

/**
 * Listes de choix d'un ensemble de mois (« du … au … ») :
 *  - groupe « contrat » : prestataires actifs pendant au moins un des mois, avec les mois
 *    où ils le sont et leurs contrats couvrants ;
 *  - groupe « tpm » : les autres partenaires actifs de type TPM (les choisir reste
 *    possible, c'est un choix hors contrat).
 * Dédoublonné, ordre stable (nom, puis identifiant).
 * @param {{ links: object[], partners: object[], months: string[] }} input
 */
function selectableProviders({ links, partners, months }) {
  const ms = [...new Set((months || []).filter(isMonth))].sort();
  const covered = new Map(); // partnerId → { months:Set, contracts:Map }
  // Groupe « contrat » : seulement les TPM du contrat (tpmIdsByContract, décision D1) — jamais un
  // partenaire de mise en œuvre titulaire (AINA, MIARO, TOHANA), avec ou sans TPM rattaché.
  const tpmIds = tpmIdsByContract(links, partners);
  for (const l of countingLinks(links)) {
    if (!(tpmIds.get(l.contractId) || new Set()).has(linkProvider(l))) continue;
    const cov = coverageOf(l);
    if (!cov) continue;
    const inside = ms.filter((m) => cov.from <= m && m <= cov.to);
    if (!inside.length) continue;
    const id = linkProvider(l);
    if (!covered.has(id)) covered.set(id, { months: new Set(), contracts: new Map() });
    const e = covered.get(id);
    inside.forEach((m) => e.months.add(m));
    e.contracts.set(l.contractId, contractRef(l));
  }
  const usable = (partners || []).filter((p) => p.active !== false);
  const contrat = sortByName(usable.filter((p) => covered.has(p.id)).map((p) => ({
    ...partnerRef(p),
    months: [...covered.get(p.id).months].sort(),
    contracts: sortContracts([...covered.get(p.id).contracts.values()]),
  })));
  const tpm = sortByName(usable.filter((p) => !covered.has(p.id) && p.typeCode === 'tpm').map((p) => ({ ...partnerRef(p), months: [], contracts: [] })));
  return { months: ms, groups: [{ key: 'contrat', providers: contrat }, { key: 'tpm', providers: tpm }] };
}

/**
 * Statut d'un prestataire à une date (en-tête de la fiche, liste des prestataires) :
 *  - 'actif'   : un contrat de suivi couvre le mois ; période = de la plus ancienne date de
 *                début à la plus lointaine fin des contrats couvrants ; `endingSoon` si la
 *                fin tombe dans la fenêtre de renouvellement (90 jours, comme les contrats) ;
 *  - 'a_venir' : aucun ne couvre le mois mais un contrat commence plus tard ;
 *  - 'echu'    : seuls des contrats terminés (période du dernier) ;
 *  - 'aucun'   : aucun contrat de suivi rattaché.
 * @param {object[]} links  liens du prestataire (voir countingLinks)
 * @param {string} today    « AAAA-MM-JJ »
 */
function providerStatus(links, today) {
  const month = monthOf(today);
  const mine = countingLinks(links).map((l) => ({ l, cov: coverageOf(l) })).filter((x) => x.cov);
  if (!mine.length) return { state: 'aucun', contracts: [] };
  const covering = mine.filter((x) => x.cov.from <= month && month <= x.cov.to);
  const pick = (list, state) => {
    const ends = list.map((x) => endDate(x.l)).sort();
    const starts = list.map((x) => x.l.dateDebut).sort();
    const end = ends[ends.length - 1];
    const out = { state, from: starts[0], to: end, contracts: sortContracts(list.map((x) => contractRef(x.l))) };
    if (state === 'actif') {
      out.daysLeft = daysBetween(today, end);
      out.endingSoon = out.daysLeft <= RENEWAL_WINDOW_DAYS;
    }
    return out;
  };
  if (covering.length) return pick(covering, 'actif');
  const future = mine.filter((x) => x.cov.from > month).sort((a, b) => (a.l.dateDebut < b.l.dateDebut ? -1 : 1));
  if (future.length) return pick([future[0]], 'a_venir');
  const past = mine.slice().sort((a, b) => (endDate(a.l) < endDate(b.l) ? 1 : -1));
  return pick([past[0]], 'echu');
}

// ---- utilitaires --------------------------------------------------------------------
const endDate = (l) => (l.status === 'resilie' ? l.terminationDate : l.dateFin);
const partnerRef = (p) => ({ id: p.id, name: p.name, shortName: p.shortName || null, typeCode: p.typeCode || null });
function contractRef(l) {
  const cov = coverageOf(l);
  return {
    // n° FLA à côté du numéro interne (retour 113 : un contrat s'affiche « n° FLA · titulaire »).
    id: l.contractId, numero: l.numero, numeroFla: l.numeroFla || null, status: l.status,
    via: (Array.isArray(l.via) ? l.via : [l.via]).filter((v) => LINK_KINDS.includes(v)).sort((a, b) => LINK_KINDS.indexOf(a) - LINK_KINDS.indexOf(b)),
    from: cov ? cov.from : null, to: cov ? cov.to : null,
  };
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortByName = (list) => list.sort((a, b) => cmp(String(a.name).toLowerCase(), String(b.name).toLowerCase()) || cmp(a.id, b.id));
const sortContracts = (list) => list.sort((a, b) => cmp(a.numero, b.numero) || cmp(a.id, b.id));

/** Mois « AAAA-MM » d'une plage (bornée : 60 mois au plus). */
function monthsOf(from, to, cap = 60) {
  if (!isMonth(from) || !isMonth(to) || to < from) return [];
  const out = [];
  let [y, m] = from.split('-').map(Number);
  while (out.length < cap) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    out.push(k);
    if (k === to) break;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

module.exports = {
  LINK_KINDS, TPM_LINK_KINDS, isMonth, coverageOf, contractCoversMonth, isMonitoringContract, linkProvider,
  tpmsByContract, contractTpmOf, tpmIdsByContract, pickerContractTpms, activeProviders, selectableProviders, providerStatus, monthsOf,
};
