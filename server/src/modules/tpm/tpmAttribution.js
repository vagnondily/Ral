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
 * Règle (docs/SPEC_RETOUR_58.md) :
 *  - TPM d'un CONTRAT (D1, décidé par défaut le 15/10, à confirmer) : le ou les partenaires de
 *    type TPM, actifs, RATTACHÉS au contrat par un plan de collecte ou une facture / un rapport
 *    (liens « plan » et « rapport » de la règle commune) ; à défaut, son titulaire. Dans les
 *    données : CTR-2026-0001 (titulaire ASSOCIATION AINA) → RANO Control, qui y facture le suivi.
 *    `contractTpms` est le SEUL endroit qui dépend de ce choix.
 *  - TPM selon contrat d'une zone (district ou commune) pour un mois M : TPM des contrats de
 *    SUIVI qui COUVRENT M (« actif » de mois(début) à mois(fin), « résilié » jusqu'au mois de
 *    résiliation, les dates décident seules) et dont une zone, liée par identifiant, contient la
 *    zone. La zone de contrat la plus précise l'emporte. Un TPM : « selon contrat » ; aucun :
 *    « sans contrat » (« à affecter ») ; plusieurs : « plusieurs contrats : choisir » — le TPM
 *    par défaut est celui du contrat au début le plus récent (puis plus petit numéro, puis nom),
 *    affiché comme tel et signalé ; un choix explicite (modification motivée) lève le signal.
 *  - TPM retenu : la modification enregistrée pour la zone et le mois (raison obligatoire,
 *    instantané du contrat, journal), sinon le TPM selon contrat. Une modification n'est
 *    jamais écrasée par un changement de contrat : elle passe « à confirmer ».
 *  - TPM d'un site (et de ses visites) : la cellule de sa commune si la commune a sa propre
 *    ligne ce mois-là (modification posée sur la commune, ou zone de contrat exactement sur
 *    la commune), sinon celle de son district ; sans district reconnu : « district inconnu ».
 */

const MAX_SPAN_MONTHS = PERIOD_CAPS.facts; // 24 mois, comme les faits site × mois (lot 1b)
const MAX_AREAS = 300;
const MAX_REGIONS = 30;
const MAX_CELLS = 2400;
const MAX_VISITS = 500;
/** États d'une cellule (zone × mois) de l'onglet. */
const ZONE_STATES = ['contrat', 'modifie', 'aucun_tpm', 'a_arbitrer', 'sans_contrat'];
/** États recopiés sur une visite (site_visits.provider_zone_state) — CHECK de la migration 070. */
const VISIT_ZONE_STATES = [...ZONE_STATES, 'district_inconnu', 'anterieur'];
/** Ce que disait le contrat au moment d'une modification (tpm_zone_overrides.expected_state). */
const DEFAULT_STATES = ['contrat', 'sans_contrat', 'a_arbitrer'];
/** États qui portent un TPM (provider_id NOT NULL) — « à arbitrer » porte le TPM par défaut. */
const WITH_PROVIDER = ['contrat', 'modifie', 'a_arbitrer'];
/** Origine du TPM d'une visite : la zone, la visite elle-même (raison), ou la reprise de l'existant. */
const VISIT_SOURCES = ['zone', 'visite', 'reprise'];
/** Statuts d'un contrat qui peuvent couvrir un mois. */
const COVERING_STATUSES = ['actif', 'resilie'];
/** Actions du journal (tpm_attribution_log.action). */
const LOG_ACTIONS = ['modifier', 'confirmer', 'revenir_contrat', 'reappliquer', 'visite_modifier', 'visite_garder', 'visite_zone'];
/** Liens de la règle commune qui désignent le TPM d'un contrat (jamais « visite » : elle en découle). */
const TPM_LINK_KINDS = ['plan', 'rapport'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // ordre binaire, comme COLLATE "C"
const monthOfDate = (d) => (d ? String(d).slice(0, 7) : null);

/** Règle commune (lot 8) : contrat de suivi, contrat qui couvre un mois. */
const { contractCoversMonth, isMonitoringContract } = activeProvider;

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
    const via = Array.isArray(l.via) ? l.via : [l.via];
    if (!p || p.active === false || p.typeCode !== 'tpm' || !via.some((v) => TPM_LINK_KINDS.includes(v))) continue;
    if (!out.has(l.contractId)) out.set(l.contractId, new Map());
    out.get(l.contractId).set(p.id, { id: p.id, name: p.name });
  }
  return new Map([...out].map(([k, m]) => [k, [...m.values()].sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id))]));
}

