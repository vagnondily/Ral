  // ================================================================== LOT AGENTS : onglets Agents, Partenaires, Qualité des données
  // Les trois onglets lisent les mêmes fiches filtrées et la même notation que les tables du fichier (ENGINE.scoreAgents,
  // scoreImps, dqStats). L'écran montre une valeur par cellule ; le détail est dans l'infobulle ou le tiroir.
  const AGX_CRIT = ENGINE.AG_CRIT;
  const agXNum = x => typeof x === 'number' && !isNaN(x);
  let agXMemo = null, agXScoreMemo = null;
  // ---- fiches relues une fois par affichage du fichier (même désérialisation que le moteur), rattachées à leur visite
  function agXData() {
    if (agXMemo) return agXMemo;
    const subs = ENGINE.readSubs(D);
    const kIdx = new Map(); (D.visitKeys || []).forEach((k, i) => kIdx.set(k, i));
    subs.forEach(s => {
      const vi = kIdx.get(s.vkey), v = vi === undefined ? null : V[vi];
      s.vregion = v ? v.region : -1; s.vdistrict = v ? v.district : -1; s.vimp = v ? v.imp : -1;
      s.orgName = s.orgF === 'Autres' ? 'Autres (non précisé*)' : s.orgF;
      s.foName = s.fo !== null && s.fo !== undefined ? s.fo : (v ? DICT.fo[v.fo] : null);
      s.month = s.day ? String(s.day).slice(0, 7) : null;
    });
    const ctx = { short: {}, nolist: {}, minN: SMALL_N.min, lowN: SMALL_N.low, acts: ACTS };
    ACTS.forEach(a => { ctx.short[a] = ACT[a].short; const S = D.spec && D.spec.acts && D.spec.acts[a]; ctx.nolist[a] = !!S && !(S.cfg && S.cfg.enu); });
    agXMemo = { subs, ctx };
    return agXMemo;
  }
  function agXFullPeriod() { return !MONTHS.length || (F.m0 === MONTHS[0] && F.m1 === MONTHS[MONTHS.length - 1]); }
  // Filtres globaux appliqués aux FICHES : activité, bureau, région, district, TPM, MEO et période (jour de la fiche)
  function agXPass(s, full) {
    const foN = F.fo >= 0 ? DICT.fo[F.fo] : null, orgN = F.org >= 0 ? DICT.org[F.org] : null;
    return (F.act === 'ALL' || s.act === F.act) && (foN === null || s.foName === foN) && (F.region < 0 || s.vregion === F.region) && (F.district < 0 || s.vdistrict === F.district) &&
      (orgN === null || s.orgName === orgN) && (F.imp < 0 || s.vimp === F.imp) && (full || (!!s.month && s.month >= F.m0 && s.month <= F.m1));
  }
  function agXSubs() { const full = agXFullPeriod(); return agXData().subs.filter(s => agXPass(s, full)); }
  function agXKey() { return [F.act, F.fo, F.region, F.district, F.org, F.imp, F.m0, F.m1].join('|'); }
  function agXScored() {
    const k = agXKey(); if (agXScoreMemo && agXScoreMemo.k === k) return agXScoreMemo;
    const subs = agXSubs(), R = ENGINE.scoreAgents(subs, agXData().ctx);
    const full = agXFullPeriod(); const undated = full ? 0 : agXData().subs.filter(s => !s.month && agXPass(s, true)).length;
    agXScoreMemo = { k, subs, R, undated };
    return agXScoreMemo;
  }
  const agXCode = i => { const k = (D.visitKeys || [])[i] || ''; return k.slice(k.indexOf('|') + 1, k.lastIndexOf('|')); };
  const agXRlabel = (a, k) => D.riskLabelAct[a + '|' + k] || (RISK.find(x => x.code === k) || {}).label || k;
  function agXVisits() { return fv().map(v => ({ act: v.act, imp: DICT.imp[v.imp], valid: v.valid, score: v.score, risks: v.risks.map(j => RISK[j].code), doms: v.doms, code: agXCode(v.i), date: v.date, org: DICT.org[v.org] })); }
  // ---- formats
  const agXDur = m => !agXNum(m) ? '–' : m < 0 ? '−' + fmt(-m, 0) + ' min' : m < 60 ? fmt(m, m < 10 ? 1 : 0) + ' min' : fmt(m / 60, 1) + ' h';
  const agXNN = (n, N) => N ? fmt(n) + '/' + fmt(N) + ' (' + pct(n / N * 100, 1) + ')' : 'aucune fiche';
  const agXThr = c => (c.dir > 0 ? '≥ ' : '≤ ') + fmt(c.thr) + ' %';
  const agXThrShort = c => (c.dir > 0 ? 'min. ' : 'max. ') + fmt(c.thr) + ' %';
  const AGX_LV = { good: ['✓', 'seuil atteint'], mid: ['!', 'sous le seuil'], bad: ['✗', 'loin du seuil'], low: ['~', 'effectif faible, valeur indicative'], na: ['', 'non calculé'] };
  const agXUnit = k => k === 'gps' ? 'fiches vérifiables' : k === 'listname' ? 'fiches de formulaires avec liste' : k === 'nsp' ? 'fiches mesurables' : k === 'dur' ? 'fiches mesurées' : k === 'perf' ? 'fiches d’au moins 15 normes' : 'fiches';
  const agXName = a => a.enu === 'Autres' ? 'Autres (non précisé*)' : a.enu.replace(/\.+$/, '');
  const agXOrgN = o => o === 'Autres' ? 'Autres (non précisé*)' : o;
  const agXSortVal = v => agXNum(v) ? v : null;
  function agXGradeScale(kind) { const s = GRADE_SCALES[kind]; return 'A ≥ ' + s.A + ', B ≥ ' + s.B + ', C ≥ ' + s.C + ', D en dessous, non noté sous ' + s.minN + ' ' + s.unit; }
  // Carte avec un titre court et toute l'explication dans l'infobulle « i »
  function agXCard(title, info, body, cls) {
    const c = card(title, null, body, cls);
    const ch = c.querySelector('.ch'); if (ch) { const old = ch.querySelector('.info'); if (old) old.remove(); if (info) ch.appendChild(infoBtn(info)); }
    return c;
  }
  // Une valeur lisible + sa base en clair ; niveau = couleur + symbole ; détail en infobulle
  function agXV(level, main, base, tip) {
    const sym = AGX_LV[level] ? AGX_LV[level][0] : '';
    const n = el('span', { class: 'agx-v agx-' + level }, [el('b', { text: (sym ? sym + ' ' : '') + main }), base ? el('small', { text: base }) : null]);
    if (tip) bindTip(n, tip);
    return n;
  }
  function agXPlain(main, tip) { const n = el('span', { class: 'agx-p', text: main }); if (tip) bindTip(n, tip); return n; }
  function agXBase(a, k) { return ({ valid: a.n, gps: a.gps_base, listname: a.list_base, nsp: a.nsp_fiches, dup: a.n, dur: a.dur_n, perf: a.full_n, date: a.n })[k]; }
  function agXNum0(a, k) { return ({ valid: a.valid_n, gps: a.gps_near, listname: a.list_ok, dup: a.dup_n, dur: a.dur_ok_n, perf: a.perfect_n, date: a.datebad_n })[k]; }
  // ---- un critère d'un agent : valeur réelle, base, niveau (seuil propre au critère), détail
  function agXCrit(a, c) {
    const v = a[c.col], b = agXBase(a, c.k), st = nStatus(b), ok = agXNum(v) && st !== 'na';
    const det = [];
    if (c.k === 'valid') { if (a.empty_n) det.push(a.empty_n + ' vide(s)'); if (a.datebad_n) det.push(a.datebad_n + ' date(s) hors période'); if (a.test_n) det.push(a.test_n + ' fiche(s) test'); }
    else if (c.k === 'gps') { if (a.gps_unverif) det.push(a.gps_unverif + ' non vérifiable(s), site sans coordonnées'); if (a.gps_missing) det.push(a.gps_missing + ' sans GPS'); if (agXNum(a.med_dist)) det.push('distance médiane ' + fmt(a.med_dist, 1) + ' km'); }
    else if (c.k === 'listname') { if (a.list_nolist) det.push(a.list_nolist + ' fiche(s) d’un formulaire sans liste, non imputées'); }
    else if (c.k === 'nsp') { if (a.nsp_tot) det.push(fmt(a.nsp_n) + ' « Ne sait pas » sur ' + fmt(a.nsp_tot) + ' réponses'); const nm = a.valid_n - a.nsp_fiches; if (nm) det.push(nm + ' fiche(s) sans question NSP'); }
    else if (c.k === 'dup') { if (a.dup_same) det.push('dont ' + a.dup_same + ' aux mêmes réponses probables'); }
    else if (c.k === 'dur') { if (a.dur_n) det.push('médiane ' + agXDur(a.dur_med)); if (a.dur_open) det.push(a.dur_open + ' finalisée(s) après plus de 24 h'); if (a.dur_neg) det.push(a.dur_neg + ' négative(s), horloge'); if (a.dur_na) det.push(a.dur_na + ' sans heure d’ouverture (' + a.dur_na_acts + ')'); }
    else if (c.k === 'date') { if (a.date_unread) det.push(a.date_unread + ' illisible(s)'); }
    const level = !ok ? 'na' : st === 'low' ? 'low' : ENGINE.agxLevel(c, v);
    const main = !ok ? (b ? 'n.c.' : 'non mesuré') : c.k === 'nsp' ? pct(v, 1) : pct(v, 0);
    const base = !ok ? '' : c.k === 'nsp' ? 'sur ' + fmt(b) : fmt(agXNum0(a, c.k)) + '/' + fmt(b);
    return { c, v, b, ok, st, level, main, base, det: det.join(', ') };
  }
  function agXCritTip(a, I) {
    const c = I.c, k = c.k, na = (a.na_detail || []).find(x => x.k === k);
    const L = [c.label + ' : ' + (I.ok ? AGX_LV[I.level][1] : 'non calculé, retiré de la note')];
    if (I.ok) L.push(k === 'nsp' ? pct(I.v, 1) + ' de « Ne sait pas » en moyenne par fiche, sur ' + fmt(I.b) + ' fiche(s) mesurable(s)' : fmt(agXNum0(a, k)) + ' ' + agXUnit(k) + ' sur ' + fmt(I.b) + ' (' + pct(I.v, 1) + ')');
    else if (na) L.push(na.why.replace(/^./, x => x.toUpperCase()) + '. Son poids est réparti sur les autres critères.');
    if (I.det) L.push('Détail : ' + I.det);
    L.push('Seuil : ' + agXThr(c) + ', le même pour la couleur et la colonne À corriger');
    L.push('Règle : ' + c.rule);
    if (I.ok) L.push('Sous-note ' + fmt(a['s_' + k], 1) + ' × poids ' + pct(a['w_' + k] * 100, 1) + ' = ' + fmt(a['pt_' + k], 1) + ' points de qualité, ' + fmt(a['lost_' + k], 1) + ' perdus');
    if (I.st === 'low' && I.ok) L.push(nNote(I.b, 'fiches'));
    L.push('Cause habituelle : ' + c.cause);
    return L.join('\n');
  }
  function agXCell(a, c) { const I = agXCrit(a, c); return agXV(I.level, I.main, I.base, () => agXCritTip(a, I)); }
  // ---- durées (5 classes)
  function agXDurBins(U) {
    return [{ label: 'Fin avant début', n: U.neg, k: 'bad' }, { label: 'Moins de 3 min', n: U.short, k: 'bad' }, { label: '3 min à 10 h', n: U.ok, k: 'good' }, { label: '10 h à 24 h', n: U.long, k: 'mid' }, { label: 'Plus de 24 h', n: U.open, k: 'na' }];
  }
  function agXDurInfo(subs) {
    const U = ENGINE.durStats(subs); const acts = ACTS.filter(a => subs.some(s => s.act === a));
    const meas = acts.filter(a => subs.some(s => s.act === a && agXNum(s.dur))), nm = acts.filter(a => !meas.includes(a));
    const nmTxt = nm.length ? nm.map(a => ACT[a].short).join(', ') + ' : durée non mesurée, l’extraction n’a pas d’heure d’ouverture et de fin.' : '';
    if (!U.meas) return { U, line: 'Aucune fiche mesurée dans cette sélection.', info: nmTxt };
    const line = fmt(U.meas) + ' fiches mesurées, médiane ' + agXDur(U.med) + ' (' + agXDur(U.medOk) + ' pour les fiches de 3 min à 10 h)';
    const info = ['La durée est l’écart entre l’ouverture et la finalisation de la fiche sur la tablette. Ce n’est pas la durée de l’entretien.',
      fmt(U.meas) + ' fiches mesurées (' + meas.map(a => ACT[a].short).join(', ') + ').',
      'Entre 3 min et 10 h : ' + fmt(U.ok) + '/' + fmt(U.meas) + ' (' + pct(U.ok / U.meas * 100) + '). Entre 10 h et 24 h : ' + fmt(U.long) + '.',
      'Finalisées plus de 24 h après ouverture : ' + fmt(U.open) + '/' + fmt(U.meas) + ' (' + pct(U.open / U.meas * 100) + '). La durée mesure alors l’attente, souvent une pratique d’équipe.',
      'Moins de 3 min : ' + fmt(U.short) + '. Fin avant début : ' + fmt(U.neg) + ' (horloge de la tablette).',
      'Critère de la note : part des fiches mesurées entre 3 min et 10 h, seuil ' + agXThr(AGX_CRIT.find(c => c.k === 'dur')) + '.', nmTxt].filter(Boolean).join('\n');
    return { U, line, info };
  }

  // ================================================================== ONGLET AGENTS
  function agXRenderAgents(main) {
    const S = agXScored(), R = S.R, AG = R.AG, GS = GRADE_SCALES.agent, minN = GS.minN;
    const graded = AG.filter(a => a.grade !== 'N/N'), cnt = g => AG.filter(a => a.grade === g).length;
    const partial = graded.filter(a => a.n_crit < AGX_CRIT.length).length;
    main.appendChild(el('div', { class: 'kpis' }, [
      kpi(fmt(graded.length), 'Agents notés', 'sur ' + fmt(AG.length) + ' vus, ' + fmt(cnt('N/N')) + ' non notés', null, 'Un agent est noté à partir de ' + minN + ' fiches dans la sélection. En dessous, il apparaît « non noté » : l’échantillon est trop faible.' + (AG.some(a => a.unknown) ? '\n« (Non renseigné) » regroupe les fiches sans nom d’agent ; ce groupe n’est jamais noté.' : '')),
      kpi(fmt(cnt('A')), 'Note A', GS.A + ' et plus', 'good', gradeTip('A', 'agent')), kpi(fmt(cnt('B')), 'Note B', GS.B + ' à ' + GS.A, null, gradeTip('B', 'agent')),
      kpi(fmt(cnt('C')), 'Note C', GS.C + ' à ' + GS.B, 'mid', gradeTip('C', 'agent')), kpi(fmt(cnt('D')), 'Note D', 'moins de ' + GS.C, 'bad', gradeTip('D', 'agent')),
      kpi(fmt(partial), 'Notes partielles', 'moins de ' + AGX_CRIT.length + ' critères', null, 'Agents notés sans tous les critères. Un critère non mesurable (durée sans heure d’ouverture, pas de question « Ne sait pas », site sans coordonnées, formulaire sans liste d’agents) ou calculé sur moins de ' + SMALL_N.min + ' fiches sort de la note ; son poids est réparti sur les autres. Le détail de chaque agent le précise.')]));
    // durée des fiches : rendue une seule fois, dans la sous-vue « Par activité » ; ici un simple renvoi (dédoublonnage)
    const xref = el('p', { class: 'hint agx-xref' }, [el('span', { text: 'Durée des fiches (ouverture, finalisation) : ' })]);
    const xb = el('button', { class: 'agx-xlink', type: 'button', text: 'voir « Par activité »' });
    xb.addEventListener('click', () => agXQaGo('activite'));
    xref.appendChild(xb);
    main.appendChild(xref);
    // tableau des agents
    const bar = el('div', { class: 'pills' });
    const q = el('input', { type: 'search', placeholder: 'Rechercher un agent…', 'aria-label': 'Rechercher un agent' });
    const so = el('select', { 'aria-label': 'Organisation de rattachement' }); so.appendChild(el('option', { value: '', text: 'Toutes organisations' }));
    Array.from(new Set(AG.map(a => a.org))).sort().forEach(o => so.appendChild(el('option', { value: o, text: agXOrgN(o) })));
    const sg = el('select', { 'aria-label': 'Note' }); [['', 'Toutes notes'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['N/N', 'Non notés']].forEach(([v, t]) => sg.appendChild(el('option', { value: v, text: t })));
    add(bar, [q, so, sg]);
    const host = el('div');
    const cols = [
      { k: 'enu', t: 'Agent', sortVal: a => agXName(a), fmt: a => agXPlain(agXName(a), () => agXName(a) + '\n' + agXOrgN(a.org) + ' · ' + a.act_split + '\nBureau(x) : ' + (a.fo || '–') + '\nFiches du ' + (a.first ? dFrUI(a.first) : '–') + ' au ' + (a.last ? dFrUI(a.last) : '–') + (a.unknown ? '\nFiches sans nom d’agent : jamais noté.' : '')) },
      { k: 'org', t: 'Organisation', title: 'Organisation majoritaire dans les fiches de l’agent', sortVal: a => agXOrgN(a.org), fmt: a => agXOrgN(a.org) },
      { k: 'n', t: 'Fiches', num: 1, sortVal: a => a.n, fmt: a => agXPlain(fmt(a.n), () => fmt(a.n) + ' fiches, ' + fmt(a.visits) + ' visites (site × jour), ' + fmt(a.sites) + ' sites, ' + fmt(a.days) + ' jours actifs') },
      { k: 'grade', t: 'Note', title: 'Barème agent : ' + agXGradeScale('agent'), sortVal: a => a.grade === 'N/N' ? 'Z' : a.grade, fmt: a => badge(a.grade, 'agent') },
      { k: 'global', t: 'Score', num: 1, title: 'Score global = ' + fmt(ENGINE.AGX_GLOBAL.q * 100) + ' % qualité + ' + fmt(ENGINE.AGX_GLOBAL.p * 100) + ' % volume', sortVal: a => agXSortVal(a.global),
        fmt: a => a.grade === 'N/N' ? el('span', { class: 'muted', text: 'non noté' }) : el('strong', { text: fmt(a.global, 1) }) },
      { k: 'quality', t: 'Qualité', num: 1, title: 'Qualité des données sur 100 : somme des sous-notes pondérées des critères calculés', sortVal: a => agXSortVal(a.quality),
        fmt: a => agXPlain(agXNum(a.quality) ? fmt(a.quality, 1) : 'n.c.', () => agXNum(a.quality) ? 'Qualité ' + fmt(a.quality, 1) + ' sur ' + a.n_crit + ' critères sur ' + AGX_CRIT.length + (a.n_crit < AGX_CRIT.length ? ' (poids ramenés à 100 %)' : '') : 'Non calculée : moins de ' + SMALL_N.min + ' fiches') },
      { k: 'prod', t: 'Volume', num: 1, title: 'Volume de visites sur 100 : 0,6 × rang du nombre de visites dans la sélection + 0,4 × visites par jour actif (plafond 3) ÷ 3', sortVal: a => agXSortVal(a.prod),
        fmt: a => agXPlain(fmt(a.prod, 0), () => agXNum(a.rank_pct) ? fmt(a.visits) + ' visites, ' + fmt(a.vpd, 1) + ' par jour actif\nRang : ' + fmt(a.rank_pct, 0) + ' % parmi les ' + fmt(a.n_ranked) + ' agents de la sélection' : 'Non classé') },
      { k: 'weak', t: 'À corriger', title: 'Critères sous leur seuil, avec la même couleur que la cellule du critère', sortVal: a => (a.weak_detail || []).length, fmt: a => agXWhy(a) }
    ].concat(AGX_CRIT.map(c => ({ k: c.col, t: c.short, title: c.label + ', seuil ' + agXThr(c) + '. ' + c.rule.replace(/^./, x => x.toUpperCase()) + '. Poids ' + pct(c.w * 100, 0) + ' de la qualité.', sortVal: a => agXNum(a['s_' + c.k]) ? a[c.col] : null, fmt: a => agXCell(a, c) })));
    const draw = () => {
      clear(host);
      const t = q.value.trim().toLowerCase();
      const rr = AG.filter(a => (!t || agXName(a).toLowerCase().includes(t)) && (!so.value || a.org === so.value) && (!sg.value || a.grade === sg.value));
      host.appendChild(table(cols, rr, { sortK: 4, onRow: a => agXAgentDrawer(a, S) }));
      host.appendChild(el('p', { class: 'hint', text: fmt(rr.length) + ' agent(s)' }));
    };
    [q, so, sg].forEach(x => x.addEventListener(x === q ? 'input' : 'change', draw));
    draw();
    const info = ['Score global : ' + fmt(ENGINE.AGX_GLOBAL.q * 100) + ' % qualité des données, ' + fmt(ENGINE.AGX_GLOBAL.p * 100) + ' % volume de visites. Barème : ' + agXGradeScale('agent') + '.',
      'Chaque critère affiche son taux et sa base (fiches concernées / fiches comptées). La couleur suit le seuil du critère, le même que la colonne À corriger.',
      '✓ seuil atteint   ! sous le seuil   ✗ loin du seuil   ~ effectif faible (' + SMALL_N.min + ' à ' + (SMALL_N.low - 1) + ' fiches), sans couleur   n.c. moins de ' + SMALL_N.min + ' fiches, retiré de la note.',
      'Le volume classe chaque agent parmi les ' + fmt(R.info.ranked) + ' agents de la sélection : il change avec les filtres.',
      fmt(R.info.sa) + ' fiches évaluées. Les fiches vides de l’ancienne version des formulaires ne sont pas imputées aux agents.' + (agXFullPeriod() ? '' : ' La période porte sur le jour de chaque fiche' + (S.undated ? ' ; ' + fmt(S.undated) + ' fiche(s) sans date lisible ne sont comptées que sans filtre de période.' : '.')),
      'Cliquez une ligne pour le détail du calcul.'].join('\n');
    const det = el('details', { class: 'agx-det' }, [el('summary', { text: 'Critères, seuils et poids' }), agXCritTable(),
      formulaBox('Qualité = Σ (sous-note × poids) ÷ Σ poids des critères calculés\nVolume = 0,6 × rang du nombre de visites + 0,4 × min(visites par jour ; 3) ÷ 3\nScore global = 0,8 × qualité + 0,2 × volume'),
      el('p', { class: 'hint', text: 'Un critère non mesurable ou calculé sur moins de ' + SMALL_N.min + ' fiches sort de la note et son poids est réparti sur les autres.' })]);
    main.appendChild(agXCard('Agents', info, [bar, host, det], 'wide'));
    // notes par organisation
    const orgs = Array.from(new Set(AG.map(a => a.org))).sort();
    const seen = new Map(R.ORG.map(o => [o.org, o.agents]));
    const gtab = table([{ k: 'o', t: 'Organisation', fmt: r => agXOrgN(r.o) }].concat(['A', 'B', 'C', 'D', 'N/N'].map(g => ({ k: g, t: g === 'N/N' ? 'Non notés' : g, num: 1, title: g === 'N/N' ? 'Moins de ' + minN + ' fiches' : 'Agents rattachés notés ' + g, fmt: r => r[g] ? el('span', { class: 'badge g' + (g === 'N/N' ? 'NN' : g), text: String(r[g]) }) : '–' })))
      .concat([{ k: 't', t: 'Rattachés', num: 1, title: 'Agents dont la majorité des fiches porte cette organisation' }, { k: 'v', t: 'Vus', num: 1, title: 'Agents présents dans les fiches de l’organisation', fmt: r => r.v === undefined ? '–' : fmt(r.v) }]),
      orgs.map(o => { const r = { o, t: 0, v: seen.get(o) }; ['A', 'B', 'C', 'D', 'N/N'].forEach(g => { r[g] = AG.filter(x => x.org === o && x.grade === g).length; r.t += r[g]; }); return r; }), { sortK: 6 });
    main.appendChild(agXCard('Notes par organisation', 'Chaque agent compte une fois, dans l’organisation majoritaire de ses fiches (Rattachés). Vus : agents présents dans les fiches de l’organisation ; un agent qui travaille pour deux organisations est vu dans les deux. D’où l’écart avec l’onglet Partenaires.', [gtab]));
  }
  function agXCritTable() {
    const t = el('table', { class: 'xt agx-ct' });
    t.appendChild(el('thead', null, el('tr', null, ['Critère', 'Seuil', 'Sous-note', 'Poids'].map((h, i) => el('th', { scope: 'col', class: i === 3 ? 'num' : '', text: h })))));
    t.appendChild(el('tbody', null, AGX_CRIT.map(c => el('tr', null, [el('td', { text: c.label }), el('td', { text: agXThr(c) }), el('td', { text: c.rule.replace(/^sous-note = /, '') }), el('td', { class: 'num', text: pct(c.w * 100, 0) })]))));
    return el('div', { class: 'tw' }, t);
  }
  function agXWhy(a) {
    const W = a.weak_detail || [];
    const notes = [];
    if (a.list_nolist) notes.push(a.list_nolist + ' fiche(s) d’un formulaire sans liste d’agents');
    if (a.gps_unverif) notes.push(a.gps_unverif + ' GPS non vérifiable(s), site sans coordonnées');
    if (!W.length && !notes.length && !a.dur_neg) return '—';
    const L = W.map(w => { const c = AGX_CRIT.find(x => x.k === w.k), lv = w.low ? 'low' : w.level; return el('li', { class: 'agx-w agx-w-' + lv, text: AGX_LV[lv][0] + ' ' + c.short + ' ' + pct(w.v, w.k === 'nsp' ? 1 : 0) + ' (' + agXThrShort(c) + ')' }); });
    const box = el('div', { class: 'why agx-why' }, L.length ? el('ul', null, L) : el('span', { class: 'muted agx-p', text: '—' }));
    bindTip(box, () => [W.map(w => { const c = AGX_CRIT.find(x => x.k === w.k); return c.label + ' : ' + (w.k === 'nsp' ? pct(w.v, 1) + ' sur ' + fmt(w.den) + ' fiches' : fmt(w.num) + '/' + fmt(w.den) + ' (' + pct(w.v, 1) + ')') + ', seuil ' + agXThr(c) + ', ' + fmt(w.lost, 1) + ' point(s) de qualité perdu(s)' + (w.low ? ', effectif faible' : ''); }).join('\n'),
      notes.length ? 'Non imputé à l’agent : ' + notes.join(', ') + '.' : '', a.dur_neg ? 'À vérifier : ' + a.dur_neg + ' durée(s) négative(s), horloge de la tablette (comptées hors plage).' : ''].filter(Boolean).join('\n'));
    return box;
  }
  // ---- fiche détaillée d'un agent
  function agXAgentDrawer(a, S) {
    const R = S.R, GS = GRADE_SCALES.agent, g = S.subs.filter(s => !s.sys_empty && s.enu === a.enu);
    const rows = AGX_CRIT.map(c => {
      const I = agXCrit(a, c), na = (a.na_detail || []).find(x => x.k === c.k);
      return { k: c.label, raw: I.ok ? (c.k === 'nsp' ? pct(I.v, 1) + ' sur ' + fmt(I.b) + ' fiches' : agXNN(agXNum0(a, c.k), I.b)) + (I.det ? ', ' + I.det : '') + (I.st === 'low' ? '. ' + nNote(I.b, 'fiches') : '') : (na ? na.why : 'non mesuré'),
        ref: 'seuil ' + agXThr(c) + ', poids de base ' + pct(c.w * 100, 0),
        sub: a['s_' + c.k], w: a['w_' + c.k], pts: a['pt_' + c.k], na: !I.ok,
        why: c.rule.replace(/^sous-note/, 'Sous-note') + '. ' + (I.ok ? (I.level === 'good' ? 'Seuil atteint.' : AGX_LV[I.level][1].replace(/^./, x => x.toUpperCase()) + ', ' + fmt(a['lost_' + c.k], 1) + ' point(s) perdu(s).' + (I.level !== 'low' ? ' Cause habituelle : ' + c.cause + '.' : '')) : 'Non calculé : poids réparti sur les autres critères.') };
    });
    const kids = [];
    kids.push(kvList([['Organisation', agXOrgN(a.org) + (a.orgs_seen > 1 ? ' (majoritaire ; ' + a.orgs_seen + ' organisations dans ses fiches)' : '')], ['Bureau(x)', a.fo || '–'],
      ['Activités', a.act_split.split(' · ').join(', ')], ['Fiches', 'du ' + (a.first ? dFrUI(a.first) : '–') + ' au ' + (a.last ? dFrUI(a.last) : '–')],
      ['Base', fmt(a.n) + ' fiches, ' + fmt(a.visits) + ' visites, ' + fmt(a.sites) + ' sites, ' + fmt(a.days) + ' jours actifs'], ['Critères évalués', a.n_crit + ' sur ' + AGX_CRIT.length + (a.n_crit < AGX_CRIT.length ? ', poids ramenés à 100 %' : '')],
      ['Note', a.grade === 'N/N' ? 'non noté (' + (a.unknown ? 'fiches sans nom d’agent' : 'moins de ' + GS.minN + ' fiches') + ')' : a.grade + ', score ' + fmt(a.global, 1)]]));
    kids.push(xsec('Qualité des données (' + a.n_crit + ' critères sur ' + AGX_CRIT.length + ')', [explainTable(rows, ['Qualité des données', agXNum(a.quality) ? fmt(a.quality, 1) : 'non calculée'])]));
    kids.push(xsec('Volume de visites', [kvList([['Visites (site × jour)', fmt(a.visits)], ['Jours actifs', fmt(a.days)], ['Visites par jour actif', fmt(a.vpd, 2) + ' (plafond ' + ENGINE.AGX_PROD.cap + ')'],
      ['Rang', agXNum(a.rank_pct) ? fmt(a.rank_pct, 1) + ' % parmi les ' + fmt(a.n_ranked) + ' agents de la sélection (médiane ' + fmt(R.info.medVisits, 0) + ' visites)' : 'non classé']]),
      agXNum(a.prod) ? formulaBox('Volume = 0,6 × ' + fmt(a.rank_pct, 1) + ' % + 0,4 × min(' + fmt(a.vpd, 2) + ' ; 3) ÷ 3 = ' + fmt(a.prod, 1) + ' / 100') : null,
      el('p', { class: 'hint', text: 'Le volume dépend de l’affectation et des autres agents de la sélection ; il change avec les filtres. Il ne mesure pas la qualité.' })]));
    if (agXNum(a.global)) {
      const qp = a.quality * ENGINE.AGX_GLOBAL.q, pp = a.prod * ENGINE.AGX_GLOBAL.p;
      const near = [GS.C, GS.B, GS.A].map(x => [x, a.global - x]).filter(x => Math.abs(x[1]) < 2).sort((x, y) => Math.abs(x[1]) - Math.abs(y[1]))[0];
      kids.push(xsec('Score et note', [formulaBox('Score = 0,8 × ' + fmt(a.quality, 1) + ' (qualité) + 0,2 × ' + fmt(a.prod, 1) + ' (volume)\n      = ' + fmt(qp, 1) + ' + ' + fmt(pp, 1) + ' = ' + fmt(a.global, 1) + ' → ' + (a.grade === 'N/N' ? 'non noté' : 'note ' + a.grade)),
        el('p', { class: 'hint', text: 'Barème agent : ' + agXGradeScale('agent') + '.' }),
        a.grade !== 'N/N' && near ? limitBox('À ' + fmt(Math.abs(near[1]), 1) + ' point de la limite ' + near[0] + ' : quelques fiches de plus ou de moins peuvent changer la lettre.') : null]));
    }
    const U = ENGINE.durStats(g);
    kids.push(xsec('Durée des fiches', U.meas ? [histo(agXDurBins(U), 'fiches'), kvList([['Fiches mesurées', fmt(U.meas) + ' sur ' + fmt(a.n) + (a.dur_na ? ', non mesurées : ' + a.dur_na_acts : '')],
      ['Médiane', agXDur(U.med)], ['Médiane de 3 min à 10 h', agXDur(U.medOk) + ' (' + fmt(U.ok) + ' fiches)'], ['Un quart sous / trois quarts sous', agXDur(U.p25) + ' / ' + agXDur(U.p75)], ['Plus longue', agXDur(U.max)]]),
      el('p', { class: 'hint', text: 'Moins de 3 min : fiche remplie sans entretien possible. De 3 min à 10 h : plausible. De 10 h à 24 h : longue. Plus de 24 h : fiche finalisée plus tard, la durée mesure l’attente. Fin avant début : horloge de la tablette. La note compte comme hors plage tout ce qui n’est pas entre 3 min et 10 h.' })]
      : [el('p', { class: 'hint', text: 'Aucune durée mesurée : ' + (a.dur_na_acts || 'activités') + ' sans heure d’ouverture et de fin dans l’extraction.' })]));
    const byA = ACTS.map(x => [x, g.filter(s => s.act === x)]).filter(x => x[1].length);
    const at = el('table', { class: 'xt' });
    at.appendChild(el('thead', null, el('tr', null, ['Activité', 'Fiches', 'Exploitables', 'GPS ≤ 5 km', 'Nom dans la liste', 'Durée 3 min à 10 h'].map((h, i) => el('th', { scope: 'col', class: i ? 'num' : '', text: h })))));
    const ctx = agXData().ctx;
    at.appendChild(el('tbody', null, byA.map(([x, l]) => {
      const v = l.filter(s => s.valid).length, gm = l.filter(s => !s.gps_ok || agXNum(s.dist)), gn = gm.filter(s => s.gps_ok && s.dist <= 5).length, dm = l.filter(s => agXNum(s.dur)), dk = dm.filter(s => s.dur >= 3 && s.dur <= 600).length;
      return el('tr', null, [el('td', { text: ACT[x].short }), el('td', { class: 'num', text: fmt(l.length) }), el('td', { class: 'num', text: agXNN(v, l.length) }), el('td', { class: 'num', text: gm.length ? agXNN(gn, gm.length) : 'non vérifiable' }),
        el('td', { class: 'num', text: ctx.nolist[x] ? 'sans liste' : agXNN(l.filter(s => !s.enu_other).length, l.length) }), el('td', { class: 'num', text: dm.length ? agXNN(dk, dm.length) : 'non mesurée' })]);
    })));
    kids.push(xsec('Par activité', [el('div', { class: 'tw' }, at)]));
    const nd = a.na_detail || [];
    if (nd.length) kids.push(xsec('Critères non mesurés', [el('ul', { class: 'find' }, nd.map(x => el('li', { text: x.label + ' : ' + x.why + '.' })))]));
    const W = a.weak_detail || [], st = [];
    if (a.list_nolist) st.push('Nom : ' + a.list_nolist + ' fiche(s) d’un formulaire sans liste d’agents. Cause : formulaire, non imputé à l’agent.');
    if (a.gps_unverif) st.push('GPS : ' + a.gps_unverif + ' fiche(s) sur un site sans coordonnées dans le plan. Distance non vérifiable, fiches sorties du critère.');
    if (a.dur_neg) st.push('Durée : ' + a.dur_neg + ' durée(s) négative(s), probablement l’horloge de la tablette.');
    if (a.dur_open) st.push('Durée : ' + a.dur_open + ' fiche(s) finalisée(s) plus de 24 h après ouverture, pratique d’équipe probable.');
    kids.push(xsec('À corriger', [W.length ? el('ul', { class: 'find' }, W.map(w => { const c = AGX_CRIT.find(x => x.k === w.k); return el('li', null, [el('b', { text: c.label + ' : ' }), (w.k === 'nsp' ? pct(w.v, 1) + ' en moyenne sur ' + fmt(w.den) + ' fiches' : fmt(w.num) + '/' + fmt(w.den) + ' ' + agXUnit(w.k) + ' (' + pct(w.v, 1) + ')') + ', seuil ' + agXThr(c) + ', ' + fmt(w.lost, 1) + ' point(s) de qualité perdu(s)' + (w.low ? ', effectif faible' : '') + '. Cause habituelle : ' + c.cause + '. Que faire : ' + c.how.replace(/^./, x => x.toLowerCase()) + '.']); })) : el('p', { class: 'hint', text: 'Aucun critère sous son seuil.' }),
      st.length ? el('ul', { class: 'find' }, st.map(t => el('li', { class: 'muted', text: t }))) : null]));
    kids.push(limitBox('La note décrit la qualité des données collectées dans la sélection (' + filtersActiveText() + '), pas la performance professionnelle de l’agent. À ne pas utiliser seule pour une décision.' + (a.n < SMALL_N.low * 2 ? ' Sur ' + fmt(a.n) + ' fiches, la note reste fragile.' : '')));
    openDrawer(agXName(a), 'Détail de la note', kids).classList.add('agx-xd');
  }

  // ================================================================== ONGLET PARTENAIRES
  const agXOrgKind = o => /^PAM$/i.test(o) ? 'int' : /^Autres/i.test(o) ? 'nc' : 'tpm';
  function agXOrgCell(o, k) {
    const c = AGX_CRIT.find(x => x.k === k); let num, den, det = '';
    if (k === 'valid') { num = o.valid_n; den = o.n; }
    else if (k === 'gps') { num = o.gps_near; den = o.gps_base; det = [o.gps_unverif ? o.gps_unverif + ' non vérifiable(s), site sans coordonnées' : '', o.gps_missing ? o.gps_missing + ' sans GPS' : ''].filter(Boolean).join(', '); }
    else if (k === 'listname') { num = o.list_ok; den = o.list_base; det = o.list_nolist ? o.list_nolist + ' fiche(s) d’un formulaire sans liste, non imputées' : ''; }
    else { num = o.dup_n; den = o.n; det = o.dup_same ? 'dont ' + o.dup_same + ' aux mêmes réponses probables' : ''; }
    const v = den ? num / den * 100 : NaN, st = nStatus(den), level = !den || st === 'na' ? 'na' : st === 'low' ? 'low' : ENGINE.agxLevel(c, v);
    return agXV(level, den ? pct(v, 0) : 'non mesuré', den ? fmt(num) + '/' + fmt(den) : '', () => c.label + ' : ' + AGX_LV[level][1] + '\n' + (den ? fmt(num) + ' sur ' + fmt(den) + ' fiches (' + pct(v, 1) + ')' : 'Aucune fiche mesurable') + (det ? '\n' + det : '') + '\nSeuil : ' + agXThr(c) + ', le même que pour les agents');
  }
  function agXRenderPartners(main) {
    const S = agXScored(), R = S.R;
    // ---- organisations de suivi
    const orgCols = [
      { k: 'org', t: 'Organisation', sortVal: o => o.org, fmt: o => agXPlain(agXOrgN(o.org), () => agXOrgN(o.org) + '\n' + (agXOrgKind(o.org) === 'int' ? 'Suivi interne, sert de référence ; pas classé avec les prestataires.' : agXOrgKind(o.org) === 'nc' ? 'Plusieurs organisations dont le nom n’a pas été collecté : non classable.' : 'Organisation de suivi') + '\nActivités : ' + o.acts) },
      { k: 'n', t: 'Fiches', num: 1, sortVal: o => o.n, fmt: o => agXPlain(fmt(o.n), () => fmt(o.n) + ' fiches, ' + fmt(o.visits) + ' visites, ' + fmt(o.sites) + ' sites') },
      { k: 'global', t: 'Note', num: 1, title: 'Note de suivi. Barème : ' + agXGradeScale('org'), sortVal: o => agXSortVal(o.global), fmt: o => el('span', { class: 'agx-note' }, [el('strong', { text: agXNum(o.global) ? fmt(o.global, 1) : 'n.c.' }), badge(o.grade, 'org')]) },
      { k: 'p_valid', t: 'Exploitables', title: 'Fiches exploitables / fiches', sortVal: o => agXSortVal(o.p_valid), fmt: o => agXOrgCell(o, 'valid') },
      { k: 'p_gps', t: 'GPS ≤ 5 km', title: 'GPS valide à 5 km au plus du site / fiches vérifiables (sites sans coordonnées exclus)', sortVal: o => agXSortVal(o.p_gps), fmt: o => agXOrgCell(o, 'gps') },
      { k: 'p_listname', t: 'Nom liste', title: 'Agent choisi dans la liste / fiches des formulaires qui ont une liste (Résilience exclue)', sortVal: o => agXSortVal(o.p_listname), fmt: o => agXOrgCell(o, 'listname') },
      { k: 'agent_q', t: 'Qualité agents', num: 1, title: 'Qualité moyenne des agents rattachés et notés, pondérée par leurs fiches', sortVal: o => agXSortVal(o.agent_q), fmt: o => agXPlain(agXNum(o.agent_q) ? fmt(o.agent_q, 1) : 'n.c.', () => 'Moyenne de ' + fmt(o.agent_q_n) + ' agent(s) noté(s), pondérée par leurs fiches') },
      { k: 'p_dup', t: 'Doublons', title: 'Même agent, site, jour et mêmes questions renseignées / fiches. Hors note.', sortVal: o => agXSortVal(o.p_dup), fmt: o => agXOrgCell(o, 'dup') },
      { k: 'p_dur_le24', t: 'Finalisées en 24 h', num: 1, title: 'Fiches finalisées au plus 24 h après ouverture / fiches mesurées (SMP et Résilience). Hors note.', sortVal: o => agXSortVal(o.p_dur_le24),
        fmt: o => o.dur_n ? agXV('plain', pct(o.p_dur_le24, 0), fmt(o.dur_le24) + '/' + fmt(o.dur_n), () => 'Finalisées au plus 24 h après ouverture : ' + fmt(o.dur_le24) + ' sur ' + fmt(o.dur_n) + ' fiches mesurées\nPlus de 24 h : ' + fmt(o.dur_open) + '\nInformation, hors note') : agXPlain('non mesuré', () => 'Les activités suivies n’ont pas d’heure d’ouverture et de fin') },
      { k: 'agents_att', t: 'Agents', num: 1, title: 'Agents rattachés (organisation majoritaire de leurs fiches)', sortVal: o => o.agents_att, fmt: o => agXPlain(fmt(o.agents_att), () => fmt(o.agents_att) + ' agents rattachés, ' + fmt(o.agents) + ' vus dans ses fiches') },
      { k: 'agents_ab', t: 'A-B', num: 1, title: 'Agents rattachés notés A ou B', sortVal: o => o.agents_ab, fmt: o => fmt(o.agents_ab) },
      { k: 'agents_cd', t: 'C-D', num: 1, title: 'Agents rattachés notés C ou D', sortVal: o => o.agents_cd, fmt: o => fmt(o.agents_cd) },
      { k: 'agents_nn', t: 'Non notés', num: 1, title: 'Agents rattachés avec moins de ' + GRADE_SCALES.agent.minN + ' fiches', sortVal: o => o.agents_nn, fmt: o => fmt(o.agents_nn) }];
    const tpm = R.ORG.filter(o => agXOrgKind(o.org) === 'tpm'), other = R.ORG.filter(o => agXOrgKind(o.org) !== 'tpm');
    const c1 = [tpm.length ? table(orgCols, tpm, { sortK: 2, onRow: o => agXOrgDrawer(o, S) }) : el('p', { class: 'hint', text: 'Aucune organisation de suivi dans la sélection.' })];
    if (other.length) c1.push(el('h3', { class: 'agx-h3', text: 'Hors classement' }), table(orgCols, other, { onRow: o => agXOrgDrawer(o, S) }));
    main.appendChild(agXCard('Organisations de suivi', ['On évalue la collecte de chaque organisation : fiches exploitables, GPS, identification des agents et qualité de ses agents. Cette note ne dit rien de l’assistance sur les sites.',
      'Note de suivi = 25 % fiches exploitables + 25 % GPS + 10 % nom choisi dans la liste + 40 % qualité moyenne des agents rattachés. Une composante non mesurable sort de la note et son poids est réparti.',
      'Barème : ' + agXGradeScale('org') + '. Doublons et délai de finalisation sont donnés pour information.',
      'Hors classement : le suivi interne (référence) et « Autres », qui regroupe des organisations non nommées.',
      fmt(R.info.sa) + ' fiches dans la sélection. Cliquez une ligne pour le calcul complet.'].join('\n'), c1, 'wide'));
    // ---- partenaires de mise en œuvre
    const VVf = agXVisits(), IMP = ENGINE.scoreImps(VVf, { rlabel: agXRlabel, domains: D.domains });
    const body = [];
    const noImp = ACTS.map(a => [a, VVf.filter(v => v.act === a && v.valid), VVf.filter(v => v.act === a && v.valid && (v.imp === '' || v.imp === null || v.imp === undefined)).length]).filter(x => x[1].length && x[2] === x[1].length);
    if (noImp.length) { const w = el('p', { class: 'note agx-line', text: noImp.map(x => ACT[x[0]].short).join(' et ') + ' : le formulaire ne demande pas le partenaire (' + fmt(sum(noImp.map(x => x[2]))) + ' visites non rattachées).' }); bindTip(w, () => noImp.map(x => ACT[x[0]].short + ' : ' + fmt(x[2]) + ' visites exploitables sans partenaire').join('\n') + '\nAjouter la question au formulaire, ou lire par école et district (onglet Activités).'); body.push(w); }
    if (DICT.imp.some(x => /^autres/i.test(String(x || '')))) { const w = el('p', { class: 'note warn agx-line', text: 'GD/PREVMA : « Autres » sans précision pour l’organisation et le partenaire, à corriger dans le formulaire.' }); bindTip(w, () => 'Les questions CPList (organisation de l’agent) et ImpPrtName (partenaire de mise en œuvre) proposent « Autres » sans question de précision. Le nom réel n’est donc pas connu : ' + autresNote() + '.'); body.push(w); }
    const RESP_S = { imp: 'partenaire', sh: 'partagée', ctx: 'contexte' };
    const ACTSI = ACTS.filter(a => IMP.some(o => o.act === a));
    ACTSI.forEach(a => {
      const ip = IMP.filter(o => o.act === a);
      const cols2 = [
        { k: 'imp', t: 'Partenaire', sortVal: o => o.imp, fmt: o => el('span', { class: 'agx-ag' }, [agXPlain(agXOrgN(o.imp), () => agXOrgN(o.imp) + '\nObservé par ' + o.obs.map(x => x.org + ' (' + fmt(x.visits) + ')').join(', ') + '\nVisites du ' + (o.first ? dFrUI(o.first) : '–') + ' au ' + (o.last ? dFrUI(o.last) : '–')),
          o.self_n ? agXV('mid', 'auto-suivi ?', '', () => fmt(o.self_n) + ' visite(s) observée(s) par une organisation au nom proche du partenaire. Constat non indépendant, à confirmer.') : null]) },
        { k: 'visits', t: 'Visites', num: 1, sortVal: o => o.visits, fmt: o => nStatus(o.visits) === 'ok' ? fmt(o.visits) : agXV('low', fmt(o.visits), '', () => nNote(o.visits, 'visites')) },
        { k: 'sites', t: 'Sites', num: 1, sortVal: o => o.sites, fmt: o => fmt(o.sites) },
        { k: 'global', t: 'Note', num: 1, title: 'Note de conformité = score moyen − 0,15 × % de visites avec alerte. Barème : ' + agXGradeScale('imp'), sortVal: o => agXSortVal(o.global), fmt: o => el('span', { class: 'agx-note' }, [el('strong', { text: fmt(o.global, 1) }), badge(o.grade, 'imp')]) },
        { k: 'score', t: 'Score', num: 1, title: 'Score de conformité moyen des visites exploitables, sur 100', sortVal: o => agXSortVal(o.score), fmt: o => agXImpCell(o, 'score') },
        { k: 'p_risk', t: 'Visites avec alerte', num: 1, title: 'Visites avec au moins une alerte / visites exploitables', sortVal: o => agXSortVal(o.p_risk), fmt: o => agXImpCell(o, 'risk') },
        { k: 'penalty', t: 'Pénalité', num: 1, title: '0,15 × % de visites avec alerte, 15 points au plus', sortVal: o => agXSortVal(o.penalty), fmt: o => '−' + fmt(o.penalty, 1) },
        { k: 'top', t: 'Alerte principale', title: 'Alerte la plus fréquente, en visites. Infobulle : les trois premières et la responsabilité proposée.', sortVal: o => o.risk_n,
          fmt: o => o.alerts.length ? agXPlain(o.alerts[0].label + ' ' + fmt(o.alerts[0].n) + '/' + fmt(o.visits), () => o.alerts.slice(0, 3).map(x => x.label + ' : ' + fmt(x.n) + '/' + fmt(o.visits) + ' visites (' + RESP_S[x.resp] + ')').join('\n') + '\nVisites avec une alerte du partenaire : ' + fmt(o.risk_imp_n) + ', partagée : ' + fmt(o.risk_sh_n) + ', de contexte : ' + fmt(o.risk_ctx_n)) : '—' }];
      body.push(el('h3', { class: 'agx-h3', text: ACT[a].label }), el('p', { class: 'hint agx-sub', text: fmt(ip.length) + ' partenaire(s), ' + fmt(sum(ip.map(o => o.visits))) + ' visites' }), table(cols2, ip, { sortK: 3, onRow: o => agXImpDrawer(o, S) }));
    });
    if (!ACTSI.length) body.push(el('p', { class: 'hint', text: 'Aucun partenaire de mise en œuvre dans la sélection.' }));
    main.appendChild(agXCard('Partenaires de mise en œuvre', ['On évalue ce que les visites ont constaté sur les sites du partenaire : normes respectées et alertes. Cette note ne mesure pas le travail des agents de suivi.',
      'Note de conformité = score moyen des visites exploitables − 0,15 × % de visites avec au moins une alerte (15 points de pénalité au plus).',
      'Barème : ' + agXGradeScale('imp') + '. Un tableau par activité : on ne compare jamais des partenaires d’activités différentes.',
      'Effectif : moins de ' + SMALL_N.min + ' visites, non calculé ; de ' + SMALL_N.min + ' à ' + (SMALL_N.low - 1) + ', valeur indicative sans couleur.',
      'Responsabilité des alertes (partenaire, partagée, contexte) : classement proposé, à valider avec le programme ; il n’entre pas dans la note.',
      'Cliquez une ligne pour le calcul, les alertes et les observateurs.'].join('\n'), body, 'wide'));
  }
  function agXImpCell(o, k) {
    const st = nStatus(o.visits);
    if (k === 'score') { const lv = st === 'ok' ? cls(o.score) : st === 'low' ? 'low' : 'na'; return agXV(lv, fmt(o.score, 1), '', () => 'Score de conformité moyen : ' + fmt(o.score, 1) + ' / 100 sur ' + fmt(o.score_n) + ' visites\nMédiane ' + fmt(o.score_med, 1) + ', plus faible ' + fmt(o.score_min, 1) + '\nRepère : ' + scoreRefText() + (st !== 'ok' ? '\n' + nNote(o.visits, 'visites') : '')); }
    const lv = st === 'ok' ? riskCls(o.p_risk) : st === 'low' ? 'low' : 'na';
    return agXV(lv, pct(o.p_risk, 0), fmt(o.risk_n) + '/' + fmt(o.visits), () => 'Visites avec au moins une alerte : ' + fmt(o.risk_n) + ' sur ' + fmt(o.visits) + ' (' + pct(o.p_risk, 1) + ')\nRepère : ' + riskRefText() + (st !== 'ok' ? '\n' + nNote(o.visits, 'visites') : ''));
  }
  function agXOrgDrawer(o, S) {
    const R = S.R, kind = agXOrgKind(o.org), GO = GRADE_SCALES.org, naL = String(o.na_comp || '').split(',');
    const comp = ENGINE.ORG_COMP.map(([k, w0, lab]) => {
      const na = naL.includes(k);
      const raw = k === 'p_valid' ? agXNN(o.valid_n, o.n) : k === 'p_gps' ? agXNN(o.gps_near, o.gps_base) + (o.gps_unverif ? ', ' + o.gps_unverif + ' non vérifiables exclues' : '') : k === 'p_listname' ? (o.list_base ? agXNN(o.list_ok, o.list_base) : 'aucune fiche avec liste') + (o.list_nolist ? ', ' + o.list_nolist + ' fiches sans liste exclues' : '') : (agXNum(o.agent_q) ? fmt(o.agent_q, 1) + ', moyenne de ' + o.agent_q_n + ' agent(s) noté(s) pondérée par leurs ' + fmt(o.agent_q_fiches) + ' fiches (toutes organisations)' : 'aucun agent noté');
      const ref = k === 'agent_q' ? 'poids de base ' + pct(w0 * 100, 0) : 'seuil agent ' + agXThr(AGX_CRIT.find(c => c.col === k)) + ', poids de base ' + pct(w0 * 100, 0);
      return { k: lab, raw, ref, sub: o[k], w: o['w_' + k], pts: o['pt_' + k], na, why: na ? 'Non mesurable : poids réparti.' : '' };
    });
    const W = o.w_eff || {};
    const kids = [kvList([['Rôle', kind === 'int' ? 'Suivi interne, référence de comparaison' : kind === 'nc' ? 'Non classable : plusieurs organisations dont le nom n’a pas été collecté' : 'Organisation de suivi (tierce partie)'],
      ['Activités', o.acts], ['Base', fmt(o.n) + ' fiches, ' + fmt(o.visits) + ' visites, ' + fmt(o.sites) + ' sites'], ['Agents', fmt(o.agents_att) + ' rattachés, ' + fmt(o.agents) + ' vus dans ses fiches'],
      ['Note', o.grade === 'N/N' ? 'non notée (' + fmt(o.n) + ' fiches, minimum ' + GO.minN + ')' + (agXNum(o.global) ? ', score ' + fmt(o.global, 1) : '') : o.grade + ', ' + fmt(o.global, 1)]]),
      xsec('Calcul de la note', [explainTable(comp, ['Note de suivi', agXNum(o.global) ? fmt(o.global, 1) : 'non calculée']),
        formulaBox('Note = (' + ENGINE.ORG_COMP.filter(([k]) => !naL.includes(k)).map(([k, w0]) => fmt(w0, 2) + ' × ' + fmt(o[k], 1)).join(' + ') + ') ÷ ' + fmt(o.w_used_pct / 100, 2) + ' = ' + fmt(o.global, 1) + ' → ' + (o.grade === 'N/N' ? 'non noté' : o.grade)),
        el('p', { class: 'hint', text: 'Barème : ' + agXGradeScale('org') + '.' })]),
      xsec('Poids réels des critères', [el('p', { class: 'hint', text: 'La qualité des agents contient déjà les fiches exploitables, le GPS et le nom : ces critères comptent deux fois. Poids réels dans la note : ' + AGX_CRIT.filter(c => agXNum(W[c.k]) && W[c.k] > 0).map(c => c.short + ' ' + pct(W[c.k], 0)).join(', ') + '.' })]),
      xsec('Délai de finalisation (hors note)', [o.dur_n ? kvList([['Finalisées en 24 h au plus', agXNN(o.dur_le24, o.dur_n)], ['Plus de 24 h', fmt(o.dur_open)], ['Négatives (horloge)', fmt(o.dur_neg)], ['Médiane', agXDur(o.dur_med) + ' (' + agXDur(o.dur_med_ok) + ' de 3 min à 10 h)']]) : el('p', { class: 'hint', text: 'Non mesuré : les activités suivies n’enregistrent pas l’heure d’ouverture et de fin.' })]),
      xsec('Agents rattachés', [agXAgentsOf(o, R, S)]),
      xsec('Limites', [el('ul', { class: 'find' }, [
        'Réalisation des visites affectées et délai d’envoi non calculables : le plan ne dit pas quelle organisation suit chaque site, et la date d’envoi au serveur n’est pas importée.',
        'Le GPS et le nom dans la liste dépendent aussi du bureau (coordonnées du plan, liste des agents à jour). À vérifier avant d’imputer l’écart à l’organisation.',
        o.n < GO.minN ? 'Moins de ' + GO.minN + ' fiches : pas de note.' : null,
        kind === 'int' ? 'Le suivi interne sert de référence ; il n’est pas évalué comme un prestataire.' : null].filter(Boolean).map(t => el('li', { text: t })))])];
    openDrawer(agXOrgN(o.org), 'Organisation de suivi', kids).classList.add('agx-xd');
  }
  function agXAgentsOf(o, R, S) {
    const att = R.AG.filter(a => a.org === o.org);
    if (!att.length) return el('p', { class: 'hint', text: 'Aucun agent rattaché.' });
    const t = el('table', { class: 'xt' });
    t.appendChild(el('thead', null, el('tr', null, ['Agent', 'Fiches', 'Qualité', 'Note'].map((h, i) => el('th', { scope: 'col', class: i && i < 3 ? 'num' : '', text: h })))));
    t.appendChild(el('tbody', null, att.map(a => { const tr = el('tr', { class: 'clk', tabindex: '0' }, [el('td', { text: agXName(a) }), el('td', { class: 'num', text: fmt(a.n) }), el('td', { class: 'num', text: agXNum(a.quality) ? fmt(a.quality, 1) : 'n.c.' }), el('td', null, badge(a.grade, 'agent'))]);
      tr.addEventListener('click', () => agXAgentDrawer(a, S)); tr.addEventListener('keydown', e => { if (e.key === 'Enter') agXAgentDrawer(a, S); }); return tr; })));
    return el('div', { class: 'tw' }, t);
  }
  function agXImpDrawer(o, S) {
    const GI = GRADE_SCALES.imp, dn = D.domains[o.act] || [];
    const kids = [kvList([['Activité', ACT[o.act].label], ['Visites', 'du ' + (o.first ? dFrUI(o.first) : '–') + ' au ' + (o.last ? dFrUI(o.last) : '–')], ['Base', fmt(o.visits) + ' visites exploitables sur ' + fmt(o.sites) + ' sites' + (nStatus(o.visits) !== 'ok' ? ', ' + nNote(o.visits, 'visites') : '')],
      ['Observé par', o.obs.map(x => x.org + ' (' + fmt(x.visits) + ')').join(', ')], ['Note', o.grade === 'N/N' ? 'non notée (moins de ' + GI.minN + ' visites)' : o.grade + ', ' + fmt(o.global, 1)]]),
      xsec('Calcul de la note', [formulaBox('Note = score moyen ' + fmt(o.score, 1) + ' (' + fmt(o.score_n) + ' visites) − 0,15 × ' + pct(o.p_risk, 1) + ' de visites avec alerte (' + fmt(o.risk_n) + '/' + fmt(o.visits) + ')\n     = ' + fmt(o.score, 1) + ' − ' + fmt(o.penalty, 1) + ' = ' + fmt(o.global, 1) + ' → ' + (o.grade === 'N/N' ? 'non noté' : o.grade)),
        el('p', { class: 'hint', text: 'Barème : ' + agXGradeScale('imp') + '.' }),
        limitBox('La pénalité vaut au plus 0,15 × 100 = 15 points : même avec une alerte à chaque visite, un partenaire dont le score moyen atteint ' + fmt(GI.B + 15) + ' reste noté B. Les questions d’alerte sont aussi des normes du score, une alerte compte donc deux fois.')]),
      xsec('Alertes relevées', [o.alerts.length ? agXAlertTable(o) : el('p', { class: 'hint', text: 'Aucune alerte relevée.' }),
        kvList([['Alerte qui relève du partenaire', nOf(o.risk_imp_n, o.visits, 'visites')], ['Alerte partagée ou à vérifier', nOf(o.risk_sh_n, o.visits, 'visites')], ['Alerte de contexte', nOf(o.risk_ctx_n, o.visits, 'visites')], ['Toutes alertes (note appliquée)', nOf(o.risk_n, o.visits, 'visites')]]),
        el('p', { class: 'hint', text: 'Pour information, avec les seules alertes qui relèvent du partenaire, la note serait ' + fmt(o.global_imp, 1) + ' (' + gradeOf('imp', o.global_imp, o.visits).replace('N/N', 'non noté') + '). Ce classement des alertes est une proposition à valider avec le programme ; la note appliquée compte toutes les alertes. Les réductions de rations sont classées « partagées » : elles viennent souvent de l’approvisionnement.' })]),
      xsec('Domaines de suivi', [agXDomTable(o, dn)]),
      xsec('Qui a observé', [agXObsTable(o)]),
      xsec('Limites', [el('ul', { class: 'find' }, [
        o.visits < 20 || o.sites < 10 ? fmt(o.visits) + ' visites sur ' + fmt(o.sites) + ' sites. Sous 20 visites et 10 sites, une visite de plus ou de moins déplace nettement le taux d’alerte : constat provisoire.' : null,
        o.visits > o.sites * 1.5 ? fmt(o.visits) + ' visites pour ' + fmt(o.sites) + ' sites : un site revisité pèse plusieurs fois.' : null,
        o.self_n ? fmt(o.self_n) + ' visite(s) observée(s) par une organisation au nom proche du partenaire. Auto-suivi probable, à confirmer : constat non indépendant.' : null,
        'La note dépend en partie de l’organisation qui observe : regarder le tableau des observateurs avant la revue.',
        'Ne pas comparer avec un partenaire d’une autre activité : normes et alertes diffèrent.'].filter(Boolean).map(t => el('li', { text: t })))])];
    openDrawer(agXOrgN(o.imp) + ' (' + ACT[o.act].short + ')', 'Partenaire de mise en œuvre', kids).classList.add('agx-xd');
  }
  function agXAlertTable(o) {
    const t = el('table', { class: 'xt' });
    t.appendChild(el('thead', null, el('tr', null, ['Alerte', 'Visites', 'Responsabilité proposée'].map((h, i) => el('th', { scope: 'col', class: i === 1 ? 'num' : '', text: h })))));
    t.appendChild(el('tbody', null, o.alerts.map(x => el('tr', null, [el('td', { text: x.label }), el('td', { class: 'num', text: agXNN(x.n, o.visits) }), el('td', { text: ENGINE.ALERT_RESP_TXT[x.resp] })]))));
    return el('div', { class: 'tw' }, t);
  }
  function agXDomTable(o, dn) {
    const t = el('table', { class: 'xt' });
    t.appendChild(el('thead', null, el('tr', null, ['Domaine', 'Score moyen', 'Visites'].map((h, i) => el('th', { scope: 'col', class: i ? 'num' : '', text: h })))));
    t.appendChild(el('tbody', null, dn.map((d, j) => el('tr', null, [el('td', { text: d }), el('td', { class: 'num' }, o.doms[j] === null || o.doms[j] === undefined ? '–' : cellTxt(o.doms[j])), el('td', { class: 'num', text: fmt(o.dom_n[j]) })]))));
    return el('div', { class: 'tw' }, t);
  }
  function agXObsTable(o) {
    const t = el('table', { class: 'xt' });
    t.appendChild(el('thead', null, el('tr', null, ['Organisation de suivi', 'Visites', 'Avec alerte', 'Score moyen'].map((h, i) => el('th', { scope: 'col', class: i ? 'num' : '', text: h })))));
    t.appendChild(el('tbody', null, o.obs.map(x => el('tr', null, [el('td', { text: x.org }), el('td', { class: 'num', text: fmt(x.visits) }), el('td', { class: 'num', text: agXNN(x.risk_n, x.visits) }), el('td', { class: 'num', text: fmt(x.score, 1) })]))));
    const big = o.obs.filter(x => x.visits >= SMALL_N.low);
    let gap = null; if (big.length > 1) { const ps = big.map(x => x.risk_n / x.visits * 100); gap = Math.max.apply(null, ps) - Math.min.apply(null, ps); }
    return el('div', null, [el('div', { class: 'tw' }, t), gap !== null && gap >= 25 ? limitBox('Écart de ' + fmt(gap, 0) + ' points de taux d’alerte entre observateurs ayant chacun au moins ' + SMALL_N.low + ' visites. Prévoir une visite conjointe ou une contre-vérification avant la revue.') : null]);
  }

  // ================================================================== SOUS-VUE « PAR ACTIVITÉ » (contrôles des fiches, durée, défauts des formulaires)
  function agXRenderQualActivite(main) {
    const full = agXFullPeriod(), d = agXData();
    const subs = d.subs.filter(s => agXPass(s, full));
    const vis = V.filter(v => (F.act === 'ALL' || v.act === F.act) && (F.fo < 0 || v.fo === F.fo) && (F.region < 0 || v.region === F.region) && (F.district < 0 || v.district === F.district) && (F.org < 0 || v.org === F.org) && (F.imp < 0 || v.imp === F.imp) && (full || (!!v.date && v.month >= F.m0 && v.month <= F.m1)));
    const DQ = ENGINE.dqStats(subs, vis.map(v => ({ act: v.act, valid: v.valid })), d.ctx).filter(x => x.subs);
    const tot = {}; DQ.forEach(x => Object.keys(x).forEach(k => { if (typeof x[k] === 'number') tot[k] = (tot[k] || 0) + x[k]; }));
    tot.act = 'TOTAL'; tot.nameNoListN = sum(DQ.filter(x => x.nameNoList).map(x => x.nameOther));
    const DTT = ENGINE.durStats(subs); tot.durMed = DTT.med; tot.durMedOk = DTT.medOk;
    const rows = DQ.concat(DQ.length > 1 ? [tot] : []);
    const lab = r => r.act === 'TOTAL' ? 'Total' : ACT[r.act].short;
    // une valeur (%) + sa base en clair ; le détail en infobulle
    const pv = (n, N, tip) => N ? agXV('plain', pct(n / N * 100, n && n / N < 0.01 ? 1 : 0), fmt(n) + '/' + fmt(N), tip ? () => tip : null) : agXPlain('–');
    const actCol = { k: 'act', t: 'Activité', fmt: r => el('b', { text: lab(r) }), sortVal: r => r.act === 'TOTAL' ? 'ZZ' : r.act };
    const cols = [actCol,
      { k: 'subs', t: 'Fiches', num: 1, sortVal: r => r.subs, fmt: r => agXPlain(fmt(r.subs), () => fmt(r.subs) + ' fiches\n' + fmt(r.validVisits) + ' visites exploitables sur ' + fmt(r.visits)) },
      { k: 'empty', t: 'Vides', num: 1, title: 'Fiches sans aucune norme renseignée / fiches', sortVal: r => r.empty, fmt: r => pv(r.empty, r.subs, r.sysEmpty ? 'Dont ' + fmt(r.sysEmpty) + ' de l’ancienne version du formulaire, écartées de l’évaluation des agents' : '') },
      { k: 'dateBad', t: 'Dates', num: 1, title: 'Date absente, illisible ou hors période de validité (' + winLabel() + ')', sortVal: r => r.dateBad, fmt: r => pv(r.dateBad, r.subs, r.dateBad ? fmt(r.dateUnread) + ' illisible(s), ' + fmt(r.dateOut) + ' hors période' : '') },
      { k: 'gpsMissing', t: 'GPS absent', num: 1, title: 'GPS absent ou hors de Madagascar / fiches', sortVal: r => r.gpsMissing, fmt: r => pv(r.gpsMissing, r.subs) },
      { k: 'gpsFarMeas', t: 'GPS > 5 km', num: 1, title: 'Fiches à plus de 5 km du site du plan / fiches dont la distance est calculable', sortVal: r => r.gpsMeas ? r.gpsFarMeas / r.gpsMeas : null,
        fmt: r => r.gpsMeas ? pv(r.gpsFarMeas, r.gpsMeas, (r.gpsUnverif ? fmt(r.gpsUnverif) + ' fiche(s) non vérifiable(s) : site sans coordonnées dans le plan' : 'Toutes les fiches avec GPS sont vérifiables')) : agXPlain('non vérifiable', () => 'Aucun site avec coordonnées dans le plan') },
      { k: 'nameOther', t: 'Agent « Autre »', num: 1, title: 'Agent saisi en « Autre » au lieu d’être choisi dans la liste / fiches', sortVal: r => r.nameOther,
        fmt: r => r.nameNoList ? agXPlain('sans liste', () => fmt(r.nameOther) + '/' + fmt(r.subs) + ' : le formulaire n’a pas de liste d’agents. Non imputable aux agents.') : pv(r.nameOther, r.subs, r.nameNoListN ? 'Dont ' + fmt(r.nameNoListN) + ' fiches d’un formulaire sans liste, non imputables' : '') },
      { k: 'noEnu', t: 'Agent absent', num: 1, title: 'Nom d’agent non renseigné / fiches', sortVal: r => r.noEnu, fmt: r => pv(r.noEnu, r.subs, r.noEnuSys ? 'Dont ' + fmt(r.noEnuSys) + ' de l’ancienne version du formulaire' : '') },
      { k: 'offList', t: 'Site hors liste', num: 1, title: 'Site saisi en « Autre », hors liste du plan / fiches', sortVal: r => r.offList, fmt: r => pv(r.offList, r.subs) },
      { k: 'dup', t: 'Doublons', num: 1, title: 'Même agent, même site, même jour et même liste de questions renseignées qu’une fiche précédente / fiches', sortVal: r => r.dup,
        fmt: r => pv(r.dup, r.subs, r.dup ? 'Dont ' + fmt(r.dupSame) + ' aux mêmes réponses probables (même score, même nombre de réponses). Les autres peuvent être des entretiens distincts le même jour.' : '') }];
    main.appendChild(agXCard('Contrôles des fiches', 'Une ligne par activité. Chaque cellule donne le taux et sa base (fiches concernées / fiches). Survolez une cellule pour le détail, un en-tête pour la définition.\nBase : toutes les fiches de la sélection (' + fmt(subs.length) + '), ancienne version des formulaires comprise. L’évaluation des agents, elle, écarte les fiches vides de l’ancienne version.' + (full ? '' : '\nLa période porte sur le jour de chaque fiche.'), [table(cols, rows, { sortK: 0, dir: 1 })], 'wide'));
    // durée des fiches
    const pd = (r, k) => r.durMeasured ? pv(r[k], r.durMeasured) : agXPlain('–');
    const dcols = [actCol,
      { k: 'durMeasured', t: 'Mesurées', num: 1, sortVal: r => r.durMeasured, fmt: r => r.durMeasured ? pv(r.durMeasured, r.subs) : agXPlain('non mesuré', () => 'Pas d’heure d’ouverture et de fin dans l’extraction') },
      { k: 'durNeg', t: 'Fin avant début', num: 1, title: 'Durée négative : horloge de la tablette', sortVal: r => r.durNeg, fmt: r => pd(r, 'durNeg') },
      { k: 'durShort', t: 'Moins de 3 min', num: 1, title: 'Fiche remplie en moins de 3 minutes : entretien peu plausible', sortVal: r => r.durShort, fmt: r => pd(r, 'durShort') },
      { k: 'durOk', t: '3 min à 10 h', num: 1, sortVal: r => r.durOk, fmt: r => pd(r, 'durOk') },
      { k: 'durLong', t: '10 à 24 h', num: 1, sortVal: r => r.durLong, fmt: r => pd(r, 'durLong') },
      { k: 'durOpen', t: 'Plus de 24 h', num: 1, title: 'Finalisée plus de 24 h après ouverture : la durée mesure l’attente, pas l’entretien', sortVal: r => r.durOpen, fmt: r => pd(r, 'durOpen') },
      { k: 'durLe24', t: 'En 24 h', num: 1, title: 'Fiches finalisées entre 0 et 24 h après ouverture / fiches mesurées', sortVal: r => r.durLe24, fmt: r => pd(r, 'durLe24') },
      { k: 'durMed', t: 'Médiane', num: 1, title: 'Médiane des durées mesurées (infobulle : médiane des fiches de 3 min à 10 h)', sortVal: r => r.durMed, fmt: r => r.durMeasured ? agXPlain(agXDur(r.durMed), () => 'Médiane de toutes les durées : ' + agXDur(r.durMed) + '\nMédiane des fiches de 3 min à 10 h : ' + agXDur(r.durMedOk)) : '–' }];
    const DT = agXDurInfo(subs);
    main.appendChild(agXCard('Durée des fiches', DT.info + '\nUne activité sans heure d’ouverture et de fin est « non mesurée », jamais « 0 problème ». Les durées négatives sont séparées des fiches de moins de 3 min.', [table(dcols, rows, { sortK: 0, dir: 1 })], 'wide'));
    // indices des formulaires
    const fcRows = ACTS.map(a => { const g = vis.filter(v => v.act === a && v.valid && v.form !== null && v.form !== undefined && !isNaN(v.form) && v.score !== null && v.score !== undefined); if (!g.length) return null;
      const mx = mean(g.map(v => v.form)), my = mean(g.map(v => v.score)); let sxy = 0, sxx = 0, syy = 0; g.forEach(v => { sxy += (v.form - mx) * (v.score - my); sxx += (v.form - mx) ** 2; syy += (v.score - my) ** 2; });
      const c = sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN; return { a, n: g.length, f: mx, r: my, c }; }).filter(Boolean);
    const noIdx = ACTS.filter(a => vis.some(v => v.act === a && v.valid) && !fcRows.some(x => x.a === a)).map(a => ACT[a].short);
    const strength = c => !agXNum(c) ? 'non calculable' : Math.abs(c) >= 0.7 ? 'lien fort' : Math.abs(c) >= 0.4 ? 'lien modéré' : 'lien faible';
    const g2 = el('div', { class: 'grid g2' });
    g2.appendChild(agXCard('Indices des formulaires', 'Indice calculé dans le formulaire comparé au score recalculé, sur les visites exploitables de la sélection. Les indices des formulaires ne servent pas aux calculs du tableau de bord.' + (noIdx.length ? '\n' + noIdx.join(', ') + ' : pas d’indice dans le formulaire.' : '') + '\n' + formRiskNote(),
      [fcRows.length ? table([{ k: 'a', t: 'Activité', fmt: r => ACT[r.a].short }, { k: 'n', t: 'Visites', num: 1 }, { k: 'f', t: 'Indice formulaire', num: 1, fmt: r => fmt(r.f, 1) }, { k: 'r', t: 'Score recalculé', num: 1, fmt: r => fmt(r.r, 1) }, { k: 'c', t: 'Corrélation', num: 1, fmt: r => agXPlain(fmt(r.c, 2), () => strength(r.c) + ' (r de Pearson sur ' + fmt(r.n) + ' visites)') }], fcRows) : el('p', { class: 'hint', text: 'Aucun indice de formulaire dans la sélection.' })]));
    g2.appendChild(agXCard('Défauts des formulaires', 'Constats rédigés sur tout le fichier, sans filtre, et recalculés à chaque mise à jour des données.', [el('ul', { class: 'find' }, D.dqFindings.map(f => el('li', { text: f })))]));
    main.appendChild(g2);
    const au = D.autreAudit, abs = au.filter(r => r[6].startsWith('Question'));
    main.appendChild(agXCard('Choix « Autre » non précisés', 'Tout le fichier, sans filtre. Questions qui proposent « Autre » : soit le formulaire n’a pas de question « préciser » et la réponse réelle est perdue, soit l’agent n’a pas saisi la précision. n.d. : question absente de l’extraction.',
      [el('p', { class: 'hint agx-sub', text: fmt(abs.length) + ' question(s) sans « préciser », ' + fmt(au.length - abs.length) + ' avec des précisions manquantes' }),
        table([{ k: 0, t: 'Activité', fmt: r => ACT[r[0]].short }, { k: 1, t: 'Variable' }, { k: 2, t: 'Question', fmt: r => { const sp = el('span', { class: 'lnk', text: r[2].length > 70 ? r[2].slice(0, 68) + '…' : r[2] }); bindTip(sp, () => r[2]); return sp; } },
          { k: 3, t: 'Question « préciser »', fmt: r => r[3] || 'absente' }, { k: 4, t: 'Réponses « Autre »', num: 1, fmt: r => r[4] === null ? 'n.d.' : fmt(r[4]) },
          { k: 5, t: 'Précisées', num: 1, fmt: r => r[5] === null ? '–' : (r[4] ? agXPlain(fmt(r[5]) + '/' + fmt(r[4]), () => pct(r[5] / r[4] * 100) + ' des réponses « Autre » précisées') : fmt(r[5])) },
          { k: 6, t: 'Statut', fmt: r => el('span', { class: 'cell bg-' + (r[6].startsWith('Question') ? 'bad' : 'mid'), text: r[6] }) }], au, { sortK: 4 })], 'wide'));
  }
  // ================================================================== ONGLET « QUALITÉ & ACTEURS » : 3 sous-vues (fusion Qualité + Partenaires + Agents)
  // Une seule page, trois vues de la même famille de mesures : Par activité · Par organisation · Par agent.
  // « Durée des fiches » et la distribution A/B/C/D ne sont rendues qu'une fois (voir le dédoublonnage ci-dessus).
  const AGX_QA_VIEWS = [['activite', 'Par activité'], ['organisation', 'Par organisation'], ['agent', 'Par agent']];
  const AGX_QA_HEAD = {
    activite: ['Qualité des données par activité', 'Contrôles des fiches, durée de saisie et défauts des formulaires — une ligne par activité.'],
    organisation: ['Acteurs par organisation', 'Note de suivi des organisations de suivi (TPM) et conformité des partenaires de mise en œuvre.'],
    agent: ['Acteurs par agent', 'Note de chaque agent de suivi : qualité des données et volume de visites.']
  };
  function agXQaSub() { const s = SESSION.qaSub; return AGX_QA_VIEWS.some(v => v[0] === s) ? s : 'activite'; }
  function agXQaGo(sub) { if (SESSION.qaSub === sub) return; SESSION.qaSub = sub; closeDrawer(); render(); window.scrollTo(0, 0); }
  function agXQaBar(cur) {
    const bar = el('div', { class: 'pl-sub agx-sub-bar', role: 'tablist', 'aria-label': 'Vues Qualité & acteurs' });
    AGX_QA_VIEWS.forEach(([k, l]) => {
      const b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(cur === k), class: cur === k ? 'on' : '', text: l });
      b.addEventListener('click', () => agXQaGo(k));
      bar.appendChild(b);
    });
    return bar;
  }
  function agXRenderQuality(main) {
    const cur = agXQaSub();
    main.appendChild(agXQaBar(cur));
    const H = AGX_QA_HEAD[cur];
    main.appendChild(el('div', { class: 'agx-vh' }, [el('h2', { class: 'agx-vh-t', text: H[0] }), el('p', { class: 'agx-vh-s', text: H[1] })]));
    if (cur === 'organisation') agXRenderPartners(main);
    else if (cur === 'agent') agXRenderAgents(main);
    else agXRenderQualActivite(main);
  }
  // ================================================================== /LOT AGENTS
