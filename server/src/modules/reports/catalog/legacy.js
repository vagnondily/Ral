const { buildDataset } = require('../reportData');
const { DATASETS: V1 } = require('../reportModel');
const { phrases } = require('../phrases');

/**
 * Les 10 jeux de données du concepteur v1, sous leurs clés v2 (lot 7a, C3) — PONT
 * provisoire : mêmes calculs qu'avant (reportData.BUILDERS sur les sources
 * reportMonitoringData / reportFieldData / consolidation / PDD), le temps que le
 * catalogue v2 les remplace par les sources partagées des tableaux de bord (C4, C5).
 */
const cols = (v1) => V1[v1].columns.map(([key, label, type]) => ({ key, label, type }));

/**
 * Filtres v2 → filtres v1 : le bureau v1 est un NOM ; seule une clé de bureau MEMS
 * ('id:…') se traduit (nom du bureau) — les autres clés ne sont pas prises en charge ici.
 */
function legacyFilters(eff, ctx) {
  const f = {};
  if (eff.formId) f.formId = eff.formId;
  if (eff.module) f.module = eff.module;
  if (eff.office) {
    const m = /^id:(.+)$/.exec(eff.office);
    const name = m && ctx.officeNames ? ctx.officeNames.get(m[1]) : null;
    if (!name) return { unsupported: true };
    f.bureau = name;
  }
  return f;
}

function legacy(key, v1, extra) {
  return {
    key, source: 'legacy', legacyKey: v1, periodMode: 'range',
    columns: cols(v1),
    shape(raw, eff, ctx) {
      const T = phrases(ctx.lang);
      const f = legacyFilters(eff, ctx);
      if (f.unsupported) return { columns: cols(v1), rows: [], meta: { note: T.notByUnlinkedOffice } };
      const d = buildDataset(v1, raw, f, eff.period);
      // Notes des mises en forme v1 (françaises) → langue du rapport.
      const note = d.note === 'Non disponible par bureau.' ? T.notByOffice : d.note ? T.chooseForm : null;
      return { columns: d.columns, rows: d.rows, meta: { note, n: d.rows.length } };
    },
    ...extra,
  };
}

module.exports = [
  legacy('cov.by_activity', 'activity_coverage', { label: 'Couverture et score par activité', group: 'coverage', filters: ['form'], views: ['table', 'bar'], defaultView: 'table', needs: ['monitoring'] }),
  legacy('mon.domains_by_activity', 'activity_domains', { label: 'Scores par domaine et par activité', group: 'monitoring', filters: ['form'], views: ['table', 'heat', 'bar'], defaultView: 'table', dynamicColumns: 'domains', needs: ['monitoring'] }),
  legacy('mon.domains_by_bureau', 'bureau_domains', { label: 'Scores par domaine et par bureau', group: 'monitoring', filters: ['form', 'office'], views: ['table', 'heat', 'bar'], defaultView: 'table', dynamicColumns: 'domains', needs: ['monitoring'] }),
  legacy('mon.indicators', 'indicator_list', { label: 'Indicateurs (valeur, base, cible)', group: 'monitoring', filters: ['form', 'module'], views: ['table', 'bar'], defaultView: 'table', needs: ['monitoring'] }),
  legacy('cov.by_office', 'bureau_coverage', { label: 'Couverture par bureau', group: 'coverage', filters: ['office'], views: ['table', 'bar'], defaultView: 'table', needs: ['field'] }),
  legacy('cov.monthly', 'plan_vs_actual', { label: 'Plan et réalisé par mois', group: 'coverage', filters: [], views: ['column', 'bar', 'line', 'table'], defaultView: 'column', needs: ['field'] }),
  legacy('cov.completeness_monthly', 'completeness_monthly', { label: 'Complétude mensuelle par activité', group: 'coverage', filters: ['form'], views: ['heat', 'line', 'table', 'bar'], defaultView: 'heat', dynamicColumns: 'months', needs: ['monitoring'] }),
  legacy('mon.by_region', 'region_submissions', { label: 'Données versées par région', group: 'monitoring', filters: [], views: ['table', 'bar'], defaultView: 'table', needs: ['monitoring'] }),
  legacy('bud.by_contract', 'budget_contracts', { label: 'Situation budgétaire par contrat', group: 'budget', filters: [], views: ['table', 'bar'], defaultView: 'table', needs: ['budget'] }),
  legacy('pdd.by_month', 'pdd_by_month', { label: 'Distributions d\'urgence par mois', group: 'pdd', filters: [], views: ['column', 'bar', 'table', 'line'], defaultView: 'column', needs: ['pdd'] }),
];
module.exports.legacyFilters = legacyFilters;
