const { overallIndex, classify, naReason, interpretIndicator } = require('../../monitoring/monitoringMath');
const { classDistribution, naReasonCounts, dimGroups, topFlop } = require('../../monitoring/coverageDashboard');
const { resultsFromTallies, explainOf } = require('../../monitoring/indicatorTallies');
const { codeLabelText } = require('../../common/codeLabel');
const { monthsOf } = require('../../common/period');
const { phrases } = require('../phrases');
const {
  col, round1, pctOf, formResults, formCount, byBureau, byMonth, bureauLabel, visitsOf, findIndicator, splitGroup,
} = require('./facts');

/**
 * Jeux de données « Suivi de processus » (lot 7a, C4) — déclarations PURES. Sources :
 *  - monForms : faits d'indicateurs de chaque fiche (un passage par fiche, groupés par
 *    bureau × mois, score de chaque visite) — les résultats sont ceux de la Synthèse et de
 *    Couverture & performance (mêmes décomptes, mêmes overallIndex / classify / dimGroups) ;
 *  - monData : comptages SQL des données versées (aucune réponse lue) ;
 *  - monAgents : faits groupés par agent ; monSubmissions : liste bornée des soumissions.
 */

const ORIGIN_SYNTH = { page: 'Suivi de processus › Tableau de bord', route: '#/processus/tableau-de-bord' };
const ORIGIN_COV = { page: 'Dashboard › Couverture & performance', route: '#/dashboard/couverture' };
const ORIGIN_RES = { page: 'Suivi de processus › Données & indicateurs', route: '#/processus/donnees' };
const MON_FILTERS = ['office', 'activity', 'partner', 'form'];
const BAND_KEYS = ['exc', 'sat', 'imp', 'urg', 'na'];
const indexBand = (v) => (v == null ? 'na' : classify({ value: v, base: 1, agg: 'percent_yes', target: null, direction: 'higher_better' }));

/** Fiches ayant des soumissions sur la période (et les filtres) : les activités « avec données ». */
const formsOf = (raw) => (raw.forms || []).filter((f) => formCount(f) > 0);
const allResults = (raw) => formsOf(raw).flatMap(formResults);
const oneForm = (raw, eff) => (eff.formId ? (raw.forms || []).find((f) => f.id === eff.formId) : (raw.forms || []).length === 1 ? raw.forms[0] : null);
const domainsOf = (results) => dimGroups(results);
const domainCols = (names) => names.map((d) => col(`d:${d}`, d, 'pct'));
const sortedNames = (list) => [...new Set(list)].sort((a, b) => a.localeCompare(b, 'fr'));
const nForms = (raw) => formsOf(raw).reduce((a, f) => a + formCount(f), 0);

function ds(key, def) {
  return { key, group: 'monitoring', filters: MON_FILTERS, periodMode: 'range', ...def };
}

// ---- Données versées (monData) ------------------------------------------------------------
const DATA_COLS = [
  col('submissions', 'Soumissions', 'int'), col('dataSites', 'Sites (données)', 'int'),
  col('registrySites', 'Sites du registre avec données', 'int'), col('unlinkedPlaces', 'Lieux non rattachés', 'int'),
  col('communes', 'Communes', 'int'), col('agents', 'Agents', 'int'), col('partners', 'Partenaires', 'int'),
  col('offices', 'Bureaux', 'int'), col('forms', 'Fiches', 'int'),
];

const kpisData = ds('mon.kpis_data', {
  label: 'Données versées (chiffres clés)', origin: ORIGIN_SYNTH, source: 'monData', views: ['kpi', 'table'], defaultView: 'kpi',
  columns: DATA_COLS,
  shape(raw) {
    const t = raw.totals || {};
    return { columns: DATA_COLS, rows: [{ ...t }], meta: { n: t.submissions || 0, nLabel: 'soumissions' } };
  },
});

