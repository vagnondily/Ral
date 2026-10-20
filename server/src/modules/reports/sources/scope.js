/**
 * Paramètres communs des sources (lot 7a) — PUR. Période selon le mode du jeu de données :
 *  - 'range' : la plage du bloc, ou ses mois cochés ; 'asOf' : le DERNIER mois (situation à cette
 *    date) ; 'year' : l'année du dernier mois ; 'now' : aucune.
 * Bureau d'une source « sites » : 'id:<bureau>' → l'identifiant, 'unlinked' → sans bureau.
 */
function periodFor(mode, eff) {
  const p = eff && eff.period;
  if (!p || mode === 'now') return null;
  if (mode === 'asOf') return { from: p.to, to: p.to };
  if (mode === 'year') return { year: Number(String(p.to).slice(0, 4)) };
  // Plage, ou mois COCHÉS (retour 68) : la liste passe telle quelle aux sources qui la prennent en charge.
  return Array.isArray(p.months) ? { from: p.from, to: p.to, months: [...p.months] } : { from: p.from, to: p.to };
}

function siteOffice(eff) {
  const o = eff && eff.office;
  if (!o) return null;
  if (o === 'unlinked') return 'unlinked';
  return o.startsWith('id:') ? o.slice(3) : null;
}

module.exports = { periodFor, siteOffice };
