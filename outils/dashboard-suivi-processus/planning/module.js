  // ================================================================== LOT PLANIFICATION
  // UN moteur (rbmCfg / rbmCompute), UN registre (siteRows / siteIndex), UNE écriture du plan de suivi (plEdit), UN import (onglet Données).
  // Tout texte est calculé depuis les données courantes ; chaque note de risque s'ouvre dans un tiroir (valeur réelle, règle, poids, points).
  const PLS = { sub: SESSION.plSub || 'prio', month: null, q: '', page: 0, mode: 'horizon', cache: null, ckey: '', timer: null, imp: null };
  const PL_SAFE = k => k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
  const PL_FK = ['high', 'med', 'low', 'never'];
  const PL_CAT = { high: 'Élevé', med: 'Moyen', low: 'Faible', never: 'Jamais visité' };
  const PL_CATC = { high: 'bad', med: 'mid', low: 'good', never: 'na' };
  const PL_RL = { high: 'elevee', med: 'moyenne', low: 'faible', never: 'non_mesure' };

  if (window.__dash) window.__dash.pl = { rbmCfg: () => rbmCfg(), rbmCompute: c => rbmCompute(c), plExecution: o => plExecution(o), monthsDiff: (a, b) => plMD(a, b) };
  function plNorm(s) { return String(s === null || s === undefined ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function plMD(a, b) { const x = String(a).split('-').map(Number), y = String(b).split('-').map(Number); return (y[0] - x[0]) * 12 + (y[1] - x[1]); }
  function plKey(s) { return s.act + '|' + s.code; }
  function plDataEnd() { return (D.period && D.period[1]) || today(); }
  function plLastComplete() { const e = plDataEnd(), m = e.slice(0, 7); const last = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate(); return +e.slice(8, 10) >= last ? m : addMonths(m, -1); }
  function plClamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  // avance de k mois ACTIFS (grille d'activation) : un mois « Non » (vacances, fin de distribution) ne compte pas dans le délai d'une fréquence
  function plAddActive(s, m, k) { let x = m, n = 0, g = 0; while (n < k && g < 48) { x = addMonths(x, 1); g++; if (monthActive(s, x)) n++; } return n < k ? addMonths(m, k) : x; }
  function plVer() { return (CUR.planVersion || 0) + ':' + D.planFull.rows.length; }

  // ------------------------------------------------------------------ registre : graphies fusionnées (district, commune) et sécurité saisie
  let PL_CN = null, PL_CNV = '';
  function plCanon() {
    if (PL_CN && PL_CNV === plVer()) return PL_CN;
    const PF = D.planFull, c = k => PF.cols.indexOf(k);
    const pick = col => {
      const g = new Map(); PF.rows.forEach(r => { const v = String(r[c(col)] || '').trim(); if (!v) return; const k = plNorm(v); if (!g.has(k)) g.set(k, new Map()); const m = g.get(k); m.set(v, (m.get(v) || 0) + 1); });
      const out = new Map(); g.forEach((m, k) => { const best = Array.from(m.entries()).sort((a, b) => (b[1] - a[1]) || ((a[0] === a[0].toUpperCase()) - (b[0] === b[0].toUpperCase())) || a[0].localeCompare(b[0]))[0][0]; out.set(k, best.replace(/\b(Ii|Iii|Iv)\b/g, x => x.toUpperCase())); });
      return out;
    };
    PL_CN = { district: pick('district'), commune: pick('commune') }; PL_CNV = plVer(); return PL_CN;
  }
  let PL_SK = null, PL_SKV = '';
  function plSecSet() { if (PL_SK && PL_SKV === plVer()) return PL_SK; PL_SK = new Set((CUR.planLog || []).filter(e => e && e.f === 'security' && e.code).map(e => e.act + '|' + e.code)); PL_SKV = plVer(); return PL_SK; }

  // ------------------------------------------------------------------ écriture UNIQUE du plan de suivi (activation, grille, sécurité, motif)
  function plEdit(changes, meta) {
    meta = meta || {};
    const PF = D.planFull, ci = k => PF.cols.indexOf(k);
    const log = CUR.planLog = CUR.planLog || []; const when = today(), by = SESSION.by || '—'; let n = 0;
    changes.forEach(ch => {
      const r = PF.rows[ch.j]; const k = ci(ch.field); if (!r || k < 0) return;
      const before = r[k]; if (before === ch.value && !meta.force) return;
      r[k] = ch.value; n++;
      if (ch.motif !== undefined && ci('motif') >= 0) r[ci('motif')] = ch.motif;
      if (!meta.batch) log.push({ d: when, by, code: r[0], act: r[ci('act')], f: ch.field, a: before, b: ch.value, m: meta.motif || '' });
    });
    if (meta.batch && n) log.push({ d: when, by, code: '', act: meta.act || '', f: meta.field || '', n, scope: meta.scope || '', a: meta.before || '', b: meta.after || '', m: meta.motif || '' });
    if (!n) return 0;
    CUR.planVersion = (CUR.planVersion || 0) + 1; CUR.planEdited = { date: when, by };
    SESSION.dirty = true; SESSION.planPending = 1; PLS.cache = null;
    clearTimeout(PLS.timer); PLS.timer = setTimeout(plRefreshNow, 150);
    render();
    return n;
  }
  // couverture, points du plan (carte) et constats recalculés par le moteur, recopiés EN PLACE (pas de rechargement, filtres gardés)
  function plRefreshNow() {
    try {
      const t0 = performance.now(); const P = ENGINE.refreshPlanTables(CUR);
      Object.keys(P.dict).forEach(k => { const a = D.dict[k], b = P.dict[k]; if (Array.isArray(a) && Array.isArray(b)) for (let i = a.length; i < b.length; i++) a.push(b[i]); });
      ['coverage', 'plan', 'findings', 'dqFindings', 'method', 'planYear', 'window'].forEach(k => { if (P[k] !== undefined) D[k] = P[k]; });
      SESSION.planPending = 0; SESSION.plRefreshMs = Math.round(performance.now() - t0);
    } catch (e) { SESSION.plRefreshErr = String((e && e.message) || e); }
    if (!['sites', 'rbm', 'data'].includes(TAB)) render();
  }
  // ligne de mise à jour (le core l'affiche dans l'infobulle du sous-titre) : visites et plan de suivi distingués
  function plUpdateLine() {
    const U = D.updated || {}; const vis = Object.keys(U).filter(k => k !== 'PLAN').map(k => U[k] && U[k].date).filter(Boolean).sort();
    const pe = CUR.planEdited, pu = U.PLAN;
    const line = 'Visites mises à jour le ' + (vis.length ? dateFrLong(vis[vis.length - 1]) : '–') + '\nPlan de suivi : ' + (pu || pe ? [pu ? 'importé le ' + dateFrLong(pu.date) : null, pe ? 'modifié le ' + dateFrLong(pe.date) : null].filter(Boolean).join(', ') : 'version d’origine du fichier');
    SESSION.plLine = line; return line;
  }


  // ------------------------------------------------------------------ configuration : RBM_DEF ← fichier (D.rbm) ← essais (SESSION.rbm), fusion profonde contrôlée
  function plMergeCfg(base, o) {
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach(k => {
      if (!PL_SAFE(k)) return; const v = o[k];
      if (k === 'w') { if (v && typeof v === 'object') Object.keys(base.w).forEach(f => { if (v[f] !== undefined && v[f] !== null && isFinite(+v[f])) base.w[f] = +v[f]; }); }
      else if (k === 'freq') { if (v && typeof v === 'object') PL_FK.forEach(f => { if (v[f] !== undefined && v[f] !== null && isFinite(+v[f])) base.freq[f] = +v[f]; }); }
      else if (k === 'cap' || k === 'capAct') { if (v && typeof v === 'object') Object.keys(v).forEach(f => { if (!PL_SAFE(f)) return; if (v[f] === null || v[f] === '') delete base[k][f]; else if (isFinite(+v[f])) base[k][f] = +v[f]; }); }
      else if (k === 'mmr') {
        if (!v || typeof v !== 'object') return;
        Object.keys(v).forEach(a => {
          if (!ACT[a] || !PL_SAFE(a)) return; const x = v[a]; if (x === null) { delete base.mmr[a]; return; } if (typeof x !== 'object') return;
          const cur = base.mmr[a] = base.mmr[a] || {};   // MMR = plancher (jamais un intervalle) : visites minimales par an, au moins 1 visite tous les N mois, visites par jour
          ['minYear', 'floor', 'vpd'].forEach(f => { if (x[f] === null) delete cur[f]; else if (x[f] !== undefined && isFinite(+x[f])) cur[f] = +x[f]; });
        });
      }
      else if (Object.prototype.hasOwnProperty.call(base, k) && !(base[k] !== null && typeof base[k] === 'object')) {
        if (typeof base[k] === 'boolean') base[k] = !!v;
        else if (typeof base[k] === 'number') { if (v !== null && v !== undefined && isFinite(+v)) base[k] = +v; }
        else if (v !== undefined) base[k] = v;
      }
    });
  }
  function plCfg() { return plCfgFrom([D.rbm || {}, SESSION.rbm || {}]); }
  // normalise n'importe quelle configuration (couches fusionnées sur RBM_DEF, clés inconnues ignorées, bornes et garde-fous)
  function plCfgFrom(layers) {
    const base = JSON.parse(JSON.stringify(RBM_DEF)); const warn = [];
    layers.forEach(o => plMergeCfg(base, o));
    Object.keys(base.w).forEach(k => { base.w[k] = plClamp(+base.w[k] || 0, 0, 10); });
    PL_FK.forEach(k => { base.freq[k] = Math.round(plClamp(+base.freq[k] || 1, 1, 12)); });
    base.thHigh = plClamp(Math.round(+base.thHigh || 60), 1, 100); base.thMed = plClamp(Math.round(+base.thMed || 0), 0, 99);
    if (base.thMed >= base.thHigh) { warn.push('Seuil « moyen » (' + base.thMed + ') supérieur ou égal au seuil « élevé » (' + base.thHigh + ') : il est ramené à ' + (base.thHigh - 1) + ' pour garder trois niveaux.'); base.thMed = base.thHigh - 1; }
    base.horizon = Math.round(plClamp(+base.horizon || 3, 1, 12)); base.target = plClamp(+base.target || 85, 50, 100); base.recencyDays = plClamp(+base.recencyDays || 180, 30, 720);
    base.vpd = plClamp(+base.vpd || 0, 0, 20);
    Object.keys(base.mmr).forEach(a => { const x = base.mmr[a]; if (x.minYear !== undefined) x.minYear = Math.round(plClamp(x.minYear, 1, 12)); if (x.floor !== undefined) x.floor = Math.round(plClamp(x.floor, 1, 12)); if (x.vpd !== undefined) x.vpd = plClamp(x.vpd, 0.5, 20); if (x.minYear === undefined && x.floor === undefined && x.vpd === undefined) delete base.mmr[a]; });
    if (!base.start || !/^\d{4}-\d{2}$/.test(String(base.start)) || base.start < currentMonth()) base.start = currentMonth();
    Object.defineProperty(base, 'warn', { value: warn, enumerable: false });
    return base;
  }
  function plPatch(o) {
    const deep = (t, s) => { Object.keys(s).forEach(k => { if (!PL_SAFE(k)) return; const v = s[k]; if (v && typeof v === 'object' && !Array.isArray(v)) { if (!t[k] || typeof t[k] !== 'object') t[k] = {}; deep(t[k], v); } else t[k] = v; }); };
    SESSION.rbm = SESSION.rbm || {}; deep(SESSION.rbm, o); PLS.cache = null; render();
  }

  // ------------------------------------------------------------------ capacité : visites réalisées sur les sites de chaque bureau (3 derniers mois COMPLETS)
  let PL_CAP = null, PL_CAPV = '';
  function plCapacity() {
    if (PL_CAP && PL_CAPV === plVer()) return PL_CAP;
    const lc = plLastComplete(), endM = plDataEnd().slice(0, 7), ms = [addMonths(lc, -2), addMonths(lc, -1), lc];
    const PF = D.planFull, c = k => PF.cols.indexOf(k);
    const siteFo = new Map(PF.rows.map(r => [r[c('act')] + '|' + r[0], FO_NORM(r[c('fo')] || '')]));
    const perFo = new Map(), perMonth = new Map(ms.map(m => [m, 0]));
    V.forEach(v => {
      if (!v.valid || !v.date || ms.indexOf(v.month) < 0) return;
      const k = (D.visitKeys || [])[v.i]; const code = k ? k.slice(k.indexOf('|') + 1, k.lastIndexOf('|')) : '';
      const sf = siteFo.get(v.act + '|' + code), vf = FO_NORM(DICT.fo[v.fo] || ''); const fo = sf || vf; if (!fo) return;
      perMonth.set(v.month, perMonth.get(v.month) + 1);
      if (!perFo.has(fo)) perFo.set(fo, { n: 0, byM: new Map(), cross: 0, off: 0, agents: new Set() });
      const o = perFo.get(fo); o.n++; o.byM.set(v.month, (o.byM.get(v.month) || 0) + 1); if (sf && vf && vf !== sf) o.cross++; if (!sf) o.off++; (v.enus || []).forEach(e => o.agents.add(e));
    });
    const fos = Array.from(new Set(PF.rows.map(r => FO_NORM(r[c('fo')] || '')).filter(Boolean))).sort();
    const auto = Object.create(null); fos.forEach(f => { auto[f] = Math.round(((perFo.get(f) || {}).n || 0) / ms.length); });
    const incomplete = lc !== endM ? { m: endM, n: V.filter(v => v.valid && v.month === endM).length, end: plDataEnd() } : null;
    PL_CAP = { ms, auto, perFo, perMonth, incomplete, fos, extra: Array.from(perFo.keys()).filter(f => fos.indexOf(f) < 0) }; PL_CAPV = plVer();
    return PL_CAP;
  }
  // visites par jour et par agent observées (médiane des couples agent × jour) : sert aux journées-agent
  let PL_VPD = null;
  function plObsVpd() { if (PL_VPD) return PL_VPD; const m = new Map(); V.forEach(v => { if (!v.valid || !v.date) return; (v.enus || []).forEach(e => { const k = e + '|' + v.date; m.set(k, (m.get(k) || 0) + 1); }); }); const a = Array.from(m.values()); PL_VPD = { med: median(a) || 1, n: a.length }; return PL_VPD; }
  function plVpd(cfg, act) { const x = cfg.mmr[act]; return (x && x.vpd) || cfg.vpd || plObsVpd().med; }

  // ------------------------------------------------------------------ équipe d'un site : organisation de suivi qui y travaille (6 derniers mois), sinon commune, sinon district
  let PL_TM = null, PL_TMV = '';
  function plTeams() {
    if (PL_TM && PL_TMV === plVer()) return PL_TM;
    const from = addMonths(plDataEnd().slice(0, 7), -5); const PF = D.planFull, c = k => PF.cols.indexOf(k);
    const where = new Map(PF.rows.map(r => [r[c('act')] + '|' + r[0], [plNorm(r[c('district')]), plNorm(r[c('commune')])]]));
    const bySite = new Map(), byCom = new Map(), byDis = new Map();
    const inc = (m, k, o) => { if (!m.has(k)) m.set(k, new Map()); const x = m.get(k); x.set(o, (x.get(o) || 0) + 1); };
    V.forEach(v => {
      if (!v.valid || !v.date || v.month < from) return; const org = DICT.org[v.org]; if (!org || /^\(Non renseign|^Autres/.test(org)) return;
      const k = (D.visitKeys || [])[v.i]; if (!k) return; const key = v.act + '|' + k.slice(k.indexOf('|') + 1, k.lastIndexOf('|'));
      inc(bySite, key, org); const w = where.get(key); if (w) { inc(byCom, w[0] + '|' + w[1], org); inc(byDis, w[0], org); }
    });
    const top = m => { if (!m) return null; let b = null, n = 0; m.forEach((x, o) => { if (x > n || (x === n && b !== null && o < b)) { b = o; n = x; } }); return b; };
    PL_TM = { of: s => { const a = top(bySite.get(plKey(s))); if (a) return { org: a, src: 'site' }; const b = top(byCom.get(plNorm(s.district) + '|' + plNorm(s.commune))); if (b) return { org: b, src: 'commune' }; const d = top(byDis.get(plNorm(s.district))); return d ? { org: d, src: 'district' } : null; } };
    PL_TMV = plVer(); return PL_TM;
  }
  function plTeamLabel(s) { return s.team ? s.team.org + ' · ' + s.fo : 'Non attribué · ' + s.fo; }

  // ------------------------------------------------------------------ plan validé (figé dans le fichier) : CUR.rbmPlan
  // { start, savedAt, by, version, months: { 'AAAA-MM': { savedAt, by, n, cells: { 'ACT|Code POI': { src, fo, team, R, cat } } } },
  //   manual: { 'ACT|Code POI|AAAA-MM': { op: 'add'|'remove', motif, by, date } }, misses: { 'ACT|Code POI|AAAA-MM': { motif, by, date } }, log: [] }
  // Clé = Code POI + activité (stable), jamais l'index de ligne (il change quand le registre est réimporté).
  function plStore(create) {
    let RP = D.rbmPlan;
    if (!RP && create) { RP = D.rbmPlan = { start: null, savedAt: null, by: null, version: 0, months: {}, manual: {}, misses: {}, log: [] }; if (CUR !== D) CUR.rbmPlan = RP; }
    if (RP) { RP.months = RP.months || {}; RP.manual = RP.manual || {}; RP.misses = RP.misses || {}; RP.log = RP.log || []; }
    return RP || null;
  }
  function plTouch(op, m, motif) { const RP = plStore(true); RP.version = (RP.version || 0) + 1; RP.log.push({ d: today(), by: SESSION.by || '—', op, m, motif: motif || '' }); SESSION.dirty = true; PLS.cache = null; render(); }

  // ------------------------------------------------------------------ score de risque d'un site : 5 facteurs détaillés (valeur réelle, règle, facteur, poids, points)
  function plScore(s, cfg, X) {
    const W = cfg.w;
    const l2 = s.hist.slice(-2), sv = l2.filter(v => v.score !== null && v.score !== undefined && !isNaN(v.score));
    const sc = sv.length ? mean(sv.map(v => v.score)) : null;
    const imp = s.lastV ? (DICT.imp[s.lastV.imp] || '') : ''; const g = imp ? (X.impGrade.get(s.act + '|' + imp) || null) : null;
    const nAl = s.lastV ? s.lastRisks.length : 0, days = s.nVis ? daysBetween(s.last, X.ref) : null;
    const F = [
      { k: 'score', l: 'Score de conformité faible', f: sc === null ? 0.5 : plClamp((cfg.target - sc) / 35, 0, 1),
        raw: sc === null ? (s.nVis ? 'aucun score exploitable aux 2 dernières visites' : 'jamais visité : score inconnu') + ' → valeur neutre 0,5' : (sv.length === 1 ? 'score de la dernière visite = ' : 'moyenne des 2 dernières visites = ') + fmt(sc, 1) + ' / 100 (' + sv.map(v => dFrUI(v.date) + ' : ' + fmt(v.score, 1)).join(' ; ') + ')' + (sv.length === 1 ? ' — score sur 1 seule visite (indicatif)' : ''),
        rule: '0 si ≥ ' + fmt(cfg.target) + ' (cible) ; 1 si ≤ ' + fmt(cfg.target - 35) + ' ; proportionnel entre les deux' },
      { k: 'alert', l: 'Alertes critiques', f: Math.min(1, nAl / 2),
        raw: s.lastV ? (nAl ? nAl + ' alerte(s) à la dernière visite (' + dFrUI(s.last) + ') : ' + riskNames(s).join(', ') : 'aucune alerte à la dernière visite (' + dFrUI(s.last) + ')') : 'jamais visité : aucune alerte connue',
        rule: '0 alerte = 0 ; 1 alerte = 0,5 ; 2 alertes ou plus = 1' },
      { k: 'never', l: 'Jamais visité', f: s.nVis ? 0 : 1,
        raw: s.nVis ? fmt(s.nVis) + ' visite(s) exploitable(s), la première le ' + dFrUI(s.hist[0].date) : 'aucune visite exploitable dans les données (jusqu’au ' + dFrUI(plDataEnd()) + ')', rule: '1 si aucune visite, sinon 0' },
      { k: 'recency', l: 'Délai depuis la dernière visite', f: s.nVis ? plClamp(days / X.rd, 0, 1) : 0,
        raw: s.nVis ? 'dernière visite le ' + dFrUI(s.last) + ', il y a ' + fmt(days) + ' jours (au ' + dFrUI(X.ref) + ')' : 'sans objet : jamais visité, déjà compté par « Jamais visité » (correction : le même fait n’est plus compté deux fois)',
        rule: '0 le jour de la visite ; 1 à partir de ' + fmt(X.rd) + ' jours' },
      { k: 'partner', l: 'Note du partenaire de mise en œuvre', na: !X.hasImp[s.act] || !/^[ABCD]$/.test(g || ''), f: g === 'D' ? 1 : g === 'C' ? 0.6 : g === 'B' ? 0.2 : 0,
        raw: !X.hasImp[s.act] ? 'sans objet : le formulaire ' + ACT[s.act].short + ' ne demande pas le partenaire de mise en œuvre — facteur retiré du calcul' : g && /^[ABCD]$/.test(g) ? 'partenaire de la dernière visite : ' + imp + ', note ' + g + ' (onglet Partenaires)' : s.lastV ? (imp ? 'partenaire ' + imp + ' non noté (moins de ' + GRADE_SCALES.imp.minN + ' visites) — facteur retiré' : 'partenaire non renseigné à la dernière visite — facteur retiré') : 'jamais visité : partenaire inconnu — facteur retiré',
        rule: 'A = 0 ; B = 0,2 ; C = 0,6 ; D = 1 ; sans objet ou inconnu : retiré (correction : n’ajoute plus 0,3)' }
    ];
    let wsum = 0; F.forEach(x => { x.w = Math.max(0, +W[x.k] || 0); if (!x.na) wsum += x.w; });
    let R = 0; F.forEach(x => { x.pts = !x.na && wsum ? x.w * x.f / wsum * 100 : 0; x.max = !x.na && wsum ? x.w / wsum * 100 : 0; R += x.pts; });
    const unmeasured = !s.nVis;
    const lvl = R >= cfg.thHigh ? 'high' : R >= cfg.thMed ? 'med' : 'low';
    const level = unmeasured ? (cfg.neverHigh ? 'high' : 'med') : lvl, cat = unmeasured ? 'never' : lvl;
    // RÈGLE MÉTIER : intervalle minimal entre deux suivis = fréquence RBM du niveau (paramètres RBM) ; la MMR ne le raccourcit jamais
    const fk = unmeasured ? (cfg.neverHigh ? 'high' : 'never') : lvl;
    const freq = cfg.freq[fk], freqSrc = 'intervalle RBM du niveau « ' + (fk === 'never' ? 'jamais visité' : PL_CAT[fk].toLowerCase()) + ' »' + (unmeasured && cfg.neverHigh ? ' (jamais visité traité comme élevé)' : '');
    const lastM = s.last ? s.last.slice(0, 7) : null, va = X.valAnchor.get(plKey(s)) || null;
    const anchorM = va && (!lastM || va > lastM) ? va : lastM, anchorSrc = !anchorM ? null : anchorM === lastM ? 'visite' : 'plan validé';
    const dueRaw = anchorM ? plAddActive(s, anchorM, freq) : null;
    const due = !anchorM ? X.months[0] : (dueRaw < X.months[0] ? X.months[0] : dueRaw), late = !!anchorM && dueRaw < X.CM;
    const comp = {}; F.forEach(x => { comp[x.k] = x.na ? 0 : x.f; });
    const why = F.filter(x => x.pts > 0.05).sort((a, b) => b.pts - a.pts).map(x => (x.k === 'score' ? (sc === null ? 'Score inconnu' : 'Score récent ' + fmt(sc) + '/100 (cible ' + fmt(cfg.target) + ')') : x.k === 'alert' ? nAl + ' alerte(s) à la dernière visite' : x.k === 'never' ? 'Jamais visité' : x.k === 'recency' ? 'Dernière visite il y a ' + fmt(days) + ' j' : 'Partenaire ' + imp + ' noté ' + g) + ' (+' + fmt(x.pts, 1) + ' pts)');
    const how = [];
    if (nAl) how.push('Vérifier les alertes : ' + riskNames(s).join(', '));
    if (s.lastV) { const dl = (D.domains[s.act] || []).map((d, j) => [d, s.lastV.doms[j]]).filter(x => x[1] !== null && x[1] !== undefined).sort((a, b) => a[1] - b[1]); if (dl.length && dl[0][1] < THR.good) how.push('Domaine le plus faible : ' + dl[0][0] + ' (' + fmt(dl[0][1]) + '/100)'); }
    if (!s.nVis) how.push('Première visite : vérifier la géolocalisation et l’ensemble des modules du formulaire');
    if (s.security === 3) how.push('Restriction de sécurité stricte (3) : autorisation et escorte à prévoir');
    if (s.security === 1) how.push('Restriction de sécurité modérée (1) : vérifier les consignes avant départ');
    const sortKey = unmeasured && cfg.neverHigh ? Math.max(R, cfg.thHigh) : R;
    return Object.assign({}, s, { R, level, cat, unmeasured, comp, factors: F, wsum, nScore: sv.length, sc, why: why.join(' ; ') || 'Aucun facteur de risque notable', how: how.join(' ; ') || 'Visite de routine',
      freq, freqSrc, anchorM, anchorSrc, nextPossible: dueRaw, due, dueRaw, late, monthsLate: late ? plMD(dueRaw, X.CM) : 0, imp, g, sortKey, team: X.teams.of(s), visM: new Set(s.hist.map(v => v.month)) });
  }

  // ------------------------------------------------------------------ MOTEUR UNIQUE : score, échéance, plan mois par mois sous la capacité de chaque bureau
  function plCompute(cfg) {
    const RP = plStore(false);
    const key = JSON.stringify(cfg) + '|' + plVer() + '|' + (RP ? RP.version || 0 : 0) + '|' + localDay();
    if (PLS.cache && PLS.ckey === key) return PLS.cache;
    const t0 = performance.now(), allS = siteRows(), ref = localDay(), CM = currentMonth();
    const impGrade = new Map(D.imps.rows.map(r => [r[0] + '|' + r[1], r[D.imps.cols.indexOf('grade')]]));
    const hasImp = Object.create(null); ACTS.forEach(a => { const S = D.spec && D.spec.acts && D.spec.acts[a]; hasImp[a] = !!(S && S.cfg && S.cfg.imp); });
    const capI = plCapacity(); const cap = Object.assign(Object.create(null), capI.auto); Object.keys(cfg.cap).forEach(f => { if (PL_SAFE(f)) cap[f] = Math.max(0, +cfg.cap[f] || 0); });
    const months = Array.from({ length: cfg.horizon }, (_, k) => addMonths(cfg.start, k));
    const valAnchor = new Map();   // dernière visite planifiée d'un mois validé AVANT l'horizon : elle compte comme ancrage de l'intervalle
    if (RP) { Object.keys(RP.months).forEach(m => { if (m >= months[0]) return; Object.keys(RP.months[m].cells || {}).forEach(k => { const mk = RP.manual[k + '|' + m]; if (mk && mk.op === 'remove') return; if (!valAnchor.has(k) || valAnchor.get(k) < m) valAnchor.set(k, m); }); });
      Object.keys(RP.manual).forEach(km => { const p = km.lastIndexOf('|'), k = km.slice(0, p), m = km.slice(p + 1); if (RP.manual[km].op === 'add' && RP.months[m] && m < months[0] && (!valAnchor.has(k) || valAnchor.get(k) < m)) valAnchor.set(k, m); }); }
    const X = { impGrade, hasImp, ref, rd: Math.max(30, cfg.recencyDays), months, CM, teams: plTeams(), valAnchor };
    const all = allS.map(s => plScore(s, cfg, X));
    const scored = all.filter(s => s.actif && s.security < 99);
    const byKey = new Map(all.map(s => [plKey(s), s])), byJ = new Map(all.map(s => [s.j, s]));
    const plan = [], used = {}, why = new Map(), next = new Map(scored.map(s => [s, s.due]));
    const planned = new Set(), capHit = new Set(), inaHit = new Set(), remHit = new Set();
    const note = (s, m, st, txt) => { let a = why.get(s.j); if (!a) why.set(s.j, a = {}); a[m] = { st, txt }; };
    const actCov = Object.create(null); ACTS.forEach(a => { const l = scored.filter(s => s.act === a); actCov[a] = l.length ? l.filter(s => s.nVis).length / l.length : 1; });
    const man = (RP && RP.manual) || {};
    const ck = s => s.kDis + '|' + plNorm(s.commune);
    const take = (s, m, src, txt) => { plan.push({ m, s, src }); planned.add(s); next.set(s, plAddActive(s, m, s.freq)); note(s, m, src === 'manuel' || src === 'forcé' ? 'manual' : 'planned', txt); };
    months.forEach(m => {
      const fr = RP && RP.months && RP.months[m];
      const adds = [], byFo = new Map();
      scored.forEach(s => {
        const mk = man[plKey(s) + '|' + m];
        if (mk && mk.op === 'add') { if (mk.force || next.get(s) <= m) { adds.push(s); return; } note(s, m, 'refused', 'ajout manuel ignoré : intervalle RBM non écoulé (' + s.freq + ' mois) — prochaine visite possible à partir de ' + monthLabel(next.get(s))); return; }
        if (fr && fr.cells && fr.cells[plKey(s)] && !(mk && mk.op === 'remove')) return;   // retenu par le plan validé (traité plus bas)
        if (next.get(s) > m) { note(s, m, 'notdue', 'intervalle RBM non écoulé (' + s.freq + ' mois depuis ' + (planned.has(s) ? 'la visite planifiée précédente' : s.anchorSrc === 'plan validé' ? 'la visite du plan validé de ' + monthLabel(s.anchorM) : 'la dernière visite') + ') : prochaine visite possible à partir de ' + monthLabel(next.get(s))); return; }
        if (mk && mk.op === 'remove') { note(s, m, 'removed', 'retiré du plan à la main : ' + mk.motif + ' (' + mk.by + ', ' + mk.date + ')'); remHit.add(s); return; }
        if (s.security >= 99) { note(s, m, 'forbidden', 'zone interdite (sécurité 99)'); inaHit.add(s); return; }
        if (!eligible(s, m)) { note(s, m, 'inactive', 'dû mais inactif ce mois-là (grille d’activation « ' + (s.months[+m.slice(5) - 1] === '0' ? 'Non' : 'non renseignée') + ' » pour ' + monthLabel(m) + ') : échéance reportée'); inaHit.add(s); return; }
        if (fr) { note(s, m, 'frozen', 'dû, non retenu dans le plan validé de ' + monthLabel(m) + ' (validé le ' + fr.savedAt + ') : reporté'); capHit.add(s); return; }
        if (!byFo.has(s.fo)) byFo.set(s.fo, []); byFo.get(s.fo).push(s);
      });
      if (fr) {
        Object.keys(fr.cells || {}).forEach(k => { const s = byKey.get(k); if (!s) return; const mk = man[k + '|' + m]; if (mk && mk.op === 'remove') { note(s, m, 'removed', 'retiré du plan validé : ' + mk.motif + ' (' + mk.by + ', ' + mk.date + ')'); remHit.add(s); return; } take(s, m, 'validé', 'planifié : plan de ' + monthLabel(m) + ' validé le ' + fr.savedAt + ' par ' + (fr.by || '—')); });
        adds.forEach(s => { const mk = man[plKey(s) + '|' + m]; take(s, m, mk.force ? 'forcé' : 'manuel', (mk.force ? 'ajout FORCÉ hors intervalle RBM au plan validé : ' : 'ajouté à la main au plan validé : ') + mk.motif); });
        const cnt = new Map(); plan.filter(p => p.m === m).forEach(p => cnt.set(p.s.fo, (cnt.get(p.s.fo) || 0) + 1));
        new Set(Object.keys(cap).concat(Array.from(cnt.keys()))).forEach(fo => { used[m + '|' + fo] = { planned: cnt.get(fo) || 0, cap: Math.round(+cap[fo] || 0), demand: cnt.get(fo) || 0, frozen: true }; });
        return;
      }
      const comN = new Map(); byFo.forEach(l => l.forEach(s => comN.set(ck(s), (comN.get(ck(s)) || 0) + 1)));
      const cmpS = (a, b) => (Math.round(b.sortKey * 10) - Math.round(a.sortKey * 10)) || (b.monthsLate - a.monthsLate) || ((comN.get(ck(b)) || 0) - (comN.get(ck(a)) || 0)) || (actCov[a.act] - actCov[b.act]) || (a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0);
      new Set(Array.from(byFo.keys()).concat(adds.map(s => s.fo))).forEach(fo => {
        const l = (byFo.get(fo) || []).sort(cmpS), ad = adds.filter(s => s.fo === fo);
        const c = Math.max(0, Math.round(+cap[fo] || 0)); let n = 0; const perAct = Object.create(null);
        ad.forEach(s => { const mk = man[plKey(s) + '|' + m]; take(s, m, mk.force ? 'forcé' : 'manuel', (mk.force ? 'ajout FORCÉ hors intervalle RBM (administrateur) : ' : 'ajouté à la main : ') + mk.motif + ' (' + mk.by + ', ' + mk.date + ') — compte dans la capacité'); n++; perAct[s.act] = (perAct[s.act] || 0) + 1; });
        l.forEach((s, i) => {
          const ca = cfg.capAct[fo + '|' + s.act], capA = ca === undefined ? Infinity : Math.max(0, +ca);
          if (n < c && (perAct[s.act] || 0) < capA) { take(s, m, 'rbm', 'planifié : rang ' + (i + 1) + ' sur ' + l.length + ' site(s) dus du bureau ' + fo + ' (capacité ' + c + ' visites par mois)'); n++; perAct[s.act] = (perAct[s.act] || 0) + 1; }
          else { capHit.add(s); note(s, m, 'cap', n >= c ? 'dû, non retenu : capacité du bureau ' + fo + ' atteinte (' + n + ' / ' + c + ' ; rang ' + (i + 1) + ' sur ' + l.length + ' sites dus) — reporté au mois suivant' : 'dû, non retenu : capacité ' + ACT[s.act].short + ' du bureau ' + fo + ' atteinte (' + capA + ') — reporté'); }
        });
        used[m + '|' + fo] = { planned: n, cap: c, demand: l.length + ad.length, adds: ad.length };
      });
    });
    const overflow = scored.filter(s => capHit.has(s) && !planned.has(s));
    const dueInactive = scored.filter(s => inaHit.has(s) && !planned.has(s) && !capHit.has(s));
    const removed = scored.filter(s => remHit.has(s) && !planned.has(s));
    const excluded = all.filter(s => !(s.actif && s.security < 99));
    const PY = +planYearUI(); const noGrid = months.filter(m => +m.slice(0, 4) !== PY && !all.some(s => +s.annee === +m.slice(0, 4)));
    // plancher MMR : nombre minimal de visites sur l'année du plan (et au plus N mois entre deux visites) ; l'intervalle RBM l'emporte toujours
    const mmrBad = [], yEnd = PY + '-12';
    scored.forEach(s => {
      const x = cfg.mmr[s.act]; if (!x || (!x.minYear && !x.floor)) return;
      const done = s.hist.filter(v => +v.date.slice(0, 4) === PY).length; let k = 0, mm = s.nextPossible && s.nextPossible > CM ? s.nextPossible : CM, g = 0;
      while (mm <= yEnd && g < 36) { g++; if (eligible(s, mm)) { k++; mm = plAddActive(s, mm, s.freq); } else mm = addMonths(mm, 1); }
      const r1 = !!x.minYear && done + k < x.minYear, r2 = !!x.floor && s.freq > x.floor;
      s.mmrChk = { minYear: x.minYear || null, floor: x.floor || null, done, possible: k, ok: !(r1 || r2),
        txt: (x.minYear ? 'plancher MMR ' + x.minYear + ' visite(s) sur ' + PY + ' : ' + done + ' réalisée(s) + au plus ' + k + ' encore possible(s) avec l’intervalle RBM de ' + s.freq + ' mois' + (r1 ? ' → inatteignable' : ' → atteignable') : '') +
          (x.floor ? (x.minYear ? ' ; ' : '') + 'au moins 1 visite tous les ' + x.floor + ' mois : ' + (r2 ? 'inatteignable, l’intervalle RBM (' + s.freq + ' mois) est plus long' : 'compatible avec l’intervalle RBM (' + s.freq + ' mois)') : '') };
      if (r1 || r2) mmrBad.push(s);
    });
    const R = { scored, plan, used, months, cap, overflow, excluded, dueInactive, removed, mmrBad, why, all, byKey, byJ, capInfo: capI, ref, CM, dataEnd: plDataEnd(), frozen: months.filter(m => RP && RP.months && RP.months[m]), noGrid, cfg, ms: Math.round(performance.now() - t0) };
    PLS.cache = R; PLS.ckey = key; return R;
  }

  // ------------------------------------------------------------------ indicateurs d'exécution (réutilisables par d'autres onglets)
  // plExecution({ filter(site) → bool, sites, m0, m1 }) : par défaut, filtres globaux (activité, bureau, région, district) et période F.m0..F.m1.
  // (1) Exécution du plan : visites dues réalisées / visites dues ; (2) sites actifs suivis dans leur fréquence RBM.
  function plExecution(opt) {
    opt = opt || {};
    const R = rbmCompute(rbmCfg());
    let list = opt.sites || siteFiltered(R.scored); if (opt.filter) list = list.filter(opt.filter);
    const lc = plLastComplete(), CM = currentMonth();
    const m0 = opt.m0 || F.m0 || lc; const m1 = [opt.m1 || F.m1 || lc, lc, addMonths(CM, -1)].sort()[0];
    const months = []; for (let m = m0; m <= m1 && months.length < 60; m = addMonths(m, 1)) months.push(m);
    let dues = 0, done = 0, late = 0; const byCat = {}, byFo = {}, byAct = {};
    const inc = (o, k, d, x) => { if (!PL_SAFE(k)) return; const a = o[k] = o[k] || { dues: 0, done: 0 }; a.dues += d; a.done += x; };
    if (months.length) list.forEach(s => {
      const f = s.freq, vis = s.visM; let lastBefore = null; for (const v of s.hist) { if (v.month < months[0]) lastBefore = v.month; else break; }
      let nx = lastBefore ? plAddActive(s, lastBefore, f) : months[0];
      for (let i = 0; i < months.length; i++) {
        const m = months[i];
        if (nx > m) { if (vis.has(m)) nx = plAddActive(s, m, f); continue; }        // visite hors échéance : le calendrier repart de cette visite
        if (!eligible(s, m)) continue;                                           // inactif ce mois : l'échéance est reportée
        dues++; inc(byCat, s.cat, 1, 0); inc(byFo, s.fo, 1, 0); inc(byAct, s.act, 1, 0);
        const ok = vis.has(m) ? m : (f >= 2 && i + 1 < months.length && vis.has(months[i + 1]) ? months[i + 1] : null);
        if (ok) { done++; byCat[s.cat].done++; byFo[s.fo].done++; byAct[s.act].done++; if (ok !== m) { late++; i++; } nx = plAddActive(s, ok, f); } else nx = plAddActive(s, m, f);
      }
    });
    const refM = months.length ? months[months.length - 1] : null; let inN = 0, inOk = 0; const inCat = {};
    if (refM) list.forEach(s => { if (!eligible(s, refM)) return; inN++; let lv = null; for (const v of s.hist) { if (v.month <= refM) lv = v.month; else break; } const ok = !!lv && plMD(lv, refM) < s.freq; if (ok) inOk++; const a = inCat[s.cat] = inCat[s.cat] || { n: 0, N: 0 }; a.N++; if (ok) a.n++; });
    return { months, m0, m1, dues, done, late, byCat, byFo, byAct, inFreq: { n: inOk, N: inN, ref: refM, byCat: inCat }, incomplete: R.capInfo.incomplete, sites: list.length,
      limits: ['Le niveau de risque et la fréquence sont ceux calculés aujourd’hui, appliqués aux mois passés (le niveau d’alors n’est pas conservé).', 'Une échéance est « réalisée » si une visite exploitable a lieu le mois dû, ou le mois suivant pour une fréquence de 2 mois ou plus.', 'Les mois où le site est inactif (grille « Non ») ne créent pas d’échéance.'] };
  }
  // plans validés : prévu / réalisé par mois et par bureau
  function plValidatedExec(list) {
    const RP = plStore(false); if (!RP) return [];
    const R = rbmCompute(rbmCfg()); const keys = new Set(list.map(plKey)); const out = [];
    Object.keys(RP.months).sort().forEach(m => {
      const fr = RP.months[m]; const cells = Object.keys(fr.cells || {}).filter(k => keys.has(k) && !(RP.manual[k + '|' + m] && RP.manual[k + '|' + m].op === 'remove'));
      Object.keys(RP.manual).forEach(k => { const p = k.lastIndexOf('|'); if (k.slice(p + 1) === m && RP.manual[k].op === 'add' && keys.has(k.slice(0, p)) && cells.indexOf(k.slice(0, p)) < 0) cells.push(k.slice(0, p)); });
      const byFo = new Map(); cells.forEach(k => { const s = R.byKey.get(k); const fo = s ? s.fo : (fr.cells[k] || {}).fo || '?'; if (!byFo.has(fo)) byFo.set(fo, { N: 0, n: 0, miss: 0, motif: 0 }); const o = byFo.get(fo); o.N++; if (s && s.visM.has(m)) o.n++; else if (m < currentMonth()) { o.miss++; if (RP.misses[k + '|' + m]) o.motif++; } });
      byFo.forEach((o, fo) => out.push({ m, fo, savedAt: fr.savedAt, by: fr.by, ...o }));
    });
    return out;
  }

  // ------------------------------------------------------------------ demande RBM et capacité d'une sélection
  function plDemand(list, months) { const per = months.map(m => { let v = 0, n = 0; list.forEach(s => { if (eligible(s, m)) { v += 1 / Math.max(1, s.freq); n++; } }); return { m, v, n }; }); return { per, avg: per.length ? per.reduce((a, x) => a + x.v, 0) / per.length : 0 }; }
  function plCapOf(R, list) { const fos = new Set(list.map(s => s.fo)); if (F.fo >= 0) { fos.clear(); fos.add(DICT.fo[F.fo]); } let c = 0; fos.forEach(f => { c += Math.max(0, +R.cap[f] || 0); }); return { total: c, fos: Array.from(fos).sort() }; }
  function plCatBadge(s) { const b = el('span', { class: 'cell bg-' + PL_CATC[s.cat], text: PL_CAT[s.cat] + (s.unmeasured ? '' : ' ' + fmt(s.R)) }); bindTip(b, () => s.unmeasured ? 'Jamais visité : risque NON mesuré (score théorique ' + fmt(s.R, 1) + '/100, sans observation)' + '\nIntervalle minimal : ' + s.freq + ' mois (' + s.freqSrc + ')\nCliquez la ligne pour le détail.' : 'Score de risque ' + fmt(s.R, 1) + ' / 100 → niveau ' + PL_CAT[s.cat].toLowerCase() + '\nIntervalle minimal : ' + s.freq + ' mois (' + s.freqSrc + ')\nCliquez la ligne pour le détail des 5 facteurs.'); return b; }
  function plIntervalText(s) {
    const lvl = s.cat === 'never' ? 'jamais visité' : PL_CAT[s.cat].toLowerCase(), CM = currentMonth();
    const np = !s.nextPossible ? 'maintenant (jamais visité)' : s.nextPossible <= CM ? 'maintenant (' + monthLabel(CM) + ' ; possible depuis ' + monthLabel(s.nextPossible) + ')' : monthLabel(s.nextPossible);
    return 'Intervalle minimal : ' + s.freq + ' mois (niveau ' + lvl + ', RBM) · dernière visite ' + (s.last ? 'le ' + dFrUI(s.last) : 'jamais') + (s.anchorSrc === 'plan validé' ? ' · visite du plan validé de ' + monthLabel(s.anchorM) : '') + ' · prochaine visite possible à partir de ' + np;
  }
  function plLevelsText(cfg) { return 'élevé ≥ ' + cfg.thHigh + ' · moyen ' + cfg.thMed + '–' + cfg.thHigh + ' · faible < ' + cfg.thMed + ' · jamais visité = catégorie à part (risque non mesuré)'; }

  // ------------------------------------------------------------------ ÉCRAN « Planification »
  const PL_SUBS = [['prio', 'Plan du mois'], ['grid', 'Grille'], ['cap', 'Capacité'], ['cfg', 'Réglages'], ['exp', 'Exports']];
  function plRenderPlanning(main) {
    const cfg = rbmCfg(), R = rbmCompute(cfg), sc = siteFiltered(R.scored), all = siteFiltered(R.all);
    plBanner(main, R, cfg, sc);
    const bar = el('div', { class: 'pl-subs', role: 'tablist', 'aria-label': 'Vues de la planification' });
    PL_SUBS.forEach(([k, l]) => { const b = el('button', { type: 'button', role: 'tab', class: 'pl-sub' + (PLS.sub === k ? ' on' : ''), 'aria-selected': String(PLS.sub === k), text: l }); b.addEventListener('click', () => { PLS.sub = SESSION.plSub = k; PLS.page = 0; render(); }); bar.appendChild(b); });
    main.appendChild(bar);
    ({ prio: plViewPrio, grid: plViewGrid, cap: plViewCap, cfg: plViewCfg, exp: plViewExp }[PLS.sub] || plViewPrio)(main, R, cfg, sc, all);
  }
  function plGo(sub) { PLS.sub = SESSION.plSub = sub; PLS.page = 0; render(); window.scrollTo(0, 0); }
  function plCard(title, info, body, cls) { const c = card(title, null, body, cls); if (info) c.querySelector('.ch').appendChild(infoBtn(info)); return c; }
  function plH3(title, info) { return el('h3', { class: 'pl-h3' }, [title, info ? infoBtn(info) : null]); }
  function plGoTab(t) { TAB = t; buildTabs(); render(); window.scrollTo(0, 0); }
  function plBanner(main, R, cfg, sc) {
    const J = new Set(sc.map(s => s.j)), ci = R.capInfo, d = plDemand(sc, R.months), C = plCapOf(R, sc);
    const cnt = k => sc.filter(s => s.cat === k).length, fq = k => every(cfg.freq[k]);
    const over = R.overflow.filter(s => J.has(s.j)), ina = R.dueInactive.filter(s => J.has(s.j)), pl = R.plan.filter(p => J.has(p.s.j));
    const nMmr = Object.keys(cfg.mmr).length, last = R.months[R.months.length - 1], k = C.total ? d.avg / C.total : Infinity;
    const detail = [
      'Demande : environ ' + fmt(d.avg) + ' visites par mois sur ' + monthLabel(R.months[0]) + ' à ' + monthLabel(last) + '. ' + fmt(cnt('high')) + ' sites à risque élevé ' + fq('high') + ', ' + fmt(cnt('med')) + ' moyens ' + fq('med') + ', ' + fmt(cnt('low')) + ' faibles ' + fq('low') + ', ' + fmt(cnt('never')) + ' jamais visités ' + (cfg.neverHigh ? fq('high') + ' (traités comme élevés)' : fq('never')) + '.' + (nMmr ? ' Plancher MMR défini pour ' + nMmr + ' activité(s).' : ''),
      'L’intervalle minimal entre deux suivis est la fréquence RBM du niveau ; la MMR ne le raccourcit jamais.',
      'Capacité : ' + fmt(C.total) + ' visites par mois (' + (C.fos.length === 1 ? 'bureau ' + C.fos[0] : fmt(C.fos.length) + ' bureaux') + '), moyenne des visites réalisées en ' + ci.ms.map(monthLabel).join(', ') + ', les 3 derniers mois complets.' + (ci.incomplete ? ' ' + monthLabel(ci.incomplete.m) + ' est exclu : mois incomplet (données jusqu’au ' + dFrUI(ci.incomplete.end) + ', ' + fmt(ci.incomplete.n) + ' visites).' : '') + (Object.keys(cfg.cap).length ? ' Capacité saisie à la main pour ' + fmt(Object.keys(cfg.cap).length) + ' bureau(x).' : ''),
      !C.total ? 'Capacité nulle : aucun site ne peut être planifié. Saisissez une capacité dans les réglages.' : k > 1.05 ? 'Le plan ne peut retenir qu’environ 1 visite due sur ' + fmt(k, 1) + ' : ' + fmt(over.length) + ' sites dus resteront sans visite d’ici ' + monthLabel(last) + ', faute de capacité. ' + fmt(ina.length) + ' sites dus tombent un mois où la grille dit Non.' : 'La capacité couvre la demande moyenne. ' + fmt(over.length) + ' sites dus ne sont pas retenus certains mois, ' + fmt(ina.length) + ' sont inactifs le mois dû.',
      'Sources : registre des sites (onglet Sites), visites exploitables jusqu’au ' + dFrUI(R.dataEnd) + ', capacité des bureaux. Calcul du ' + dFrUI(R.ref) + ', jour local de Madagascar ; les mois passés ne montrent que le réalisé.' + (F.act !== 'ALL' ? ' La capacité d’un bureau est partagée entre activités : avec un filtre d’activité, les sites retenus dépendent aussi des autres activités.' : '')].join('\n\n');
    const line = el('div', { class: 'pl-line' + (k > 1.05 || !C.total ? ' pl-warn' : '') }, [
      el('span', { class: 'pl-l1', text: 'Demande ≈ ' + fmt(d.avg) + ' visites/mois' }), el('span', { class: 'pl-l2', text: 'capacité ' + fmt(C.total) }),
      C.total && k > 1.05 ? el('span', { class: 'pl-l3', text: '1 visite due sur ' + fmt(k, 1) + ' retenue' }) : null, infoBtn(detail),
      el('span', { class: 'pl-acts' }, [btn('Fréquences', () => plGo('cfg'), 'sm'), btn('Capacité', () => plGo('cap'), 'sm'), btn('Dus non retenus', () => { PLS.focus = 'cap'; plGo('prio'); }, 'sm')])]);
    main.appendChild(line);
    const chips = [];
    (cfg.warn || []).forEach(w => chips.push(el('span', { class: 'pl-wchip' }, ['Seuils corrigés', infoBtn(w)])));
    R.noGrid.forEach(m => chips.push(el('span', { class: 'pl-wchip' }, ['Grille ' + m.slice(0, 4) + ' non renseignée', infoBtn(monthLabel(m) + ' : les sites y sont supposés actifs. Importez le registre ' + m.slice(0, 4) + ' pour confirmer.'), btn('Importer', () => plGoTab('data'), 'sm')])));
    const sea = plSeasonality(); if (sea.length) chips.push(el('span', { class: 'pl-wchip' }, ['Grille d’activation à vérifier', infoBtn(sea.length + ' mois × activité sans visite ou presque : ' + sea.map(p => ACT[p.act].short + ' ' + monthLabel(p.m) + ' (' + p.n + ')').join(', ') + '.'), btn('Voir', () => plGoTab('sites'), 'sm')]));
    const mb = R.mmrBad.filter(s => J.has(s.j)); if (mb.length) chips.push(el('span', { class: 'pl-wchip' }, ['Plancher MMR inatteignable : ' + fmt(mb.length) + ' sites', infoBtn('L’intervalle RBM l’emporte sur le plancher MMR (' + Array.from(new Set(mb.map(s => ACT[s.act].short))).join(', ') + ').'), btn('Voir', () => plGo('cap'), 'sm')]));
    if (chips.length) main.appendChild(el('div', { class: 'pl-warns' }, chips));
    const def = t => t + '\nNiveaux : ' + plLevelsText(cfg) + '.';
    main.appendChild(el('div', { class: 'kpis' }, [
      kpi(fmt(cnt('high')), 'Risque élevé', fq('high'), 'bad', def('Sites visités dont le score de risque (0 à 100) atteint ' + cfg.thHigh + '. Visite ' + fq('high') + '.')),
      kpi(fmt(cnt('med')), 'Risque moyen', fq('med'), 'mid', def('Sites visités au score de risque entre ' + cfg.thMed + ' et ' + cfg.thHigh + '. Visite ' + fq('med') + '.')),
      kpi(fmt(cnt('low')), 'Risque faible', fq('low'), 'good', def('Sites visités au score de risque inférieur à ' + cfg.thMed + '. Visite ' + fq('low') + '.')),
      kpi(fmt(cnt('never')), 'Jamais visités', 'sur ' + fmt(sc.length) + ' sites actifs', 'na', 'Sites actifs sans aucune visite exploitable. Leur risque n’est pas mesuré : ils forment une catégorie à part, visitée ' + (cfg.neverHigh ? fq('high') + ' (traités comme élevés)' : fq('never')) + '.'),
      kpi(fmt(pl.length), 'Visites planifiées', monthLabel(R.months[0]) + ' à ' + monthLabel(last), null, 'Visites retenues sur ' + R.months.map(monthLabel).join(', ') + ', dans la limite de la capacité de chaque bureau.' + (R.frozen.length ? ' Plans validés repris tels quels : ' + R.frozen.map(monthLabel).join(', ') + '.' : '')),
      kpi(fmt(over.length), 'Dus non retenus', 'faute de capacité', over.length ? 'bad' : 'good', fmt(over.length) + ' sites sur ' + fmt(sc.length) + ' sont dus et actifs le mois dû, mais restent sans visite sur tout l’horizon parce que la capacité du bureau est atteinte. Leviers : fréquences, capacité, horizon.'),
      kpi(fmt(ina.length), 'Dus inactifs', 'grille à Non le mois dû', ina.length ? 'mid' : 'good', 'Sites dont l’échéance tombe un mois où la grille d’activation dit Non (ou n’est pas renseignée). Ce n’est pas un manque de capacité.')]));
  }

  // ---- vue « Priorités du mois » : tournées par commune, sites planifiés, dus non planifiés, dus inactifs
  function plViewPrio(main, R, cfg, sc) {
    const J = new Set(sc.map(s => s.j)); const m = R.months.indexOf(PLS.month) >= 0 ? PLS.month : R.months[0]; PLS.month = m;
    const msel = el('select', { 'aria-label': 'Mois' }); R.months.forEach(x => { const o = el('option', { value: x, text: monthLabel(x) + (R.frozen.indexOf(x) >= 0 ? ', validé' : '') }); if (x === m) o.selected = true; msel.appendChild(o); });
    msel.addEventListener('change', () => { PLS.month = msel.value; render(); });
    const pl = R.plan.filter(p => p.m === m && J.has(p.s.j)).map(p => Object.assign({ src: p.src }, p.s));
    const st = s => { const w = R.why.get(s.j); return w && w[m] ? w[m].st : null; };
    const capL = sc.filter(s => st(s) === 'cap' || st(s) === 'frozen').sort((a, b) => b.sortKey - a.sortKey), inaL = sc.filter(s => st(s) === 'inactive' || st(s) === 'forbidden');
    const g = new Map();
    pl.forEach(s => { const k = s.kDis + '|' + plNorm(s.commune); if (!g.has(k)) g.set(k, { district: s.district, commune: s.commune, fo: new Set(), teams: new Set(), n: 0, high: 0, never: 0, ad: 0, cap: 0 }); const o = g.get(k); o.fo.add(s.fo); o.teams.add(s.team ? s.team.org : 'Non attribué'); o.n++; if (s.cat === 'high') o.high++; if (s.cat === 'never') o.never++; o.ad += 1 / plVpd(cfg, s.act); });
    capL.forEach(s => { const o = g.get(s.kDis + '|' + plNorm(s.commune)); if (o) o.cap++; });
    const tours = Array.from(g.values()).sort((a, b) => (b.high - a.high) || (b.n - a.n));
    const vObs = plObsVpd();
    const order = 'Ordre de sélection dans un bureau : score de risque décroissant. À égalité : retard le plus long, puis commune qui regroupe le plus de sites dus ce mois (tournées), puis activité la moins couverte, puis identifiant.';
    main.appendChild(el('div', { class: 'frow pl-mrow' }, [el('label', { class: 'fld' }, ['Mois', msel]), infoBtn(order)]));
    main.appendChild(plCard('Tournées par commune', 'Sites retenus en ' + monthLabel(m) + ', regroupés par district et commune.\nJournées-agent = visites ÷ visites par jour et par agent (' + (cfg.vpd ? fmt(cfg.vpd, 1) + ', saisi' : 'médiane observée ' + fmt(vObs.med, 1) + ' sur ' + fmt(vObs.n) + ' couples agent × jour') + ', réglable par activité).\nÉquipe : organisation de suivi qui a travaillé sur ces sites ces 6 derniers mois, sinon dans la commune, sinon dans le district.\n\n' + order, [
      tours.length ? table([{ k: 'district', t: 'District' }, { k: 'commune', t: 'Commune' }, { k: 'fo', t: 'Bureau', fmt: r => Array.from(r.fo).join(', ') }, { k: 'teams', t: 'Équipe', fmt: r => Array.from(r.teams).join(', ') },
        { k: 'n', t: 'Visites', num: 1 }, { k: 'high', t: 'Risque élevé', num: 1 }, { k: 'never', t: 'Jamais visités', num: 1 }, { k: 'ad', t: 'Journées-agent', num: 1, fmt: r => fmt(Math.ceil(r.ad)) }, { k: 'cap', t: 'Dus non retenus', num: 1, title: 'Sites dus de la commune non retenus faute de capacité' }], tours, { sortK: 5, dir: -1 }) : note('Aucune visite planifiée ce mois.', 'warn')], 'wide'));
    const cols = (withSrc) => [{ k: 'publicId', t: 'ID site' }, { k: 'fo', t: 'Bureau' }, { k: 'team', t: 'Équipe', fmt: s => s.team ? s.team.org : 'Non attribué', sortVal: s => s.team ? s.team.org : '' }, { k: 'act', t: 'Activité', fmt: s => ACT[s.act].short },
      { k: 'localite', t: 'Site', fmt: s => s.localite + ' (' + s.commune + ')' }, { k: 'district', t: 'District' }, { k: 'cat', t: 'Risque', fmt: plCatBadge, sortVal: s => s.sortKey },
      { k: 'why', t: 'Pourquoi', fmt: s => el('span', { class: 'why', text: s.why }) }, { k: 'last', t: 'Dernière visite', fmt: s => s.last ? dFrUI(s.last) : 'jamais', sortVal: s => s.last || '' }, { k: 'freq', t: 'Intervalle', fmt: s => s.freq + ' mois', sortVal: s => s.freq, title: 'Intervalle minimal entre deux suivis (RBM)' }]
      .concat(withSrc ? [{ k: 'src', t: 'Origine', fmt: s => s.src === 'rbm' ? 'calcul' : s.src }] : [{ k: 'st', t: 'Raison', fmt: s => { const w = (R.why.get(s.j) || {})[m]; const sp = el('span', { text: !w ? '' : w.st === 'cap' ? 'capacité atteinte' : w.st === 'frozen' ? 'hors plan validé' : w.st === 'forbidden' ? 'zone interdite' : 'grille à Non' }); if (w) bindTip(sp, () => w.txt); return sp; } }]);
    const cap = (l) => l.length > 300 ? l.slice(0, 300) : l;
    main.appendChild(plCard(fmt(pl.length) + ' sites retenus', 'Le détail du score (5 facteurs), de l’intervalle et de la raison du mois s’ouvre sur chaque ligne.', [table(cols(true), pl, { sortK: 6, dir: -1, onRow: s => plSiteDrawer(s.j, m) })], 'wide'));
    main.lastChild.querySelector('.tw').classList.add('compact');
    const capCard = plCard(fmt(capL.length) + ' dus non retenus', 'Sites dus et actifs en ' + monthLabel(m) + ', non retenus parce que la capacité du bureau est atteinte.' + (capL.length > 300 ? ' Les 300 premiers sont affichés ; la liste complète est dans l’export Plan de suivi.' : ''), [capL.length ? table(cols(false), cap(capL), { sortK: 6, dir: -1, onRow: s => plSiteDrawer(s.j, m) }) : note('Aucun.', 'hint')], 'wide');
    main.appendChild(capCard); if (capL.length) capCard.querySelector('.tw').classList.add('compact');
    if (PLS.focus === 'cap') { PLS.focus = null; setTimeout(() => capCard.scrollIntoView({ block: 'start' }), 30); }
    const inaCard = plCard(fmt(inaL.length) + ' dus inactifs', 'Échéance atteinte mais pas de visite possible ce mois : grille d’activation à Non ou non renseignée, ou zone interdite. Ce n’est pas un manque de capacité ; l’échéance passe au premier mois actif.', [inaL.length ? table(cols(false), cap(inaL), { sortK: 6, dir: -1, onRow: s => plSiteDrawer(s.j, m) }) : note('Aucun.', 'hint')], 'wide');
    main.appendChild(inaCard); if (inaL.length) inaCard.querySelector('.tw').classList.add('compact');
  }

  // ---- vue « Plan de suivi » : grille sites × mois, un état par case (couleur + symbole + libellé), totaux sur toutes les lignes filtrées
  const PL_ST = {
    vis: ['✓', 'Visité (visite exploitable ce mois)'], off: ['✓°', 'Visité hors plan validé'], pln: ['●', 'Planifié'], add: ['✚', 'Ajouté à la main (motif)'], frc: ['✚!', 'Ajout forcé hors intervalle RBM (administrateur, motif)'], miss: ['✕', 'Planifié (plan validé) non réalisé'],
    cap: ['◌', 'Dû non planifié (capacité atteinte)'], ina: ['▒', 'Inactif ce mois (grille « Non » ou site désactivé)'], forb: ['⊘', 'Zone interdite (sécurité 99)'], rem: ['−', 'Retiré du plan (motif)'], none: ['', 'Pas dû / rien de prévu']
  };
  function plGridCtx(R) { const RP = plStore(false); return { R, RP, man: (RP && RP.manual) || {}, CM: currentMonth(), planned: new Set(R.plan.map(p => p.s.j + '|' + p.m)), hz: new Set(R.months) }; }
  function plCellState(s, m, X) {
    const fr = X.RP && X.RP.months[m], k = plKey(s), mk = X.man[k + '|' + m];
    const inFr = !!fr && ((!!(fr.cells || {})[k] && !(mk && mk.op === 'remove')) || !!(mk && mk.op === 'add'));
    const inPlan = X.planned.has(s.j + '|' + m) || inFr;
    if (s.visM && s.visM.has(m)) return fr && !inFr ? 'off' : 'vis';
    if (m < X.CM) return inFr ? 'miss' : s.security >= 99 ? 'forb' : (!s.actif || !monthActive(s, m)) ? 'ina' : 'none';
    if (s.security >= 99) return 'forb';
    if (inPlan) return mk && mk.op === 'add' ? (mk.force ? 'frc' : 'add') : 'pln';
    if (mk && mk.op === 'remove') return 'rem';
    if (!s.actif || !monthActive(s, m)) return 'ina';
    const w = X.R.why.get(s.j); if (w && w[m] && (w[m].st === 'cap' || w[m].st === 'frozen')) return 'cap';
    return 'none';
  }
  function plGridMonths(R) { if (PLS.mode === 'year') { const y = planYearUI(); return Array.from({ length: 12 }, (_, i) => y + '-' + String(i + 1).padStart(2, '0')); } return R.months.slice(); }
  function plSearch(list) { const q = plNorm(PLS.q); return q ? list.filter(s => plNorm(s.publicId + ' ' + s.code + ' ' + s.localite + ' ' + s.commune + ' ' + s.district + ' ' + s.fokontany).indexOf(q) >= 0) : list; }
  function plViewGrid(main, R, cfg, sc, all) {
    const X = plGridCtx(R), months = plGridMonths(R), rows = plSearch(all).slice().sort((a, b) => (a.actif === b.actif ? 0 : a.actif ? -1 : 1) || (b.sortKey - a.sortKey) || (a.publicId < b.publicId ? -1 : 1));
    // états de TOUTES les lignes filtrées (totaux et légende), puis une page affichée
    const ST = rows.map(s => months.map(m => plCellState(s, m, X)));
    const tot = months.map(() => ({ pln: 0, vis: 0, cap: 0, ina: 0, miss: 0 })), cnt = {}; Object.keys(PL_ST).forEach(k => { cnt[k] = 0; });
    ST.forEach(r => r.forEach((st, i) => { cnt[st]++; const t = tot[i]; if (st === 'pln' || st === 'add' || st === 'frc' || st === 'miss') t.pln++; if (st === 'vis' || st === 'off') t.vis++; if (st === 'cap') t.cap++; if (st === 'ina') t.ina++; if (st === 'miss') t.miss++; }));
    const qs = inp({ type: 'search', placeholder: 'ID, code, localité, commune, district…', 'aria-label': 'Rechercher un site' }); qs.value = PLS.q; qs.addEventListener('change', () => { PLS.q = qs.value; PLS.page = 0; render(); });
    const ms = el('select', { 'aria-label': 'Mois affichés' }); [['horizon', 'Horizon du plan (' + monthLabel(R.months[0]) + ' → ' + monthLabel(R.months[R.months.length - 1]) + ')'], ['year', 'Année ' + planYearUI() + ' (mois passés = réalisé)']].forEach(([v, t]) => { const o = el('option', { value: v, text: t }); if (v === PLS.mode) o.selected = true; ms.appendChild(o); }); ms.addEventListener('change', () => { PLS.mode = ms.value; render(); });
    const legend = el('div', { class: 'pl-legend' }, Object.keys(PL_ST).filter(k => k !== 'none').map(k => el('span', { class: 'pl-lg' }, [el('span', { class: 'pl-c pl-c-' + k, text: PL_ST[k][0] || ' ' }), PL_ST[k][1] + ' : ' + fmt(cnt[k])])));
    const PAGE = 100, pages = Math.max(1, Math.ceil(rows.length / PAGE)); if (PLS.page >= pages) PLS.page = 0;
    const p0 = PLS.page * PAGE, slice = rows.slice(p0, p0 + PAGE);
    const t = el('table', { class: 'pl-grid' });
    const hr = el('tr', null, ['ID site', 'Activité', 'Localité (commune)', 'District', 'Bureau', 'Équipe', 'Risque', 'Dernière visite', 'Prochaine visite possible'].map((h, i) => el('th', { scope: 'col', class: i < 3 ? 'pl-fix pl-f' + i : '', text: h })).concat(months.map(m => el('th', { scope: 'col', class: 'pl-m' + (m === X.CM ? ' pl-now' : '') + (X.hz.has(m) ? '' : ' pl-out'), text: monthLabel(m) + (R.frozen.indexOf(m) >= 0 ? ' ✔' : '') }))));
    t.appendChild(el('thead', null, hr));
    const tb = el('tbody');
    slice.forEach((s, i) => {
      const tr = el('tr', { class: s.actif ? '' : 'pl-off' });
      [s.publicId, ACT[s.act].short, s.localite + ' (' + s.commune + ')', s.district, s.fo, s.team ? s.team.org : '—'].forEach((v, k) => tr.appendChild(el('td', { class: k < 3 ? 'pl-fix pl-f' + k : '', text: v })));
      const lv = el('td'); if (s.actif && s.security < 99) lv.appendChild(plCatBadge(s)); else lv.textContent = s.security >= 99 ? 'zone interdite' : 'désactivé'; tr.appendChild(lv);
      tr.appendChild(el('td', { text: s.last ? dFrUI(s.last) : 'jamais' })); const tdN = el('td', { text: s.actif && s.security < 99 ? (!s.nextPossible ? 'maintenant' : s.late ? monthLabel(s.dueRaw) + ' (retard)' : monthLabel(s.dueRaw)) + ' · ' + s.freq + ' m' : '–' }); if (s.actif && s.security < 99) bindTip(tdN, () => plIntervalText(s)); tr.appendChild(tdN);
      ST[p0 + i].forEach((st, k) => tr.appendChild(el('td', { class: 'pl-c pl-c-' + st, 'data-j': String(s.j), 'data-m': months[k], tabindex: '0', 'aria-label': monthLabel(months[k]) + ' : ' + PL_ST[st][1], text: PL_ST[st][0] })));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    const sumT = el('table', { class: 'pl-sum' }); sumT.appendChild(el('thead', null, el('tr', null, [el('th', { scope: 'col', text: 'Totaux sur les ' + fmt(rows.length) + ' lignes filtrées' })].concat(months.map(m => el('th', { scope: 'col', class: 'num', text: monthLabel(m) }))))));
    const sb = el('tbody'); [['● Prévu (planifié, ajouté, plan validé)', 'pln'], ['✓ Réalisé (visite exploitable)', 'vis'], ['◌ Dû non planifié (capacité)', 'cap'], ['▒ Inactif ce mois', 'ina']].forEach(([l, k]) => sb.appendChild(el('tr', null, [el('th', { scope: 'row', text: l })].concat(tot.map((x, i) => el('td', { class: 'num', text: k === 'vis' && x.pln && months[i] < X.CM ? fmt(x.vis) + ' (' + pct(x.vis / Math.max(1, x.pln) * 100) + ' du prévu)' : fmt(x[k]) }))))));
    sumT.appendChild(sb);
    const wrap = el('div', { class: 'tw pl-gw' }, t);
    tb.addEventListener('click', e => { const td = e.target.closest('td[data-m]'); if (td) plSiteDrawer(+td.getAttribute('data-j'), td.getAttribute('data-m')); });
    tb.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const td = e.target.closest('td[data-m]'); if (td) plSiteDrawer(+td.getAttribute('data-j'), td.getAttribute('data-m')); });
    tb.addEventListener('mousemove', e => { const td = e.target.closest('td[data-m]'); if (!td) { hideTip(); return; } const s = R.byJ.get(+td.getAttribute('data-j')), m = td.getAttribute('data-m'); const st = plCellState(s, m, X); const w = (R.why.get(s.j) || {})[m]; showTip(e, s.publicId + ' · ' + s.localite + ' — ' + monthLabel(m) + '\n' + PL_ST[st][1] + (w ? '\n' + w.txt : '') + (s.annee && +m.slice(0, 4) !== +s.annee ? '\nGrille ' + m.slice(0, 4) + ' non renseignée : site supposé actif.' : '') + '\n(cliquer : détail)'); });
    tb.addEventListener('mouseleave', hideTip);
    const pager = el('div', { class: 'frow' }, pages > 1 ? [btn('‹ Précédente', () => { PLS.page = Math.max(0, PLS.page - 1); render(); }), el('span', { class: 'hint', text: 'Lignes ' + fmt(p0 + 1) + '–' + fmt(Math.min(rows.length, p0 + PAGE)) + ' sur ' + fmt(rows.length) + ' (page ' + (PLS.page + 1) + ' / ' + pages + ')' }), btn('Suivante ›', () => { PLS.page = Math.min(pages - 1, PLS.page + 1); render(); })] : [el('span', { class: 'hint', text: fmt(rows.length) + ' ligne(s)' })]);
    main.appendChild(plCard('Plan de suivi par site', 'Mois passés : réalisé (visites exploitables). Mois à venir : planifié, ou plan validé (✔). Mois courant : ' + monthLabel(X.CM) + ' (jour local du ' + dFrUI(R.ref) + ').\nLes totaux portent sur toutes les lignes filtrées, pas seulement la page.\nUne case ouvre le détail du site et la raison du mois.', [
      el('div', { class: 'frow' }, [el('label', { class: 'fld' }, ['Recherche', qs]), el('label', { class: 'fld' }, ['Mois affichés', ms]), btn('Plan de suivi (.xlsx)', () => plExportPlan(R, cfg, sc, all), 'on')]),
      legend, el('div', { class: 'tw pl-sumw' }, sumT), pager, wrap, plValidationBar(R, cfg)], 'wide'));
  }
  // validation mensuelle (administrateur) : un mois validé est figé dans le fichier et n'est plus recalculé
  function plValidationBar(R, cfg) {
    const RP = plStore(false); const box = el('div', { class: 'pl-val' }, [plH3('Validation du plan', 'Valider fige la liste des sites du mois dans le fichier, pour tous les bureaux et toutes les activités (« Télécharger le dashboard mis à jour » pour la partager). Ces visites servent ensuite d’ancrage à l’intervalle RBM, et le prévu / réalisé devient mesurable. Toute modification d’un mois validé demande un motif. Mot de passe d’administration requis.')]);
    R.months.forEach(m => {
      const fr = RP && RP.months[m]; const nAll = R.plan.filter(p => p.m === m).length;
      const row = el('div', { class: 'frow' }, [el('b', { text: monthLabel(m) }), el('span', { text: fr ? 'validé le ' + dFrUI(fr.savedAt) + ' par ' + (fr.by || '–') + ', ' + fmt(fr.n) + ' visites' : fmt(nAll) + ' visites, non validé' })]);
      if (!fr) row.appendChild(btn('Valider', () => requireAdmin(() => {
        const cells = {}; R.plan.filter(p => p.m === m).forEach(p => { cells[plKey(p.s)] = { src: p.src, fo: p.s.fo, team: p.s.team ? p.s.team.org : null, R: Math.round(p.s.R * 10) / 10, cat: p.s.cat }; });
        const RP2 = plStore(true); RP2.months[m] = { savedAt: today(), by: SESSION.by || '—', n: Object.keys(cells).length, cells }; RP2.savedAt = today(); RP2.by = SESSION.by || '—'; RP2.start = Object.keys(RP2.months).sort()[0];
        plTouch('valider', m, '');
      }), 'on sm'));
      else row.appendChild(btn('Annuler la validation', () => requireAdmin(() => plAskMotif('Annuler la validation de ' + monthLabel(m), 'Le mois sera de nouveau calculé.', ['Erreur de paramétrage', 'Changement de capacité des équipes', 'Nouvelle extraction du registre', 'Autre (préciser)'], mo => { const RP2 = plStore(true); delete RP2.months[m]; plTouch('annuler la validation', m, mo); })), 'sm'));
      box.appendChild(row);
    });
    return box;
  }

  // ---- vue « Capacité & exécution »
  function plViewCap(main, R, cfg, sc) {
    const ci = R.capInfo, J = new Set(sc.map(s => s.j)); const fos = Array.from(new Set(sc.map(s => s.fo))).sort().filter(f => F.fo < 0 || f === DICT.fo[F.fo]);
    const rows = fos.map(fo => {
      const l = sc.filter(s => s.fo === fo), p = ci.perFo.get(fo) || { n: 0, byM: new Map(), cross: 0, off: 0, agents: new Set() }, d = plDemand(l, R.months);
      const m0 = R.months[0], pl0 = R.plan.filter(x => x.m === m0 && x.s.fo === fo && J.has(x.s.j));
      return { fo, cap: Math.round(+R.cap[fo] || 0), auto: ci.auto[fo] || 0, set: Object.prototype.hasOwnProperty.call(cfg.cap, fo), base: ci.ms.map(m => fmt(p.byM.get(m) || 0)).join(' / '), cross: p.cross, agents: p.agents.size, dem: d.avg, sites: l.length,
        over: R.overflow.filter(s => s.fo === fo && J.has(s.j)).length, ad: pl0.reduce((a, x) => a + 1 / plVpd(cfg, x.s.act), 0), n0: pl0.length };
    });
    const capCell = r => { const sp = el('span', { class: 'cell bg-' + (r.cap === 0 ? 'bad' : r.dem > r.cap * 1.05 ? 'mid' : 'good'), text: fmt(r.cap) }); bindTip(sp, () => r.fo + ' : capacité retenue ' + fmt(r.cap) + ' visites/mois' + (r.set ? ', saisie (calcul automatique : ' + fmt(r.auto) + ')' : ', calcul automatique') + '\nVisites réalisées ' + ci.ms.map(monthLabel).join(' / ') + ' : ' + r.base + '\nDemande moyenne : ' + fmt(r.dem, 1) + ' visites/mois'); return sp; };
    main.appendChild(plCard('Capacité', 'Capacité par défaut : moyenne mensuelle des visites exploitables réalisées sur les sites du bureau en ' + ci.ms.map(monthLabel).join(', ') + ', les 3 derniers mois complets.' + (ci.incomplete ? ' ' + monthLabel(ci.incomplete.m) + ' est exclu : mois incomplet (' + fmt(ci.incomplete.n) + ' visites au ' + dFrUI(ci.incomplete.end) + ').' : '') + '\nUne visite compte pour le bureau du site, quelle que soit l’équipe qui l’a faite (colonne « autres bureaux »).' + (ci.extra.length ? '\nBureaux avec des visites mais aucun site au registre : ' + ci.extra.join(', ') + ' ; ces visites ne comptent pour aucune capacité.' : '') + '\nModifiable dans les réglages.', [
      table([{ k: 'fo', t: 'Bureau' }, { k: 'sites', t: 'Sites actifs', num: 1, fmt: r => fmt(r.sites) }, { k: 'cap', t: 'Capacité', num: 1, fmt: capCell, title: 'Visites par mois retenues pour le plan' }, { k: 'cross', t: 'Autres bureaux', num: 1, title: 'Visites des 3 mois faites par une équipe d’un autre bureau sur les sites de ce bureau' },
        { k: 'agents', t: 'Agents actifs', num: 1, title: 'Agents ayant fait au moins une visite sur ces sites pendant les 3 mois de référence' }, { k: 'dem', t: 'Demande / mois', num: 1, fmt: r => fmt(r.dem) },
        { k: 'n0', t: 'Retenu ' + monthLabel(R.months[0]), num: 1 }, { k: 'ad', t: 'Journées-agent', num: 1, fmt: r => fmt(Math.ceil(r.ad)), title: 'Journées-agent nécessaires en ' + monthLabel(R.months[0]) }, { k: 'over', t: 'Dus non retenus', num: 1, fmt: r => fmt(r.over), title: 'Sur tout l’horizon' }], rows, { sortK: 1, dir: -1 })], 'wide'));
    main.appendChild(plCard('Charge mensuelle', 'Visites retenues / capacité ; entre parenthèses, sites dus ce mois-là. Rouge : demande supérieure à la capacité.', [table([{ k: 'fo', t: 'Bureau' }].concat(R.months.map((m, j) => ({ k: 'm' + j, t: monthLabel(m) + (R.frozen.indexOf(m) >= 0 ? ' ✔' : ''), fmt: r => { const u = R.used[m + '|' + r.fo] || { planned: 0, cap: Math.round(+R.cap[r.fo] || 0), demand: 0 }; const sp = el('span', { class: 'cell bg-' + (u.demand > u.cap ? 'bad' : u.planned >= u.cap * 0.8 ? 'mid' : 'good'), text: fmt(u.planned) + ' / ' + fmt(u.cap) + ' (' + fmt(u.demand) + ')' }); bindTip(sp, () => r.fo + ', ' + monthLabel(m) + '\nRetenues : ' + u.planned + '\nCapacité : ' + u.cap + '\nSites dus : ' + u.demand + (u.frozen ? '\nPlan validé' : '')); return sp; } }))), fos.map(fo => ({ fo })))]));
    const mb = R.mmrBad.filter(s => J.has(s.j)), hasMmr = ACTS.some(a => cfg.mmr[a] && (cfg.mmr[a].minYear || cfg.mmr[a].floor));
    if (hasMmr) {
      const mmrCard = plCard('Planchers MMR', 'Intervalle minimal entre deux suivis = fréquence RBM du niveau de risque ; la MMR fixe un nombre minimal de visites, jamais un intervalle plus court.\nUn site est signalé quand son plancher MMR ne peut pas être atteint sur les mois restants de ' + planYearUI() + ' en respectant l’intervalle RBM. L’intervalle l’emporte.', [
        mb.length ? table([{ k: 'publicId', t: 'ID site' }, { k: 'act', t: 'Activité', fmt: s => ACT[s.act].short }, { k: 'localite', t: 'Site', fmt: s => s.localite + ' (' + s.commune + ')' }, { k: 'fo', t: 'Bureau' }, { k: 'cat', t: 'Risque', fmt: plCatBadge, sortVal: s => s.sortKey }, { k: 'freq', t: 'Intervalle', num: 1, fmt: s => s.freq + ' mois' }, { k: 'mmr', t: 'Visites possibles', fmt: s => { const sp = el('span', { text: s.mmrChk.minYear ? fmt(s.mmrChk.done + s.mmrChk.possible) + ' / ' + fmt(s.mmrChk.minYear) : 'intervalle trop long' }); bindTip(sp, () => s.mmrChk.txt); return sp; } }], mb.slice(0, 300), { onRow: s => plSiteDrawer(s.j) }) : note('Tous les planchers sont atteignables.', 'hint')], 'wide');
      mmrCard.querySelector('h2').textContent = 'Planchers MMR inatteignables : ' + fmt(mb.length);
      main.appendChild(mmrCard); if (mb.length) mmrCard.querySelector('.tw').classList.add('compact');
    }
    // ---- exécution
    const E = plExecution({ sites: sc }); const ex = plValidatedExec(sc);
    const pc = (n, N) => N ? fmt(n) + ' / ' + fmt(N) + ' (' + pct(n / N * 100) + ')' : 'non mesurable';
    const per = E.months.length ? monthLabel(E.months[0]) + ' à ' + monthLabel(E.months[E.months.length - 1]) : 'aucun mois complet';
    main.appendChild(el('div', { class: 'kpis' }, [
      kpi(E.dues ? pct(E.done / E.dues * 100) : '–', 'Exécution du plan', fmt(E.done) + ' / ' + fmt(E.dues) + ' visites dues', null, 'Visites dues selon l’intervalle RBM de chaque site, sur ' + per + ' (période des filtres, mois complets seulement), réalisées le mois dû ou le suivant.' + (E.late ? '\nDont ' + fmt(E.late) + ' réalisées le mois suivant.' : '') + (E.byCat.never && E.byCat.never.dues ? '\nHors sites jamais visités : ' + pct((E.done - E.byCat.never.done) / Math.max(1, E.dues - E.byCat.never.dues) * 100) + '.' : '') + '\n\n' + E.limits.join('\n')),
      kpi(E.inFreq.N ? pct(E.inFreq.n / E.inFreq.N * 100) : '–', 'Sites dans leur intervalle', fmt(E.inFreq.n) + ' / ' + fmt(E.inFreq.N) + (E.inFreq.ref ? ' en ' + monthLabel(E.inFreq.ref) : ''), null, 'Sites actifs le mois de référence dont la dernière visite date de moins que leur intervalle RBM (par exemple moins de 2 mois pour un site visité tous les 2 mois).'),
      kpi(E.byCat.high ? fmt(E.byCat.high.done) + ' / ' + fmt(E.byCat.high.dues) : '–', 'Risque élevé réalisé', E.byCat.high ? pct(E.byCat.high.done / E.byCat.high.dues * 100) : 'aucun site élevé', 'bad', 'Échéances des sites à risque élevé réalisées. Petit effectif : lire le n / N.' + (E.byCat.high && nNote(E.byCat.high.dues, 'échéances') ? '\n' + nNote(E.byCat.high.dues, 'échéances') : '')),
      kpi(ex.length ? pct(ex.reduce((a, x) => a + x.n, 0) / Math.max(1, ex.reduce((a, x) => a + x.N, 0)) * 100) : '–', 'Plans validés', ex.length ? fmt(ex.reduce((a, x) => a + x.n, 0)) + ' / ' + fmt(ex.reduce((a, x) => a + x.N, 0)) + ' réalisées' : 'aucun plan validé', null, 'Réalisé / prévu des plans validés (' + (ex.length ? Array.from(new Set(ex.map(x => x.m))).map(monthLabel).join(', ') : 'aucun') + '). Seul un plan validé avant le mois fait foi pour « planifié non réalisé ».')]));
    const catRows = ['high', 'med', 'low', 'never'].map(k => ({ k, dues: (E.byCat[k] || {}).dues || 0, done: (E.byCat[k] || {}).done || 0, n: (E.inFreq.byCat[k] || {}).n || 0, N: (E.inFreq.byCat[k] || {}).N || 0 }));
    const foRows = Object.keys(E.byFo).sort().map(fo => ({ fo, dues: E.byFo[fo].dues, done: E.byFo[fo].done }));
    main.appendChild(plCard('Exécution du plan', 'Période : ' + per + ' (« Du mois / Au mois » de la barre de filtres, bornés au dernier mois complet' + (E.incomplete ? ' ; ' + monthLabel(E.incomplete.m) + ' exclu, mois incomplet' : '') + ').\nCouverture (sites) et exécution (visites dues) sont deux indicateurs différents.\n\n' + E.limits.join('\n'), [
      el('div', { class: 'grid2 pl-g2' }, [table([{ k: 'k', t: 'Catégorie', fmt: r => PL_CAT[r.k] }, { k: 'dues', t: 'Dues', num: 1, fmt: r => fmt(r.dues) }, { k: 'done', t: 'Réalisées', num: 1, fmt: r => pc(r.done, r.dues) }, { k: 'N', t: 'Dans l’intervalle', num: 1, fmt: r => pc(r.n, r.N) }], catRows),
        table([{ k: 'fo', t: 'Bureau' }, { k: 'dues', t: 'Dues', num: 1, fmt: r => fmt(r.dues) }, { k: 'done', t: 'Réalisées', num: 1, fmt: r => pc(r.done, r.dues) }], foRows)]),
      ex.length ? table([{ k: 'm', t: 'Mois', fmt: r => monthLabel(r.m) }, { k: 'fo', t: 'Bureau' }, { k: 'N', t: 'Prévu', num: 1 }, { k: 'n', t: 'Réalisé', num: 1, fmt: r => pc(r.n, r.N) }, { k: 'miss', t: 'Non réalisé', num: 1 }, { k: 'motif', t: 'Motif saisi', num: 1 }, { k: 'savedAt', t: 'Validé le', fmt: r => dFrUI(r.savedAt) }], ex) : note('Aucun plan validé pour l’instant.', 'hint')], 'wide'));
  }

  // ---- vue « Paramètres » : UN panneau (score de risque, niveaux, fréquences par activité = MMR, horizon, capacités)
  function plViewCfg(main, R, cfg, sc) {
    const num = (val, min, max, step, on, ph) => { const i = inp({ type: 'number', min, max, step, 'aria-label': 'valeur', placeholder: ph === undefined ? '' : String(ph) }); if (val !== undefined && val !== null && val !== '') i.value = val; i.addEventListener('change', () => { if (i.value === '') { on(null); return; } on(plClamp(+i.value || 0, min, max)); }); return i; };
    const fld = (label, input, why) => el('label', { class: 'fld pl-fld' }, [el('span', { class: 'pl-fl' }, [label, why ? infoBtn(why) : null]), input]);
    const d0 = plDemand(sc, R.months), C = plCapOf(R, sc), J0 = new Set(sc.map(s => s.j));
    const sim = el('p', { class: 'pl-sim' + (d0.avg > C.total ? ' pl-warn' : '') }, ['Demande ≈ ' + fmt(d0.avg) + ' visites/mois, capacité ' + fmt(C.total) + ', ' + (d0.avg ? pct(Math.min(100, C.total / d0.avg * 100)) : '–') + ' de la demande couverte', infoBtn('Avec ces réglages : ' + fmt(R.overflow.filter(s => J0.has(s.j)).length) + ' sites dus restent sans visite sur l’horizon (sélection filtrée). Chaque changement recalcule tout de suite le plan, la carte, la grille et les exports.')]);
    const WHY = { score: 'Un site qui respecte mal les normes doit être revu. Plus le poids est fort, plus un score faible fait remonter le site.',
      alert: 'Une alerte critique (vol, fraude, insécurité…) demande une vérification. Deux alertes ou plus donnent le maximum de ce facteur.',
      never: 'Un site jamais vu n’a aucun risque mesuré. Ce poids donne de la priorité aux premières visites.',
      recency: 'Plus la dernière visite est ancienne, moins on sait ce qui se passe. Le facteur atteint son maximum au délai maximal.',
      partner: 'Un partenaire mal noté appelle plus de contrôle. Le facteur est retiré du calcul quand l’activité n’a pas de partenaire (SMP, Résilience) ou quand il est inconnu.' };
    const wcol = el('div', null, [plH3('Score de risque', 'Score de 0 à 100 : moyenne pondérée de 5 facteurs entre 0 et 1. Un poids à 0 ignore le facteur.')].concat(RBM_W.map(([k, l]) => fld(l, num(cfg.w[k], 0, 10, 1, x => plPatch({ w: { [k]: x === null ? RBM_DEF.w[k] : x } })), WHY[k])), [
      fld('Score cible', num(cfg.target, 50, 100, 1, x => plPatch({ target: x === null ? RBM_DEF.target : x })), 'Référence du facteur conformité : 0 au-dessus de la cible, 1 à 35 points en dessous. Le seuil « bon » des scores du tableau de bord est ' + THR.good + (cfg.target !== THR.good ? ' ; la cible RBM (' + cfg.target + ') en diffère, à harmoniser si besoin.' : '.')),
      fld('Délai maximal (jours)', num(cfg.recencyDays, 30, 720, 10, x => plPatch({ recencyDays: x === null ? RBM_DEF.recencyDays : x })), 'Le facteur « délai » vaut 1 à partir de ce nombre de jours depuis la dernière visite.')]));
    const lcol = el('div', null, [plH3('Niveaux', null),
      fld('Seuil élevé', num(cfg.thHigh, 1, 100, 1, x => plPatch({ thHigh: x === null ? RBM_DEF.thHigh : x })), 'À partir de ce score, le site prend l’intervalle « élevé ».'),
      fld('Seuil moyen', num(cfg.thMed, 0, 99, 1, x => plPatch({ thMed: x === null ? RBM_DEF.thMed : x })), 'Toujours inférieur au seuil élevé, sinon ramené automatiquement.'),
      el('label', { class: 'fld pl-chk' }, [(() => { const c = el('input', { type: 'checkbox', 'aria-label': 'Jamais visité = risque élevé' }); c.checked = !!cfg.neverHigh; c.addEventListener('change', () => plPatch({ neverHigh: c.checked })); return c; })(), ' Jamais visités = risque élevé', infoBtn(plNeverText(R, cfg, sc))]),
      plH3('Horizon', null), fld('Premier mois', (() => { const s = el('select', { 'aria-label': 'Premier mois' }); for (let k = 0; k < 12; k++) { const m = addMonths(currentMonth(), k); const o = el('option', { value: m, text: monthLabel(m) }); if (m === cfg.start) o.selected = true; s.appendChild(o); } s.addEventListener('change', () => plPatch({ start: s.value })); return s; })(), 'Jamais un mois passé (jour local de Madagascar).'),
      fld('Nombre de mois', num(cfg.horizon, 1, 12, 1, x => plPatch({ horizon: x === null ? RBM_DEF.horizon : x })), 'Plus l’horizon est long, plus les sites reportés trouvent une place.')]);
    // table unique : intervalle minimal RBM (ligne « Toutes activités ») + plancher MMR par activité (nombre minimal de visites, jamais un intervalle)
    const PYc = planYearUI();
    const ft = el('table', { class: 'pl-ft' }); ft.appendChild(el('thead', null, el('tr', null, ['Activité', 'Élevé', 'Moyen', 'Faible', 'Jamais visité', 'MMR visites / an', 'MMR 1 visite tous les', 'Visites / jour / agent', 'Sites actifs', 'Demande / mois', 'MMR inatteignable'].map(h => el('th', { scope: 'col', text: h })))));
    const ftb = el('tbody');
    const dAll = plDemand(R.scored, R.months);
    ftb.appendChild(el('tr', null, [el('th', { scope: 'row', text: 'Toutes activités' })].concat(PL_FK.map(f => el('td', null, num(cfg.freq[f], 1, 12, 1, x => plPatch({ freq: { [f]: x === null ? RBM_DEF.freq[f] : x } })))), [el('td', { text: '–' }), el('td', { text: '–' }), el('td', null, num(cfg.vpd || '', 0.5, 20, 0.5, x => plPatch({ vpd: x === null ? 0 : x }), fmt(plObsVpd().med, 1))), el('td', { class: 'num', text: fmt(R.scored.length) }), el('td', { class: 'num', text: fmt(dAll.avg) }), el('td', { class: 'num', text: fmt(R.mmrBad.length) })])));
    ACTS.forEach(a => {
      const x = cfg.mmr[a] || {}, l = R.scored.filter(s => s.act === a), d = plDemand(l, R.months), bad = R.mmrBad.filter(s => s.act === a).length;
      ftb.appendChild(el('tr', null, [el('th', { scope: 'row', text: ACT[a].short }), el('td', { colspan: '4', class: 'pl-inh', text: 'même intervalle (' + PL_FK.map(f => cfg.freq[f]).join(' / ') + ' mois)' }),
        el('td', null, num(x.minYear, 1, 12, 1, v => plPatch({ mmr: { [a]: { minYear: v } } }), '–')), el('td', null, num(x.floor, 1, 12, 1, v => plPatch({ mmr: { [a]: { floor: v } } }), '–')), el('td', null, num(x.vpd, 0.5, 20, 0.5, v => plPatch({ mmr: { [a]: { vpd: v } } }), fmt(cfg.vpd || plObsVpd().med, 1))),
        el('td', { class: 'num', text: fmt(l.length) }), el('td', { class: 'num', text: fmt(d.avg) }), el('td', { class: 'num' + (bad ? ' pl-bad' : ''), text: x.minYear || x.floor ? fmt(bad) : '–' })]));
    });
    ft.appendChild(ftb);
    const mmrCtl = ACTS.filter(a => cfg.mmr[a] && (cfg.mmr[a].minYear || cfg.mmr[a].floor)).map(a => { const l = R.scored.filter(s => s.act === a), bad = R.mmrBad.filter(s => s.act === a).length; return ACT[a].short + ' : ' + fmt(l.length) + ' sites actifs, plancher ' + [cfg.mmr[a].minYear ? cfg.mmr[a].minYear + ' visite(s) sur ' + PYc : null, cfg.mmr[a].floor ? '1 visite tous les ' + cfg.mmr[a].floor + ' mois' : null].filter(Boolean).join(' et ') + ', ' + fmt(bad) + ' site(s) ne peuvent pas l’atteindre avec l’intervalle RBM.'; });
    const intInfo = 'L’intervalle (en mois) est compté depuis la dernière visite réelle exploitable du site, ou depuis une visite d’un plan validé. Le calcul ne planifie jamais une visite avant ; un ajout manuel plus tôt est refusé (forçage administrateur avec motif seulement, signalé « hors intervalle RBM »).\n\nLe plancher MMR d’une activité (visites minimales sur ' + PYc + ', ou au moins 1 visite tous les N mois) est contrôlé : s’il ne peut pas être atteint sur les mois restants en respectant l’intervalle, le site est signalé. L’intervalle RBM l’emporte.\n\nLe nombre de sites et la durée ne se saisissent pas : ils viennent du registre et de la grille d’activation. Visites par jour et par agent : sert aux journées-agent (vide = médiane observée ' + fmt(plObsVpd().med, 1) + ').' + (mmrCtl.length ? '\n\n' + mmrCtl.join('\n') : '');
    // capacités
    const ci = R.capInfo;
    const capRows = ci.fos.map(fo => fld(fo, num(Object.prototype.hasOwnProperty.call(cfg.cap, fo) ? cfg.cap[fo] : '', 0, 2000, 1, x => plPatch({ cap: { [fo]: x } }), ci.auto[fo]), 'Automatique : ' + fmt(ci.auto[fo]) + ' visites/mois (' + ci.ms.map(m => monthLabel(m) + ' ' + fmt(((ci.perFo.get(fo) || { byM: new Map() }).byM.get(m)) || 0)).join(', ') + ').' + (Object.prototype.hasOwnProperty.call(cfg.cap, fo) ? ' Saisi : ' + fmt(cfg.cap[fo]) + ' ; videz la case pour revenir à l’automatique.' : '')));
    const capAct = el('details', { class: 'rbm-panel' }, [el('summary', null, ['Par bureau et par activité', infoBtn('Plafond supplémentaire à l’intérieur d’un bureau (par exemple pas plus de 20 écoles SMP par mois à Ampanihy). Vide : pas de plafond par activité.')])].concat(ci.fos.map(fo => el('div', { class: 'frow' }, [el('b', { text: fo })].concat(ACTS.map(a => fld(ACT[a].short, num(cfg.capAct[fo + '|' + a], 0, 2000, 1, x => plPatch({ capAct: { [fo + '|' + a]: x } }), '–'))))))));
    const saved = D.rbmSaved;
    main.appendChild(plCard('Réglages', 'Tout le monde peut essayer des réglages, gardés pour la session. « Enregistrer » les écrit dans le fichier (mot de passe, puis « Télécharger le dashboard mis à jour »).', [sim,
      el('div', { class: 'rbm-grid pl-cfg' }, [wcol, lcol]),
      plH3('Intervalle entre deux suivis', intInfo),
      el('p', { class: 'pl-rule', text: 'Intervalle minimal entre deux suivis = fréquence RBM du niveau de risque ; la MMR fixe un nombre minimal de visites, jamais un intervalle plus court.' }),
      el('div', { class: 'tw pl-ftw' }, ft),
      plH3('Capacité des bureaux', 'La capacité limite les visites retenues chaque mois ; au-delà, les sites dus sont reportés. Calcul automatique : moyenne des 3 derniers mois complets (' + ci.ms.map(monthLabel).join(', ') + ')' + (ci.incomplete ? ', ' + monthLabel(ci.incomplete.m) + ' exclu car incomplet' : '') + ', sans minimum artificiel. Case vide : automatique.'),
      el('div', { class: 'rbm-grid' }, capRows), capAct,
      el('div', { class: 'frow' }, [btn('Revenir aux réglages enregistrés', () => { SESSION.rbm = {}; PLS.cache = null; render(); }),
        btn('Enregistrer dans le fichier', () => requireAdmin(() => { const c2 = rbmCfg(); D.rbm = JSON.parse(JSON.stringify(Object.assign({}, c2, { start: null }))); D.rbmSaved = { date: today(), by: SESSION.by || '—' }; if (CUR !== D) { CUR.rbm = D.rbm; CUR.rbmSaved = D.rbmSaved; } SESSION.rbm = {}; SESSION.dirty = true; PLS.cache = null; render(); }), 'on'),
        el('span', { class: 'hint', text: saved ? 'Enregistrés le ' + dFrUI(saved.date) + ' par ' + saved.by : D.rbm ? 'Réglages du fichier' : 'Réglages par défaut' })])], 'wide'));
    main.appendChild(plMethodCard(cfg));
  }
  function plNeverText(R, cfg, sc) {
    const nv = sc.filter(s => s.cat === 'never'); const fr = (cfg.freq.never || 2), fh = cfg.freq.high || 1;
    const extra = nv.length * (1 / fh - 1 / fr);
    return (cfg.neverHigh ? 'Coché : ' : 'Non coché (recommandé) : ') + fmt(nv.length) + ' sites jamais visités. Leur risque n’est pas mesuré : les traiter comme « élevés » les ferait passer avant les sites mal notés et ' + (extra >= 0 ? 'ajouterait ≈ ' + fmt(extra) : 'retirerait ≈ ' + fmt(-extra)) + ' visites/mois à la demande (fréquence ' + every(fh) + ' au lieu de ' + every(fr) + '). Non coché, ils gardent leur propre fréquence (« Jamais visité ») et leur score théorique (' + (nv[0] ? fmt(nv[0].R, 1) : '–') + ') pour l’ordre de passage.';
  }
  function plMethodCard(cfg) {
    return el('details', { class: 'card pl-method' }, [el('summary', { text: 'Méthode de calcul' }), el('ul', { class: 'find' }, [
      el('li', { text: 'Score de risque = somme (poids × facteur entre 0 et 1) ÷ somme des poids retenus × 100. Poids actuels : ' + RBM_W.map(([k, l]) => l.toLowerCase() + ' ' + cfg.w[k]).join(', ') + '.' }),
      el('li', { text: 'Conformité : (cible ' + cfg.target + ' moins la moyenne des 2 dernières visites) ÷ 35, entre 0 et 1 ; 0,5 si aucun score. Alertes : nombre à la dernière visite ÷ 2, au plus 1. Jamais visité : 1. Délai : jours depuis la dernière visite ÷ ' + cfg.recencyDays + ', au plus 1. Partenaire : A 0, B 0,2, C 0,6, D 1.' }),
      el('li', { text: 'Deux corrections : le partenaire est retiré du calcul quand l’activité n’a pas de partenaire (SMP, Résilience) ou qu’il est inconnu, au lieu de compter 0,3 ; pour un site jamais visité, le délai n’est plus compté en plus de « jamais visité ». Les poids et seuils par défaut ne changent pas.' }),
      el('li', { text: 'Niveaux : ' + plLevelsText(cfg) + '. Le score bouge chaque jour (le délai augmente) ; la date de référence est donnée dans le détail de chaque site.' }),
      el('li', { text: 'Intervalle minimal entre deux suivis = fréquence RBM du niveau de risque (' + PL_FK.map(f => (f === 'never' ? 'jamais visité' : PL_CAT[f].toLowerCase()) + ' ' + cfg.freq[f] + ' mois').join(', ') + ') ; la MMR fixe un nombre minimal de visites, jamais un intervalle plus court. Prochaine visite possible = mois de la dernière visite réelle (ou de la visite d’un plan validé) + intervalle, compté en mois actifs de la grille d’activation.' }),
      el('li', { text: 'Chaque mois, les sites dus et actifs ce mois-là sont classés (risque décroissant, puis retard, commune déjà chargée, activité la moins couverte) et retenus dans la limite de la capacité du bureau ; les autres sont reportés. Un site dû un mois où la grille dit Non n’est pas compté comme manque de capacité.' }),
      el('li', { text: 'Un plan validé est figé ; les ajouts et retraits manuels sont enregistrés avec motif, auteur et date.' })])]);
  }

  // ---- vue « Exports » : trois exports, un usage chacun
  function plViewExp(main, R, cfg, sc, all) {
    const m = R.months.indexOf(PLS.month) >= 0 ? PLS.month : R.months[0];
    const msel = el('select', { 'aria-label': 'Mois des ordres de mission' }); R.months.forEach(x => { const o = el('option', { value: x, text: monthLabel(x) + (R.frozen.indexOf(x) >= 0 ? ', plan validé' : ', non validé') }); if (x === m) o.selected = true; msel.appendChild(o); }); msel.addEventListener('change', () => { PLS.month = msel.value; render(); });
    const item = (title, info, kids) => el('div', { class: 'pl-exp' }, [el('span', { class: 'pl-exp-t' }, [title, infoBtn(info)])].concat(kids));
    main.appendChild(plCard('Exports', 'Les trois exports suivent les filtres du haut et le même calcul que l’écran. Le nom du fichier porte la version : données jusqu’au ' + R.dataEnd + ', plan de suivi version ' + (CUR.planVersion || 0) + '.', [
      item('Plan de suivi', 'Grille sites × mois en clair, visites planifiées avec GPS, dus non retenus, dus inactifs, planchers MMR inatteignables, scores de risque facteur par facteur, charge par bureau et réglages.\nPas de format DOTS ici : ses colonnes Jan…Déc sont la grille d’activation, qu’un plan de visites réimporté écraserait.', [btn('Plan de suivi (.xlsx)', () => plExportPlan(R, cfg, sc, all), 'on')]),
      item('Ordres de mission', 'Une feuille par équipe (organisation de suivi × bureau du site), plus Synthèse et Lisez-moi : GPS, raison chiffrée, intervalle RBM, points à vérifier et colonnes de retour à remplir sur le terrain.', [el('label', { class: 'fld' }, ['Mois', msel]), btn('Ordres de mission (.xlsx)', () => plExportMissions(R, cfg, sc, m), 'on')]),
      item('Registre des sites', 'Format DOTS (mêmes colonnes et même ordre que le fichier importé) : colonne Actif et grille d’activation Jan…Déc ; ce n’est pas le plan de visites.\nFeuille « Journal des changements » : chaque modification d’activation, de grille ou de sécurité (date, auteur, avant et après, motif).', [btn('Registre DOTS (.xlsx)', plExportDots, 'on')])], 'wide'));
  }
  function plStamp(R) { return 'v' + R.dataEnd + '_p' + (CUR.planVersion || 0); }
  function plStateText(st) { return st === 'none' ? '' : PL_ST[st][0] + ' ' + PL_ST[st][1].replace(/ \(.*\)$/, ''); }
  function plFactorRow(s) { return s.factors.map(x => x.na ? 'sans objet' : fmt(x.pts, 1)); }
  function plExportPlan(R, cfg, sc, all) {
    const X = plGridCtx(R), J = new Set(sc.map(s => s.j)), pl = R.plan.filter(p => J.has(p.s.j));
    const base = s => [s.publicId, s.code, ACT[s.act].short, s.region, s.district, s.commune, s.localite, s.fo, plTeamLabel(s)];
    const BH = ['ID site', 'Code POI', 'Activité', 'Région', 'District', 'Commune', 'Localité / école', 'Bureau', 'Équipe'];
    const reason = (s, m) => { const w = (R.why.get(s.j) || {})[m]; return w ? w.txt : ''; };
    const sheets = [
      { name: 'Lisez-moi', header: ['Rubrique', 'Contenu'], rows: [['Fichier', 'Plan de suivi — moteur unique de planification (RBM)'], ['Données', 'visites exploitables jusqu’au ' + R.dataEnd + ' ; calculé le ' + R.ref + ' (jour local Madagascar)'], ['Version du plan de suivi', String(CUR.planVersion || 0)], ['Filtres', filtersActiveText()], ['Mois planifiés', R.months.join(', ')], ['Plans validés', R.frozen.join(', ') || 'aucun'], ['États de la grille', Object.keys(PL_ST).filter(k => k !== 'none').map(k => PL_ST[k][0] + ' = ' + PL_ST[k][1]).join(' ; ')], ['Niveaux', plLevelsText(cfg)], ['Capacité', 'moyenne des visites réalisées sur les sites du bureau en ' + R.capInfo.ms.join(', ') + (R.capInfo.incomplete ? ' (' + R.capInfo.incomplete.m + ' exclu, incomplet)' : '')], ['Format DOTS', 'volontairement absent de ce classeur : les colonnes Jan…Déc du format DOTS sont la grille d’ACTIVATION ; y écrire le plan de visites puis le réimporter désactiverait les mois non planifiés. Le registre au format DOTS est un export séparé (onglet Sites).']] },
      { name: 'Grille sites x mois', header: BH.concat(['Actif', 'Sécurité', 'Catégorie', 'Score de risque', 'Intervalle minimal RBM (mois)', 'Dernière visite', 'Prochaine visite possible à partir de'], R.months.map(monthLabel)), rows: plSearch(all).map(s => base(s).concat([s.actif ? 'Oui' : 'Non', s.secKnown ? s.security : 'non renseignée', s.actif && s.security < 99 ? PL_CAT[s.cat] : '', s.actif && s.security < 99 ? Math.round(s.R * 10) / 10 : null, s.freq, s.last, s.nextPossible || 'maintenant'], R.months.map(m => plStateText(plCellState(s, m, X))))) },
      { name: 'Visites planifiées', header: ['Mois'].concat(BH, ['Catégorie', 'Score de risque', 'Origine', 'Intervalle minimal (RBM)', 'Pourquoi (facteurs)', 'À vérifier sur place', 'Dernière visite', 'Dernier score', 'Partenaire', 'Latitude', 'Longitude']), rows: pl.map(p => [p.m].concat(base(p.s), [PL_CAT[p.s.cat], Math.round(p.s.R * 10) / 10, p.src === 'forcé' ? 'forcé HORS intervalle RBM' : p.src, plIntervalText(p.s), p.s.why, p.s.how, p.s.last, p.s.lastScore === null ? null : Math.round(p.s.lastScore), p.s.imp || '', p.s.lat, p.s.lon])) },
      { name: 'Dus non planifiés (capacité)', header: BH.concat(['Catégorie', 'Score de risque', 'Raison (premier mois)', 'Pourquoi']), rows: R.overflow.filter(s => J.has(s.j)).sort((a, b) => b.sortKey - a.sortKey).map(s => base(s).concat([PL_CAT[s.cat], Math.round(s.R * 10) / 10, reason(s, R.months.find(m => ((R.why.get(s.j) || {})[m] || {}).st === 'cap' || ((R.why.get(s.j) || {})[m] || {}).st === 'frozen')), s.why])) },
      { name: 'Dus inactifs (grille Non)', header: BH.concat(['Catégorie', 'Raison']), rows: R.dueInactive.filter(s => J.has(s.j)).map(s => base(s).concat([PL_CAT[s.cat], reason(s, R.months.find(m => ((R.why.get(s.j) || {})[m] || {}).st === 'inactive' || ((R.why.get(s.j) || {})[m] || {}).st === 'forbidden'))])) },
      { name: 'Scores de risque', header: BH.concat(['Catégorie', 'Score de risque (0-100)', 'Visites utilisées pour le score', 'Pts conformité', 'Pts alertes', 'Pts jamais visité', 'Pts délai', 'Pts partenaire', 'Intervalle minimal (mois)', 'Source de l’intervalle', 'Prochaine visite possible à partir de', 'En retard', 'Pourquoi', 'À vérifier']), rows: sc.slice().sort((a, b) => b.sortKey - a.sortKey).map(s => base(s).concat([PL_CAT[s.cat], Math.round(s.R * 10) / 10, s.nScore], plFactorRow(s), [s.freq, s.freqSrc, s.nextPossible || 'maintenant', s.late ? 'oui' : 'non', s.why, s.how])) },
      { name: 'MMR inatteignable', header: BH.concat(['Catégorie', 'Intervalle minimal RBM (mois)', 'Contrôle du plancher MMR']), rows: R.mmrBad.filter(s => J.has(s.j)).map(s => base(s).concat([PL_CAT[s.cat], s.freq, s.mmrChk.txt])) },
      { name: 'Charge par bureau', header: ['Bureau', 'Capacité retenue', 'Capacité automatique'].concat(R.months.map(m => monthLabel(m) + ' planifiées / dus')), rows: Object.keys(R.cap).sort().map(fo => [fo, Math.round(+R.cap[fo] || 0), R.capInfo.auto[fo] || 0].concat(R.months.map(m => { const u = R.used[m + '|' + fo]; return u ? u.planned + ' / ' + u.demand : '0 / 0'; }))) },
      { name: 'Paramètres', header: ['Paramètre', 'Valeur'], rows: RBM_W.map(([k, l]) => ['Poids – ' + l, cfg.w[k]]).concat([['Score cible', cfg.target], ['Délai maximal (j)', cfg.recencyDays], ['Seuil élevé', cfg.thHigh], ['Seuil moyen', cfg.thMed], ['Jamais visité traité comme élevé', cfg.neverHigh ? 'oui' : 'non']], PL_FK.map(f => ['Intervalle minimal RBM ' + PL_CAT[f].toLowerCase() + ' (mois)', cfg.freq[f]]), [['Règle', 'Intervalle minimal entre deux suivis = fréquence RBM du niveau de risque ; la MMR fixe un nombre minimal de visites, jamais un intervalle plus court']], Object.keys(cfg.mmr).map(a => ['MMR ' + ACT[a].short, (cfg.mmr[a].minYear ? cfg.mmr[a].minYear + ' visite(s) minimum par site sur l’année' : '') + (cfg.mmr[a].floor ? ' ; au moins 1 visite tous les ' + cfg.mmr[a].floor + ' mois' : '') + (cfg.mmr[a].vpd ? ' ; ' + cfg.mmr[a].vpd + ' visites par jour et par agent' : '')]), [['Visites par jour et par agent', cfg.vpd || 'médiane observée ' + plObsVpd().med], ['Premier mois', cfg.start], ['Horizon (mois)', cfg.horizon]], Object.keys(R.cap).sort().map(f => ['Capacité ' + f, Math.round(+R.cap[f] || 0)])) }];
    downloadBlob(xlsxBlob(sheets), 'plan_de_suivi_' + R.months[0] + '_' + plStamp(R) + '.xlsx');
  }
  function plExportMissions(R, cfg, sc, m) {
    const J = new Set(sc.map(s => s.j)), fr = R.frozen.indexOf(m) >= 0, pl = R.plan.filter(p => p.m === m && J.has(p.s.j));
    const teams = new Map(); pl.forEach(p => { const t = plTeamLabel(p.s); if (!teams.has(t)) teams.set(t, []); teams.get(t).push(p); });
    const H = ['Mois', 'Équipe', 'Bureau', 'District', 'Commune', 'Fokontany', 'Localité / école', 'ID site', 'Code POI', 'Activité', 'Latitude', 'Longitude', 'Niveau de risque', 'Score de risque', 'Pourquoi ce site', 'À vérifier sur place', 'Dernière visite', 'Dernier score', 'Alertes à la dernière visite', 'Sécurité (0/1/3)', 'Intervalle minimal (RBM)', '— RETOUR — Date réalisée', 'Réalisée (Oui/Non)', 'Motif si non réalisée', 'Commentaire'];
    const used = new Set(); const sname = t => { let b = t.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28), x = b, i = 2; while (used.has(x)) x = b.slice(0, 26) + ' ' + (i++); used.add(x); return x; };
    const head = 'Plan ' + (fr ? 'validé' : 'CALCULÉ (non validé)') + ' de ' + monthLabel(m) + ' · données jusqu’au ' + R.dataEnd + ' · plan de suivi v' + (CUR.planVersion || 0);
    const syn = Array.from(teams.entries()).sort().map(([t, l]) => [t, l.length, Math.ceil(l.reduce((a, p) => a + 1 / plVpd(cfg, p.s.act), 0)), l.filter(p => p.s.cat === 'high').length, l.filter(p => p.s.cat === 'never').length]);
    const sheets = [{ name: 'Lisez-moi', header: ['Rubrique', 'Contenu'], rows: [['Version', head], ['Équipe', 'organisation de suivi qui a fait le plus de visites sur le site ces 6 derniers mois (sinon dans la commune, sinon dans le district) × bureau du site ; « Non attribué » si aucune visite récente'], ['Ordre', 'sites triés par score de risque décroissant'], ['Retour', 'remplir les 4 colonnes RETOUR ; le réalisé est confirmé par les fiches Kobo importées'], ['Filtres', filtersActiveText()], ['Journées-agent', 'visites ÷ visites par jour et par agent (' + (cfg.vpd || 'médiane observée ' + plObsVpd().med) + ')']] },
      { name: 'Synthèse', header: ['Équipe', 'Visites', 'Journées-agent estimées', 'dont risque élevé', 'dont jamais visités'], rows: syn }];
    Array.from(teams.entries()).sort().forEach(([t, l]) => sheets.push({ name: sname(t), header: H, rows: l.slice().sort((a, b) => b.s.sortKey - a.s.sortKey).map(p => { const s = p.s; return [m, t, s.fo, s.district, s.commune, s.fokontany && s.fokontany !== '0' ? s.fokontany : '', s.localite, s.publicId, s.code, ACT[s.act].short, s.lat, s.lon, PL_CAT[s.cat], Math.round(s.R * 10) / 10, s.why, s.how, s.last, s.lastScore === null ? null : Math.round(s.lastScore), riskNames(s).join(' ; '), s.secKnown ? s.security : 'non renseignée', (p.src === 'forcé' ? 'FORCÉ hors intervalle RBM — ' : '') + plIntervalText(s), '', '', '', '']; }) }));
    if (!pl.length) sheets.push({ name: 'Aucune visite', header: ['Information'], rows: [['Aucune visite planifiée pour ce mois avec les filtres choisis.']] });
    downloadBlob(xlsxBlob(sheets), 'ordres_mission_' + m + '_' + (fr ? 'valide' : 'calcule') + '_' + plStamp(R) + '.xlsx');
  }
  function plExportDots() {
    const X = planDots(null); const L = (CUR.planLog || []).map(e => [e.d, e.by, e.code || '(groupe)', e.act ? (ACT[e.act] ? ACT[e.act].short : e.act) : '', e.f, e.scope || '', e.n || 1, e.a === undefined || e.a === null ? '' : String(e.a), e.b === undefined || e.b === null ? '' : String(e.b), e.m || '']);
    downloadBlob(xlsxBlob([{ name: 'monitoring_plan', header: X.header, rows: X.rows }, { name: 'Journal des changements', header: ['Date', 'Par', 'Code POI', 'Activité', 'Champ', 'Portée', 'Sites', 'Avant', 'Après', 'Motif'], rows: L }]), 'co_madagascar_monitoring_plan_' + today() + '_p' + (CUR.planVersion || 0) + '.xlsx');
  }

  // ------------------------------------------------------------------ TIROIR D'UN SITE : les 5 facteurs, la fréquence, l'échéance, la raison de chaque mois
  function plFactorTable(s) {
    const t = el('table', { class: 'xt pl-xt' });
    t.appendChild(el('thead', null, el('tr', null, ['Facteur', 'Valeur réelle', 'Règle (saturation)', 'Facteur 0–1', 'Poids', 'Points / max'].map((h, i) => el('th', { scope: 'col', class: i >= 3 ? 'num' : '', text: h })))));
    const tb = el('tbody');
    s.factors.forEach(x => tb.appendChild(el('tr', { class: x.na ? 'xna' : '' }, [el('td', null, el('b', { text: x.l })), el('td', { text: x.raw }), el('td', { text: x.rule }), el('td', { class: 'num', text: x.na ? 'sans objet' : fmt(x.f, 2) }), el('td', { class: 'num', text: x.na ? '— (retiré)' : fmt(x.w) }), el('td', { class: 'num', text: x.na ? '—' : fmt(x.pts, 1) + ' / ' + fmt(x.max, 1) })])));
    t.appendChild(tb);
    t.appendChild(el('tfoot', null, el('tr', null, [el('td', { colspan: '5', text: 'Score de risque R = somme des points (poids retenus : ' + fmt(s.wsum) + ')' }), el('td', { class: 'num', text: fmt(s.R, 1) + ' / 100' })])));
    return el('div', { class: 'tw' }, t);
  }
  function plSiteDrawer(j, fm) {
    const cfg = rbmCfg(), R = rbmCompute(cfg), s = R.byJ.get(j); if (!s) return;
    const RP = plStore(false), k = plKey(s), active = s.actif && s.security < 99;
    const parts = s.factors.filter(x => !x.na).map(x => fmt(x.pts, 1)).join(' + ');
    const monthsShow = Array.from(new Set(R.months.concat(fm ? [fm] : []))).sort();
    const X = plGridCtx(R);
    const mrows = monthsShow.map(m => { const st = plCellState(s, m, X), w = (R.why.get(s.j) || {})[m]; const ms = RP && RP.misses[k + '|' + m]; return [monthLabel(m) + (m === fm ? ' ◄' : ''), (PL_ST[st][0] ? PL_ST[st][0] + ' ' : '') + PL_ST[st][1] + (w ? ' — ' + w.txt : (m < currentMonth() ? (s.visM.has(m) ? '' : ' — aucune visite exploitable ce mois') : '')) + (ms ? ' — motif de non-réalisation : ' + ms.motif + ' (' + ms.by + ', ' + ms.date + ')' : '')]; });
    const acts = [];
    if (active) R.months.forEach(m => {
      const mk = RP && RP.manual[k + '|' + m], inPl = R.plan.some(p => p.m === m && p.s.j === s.j);
      if (mk) acts.push(btn('Annuler ' + (mk.op === 'add' ? 'l’ajout' : 'le retrait') + ' (' + monthLabel(m) + ')', () => requireAdmin(() => { const R2 = plStore(true); delete R2.manual[k + '|' + m]; plTouch('annuler ' + mk.op, m, k); closeDrawer(); })));
      else if (inPl) acts.push(btn('Retirer du plan de ' + monthLabel(m) + ' (motif)', () => requireAdmin(() => plAskMotif('Retirer ' + s.publicId + ' du plan de ' + monthLabel(m), s.localite + ' — ' + s.commune, ['Accès impossible (route, pluie, cyclone)', 'Insécurité', 'Site fermé / activité arrêtée', 'Capacité de l’équipe', 'Reporté au mois suivant', 'Autre (préciser)'], mo => { const R2 = plStore(true); R2.manual[k + '|' + m] = { op: 'remove', motif: mo, by: SESSION.by || '—', date: today() }; plTouch('retirer', m, k + ' : ' + mo); closeDrawer(); }))));
      else {
        // l'ajout doit respecter l'intervalle RBM depuis la visite précédente (réelle, planifiée ou validée) ; sinon : forçage administrateur motivé, journalisé
        const prev = [s.hist.filter(v => v.month <= m).map(v => v.month).pop() || null, s.anchorSrc === 'plan validé' ? s.anchorM : null].concat(R.plan.filter(p => p.s.j === s.j && p.m < m).map(p => p.m)).filter(Boolean).sort().pop() || null;
        const from = prev ? plAddActive(s, prev, s.freq) : null, ok = !from || m >= from;
        const why = ok ? '' : 'intervalle RBM de ' + s.freq + ' mois non écoulé depuis ' + monthLabel(prev) + ' : prochaine visite possible à partir de ' + monthLabel(from);
        if (ok) acts.push(btn('Ajouter au plan de ' + monthLabel(m) + ' (motif)', () => requireAdmin(() => plAskMotif('Ajouter ' + s.publicId + ' au plan de ' + monthLabel(m), s.localite + ' — ' + s.commune, ['Alerte de protection signalée', 'Demande du bureau', 'Suivi d’une alerte critique', 'Autre (préciser)'], mo => { const R2 = plStore(true); R2.manual[k + '|' + m] = { op: 'add', motif: mo, by: SESSION.by || '—', date: today() }; plTouch('ajouter', m, k + ' : ' + mo); closeDrawer(); }))));
        else { const b = btn('Forcer l’ajout en ' + monthLabel(m) + ' (hors intervalle RBM, motif)', () => requireAdmin(() => plAskMotif('Ajout HORS intervalle RBM — ' + s.publicId + ' en ' + monthLabel(m), 'Refusé par la règle : ' + why + '. Le forçage est journalisé et signalé « hors intervalle RBM ».', ['Alerte de protection signalée', 'Suivi d’une alerte critique', 'Demande expresse du bureau', 'Autre (préciser)'], mo => { const R2 = plStore(true); R2.manual[k + '|' + m] = { op: 'add', force: true, motif: mo + ' [hors intervalle RBM : ' + why + ']', by: SESSION.by || '—', date: today() }; plTouch('forcer ajout hors intervalle', m, k + ' : ' + mo); closeDrawer(); })), 'pl-force'); b.title = 'Ajout refusé : ' + why; acts.push(b); }
      }
    });
    if (RP) Object.keys(RP.months).filter(m => m < currentMonth() && (RP.months[m].cells || {})[k] && !s.visM.has(m)).forEach(m => acts.push(btn('Motif de non-réalisation (' + monthLabel(m) + ')', () => requireAdmin(() => plAskMotif('Visite de ' + monthLabel(m) + ' non réalisée — ' + s.publicId, s.localite, ['Accès impossible (route, pluie, cyclone)', 'Insécurité', 'Site fermé / activité arrêtée', 'Capacité de l’équipe', 'Reporté au mois suivant', 'Autre (préciser)'], mo => { const R2 = plStore(true); R2.misses[k + '|' + m] = { motif: mo, by: SESSION.by || '—', date: today() }; plTouch('motif non réalisé', m, k + ' : ' + mo); closeDrawer(); })))));
    const lim = [];
    if (s.unmeasured) lim.push('Jamais visité : le risque n’est pas mesuré ; le score affiché est théorique (facteurs par défaut), il ne sert qu’à l’ordre de passage.');
    if (s.nScore === 1) lim.push('Score de conformité calculé sur une seule visite : indicatif, il peut changer fortement à la prochaine visite.');
    if (!s.secKnown) lim.push('Situation sécuritaire non renseignée (0 par défaut) : le site reste planifiable.');
    if (s.annee && R.months.some(m => +m.slice(0, 4) !== +s.annee)) lim.push('Grille d’activation ' + R.months.filter(m => +m.slice(0, 4) !== +s.annee).map(m => m.slice(0, 4))[0] + ' non renseignée : le site est supposé actif ces mois-là.');
    lim.push('Le facteur « délai » augmente chaque jour : le score est calculé au ' + dFrUI(R.ref) + ' sur les visites jusqu’au ' + dFrUI(R.dataEnd) + '.');
    openDrawer(s.publicId + ' · ' + s.localite, ACT[s.act].label + ' — ' + s.commune + ', district ' + s.district + ', ' + s.region + ' · bureau ' + s.fo, [
      xsec('Site', [kvList([['ID site / Code POI', s.publicId + ' / ' + s.code], ['Équipe de suivi', s.team ? s.team.org + ' (d’après les visites ' + (s.team.src === 'site' ? 'sur ce site' : s.team.src === 'commune' ? 'dans la commune' : 'dans le district') + ', 6 derniers mois)' : 'non attribuée (aucune visite récente dans la commune ni le district)'],
        ['Actif', s.actif ? 'Oui' : 'Non' + (s.motif ? ' — ' + s.motif : '')], ['Sécurité', s.secKnown ? s.security + ' – ' + SEC[s.security] : 'non renseignée (0 par défaut)'],
        ['Grille d’activation ' + (s.annee || ''), s.months.split('').map((x, i) => MONTHS_FR[i] + ' ' + (x === '1' ? 'Oui' : x === '0' ? 'Non' : '–')).join(' · ')], ['Visites exploitables', fmt(s.nVis) + (s.nVis ? ' (dernière le ' + dFrUI(s.last) + ')' : '')]])]),
      active ? xsec('Score de risque : ' + (s.unmeasured ? 'jamais visité (risque non mesuré, score théorique ' + fmt(s.R, 1) + ')' : fmt(s.R, 1) + ' / 100 → ' + PL_CAT[s.cat].toLowerCase()), [plFactorTable(s), formulaBox('R = (' + parts + ') = ' + fmt(s.R, 1) + ' / 100. Seuils : ' + plLevelsText(cfg) + '.')]) : xsec('Planification', [limitBox(s.security >= 99 ? 'Zone interdite (sécurité 99) : exclu de la planification.' : 'Site désactivé : exclu de la planification (réactivez-le dans l’onglet Sites, avec un motif).', 'warn')]),
      active ? xsec('Intervalle minimal entre deux suivis (RBM)', [formulaBox(plIntervalText(s)), kvList([['Règle', 'intervalle minimal = fréquence RBM du niveau de risque (' + s.freqSrc + ') ; la MMR fixe un nombre minimal de visites, jamais un intervalle plus court'], ['Dernière visite réelle', s.last ? dFrUI(s.last) + ' (' + fmt(s.since) + ' j)' : 'jamais'], s.anchorSrc === 'plan validé' ? ['Ancrage', 'visite du plan validé de ' + monthLabel(s.anchorM) + ' (postérieure à la dernière visite réelle)'] : null, ['Retard', s.late ? 'oui : visite possible depuis ' + monthLabel(s.dueRaw) + ', ' + s.monthsLate + ' mois de retard' : 'non'], s.mmrChk ? ['Plancher MMR ' + ACT[s.act].short, (s.mmrChk.ok ? '' : '⚠ ') + s.mmrChk.txt] : null, ['À vérifier sur place', s.how]])]) : null,
      active ? xsec('Pourquoi ce site est (ou n’est pas) planifié', [kvList(mrows)]) : null,
      s.hist.length ? xsec('Dernières visites', [kvList(s.hist.slice(-5).reverse().map(v => [dFrUI(v.date), 'score ' + fmt(v.score, 1) + ' · ' + (v.risks.length ? v.risks.length + ' alerte(s) : ' + v.risks.map(r => riskLabel(s.act, r)).join(', ') : 'aucune alerte')]))]) : null,
      acts.length ? xsec('Modifier le plan (administrateur, motif obligatoire)', [el('div', { class: 'frow' }, acts)]) : null,
      xsec('Limites', lim.map(t => limitBox(t, 'hint')))]);
  }
  function plAskMotif(title, sub, options, onOk) {
    const ov = el('div', { class: 'modal-ov', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const sel = el('select', { 'aria-label': 'Motif' }); options.forEach(m => sel.appendChild(el('option', { value: m, text: m })));
    const pr = inp({ type: 'text', maxlength: 160, placeholder: 'Complément (obligatoire pour « Autre »)', 'aria-label': 'Préciser' });
    const msg = el('p', { class: 'modal-err' });
    const close = () => { ov.remove(); document.removeEventListener('keydown', esc); }, esc = e => { if (e.key === 'Escape') close(); };
    const ok = () => { let m = sel.value; const p = pr.value.replace(/\s+/g, ' ').trim(); if (/^Autre/.test(m)) { if (p.length < 3) { msg.textContent = 'Précisez le motif.'; pr.focus(); return; } m = 'Autre : ' + p; } else if (p) m += ' – ' + p; close(); onOk(m); };
    ov.appendChild(el('div', { class: 'modal' }, [el('h2', { text: title }), sub ? el('p', { class: 'hint', text: sub }) : null, el('label', { class: 'fld' }, ['Motif', sel]), el('label', { class: 'fld' }, ['Préciser', pr]), msg, el('div', { class: 'mrow' }, [btn('Enregistrer', ok, 'on'), btn('Annuler', close)]), el('p', { class: 'hint', text: 'Enregistré dans le fichier avec la date et l’auteur (« Mis à jour par » de l’onglet Données).' })]));
    ov.addEventListener('click', e => { if (e.target === ov) close(); }); document.addEventListener('keydown', esc); document.body.appendChild(ov); sel.focus();
  }

  // ------------------------------------------------------------------ ONGLET SITES (registre) — même moteur, mêmes filtres, même tiroir
  function plSecView(s) { const sp = el('span', { class: 'cell bg-' + (!s.secKnown ? 'na' : s.security >= 99 ? 'bad' : s.security >= 3 ? 'mid' : 'good'), text: s.secKnown ? String(s.security) : 'n.r.' }); bindTip(sp, () => s.secKnown ? 'Situation sécuritaire : ' + s.security + ' – ' + SEC[s.security] + '\n0 pas de restriction, 1 modérée, 3 stricte, 99 zone interdite (exclue de la planification)' : 'Situation sécuritaire non renseignée (0 par défaut, jamais saisie) : le site reste planifiable.'); return sp; }
  function plSecCell(s) {
    if (!SESSION.admin) return plSecView(s);
    const se = el('select', { 'aria-label': 'Situation sécuritaire' }); if (!s.secKnown) se.appendChild(el('option', { value: '', text: '— non renseignée —' }));
    [0, 1, 3, 99].forEach(v => { const o = el('option', { value: v, text: v + ' – ' + SEC[v] }); if (s.secKnown && v === s.security) o.selected = true; se.appendChild(o); });
    se.addEventListener('change', () => { if (se.value === '') return; plEdit([{ j: s.j, field: 'security', value: +se.value }], { motif: 'Situation sécuritaire : ' + se.value + ' – ' + SEC[+se.value], force: true }); });
    return se;
  }
  function plActCell(s) {
    if (!SESSION.admin) return el('span', { class: 'cell bg-' + (s.actif ? 'good' : 'na'), text: s.actif ? 'Actif' : 'Inactif' });
    const cb = el('input', { type: 'checkbox', 'aria-label': 'Site actif' }); cb.checked = s.actif;
    cb.addEventListener('change', () => { const want = cb.checked; cb.checked = !want; askMotif(s, want, motif => plEdit([{ j: s.j, field: 'actif', value: want ? 1 : 0, motif }], { motif })); });
    return el('label', { class: 'tog' }, [cb, s.actif ? ' actif' : ' inactif']);
  }
  function plRenderSites(main) {
    const cfg = rbmCfg(), R = rbmCompute(cfg), all = siteFiltered(R.all), on = all.filter(s => s.actif), CM = currentMonth();
    const plannable = on.filter(s => s.security < 99), visited = plannable.filter(s => s.nVis), late = plannable.filter(s => s.late), never = plannable.filter(s => !s.nVis);
    const secK = all.filter(s => s.secKnown);
    const status = s => s.security >= 99 ? 'Zone interdite' : !s.actif ? 'Désactivé' : !s.nVis ? 'Jamais visité' : s.late ? 'En retard' : s.dueRaw === CM ? 'Dû ce mois' : 'À jour';
    const q = plNorm(SITE_UI.q);
    const rows = all.filter(s => (SITE_UI.status === 'all' || (SITE_UI.status === 'on' && s.actif) || (SITE_UI.status === 'off' && !s.actif) || (SITE_UI.status === 'never' && s.actif && !s.nVis) || (SITE_UI.status === 'late' && s.actif && s.late) || (SITE_UI.status === 'secnr' && !s.secKnown)) &&
      (!q || plNorm(s.publicId + ' ' + s.code + ' ' + s.localite + ' ' + s.commune + ' ' + s.district + ' ' + s.fokontany).indexOf(q) >= 0));
    main.appendChild(el('div', { class: 'kpis' }, [
      kpi(fmt(on.length), 'Sites actifs', 'sur ' + fmt(all.length), null, 'Sites du registre marqués actifs (colonne Actif, modifiable en mode administrateur avec un motif) ; ' + fmt(all.length - on.length) + ' désactivé(s). Seuls les sites actifs, hors zone interdite et actifs le mois considéré (grille), comptent dans la couverture, la carte et la planification.'),
      kpi(fmt(visited.length), 'Déjà visités', 'sur ' + fmt(plannable.length) + ' sites actifs', null, 'Au moins une visite exploitable sur toute la période des données (du ' + dFrUI(D.period[0]) + ' au ' + dFrUI(D.period[1]) + ') : ' + pct(plannable.length ? visited.length / plannable.length * 100 : null) + ' des sites actifs.'),
      kpi(fmt(never.length), 'Jamais visités', 'sur ' + fmt(plannable.length), never.length ? 'bad' : 'good', 'Sites actifs sans aucune visite exploitable : risque non mesuré, catégorie à part dans la planification.'),
      kpi(fmt(late.length), 'En retard', 'sur ' + fmt(visited.length) + ' sites visités', late.length ? 'mid' : 'good', 'Sites dont la prochaine visite possible est dépassée au ' + dFrUI(localDay()) + '. Échéance = mois de la dernière visite + intervalle RBM du niveau de risque (' + PL_FK.filter(k => k !== 'never').map(k => PL_CAT[k].toLowerCase() + ' ' + every(cfg.freq[k])).join(', ') + ') ; les mois où la grille d’activation dit « Non » (vacances scolaires, fin de distribution) ne comptent pas dans ce délai ; en retard si l’échéance est antérieure au mois courant. Remplace l’ancien seuil fixe de 90 jours. Tant que la grille n’est pas corrigée (bloc Saisonnalité plus bas), les écoles en vacances restent comptées en retard.'),
      secK.length ? kpi(fmt(all.filter(s => s.security >= 99).length), 'Zones interdites', fmt(secK.length) + ' sites renseignés sur ' + fmt(all.length), all.some(s => s.security >= 99) ? 'bad' : null, 'Situation sécuritaire saisie site par site (0, 1, 3 ou 99) ; ' + fmt(all.filter(s => s.security === 3).length) + ' en restriction stricte. Les sites non renseignés restent planifiables.') :
        kpi(fmt(all.length), 'Sécurité non renseignée', 'sur ' + fmt(all.length) + ' sites', 'na', 'Aucune situation sécuritaire n’a été saisie : les ' + fmt(all.length) + ' sites sont à 0 par défaut (valeur posée à l’import du plan). Zéro zone interdite déclarée ne veut donc pas dire que la vérification a été faite.'),
      kpi(fmt(on.filter(s => s.lastScore !== null && s.lastScore < THR.mid).length), 'Dernier score faible', 'sous ' + THR.mid + ' à la dernière visite', 'bad', 'Score de conformité de la dernière visite exploitable inférieur au seuil « faible » (' + scoreRefText() + ').')]));
    const qs = inp({ type: 'search', placeholder: 'ID, code, localité, commune, district…', 'aria-label': 'Rechercher un site' }); qs.value = SITE_UI.q; qs.addEventListener('change', () => { SITE_UI.q = qs.value; SITE_UI.page = 0; render(); });
    const ss = el('select', { 'aria-label': 'Statut' }); [['all', 'Tous les sites'], ['on', 'Actifs'], ['off', 'Désactivés'], ['never', 'Jamais visités'], ['late', 'En retard'], ['secnr', 'Sécurité non renseignée']].forEach(([v, t]) => { const o = el('option', { value: v, text: t }); if (v === SITE_UI.status) o.selected = true; ss.appendChild(o); });
    ss.addEventListener('change', () => { SITE_UI.status = ss.value; SITE_UI.page = 0; render(); });
    const PAGE = 300, pages = Math.max(1, Math.ceil(rows.length / PAGE)); if (SITE_UI.page >= pages) SITE_UI.page = 0;
    const sorted = rows.slice().sort((a, b) => (b.actif - a.actif) || ((a.late ? 0 : 1) - (b.late ? 0 : 1)) || (b.monthsLate - a.monthsLate) || (a.publicId < b.publicId ? -1 : 1));
    const slice = sorted.slice(SITE_UI.page * PAGE, SITE_UI.page * PAGE + PAGE);
    const bar = el('div', { class: 'frow' }, [el('label', { class: 'fld' }, ['Recherche', qs]), el('label', { class: 'fld' }, ['Statut', ss]),
      btn('Registre DOTS (.xlsx)', plExportDots, 'on'), lockBadge(), !SESSION.admin ? btn('Gérer', () => requireAdmin(render)) : null,
      SESSION.planPending ? el('span', { class: 'hint', text: 'Mise à jour de la carte…' }) : null]);
    const pager = pages > 1 ? el('div', { class: 'frow' }, [btn('‹ Précédente', () => { SITE_UI.page = Math.max(0, SITE_UI.page - 1); render(); }), el('span', { class: 'hint', text: 'Sites ' + fmt(SITE_UI.page * PAGE + 1) + '–' + fmt(Math.min(rows.length, SITE_UI.page * PAGE + PAGE)) + ' sur ' + fmt(rows.length) }), btn('Suivante ›', () => { SITE_UI.page = Math.min(pages - 1, SITE_UI.page + 1); render(); })]) : null;
    const rk = s => { if (!s.lastV) return '–'; const n = s.lastRisks.length; const sp = el('span', { class: 'cell bg-' + (n ? 'bad' : 'good'), text: String(n) }); bindTip(sp, () => n ? 'Alertes à la dernière visite (' + s.last + ') :\n• ' + riskNames(s).join('\n• ') : 'Aucune alerte critique à la dernière visite.'); return sp; };
    const scc = s => s.lastScore === null ? '–' : cell(s.lastScore, false, 'Dernière visite : ' + s.last + (s.hist.length > 1 ? '\nScores précédents : ' + s.hist.slice(-4, -1).map(v => v.date + ' → ' + fmt(v.score, 0)).join(' ; ') : ''));
    main.appendChild(plCard('Registre des sites', 'Registre unique : ' + fmt(D.planFull.rows.length) + ' sites, clé Code POI + activité. Filtres du haut : activité, bureau, région, district.\nUn site est planifiable un mois donné si Actif = Oui, grille du mois à Oui et hors zone interdite.\nEn mode administrateur : Actif (avec motif), grille mensuelle (clic sur un mois) et sécurité sont modifiables ; chaque changement est journalisé et met aussitôt à jour la couverture, la carte et le plan.\nChaque ligne ouvre le détail du site.', [bar, pager,
      table([{ k: 'publicId', t: 'ID site', title: 'Identifiant public MEMS (S-XXXX-XXXX), attribué une fois et jamais modifié' }, { k: 'code', t: 'Code POI' }, { k: 'act', t: 'Activité', fmt: s => ACT[s.act].short }, { k: 'region', t: 'Région' }, { k: 'district', t: 'District' }, { k: 'commune', t: 'Commune' }, { k: 'localite', t: 'Localité / école' }, { k: 'fo', t: 'Bureau' },
        { k: 'actif', t: 'Actif', fmt: plActCell, sortVal: s => s.actif ? 1 : 0, title: 'Site actif dans le plan de suivi (modifiable en mode administrateur, avec motif)' },
        { k: 'cat', t: 'Risque', fmt: s => s.actif && s.security < 99 ? plCatBadge(s) : '–', sortVal: s => s.actif && s.security < 99 ? s.sortKey : -1 },
        { k: 'nVis', t: 'Visites', num: 1, title: 'Visites exploitables sur toute la période' }, { k: 'last', t: 'Dernière visite', fmt: s => s.last ? dFrUI(s.last) : 'jamais', sortVal: s => s.last || '' },
        { k: 'lastScore', t: 'Dernier score', num: 1, fmt: scc }, { k: 'nr', t: 'Alertes', num: 1, fmt: rk, sortVal: s => s.lastV ? s.lastRisks.length : null, title: 'Alertes critiques relevées à la dernière visite' },
        { k: 'security', t: 'Sécurité', fmt: secCell, sortVal: s => s.secKnown ? s.security : -1, title: 'Situation sécuritaire : 0 / 1 / 3 / 99 (99 = zone interdite) ; « n.r. » = jamais renseignée' },
        { k: 'months', t: 'Mois actifs', fmt: monthGrid, sortVal: s => s.months.split('').filter(x => x === '1').length, title: 'Grille Oui/Non par mois (colonnes Jan…Déc du plan) : un site n’est planifiable que les mois « Oui »' },
        { k: 'st', t: 'Statut', fmt: status, sortVal: s => s.late ? 1000 + s.monthsLate : !s.nVis ? 999 : 0 }, { k: 'motif', t: 'Motif', fmt: s => { if (!s.motif) return '–'; const sp = el('span', { class: 'pl-motif', text: s.motif.length > 40 ? s.motif.slice(0, 38) + '…' : s.motif }); bindTip(sp, () => 'Motif du changement : ' + s.motif); return sp; }, title: 'Motif du changement (colonne du plan de suivi)' }], slice, { onRow: s => plSiteDrawer(s.j) })], 'wide'));
    main.lastChild.querySelector('.tw').classList.add('compact');
    plSeasonCard(main);
    const vis = siteIndex(); const inPlan = new Set(D.planFull.rows.map(r => r[1] + '|' + r[0]));
    const off = Array.from(vis.keys()).filter(k => !inPlan.has(k) && (F.act === 'ALL' || k.startsWith(F.act + '|')));
    const byAct = {}; off.forEach(k => { const a = k.slice(0, k.indexOf('|')); byAct[a] = (byAct[a] || 0) + 1; });
    if (off.length) main.appendChild(el('div', { class: 'frow pl-off' }, [el('span', { text: fmt(off.length) + ' sites visités hors registre' }), infoBtn('Couples activité × site visités mais absents du registre (' + Object.keys(byAct).map(a => (ACT[a] ? ACT[a].short : a) + ' ' + byAct[a]).join(', ') + ') : ils ne sont pas planifiables tant qu’ils ne sont pas ajoutés au registre (import du plan de suivi, onglet Données).'),
      btn('Liste (.xlsx)', () => downloadBlob(xlsxBlob([{ name: 'Visités hors registre', header: ['Activité', 'Code site', 'Visites exploitables', 'Dernière visite', 'Nom du site (visites)'], rows: off.map(k => { const l = vis.get(k); const a = k.slice(0, k.indexOf('|')); return [ACT[a] ? ACT[a].short : a, k.slice(k.indexOf('|') + 1), l.length, l[l.length - 1].date, DICT.site[l[l.length - 1].site] || '']; }) }]), 'sites_hors_registre_' + today() + '.xlsx'), 'sm')]));
  }
  // contrôle de saisonnalité de la grille d'activation : mois de l'année du plan sans (presque) aucune visite, par activité
  let PL_SEA = null, PL_SEAV = '';
  function plSeasonality() {
    if (PL_SEA && PL_SEAV === plVer()) return PL_SEA;
    const PY = planYearUI(), endM = plDataEnd().slice(0, 7), out = [];
    const cnt = new Map(); V.forEach(v => { if (v.valid && v.date && v.month.slice(0, 4) === PY) cnt.set(v.act + '|' + v.month, (cnt.get(v.act + '|' + v.month) || 0) + 1); });
    const rows = siteRows();
    ACTS.forEach(a => {
      const ms = []; for (let i = 1; i <= 12; i++) { const m = PY + '-' + String(i).padStart(2, '0'); if (m <= endM) ms.push(m); }
      const first = ms.find(m => cnt.get(a + '|' + m)); if (!first) return;
      const span = ms.filter(m => m >= first), med = median(span.map(m => cnt.get(a + '|' + m) || 0)) || 0; if (med < 10) return;
      span.forEach(m => {
        const n = cnt.get(a + '|' + m) || 0; if (n > Math.max(1, med * 0.02)) return;
        const mi = +m.slice(5) - 1; const sites = rows.filter(s => s.act === a && s.actif && +s.annee === +PY && s.months[mi] === '1').map(s => s.j);
        if (sites.length) out.push({ act: a, m, n, med, sites, partial: m === endM && plLastComplete() !== endM });
      });
    });
    PL_SEA = out; PL_SEAV = plVer(); return out;
  }
  function plSeasonCard(main) {
    const P = plSeasonality(); if (!P.length) return;
    const rows = P.map(p => ({ p, act: ACT[p.act].short, m: monthLabel(p.m), n: p.n, med: p.med, sites: p.sites.length }));
    main.appendChild(plCard('Saisonnalité à vérifier', 'Mois de ' + planYearUI() + ' où une activité n’a pas ou presque pas de visite exploitable alors que la grille dit Oui : vacances scolaires (SMP), fin des distributions (GD)… Règle : au plus 2 % de la médiane mensuelle de l’activité (au moins 1 visite). Avant de valider, vérifiez qu’il ne s’agit pas d’un trou d’extraction. Proposition : passer ces sites à « Non » pour ce mois, avec un motif ; rien n’est changé sans votre clic (administrateur).', [
      table([{ k: 'act', t: 'Activité' }, { k: 'm', t: 'Mois' }, { k: 'n', t: 'Visites', num: 1, fmt: r => fmt(r.n) + (r.p.partial ? ' (mois incomplet)' : '') }, { k: 'med', t: 'Médiane / mois', num: 1, fmt: r => fmt(r.med) }, { k: 'sites', t: 'Sites à Oui', num: 1, fmt: r => fmt(r.sites) },
        { k: 'go', t: 'Proposition', fmt: r => btn('Passer à Non', () => requireAdmin(() => plAskMotif('Grille ' + r.act + ' — ' + r.m + ' : passer à « Non »', fmt(r.sites) + ' site(s) actifs ; ' + fmt(r.n) + ' visite(s) observée(s) contre une médiane de ' + fmt(r.med) + ' par mois.', [r.p.act === 'SMP' ? 'Vacances scolaires' : 'Fin des distributions / activité arrêtée ce mois', 'Saisonnalité observée dans les données', 'Autre (préciser)'], mo => {
          const ci = D.planFull.cols.indexOf('months'), mi = +r.p.m.slice(5) - 1;
          plEdit(r.p.sites.map(j => { const a = (D.planFull.rows[j][ci] || '------------').split(''); a[mi] = '0'; return { j, field: 'months', value: a.join('') }; }), { batch: true, act: r.p.act, field: 'months', scope: r.act + ' · ' + r.m, before: 'Oui', after: 'Non', motif: mo });
        })), 'sm') }], rows)]));
  }

  // ------------------------------------------------------------------ ONGLET DONNÉES : mises à jour, journal, import unique (vérifier puis appliquer)
  function plUpdatesCard(main) {
    const U = D.updated || {};
    const rows = D.acts.map(a => { const u = U[a.code] || {}; const dq = D.dq.find(x => x.act === a.code) || {}; const vs = V.filter(v => v.act === a.code && v.valid && v.date).map(v => v.date).sort();
      return { act: a.short, kind: 'Données de visites', date: u.date || '–', by: u.by || '–', file: u.file || '–', rows: u.rows, subs: dq.subs, vv: dq.validVisits, per: vs.length ? vs[0] + ' → ' + vs[vs.length - 1] : '–' }; });
    const pu = U.PLAN || {}, pe = CUR.planEdited, RP = plStore(false);
    rows.push({ act: 'Plan de suivi (registre)', kind: 'Plan de suivi', date: pu.date || 'version d’origine', by: pu.by || '–', file: pu.file || '–', rows: D.planFull.rows.length, subs: null, vv: null, per: 'année ' + planYearUI() + (pe ? ' · modifié le ' + pe.date + ' par ' + pe.by + ' (' + fmt((CUR.planLog || []).length) + ' changement(s) journalisé(s))' : '') });
    if (RP && Object.keys(RP.months).length) rows.push({ act: 'Plan de visites validé', kind: 'Planification', date: RP.savedAt || '–', by: RP.by || '–', file: '–', rows: Object.keys(RP.months).reduce((a, m) => a + (RP.months[m].n || 0), 0), subs: null, vv: null, per: Object.keys(RP.months).sort().map(monthLabel).join(', ') });
    if (D.rbmSaved) rows.push({ act: 'Paramètres de planification', kind: 'Planification', date: D.rbmSaved.date, by: D.rbmSaved.by, file: '–', rows: null, subs: null, vv: null, per: '–' });
    main.appendChild(plCard('Mises à jour', 'Les données de visites (une extraction par activité) et le plan de suivi (registre des sites) sont mis à jour séparément ; la date et l’auteur de chacun sont enregistrés dans le fichier.', [table([
      { k: 'act', t: 'Contenu' }, { k: 'kind', t: 'Type' }, { k: 'date', t: 'Mise à jour le' }, { k: 'by', t: 'Par' }, { k: 'file', t: 'Fichier importé' }, { k: 'rows', t: 'Lignes', num: 1, fmt: r => r.rows === null || r.rows === undefined ? '–' : fmt(r.rows) },
      { k: 'subs', t: 'Fiches', num: 1, fmt: r => r.subs === null || r.subs === undefined ? '–' : fmt(r.subs) }, { k: 'vv', t: 'Visites exploitables', num: 1, fmt: r => r.vv === null || r.vv === undefined ? '–' : fmt(r.vv) }, { k: 'per', t: 'Période / détail' }], rows)], 'wide'));
  }
  function plLogCard(main) {
    const L = (CUR.importLog || []).slice(-50).reverse(); if (!L.length && !SESSION.log.length) return;
    main.appendChild(plCard('Journal des imports', 'Enregistré dans le fichier (200 derniers imports).', [table([{ k: 'when', t: 'Date' }, { k: 'by', t: 'Par' }, { k: 'what', t: 'Import' }, { k: 'res', t: 'Résultat' }, { k: 'warn', t: 'À noter' }], L.length ? L : SESSION.log.slice().reverse())], 'wide'));
  }
  const PL_MAX_FILE = 150e6;
  function plImportCard(main) {
    const by = inp({ type: 'text', placeholder: 'Nom de la personne', maxlength: 60, 'aria-label': 'Mis à jour par' }); by.value = SESSION.by || '';
    by.addEventListener('input', () => { SESSION.by = by.value.slice(0, 60); });
    const sel = el('select', { 'aria-label': 'Contenu du fichier' }); [['AUTO', 'Détection automatique']].concat(D.acts.map(a => [a.code, a.label]), [['PLAN', 'Plan de suivi (registre des sites)']]).forEach(([v, t]) => sel.appendChild(el('option', { value: v, text: t })));
    const fi = inp({ type: 'file', accept: '.csv,.txt,.xlsx,text/csv', 'aria-label': 'Fichier à importer' });
    const st = el('p', { class: 'hint pl-ist', text: 'CSV ou XLSX : extraction Tableau, export Kobo, ONA ou MoDA, ou plan de suivi.' });
    const pv = el('div', { class: 'pl-imp' });
    const say = (t, warn) => { st.textContent = t; st.className = 'note' + (warn ? ' warn' : ''); };
    fi.addEventListener('change', () => {
      const f = fi.files && fi.files[0]; clear(pv); PLS.imp = null; if (!f) return;
      if (f.size > PL_MAX_FILE) { say('Fichier refusé : ' + fmt(f.size / 1e6, 0) + ' Mo, au-delà du plafond de ' + fmt(PL_MAX_FILE / 1e6, 0) + ' Mo. Exportez une activité à la fois ou retirez les colonnes inutiles.', true); return; }
      say('Lecture de ' + f.name + '…');
      const rd = new FileReader(); rd.onerror = () => say('Lecture impossible.', true);
      rd.onload = async () => {
        try {
          const u8 = new Uint8Array(rd.result); let text, sheet = null;
          if (u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 3 && u8[3] === 4) { const X = await plXlsxToCsv(rd.result); text = X.csv; sheet = X.sheet; }
          else { text = new TextDecoder('utf-8').decode(u8); const bad = (text.slice(0, 200000).match(/�/g) || []).length; if (bad > 20) { try { text = new TextDecoder('windows-1252').decode(u8); } catch (e) { /* utf-8 gardé */ } } }
          const head = text.slice(0, Math.min(text.length, 1e6)).split(/\r?\n/)[0];
          const det = ENGINE.detectActDetail(CUR, head); let act = sel.value === 'AUTO' ? det.act : sel.value;
          if (!act) { say('Contenu non reconnu : choisissez l’activité puis rechargez le fichier.', true); plDetectView(pv, det); return; }
          const P = act === 'PLAN' ? ENGINE.previewPlan(CUR, text) : ENGINE.previewExtract(CUR, text, act);
          PLS.imp = { name: f.name, text, act, P, det, sheet };
          say('Vérification terminée, rien n’a été modifié.');
          plPreviewView(pv, PLS.imp);
        } catch (e) { say('Import refusé : ' + String((e && e.message) || e) + '. Les données existantes n’ont pas été modifiées.', true); }
      };
      rd.readAsArrayBuffer(f);
    });
    main.appendChild(plCard('Importer un fichier', 'Un seul import pour tout le tableau de bord. Une extraction remplace entièrement l’activité choisie (les extractions sont cumulatives) puis recalcule tous les indicateurs. Un plan de suivi remplace le registre des sites ; les identifiants, la sécurité et les cases de mois laissées vides sont conservés.\n\nExtraction Tableau : Données › Exporter les données vers CSV, avec toutes les colonnes. Export Kobo, ONA ou MoDA : CSV ou XLSX en valeurs XML (codes), avec ou sans groupes, séparateur virgule ou point-virgule ; l’identifiant _uuid, _id ou meta/instanceID sert si la colonne d’identifiant Tableau manque.\n\nMêmes règles que l’analyse initiale : dédoublonnage par fiche, visite = site × jour, scores recalculés, alertes critiques, rapprochement des noms d’agents.\n\nRien n’est modifié avant votre confirmation. Le traitement se fait dans le navigateur, aucune donnée n’est envoyée sur Internet. Plafond : ' + fmt(PL_MAX_FILE / 1e6, 0) + ' Mo par fichier.', [
      el('div', { class: 'frow' }, [el('label', { class: 'fld' }, ['Mis à jour par', by]), el('label', { class: 'fld' }, ['Contenu', sel]), el('label', { class: 'fld' }, ['Fichier', fi])]), st, pv], 'wide'));
  }
  function plDetectView(pv, det) {
    clear(pv); if (!det || !det.scores || !det.scores.length) return;
    pv.appendChild(xsec('Détection', [kvList(det.scores.slice(0, 5).map(x => [ACT[x.act] ? ACT[x.act].short : x.act, fmt(x.hit) + ' variable(s) du formulaire reconnue(s) sur ' + fmt(Math.round(x.hit / Math.max(x.share, 1e-9))) + ' (' + pct(x.share * 100) + ')' + (x.exactId ? ', identifiant Tableau présent' : '')]))]));
  }
  function plPreviewView(pv, I) {
    clear(pv); const P = I.P, errs = [], warns = [];   // warns : [texte court, détail]
    let kv, cols;
    const colTable = rows => el('div', { class: 'tw' }, (() => { const t = el('table'); t.appendChild(el('thead', null, el('tr', null, ['Colonne attendue', 'Colonne du fichier', 'Règle'].map(h => el('th', { scope: 'col', text: h }))))); const tb = el('tbody'); rows.forEach(a => tb.appendChild(el('tr', null, [el('td', { text: a[0] }), el('td', { text: a[1] }), el('td', { text: a[2] === 'liste' ? 'choix multiple dans une seule colonne' : a[2] === 'identifiant' ? 'identifiant de soumission' : 'nom de variable' })]))); t.appendChild(tb); return t; })());
    if (I.act === 'PLAN') {
      if (P.missingKey.length) errs.push('Colonnes obligatoires absentes : ' + P.missingKey.join(', '));
      if (P.err) errs.push(P.err); if (!P.missingKey.length && !P.err && !P.sites) errs.push('Aucun site reconnu');
      if (P.missing.length) warns.push(['Colonnes absentes : ' + fmt(P.missing.length), P.missing.join(', ') + '. Les valeurs actuelles sont conservées ou laissées vides.']);
      if (P.removed) warns.push([fmt(P.removed) + ' sites seront retirés du registre', 'Sites du registre actuel absents du fichier. Leur identifiant S-XXXX-XXXX et leur sécurité sont conservés s’ils reviennent.']);
      kv = [['Contenu', 'Plan de suivi' + (I.sheet ? ', feuille ' + I.sheet : '')], ['Sites reconnus', fmt(P.sites) + ' (actuellement ' + fmt(D.planFull.rows.length) + ')'], ['Changements', fmt(P.added) + ' ajoutés, ' + fmt(P.removed) + ' retirés, ' + fmt(P.actifChanged) + ' Actif modifiés, ' + fmt(P.monthsChanged) + ' grilles modifiées'], ['Année', P.years.join(', ') || '–']];
      cols = [el('p', { class: 'hint', text: fmt(P.rows) + ' lignes, ' + fmt(P.exactN) + ' colonnes reconnues par leur nom, ' + fmt(P.aliasN) + ' par correspondance, ' + fmt(P.ignored.length) + ' ignorées.' }), P.alias.length ? colTable(P.alias) : null, P.ignored.length ? el('p', { class: 'hint', text: 'Ignorées : ' + P.ignored.join(', ') }) : null];
    } else {
      const S = ACT[I.act]; const share = P.nVars ? P.found / P.nVars : 0;
      if (!P.idOk) errs.push('Aucune colonne d’identifiant (Tableau, _uuid, _id ou meta/instanceID)');
      if (!P.fiches) errs.push('Aucune fiche trouvée');
      if (share < 0.15) errs.push('Seules ' + fmt(P.found) + ' variables sur ' + fmt(P.nVars) + ' du formulaire ' + S.short + ' sont reconnues : ce n’est probablement pas cette activité');
      const top = I.det && I.det.scores && I.det.scores[0]; if (top && top.act !== I.act && top.act !== 'PLAN' && top.score > 3) warns.push(['Ressemble plutôt à ' + (ACT[top.act] ? ACT[top.act].short : top.act), 'La détection automatique reconnaît davantage de variables de ' + (ACT[top.act] ? ACT[top.act].short : top.act) + ' que de ' + S.short + '.']);
      if (P.tbMissing.length) warns.push(['Colonnes de site ou de GPS absentes', P.tbMissing.join(', ') + '. Les visites ne pourront pas toutes être rattachées à un site ou géolocalisées.']);
      if (P.outWin) warns.push([fmt(P.outWin) + ' fiches hors période', 'Fiches datées hors de la période de validité (du ' + dFrUI(P.win[0]) + ' au ' + dFrUI(P.win[1]) + ') : elles seront exclues des indicateurs.']);
      if (P.noDate) warns.push([fmt(P.noDate) + ' fiches sans date', 'Date d’enquête illisible' + (P.dateCol ? '' : ' (colonne de date introuvable)') + '.']);
      const dq = D.dq.find(x => x.act === I.act) || {};
      kv = [['Activité', S.label + (I.sheet ? ', feuille ' + I.sheet : '')], ['Fiches', fmt(P.fiches) + ', remplacent les ' + fmt(dq.subs) + ' actuelles'], ['Période', P.period ? dFrUI(P.period[0]) + ' au ' + dFrUI(P.period[1]) : 'non lisible'], ['Variables reconnues', fmt(P.found) + ' / ' + fmt(P.nVars) + ' (' + pct(share * 100) + ')'], ['Identifiant', P.idSource || '–']];
      cols = [el('p', { class: 'hint', text: fmt(P.rows) + ' lignes et ' + fmt(P.ncols) + ' colonnes. ' + fmt(P.exactN) + ' reconnues par leur nom exact, ' + fmt(P.aliasN) + ' par correspondance (nom de variable, groupe/variable, choix multiples' + (P.byLabel ? ', ' + fmt(P.byLabel) + ' par libellé' : '') + '), ' + fmt(P.ignored.length) + ' ignorées.' + (P.dateCol ? ' Date lue dans « ' + P.dateCol + ' ».' : '') }),
        P.alias.length ? colTable(P.alias) : null, P.missing.length ? el('p', { class: 'hint', text: 'Variables attendues absentes (' + fmt(P.missing.length) + ', indicateurs correspondants vides) : ' + P.missing.join(', ') }) : null, P.ignored.length ? el('p', { class: 'hint', text: 'Colonnes ignorées : ' + P.ignored.join(', ') }) : null];
    }
    pv.appendChild(xsec('Vérification', [kvList(kv)]));
    pv.appendChild(el('details', { class: 'rbm-panel' }, [el('summary', { text: 'Colonnes' })].concat(cols.filter(Boolean))));
    errs.forEach(t => pv.appendChild(el('p', { class: 'note warn', text: t })));
    if (warns.length) pv.appendChild(el('div', { class: 'pl-warns' }, warns.map(w => el('span', { class: 'pl-wchip' }, [w[0], infoBtn(w[1])]))));
    const go = btn('Appliquer l’import', () => plApplyImport(), 'on'); if (errs.length) { go.disabled = true; go.title = 'Vérification échouée : rien ne sera écrit.'; }
    pv.appendChild(el('div', { class: 'frow' }, [go, btn('Annuler', () => { PLS.imp = null; clear(pv); })]));
  }
  function plApplyImport() {
    const I = PLS.imp; if (!I) return;
    requireAdmin(() => setTimeout(() => {
      const when = today() + ' ' + new Date().toTimeString().slice(0, 5), who = SESSION.by || '—';
      try {
        let P2, entry;
        if (I.act === 'PLAN') {
          P2 = ENGINE.refreshPlanTables(ENGINE.importPlan(CUR, I.text));
          P2.updated = Object.assign({}, P2.updated, { PLAN: { date: today(), by: who, file: I.name, rows: P2.planFull.rows.length } });
          entry = { when, by: who, what: 'Plan de suivi – ' + I.name, res: fmt(P2.planFull.rows.length) + ' sites (' + fmt(I.P.added) + ' ajoutés, ' + fmt(I.P.removed) + ' retirés, ' + fmt(I.P.actifChanged) + ' « Actif » modifiés)', warn: I.P.missing.length ? 'Colonnes absentes : ' + I.P.missing.join(', ') : '—' };
          P2.planVersion = (CUR.planVersion || 0) + 1; P2.planEdited = { date: today(), by: who };
        } else {
          const before = D.dq.find(x => x.act === I.act) || {};
          const res = ENGINE.importActivity(CUR, I.act, I.text, { date: today(), by: who, file: I.name }); const Rp = res.report; P2 = res.P;
          entry = { when, by: who, what: ACT[I.act].short + ' – ' + I.name + (I.P.aliasN ? ' (' + fmt(I.P.aliasN) + ' colonnes par correspondance)' : ''), res: fmt(Rp.subs) + ' fiches (avant : ' + fmt(before.subs) + '), ' + fmt(Rp.validVisits) + ' visites exploitables (avant : ' + fmt(before.validVisits) + ')' + (Rp.period ? ', du ' + Rp.period[0] + ' au ' + Rp.period[1] : ''),
            warn: Rp.missing.length ? Rp.missing.length + ' colonne(s) attendue(s) absente(s) : ' + Rp.missing.slice(0, 8).join(', ') + (Rp.missing.length > 8 ? '…' : '') + ' – les indicateurs correspondants restent vides.' : '—' };
        }
        P2.importLog = (CUR.importLog || []).concat([entry]).slice(-200);
        SESSION.log.push(entry); SESSION.dirty = true; SESSION.planPending = 0; PLS.imp = null; reboot(P2, 'data');
      } catch (e) { const pv = document.querySelector('.pl-imp'); if (pv) pv.appendChild(el('p', { class: 'note warn', text: 'Import refusé : ' + String((e && e.message) || e) + '. Les données existantes n’ont pas été modifiées.' })); }
    }, 30));
  }

  // ------------------------------------------------------------------ lecteur XLSX sans dépendance (zip + DecompressionStream), avec garde anti-bombe
  async function plXlsxToCsv(buf) {
    if (typeof DecompressionStream === 'undefined') throw new Error('ce navigateur ne sait pas lire les fichiers .xlsx (DecompressionStream absent) : enregistrez le classeur en CSV UTF-8 (Fichier › Enregistrer sous) puis importez le CSV');
    const LIM = { entries: 2000, total: 150e6, ratio: 100 };
    const u8 = new Uint8Array(buf), dv = new DataView(buf); let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('fichier .xlsx illisible (archive zip incomplète)');
    const nE = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
    if (nE > LIM.entries) throw new Error('archive refusée : ' + nE + ' entrées (plafond ' + LIM.entries + ')');
    const E = new Map(); let p = cdOff;
    for (let k = 0; k < nE; k++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('répertoire de l’archive corrompu');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      if (/\.\.|^\/|\\|[\x00-\x1f]/.test(name)) throw new Error('archive refusée : chemin suspect « ' + name.slice(0, 60) + ' »');
      E.set(name, { method, csize, usize, lho });
    }
    const read = async (name, maxOut) => {
      const e = E.get(name); if (!e) return null;
      if (e.usize > maxOut) throw new Error('archive refusée : « ' + name + ' » décompressé ferait ' + fmt(e.usize / 1e6, 0) + ' Mo (plafond ' + fmt(maxOut / 1e6, 0) + ' Mo)');
      if (e.csize && e.usize / e.csize > LIM.ratio) throw new Error('archive refusée : taux de compression anormal (' + fmt(e.usize / e.csize, 0) + ' pour 1) sur « ' + name + ' »');
      if (e.lho + 30 > u8.length || dv.getUint32(e.lho, true) !== 0x04034b50) throw new Error('entrée d’archive corrompue');
      const start = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true); if (start + e.csize > u8.length) throw new Error('entrée d’archive tronquée'); const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return new TextDecoder().decode(data);
      if (e.method !== 8) throw new Error('compression non prise en charge dans « ' + name + ' »');
      const rdr = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(); const chunks = []; let tot = 0;
      for (;;) { const { done, value } = await rdr.read(); if (done) break; tot += value.length; if (tot > e.usize + 1024 || tot > maxOut) { try { await rdr.cancel(); } catch (x) { /* arrêt */ } throw new Error('archive refusée : décompression au-delà de la taille déclarée'); } chunks.push(value); }
      const out = new Uint8Array(tot); let o = 0; chunks.forEach(c => { out.set(c, o); o += c.length; }); return new TextDecoder().decode(out);
    };
    let budget = LIM.total; const take = async n => { const t = await read(n, budget); if (t) budget -= t.length; return t; };
    const wb = await take('xl/workbook.xml'); if (!wb) throw new Error('ce fichier n’est pas un classeur Excel (.xlsx)');
    const rels = (await take('xl/_rels/workbook.xml.rels')) || '';
    const relT = new Map(); (rels.match(/<Relationship\b[^>]*>/g) || []).forEach(t => { const id = (t.match(/\bId="([^"]+)"/) || [])[1], tg = (t.match(/\bTarget="([^"]+)"/) || [])[1]; if (id && tg) relT.set(id, tg.replace(/^\/?xl\//, '')); });
    const sheets = (wb.match(/<sheet\b[^>]*>/g) || []).map(t => ({ name: plXmlDec((t.match(/\bname="([^"]*)"/) || [])[1] || ''), target: relT.get((t.match(/\br:id="([^"]+)"/) || [])[1]) || '' })).filter(s => /^worksheets\/sheet\d+\.xml$/.test(s.target));
    if (!sheets.length) throw new Error('aucune feuille de données trouvée dans le classeur');
    const sh = sheets.slice().sort((a, b) => ((E.get('xl/' + b.target) || {}).usize || 0) - ((E.get('xl/' + a.target) || {}).usize || 0))[0];   // la feuille la plus grande = les données
    const ss = []; const sst = await take('xl/sharedStrings.xml'); if (sst) (sst.match(/<si>[\s\S]*?<\/si>/g) || []).forEach(si => { ss.push(plXmlDec((si.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || []).map(t => t.replace(/^<t\b[^>]*>|<\/t>$/g, '')).join(''))); });
    const sty = (await take('xl/styles.xml')) || ''; const fmts = new Map(); (sty.match(/<numFmt\b[^>]*>/g) || []).forEach(t => { fmts.set(+((t.match(/numFmtId="(\d+)"/) || [])[1]), plXmlDec((t.match(/formatCode="([^"]*)"/) || [])[1] || '')); });
    const xfs = ((sty.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [''])[0].match(/<xf\b[^>]*>/g) || []).map(t => { const id = +((t.match(/numFmtId="(\d+)"/) || [])[1] || 0); return (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (fmts.has(id) && /[dmyhs]/i.test(fmts.get(id).replace(/"[^"]*"|\[[^\]]*\]/g, ''))); });
    const xml = await take('xl/' + sh.target); if (!xml) throw new Error('feuille illisible');
    const colN = ref => { let n = 0; for (let i = 0; i < ref.length; i++) { const c = ref.charCodeAt(i); if (c < 65 || c > 90) break; n = n * 26 + c - 64; } return n - 1; };
    const toDate = v => { if (!(v > 0 && v < 2958466)) return String(v); const d = new Date(Math.round((v - 25569) * 86400000)); const iso = d.toISOString(); return Math.abs(v - Math.round(v)) < 1e-9 ? iso.slice(0, 10) : iso.slice(0, 19); };
    const q = x => /[",\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
    const out = []; const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g, cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let m, nRows = 0;
    while ((m = rowRe.exec(xml))) {
      const cells = []; let c; cRe.lastIndex = 0; const body = m[1];
      while ((c = cRe.exec(body))) {
        const at = c[1], inner = c[2] || ''; const ref = (at.match(/\br="([A-Z]+)\d+"/) || [])[1]; const j = ref ? colN(ref) : cells.length; if (j > 5000) throw new Error('feuille refusée : plus de 5 000 colonnes');
        const t = (at.match(/\bt="([^"]+)"/) || [])[1], s = +((at.match(/\bs="(\d+)"/) || [])[1] || 0); let v = '';
        if (t === 'inlineStr') v = plXmlDec((inner.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || []).map(x => x.replace(/^<t\b[^>]*>|<\/t>$/g, '')).join(''));
        else { const raw = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]; if (raw !== undefined) { if (t === 's') v = ss[+raw] || ''; else if (t === 'str' || t === 'e') v = plXmlDec(raw); else if (t === 'b') v = raw === '1' ? 'TRUE' : 'FALSE'; else v = xfs[s] && isFinite(+raw) ? toDate(+raw) : raw; } }
        cells[j] = v;
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
      out.push(cells.map(q).join(',')); nRows++;
    }
    return { csv: out.join('\n'), sheet: sh.name, rows: nRows };
  }
  function plXmlDec(s) { return String(s).replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (x, e) => { const k = e.toLowerCase(); if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'amp') return '&'; if (k === 'quot') return '"'; if (k === 'apos') return '\''; const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }); }
