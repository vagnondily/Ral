const { DATASETS } = require('./reportModel');

/**
 * Mise en forme PURE des données d'un rapport (testée, sans I/O). Entrée :
 * les agrégats calculés une fois pour la période par les repositories —
 *   monitoring : { forms[], regions[], submissions }   (reportMonitoringData)
 *   field      : { byOffice[], monthly[] }             (reportFieldData)
 *   budget     : { rows[], totals }                    (consolidation)
 *   pdd        : [{ month, beneficiaries, … }]         (reportPddByMonth)
 * Sortie : jeux de données { columns, rows } et chiffres clés, filtrés par
 * activité (formId), bureau ou domaine (module).
 */
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const cols = (key, extra = []) => [...DATASETS[key].columns, ...extra].map(([k, label, type]) => ({ key: k, label, type }));

function formsOf(monitoring, { formId } = {}) {
  const all = (monitoring && monitoring.forms) || [];
  return formId ? all.filter((f) => f.id === formId) : all;
}

const BUILDERS = {
  activity_coverage: ({ monitoring }, f) => ({
    columns: cols('activity_coverage'),
    rows: formsOf(monitoring, f).map((m) => ({
      activity: m.label, visits: m.visits, sitesVisited: m.sitesVisited, sitesActive: m.sitesActive,
      coverage: m.sitesActive ? pct(m.sitesVisited, m.sitesActive) : null, score: m.index,
    })),
  }),

  activity_domains: ({ monitoring }, f) => {
    const forms = formsOf(monitoring, f);
    const domains = [...new Set(forms.flatMap((m) => m.dims.map((d) => d.name)))].sort((a, b) => a.localeCompare(b, 'fr'));
    return {
      columns: [cols('activity_domains')[0], ...domains.map((d) => ({ key: `d:${d}`, label: d, type: 'pct' })), cols('activity_domains')[1]],
      rows: forms.map((m) => ({ activity: m.label, score: m.index, ...Object.fromEntries(m.dims.map((d) => [`d:${d.name}`, d.score])) })),
    };
  },

  bureau_domains: ({ monitoring }, f) => {
    const form = formsOf(monitoring, f)[0];
    if (!form) return { columns: cols('bureau_domains'), rows: [], note: 'Choisissez une activité (fiche).' };
    const bureaux = f.bureau ? form.bureaux.filter((b) => b.bureau === f.bureau) : form.bureaux;
    const domains = [...new Set(bureaux.flatMap((b) => b.dims.map((d) => d.name)))].sort((a, b) => a.localeCompare(b, 'fr'));
    const base = cols('bureau_domains');
    return {
      columns: [base[0], base[1], ...domains.map((d) => ({ key: `d:${d}`, label: d, type: 'pct' })), base[2]],
      rows: bureaux.map((b) => ({ bureau: b.bureau, n: b.n, score: b.index, ...Object.fromEntries(b.dims.map((d) => [`d:${d.name}`, d.score])) })),
    };
  },

  indicator_list: ({ monitoring }, f) => {
    const form = formsOf(monitoring, f)[0];
    if (!form) return { columns: cols('indicator_list'), rows: [], note: 'Choisissez une activité (fiche).' };
    const list = f.module ? form.indicators.filter((i) => (i.module || '') === f.module) : form.indicators;
    return {
      columns: cols('indicator_list'),
      rows: list.map((i) => ({ label: i.label, module: i.module, value: i.value == null ? null : Math.round(i.value * 10) / 10, base: i.base, target: i.target, band: i.cls })),
    };
  },

  bureau_coverage: ({ field }, f) => ({
    columns: cols('bureau_coverage'),
    rows: ((field && field.byOffice) || []).filter((b) => !f.bureau || b.bureau === f.bureau)
      .map((b) => ({ bureau: b.bureau, sitesActive: b.sitesActive, planned: b.planned, done: b.done, rate: pct(b.done, b.planned) })),
  }),

  plan_vs_actual: ({ field }) => ({
    columns: cols('plan_vs_actual'),
    rows: ((field && field.monthly) || []).map((m) => ({ month: m.month, planned: m.planned, done: m.done, rate: pct(m.done, m.planned) })),
  }),

  completeness_monthly: ({ monitoring }, f, period) => {
    const months = monthsBetween(period.from, period.to);
    return {
      columns: [...cols('completeness_monthly'), ...months.map((m) => ({ key: `m:${m}`, label: m, type: 'pct' }))],
      rows: formsOf(monitoring, f).map((m) => {
        const byMonth = new Map((m.monthly || []).map((x) => [x.month, x.sites]));
        return { activity: m.label, target: m.sitesActive, ...Object.fromEntries(months.map((mm) => [`m:${mm}`, m.sitesActive ? pct(byMonth.get(mm) || 0, m.sitesActive) : null])) };
      }),
    };
  },

  region_submissions: ({ monitoring }) => ({ columns: cols('region_submissions'), rows: (monitoring && monitoring.regions) || [] }),

  budget_contracts: ({ budget }) => ({
    columns: cols('budget_contracts'),
    rows: ((budget && budget.rows) || []).map((r) => ({
      contract: r.numero, partner: r.partnerName, budget: r.budget, planned: r.planned, actual: r.actual,
      rate: r.actualRate == null ? null : Math.round(r.actualRate * 1000) / 10, remaining: r.budget != null && r.actual != null ? Math.round((r.budget - r.actual) * 100) / 100 : null,
    })),
  }),

  pdd_by_month: ({ pdd }) => ({
    columns: cols('pdd_by_month'),
    rows: (pdd || []).map((m) => ({ month: m.month, beneficiaries: m.beneficiaries, households: m.households, food: Math.round((m.food || 0) * 1000) / 1000, cash: m.cash })),
  }),
};

