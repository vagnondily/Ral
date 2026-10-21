/**
 * Fiche partenaire 360° — logique PURE (testée, sans I/O) : en-tête (statut « actif selon
 * contrat »), faits clés, contrats et récapitulatif budgétaire, zones d'intervention calculées
 * et frise du parcours. Les montants suivent la définition unique du Réalisé (tpm/realised.js :
 * factures validées) et la ligne de suivi IV.suivi, comme la Consolidation ; ils arrivent en
 * CENTIMES entiers (sommes SQL) et ne sont convertis qu'à la fin. Un fait qu'on ne sait pas
 * mesurer est renvoyé null (« — » à l'écran), jamais 0.
 */
const { pathKey } = require('../common/placeMatch');
const { providerStatus, coverageOf, contractCoversMonth } = require('../tpm/activeProvider');
const { roleOf, partnerContracts } = require('../tpm/contractTpm');

const ratio = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const cents = (v) => (v == null ? 0 : Math.round(Number(v)));
const ar = (c) => c / 100;

/**
 * Lignes « contrat » du prestataire : chiffres du contrat (total de l'accord = direct +
 * commission, comme contracts.domain.grandTotal ; ligne de suivi) et part du prestataire.
 * La consommation du contrat (tous prestataires) reprend la Consolidation quand le contrat y
 * figure (contrat de suivi actif : même Réalisé, mêmes restants et projection), sinon les
 * sommes SQL faites avec les mêmes définitions.
 * @param {object[]} figures  partners.repository.contractFiguresTx
 * @param {object[]} links    liens du prestataire (activeProvider.repository.providerLinksTx)
 * TPM du contrat (retour 113) : vue de la règle commune (tpm/contractTpm.contractTpmViews) ; rôle du
 * titulaire d'après le type de sa fiche.
 * @param {{ partnerId: string, month: string, consolidation?: Map<string, object>, tpmViews?: Map, partnerTypes?: Map }} ctx
 */
function contractRows(figures, links, { partnerId, month, consolidation = new Map(), tpmViews = new Map(), partnerTypes = new Map() }) {
  const linkOf = new Map((links || []).map((l) => [l.contractId, l]));
  return (figures || []).map((f) => {
    const direct = cents(f.directCents);
    const grand = direct + Math.round(direct * (Number(f.feePct) || 0));
    const monitoring = cents(f.monitoringCents);
    const cons = consolidation.get(f.id) || null;
    const contractActual = cons ? Math.round(Number(cons.actual) * 100) : cents(f.contractActualCents);
    const link = linkOf.get(f.id) || {};
    const cov = coverageOf(f);
    return {
      id: f.id, numero: f.numero, numeroFla: f.numeroFla || null, status: f.status, holderId: f.holderId || null, holderName: f.holderName,
      holderRole: f.holderId ? roleOf(partnerTypes.get(f.holderId)) : null,
      tpm: tpmViews.get(f.id) || { state: 'aucun', tpms: [] },
      isHolder: f.holderId === partnerId, via: link.via || [], monitoring: link.monitoring === true,
      dateDebut: f.dateDebut, dateFin: f.dateFin, terminationDate: f.terminationDate || null,
      coverage: cov, coversMonth: contractCoversMonth(f, month),
      total: ar(grand), monitoringBudget: ar(monitoring),
      providerActual: ar(cents(f.providerActualCents)), providerPending: ar(cents(f.providerPendingCents)),
      providerPlanned: ar(cents(f.providerPlannedCents)),
      contractActual: ar(contractActual), consumption: ratio(contractActual, monitoring),
      remaining: monitoring ? ar(monitoring - contractActual) : null,
      monthsRemaining: cons ? cons.monthsRemaining : null,
      projectedOverrun: cons ? cons.projectedOverrun : null,
    };
  });
}

/**
 * Récapitulatif budgétaire (Vue d'ensemble) : sommes des contrats du prestataire, en
 * centimes, puis converties. Ne compte que les contrats de suivi (ligne IV.suivi > 0) pour la
 * consommation ; `contracts` = nombre de contrats rattachés.
 */
