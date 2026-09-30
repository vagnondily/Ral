/**
 * État des dépenses — pure math for a faithful TPM invoice (facture).
 *
 * Reproduces the real invoice "Facture_YPA_TPM_Novembre_Janvier.pdf":
 * each poste = quantité × coût unitaire = montant, flagged « à payer par le
 * PAM » or « à payer par l'ONG », grouped in the FLA sections I–V. The amount
 * that justifies payment (what MEMS books as « Réalisé ») is the PAM share.
 *
 * Cent-safe like contracts.domain.js — never trust raw float sums.
 */
const { SECTIONS, LINE_LABELS, SECTION_OF, isValidLine } = require('../contracts/budgetCatalog');

const SECTION_LABEL = Object.fromEntries(SECTIONS.map((s) => [s.code, s.label]));

function round2(cents) {
  return Math.round(cents) / 100;
}

/** Montant d'un poste en centimes = quantité × coût unitaire. */
function itemCents(item) {
  return Math.round(Number(item.unitCount || 0) * Number(item.unitCost || 0) * 100);
}

/** Montant d'un poste en Ariary. */
function itemAmount(item) {
  return round2(itemCents(item));
}

/**
 * Summarize an invoice's line items into section subtotals and grand totals,
 * with the PAM / ONG split. `payBy` defaults to 'PAM'.
 *
 * Returns { sections:[{code,label,total,pam,ong,count}], total, pam, ong }.
 */
function summarize(items) {
  const secMap = new Map(); // code -> { total, pam, ong, count }
  let totalCents = 0;
  let pamCents = 0;
  let ongCents = 0;

  for (const it of items || []) {
    const cents = itemCents(it);
    const code = SECTION_OF[it.lineCode] || String(it.lineCode || '').split('.')[0] || '?';
    if (!secMap.has(code)) secMap.set(code, { total: 0, pam: 0, ong: 0, count: 0 });
    const s = secMap.get(code);
    s.total += cents;
    s.count += 1;
    if (it.payBy === 'ONG') { s.ong += cents; ongCents += cents; } else { s.pam += cents; pamCents += cents; }
    totalCents += cents;
  }

  // Emit sections in catalogue order, only those that carry postes.
  const sections = SECTIONS.filter((s) => secMap.has(s.code)).map((s) => {
    const v = secMap.get(s.code);
    return {
      code: s.code,
      label: SECTION_LABEL[s.code] || s.code,
      total: round2(v.total),
      pam: round2(v.pam),
      ong: round2(v.ong),
      count: v.count,
    };
  });

  return {
    sections,
    total: round2(totalCents),
    pam: round2(pamCents),
    ong: round2(ongCents),
  };
}

/** The amount an invoice bills to the PAM (booked as « Réalisé »). */
function billedToPam(items) {
  return summarize(items).pam;
}

/**
 * Validate & clean incoming invoice items. Each must reference a valid FLA
 * line and carry a designation; quantities/costs must be non-negative.
 */
function normalizeItems(rawItems) {
  const out = [];
  let order = 0;
  for (const it of rawItems || []) {
    if (!isValidLine(it.lineCode)) throw new Error(`Ligne budgétaire inconnue : ${it.lineCode}`);
    const designation = String(it.designation || '').trim();
    if (designation.length < 2) throw new Error('Chaque poste doit avoir une désignation.');
    const unitCount = Number(it.unitCount);
    const unitCost = Number(it.unitCost);
    if (!Number.isFinite(unitCount) || unitCount < 0) throw new Error(`Quantité invalide pour « ${designation} ».`);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error(`Coût unitaire invalide pour « ${designation} ».`);
    const payBy = it.payBy === 'ONG' ? 'ONG' : 'PAM';
    out.push({
      lineCode: it.lineCode,
      designation,
      unit: it.unit ? String(it.unit).trim().slice(0, 40) : null,
      unitCount,
      unitCost,
      payBy,
      site: it.site ? String(it.site).trim().slice(0, 120) : null,
      observation: it.observation ? String(it.observation).trim().slice(0, 400) : null,
      sortOrder: order,
    });
    order += 1;
  }
  return out;
}

module.exports = { itemCents, itemAmount, summarize, billedToPam, normalizeItems, LINE_LABELS, SECTION_LABEL };
