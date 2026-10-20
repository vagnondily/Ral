/**
 * Tableau de bord « Couverture & performance du suivi » (maquette de l'utilisateur, retours
 * 40, 66, 67 et 85) — logique PURE, sans I/O, testée (test/performanceMath.test.js).
 *
 * Met en forme, PAR ACTIVITÉ, les faits d'indicateurs déjà décomptés en flux par
 * indicatorFacts (décomptes additifs groupés par bureau × mois, score de chaque visite) :
 *   - la liste des activités vient de MEMS, jamais d'une liste codée en dur : catégories
 *     d'activité des fiches de suivi et des sites du registre ; le modèle d'indicateurs
 *     (indicatorTemplates.json) ne fait que nommer celles qu'il connaît (« GD / PREVMA ») ;
 *   - visites = soumissions reçues, classées par le score de visite (monitoringMath.visitScore,
 *     règle unique classify : bandes 80 / 65 / 50) — urgentes = score < 50 ;
 *   - indice d'une activité = indice de conformité (monitoringMath.overallIndex) de ses
 *     résultats, le même calcul que les Résultats d'une fiche, la Synthèse et le concepteur ;
 *   - modules (coverageDashboard.dimGroups), points forts / faibles (topFlop), mur des
 *     indicateurs (classe de chacun : classify), raisons « Non évalué » (naReason) ;
 *   - bureaux (indice, visites, score moyen des visites), visites urgentes les plus faibles,
 *     signaux de risque, tendance mensuelle, qualité de saisie par agent.
 * Vue d'ensemble : visites réunies et INDICE PONDÉRÉ = moyenne des indices d'activité pondérée
 * par leurs visites notées.
 *
 * La COUVERTURE (sites visités ÷ sites actifs, distincts sur la période) ne vient pas d'ici :
 * l'écran la lit dans la réponse de la carte (/api/map/districts, service unique des faits
 * site × mois), celle que la carte de la page dessine — jamais deux couvertures différentes.
 */

const { overallIndex, classify, naReason, orientedScore } = require('../monitoring/monitoringMath');
const { classDistribution, naReasonCounts, dimGroups, topFlop, isPercent } = require('../monitoring/coverageDashboard');
const { resultsFromTallies, mergeVisits } = require('../monitoring/indicatorTallies');
const { formResults, formCount, byBureau, splitGroup, pctOf, round1 } = require('../reports/catalog/facts');

const BANDS = Object.freeze(['exc', 'sat', 'imp', 'urg', 'na']);
const NO_DOMAIN = '(sans dimension)';
/** Seuil de remplissage sous lequel la saisie d'un agent est jugée insuffisante (maquette : « < 50 % rempli »). */
const LOW_FILL = 50;
/** Seuil des signaux : un module ou un indicateur sous « Satisfaisant » (65) est signalé. */
const SIGNAL_BELOW = 65;
/** Part de visites non évaluées à partir de laquelle le signal passe « à surveiller » (concepteur : 20 %). */
const NA_WATCH = 20;

/** Classe d'un indice ou d'un score sur 100 : la règle unique (classify, bandes 80 / 65 / 50). */
const indexBand = (v) => (v == null ? 'na' : classify({ value: v, base: 1, agg: 'percent_yes', target: null, direction: 'higher_better' }));

/** Clé d'une activité : sa catégorie sans casse ni espaces de bord ; '' = fiches sans activité. */
const activityKeyOf = (category) => String(category == null ? '' : category).trim().toLowerCase();

/** Visites d'un décompte (indicatorTallies.mergeVisits) : effectifs, classes et taux de la maquette. */
function visitStats(v) {
  const x = v || mergeVisits([]);
  return {
    n: x.n,
    scored: x.scored,
    classes: { ...x.classes },
    // Mêmes définitions que le concepteur (mon.visit_classes) : jamais « 0 % » sans base.
    meanScore: x.scored ? round1(x.sumScore / x.scored) : null,
    urgentPct: pctOf(x.classes.urg, x.scored),
    naPct: pctOf(x.classes.na, x.n),
  };
}

/** Bureau d'une ligne de comptage (identité résolue par officeLabelSql) : champs de CodeLabel. */
function officeOf(meta, key) {
  const m = meta || {};
  const status = key === 'vide' ? 'vide' : (m.officeStatus || null);
  return {
    key,
    status,
    name: m.officeName || null,
    code: m.officeCode || null,
    formId: m.officeFormId || null,
    officeId: String(key).startsWith('id:') ? String(key).slice(3) : null,
  };
}

