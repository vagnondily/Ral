const crypto = require('node:crypto');
const { PERIOD_CAPS } = require('../common/periodCaps');
const activeProvider = require('./activeProvider');
const { districtKey } = require('../common/siteDistrict');

/**
 * Attribution des TPM par zone (retour 58) — règle PURE, sans I/O, testée
 * (test/tpmAttribution.test.js). Le SQL lit les entrées et applique les résultats ;
 * toute la décision vit ici. Jumelle SQL : la fonction `mems_tpm_cells` de la migration
 * 070 (estampille des visites en base) — parité vérifiée par scripts/tpmParity.js.
 *
 * UNE règle commune avec le lot 8 (« prestataire actif au mois M », tpm/activeProvider.js) :
 * contrat de suivi (IV.suivi > 0), contrat qui couvre un mois, liens prestataire ↔ contrat et
 * listes de choix viennent de ce module — jamais réécrits ici.
 *
 * Règle (docs/SPEC_RETOUR_58.md, retours 114 et 115) :
 *  - TPM d'un CONTRAT (D1, décidée le 20/10) : le ou les partenaires de type TPM, actifs,
 *    RATTACHÉS au contrat par un plan de collecte ou une facture / un rapport (liens « plan » et
 *    « rapport » de la règle commune) ; à défaut son titulaire, SEULEMENT s'il est lui-même un
 *    partenaire actif de type TPM (activeProvider.contractTpmOf, la règle des écrans) ; sinon le
 *    contrat n'a pas de TPM. Dans les données : CTR-2026-0001 (titulaire ASSOCIATION AINA) → RANO
 *    Control, qui y facture le suivi. `contractTpms` est le SEUL endroit qui dépend de ce choix.
 *  - TPM selon contrat d'une zone (district ou commune) pour un mois M : TPM des contrats de
 *    SUIVI qui COUVRENT M (« actif » de mois(début) à mois(fin), « résilié » jusqu'au mois de
 *    résiliation, les dates décident seules) et dont une zone, liée par identifiant, contient la
 *    zone. La zone de contrat la plus précise l'emporte. Un TPM : « selon contrat » ; plusieurs :
 *    « plusieurs contrats : choisir » — le TPM par défaut est celui du contrat au début le plus
 *    récent (puis plus petit numéro, puis nom), affiché comme tel et signalé ; un choix explicite
 *    (modification motivée) lève le signal.
 *  - SUIVI INTERNE (retour 114 : « sans contrat, on devra le faire nous-mêmes ») : sans TPM, la
 *    zone est suivie par l'équipe S&E — une affectation, jamais « à affecter ». Les états disent
 *    pourquoi : « sans_contrat » (aucun contrat de suivi ne couvre la zone ce mois), « sans_tpm »
 *    (un contrat de suivi la couvre mais n'a pas de TPM, D1), « indisponible » (le TPM retenu est
 *    déclaré indisponible ce mois, avec un motif), « aucun_tpm » (décidé, avec une raison),
 *    « district_inconnu » (site non rattaché). `monitoredByOf` est la jumelle de la colonne
 *    générée site_visits.monitored_by (migration 107) : 'tpm' | 'interne' | 'non_affecte'.
 *  - INDISPONIBILITÉ d'un TPM (retour 114 : « même avec un contrat, si cette entité n'est pas
 *    disponible, on doit le faire ») : TPM × mois, motif obligatoire (tpm_unavailability). Le TPM
 *    est retiré des candidats de la zone ce mois-là ; s'il en reste, ils décident (même ordre) ;
 *    sinon « indisponible » (suivi interne). Une modification vers un TPM indisponible est
 *    suspendue le temps de l'indisponibilité. Jamais un contrat moins précis n'est appelé.
 *  - TPM retenu : la modification enregistrée pour la zone et le mois (raison obligatoire,
 *    instantané du contrat, journal), sinon le TPM selon contrat. Une modification n'est
 *    jamais écrasée par un changement de contrat : elle passe « à confirmer ».
 *  - TPM d'un site (et de ses visites) : la cellule de sa commune si la commune a sa propre
 *    ligne ce mois-là (modification posée sur la commune, ou zone de contrat exactement sur
 *    la commune, avec ou sans TPM), sinon celle de son district ; sans district reconnu :
 *    « district inconnu » (suivi interne tant que le site n'est pas rapproché).
 */

const MAX_SPAN_MONTHS = PERIOD_CAPS.facts; // 24 mois, comme les faits site × mois (lot 1b)
const MAX_AREAS = 300;
const MAX_REGIONS = 30;
const MAX_CELLS = 2400;
const MAX_VISITS = 500;
/** États d'une cellule (zone × mois) de l'onglet. */
const ZONE_STATES = ['contrat', 'modifie', 'aucun_tpm', 'a_arbitrer', 'sans_contrat', 'sans_tpm', 'indisponible'];
/** États recopiés sur une visite (site_visits.provider_zone_state) — CHECK des migrations 070 et 107. */
const VISIT_ZONE_STATES = [...ZONE_STATES, 'district_inconnu', 'anterieur'];
/** Ce que disait le contrat au moment d'une modification (tpm_zone_overrides.expected_state). */
const DEFAULT_STATES = ['contrat', 'sans_contrat', 'a_arbitrer', 'sans_tpm'];
/** Ce que dit le contrat quand la zone n'a aucun TPM : suivi interne (« aucun TPM » n'y est pas une modification). */
const INTERNAL_DEFAULT_STATES = ['sans_contrat', 'sans_tpm'];
/**
 * États d'une visite « zone » sans TPM qui veulent dire SUIVI INTERNE (équipe S&E, retour 114) —
 * liste de la colonne générée site_visits.monitored_by (migration 107). « anterieur » n'en est pas :
 * visite figée avant la règle, sans TPM connu (« non affecté »).
 */
