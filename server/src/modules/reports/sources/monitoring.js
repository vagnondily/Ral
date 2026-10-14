const repo = require('../../monitoring/monitoring.repository');
const { periodFor } = require('./scope');

/**
 * Sources « Suivi de processus » (lot 7a, C4) — seules à appeler le dépôt du suivi :
 *  - monForms : faits d'indicateurs de chaque fiche, un passage par fiche groupé par
 *    bureau × mois, avec le score de chaque visite (tous les jeux mon.* et les chiffres de
 *    conformité partagent CE calcul : un bloc global et un bloc par bureau ne relisent pas
 *    les données) ;
 *  - monData : comptages SQL des données versées ; monAgents : faits groupés par agent ;
 *  - monSubmissions : liste bornée.
 * Les libellés dépendant de la langue sont faits dans les mises en forme (catalogue) : ces
 * sources ne varient ni par langue ni par lecteur.
 */
const scope = (def, eff) => ({
  period: periodFor(def.periodMode || 'range', eff),
  officeKey: eff.office || null, partnerId: eff.partnerId || null, formId: eff.formId || null, activity: eff.activity || null,
});
const DOMAINS = ['submissions', 'monitoring_def'];

const monForms = {
  key: 'monForms', domains: DOMAINS, varies: [],
  params: scope,
  load: (tenantId, p) => repo.reportFormsFacts(tenantId, { ...p, visits: { keep: 50 } }),
};

const monData = {
  key: 'monData', domains: DOMAINS, varies: ['today'],
  params: scope,
  load: (tenantId, p) => repo.reportDataCounts(tenantId, p),
};

const monAgents = {
  key: 'monAgents', domains: [...DOMAINS, 'partners'], varies: [],
  params: scope,
  load: (tenantId, p) => repo.reportAgentFacts(tenantId, p),
};

const monSubmissions = {
  key: 'monSubmissions', domains: ['submissions', 'sites'], varies: [],
  params: (def, eff) => { const s = scope(def, eff); return { period: s.period, scope: { officeKey: s.officeKey, partnerId: s.partnerId, formId: s.formId, activity: s.activity } }; },
  load: (tenantId, p) => repo.listSubmissions(tenantId, { period: p.period, scope: p.scope, limit: 200 }),
};

module.exports = [monForms, monData, monAgents, monSubmissions];