const TREND_COLS = [col('month', 'Mois', 'month'), col('submissions', 'Soumissions', 'int')];
const trendSubmissions = ds('mon.trend_submissions', {
  label: 'Tendance mensuelle des soumissions', origin: ORIGIN_SYNTH, source: 'monData', views: ['line', 'column', 'table'], defaultView: 'column',
  columns: TREND_COLS,
  shape(raw) {
    const rows = raw.trend || [];
    return { columns: TREND_COLS, rows, meta: { n: rows.reduce((a, r) => a + r.submissions, 0), nLabel: 'soumissions' } };
  },
});

const BUREAU_COLS = [col('bureau', 'Bureau'), col('submissions', 'Soumissions', 'int'), col('sites', 'Sites (données)', 'int'), col('registrySites', 'Sites du registre', 'int')];
const byBureauData = ds('mon.by_bureau', {
  label: 'Données versées par bureau', origin: ORIGIN_SYNTH, source: 'monData', views: ['bar', 'table'], defaultView: 'bar',
  columns: BUREAU_COLS,
  shape(raw, eff, ctx) {
    const rows = (raw.byBureau || []).map((r) => ({
      _key: r.key, bureau: codeLabelText(r, { formLabel: r.status === 'non_relie' ? r.formLabel : null, lang: ctx.lang }),
      submissions: r.submissions, sites: r.sites, registrySites: r.registrySites,
    }));
    return { columns: BUREAU_COLS, rows, meta: { n: rows.reduce((a, r) => a + r.submissions, 0), nLabel: 'soumissions' } };
  },
});

const REGION_COLS = [col('region', 'Région'), col('submissions', 'Soumissions', 'int'), col('communes', 'Communes', 'int')];
const byRegion = ds('mon.by_region', {
  label: 'Données versées par région', origin: ORIGIN_SYNTH, source: 'monData', views: ['bar', 'table'], defaultView: 'table',
  columns: REGION_COLS,
  shape(raw, eff, ctx) {
    if (raw.regions == null) return { columns: REGION_COLS, rows: [], meta: { note: phrases(ctx.lang).notByUnlinkedOffice } };
    return { columns: REGION_COLS, rows: raw.regions, meta: { n: raw.regions.reduce((a, r) => a + r.submissions, 0), nLabel: 'soumissions' } };
  },
});

// ---- Conformité (monForms) -----------------------------------------------------------------
const FORMS_COLS = [
  col('activity', 'Activité'), col('submissions', 'Soumissions', 'int'), col('indicators', 'Indicateurs', 'int'),
  col('scored', 'Indicateurs notés', 'int'), col('index', 'Indice de conformité', 'pct'), col('band', 'Classe', 'band'),
];
const formsIndex = ds('mon.forms_index', {
  label: 'Conformité par activité', origin: ORIGIN_SYNTH, source: 'monForms', views: ['bar', 'table'], defaultView: 'bar',
  columns: FORMS_COLS, measures: ['index'],
  shape(raw) {
    const rows = formsOf(raw).map((f) => {
      const r = formResults(f);
      const index = overallIndex(r);
      return { _key: f.id, activity: f.label, submissions: formCount(f), indicators: f.facts.inds.length, scored: classDistribution(r).scored, index, band: indexBand(index) };
    });
    return { columns: FORMS_COLS, rows, meta: { n: nForms(raw), nLabel: 'soumissions' } };
  },
});

const CLASS_COLS = [
  col('activity', 'Activité'), col('exc', 'Excellent', 'int'), col('sat', 'Satisfaisant', 'int'), col('imp', 'À améliorer', 'int'),
  col('urg', 'Action urgente', 'int'), col('na', 'Non évalué', 'int'), col('scored', 'Indicateurs notés', 'int'),
];
const conformityClasses = ds('mon.conformity_classes', {
  label: 'Répartition des indicateurs en 5 classes', origin: ORIGIN_COV, source: 'monForms', views: ['stacked', 'donut', 'table'], defaultView: 'stacked',
  columns: CLASS_COLS, measures: BAND_KEYS,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const rows = formsOf(raw).map((f) => ({ _key: f.id, activity: f.label, ...classDistribution(formResults(f)) }));
    if (rows.length > 1) rows.push({ _key: 'total', activity: T.total, ...classDistribution(allResults(raw)) });
    return { columns: CLASS_COLS, rows, meta: { n: nForms(raw), nLabel: 'soumissions' } };
  },
});

