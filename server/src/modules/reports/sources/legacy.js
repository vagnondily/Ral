const monitoringRepo = require('../../monitoring/monitoring.repository');
const fieldRepo = require('../../tpm/field.repository');
const pddRepo = require('../../pdd/pdd.repository');
const consolidationRepo = require('../../tpm/consolidation.repository');
const { memo } = require('./memo');

/**
 * Source « legacy » (lot 7a, C3) : les quatre sources du concepteur v1, chargées à la
 * demande — suivi de processus (reportMonitoringData), terrain (reportFieldData),
 * budget (consolidation) et PDD (reportPddByMonth). Pont provisoire, remplacé en C4 / C5.
 * Paramètres : { period, parts: ['monitoring' | 'field' | 'budget' | 'pdd'] }.
 */
module.exports = {
  key: 'legacy',
  domains: ['submissions', 'monitoring_def', 'sites', 'visits', 'budget', 'pdd'],
  varies: ['lang'],
  params: (def, eff) => ({ period: eff.period, parts: [...(def.needs || [])].sort() }),
  async load(tenantId, { period, parts }, ctx) {
    const lang = ctx.lang || 'fr';
    const want = new Set(parts);
    // Chaque partie est calculée une fois par rendu (partagée entre les jeux et les chiffres clés).
    const part = (name, fn) => (want.has(name) ? memo(ctx, `legacy:${name}:${period.from}:${period.to}:${lang}`, fn) : null);
    return {
      monitoring: await part('monitoring', () => monitoringRepo.reportMonitoringData(tenantId, period, { lang })),
      field: await part('field', () => fieldRepo.reportFieldData(tenantId, period, { lang })),
      budget: await part('budget', () => consolidationRepo.consolidation(tenantId, { today: period.to })),
      pdd: await part('pdd', () => pddRepo.reportPddByMonth(tenantId, period)),
    };
  },
};
