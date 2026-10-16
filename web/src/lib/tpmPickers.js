/**
 * Options des listes « Contrat suivi » et « Prestataire TPM » (Planification & budget, facture) —
 * logique pure, testée (server/test/webEntityPicker.test.js). Règle unique du retour 58 : le TPM d'un
 * contrat de suivi est le TPM rattaché (plans, factures), sinon son titulaire (`tpmsOf`).
 *
 *  - Contrat : libellé = n° du contrat ; précision = partenaire · période · TPM ; d'abord les contrats
 *    qui couvrent le mois du plan, puis les autres contrats actifs.
 *  - Prestataire TPM : précision = ses contrats de suivi ; le contrat choisi, ses TPM viennent d'abord.
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
 * @param {object[]} contracts  contexte des rapports (id, numero, partnerName, dateDebut, dateFin)
 * @param {{ month?: string, tpmsOf?: (id) => {id,name}[], fmtPeriod?: Function,
 *           labels?: { covering?: string, others?: string, tpm?: string } }} o
 * @returns {{ options: object[], order: string[] }}
 */
export function contractOptions(contracts, { month, tpmsOf = () => [], fmtPeriod, labels = {} } = {}) {
  const grouped = Boolean(month && labels.covering && labels.others);
  const options = (contracts || []).map((c) => {
    const tpms = tpmsOf(c.id) || [];
    const a = ym(c.dateDebut); const b = ym(c.dateFin);
    const period = a && b && fmtPeriod ? fmtPeriod(a, b) : null;
    const tpm = tpms.length ? `${labels.tpm || 'TPM'} : ${listed(tpms.map((p) => p.name))}` : null;
    return {
      value: c.id,
      label: c.numero || '—',
      sub: [c.partnerName, period, tpm].filter(Boolean).join(' · ') || undefined,
      group: grouped ? (contractCovers(c, month) ? labels.covering : labels.others) : undefined,
      keywords: [c.partnerName, ...tpms.map((p) => p.name)].filter(Boolean),
    };
  });
  return { options, order: grouped ? [labels.covering, labels.others] : [] };
}

/**
 * @param {{id,name}[]} partners  prestataires TPM actifs
 * @param {{ contracts?: object[], contractId?: string, tpmsOf?: Function,
 *           labels?: { ofContract?: string, others?: string, noContract?: string } }} o
 * @returns {{ options: object[], order: string[] }}
 */
export function tpmOptions(partners, { contracts = [], contractId = '', tpmsOf = () => [], labels = {} } = {}) {
  const own = new Set((contractId ? tpmsOf(contractId) || [] : []).map((p) => p.id));
  const grouped = Boolean(contractId && own.size && labels.ofContract && labels.others);
  const options = (partners || []).map((p) => {
    const mine = (contracts || []).filter((c) => (tpmsOf(c.id) || []).some((x) => x.id === p.id)).map((c) => c.numero).filter(Boolean);
    return {
      value: p.id,
      label: p.name,
      sub: mine.length ? listed(mine) : labels.noContract,
      group: grouped ? (own.has(p.id) ? labels.ofContract : labels.others) : undefined,
      keywords: mine,
    };
  });
  return { options, order: grouped ? [labels.ofContract, labels.others] : [] };
}

/**
 * Choisir le prestataire propose son contrat : sans contrat choisi, le seul contrat de suivi dont il est
 * le TPM est pré-sélectionné (aucun ou plusieurs : le choix reste à faire). Un contrat déjà choisi ne
 * change jamais.
 */
export function withPartner(head, partnerId, contracts, tpmsOf = () => []) {
  if (head.contractId || !partnerId) return { ...head, partnerId };
  const own = (contracts || []).filter((c) => (tpmsOf(c.id) || []).some((p) => p.id === partnerId));
  return { ...head, partnerId, contractId: own.length === 1 ? own[0].id : '' };
}

/**
 * Choisir le contrat donne son TPM : s'il n'a qu'un TPM et que le prestataire choisi n'en est pas un
 * (ou qu'aucun n'est choisi), ce TPM est pris ; un prestataire qui est un TPM du contrat est gardé ;
 * sinon le choix reste tel quel (l'écran signale l'écart).
 */
export function withContract(head, contractId, tpmsOf = () => []) {
  const tpms = (contractId && tpmsOf(contractId)) || [];
  const keep = head.partnerId && tpms.some((p) => p.id === head.partnerId);
  if (keep || tpms.length !== 1) return { ...head, contractId };
  return { ...head, contractId, partnerId: tpms[0].id };
}