const DOMAIN_COLS = [col('domain', 'Domaine'), col('score', 'Score moyen', 'pct'), col('n', 'Indicateurs', 'int'), col('band', 'Classe', 'band')];
const domains = ds('mon.domains', {
  label: 'Profil par domaine (score moyen)', origin: ORIGIN_COV, source: 'monForms', views: ['bar', 'table'], defaultView: 'bar',
  columns: DOMAIN_COLS, measures: ['score'],
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const rows = domainsOf(allResults(raw)).map((d) => ({ _key: d.name, domain: d.name === '(sans dimension)' ? T.noDomain : d.name, score: d.score, n: d.n, band: indexBand(d.score) }));
    return { columns: DOMAIN_COLS, rows, meta: { n: nForms(raw), nLabel: 'soumissions' } };
  },
});

const domainsByActivity = ds('mon.domains_by_activity', {
  label: 'Scores par domaine et par activité', origin: ORIGIN_COV, source: 'monForms', views: ['heat', 'table', 'bar'], defaultView: 'heat',
  columns: [col('activity', 'Activité'), col('score', 'Indice', 'pct')], dynamicColumns: 'domains',
  shape(raw) {
    const per = formsOf(raw).map((f) => { const r = formResults(f); return { f, dims: domainsOf(r), index: overallIndex(r) }; });
    const names = sortedNames(per.flatMap((x) => x.dims.map((d) => d.name)));
    const rows = per.map(({ f, dims, index }) => ({ _key: f.id, activity: f.label, score: index, ...Object.fromEntries(dims.map((d) => [`d:${d.name}`, d.score])) }));
    return { columns: [col('activity', 'Activité'), ...domainCols(names), col('score', 'Indice', 'pct')], rows, meta: { n: nForms(raw), nLabel: 'soumissions' } };
  },
});

const domainsByBureau = ds('mon.domains_by_bureau', {
  label: 'Scores par domaine et par bureau', origin: ORIGIN_COV, source: 'monForms', views: ['heat', 'table', 'bar'], defaultView: 'heat',
  columns: [col('bureau', 'Bureau'), col('n', 'Soumissions', 'int'), col('score', 'Indice', 'pct')], dynamicColumns: 'domains',
  shape(raw, eff, ctx) {
    const base = [col('bureau', 'Bureau'), col('n', 'Soumissions', 'int')];
    const form = oneForm(raw, eff);
    if (!form) return { columns: [...base, col('score', 'Indice', 'pct')], rows: [], meta: { note: phrases(ctx.lang).chooseForm } };
    const per = [...byBureau(form)].map(([k, g]) => { const r = resultsFromTallies(form.facts.inds, g.tallies); return { k, g, dims: domainsOf(r), index: overallIndex(r) }; });
    const names = sortedNames(per.flatMap((x) => x.dims.map((d) => d.name)));
    // Tableau d'UNE fiche : le bureau sans le nom de la fiche (déjà connu).
    const rows = per.map(({ k, g, dims, index }) => ({ _key: k, bureau: bureauLabel(g.meta, { lang: ctx.lang }), n: g.total, score: index, ...Object.fromEntries(dims.map((d) => [`d:${d.name}`, d.score])) }))
      .sort((a, b) => b.n - a.n || String(a._key).localeCompare(String(b._key)));
    return { columns: [...base, ...domainCols(names), col('score', 'Indice', 'pct')], rows, meta: { n: formCount(form), nLabel: 'soumissions' } };
  },
});

