// Accès par écran (jumelle de server/src/modules/common/pageCatalog.js).
// pageAccess : null/absent = aucune restriction (voit tout) ; tableau de clés d'« item » du menu
// (contrats, tpm, processus, pdd, dashboard, reporting, alertes, parametrage) = ces écrans seulement.
export const canSeePage = (pageAccess, key) =>
  pageAccess == null || (Array.isArray(pageAccess) && pageAccess.includes(key));