/** Première ligne de comptage de chaque bureau d'une fiche (clé « bureau|mois » → bureau). */
function bureauMetaOf(form) {
  const out = new Map();
  for (const [g, c] of form.facts.counts) {
    const [bk] = splitGroup(g);
    if (!out.has(bk)) out.set(bk, c);
  }
  return out;
}

/**
 * Liste des activités du tableau de bord — dérivée des données de MEMS :
 *  - catégories des fiches actives (`activityCategory`) et des sites du registre (`registry` :
 *    [{ activity, sites }], périmètre du bureau choisi) ;
 *  - libellé et clé du modèle d'indicateurs quand la catégorie est celle d'un modèle ;
 *  - fiches sans activité réunies sous la clé '' (montrées seulement si elles ont des données).
 * Ordre : activités des modèles (dans l'ordre du catalogue), puis par nombre de sites,
 * puis par visites, puis par nom ; les fiches sans activité en dernier.
 * Nature (`kind`) — l'écran en fait un onglet, ou une ligne du tableau « autres activités » :
 *   'suivie'   au moins une fiche de suivi rattachée ;
 *   'modele'   aucune fiche, mais un modèle d'indicateurs existe pour cette activité ;
 *   'registre' seulement des sites du registre (couverture, aucun suivi possible) ;
 *   'sans'     fiches sans activité (avec des données sur la période).
 * @param {{ forms?: object[], registry?: {activity:string, sites:number}[], templates?: {key,label,mmrCategory}[] }} input
 * @returns {Array<{ key, category, label, templateKey, kind, sites, forms }>}
 */
function buildActivities({ forms = [], registry = [], templates = [] } = {}) {
  const byKey = new Map();
  const get = (category) => {
    const key = activityKeyOf(category);
    if (!byKey.has(key)) byKey.set(key, { key, category: key ? String(category).trim() : null, sites: 0, forms: [] });
    return byKey.get(key);
  };
  for (const r of registry || []) if (activityKeyOf(r.activity)) get(r.activity).sites += Number(r.sites) || 0;
  for (const f of forms || []) get(f.activityCategory).forms.push(f);
  const tIndex = new Map((templates || []).map((t, i) => [activityKeyOf(t.mmrCategory), { t, i }]));
  const visitsOf = (a) => a.forms.reduce((s, f) => s + formCount(f), 0);
  const list = [...byKey.values()]
    .filter((a) => (a.key ? a.sites > 0 || a.forms.length > 0 : visitsOf(a) > 0))
    .map((a) => {
      const hit = a.key ? tIndex.get(a.key) : null;
      const kind = !a.key ? 'sans' : a.forms.length ? 'suivie' : hit ? 'modele' : 'registre';
      return {
        ...a,
        label: hit ? hit.t.label : a.category,
        templateKey: hit ? hit.t.key : null,
        kind,
        order: hit ? hit.i : Number.POSITIVE_INFINITY,
        visits: visitsOf(a),
      };
    });
  list.sort((a, b) => (a.key === '') - (b.key === '') || a.order - b.order || b.sites - a.sites || b.visits - a.visits
    || String(a.category || '').localeCompare(String(b.category || ''), 'fr'));
  return list.map(({ order: _o, visits: _v, ...a }) => a);
}

/** Résultats d'indicateurs de plusieurs fiches (chaque résultat porte sa fiche). */
function activityResults(forms) {
  const out = [];
  for (const f of forms) for (const r of formResults(f)) out.push({ ...r, formId: f.id, formLabel: f.label });
  return out;
}

/** Ajoute la classe (règle unique) aux modules de dimGroups et à leurs indicateurs. */
const withBands = (dims) => dims.map((d) => ({ ...d, band: indexBand(d.score), inds: d.inds.map((i) => ({ ...i, band: indexBand(i.score) })) }));

/**
 * Mur des indicateurs (Salle de contrôle) : TOUS les indicateurs actifs, groupés par module —
 * modules de l'indice d'abord (du plus faible au plus solide), puis les modules complémentaires
 * (hors indice). Classe de chaque indicateur : classify (cible, sinon bandes) ; score d'un
 * module = moyenne des scores orientés de ses indicateurs en % (celui de dimGroups).
 * @param {object[]} results résultats (activityResults)
 * @param {Map<string, number>} countByForm soumissions de chaque fiche sur la période (naReason)
 * @param {boolean} several plusieurs fiches dans l'activité (le nom de la fiche suit l'indicateur)
 */