function budgetRecap(rows) {
  const sum = (k, list) => list.reduce((s, r) => s + Math.round(Number(r[k] || 0) * 100), 0);
  const mon = (rows || []).filter((r) => r.monitoring);
  const budget = sum('monitoringBudget', mon);
  const contractActual = sum('contractActual', mon);
  return {
    contracts: (rows || []).length, monitoringContracts: mon.length,
    total: ar(sum('total', rows || [])), monitoringBudget: ar(budget),
    providerActual: ar(sum('providerActual', rows || [])), providerPending: ar(sum('providerPending', rows || [])),
    providerPlanned: ar(sum('providerPlanned', rows || [])),
    contractActual: ar(contractActual), consumption: ratio(contractActual, budget),
    providerShare: ratio(sum('providerActual', mon), budget),
  };
}

/**
 * Lignes de la liste des prestataires : compteurs SQL + statut selon contrat (règle commune
 * activeProvider.providerStatus) ; la note est celle de la dernière évaluation VALIDÉE.
 * Rôle (retour 113) : « tpm », « mise_en_oeuvre » ou « autre » (type de la fiche) ; contrats ACTIFS
 * tenus comme titulaire, contrats ACTIFS suivis comme TPM, et TPM des contrats d'un titulaire.
 * @param {object[]} rows   partners.repository.providersList().rows
 * @param {object[]} links  liens prestataire ↔ contrat de tout le compte
 * @param {{ contracts?: object[], views?: Map }} [ctx]  contrats actifs et leur TPM (contractTpm)
 */
function providerListRows(rows, links, { contracts = [], views = new Map() } = {}) {
  const byPartner = new Map();
  for (const l of links || []) {
    if (!byPartner.has(l.partnerId)) byPartner.set(l.partnerId, []);
    byPartner.get(l.partnerId).push(l);
  }
  const roles = partnerContracts(contracts, views);
  const none = { held: [], monitored: [], tpms: [] };
  return (rows || []).map(({ today, ...r }) => {
    const pc = roles.get(r.id) || none;
    return {
      ...r, role: roleOf(r.typeCode), lastScore: r.lastScore == null ? null : Number(r.lastScore),
      status: providerStatus(byPartner.get(r.id) || [], today),
      heldContracts: pc.held, monitoredContracts: pc.monitored, tpms: pc.tpms,
    };
  });
}

/**
 * Rapports par statut et par nature : { financier: { soumis: n, … }, technique: {…}, total, toValidate,
 * expected, late, rejected }. Soumis / Validé / Rejeté : documents enregistrés. Factures « Attendu » et
 * « En retard » : les RAPPORTS ATTENDUS de ce TPM (`live`, expectedCountsOf — la même source que la carte
 * et les alertes ; relecture croisée, point 4) quand ils sont connus, sinon les gabarits enregistrés.
 * `total` compte toujours les documents enregistrés (onglet Rapports).
 */
function reportSummary(rows, live = null) {
  const out = { financier: {}, technique: {}, total: 0, toValidate: 0, expected: 0, late: 0, rejected: 0 };
  const fromLive = (r) => live && r.kind === 'financier' && (r.status === 'attendu' || r.status === 'en_retard');
  for (const r of rows || []) {
    if (!out[r.kind]) continue;
    out.total += r.n;
    if (fromLive(r)) continue;
    out[r.kind][r.status] = (out[r.kind][r.status] || 0) + r.n;
    if (r.status === 'soumis') out.toValidate += r.n;
    if (r.status === 'attendu') out.expected += r.n;
    if (r.status === 'en_retard') out.late += r.n;
    if (r.status === 'rejete') out.rejected += r.n;
  }
  if (live) {
    for (const st of ['attendu', 'en_retard']) if (live[st]) out.financier[st] = live[st];
    out.expected += live.attendu || 0;
    out.late += live.en_retard || 0;
  }
  return out;
}

/**
 * Factures attendues et en retard d'UN partenaire, d'après les rapports attendus (reports.repository
 * .expectedReports : une ligne par TPM × contrat × mois) — pur, testé.
 * @returns {{ attendu: number, en_retard: number }}
 */
function expectedCountsOf(expected, partnerId) {
  const out = { attendu: 0, en_retard: 0 };
  for (const r of (expected && expected.rows) || []) {
    if (r.unit && r.unit.kind === 'tpm' && r.unit.providerId === partnerId && out[r.status] !== undefined) out[r.status] += 1;
  }
  return out;
}

