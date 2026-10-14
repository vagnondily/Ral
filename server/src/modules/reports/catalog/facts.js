const { resultsFromTallies, mergeAll, mergeVisits } = require('../../monitoring/indicatorTallies');
const { codeLabelText } = require('../../common/codeLabel');

/**
 * Lecture PURE des faits d'indicateurs d'une fiche (monitoring.repository.reportFormsFacts :
 * décomptes par groupe « bureau|AAAA-MM », comptages, visites) pour les mises en forme du
 * catalogue — aucun recalcul sur les données : on réunit des décomptes (mergeAll) et on en
 * tire les résultats (resultsFromTallies), comme la Synthèse et Couverture & performance.
 */

const col = (key, label, type = 'text') => ({ key, label, type });
const round1 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
/** Pourcentage arrondi à 0,1 ; null sans dénominateur (jamais « 0 % » sans base). */
const pctOf = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
/** Taux (fraction) → pourcentage arrondi à 0,1. */
const ratePct = (r) => (r == null ? null : Math.round(r * 1000) / 10);

/** « bureau|AAAA-MM » → [bureau, mois] (le mois est le dernier segment). */
function splitGroup(g) {
  const i = String(g).lastIndexOf('|');
  return i < 0 ? [String(g), ''] : [g.slice(0, i), g.slice(i + 1)];
}

/** Résultats globaux d'une fiche (forme de computeAll). */
const formResults = (form) => resultsFromTallies(form.facts.inds, form.facts.overall);

/** Nombre de soumissions d'une fiche (tous groupes). */
function formCount(form) {
  let n = 0;
  for (const c of form.facts.counts.values()) n += c.total;
  return n;
}

/**
 * Groupes réunis par une clé dérivée du groupe (bureau ou mois) :
 * Map clé → { tallies, total, groups: [clés d'origine], meta (première ligne de comptage) }.
 */
function regroup(form, keyOf) {
  const out = new Map();
  for (const [g, tallies] of form.facts.groups) {
    const k = keyOf(g);
    if (!out.has(k)) out.set(k, { lists: [], total: 0, groups: [], meta: form.facts.counts.get(g) || null });
    const e = out.get(k);
    e.lists.push(tallies);
    e.groups.push(g);
    e.total += (form.facts.counts.get(g) || {}).total || 0;
  }
  const n = form.facts.inds.length;
  for (const e of out.values()) { e.tallies = mergeAll(e.lists, n); delete e.lists; }
  return out;
}
const byBureau = (form) => regroup(form, (g) => splitGroup(g)[0]);
const byMonth = (form) => regroup(form, (g) => splitGroup(g)[1]);

/** Libellé lisible d'un bureau (jamais un code seul), dans la langue du rapport. */
function bureauLabel(meta, { formLabel = null, lang = 'fr' } = {}) {
  if (!meta) return codeLabelText(null, { lang });
  const v = { status: meta.officeStatus, name: meta.officeName, code: meta.officeCode };
  return codeLabelText(v, { formLabel: v.status === 'non_relie' ? formLabel : null, lang });
}

/** Visites (score par visite) d'un ensemble de groupes d'une fiche. */
function visitsOf(form, groups) {
  const vg = form.facts.visitGroups;
  if (!vg) return mergeVisits([]);
  return mergeVisits((groups || [...vg.keys()]).map((g) => vg.get(g)), 1000);
}

/** Indicateur (et sa fiche) par identifiant dans les faits chargés. */
function findIndicator(forms, id) {
  for (const f of forms || []) {
    const i = f.facts.inds.findIndex((x) => x.id === id);
    if (i >= 0) return { form: f, ind: f.facts.inds[i], index: i };
  }
  return null;
}

module.exports = { col, round1, pctOf, ratePct, splitGroup, formResults, formCount, regroup, byBureau, byMonth, bureauLabel, visitsOf, findIndicator };
