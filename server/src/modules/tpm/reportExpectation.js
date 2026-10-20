/**
 * Rapports attendus (retour 114 : « pas de planification → pas de rapport (non applicable d'office) ;
 * si c'est nous, un rapport pour nous ») — règle PURE, sans I/O, testée
 * (test/reportExpectation.test.js). Le SQL (reports.repository.expectedReports) lit les entrées ;
 * toute la décision vit ici. Recalculé en direct, rien de stocké : aucune écriture automatique sur
 * tpm_reports (un « non applicable d'office » redevient attendu dès qu'une visite est prévue).
 *
 * Pour chaque mois M de la période :
 *  - un TPM est retenu s'il est le TPM d'un contrat de suivi qui couvre M (décision D1 :
 *    tpmAttribution.holdersByMonth), s'il porte au moins une visite de M, ou s'il a une facture de M ;
 *    son rapport du mois (facture, rapport financier) est ATTENDU seulement s'il porte au moins une
 *    visite NON ANNULÉE de M (prévue ou réalisée). Sans visite : « non applicable » d'office —
 *    jamais « en retard ». Un document réel l'emporte toujours : soumis, validé, rejeté, ou
 *    « non applicable » saisi à la main ;
 *  - le SUIVI INTERNE (visites suivies par l'équipe S&E, site_visits.monitored_by = 'interne') :
 *    au moins une visite interne non annulée en M → un « rapport interne » est attendu, par
 *    l'équipe S&E des bureaux des sites concernés (dit à l'écran). Il n'a pas encore de document
 *    dans l'application : il reste « attendu », jamais « en retard ».
 *  - Échéance : le rapport du mois M se remet au plus tard au cours du mois M + DUE_MONTHS_AFTER ;
 *    au-delà, un rapport attendu et non remis est « en retard ».
 * Une visite que personne ne suit (antérieure à la règle, 'non_affecte') n'attend aucun rapport.
 */

