/**
 * Visite après une modification en ligne (Affectation & visites), calculée dans le navigateur
 * pour que la grille change TOUT DE SUITE, sans attendre la relecture : mêmes règles que
 * PATCH /api/tpm/field/visits/:id (field.routes patchSchema + field.repository.updateVisit) —
 *   champ absent = inchangé ; prestataire ou date vides = effacés (null) ; rôle = texte rogné
 *   (vide gardé tel quel, comme le serveur) ; statut remplacé s'il est donné.
 * La relecture silencieuse qui suit remet de toute façon l'état exact du serveur.
 * Module pur, testé par server/test/webFieldVisits.test.js.
 *
 * @param {object} visit     ligne de GET /visits (providerId, providerName, agent, status, visitDate…)
 * @param {object} body      corps envoyé au PATCH
 * @param {{id,name}[]} providers  prestataires connus (nom du prestataire choisi)
 */
export function applyVisitPatch(visit, body, providers = []) {
  const next = { ...visit };
  if (body.providerId !== undefined) {
    next.providerId = body.providerId || null;
    next.providerName = next.providerId ? ((providers.find((p) => p.id === next.providerId) || {}).name ?? null) : null;
  }
  if (body.agent !== undefined) next.agent = body.agent == null ? null : String(body.agent).trim();
  if (body.visitDate !== undefined) next.visitDate = body.visitDate || null;
  if (body.status) next.status = body.status;
  return next;
}