const INTERNAL_VISIT_STATES = ['sans_contrat', 'sans_tpm', 'indisponible', 'aucun_tpm', 'district_inconnu'];
/** Qui suit une visite : un TPM, l'équipe S&E (interne), ou personne de connu (antérieure, en cours d'estampille). */
const MONITORED_BY = ['tpm', 'interne', 'non_affecte'];
/** États qui portent un TPM (provider_id NOT NULL) — « à arbitrer » porte le TPM par défaut. */
const WITH_PROVIDER = ['contrat', 'modifie', 'a_arbitrer'];
/** Origine du TPM d'une visite : la zone, la visite elle-même (raison), ou la reprise de l'existant. */
const VISIT_SOURCES = ['zone', 'visite', 'reprise'];
/** Statuts d'un contrat qui peuvent couvrir un mois. */
const COVERING_STATUSES = ['actif', 'resilie'];
/** Actions du journal (tpm_attribution_log.action) ; « indispo_* » : indisponibilités des TPM (retour 114). */
const LOG_ACTIONS = ['modifier', 'confirmer', 'revenir_contrat', 'reappliquer', 'visite_modifier', 'visite_garder', 'visite_zone',
  'indispo_poser', 'indispo_modifier', 'indispo_retirer'];
/** Portées d'une ligne du journal : un lot, une zone × mois, une visite, un TPM × mois (indisponibilité). */
const LOG_SCOPES = ['lot', 'zone', 'visite', 'tpm'];
/** Actions dont la raison est facultative (retour au contrat, réapplication, fin d'une indisponibilité). */
const LOG_OPTIONAL_REASON = ['revenir_contrat', 'reappliquer', 'visite_zone', 'indispo_retirer'];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // ordre binaire, comme COLLATE "C"
const monthOfDate = (d) => (d ? String(d).slice(0, 7) : null);

/** Règle commune (lot 8) : contrat de suivi, contrat qui couvre un mois, TPM d'un contrat (D1). */
const { contractCoversMonth, isMonitoringContract, contractTpmOf } = activeProvider;

/**
 * TPM rattachés à chaque contrat (plan de collecte, facture / rapport ; partenaires actifs de type
 * TPM) : la règle unique est dans activeProvider.tpmsByContract (partagée avec les listes de choix
 * et les écrans, retour 113). Map contractId → TPM (ordre du nom).
 */
const { tpmsByContract, TPM_LINK_KINDS } = activeProvider;

/**
 * D1 (retours 114 et 115) : TPM d'un contrat = ses TPM rattachés (plans, factures ; partenaires
 * actifs de type TPM) ; à défaut son titulaire SEULEMENT s'il est un partenaire actif de type TPM ;
 * sinon aucun (suivi interne). La règle des écrans (activeProvider.contractTpmOf), jamais réécrite :
 * le titulaire est lu sur le contrat (partnerId, partnerName, holderTypeCode, holderActive).
 */
function contractTpms(c) {
  if (!c) return [];
  const holder = c.partnerId
    ? { id: c.partnerId, name: c.partnerName || null, typeCode: c.holderTypeCode || null, active: c.holderActive !== false }
    : null;
  return contractTpmOf(Array.isArray(c.tpms) ? c.tpms : [], holder).tpms.map((t) => ({ id: t.id, name: t.name || null }));
}
/** Le TPM « principal » d'un contrat (le premier de contractTpms). */
const contractTpm = (c) => (contractTpms(c)[0] || {}).id || null;

/** Dernier mois couvert : mois de fin, ou mois de résiliation pour un contrat résilié. */
function contractEndMonth(c) {
  return c.status === 'resilie' ? monthOfDate(c.terminationDate) : monthOfDate(c.dateFin);
}

/** Contrats de suivi qui couvrent M (avec ou sans TPM). */
const monitoringContractsAt = (contracts, m) => (contracts || []).filter((c) => isMonitoringContract(c) && contractCoversMonth(c, m));
/** Contrats de suivi avec un TPM qui couvrent M. */
const coveringContracts = (contracts, m) => monitoringContractsAt(contracts, m).filter((c) => contractTpms(c).length);

/**
 * Relation entre une aire (district ou commune) et une zone de contrat :
 *  'detachee' (zone sans identifiant : découpage réimporté), 'exact', 'ancetre' (la zone
 *  contient l'aire), 'descendant' (zone plus fine, dans l'aire), 'trop_fine' (fokontany
 *  dans l'aire : ne prouve pas que l'aire entière est couverte), sinon null.
 */
function coverOf(area, zone) {
  if (!zone || !zone.adminAreaId) return 'detachee';
  if (zone.adminAreaId === area.id) return 'exact';
  if ((area.lineage || []).includes(zone.adminAreaId)) return 'ancetre';
  if ((zone.lineage || []).includes(area.id)) return Number(zone.depth) >= 4 ? 'trop_fine' : 'descendant';
  return null;
}

/** Ordre « par défaut » : contrat au début le plus récent, puis plus petit numéro, puis TPM (nom, id). */
const byDefault = (a, b) => cmp(b.dateDebut, a.dateDebut) || cmp(a.numero, b.numero)
  || cmp(a.providerName || '', b.providerName || '') || cmp(a.providerId || '', b.providerId || '');
/** Libellé d'un contrat pour l'écran : son numéro FLA s'il en a un, sinon son numéro MEMS. */
const contractLabelOf = (c) => c.numeroFla || c.numero;

