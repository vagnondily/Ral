import { formatInt, monthLabel, shiftMonth, shortMonthLabel } from './format.js';
import { ROLE_LABELS } from './roles.js';

/**
 * Affectation des TPM par zone (retour 58) — statuts et libellés partagés par l'onglet
 * « Affectation des TPM », la colonne du Plan de suivi et Affectation & visites.
 * Statut = couleur + icône + libellé (jamais la couleur seule) : rendu par <StatusBadge def={…} />.
 * Les calculs font foi côté serveur (modules/tpm/tpmAttribution.js) ; ici on n'affiche que.
 */

/**
 * SUIVI INTERNE (retour 114) : sans TPM, la zone est suivie par l'équipe S&E — une affectation,
 * jamais « à affecter ». Partout le même badge : « Interne » (ROLE_LABELS.noTpm), ton bleu, icône
 * équipe ; `why` dit pourquoi (aucun contrat, contrat sans TPM, TPM indisponible, décidé, district
 * inconnu). États serveur : tpmAttribution.INTERNAL_VISIT_STATES.
 */
const INTERNAL = { label: ROLE_LABELS.noTpm, tone: 'blue', icon: 'team' };
export const INTERNAL_STATES = ['sans_contrat', 'sans_tpm', 'indisponible', 'aucun_tpm', 'district_inconnu'];
export const isInternalState = (s) => INTERNAL_STATES.includes(s);
/** Infobulle du badge « Interne » d'une zone ou d'une visite. */
export const INTERNAL_HINT = 'Suivi interne (équipe S&E) : aucun TPM retenu pour cette zone ce mois-là. Pour la confier à un TPM : onglet Affectation des TPM.';

/** État d'une zone × mois (TPM retenu). */
export const TPM_ZONE_STATE = {
  contrat: { label: 'Selon contrat', tone: 'green', icon: 'check' },
  modifie: { label: 'Modifié', tone: 'orange', icon: 'edit' },
  a_arbitrer: { label: 'Plusieurs contrats : choisir', tone: 'orange', icon: 'warn' },
  sans_contrat: { ...INTERNAL, why: 'aucun contrat de suivi' },
  sans_tpm: { ...INTERNAL, why: 'contrat sans TPM' },
  indisponible: { ...INTERNAL, why: 'TPM indisponible' },
  aucun_tpm: { ...INTERNAL, why: 'décidé, avec une raison' },
  district_inconnu: { ...INTERNAL, why: 'district du site non reconnu' },
};

/**
 * Pourquoi « Interne » (cellule de zone de la règle : { state, noTpm, unavailable, reason }) :
 * « aucun contrat de suivi sur cette zone », « contrat FLA-… sans TPM », « TPM X indisponible : motif »…
 */
export function internalWhy(tr, c) {
  if (!c) return '';
  switch (c.state) {
    case 'sans_tpm': return (c.noTpm || []).length
      ? tr('contrat sans TPM : {c}', { c: c.noTpm.map((k) => `${k.contractLabel || k.numero}${k.holderName ? ` (${k.holderName})` : ''}`).join(', ') })
      : tr('contrat de suivi sans TPM');
    case 'indisponible': return (c.unavailable || []).length
      ? tr('TPM indisponible : {list}', { list: c.unavailable.map((u) => `${u.providerName || '—'}${u.reason ? ` — ${u.reason}` : ''}`).join(' ; ') })
      : tr('TPM du contrat indisponible ce mois');
    case 'aucun_tpm': return c.reason ? tr('décidé : {r}', { r: c.reason }) : tr('décidé, avec une raison');
    case 'district_inconnu': return tr('district du site non reconnu');
    case 'sans_contrat': return tr('aucun contrat de suivi sur la zone');
    default: return '';
  }
}

/**
 * Contrats de suivi d'une zone sur la période (colonne « Contrat(s) de suivi » de l'onglet), un par
 * contrat : ceux qui donnent un TPM (candidates), puis ceux SANS TPM (noTpm, `noTpm: true`) — une
 * zone couverte par un contrat sans TPM n'est jamais « aucun contrat de suivi ».
 */
