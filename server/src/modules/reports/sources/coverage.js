const field = require('../../tpm/field.repository');
const settings = require('../../settings/settings.repository');
const { periodFor, siteOffice } = require('./scope');
const { currentMonth } = require('../../tpm/rbmMath');

/**
 * Sources « Couverture, plan, RBM et sites » (lot 7a, C4) — seules à appeler les dépôts du
 * terrain et du paramétrage :
 *  - covFacts : faits site × mois (service unique du lot 1b) par bureau, district, activité
 *    et mois, visites par prestataire (field.coverageFacts) ;
 *  - covMatrix, covRecap, collectionDays, monthsOverview, planBoard : les calculs des écrans
 *    Affectation & visites et Plan de suivi, appelés tels quels ;
 *  - rbmSites : sites RBM avec leur explication, au dernier mois de la période ;
 *  - mmr : paramètres MMR.
 */
const SITES = ['sites', 'visits', 'offices'];

const covFacts = {
  key: 'covFacts', domains: [...SITES, 'activation'], varies: ['lang'],
  params: (def, eff) => ({ period: periodFor(def.periodMode || 'range', eff), officeId: siteOffice(eff), activity: eff.activity || null }),
  load: (tenantId, p, ctx) => field.coverageFacts(tenantId, { ...p, lang: ctx.lang || 'fr' }),
};

const covMatrix = {
  key: 'covMatrix', domains: ['visits', 'partners'], varies: [],
  params: (def, eff) => ({ period: periodFor('range', eff) }),
  load: (tenantId, p) => field.coverageMatrix(tenantId, { period: p.period }),
};

const covRecap = {
  key: 'covRecap', domains: [...SITES, 'activation'], varies: [],
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
  // Exercice par défaut : année du mois courant LOCAL (APP_TIMEZONE), comme le Plan de suivi.
  load: (tenantId, p) => field.planBoard(tenantId, { year: p.year || Number(currentMonth().slice(0, 4)) }),
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

module.exports = [covFacts, covMatrix, covRecap, collectionDays, monthsOverview, planBoard, rbmSites, mmr];
