const consolidationRepo = require('../../tpm/consolidation.repository');
const contractsService = require('../../contracts/contracts.service');
const reportsRepo = require('../../tpm/reports.repository');
const planningRepo = require('../../tpm/planning.repository');
const tpmRepo = require('../../tpm/tpm.repository');
const partnersRepo = require('../../partners/partners.repository');
const partnersService = require('../../partners/partners.service');
const pddRepo = require('../../pdd/pdd.repository');
const healthRepo = require('../../settings/health.repository');
const alertsService = require('../../dashboards/alerts.service');
const { periodBounds } = require('../../common/period');
const { periodFor } = require('./scope');

/**
 * Sources « Budget et contrats, Partenaires et TPM, PDD, Alertes, Qualité » (lot 7a, C5) —
 * seules à appeler ces dépôts et services, tels quels (aucun SQL ici) :
 *  - consolidation : le Suivi budgétaire consolidé, SITUATION AU DERNIER MOIS de la période
 *    (`until` : factures et plans jusque-là, contrats actifs à cette date) ;
 *  - contracts / contractDetail / contractForecast / amendments : le module Contrats ;
 *  - tpmReports, tpmPlans, tpmProviders, tpmEvaluations, partnerSheet, partnerTimeline,
 *    invoice, formations : Partenaires & TPM ;
 *  - pddTotals (sommes SQL), pddByMonth, pddSummary, pddPipeline : Distribution d'urgence ;
 *  - alerts : le Centre d'alertes, lu avec un LECTEUR NEUTRE (droits d'écriture, aucun
 *    utilisateur) : un rapport figé montre toutes les décisions en attente, jamais la vue
 *    personnelle de celui qui le soumet ;
 *  - health / linking : état de la configuration et des liaisons (Paramétrage).
 */
const NEUTRAL_ACTOR = { userId: null, role: 'viewer' };
const range = (eff) => periodFor('range', eff);
const lastMonth = (eff) => (eff.period ? eff.period.to : null);

module.exports = [
  {
    key: 'consolidation', domains: ['budget'], varies: [],
    params: (def, eff) => ({ until: lastMonth(eff) }),
    load: (tenantId, p) => consolidationRepo.consolidation(tenantId, { until: p.until }),
  },
  {
    key: 'contracts', domains: ['budget'], varies: ['today'],
    params: () => ({}),
    load: (tenantId) => contractsService.listContracts(tenantId, {}),
  },
  {
    key: 'contractDetail', domains: ['budget'], varies: [],
    params: (def, eff, args) => ({ id: args.contractId || null }),
    load: (tenantId, p) => (p.id ? contractsService.getContractDetail(tenantId, p.id, NEUTRAL_ACTOR) : null),
  },
  {
    key: 'contractForecast', domains: ['budget'], varies: ['today'],
    params: (def, eff, args) => ({ id: args.contractId || null }),
    load: (tenantId, p) => (p.id ? contractsService.forecast(tenantId, p.id, {}) : null),
  },
  {
    key: 'amendments', domains: ['budget'], varies: [],
    params: (def, eff) => ({ period: range(eff), partnerId: eff.partnerId || null }),
    load: (tenantId, p) => contractsService.amendmentsReport(tenantId, p),
  },
  {
    key: 'tpmReports', domains: ['budget', 'partners'], varies: [],
    params: (def, eff) => ({ partnerId: eff.partnerId || null }),
    load: (tenantId, p) => reportsRepo.listReports(tenantId, { partnerId: p.partnerId || undefined }),
  },
  {
    key: 'tpmPlans', domains: ['budget', 'partners'], varies: [],
    params: () => ({}),
    load: (tenantId) => planningRepo.listPlans(tenantId, {}),
  },
  {
    key: 'tpmProviders', domains: ['partners'], varies: [],
    params: () => ({}),
    load: (tenantId) => tpmRepo.listProviders(tenantId),
  },
  {
    key: 'tpmEvaluations', domains: ['partners'], varies: [],
    params: () => ({}),
    load: (tenantId) => tpmRepo.listAgentsEvaluation(tenantId),
  },
  {
    key: 'formations', domains: ['partners'], varies: [],
    params: (def, eff) => { const p = range(eff); const b = p ? periodBounds(p) : {}; return { lo: b.lo || null, hiExcl: b.hiExcl || null, partnerId: eff.partnerId || null }; },
    load: (tenantId, p) => tpmRepo.listFormationsReport(tenantId, p),
  },
  {
    key: 'partnerSheet', domains: ['partners', 'budget', 'visits'], varies: ['today'],
    params: (def, eff, args) => ({ id: args.partnerId || eff.partnerId || null }),
    load: (tenantId, p) => (p.id ? partnersService.sheet(tenantId, p.id) : null),
  },
  {
    key: 'partnerTimeline', domains: ['partners', 'budget', 'visits'], varies: ['today'],
    params: (def, eff, args) => ({ id: args.partnerId || eff.partnerId || null }),
    load: (tenantId, p) => (p.id ? partnersRepo.timeline(tenantId, p.id, { limit: 50 }) : null),
  },
  {
    key: 'invoice', domains: ['budget'], varies: [],
    params: (def, eff, args) => ({ id: args.reportId || null }),
    load: (tenantId, p) => (p.id ? reportsRepo.invoiceData(tenantId, p.id) : null),
  },
  {
    key: 'pddTotals', domains: ['pdd'], varies: [],
    params: (def, eff) => ({ period: range(eff) }),
    load: (tenantId, p) => pddRepo.reportPddTotals(tenantId, p.period),
  },
  {
    key: 'pddByMonth', domains: ['pdd'], varies: [],
    params: (def, eff) => ({ period: range(eff) }),
    load: (tenantId, p) => pddRepo.reportPddByMonth(tenantId, p.period),
  },
  {
    key: 'pddSummary', domains: ['pdd'], varies: [],
    params: (def, eff, args) => ({ period: range(eff), region: args.region || null, district: args.district || null }),
    load: (tenantId, p) => pddRepo.summaryData(tenantId, { period: p.period, region: p.region || undefined, district: p.district || undefined }),
  },
  {
    key: 'pddPipeline', domains: ['pdd'], varies: [],
    params: (def, eff) => ({ month: lastMonth(eff) }),
    load: (tenantId, p) => pddRepo.pipelineData(tenantId, { month: p.month }),
  },
  {
    key: 'alerts', domains: ['budget', 'visits', 'sites'], varies: ['today'],
    params: () => ({ viewer: 'neutral' }),
    // Lecteur neutre : droits d'écriture (rôle admin) sans utilisateur — toutes les décisions en attente.
    load: (tenantId) => alertsService.alerts({ tenantId, userId: null, role: 'admin' }),
  },
  {
    key: 'health', domains: ['sites', 'offices', 'submissions', 'budget', 'partners', 'mmr'], varies: [],
    params: () => ({}),
    load: (tenantId) => healthRepo.configHealth(tenantId),
  },
  {
    key: 'linking', domains: ['sites', 'offices', 'submissions'], varies: [],
    params: () => ({}),
    load: (tenantId) => healthRepo.linkingCounts(tenantId),
  },
];
module.exports.NEUTRAL_ACTOR = NEUTRAL_ACTOR;