export function zoneContracts(row) {
  const out = [];
  const seen = new Set();
  const add = (c, noTpm) => { if (!c || !c.contractId || seen.has(c.contractId)) return; seen.add(c.contractId); out.push({ ...c, noTpm }); };
  for (const s of (row && row.contractSegments) || []) for (const c of s.candidates || []) add(c, false);
  for (const s of (row && row.contractSegments) || []) for (const c of s.noTpm || []) add(c, true);
  return out;
}

/** N° du (des) contrat(s) d'un segment « selon contrat » (CSV) : le contrat retenu, sinon ceux sans TPM. */
export const segmentContractLabel = (c) => (c && (c.contractLabel
  || ((c.noTpm || []).map((k) => k.contractLabel || k.numero).filter(Boolean).join(', ')))) || '';

/** Indisponibilité d'un TPM (onglet Affectation des TPM, journal) : couleur + icône + libellé. */
export const TPM_AVAILABILITY = {
  disponible: { label: 'Disponible', tone: 'green', icon: 'check' },
  indisponible: { label: 'Indisponible', tone: 'orange', icon: 'ban' },
};

/** Drapeaux d'une cellule (affichés à côté de l'état). */
export const TPM_FLAGS = {
  a_confirmer: { label: 'À confirmer (contrat changé)', tone: 'orange', icon: 'clock' },
  partiel: { label: 'Partiel (par commune)', tone: 'blue', icon: 'dot' },
  hors_contrat: { label: 'TPM hors contrat', tone: 'orange', icon: 'warn' },
  prestataire_inactif: { label: 'TPM désactivé', tone: 'red', icon: 'ban' },
  zone_a_reselectionner: { label: 'Zone de contrat à resélectionner', tone: 'orange', icon: 'warn' },
  modification_suspendue: { label: 'Modification suspendue (TPM indisponible)', tone: 'orange', icon: 'clock' },
  tpm_indisponible: { label: 'Un TPM du contrat est indisponible', tone: 'orange', icon: 'clock' },
};
/** Drapeaux montrés ligne par ligne (« titulaire non TPM » est dit une fois, en bannière). */
export const ROW_FLAGS = ['a_confirmer', 'hors_contrat', 'prestataire_inactif', 'zone_a_reselectionner', 'modification_suspendue', 'tpm_indisponible', 'partiel'];

/**
 * Aucun contrat ne couvre la zone, mais un contrat de suivi y a une zone DÉTACHÉE de même nom
 * (découpage réimporté) : « zone du contrat X à resélectionner » — jamais un TPM deviné.
 */
export const detachedHint = (tr, cell) => ((cell && (cell.flags || []).includes('zone_a_reselectionner') && (cell.detached || []).length)
  ? tr('zone à resélectionner (avenant) : contrat {n}', { n: cell.detached.map((d) => d.contractLabel || d.numero).join(', ') })
  : null);

/** TPM d'une visite : origine (zone / visite / reprise) + état de sa zone. */
export const TPM_VISIT = {
  'zone:contrat': { label: 'Selon contrat', tone: 'green', icon: 'check' },
  'zone:modifie': { label: 'Modifié (zone)', tone: 'orange', icon: 'edit' },
  'zone:a_arbitrer': { label: 'Plusieurs contrats : choisir', tone: 'orange', icon: 'warn' },
  'zone:sans_contrat': { ...INTERNAL, label: 'Interne — aucun contrat de suivi' },
  'zone:sans_tpm': { ...INTERNAL, label: 'Interne — contrat sans TPM' },
  'zone:indisponible': { ...INTERNAL, label: 'Interne — TPM indisponible' },
  'zone:aucun_tpm': { ...INTERNAL, label: 'Interne — décidé pour la zone' },
  'zone:district_inconnu': { ...INTERNAL, label: 'Interne — district inconnu' },
  'zone:anterieur': { label: 'Antérieur à la règle', tone: null, icon: 'na' },
  'zone:': { label: 'En cours d\'affectation', tone: null, icon: 'clock' },
  visite: { label: 'Modifié pour cette visite', tone: 'orange', icon: 'edit' },
  'visite:interne': { ...INTERNAL, label: 'Interne — choisi pour cette visite' },
  reprise: { label: 'TPM saisi avant la règle', tone: 'blue', icon: 'draft' },
};

