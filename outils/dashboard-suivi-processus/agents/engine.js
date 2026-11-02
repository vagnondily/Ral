    // ================================================================ LOT AGENTS : notation des agents, des TPM et des MEO
    // UNE seule notation, pure (aucun accès au DOM), utilisée par recomputeTables (tables du fichier) ET par les onglets
    // Agents / Partenaires / Qualité sur les fiches filtrées. Chaque note garde ses comptes bruts (n / N), ses sous-notes et
    // ses points, pour que l'écran puisse refaire le calcul devant l'utilisateur.
    const AGX_MIN = 5, AGX_LOW = 10;   // = SMALL_N de l'interface : < 5 non calculé (poids redistribué) ; 5 à 9 indicatif
    const agxClip = (x, a, b) => Math.max(a, Math.min(b, x));
    // Table UNIQUE des critères de qualité de collecte d'un agent : poids, seuil (le même pour la couleur ET le point faible),
    // limite de l'orange, règle de sous-note, cause habituelle et action de correction.
    const AG_CRIT = [
      { k: 'valid', col: 'p_valid', label: 'Fiches exploitables', short: 'Exploitables', w: 0.22, dir: 1, thr: 90, warn: 80, wlab: 'fiches non exploitables',
        rule: 'sous-note = % de fiches exploitables', sub: v => agxClip(v, 0, 100),
        cause: 'agent (fiche vide, date de la tablette, fiche test)', how: 'Vérifier l’envoi complet des fiches, la bonne version du formulaire et la date de la tablette' },
      { k: 'gps', col: 'p_gps', label: 'GPS à 5 km au plus du site', short: 'GPS ≤ 5 km', w: 0.22, dir: 1, thr: 75, warn: 65, wlab: 'GPS absent/éloigné du site prévu',
        rule: 'sous-note = % des fiches vérifiables dont le GPS est valide et à 5 km au plus du site du plan', sub: v => agxClip(v, 0, 100),
        cause: 'agent (GPS absent ou pris loin du site) ; plan si les coordonnées du site sont fausses', how: 'Prendre le GPS sur le site même, attendre une précision ≤ 20 m' },
      { k: 'listname', col: 'p_listname', label: 'Nom choisi dans la liste', short: 'Nom liste', w: 0.10, dir: 1, thr: 80, warn: 70, wlab: 'nom saisi hors liste',
        rule: 'sous-note = % des fiches (formulaires avec liste d’agents) où l’agent s’est choisi dans la liste', sub: v => agxClip(v, 0, 100),
        cause: 'agent (choix « Autre ») ou bureau (nom absent de la liste)', how: 'Se sélectionner dans la liste ; demander au bureau l’ajout de son nom au formulaire' },
      { k: 'nsp', col: 'nsp', label: 'Réponses « Ne sait pas »', short: 'NSP', w: 0.08, dir: -1, thr: 5, warn: 10, wlab: '« Ne sait pas » fréquent',
        rule: 'sous-note = 100 − 10 × % de « Ne sait pas » (0 dès 10 %)', sub: v => (1 - agxClip(v / 10, 0, 1)) * 100,
        cause: 'agent (entretien peu préparé) ou répondant', how: 'Mieux préparer l’entretien, vérifier les documents avant de répondre' },
      { k: 'dup', col: 'p_dup', label: 'Doublons', short: 'Doublons', w: 0.10, dir: -1, thr: 5, warn: 10, wlab: 'doublons',
        rule: 'sous-note = 100 − 3 × % de doublons (0 dès 33,3 %)', sub: v => agxClip(100 - v * 3, 0, 100),
        cause: 'agent (fiche envoyée deux fois) ; ou plusieurs entretiens le même jour sur le même site', how: 'Ne soumettre qu’une fiche par module et par visite' },
      { k: 'dur', col: 'p_dur_ok', label: 'Durée de 3 min à 10 h', short: 'Durée', w: 0.10, dir: 1, thr: 70, warn: 60, wlab: 'durées anormales',
        rule: 'sous-note = % des fiches mesurées dont la durée ouverture → finalisation est de 3 min à 10 h', sub: v => agxClip(v, 0, 100),
        cause: 'pratique d’équipe (fiche finalisée plus tard) ; agent si < 3 min ; tablette si fin avant début', how: 'Ouvrir la fiche sur site et la finaliser le jour même' },
      { k: 'perf', col: 'p_perfect', label: 'Fiches « 100 % conformes »', short: '100 % conf.', w: 0.10, dir: -1, thr: 40, warn: 60, wlab: 'fiches « 100 % conformes » suspectes',
        rule: 'sous-note = 100 jusqu’à 40 % ; au-delà 100 − (% − 40) ÷ 60 × 100', sub: v => 100 - Math.max(v - 40, 0) / 60 * 100,
        cause: 'agent (remplissage sans observation) ou site réellement conforme', how: 'Observer réellement chaque point ; supervision conjointe' },
      { k: 'date', col: 'p_datebad', label: 'Dates hors période', short: 'Dates', w: 0.08, dir: -1, thr: 0, warn: 5, wlab: 'dates hors période',
        rule: 'sous-note = 100 − 5 × % de dates hors période', sub: v => agxClip(100 - v * 5, 0, 100),
        cause: 'tablette (date et heure mal réglées) ou agent', how: 'Régler la date et l’heure de la tablette' }
    ];
    const AGX_GLOBAL = { q: 0.8, p: 0.2 }, AGX_PROD = { rank: 0.6, vpd: 0.4, cap: 3 };
    const ORG_COMP = [['p_valid', 0.25, 'Fiches exploitables'], ['p_gps', 0.25, 'GPS à 5 km au plus du site'], ['p_listname', 0.10, 'Nom choisi dans la liste'], ['agent_q', 0.40, 'Qualité moyenne des agents rattachés']];
    const IMP_PEN = 0.15;   // note MEO = score moyen − 0,15 × % de visites avec alerte (pénalité de 15 points au plus)
    // Responsabilité des alertes (classement PROPOSÉ, à valider avec le programme ; n'entre pas dans la note)
    const ALERT_RESP = {
      MOWHBadCommod: 'imp', MOWHBadCommodoui: 'imp', MOWHBadCommodouinon: 'imp', MOWhBadCom: 'imp', MOWhDisposeEvidSpill: 'imp', MOExpItem: 'imp', MOBenefOther: 'imp', HHAsstPayEnt: 'imp', MOHighRiskFoods: 'imp',
      MOAsstIKRed: 'sh', MOAsstIKRedNut: 'sh', HHFraudConcerns: 'sh', MOFraudConcerns: 'sh', HHDistDiv: 'sh', MODistDiv: 'sh',
      MOAsstArmed: 'ctx', HHAsstSafeLevel: 'ctx', HHAsstSecurity: 'ctx', security_incident: 'ctx', MMFGDAccDif: 'ctx', RRT_SiteConflict: 'ctx', RRT_VSLAConflict: 'ctx'
    };
    const ALERT_RESP_TXT = { imp: 'relève du partenaire', sh: 'partagée ou à vérifier (ex. rations réduites : souvent l’approvisionnement)', ctx: 'contexte, hors de son contrôle' };
    const agxResp = c => ALERT_RESP[c] || 'sh';
    const agxQuant = (a, q) => { const b = a.filter(isNum).sort((x, y) => x - y); if (!b.length) return NaN; const p = (b.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return b[lo] + (b[hi] - b[lo]) * (p - lo); };
    const agxLevel = (c, v) => !isNum(v) ? 'na' : (c.dir > 0 ? v >= c.thr : v <= c.thr) ? 'good' : (c.dir > 0 ? v >= c.warn : v <= c.warn) ? 'mid' : 'bad';
    // Durées ouverture → finalisation en 5 classes (minutes)
    function agxDur(g) {
      const o = { meas: 0, neg: 0, short: 0, ok: 0, long: 0, open: 0, le24: 0, na: 0, naByAct: {}, max: NaN };
      const all = [], oks = [];
      g.forEach(s => {
        const d = s.dur;
        if (!isNum(d)) { o.na++; o.naByAct[s.act] = (o.naByAct[s.act] || 0) + 1; return; }
        o.meas++; all.push(d);
        if (d < 0) o.neg++; else if (d < 3) o.short++; else if (d <= 600) { o.ok++; oks.push(d); } else if (d <= 1440) o.long++; else o.open++;
        if (d >= 0 && d <= 1440) o.le24++;
        if (!(d <= o.max)) o.max = d;
      });
      o.med = medianN(all); o.medOk = medianN(oks); o.p25 = agxQuant(all, 0.25); o.p75 = agxQuant(all, 0.75);
      return o;
    }
    // GPS : absent/invalide · vérifiable (distance au site calculable) · non vérifiable (site sans coordonnées)
    function agxGps(g) {
      const o = { missing: 0, unverif: 0, meas: 0, near: 0, far: 0 }; const dd = [];
      g.forEach(s => {
        if (!s.gps_ok) o.missing++; else if (!isNum(s.dist)) o.unverif++; else { o.meas++; if (s.dist <= 5) o.near++; else o.far++; }
        if (isNum(s.dist)) dd.push(s.dist);
      });
      o.base = o.missing + o.meas; o.p = o.base ? o.near / o.base * 100 : NaN; o.med = dd.length ? medianN(dd) : NaN; o.medN = dd.length;
      return o;
    }
    // Doublon « mêmes réponses probables » : même agent, site, jour, même nombre de réponses et même score qu'une fiche précédente
    function agxDupSame(subs) {
      const seen = new Set(), out = new Set();
      subs.forEach(s => { const k = [s.enu, s.site_k, s.day || '', s.n_items, isNum(s.score) ? s.score.toFixed(3) : 'x'].join('\u0001'); if (s.dup && seen.has(k)) out.add(s); seen.add(k); });
      return out;
    }
    const agxBaseOf = (a, k) => ({ valid: a.n, gps: a.gps_base, listname: a.list_base, nsp: a.nsp_fiches, dup: a.n, dur: a.dur_n, perf: a.full_n, date: a.n })[k];
    const agxNumOf = (a, k) => ({ valid: a.valid_n, gps: a.gps_near, listname: a.list_ok, nsp: a.nsp_n, dup: a.dup_n, dur: a.dur_ok_n, perf: a.perfect_n, date: a.datebad_n })[k];
    function agxNaWhy(a, k, minN, SHORT) {
      const b = agxBaseOf(a, k), few = b ? ' (' + b + ' fiche' + (b > 1 ? 's' : '') + ', minimum ' + minN + ')' : '';
      if (k === 'gps') return (a.gps_unverif ? a.gps_unverif + ' fiche(s) sur un site sans coordonnées dans le plan : distance non vérifiable' : 'aucune fiche vérifiable') + few;
      if (k === 'listname') return (a.list_nolist ? a.list_nolist + ' fiche(s) d’un formulaire sans liste d’agents (Résilience) : non imputable à l’agent' : 'aucune fiche avec liste') + few;
      if (k === 'nsp') return 'aucune question avec l’option « Ne sait pas » renseignée sur ' + (a.valid_n - a.nsp_fiches) + ' fiche(s) exploitable(s)' + few;
      if (k === 'dur') return (a.dur_na ? a.dur_na + ' fiche(s) sans heure d’ouverture et de fin (' + a.dur_na_acts + ')' : 'aucune durée') + few;
      if (k === 'perf') return 'trop peu de fiches exploitables d’au moins 15 normes' + few;
      return 'trop peu de fiches' + few;
    }
    function agxAgent(enu, g, ctx, DS) {
      const SHORT = ctx.short || {}, NOL = ctx.nolist || {};
      const n = g.length, gv = g.filter(s => s.valid);
      const days = g.map(s => s.day).filter(Boolean).sort(cmp);
      const byAct = {}; g.forEach(s => { byAct[s.act] = (byAct[s.act] || 0) + 1; });
      const a = { enu, unknown: enu === '(Non renseigné)', org: modeOf(g.map(s => s.orgF)), acts: Object.keys(byAct).sort(cmp).map(x => SHORT[x] || x).join(', '),
        fo: Array.from(new Set(g.map(s => s.fo).filter(x => x !== null && x !== undefined))).sort(cmp).join(', '),
        n, visits: new Set(g.map(s => s.vkey)).size, sites: new Set(g.map(s => s.site_k)).size, days: new Set(days).size, first: days[0] || null, last: days[days.length - 1] || null };
      a.act_split = Object.keys(byAct).sort(cmp).map(x => (SHORT[x] || x) + ' ' + byAct[x]).join(' · ');
      a.orgs_seen = new Set(g.map(s => s.orgF)).size;
      a.valid_n = gv.length; a.empty_n = g.filter(s => s.empty).length;
      a.date_unread = g.filter(s => s.date_bad && !s.day).length; a.date_out = g.filter(s => s.date_bad && s.day).length; a.datebad_n = a.date_unread + a.date_out;
      a.test_n = g.filter(s => !s.valid && !s.empty && !s.date_bad).length;
      a.p_valid = n ? gv.length / n * 100 : NaN;
      const G = agxGps(g);
      Object.assign(a, { gps_near: G.near, gps_far: G.far, gps_meas: G.meas, gps_unverif: G.unverif, gps_missing: G.missing, gps_base: G.base, p_gps: G.p, med_dist: G.med, med_dist_n: G.medN });
      a.list_nolist = g.filter(s => NOL[s.act]).length; a.list_base = n - a.list_nolist; a.list_ok = g.filter(s => !NOL[s.act] && !s.enu_other).length;
      a.p_listname = a.list_base ? a.list_ok / a.list_base * 100 : NaN;
      const nm = gv.filter(s => isNum(s.nsp)); a.nsp_fiches = nm.length; a.nsp = nm.length ? meanN(nm.map(s => s.nsp)) * 100 : NaN;
      const rawN = nm.length > 0 && nm.every(s => isNum(s.nsp_tot) && s.nsp_tot > 0);
      a.nsp_n = rawN ? nm.reduce((t, s) => t + (isNum(s.nsp_n) ? s.nsp_n : 0), 0) : null; a.nsp_tot = rawN ? nm.reduce((t, s) => t + s.nsp_tot, 0) : null;
      a.dup_n = g.filter(s => s.dup).length; a.dup_same = g.filter(s => DS.has(s)).length; a.p_dup = n ? a.dup_n / n * 100 : NaN;
      const U = agxDur(g);
      Object.assign(a, { dur_n: U.meas, dur_na: U.na, dur_na_acts: Object.keys(U.naByAct).sort(cmp).map(x => (SHORT[x] || x) + ' ' + U.naByAct[x]).join(', '), dur_ok_n: U.ok, dur_neg: U.neg,
        dur_short: U.short, dur_long: U.long, dur_open: U.open, dur_le24: U.le24, dur_med: U.med, dur_med_ok: U.medOk, dur_p25: U.p25, dur_p75: U.p75, dur_max: U.max });
      a.p_dur_ok = U.meas ? U.ok / U.meas * 100 : NaN;
      const full = gv.filter(s => s.n_items >= 15); a.full_n = full.length; a.perfect_n = full.filter(s => s.score >= 99.9).length;
      a.p_perfect = full.length ? a.perfect_n / full.length * 100 : NaN;
      a.p_datebad = n ? a.datebad_n / n * 100 : NaN;
      a.vpd = a.visits / Math.max(a.days, 1);
      return a;
    }
    function agxScore(a, rankPct, nRanked, ctx) {
      const minN = ctx.minN || AGX_MIN, lowN = ctx.lowN || AGX_LOW;
      a.n_ranked = nRanked; a.rank_pct = a.unknown || !nRanked ? NaN : rankPct(a.visits) * 100;
      a.prod = isNum(a.rank_pct) ? (a.rank_pct / 100 * AGX_PROD.rank + Math.min(a.vpd, AGX_PROD.cap) / AGX_PROD.cap * AGX_PROD.vpd) * 100 : NaN;
      let s = 0, w = 0; const C = [];
      AG_CRIT.forEach(c => { const v = a[c.col], b = agxBaseOf(a, c.k), ok = isNum(v) && b >= minN, sub = ok ? c.sub(v) : NaN; a['s_' + c.k] = sub; if (ok) { s += sub * c.w; w += c.w; } C.push({ c, v, b, ok, sub }); });
      a.w_used = w; a.w_used_pct = w * 100; a.n_crit = C.filter(x => x.ok).length; a.quality = w ? s / w : NaN;
      C.forEach(x => { a['w_' + x.c.k] = x.ok ? x.c.w / w : NaN; a['pt_' + x.c.k] = x.ok ? x.sub * x.c.w / w : NaN; a['lost_' + x.c.k] = x.ok ? (100 - x.sub) * x.c.w / w : NaN; });
      a.global = isNum(a.quality) && isNum(a.prod) ? a.quality * AGX_GLOBAL.q + a.prod * AGX_GLOBAL.p : NaN;
      a.grade = a.unknown ? 'N/N' : gradeOf('agent', isNum(a.global) ? a.global : -1, a.n);
      const wk = [], wd = [];
      C.forEach(x => {
        if (!x.ok) return; const lv = agxLevel(x.c, x.v); if (lv === 'good') return;
        wk.push(x.c.wlab);
        wd.push({ k: x.c.k, label: x.c.label, v: r(x.v, 1), num: agxNumOf(a, x.c.k), den: x.b, thr: x.c.thr, dir: x.c.dir, level: lv, low: x.b < lowN, lost: r(a['lost_' + x.c.k], 1) });
      });
      a.weak = wk.length ? wk.join('; ') : '—'; a.weak_detail = wd;
      a.na_crit = C.filter(x => !x.ok).map(x => x.c.k).join(',');
      a.na_detail = C.filter(x => !x.ok).map(x => ({ k: x.c.k, label: x.c.label, why: agxNaWhy(a, x.c.k, minN, ctx.short || {}) }));
    }
    // ctx : { short: {act: libellé court}, nolist: {act: formulaire sans liste d'agents}, minN, lowN }
    function scoreAgents(subs, ctx0) {
      const ctx = ctx0 || {}, minN = ctx.minN || AGX_MIN, SHORT = ctx.short || {};
      const DS = agxDupSame(subs);
      const SA = subs.filter(s => !s.sys_empty);
      const byE = new Map(); SA.forEach(s => { if (!byE.has(s.enu)) byE.set(s.enu, []); byE.get(s.enu).push(s); });
      const AG = Array.from(byE.entries()).sort((x, y) => cmp(x[0], y[0])).map(([enu, g]) => agxAgent(enu, g, ctx, DS));
      // productivité : rang (pandas rank pct, ex æquo moyens) parmi les agents identifiés DE CET ENSEMBLE de fiches
      const sortedV = AG.filter(a => !a.unknown).map(a => a.visits).sort((x, y) => x - y);
      const rankPct = v => { const lo = sortedV.indexOf(v), hi = sortedV.lastIndexOf(v); return ((lo + 1 + hi + 1) / 2) / sortedV.length; };
      AG.forEach(a => agxScore(a, rankPct, sortedV.length, ctx));
      const medVisits = medianN(sortedV);
      AG.sort((x, y) => ((isNum(y.global) ? y.global : -1) - (isNum(x.global) ? x.global : -1)) || cmp(x.enu, y.enu));
      // organisations de suivi (TPM)
      const ORG = []; const byO = new Map();
      SA.forEach(s => { if (s.orgF === '(Non renseigné)') return; if (!byO.has(s.orgF)) byO.set(s.orgF, []); byO.get(s.orgF).push(s); });
      byO.forEach((g, org) => {
        const att = AG.filter(x => x.org === org), q = att.filter(x => isNum(x.quality)), gv = g.filter(s => s.valid);
        const wn = q.reduce((t, x) => t + x.n, 0), G = agxGps(g), U = agxDur(g);
        const NOL = ctx.nolist || {};
        const o = { org, n: g.length, visits: new Set(g.map(s => s.vkey)).size, agents: new Set(g.map(s => s.enu)).size, sites: new Set(g.map(s => s.site_k)).size,
          acts: Array.from(new Set(g.map(s => s.act))).sort(cmp).map(x => SHORT[x] || x).join(', '),
          valid_n: gv.length, p_valid: gv.length / g.length * 100, gps_near: G.near, gps_far: G.far, gps_meas: G.meas, gps_unverif: G.unverif, gps_missing: G.missing, gps_base: G.base, p_gps: G.p,
          list_nolist: g.filter(s => NOL[s.act]).length, list_ok: g.filter(s => !NOL[s.act] && !s.enu_other).length };
        o.list_base = o.n - o.list_nolist; o.p_listname = o.list_base ? o.list_ok / o.list_base * 100 : NaN;
        o.dup_n = g.filter(s => s.dup).length; o.dup_same = g.filter(s => DS.has(s)).length; o.p_dup = o.dup_n / o.n * 100;
        o.agent_q = wn ? q.reduce((t, x) => t + x.quality * x.n, 0) / wn : NaN; o.agent_q_n = q.length; o.agent_q_fiches = wn;
        o.agents_ab = att.filter(x => x.grade === 'A' || x.grade === 'B').length; o.agents_cd = att.filter(x => x.grade === 'C' || x.grade === 'D').length;
        o.agents_nn = att.filter(x => x.grade === 'N/N').length; o.agents_att = att.length;
        Object.assign(o, { dur_n: U.meas, dur_ok_n: U.ok, dur_open: U.open, dur_le24: U.le24, dur_neg: U.neg, dur_short: U.short, dur_long: U.long, dur_med: U.med, dur_med_ok: U.medOk });
        o.p_dur_le24 = U.meas ? U.le24 / U.meas * 100 : NaN;
        const base = { p_valid: o.n, p_gps: o.gps_base, p_listname: o.list_base, agent_q: q.length ? minN : 0 };
        let s = 0, w = 0; const na = [];
        ORG_COMP.forEach(([k, wt]) => { if (isNum(o[k]) && base[k] >= minN) { s += o[k] * wt; w += wt; } else na.push(k); });
        o.global = w ? s / w : NaN; o.w_used = w; o.w_used_pct = w * 100; o.na_comp = na.join(',');
        ORG_COMP.forEach(([k, wt]) => { o['w_' + k] = na.includes(k) ? NaN : wt / w; o['pt_' + k] = na.includes(k) ? NaN : o[k] * wt / w; });
        o.grade = gradeOf('org', isNum(o.global) ? o.global : -1, o.n);
        // poids effectifs de chaque critère dans la note (le critère compte directement ET à travers la qualité des agents)
        const wq = na.includes('agent_q') ? 0 : 0.40 / w, direct = { valid: 'p_valid', gps: 'p_gps', listname: 'p_listname' };
        o.w_eff = {}; AG_CRIT.forEach(c => { let e = direct[c.k] && !na.includes(direct[c.k]) ? ORG_COMP.find(x => x[0] === direct[c.k])[1] / w : 0; if (wq) q.forEach(x => { if (isNum(x['w_' + c.k])) e += wq * (x.n / wn) * x['w_' + c.k]; }); o.w_eff[c.k] = r(e * 100, 1); });
        ORG.push(o);
      });
      ORG.sort((x, y) => (isNum(y.global) ? y.global : -1) - (isNum(x.global) ? x.global : -1));
      return { AG, ORG, info: { subs: subs.length, sa: SA.length, ranked: sortedV.length, medVisits, minN } };
    }
    // Partenaires de mise en œuvre. VV : visites { act, imp, valid, score, risks: [codes], doms: [], code, org, date }
    function scoreImps(VV, ctx0) {
      const ctx = ctx0 || {}, rlabel = ctx.rlabel || ((a, k) => k), DOM = ctx.domains || {};
      const g0 = new Map();
      VV.filter(v => v.valid && v.imp !== '' && v.imp !== undefined && v.imp !== null).forEach(v => { const k = v.act + '\u0001' + v.imp; if (!g0.has(k)) g0.set(k, []); g0.get(k).push(v); });
      const IL = [];
      g0.forEach((g, k) => {
        const [a, imp] = k.split('\u0001'); const cnt = new Map(); g.forEach(v => v.risks.forEach(x => cnt.set(x, (cnt.get(x) || 0) + 1)));
        const ranked = Array.from(cnt.entries()).map((e, i) => [e[0], e[1], i]).sort((x, y) => (y[1] - x[1]) || (x[2] - y[2]));
        const tr = ranked.slice(0, 3).map(([c, n]) => `${rlabel(a, c)} (${bround(n / g.length * 100)} %)`).join('; ') || '—';
        const nd = (DOM[a] || []).length;
        const o = { act: a, imp, visits: g.length, sites: new Set(g.map(v => v.code.startsWith('999:') ? '999' : v.code).filter(c => c !== 'NA')).size, score: meanN(g.map(v => v.score)),
          p_risk: g.filter(v => v.risks.length > 0).length / g.length * 100, top_risks: tr,
          doms: Array.from({ length: nd }, (_, j) => r(meanN(g.map(v => v.doms[j] === null || v.doms[j] === undefined ? NaN : v.doms[j])), 1)) };
        o.global = o.score - o.p_risk * IMP_PEN; o.grade = gradeOf('imp', o.global, o.visits);
        // comptes bruts et décomposition (n'entrent pas dans la note)
        const sc = g.map(v => v.score).filter(isNum);
        o.risk_n = g.filter(v => v.risks.length > 0).length; o.score_n = sc.length; o.score_med = medianN(sc); o.score_min = sc.length ? Math.min.apply(null, sc) : NaN;
        o.penalty = o.p_risk * IMP_PEN;
        o.dom_n = Array.from({ length: nd }, (_, j) => g.filter(v => isNum(v.doms[j])).length);
        o.alerts = ranked.map(([c, n]) => ({ code: c, label: rlabel(a, c), n, resp: agxResp(c) }));
        ['imp', 'sh', 'ctx'].forEach(t => { o['risk_' + t + '_n'] = g.filter(v => v.risks.some(c => agxResp(c) === t)).length; });
        o.global_imp = o.score - o.risk_imp_n / g.length * 100 * IMP_PEN;
        const ob = new Map(); g.forEach(v => { const kk = v.org || '(Non renseigné)'; if (!ob.has(kk)) ob.set(kk, []); ob.get(kk).push(v); });
        o.obs = Array.from(ob.entries()).map(([org, l]) => ({ org, visits: l.length, risk_n: l.filter(v => v.risks.length > 0).length, score: r(meanN(l.map(v => v.score)), 1) })).sort((x, y) => y.visits - x.visits);
        const self = /^(autres|\(non)/i.test(String(imp)) ? null : orgStd(imp); o.self_n = self ? g.filter(v => v.org && !/^(autres|\(non)/i.test(v.org) && orgStd(v.org) === self).length : 0;
        const dts = g.map(v => v.date).filter(Boolean).sort(cmp); o.first = dts[0] || null; o.last = dts[dts.length - 1] || null;
        IL.push(o);
      });
      IL.sort((x, y) => cmp(x.act, y.act) || (y.global - x.global));
      return IL;
    }
    // Contrôles de qualité par activité. subs : TOUTES les fiches (anciennes versions comprises) ; VV : visites { act, valid }
    function dqStats(subs, VV, ctx0) {
      const ctx = ctx0 || {}, NOL = ctx.nolist || {}, DS = agxDupSame(subs);
      return (ctx.acts || []).map(a => {
        const s = subs.filter(x => x.act === a), v = VV.filter(x => x.act === a), U = agxDur(s), G = agxGps(s);
        const c = f => s.filter(f).length;
        return { act: a, subs: s.length, visits: v.length, validVisits: v.filter(x => x.valid).length, empty: c(x => x.empty), sysEmpty: c(x => x.sys_empty), dateBad: c(x => x.date_bad),
          gpsMissing: c(x => !x.gps_ok), gpsFar: c(x => x.dist > 5), nameOther: c(x => x.enu_other), noEnu: c(x => x.enu === '(Non renseigné)'), dup: c(x => x.dup),
          durOpen: U.open, durShort: U.short, offList: c(x => String(x.site) === '999'),
          valid: c(x => x.valid), nonSys: c(x => !x.sys_empty), durMeasured: U.meas, durNeg: U.neg, durOk: U.ok, durLong: U.long, durLe24: U.le24,
          durMed: r(U.med, 1), durMedOk: r(U.medOk, 1), durMax: r(U.max, 1), gpsMeas: G.meas, gpsNear: G.near, gpsFarMeas: G.far, gpsUnverif: G.unverif, gpsOk: c(x => !!x.gps_ok),
          nameNoList: !!NOL[a], noEnuSys: c(x => x.enu === '(Non renseigné)' && x.sys_empty), dupSame: c(x => DS.has(x)), dateUnread: c(x => x.date_bad && !x.day), dateOut: c(x => x.date_bad && !!x.day) };
      });
    }
    // Relecture UNIQUE des fiches stockées (P.subs) : même désérialisation pour l'import, le recalcul et les écrans
    function readStoredSubs(P) {
      const SC = P.subs.cols, si = k => SC.indexOf(k), iN = si('nsp_n'), iT = si('nsp_tot');
      const nv = x => x === null || x === undefined ? NaN : x;
      return P.subs.rows.map(rw => ({ act: rw[si('act')], enu_raw: rw[si('enu_raw')], enu_other: rw[si('enu_other')] === 1, org: rw[si('org')], fo: rw[si('fo')], valid: rw[si('valid')] === 1, empty: rw[si('empty')] === 1,
        sys_empty: rw[si('sys_empty')] === 1, date_bad: rw[si('date_bad')] === 1, day: rw[si('day')], site: rw[si('site')], site_k: rw[si('site_k')], vkey: rw[si('vkey')], gps_ok: rw[si('gps_ok')] === 1,
        dist: nv(rw[si('dist')]), nsp: nv(rw[si('nsp')]), dur: nv(rw[si('dur')]), dup: rw[si('dup')] === 1, n_items: rw[si('n_items')], score: nv(rw[si('score')]),
        nsp_n: iN >= 0 ? nv(rw[iN]) : NaN, nsp_tot: iT >= 0 ? nv(rw[iT]) : NaN }));
    }
    // Pour les écrans : fiches relues + noms d'agents harmonisés (même regroupement que le recalcul)
    function readSubsForUI(P) {
      const ALL = readStoredSubs(P);
      const canonOf = clusterNames(ALL.map(s => s.enu_raw).filter(x => x !== null));
      ALL.forEach(s => { s.enu = canonOf(s.enu_raw) || '(Non renseigné)'; s.orgF = s.org === null || s.org === undefined ? '(Non renseigné)' : s.org; });
      return ALL;
    }
    // colonnes nouvelles des fiches stockées (ajoutées à la fin ; anciennes lignes complétées par null)
    const AGX_SUBCOLS = ['nsp_n', 'nsp_tot'];
    function agxEnsureSubCols(P) {
      AGX_SUBCOLS.forEach(k => { if (!P.subs.cols.includes(k)) P.subs.cols.push(k); });
      const L = P.subs.cols.length; P.subs.rows.forEach(rw => { while (rw.length < L) rw.push(null); });
    }
    // colonnes ajoutées À LA FIN des tables du fichier (jamais de réordonnancement)
    const AGX_AGCOLS = ['valid_n', 'empty_n', 'date_unread', 'date_out', 'datebad_n', 'test_n', 'gps_near', 'gps_far', 'gps_meas', 'gps_unverif', 'gps_missing', 'gps_base', 'med_dist_n',
      'list_ok', 'list_base', 'list_nolist', 'nsp_fiches', 'nsp_n', 'nsp_tot', 'dup_n', 'dup_same', 'dur_n', 'dur_na', 'dur_na_acts', 'dur_ok_n', 'dur_neg', 'dur_short', 'dur_long', 'dur_open', 'dur_le24',
      'dur_med', 'dur_med_ok', 'dur_p25', 'dur_p75', 'full_n', 'perfect_n', 'vpd', 'rank_pct', 'n_ranked', 's_valid', 's_gps', 's_listname', 's_nsp', 's_dup', 's_dur', 's_perf', 's_date',
      'pt_valid', 'pt_gps', 'pt_listname', 'pt_nsp', 'pt_dup', 'pt_dur', 'pt_perf', 'pt_date', 'w_used_pct', 'n_crit', 'na_crit', 'act_split', 'weak_detail'];
    const AGX_ORGCOLS = ['valid_n', 'gps_near', 'gps_meas', 'gps_unverif', 'gps_missing', 'gps_base', 'list_ok', 'list_base', 'list_nolist', 'dup_n', 'dup_same', 'agent_q_n', 'agents_nn', 'agents_att',
      'dur_n', 'dur_ok_n', 'dur_open', 'dur_le24', 'dur_neg', 'dur_med', 'dur_med_ok', 'p_dur_le24', 'w_used_pct', 'na_comp', 'w_eff'];
    const AGX_IMPCOLS = ['risk_n', 'score_med', 'score_min', 'penalty', 'dom_n', 'risk_imp_n', 'risk_sh_n', 'risk_ctx_n', 'global_imp', 'self_n', 'first', 'last', 'obs', 'alerts'];
    const agxCols = (T, extra) => { extra.forEach(k => { if (!T.cols.includes(k)) T.cols.push(k); }); return T.cols; };
    const agxNolist = P => { const o = {}; Object.keys(P.spec.acts).forEach(a => { o[a] = !(P.spec.acts[a].cfg && P.spec.acts[a].cfg.enu); }); return o; };
    // ================================================================ /LOT AGENTS