function monthsBetween(from, to) {
  const out = []; let [y, m] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } if (out.length > 120) break; }
  return out;
}

/** Jeu de données `key` filtré. */
function buildDataset(key, sources, filters = {}, period) {
  const b = BUILDERS[key];
  if (!b) throw new Error(`Jeu de données inconnu : ${key}`);
  return b(sources, filters || {}, period);
}

/** Chiffres clés (bloc « kpis », variables du texte, bulletin). */
function computeKpis(sources, filters = {}) {
  const forms = formsOf(sources.monitoring, filters);
  const offices = ((sources.field && sources.field.byOffice) || []).filter((b) => !filters.bureau || b.bureau === filters.bureau);
  const sum = (arr, k) => arr.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  const sitesActiveForms = forms.filter((f) => f.sitesActive != null);
  const sitesActive = sitesActiveForms.length ? sum(sitesActiveForms, 'sitesActive') : sum(offices, 'sitesActive');
  const sitesVisited = sum(forms, 'sitesVisited');
  const planned = sum(offices, 'planned'); const done = sum(offices, 'done');
  const indices = forms.map((f) => (filters.bureau ? (f.bureaux.find((b) => b.bureau === filters.bureau) || {}).index : f.index)).filter((x) => x != null);
  const budgetRows = (sources.budget && sources.budget.rows) || [];
  const pddRows = sources.pdd || [];
  const budgetTotal = sum(budgetRows, 'budget'); const budgetActual = sum(budgetRows, 'actual');
  return {
    sites_active: sitesActive, sites_visited: sitesVisited, coverage: pct(sitesVisited, sitesActive),
    visits_done: done, visits_planned: planned, execution_rate: pct(done, planned),
    submissions: filters.formId || filters.bureau ? sum(forms, 'visits') : (sources.monitoring ? sources.monitoring.submissions : 0),
    conformity: indices.length ? Math.round(indices.reduce((a, b) => a + b, 0) / indices.length) : null,
    budget_total: budgetTotal, budget_actual: budgetActual, consumption: pct(budgetActual, budgetTotal),
    pdd_beneficiaries: sum(pddRows, 'beneficiaries'), pdd_food: Math.round(sum(pddRows, 'food') * 10) / 10, pdd_cash: Math.round(sum(pddRows, 'cash')),
  };
}

/** Éléments d'un bloc répété : une entrée par activité (fiche avec données) ou par bureau. */
function repeatItems(over, sources) {
  if (over === 'activity') {
    return formsOf(sources.monitoring).filter((f) => f.visits > 0).map((f) => ({ key: f.id, label: f.label, filters: { formId: f.id } }));
  }
  const names = new Set(((sources.field && sources.field.byOffice) || []).map((b) => b.bureau));
  formsOf(sources.monitoring).forEach((f) => f.bureaux.forEach((b) => names.add(b.bureau)));
  return [...names].sort((a, b) => a.localeCompare(b, 'fr')).map((b) => ({ key: b, label: b, filters: { bureau: b } }));
}

/**
 * Bulletin rédigé automatiquement (texte riche) à partir des chiffres : le
 * point de départ que l'utilisateur complète ou réécrit dans l'éditeur.
 */
function bulletinDoc(kpis, sources, periodText) {
  const seg = (x, o = {}) => ({ x, ...o });
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('fr-FR'));
  const nodes = [];
  nodes.push({ t: 'p', c: [seg(`Sur la période ${periodText}, `), seg(`${n(kpis.sites_visited)} site(s)`, { b: true }),
    seg(' ont fait l\'objet d\'au moins une collecte'), seg(kpis.coverage != null ? `, soit une couverture de ${n(kpis.coverage)} %` : ''),
    seg(`. ${n(kpis.visits_done)} visite(s) réalisée(s) sur ${n(kpis.visits_planned)} planifiée(s)`),
    seg(kpis.execution_rate != null ? ` (${n(kpis.execution_rate)} %).` : '.')] });
  if (kpis.conformity != null) {
    nodes.push({ t: 'p', c: [seg('L\'indice de conformité moyen s\'établit à '), seg(`${n(kpis.conformity)} %`, { b: true }), seg('.')] });
  }
  const forms = formsOf(sources.monitoring).filter((f) => f.visits > 0);
  const weak = forms.flatMap((f) => f.dims.filter((d) => d.score < 60).map((d) => `${d.name} (${f.label} : ${d.score} %)`)).slice(0, 5);
  if (weak.length) nodes.push({ t: 'p', c: [seg('Domaines sous 60 % : ', { b: true })] }, { t: 'ul', items: weak.map((w) => [seg(w)]) });
  const lowCov = forms.filter((f) => f.sitesActive && pct(f.sitesVisited, f.sitesActive) < 30).map((f) => `${f.label} (${pct(f.sitesVisited, f.sitesActive)} %)`);
  if (lowCov.length) nodes.push({ t: 'p', c: [seg('Couverture insuffisante (< 30 %) : ', { b: true }), seg(lowCov.join(', '))] });
  return { nodes };
}

module.exports = { buildDataset, computeKpis, repeatItems, bulletinDoc, monthsBetween, BUILDERS };
