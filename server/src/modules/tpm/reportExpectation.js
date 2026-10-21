/**
 * Rapports attendus (retour 114 : « pas de planification → pas de rapport (non applicable d'office) ;
 * si c'est nous, un rapport pour nous ») — règle PURE, sans I/O, testée
 * (test/reportExpectation.test.js). Le SQL (reports.repository.expectedReports) lit les entrées ;
 * toute la décision vit ici. Recalculé en direct, rien de stocké : aucune écriture automatique sur
 * tpm_reports (un « non applicable d'office » redevient attendu dès qu'une visite est prévue).
 *
 * Pour chaque mois M de la période, une ligne par TPM × CONTRAT (une facture par TPM, contrat et mois :
 * UNIQUE(partner_id, contract_id, period_month, kind)) :
 *  - un couple TPM × contrat est retenu si le TPM est le TPM de ce contrat de suivi qui couvre M
 *    (décision D1 : tpmAttribution.contractTpms), s'il porte au moins une visite de M sur ce contrat
 *    (site_visits.contract_id), ou s'il a une facture de ce contrat qui COUVRE M ;
 *  - la facture est ATTENDUE seulement si le TPM porte au moins une visite NON ANNULÉE de M sur ce
 *    contrat (prévue ou réalisée). Sans visite : « non applicable » d'office — jamais « en retard ».
 *    Un document réel l'emporte toujours : soumis, validé, rejeté, ou « non applicable » saisi ;
 *  - une facture pluri-mensuelle ([period_month, period_end]) couvre CHACUN de ses mois ;
 *  - visites d'un TPM sans contrat (TPM choisi pour la visite, hors contrat) : une ligne TPM × « contrat
 *    à préciser », qu'un document réel du TPM couvrant le mois satisfait ;
 *  - le SUIVI INTERNE (visites suivies par l'équipe S&E, site_visits.monitored_by = 'interne') :
 *    au moins une visite interne non annulée en M → un « rapport interne » est attendu, par
 *    l'équipe S&E des bureaux des sites concernés (dit à l'écran). Il n'a pas encore de document
 *    dans l'application : il reste « attendu », jamais « en retard ».
 *  - Échéance : le rapport du mois M se remet au plus tard au cours du mois M + DUE_MONTHS_AFTER ;
 *    au-delà, un rapport attendu et non remis est « en retard ».
 * Une visite que personne ne suit (antérieure à la règle, 'non_affecte') n'attend aucun rapport.
 * Jumelle SQL d'une partie de la règle (liste des rapports, fiche 360°) : un gabarit « attendu » sans
 * visite non annulée de son TPM sur son contrat pendant ses mois est « non applicable » d'office
 * (reportExpectationSql.stubNotApplicableSql) — la même règle que tpmStatus ci-dessous.
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
 * @param {{ visits: number, docs: { status }[], month: string, today: string, off?: boolean, notTpm?: boolean }} p
 *   visits = visites non annulées du TPM ce mois ; docs = ses factures du mois ; today = « AAAA-MM » ;
 *   off = TPM déclaré indisponible ce mois (retour 114) ; notTpm = le partenaire n'est PLUS de type TPM
 *   (décision D-b, relecture croisée point 21 : on n'attend plus de facture de lui — jamais « en retard »)
 * @returns {{ status: string, expected: boolean, auto: boolean, reason: string }}
 *   auto = « non applicable » d'office (aucune visite, aucun document qui le dise, partenaire qui n'est plus TPM) ;
 *   reason ∈ document, aucune_visite, tpm_indisponible, partner_not_tpm, saisi_non_applicable, a_remettre, echeance_depassee
 */
function tpmStatus({ visits, docs, month, today, off = false, notTpm = false }) {
  const best = [...(docs || [])].sort((a, b) => (DOC_RANK[b.status] ?? -1) - (DOC_RANK[a.status] ?? -1))[0] || null;
  const expected = visits > 0;
  if (best && ['valide', 'soumis', 'rejete'].includes(best.status)) return { status: best.status, expected, auto: false, reason: 'document' };
  // Un TPM devenu partenaire de mise en œuvre : plus de facture attendue. Un TPM INACTIF (contrat fini,
  // fiche désactivée ensuite) reste attendu pour les mois qu'il a servis (il peut encore facturer ces mois).
  if (notTpm) return { status: 'non_applicable', expected: false, auto: true, reason: 'partner_not_tpm' };
  if (!expected) return { status: 'non_applicable', expected, auto: !(best && best.status === 'non_applicable'), reason: off ? 'tpm_indisponible' : 'aucune_visite' };
  if (best && best.status === 'non_applicable') return { status: 'non_applicable', expected, auto: false, reason: 'saisi_non_applicable' };
  const late = today > dueMonth(month);
  return { status: late ? 'en_retard' : 'attendu', expected, auto: false, reason: late ? 'echeance_depassee' : 'a_remettre' };
}

