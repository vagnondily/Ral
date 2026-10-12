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
  return Math.min(1, Math.max(0, p / 100));
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