// ---- Indicateurs d'une fiche ---------------------------------------------------------------
const IND_COLS = [
  col('label', 'Indicateur'), col('module', 'Domaine'), col('value', 'Valeur', 'dec'), col('base', 'Base (n)', 'int'),
  col('target', 'Cible', 'dec'), col('band', 'Classe', 'band'), col('reason', 'Pourquoi non évalué'),
];
function indicatorRows(form, eff, lang) {
  const T = phrases(lang);
  const n = formCount(form);
  return formResults(form).filter((r) => !eff.module || (r.module || '') === eff.module).map((r) => {
    const why = naReason(r, { periodCount: n });
    return {
      _key: r.id, label: r.label, module: r.module || null, value: round1(r.value), base: r.base, target: r.target == null ? null : Number(r.target),
      band: classify(r), reason: why ? T.naReasons[why] : null, agg: r.agg,
    };
  });
}
const indicators = ds('mon.indicators', {
  label: 'Indicateurs (valeur, base, cible, classe)', origin: ORIGIN_RES, source: 'monForms', filters: [...MON_FILTERS, 'module'],
  views: ['table', 'bar'], defaultView: 'table', columns: IND_COLS, measures: ['value'],
  shape(raw, eff, ctx) {
    const form = oneForm(raw, eff);
    if (!form) return { columns: IND_COLS, rows: [], meta: { note: phrases(ctx.lang).chooseForm } };
    return { columns: IND_COLS, rows: indicatorRows(form, eff, ctx.lang), meta: { n: formCount(form), nLabel: 'soumissions' } };
  },
});

const BARS_COLS = [col('label', 'Indicateur'), col('module', 'Domaine'), col('value', 'Valeur', 'pct'), col('base', 'Base (n)', 'int'), col('band', 'Classe', 'band')];
const indicatorBars = ds('mon.indicator_bars', {
  label: 'Barres d\'indicateurs par domaine', origin: ORIGIN_RES, source: 'monForms', filters: [...MON_FILTERS, 'module'],
  views: ['bar', 'table'], defaultView: 'bar', columns: BARS_COLS, measures: ['value'],
  shape(raw, eff, ctx) {
    const form = oneForm(raw, eff);
    if (!form) return { columns: BARS_COLS, rows: [], meta: { note: phrases(ctx.lang).chooseForm } };
    const rows = indicatorRows(form, eff, ctx.lang).filter((r) => (r.agg === 'percent_yes' || r.agg === 'percent_value') && r.value != null)
      .sort((a, b) => String(a.module || '').localeCompare(String(b.module || ''), 'fr') || b.value - a.value)
      .map(({ agg: _a, reason: _r, target: _t, ...r }) => r);
    return { columns: BARS_COLS, rows, meta: { n: formCount(form), nLabel: 'soumissions' } };
  },
});

const TF_COLS = [col('kind', 'Type'), col('label', 'Indicateur'), col('value', 'Valeur', 'pct')];
const topFlopDs = ds('mon.top_flop', {
  label: 'Points forts et points faibles', origin: ORIGIN_COV, source: 'monForms', views: ['list', 'table'], defaultView: 'list',
  columns: TF_COLS,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const { top, flop } = topFlop(allResults(raw), { nTop: 5, nFlop: 5 });
    const rows = [...top.map((x) => ({ _key: `t:${x.label}`, kind: T.strength, label: x.label, value: x.pct, tone: 'exc' })),
      ...flop.map((x) => ({ _key: `f:${x.label}`, kind: T.weakness, label: x.label, value: x.pct, tone: 'urg' }))];
    return { columns: TF_COLS, rows, meta: { n: nForms(raw), nLabel: 'soumissions' } };
  },
});