/** Actions du journal d'affectation (tpm_attribution_log.action) : couleur + icône + libellé. */
export const TPM_LOG_ACTION = {
  modifier: { label: 'TPM modifié', tone: 'orange', icon: 'edit' },
  confirmer: { label: 'Modification confirmée', tone: 'green', icon: 'check' },
  revenir_contrat: { label: 'Retour au contrat', tone: 'blue', icon: 'dot' },
  reappliquer: { label: 'TPM des contrats appliqués', tone: 'blue', icon: 'check' },
  visite_modifier: { label: 'TPM d\'une visite modifié', tone: 'orange', icon: 'edit' },
  visite_garder: { label: 'TPM saisi avant la règle gardé', tone: 'orange', icon: 'edit' },
  visite_zone: { label: 'Visite rendue à sa zone', tone: 'green', icon: 'check' },
  indispo_poser: { label: 'TPM déclaré indisponible', tone: 'orange', icon: 'ban' },
  indispo_modifier: { label: 'Motif d\'indisponibilité modifié', tone: 'orange', icon: 'edit' },
  indispo_retirer: { label: 'Fin d\'indisponibilité', tone: 'green', icon: 'check' },
};

/** Libellé d'un état inscrit au journal : état de zone, origine de visite (« visite », « reprise »). */
export const tpmStateLabel = (s) => (TPM_ZONE_STATE[s] || TPM_VISIT[s] || TPM_VISIT[`zone:${s}`] || {}).label || s || '';

/** Clé TPM_VISIT d'une visite ({ providerSource, providerZoneState }). */
export function visitTpmKey(v) {
  const src = v.providerSource || 'zone';
  if (src === 'visite' && !v.providerId) return 'visite:interne';
  return src === 'zone' ? `zone:${v.providerZoneState || ''}` : src;
}

/**
 * Une visite est-elle suivie EN INTERNE (équipe S&E) ? La colonne générée site_visits.monitored_by
 * (retour 114, jumelle serveur tpmAttribution.monitoredByOf) ; repli sur l'état pour une ancienne réponse.
 */
export const visitInternal = (v) => (v.monitoredBy ? v.monitoredBy === 'interne'
  : !v.providerId && ((v.providerSource || 'zone') === 'visite' || ((v.providerSource || 'zone') === 'zone' && isInternalState(v.providerZoneState))));

/**
 * Visite que PERSONNE ne suit (monitored_by = 'non_affecte' : antérieure à la règle sans TPM connu) —
 * un seul nom partout (cellule, CSV, matrice, alerte, carte), jumeau de fieldMath.UNIT_LABELS.non_affecte.
 * Jamais une visite interne : celle-là est suivie par l'équipe S&E.
 */
export const UNASSIGNED_LABEL = 'Non affectée (ni TPM ni suivi interne)';
export const visitUnassigned = (v) => !v.providerId && !visitInternal(v);
/** Qui suit une visite, en clair (CSV, tri) : son TPM, « Interne » ou « Non affectée (…) ». */
export const visitWho = (tr, v) => v.providerName || (v.providerId ? '' : tr(visitInternal(v) ? ROLE_LABELS.noTpm : UNASSIGNED_LABEL));

/**
 * Compte rendu de « Appliquer les TPM des contrats » (Affectation & visites, onglet Affectation des
 * TPM) : visites PRÉVUES mises à jour, et celles gardées telles quelles (réalisées ou annulées, déjà
 * facturées, au TPM motivé, antérieures à la règle) — `v` = réponse `visits` de POST /apply.
 */
