const { phrases } = require('../phrases');
const { col } = require('./facts');

/**
 * Jeux de données « Distribution d'urgence » (lot 7a, C5) — déclarations PURES.
 *  - pddTotals : sommes SQL exactes de la période (jamais une addition de mois en JS) ;
 *  - pddByMonth : par mois ; pddSummary : pddMath.summarize (cash en centimes, tonnages en kg
 *    entiers) par aléa, zone, denrée — région / district en arguments ;
 *  - pddPipeline : besoin vs stock par denrée au dernier mois de la période.
 * Le PDD n'est pas relié aux bureaux MEMS : aucun filtre bureau (note), jamais un total national
 * présenté comme celui d'un bureau.
 */
const ORIGIN = { page: 'Suivi & évaluation › Distribution d\'urgence', route: '#/pdd' };
const ZONE_ARGS = { region: { type: 'text', label: 'Région' }, district: { type: 'text', label: 'District' } };
const ds = (key, def) => ({ key, group: 'pdd', filters: [], officeKinds: [], periodMode: 'range', origin: ORIGIN, ...def });

const KPI_COLS = [
  col('beneficiaries', 'Bénéficiaires', 'int'), col('households', 'Ménages', 'int'), col('food', 'Vivres (t)', 'dec'),
  col('cash', 'Cash (USD)', 'money'), col('distributions', 'Distributions', 'int'),
];
const kpis = ds('pdd.kpis', {
  label: 'Distribution d\'urgence (chiffres clés)', source: 'pddTotals', views: ['kpi', 'table'], defaultView: 'kpi', columns: KPI_COLS,
  shape(raw) {
    const r = raw || {};
    return { columns: KPI_COLS, rows: [{ _key: 'total', beneficiaries: r.beneficiaries, households: r.households, food: r.food, cash: r.cash, distributions: r.distributions }], meta: { n: r.distributions || 0, nLabel: 'distributions' } };
  },
});

const MONTH_COLS = [col('month', 'Mois', 'month'), col('beneficiaries', 'Bénéficiaires', 'int'), col('households', 'Ménages', 'int'), col('food', 'Vivres (t)', 'dec'), col('cash', 'Cash (USD)', 'money')];
const byMonth = ds('pdd.by_month', {
  label: 'Distributions d\'urgence par mois', source: 'pddByMonth', views: ['column', 'bar', 'table', 'line'], defaultView: 'column', columns: MONTH_COLS, measures: ['beneficiaries'],
  shape(raw) {
    const rows = (raw || []).map((m) => ({ _key: m.month, month: m.month, beneficiaries: m.beneficiaries, households: m.households, food: Math.round((m.food || 0) * 1000) / 1000, cash: m.cash }));
    return { columns: MONTH_COLS, rows, meta: { n: rows.length, nLabel: 'mois' } };
  },
});

const aggCols = (first) => [first, col('beneficiaries', 'Bénéficiaires', 'int'), col('households', 'Ménages', 'int'), col('food', 'Vivres (t)', 'dec'), col('cash', 'Cash (USD)', 'money'), col('lines', 'Distributions', 'int')];
const aggRow = (key, label, a) => ({ _key: key, label, beneficiaries: a.beneficiaries, households: a.households, food: a.totalFood, cash: a.cashUsd, lines: a.lines });

const HZ_COLS = aggCols(col('label', 'Type de choc'));
const byHazard = ds('pdd.by_hazard', {
  label: 'Distributions par type de choc', source: 'pddSummary', views: ['bar', 'table'], defaultView: 'bar', columns: HZ_COLS, measures: ['beneficiaries'], args: ZONE_ARGS,
  shape(raw) {
    const rows = Object.entries((raw && raw.byHazard) || {}).map(([k, a]) => aggRow(k, k, a)).sort((a, b) => b.beneficiaries - a.beneficiaries);
    return { columns: HZ_COLS, rows, meta: { n: (raw && raw.total && raw.total.lines) || 0, nLabel: 'distributions' } };
  },
});

const ZONE_COLS = aggCols(col('label', 'Zone'));
const byZone = ds('pdd.by_zone', {
  label: 'Distributions par zone (région, district, commune)', source: 'pddSummary', views: ['table', 'bar'], defaultView: 'table', columns: ZONE_COLS, measures: ['beneficiaries'], args: ZONE_ARGS,
  shape(raw) {
    const rows = [];
    for (const R of (raw && raw.byZone) || []) {
      rows.push({ ...aggRow(`r:${R.name}`, R.name, R), level: 1 });
      for (const D of R.districts) {
        rows.push({ ...aggRow(`d:${R.name}|${D.name}`, `› ${D.name}`, D), level: 2 });
        for (const C of D.communes) rows.push({ ...aggRow(`c:${R.name}|${D.name}|${C.name}`, `›› ${C.name}`, C), level: 3 });
      }
    }
    return { columns: ZONE_COLS, rows, meta: { n: (raw && raw.total && raw.total.lines) || 0, nLabel: 'distributions' } };
  },
});

const COM_COLS = [col('commodity', 'Denrée'), col('mt', 'Tonnage (t)', 'dec'), col('share', 'Part', 'pct')];
const byCommodity = ds('pdd.by_commodity', {
  label: 'Distributions par denrée', source: 'pddSummary', views: ['bar', 'table', 'donut'], defaultView: 'bar', columns: COM_COLS, measures: ['mt'], args: ZONE_ARGS,
  shape(raw) {
    const by = (raw && raw.total && raw.total.byCommodity) || {};
    const kg = (v) => Math.round((Number(v) || 0) * 1000);
    const total = Object.values(by).reduce((a, v) => a + kg(v), 0);
    const rows = Object.entries(by).map(([c, v]) => ({ _key: c, commodity: c, mt: v, share: total ? Math.round((kg(v) / total) * 1000) / 10 : null })).sort((a, b) => b.mt - a.mt);
    return { columns: COM_COLS, rows, meta: { n: (raw && raw.total && raw.total.lines) || 0, nLabel: 'distributions' } };
  },
});

const PIPE_COLS = [
  col('commodity', 'Denrée'), col('need', 'Besoin (t)', 'dec'), col('available', 'Stock disponible (t)', 'dec'), col('gap', 'Écart (t)', 'dec'),
  // Stock ÷ besoin (pipeline) : « Couverture du besoin », jamais la « Couverture » des sites.
  col('coverage', 'Couverture du besoin', 'pct'), col('status', 'Statut', 'status'), col('stockMonth', 'Stock au', 'month'), col('donor', 'Bailleur'),
];
const pipeline = ds('pdd.pipeline', {
  label: 'Pipeline : besoin et stock par denrée', source: 'pddPipeline', periodMode: 'asOf', views: ['table', 'bar'], defaultView: 'table', columns: PIPE_COLS, measures: ['need', 'available'],
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const rows = (raw || []).map((r) => ({
      _key: r.commodity, commodity: r.commodity, need: r.need, available: r.available, gap: r.gap, coverage: Math.round(r.coverage * 1000) / 10,
      status: r.shortfall ? 'rupture' : 'couvert', stockMonth: r.stockMonth, donor: r.donor,
    }));
    return { columns: PIPE_COLS, rows, meta: { n: rows.length, nLabel: 'denrées', asOf: eff.period ? eff.period.to : null, note: rows.length ? null : T.noData } };
  },
});

module.exports = [kpis, byMonth, byHazard, byZone, byCommodity, pipeline];