const WEAK_COLS = [col('domain', 'Domaine'), col('score', 'Score moyen', 'pct'), col('n', 'Indicateurs', 'int'), col('weakest', 'Indicateur le plus faible'), col('weakestPct', 'Valeur', 'pct')];
const weakModules = ds('mon.weak_modules', {
  label: 'Domaines à renforcer en priorité', origin: ORIGIN_COV, source: 'monForms', views: ['list', 'bar', 'table'], defaultView: 'list',
  columns: WEAK_COLS, measures: ['score'],
  args: { threshold: { type: 'number', label: 'Seuil (score < …)', default: 65 } },
  shape(raw, eff, ctx) {
    const thr = ctx.args && ctx.args.threshold != null ? Number(ctx.args.threshold) : 65;
    const T = phrases(ctx.lang);
    const rows = domainsOf(allResults(raw)).filter((d) => d.score < thr).map((d) => ({
      _key: d.name, domain: d.name === '(sans dimension)' ? T.noDomain : d.name, score: d.score, n: d.n,
      weakest: d.inds[0] ? d.inds[0].label : null, weakestPct: d.inds[0] ? d.inds[0].pct : null,
    }));
    return { columns: WEAK_COLS, rows, meta: { n: nForms(raw), nLabel: 'soumissions' } };
  },
});

const TRENDI_COLS = [col('month', 'Mois', 'month'), col('index', 'Indice de conformité', 'pct'), col('submissions', 'Soumissions', 'int')];
const indexTrend = ds('mon.index_trend', {
  label: 'Tendance de l\'indice de conformité', origin: ORIGIN_COV, source: 'monForms', views: ['line', 'column', 'table'], defaultView: 'line',
  columns: TRENDI_COLS, measures: ['index'],
  shape(raw, eff) {
    const per = new Map(); // mois → { results, n }
    for (const f of formsOf(raw)) {
      for (const [m, g] of byMonth(f)) {
        if (!m) continue;
        if (!per.has(m)) per.set(m, { results: [], n: 0 });
        const e = per.get(m);
        e.results.push(...resultsFromTallies(f.facts.inds, g.tallies));
        e.n += g.total;
      }
    }
    const months = eff.period ? monthsOf(eff.period) : [...per.keys()].sort();
    const rows = per.size ? months.map((m) => { const e = per.get(m); return { _key: m, month: m, index: e ? overallIndex(e.results) : null, submissions: e ? e.n : 0 }; }) : [];
    return { columns: TRENDI_COLS, rows, meta: { n: nForms(raw), nLabel: 'soumissions' } };
  },
});

const COMPARE_COLS = [col('bureau', 'Bureau'), col('submissions', 'Soumissions', 'int'), col('index', 'Indice de conformité', 'pct'), col('band', 'Classe', 'band')];
const bureauCompare = ds('mon.bureau_compare', {
  label: 'Comparaison des bureaux (indice de conformité)', origin: ORIGIN_COV, source: 'monForms', views: ['bar', 'table'], defaultView: 'bar',
  columns: COMPARE_COLS, measures: ['index'],
  shape(raw, eff, ctx) {
    const per = new Map();
    const several = formsOf(raw).length > 1;
    for (const f of formsOf(raw)) {
      for (const [k, g] of byBureau(f)) {
        if (!per.has(k)) per.set(k, { results: [], n: 0, label: bureauLabel(g.meta, { formLabel: several ? f.label : null, lang: ctx.lang }) });
        const e = per.get(k);
        e.results.push(...resultsFromTallies(f.facts.inds, g.tallies));
        e.n += g.total;
      }
    }
    const rows = [...per].map(([k, e]) => { const index = overallIndex(e.results); return { _key: k, bureau: e.label, submissions: e.n, index, band: indexBand(index) }; })
      .sort((a, b) => (b.index ?? -1) - (a.index ?? -1) || b.submissions - a.submissions || String(a._key).localeCompare(String(b._key)));
    return { columns: COMPARE_COLS, rows, meta: { n: nForms(raw), nLabel: 'soumissions' } };
  },
});

