/**
 * Calculs longs écrits UNE fois, sous forme de générateur qui fait `yield` entre deux paquets
 * de travail, et exécutés de deux façons (même code, même résultat) :
 *   - runSync     : d'une traite (tests, petits volumes, appel synchrone existant) ;
 *   - runYielding : en rendant la main à la boucle d'événements à chaque `yield` — une tâche
 *     de fond qui prépare 5 000 soumissions ou construit l'index de 19 000 lieux ne fait plus
 *     attendre les autres requêtes plus de quelques dizaines de millisecondes.
 */

/** Exécute un générateur de calcul jusqu'au bout, sans rendre la main ; rend sa valeur finale. */
function runSync(it) {
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/** Exécute un générateur de calcul en rendant la main (setImmediate) à chaque `yield`. */
async function runYielding(it) {
  let r = it.next();
  while (!r.done) {
    await new Promise((resolve) => { setImmediate(resolve); });
    r = it.next();
  }
  return r.value;
}

/** Vrai tous les `chunk` éléments (compteur partant de 1) ; jamais pour chunk = Infinity. */
const isPause = (n, chunk) => Number.isFinite(chunk) && chunk > 0 && n % chunk === 0;

module.exports = { runSync, runYielding, isPause };