/**
 * TPM selon contrat d'une aire pour un mois. Plusieurs TPM : « à arbitrer », avec le TPM par
 * défaut (byDefault) — jamais un blanc. Aucun TPM : suivi interne — « sans_tpm » si un contrat de
 * suivi SANS TPM couvre l'aire (D1 ; `noTpm` dit lesquels), sinon « sans_contrat ». Seules les
 * zones des contrats avec un TPM donnent un TPM ; `exactHit` (une zone d'un tel contrat exactement
 * sur l'aire) et `exactBare` (une zone d'un contrat SANS TPM exactement sur l'aire) décident si une
 * commune a sa propre ligne (buildZoneTable) ; `partiel` compte tous les contrats. Indisponibilités :
 * voir availableDefault (appliquées après, jamais ici : la valeur par défaut reste celle du contrat).
 * @returns {{ state:'contrat'|'sans_contrat'|'sans_tpm'|'a_arbitrer', providerId, contractId, numero, contractLabel,
 *            candidates:[{providerId, providerName, contractId, numero, contractLabel, dateDebut, zonePath, via, endMonth}],
 *            noTpm:[{contractId, numero, contractLabel, holderName}], partiel:boolean, exactHit:boolean, exactBare:boolean }}
 */
function defaultFor(area, month, contracts) {
  const hits = [];
  const bare = [];
  let partiel = false;
  let exactHit = false;
  let exactBare = false;
  for (const c of monitoringContractsAt(contracts, month)) {
    const withTpm = contractTpms(c).length > 0;
    for (const z of c.zones || []) {
      const cov = coverOf(area, z);
      if (cov === 'exact' || cov === 'ancetre') {
        (withTpm ? hits : bare).push({ c, z, cov });
        if (cov === 'exact') { if (withTpm) exactHit = true; else exactBare = true; }
      } else if (cov === 'descendant') partiel = true;
    }
  }
  if (!hits.length) {
    const seen = new Set();
    const noTpm = bare.filter((h) => !seen.has(h.c.id) && seen.add(h.c.id))
      .map((h) => ({ contractId: h.c.id, numero: h.c.numero, contractLabel: contractLabelOf(h.c), holderName: h.c.partnerName || null }))
      .sort((a, b) => cmp(a.numero, b.numero));
    return { state: bare.length ? 'sans_tpm' : 'sans_contrat', providerId: null, contractId: null, numero: null, contractLabel: null,
      candidates: [], noTpm, partiel, exactHit, exactBare };
  }
  const best = Math.max(...hits.map((h) => Number(h.z.depth)));
  // Un candidat par TPM : son contrat retenu (ordre par défaut) parmi les zones les plus précises.
  const byProvider = new Map();
  for (const h of hits.filter((x) => Number(x.z.depth) === best)) {
    for (const t of contractTpms(h.c)) {
      const cand = {
        providerId: t.id, providerName: t.name || null, contractId: h.c.id, numero: h.c.numero,
        contractLabel: contractLabelOf(h.c), dateDebut: h.c.dateDebut,
        zonePath: h.z.path || null, via: h.cov === 'exact' ? 'exact' : 'parent', endMonth: contractEndMonth(h.c),
      };
      const prev = byProvider.get(t.id);
      if (!prev || byDefault(cand, prev) < 0) byProvider.set(t.id, cand);
    }
  }
  const candidates = [...byProvider.values()].sort((a, b) => cmp(a.providerName || '', b.providerName || '') || cmp(a.numero, b.numero));
  const chosen = candidates.length === 1 ? candidates[0] : candidates.slice().sort(byDefault)[0];
  return {
    state: candidates.length === 1 ? 'contrat' : 'a_arbitrer',
    providerId: chosen.providerId, contractId: chosen.contractId, numero: chosen.numero, contractLabel: chosen.contractLabel,
    candidates, noTpm: [], partiel, exactHit, exactBare,
  };
}

/** Clé d'une indisponibilité : TPM × mois (« AAAA-MM »). */
const offKey = (providerId, month) => `${providerId}|${String(month).slice(0, 7)}`;
/**
 * Indisponibilités des TPM (tpm_unavailability, une ligne par TPM × mois) → index par clé.
 * @param {{ providerId, month, reason, batchId?, id? }[]} list
 */
function unavailabilityIndex(list) {
  const out = new Map();
  for (const u of list || []) if (u && u.providerId && u.month) out.set(offKey(u.providerId, u.month), u);
  return out;
}
/** Ce que l'écran dit d'une indisponibilité (TPM, motif, lot). */
const offView = (u, providerName) => ({ providerId: u.providerId, providerName: providerName || u.providerName || null,
  reason: u.reason || null, batchId: u.batchId || u.id || null });

/**
 * TPM retenu par défaut compte tenu des indisponibilités (retour 114) : un TPM indisponible ce
 * mois-là est retiré des candidats ; s'il en reste, ils décident (même ordre byDefault, un seul =
 * « selon contrat ») ; sinon « indisponible » — suivi interne. Jamais un contrat moins précis.
 * @param {object} def  defaultFor(...)
 * @param {(providerId) => object|null} offOf  indisponibilité du TPM ce mois-là
 */