/**
 * Fiche assemblée : identité, statut selon contrat, faits clés, récapitulatif, zones, compteurs.
 * @param {object} raw  partners.repository.sheet
 * @param {{ consolidation?: Map<string, object> }} [opts]
 */
function buildSheet(raw, { consolidation, expected = null } = {}) {
  const c = raw.counts || {};
  const contracts = contractRows(raw.contracts, raw.links, {
    partnerId: raw.partner.id, month: c.month, consolidation, tpmViews: raw.tpmViews, partnerTypes: raw.partnerTypes,
  });
  // TPM qui suivent les contrats tenus par ce partenaire (retour 113 : chaque titulaire voit son TPM).
  const tpms = new Map();
  for (const x of contracts) if (x.isHolder) for (const t of x.tpm.tpms) if (t.id !== raw.partner.id) tpms.set(t.id, { id: t.id, name: t.name });
  const recap = budgetRecap(contracts);
  const reports = reportSummary(raw.reports, expected);
  // Contrat « en cours » (bloc « Fiche 360° » du concepteur de rapport, lot 7a) : le premier contrat de
  // suivi qui couvre le mois, chiffres du contrat (Consolidation) et factures en attente du prestataire.
  const current = contracts.find((x) => x.monitoring && x.coversMonth) || null;
  return {
    partner: raw.partner,
    role: roleOf(raw.partner.typeCode),
    tpms: [...tpms.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr')),
    status: providerStatus(raw.links, c.today),
    facts: {
      budget: recap,
      visits: {
        month: c.month, assigned: c.visitsAssigned || 0, realised: c.visitsRealised || 0,
        rate: ratio(c.visitsRealised || 0, c.visitsAssigned || 0), realised12: c.visitsRealised12 || 0, sitesFollowed: c.sitesFollowed || 0,
        // Visites suivies en interne dans les zones de ses contrats (retour 114) : à part, jamais « affectées ».
        internal: c.visitsInternal || 0, internalRealised: c.visitsInternalRealised || 0,
      },
      submissions: { valid12: c.submissions12 || 0, excluded12: c.submissionsExcluded12 || 0,
        excludedRate: ratio(c.submissionsExcluded12 || 0, (c.submissions12 || 0) + (c.submissionsExcluded12 || 0)) },
      team: { active: c.agentsActive || 0, total: c.agentsTotal || 0 },
      reports,
      trainings: c.trainings || 0,
      evaluation: raw.lastEval ? { ...raw.lastEval, score: raw.lastEval.score == null ? null : Number(raw.lastEval.score) } : null,
      contract: current ? {
        status: 'mesure', id: current.id, numero: current.numero, dateFin: current.dateFin, budget: current.monitoringBudget,
        actual: current.contractActual, consumption: current.consumption, pending: current.providerPending,
      } : { status: 'aucun' },
      sitesFollowed: c.sitesFollowed || 0,
      invoicesPending: reports.toValidate,
    },
    contracts,
    zones: mergeZones(raw.zones, raw.districts),
    counts: {
      contracts: contracts.length, reports: reports.total, plans: c.plans || 0, agents: c.agentsTotal || 0,
      trainings: c.trainings || 0, evaluations: c.evaluations || 0,
    },
  };
}

/**
 * Contrats derrière une cellule SUIVIE EN INTERNE (retour 114), tels que la règle d'attribution les
 * nomme (tpmAttribution.resolveCell) — lecture seule, jamais une autre règle : « sans_tpm » → les
 * contrats de suivi sans TPM qui couvrent la zone (`default.noTpm`) ; « indisponible » → les contrats
 * des TPM indisponibles ce mois (candidats du contrat, ou celui de la modification suspendue).
 * @param {object|null} cell  tpmAttribution.cellForSite(...)
 * @returns {string[]} identifiants de contrats
 */
function internalCellContracts(cell) {
  if (!cell || !cell.default) return [];
  if (cell.state === 'sans_tpm') return (cell.default.noTpm || []).map((k) => k.contractId);
  if (cell.state !== 'indisponible') return [];
  const cands = cell.default.candidates || [];
  const suspended = cell.override && cell.override.providerId;
  return (suspended ? cands.filter((c) => c.providerId === cell.override.providerId) : cands).map((c) => c.contractId);
}

/**
 * Visites suivies en interne dans les zones des contrats TENUS : celles dont la cellule nomme un de ces
 * contrats (internalCellContracts) — non annulées, et parmi elles les réalisées.
 * @param {{ status, cell }[]} visits   visites internes du mois et leur cellule
 * @param {Iterable<string>} heldIds    contrats tenus par le partenaire
 */
function holderInternalVisits(visits, heldIds) {
  const held = new Set(heldIds);
  const mine = (visits || []).filter((v) => v.status !== 'annule' && internalCellContracts(v.cell).some((k) => held.has(k)));
  return { visitsInternal: mine.length, visitsInternalRealised: mine.filter((v) => v.status === 'realise').length };
}

/**
 * Zones d'intervention CALCULÉES (aucune saisie) : zones des contrats + districts
 * des visites, sans doublon (comparaison normalisée), triées.
 * @param {string[]} contractPaths  « Région > District »
 * @param {Array<{region?, district}>} visitDistricts
 */
function mergeZones(contractPaths = [], visitDistricts = []) {
  const out = new Map();
  for (const p of contractPaths) if (p) out.set(pathKey(p), { path: p, source: 'contrat' });
  for (const v of visitDistricts) {
    if (!v.district) continue;
    const path = v.region ? `${v.region} > ${v.district}` : v.district;
    const k = pathKey(path);
    const already = [...out.keys()].some((x) => x === k || x.endsWith(` > ${pathKey(v.district)}`));
    if (!already) out.set(k, { path, source: 'visites' });
  }
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path, 'fr'));
}