/** Mois « AAAA-MM » de from à to inclus (bornés à 120). */
function monthsBetween(from, to) {
  const out = [];
  for (let m = from; m <= to && out.length < 120; m = addMonth(m, 1)) out.push(m);
  return out;
}

/**
 * Rapports attendus d'une période.
 * @param {{
 *   months: string[], today: string,
 *   activity: { key: string, contractId?: string|null, name?: string, month: string, planned: number, realised: number,
 *               cancelled?: number, offices?: string[] }[],      visites par unité (TPM, 'interne') × contrat × mois
 *   contractPairs?: Map<string, { providerId, contractId }[]>,    mois → TPM des contrats de suivi qui le couvrent (D1)
 *   names?: Map<string, string>,                                  TPM → nom
 *   contractLabels?: Map<string, string>,                         contrat → n° affiché
 *   reports?: { id, partnerId, partnerName?, contractId, contractLabel?, month, endMonth?, status,
 *               late?, autoNotApplicable?, partnerNotTpm? }[],  factures qui chevauchent (drapeaux du document : la liste)
 *   unavailable?: Set<string>                                     `${TPM}|${mois}` déclarés indisponibles
 *   notTpm?: Set<string>                                          partenaires qui ne sont plus de type TPM (D-b)
 * }} input
 * @returns {{ rows: object[], counts: object }}
 *   rows : { month, unit: { kind: 'tpm'|'interne', providerId, name, offices }, contract: { id, label }|null,
 *            visits: { planned, realised }, status, expected, auto, reason, due,
 *            reports: { id, status, contractLabel, late, autoNotApplicable, partnerNotTpm }[] }
 */
