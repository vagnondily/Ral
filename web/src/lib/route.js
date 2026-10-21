/**
 * Route d'une adresse — LE parseur de l'application, partagé par le routeur (App.jsx, parseHash) et
 * par les écrans qui lisent une période dans l'adresse (lib/period.isHashRoute, usePeriod de
 * PeriodBanner, Rapports & dépenses) : un lien suivi pendant qu'un écran est encore monté n'agit sur
 * cet écran que s'il le vise (re-relecture du retour 114). Pur, sans React, testé.
 *
 * Adresses : #/tpm/prestataires, #/contrats/liste, #/contrats/liste/nouveau, #/contrats/liste/<id>,
 * #/contrats/liste/<id>/edit, #/contrats/liste/<id>/amend… ; la requête (?from=&to=, lot 1b)
 * n'appartient pas à la route.
 */

/** Route par défaut (adresse inconnue). */
export const DEFAULT_ROUTE = { module: 'contrats', sub: 'liste' };

// Routes retirées → redirigées (ex. l'ancien « Affectation & calendrier », fusionné dans
// « Affectation & visites ») ; anciennes adresses → nouvel emplacement (les favoris restent valides).
export const REDIRECTS = {
  'tpm/affectation': { module: 'processus', sub: 'sites' },
  // Le plan de suivi est un onglet de l'espace RBM (retour n° 7).
  'processus/plan': { module: 'processus', sub: 'rbm', extra: 'plan' },
  // Le registre des sites est un onglet de Localités (retour 63).
  'parametrage/sites': { module: 'parametrage', sub: 'localites', extra: 'sites' },
  // Le rapport trimestriel est devenu la carte « Couverture par activité » de la Synthèse (retour 76).
  'dashboard/trimestriel': { module: 'processus', sub: 'synthese' },
};

/**
 * Route d'un hash — celle que prend le routeur, qui l'appelle : `hash.split('?')[0].split('/')` →
 * [, module, sous-module, extra, extra2] (rien n'est nettoyé : « #//tpm/rapports » ou « #tpm/rapports »
 * ne sont pas Rapports), redirections, puis `isKnown(module, sous-module)` (le routeur passe
 * AppShell.findRoute, qui ignore les intertitres ; sans lui toute paire est tenue pour connue) — sinon
 * DEFAULT_ROUTE. Une adresse sans sous-module (« #/parametrage », « #/alertes ») va à DEFAULT_ROUTE.
 * @returns {{ module: string, sub: string, extra?: string|null, extra2?: string|null }}
 */
export function routeOfHash(hash, isKnown = () => true) {
  const [, mod, sub, extra, extra2] = String(hash || '').split('?')[0].split('/');
  const redirect = REDIRECTS[`${mod}/${sub}`];
  if (redirect) return redirect;
  return mod && sub && isKnown(mod, sub) ? { module: mod, sub, extra: extra || null, extra2: extra2 || null } : DEFAULT_ROUTE;
}

/**
 * Même écran ? Module et sous-module, comme le rendu conditionnel du routeur (App.jsx) : un lien vers
 * le même écran avec d'autres segments (extra, extra2 : onglet, identifiant) le garde monté et le vise.
 */
export const sameScreen = (a, b) => Boolean(a && b && a.module === b.module && a.sub === b.sub);

/** Le hash vise-t-il l'écran `screen` (route { module, sub }) ? */
export const hashTargets = (hash, screen, isKnown) => sameScreen(routeOfHash(hash, isKnown), screen);