const DUE_MONTHS_AFTER = 1;
/** Statuts d'un rapport attendu, à l'écran (couleur + icône + libellé côté interface). */
const EXPECTATION_STATUSES = ['attendu', 'en_retard', 'soumis', 'valide', 'rejete', 'non_applicable'];
/** Rang d'un document réel : le plus avancé l'emporte quand un TPM a plusieurs factures du mois. */
const DOC_RANK = { valide: 4, soumis: 3, rejete: 2, non_applicable: 1, attendu: 0 };
const INTERNAL = 'interne';
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Mois « AAAA-MM » + n. */
function addMonth(m, n) {
  const [y, mm] = String(m).slice(0, 7).split('-').map(Number);
  const i = y * 12 + (mm - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
/** Dernier mois pour remettre le rapport du mois M. */
const dueMonth = (m) => addMonth(m, DUE_MONTHS_AFTER);

/**
 * Statut d'un rapport de TPM pour un mois.
 * @param {{ visits: number, docs: { status }[], month: string, today: string, off?: boolean }} p
 *   visits = visites non annulées du TPM ce mois ; docs = ses factures du mois ; today = « AAAA-MM » ;
 *   off = TPM déclaré indisponible ce mois (retour 114)
 * @returns {{ status: string, expected: boolean, auto: boolean, reason: string }}
 *   auto = « non applicable » d'office (aucune visite, aucun document qui le dise) ;
 *   reason ∈ document, aucune_visite, tpm_indisponible, saisi_non_applicable, a_remettre, echeance_depassee
 */
function tpmStatus({ visits, docs, month, today, off = false }) {
  const best = [...(docs || [])].sort((a, b) => (DOC_RANK[b.status] ?? -1) - (DOC_RANK[a.status] ?? -1))[0] || null;
  const expected = visits > 0;
  if (best && ['valide', 'soumis', 'rejete'].includes(best.status)) return { status: best.status, expected, auto: false, reason: 'document' };
  if (!expected) return { status: 'non_applicable', expected, auto: !(best && best.status === 'non_applicable'), reason: off ? 'tpm_indisponible' : 'aucune_visite' };
  if (best && best.status === 'non_applicable') return { status: 'non_applicable', expected, auto: false, reason: 'saisi_non_applicable' };
  const late = today > dueMonth(month);
  return { status: late ? 'en_retard' : 'attendu', expected, auto: false, reason: late ? 'echeance_depassee' : 'a_remettre' };
}

/**
 * Rapports attendus d'une période.
 * @param {{
 *   months: string[], today: string,
 *   activity: { key: string, name?: string, month: string, planned: number, realised: number, cancelled?: number, offices?: string[] }[],
 *   contractTpms?: Map<string, Set<string>>,   mois → TPM des contrats de suivi qui le couvrent (D1)
 *   names?: Map<string, string>,              TPM → nom
 *   reports?: { id, partnerId, partnerName?, contractId?, contractLabel?, month, status }[],  factures de la période
 *   unavailable?: Set<string>                 `${TPM}|${mois}` déclarés indisponibles
 * }} input
 * @returns {{ rows: object[], counts: object }}
 *   rows : { month, unit: { kind: 'tpm'|'interne', providerId, name, offices }, visits: { planned, realised },
 *            status, expected, auto, reason, due, reports: { id, status, contractLabel }[] }
 */
function expectedReports({ months, today, activity = [], contractTpms = new Map(), names = new Map(), reports = [], unavailable = new Set() }) {
  const ms = [...new Set(months || [])].sort();
  const inRange = new Set(ms);
  const act = new Map();
  for (const a of activity) {
    if (!a || !inRange.has(a.month) || a.key === 'non_affecte') continue;
    act.set(`${a.key}|${a.month}`, a);
    if (a.key !== INTERNAL && a.name && !names.has(a.key)) names.set(a.key, a.name);
  }
  const docs = new Map();
  for (const r of reports) {
    if (!r || !inRange.has(r.month) || !r.partnerId) continue;
    const k = `${r.partnerId}|${r.month}`;
    if (!docs.has(k)) docs.set(k, []);
    docs.get(k).push(r);
    if (r.partnerName && !names.has(r.partnerId)) names.set(r.partnerId, r.partnerName);
  }
  const rows = [];
  for (const m of ms) {
    const tpms = new Set([...(contractTpms.get(m) || [])]);
    for (const k of act.keys()) { const [key, mm] = k.split('|'); if (mm === m && key !== INTERNAL) tpms.add(key); }
    for (const k of docs.keys()) { const [key, mm] = k.split('|'); if (mm === m) tpms.add(key); }
    const tpmRows = [...tpms].map((id) => {
      const a = act.get(`${id}|${m}`) || { planned: 0, realised: 0 };
      const d = docs.get(`${id}|${m}`) || [];
      const visits = (Number(a.planned) || 0) + (Number(a.realised) || 0);
      return {
        month: m, unit: { kind: 'tpm', providerId: id, name: names.get(id) || null, offices: [] },
        visits: { planned: Number(a.planned) || 0, realised: Number(a.realised) || 0 },
        ...tpmStatus({ visits, docs: d, month: m, today, off: unavailable.has(`${id}|${m}`) }), due: dueMonth(m),
        reports: d.map((r) => ({ id: r.id, status: r.status, contractLabel: r.contractLabel || null }))
          .sort((x, y) => cmp(String(x.contractLabel || ''), String(y.contractLabel || ''))),
      };
    }).sort((x, y) => cmp(String(x.unit.name || '').toLowerCase(), String(y.unit.name || '').toLowerCase()) || cmp(x.unit.providerId, y.unit.providerId));
    rows.push(...tpmRows);
    const own = act.get(`${INTERNAL}|${m}`);
    const ownVisits = own ? (Number(own.planned) || 0) + (Number(own.realised) || 0) : 0;
    if (ownVisits > 0) {
      rows.push({
        month: m, unit: { kind: 'interne', providerId: null, name: null, offices: [...new Set(own.offices || [])].sort((x, y) => x.localeCompare(y, 'fr')) },
        visits: { planned: Number(own.planned) || 0, realised: Number(own.realised) || 0 },
        status: 'attendu', expected: true, auto: false, reason: 'rapport_interne', due: dueMonth(m), reports: [],
      });
    }
  }
  const counts = Object.fromEntries(EXPECTATION_STATUSES.map((s) => [s, 0]));
  let auto = 0; let internal = 0;
  for (const r of rows) {
    counts[r.status] += 1;
    if (r.auto) auto += 1;
    if (r.unit.kind === 'interne') internal += 1;
  }
  return { rows, counts: { ...counts, autoNonApplicable: auto, internal, total: rows.length } };
}

module.exports = { DUE_MONTHS_AFTER, EXPECTATION_STATUSES, DOC_RANK, dueMonth, addMonth, tpmStatus, expectedReports };
