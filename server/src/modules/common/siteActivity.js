const { monthsOf } = require('./period');

/**
 * Sites actifs, prévus et réalisés sur une période (lot 1b, retour n° 47) — règle
 * PURE, testée (test/siteActivity.test.js). Jumeau de la requête SQL
 * common/siteActivitySql.siteMonthFactsCtes ; leur parité est vérifiée par le banc
 * (scripts/perfPeriod.js) sur le jeu synthétique.
 *
 * Site actif un mois M (définition commune, comme le classeur d'activation) :
 *  - un site en zone interdite (security_situation ≥ 99) n'est jamais actif ;
 *  - si le tenant a AU MOINS UNE case de grille d'activation pour l'année de M, seul un
 *    « Oui » EXPLICITE à M rend le site actif — une case vide n'est pas active (la grille
 *    ne stocke que les cases renseignées) ;
 *  - sans aucune case cette année-là, tout le registre est actif, et la réponse le dit
 *    (`activationKnown: false` pour ce mois).
 *  Limite connue : la zone interdite est la valeur actuelle, pas une valeur datée
 *  (lot 5 : risque par période).
 *
 * Sur une période [from, to] :
 *  - actif = actif au moins un mois de la période ;
 *  - une visite = site × mois, comptée UNE fois : plusieurs lignes du même site × mois
 *    (activités différentes) donnent un seul statut, réalisée > prévue > annulée ;
 *  - prévu = au moins une visite prévue ou réalisée PENDANT un mois actif ;
 *  - réalisé = au moins une visite réalisée pendant un mois actif ; une visite réalisée
 *    un mois inactif est comptée à part (realisedInactive), jamais perdue ni comptée
 *    dans la couverture ;
 *  - exécution du plan = site × mois réalisés ÷ site × mois prévus (non annulés), sur
 *    les mois échus (≤ mois courant) : une visite prévue à venir ne fait pas baisser le
 *    taux, elle est rendue à part (upcoming). Tant que le lot 4 ne distingue pas le
 *    « hors plan », toute ligne non annulée compte comme prévue.
 */

const STATUS_RANK = { realise: 3, planifie: 2, annule: 1 };

/** Statut unique d'un site × mois : réalisée > prévue > annulée (null sans visite). */
function collapseStatus(statuses) {
  let best = null;
  for (const s of statuses || []) if (STATUS_RANK[s] && (!best || STATUS_RANK[s] > STATUS_RANK[best])) best = s;
  return best;
}

/**
 * Site actif au mois `month` (« AAAA-MM »).
 * @param {Map<string,boolean>|object} statuses cases EXPLICITES de la grille de CE site : mois → actif
 * @param {{ forbidden?: boolean, gridYears?: Set<number>|number[] }} opts années où le tenant a une grille
 */
function activeAt(statuses, month, { forbidden = false, gridYears = [] } = {}) {
  if (forbidden) return false;
  const years = gridYears instanceof Set ? gridYears : new Set(gridYears);
  if (!years.has(Number(month.slice(0, 4)))) return true; // aucune grille cette année-là : tout le registre
  const v = statuses instanceof Map ? statuses.get(month) : (statuses || {})[month];
  return v === true;
}

/**
 * Faits d'UN site sur une période.
 * @param {{ statuses?: Map|object, forbidden?: boolean, gridYears?: Set|number[],
 *           visits?: {month:string, status:string}[] }} site
 * @param {{from:string,to:string}} period
 * @param {{ todayMonth?: string }} [opts] mois courant (exécution sur les mois échus)
 */
function siteRangeFacts(site, period, { todayMonth = '9999-12' } = {}) {
  const byMonth = new Map();
  for (const v of site.visits || []) {
    const m = String(v.month).slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(v.status);
  }
  const out = {
    active: false, planned: false, realised: false, realisedInactive: false,
    planifie: 0, realise: 0, annule: 0, duePlanifie: 0, dueRealise: 0, upcoming: 0, realiseActive: 0,
    // Mode « données » (carte, lot 6a — jumeau de siteMonthFactsCtes({ withData })) :
    realisedAny: false, realisedData: false, vPlanned: 0, vPlannedRealised: 0, vOffPlan: 0,
  };
  const data = new Set((site.dataMonths || []).map((m) => String(m).slice(0, 7)));
  for (const m of monthsOf(period)) {
    const act = activeAt(site.statuses, m, site);
    const st = collapseStatus(byMonth.get(m));
    const wd = data.has(m);
    const planned = st === 'planifie' || st === 'realise';
    if (act) out.active = true;
    if (act && planned) out.planned = true;
    if (act && st === 'realise') { out.realised = true; out.realiseActive += 1; }
    if (!act && st === 'realise') out.realisedInactive = true;
    if (st) out[st] += 1;
    if (st === 'planifie' && m > todayMonth) out.upcoming += 1;
    if (m <= todayMonth) { if (st === 'planifie') out.duePlanifie += 1; if (st === 'realise') out.dueRealise += 1; }
    if (act && (st === 'realise' || wd)) out.realisedAny = true;
    if (act && wd) out.realisedData = true;
    // Exécution : mois échus seulement (règle du lot 1b ; une visite à venir n'est pas manquée).
    if (act && planned && m <= todayMonth) { out.vPlanned += 1; if (st === 'realise' || wd) out.vPlannedRealised += 1; }
    if (act && !planned && wd) out.vOffPlan += 1;
  }
  return out;
}

const ratio = (num, den) => (den > 0 ? num / den : null);

/**
 * Les trois taux — l'UNIQUE endroit de la règle « — aucun plan » (null, jamais 0 %) :
 *  - couverture   = sites réalisés ÷ sites actifs (null sans site actif) ;
 *  - planification = sites prévus ÷ sites actifs (null sans site prévu : « — aucun plan ») ;
 *  - exécution    = visites réalisées ÷ visites prévues, `planifie` + `realise` (null sans visite).
 */
function ratesOf({ sitesActive = 0, sitesPlanned = 0, sitesRealised = 0, planifie = 0, realise = 0 } = {}) {
  return {
    coverage: ratio(sitesRealised, sitesActive),
    planning: sitesPlanned > 0 ? ratio(sitesPlanned, sitesActive) : null,
    execution: ratio(realise, planifie + realise),
  };
}

/** Totaux d'une liste de faits par site (siteRangeFacts) : comptes de sites et de site × mois. */
function sumFacts(list) {
  const t = { sitesActive: 0, sitesPlanned: 0, sitesRealised: 0, sitesRealisedInactive: 0, planifie: 0, realise: 0, annule: 0, duePlanifie: 0, dueRealise: 0, upcoming: 0 };
  for (const f of list || []) {
    if (f.active) t.sitesActive += 1;
    if (f.planned) t.sitesPlanned += 1;
    if (f.realised) t.sitesRealised += 1;
    if (f.realisedInactive) t.sitesRealisedInactive += 1;
    for (const k of ['planifie', 'realise', 'annule', 'duePlanifie', 'dueRealise', 'upcoming']) t[k] += f[k];
  }
  return t;
}

module.exports = { activeAt, collapseStatus, siteRangeFacts, ratesOf, sumFacts };
