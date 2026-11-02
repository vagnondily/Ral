'use strict';
// LOT AGENTS : notation unique (agents, organisations de suivi, partenaires de mise en œuvre), qualité des données,
// onglets Agents / Partenaires / Qualité recalculés sur les fiches filtrées.
const fs = require('fs');
const ENGINE_CODE = fs.readFileSync(__dirname + '/engine.js', 'utf8');

module.exports = [
  // ---------------------------------------------------------------- moteur : fiches (comptes NSP bruts conservés)
  { label: 'computeSubs : comptes bruts « Ne sait pas »',
    find: '        s.nsp = tot > 0 ? nsp / tot : NaN;\n',
    replace: '        s.nsp = tot > 0 ? nsp / tot : NaN;\n        s.nsp_n = tot > 0 ? nsp : NaN; s.nsp_tot = tot > 0 ? tot : NaN;\n' },
  // ---------------------------------------------------------------- moteur : notation unique (fonctions pures)
  { label: 'moteur : scoreAgents / scoreImps / dqStats / readStoredSubs',
    find: '    function recomputeTables(P, ALL) {\n',
    replace: ENGINE_CODE + '    function recomputeTables(P, ALL) {\n' },
  // ---------------------------------------------------------------- importActivity : relecture et écriture des fiches stockées
  { label: 'importActivity : relecture unique des fiches stockées',
    start: '      const stored = P.subs.rows.map(rw => ({',
    end: "rw[si('score')] }));\n",
    replace: '      const stored = readStoredSubs(P);\n' },
  { label: 'importActivity : fiches stockées avec comptes NSP (colonnes ajoutées à la fin)',
    find: "      const newSubRows = subs.map(s => [act, s.enu_raw, s.enu_other ? 1 : 0, s.org === undefined ? null : s.org, s.fo, s.valid ? 1 : 0, s.empty ? 1 : 0, s.sys_empty ? 1 : 0, s.date_bad ? 1 : 0, s.day, s.site, s.site_k, s.vkey, s.gps_ok ? 1 : 0, r(s.dist, 3), r(s.nsp, 5), r(s.dur, 2), s.dup ? 1 : 0, s.n_items, r(s.score, 4)]);\n",
    replace: "      agxEnsureSubCols(P);\n" +
      "      const agxIN = P.subs.cols.indexOf('nsp_n'), agxIT = P.subs.cols.indexOf('nsp_tot'), agxL = P.subs.cols.length;\n" +
      "      const newSubRows = subs.map(s => { const rw = [act, s.enu_raw, s.enu_other ? 1 : 0, s.org === undefined ? null : s.org, s.fo, s.valid ? 1 : 0, s.empty ? 1 : 0, s.sys_empty ? 1 : 0, s.date_bad ? 1 : 0, s.day, s.site, s.site_k, s.vkey, s.gps_ok ? 1 : 0, r(s.dist, 3), r(s.nsp, 5), r(s.dur, 2), s.dup ? 1 : 0, s.n_items, r(s.score, 4)];\n" +
      "        while (rw.length < agxL) rw.push(null); rw[agxIN] = isNum(s.nsp_n) ? s.nsp_n : null; rw[agxIT] = isNum(s.nsp_tot) ? s.nsp_tot : null; return rw; });\n" },
  // ---------------------------------------------------------------- recomputeTables : agents + organisations
  { label: 'recomputeTables : agents et organisations par scoreAgents',
    start: '      const SA = ALL.filter(s => !s.sys_empty);\n',
    end: "      P.orgs.rows = ORG.map(o => P.orgs.cols.map(k => k === 'org' ? AU(o.org) : r1(o[k])));\n",
    replace:
      "      const by = (arr, f) => { const m = new Map(); arr.forEach(x => { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };\n" +
      "      const pctOf = (arr, f) => arr.length ? arr.filter(f).length / arr.length * 100 : NaN;\n" +
      "      // comptes NSP bruts des fiches stockées (même ordre que P.subs.rows)\n" +
      "      if (P.subs && P.subs.rows.length === ALL.length) { const iN = P.subs.cols.indexOf('nsp_n'), iT = P.subs.cols.indexOf('nsp_tot'), iK = P.subs.cols.indexOf('vkey');\n" +
      "        if (iN >= 0) ALL.forEach((s, i) => { const rw = P.subs.rows[i]; if (s.nsp_n === undefined && rw[iK] === s.vkey) { s.nsp_n = rw[iN] === null || rw[iN] === undefined ? NaN : rw[iN]; s.nsp_tot = rw[iT] === null || rw[iT] === undefined ? NaN : rw[iT]; } }); }\n" +
      "      // notation UNIQUE (lot agents) : la même fonction sert aux onglets sur les fiches filtrées\n" +
      "      const NOL = agxNolist(P);\n" +
      "      const SCO = scoreAgents(ALL, { short: SHORT, nolist: NOL }); const AG = SCO.AG, ORG = SCO.ORG;\n" +
      "      const AU = x => x === 'Autres' ? 'Autres (non précisé*)' : x;\n" +
      "      const r1 = x => typeof x === 'number' ? (isNum(x) ? (Number.isInteger(x) ? x : r(x, 1)) : null) : x;\n" +
      "      const agc = agxCols(P.agents, AGX_AGCOLS);\n" +
      "      P.agents.rows = AG.map(a => agc.map(k => k === 'enu' ? AU(a.enu.replace(/\\.+$/, '')) : k === 'org' ? AU(a.org) : r1(a[k])));\n" +
      "      const ogc = agxCols(P.orgs, AGX_ORGCOLS);\n" +
      "      P.orgs.rows = ORG.map(o => ogc.map(k => k === 'org' ? AU(o.org) : r1(o[k])));\n" },
  // ---------------------------------------------------------------- recomputeTables : partenaires de mise en œuvre
  { label: 'recomputeTables : partenaires de mise en œuvre par scoreImps',
    start: '      const IMP = [];\n',
    end: "      P.imps.rows = IMP.map(o => P.imps.cols.map(k => k === 'doms' ? o.doms : k === 'imp' ? AU(o.imp) : r1(o[k])));\n",
    replace:
      "      const IMP = scoreImps(VV.map(v => ({ act: v.act, imp: v.imp, valid: v.valid, score: v.score, risks: v.risks, doms: v.doms, code: v.code, date: v.date, org: P.dict.org[P.visits[v.i][5]] })), { rlabel, domains: P.domains });\n" +
      "      const ipc = agxCols(P.imps, AGX_IMPCOLS);\n" +
      "      P.imps.rows = IMP.map(o => ipc.map(k => (k === 'doms' || k === 'dom_n' || k === 'obs' || k === 'alerts') ? o[k] : k === 'imp' ? AU(o.imp) : r1(o[k])));\n" },
  // ---------------------------------------------------------------- recomputeTables : contrôles de qualité
  { label: 'recomputeTables : contrôles de qualité par dqStats',
    start: '      P.dq = ACTS.map(a => {\n',
    end: "offList: s.filter(x => String(x.site) === '999').length };\n      });\n",
    replace: '      P.dq = dqStats(ALL, VV, { acts: ACTS, nolist: NOL });\n' },
  // ---------------------------------------------------------------- exports
  { label: 'exports moteur (lot agents)',
    find: '    /*ENGINE-EXPORTS*/\n',
    replace: '    Object.assign(API, { scoreAgents, scoreImps, dqStats, readSubs: readSubsForUI, durStats: agxDur, AG_CRIT, ORG_COMP, IMP_PEN, ALERT_RESP_TXT, alertResp: agxResp, agxLevel, AGX_GLOBAL, AGX_PROD });\n    /*ENGINE-EXPORTS*/\n' },
  // ---------------------------------------------------------------- écrans
  { label: 'onglet Agents : module agX',
    start: '  function renderAgents(main) {\n',
    end: '[bar, host]));\n  }\n',
    replace: '  function renderAgents(main) { agXRenderAgents(main); }\n' },
  { label: 'onglet Partenaires : module agX',
    start: '  function renderPartners(main) {\n',
    end: "– à corriger dans le formulaire.' }));\n  }\n",
    replace: '  function renderPartners(main) { agXRenderPartners(main); }\n' },
  { label: 'onglet Qualité : module agX',
    start: '  function renderQuality(main) {\n',
    end: "    c3.style.marginTop = '14px'; main.appendChild(c3);\n  }\n",
    replace: '  function renderQuality(main) { agXRenderQuality(main); }\n' },
];