// Libellés de la frise : phrase française à paramètres (traduite par l'interface).
const EVENT_TEXT = {
  'contrat:creation': 'Contrat {label} créé',
  'contrat:soumission': 'Contrat {label} soumis pour validation',
  'contrat:approbation': 'Contrat {label} validé',
  'contrat:rejet': 'Contrat {label} rejeté',
  'contrat:avenant_demande': 'Avenant demandé sur le contrat {label}',
  'contrat:avenant_approuve': 'Avenant approuvé sur le contrat {label}',
  'contrat:avenant_rejete': 'Avenant rejeté sur le contrat {label}',
  'contrat:renouvellement': 'Contrat {label} renouvelé',
  'contrat:resiliation': 'Contrat {label} résilié',
  'facture:soumis': 'Facture de {extra} soumise',
  'facture:valide': 'Facture de {extra} validée',
  'facture:rejete': 'Facture de {extra} rejetée',
  'terrain:debut': 'Premières visites dans le district {label}',
  'terrain:dernier': 'Dernières visites dans le district {label}',
  'formation:formation': 'Formation « {label} » suivie par {extra}',
  'formation:prevue': 'Formation « {label} » prévue pour {extra}',
  'evaluation:evaluation': 'Évaluation de {extra} ({label})',
};
const KIND_ORDER = { contrat: 0, facture: 1, terrain: 2, formation: 3, evaluation: 4 };
// À date égale, l'étape la plus avancée d'abord (ex. « validé » avant « soumis » avant « créé »).
const STEP = Object.fromEntries(Object.keys(EVENT_TEXT).map((k, i) => [k, i]));
const byDateDesc = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1
  : (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || (STEP[`${b.kind}:${b.code}`] ?? -1) - (STEP[`${a.kind}:${a.code}`] ?? -1));

/**
 * Frise : événements triés du plus récent au plus ancien (à date égale, ordre
 * stable par nature), bornés à `limit`, avec le curseur de la page suivante.
 * @param {Array<{at, kind, code, label, ref, extra}>} rows
 */
function shapeTimeline(rows, { limit = 50 } = {}) {
  const items = rows
    .filter((r) => r.at)
    .map((r) => ({ ...r, at: new Date(r.at).toISOString() }))
    .sort(byDateDesc)
    .slice(0, limit)
    .map((r) => ({
      at: r.at, kind: r.kind, ref: r.ref || null,
      message: { text: EVENT_TEXT[`${r.kind}:${r.code}`] || `${r.kind} : {label}`, params: { label: r.label || '', extra: r.extra || '' } },
    }));
  return { items, next: items.length === limit ? items[items.length - 1].at : null };
}

module.exports = {
  buildSheet, providerListRows, contractRows, budgetRecap, reportSummary, expectedCountsOf, mergeZones, shapeTimeline, EVENT_TEXT,
  internalCellContracts, holderInternalVisits,
};
