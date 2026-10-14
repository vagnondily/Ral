/**
 * Durées maximales d'une période, par nature de calcul (lot 1b) — jumelle EXACTE de
 * server/src/modules/common/periodCaps.js (parité testée : server/test/periodCaps.test.js).
 * Chaque écran passe le plafond de ses endpoints à usePeriod et à PeriodSelect : une période
 * plus longue n'est jamais proposée, et une période d'URL ou de session plus longue est
 * écartée (période par défaut de l'écran, avec une mention) au lieu d'un refus du serveur.
 *   analysis  calcul des indicateurs (Synthèse, Couverture & performance, Résultats, aperçu)
 *   facts     faits site × mois (résumé terrain, récapitulatif, alertes, rapport de synthèse)
 *   list      listes (visites, soumissions)
 *   document  budget, consolidation, concepteur de rapport
 */
export const PERIOD_CAPS = Object.freeze({ analysis: 12, facts: 24, list: 12, document: 60 });