export function applyResultMessage(tr, v, emptyPhrase) {
  const k = (v && v.kept) || {};
  const kept = [
    k.done && tr('{n} réalisée(s) ou annulée(s)', { n: formatInt(k.done) }),
    k.invoiced && tr('{n} déjà facturée(s)', { n: formatInt(k.invoiced) }),
    k.reasoned && tr('{n} au TPM motivé', { n: formatInt(k.reasoned) }),
    k.anterieur && tr('{n} antérieure(s) à la règle', { n: formatInt(k.anterieur) }),
  ].filter(Boolean);
  const main = v && v.changed
    ? tr('TPM des contrats appliqués : {n} visite(s) prévue(s) mise(s) à jour sur {t}.', { n: formatInt(v.changed), t: formatInt(v.visits) })
    : tr(emptyPhrase);
  return kept.length ? `${main} ${tr('Gardées telles quelles : {list}.', { list: kept.join(', ') })}` : main;
}

/** Libellé d'une plage de mois : « Octobre 2026 » ou « oct. 26 – déc. 26 ». */
export function rangeLabel(from, to) {
  if (!from) return '';
  return from === to ? monthLabel(from) : `${shortMonthLabel(from)} – ${shortMonthLabel(to)}`;
}

/** Plage la plus longue d'une décision et de la liste des indisponibilités (serveur : tpmAttribution.MAX_SPAN_MONTHS). */
export const UNAVAILABILITY_MAX_SPAN = 24;

/**
 * Plage lue par la vue « Indisponibilités » (U5) : du plus tôt entre le début de la période de
 * l'onglet et le mois courant, jusqu'à 6 mois après sa fin — jamais plus de 24 mois (plafond de
 * GET /unavailability : au-delà, 400 et vue inutilisable). `capped` : la fin a été rapprochée.
 */
export function unavailabilityListRange(period, today, max = UNAVAILABILITY_MAX_SPAN) {
  const from = period.from <= today ? period.from : today;
  const wanted = shiftMonth(period.to, 6);
  const cap = shiftMonth(from, max - 1);
  return { from, to: wanted <= cap ? wanted : cap, capped: wanted > cap };
}

/**
 * « Mettre fin » à une période d'indisponibilité (U4, U7) : dès le mois courant pour une période en
 * cours ou à venir (le passé reste tel qu'il a été vécu) ; une période ENTIÈREMENT passée (déclarée
 * sur des mois échus, par erreur par exemple) se retire sur ses propres bornes — elle compte encore
 * pour l'estampille des visites prévues et les rapports attendus, on doit pouvoir la défaire.
 * Jamais « du » après « au ». `past` : période entièrement passée. null sans période.
 */
export function endRangeOf(p, today) {
  if (!p || !p.from || !p.to) return null;
  if (p.to < today) return { from: p.from, to: p.to, past: true };
  return { from: p.from < today ? today : p.from, to: p.to, past: false };
}

/** Mois de from à to inclus (« AAAA-MM »), au plus `max`. */
export function monthsBetween(from, to, max = 60) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < max) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Suggestions de motif d'indisponibilité d'un TPM (insèrent un texte modifiable). */
export const UNAVAILABILITY_SUGGESTIONS = [
  'Équipe mobilisée sur une autre mission',
  'Contrat du TPM suspendu',
  'Accès / sécurité',
  'Capacité insuffisante du TPM',
];

/** Suggestions de raison (insèrent un texte modifiable). */
export const REASON_SUGGESTIONS = [
  'Contrat en cours de renouvellement',
  'Capacité insuffisante du TPM',
  'Accès / sécurité',
  'Arbitrage entre deux contrats',
];

/** Bornes de la raison (comme le serveur : common/reasonText, CHECK de la migration 070). */
export const REASON_MIN = 10;
export const REASON_MAX = 500;

