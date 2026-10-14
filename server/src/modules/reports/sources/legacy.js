const pddRepo = require('../../pdd/pdd.repository');
const consolidationRepo = require('../../tpm/consolidation.repository');
const { memo } = require('./memo');

/**
 * Source « legacy » (lot 7a) : budget (consolidation) et PDD (reportPddByMonth) du concepteur
 * v1, chargés à la demande. Pont provisoire, remplacé en C5 par les sources partagées.
 * Paramètres : { period, parts: ['budget' | 'pdd'] }.
 */
module.exports = {
  key: 'legacy',
  domains: ['budget', 'pdd'],
  varies: ['lang'],
  params: (def, eff) => ({ period: eff.period, parts: [...(def.needs || [])].sort() }),
  async load(tenantId, { period, parts }, ctx) {
    const lang = ctx.lang || 'fr';
    const want = new Set(parts);
    // Chaque partie est calculée une fois par rendu (partagée entre les jeux et les chiffres clés).
    const part = (name, fn) => (want.has(name) ? memo(ctx, `legacy:${name}:${period.from}:${period.to}:${lang}`, fn) : null);
    return {
      budget: await part('budget', () => consolidationRepo.consolidation(tenantId, { today: period.to })),
      pdd: await part('pdd', () => pddRepo.reportPddByMonth(tenantId, period)),
    };
  },
};
