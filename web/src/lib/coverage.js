// Couverture terrain affichée — règle PURE (sans DOM), testée depuis le serveur
// (server/test/webCoverage.test.js). Même règle que Synthèse, Couverture &
// performance et le Bulletin : sans visite active (planifiée ou réalisée), le
// taux est INCONNU — « — aucun plan », jamais un 0 % qui se lirait comme un échec.

/**
 * Taux de couverture en % entier (réalisées ÷ actives), ou null quand rien
 * n'est planifié ce mois (fieldMath renvoie alors rate = 0 : on ne le montre pas).
 * @param {{ active?:number, realise?:number, rate?:number|null } | null | undefined} cov
 * @returns {number|null}
 */
export function coveragePct(cov) {
  const active = Number(cov && cov.active) || 0;
  if (active <= 0) return null;
  const rate = cov.rate == null ? (Number(cov.realise) || 0) / active : Number(cov.rate);
  return Number.isFinite(rate) ? Math.round(rate * 100) : null;
}