// ---- Un indicateur : carte de résultat et « Comment c'est calculé » -----------------------
const CARD_COLS = [col('label', 'Indicateur'), col('value', 'Valeur', 'dec'), col('base', 'Base (n)', 'int'), col('target', 'Cible', 'dec'), col('band', 'Classe', 'band'), col('sentence', 'Interprétation'), col('alert', 'Alerte')];
const INDICATOR_ARG = { indicatorId: { type: 'uuid', label: 'Indicateur', required: true, choices: 'indicators' } };
const indicatorCard = ds('mon.indicator_card', {
  label: 'Carte de résultat d\'un indicateur', origin: ORIGIN_RES, source: 'monForms', filters: ['office', 'partner', 'form'],
  views: ['card', 'table'], defaultView: 'card', columns: CARD_COLS, args: INDICATOR_ARG,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const id = ctx.args && ctx.args.indicatorId;
    if (!id) return { columns: CARD_COLS, rows: [], meta: { note: T.chooseIndicator } };
    const hit = findIndicator(raw.forms, id);
    if (!hit) return { columns: CARD_COLS, rows: [], meta: { note: T.unknownIndicator } };
    const r = resultsFromTallies(hit.form.facts.inds, hit.form.facts.overall)[hit.index];
    const i = interpretIndicator(r, ctx.lang);
    const row = { _key: id, label: r.label, module: r.module || null, agg: r.agg, direction: r.direction || null, value: round1(r.value), base: r.base, target: r.target == null ? null : Number(r.target), band: i.rating, sentence: i.sentence, alert: i.alert, activity: hit.form.label };
    return { columns: CARD_COLS, rows: [row], meta: { n: formCount(hit.form), nLabel: 'soumissions' } };
  },
});

const EXPLAIN_COLS = [col('value', 'Réponse'), col('label', 'Libellé'), col('n', 'Effectif', 'int'), col('role', 'Rôle')];
const indicatorExplain = ds('mon.indicator_explain', {
  label: 'Comment c\'est calculé (un indicateur)', origin: ORIGIN_RES, source: 'monForms', filters: ['office', 'partner', 'form'],
  views: ['explain', 'table'], defaultView: 'explain', columns: EXPLAIN_COLS, args: INDICATOR_ARG,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const id = ctx.args && ctx.args.indicatorId;
    if (!id) return { columns: EXPLAIN_COLS, rows: [], meta: { note: T.chooseIndicator } };
    const hit = findIndicator(raw.forms, id);
    if (!hit) return { columns: EXPLAIN_COLS, rows: [], meta: { note: T.unknownIndicator } };
    const x = explainOf(hit.ind, hit.form.facts.overall[hit.index]);
    const rows = x.distribution.map((d) => ({ _key: String(d.value), value: String(d.value), label: d.label, n: d.n, role: d.role }));
    return { columns: EXPLAIN_COLS, rows, meta: { n: x.total, nLabel: 'soumissions', explain: { ...x, label: hit.ind.label, activity: hit.form.label } } };
  },
});

const NA_COLS = [col('reason', 'Raison'), col('count', 'Indicateurs', 'int')];
const naReasons = ds('mon.na_reasons', {
  label: 'Pourquoi « Non évalué »', origin: ORIGIN_COV, source: 'monForms', views: ['table', 'bar'], defaultView: 'table',
  columns: NA_COLS,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const counts = {};
    for (const f of formsOf(raw)) for (const [k, v] of Object.entries(naReasonCounts(formResults(f), formCount(f)))) counts[k] = (counts[k] || 0) + v;
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => ({ _key: k, reason: T.naReasons[k] || k, count: v }));
    return { columns: NA_COLS, rows, meta: { n: nForms(raw), nLabel: 'soumissions' } };
  },
});

