const field = require('../../tpm/field.repository');
const settings = require('../../settings/settings.repository');
const dashCoverage = require('../../dashboards/coverage.repository');
const { shapeCoverage } = require('../../dashboards/coverageDefinitions');
const { periodFor, siteOffice } = require('./scope');

/**
 * Sources « Couverture, plan, RBM et sites » (lot 7a, C4) — seules à appeler les dépôts du
 * terrain et du paramétrage :
 *  - covDash : la couverture des TABLEAUX DE BORD (retour 110, « une seule source ») — même
 *    univers (sites actifs de la période), même « suivi » (visite déclarée OU données reçues
 *    rattachées au site), mêmes découpages (activité, bureau, district) que la Synthèse et
 *    « Couverture & performance » : dashboards/coverage.repository + coverageDefinitions ;
 *  - covFacts : faits site × mois (service unique du lot 1b) par mois et par prestataire
 *    (field.coverageFacts) — séries mensuelles des visites déclarées ;
 *  - covMatrix, covRecap, collectionDays, monthsOverview, planBoard : les calculs des écrans
 *    Affectation & visites et Plan de suivi, appelés tels quels ;
 *  - rbmSites : sites RBM avec leur explication, au dernier mois de la période ;
 *  - mmr : paramètres MMR.
 */
const SITES = ['sites', 'visits', 'offices'];

// Le filtre d'activité se lit dans la réponse (découpage par activité = partition de l'univers) :
// catalog/coverage.dashScope ; la requête des tableaux de bord est appelée telle quelle.
const covDash = {
  key: 'covDash', monthList: true, domains: [...SITES, 'activation', 'submissions'], varies: ['today'],
  params: (def, eff) => ({ period: periodFor('range', eff), officeId: siteOffice(eff) }),
  load: async (tenantId, p) => {
    const { rows, refMonth } = await dashCoverage.coverageFacts(tenantId, p);
    return shapeCoverage(rows, { refMonth });
  },
};

const covFacts = {
  key: 'covFacts', monthList: true, domains: [...SITES, 'activation'], varies: ['lang'],
  params: (def, eff) => ({ period: periodFor(def.periodMode || 'range', eff), officeId: siteOffice(eff), activity: eff.activity || null, district: eff.district || null }),
  load: (tenantId, p, ctx) => field.coverageFacts(tenantId, { ...p, lang: ctx.lang || 'fr' }),
};

const covMatrix = {
  key: 'covMatrix', monthList: true, domains: ['visits', 'partners'], varies: [],
  params: (def, eff) => ({ period: periodFor('range', eff) }),
  load: (tenantId, p) => field.coverageMatrix(tenantId, { period: p.period }),
};

const covRecap = {
  key: 'covRecap', monthList: true, domains: [...SITES, 'activation'], varies: [],
  params: (def, eff, args) => ({ period: periodFor('range', eff), district: args.district || null }),
  load: (tenantId, p) => field.coverageRecapSummary(tenantId, { period: p.period, district: p.district || undefined }),
};

const collectionDays = {
  key: 'collectionDays', domains: ['visits', 'partners'], varies: [],
  params: (def, eff) => ({ month: eff.period ? eff.period.to : null }),
  load: (tenantId, p) => field.collectionDaysSummary(tenantId, { month: p.month }),
};

const monthsOverview = {
  key: 'monthsOverview', domains: ['visits'], varies: [],
  params: (def, eff) => periodFor('year', eff) || {},
  load: (tenantId, p) => field.monthsOverview(tenantId, { year: p.year }),
};

const planBoard = {
  key: 'planBoard', domains: [...SITES, 'submissions', 'mmr', 'activation'], varies: ['today'],
  params: (def, eff) => periodFor('year', eff) || {},
  load: (tenantId, p) => field.planBoard(tenantId, { year: p.year || new Date().getFullYear() }),
};

const rbmSites = {
  key: 'rbmSites', domains: [...SITES, 'submissions'], varies: ['today'],
  params: (def, eff) => ({ month: eff.period ? eff.period.to : null }),
  load: (tenantId, p) => field.rbmSites(tenantId, { month: p.month, asOf: p.month, explain: true }),
};

const mmr = {
  key: 'mmr', domains: ['mmr'], varies: [],
  params: () => ({}),
  load: (tenantId) => settings.listMmr(tenantId),
};

module.exports = [covDash, covFacts, covMatrix, covRecap, collectionDays, monthsOverview, planBoard, rbmSites, mmr];