function moduleWall(results, countByForm, several) {
  const groups = new Map();
  for (const r of results) {
    const complementary = r.scored === false;
    const name = r.module || NO_DOMAIN;
    const k = `${complementary ? 'c' : 's'}|${name}`;
    if (!groups.has(k)) groups.set(k, { name, complementary, indicators: [], scores: [] });
    const g = groups.get(k);
    const sc = orientedScore(r);
    if (sc != null) g.scores.push(sc);
    g.indicators.push({
      id: r.id || null,
      code: r.code || null,
      label: r.label,
      form: several ? r.formLabel : null,
      value: r.value == null ? null : round1(r.value),
      base: r.base || 0,
      agg: r.agg,
      percent: isPercent(r),
      target: r.target == null ? null : Number(r.target),
      direction: r.direction || 'higher_better',
      band: classify(r),
      reason: naReason(r, { periodCount: countByForm.get(r.formId) || 0 }),
    });
  }
  const out = [...groups.values()].map((g) => {
    const score = g.scores.length ? Math.round(g.scores.reduce((a, b) => a + b, 0) / g.scores.length) : null;
    return { name: g.name, complementary: g.complementary, score, band: indexBand(score), n: g.indicators.length, indicators: g.indicators };
  });
  const rank = (s) => (s == null ? Number.POSITIVE_INFINITY : s);
  return out.sort((a, b) => a.complementary - b.complementary || rank(a.score) - rank(b.score) || a.name.localeCompare(b.name, 'fr'));
}

/**
 * Bureaux d'une activité : indice de conformité (overallIndex de leurs résultats réunis),
 * visites, visites notées, score moyen et visites urgentes — clé de bureau de officeLabelSql
 * (un bureau MEMS ou un libellé est commun à toutes les fiches ; un code non relié reste propre
 * à SA fiche). Tri : indice décroissant (non évalué en dernier), puis visites.
 */
function bureauRows(forms) {
  const per = new Map();
  for (const f of forms) {
    const vg = f.facts.visitGroups || new Map();
    for (const [bk, e] of byBureau(f)) {
      if (!per.has(bk)) per.set(bk, { key: bk, meta: e.meta, formLabel: f.label, results: [], visits: 0, vlist: [] });
      const p = per.get(bk);
      p.results.push(...resultsFromTallies(f.facts.inds, e.tallies));
      p.visits += e.total;
      for (const g of e.groups) if (vg.has(g)) p.vlist.push(vg.get(g));
    }
  }
  const rows = [...per.values()].map((p) => {
    const v = mergeVisits(p.vlist, 1);
    const index = overallIndex(p.results);
    const office = officeOf(p.meta, p.key);
    return {
      ...office,
      formLabel: office.status === 'non_relie' ? p.formLabel : null,
      visits: p.visits,
      scored: v.scored,
      urgent: v.classes.urg,
      meanScore: v.scored ? round1(v.sumScore / v.scored) : null,
      index,
      band: indexBand(index),
    };
  });
  const rank = (x) => (x == null ? -1 : x);
  return rows.sort((a, b) => rank(b.index) - rank(a.index) || b.visits - a.visits || String(a.key).localeCompare(String(b.key)));
}

/** Visites urgentes les plus faibles d'une activité (identité gardée par indicatorFacts, `keep` par fiche). */
function urgentVisits(forms, keep = 15) {
  const list = [];
  for (const f of forms) {
    const v = f.facts.visits;
    if (!v || !v.urgent || !v.urgent.length) continue;
    const metas = bureauMetaOf(f);
    for (const u of v.urgent) {
      const [bk] = splitGroup(u.group || '');
      list.push({
        id: u.id || null,
        month: u.month || null,
        site: u.site || null,
        agent: u.agent || null,
        score: u.score,
        answered: u.answered,
        formId: f.id,
        formLabel: f.label,
        bureau: bk ? { ...officeOf(metas.get(bk), bk), formLabel: f.label } : null,
      });
    }
  }
  list.sort((a, b) => a.score - b.score || String(a.id).localeCompare(String(b.id)));
  return list.slice(0, keep);
}