// ---- Visites : score par visite (classes, urgentes, signaux) --------------------------------
const VISIT_COLS = [
  col('activity', 'Activité'), col('visits', 'Visites', 'int'), col('exc', 'Excellent', 'int'), col('sat', 'Satisfaisant', 'int'),
  col('imp', 'À améliorer', 'int'), col('urg', 'Action urgente', 'int'), col('na', 'Non évalué', 'int'),
  col('urgentPct', '% urgentes', 'pct'), col('naPct', '% non évaluées', 'pct'), col('meanScore', 'Indice pondéré', 'pct'),
];
const visitRow = (key, activity, v) => ({
  _key: key, activity, visits: v.n, ...v.classes,
  urgentPct: pctOf(v.classes.urg, v.scored), naPct: pctOf(v.classes.na, v.n), meanScore: v.scored ? round1(v.sumScore / v.scored) : null,
});
const visitClasses = ds('mon.visit_classes', {
  label: 'Visites par classe (score par visite)', origin: ORIGIN_COV, source: 'monForms', views: ['stacked', 'donut', 'table'], defaultView: 'stacked',
  columns: VISIT_COLS, measures: BAND_KEYS,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const per = formsOf(raw).map((f) => ({ f, v: visitsOf(f) }));
    const rows = per.map(({ f, v }) => visitRow(f.id, f.label, v));
    if (rows.length > 1) {
      const all = { n: 0, scored: 0, sumScore: 0, classes: { exc: 0, sat: 0, imp: 0, urg: 0, na: 0 } };
      for (const { v } of per) { all.n += v.n; all.scored += v.scored; all.sumScore += v.sumScore; for (const c of BAND_KEYS) all.classes[c] += v.classes[c]; }
      rows.push(visitRow('total', T.total, all));
    }
    return { columns: VISIT_COLS, rows, meta: { n: nForms(raw), nLabel: 'visites', definition: T.definitions.visitScore } };
  },
});

const URGENT_COLS = [col('month', 'Mois', 'month'), col('site', 'Site'), col('bureau', 'Bureau'), col('activity', 'Activité'), col('agent', 'Agent'), col('score', 'Score', 'pct'), col('answered', 'Indicateurs répondus', 'int')];
const urgentVisits = ds('mon.urgent_visits', {
  label: 'Visites en « Action urgente » (les plus faibles)', origin: ORIGIN_COV, source: 'monForms', views: ['table', 'list'], defaultView: 'table',
  columns: URGENT_COLS,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const list = [];
    for (const f of formsOf(raw)) {
      for (const u of visitsOf(f).urgent) {
        const [bk] = splitGroup(u.group || '');
        const meta = [...f.facts.counts].find(([g]) => splitGroup(g)[0] === bk);
        list.push({ _key: u.id, month: u.month, site: u.site, bureau: bureauLabel(meta ? meta[1] : null, { lang: ctx.lang }), activity: f.label, agent: u.agent, score: u.score, answered: u.answered });
      }
    }
    list.sort((a, b) => a.score - b.score || String(a._key).localeCompare(String(b._key)));
    const n = list.length;
    return { columns: URGENT_COLS, rows: list.slice(0, 50), meta: { n, nLabel: 'visites', definition: T.definitions.visitScore } };
  },
});

const SIGNAL_COLS = [col('signal', 'Signal'), col('value', 'Valeur', 'dec')];
const riskSignals = ds('mon.risk_signals', {
  label: 'Signaux de risque (visites et indicateurs)', origin: ORIGIN_COV, source: 'monForms', views: ['list', 'table'], defaultView: 'list',
  columns: SIGNAL_COLS,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    let n = 0; let na = 0; let urg = 0;
    for (const f of formsOf(raw)) { const v = visitsOf(f); n += v.n; na += v.classes.na; urg += v.classes.urg; }
    const rows = [];
    if (urg > 0) rows.push({ _key: 'urgent', signal: T.signals.urgent(urg), value: urg, tone: 'urg' });
    const naPct = pctOf(na, n);
    if (naPct != null && naPct > 0) rows.push({ _key: 'na', signal: T.signals.naVisits(naPct), value: naPct, tone: naPct >= 20 ? 'imp' : 'sat' });
    const { flop } = topFlop(allResults(raw), { nTop: 0, nFlop: 1 });
    if (flop[0]) rows.push({ _key: 'weakest', signal: T.signals.weakest(flop[0].label, flop[0].pct), value: flop[0].pct, tone: indexBand(flop[0].score) });
    return { columns: SIGNAL_COLS, rows, meta: { n, nLabel: 'visites', note: rows.length ? null : T.signals.none, definition: T.definitions.visitScore } };
  },
});