function expectedReports({
  months, today, activity = [], contractPairs = new Map(), names = new Map(), contractLabels = new Map(), reports = [], unavailable = new Set(),
  notTpm = new Set(),
}) {
  const ms = [...new Set(months || [])].sort();
  const inRange = new Set(ms);
  const pairKey = (p, k, m) => `${p}|${k || ''}|${m}`;
  // Visites : TPM × contrat × mois ; suivi interne : mois (tous contrats confondus).
  const act = new Map(); const own = new Map();
  for (const a of activity) {
    if (!a || !inRange.has(a.month) || a.key === 'non_affecte') continue;
    if (a.key === INTERNAL) {
      const o = own.get(a.month) || { planned: 0, realised: 0, offices: [] };
      o.planned += Number(a.planned) || 0; o.realised += Number(a.realised) || 0; o.offices.push(...(a.offices || []));
      own.set(a.month, o);
      continue;
    }
    const k = pairKey(a.key, a.contractId, a.month);
    const e = act.get(k) || { planned: 0, realised: 0 };
    e.planned += Number(a.planned) || 0; e.realised += Number(a.realised) || 0;
    act.set(k, e);
    if (a.name && !names.has(a.key)) names.set(a.key, a.name);
  }
  // Documents : chaque facture couvre chacun de ses mois (facture pluri-mensuelle comprise).
  const docs = new Map(); const docsOfTpm = new Map();
  const push = (map, k, r) => { if (!map.has(k)) map.set(k, []); map.get(k).push(r); };
  for (const r of reports) {
    if (!r || !r.partnerId || !r.month) continue;
    if (r.partnerName && !names.has(r.partnerId)) names.set(r.partnerId, r.partnerName);
    if (r.contractId && r.contractLabel && !contractLabels.has(r.contractId)) contractLabels.set(r.contractId, r.contractLabel);
    const end = r.endMonth && r.endMonth > r.month ? r.endMonth : r.month;
    for (const m of monthsBetween(r.month, end)) {
      if (!inRange.has(m)) continue;
      push(docs, pairKey(r.partnerId, r.contractId, m), r);
      push(docsOfTpm, `${r.partnerId}|${m}`, r);
    }
  }
  const rows = [];
  for (const m of ms) {
    const pairs = new Map();
    const add = (providerId, contractId) => { const k = pairKey(providerId, contractId, m); if (!pairs.has(k)) pairs.set(k, { providerId, contractId: contractId || null }); };
    for (const p of contractPairs.get(m) || []) add(p.providerId, p.contractId);
    for (const k of act.keys()) { const [p, c, mm] = k.split('|'); if (mm === m) add(p, c || null); }
    for (const k of docs.keys()) { const [p, c, mm] = k.split('|'); if (mm === m) add(p, c || null); }
    const tpmRows = [...pairs.values()].map(({ providerId, contractId }) => {
      const a = act.get(pairKey(providerId, contractId, m)) || { planned: 0, realised: 0 };
      // Visites hors contrat : tout document réel du TPM qui couvre le mois les satisfait.
      const d = contractId ? (docs.get(pairKey(providerId, contractId, m)) || []) : (docsOfTpm.get(`${providerId}|${m}`) || []);
      const visits = a.planned + a.realised;
      return {
        month: m, unit: { kind: 'tpm', providerId, name: names.get(providerId) || null, offices: [] },
        contract: contractId ? { id: contractId, label: contractLabels.get(contractId) || null } : null,
        visits: { planned: a.planned, realised: a.realised },
        ...tpmStatus({ visits, docs: d, month: m, today, off: unavailable.has(`${providerId}|${m}`), notTpm: notTpm.has(providerId) }), due: dueMonth(m),
        reports: d.map((r) => ({
          id: r.id, status: r.status, contractLabel: r.contractLabel || null,
          late: r.late === true, autoNotApplicable: r.autoNotApplicable === true, partnerNotTpm: r.partnerNotTpm === true,
        }))
          .sort((x, y) => cmp(String(x.contractLabel || ''), String(y.contractLabel || ''))),
      };
    }).sort((x, y) => cmp(String(x.unit.name || '').toLowerCase(), String(y.unit.name || '').toLowerCase()) || cmp(x.unit.providerId, y.unit.providerId)
      || cmp(String((x.contract && x.contract.label) || '~'), String((y.contract && y.contract.label) || '~')));
    rows.push(...tpmRows);
    const o = own.get(m);
    if (o && o.planned + o.realised > 0) {
      rows.push({
        month: m, unit: { kind: 'interne', providerId: null, name: null, offices: [...new Set(o.offices)].sort((x, y) => x.localeCompare(y, 'fr')) },
        contract: null, visits: { planned: o.planned, realised: o.realised },
        status: 'attendu', expected: true, auto: false, reason: 'rapport_interne', due: dueMonth(m), reports: [],
      });
    }
  }
  const counts = Object.fromEntries(EXPECTATION_STATUSES.map((st) => [st, 0]));
  let auto = 0; let internal = 0;
  for (const r of rows) {
    counts[r.status] += 1;
    if (r.auto) auto += 1;
    if (r.unit.kind === 'interne') internal += 1;
  }
  return { rows, counts: { ...counts, autoNonApplicable: auto, internal, total: rows.length } };
}

/**
 * Garde « TPM actif » d'une écriture de document (décision D-b) : une FACTURE dont toute la période
 * [periodMonth, periodEnd] précède le mois courant local peut venir d'un TPM désormais inactif (contrat
 * fini, fiche désactivée ensuite) — il facture des mois qu'il a servis ; seul le type « tpm » est alors
 * exigé, comme le déclencheur de la migration 089. Un plan (travail à venir), un gabarit mensuel, un
 * rapport technique ou une facture qui touche le mois courant exige toujours un TPM ACTIF.
 * @param {{ kind: string, periodMonth: string, periodEnd?: string|null }} doc
 * @param {string} today « AAAA-MM »
 */
function inactiveTpmMayInvoice(doc, today) {
  if (!doc || doc.kind !== 'financier') return false;
  const from = String(doc.periodMonth || '').slice(0, 7);
  const to = doc.periodEnd ? String(doc.periodEnd).slice(0, 7) : from;
  return /^\d{4}-\d{2}$/.test(from) && (to > from ? to : from) < today;
}

module.exports = { inactiveTpmMayInvoice, DUE_MONTHS_AFTER, EXPECTATION_STATUSES, DOC_RANK, dueMonth, addMonth, monthsBetween, tpmStatus, expectedReports };