/**
 * Indisponibilité ACTUELLE ou PROCHAINE d'un TPM (badges des écrans partenaires et contrats) : lue
 * dans la réponse de GET /api/tpm/attribution/unavailability — les périodes du serveur, une seule
 * source, rien n'est recalculé — au mois courant du serveur (`period.from` de cette réponse).
 * @param {{ period?: { from }, periods?: { providerId, from, to, reason }[] } | null} data
 * @returns {{ from, to, reason, current: boolean } | null}  current = le mois courant en fait partie
 */
export function unavailabilityOf(data, providerId) {
  const month = data && data.period && data.period.from;
  if (!month || !providerId) return null;
  const next = (data.periods || []).filter((p) => p.providerId === providerId && p.to >= month)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))[0];
  return next ? { from: next.from, to: next.to, reason: next.reason || null, current: next.from <= month } : null;
}

/**
 * Qui suit les zones d'un contrat CE MOIS (ligne « TPM » du détail d'un contrat, relecture croisée
 * #5 / #8) : lu dans les cellules de l'onglet Affectation des TPM — GET /api/tpm/attribution sur UN
 * mois, la règle même des visites (modules/tpm/tpmAttribution.js), rien de recalculé —, jamais
 * déduit du nombre de zones : une modification, une indisponibilité ou un autre contrat qui décide
 * d'une zone y apparaissent.
 * @param {{ adminAreaId?: string }[]} zones  zones du contrat (détail)
 * @param {{ id: string }[]} tpms  TPM du contrat
 * @param {{ rows?: { id, name, cells }[] } | null} table  réponse de l'onglet pour un mois
 * @returns {null | { total: number, followed: number, others: { areaId, name, cell }[] }}
 *   null : réponse absente, ou une zone sans ligne dans l'onglet (zone à resélectionner, région
 *   entière, commune qui ne décide pas) — l'écran dit alors la phrase toujours vraie.
 */
export function contractZoneFollow(zones, tpms, table) {
  const list = zones || [];
  if (!table || !Array.isArray(table.rows) || !list.length) return null;
  const ids = new Set((tpms || []).map((t) => t.id));
  const byId = new Map(table.rows.map((r) => [r.id, r]));
  let followed = 0;
  const others = [];
  for (const z of list) {
    const row = z && z.adminAreaId ? byId.get(z.adminAreaId) : null;
    const cell = row && row.cells && row.cells[0];
    if (!cell) return null;
    if (cell.monitoredBy === 'tpm' && ids.has(cell.providerId)) followed += 1;
    else others.push({ areaId: row.id, name: row.name, cell });
  }
  return { total: list.length, followed, others };
}

/** Pourquoi une zone du contrat n'est pas suivie par son TPM ce mois (cellule de l'onglet). */
function zoneOtherWhy(tr, cell, contractId) {
  if (cell.state === 'modifie' || cell.state === 'aucun_tpm') return tr('modification'); // aucun_tpm : modification « aucun TPM »
  if (cell.state === 'indisponible') return tr('TPM indisponible');
  if (isInternalState(cell.state)) return internalWhy(tr, cell);
  if (cell.contractId && cell.contractId !== contractId) return tr('autre contrat : {c}', { c: cell.contractLabel || cell.numero || '—' });
  return '';
}

const ZONE_FOLLOW_LISTED = 3;
/** Phrase toujours vraie quand les cellules manquent : la règle, et où la lire. */
export const ZONE_FOLLOW_DEFAULT = 'zones du contrat, sauf modification ou indisponibilité — voir Affectation des TPM';

/**
 * Phrase de la ligne « TPM » : « suit les 2 zones du contrat ce mois », ou « suit 1 des 2 zones ce
 * mois · Betroka : RANO Control (modification) » ; la phrase toujours vraie (ZONE_FOLLOW_DEFAULT)
 * quand contractZoneFollow rend null. Trois zones nommées au plus, puis « +n autre(s) ».
 * @param {Function} tr  traduction
 * @param {ReturnType<typeof contractZoneFollow>} follow
 * @param {string} contractId
 * @returns {string}
 */