function availableDefault(def, offOf = () => null) {
  const base = { state: def.state, providerId: def.providerId || null, contractId: def.contractId || null, numero: def.numero || null,
    contractLabel: def.contractLabel || null, candidates: def.candidates, unavailable: [] };
  if (!def.candidates.length) return base;
  const ok = []; const off = [];
  for (const c of def.candidates) {
    const u = offOf(c.providerId);
    if (u) off.push(offView(u, c.providerName)); else ok.push(c);
  }
  if (!off.length) return base;
  if (!ok.length) return { state: 'indisponible', providerId: null, contractId: null, numero: null, contractLabel: null, candidates: [], unavailable: off };
  const chosen = ok.length === 1 ? ok[0] : ok.slice().sort(byDefault)[0];
  return { state: ok.length === 1 ? 'contrat' : 'a_arbitrer', providerId: chosen.providerId, contractId: chosen.contractId,
    numero: chosen.numero, contractLabel: chosen.contractLabel, candidates: ok, unavailable: off };
}

/** Libellé de ce que dit le contrat (instantané d'une modification, journal). */
function defaultLabel(def, partnersById) {
  const name = (c) => (partnersById && partnersById.get(c.providerId) ? partnersById.get(c.providerId).name : c.providerName) || '—';
  if (def.state === 'contrat') return `${def.candidates[0].contractLabel || def.candidates[0].numero} · ${name(def.candidates[0])}`.slice(0, 300);
  if (def.state === 'a_arbitrer') return `${def.candidates.length} contrats : ${def.candidates.map((c) => `${name(c)} (${c.contractLabel || c.numero})`).join(', ')}`.slice(0, 300);
  if (def.state === 'sans_tpm') return `Contrat sans TPM : ${(def.noTpm || []).map((c) => c.contractLabel || c.numero).join(', ')}`.slice(0, 300);
  return 'Sans contrat';
}

/**
 * Cellule retenue : la modification si elle existe (TPM ou « aucun TPM »), sinon le contrat — puis
 * les indisponibilités (retour 114). Drapeaux : a_confirmer (le contrat a changé depuis la
 * décision), redondante (la modification rejoint le contrat), partiel, hors_contrat (TPM modifié
 * qui ne tient aucun contrat de suivi ce mois), titulaire_non_tpm, prestataire_inactif,
 * modification_suspendue (le TPM choisi est indisponible ce mois : suivi interne le temps de
 * l'indisponibilité), tpm_indisponible (un candidat indisponible, un autre prend le relais).
 * `monitoredBy` : 'tpm' (un TPM) ou 'interne' (équipe S&E).
 * @param {object} def  defaultFor(...)
 * @param {object|null} override  modification de la zone pour ce mois
 * @param {{ partnersById?: Map, holders?: Set<string>, offOf?: (providerId) => object|null }} ctx
 *   holders = TPM des contrats du mois ; offOf = indisponibilité d'un TPM ce mois-là
 */
function resolveCell(def, override, { partnersById = new Map(), holders = null, offOf = () => null } = {}) {
  const flags = [];
  let cell;
  const nameOf = (id) => (partnersById.get(id) || {}).name || (def.candidates.find((x) => x.providerId === id) || {}).providerName || null;
  if (override) {
    const providerId = override.providerId || null;
    const cand = providerId ? def.candidates.find((x) => x.providerId === providerId) : null;
    const off = providerId ? offOf(providerId) : null;
    cell = off
      ? { state: 'indisponible', providerId: null, contractId: null, numero: null, contractLabel: null, unavailable: [offView(off, nameOf(providerId))] }
      : {
        state: providerId ? 'modifie' : 'aucun_tpm', providerId,
        contractId: cand ? cand.contractId : null, numero: cand ? cand.numero : null, contractLabel: cand ? cand.contractLabel : null, unavailable: [],
      };
    if (off) flags.push('modification_suspendue');
    if ((override.expectedState || null) !== def.state || (override.expectedProviderId || null) !== (def.providerId || null)) flags.push('a_confirmer');
    if ((def.state === 'contrat' && def.providerId === providerId) || (INTERNAL_DEFAULT_STATES.includes(def.state) && providerId === null)) flags.push('redondante');
    if (providerId && !off && holders && !holders.has(providerId)) flags.push('hors_contrat');
  } else {
    const av = availableDefault(def, offOf);
    cell = { state: av.state, providerId: av.providerId, contractId: av.contractId, numero: av.numero, contractLabel: av.contractLabel, unavailable: av.unavailable };
    if (av.unavailable.length && av.providerId) flags.push('tpm_indisponible');
    if (av.state === 'a_arbitrer' && av.candidates !== def.candidates) cell.candidates = av.candidates;
  }
  if (def.partiel) flags.push('partiel');
  const p = cell.providerId ? partnersById.get(cell.providerId) : null;
  if (p && p.typeCode !== 'tpm') flags.push('titulaire_non_tpm');
  if (p && p.active === false) flags.push('prestataire_inactif');
  const fallbackName = cell.providerId ? (def.candidates.find((x) => x.providerId === cell.providerId) || {}).providerName : null;
  return { ...cell, monitoredBy: cell.providerId ? 'tpm' : 'interne', providerName: p ? p.name : (fallbackName || null), override: override || null, default: def, flags };
}

/**
 * Qui suit une visite (jumelle de la colonne générée site_visits.monitored_by, migration 107) :
 * 'tpm' (elle porte un TPM), 'interne' (équipe S&E : zone sans TPM — aucun contrat, contrat sans
 * TPM, TPM indisponible, « aucun TPM » décidé, district inconnu — ou « aucun TPM » choisi pour
 * cette visite avec une raison), sinon 'non_affecte' (antérieure à la règle, en cours d'estampille).
 * @param {{ providerId?, providerSource?, providerZoneState? }} v
 */
function monitoredByOf(v) {
  if (v && v.providerId) return 'tpm';
  const src = (v && v.providerSource) || 'zone';
  if (src === 'visite') return 'interne';
  if (src === 'zone' && INTERNAL_VISIT_STATES.includes(v && v.providerZoneState)) return 'interne';
  return 'non_affecte';
}

