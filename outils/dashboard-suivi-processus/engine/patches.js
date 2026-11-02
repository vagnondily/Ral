'use strict';
// Correctifs du moteur et des textes figés. Chaque patch doit correspondre EXACTEMENT une fois
// (ou `count` fois), sinon la construction échoue — jamais de remplacement silencieux.
const fs = require('fs');
const NEW_FINDINGS = fs.readFileSync(__dirname + '/engine-findings.js', 'utf8');

module.exports = [
  // ---------- fenêtre de validité : plus jamais une date figée (bug : 2026-10-31 < aujourd'hui)
  { label: 'WIN1 dynamique + constantes sys_empty',
    find: "    const WIN0 = '2025-09-01', WIN1 = '2026-10-31';",
    replace: "    const WIN0 = '2025-09-01', WIN1 = localDay(); // fin de validité = jour du recalcul (heure locale)\n" +
             "    const SYS_EMPTY_BEFORE = { PECMAM: '2026-04-01', SMP: '2025-12-01' }; // fiches « en-tête seul » d'une ancienne version du formulaire" },
  { label: 'sys_empty sur la constante unique',
    find: "s.sys_empty = s.empty && ((act === 'PECMAM' && s.day && s.day < '2026-04-01') || (act === 'SMP' && s.day && s.day < '2025-12-01'));",
    replace: "s.sys_empty = s.empty && !!SYS_EMPTY_BEFORE[act] && !!s.day && s.day < SYS_EMPTY_BEFORE[act];" },

  // ---------- année du plan dérivée du plan (plus de « 2026 » en dur), fenêtre exposée
  { label: 'année du plan + fenêtre de couverture',
    find: "      const vis = new Set(VV.filter(v => v.valid && v.date >= '2026-01-01').map(v => v.act + '|' + v.code));",
    replace: "      const PY = String(modeOf(PF.rows.map(x => x[pc('annee')]).filter(x => x !== null && x !== undefined && x !== '')) || localDay().slice(0, 4));\n" +
             "      P.planYear = PY; P.window = { from: WIN0, to: WIN1 };\n" +
             "      const vis = new Set(VV.filter(v => v.valid && v.date >= PY + '-01-01' && v.date <= PY + '-12-31').map(v => v.act + '|' + v.code));" },
  { label: 'normalisation des bureaux unique (FO_STD)',
    find: "dF(({ Tulear: 'Toliara', 'Fort Dauphin': 'Tolagnaro' })[x[pc('fo')]] || x[pc('fo')])",
    replace: "dF(FO_STD[x[pc('fo')]] || x[pc('fo')])" },
  { label: 'visites du moteur : région + index (constats par région / par norme)',
    find: "      const VV = P.visits.map((rw, i) => ({ act: ACTS[rw[0]], date: rw[1], imp: P.dict.imp[rw[6]], site_name: rw[8], valid: rw[11] === 1,",
    replace: "      const VV = P.visits.map((rw, i) => ({ i, region: P.dict.region[rw[2]], act: ACTS[rw[0]], date: rw[1], imp: P.dict.imp[rw[6]], site_name: rw[8], valid: rw[11] === 1," },

  // ---------- constats, qualité des données et méthodologie entièrement recalculés
  { label: 'findings() + dqFindings sans constat figé + methodTexts()',
    start: '    function findings(P, ALL, VV, AG, ORG, IMP) {',
    end: '      ].concat(keepStatic);\n    }',
    replace: NEW_FINDINGS },

  // ---------- tout est recalculé au chargement (tables, constats, méthodo) avec le code courant
  { label: 'recalcul complet au chargement',
    find: '  boot(CUR);\n})();',
    replace: "  try { const t0 = Date.now(); CUR = ENGINE.refreshPlanTables(CUR); SESSION.loadRecalcMs = Date.now() - t0; }\n" +
             "  catch (e) { SESSION.loadRecalcErr = String((e && e.message) || e); if (window.console) console.warn('Recalcul au chargement impossible :', e); }\n" +
             "  // Accroche de test (seulement avec #debug dans l'adresse) : permet de simuler une mise à jour des données.\n" +
             "  if (/debug/.test(location.hash)) window.__dash = { get CUR() { return CUR; }, ENGINE, SESSION, reboot, exportHtml };\n" +
             "  boot(CUR);\n})();" },

  // ---------- export : applique d'abord les activations en attente (fichier cohérent)
  { label: 'export applique les activations en attente',
    find: '  function exportHtml() {\n    const json = JSON.stringify(CUR)',
    replace: '  function exportHtml() {\n    let applied = false;\n' +
             '    if (SESSION.planPending) { try { CUR = ENGINE.refreshPlanTables(CUR); SESSION.planPending = 0; applied = true; } catch (e) { /* export tel quel */ } }\n' +
             '    const json = JSON.stringify(CUR)' },
  { label: 'export : réafficher après application',
    find: "    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), 'Dashboard_Suivi_Processus_PAM_MDG_' + localDay() + '.html');\n    SESSION.dirty = false;\n  }",
    replace: "    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), 'Dashboard_Suivi_Processus_PAM_MDG_' + localDay() + '.html');\n    SESSION.dirty = false;\n    if (applied) reboot(CUR, 'data');\n  }" },
  { label: 'import du plan : activations intégrées',
    find: "              SESSION.dirty = true; reboot(P2, 'data');",
    replace: "              SESSION.dirty = true; SESSION.planPending = 0; reboot(P2, 'data');" },
  { label: 'import activité : activations intégrées',
    find: "              SESSION.dirty = true; reboot(res.P, 'data');",
    replace: "              SESSION.dirty = true; SESSION.planPending = 0; reboot(res.P, 'data');" },

  // ---------- textes de l'interface avec chiffres ou années figés
  { label: 'carte couverture : année + note Résilience calculées',
    find: "card('Couverture du plan de suivi 2026', 'Sites du plan visités au moins une fois en 2026 (toute la période). Résilience : le plan ne liste que 2 sites alors que 112 ont été suivis.',",
    replace: "card('Couverture du plan de suivi ' + planYearUI(), 'Sites actifs du plan visités au moins une fois en ' + planYearUI() + ' (toute la période).' + resCoverageNote(),", },
  { label: 'couverture : masquer seulement les activités non calculables',
    find: 'bars(perAct.filter(x => x.cp.planned > 2).map(',
    replace: 'bars(perAct.filter(x => coverageComputable(x.a, x.cp)).map(' },
  { label: 'définition « exploitable » : période de validité réelle',
    find: "(SvyDate) entre sept. 2025 et oct. 2026'",
    replace: "(SvyDate) dans la période de validité (' + winLabel() + ')'" },
  { label: 'note « Autres » : comptes réels',
    find: "Le nom réel de ces 8 organisations et 6 partenaires n’a donc pas été collecté – à corriger dans le formulaire.' }));",
    replace: "Le nom réel n’a donc pas été collecté (' + autresNote() + ') – à corriger dans le formulaire.' }));" },
  { label: 'note composante risques : seulement si les données le confirment',
    start: "      el('p', { class: 'note warn', text: `GD/PREVMA : la composante « risques » de l’indice du formulaire vaut toujours 25/25",
    end: "L’indice du formulaire ne pénalise donc jamais les risques.` })]));",
    replace: "      el('p', { class: 'note warn', text: formRiskNote() })]));" },

  // ---------- barèmes de note : une seule table, la bonne échelle par type
  { label: 'badge(note, type) avec le barème du type',
    find: "  const badge = g => { const b = el('span', { class: 'badge g' + (g === 'N/N' ? 'NN' : g), text: g === 'N/N' ? 'n.n.' : g }); bindTip(b, () => ({ A: 'Note A : très bon (≥ 85)', B: 'Note B : bon (75–85)', C: 'Note C : à accompagner (65–75)', D: 'Note D : insuffisant (< 65)', 'N/N': 'Non noté : moins de 5 fiches/visites' })[g] || g); return b; };",
    replace: "  const badge = (g, kind) => { const b = el('span', { class: 'badge g' + (g === 'N/N' ? 'NN' : g), text: g === 'N/N' ? 'n.n.' : g }); bindTip(b, () => gradeTip(g, kind || 'agent')); return b; };" },
  { label: 'notes des partenaires de mise en œuvre : barème MEO', find: 'badge(r[7])', replace: "badge(r[7], 'imp')", count: 4 },
  { label: 'notes des organisations (onglet Partenaires) : barème TPM',
    find: "t: 'Note', fmt: r => badge(r[ix.grade])", replace: "t: 'Note', fmt: r => badge(r[ix.grade], 'org')" },
  { label: 'notes des organisations (rapport) : barème TPM', find: 'badge(r[ox.grade])', replace: "badge(r[ox.grade], 'org')" },
  // ---------- barèmes et seuils : UNE seule définition (moteur + badges + légendes + textes)
  { label: 'table unique des seuils et barèmes',
    find: '  const ENGINE = (function () {',
    replace: "  // Barèmes et seuils : définis une seule fois, lus par le moteur, les badges, les légendes et les textes.\n" +
             "  const THR = { good: 80, mid: 65, rLow: 15, rHigh: 35 };\n" +
             "  const GRADE_SCALES = {\n" +
             "    agent: { A: 85, B: 75, C: 65, minN: 5, unit: 'fiches', label: 'agent' },\n" +
             "    org: { A: 85, B: 75, C: 65, minN: 20, unit: 'fiches', label: 'organisation de suivi (TPM)' },\n" +
             "    imp: { A: 80, B: 72, C: 65, minN: 5, unit: 'visites', label: 'partenaire de mise en œuvre' }\n" +
             "  };\n" +
             "  const gradeOf = (kind, score, n) => { const s = GRADE_SCALES[kind]; return n < s.minN ? 'N/N' : score >= s.A ? 'A' : score >= s.B ? 'B' : score >= s.C ? 'C' : 'D'; };\n" +
             "  const ENGINE = (function () {" },
  { label: 'note agent sur le barème unique',
    find: "a.grade = a.n < 5 ? 'N/N' : a.global >= 85 ? 'A' : a.global >= 75 ? 'B' : a.global >= 65 ? 'C' : 'D';",
    replace: "a.grade = gradeOf('agent', a.global, a.n);" },
  { label: 'note organisation sur le barème unique',
    find: "o.grade = o.n < 20 ? 'N/N' : o.global >= 85 ? 'A' : o.global >= 75 ? 'B' : o.global >= 65 ? 'C' : 'D';",
    replace: "o.grade = gradeOf('org', o.global, o.n);" },
  { label: 'note partenaire MEO sur le barème unique',
    find: "o.grade = o.visits < 5 ? 'N/N' : o.global >= 80 ? 'A' : o.global >= 72 ? 'B' : o.global >= 65 ? 'C' : 'D';",
    replace: "o.grade = gradeOf('imp', o.global, o.visits);" },
  { label: 'classes de score sur les seuils uniques',
    find: "  const cls = s => s === null || s === undefined ? 'na' : s >= 80 ? 'good' : s >= 65 ? 'mid' : 'bad';\n  const riskCls = p => p === null ? 'na' : p <= 15 ? 'good' : p <= 35 ? 'mid' : 'bad';",
    replace: "  const cls = s => s === null || s === undefined ? 'na' : s >= THR.good ? 'good' : s >= THR.mid ? 'mid' : 'bad';\n  const riskCls = p => p === null || p === undefined ? 'na' : p <= THR.rLow ? 'good' : p <= THR.rHigh ? 'mid' : 'bad';" },
];