/** D1 : TPM d'un contrat = ses TPM rattachés (plans, factures), sinon son titulaire. */
function contractTpms(c) {
  if (!c) return [];
  if (Array.isArray(c.tpms) && c.tpms.length) return c.tpms;
  return c.partnerId ? [{ id: c.partnerId, name: c.partnerName || null }] : [];
}
/** Le TPM « principal » d'un contrat (le premier de contractTpms). */
const contractTpm = (c) => (contractTpms(c)[0] || {}).id || null;

/** Dernier mois couvert : mois de fin, ou mois de résiliation pour un contrat résilié. */
function contractEndMonth(c) {
  return c.status === 'resilie' ? monthOfDate(c.terminationDate) : monthOfDate(c.dateFin);
}

/** Contrats de suivi avec un TPM qui couvrent M. */
const coveringContracts = (contracts, m) =>
  (contracts || []).filter((c) => isMonitoringContract(c) && contractTpms(c).length && contractCoversMonth(c, m));

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
 * défaut (byDefault) — jamais un blanc.
 * @returns {{ state:'contrat'|'sans_contrat'|'a_arbitrer', providerId, contractId, numero, contractLabel,
 *            candidates:[{providerId, providerName, contractId, numero, contractLabel, dateDebut, zonePath, via, endMonth}],
 *            partiel:boolean, exactHit:boolean }}
 */
function defaultFor(area, month, contracts) {
  const hits = [];
  let partiel = false;
  for (const c of coveringContracts(contracts, month)) {
    for (const z of c.zones || []) {
      const cov = coverOf(area, z);
      if (cov === 'exact' || cov === 'ancetre') hits.push({ c, z, cov });
      else if (cov === 'descendant') partiel = true;
    }
  }
  const exactHit = hits.some((h) => h.cov === 'exact');
  if (!hits.length) return { state: 'sans_contrat', providerId: null, contractId: null, numero: null, contractLabel: null, candidates: [], partiel, exactHit };
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
    candidates, partiel, exactHit,
  };
}

/** Libellé de ce que dit le contrat (instantané d'une modification, journal). */
function defaultLabel(def, partnersById) {
  const name = (c) => (partnersById && partnersById.get(c.providerId) ? partnersById.get(c.providerId).name : c.providerName) || '—';
  if (def.state === 'contrat') return `${def.candidates[0].contractLabel || def.candidates[0].numero} · ${name(def.candidates[0])}`.slice(0, 300);
  if (def.state === 'a_arbitrer') return `${def.candidates.length} contrats : ${def.candidates.map((c) => `${name(c)} (${c.contractLabel || c.numero})`).join(', ')}`.slice(0, 300);
  return 'Sans contrat';
}

/**
 * Cellule retenue : la modification si elle existe (TPM ou « aucun TPM »), sinon le contrat.
 * Drapeaux : a_confirmer (le contrat a changé depuis la décision), redondante (la
 * modification rejoint le contrat), partiel, hors_contrat (TPM modifié qui ne tient aucun
 * contrat de suivi ce mois), titulaire_non_tpm, prestataire_inactif.
 * @param {object} def  defaultFor(...)
 * @param {object|null} override  modification de la zone pour ce mois
 * @param {{ partnersById?: Map, holders?: Set<string> }} ctx  holders = titulaires du mois
 */
