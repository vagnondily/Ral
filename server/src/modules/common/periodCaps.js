/**
 * Durées maximales d'une période, par nature de calcul (lot 1b, retour n° 47) — UNE table :
 *  - lue par les routes (readPeriod(…, { maxSpan: PERIOD_CAPS.x })) ;
 *  - renvoyée aux écrans par GET /monitoring/periods (`limits`) ;
 *  - jumelle EXACTE de web/src/lib/periodCaps.js (sélecteur, usePeriod) — parité testée
 *    (test/periodCaps.test.js) : un écran ne propose jamais une période que le serveur refuse.
 *
 * Valeurs mesurées au banc (npm run perf:period, 30 000 soumissions par an, 3 000 sites,
 * rôle mems2_app) :
 *  - analysis : calcul des indicateurs sur les soumissions de la période (Synthèse, Couverture &
 *    performance, Résultats d'une fiche, aperçu « Comment c'est calculé ») — 12 mois : chaque
 *    soumission de la période est relue (JSON) ; 24 mois coûtaient 3,6 à 3,7 s ;
 *  - facts : faits site × mois (résumé terrain, récapitulatif de couverture, alertes, rapport de
 *    synthèse) — 24 mois ≈ 0,3 s ;
 *  - list : listes (visites, soumissions) — 12 mois, réponse bornée ;
 *  - document : budget, consolidation, concepteur de rapport — 60 mois (common/period.MAX_SPAN).
 */
const PERIOD_CAPS = Object.freeze({ analysis: 12, facts: 24, list: 12, document: 60 });

module.exports = { PERIOD_CAPS };