/**
 * Signaux de risque d'une activité (page Contrôle), en codes + valeurs : l'écran en fait des
 * phrases dans la langue de l'utilisateur. Les signaux qui viennent des sites (risque élevé non
 * suivi, sites jamais visités) sont ajoutés par l'écran depuis la réponse de la carte.
 *   urgent_visits  visites notées < 50 (à auditer) ;
 *   na_visits      visites sans score (aucune réponse comptée à un indicateur noté) ;
 *   weak_module    module de l'indice le plus faible, sous « Satisfaisant » (65) ;
 *   weak_indicator ses deux indicateurs les plus faibles sous 65 ;
 *   no_indicator   fiche qui reçoit des données sans aucun indicateur.
 */
function riskSignals({ visits, dims, forms }) {
  const out = [];
  if (visits.classes.urg > 0) out.push({ kind: 'urgent_visits', tone: 'urg', n: visits.classes.urg, pct: visits.urgentPct });
  if (visits.naPct != null && visits.naPct > 0) {
    out.push({ kind: 'na_visits', tone: visits.naPct >= NA_WATCH ? 'imp' : 'sat', n: visits.classes.na, pct: visits.naPct });
  }
  const weak = dims[0];
  if (weak && weak.score < SIGNAL_BELOW) {
    out.push({ kind: 'weak_module', tone: indexBand(weak.score), module: weak.name, score: weak.score });
    for (const i of weak.inds.slice(0, 2)) {
      if (i.score < SIGNAL_BELOW) out.push({ kind: 'weak_indicator', tone: indexBand(i.score), module: weak.name, label: i.label, pct: i.pct, lower: !!i.lower });
    }
  }
  for (const f of forms) {
    const n = formCount(f);
    if (n > 0 && !f.facts.inds.length) out.push({ kind: 'no_indicator', tone: 'imp', formId: f.id, formLabel: f.label, n });
  }
  return out;
}

/**
 * Une activité mise en forme (onglet de la maquette) : visites, indice, indicateurs, modules,
 * points forts / faibles, mur, bureaux, visites urgentes, raisons « Non évalué », signaux.
 * @param {{ key, category, label, templateKey, sites, forms }} a activité de buildActivities
 * @param {{ urgentKeep?: number }} [opts]
 */
function shapeActivity(a, { urgentKeep = 15 } = {}) {
  const forms = a.forms || [];
  const withData = forms.filter((f) => formCount(f) > 0);
  const several = withData.length > 1;
  const results = activityResults(forms);
  const countByForm = new Map(forms.map((f) => [f.id, formCount(f)]));
  const rawVisits = mergeVisits(forms.map((f) => f.facts.visits).filter(Boolean), 1);
  const visits = visitStats(rawVisits);
  const index = overallIndex(results);
  const dims = withBands(dimGroups(results));
  // Modules complémentaires (hors indice) : même calcul, à part — jamais mêlés à l'indice.
  const complementary = withBands(dimGroups(results.filter((r) => r.scored === false).map((r) => ({ ...r, scored: true }))));
  const { top, flop } = topFlop(results, { nTop: 6, nFlop: 6 });
  const naReasons = {};
  for (const f of forms) {
    for (const [k, v] of Object.entries(naReasonCounts(formResults(f), formCount(f)))) naReasons[k] = (naReasons[k] || 0) + v;
  }
  return {
    key: a.key,
    category: a.category,
    label: a.label,
    templateKey: a.templateKey,
    kind: a.kind,
    sites: a.sites,
    forms: forms.map((f) => ({
      id: f.id,
      code: f.code || null,
      label: f.label,
      submissions: countByForm.get(f.id),
      indicators: f.facts.inds.length,
      scoredIndicators: f.facts.inds.filter((i) => i.scored !== false).length,
    })),
    visits,
    index,
    band: indexBand(index),
    indicatorCount: forms.reduce((s, f) => s + f.facts.inds.length, 0),
    indicatorClasses: classDistribution(results),
    dims,
    complementary,
    top: top.map((x) => ({ ...x, band: indexBand(x.score) })),
    flop: flop.map((x) => ({ ...x, band: indexBand(x.score) })),
    // Mur des indicateurs : seulement s'il y a des visites sur la période (sinon, que des « — »).
    wall: rawVisits.n > 0 ? moduleWall(results, countByForm, several) : [],
    bureaux: bureauRows(forms),
    urgent: urgentVisits(forms, urgentKeep),
    naReasons,
    signals: riskSignals({ visits, dims, forms }),
  };
}

