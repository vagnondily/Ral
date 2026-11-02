  // ================================================================== LOT « VUE D'ENSEMBLE » (préfixe ov)
  // Vue d'ensemble, Activités, alertes et cas, couverture filtrée, Méthodologie générée, rapport aux textes versionnés.
  // Unités (une seule définition, utilisée partout dans ce lot) :
  //  · fiche  = une soumission de formulaire ;
  //  · visite = les fiches d'une même activité, même site, même jour (clé « activité|site|jour ») ;
  //  · site   = code du site (Code POI) ; un site saisi « Autre » (999) est compté à part, par son nom ; sans code ni nom = visite sans site.
  const OV_NOW = localDay();
  const OV_NR = DICT.enu.indexOf('(Non renseigné)');
  const OV_CODE = (D.visitKeys || []).map(k => { const s = String(k || ''); return s.slice(s.indexOf('|') + 1, s.lastIndexOf('|')); });
  const ovNum = x => typeof x === 'number' && isFinite(x);
  const OV_TREND_PTS = 5;          // écart (points de %) sous lequel une tendance est dite « stable »
  const OV_OLD_DAYS = 90;          // âge d'un cas signalé comme ancien
  const OV_DOM_SHARE = 0.1;       // un domaine n'est classé (« le plus faible ») que s'il est renseigné dans au moins 10 % des visites de l'activité
  const OV_CASE_ST = ['À transmettre', 'Transmis', 'En vérification', 'Clos – confirmé', 'Clos – non confirmé'];

  // ---------------------------------------------------------------- sites, agents, fiches
  function ovSiteOf(v) {
    const c = OV_CODE[v.i] || 'NA';
    if (c === 'NA' || c === '') return { kind: 'none', key: null, code: '' };
    if (c.slice(0, 3) === '999') {
      const p = c.split(':'); const nm = (p.length > 2 ? p.slice(1, -1).join(':') : (p[1] || '')).trim();
      if (!nm || /^(999|nan|none)$/i.test(nm)) return { kind: 'none', key: null, code: c };
      return { kind: 'off', key: v.act + '|999:' + nm.toLowerCase(), code: c };
    }
    return { kind: 'code', key: v.act + '|' + c, code: c };
  }
  function ovSites(vs) {
    const id = new Set(), off = new Set(), inP = new Set(); let none = 0; const PS = new Set(ovPlanRows().map(x => x.key));
    vs.forEach(v => { const s = ovSiteOf(v); if (s.kind === 'code') { id.add(s.key); if (PS.has(s.key)) inP.add(s.key); } else if (s.kind === 'off') off.add(s.key); else none++; });
    return { ident: id.size, inPlan: inP.size, off: off.size, noneVisits: none };
  }
  const ovSiteCount = vs => new Set(vs.map(v => ovSiteOf(v).key || ('v' + v.i))).size;
  function ovAgents(vs) {
    const s = new Set(); let noName = 0;
    vs.forEach(v => { const e = (v.enus || []).filter(x => x !== OV_NR); if (!e.length) noName++; e.forEach(x => s.add(x)); });
    return { n: s.size, noName };
  }
  const OV_SUB = (() => {
    const SC = D.subs.cols, ix = k => SC.indexOf(k), m = new Map(), durAct = {}, durOpen = {};
    const iv = ix('vkey'), ivl = ix('valid'), ie = ix('empty'), is = ix('sys_empty'), idb = ix('date_bad'), idu = ix('dur'), ia = ix('act');
    D.subs.rows.forEach(r => {
      const k = r[iv]; let o = m.get(k); if (!o) { o = { n: 0, valid: 0, empty: 0, sys: 0, dbad: 0 }; m.set(k, o); }
      o.n++; if (r[ivl] === 1) o.valid++; if (r[ie] === 1) o.empty++; if (r[is] === 1) o.sys++; if (r[idb] === 1) o.dbad++;
      if (idu >= 0 && ovNum(r[idu])) { durAct[r[ia]] = (durAct[r[ia]] || 0) + 1; if (r[idu] > 1440) durOpen[r[ia]] = (durOpen[r[ia]] || 0) + 1; }
    });
    return { m, durAct, durOpen };
  })();
  function ovFiches(vs) { let a = 0, b = 0; vs.forEach(v => { const o = OV_SUB.m.get(D.visitKeys[v.i]); if (o) { a += o.n; b += o.valid; } }); return { all: a, valid: b }; }
  function ovExclusions(bad) {
    const c = { sys: 0, date: 0, empty: 0, other: 0 };
    bad.forEach(v => { const o = OV_SUB.m.get(D.visitKeys[v.i]); if (!o) c.other++; else if (o.sys === o.n) c.sys++; else if (o.dbad > 0) c.date++; else if (o.empty === o.n) c.empty++; else c.other++; });
    return c;
  }
  const ovExclText = c => [c.sys ? fmt(c.sys) + ' ancienne version du formulaire' : '', c.date ? fmt(c.date) + ' date hors période de validité' : '', c.empty ? fmt(c.empty) + ' sans réponse' : '', c.other ? fmt(c.other) + ' autre motif (test…)' : ''].filter(Boolean).join(' · ') || 'aucune';
  let OV_QN = null;
  function ovQn(v) { if (!OV_QN) { OV_QN = new Map(); Object.keys(D.items).forEach(a => D.items[a].vals.forEach(arr => arr.forEach(p => OV_QN.set(p[0], (OV_QN.get(p[0]) || 0) + 1)))); } return OV_QN.get(v.i) || 0; }
  function ovScoreStats(x) {
    const s = x.map(v => v.score).filter(ovNum).sort((a, b) => a - b);
    const q = p => s.length ? s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))] : null;
    return { n: s.length, mean: mean(s), med: median(s), p25: q(0.25), p75: q(0.75), good: s.filter(y => y >= THR.good).length, bad: s.filter(y => y < THR.mid).length, perfect: s.filter(y => y >= 99.95).length,
      qmed: median(x.filter(v => ovNum(v.score)).map(ovQn)) };
  }
  function ovHeap(arr) { // valeurs « en tas » : une même valeur porte une grande part des réponses
    const a = arr.filter(ovNum); if (a.length < SMALL_N.low) return null;
    const c = new Map(); a.forEach(y => c.set(y, (c.get(y) || 0) + 1)); let mv = null, mn = 0; c.forEach((k, y) => { if (k > mn) { mn = k; mv = y; } });
    return mn / a.length >= 0.4 ? { value: mv, n: mn, N: a.length } : null;
  }

  // ---------------------------------------------------------------- niveaux d'alerte (une seule table)
  const ovALERT_TIERS = {
    source: 'Classification proposée par l’unité S&E, à valider avec les équipes protection et programme',
    levels: [
      { id: 1, name: 'Alerte grave, à escalader (niveau 1)', short: 'Grave', what: 'vol ou détournement, fraude ou doutes sur le ciblage, paiement exigé pour être inscrit, acteurs armés, incident lié à l’aide, trajet jugé peu sûr', rule: 'chaque cas est à transmettre, même isolé' },
      { id: 2, name: 'Alerte à vérifier et corriger (niveau 2)', short: 'À vérifier', what: 'rations réduites ou substituées, cartes d’autrui, vivres avariés, périmés ou à risque, difficultés d’accès, conflit sur le site', rule: 'à suivre avec le partenaire ; recommandation dès ' + THR.rLow + ' % des visites' },
      { id: 3, name: 'Problème de gestion (niveau 3)', short: 'Gestion', what: 'traces de déversement en magasin, conflit interne à un groupe', rule: 'à corriger lors des visites de suivi, sans cas individuel' },
      { id: 'c', name: 'Signal à confirmer', short: 'À confirmer', what: 'question sans libellé français dans le formulaire (SMP, signes de détournement au magasin)', rule: 'écarté des niveaux, des cas et des recommandations tant que la question n’est pas traduite et vérifiée' }
    ],
    codes: { MODistDiv: 1, HHDistDiv: 1, MOFraudConcerns: 1, HHFraudConcerns: 1, HHAsstPayEnt: 1, HHAsstSecurity: 1, security_incident: 1, MOAsstArmed: 1, HHAsstSafeLevel: 1,
      MOAsstIKRed: 2, MOAsstIKRedNut: 2, MOBenefOther: 2, MOWHBadCommod: 2, MOWHBadCommodoui: 2, MOWHBadCommodouinon: 2, MOExpItem: 2, MOWhBadCom: 2, MOHighRiskFoods: 2, MMFGDAccDif: 2, RRT_SiteConflict: 2,
      MOWhDisposeEvidSpill: 3, RRT_VSLAConflict: 3 },
    byAct: { 'SMP|HHDistDiv': 'c' },
    fallback: 2
  };
  function ovTier(act, code) { const k = act + '|' + code; if (ovALERT_TIERS.byAct[k] !== undefined) return ovALERT_TIERS.byAct[k]; const t = ovALERT_TIERS.codes[code]; return t === undefined ? ovALERT_TIERS.fallback : t; }
  const ovTierDef = t => ovALERT_TIERS.levels.find(l => l.id === t) || ovALERT_TIERS.levels[1];
  const ovTierRank = t => t === 'c' ? 4 : +t;
  function ovChip(t) { const d = ovTierDef(t); const s = el('span', { class: 'ov-chip ov-t' + t, text: d.short }); bindTip(s, () => d.name + ' : ' + d.what + '.\nRègle : ' + d.rule + '.\n' + ovALERT_TIERS.source + '.'); return s; }
  const OV_VT = new Map();
  function ovVT(v) {
    let o = OV_VT.get(v.i); if (o) return o;
    o = { 1: [], 2: [], 3: [], c: [] }; (v.risks || []).forEach(r => { const t = ovTier(v.act, RISK[r].code); (o[t] || o[2]).push(r); });
    OV_VT.set(v.i, o); return o;
  }
  function ovTierCounts(vs) {
    const o = { N: vs.length, t1: 0, t2: 0, t3: 0, c: 0, any: 0, t12: 0 };
    vs.forEach(v => { const T = ovVT(v); if (T[1].length) o.t1++; if (T[2].length) o.t2++; if (T[3].length) o.t3++; if (T.c.length) o.c++; if (v.risks.length) o.any++; if (T[1].length || T[2].length) o.t12++; });
    return o;
  }
  const OV_ASK = {};
  function ovAsked(act, code) { // visites où la question d'alerte a reçu une réponse (liste des normes), sinon null
    const k = act + '|' + code; if (k in OV_ASK) return OV_ASK[k];
    const q = D.riskQ[k], it = D.items[act]; let s = null;
    if (q && it) { const j = it.meta.findIndex(m => m.name === q.var); if (j >= 0) s = new Set(it.vals[j].map(p => p[0])); }
    OV_ASK[k] = s; return s;
  }
  const ovRiskLabel = (act, code, ri) => ri >= 0 ? riskLabel(act, ri) : ((D.spec && D.spec.riskLabel && D.spec.riskLabel[code]) || code);
  function ovTrend(x, isHit) {
    const ms = Array.from(new Set(x.filter(v => v.date).map(v => v.month))).sort();
    if (ms.length < 4) return { t: 'non calculable', d: 'moins de 4 mois de données dans la période', k: 'na' };
    const k = Math.min(3, Math.floor(ms.length / 2)), last = new Set(ms.slice(-k)), prev = new Set(ms.slice(-2 * k, -k));
    const L = x.filter(v => last.has(v.month)), Pv = x.filter(v => prev.has(v.month)), nl = L.filter(isHit).length, np = Pv.filter(isHit).length;
    const det = k + ' derniers mois : ' + nOf(nl, L.length, 'visites') + ' · ' + k + ' mois précédents : ' + nOf(np, Pv.length, 'visites');
    if (L.length < SMALL_N.low || Pv.length < SMALL_N.low) return { t: 'effectif faible', d: det, k: 'na' };
    const df = nl / L.length * 100 - np / Pv.length * 100;
    return { t: Math.abs(df) < OV_TREND_PTS ? 'stable' : df > 0 ? 'en hausse (+' + fmt(df, 0) + ' pts)' : 'en baisse (' + fmt(df, 0) + ' pts)', d: det, k: Math.abs(df) < OV_TREND_PTS ? 'na' : df > 0 ? 'up' : 'down' };
  }
  // Une ligne par question d'alerte de l'activité (même sans alerte) : n / N visites, base « question posée », tendance
  function ovAlertRows(ok, act) {
    const out = [];
    (act ? [act] : ACTS).forEach(a => {
      const x = ok.filter(v => v.act === a); if (!x.length) return;
      Object.keys(D.riskQ).filter(k => k.split('|')[0] === a).forEach(k => {
        const code = k.slice(a.length + 1), ri = RISK.findIndex(r => r.code === code);
        const hit = ri < 0 ? [] : x.filter(v => v.risks.includes(ri)); const hs = new Set(hit.map(v => v.i));
        const as = ovAsked(a, code); const asked = as ? x.filter(v => as.has(v.i) || hs.has(v.i)).length : null;
        const r = { act: a, code, ri, tier: ovTier(a, code), n: hit.length, N: x.length, asked, p: hit.length / x.length * 100, pa: asked ? hit.length / asked * 100 : null,
          label: ovRiskLabel(a, code, ri), q: D.riskQ[k], hit, all: x, hs };
        r.trend = r.n ? ovTrend(x, v => hs.has(v.i)) : { t: '—', d: 'aucune alerte', k: 'na' };
        out.push(r);
      });
    });
    return out;
  }
  const ovAlertSort = (p, q) => (ovTierRank(p.tier) - ovTierRank(q.tier)) || (q.n - p.n);
  function ovAlertCls(tier, n, p) { if (tier === 'c') return 'na'; if (!n) return 'good'; if (tier === 1) return 'bad'; if (tier === 2) return p > THR.rHigh ? 'bad' : 'mid'; return riskCls(p); }
  function ovAlertCell(r) {
    const k = ovAlertCls(r.tier, r.n, r.p), c = el('span', { class: 'cell ov-cw bg-' + k, text: fmt(r.n) + '/' + fmt(r.N) });
    bindTip(c, () => r.label + ' : ' + fmt(r.n) + ' visites sur ' + fmt(r.N) + ' (' + pct(r.p, 1) + ')\n' + (r.tier === 1 ? 'Alerte grave : rouge dès un cas.' : r.tier === 2 ? 'À vérifier : orange dès un cas, rouge au-delà de ' + THR.rHigh + ' % des visites.' : r.tier === 'c' ? 'À confirmer : pas de couleur (question non fiable).' : RCLS_TXT[k] + '.'));
    return c;
  }
  // ---------------------------------------------------------------- couverture du plan : suit TOUS les filtres
  const OV_PLANMAP = (() => { // région et bureau de chaque ligne du plan tels que le moteur les a rangés dans D.plan (même filtre, même ordre)
    const PF = D.planFull || { cols: [], rows: [] }, c = k => PF.cols.indexOf(k), reg = {}, fo = {};
    const al = PF.rows.filter(x => x[c('lat')] !== null && x[c('lat')] !== undefined && x[c('actif')] === 1);
    if (al.length === (D.plan || []).length) al.forEach((x, k) => { const p = D.plan[k]; if (ACTS[p[0]] !== x[c('act')]) return; reg[x[c('region')]] = p[4]; fo[x[c('fo')]] = p[5]; });
    return { reg, fo };
  })();
  const ovNormTxt = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  const OV_PR = { key: null, rows: [] };
  function ovPlanRows() {
    const PF = D.planFull || { cols: [], rows: [] }, c = k => PF.cols.indexOf(k), key = PF.rows.length + ':' + (SESSION.planPending || 0);
    if (OV_PR.key === key) return OV_PR.rows;
    const regIdx = raw => (String(raw) in OV_PLANMAP.reg) ? OV_PLANMAP.reg[raw] : DICT.region.indexOf(ENGINE.canonRegion(raw) || '');
    const foIdx = raw => (String(raw) in OV_PLANMAP.fo) ? OV_PLANMAP.fo[raw] : DICT.fo.indexOf(raw === null || raw === undefined ? '' : String(raw));
    OV_PR.rows = PF.rows.filter(x => x[c('actif')] === 1).map(x => ({ act: x[c('act')], code: x[0], key: x[c('act')] + '|' + x[0], region: regIdx(x[c('region')]), fo: foIdx(x[c('fo')]), dist: ovNormTxt(x[c('district')]), months: String(x[c('months')] || '') }));
    OV_PR.key = key; return OV_PR.rows;
  }
  function ovPeriodFull() { return !MONTHS.length || (F.m0 === MONTHS[0] && F.m1 === MONTHS[MONTHS.length - 1]); }
  // Contexte de couverture : sites actifs du plan (année du plan) vus par au moins une visite exploitable des visites données (déjà filtrées)
  function ovCovCtx(ok) {   // couverture : définition unique covCalc (core) — mêmes chiffres que la carte et la planification
    const fn = (act, regionIdx) => { const c = covCalc({ act, regionIdx }); return { planned: c.planned, visited: c.visited, year: c.year, outOfYear: c.outOfYear }; };
    fn.year = planYearUI(); return fn;
  }
  function ovCovNotes() {
    const n = ['Année du plan : ' + planYearUI() + ' (visites datées de cette année seulement).'];
    if (!ovPeriodFull()) n.push('Période choisie (' + monthLabel(F.m0) + ' → ' + monthLabel(F.m1) + ') : seules les visites de la période comptent ; le dénominateur garde les sites actifs au moins un mois de la période (grille mensuelle du plan).');
    if (F.org >= 0 || F.imp >= 0) n.push('Partenaire choisi : seules ses visites comptent, mais le plan n’indique pas le partenaire responsable d’un site : le dénominateur reste l’ensemble des sites actifs du périmètre géographique (la couverture d’un partenaire est donc minorée).');
    if (SESSION.planPending) n.push(fmt(SESSION.planPending) + ' changement(s) d’activation de sites non encore appliqué(s) au reste du fichier : pris en compte ici.');
    n.push('Aucune cible de couverture n’est définie : la valeur n’est pas colorée.');
    return n;
  }
  const ovCovTxt = cp => cp.outOfYear ? 'période hors de l’année du plan' : cp.planned ? fmt(cp.visited) + ' / ' + fmt(cp.planned) + ' sites actifs (' + pct(cp.visited / cp.planned * 100, 1) + ')' : 'aucun site actif au plan';

  // ---------------------------------------------------------------- éléments d'interface communs au lot
  function ovClickable(node, fn, label) {
    node.classList.add('ov-clk'); node.setAttribute('role', 'button'); node.tabIndex = 0; if (label) node.setAttribute('aria-label', label + ' — ouvrir le détail du calcul');
    node.addEventListener('click', ev => { if (ev.target !== node && ev.target.closest('button,a,input,select,textarea')) return; fn(); });
    node.addEventListener('keydown', ev => { if (ev.target !== node) return; if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fn(); } });
    return node;
  }
  function ovTile(o) {
    const t = el('div', { class: 'kpi ov-tile' + (o.c ? ' k-' + o.c : '') }, [el('div', { class: 'kh' }, [el('div', { class: 'l', text: o.l }), o.i ? infoBtn(o.i) : null]), el('div', { class: 'v' + (o.c ? ' ' + o.c : ''), text: o.v }), o.s ? el('div', { class: 's', text: o.s }) : null]);
    return o.open ? ovClickable(t, o.open, o.l) : t;
  }
  function ovCard(title, info, body, cls) { return el('div', { class: 'card' + (cls ? ' ' + cls : '') }, [el('div', { class: 'ch' }, [el('h2', { text: title }), info ? infoBtn(info) : null])].concat((body || []).filter(Boolean))); }
  function ovNCell(n, N, k, unit) { const s = el('span', { class: k ? 'cell ov-cw bg-' + k : 'ov-plain', text: fmt(n) }); bindTip(s, () => nOf(n, N, unit || 'visites')); return s; }
  function ovFrac(n, N, unit) { const s = el('span', { class: 'ov-plain', text: N ? fmt(n) + '/' + fmt(N) : '–' }); bindTip(s, () => nOf(n, N, unit || 'visites')); return s; }
  function ovBars(items, opt) {
    opt = opt || {}; const max = opt.max || Math.max(1, ...items.map(i => i.value || 0));
    const wrap = el('div', { class: 'bars ov-bars' });
    items.forEach(it => {
      const fil = el('div', { class: 'fil' + (it.cls ? ' bg-' + it.cls : '') }); fil.style.width = Math.max(0, Math.min(100, (it.value || 0) / max * 100)) + '%';
      const row = el('div', { class: 'bar' + (it.dim ? ' ov-dim' : '') }, [el('div', { class: 'lab' }, [el('span', { text: it.label }), it.sub ? el('span', { class: 'ov-sub', text: it.sub }) : null]), el('div', { class: 'trk' }, fil),
        el('div', { class: 'val' + (it.cls ? ' ' + it.cls : ''), text: it.vtxt !== undefined ? it.vtxt : pct(it.value, 1) }), el('div', { class: 'n', text: it.ntxt || '' })]);
      if (it.tip) bindTip(row, () => it.tip);
      if (it.open) ovClickable(row, it.open, it.label);
      wrap.appendChild(row);
    });
    if (!items.length) wrap.appendChild(el('p', { class: 'hint', text: opt.empty || 'Aucune donnée pour la sélection.' }));
    return wrap;
  }
  function ovDrawer(title, sub, o) {
    return openDrawer(title, sub, [
      o.value ? xsec('Valeur réelle et base (n / N)', [kvList(o.value)]) : null,
      o.ref ? xsec('Référence', [typeof o.ref === 'string' ? el('p', { text: o.ref }) : kvList(o.ref)]) : null
    ].concat(o.extra || [], [
      o.formula ? xsec('Calcul', [formulaBox(o.formula)]) : null,
      o.limits && o.limits.filter(Boolean).length ? xsec('Limites', o.limits.filter(Boolean).map(t => limitBox(t, 'warn'))) : null,
      xsec('Filtres et version des données', [kvList([['Filtres appliqués', filtersActiveText()], ['Données', OV_VERLAB]])])
    ]));
  }
  const ovScoreRef = () => [['Seuils de lecture', scoreRefText()], ['Origine', 'convention interne de l’outil (table unique des seuils), provisoire : aucune cible programme n’est validée — à confirmer par l’unité S&E']];
  function ovBtn(text, fn, extra) { const b = el('button', { class: 'btn' + (extra ? ' ' + extra : ''), type: 'button', text }); b.addEventListener('click', fn); return b; }
  function ovSmallCell(v, n, lab) { // score coloré seulement si l'effectif suffit
    const s = nStatus(n); if (s === 'na') { const c = el('span', { class: 'cell bg-na', text: '–' }); bindTip(c, () => (lab ? lab + '\n' : '') + nNote(n, 'visites')); return c; }
    if (s === 'low') { const c = el('span', { class: 'cell bg-na ov-low', text: fmt(v, 0) }); bindTip(c, () => (lab ? lab + '\n' : '') + 'Score ' + fmt(v, 1) + ' / 100 — ' + nNote(n, 'visites') + ' : non coloré, exclu des classements.'); return c; }
    return cell(v, false, (lab ? lab + ' · ' : '') + fmt(n) + ' visites');
  }
  // ---------------------------------------------------------------- export « cas à suivre » (CSV durci et XLSX sans formule)
  const OV_CASE_H = ['Activité', 'Date de la visite', 'Site', 'Code du site', 'District', 'Région', 'Bureau', 'Partenaire de suivi (TPM)', 'Partenaire de mise en œuvre', 'Agent(s)', 'Alerte', 'Niveau', 'Question', 'Réponse comptée comme alerte', 'Autres alertes de la visite', 'Score /100', 'Statut du cas', 'Clé du cas'];
  function ovCaseRow(v, code) {
    const ri = RISK.findIndex(r => r.code === code), q = D.riskQ[v.act + '|' + code] || {}, st = ovCaseStore()[ovCaseKey(v, code)];
    return [ACT[v.act].short, v.date || '', DICT.site[v.site] || '', ovSiteOf(v).code || '', DICT.district[v.district] || '', DICT.region[v.region] || '', DICT.fo[v.fo] || '', DICT.org[v.org] || '', DICT.imp[v.imp] || '',
      (v.enus || []).filter(e => e !== OV_NR).map(e => DICT.enu[e]).join(', '), ovRiskLabel(v.act, code, ri), ovTierDef(ovTier(v.act, code)).short, q.q || code, q.ans || 'Oui',
      v.risks.filter(r => RISK[r].code !== code).map(r => riskLabel(v.act, r) + ' (' + ovTierDef(ovTier(v.act, RISK[r].code)).short + ')').join(' ; '), ovNum(v.score) ? Math.round(v.score * 10) / 10 : null,
      ovTier(v.act, code) === 1 || ovTier(v.act, code) === 2 ? OV_CASE_ST[st ? st.s || 0 : 0] : '', ovCaseKey(v, code)];
  }
  function ovExportBtns(base, pairs, lead) { // pairs : [[visite, code]]
    const rows = () => pairs.map(([v, c]) => ovCaseRow(v, c));
    // texte des appels gardé à l'identique : le lot sécurité y ajoute le contrôle administrateur
    const b1 = ovBtn('Exporter les cas à suivre (.csv)', () => downloadBlob(csvBlob(OV_CASE_H, rows()), base + '_' + OV_NOW + '.csv'));
    const b2 = ovBtn('Exporter (.xlsx)', () => downloadBlob(xlsxBlob([{ name: 'Cas a suivre', header: OV_CASE_H, rows: rows() }]), base + '_' + OV_NOW + '.xlsx'));
    b1.textContent = 'Export CSV'; b2.textContent = 'Export Excel'; b1.classList.add('sm'); b2.classList.add('sm');
    bindTip(b1, () => fmt(pairs.length) + ' ligne(s) : une par visite et par alerte, avec le site, la date, les partenaires, les agents et le statut du cas.');
    return el('div', { class: 'ov-exp' }, [lead ? el('span', { class: 'ov-lead', text: lead }) : null, b1, b2]);
  }
  // ---------------------------------------------------------------- détail d'une visite, d'une alerte, des niveaux
  function ovVisitChips(v) {
    const T = ovVT(v), b = el('div', { class: 'ov-chips' }), pl = { 1: 'graves', 2: 'à vérifier', 3: 'gestion', c: 'à confirmer' }, sg = { 1: 'grave', 2: 'à vérifier', 3: 'gestion', c: 'à confirmer' };
    [1, 2, 3, 'c'].forEach(t => { const n = T[t].length; if (n) { const c = ovChip(t); c.textContent = n + ' ' + (n > 1 ? pl[t] : sg[t]); b.appendChild(c); } });
    if (!v.risks.length) b.appendChild(el('span', { class: 'muted', text: 'aucune' })); return b;
  }
  function ovNonConf(v) { const rset = new Set(Object.keys(D.riskQ).filter(k => k.split('|')[0] === v.act).map(k => D.riskQ[k].var)); return nonConf(v).filter(m => !rset.has(m.name)); }
  function ovWhyNode(v) {
    const box = el('div', { class: 'why' }), rs = v.risks.slice().sort((a, b) => ovTierRank(ovTier(v.act, RISK[a].code)) - ovTierRank(ovTier(v.act, RISK[b].code)));
    rs.slice(0, 3).forEach(r => { const t = ovTier(v.act, RISK[r].code), q = riskQ(v.act, r); const d = el('div', { class: t === 1 ? 'w-al' : 'ov-w2', text: riskLabel(v.act, r) }); bindTip(d, () => ovTierDef(t).name + '\nQuestion : « ' + (q ? q.q : RISK[r].code) + ' »\nRéponse comptée : ' + (q ? q.ans : 'Oui')); box.appendChild(d); });
    if (rs.length > 3) box.appendChild(el('div', { class: 'muted', text: 'et ' + (rs.length - 3) + ' autre(s)' }));
    const nc = ovNonConf(v);
    if (nc.length) { const d = el('div', { class: 'muted', text: fmt(nc.length) + ' norme(s) non respectée(s) sur ' + fmt(ovQn(v)) }); bindTip(d, () => nc.slice(0, 8).map(m => (m.neg ? 'Oui' : 'Non') + ' à « ' + shortQ(m.label) + ' »').join('\n') + (nc.length > 8 ? '\n… et ' + (nc.length - 8) + ' autre(s)' : '')); box.appendChild(d); }
    return box;
  }
  function ovHowNode(v) {
    const L = [], T = ovVT(v);
    [1, 2, 3].forEach(t => T[t].forEach(r => { const h = RISK_HOW[RISK[r].code]; if (h && !L.includes(h)) L.push(h); }));
    if (T.c.length) L.push('Vérifier sur place le signal à confirmer avant toute escalade.');
    const nc = ovNonConf(v), byDom = {}; nc.forEach(m => { byDom[m.domain] = (byDom[m.domain] || 0) + 1; });
    Object.keys(byDom).sort((a, b) => byDom[b] - byDom[a]).slice(0, 2).forEach(d => { const h = DOMAIN_HOW[d]; if (h && !L.includes(h)) L.push(h); });
    return el('ul', { class: 'how' }, L.slice(0, 2).map(t => el('li', { text: t })));
  }
  function ovVisitDrawer(v) {
    const T = ovVT(v), nc = ovNonConf(v), st = ovSiteOf(v);
    const al = el('div', { class: 'ov-list' }, v.risks.length ? v.risks.map(r => { const q = riskQ(v.act, r), t = ovTier(v.act, RISK[r].code); return el('div', { class: 'ov-li' }, [ovChip(t), ' ', el('b', { text: riskLabel(v.act, r) }), el('div', { class: 'muted', text: 'Question : « ' + (q ? q.q : RISK[r].code) + ' » — réponse comptée comme alerte : « ' + (q ? q.ans : 'Oui') + ' »' }), RISK_HOW[RISK[r].code] ? el('div', { class: 'ov-how', text: 'Que faire : ' + RISK_HOW[RISK[r].code] }) : null]); }) : [el('p', { class: 'muted', text: 'Aucune alerte relevée.' })]);
    const byDom = {}; nc.forEach(m => { (byDom[m.domain] = byDom[m.domain] || []).push(m); });
    const ncs = Object.keys(byDom).sort((a, b) => byDom[b].length - byDom[a].length).map(d => el('div', { class: 'ov-li' }, [el('b', { text: d + ' (' + byDom[d].length + ')' }), el('ul', null, byDom[d].map(m => el('li', { text: (m.neg ? 'Oui' : 'Non') + ' à « ' + m.label + ' »' })))]));
    ovDrawer('Visite du ' + dFrUI(v.date) + ' – ' + (DICT.site[v.site] || 'site non renseigné'), ACT[v.act].label, {
      value: [['Site', (DICT.site[v.site] || '–') + (st.code ? ' · code ' + st.code : '')], ['District · région', (DICT.district[v.district] || '–') + ' · ' + (DICT.region[v.region] || '–')], ['Bureau', DICT.fo[v.fo] || '–'],
        ['Partenaire de suivi (TPM)', DICT.org[v.org] || '–'], ['Partenaire de mise en œuvre', DICT.imp[v.imp] || '–'], ['Agent(s)', (v.enus || []).map(e => DICT.enu[e]).join(', ') || '–'],
        ['Score de conformité', ovNum(v.score) ? fmt(v.score, 1) + ' / 100 sur ' + fmt(ovQn(v)) + ' questions renseignées' : 'non calculé'], ['Alertes', T[1].length + ' grave(s), ' + T[2].length + ' à vérifier, ' + T[3].length + ' de gestion, ' + T.c.length + ' à confirmer'],
        ['Fiches', (() => { const o = OV_SUB.m.get(D.visitKeys[v.i]); return o ? fmt(o.valid) + ' exploitable(s) sur ' + fmt(o.n) : '–'; })()]],
      ref: ovScoreRef(),
      extra: [xsec('Alertes relevées', [al]), xsec('Normes non respectées (hors questions d’alerte)', ncs.length ? ncs : [el('p', { class: 'muted', text: 'Aucune.' })]), xsec('Que faire', [ovHowNode(v)])],
      formula: 'Score de la visite = moyenne des questions Oui/Non répondues (conforme = 100, non conforme = 0, partiel = 50 ; questions « négatives » inversées) sur les fiches exploitables de la visite.',
      limits: ['Une question non posée ou « ne sait pas » est exclue : le score repose sur ' + fmt(ovQn(v)) + ' question(s) de la liste des normes.', 'Les questions d’alerte sont aussi des normes : une alerte fait aussi baisser le score.']
    });
  }
  function ovAlertDrawer(r) {
    const q = r.q || {}, d = ovTierDef(r.tier), hit = r.hit.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const tbl = table([
      { k: 'date', t: 'Date', fmt: v => dFrUI(v.date), sortVal: v => v.date },
      { k: 'site', t: 'Site', fmt: v => el('div', null, [el('div', { class: 'ov-b', text: DICT.site[v.site] || '–' }), el('div', { class: 'muted', text: (DICT.district[v.district] || '–') + ' · ' + (DICT.region[v.region] || '–') })]), sortVal: v => DICT.site[v.site] },
      { k: 'org', t: 'TPM · MEO', fmt: v => (DICT.org[v.org] || '–') + ' · ' + (DICT.imp[v.imp] || '–') },
      { k: 'enu', t: 'Agent(s)', fmt: v => (v.enus || []).filter(e => e !== OV_NR).map(e => DICT.enu[e]).join(', ') || '–' },
      { k: 'oth', t: 'Autres alertes', fmt: v => v.risks.filter(x => x !== r.ri).map(x => riskLabel(v.act, x)).join(' ; ') || '—' },
      { k: 'score', t: 'Score', num: 1, fmt: v => cell(v.score, false, DICT.site[v.site]), sortVal: v => v.score }
    ], hit.slice(0, 400), { onRow: v => ovVisitDrawer(v) });
    ovDrawer(r.label + ' – ' + ACT[r.act].short, d.name, {
      value: [['Visites concernées', nOf(r.n, r.N, 'visites exploitables de l’activité')], ['Où la question a été posée', r.asked === null ? 'non disponible (la réponse à cette question n’est pas conservée dans la liste des normes)' : nOf(r.n, r.asked, 'visites où la question a reçu une réponse')],
        ['Sites distincts', fmt(ovSiteCount(r.hit))], ['Tendance', r.trend.t + ' — ' + r.trend.d]],
      ref: [['Question exacte', '« ' + (q.q || r.code) + ' »'], ['Variable', q.var || r.code], ['Réponse comptée comme alerte', '« ' + (q.ans || 'Oui') + ' »'], ['Niveau', d.name + ' — ' + d.rule], ['Classement', ovALERT_TIERS.source], ['Action recommandée', RISK_HOW[r.code] || 'Analyser les cas avec le partenaire.']],
      extra: [xsec('Visites concernées (' + fmt(r.n) + ')', [ovExportBtns('cas_' + r.act + '_' + r.code, r.hit.map(v => [v, r.code])), r.n > 400 ? el('p', { class: 'muted', text: '400 premières affichées ; l’export contient tout.' }) : null, tbl])],
      formula: '% = visites exploitables où au moins une fiche a répondu « ' + (q.ans || 'Oui') + ' » ÷ visites exploitables de l’activité (filtres appliqués). Base « question posée » : même numérateur ÷ visites où la question a reçu une réponse.',
      limits: [r.tier === 'c' ? 'Question sans libellé français (seule la consigne anglaise s’affiche) : taux à confirmer sur le terrain avant toute conclusion.' : null, 'Les fiches d’une visite sont réunies : une seule fiche « Oui » suffit.', r.asked !== null && r.asked < r.N ? 'La question n’a pas été posée dans ' + fmt(r.N - r.asked) + ' visite(s) : le % sur toutes les visites minore la fréquence réelle.' : null, 'Un signal relevé par l’agent n’est pas un fait vérifié.']
    });
  }
  function ovTiersDrawer(ok, act) {
    const x = act ? ok.filter(v => v.act === act) : ok, T = ovTierCounts(x), rows = ovAlertRows(x, act).filter(r => r.n);
    const only = {}; x.forEach(v => { const cs = Array.from(new Set(v.risks.map(r => RISK[r].code))); if (cs.length === 1) { const k = v.act + '|' + cs[0]; only[k] = (only[k] || 0) + 1; } });
    rows.forEach(r => { r.only = only[r.act + '|' + r.code] || 0; r.without = T.N ? (T.any - r.only) / T.N * 100 : null; });
    rows.sort((p, q) => q.n - p.n);
    const nq = {}; Object.keys(D.riskQ).forEach(k => { const a = k.split('|')[0]; nq[a] = (nq[a] || 0) + 1; });
    const tb = table([{ k: 'act', t: 'Activité', fmt: r => ACT[r.act].short }, { k: 'label', t: 'Alerte', fmt: r => r.label }, { k: 'tier', t: 'Niveau', fmt: r => ovChip(r.tier), sortVal: r => ovTierRank(r.tier) },
      { k: 'n', t: 'Visites', num: 1, fmt: r => fmt(r.n) }, { k: 'only', t: 'Seule alerte', title: 'Visites dont c’est la seule alerte', num: 1, fmt: r => fmt(r.only) }, { k: 'without', t: 'Taux sans elle', title: 'Taux « au moins une alerte » si cette question était retirée', num: 1, fmt: r => pct(r.without, 1) }], rows, { onRow: r => ovAlertDrawer(r) });
    ovDrawer('Alertes par niveau' + (act ? ', ' + ACT[act].short : ''), ovALERT_TIERS.source, {
      value: [['Visites exploitables', fmt(T.N)], ['Alertes graves', nOf(T.t1, T.N, 'visites')], ['À vérifier', nOf(T.t2, T.N, 'visites')], ['Gestion', nOf(T.t3, T.N, 'visites')], ['À confirmer', nOf(T.c, T.N, 'visites')], ['Au moins une alerte, tous niveaux', nOf(T.any, T.N, 'visites')]],
      ref: ovALERT_TIERS.levels.map(l => [l.name, l.what + ' — ' + l.rule]),
      extra: [xsec('Contribution de chaque question au taux « au moins une alerte »', [tb, el('p', { class: 'muted', text: 'Questions d’alerte par activité : ' + ACTS.filter(a => !act || a === act).map(a => ACT[a].short + ' ' + (nq[a] || 0)).join(' · ') + '. Plus une activité a de questions, plus son taux « ≥ 1 alerte » monte : ne comparez pas les activités sur ce taux.' })])],
      formula: 'Visite « avec alerte de niveau k » = au moins une question d’alerte de niveau k a reçu la réponse indiquée dans une des fiches de la visite. Taux = visites ÷ visites exploitables (filtres appliqués).',
      limits: ['La classification en niveaux est une proposition : à valider avec les équipes protection et programme.', 'Le taux global « ≥ 1 alerte » mélange des signaux graves et des problèmes de magasin : lisez les niveaux.', T.c ? fmt(T.c) + ' visite(s) portent un signal « à confirmer » (question non traduite), exclu des niveaux.' : null]
    });
  }

  // ---------------------------------------------------------------- visites prioritaires : UN générateur (écran et rapport)
  function ovPrio(ok, mode) {
    mode = mode || 'both'; const t = v => ovVT(v);
    const crit = v => { const T = t(v), al = T[1].length + T[2].length > 0, low = ovNum(v.score) && v.score < THR.mid; return mode === 'score' ? low : mode === 'alert' ? al : (al || low); };
    const all = ok.filter(crit).sort((a, b) => (t(b)[1].length - t(a)[1].length) || (t(b)[2].length - t(a)[2].length) || ((ovNum(a.score) ? a.score : 101) - (ovNum(b.score) ? b.score : 101)));
    const n1 = all.filter(v => t(v)[1].length).length, n2 = all.filter(v => !t(v)[1].length && t(v)[2].length).length;
    return { all, n1, n2, ns: all.length - n1 - n2, N: ok.length, mode };
  }
  const ovPrioCritTxt = m => ({ both: 'une alerte grave ou à vérifier, ou un score sous ' + THR.mid, score: 'un score sous ' + THR.mid, alert: 'une alerte grave ou à vérifier' })[m] || '';
  function ovPrioHead(P, shown) { return fmt(P.all.length) + ' visites sur ' + fmt(P.N) + ' demandent un suivi : ' + fmt(P.n1) + ' avec une alerte grave, ' + fmt(P.n2) + ' avec une alerte à vérifier, ' + fmt(P.ns) + ' avec un score sous ' + THR.mid + '. Les ' + fmt(shown) + ' premières sont listées, alertes graves d’abord, puis alertes à vérifier, puis score le plus bas.'; }
  function ovPrioPairs(P) { const out = []; P.all.forEach(v => { const T = ovVT(v); T[1].concat(T[2]).forEach(r => out.push([v, RISK[r].code])); if (!T[1].length && !T[2].length) out.push([v, '']); }); return out; }
  function ovPrioCard(ok, n, title) {
    const P = ovPrio(ok, 'both'), rows = P.all.slice(0, n);
    const t = table([
      { k: 'site', t: 'Visite', fmt: r => el('div', null, [el('div', { class: 'ov-b', text: DICT.site[r.site] || '–' }), el('div', { class: 'muted', text: (DICT.district[r.district] || '–') + ', ' + dFrUI(r.date) + (F.act === 'ALL' ? ', ' + ACT[r.act].short : '') })]), sortVal: r => DICT.site[r.site] },
      { k: 'al', t: 'Alertes', fmt: r => ovVisitChips(r), sortVal: r => ovVT(r)[1].length * 100 + ovVT(r)[2].length },
      { k: 'score', t: 'Score', num: 1, fmt: r => { const c = cell(r.score, false, DICT.site[r.site] + ' : ' + fmt(ovQn(r)) + ' questions renseignées'); return c; }, sortVal: r => r.score },
      { k: 'why', t: 'Pourquoi', fmt: r => ovWhyNode(r) },
      { k: 'how', t: 'Que faire', fmt: r => ovHowNode(r) }
    ], rows, { onRow: r => ovVisitDrawer(r) });
    return ovCard(title, ovPrioHead(P, rows.length), [ovExportBtns('visites_prioritaires', ovPrioPairs(P), fmt(rows.length) + ' sur ' + fmt(P.all.length) + ' visites'), t], 'wide');
  }
  // ---------------------------------------------------------------- textes calculés : messages, recommandations, pourquoi / comment
  function ovItemCounts(a, j, okSet) {
    const it = D.items[a], m = it.meta[j]; let n = 0, c = 0, nc = 0, pa = 0, s = 0;
    it.vals[j].forEach(p => { if (okSet && !okSet.has(p[0])) return; n++; s += p[1]; if (p[1] >= 100) c++; else if (p[1] <= 0) nc++; else pa++; });
    return { m, j, n, c, nc, part: pa, p: n ? s / n : null };
  }
  function ovDomRows(a, x) {
    const N = x.length;
    return D.domains[a].map((d, j) => { const xs = x.filter(v => ovNum(v.doms[j])); return { d, j, n: xs.length, N, v: mean(xs.map(v => v.doms[j])), med: median(xs.map(v => v.doms[j])), nq: ((D.domainItems[a] || {})[d] || []).length }; }).filter(r => r.n);
  }
  const ovDomRanked = r => nStatus(r.n) === 'ok' && r.n >= OV_DOM_SHARE * r.N;
  function ovWeakDomains(a, x) {
    const okSet = new Set(x.map(v => v.i));
    return ovDomRows(a, x).filter(r => ovDomRanked(r)).sort((p, q) => p.v - q.v).map(r => Object.assign(r, { qs: ((D.domainItems[a] || {})[r.d] || []).map(j => ovItemCounts(a, j, okSet)).filter(q => q.n >= SMALL_N.min).sort((p, q) => p.p - q.p) }));
  }
  const ovQTxt = q => '« ' + (q.m.neg ? 'Oui' : 'Non') + ' » à « ' + shortQ(q.m.label) + ' » dans ' + nOf(q.nc, q.n, 'visites') + (q.part ? ' (+ ' + fmt(q.part) + ' partiel)' : '');
  function ovMessages(ok) {
    const M = [];
    ACTS.forEach(a => {
      const x = ok.filter(v => v.act === a); if (!x.length) return;
      if (nStatus(x.length) === 'na') { M.push([a, ACT[a].short + ' : seulement ' + fmt(x.length) + ' visite(s), trop peu pour commenter (minimum ' + SMALL_N.min + ').']); return; }
      const st = ovScoreStats(x), ds = x.map(v => v.date).filter(Boolean).sort(), T = ovTierCounts(x);
      const s = [ACT[a].short + ' : ' + fmt(x.length) + ' visites du ' + dFrUI(ds[0]) + ' au ' + dFrUI(ds[ds.length - 1]) + (nStatus(x.length) === 'low' ? ', à lire avec prudence vu le petit nombre' : '') + '.'];
      s.push('Le score moyen est de ' + fmt(st.mean, 1) + ' sur 100 (médiane ' + fmt(st.med, 1) + ') et ' + fmt(st.good) + ' visites sur ' + fmt(st.n) + ' atteignent la référence de ' + THR.good + '.');
      const rows = ovAlertRows(x, a).filter(r => r.n && r.tier !== 'c').sort(ovAlertSort), top = rows[0];
      if (T.t1) s.push('Des alertes graves ont été relevées dans ' + fmt(T.t1) + ' visites sur ' + fmt(T.N) + (top && top.tier === 1 ? ', surtout ' + ovLow(top.label) + ' (' + fmt(top.n) + ' visites)' : '') + '.');
      else if (top) s.push('Aucune alerte grave. L’alerte la plus fréquente est ' + ovLow(top.label) + ' (' + fmt(top.n) + ' visites sur ' + fmt(top.N) + (top.asked && top.asked < top.N ? ', ' + pct(top.pa, 0) + ' des visites où la question a été posée' : '') + ').');
      else s.push('Aucune alerte relevée.');
      ovAlertRows(x, a).filter(r => r.n && r.tier === 'c').forEach(r => s.push('Le signal « ' + ovLow(r.label.replace(/\s*\(.*\)\s*$/, '')) + ' » (' + fmt(r.n) + ' visites) reste à confirmer : la question n’est pas traduite dans le formulaire.'));
      const dw = ovWeakDomains(a, x)[0];
      if (dw) s.push('Point faible : ' + ovLow(dw.d) + ' (' + fmt(dw.v, 1) + ' sur 100)' + (dw.qs[0] ? ', ' + ovQPlain(dw.qs[0]) : '') + '.');
      if (a === 'SMP' && D.smpMeals && D.smpMeals.n_all) s.push('Sur toute la période, ' + fmt(D.smpMeals.supply) + ' fiches de direction sur ' + fmt(D.smpMeals.n_all) + ' citent une rupture, un retard de livraison ou une catastrophe.');
      M.push([a, s.join(' ')]);
    });
    return M;
  }
  const ovLow = s => { const t = String(s || ''); return /^[A-ZÉÈÀ][a-zéèêàùç]/.test(t) && !/^[A-Z]{2}/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t; };
  const ovQPlain = q => 'réponse « ' + (q.m.neg ? 'oui' : 'non') + ' » à « ' + shortQ(q.m.label) + ' » dans ' + fmt(q.nc) + ' visites sur ' + fmt(q.n);
  function ovRecs(ok) {
    const R = [], how = (h, d) => ovLow(h || d);
    ACTS.forEach(a => {
      const x = ok.filter(v => v.act === a); if (nStatus(x.length) === 'na') return;
      const rows = ovAlertRows(x, a).filter(r => r.n), g = rows.filter(r => r.tier === 1).sort((p, q) => q.n - p.n);
      g.slice(0, 3).forEach(r => R.push(['rec.' + a + '.' + r.code, ACT[a].short + ', ' + ovLow(r.label) + ' (' + fmt(r.n) + ' visites, ' + fmt(ovSiteCount(r.hit)) + ' sites) : ' + how(RISK_HOW[r.code], 'ouvrir un cas et vérifier avec le partenaire.')]));
      if (g.length > 3) R.push(['rec.' + a + '.autres-graves', ACT[a].short + ', autres alertes graves (' + g.slice(3).map(r => ovLow(r.label) + ' ' + fmt(r.n)).join(', ') + ') : ouvrir un cas pour chaque visite concernée.']);
      rows.filter(r => r.tier === 2 && r.p >= THR.rLow).sort((p, q) => q.n - p.n).slice(0, 2).forEach(r => R.push(['rec.' + a + '.' + r.code, ACT[a].short + ', ' + ovLow(r.label) + ' (' + fmt(r.n) + ' visites sur ' + fmt(r.N) + ') : ' + how(RISK_HOW[r.code], 'vérifier avec le partenaire.')]));
      ovWeakDomains(a, x).filter(d => d.v < THR.good).slice(0, 2).forEach(d => { if (DOMAIN_HOW[d.d]) R.push(['rec.' + a + '.dom.' + d.d, ACT[a].short + ', ' + ovLow(d.d) + ' (' + fmt(d.v, 1) + ' sur 100) : ' + ovLow(DOMAIN_HOW[d.d])]); });
    });
    return R;
  }
  function ovWhyHow(a, x) {
    const why = [], how = [];
    ovWeakDomains(a, x).slice(0, 3).forEach(d => {
      why.push(['dom.' + d.d, d.d + ' : ' + fmt(d.v, 1) + ' sur 100 (' + fmt(d.n) + ' visites)' + (d.qs.length ? ', ' + ovQPlain(d.qs[0]) : '') + '.']);
      if (DOMAIN_HOW[d.d]) how.push(['dom.' + d.d, d.d + ' : ' + ovLow(DOMAIN_HOW[d.d])]);
    });
    ovAlertRows(x, a).filter(r => r.n).sort(ovAlertSort).slice(0, 4).forEach(r => {
      why.push(['al.' + r.code, r.label + ' : ' + fmt(r.n) + ' visites sur ' + fmt(r.N) + (r.tier === 1 ? ', alerte grave' : r.tier === 'c' ? ', à confirmer' : '') + (r.asked && r.asked < r.N ? ' (' + pct(r.pa, 0) + ' là où la question a été posée)' : '') + '.']);
      if (r.tier !== 'c' && RISK_HOW[r.code]) how.push(['al.' + r.code, r.label + ' : ' + ovLow(RISK_HOW[r.code])]);
    });
    return { why, how };
  }
  // ---------------------------------------------------------------- graphique du score : axe 0–100, séparé des volumes
  function ovScoreSeries(ok, acts, months) {
    return acts.map(a => ({ key: a, label: ACT[a].short, color: ACT_COLOR[a] || '#555', pts: months.map(m => { const x = ok.filter(v => v.act === a && v.month === m && ovNum(v.score)); return { m, n: x.length, s: mean(x.map(v => v.score)), med: median(x.map(v => v.score)) }; }) })).filter(s => s.pts.some(p => p.n));
  }
  function ovLineChart(series, months, opt) {
    opt = opt || {}; const W = 760, H = opt.h || 230, pl = 40, pr = 24, pb = 30, pt = 22;
    const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opt.aria || 'Score de conformité par mois' }); svg.style.width = '100%'; svg.style.height = 'auto';
    const X = i => pl + (months.length <= 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (months.length - 1)), Y = s => pt + (H - pt - pb) * (1 - s / 100);
    [0, 20, 40, 60, 80, 100].forEach(t => { svg.appendChild(sv('line', { x1: pl, x2: W - pr, y1: Y(t), y2: Y(t), stroke: 'currentColor', 'stroke-opacity': 0.12 })); const tx = sv('text', { x: pl - 6, y: Y(t) + 4, 'text-anchor': 'end' }); tx.textContent = String(t); svg.appendChild(tx); });
    svg.appendChild(sv('line', { x1: pl, x2: W - pr, y1: Y(THR.good), y2: Y(THR.good), class: 'ov-tgt', 'stroke-dasharray': '6 4', 'stroke-width': 1.5 }));
    const tl = sv('text', { x: W - pr, y: 11, 'text-anchor': 'end', class: 'ov-tgtt' }); tl.textContent = '- - - référence ' + THR.good; svg.appendChild(tl);
    const step = Math.max(1, Math.ceil(months.length / 12));
    months.forEach((m, i) => { if (i % step) return; const tx = sv('text', { x: X(i), y: H - pb + 16, 'text-anchor': 'middle' }); tx.textContent = monthLabel(m); svg.appendChild(tx); });
    const ax = sv('text', { x: 4, y: 11, 'text-anchor': 'start', class: 'ov-axt' }); ax.textContent = 'score /100'; svg.appendChild(ax);
    series.forEach(s => {
      let d = ''; let pen = false;
      s.pts.forEach((p, i) => { if (p.n >= SMALL_N.min && ovNum(p.s)) { d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.s).toFixed(1); pen = true; } else pen = false; });
      svg.appendChild(sv('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2 }));
      s.pts.forEach((p, i) => {
        if (p.n < SMALL_N.min || !ovNum(p.s)) return;
        const c = sv('circle', { cx: X(i), cy: Y(p.s), r: 4, fill: p.n < SMALL_N.low ? 'none' : s.color, stroke: s.color, 'stroke-width': 2 });
        bindTip(c, () => s.label + ' · ' + monthLabel(p.m) + ' : score moyen ' + fmt(p.s, 1) + ' / 100 (médiane ' + fmt(p.med, 1) + ') sur ' + fmt(p.n) + ' visites' + (p.n < SMALL_N.low ? ' — effectif faible, indicatif' : '') + '\nRéférence : ' + THR.good + ' (convention interne)');
        svg.appendChild(c);
      });
    });
    return svg;
  }
  function ovPartialMonthNote(months) {
    const end = (D.period || [])[1]; if (!end || !months.length || months[months.length - 1] !== end.slice(0, 7)) return null;
    const y = +end.slice(0, 4), m = +end.slice(5, 7), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return +end.slice(8, 10) < last ? monthLabel(end.slice(0, 7)) + ' : mois partiel (données jusqu’au ' + dFrUI(end) + ').' : null;
  }

  // ---------------------------------------------------------------- détail des scores (activité, domaine, norme)
  function ovScoreDrawer(a, x) {
    const st = ovScoreStats(x), it = D.items[a];
    const bins = [['< 50', -1, 50, 'bad'], ['50 – ' + THR.mid, 50, THR.mid, 'bad'], [THR.mid + ' – ' + THR.good, THR.mid, THR.good, 'mid'], [THR.good + ' – 90', THR.good, 90, 'good'], ['≥ 90', 90, 1000, 'good']].map(([l, lo, hi, k]) => ({ label: l, n: x.filter(v => ovNum(v.score) && v.score >= lo && v.score < hi).length, k }));
    ovDrawer('Score de conformité – ' + (a ? ACT[a].short : 'toutes activités'), a ? ACT[a].label : 'Moyenne de visites de questionnaires différents', {
      value: [['Score moyen', fmt(st.mean, 1) + ' / 100'], ['Médiane (P25 – P75)', fmt(st.med, 1) + ' (' + fmt(st.p25, 1) + ' – ' + fmt(st.p75, 1) + ')'], ['Visites notées', fmt(st.n) + (nNote(st.n, 'visites') ? ' — ' + nNote(st.n, 'visites') : '')],
        ['Visites ≥ ' + THR.good, nOf(st.good, st.n, 'visites')], ['Visites < ' + THR.mid, nOf(st.bad, st.n, 'visites')], ['Visites à 100 / 100', fmt(st.perfect) + ' (à vérifier : une fiche « parfaite » peut être remplie sans observation)'],
        a ? ['Questions renseignées par visite', 'médiane ' + fmt(st.qmed) + ' sur ' + fmt(it.meta.length) + ' questions de la liste des normes'] : null].filter(Boolean),
      ref: ovScoreRef(),
      extra: [xsec('Répartition des visites', [histo(bins, 'visites')]), !a ? xsec('Par activité', [kvList(ACTS.map(b => { const y = x.filter(v => v.act === b); return y.length ? [ACT[b].short, fmt(mean(y.map(v => v.score)), 1) + ' / 100 · ' + fmt(y.length) + ' visites (' + pct(y.length / x.length * 100, 0) + ' du total)'] : null; }).filter(Boolean))]) : null],
      formula: 'Score d’une visite = moyenne des questions Oui/Non répondues (conforme = 100, non conforme = 0, partiel = 50 ; une question où « Oui » signale un problème est inversée). Score affiché = moyenne des visites ; médiane et répartition pour juger de la dispersion.',
      limits: ['Questions non posées, « non applicable » et « ne sait pas » exclues : une visite où peu de questions sont répondues pèse autant qu’une visite complète.', 'Chaque question pèse autant, quelle que soit sa gravité ; les questions d’alerte comptent aussi dans le score.', a ? 'Ne comparez pas ce score à celui d’une autre activité : les questionnaires diffèrent (' + fmt(it.meta.length) + ' questions ici).' : 'Moyenne toutes activités : dépend du mélange des activités (effet de composition) ; lisez les scores par activité.']
    });
  }
  function ovDomainDrawer(a, j, x) {
    const d = D.domains[a][j], okSet = new Set(x.map(v => v.i)), xs = x.filter(v => ovNum(v.doms[j])), vals = xs.map(v => v.doms[j]);
    const js = (D.domainItems[a] || {})[d] || [], qs = js.map(jj => ovItemCounts(a, jj, okSet)).filter(q => q.n).sort((p, q) => p.p - q.p);
    const tb = table([{ k: 'l', t: 'Question', fmt: q => (q.m.neg ? '↺ ' : '') + q.m.label, sortVal: q => q.m.label }, { k: 'c', t: 'Conforme', num: 1, fmt: q => fmt(q.c) }, { k: 'nc', t: 'Non conforme', num: 1, fmt: q => fmt(q.nc) }, { k: 'part', t: 'Partiel / mixte', num: 1, fmt: q => fmt(q.part) }, { k: 'n', t: 'Visites', num: 1, fmt: q => fmt(q.n) }, { k: 'p', t: '% conforme', num: 1, fmt: q => ovSmallCell(q.p, q.n, q.m.label), sortVal: q => q.p }], qs, { onRow: q => ovNormDrawer(a, q, x) });
    ovDrawer('Domaine « ' + d + ' » – ' + ACT[a].short, 'Score de domaine : part des normes du domaine respectées', {
      value: [['Score du domaine', fmt(mean(vals), 1) + ' / 100 (médiane ' + fmt(median(vals), 1) + ')'], ['Visites concernées', nOf(xs.length, x.length, 'visites exploitables de l’activité') + (nNote(xs.length, 'visites') ? ' — ' + nNote(xs.length, 'visites') : '')], ['Questions du domaine', fmt(js.length) + ' dans la liste des normes, dont ' + fmt(qs.length) + ' répondue(s) dans la sélection']],
      ref: ovScoreRef(), extra: [xsec('Questions (clic : détail)', [tb, el('p', { class: 'muted', text: '↺ question inversée : « Oui » signale un problème. Partiel / mixte : réponse « partiellement » ou fiches de la visite en désaccord (compté ½ dans le %).' })])],
      formula: 'Pour une visite : moyenne des questions du domaine répondues (conforme 100, non conforme 0, partiel 50). Score du domaine = moyenne des visites où au moins une question du domaine est répondue.',
      limits: ['Questions non posées ou non applicables exclues : la base change d’une question à l’autre.', 'La liste détaillée ne retient que les questions répondues dans au moins ' + SMALL_N.min + ' visites ; le score de visite utilise toutes les questions.', /ntégrité|fraude/i.test(d) ? 'Ce domaine contient des questions d’alerte : elles comptent aussi dans les alertes.' : null]
    });
  }
  function ovNormDrawer(a, q, x) {
    ovDrawer(q.m.label, 'Norme du domaine « ' + q.m.domain + ' » – ' + ACT[a].short, {
      value: [['% conforme (partiel = ½)', pct(q.p, 1)], ['Conforme', nOf(q.c, q.n, 'visites')], ['Non conforme', nOf(q.nc, q.n, 'visites')], ['Partiel / mixte', nOf(q.part, q.n, 'visites')], ['Visites où la question a été répondue', nOf(q.n, x.length, 'visites exploitables de l’activité')]],
      ref: [['Réponse conforme attendue', q.m.neg ? 'Non (question inversée : « Oui » signale un problème)' : 'Oui'], ['Variable', q.m.name], ['Seuils de lecture', scoreRefText() + ' (convention interne)']],
      formula: 'Valeur d’une visite = moyenne de ses fiches (conforme 100, non conforme 0, partiel 50). % conforme = moyenne des visites. Conforme / non conforme / partiel = visites à 100, à 0, ou entre les deux.',
      limits: ['Les visites où la question n’a pas été posée ne comptent pas.', nNote(q.n, 'visites') || null]
    });
  }

  // ---------------------------------------------------------------- VUE D'ENSEMBLE
  function ovScoreTile(perAct, ok) {
    const box = el('div', { class: 'kpi ov-tile ov-wtile' }, [el('div', { class: 'kh' }, [el('div', { class: 'l', text: 'Score par activité' }), infoBtn('Score de conformité sur 100 : moyenne des visites. Référence ' + THR.good + ', seuil interne à valider. Toutes activités confondues : ' + fmt(mean(ok.map(v => v.score)), 1) + ', non comparable car les questionnaires diffèrent. Survolez une activité pour la médiane et le nombre de visites, cliquez pour le détail.')])]);
    const list = el('div', { class: 'ov-rows' });
    perAct.forEach(p => {
      const s = nStatus(p.st.n), k = s === 'ok' ? cls(p.st.mean) : 'na';
      const r = el('div', { class: 'ov-row ov-row3' }, [el('span', { class: 'ov-rl', text: ACT[p.a].short }), el('span', { class: 'ov-rv ' + k, text: fmt(p.st.mean, 1) }), el('span', { class: 'ov-rk bg-' + k, text: s === 'ok' ? ({ good: 'Bon', mid: 'À améliorer', bad: 'Insuffisant' })[k] : s === 'low' ? 'Indicatif' : 'Non calculé' })]);
      bindTip(r, () => ACT[p.a].short + ' : médiane ' + fmt(p.st.med, 1) + ', ' + fmt(p.st.n) + ' visites, dont ' + fmt(p.st.good) + ' à ' + THR.good + ' ou plus' + (s !== 'ok' ? '\n' + nNote(p.st.n, 'visites') : ''));
      ovClickable(r, () => ovScoreDrawer(p.a, p.x), 'Score ' + ACT[p.a].short); list.appendChild(r);
    });
    box.appendChild(list);
    return box;
  }
  function ovTierTile(ok, T) {
    const box = el('div', { class: 'kpi ov-tile ov-wtile' + (T.t1 ? ' k-bad' : '') }, [el('div', { class: 'kh' }, [el('div', { class: 'l', text: 'Alertes' }), infoBtn('Visites avec au moins une alerte de chaque niveau, sur ' + fmt(T.N) + ' visites. Au moins une alerte, tous niveaux : ' + nOf(T.any, T.N, 'visites') + '. ' + ovALERT_TIERS.levels.map(l => l.short + ' : ' + l.what).join('. ') + '. ' + ovALERT_TIERS.source + '.')])]);
    const list = el('div', { class: 'ov-rows' });
    [[1, T.t1], [2, T.t2], [3, T.t3], ['c', T.c]].forEach(([t, n]) => list.appendChild(el('div', { class: 'ov-row ov-row3' }, [ovChip(t), el('span', { class: 'ov-rv ' + (t === 1 && n ? 'bad' : ''), text: fmt(n) }), el('span', { class: 'ov-rs', text: pct(T.N ? n / T.N * 100 : null, 1) })])));
    box.appendChild(list);
    return ovClickable(box, () => ovTiersDrawer(ok), 'Alertes par niveau');
  }
  function ovCaseKey(v, code) { return v.act + '|' + (OV_CODE[v.i] || 'NA') + '|' + (v.date || 'NA') + '|' + code; }
  const ovCaseStore = () => (D.cases && typeof D.cases === 'object') ? D.cases : {};
  function ovCaseList(ok) { const out = []; ok.forEach(v => { const T = ovVT(v); [1, 2].forEach(t => T[t].forEach(r => out.push({ v, code: RISK[r].code, ri: r, tier: t, key: ovCaseKey(v, RISK[r].code) }))); }); return out; }
  const ovAge = d => d ? Math.max(0, Math.round((Date.parse(OV_NOW) - Date.parse(d)) / 864e5)) : null;
  function ovCasesTile(ok) {
    const L = ovCaseList(ok), S = ovCaseStore(), open1 = L.filter(c => c.tier === 1 && !(S[c.key] && S[c.key].s >= 1)), old = open1.filter(c => ovAge(c.v.date) > OV_OLD_DAYS).length;
    return ovTile({ l: 'Cas à suivre', v: fmt(open1.length), c: open1.length ? 'bad' : null, s: 'alertes graves non transmises', i: 'Dont ' + fmt(old) + ' relevées il y a plus de ' + OV_OLD_DAYS + ' jours. ' + fmt(L.length) + ' cas en tout : ' + fmt(L.filter(c => c.tier === 1).length) + ' graves et ' + fmt(L.filter(c => c.tier === 2).length) + ' à vérifier. Un cas = une visite et une alerte grave ou à vérifier ; son statut se suit dans le registre.', open: () => ovCasesDrawer() });
  }
  const OV_CF = { tier: 'all', st: 'all' };
  function ovSetCase(key, patch) {
    requireAdmin(() => {
      if (!D.cases || typeof D.cases !== 'object') D.cases = {};
      const o = Object.assign({ s: 0, c: '' }, D.cases[key] || {}, patch);
      o.s = Math.max(0, Math.min(OV_CASE_ST.length - 1, Math.round(+o.s) || 0)); o.c = String(o.c || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 500);
      o.at = localDay(); o.by = String(SESSION.by || '—').slice(0, 80);
      if (!o.s && !o.c) delete D.cases[key]; else D.cases[key] = { s: o.s, c: o.c, at: o.at, by: o.by };
      if (CUR !== D) CUR.cases = D.cases;
      SESSION.dirty = true; ovCasesDrawer();
    });
  }
  function ovCasesDrawer() {
    const ok = fv(v => v.valid), all = ovCaseList(ok), S = ovCaseStore();
    const L = all.filter(c => (OV_CF.tier === 'all' || String(c.tier) === OV_CF.tier) && (OV_CF.st === 'all' || String((S[c.key] || {}).s || 0) === OV_CF.st)).sort((p, q) => (p.tier - q.tier) || String(p.v.date).localeCompare(String(q.v.date)));
    const sel = (lab, key, opts) => { const s = el('select', { 'aria-label': lab }); opts.forEach(([v, t]) => { const o = el('option', { value: v, text: t }); if (OV_CF[key] === v) o.selected = true; s.appendChild(o); }); s.addEventListener('change', () => { OV_CF[key] = s.value; ovCasesDrawer(); }); return el('label', { class: 'ov-fl' }, [lab + ' ', s]); };
    const stCell = c => {
      const o = S[c.key] || { s: 0, c: '' };
      if (!SESSION.admin) return el('div', null, [el('span', { class: 'ov-st ov-st' + (o.s || 0), text: OV_CASE_ST[o.s || 0] }), o.c ? el('div', { class: 'muted', text: o.c }) : null, o.at ? el('div', { class: 'muted', text: 'le ' + dFrUI(o.at) + ' · ' + (o.by || '—') }) : null]);
      const s = el('select', { 'aria-label': 'Statut du cas' }); OV_CASE_ST.forEach((t, i) => { const op = el('option', { value: String(i), text: t }); if ((o.s || 0) === i) op.selected = true; s.appendChild(op); });
      s.addEventListener('change', () => ovSetCase(c.key, { s: +s.value }));
      const cm = el('input', { type: 'text', placeholder: 'Commentaire court (canal, référence)', 'aria-label': 'Commentaire du cas' }); cm.value = o.c || ''; cm.maxLength = 500;
      cm.addEventListener('change', () => ovSetCase(c.key, { c: cm.value }));
      return el('div', { class: 'ov-stedit' }, [s, cm, o.at ? el('div', { class: 'muted', text: 'mis à jour le ' + dFrUI(o.at) + ' · ' + (o.by || '—') }) : null]);
    };
    const tb = table([
      { k: 'd', t: 'Relevé le', fmt: c => dFrUI(c.v.date), sortVal: c => c.v.date }, { k: 'age', t: 'Âge (j)', num: 1, fmt: c => fmt(ovAge(c.v.date)), sortVal: c => ovAge(c.v.date) },
      { k: 'site', t: 'Activité · site', fmt: c => el('div', null, [el('div', { class: 'ov-b', text: ACT[c.v.act].short + ' · ' + (DICT.site[c.v.site] || '–') }), el('div', { class: 'muted', text: (DICT.district[c.v.district] || '–') + ' · TPM ' + (DICT.org[c.v.org] || '–') + (DICT.imp[c.v.imp] ? ' · MEO ' + DICT.imp[c.v.imp] : '') })]) },
      { k: 'al', t: 'Alerte', fmt: c => el('div', null, [ovChip(c.tier), ' ' + ovRiskLabel(c.v.act, c.code, c.ri)]), sortVal: c => c.tier },
      { k: 'st', t: 'Statut', fmt: stCell, sortVal: c => (S[c.key] || {}).s || 0 }
    ], L.slice(0, 300), {});
    const n1 = all.filter(c => c.tier === 1), tr = n1.filter(c => S[c.key] && S[c.key].s >= 1).length;
    ovDrawer('Registre des cas', 'Une ligne par visite et par alerte grave ou à vérifier. La clé (activité, site, jour, alerte) reste la même après une mise à jour des données.', {
      value: [['Cas dans les filtres', fmt(all.length) + ' : ' + fmt(n1.length) + ' graves, ' + fmt(all.length - n1.length) + ' à vérifier'], ['Cas graves transmis ou plus avancés', nOf(tr, n1.length, 'cas graves')], ['Cas graves de plus de ' + OV_OLD_DAYS + ' jours sans transmission', fmt(n1.filter(c => !(S[c.key] && S[c.key].s >= 1) && ovAge(c.v.date) > OV_OLD_DAYS).length)]],
      ref: [['Statuts', OV_CASE_ST.join(' · ')], ['Niveaux', ovALERT_TIERS.source]],
      extra: [xsec('Cas (' + fmt(L.length) + ')', [el('div', { class: 'ov-exp' }, [sel('Niveau', 'tier', [['all', 'Tous'], ['1', 'Graves'], ['2', 'À vérifier']]), sel('Statut', 'st', [['all', 'Tous']].concat(OV_CASE_ST.map((t, i) => [String(i), t])))]),
        SESSION.admin ? null : el('div', { class: 'ov-exp' }, [el('span', { class: 'muted', text: 'Lecture seule : le statut se modifie en mode administrateur.' }), ovBtn('Modifier les statuts (mot de passe)', () => requireAdmin(ovCasesDrawer))]),
        ovExportBtns('registre_des_cas', L.map(c => [c.v, c.code])), L.length > 300 ? el('p', { class: 'muted', text: '300 premiers cas affichés ; l’export contient tout.' }) : null, tb,
        limitBox('Ne saisissez ni nom, ni donnée personnelle, ni description d’une allégation d’exploitation ou d’abus sexuels : indiquez seulement le canal (mécanisme confidentiel) et la date de transmission. Commentaire limité à 500 caractères.', 'warn'),
        el('p', { class: 'muted', text: 'Les statuts sont enregistrés dans le fichier du tableau de bord (téléchargez le fichier mis à jour dans « Données & mises à jour ») ; une nouvelle extraction ne les efface pas.' })])],
      formula: 'Cas = une visite exploitable et une alerte grave ou à vérifier. Âge = jours entre la date de la visite et aujourd’hui (' + dFrUI(OV_NOW) + ').',
      limits: ['Les signaux à confirmer et les problèmes de gestion ne créent pas de cas.', 'Le statut dépend de la saisie : un cas sans statut n’est pas forcément non traité.']
    });
  }
  function ovVisitsDrawer(ok, all, bad) { const FI = ovFiches(ok), EX = ovExclusions(bad); return ovDrawer('Visites exploitables', 'Unité : la visite (fiches d’une même activité, même site, même jour)', { value: [['Visites exploitables', nOf(ok.length, all.length, 'visites dans les filtres')], ['Fiches des visites exploitables', fmt(FI.all) + ' dont ' + fmt(FI.valid) + ' exploitables'], ['Visites écartées', fmt(bad.length)], ['Motifs', ovExclText(EX)]],
          ref: 'Fenêtre de validité des dates : ' + winLabel() + '.', formula: 'Visite exploitable = au moins une fiche exploitable (non vide, datée dans la fenêtre de validité, hors test). Une visite regroupe les fiches de la même activité, du même site et du même jour (ex. SMP : direction + cuisiniers + observation).', limits: ['Une visite sans date passe tous les filtres de période.', 'Les fiches de l’ancienne version d’un formulaire (en-tête seul) sont écartées : ce n’est pas une défaillance du terrain.'] }); }
  function ovSitesDrawer(ok) { const Sx = ovSites(ok); return ovDrawer('Sites suivis', 'Unité : le site (code du plan)', { value: [['Sites identifiés par code', fmt(Sx.ident)], ['dont inscrits au plan actif', nOf(Sx.inPlan, Sx.ident, 'sites')], ['Sites saisis hors liste (comptés par nom)', fmt(Sx.off)], ['Visites sans site identifié', fmt(Sx.noneVisits)]],
          formula: 'Site = couple activité × code du site (Code POI) ayant au moins une visite exploitable dans les filtres. Un site saisi « Autre » (code 999) est compté à part, par son nom.', limits: ['La couverture du plan compte autre chose : les sites ACTIFS du plan de l’année ' + planYearUI() + ' vus au moins une fois dans l’année (et la période).', 'Un même lieu suivi par deux activités compte deux sites.'] }); }
  function ovAgentsDrawer(ok) { const AG = ovAgents(ok); return ovDrawer('Agents identifiés', 'Unité : l’agent (nom harmonisé)', { value: [['Agents identifiés', fmt(AG.n)], ['Visites sans nom d’agent', fmt(AG.noName)]], formula: 'Noms distincts après rapprochement automatique des graphies (similarité des noms), sur les visites exploitables des filtres. « (Non renseigné) » n’est pas compté comme un agent.', limits: ['Le chiffre dépend du rapprochement automatique des noms saisis.', 'L’onglet Agents évalue tous les agents ayant au moins une fiche (toute la période) : son total peut différer.'] }); }
  function ovRenderOverview(main) {
    const all = fv(), ok = all.filter(v => v.valid), bad = all.filter(v => !v.valid);
    const covF = ovCovCtx(ok), cov = covF(F.act, F.region), Sx = ovSites(ok), AG = ovAgents(ok), FI = ovFiches(ok), EX = ovExclusions(bad), T = ovTierCounts(ok);
    const acts = F.act === 'ALL' ? ACTS : [F.act];
    const perAct = acts.map(a => { const x = ok.filter(v => v.act === a); return { a, x, n: x.length, st: ovScoreStats(x), cp: covF(a, F.region), T: ovTierCounts(x) }; }).filter(p => p.n);
    main.appendChild(el('div', { class: 'kpis' }, [
      ovTile({ l: 'Visites', v: fmt(ok.length), s: 'sur ' + fmt(all.length), i: 'Visites exploitables : ' + fmt(FI.valid) + ' fiches. Écartées : ' + fmt(bad.length) + (bad.length ? ' (' + ovExclText(EX) + ')' : '') + '. Une visite regroupe les fiches d’une même activité, d’un même site et d’un même jour.', open: () => ovVisitsDrawer(ok, all, bad) }),
      ovTile({ l: 'Sites suivis', v: fmt(Sx.ident), s: 'dont ' + fmt(Sx.inPlan) + ' au plan', i: 'Sites comptés par leur code. À part : ' + fmt(Sx.off) + ' sites saisis hors liste et ' + fmt(Sx.noneVisits) + ' visites sans site.', open: () => ovSitesDrawer(ok) }),
      ovTile({ l: 'Couverture du plan', v: cov.planned && !cov.outOfYear ? pct(cov.visited / cov.planned * 100, 1) : 'n.c.', s: cov.planned ? fmt(cov.visited) + '/' + fmt(cov.planned) + ' sites' : null, i: (typeof covDefinition === 'function' ? covDefinition() + ' ' : '') + 'Pas de cible définie, donc pas de couleur.', open: () => ovCovDrawer(perAct, cov) }),
      ovTile({ l: 'Agents', v: fmt(AG.n), s: AG.noName ? '+ ' + fmt(AG.noName) + ' visite sans nom' : null, i: 'Noms d’agents harmonisés ayant au moins une visite exploitable.', open: () => ovAgentsDrawer(ok) })
    ]));
    main.appendChild(el('div', { class: 'ov-tiles' }, [ovScoreTile(perAct, ok), ovTierTile(ok, T), ovCasesTile(ok)]));
    const months = MONTHS.filter(m => m >= F.m0 && m <= F.m1), pm = ovPartialMonthNote(months);
    const rows = months.map(m => { const vals = {}; ok.filter(v => v.month === m).forEach(v => { vals[v.act] = (vals[v.act] || 0) + 1; }); return { month: m, values: vals, line: null }; });
    main.appendChild(ovCard('Visites par mois', 'Visites exploitables par mois et par activité.' + (pm ? ' ' + pm : ''), [stackedMonthly(rows, acts, acts.map(a => ACT_COLOR[a]), acts.map(a => ACT[a].short), { aria: 'Visites par mois' }), legend(acts.map(a => [ACT_COLOR[a], ACT[a].short]))]));
    main.appendChild(ovCard('Score par mois', 'Score moyen sur 100 par activité. Pointillé : référence ' + THR.good + '. Point creux : moins de ' + SMALL_N.low + ' visites dans le mois ; sous ' + SMALL_N.min + ' visites, le mois n’est pas tracé.', [ovLineChart(ovScoreSeries(ok, acts, months), months), legend(acts.map(a => [ACT_COLOR[a], ACT[a].short]))]));
    const st = ovScoreStats(ok);
    const bins = [['< 50', -1, 50, 'bad'], ['50 – ' + THR.mid, 50, THR.mid, 'bad'], [THR.mid + ' – ' + THR.good, THR.mid, THR.good, 'mid'], [THR.good + ' – 90', THR.good, 90, 'good'], ['90 – 99', 90, 99.95, 'good'], ['100', 99.95, 1000, 'good']].map(([l, lo, hi, k]) => ({ label: l, n: ok.filter(v => ovNum(v.score) && v.score >= lo && v.score < hi).length, k }));
    main.appendChild(ovCard('Répartition des scores', fmt(st.n) + ' visites notées, médiane ' + fmt(st.med, 1) + '. Les ' + fmt(st.perfect) + ' visites à 100 sont à vérifier. Seuils internes ' + THR.mid + ' et ' + THR.good + ', activités mélangées.', [ovClickable(el('div', null, [histo(bins, 'visites')]), () => ovScoreDrawer(null, ok), 'Répartition des scores')]));
    const nq = a => Object.keys(D.riskQ).filter(k => k.split('|')[0] === a).length;
    main.appendChild(ovCard('Alertes par activité', 'Nombre de visites avec au moins une alerte de chaque niveau (survolez pour le pourcentage). Le taux « au moins une alerte » dépend du nombre de questions d’alerte de chaque formulaire : ne comparez pas les activités sur ce taux. ' + ovALERT_TIERS.source + '.', [table([
      { k: 'a', t: 'Activité', fmt: p => { const s = el('span', { text: ACT[p.a].short }); bindTip(s, () => nq(p.a) + ' questions d’alerte dans le formulaire'); return s; } }, { k: 'n', t: 'Visites', num: 1, fmt: p => fmt(p.n) },
      { k: 't1', t: 'Graves', num: 1, fmt: p => ovNCell(p.T.t1, p.n, p.T.t1 ? 'bad' : 'good'), sortVal: p => p.T.t1 }, { k: 't2', t: 'À vérifier', num: 1, fmt: p => ovNCell(p.T.t2, p.n), sortVal: p => p.T.t2 },
      { k: 't3', t: 'Gestion', num: 1, fmt: p => ovNCell(p.T.t3, p.n), sortVal: p => p.T.t3 }, { k: 'c', t: 'À confirmer', num: 1, fmt: p => ovNCell(p.T.c, p.n), sortVal: p => p.T.c },
      { k: 'any', t: 'Au moins une', num: 1, fmt: p => { const s = el('span', { class: 'ov-plain', text: pct(p.T.any / p.n * 100, 0) }); bindTip(s, () => nOf(p.T.any, p.n, 'visites')); return s; }, sortVal: p => p.T.any / p.n }], perAct, { onRow: p => ovTiersDrawer(ok, p.a) })], 'wide'));
    const ar = ovAlertRows(ok).filter(r => r.n).sort(ovAlertSort), AT = ovAlertTableNodes(ar, ok, false);
    main.appendChild(ovCard('Alertes', AT.info, AT.nodes, 'wide'));
    const covOk = perAct.filter(p => coverageComputable(p.a, p.cp) && !p.cp.outOfYear), covNo = perAct.filter(p => !coverageComputable(p.a, p.cp));
    main.appendChild(ovCard('Couverture par activité', (typeof covDefinition === 'function' ? covDefinition() + ' ' : '') + ovCovNotes().join(' '), [ovBars(covOk.map(p => ({ label: ACT[p.a].short, value: p.cp.planned ? p.cp.visited / p.cp.planned * 100 : 0, ntxt: fmt(p.cp.visited) + '/' + fmt(p.cp.planned), tip: ACT[p.a].short + ' : ' + ovCovTxt(p.cp) })), { max: 100 }),
      covNo.length ? el('p', { class: 'ov-warn1', text: covNo.map(p => ACT[p.a].short + ' : plan à compléter (' + fmt(p.cp.planned) + (p.cp.planned > 1 ? ' sites' : ' site') + ' au plan pour ' + fmt(sitesFollowed(p.a)) + ' suivis)').join(' ; ') }) : null]));
    main.appendChild(ovRegionCard(ok, covF));
    main.appendChild(ovCard('Constats', 'Calculés sur les visites des filtres choisis ; ils changent avec les données.', [el('ul', { class: 'find' }, ovMessages(ok).map(([, t]) => el('li', { text: t }))),
      el('details', { class: 'ov-det' }, [el('summary', { text: 'Sur toute la période' }), el('ul', { class: 'find' }, (D.findings || []).map(f => el('li', { text: f })))])]));
    main.appendChild(ovCard('Par activité', 'Mêmes définitions que les tuiles. Survolez une valeur pour le détail, cliquez une ligne pour le score.', [table([
      { k: 'a', t: 'Activité', fmt: p => ACT[p.a].short }, { k: 'n', t: 'Visites', num: 1, fmt: p => { const s = el('span', { class: 'ov-plain', text: fmt(p.n) }); bindTip(s, () => fmt(ovFiches(p.x).valid) + ' fiches exploitables'); return s; }, sortVal: p => p.n },
      { k: 's', t: 'Sites', num: 1, fmt: p => fmt(ovSites(p.x).ident), sortVal: p => ovSites(p.x).ident }, { k: 'ag', t: 'Agents', num: 1, fmt: p => fmt(ovAgents(p.x).n) },
      { k: 'sc', t: 'Score', num: 1, fmt: p => ovSmallCell(p.st.mean, p.st.n, ACT[p.a].short + ', médiane ' + fmt(p.st.med, 1)), sortVal: p => p.st.mean },
      { k: 'any', t: 'Avec alerte', num: 1, fmt: p => ovFrac(p.T.any, p.n), sortVal: p => p.T.any / p.n }, { k: 't1', t: 'Graves', num: 1, fmt: p => ovFrac(p.T.t1, p.n), sortVal: p => p.T.t1 / p.n },
      { k: 'c', t: 'Couverture', num: 1, fmt: p => coverageComputable(p.a, p.cp) ? ovFrac(p.cp.visited, p.cp.planned, 'sites actifs') : 'n.c.', sortVal: p => p.cp.planned ? p.cp.visited / p.cp.planned : null },
      { k: 'd', t: 'Dernière visite', fmt: p => { const ds = p.x.map(v => v.date).filter(Boolean).sort(); const s = el('span', { text: ds.length ? dFrUI(ds[ds.length - 1]) : '–' }); bindTip(s, () => ds.length ? 'Du ' + dFrUI(ds[0]) + ' au ' + dFrUI(ds[ds.length - 1]) : ''); return s; } }], perAct, { onRow: p => ovScoreDrawer(p.a, p.x) })], 'wide'));
    main.appendChild(ovPrioCard(ok, 20, 'Visites prioritaires'));
  }
  function ovCovDrawer(perAct, cov) {
    return ovDrawer('Couverture du plan de suivi ' + planYearUI(), 'Sites actifs du plan vus au moins une fois', { value: [['Sites actifs vus', ovCovTxt(cov)]].concat(perAct.map(p => [ACT[p.a].short, coverageComputable(p.a, p.cp) ? ovCovTxt(p.cp) : 'non calculable : le plan liste ' + fmt(p.cp.planned) + ' site(s) actif(s) pour ' + fmt(sitesFollowed(p.a)) + ' site(s) suivis'])),
      ref: 'Aucune cible de couverture n’est définie dans les données : la valeur n’est pas colorée.', formula: typeof covDefinition === 'function' ? covDefinition() : 'Sites actifs du plan vus au moins une fois ÷ sites actifs du plan.', limits: ovCovNotes().concat(['Une seule visite dans la période suffit : la couverture ne dit pas si la fréquence du suivi basé sur le risque est respectée (voir l’onglet Planification).', 'Les visites saisies sur un site « Autre » (999) ne peuvent pas être rapprochées du plan.']) });
  }
  function ovAlertTableNodes(rows, ok, oneAct) {
    const zero = (oneAct ? ovAlertRows(ok, oneAct) : ovAlertRows(ok)).filter(r => !r.n);
    const word = r => r.trend.k === 'up' ? 'en hausse' : r.trend.k === 'down' ? 'en baisse' : r.trend.t === 'stable' ? 'stable' : '–';
    const cols = [oneAct ? null : { k: 'act', t: 'Activité', fmt: r => ACT[r.act].short, sortVal: r => r.act },
      { k: 'label', t: 'Alerte', fmt: r => { const s = el('span', { text: r.label + (r.tier === 'c' ? ' *' : '') }); bindTip(s, () => 'Question : « ' + (r.q ? r.q.q : r.code) + ' »\nRéponse comptée : ' + (r.q ? r.q.ans : 'Oui')); return s; }, sortVal: r => r.label },
      { k: 'tier', t: 'Niveau', fmt: r => ovChip(r.tier), sortVal: r => ovTierRank(r.tier) },
      { k: 'n', t: 'Visites', num: 1, fmt: r => ovAlertCell(r), sortVal: r => r.n },
      { k: 'pa', t: '% où posée', title: 'Part des visites où la question a été posée', num: 1, fmt: r => { if (r.asked === null) return '–'; const s = el('span', { class: 'ov-plain', text: pct(r.pa, 0) }); bindTip(s, () => nOf(r.n, r.asked, 'visites où la question a été posée')); return s; }, sortVal: r => r.pa },
      { k: 'tr', t: 'Tendance', fmt: r => { const s = el('span', { class: 'ov-tr ov-tr-' + r.trend.k, text: word(r) }); bindTip(s, () => r.trend.t + '\n' + r.trend.d); return s; }, sortVal: r => r.trend.t }].filter(Boolean);
    const pairs = []; rows.forEach(r => r.hit.forEach(v => pairs.push([v, r.code])));
    const info = 'Visites concernées sur les visites de l’activité, et part là où la question a été posée. Tendance : 3 derniers mois de la période contre les 3 précédents. Grave en rouge dès un cas, à vérifier en orange.' + (zero.length ? ' Sans alerte dans la sélection : ' + zero.map(r => (oneAct ? '' : ACT[r.act].short + ', ') + ovLow(r.label)).join(' ; ') + '.' : '');
    return { info, nodes: [ovExportBtns('cas_a_suivre', pairs, fmt(rows.length) + ' alertes relevées'), table(cols, rows, { onRow: r => ovAlertDrawer(r) }),
      rows.some(r => r.tier === 'c') ? el('p', { class: 'ov-warn1', text: '* Question non traduite dans le formulaire : à faire traduire, signal à confirmer.' }) : null] };
  }
  function ovRegionCard(ok, covF) {
    const ids = Array.from(new Set(ok.map(v => v.region)));
    const rows = ids.map(r => {
      const x = ok.filter(v => v.region === r), named = !!DICT.region[r], st = ovScoreStats(x), T = ovTierCounts(x);
      const mix = ACTS.map(a => [a, x.filter(v => v.act === a).length]).filter(z => z[1]).sort((p, q) => q[1] - p[1]);
      const top = ovAlertRows(x).filter(z => z.n && z.tier !== 'c').sort((p, q) => q.n - p.n)[0];
      return { reg: named ? DICT.region[r] : 'Non renseignée', named, n: x.length, x, st, T, mix, cp: named ? covF(F.act, r) : null, top };
    }).sort((p, q) => q.n - p.n);
    const mixed = F.act === 'ALL';
    return ovCard('Par région', (mixed ? 'Toutes activités : le score mélange des questionnaires différents et la composition change d’une région à l’autre, il n’est donc pas coloré. Choisissez une activité pour comparer. ' : '') + 'Moins de ' + SMALL_N.min + ' visites : non calculé ; de ' + SMALL_N.min + ' à ' + (SMALL_N.low - 1) + ' : indicatif. Alerte la plus fréquente : alerte relevée dans le plus de visites, signaux à confirmer exclus.', [table([
      { k: 'reg', t: 'Région' }, { k: 'n', t: 'Visites', num: 1, fmt: r => { const s = el('span', { class: 'ov-plain', text: fmt(r.n) }); bindTip(s, () => r.mix.map(z => ACT[z[0]].short + ' ' + fmt(z[1])).join(', ')); return s; }, sortVal: r => r.n },
      { k: 's', t: 'Score', num: 1, fmt: r => mixed ? el('span', { class: 'ov-plain' + (nStatus(r.st.n) === 'low' ? ' ov-dim' : ''), text: nStatus(r.st.n) === 'na' ? '–' : fmt(r.st.mean, 1) }) : ovSmallCell(r.st.mean, r.st.n, r.reg), sortVal: r => r.st.mean },
      { k: 'any', t: 'Avec alerte', num: 1, fmt: r => nStatus(r.n) === 'na' ? '–' : ovFrac(r.T.any, r.n), sortVal: r => r.T.any / r.n },
      { k: 't1', t: 'Graves', num: 1, fmt: r => ovNCell(r.T.t1, r.n), sortVal: r => r.T.t1 },
      { k: 'cov', t: 'Couverture', num: 1, fmt: r => r.cp && r.cp.planned ? ovFrac(r.cp.visited, r.cp.planned, 'sites actifs') : '–', sortVal: r => r.cp && r.cp.planned ? r.cp.visited / r.cp.planned : null },
      { k: 'top', t: 'Alerte la plus fréquente', fmt: r => { if (!r.top) return '—'; const s = el('span', { text: (mixed ? ACT[r.top.act].short + ', ' : '') + ovLow(r.top.label) }); bindTip(s, () => fmt(r.top.n) + ' visites sur ' + fmt(r.top.N) + ' visites ' + ACT[r.top.act].short + ' de la région'); return s; } }
    ], rows, { onRow: r => ovTiersDrawer(r.x) })], 'wide');
  }
  // ---------------------------------------------------------------- ACTIVITÉS
  function ovRenderActivity(main) {
    const pills = el('div', { class: 'pills' });
    ACTS.forEach(a => { const b = el('button', { class: 'btn' + (ACT_SEL === a ? ' on' : ''), type: 'button', text: ACT[a].label }); b.addEventListener('click', () => { ACT_SEL = a; if (F.act !== 'ALL') { F.act = a; buildFilters(); } render(); }); pills.appendChild(b); });
    main.appendChild(pills);
    const a = ACT_SEL;
    const inF = v => (F.fo < 0 || v.fo === F.fo) && (F.region < 0 || v.region === F.region) && (F.district < 0 || v.district === F.district) && (F.org < 0 || v.org === F.org) && (F.imp < 0 || v.imp === F.imp) && (!v.date || (v.month >= F.m0 && v.month <= F.m1));
    const all = V.filter(v => v.act === a && inF(v)), ok = all.filter(v => v.valid), bad = all.filter(v => !v.valid), okAll = V.filter(v => v.valid && inF(v));
    const covF = ovCovCtx(okAll), cp = covF(a, F.region), st = ovScoreStats(ok), T = ovTierCounts(ok), Sx = ovSites(ok), AG = ovAgents(ok), FI = ovFiches(ok), it = D.items[a];
    const computable = coverageComputable(a, cp);
    main.appendChild(el('div', { class: 'kpis' }, [
      ovTile({ l: 'Visites', v: fmt(ok.length), s: fmt(FI.valid) + ' fiches', i: 'Visites exploitables de l’activité. Écartées : ' + fmt(bad.length) + (bad.length ? ' (' + ovExclText(ovExclusions(bad)) + ')' : '') + '.', open: () => ovVisitsDrawer(ok, all, bad) }),
      ovTile({ l: 'Sites suivis', v: fmt(Sx.ident), s: 'dont ' + fmt(Sx.inPlan) + ' au plan', i: 'Sites comptés par leur code. À part : ' + fmt(Sx.off) + ' saisis hors liste, ' + fmt(Sx.noneVisits) + ' visites sans site.', open: () => ovSitesDrawer(ok) }),
      ovTile({ l: 'Couverture du plan', v: computable && !cp.outOfYear ? pct(cp.visited / cp.planned * 100, 1) : 'n.c.', s: computable ? fmt(cp.visited) + '/' + fmt(cp.planned) + ' sites' : 'plan à compléter', i: computable ? (typeof covDefinition === 'function' ? covDefinition() : '') : 'Le plan liste ' + fmt(cp.planned) + ' site(s) actif(s) alors que ' + fmt(sitesFollowed(a)) + ' ont été suivis : couverture non calculable.', open: () => ovDrawer('Couverture du plan ' + planYearUI() + ', ' + ACT[a].short, null, { value: [['Sites actifs vus', ovCovTxt(cp)]], formula: typeof covDefinition === 'function' ? covDefinition() : '', limits: ovCovNotes() }) }),
      ovTile({ l: 'Score', v: st.n ? fmt(st.mean, 1) : '–', c: nStatus(st.n) === 'ok' ? cls(st.mean) : null, s: 'médiane ' + fmt(st.med, 1), i: 'Score de conformité sur 100. ' + fmt(st.good) + ' visites sur ' + fmt(st.n) + ' atteignent ' + THR.good + ' (référence interne). ' + fmt(st.qmed) + ' questions répondues par visite en médiane, sur ' + fmt(it.meta.length) + '.', open: () => ovScoreDrawer(a, ok) }),
      ovTile({ l: 'Alertes graves', v: fmt(T.t1), c: T.t1 ? 'bad' : null, s: 'sur ' + fmt(T.N) + ' visites', i: 'À vérifier : ' + nOf(T.t2, T.N, 'visites') + '. Gestion : ' + fmt(T.t3) + '.' + (T.c ? ' À confirmer : ' + fmt(T.c) + '.' : '') + ' Au moins une alerte : ' + nOf(T.any, T.N, 'visites') + '.', open: () => ovTiersDrawer(ok, a) }),
      ovTile({ l: 'Agents', v: fmt(AG.n), s: AG.noName ? '+ ' + fmt(AG.noName) + ' visite sans nom' : null, i: 'Noms d’agents harmonisés ayant au moins une visite exploitable.', open: () => ovAgentsDrawer(ok) })
    ].concat(ovSpecTiles(a, ok))));
    const wh = ovWhyHow(a, ok), skipped = ovDomRows(a, ok).filter(r => !ovDomRanked(r));
    main.appendChild(ovCard('Pourquoi et que faire', 'Les trois domaines les plus faibles (au moins ' + SMALL_N.low + ' visites et ' + pct(OV_DOM_SHARE * 100, 0) + ' des visites de l’activité) et les alertes les plus graves puis les plus fréquentes.' + (skipped.length ? ' Non classés, trop peu renseignés : ' + skipped.map(r => r.d + ' (' + fmt(r.n) + ' visites)').join(', ') + '.' : ''),
      [el('div', { class: 'wh ov-wh' }, [el('div', { class: 'wh-c' }, [el('h3', { text: 'Pourquoi' }), el('ul', null, wh.why.map(([, t]) => el('li', { text: t })))]), el('div', { class: 'wh-c' }, [el('h3', { text: 'Que faire' }), el('ul', null, wh.how.map(([, t]) => el('li', { text: t })))])])]));
    const cc = causesCard(a, ok); if (cc) main.appendChild(cc);
    const dr = ovDomRows(a, ok);
    main.appendChild(ovCard('Score par domaine', 'Part des normes respectées dans chaque domaine, en moyenne sur les visites où il est renseigné. Couleur à partir de ' + SMALL_N.low + ' visites. Cliquez un domaine pour ses questions.', [ovBars(dr.map(r => { const s = nStatus(r.n); return { label: r.d, value: s === 'na' ? 0 : r.v, vtxt: s === 'na' ? '–' : fmt(r.v, 1), ntxt: fmt(r.n) + ' v.', tip: r.d + ' : ' + nOf(r.n, r.N, 'visites') + ', ' + fmt(r.nq) + ' question(s)' + (s !== 'ok' ? '\n' + nNote(r.n, 'visites') : ''), cls: s === 'ok' ? cls(r.v) : 'na', dim: s !== 'ok', open: () => ovDomainDrawer(a, r.j, ok) }; }), { max: 100 })]));
    const months = MONTHS.filter(m => m >= F.m0 && m <= F.m1), rows = months.map(m => ({ month: m, values: { n: ok.filter(v => v.month === m).length }, line: null })), pm = ovPartialMonthNote(months);
    main.appendChild(ovCard('Évolution mensuelle', 'Visites par mois, puis score moyen sur 100 (référence ' + THR.good + ').' + (pm ? ' ' + pm : ''), [stackedMonthly(rows, ['n'], [ACT_COLOR[a]], ['Visites'], { h: 170, aria: 'Visites par mois' }), ovLineChart(ovScoreSeries(ok, [a], months), months, { h: 200 })]));
    const AT = ovAlertTableNodes(ovAlertRows(ok, a).sort(ovAlertSort).filter(r => r.n), ok, a);
    main.appendChild(ovCard('Alertes', AT.info, AT.nodes, 'wide'));
    const okSet = new Set(ok.map(v => v.i)), qs = it.meta.map((m, j) => ovItemCounts(a, j, okSet)).filter(q => q.n >= SMALL_N.min);
    const qTip = q => (q.m.neg ? 'Question inversée : « Oui » signale un problème.\n' : '') + q.m.domain + ' · variable ' + q.m.name + '\nConforme ' + fmt(q.c) + ', non conforme ' + fmt(q.nc) + ', partiel ' + fmt(q.part) + ' sur ' + fmt(q.n) + ' visites';
    const weak = qs.filter(q => nStatus(q.n) === 'ok').sort((p, q) => p.p - q.p).slice(0, 15);
    main.appendChild(ovCard('Normes les moins respectées', '% de visites conformes, le partiel compte pour moitié. Seules les normes répondues dans au moins ' + SMALL_N.low + ' visites sont classées. Le signe ↺ marque une question inversée (« Oui » signale un problème).', [ovBars(weak.map(q => ({ label: (q.m.neg ? '↺ ' : '') + q.m.label, value: q.p, ntxt: fmt(q.n) + ' v.', tip: qTip(q), cls: cls(q.p), open: () => ovNormDrawer(a, q, ok) })), { max: 100 })]));
    main.appendChild(ovCard('Toutes les normes', fmt(qs.length) + ' normes. Conforme = 100, non conforme = 0, partiel ou fiches en désaccord entre les deux (compté pour moitié dans le %).', [table([
      { k: 'd', t: 'Domaine', fmt: q => q.m.domain, sortVal: q => q.m.domain }, { k: 'l', t: 'Norme', fmt: q => { const s = el('span', { text: (q.m.neg ? '↺ ' : '') + q.m.label }); bindTip(s, () => qTip(q)); return s; }, sortVal: q => q.m.label },
      { k: 'c', t: 'Conforme', num: 1, fmt: q => fmt(q.c) }, { k: 'nc', t: 'Non conf.', num: 1, fmt: q => fmt(q.nc) }, { k: 'part', t: 'Partiel', num: 1, fmt: q => fmt(q.part) }, { k: 'n', t: 'Visites', num: 1, fmt: q => fmt(q.n) },
      { k: 'p', t: '% conforme', num: 1, fmt: q => ovSmallCell(q.p, q.n, q.m.label), sortVal: q => q.p }], qs, { sortK: 6, dir: 1, onRow: q => ovNormDrawer(a, q, ok) })], 'wide'));
    const ip = ovImpRows(a, ok);
    if (ip.length) main.appendChild(ovCard('Partenaires de mise en œuvre', 'Visites, score et alertes dans les filtres. Note du moteur sur toute la période : score moins un coefficient fois la part de visites avec alerte (pénalité plafonnée, lisez la colonne des alertes). Barème : A dès ' + GRADE_SCALES.imp.A + ', B dès ' + GRADE_SCALES.imp.B + ', C dès ' + GRADE_SCALES.imp.C + '.', [table([
      { k: 'imp', t: 'Partenaire' }, { k: 'n', t: 'Visites', num: 1, fmt: r => fmt(r.n) }, { k: 's', t: 'Score', num: 1, fmt: r => ovSmallCell(r.s, r.n, r.imp), sortVal: r => r.s },
      { k: 'any', t: 'Avec alerte', num: 1, fmt: r => ovFrac(r.T.any, r.n), sortVal: r => r.T.any / r.n }, { k: 't1', t: 'Graves', num: 1, fmt: r => ovNCell(r.T.t1, r.n), sortVal: r => r.T.t1 },
      { k: 'g', t: 'Note', fmt: r => r.eng ? badge(r.eng[7], 'imp') : '–', sortVal: r => r.eng ? r.eng[6] : null }], ip, { sortK: 1, onRow: r => ovImpDrawer(a, r) })], 'wide'));
    const dist = Array.from(new Set(ok.map(v => v.district))).map(d => { const x = ok.filter(v => v.district === d); return { label: DICT.district[d] || 'District non renseigné', x, n: x.length, s: mean(x.map(v => v.score)) }; });
    const ranked = dist.filter(r => nStatus(r.n) === 'ok').sort((p, q) => p.s - q.s).slice(0, 15), lowN = dist.filter(r => nStatus(r.n) !== 'ok');
    main.appendChild(ovCard('Score par district', 'Les 15 districts les plus faibles parmi ceux qui ont au moins ' + SMALL_N.low + ' visites (' + fmt(dist.length - lowN.length) + ' sur ' + fmt(dist.length) + ').' + (lowN.length ? ' Non classés : ' + lowN.map(r => r.label + ' (' + fmt(r.n) + ')').join(', ') + '.' : ''), [ovBars(ranked.map(r => ({ label: r.label, value: r.s, vtxt: fmt(r.s, 1), ntxt: fmt(r.n) + ' v.', cls: cls(r.s), open: () => ovScoreDrawer(a, r.x) })), { max: 100 })]));
    main.appendChild(ovCard('Domaines par région', 'Score moyen de chaque domaine par région ; survolez une case pour le nombre de visites. Grisé sous ' + SMALL_N.low + ' visites, vide sous ' + SMALL_N.min + '.', [ovHeat(a, ok)], 'wide'));
    main.appendChild(ovPrioCard(ok, 15, 'Visites prioritaires'));
    main.appendChild(explorer(a, ok));
  }
  function ovHeat(a, ok) {
    const dn = D.domains[a], regs = Array.from(new Set(ok.map(v => v.region))).filter(r => DICT.region[r]);
    const rows = regs.map(r => { const x = ok.filter(v => v.region === r); return { reg: DICT.region[r], n: x.length, c: dn.map((d, j) => { const y = x.filter(v => ovNum(v.doms[j])); return { n: y.length, v: mean(y.map(v => v.doms[j])) }; }) }; });
    const cols = [{ k: 'reg', t: 'Région' }, { k: 'n', t: 'Visites', num: 1 }].concat(dn.map((d, j) => rows.some(r => r.c[j].n) ? { k: 'd' + j, t: d.length > 16 ? d.slice(0, 15) + '…' : d, title: d, num: 1, sortVal: r => r.c[j].n >= SMALL_N.min ? r.c[j].v : null,
      fmt: r => { const c = r.c[j]; return c.n ? ovSmallCell(c.v, c.n, r.reg + ', ' + d + ' : ' + fmt(c.n) + ' visites') : '–'; } } : null).filter(Boolean));
    return table(cols, rows, { sortK: 1 });
  }
  function ovImpRows(a, ok) {
    const g = new Map(); ok.forEach(v => { const nm = DICT.imp[v.imp]; if (!nm) return; if (!g.has(nm)) g.set(nm, []); g.get(nm).push(v); });
    return Array.from(g.entries()).map(([imp, x]) => ({ imp, x, n: x.length, s: mean(x.map(v => v.score)), T: ovTierCounts(x), eng: D.imps.rows.find(r => r[0] === a && r[1] === imp) || null }));
  }
  function ovImpDrawer(a, r) {
    const e = r.eng, k = e && e[5] ? (e[4] - e[6]) / e[5] : null;
    ovDrawer(r.imp + ' – ' + ACT[a].short, 'Partenaire de mise en œuvre', {
      value: [['Visites (filtres)', fmt(r.n)], ['Score (filtres)', fmt(r.s, 1) + ' / 100'], ['Visites avec alerte (filtres)', nOf(r.T.any, r.n, 'visites')], ['dont alertes graves', nOf(r.T.t1, r.n, 'visites')],
        e ? ['Note du moteur (toute la période)', e[7] + ' — ' + fmt(e[6], 1) + ' = score ' + fmt(e[4], 1) + ' − ' + fmt(k, 2) + ' × ' + pct(e[5], 1) + ' de visites avec alerte (' + fmt(e[2]) + ' visites)'] : null].filter(Boolean),
      ref: [['Barème', gradeTip(e ? e[7] : 'N/N', 'imp').split('\n').pop()]], formula: 'Note = score de conformité moyen − coefficient × % de visites avec au moins une alerte (règle du moteur, toute la période).',
      limits: ['La pénalité d’alerte est plafonnée : avec 100 % de visites en alerte, elle ôte au plus ' + fmt(k === null ? null : k * 100, 0) + ' points — une bonne note reste compatible avec des alertes fréquentes : lisez la colonne des alertes.', 'Les alertes comptent déjà dans le score (questions d’alerte = normes) : elles pèsent deux fois.', 'Certaines alertes (réductions de rations, acteurs armés) ne dépendent pas du partenaire.', nNote(r.n, 'visites') || null]
    });
  }
  // Indicateurs propres à chaque activité : valeur, base, référence, formule, limites
  function ovSpecTiles(a, ok) {
    const X = key => ok.filter(v => ovNum(v.x[key]));
    const pair = (kn, kd) => { const x = ok.filter(v => ovNum(v.x[kn]) && ovNum(v.x[kd])); return { x, num: sum(x.map(v => v.x[kn])), den: sum(x.map(v => v.x[kd])) }; };
    const lastPer = key => { const m = new Map(); X(key).forEach(v => { const sk = ovSiteOf(v).key || ('v' + v.i), p = m.get(sk); if (!p || String(v.date) > String(p.d)) m.set(sk, { d: v.date, y: v.x[key] }); }); return { sum: sum(Array.from(m.values()).map(o => o.y)), sites: m.size, visits: X(key).length, sumAll: sum(X(key).map(v => v.x[key])) }; };
    const T = [];
    const tile = (l, v, s, i, dr) => T.push(ovTile({ l, v, s, i, open: () => ovDrawer(l, ACT[a].label, dr) }));
    if (a === 'SMP' && D.smpMeals) {
      const SM = D.smpMeals;
      tile('Ruptures de repas', pct(SM.p_supply, 1), fmt(SM.supply) + '/' + fmt(SM.n_all) + ' fiches', 'Fiches de direction qui citent une rupture, un retard de livraison ou une catastrophe. Toute la période : les filtres ne s’appliquent pas. Unité : la fiche, pas l’école.', { value: [['Fiches citant rupture, livraison, catastrophe ou retard', nOf(SM.supply, SM.n_all, 'fiches direction')]], extra: [xsec('Raisons déclarées (fiches)', [kvList(SM.reasons.map(r => [r[0], fmt(r[1])]))])], formula: 'Fiches direction avec un nombre de jours de repas lisible (≤ 20) dont la raison citée (liste et précision « Autre ») relève de l’approvisionnement ÷ fiches direction.', limits: ['Unité : la fiche, pas l’école (une école visitée plusieurs fois compte plusieurs fois).', 'Calculé à l’import de l’extraction SMP sur toute la période : les filtres ne s’y appliquent pas.', 'Classement par mots-clés dans un texte libre.'] });
      const md = X('meal_days20').map(v => v.x.meal_days20), full = md.filter(y => y >= 20).length;
      tile('Jours de repas', md.length ? fmt(mean(md), 1) + ' / 20' : '–', 'médiane ' + fmt(median(md), 1), fmt(full) + ' visites sur ' + fmt(md.length) + ' à 20 jours sur 20. Chiffre sous-estimé : ' + fmt(SM.cal_only) + ' fiches sous 20 jours l’expliquent seulement par des jours sans école.', { value: [['Moyenne', fmt(mean(md), 1) + ' jours'], ['Médiane', fmt(median(md), 1) + ' jours'], ['Visites renseignées', nOf(md.length, ok.length, 'visites')], ['Visites à 20 / 20', nOf(full, md.length, 'visites')]], ref: 'Référence : 20 jours de repas sur les 20 derniers jours d’école.', formula: 'Moyenne, sur les visites, du nombre de jours de repas déclaré par la direction (réponses supérieures à 20 retirées).', limits: ['Sous-estimé : ' + nOf(SM.cal_only, SM.n_lt20, 'fiches sous 20 jours') + ' l’expliquent uniquement par des jours sans école (toute la période).', 'Le nombre de réponses supérieures à 20 retirées n’est pas conservé.'] });
      const en = lastPer('enrolled');
      tile('Élèves inscrits', fmt(en.sum), fmt(en.sites) + ' écoles', 'Dernier relevé de chaque école visitée. Additionner toutes les visites donnerait ' + fmt(en.sumAll) + ', en comptant plusieurs fois les écoles revisitées.', { value: [['Élèves (dernier relevé par école)', fmt(en.sum)], ['Écoles', fmt(en.sites)], ['Somme sur toutes les visites (non retenue)', fmt(en.sumAll) + ' sur ' + fmt(en.visits) + ' visites']], formula: 'Somme, sur les écoles, des filles et garçons inscrits au dernier relevé de chaque école.', limits: ['Seules les écoles visitées dans les filtres sont comptées.'] });
    }
    if (a === 'MIARO') {
      [['plan_PBW', 'att_PBW', 'Présence FEFA'], ['plan_Under2', 'att_Under2', 'Présence 6-23 mois']].forEach(([kp, ka, l]) => { const p = pair(ka, kp); tile(l, pct(p.den ? p.num / p.den * 100 : null, 1), fmt(p.num) + '/' + fmt(p.den) + ' prévus', 'Présents sur prévus, sur les ' + fmt(p.x.length) + ' visites où les deux sont renseignés (sur ' + fmt(ok.length) + '). Pas de cible définie.', { value: [['Présents / prévus', fmt(p.num) + ' / ' + fmt(p.den)], ['Visites renseignées (les deux valeurs)', nOf(p.x.length, ok.length, 'visites')]], formula: 'Σ présents ÷ Σ prévus, sur les seules visites où les deux nombres sont renseignés.', limits: ['Aucune cible de présence n’est définie.', nNote(p.x.length, 'visites') || null] }); });
    }
    if (a === 'PECMAM') {
      const deb = lastPer('MODRegBenefDebutnb'), en = X('MODRegEntrnb'), so = X('MODRegSortnb');
      tile('Enfants inscrits', fmt(deb.sum), fmt(deb.sites) + ' sites', 'Inscrits en début de mois, dernier relevé de chaque site. Additionner toutes les visites donnerait ' + fmt(deb.sumAll) + '.', { value: [['Enfants (dernier relevé par site)', fmt(deb.sum)], ['Sites', fmt(deb.sites)], ['Somme sur toutes les visites (non retenue)', fmt(deb.sumAll) + ' sur ' + fmt(deb.visits) + ' visites']], formula: 'Somme, sur les sites, des enfants inscrits en début de mois au dernier relevé de chaque site.', limits: ['Un stock mensuel ne s’additionne pas d’un mois à l’autre.'] });
      tile('Admissions / sorties', fmt(sum(en.map(v => v.x.MODRegEntrnb))) + ' / ' + fmt(sum(so.map(v => v.x.MODRegSortnb))), 'mois visités', 'Flux des mois où le site a été visité : ' + fmt(en.length) + ' relevés d’admissions, ' + fmt(so.length) + ' de sorties.', { value: [['Admissions', fmt(sum(en.map(v => v.x.MODRegEntrnb))) + ' (' + fmt(en.length) + ' relevés)'], ['Sorties', fmt(sum(so.map(v => v.x.MODRegSortnb))) + ' (' + fmt(so.length) + ' relevés)']], formula: 'Somme des flux du mois relevés aux visites.', limits: ['Ne couvre que les mois où le site a été visité.'] });
    }
    if (a === 'RES') {
      const ad = pair('cep_adopters', 'cep_members'), w = ok.filter(v => ovNum(v.x.VSLA_MembersF) && ovNum(v.x.VSLA_MembersM)), f = sum(w.map(v => v.x.VSLA_MembersF)), h = sum(w.map(v => v.x.VSLA_MembersM));
      tile('Adoption des pratiques', pct(ad.den ? ad.num / ad.den * 100 : null, 1), fmt(ad.num) + '/' + fmt(ad.den) + ' membres', 'Adoptants sur membres des champs écoles, sur ' + fmt(ad.x.length) + ' visites renseignées.', { value: [['Adoptants / membres', fmt(ad.num) + ' / ' + fmt(ad.den)], ['Visites renseignées', nOf(ad.x.length, ok.length, 'visites')]], formula: 'Σ adoptants ÷ Σ membres, sur les visites où les deux sont renseignés.', limits: ['Les membres d’un même champ école revisité sont comptés à chaque visite.'] });
      tile('Femmes dans les VSLA', pct(f + h ? f / (f + h) * 100 : null, 1), fmt(f) + '/' + fmt(f + h) + ' membres', 'Sur ' + fmt(w.length) + ' visites renseignées.', { value: [['Femmes / membres', fmt(f) + ' / ' + fmt(f + h)]], formula: 'Σ femmes ÷ Σ (femmes + hommes), visites où les deux sont renseignés.', limits: [] });
      const rr = X('VSLA_LoanRepayRate').map(v => v.x.VSLA_LoanRepayRate), hp = ovHeap(rr);
      tile('Remboursement VSLA', rr.length ? fmt(median(rr), 0) + ' %' : 'non mesuré', hp ? 'valeur ' + fmt(hp.value) + ' très fréquente' : fmt(rr.length) + ' groupes', 'Médiane des taux déclarés par ' + fmt(rr.length) + ' groupes.' + (hp ? ' ' + fmt(hp.n) + ' réponses sur ' + fmt(hp.N) + ' valent exactement ' + fmt(hp.value) + ' : valeur par défaut ou code ? À vérifier avant de lire la médiane.' : ''), { value: [['Médiane', fmt(median(rr), 1) + ' %'], ['Moyenne', fmt(mean(rr), 1) + ' %'], ['Groupes renseignés', fmt(rr.length)]].concat(hp ? [['Valeur la plus fréquente', fmt(hp.value) + ' : ' + nOf(hp.n, hp.N, 'valeurs')]] : []), formula: 'Médiane des taux de remboursement déclarés.', limits: [hp ? 'Valeurs en tas : ' + fmt(hp.n) + ' réponses sur ' + fmt(hp.N) + ' valent exactement ' + fmt(hp.value) + ' (valeur par défaut ou code ?) : à vérifier avant d’interpréter la médiane.' : null] });
    }
    if (a === 'GD') {
      const fg = X('fgd_n'), n = sum(fg.map(v => v.x.fgd_n)), f = sum(fg.map(v => v.x.fgd_f || 0)), sl = sum(X('stock_lines').map(v => v.x.stock_lines)), sg = sum(X('stock_gap_lines').map(v => v.x.stock_gap_lines || 0));
      tile('Participants aux FGD', fmt(n), pct(n ? f / n * 100 : null, 0) + ' de femmes', 'Participants des groupes de discussion, additionnés sur ' + fmt(fg.length) + ' visites. Le codage « femme » est supposé à partir du code de sexe.', { value: [['Participants', fmt(n)], ['Femmes', nOf(f, n, 'participants')], ['Visites avec FGD', fmt(fg.length)]], formula: 'Somme des participants des groupes de discussion sur les visites.', limits: ['Codage « femme » supposé à partir du code de sexe (à confirmer dans le formulaire).', 'Participants additionnés sur les visites.'] });
      tile('Écarts de stock', pct(sl ? sg / sl * 100 : null, 1), fmt(sg) + '/' + fmt(sl) + ' lignes', 'Lignes produit dont l’écart entre stock théorique et stock compté dépasse 2 %. Pas de seuil d’alerte défini, donc pas de couleur.', { value: [['Lignes avec écart', nOf(sg, sl, 'lignes produit')]], formula: 'Écart = |ouverture + reçu − avarié − distribué − stock compté| ÷ (ouverture + reçu) ; ligne en écart si > 2 %.', limits: ['Les seuils des alertes (' + THR.rLow + ' / ' + THR.rHigh + ' %) ne s’appliquent pas à un écart de stock.'] });
    }
    return T;
  }
  // ---------------------------------------------------------------- aides des cartes (info ⓘ), calculées à l'affichage
  function ovDefFor(t) {
    const L = [
      ['Causes déclarées', 'Réponses aux questions « pourquoi », « quelles raisons » ou « quels défis » du formulaire, sur les visites des filtres. Elles éclairent les écarts observés.'],
      ['Toutes les questions', 'Réponses à chaque question du formulaire, sur les fiches exploitables des filtres. Les codes « ne sait pas » (888, 999…) sont écartés. Pour un nombre, le total additionne les fiches : un site revisité compte plusieurs fois.']
    ];
    const d = L.find(([k]) => t.startsWith(k)); return d ? d[1] : null;
  }

  // ---------------------------------------------------------------- MÉTHODOLOGIE générée depuis le code et les données
  function ovMethodSections() {
    const U = D.updated || {}, PF = D.planFull || { cols: [], rows: [] }, pc = k => PF.cols.indexOf(k), ok = V.filter(v => v.valid), Sx = ovSites(ok), AG = ovAgents(ok);
    const S = [];
    S.push({ t: 'Données utilisées', items: ['Visites du ' + dFrUI((D.period || [])[0]) + ' au ' + dFrUI((D.period || [])[1]) + ', recalculées le ' + dFrUI(D.generated) + '.', 'Dates acceptées ' + winLabel() + '. Une fiche datée en dehors est écartée.', 'Plan de suivi ' + planYearUI() + ' : ' + fmt(PF.rows.filter(x => x[pc('actif')] === 1).length) + ' sites actifs sur ' + fmt(PF.rows.length) + (U.PLAN ? ', mis à jour le ' + dFrUI(U.PLAN.date) : '') + '.']
      .concat(ACTS.filter(a => U[a]).map(a => ACT[a].short + ' : extraction du ' + dFrUI(U[a].date) + ', ' + fmt(U[a].rows) + ' lignes' + (U[a].file ? ' (' + U[a].file + ')' : '') + '.')).concat(['Version des données pour les textes du rapport : v-' + ovHash(OV_VER) + '.']) });
    S.push({ t: 'Ce que l’on compte', items: ['Une fiche est une soumission de formulaire. Le fichier en contient ' + fmt(D.subs.rows.length) + '.', 'Une visite regroupe les fiches d’une même activité, d’un même site et d’un même jour : ' + fmt(V.length) + ' visites, dont ' + fmt(ok.length) + ' exploitables (au moins une fiche remplie, datée dans la période acceptée, hors test).',
      'Un site est compté par son code : ' + fmt(Sx.ident) + ' sites suivis, dont ' + fmt(Sx.inPlan) + ' au plan. Les ' + fmt(Sx.off) + ' sites saisis hors liste sont comptés à part, par leur nom, et ' + fmt(Sx.noneVisits) + ' visites n’ont pas de site.', 'Les noms d’agents sont harmonisés automatiquement : ' + fmt(AG.n) + ' agents. « Non renseigné » n’est pas compté comme un agent (' + fmt(AG.noName) + ' visites).'] });
    S.push({ t: 'Score de conformité', items: ['Pour chaque visite, part des questions oui/non respectées : conforme 100, non conforme 0, partiel 50. Les questions où « oui » signale un problème sont inversées. Les questions non posées, non applicables ou « ne sait pas » sont écartées.',
      'Lecture : bon à partir de ' + THR.good + ', à améliorer de ' + THR.mid + ' à ' + THR.good + ', insuffisant sous ' + THR.mid + '. Ce sont des seuils internes à l’outil, en attendant une cible validée.', 'Le score ne se compare pas d’une activité à l’autre, car les questionnaires diffèrent. Une moyenne toutes activités dépend du mélange des activités.'] });
    S.push({ t: 'Alertes', items: ['Une visite a une alerte quand au moins une de ses fiches donne la réponse d’alerte à une question de la liste de l’activité.', 'Couleurs : grave en rouge dès un cas, à vérifier en orange dès un cas puis rouge au-delà de ' + THR.rHigh + ' % des visites. Pour le reste, peu fréquentes jusqu’à ' + THR.rLow + ' %, fréquentes jusqu’à ' + THR.rHigh + ' %, très fréquentes au-delà.', ovALERT_TIERS.source + '.']
      .concat(ovALERT_TIERS.levels.map(l => l.name + ' : ' + l.what + '. Règle : ' + l.rule + '. Questions : ' + (Object.keys(D.riskQ).filter(k => ovTier(k.split('|')[0], k.slice(k.indexOf('|') + 1)) === l.id).map(k => ACT[k.split('|')[0]].short + ', ' + ovLow(ovRiskLabel(k.split('|')[0], k.slice(k.indexOf('|') + 1), RISK.findIndex(r => r.code === k.slice(k.indexOf('|') + 1))))).join(' ; ') || 'aucune') + '.'))
      .concat(['Un cas est une visite avec une alerte grave ou à vérifier. Il garde la même clé (activité, site, jour, alerte) d’une mise à jour à l’autre. On enregistre son statut, la date, l’auteur et un commentaire de ' + 500 + ' caractères au plus.', 'Tendance : part des visites avec l’alerte sur les 3 derniers mois de la période, comparée aux 3 mois précédents. Elle est dite stable sous ' + OV_TREND_PTS + ' points et n’est pas calculée sous ' + SMALL_N.low + ' visites par période.']) });
    S.push({ t: 'Petits effectifs', items: ['Sous ' + SMALL_N.min + ' observations, la valeur n’est pas calculée. De ' + SMALL_N.min + ' à ' + (SMALL_N.low - 1) + ', elle est grisée et ne sert ni aux couleurs ni aux classements. À partir de ' + SMALL_N.low + ', affichage normal.', 'Un domaine n’est retenu comme point faible que s’il est renseigné dans au moins ' + SMALL_N.low + ' visites et ' + pct(OV_DOM_SHARE * 100, 0) + ' des visites de l’activité.'] });
    S.push({ t: 'Couverture, priorités, stocks', items: [typeof covDefinition === 'function' ? covDefinition() : 'Couverture du plan : sites actifs du plan vus au moins une fois sur les sites actifs du plan.', 'Aucune cible de couverture n’est définie : la valeur n’est pas colorée.',
      'Visites prioritaires : ' + ovPrioCritTxt('both') + '. Elles sont triées par alertes graves, puis alertes à vérifier, puis score le plus bas, à l’écran comme dans le rapport.', 'Les effectifs (élèves, enfants inscrits) sont pris au dernier relevé de chaque site et ne s’additionnent pas d’une visite à l’autre. Seuls les flux (admissions, sorties) s’additionnent.'] });
    S.push({ t: 'Barèmes des notes', items: Object.keys(GRADE_SCALES).map(k => { const s = GRADE_SCALES[k]; return ovUp(s.label) + ' : A dès ' + s.A + ', B dès ' + s.B + ', C dès ' + s.C + ', D en dessous ; pas de note sous ' + s.minN + ' ' + s.unit + '.'; }) });
    let rb = null, rbErr = ''; try { rb = typeof rbmCfg === 'function' ? rbmCfg() : null; } catch (e) { rb = null; rbErr = String((e && e.message) || e).slice(0, 200); }
    if (!rb || !rb.w) S.push({ t: 'Planification', items: ['Paramètres non lisibles ici' + (rbErr ? ' (' + rbErr + ')' : '') + ' : voir l’onglet Planification.'] });
    if (rb && rb.w) S.push({ t: 'Planification', items: ['Poids du score de risque : ' + Object.keys(rb.w).map(k => (({ score: 'conformité récente', alert: 'alertes de la dernière visite', never: 'jamais visité', recency: 'délai depuis la dernière visite', partner: 'note du partenaire', plan: 'calendrier du plan' })[k] || k) + ' ' + rb.w[k]).join(', ') + '.', 'Risque élevé à partir de ' + rb.thHigh + ', moyen à partir de ' + rb.thMed + '. Visite tous les ' + (rb.freq || {}).high + ' mois pour un risque élevé, ' + (rb.freq || {}).med + ' pour moyen, ' + (rb.freq || {}).low + ' pour faible.', 'Score cible ' + rb.target + ', délai maximal ' + rb.recencyDays + ' jours, horizon ' + rb.horizon + ' mois.'].concat(rb.target !== THR.good ? ['La cible du score de risque (' + rb.target + ') n’est pas la même que le seuil « bon » des écrans (' + THR.good + ').'] : []) });
    return S;
  }
  const ovUp = s => { const t = String(s || ''); return t.charAt(0).toUpperCase() + t.slice(1); };
  function ovRenderMethod(main) {
    const det = (t, items, open) => { const d = el('details', { class: 'ov-msec' }, [el('summary', { text: t }), el('ul', { class: 'find' }, items.map(x => el('li', { text: x })))]); if (open) d.open = true; return d; };
    const secs = ovMethodSections();
    main.appendChild(ovCard('Méthodologie', 'Sources, unités, seuils et barèmes. Tout est relu dans les données et le code à chaque affichage.', secs.map((s, i) => det(s.t, s.items, i === 0)).concat([det('Traitement des extractions', D.method || [], false)]), 'wide'));
  }
  // ---------------------------------------------------------------- RAPPORT : textes saisis versionnés, clés sémantiques
  const OV_LS2 = 'pm-report-v2', OV_LS1 = 'pm-report-v1';
  const OV_GLOBAL_RE = /^(title|author|date|version|sig-|cust-)/, OV_FREE_RE = /^(com-|cust-)/, OV_POS_RE = /^(msg|rec|dq|why-[A-Za-z]+|how-[A-Za-z]+)\.\d+$/;
  function ovDataVer() { const U = D.updated || {}; return [D.generated, (D.visits || []).length, (D.visits || []).filter(r => r[11] === 1).length, (D.period || []).join('>'), Object.keys(U).sort().map(a => a + ':' + U[a].date + ':' + U[a].rows).join(',')].join('|'); }
  const OV_VER = ovDataVer();
  const OV_VERLAB = 'données du ' + dFrUI((D.period || [])[0]) + ' au ' + dFrUI((D.period || [])[1]) + ', ' + fmt(V.filter(v => v.valid).length) + ' visites exploitables';
  let OV_STORE = null;
  const OV_STALE = [], OV_OLDVER = [];
  function ovMigrateKey(k) {
    const h = k.indexOf('#'); if (h < 0) return null; const sc = k.slice(0, h).split('|'), id = k.slice(h + 1);
    if (OV_GLOBAL_RE.test(id)) return 'G#' + id;
    if (sc.length !== 7) return null;
    const nm = (d, x) => { const i = +x; return i >= 0 && DICT[d] && DICT[d][i] !== undefined ? DICT[d][i] : '*'; };
    const per = sc[5] === MONTHS[0] && sc[6] === MONTHS[MONTHS.length - 1] ? 'ALL' : sc[5] + '~' + sc[6];
    return [sc[0], nm('fo', sc[1]), nm('region', sc[2]), '*', nm('org', sc[3]), nm('imp', sc[4]), per].join('|') + '#' + (OV_POS_RE.test(id) ? 'old:' + id : id);
  }
  function ovStoreLoad() {
    if (OV_STORE) return OV_STORE;
    let s = null; try { s = JSON.parse(window.localStorage.getItem(OV_LS2) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') {
      s = {}; let old = null; try { old = JSON.parse(window.localStorage.getItem(OV_LS1) || 'null'); } catch (e) { old = null; }
      if (old && typeof old === 'object') { Object.keys(old).forEach(k => { const v = old[k]; if (typeof v !== 'string') return; const nk = ovMigrateKey(k); if (nk) s[nk] = { t: v.slice(0, 20000), base: null, ver: null, legacy: 1 }; }); ovStoreSave(s); }
    }
    OV_STORE = s; return s;
  }
  function ovStoreSave(o) { OV_STORE = o; try { window.localStorage.setItem(OV_LS2, JSON.stringify(o)); } catch (e) { /* stockage indisponible */ } }
  function ovScopeKey() { const nm = (d, i) => i < 0 || DICT[d][i] === undefined ? '*' : DICT[d][i]; return [F.act, nm('fo', F.fo), nm('region', F.region), nm('district', F.district), nm('org', F.org), nm('imp', F.imp), ovPeriodFull() ? 'ALL' : F.m0 + '~' + F.m1].join('|'); }
  function ovImportTexts(j) {
    const out = {}, T = j && j.texts && typeof j.texts === 'object' ? j.texts : {};
    Object.keys(T).forEach(k => {
      if (typeof k !== 'string' || k.length > 400) return; const v = T[k];
      if (typeof v === 'string') { const nk = ovMigrateKey(k); if (nk) out[nk] = { t: v.slice(0, 20000), base: null, ver: null, legacy: 1 }; return; }
      if (v && typeof v === 'object' && typeof v.t === 'string') out[k] = { t: v.t.slice(0, 20000), base: typeof v.base === 'string' ? v.base.slice(0, 20000) : null, ver: typeof v.ver === 'string' ? v.ver.slice(0, 400) : null, verLab: typeof v.verLab === 'string' ? v.verLab.slice(0, 300) : undefined, at: typeof v.at === 'string' ? v.at.slice(0, 20) : undefined, legacy: v.legacy ? 1 : undefined };
    });
    return out;
  }
  function ovEd(tag, id, def, cls_) {
    const g = OV_GLOBAL_RE.test(id), free = OV_FREE_RE.test(id), k = (g ? 'G' : scopeKey()) + '#' + id;
    const st = lsLoad(), o = st[k] && typeof st[k] === 'object' && typeof st[k].t === 'string' ? st[k] : null;
    const n = el(tag, { class: 'ed' + (cls_ ? ' ' + cls_ : ''), 'data-id': id, spellcheck: 'true', title: 'Cliquer pour modifier le texte' });
    n.textContent = o ? o.t : def;
    try { n.contentEditable = 'plaintext-only'; } catch (e) { n.contentEditable = 'true'; }
    if (n.contentEditable !== 'plaintext-only') n.contentEditable = 'true';
    if (o) n.classList.add('edited');
    if (o && !g && !free && o.base !== def) { n.classList.add('ov-stale'); n.title = 'Texte saisi sur une version antérieure des données ou du texte calculé : voir le bandeau en haut du rapport.'; OV_STALE.push({ k, id, def, o }); }
    else if (o && free && o.ver !== OV_VER) OV_OLDVER.push({ k, id, o });
    n.addEventListener('paste', ev => { ev.preventDefault(); const t = (ev.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); });
    n.addEventListener('input', () => { const s = lsLoad(), t = String(n.textContent || '').slice(0, 20000); if (t === def) { delete s[k]; n.classList.remove('edited', 'ov-stale'); } else { s[k] = { t, base: def, ver: OV_VER, verLab: OV_VERLAB, at: localDay() }; n.classList.add('edited'); } lsSave(s); });
    return n;
  }
  function ovHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function ovEdList(id, items) {
    const seen = {};
    return el('ul', { class: 'r-list' }, items.map(t => {
      let key, txt; if (Array.isArray(t)) { key = String(t[0]); txt = t[1]; } else { txt = String(t); key = 'h' + ovHash(txt.replace(/[\d\s.,%/()–+-]+/g, ' ').trim().slice(0, 160)); }
      seen[key] = (seen[key] || 0) + 1; if (seen[key] > 1) key += '~' + seen[key];
      return ed('li', id + '.' + key, txt);
    }));
  }
  function ovIdLabel(id) {
    const a = s => ACT[s] ? ACT[s].short : s, p = id.split('.');
    if (/^old:/.test(id)) return 'Ancienne saisie rattachée par position (' + id.slice(4) + ')';
    if (p[0] === 'msg') return 'Messages clés – ' + a(p[1]); if (p[0] === 'rec') return 'Recommandations – ' + a(p[1]); if (p[0] === 'dq') return 'Qualité des données – constat';
    if (/^why-/.test(p[0])) return 'Pourquoi ? – ' + a(p[0].slice(4)); if (/^how-/.test(p[0])) return 'Comment agir ? – ' + a(p[0].slice(4));
    return ({ intro: 'Introduction' })[id] || id;
  }
  function ovStaleBanner(main, tools) {
    const sc = scopeKey(), base = sc.slice(0, sc.lastIndexOf('|')), S = lsLoad();
    const olds = Object.keys(S).filter(k => { const h = k.indexOf('#'); const s2 = k.slice(0, h); return k.slice(h + 1, h + 5) === 'old:' && s2.slice(0, s2.lastIndexOf('|')) === base; });
    if (!OV_STALE.length && !olds.length && !OV_OLDVER.length) return;
    const box = el('div', { class: 'ov-banner', role: 'status' });
    if (OV_STALE.length) {
      box.appendChild(el('div', { class: 'ov-bh' }, [el('b', { text: fmt(OV_STALE.length) + ' texte(s) modifié(s) avant la mise à jour des données du ' + dFrUI(D.generated) + '. Chiffres actuels : ' + OV_VERLAB + '.' }), ' ',
        ovBtn('Tout reprendre (textes calculés)', () => { const s = lsLoad(); OV_STALE.forEach(x => { delete s[x.k]; }); lsSave(s); render(); }), ' ',
        ovBtn('Tout garder', () => { const s = lsLoad(); OV_STALE.forEach(x => { if (s[x.k]) Object.assign(s[x.k], { base: x.def, ver: OV_VER, verLab: OV_VERLAB }); }); lsSave(s); render(); })]));
      OV_STALE.forEach(x => box.appendChild(el('div', { class: 'ov-bi' }, [el('div', { class: 'ov-b', text: ovIdLabel(x.id) }),
        el('div', { class: 'muted', text: 'Saisi ' + (x.o.at ? 'le ' + dFrUI(x.o.at) + ', ' : '') + 'sur les ' + (x.o.verLab || (x.o.legacy ? 'données d’une version antérieure, à revoir' : 'données d’une version antérieure')) }),
        el('div', { class: 'ov-q', text: 'Votre texte : « ' + (x.o.t.length > 400 ? x.o.t.slice(0, 398) + '…' : x.o.t) + ' »' }), el('div', { class: 'ov-q ov-new', text: 'Texte calculé aujourd’hui : « ' + (x.def.length > 400 ? x.def.slice(0, 398) + '…' : x.def) + ' »' }),
        el('div', { class: 'ov-exp' }, [ovBtn('Reprendre le texte calculé', () => { const s = lsLoad(); delete s[x.k]; lsSave(s); render(); }, 'on'), ovBtn('Garder mon texte', () => { const s = lsLoad(); if (s[x.k]) Object.assign(s[x.k], { base: x.def, ver: OV_VER, verLab: OV_VERLAB }); lsSave(s); render(); })])])));
    }
    if (olds.length) {
      box.appendChild(el('div', { class: 'ov-bh' }, [el('b', { text: fmt(olds.length) + ' ancienne(s) saisie(s) d’un format précédent : à relire, puis supprimer.' })]));
      olds.forEach(k => box.appendChild(el('div', { class: 'ov-bi' }, [el('div', { class: 'ov-b', text: ovIdLabel(k.slice(k.indexOf('#') + 1)) }), el('div', { class: 'ov-q', text: '« ' + String(S[k].t).slice(0, 400) + ' »' }), el('div', { class: 'ov-exp' }, [ovBtn('Supprimer', () => { const s = lsLoad(); delete s[k]; lsSave(s); render(); })])])));
    }
    if (OV_OLDVER.length) box.appendChild(el('p', { class: 'muted', text: fmt(OV_OLDVER.length) + ' commentaire(s) libre(s) rédigé(s) sur une autre version des données (' + OV_OLDVER.map(x => ovIdLabel(x.id) + (x.o.verLab ? ' : ' + x.o.verLab : '')).join(' ; ') + ') : relisez-les.' }));
    main.insertBefore(box, tools.nextSibling);
  }
  // Pages du rapport
  function ovRepCover(ok) {
    const Sx = ovSites(ok), AG = ovAgents(ok), T = ovTierCounts(ok), cov = ovCovCtx(ok)(F.act, F.region), FI = ovFiches(ok);
    const sc = ACTS.map(a => { const x = ok.filter(v => v.act === a); return x.length ? ACT[a].short + ' ' + fmt(mean(x.map(v => v.score)), 1) : null; }).filter(Boolean);
    return el('div', null, [kpiRow([[fmt(ok.length), 'visites (' + fmt(FI.valid) + ' fiches)'], [fmt(Sx.ident), 'sites suivis'], [fmt(T.t1), 'visites avec une alerte grave', T.t1 ? 'bad' : ''], [cov.planned && !cov.outOfYear ? pct(cov.visited / cov.planned * 100, 0) : 'n.c.', 'couverture du plan (' + fmt(cov.visited) + ' sites sur ' + fmt(cov.planned) + ')'], [fmt(AG.n), 'agents']]),
      el('p', { class: 'r-small', text: 'Score sur 100 : ' + sc.join(', ') + ' (référence ' + THR.good + '). Données du ' + dFrUI((D.period || [])[0]) + ' au ' + dFrUI((D.period || [])[1]) + '.' })]);
  }
  function ovRepLegend() { return el('p', { class: 'r-small', text: 'Couleurs : score bon à partir de ' + THR.good + ', à améliorer de ' + THR.mid + ' à ' + THR.good + ', insuffisant sous ' + THR.mid + '. Alerte grave en rouge dès un cas, alerte à vérifier en orange. Pas de couleur sous ' + SMALL_N.low + ' visites.' }); }
  function ovRepSynth(ok, acts) {
    const covF = ovCovCtx(ok);
    const rows = acts.map(a => { const x = ok.filter(v => v.act === a); const cp = covF(a, F.region); return { a, x, n: x.length, st: ovScoreStats(x), T: ovTierCounts(x), cp }; });
    return [rblock('Résultats par activité', [rtable([{ t: 'Activité', fmt: r => ACT[r.a].label }, { t: 'Visites', num: 1, fmt: r => fmt(r.n) }, { t: 'Score', num: 1, fmt: r => ovSmallCell(r.st.mean, r.st.n) }, { t: 'Médiane', num: 1, fmt: r => fmt(r.st.med, 1) },
      { t: 'Avec alerte', num: 1, fmt: r => fmt(r.T.any) + '/' + fmt(r.n) }, { t: 'Graves', num: 1, fmt: r => el('span', { class: 'cell ov-cw bg-' + (r.T.t1 ? 'bad' : 'good'), text: fmt(r.T.t1) }) },
      { t: 'Couverture', num: 1, fmt: r => coverageComputable(r.a, r.cp) ? fmt(r.cp.visited) + '/' + fmt(r.cp.planned) : 'n.c.' }], rows), ovRepLegend()]),
      rblock('Messages clés', [edList('msg', ovMessages(ok))]),
      rblock('Recommandations', [edList('rec', ovRecs(ok)), el('p', { class: 'r-small', text: 'Sont retenues : toutes les alertes graves, les alertes à vérifier présentes dans au moins ' + THR.rLow + ' % des visites et les domaines sous ' + THR.good + ' assez renseignés. ' + ovALERT_TIERS.source + '.' })]),
      rblock('Commentaire du bureau', [ed('p', 'com-synth', 'Ajouter ici le commentaire du bureau (contexte, explications, suites données)…', 'r-note')])];
  }
  function ovRepGeo(ok, acts) {
    const months = MONTHS.filter(m => m >= F.m0 && m <= F.m1), covF = ovCovCtx(ok);
    const rows = months.map(m => { const vals = {}; ok.filter(v => v.month === m).forEach(v => { vals[v.act] = (vals[v.act] || 0) + 1; }); return { month: m, values: vals, line: null }; }).filter(r => Object.keys(r.values).length);
    const dist = Array.from(new Set(ok.map(v => v.district))).map(d => { const x = ok.filter(v => v.district === d); const top = ovAlertRows(x).filter(z => z.n && z.tier !== 'c').sort((p, q) => q.n - p.n)[0]; return { d: DICT.district[d] || 'Non renseigné', n: x.length, st: ovScoreStats(x), T: ovTierCounts(x), top }; }).sort((p, q) => q.n - p.n);
    const pm = ovPartialMonthNote(months);
    return [rblock('Visites par mois', [stackedMonthly(rows, acts, acts.map(a => ACT_COLOR[a]), acts.map(a => ACT[a].short), { h: 180 }), legend(acts.map(a => [ACT_COLOR[a], ACT[a].short])), pm ? el('p', { class: 'r-small', text: pm }) : null]),
      rblock('Score par mois', [ovLineChart(ovScoreSeries(ok, acts, months), months, { h: 180 }), legend(acts.map(a => [ACT_COLOR[a], ACT[a].short]))]),
      rblock('Couverture du plan ' + planYearUI(), [ovBars(acts.map(a => ({ a, cp: covF(a, F.region) })).filter(z => coverageComputable(z.a, z.cp) && !z.cp.outOfYear).map(z => ({ label: ACT[z.a].short, value: z.cp.planned ? z.cp.visited / z.cp.planned * 100 : 0, ntxt: fmt(z.cp.visited) + '/' + fmt(z.cp.planned) })), { max: 100 }), el('p', { class: 'r-small', text: 'Sites actifs du plan vus au moins une fois dans la période. Pas de cible définie.' })]),
      rblock('Par district', [rtable([{ t: 'District', k: 'd' }, { t: 'Visites', num: 1, fmt: r => fmt(r.n) }, { t: 'Score', num: 1, fmt: r => F.act === 'ALL' ? (nStatus(r.n) === 'na' ? '–' : fmt(r.st.mean, 1)) : ovSmallCell(r.st.mean, r.n) }, { t: 'Avec alerte', num: 1, fmt: r => nStatus(r.n) === 'na' ? '–' : fmt(r.T.any) + '/' + fmt(r.n) }, { t: 'Graves', num: 1, fmt: r => fmt(r.T.t1) },
        { t: 'Alerte la plus fréquente', fmt: r => r.top ? (F.act === 'ALL' ? ACT[r.top.act].short + ', ' : '') + ovLow(r.top.label) + ' (' + fmt(r.top.n) + '/' + fmt(r.top.N) + ')' : '—' }], dist), el('p', { class: 'r-small', text: (F.act === 'ALL' ? 'Toutes activités : score sans couleur, les questionnaires diffèrent. ' : '') + 'Sous ' + SMALL_N.min + ' visites, valeur non calculée.' })]),
      rblock(null, [ed('p', 'com-geo', 'Commentaire sur la couverture et la répartition géographique…', 'r-note')])];
  }
  function ovRepAct(a, ok) {
    const x = ok.filter(v => v.act === a); if (!x.length) return null;
    const okSet = new Set(x.map(v => v.i)), P = RCFG.actParts, st = ovScoreStats(x), T = ovTierCounts(x), cp = ovCovCtx(ok)(a, F.region), cc = coverageComputable(a, cp);
    const kids = [kpiRow([[fmt(x.length), 'visites'], [fmt(ovSites(x).ident), 'sites'], [fmt(st.mean, 1), 'score sur 100 (médiane ' + fmt(st.med, 1) + ')', nStatus(st.n) === 'ok' ? cls(st.mean) : ''], [fmt(T.t1), 'visites avec une alerte grave', T.t1 ? 'bad' : ''], [cc ? pct(cp.planned ? cp.visited / cp.planned * 100 : null, 0) : 'n.c.', cc ? 'couverture du plan (' + fmt(cp.visited) + '/' + fmt(cp.planned) + ')' : 'couverture : plan à compléter']])];
    if (P.why) { const wh = ovWhyHow(a, x); kids.push(el('div', { class: 'r-2col' }, [rblock('Pourquoi', [edList('why-' + a, wh.why)]), rblock('Que faire', [edList('how-' + a, wh.how)])])); }
    if (P.charts) {
      const dr = ovDomRows(a, x).sort((p, q) => p.v - q.v), ar = ovAlertRows(x, a).filter(r => r.n).sort(ovAlertSort).slice(0, 6);
      kids.push(el('div', { class: 'r-2col' }, [rblock('Score par domaine', [ovBars(dr.map(r => { const s = nStatus(r.n); return { label: r.d, value: s === 'na' ? 0 : r.v, vtxt: s === 'na' ? '–' : fmt(r.v, 0), ntxt: fmt(r.n) + ' v.', cls: s === 'ok' ? cls(r.v) : 'na' }; }), { max: 100 })]),
        rblock('Alertes', [ovBars(ar.map(r => ({ label: r.label, value: r.p, vtxt: pct(r.p, 0), ntxt: fmt(r.n) + '/' + fmt(r.N), cls: ovAlertCls(r.tier, r.n, r.p) })), { max: 100 })])]));
    }
    if (P.norms) { const sts = D.items[a].meta.map((m, j) => ovItemCounts(a, j, okSet)).filter(z => nStatus(z.n) === 'ok').sort((p, q) => p.p - q.p).slice(0, RCFG.nNorms); kids.push(rblock('Normes les moins respectées', [rtable([{ t: 'Question du formulaire', fmt: r => (r.m.neg ? '↺ ' : '') + r.m.label }, { t: 'Domaine', fmt: r => r.m.domain }, { t: 'Conforme', num: 1, fmt: r => fmt(r.c) }, { t: 'Non conf.', num: 1, fmt: r => fmt(r.nc) }, { t: 'Partiel', num: 1, fmt: r => fmt(r.part) }, { t: '% conforme', num: 1, fmt: r => cell(r.p) }], sts), el('p', { class: 'r-small', text: '↺ : question inversée, « oui » signale un problème. Le partiel compte pour moitié.' })])); }
    if (a === 'SMP' && D.smpMeals && D.smpMeals.n_all) { const SM = D.smpMeals; kids.push(rblock('Repas non servis', [el('p', { class: 'r-p', text: 'Sur toute la période, ' + fmt(SM.supply) + ' fiches de direction sur ' + fmt(SM.n_all) + ' citent une rupture, un retard de livraison ou une catastrophe. Le nombre de jours de repas est sous-estimé : ' + fmt(SM.cal_only) + ' fiches sur ' + fmt(SM.n_lt20) + ' l’expliquent seulement par des jours sans école. Une école revisitée compte plusieurs fois.' })])); }
    const ip = ovImpRows(a, x);
    if (P.partners && ip.length) kids.push(rblock('Partenaires de mise en œuvre', [rtable([{ t: 'Partenaire', fmt: r => r.imp }, { t: 'Visites', num: 1, fmt: r => fmt(r.n) }, { t: 'Score', num: 1, fmt: r => ovSmallCell(r.s, r.n) }, { t: 'Avec alerte', num: 1, fmt: r => fmt(r.T.any) + '/' + fmt(r.n) }, { t: 'Graves', num: 1, fmt: r => fmt(r.T.t1) }, { t: 'Note', fmt: r => r.eng ? badge(r.eng[7], 'imp') : '–' }], ip.sort((p, q) => q.n - p.n)),
      el('p', { class: 'r-small', text: 'Note sur toute la période : A dès ' + GRADE_SCALES.imp.A + ', B dès ' + GRADE_SCALES.imp.B + ', C dès ' + GRADE_SCALES.imp.C + ', pas de note sous ' + GRADE_SCALES.imp.minN + ' visites. La pénalité pour alertes est plafonnée : lisez aussi la colonne des alertes.' })]));
    if (P.comment) kids.push(rblock('Commentaire', [ed('p', 'com-' + a, 'Commentaire sur ' + ACT[a].short + ' (contexte, réponse du partenaire, suites données)…', 'r-note')]));
    return kids;
  }
  function ovRepPrio(ok) {
    const Pr = ovPrio(ok, RCFG.prioMode), pv = Pr.all.slice(0, RCFG.nPrio);
    return [el('p', { class: 'r-p', text: ovPrioHead(Pr, pv.length) }),
      rtable([{ t: 'Visite', fmt: r => el('div', null, [el('b', { text: DICT.site[r.site] || '–' }), el('div', { class: 'r-small', text: (DICT.district[r.district] || '') + ', ' + dFrUI(r.date) + ', ' + ACT[r.act].short })]) }, { t: 'Score', num: 1, fmt: r => cell(r.score) },
        { t: 'Pourquoi', fmt: r => ovWhyNode(r) }, { t: 'Que faire', fmt: r => ovHowNode(r) }], pv, 'pv'),
      rblock('Commentaire', [ed('p', 'com-prio', 'Suites données aux visites prioritaires (visites de vérification, échanges avec les partenaires)…', 'r-note')])];
  }
  function ovRepDq() {
    const measured = a => (OV_SUB.durAct[a] || 0) > 0;
    return [rblock('Constats', [edList('dq', D.dqFindings || [])]), rblock('Contrôles par activité', [rtable([{ t: 'Activité', fmt: r => ACT[r.act].short }, { t: 'Fiches', num: 1, fmt: r => fmt(r.subs) }, { t: 'Visites exploitables', num: 1, fmt: r => fmt(r.validVisits) + '/' + fmt(r.visits) }, { t: 'Fiches vides', num: 1, fmt: r => fmt(r.empty) },
      { t: 'GPS à plus de 5 km', num: 1, fmt: r => fmt(r.gpsFar) }, { t: 'Agent « Autre »', num: 1, fmt: r => fmt(r.nameOther) }, { t: 'Ouvertes plus de 24 h', num: 1, fmt: r => measured(r.act) ? fmt(OV_SUB.durOpen[r.act] || 0) + '/' + fmt(OV_SUB.durAct[r.act]) : 'non mesuré' }], (D.dq || []).filter(r => F.act === 'ALL' || r.act === F.act)),
      el('p', { class: 'r-small', text: 'Toute la période. « Non mesuré » : l’extraction ne donne pas l’heure de début et de fin des fiches de cette activité.' })])];
  }
  function ovRepMethod() { return ovMethodSections().map(s => rblock(s.t, [el('ul', { class: 'r-list' }, s.items.map(t => el('li', { text: t })))])).concat([rblock('Méthodologie du recalcul', [el('ul', { class: 'r-list' }, (D.method || []).map(t => el('li', { text: t })))])]); }