export function contractZoneFollowText(tr, follow, contractId) {
  if (!follow) return tr(ZONE_FOLLOW_DEFAULT);
  const { total, followed, others } = follow;
  let head;
  if (!others.length) head = total > 1 ? tr('suit les {n} zones du contrat ce mois', { n: total }) : tr('suit la zone du contrat ce mois');
  else if (!followed) head = tr('ne suit aucune zone du contrat ce mois');
  else head = tr('suit {k} des {n} zones ce mois', { k: followed, n: total });
  const items = others.slice(0, ZONE_FOLLOW_LISTED).map((o) => {
    const who = o.cell.monitoredBy === 'tpm' ? (o.cell.providerName || '—') : tr(ROLE_LABELS.noTpm);
    const why = zoneOtherWhy(tr, o.cell, contractId);
    return why ? tr('{zone} : {who} ({why})', { zone: o.name, who, why }) : tr('{zone} : {who}', { zone: o.name, who });
  });
  if (others.length > ZONE_FOLLOW_LISTED) items.push(tr('+{n} autre(s)', { n: others.length - ZONE_FOLLOW_LISTED }));
  return [head, ...items].join(' · ');
}

/**
 * Pourquoi les visites des zones d'un titulaire sont suivies en interne (fiche 360°, `internalReasons` :
 * serveur partnerSheet.INTERNAL_REASONS) — jamais une phrase fixe : un contrat sans TPM, un TPM
 * indisponible ou retiré avec un motif ; pour une visite réalisée, l'estampille figée au moment de la visite.
 */
export const INTERNAL_REASON_LABELS = {
  sans_tpm: 'contrat sans TPM',
  indisponible: 'TPM indisponible',
  retire: 'TPM retiré avec motif',
  sans_contrat: 'aucun contrat de suivi lors de la visite',
  district_inconnu: 'district du site non reconnu lors de la visite',
};

/** Infobulle : « Suivi interne (équipe S&E) : contrat sans TPM (2) · TPM indisponible (1) » ; repli générique. */
export function internalReasonsHint(tr, reasons) {
  const parts = Object.keys(INTERNAL_REASON_LABELS).filter((k) => reasons && reasons[k] > 0)
    .map((k) => tr('{why} ({n})', { why: tr(INTERNAL_REASON_LABELS[k]), n: reasons[k] }));
  return parts.length ? tr('Suivi interne (équipe S&E) : {list}', { list: parts.join(' · ') }) : tr(INTERNAL_HINT);
}

/**
 * Raisons écrites par le SYSTÈME au journal (serveur tpmAttribution.SYSTEM_LOG_REASONS) : le serveur
 * envoie un code (`reasonKey`), l'écran le traduit — les lignes anciennes, en phrase française, sont
 * reconnues par le serveur et arrivent avec le même code.
 */
export const SYSTEM_LOG_REASONS = {
  partner_not_tpm: 'Le partenaire n\'est plus un TPM actif (type changé ou fiche désactivée) : visites prévues rendues à leur zone.',
};
/** Raison d'une ligne du journal à afficher : traduite pour le système, telle quelle pour une personne. */
export function logReasonText(tr, l) {
  if (l && l.reasonKey) return SYSTEM_LOG_REASONS[l.reasonKey] ? tr(SYSTEM_LOG_REASONS[l.reasonKey]) : null;
  return (l && l.reason) || null;
}
/** Portée d'un lot « N visite(s) » (libellé écrit en français par le serveur) : traduite à l'affichage. */
export function logLabelText(tr, l) {
  const m = /^(\d+) visite\(s\)$/.exec(String((l && l.label) || ''));
  return m ? tr('{n} visite(s)', { n: formatInt(Number(m[1])) }) : (l && l.label) || '';
}
