'use strict';
// Socle commun : lignes de tableau cliquables (détail), légendes sur les seuils uniques, filtres conservés et portée par onglet.
module.exports = [
  { label: 'table() : ligne cliquable → détail (opt.onRow)',
    find: "rr.forEach(r => { const tr = el('tr'); cols.forEach",
    replace: "rr.forEach(r => { const tr = el('tr'); if (opt.onRow) { tr.classList.add('clk'); tr.tabIndex = 0; tr.addEventListener('click', ev => { if (ev.target.closest('button,a,input,select,summary')) return; opt.onRow(r); }); tr.addEventListener('keydown', ev => { if (ev.key === 'Enter') opt.onRow(r); }); } cols.forEach" },
  { label: 'textes de niveau sur les seuils uniques',
    find: "  const CLS_TXT = { good: 'Bon (≥ 80)', mid: 'À améliorer (65–80)', bad: 'Faible (< 65)', na: 'Non calculé' };\n  const RCLS_TXT = { good: 'Faible (≤ 15 %)', mid: 'Modéré (15–35 %)', bad: 'Élevé (> 35 %)', na: 'Non calculé' };",
    replace: "  const CLS_TXT = { good: 'Bon (≥ ' + THR.good + ')', mid: 'À améliorer (' + THR.mid + '–' + THR.good + ')', bad: 'Faible (< ' + THR.mid + ')', na: 'Non calculé' };\n  const RCLS_TXT = { good: 'Peu d’alertes (≤ ' + THR.rLow + ' % des visites)', mid: 'Alertes fréquentes (' + THR.rLow + '–' + THR.rHigh + ' %)', bad: 'Alertes très fréquentes (> ' + THR.rHigh + ' %)', na: 'Non calculé' };" },
  { label: 'légende score sur les seuils uniques',
    find: "  function scoreLegend() { return legend([['#1f8a4c', 'Bon ≥ 80'], ['#d08a00', 'À améliorer 65–80'], ['#c23b2a', 'Faible < 65']]); }",
    replace: "  function scoreLegend() { return legend([['#1f8a4c', 'Bon ≥ ' + THR.good], ['#d08a00', 'À améliorer ' + THR.mid + '–' + THR.good], ['#c23b2a', 'Faible < ' + THR.mid]]); }" },
  { label: 'légende alertes sur les seuils uniques',
    find: "  function riskLegend() { return legend([['#1f8a4c', 'Alerte ≤ 15 %'], ['#d08a00', '15–35 %'], ['#c23b2a', '> 35 %']]); }",
    replace: "  function riskLegend() { return legend([['#1f8a4c', 'Visites avec alerte ≤ ' + THR.rLow + ' %'], ['#d08a00', THR.rLow + '–' + THR.rHigh + ' %'], ['#c23b2a', '> ' + THR.rHigh + ' %']]); }" },
  { label: 'filtres : district + conservés après mise à jour',
    find: "  const F = { act: 'ALL', fo: -1, region: -1, org: -1, imp: -1, m0: MONTHS[0], m1: MONTHS[MONTHS.length - 1] };",
    replace: "  const F = { act: 'ALL', fo: -1, region: -1, district: -1, org: -1, imp: -1, m0: MONTHS[0], m1: MONTHS[MONTHS.length - 1] };\n  restoreFilters();" },
  { label: 'inFilter + filtre de l’onglet Activités : district',
    find: "(F.region < 0 || v.region === F.region) && (F.org < 0 || v.org === F.org)",
    replace: "(F.region < 0 || v.region === F.region) && (F.district < 0 || v.district === F.district) && (F.org < 0 || v.org === F.org)", count: 2 },
  { label: 'barre de filtres : Activité + Période visibles, secondaires repliés derrière « Filtres », grisage généralisé, résumé',
    start: "    box.appendChild(mk('Activité', [['ALL', 'Toutes les activités']]",
    end: "    box.appendChild(rs);",
    replace: "    const applies = key => filterApplies(key === 'm0' || key === 'm1' ? 'period' : key) || (FILTER_SCOPE[TAB] === 'all');\n" +
      "    const grey = (lb, key) => { if (!applies(key)) { lb.classList.add('f-off'); const s = lb.querySelector('select'); if (s) s.disabled = true; bindTip(lb, () => 'Ce filtre ne s’applique pas à cet onglet. ' + (FILTER_WHY[TAB] || '')); } return lb; };\n" +
      "    box.appendChild(grey(mk('Activité', [['ALL', 'Toutes les activités']].concat(D.acts.map(a => [a.code, a.label])), F.act, v => { F.act = v; if (v !== 'ALL') ACT_SEL = v; }), 'act'));\n" +
      "    box.appendChild(grey(mk('Du mois', MONTHS.map(m => [m, monthLabel(m)]), F.m0, v => { F.m0 = v; if (F.m1 < v) F.m1 = v; buildFilters(); }), 'm0'));\n" +
      "    box.appendChild(grey(mk('Au mois', MONTHS.map(m => [m, monthLabel(m)]), F.m1, v => { F.m1 = v; if (F.m0 > v) F.m0 = v; buildFilters(); }), 'm1'));\n" +
      "    const SEC = ['fo', 'region', 'district', 'org', 'imp'], anySec = SEC.some(applies), nSec = SEC.filter(k => F[k] >= 0).length, fOpen = !!SESSION.filtersOpen && anySec;\n" +
      "    const ft = el('button', { class: 'btn f-toggle' + (fOpen ? ' on' : ''), type: 'button', 'aria-expanded': String(fOpen), 'aria-controls': 'f-panel' });\n" +
      "    ft.appendChild(el('span', { text: 'Filtres' })); ft.appendChild(el('span', { class: 'f-caret', 'aria-hidden': 'true', text: fOpen ? '▲' : '▾' }));\n" +
      "    if (nSec) ft.appendChild(el('span', { class: 'f-badge', text: String(nSec), 'aria-label': nSec + ' filtre(s) actif(s)' }));\n" +
      "    if (!anySec) { ft.disabled = true; ft.classList.add('f-off'); bindTip(ft, () => 'Aucun de ces filtres ne s’applique à cet onglet. ' + (FILTER_WHY[TAB] || '')); }\n" +
      "    else bindTip(ft, () => (fOpen ? 'Masquer' : 'Afficher') + ' les filtres par bureau, région, district, TPM et partenaire' + (nSec ? ' · ' + nSec + ' actif' + (nSec > 1 ? 's' : '') : ''));\n" +
      "    ft.addEventListener('click', () => { SESSION.filtersOpen = !SESSION.filtersOpen; buildFilters(); }); box.appendChild(ft);\n" +
      "    const rs = el('button', { class: 'btn', type: 'button', text: 'Réinitialiser' });\n" +
      "    rs.addEventListener('click', () => { F.act = 'ALL'; F.fo = -1; F.region = -1; F.district = -1; F.org = -1; F.imp = -1; F.m0 = MONTHS[0]; F.m1 = MONTHS[MONTHS.length - 1]; buildFilters(); render(); });\n" +
      "    box.appendChild(rs);\n" +
      "    const panel = el('div', { class: 'f-panel' + (fOpen ? '' : ' f-hidden'), id: 'f-panel', role: 'group', 'aria-label': 'Filtres par bureau, zone et partenaire' });\n" +
      "    panel.appendChild(grey(mk('Bureau de terrain', [[-1, 'Tous']].concat(usedIdx('fo').map(i => [i, DICT.fo[i]])), F.fo, v => { F.fo = +v; }), 'fo'));\n" +
      "    panel.appendChild(grey(mk('Région', [[-1, 'Toutes']].concat(usedIdx('region').map(i => [i, DICT.region[i]])), F.region, v => { F.region = +v; F.district = -1; buildFilters(); }), 'region'));\n" +
      "    const dIdx = Array.from(new Set(V.filter(v => F.region < 0 || v.region === F.region).map(v => v.district))).filter(i => DICT.district[i]).sort((a, b) => DICT.district[a].localeCompare(DICT.district[b]));\n" +
      "    panel.appendChild(grey(mk('District', [[-1, 'Tous']].concat(dIdx.map(i => [i, DICT.district[i]])), F.district, v => { F.district = +v; }), 'district'));\n" +
      "    panel.appendChild(grey(mk('Partenaire de suivi (TPM)', [[-1, 'Tous']].concat(usedIdx('org').map(i => [i, DICT.org[i]])), F.org, v => { F.org = +v; }), 'org'));\n" +
      "    panel.appendChild(grey(mk('Partenaire de mise en œuvre', [[-1, 'Tous']].concat(usedIdx('imp').map(i => [i, DICT.imp[i]])), F.imp, v => { F.imp = +v; }), 'imp'));\n" +
      "    box.appendChild(panel);\n" +
      "    if (filtersAny()) box.appendChild(el('div', { class: 'f-sum', text: 'Filtres : ' + filtersActiveText() }));" },
  { label: 'render : filtres conservés + barre recalculée selon l’onglet',
    find: "  function render() {\n    hideTip();",
    replace: "  let RENDER_N = 0;\n  function render() {\n    RENDER_N++; hideTip(); closeDrawer(); saveFilters(); buildFilters();" },
  { label: 'moteur : point d’export unique (chaque lot y ajoute ses fonctions sans se marcher dessus)',
    find: "    return { importActivity, importPlan, refreshPlanTables, detectAct, parseCSV, clusterNames, seqRatio, canonRegion };\n  })();",
    replace: "    const API = { importActivity, importPlan, refreshPlanTables, detectAct, parseCSV, clusterNames, seqRatio, canonRegion };\n    /*ENGINE-EXPORTS*/\n    return API;\n  })();" },
  { label: 'légende globale retirée sous la barre de filtres (chaque tuile porte sa référence)',
    find: "    const lg = el('div', { class: 'glegend' }, [el('span', { class: 'gl-t', text: 'Score :' }), scoreLegend(), el('span', { class: 'gl-t', text: 'Alertes :' }), riskLegend()]);\n    box.appendChild(lg);",
    replace: "" },
  { label: 'cartes : une aide longue passe en infobulle « i » (écran allégé)',
    find: "    return el('div', { class: 'card' + (wide ? ' wide' : '') + (extraCls ? ' ' + extraCls : '') }, [el('div', { class: 'ch' }, [el('h2', { text: title }), d ? infoBtn(d) : null]), hint ? el('p', { class: 'hint', text: hint }) : null].concat(body));",
    replace: "    const longH = !!hint && String(hint).length > 90, tipTxt = [d, longH ? hint : null].filter(Boolean).join('\\n\\n');\n    return el('div', { class: 'card' + (wide ? ' wide' : '') + (extraCls ? ' ' + extraCls : '') }, [el('div', { class: 'ch' }, [el('h2', { text: title }), tipTxt ? infoBtn(tipTxt) : null]), hint && !longH ? el('p', { class: 'hint', text: hint }) : null].concat(body));" },
  { label: 'en-tête : sous-titre court, le détail au survol',
    start: "  document.getElementById('subtitle').textContent = `PAM Madagascar · Recherche, Évaluation et Suivi · Données du ${D.period[0]} au ${D.period[1]}",
    end: "\n",
    replace: "  { const stEl = document.getElementById('subtitle'); stEl.textContent = 'PAM Madagascar · données du ' + dateFrLong(D.period[0]) + ' au ' + dateFrLong(D.period[1]);\n    bindTip(stEl, () => 'Recherche, évaluation et suivi\\n' + fmt(D.visits.length) + ' visites (' + fmt(sum(D.dq.map(x => x.subs))) + ' fiches)\\nRecalculé le ' + dateFrLong(D.generated) + (lastUpdateLine() ? '\\n' + lastUpdateLine() : '')); }\n" },
  // Fusion « Qualité & acteurs » : Agents + Partenaires deviennent des sous-vues de l'onglet Qualité (voir lot agents).
  // On garde « Planification RBM » tel quel : le lot planning le renomme ensuite par son propre correctif.
  { label: 'onglets : Agents + Partenaires fondus dans « Qualité & acteurs »',
    find: "  const TABS = [['overview', 'Vue d’ensemble'], ['map', 'Carte'], ['activity', 'Activités'], ['agents', 'Agents'], ['partners', 'Partenaires'], ['quality', 'Qualité des données'], ['sites', 'Sites'], ['rbm', 'Planification RBM'], ['report', 'Rapport (imprimable)'], ['data', 'Données & mises à jour'], ['method', 'Méthodologie']];",
    replace: "  const TABS = [['overview', 'Vue d’ensemble'], ['map', 'Carte'], ['activity', 'Activités'], ['quality', 'Qualité & acteurs'], ['sites', 'Sites'], ['rbm', 'Planification RBM'], ['report', 'Rapport (imprimable)'], ['data', 'Données & mises à jour'], ['method', 'Méthodologie']];" },
  // Barre d'onglets groupée par familles (table TAB_FAMILIES dans core-module). Les boutons restent des enfants directs
  // de #tabs (role=tab) ; chaque premier onglet d'une famille porte un intitulé discret. Clé inconnue → « Autres ».
  { label: 'buildTabs : onglets groupés en familles (sans débordement)',
    find: "    const t = clear(document.getElementById('tabs'));\n    TABS.forEach(([k, l]) => { const b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(TAB === k), text: l }); b.addEventListener('click', () => { TAB = k; buildTabs(); render(); }); t.appendChild(b); });",
    replace: "    const t = clear(document.getElementById('tabs'));\n" +
      "    const famOf = k => { const f = TAB_FAMILIES.find(x => x[1].indexOf(k) >= 0); return f ? f[0] : 'Autres'; };\n" +
      "    const famOrder = TAB_FAMILIES.map(x => x[0]).concat(['Autres']);\n" +
      "    const famBuckets = {}; famOrder.forEach(n => { famBuckets[n] = []; });\n" +
      "    TABS.forEach(pair => { famBuckets[famOf(pair[0])].push(pair); });\n" +
      "    famOrder.forEach(n => { famBuckets[n].forEach((pair, idx) => {\n" +
      "      const b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(TAB === pair[0]) });\n" +
      "      if (idx === 0) { b.setAttribute('data-fam-first', '1'); b.appendChild(el('span', { class: 'tab-fam', 'aria-hidden': 'true', text: n })); }\n" +
      "      b.appendChild(el('span', { class: 'tab-lbl', text: pair[1] }));\n" +
      "      b.addEventListener('click', () => { TAB = pair[0]; buildTabs(); render(); });\n" +
      "      t.appendChild(b);\n" +
      "    }); });" },
];