/**
 * Zones de contrat DÉTACHÉES (découpage réimporté : l'aire n'existe plus sous ce chemin) des
 * contrats de suivi « actif » ou « résilié » qui couvrent au moins un des mois : nom normalisé du
 * dernier segment et de la région (siteDistrict.districtKey), mois couverts, contrat. Sert d'INDICE
 * seulement (detachedHintFor) : jamais un TPM deviné (questions Ambovombe / Ampanihy).
 * @returns {{ key, regionKey, months: Set<string>, contractId, numero, contractLabel }[]}
 */
function detachedZones(contracts, months) {
  const out = [];
  for (const c of contracts || []) {
    if (!isMonitoringContract(c) || !COVERING_STATUSES.includes(c.status)) continue;
    const covered = new Set((months || []).filter((m) => contractCoversMonth(c, m)));
    if (!covered.size) continue;
    for (const z of c.zones || []) {
      if (z.adminAreaId || !z.path) continue;
      const parts = String(z.path).split('>');
      const key = districtKey(parts[parts.length - 1]);
      if (!key) continue;
      out.push({ key, regionKey: parts.length > 1 ? districtKey(parts[0]) : '', months: covered,
        contractId: c.id, numero: c.numero, contractLabel: c.numeroFla || c.numero });
    }
  }
  return out;
}

/**
 * Contrats dont une zone détachée correspond, ce mois-là, à une zone SANS contrat : même région (si
 * connue des deux côtés) et même nom normalisé, ou l'un préfixe de l'autre (5 caractères au moins :
 * « Ampanihy » ↔ « Ampanihy Ouest » après un réimport). Indice « zone de contrat à resélectionner ».
 * @param {{ name: string, regionName?: string }} area
 */
function detachedHintFor(area, month, zones) {
  const key = districtKey(area && area.name);
  if (!key || !zones.length) return [];
  const regionKey = districtKey(area.regionName);
  const close = (a, b) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
  const seen = new Set();
  const out = [];
  for (const z of zones) {
    if (!z.months.has(month) || !close(key, z.key)) continue;
    if (regionKey && z.regionKey && regionKey !== z.regionKey) continue;
    if (seen.has(z.contractId)) continue;
    seen.add(z.contractId);
    out.push({ contractId: z.contractId, numero: z.numero, contractLabel: z.contractLabel });
  }
  return out;
}

/**
 * TPM × contrat de chaque mois (rapports attendus, retour 114) : pour chaque contrat de suivi qui couvre
 * le mois et a un TPM (D1), un couple par TPM. @returns {Map<string, {providerId, contractId, contractLabel}[]>}
 */
function contractTpmPairsByMonth(contracts, months) {
  return new Map(months.map((m) => [m, coveringContracts(contracts, m)
    .flatMap((c) => contractTpms(c).map((t) => ({ providerId: t.id, contractId: c.id, contractLabel: contractLabelOf(c) })))]));
}

/** Titulaires (ensemble d'identifiants) de chaque mois. */
function holdersByMonth(contracts, months) {
  return new Map(months.map((m) => [m, new Set(coveringContracts(contracts, m).flatMap((c) => contractTpms(c).map((t) => t.id)))]));
}

/**
 * Qualité des données qui alimentent la règle (bannières de l'onglet) — sur les contrats de
 * suivi « actif » ou « résilié » qui chevauchent les mois lus.
 */
function qualityOf({ contracts = [], overrides = [], months = [], today = null }) {
  const first = months[0]; const last = months[months.length - 1];
  const overlapping = contracts.filter((c) => isMonitoringContract(c) && COVERING_STATUSES.includes(c.status)
    && monthOfDate(c.dateDebut) <= last && contractEndMonth(c) >= first);
  const ref = (c) => ({ contractId: c.id, numero: c.numero });
  const detachedContractZones = []; const tooFineZones = [];
  for (const c of overlapping) {
    for (const z of c.zones || []) {
      if (!z.adminAreaId) detachedContractZones.push({ ...ref(c), path: z.path, holder: c.partnerName || null });
      else if (Number(z.depth) >= 4) tooFineZones.push({ ...ref(c), path: z.path });
    }
  }
  // D1 : contrat de suivi sans TPM (aucun TPM rattaché, titulaire qui n'est pas un TPM actif) — ses
  // zones sont suivies en interne (équipe S&E), sauf si un autre contrat y a un TPM.
  return {
    detachedContractZones,
    tooFineZones,
    contractsWithoutHolder: overlapping.filter((c) => !c.partnerId && !(Array.isArray(c.tpms) && c.tpms.length)).map(ref),
    contractsWithoutTpm: overlapping.filter((c) => !contractTpms(c).length)
      .map((c) => ({ ...ref(c), contractLabel: contractLabelOf(c), holder: c.partnerName || null })),
    expiredStillActive: today
      ? overlapping.filter((c) => c.status === 'actif' && monthOfDate(c.dateFin) < today).map((c) => ({ ...ref(c), endMonth: monthOfDate(c.dateFin), holder: c.partnerName || null }))
      : [],
    detachedOverrides: overrides.filter((o) => !o.adminAreaId && o.month >= first && o.month <= last)
      .map((o) => ({ id: o.id, path: o.areaPath, month: o.month })),
  };
}

