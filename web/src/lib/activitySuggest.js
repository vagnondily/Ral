/**
 * Suggestion d'activité du MMR pour une fiche de suivi, d'après son nom et son
 * code (ex. « CSP_MDG GD Process Monitoring » → transferts de ressources
 * inconditionnels). Proposition seulement : l'utilisateur confirme d'un clic,
 * rien n'est rattaché sans lui. Renvoie un libellé EXACT de `activities`, ou null.
 */
const RULES = [
  // Ordre = priorité : le premier mot-clé reconnu dans le nom de la fiche l'emporte.
  { re: /(^|[^a-z])(gd|urt)([^a-z]|$)|general distribution|distribution g[ée]n[ée]rale|transferts? (de ressources|inconditionnels)/i, cat: /unconditional resource transfer|transferts? (de ressources|inconditionnel)/i },
  { re: /(^|[^a-z])smp([^a-z]|$)|school|cantine|scolaire|repas scolaire/i, cat: /school meal|repas scolaire|cantine/i },
  // MIARO : programme de prévention de la malnutrition (modèles de tableau de bord partagés).
  { re: /pr[ée]vention|blanket|bsfp|prevma|miaro/i, cat: /malnutrition prevention|pr[ée]vention de la malnutrition/i },
  { re: /nutrition|pecmam|(^|[^a-z])(mam|tsfp|aim)([^a-z]|$)|traitement/i, cat: /nutrition treatment|traitement nutritionnel/i },
  // SAMS = Smallholder Agricultural Market Support (le formulaire « Résilience SAMS » suit les petits producteurs).
  { re: /smallholder|petits producteurs|(^|[^a-z])(p4p|sams)([^a-z]|$)/i, cat: /smallholder|petits producteurs/i },
  { re: /r[ée]silience|(^|[^a-z])ffa([^a-z]|$)|asset|cr[ée]ation d'actifs|livelihood|moyens d'existence/i, cat: /asset creation|cr[ée]ation d'actifs/i },
  { re: /climat|climate|anticipat/i, cat: /climate adaptation|adaptation au climat/i },
];

export function suggestActivity(form, activities) {
  const text = `${form?.label || ''} ${form?.code || ''}`.replace(/_/g, ' ');
  for (const r of RULES) {
    if (!r.re.test(text)) continue;
    const hit = (activities || []).find((a) => r.cat.test(a));
    if (hit) return hit;
  }
  return null;
}