/**
 * Indice pondéré de la vue d'ensemble : moyenne des indices d'activité pondérée par leurs
 * visites notées (une activité sans visite notée ne pèse rien) ; null sans aucune.
 */
function weightedIndex(activities) {
  let num = 0;
  let den = 0;
  for (const a of activities || []) {
    if (a.index == null || !(a.visits && a.visits.scored > 0)) continue;
    num += a.index * a.visits.scored;
    den += a.visits.scored;
  }
  return den ? round1(num / den) : null;
}

/**
 * Réponse du tableau de bord : activités mises en forme et vue d'ensemble.
 * @param {{ forms: object[], registry: object[], templates: object[] }} raw
 */
function shapePerformance({ forms = [], registry = [], templates = [] } = {}) {
  const activities = buildActivities({ forms, registry, templates }).map((a) => shapeActivity(a));
  const all = mergeVisits(forms.map((f) => f.facts.visits).filter(Boolean), 1);
  const wIndex = weightedIndex(activities);
  return {
    activities,
    overall: {
      visits: visitStats(all),
      weightedIndex: wIndex,
      band: indexBand(wIndex),
      activitiesWithData: activities.filter((a) => a.visits.n > 0).length,
      forms: forms.length,
      // Fiches sans activité : leurs données comptent, mais elles n'ont ni sites actifs ni modèle.
      unattachedForms: forms.filter((f) => !activityKeyOf(f.activityCategory)).map((f) => ({ id: f.id, label: f.label, submissions: formCount(f) })),
    },
  };
}

/**
 * Tendance mensuelle d'une activité (faits groupés par mois sur la fenêtre des tendances) :
 * indice de conformité, visites, visites notées, score moyen et urgentes de chaque mois ;
 * mois sans donnée compris (indice null), dans l'ordre de `months`.
 */
function trendRows(forms, months) {
  const per = new Map((months || []).map((m) => [m, { results: [], vlist: [], n: 0 }]));
  for (const f of forms || []) {
    const vg = f.facts.visitGroups || new Map();
    for (const [g, tallies] of f.facts.groups) {
      const e = per.get(g);
      if (!e) continue;
      e.results.push(...resultsFromTallies(f.facts.inds, tallies));
      e.n += (f.facts.counts.get(g) || {}).total || 0;
      if (vg.has(g)) e.vlist.push(vg.get(g));
    }
  }
  return (months || []).map((m) => {
    const e = per.get(m);
    const v = mergeVisits(e.vlist, 1);
    const index = overallIndex(e.results);
    return {
      month: m,
      visits: e.n,
      scored: v.scored,
      urgent: v.classes.urg,
      meanScore: v.scored ? round1(v.sumScore / v.scored) : null,
      index,
      band: indexBand(index),
    };
  });
}

/**
 * Évolution de l'indice : dernier mois noté de la tendance face au mois noté qui le précède.
 * @returns {{ month, value, previousMonth, previous, delta, direction: 'up'|'down'|'flat'|null }}
 */
function trendDelta(rows) {
  const scored = (rows || []).filter((r) => r.index != null);
  if (!scored.length) return { month: null, value: null, previousMonth: null, previous: null, delta: null, direction: null };
  const last = scored[scored.length - 1];
  const prev = scored.length > 1 ? scored[scored.length - 2] : null;
  const delta = prev ? round1(last.index - prev.index) : null;
  const direction = delta == null ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return { month: last.month, value: last.index, previousMonth: prev ? prev.month : null, previous: prev ? prev.index : null, delta, direction };
}

/**
 * Identité d'un agent d'un groupe de faits (« jamais un code sans son nom », retour 19) :
 *   id:<uuid>          agent MEMS relié → son nom (relie) ;
 *   raw:<valeur>       valeur saisie : libellé de la liste de la fiche (« 76 » → « Haja ») →
 *                      clé lib:<libellé> (libelle) ; sinon un code numérique reste propre à SA
 *                      fiche, code:<fiche>:<code> (non_relie) ; sinon un nom saisi, réuni sans la
 *                      casse d'une fiche à l'autre, raw:<nom> (saisi) ;
 *   vide               non renseigné.
 */
