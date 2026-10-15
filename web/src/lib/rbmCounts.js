/**
 * Compteurs de l'état RBM tels que les écrans les affichent, lus dans la réponse de
 * GET /api/tpm/field/rbm/counts (serveur : tpm/rbmSummary.rbmCounts, mêmes lignes que
 * /rbm/sites). Les écrans qui n'affichent que des totaux (Synthèse, Couverture &
 * performance, Affectation & visites) ne téléchargent plus la liste complète des sites.
 *
 *   due     : « à suivre », zones interdites comprises (Synthèse, Couverture) ;
 *   dueOpen : à suivre hors zones interdites (même définition que « Générer ») ;
 *   toPlan  : ce que « Générer » planifiera.
 * Réponse absente (chargement, échec) → zéros, comme le calcul fait avant sur une liste vide.
 * Module pur, testé par server/test/webRbmCounts.test.js.
 */
export function rbmStatsOf(counts) {
  const c = counts || {};
  const by = c.byRisk || {};
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    total: n(c.total), due: n(c.due), dueOpen: n(c.dueOpen), toPlan: n(c.toPlan),
    elevee: n(by.elevee), moyenne: n(by.moyenne), faible: n(by.faible),
  };
}
