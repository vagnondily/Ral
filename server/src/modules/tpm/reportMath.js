/**
 * État des dépenses — pure math for a faithful TPM invoice (facture).
 *
 * Reproduces the real expense statement: each poste = quantité × coût
 * unitaire = montant, flagged « à la charge du bailleur » or « à la charge de
 * l'ONG », grouped in the FLA sections I–V. The amount that justifies payment
 * (what the app books as « Réalisé ») is the funder (bailleur) share.
 *
 * Cent-safe like contracts.domain.js — never trust raw float sums.
 */
const { SECTIONS, LINE_LABELS, SECTION_OF, isValidLine } = require('../contracts/budgetCatalog');

const SECTION_LABEL = Object.fromEntries(SECTIONS.map((s) => [s.code, s.label]));

// Who bears a cost line. 'bailleur' = the funder (booked as « Réalisé »),
// 'ong' = the partner NGO. Kept for backward compatibility; the real split is
// now a per-line percentage (bailleurPct, 0..1) — « à payer par le bailleur »
// = montant × bailleurPct — faithful to the invoice template's ×90 % / ×1.
const PAYERS = ['bailleur', 'ong'];

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
 * Share of a poste borne by the funder (bailleur), 0..1. Prefers the explicit
 * `bailleurPct`; falls back to the legacy binary `payBy` (ong → 0, else → 1).
 * Tolerates a percentage (e.g. 90) as well as a fraction (0.9).
 */
function bailleurPctOf(item) {
  const raw = item.bailleurPct;
  if (raw != null && raw !== '') {
    let p = Number(raw);
    if (!Number.isFinite(p)) return item.payBy === 'ong' ? 0 : 1;
    if (p > 1 && p <= 100) p /= 100; // tolerate a percent value
    return Math.min(1, Math.max(0, p));
  }
  return item.payBy === 'ong' ? 0 : 1;
}

/** « À payer par le bailleur » d'un poste, en centimes = montant × bailleurPct. */
function funderCentsOf(item) {
  return Math.round(itemCents(item) * bailleurPctOf(item));
}

/**
 * Summarize an invoice's line items into section subtotals and grand totals,
 * with the bailleur / ONG split. `payBy` defaults to 'bailleur'.
 *
 * Returns { sections:[{code,label,total,funder,ong,count}], total, funder, ong }.
 */
function summarize(items) {
  const secMap = new Map(); // code -> { total, funder, ong, count }
  let totalCents = 0;
  let funderCents = 0;
  let ongCents = 0;

  for (const it of items || []) {
    const cents = itemCents(it);
    const fCents = funderCentsOf(it);        // part bailleur = montant × %
    const oCents = cents - fCents;           // le reste est à la charge de l'ONG
    const code = SECTION_OF[it.lineCode] || String(it.lineCode || '').split('.')[0] || '?';
    if (!secMap.has(code)) secMap.set(code, { total: 0, funder: 0, ong: 0, count: 0 });
    const s = secMap.get(code);
    s.total += cents;
    s.count += 1;
    s.funder += fCents; funderCents += fCents;
    s.ong += oCents; ongCents += oCents;
    totalCents += cents;
  }

  // Emit sections in catalogue order, only those that carry postes.
  const sections = SECTIONS.filter((s) => secMap.has(s.code)).map((s) => {
    const v = secMap.get(s.code);
    return {
      code: s.code,
      label: SECTION_LABEL[s.code] || s.code,
      total: round2(v.total),
      funder: round2(v.funder),
      ong: round2(v.ong),
      count: v.count,
    };
  });

  return {
    sections,
    total: round2(totalCents),
    funder: round2(funderCents),
    ong: round2(ongCents),
  };
}

/** The amount an invoice bills to the funder / bailleur (booked as « Réalisé »). */
function billedToFunder(items) {
  return summarize(items).funder;
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
    const bailleurPct = bailleurPctOf(it);
    // Legacy binary field kept in sync so old readers still work.
    const payBy = bailleurPct <= 0 ? 'ong' : 'bailleur';
    const activityId = it.activityId ? String(it.activityId).trim() : null;
    const activity2Id = it.activity2Id ? String(it.activity2Id).trim() : null;
    // Share of the montant on activity 1 (rest on activity 2). Only meaningful
    // when a second activity is set; otherwise everything is on activity 1.
    let activity1Pct = null;
    if (activity2Id) {
      let p = Number(it.activity1Pct);
      if (!Number.isFinite(p)) p = 1;
      if (p > 1 && p <= 100) p /= 100;
      activity1Pct = Math.min(1, Math.max(0, p));
    }
    out.push({
      lineCode: it.lineCode,
      designation,
      unit: it.unit ? String(it.unit).trim().slice(0, 40) : null,
      unitCount,
      unitCost,
      bailleurPct,
      payBy,
      activityId,
      activity2Id,
      activity1Pct,
      site: it.site ? String(it.site).trim().slice(0, 120) : null,
      observation: it.observation ? String(it.observation).trim().slice(0, 400) : null,
      sortOrder: order,
    });
    order += 1;
  }
  return out;
}

module.exports = {
  itemCents, itemAmount, bailleurPctOf, funderCentsOf, summarize, billedToFunder,
  normalizeItems, PAYERS, LINE_LABELS, SECTION_LABEL,
};