/**
 * Une commune a-t-elle sa propre ligne ce mois (`own`) ? Oui si une modification y est posée, ou si
 * une zone d'un contrat AVEC TPM est exactement sur elle. Une commune listée seulement par des
 * contrats SANS TPM suit son district (son TPM de contrat ET sa modification — retour 114, U1) ;
 * elle n'a sa ligne « sans_tpm » que si aucun contrat avec TPM ni aucune modification ne couvre un de
 * ses ancêtres (district). Jumelle du CTE `tg` de mems_tpm_cells (migration 107).
 */
function communeOwnsRow(def, ov, ancestorOverride) {
  return Boolean(ov || def.exactHit || (def.exactBare && def.state === 'sans_tpm' && !ancestorOverride));
}

/**
 * Table zone × mois. `areas` = districts et communes de l'onglet (une commune n'a sa propre
 * ligne que selon communeOwnsRow : `own`). Taille bornée par l'appelant (≤ MAX_CELLS côté écriture).
 * @returns {{ cells: Map<string, object>, quality: object, partnersById: Map }}
 */
function buildZoneTable({ areas = [], months = [], contracts = [], overrides = [], partners = [], unavailability = [], today = null }) {
  const partnersById = new Map(partners.map((p) => [p.id, p]));
  const ovByKey = new Map(overrides.filter((o) => o.adminAreaId).map((o) => [`${o.adminAreaId}|${o.month}`, o]));
  const holders = holdersByMonth(contracts, months);
  const detached = detachedZones(contracts, months);
  const off = unavailabilityIndex(unavailability);
  const cells = new Map();
  for (const a of areas) {
    for (const m of months) {
      const def = defaultFor(a, m, contracts);
      const ov = ovByKey.get(`${a.id}|${m}`) || null;
      const cell = resolveCell(def, ov, { partnersById, holders: holders.get(m), offOf: (pid) => off.get(offKey(pid, m)) || null });
      // Aucun contrat ne couvre, mais un contrat de suivi y a une zone détachée de même nom : indice.
      const hint = cell.state === 'sans_contrat' ? detachedHintFor(a, m, detached) : [];
      if (hint.length) { cell.flags.push('zone_a_reselectionner'); cell.detached = hint; }
      const own = Number(a.depth) === 3
        ? communeOwnsRow(def, ov, (a.lineage || []).some((id) => ovByKey.has(`${id}|${m}`)))
        : true;
      cells.set(`${a.id}|${m}`, { areaId: a.id, month: m, own, ...cell });
    }
  }
  return { cells, quality: qualityOf({ contracts, overrides, months, today }), partnersById };
}

/**
 * Cellule qui s'applique à un site un mois donné : sa commune si elle a sa propre ligne ce
 * mois-là, sinon son district. Sans district reconnu : « district inconnu », aucun TPM.
 */
function cellForSite({ districtId, communeId }, month, table) {
  if (!districtId) return { areaId: null, month, state: 'district_inconnu', providerId: null, contractId: null, monitoredBy: 'interne', flags: [] };
  const c = communeId ? table.cells.get(`${communeId}|${month}`) : null;
  if (c && c.own) return c;
  return table.cells.get(`${districtId}|${month}`) || null;
}

/**
 * Clé de regroupement des mois consécutifs identiques. Une modification compte par DÉCISION (même
 * lot, même raison), pas par ligne : six mois modifiés d'un coup forment un seul segment.
 */
const segmentKey = (c) => [c.state, c.providerId || '', c.contractId || '',
  c.override ? `${c.override.batchId || c.override.id}~${c.override.reason || ''}` : '', c.flags.includes('a_confirmer') ? 1 : 0,
  c.flags.includes('zone_a_reselectionner') ? 1 : 0,
  (c.unavailable || []).map((u) => `${u.providerId}~${u.batchId || ''}`).join(','),
  ((c.default && c.default.noTpm) || []).map((k) => k.contractId).join(',')].join('|');

/** Mois consécutifs identiques (même état, TPM, contrat, décision de modification) → { from, to, cell }. */
function segments(cellsOfArea) {
  const out = [];
  for (const c of [...cellsOfArea].sort((a, b) => cmp(a.month, b.month))) {
    const last = out[out.length - 1];
    if (last && last.key === segmentKey(c)) { last.to = c.month; last.months += 1; continue; }
    out.push({ key: segmentKey(c), from: c.month, to: c.month, months: 1, cell: c });
  }
  return out.map(({ key: _k, ...s }) => s);
}

const stampTime = (v) => (v instanceof Date ? v.toISOString() : (v ? String(v) : ''));

/** Empreinte (verrou optimiste) d'une sélection de cellules : indépendante de l'ordre. */
function stampOf(cells) {
  const lines = [...cells].map((c) => [c.areaId, c.month, c.state, c.providerId || '', c.override ? stampTime(c.override.updatedAt) : ''].join('|')).sort();
  return crypto.createHash('sha1').update(lines.join('\n')).digest('hex');
}

/**
 * Plan d'écriture d'un changement de TPM sur une sélection de cellules (zone × mois).
 * Choisir la valeur du contrat (ou « aucun TPM » là où aucun contrat ne couvre) n'est pas une
 * modification : une modification existante est alors supprimée (« revenir au contrat »).
 * @param {{ targets: {areaId, month, cell}[], providerId: string|null, reason: string|null, partnersById?: Map }} p
 * @returns {{ upserts, deletes, log, counts }}
 */
