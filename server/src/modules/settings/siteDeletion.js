/**
 * Suppression groupée de sites du registre (retours 62 et 89) — règles PURES.
 *
 * Un site qui porte des données (visites, soumissions rattachées, grille des
 * sites actifs, affectations) n'est jamais supprimé : il est GARDÉ. Ce module
 * résume, pour une sélection, ce qui sera supprimé et ce qui sera gardé, et
 * pourquoi — le même résumé sert à l'aperçu (avant) et au compte rendu (après).
 */

/** Raisons de garder un site, dans l'ordre d'affichage. */
const KEEP_REASONS = Object.freeze(['visits', 'submissions', 'activation', 'assignments']);

/** Nombre maximal de sites gardés détaillés par nom dans une réponse. */
const SAMPLE_MAX = 50;

/**
 * @param {{id:string,name:string}[]} found   sites trouvés (sélection)
 * @param {Map<string, Record<string, number>>} linked  comptes par site (linkedDataTx)
 * @returns {{ total:number, deletable:string[], kept:string[],
 *            byReason: Record<string, number>,
 *            sample: {id:string,name:string,counts:Record<string,number>}[] }}
 */
function summarizeSiteDeletion(found = [], linked = new Map()) {
  const deletable = [];
  const kept = [];
  const byReason = Object.fromEntries(KEEP_REASONS.map((k) => [k, 0]));
  const sample = [];
  for (const s of found) {
    const c = linked.get(s.id);
    const has = c && KEEP_REASONS.some((k) => Number(c[k]) > 0);
    if (!has) { deletable.push(s.id); continue; }
    kept.push(s.id);
    for (const k of KEEP_REASONS) if (Number(c[k]) > 0) byReason[k] += 1;
    if (sample.length < SAMPLE_MAX) {
      sample.push({ id: s.id, name: s.name, counts: Object.fromEntries(KEEP_REASONS.map((k) => [k, Number(c[k]) || 0])) });
    }
  }
  return { total: found.length, deletable, kept, byReason, sample };
}

module.exports = { KEEP_REASONS, SAMPLE_MAX, summarizeSiteDeletion };
