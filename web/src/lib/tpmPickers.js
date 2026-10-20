/**
 * Options des listes « Contrat suivi » et « TPM » (Planification & budget, facture) —
 * logique pure, testée (server/test/webEntityPicker.test.js). Règle unique du retour 58 : le TPM d'un
 * contrat de suivi est le TPM rattaché (plans, factures), sinon son titulaire (`tpmsOf`).
 *
 *  - Contrat : libellé = n° FLA (sinon n° interne) ; précision = titulaire · période · TPM ; d'abord les contrats
 *    qui couvrent le mois du plan, puis les autres contrats actifs.
 *  - TPM : précision = ses contrats de suivi ; le contrat choisi, ses TPM viennent d'abord.
 *
 * Les libellés de groupe arrivent traduits (`labels`) ; `fmtPeriod(from, to)` met en forme une période
 * de mois « AAAA-MM ».
 */
const ym = (d) => (d ? String(d).slice(0, 7) : null);
const MAX_LISTED = 3;

/** Le contrat couvre-t-il le mois « AAAA-MM » ? (sans date de début ou de fin : ouvert de ce côté) */
export function contractCovers(c, month) {
  const m = ym(month);
  if (!m) return false;
  const a = ym(c.dateDebut); const b = ym(c.dateFin);
  return (!a || a <= m) && (!b || b >= m);
}

const listed = (names) => (names.length <= MAX_LISTED ? names.join(', ') : `${names.slice(0, MAX_LISTED).join(', ')} +${names.length - MAX_LISTED}`);

/**
 * @param {object[]} contracts  contexte des rapports (id, numero, numeroFla, partnerName = titulaire, dateDebut, dateFin)
 * @param {{ month?: string, tpmsOf?: (id) => {id,name}[], fmtPeriod?: Function,
 *           labels?: { covering?: string, others?: string, tpmList?: (names: string) => string } }} o
 * @returns {{ options: object[], order: string[] }}
 */
export function contractOptions(contracts, { month, tpmsOf = () => [], fmtPeriod, labels = {} } = {}) {
  const grouped = Boolean(month && labels.covering && labels.others);
  const options = (contracts || []).map((c) => {
    const tpms = tpmsOf(c.id) || [];
    const a = ym(c.dateDebut); const b = ym(c.dateFin);
    const period = a && b && fmtPeriod ? fmtPeriod(a, b) : null;
    // Une phrase entière à traduire (« TPM : X » / « TPM: X ») — jamais un collage de morceaux.
    const tpm = tpms.length ? (labels.tpmList ? labels.tpmList(listed(tpms.map((p) => p.name))) : `TPM : ${listed(tpms.map((p) => p.name))}`) : null;
    return {
      value: c.id,
      label: c.numeroFla || c.numero || '—',
      sub: [c.partnerName, period, tpm].filter(Boolean).join(' · ') || undefined,
      group: grouped ? (contractCovers(c, month) ? labels.covering : labels.others) : undefined,
      keywords: [c.numero, c.numeroFla, c.partnerName, ...tpms.map((p) => p.name)].filter(Boolean),
    };
  });
  return { options, order: grouped ? [labels.covering, labels.others] : [] };
}

/**
 * Groupes, dans l'ordre : « TPM de ce contrat » (un contrat choisi) → « Actifs ce mois-ci » (règle commune
 * « prestataire actif au mois M », retour 30, `isActive`) → les autres. Un groupe sans libellé fourni
 * n'est pas formé.
 * @param {{id,name}[]} partners  TPM actifs
 * @param {{ contracts?: object[], contractId?: string, tpmsOf?: Function, isActive?: (id) => boolean,
 *           labels?: { ofContract?: string, active?: string, others?: string, noContract?: string } }} o
 * @returns {{ options: object[], order: string[] }}
 */
export function tpmOptions(partners, { contracts = [], contractId = '', tpmsOf = () => [], isActive = null, labels = {} } = {}) {
  const own = new Set((contractId ? tpmsOf(contractId) || [] : []).map((p) => p.id));
  const byContract = Boolean(contractId && own.size && labels.ofContract);
  const byActivity = Boolean(isActive && labels.active && (partners || []).some((p) => isActive(p.id) && !own.has(p.id)));
  const grouped = Boolean((byContract || byActivity) && labels.others);
  const groupOf = (p) => {
    if (!grouped) return undefined;
    if (byContract && own.has(p.id)) return labels.ofContract;
    if (byActivity && isActive(p.id)) return labels.active;
    return labels.others;
  };
  const options = (partners || []).map((p) => {
    const mine = (contracts || []).filter((c) => (tpmsOf(c.id) || []).some((x) => x.id === p.id)).map((c) => c.numeroFla || c.numero).filter(Boolean);
    return { value: p.id, label: p.name, sub: mine.length ? listed(mine) : labels.noContract, group: groupOf(p), keywords: mine };
  });
  const order = grouped ? [byContract && labels.ofContract, byActivity && labels.active, labels.others].filter(Boolean) : [];
  return { options, order };
}

/**
 * Choisir le TPM propose son contrat : sans contrat choisi, le seul contrat de suivi dont il est
 * le TPM est pré-sélectionné (aucun ou plusieurs : le choix reste à faire). Un contrat déjà choisi ne
 * change jamais.
 */
export function withPartner(head, partnerId, contracts, tpmsOf = () => []) {
  if (head.contractId || !partnerId) return { ...head, partnerId };
  const own = (contracts || []).filter((c) => (tpmsOf(c.id) || []).some((p) => p.id === partnerId));
  return { ...head, partnerId, contractId: own.length === 1 ? own[0].id : '' };
}

/**
 * Choisir le contrat donne son TPM — sans jamais écraser un choix délibéré : le TPM unique du contrat
 * n'est pris que si aucun TPM n'est choisi, ou si le TPM choisi était venu du contrat PRÉCÉDENT
 * (pré-rempli, pas choisi). Un TPM choisi à la main est gardé ; l'écran signale l'écart
 * (« Ce TPM n'est pas celui de ce contrat »).
 */
export function withContract(head, contractId, tpmsOf = () => []) {
  const tpms = (contractId && tpmsOf(contractId)) || [];
  const prefilled = !head.partnerId || ((head.contractId && tpmsOf(head.contractId)) || []).some((p) => p.id === head.partnerId);
  if (!prefilled || tpms.length !== 1) return { ...head, contractId };
  return { ...head, contractId, partnerId: tpms[0].id };
}