function planOverrides({ targets, providerId, reason, partnersById }) {
  const p = providerId || null;
  const upserts = []; const deletes = []; const log = [];
  const counts = { created: 0, updated: 0, confirmed: 0, deleted: 0, sameAsContract: 0, nothingToChange: 0, unchanged: 0 };
  const after = { state: p ? 'modifie' : 'aucun_tpm', providerId: p };
  for (const { areaId, month, cell } of targets) {
    const def = cell.default;
    const ex = cell.override;
    const label = defaultLabel(def, partnersById);
    const asContract = def.state === 'contrat' && p === def.providerId;
    // « Aucun TPM » là où la zone est déjà en suivi interne (aucun contrat, contrat sans TPM) : rien à décider.
    const nothing = INTERNAL_DEFAULT_STATES.includes(def.state) && p === null;
    if (asContract || nothing) {
      counts[asContract ? 'sameAsContract' : 'nothingToChange'] += 1;
      if (ex) {
        deletes.push(ex.id); counts.deleted += 1;
        log.push({ action: 'revenir_contrat', areaId, month, old: { state: cell.state, providerId: ex.providerId || null }, new: { state: def.state, providerId: def.providerId || null }, contractLabel: label });
      }
      continue;
    }
    const row = { areaId, month, providerId: p, expectedState: def.state, expectedProviderId: def.providerId || null, expectedLabel: label };
    if (ex) {
      const same = (ex.providerId || null) === p;
      const stale = cell.flags.includes('a_confirmer');
      if (same && !stale && ex.reason === reason) { counts.unchanged += 1; continue; }
      upserts.push(row);
      counts[same && stale ? 'confirmed' : 'updated'] += 1;
      log.push({ action: same && stale ? 'confirmer' : 'modifier', areaId, month, old: { state: cell.state, providerId: ex.providerId || null }, new: after, contractLabel: label });
    } else {
      upserts.push(row);
      counts.created += 1;
      log.push({ action: 'modifier', areaId, month, old: { state: cell.state, providerId: cell.providerId || null }, new: after, contractLabel: label });
    }
  }
  return { upserts, deletes, log, counts };
}

/** « Revenir au contrat » sur une sélection : supprime les modifications visées. */
function planRevert({ targets, partnersById }) {
  const deletes = []; const log = [];
  for (const { areaId, month, cell } of targets) {
    if (!cell.override) continue;
    deletes.push(cell.override.id);
    const def = cell.default;
    log.push({ action: 'revenir_contrat', areaId, month, old: { state: cell.state, providerId: cell.providerId || null }, new: { state: def.state, providerId: def.providerId || null }, contractLabel: defaultLabel(def, partnersById) });
  }
  return { deletes, log, counts: { deleted: deletes.length } };
}

/**
 * Visites dont l'estampille changerait avec cette table (aperçu) : seulement les lignes qui
 * changent. `visits` : { id, districtId, communeId, month, providerId, zoneState, contractId, dated }.
 */
function restampPlan(visits, table) {
  const out = [];
  for (const v of visits) {
    const c = cellForSite(v, v.month, table);
    if (!c) continue;
    const next = { providerId: c.providerId || null, zoneState: c.state, contractId: c.contractId || null };
    if (next.providerId !== (v.providerId || null) || next.zoneState !== (v.zoneState || null) || next.contractId !== (v.contractId || null)) {
      out.push({ id: v.id, ...next, fromProviderId: v.providerId || null, dated: Boolean(v.dated) });
    }
  }
  return out;
}

/** Répartition d'un plan d'estampille : par état et déplacements entre prestataires. */
function summarizeRestamp(changes) {
  const byState = {};
  const moves = new Map();
  for (const c of changes) {
    byState[c.zoneState] = (byState[c.zoneState] || 0) + 1;
    if ((c.fromProviderId || null) === (c.providerId || null)) continue;
    const k = `${c.fromProviderId || ''}>${c.providerId || ''}`;
    if (!moves.has(k)) moves.set(k, { fromProviderId: c.fromProviderId || null, toProviderId: c.providerId || null, visits: 0, datedVisits: 0 });
    const m = moves.get(k); m.visits += 1; if (c.dated) m.datedVisits += 1;
  }
  return { changed: changes.length, byState, moves: [...moves.values()].sort((a, b) => b.visits - a.visits) };
}

/**
 * Prestataires sélectionnables sur des mois : la règle COMMUNE (lot 8, activeProvider
 * .selectableProviders) — groupe « contrat » (prestataires actifs, avec leurs mois et contrats)
 * puis groupe « tpm » (autres TPM actifs, choix hors contrat). Entrées : liens et partenaires.
 */
const { selectableProviders, activeProviders } = activeProvider;

/**
 * Listes de choix d'un TPM pour des mois (onglet, visites) : la règle commune du lot 8
 * (selectableProviders) restreinte par D1 aux partenaires ACTIFS de type TPM — un partenaire de mise
 * en œuvre n'est jamais proposé comme TPM d'une zone ou d'une visite — et annotée des mois où chacun
 * est déclaré indisponible (`unavailableMonths`, retour 114).
 * @param {{ links, partners, months, unavailability?: object[] }} input
 */
function tpmSelectable({ links, partners, months, unavailability = [] }) {
  const base = selectableProviders({ links, partners, months });
  const byId = new Map((partners || []).map((p) => [p.id, p]));
  const isTpm = (id) => { const p = byId.get(id); return Boolean(p) && p.typeCode === 'tpm' && p.active !== false; };
  const off = unavailabilityIndex(unavailability);
  const offMonths = (id) => base.months.filter((m) => off.has(offKey(id, m)));
  return {
    ...base,
    groups: base.groups.map((g) => ({ ...g, providers: g.providers.filter((p) => isTpm(p.id)).map((p) => ({ ...p, unavailableMonths: offMonths(p.id) })) })),
  };
}

/**
 * Mois de `months` où le prestataire n'est PAS sélectionnable : ni TPM d'un contrat de suivi ce
 * mois-là, ni autre TPM actif (tpmSelectable : jamais un partenaire de mise en œuvre) — ou déclaré
 * indisponible ce mois-là (retour 114).
 */