function resolveCell(def, override, { partnersById = new Map(), holders = null } = {}) {
  const flags = [];
  let cell;
  if (override) {
    const providerId = override.providerId || null;
    const cand = providerId ? def.candidates.find((x) => x.providerId === providerId) : null;
    cell = {
      state: providerId ? 'modifie' : 'aucun_tpm', providerId,
      contractId: cand ? cand.contractId : null, numero: cand ? cand.numero : null, contractLabel: cand ? cand.contractLabel : null,
    };
    if ((override.expectedState || null) !== def.state || (override.expectedProviderId || null) !== (def.providerId || null)) flags.push('a_confirmer');
    if ((def.state === 'contrat' && def.providerId === providerId) || (def.state === 'sans_contrat' && providerId === null)) flags.push('redondante');
    if (providerId && holders && !holders.has(providerId)) flags.push('hors_contrat');
  } else {
    cell = { state: def.state, providerId: def.providerId || null, contractId: def.contractId || null, numero: def.numero || null, contractLabel: def.contractLabel || null };
  }
  if (def.partiel) flags.push('partiel');
  const p = cell.providerId ? partnersById.get(cell.providerId) : null;
  if (p && p.typeCode !== 'tpm') flags.push('titulaire_non_tpm');
  if (p && p.active === false) flags.push('prestataire_inactif');
  const fallbackName = cell.providerId ? (def.candidates.find((x) => x.providerId === cell.providerId) || {}).providerName : null;
  return { ...cell, providerName: p ? p.name : (fallbackName || null), override: override || null, default: def, flags };
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

/** Titulaires (ensemble d'identifiants) de chaque mois. */
function holdersByMonth(contracts, months) {
  return new Map(months.map((m) => [m, new Set(coveringContracts(contracts, m).flatMap((c) => contractTpms(c).map((t) => t.id)))]));
}

/**
 * Qualité des données qui alimentent la règle (bannières de l'onglet) — sur les contrats de
 * suivi « actif » ou « résilié » qui chevauchent les mois lus.
 */
function qualityOf({ contracts = [], partners = [], overrides = [], months = [], today = null }) {
  const partnersById = new Map(partners.map((p) => [p.id, p]));
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
  // Contrat sans TPM rattaché (aucun plan, aucune facture d'un TPM) : son titulaire est retenu.
  const holders = new Map();
  for (const c of overlapping) {
    for (const t of contractTpms(c)) {
      const p = partnersById.get(t.id);
      if (p && p.typeCode !== 'tpm') holders.set(p.id, { providerId: p.id, name: p.name, typeCode: p.typeCode });
    }
  }
  return {
    detachedContractZones,
    tooFineZones,
    contractsWithoutHolder: overlapping.filter((c) => !contractTpms(c).length).map(ref),
    contractsWithoutTpm: overlapping.filter((c) => !(Array.isArray(c.tpms) && c.tpms.length) && c.partnerId)
      .map((c) => ({ ...ref(c), holder: c.partnerName || null })),
    holdersNotTpm: [...holders.values()].sort((a, b) => cmp(a.name, b.name)),
    expiredStillActive: today
      ? overlapping.filter((c) => c.status === 'actif' && monthOfDate(c.dateFin) < today).map((c) => ({ ...ref(c), endMonth: monthOfDate(c.dateFin), holder: c.partnerName || null }))
      : [],
    detachedOverrides: overrides.filter((o) => !o.adminAreaId && o.month >= first && o.month <= last)
      .map((o) => ({ id: o.id, path: o.areaPath, month: o.month })),
  };
}

/**
 * Table zone × mois. `areas` = districts et communes de l'onglet (une commune n'a sa propre
 * ligne que si une modification y est posée ou si une zone de contrat est exactement sur elle :
 * `own`). Taille bornée par l'appelant (≤ MAX_CELLS côté écriture).
 * @returns {{ cells: Map<string, object>, quality: object, partnersById: Map }}
 */
function buildZoneTable({ areas = [], months = [], contracts = [], overrides = [], partners = [], today = null }) {
  const partnersById = new Map(partners.map((p) => [p.id, p]));
  const ovByKey = new Map(overrides.filter((o) => o.adminAreaId).map((o) => [`${o.adminAreaId}|${o.month}`, o]));
  const holders = holdersByMonth(contracts, months);
  const detached = detachedZones(contracts, months);
  const cells = new Map();
  for (const a of areas) {
    for (const m of months) {
      const def = defaultFor(a, m, contracts);
      const ov = ovByKey.get(`${a.id}|${m}`) || null;
      const cell = resolveCell(def, ov, { partnersById, holders: holders.get(m) });
      // Aucun contrat ne couvre, mais un contrat de suivi y a une zone détachée de même nom : indice.
      const hint = cell.state === 'sans_contrat' ? detachedHintFor(a, m, detached) : [];
      if (hint.length) { cell.flags.push('zone_a_reselectionner'); cell.detached = hint; }
      cells.set(`${a.id}|${m}`, { areaId: a.id, month: m, own: Number(a.depth) === 3 ? Boolean(ov || def.exactHit) : true, ...cell });
    }
  }
  return { cells, quality: qualityOf({ contracts, partners, overrides, months, today }), partnersById };
}

/**
 * Cellule qui s'applique à un site un mois donné : sa commune si elle a sa propre ligne ce
 * mois-là, sinon son district. Sans district reconnu : « district inconnu », aucun TPM.
 */
function cellForSite({ districtId, communeId }, month, table) {
  if (!districtId) return { areaId: null, month, state: 'district_inconnu', providerId: null, contractId: null, flags: [] };
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
  c.flags.includes('zone_a_reselectionner') ? 1 : 0].join('|');

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
    const nothing = def.state === 'sans_contrat' && p === null;
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

/** Mois de `months` où le prestataire n'est PAS sélectionnable (ni actif ce mois-là, ni TPM actif). */
function notSelectableMonths(providerId, months, selectable) {
  if (!providerId) return [];
  const group = (key) => ((selectable.groups || []).find((g) => g.key === key) || { providers: [] }).providers;
  if (group('tpm').some((p) => p.id === providerId)) return [];
  const h = group('contrat').find((p) => p.id === providerId);
  return months.filter((m) => !h || !h.months.includes(m));
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
  provider_not_selectable: 'Ce prestataire n\'est pas sélectionnable au mois de la visite (ni titulaire d\'un contrat de suivi, ni TPM actif).',
  visit_unknown: 'Visite inconnue (ou hors de ce compte).',
  action_unknown: 'Action inconnue.',
};
/** Message d'une erreur de décision, avec le site et le mois quand on les connaît. */
const visitErrorMessage = (res) => `${VISIT_ERROR_MESSAGES[res.error] || 'Données invalides.'}${res.visit ? ` (${res.visit.siteName} · ${res.visit.month})` : ''}`;

module.exports = {
  VISIT_ERROR_MESSAGES, visitErrorMessage, TPM_LINK_KINDS, tpmsByContract, contractTpms,
  MAX_SPAN_MONTHS, MAX_AREAS, MAX_REGIONS, MAX_CELLS, MAX_VISITS,
  ZONE_STATES, VISIT_ZONE_STATES, DEFAULT_STATES, WITH_PROVIDER, VISIT_SOURCES, COVERING_STATUSES, LOG_ACTIONS,
  contractTpm, isMonitoringContract, contractEndMonth, contractCoversMonth, coveringContracts, coverOf,
  defaultFor, defaultLabel, resolveCell, holdersByMonth, qualityOf, buildZoneTable, cellForSite, segments, stampOf,
  planOverrides, planRevert, restampPlan, summarizeRestamp, selectableProviders, activeProviders, notSelectableMonths,
  visitDecision, districtAreaFor, detachedZones, detachedHintFor,
};
