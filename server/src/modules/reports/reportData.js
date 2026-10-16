const { dimGroups } = require('../monitoring/coverageDashboard');
const { resultsFromTallies } = require('../monitoring/indicatorTallies');

/**
 * Bulletin rédigé automatiquement (lot 7a) — PUR, testé. Le point de départ que
 * l'utilisateur complète ou réécrit dans l'éditeur, écrit à partir des chiffres clés du
 * catalogue (mêmes sources que les tableaux de bord : faits site × mois pour la
 * couverture, résultats des fiches pour la conformité) — l'ancien calcul de reportData
 * (BUILDERS, computeKpis : couverture = clés de soumissions ÷ sites actifs) est supprimé.
 */

/** Mois « AAAA-MM » de from à to inclus (120 au plus). */
function monthsBetween(from, to) {
  const out = []; let [y, m] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } if (out.length > 120) break; }
  return out;
}

const pct1 = (r) => (r == null ? null : Math.round(r * 1000) / 10);

/**
 * Constats du bulletin : domaines faibles (score < 60) par activité ayant des données, et
 * activités à couverture insuffisante (< 30 %, sites actifs réalisés ÷ sites actifs).
 * @param {{forms:object[]}|null} mon source monForms ; @param {object|null} cov source covFacts
 */
function bulletinFindings(mon, cov) {
  const weak = [];
  for (const f of (mon && mon.forms) || []) {
    let n = 0; for (const c of f.facts.counts.values()) n += c.total;
    if (!n) continue;
    for (const d of dimGroups(resultsFromTallies(f.facts.inds, f.facts.overall))) if (d.score < 60) weak.push({ name: d.name, form: f.label, score: d.score });
  }
  // Couverture des tableaux de bord (une seule source) : { coverage: { rate } } par activité de l'univers.
  const rateOf = (a) => (a.coverage && typeof a.coverage === 'object' ? a.coverage.rate : a.coverage);
  const lowCov = ((cov && cov.byActivity) || []).filter((a) => a.key !== '—' && rateOf(a) != null && rateOf(a) < 0.3)
    .map((a) => ({ label: a.label, pct: pct1(rateOf(a)) }));
  return { weak: weak.slice(0, 5), lowCov };
}

// Phrases du bulletin auto-rédigé, par langue du rapport.
const BULLETIN_TEXT = {
  fr: {
    intro: (p) => `Sur la période ${String(p).charAt(0).toLowerCase()}${String(p).slice(1)}, `, sites: (n, a) => `${n} site(s) actif(s) sur ${a}`, collected: ' ont été suivis (visite déclarée ou données reçues)',
    coverage: (n) => `, soit une couverture de ${n} %`, visits: (d, p) => `. ${d} visite(s) prévue(s) sur ${p} ont été suivies`,
    conformity: 'L\'indice de conformité moyen s\'établit à ', weak: 'Domaines sous 60 % : ', lowCov: 'Couverture insuffisante (< 30 %) : ',
    pctSep: ' : ', locale: 'fr-FR',
  },
  en: {
    intro: (p) => `Over the period ${p}, `, sites: (n, a) => `${n} of ${a} active site(s)`, collected: ' were monitored (declared visit or data received)',
    coverage: (n) => `, i.e. a coverage of ${n} %`, visits: (d, p) => `. ${d} of ${p} planned visit(s) were monitored`,
    conformity: 'The average compliance index stands at ', weak: 'Domains below 60 %: ', lowCov: 'Insufficient coverage (< 30 %): ',
    pctSep: ': ', locale: 'en-GB',
  },
};

/**
 * @param {object} kpis valeurs des chiffres clés (sites_active, sites_realised, coverage,
 *   visits_realised, visits_planned, execution_rate, conformity) ; null = non calculable
 * @param {{weak, lowCov}} findings bulletinFindings
 */
function bulletinDoc(kpis, findings, periodText, lang = 'fr') {
  const T = BULLETIN_TEXT[lang] || BULLETIN_TEXT.fr;
  const seg = (x, o = {}) => ({ x, ...o });
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString(T.locale));
  const nodes = [];
  nodes.push({ t: 'p', c: [seg(T.intro(periodText)), seg(T.sites(n(kpis.sites_realised), n(kpis.sites_active)), { b: true }),
    seg(T.collected), seg(kpis.coverage != null ? T.coverage(n(kpis.coverage)) : ''),
    seg(T.visits(n(kpis.visits_realised), n(kpis.visits_planned))),
    seg(kpis.execution_rate != null ? ` (${n(kpis.execution_rate)} %).` : '.')] });
  if (kpis.conformity != null) {
    nodes.push({ t: 'p', c: [seg(T.conformity), seg(`${n(kpis.conformity)} %`, { b: true }), seg('.')] });
  }
  const f = findings || { weak: [], lowCov: [] };
  if (f.weak.length) nodes.push({ t: 'p', c: [seg(T.weak, { b: true })] }, { t: 'ul', items: f.weak.map((w) => [seg(`${w.name} (${w.form}${T.pctSep}${w.score} %)`)]) });
  if (f.lowCov.length) nodes.push({ t: 'p', c: [seg(T.lowCov, { b: true }), seg(f.lowCov.map((a) => `${a.label} (${n(a.pct)} %)`).join(', '))] });
  return { nodes };
}

const BULLETIN_METRICS = ['sites_active', 'sites_realised', 'coverage', 'visits_realised', 'visits_planned', 'execution_rate', 'conformity'];

module.exports = { bulletinDoc, bulletinFindings, monthsBetween, BULLETIN_METRICS };
