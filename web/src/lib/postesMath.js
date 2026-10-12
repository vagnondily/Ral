// Calcul PUR des postes d'un état des dépenses côté écran (éditeur, impression).
// Mêmes règles que server/src/modules/tpm/reportMath.js, en CENTIMES ENTIERS :
//   montant        = arrondi(quantité × coût unitaire × 100)            (centimes)
//   part bailleur  = arrondi(montant × % bailleur)                       (centimes)
//   part ONG       = montant − part bailleur                             (le reste)
// Convention de l'éditeur : « % bailleur » en POURCENT (0..100), vide = 100 %.
// Aucune dépendance (ni React ni DOM) : testé depuis server/test.
import { SECTION_OF } from './budgetCatalog.js';

/**
 * Part bailleur d'une ligne de l'éditeur, en fraction 0..1. Accepte la virgule
 * décimale (« 90,5 »). Vide = 100 % (ou 0 % pour une ancienne ligne « ONG »).
 */
export function pctFraction(r) {
  const raw = r.bailleurPct;
  if (raw === '' || raw == null) return r.payBy === 'ong' ? 0 : 1;
  const p = Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(p)) return 1;
  // Fraction à la précision de la base (numeric(6,5)), comme reportMath :
  // 33,333 % → 0,33333 exactement (et non 0,33332999…).
  return Math.min(1, Math.max(0, Math.round(p * 1000) / 100000));
}

/**
 * Fraction stockée (0..1, 5 décimales en base : numeric(6,5)) → pourcent de
 * l'éditeur, SANS perte : 0,33333 → 33,333 (et non 33, qui changerait la part
 * bailleur au réenregistrement). Vide / illisible → null.
 */
export function fractionToPercent(f) {
  if (f === '' || f == null) return null;
  const n = Number(f);
  return Number.isFinite(n) ? Math.round(n * 100000) / 1000 : null;
}

/** « % bailleur » d'un poste stocké, en pourcent pour l'éditeur (ancien poste « ONG » sans % : 0). */
export function pctPercentOf(item) {
  const p = fractionToPercent(item.bailleurPct);
  if (p != null) return p;
  return item.payBy === 'ong' ? 0 : 100;
}

/** « % bailleur » saisi illisible ou hors 0–100 (vide = 100 %, valide). */
export function pctInvalid(r) {
  const raw = r.bailleurPct;
  if (raw === '' || raw == null) return false;
  const p = Number(String(raw).trim().replace(',', '.'));
  return !Number.isFinite(p) || p < 0 || p > 100;
}

/** Lignes qui seront enregistrées (désignation ≥ 2 caractères) avec un % bailleur invalide. */
export function invalidPctRows(rows) {
  return rows.filter((r) => String(r.designation || '').trim().length >= 2 && pctInvalid(r));
}

/** Montant d'un poste en centimes entiers = quantité × coût unitaire. */
export function posteCents(r) {
  const q = Number(r.unitCount); const c = Number(r.unitCost);
  return Number.isFinite(q) && Number.isFinite(c) ? Math.round(q * c * 100) : 0;
}

/** « À payer par le bailleur » d'un poste, en centimes = montant × % bailleur. */
export function posteFunderCents(r) {
  return Math.round(posteCents(r) * pctFraction(r));
}

export const posteAmount = (r) => posteCents(r) / 100;
export const posteFunder = (r) => posteFunderCents(r) / 100;
export const posteOng = (r) => (posteCents(r) - posteFunderCents(r)) / 100;

/**
 * Totaux d'une liste de postes, cumulés en centimes : par section (montant,
 * part bailleur, part ONG) et au global. `bySec[code]` = montant de la section.
 */
export function postesTotals(rows) {
  const sec = {};
  let total = 0; let funder = 0;
  for (const r of rows) {
    const c = posteCents(r);
    const f = posteFunderCents(r);
    const code = SECTION_OF[r.lineCode] || '?';
    if (!sec[code]) sec[code] = { total: 0, funder: 0, ong: 0 };
    sec[code].total += c; sec[code].funder += f; sec[code].ong += c - f;
    total += c; funder += f;
  }
  const bySection = {};
  const bySec = {};
  for (const [code, v] of Object.entries(sec)) {
    bySection[code] = { total: v.total / 100, funder: v.funder / 100, ong: v.ong / 100 };
    bySec[code] = v.total / 100;
  }
  return { bySec, bySection, total: total / 100, funder: funder / 100, ong: (total - funder) / 100 };
}