// ---- Qualité de saisie par agent (monAgents) -------------------------------------------------
const AGENT_COLS = [
  col('agent', 'Agent'), col('submissions', 'Soumissions', 'int'), col('fill', 'Réponses exploitables', 'pct'),
  col('blankPct', 'Vides ou hors base', 'pct'), col('index', 'Indice de conformité', 'pct'),
];
const agentQuality = ds('mon.agent_quality', {
  label: 'Qualité de saisie par agent', origin: ORIGIN_COV, source: 'monAgents', views: ['table', 'bar'], defaultView: 'table',
  columns: AGENT_COLS, measures: ['blankPct'],
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const per = new Map();
    for (const f of formsOf(raw)) {
      const scored = f.facts.inds.map((ind, i) => [ind, i]).filter(([ind]) => ind.scored !== false);
      for (const [k, tallies] of f.facts.groups) {
        const key = k.startsWith('raw:') ? `raw:${k.slice(4).trim().toLowerCase()}` : k;
        if (!per.has(key)) per.set(key, { raw: k, n: 0, total: 0, answered: 0, blank: 0, results: [] });
        const e = per.get(key);
        e.n += (f.facts.counts.get(k) || {}).total || 0;
        for (const [, i] of scored) {
          const t = tallies[i];
          let naN = 0; for (const c of t.naExcluded.values()) naN += c;
          e.total += t.total - t.absent; e.answered += t.answered; e.blank += t.blank + naN;
        }
        e.results.push(...resultsFromTallies(f.facts.inds, tallies));
      }
    }
    const nameOf = (key, e) => {
      if (key === 'vide') return codeLabelText(null, { lang: ctx.lang });
      if (key.startsWith('id:')) return (raw.agentNames && raw.agentNames.get(key)) || key;
      return e.raw.slice(4).trim();
    };
    const rows = [...per].map(([k, e]) => ({ _key: k, agent: nameOf(k, e), submissions: e.n, fill: pctOf(e.answered, e.total), blankPct: pctOf(e.blank, e.total), index: overallIndex(e.results) }))
      .sort((a, b) => b.submissions - a.submissions || String(a._key).localeCompare(String(b._key)));
    return { columns: AGENT_COLS, rows, meta: { n: rows.reduce((a, r) => a + r.submissions, 0), nLabel: 'soumissions', definition: T.definitions.agentQuality } };
  },
});

// ---- Soumissions (liste bornée) --------------------------------------------------------------
const SUB_COLS = [col('periodMonth', 'Mois', 'month'), col('formLabel', 'Activité'), col('office', 'Bureau'), col('commune', 'Commune'), col('site', 'Site'), col('partner', 'Partenaire'), col('agent', 'Agent')];
const submissionsList = ds('mon.submissions_list', {
  label: 'Données réelles de la période (liste)', origin: ORIGIN_RES, source: 'monSubmissions', views: ['table'], defaultView: 'table',
  columns: SUB_COLS,
  shape(raw) {
    const rows = (raw || []).map((r, i) => ({
      _key: r.externalId || String(i), periodMonth: r.periodMonth, formLabel: r.formLabel, office: r.officeName || r.fieldOffice || null,
      commune: r.communeName || r.admin3 || null, site: r.siteName || r.site || null, partner: r.partner || null, agent: r.agent || null,
    }));
    return { columns: SUB_COLS, rows, meta: { n: rows.length, nLabel: 'soumissions' } };
  },
});

module.exports = [
  kpisData, trendSubmissions, byBureauData, byRegion, formsIndex, conformityClasses, domains, domainsByActivity, domainsByBureau,
  indicators, indicatorBars, topFlopDs, weakModules, indexTrend, bureauCompare, indicatorCard, indicatorExplain, naReasons,
  agentQuality, submissionsList, visitClasses, urgentVisits, riskSignals,
];
module.exports.indexBand = indexBand;
module.exports.allResults = allResults;
