/**
 * Catalogue des écrans (modules du menu) pour les restrictions d'accès par personne.
 * Jumelle lisible côté web (le menu NAV d'AppShell porte les mêmes clés d'« item »).
 *
 * page_access d'un utilisateur :
 *   null            → aucune restriction : il voit tout ce que son rôle permet.
 *   tableau de clés → il voit UNIQUEMENT ces écrans (intersection avec les droits du rôle).
 *
 * La granularité est l'écran (item de menu) : contrats, partenaires & TPM, suivi de
 * processus, distribution d'urgence, dashboard, reporting, alertes, paramétrage.
 */
const PAGES = [
  { key: 'contrats', group: 'Contractualisation', label: 'Contrats' },
  { key: 'tpm', group: 'Suivi & évaluation', label: 'Partenaires & TPM' },
  { key: 'processus', group: 'Suivi & évaluation', label: 'Suivi de processus' },
  { key: 'pdd', group: 'Suivi & évaluation', label: "Distribution d'urgence" },
  { key: 'dashboard', group: 'Pilotage', label: 'Dashboard décisionnel' },
  { key: 'reporting', group: 'Pilotage', label: 'Reporting' },
  { key: 'alertes', group: 'Pilotage', label: 'Alertes' },
  { key: 'parametrage', group: 'Administration', label: 'Paramétrage', adminOnly: true },
];
const PAGE_KEYS = PAGES.map((p) => p.key);
const PAGE_KEY_SET = new Set(PAGE_KEYS);

/** Normalise une entrée page_access : null (aucune restriction) ou tableau de clés connues, dédupliqué. */
function normalizePageAccess(input) {
  if (input === null || input === undefined) return null;
  if (!Array.isArray(input)) return null;
  const kept = [...new Set(input.filter((k) => PAGE_KEY_SET.has(k)))];
  return kept; // [] = ne voit aucun écran (compte volontairement sans accès)
}

/** L'utilisateur peut-il voir cet écran ? (null = tout ; sinon la clé doit être listée) */
function canSeePage(pageAccess, key) {
  if (pageAccess === null || pageAccess === undefined) return true;
  return Array.isArray(pageAccess) && pageAccess.includes(key);
}

module.exports = { PAGES, PAGE_KEYS, PAGE_KEY_SET, normalizePageAccess, canSeePage };
