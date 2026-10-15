/**
 * Grille « Sites (actifs / inactifs) » (retour 64) — aides pures de l'écran.
 * Le serveur envoie les 12 mois d'un site sur 12 caractères : O (actif),
 * N (inactif), - (non renseigné). Les règles et le journal restent côté serveur
 * (activationMath / activation.repository) ; ici, seulement l'affichage et les
 * changements en attente.
 */
export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** « OON-… » → { 1: true, 2: true, 3: false, … } (mois non renseignés absents). */
export function unpack(m = '') {
  const out = {};
  MONTHS.forEach((mo, i) => { const c = m[i]; if (c === 'O') out[mo] = true; else if (c === 'N') out[mo] = false; });
  return out;
}

/** Clé d'un changement en attente. */
export const pendingKey = (siteId, month) => `${siteId}|${month}`;

/** Valeur suivante au clic : Oui → Non → vide → Oui. */
export function nextValue(v) {
  if (v === true) return false;
  if (v === false) return null;
  return true;
}

/** Valeur affichée d'une case : en attente d'abord, sinon l'état enregistré. */
export function cellValue(months, pending, siteId, month) {
  const k = pendingKey(siteId, month);
  if (Object.prototype.hasOwnProperty.call(pending, k)) return pending[k];
  return months[month] === undefined ? null : months[month];
}

/** Totaux par mois (actifs, inactifs, non renseignés), changements en attente compris. */
export function totals(rows, pending) {
  return MONTHS.map((month) => {
    let active = 0; let inactive = 0; let unknown = 0;
    for (const r of rows) {
      const v = cellValue(r.months, pending, r.id, month);
      if (v === true) active += 1; else if (v === false) inactive += 1; else unknown += 1;
    }
    return { month, active, inactive, unknown };
  });
}

/** Au moins un mois actif sur l'exercice (colonne « Actif » du classeur). */
export const activeInYear = (row, pending) => MONTHS.some((m) => cellValue(row.months, pending, row.id, m) === true);
