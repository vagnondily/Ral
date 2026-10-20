/**
 * Rôles d'un partenaire et TPM d'un contrat POUR L'AFFICHAGE (retour 113) — logique PURE, sans
 * I/O, testée (test/contractTpm.test.js). Une seule lecture des rôles pour tous les écrans
 * (Contrats, Partenaires & TPM, Consolidation, Reporting, tableau de bord) :
 *
 *  - Titulaire d'un contrat : le partenaire qui le signe (contracts.partner_id) — en général un
 *    PARTENAIRE DE MISE EN ŒUVRE (type « prestataire » en base, libellé « Partenaire de mise en
 *    œuvre ») ; parfois le TPM lui-même quand il a son propre contrat.
 *  - TPM (tierce partie de suivi) : partenaire de type « tpm ».
 *  - TPM d'un contrat : la règle commune (activeProvider.tpmsByContract / contractTpmOf — TPM ACTIFS
 *    rattachés par un plan de collecte ou une facture / un rapport), jamais réécrite ici. Quand
 *    aucun TPM n'est rattaché, la règle prend le titulaire : on le montre comme TPM s'il EST un
 *    TPM (« son propre contrat ») ; sinon le contrat n'a « aucun TPM rattaché » — on ne présente
 *    jamais un partenaire de mise en œuvre comme un TPM.
 */
const { tpmsByContract, contractTpmOf } = require('./activeProvider');

const ROLES = ['tpm', 'mise_en_oeuvre', 'autre'];
/** Rôle d'un partenaire d'après le code de son type. */
function roleOf(typeCode) {
  if (typeCode === 'tpm') return 'tpm';
  if (typeCode === 'prestataire') return 'mise_en_oeuvre';
  return 'autre';
}

/** États du TPM d'un contrat. */
const TPM_STATES = ['rattache', 'titulaire', 'aucun'];

/**
 * TPM de chaque contrat.
 * @param {Array<{ id, partnerId?, partnerName? }>} contracts  contrats à décrire
 * @param {object[]} links     liens prestataire ↔ contrat (activeProvider.repository.providerLinksTx, tout le compte)
 * @param {object[]} partners  partenaires (activeProvider.repository.partnersTx)
 * @returns {Map<string, { state: 'rattache'|'titulaire'|'aucun', tpms: Array<{ id, name, via: string[] }> }>}
 *   via : origines du rattachement ('plan', 'rapport' ; 'titulaire' pour un TPM titulaire).
 */
function contractTpmViews(contracts, links, partners) {
  const attached = tpmsByContract(links, partners);
  const byId = new Map((partners || []).map((p) => [p.id, p]));
  const viaOf = new Map();
  for (const l of links || []) {
    const via = (Array.isArray(l.via) ? l.via : [l.via]).filter((v) => v === 'plan' || v === 'rapport');
    if (via.length) viaOf.set(`${l.contractId}|${l.partnerId}`, via.sort());
  }
  const out = new Map();
  for (const c of contracts || []) {
    // Même règle que les listes de choix d'un TPM (activeProvider.contractTpmOf).
    const v = contractTpmOf(attached.get(c.id), c.partnerId ? byId.get(c.partnerId) : null);
    out.set(c.id, { state: v.state, tpms: v.tpms.map((t) => ({ id: t.id, name: t.name,
      via: v.state === 'titulaire' ? ['titulaire'] : (viaOf.get(`${c.id}|${t.id}`) || []) })) });
  }
  return out;
}

/**
 * Partenaires vus depuis leurs contrats : pour chacun, les contrats dont il est TITULAIRE et les
 * contrats qu'il SUIT comme TPM (même vue que contractTpmViews), avec les TPM de ses contrats.
 * @param {Array<{ id, numero, numeroFla?, partnerId, partnerName, status }>} contracts
 * @param {Map} views  contractTpmViews(...)
 * @returns {Map<string, { held: object[], monitored: object[], tpms: Array<{id, name}> }>}
 */
function partnerContracts(contracts, views) {
  const out = new Map();
  const entry = (id) => {
    if (!out.has(id)) out.set(id, { held: [], monitored: [], tpms: new Map() });
    return out.get(id);
  };
  const short = (c) => ({ id: c.id, numero: c.numero, numeroFla: c.numeroFla || null, status: c.status, holderId: c.partnerId || null, holderName: c.partnerName || null });
  for (const c of contracts || []) {
    const v = views.get(c.id) || { state: 'aucun', tpms: [] };
    if (c.partnerId) {
      const e = entry(c.partnerId);
      e.held.push(short(c));
      for (const t of v.tpms) if (t.id !== c.partnerId) e.tpms.set(t.id, { id: t.id, name: t.name });
    }
    // Chaque TPM du contrat le SUIT — y compris un TPM titulaire de son propre contrat, qu'il y soit
    // rattaché par son plan / sa facture (« rattaché ») ou seulement comme titulaire. contractTpmOf ne
    // rend jamais un partenaire de mise en œuvre : la liste ne contient que des TPM actifs.
    for (const t of v.tpms) entry(t.id).monitored.push(short(c));
  }
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'fr');
  return new Map([...out].map(([k, e]) => [k, { held: e.held, monitored: e.monitored, tpms: [...e.tpms.values()].sort(byName) }]));
}

/** N° affiché d'un contrat : le numéro FLA s'il existe, sinon le numéro interne (CTR-…). */
const contractNo = (c) => (c && (c.numeroFla || c.numero)) || null;

module.exports = { ROLES, TPM_STATES, roleOf, contractTpmViews, partnerContracts, contractNo };