function agentIdentity(k, formId, labels) {
  if (k === 'vide') return { key: 'vide', status: 'vide' };
  if (k.startsWith('id:')) return { key: k, status: 'relie' };
  const v = k.slice(4).trim();
  const label = labels && labels.get(formId) ? labels.get(formId).get(v) : null;
  const lab = label == null ? '' : String(label).trim();
  if (lab && lab !== v) return { key: `lib:${lab.toLowerCase().replace(/\s+/g, ' ')}`, status: 'libelle', name: lab };
  if (/^\d+$/.test(v)) return { key: `code:${formId}:${v}`, status: 'non_relie', code: v, formId };
  return { key: `raw:${v.toLowerCase()}`, status: 'saisi', name: v };
}

/**
 * Qualité de saisie par agent (page Agent) — même décompte que le concepteur
 * (mon.agent_quality, parité testée) : réponses exploitables (taux de remplissage) =
 * réponses comptées ÷ réponses attendues sur les indicateurs notés ; vides ou hors base ;
 * plus la part de visites sans score et l'indice de conformité de l'agent. Identité : agentIdentity.
 * @param {object[]} forms faits groupés par agent (indicatorFacts, group 'agent', visites)
 * @param {Map<string,string>} [agentNames] « id:<uuid> » → nom de l'agent MEMS
 * @param {Map<string, Map<string,string>>} [labels] fiche → (valeur saisie → libellé de sa liste)
 */
function agentRows(forms, agentNames = new Map(), labels = new Map()) {
  const per = new Map();
  for (const f of forms || []) {
    const scoredIdx = f.facts.inds.map((ind, i) => [ind, i]).filter(([ind]) => ind.scored !== false);
    const vg = f.facts.visitGroups || new Map();
    for (const [k, tallies] of f.facts.groups) {
      const who = agentIdentity(k, f.id, labels);
      const key = who.key;
      if (!per.has(key)) per.set(key, { who, n: 0, total: 0, answered: 0, blank: 0, results: [], vlist: [] });
      const e = per.get(key);
      e.n += (f.facts.counts.get(k) || {}).total || 0;
      for (const [, i] of scoredIdx) {
        const t = tallies[i];
        let naN = 0;
        for (const c of t.naExcluded.values()) naN += c;
        e.total += t.total - t.absent;
        e.answered += t.answered;
        e.blank += t.blank + naN;
      }
      e.results.push(...resultsFromTallies(f.facts.inds, tallies));
      if (vg.has(k)) e.vlist.push(vg.get(k));
    }
  }
  const rows = [...per].map(([key, e]) => {
    const v = mergeVisits(e.vlist, 1);
    const { status } = e.who;
    const name = status === 'relie' ? (agentNames.get(key) || null) : (e.who.name || null);
    const index = overallIndex(e.results);
    return {
      key,
      status,
      name,
      code: e.who.code || null,
      formId: e.who.formId || null,
      visits: e.n,
      fill: pctOf(e.answered, e.total),
      blankPct: pctOf(e.blank, e.total),
      naPct: pctOf(v.classes.na, v.n),
      scored: v.scored,
      meanScore: v.scored ? round1(v.sumScore / v.scored) : null,
      index,
      band: indexBand(index),
    };
  }).sort((a, b) => b.visits - a.visits || String(a.key).localeCompare(String(b.key)));
  const named = rows.filter((r) => r.status !== 'vide');
  const fills = named.map((r) => r.fill).filter((x) => x != null);
  const visits = rows.reduce((s, r) => s + r.visits, 0);
  const scored = rows.reduce((s, r) => s + r.scored, 0);
  return {
    agents: rows,
    totals: {
      agents: named.length,
      avgFill: fills.length ? round1(fills.reduce((a, b) => a + b, 0) / fills.length) : null,
      lowFill: named.filter((r) => r.fill != null && r.fill < LOW_FILL).length,
      visits,
      completeness: pctOf(scored, visits),
    },
  };
}

module.exports = {
  BANDS, NO_DOMAIN, LOW_FILL, SIGNAL_BELOW, NA_WATCH,
  indexBand, activityKeyOf, visitStats, buildActivities, shapeActivity, shapePerformance, weightedIndex,
  moduleWall, bureauRows, urgentVisits, riskSignals, trendRows, trendDelta, agentRows,
};