function notSelectableMonths(providerId, months, selectable) {
  if (!providerId) return [];
  const group = (key) => ((selectable.groups || []).find((g) => g.key === key) || { providers: [] }).providers;
  const t = group('tpm').find((p) => p.id === providerId);
  const h = group('contrat').find((p) => p.id === providerId);
  const off = new Set(((t || h) || {}).unavailableMonths || []);
  if (t) return months.filter((m) => off.has(m));
  return months.filter((m) => !h || !h.months.includes(m) || off.has(m));
}

/**
 * Décision pour le TPM d'une visite.
 *  - { action:'zone' } ou la valeur de la zone → la visite suit sa zone (aucune raison) ;
 *  - { action:'set', providerId|null, reason } autre valeur → source « visite », raison exigée,
 *    TPM sélectionnable au mois de la visite ;
 *  - { action:'keep', reason } (visite reprise) → garder sa valeur comme exception motivée.
 * @returns {{ source:'zone' } | { source:'visite', providerId, reason } | { error: string }}
 */
function visitDecision({ visit, cell, request, selectable }) {
  if (request.action === 'zone') return { source: 'zone' };
  const zoneDecides = cell && cell.state !== 'district_inconnu';
  if (request.action === 'set') {
    const p = request.providerId || null;
    if (zoneDecides && p === (cell.providerId || null)) return { source: 'zone' };
    if (!request.reason) return { error: 'reason_required' };
    if (p && notSelectableMonths(p, [visit.month], selectable).length) return { error: 'provider_not_selectable' };
    return { source: 'visite', providerId: p, reason: request.reason };
  }
  if (request.action === 'keep') {
    if (!request.reason) return { error: 'reason_required' };
    return { source: 'visite', providerId: visit.providerId || null, reason: request.reason };
  }
  return { error: 'action_unknown' };
}

/**
 * Jumelle pure du rattachement SQL d'un site à son district (sdcand/sdarea du dépôt) : le district
 * du découpage dont le nom normalisé est la clé du site (siteDistrict), dans la région du site
 * (ou unique si le site n'a pas de région). null si absent ou ambigu.
 * @param {string} dkey clé du district retenu pour le site (sdist.dkey, '—' sans nom)
 * @param {string} regionKey clé normalisée de la région du site ('' sans région)
 * @param {{ id, key, regionKey }[]} districtAreas
 */
function districtAreaFor(dkey, regionKey, districtAreas) {
  if (!dkey || dkey === '—') return null;
  const hits = districtAreas.filter((a) => a.key === dkey && (regionKey === '' || a.regionKey === regionKey));
  return hits.length === 1 ? hits[0].id : null;
}

/** Messages des erreurs de décision pour une visite (visitDecision → 400 avec details.code). */
const VISIT_ERROR_MESSAGES = {
  reason_required: 'Indiquez la raison du changement (10 caractères au moins).',
  provider_not_selectable: 'Ce partenaire n\'est pas sélectionnable au mois de la visite : ce n\'est pas un TPM actif, ou il est déclaré indisponible ce mois-là.',
  visit_unknown: 'Visite inconnue (ou hors de ce compte).',
  action_unknown: 'Action inconnue.',
};
/** Message d'une erreur de décision, avec le site et le mois quand on les connaît. */
const visitErrorMessage = (res) => `${VISIT_ERROR_MESSAGES[res.error] || 'Données invalides.'}${res.visit ? ` (${res.visit.siteName} · ${res.visit.month})` : ''}`;

/**
 * Premier mois à ré-estampiller quand un document (plan de collecte, facture, gabarits) crée ou
 * supprime le lien TPM ↔ contrat (U2) : le mois du document s'il est passé — une facture arrive
 * après son mois, ses visites prévues de ce mois doivent suivre — sinon le mois courant (jamais
 * avant le document : l'historique antérieur ne se réécrit pas).
 * @param {string|null} docMonth  « AAAA-MM… » (premier mois du document ; gabarits : le premier)
 * @param {string} today          « AAAA-MM »
 */
function linkRestampFrom(docMonth, today) {
  const m = docMonth ? String(docMonth).slice(0, 7) : null;
  return m && /^\d{4}-\d{2}$/.test(m) && m < today ? m : today;
}

module.exports = {
  VISIT_ERROR_MESSAGES, visitErrorMessage, TPM_LINK_KINDS, tpmsByContract, contractTpms, linkRestampFrom,
  MAX_SPAN_MONTHS, MAX_AREAS, MAX_REGIONS, MAX_CELLS, MAX_VISITS,
  ZONE_STATES, VISIT_ZONE_STATES, DEFAULT_STATES, WITH_PROVIDER, VISIT_SOURCES, COVERING_STATUSES, LOG_ACTIONS, LOG_SCOPES, LOG_OPTIONAL_REASON,
  INTERNAL_DEFAULT_STATES, INTERNAL_VISIT_STATES, MONITORED_BY, monitoredByOf,
  contractTpm, isMonitoringContract, contractEndMonth, contractCoversMonth, monitoringContractsAt, coveringContracts, coverOf,
  defaultFor, defaultLabel, availableDefault, unavailabilityIndex, offKey, resolveCell, holdersByMonth, contractTpmPairsByMonth, qualityOf, buildZoneTable,
  cellForSite, segments, stampOf, planOverrides, planRevert, restampPlan, summarizeRestamp, selectableProviders, activeProviders,
  tpmSelectable, notSelectableMonths, visitDecision, districtAreaFor, detachedZones, detachedHintFor,
};
