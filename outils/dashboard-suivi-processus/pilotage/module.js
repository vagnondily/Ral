  // ================================================================== LOT « PILOTAGE » (préfixe pi) : note de direction, une page A4
  // Recalculée à chaque affichage depuis les données courantes et la barre de filtres (FILTER_SCOPE.pilot = 'all').
  // Les fenêtres de comparaison partent du mois de fin choisi : F.m0 ne les raccourcit pas, il borne les blocs cumulés.
  // Seuils provisoires : table unique PILOT (à valider), affichée dans le tiroir « Règles et seuils ».
  const PILOT = { k: 3, minN: 30, drop: 5, covFloor: 10, blindSites: 10, blindMonths: 6, complete: 80, caseAge: 30, oldDays: 90, revisitDays: 30,
    supply: 25, supplyRise: 10, mealDays: 15, mealShare: 25, mealSchools: 30, stockVisits: 2, cap: 1.5, channelMin: 20, detectMin: 90, impMin: 95,
    normN: 30, normGroupN: 10, normShare: 67, mask: 5, gpsKm: 5, maxSubjects: 5, fontMax: 9.5, fontMin: 7.5 };
  const PILOT_DEF = [
    ['k', 'Fenêtre de comparaison', 'mois complets', 'les k derniers mois complets avant le mois de fin, contre les k précédents'],
    ['minN', 'Effectif minimal pour un verdict', 'visites', 'en dessous : non concluant ; une baisse n’est significative qu’avec ce nombre de visites de chaque côté'],
    ['drop', 'Baisse significative', 'points', ''],
    ['covFloor', 'Couverture minimale pour conclure', '% des sites actifs', ''],
    ['blindSites', 'Suivi interrompu ou zone aveugle', 'sites actifs au moins', ''],
    ['blindMonths', 'Zone aveugle', 'mois sans visite', ''],
    ['complete', 'Mois complet', '% d’un mois habituel', 'moyenne des 3 mois précédents'],
    ['caseAge', 'Cas grave sans suite', 'jours sans statut', ''],
    ['oldDays', 'Cas ancien', 'jours', ''],
    ['revisitDays', 'Site revu à temps après un cas', 'jours', ''],
    ['supply', 'Rations réduites (GD)', '% des visites', ''],
    ['supplyRise', 'Hausse des rations réduites', 'points', ''],
    ['mealDays', 'Repas scolaires servis', 'jours sur 20, seuil', ''],
    ['mealShare', 'Écoles sous ce seuil', '% des écoles', ''],
    ['mealSchools', 'Écoles relevées au moins', 'écoles', ''],
    ['stockVisits', 'Écart de stock chez un même partenaire', 'visites', ''],
    ['cap', 'Charge du plan', 'fois la capacité', 'visites dues par mois ÷ visites réalisées par mois'],
    ['channelMin', 'Question posée assez souvent', 'visites par mois', 'en dessous, une baisse est un signal non mesuré'],
    ['detectMin', 'Formulaires qui peuvent signaler un cas grave', '% des visites', ''],
    ['impMin', 'Visites avec partenaire renseigné', '% des visites', 'activités d’au moins minN visites'],
    ['normN', 'Norme observée', 'visites', ''],
    ['normGroupN', 'Groupe compté', 'visites', ''],
    ['normShare', 'Norme à revoir au niveau programme', '% des groupes sous le seuil faible', 'et au moins 2 groupes'],
    ['mask', 'Version diffusable : cases masquées', 'sous', ''],
    ['gpsKm', 'Position GPS proche du site', 'km', '']
  ];
  // Qui décide, et pour quand (à valider)
  const PILOT_ROUTE = {
    grave: { role: 'Protection et conformité', days: 7 },
    secu: { role: 'Sécurité, chefs de bureau', text: () => 'avant les ordres de mission de ' + PI_ML[+currentMonth().slice(5) - 1] },
    act: { role: 'Programme, chefs de bureau', days: 15 },
    ration: { role: 'Programme GD, approvisionnement', days: 15 },
    meal: { role: 'Programme SMP, approvisionnement', days: 30 },
    stock: { role: 'Logistique, programme GD', days: 15 },
    cap: { role: 'Direction, S&E', text: () => 'prochain comité de gestion' },
    mesure: { role: 'S&E, programme', days: 30 }
  };
  // Familles des alertes de niveau 1 : chacune va à un destinataire différent (proposition à valider)
  const PI_FAM = [
    { id: 'grave', label: 'Atteintes graves', to: 'Protection, anti-fraude', codes: ['MODistDiv', 'HHDistDiv', 'HHAsstPayEnt', 'HHAsstSecurity', 'security_incident'] },
    { id: 'ciblage', label: 'Doutes sur le ciblage', to: 'Programme', codes: ['MOFraudConcerns', 'HHFraudConcerns'] },
    { id: 'secu', label: 'Sécurité du site', to: 'Sécurité', codes: ['MOAsstArmed', 'HHAsstSafeLevel'] }
  ];
  const PI_VD = { out: ['✗', 'Hors contrôle', 'bad'], inc: ['?', 'Non concluant', 'na'], watch: ['!', 'À surveiller', 'mid'], ok: ['✓', 'Sous contrôle', 'good'] };
  const PI_ST = ['Ouvert', 'Décidé', 'Clos'];
  const PI_MS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const PI_ML = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const PI_ACT_TXT = { GD: 'la distribution générale', MIARO: 'la prévention du retard de croissance', PECMAM: 'le traitement de la malnutrition aiguë modérée', SMP: 'l’alimentation scolaire', RES: 'la résilience' };
  const PI_NUMW = ['aucune', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six'];
  const PI_CODE = (D.visitKeys || []).map(k => { const s = String(k || ''); return s.slice(s.indexOf('|') + 1, s.lastIndexOf('|')); });
  const PI_NR = DICT.enu.indexOf('(Non renseigné)');
  const PI_NVALID = V.filter(v => v.valid).length;
  const PI_SR = { n: -1, rows: null };
  let PI_CTX = { win: '', ver: '' }, PI_LAST = null;

  const piNum = x => typeof x === 'number' && isFinite(x);
  const piKey = v => v.act + '|' + (PI_CODE[v.i] || '');
  function piSiteKey(v) {
    if (typeof ovSiteOf === 'function') return ovSiteOf(v).key || ('v' + v.i);
    const c = PI_CODE[v.i] || ''; return c && c !== 'NA' ? v.act + '|' + c : 'v' + v.i;
  }
  const piSiteN = vs => new Set(vs.map(piSiteKey)).size;
  function piMonths(a, b) { const o = []; for (let m = a; m <= b && o.length < 60; m = addMonths(m, 1)) o.push(m); return o; }
  function piWin(W) {
    if (!W || !W.length) return '–';
    const a = W[0], b = W[W.length - 1], ma = +a.slice(5) - 1, mb = +b.slice(5) - 1;
    if (a === b) return PI_ML[ma] + ' ' + a.slice(0, 4);
    return a.slice(0, 4) === b.slice(0, 4) ? PI_MS[ma] + '–' + PI_MS[mb] + ' ' + a.slice(0, 4) : PI_MS[ma] + ' ' + a.slice(0, 4) + '–' + PI_MS[mb] + ' ' + b.slice(0, 4);
  }
  function piWinText(W) {
    if (!W || !W.length) return '';
    const a = W[0], b = W[W.length - 1], ma = +a.slice(5) - 1, mb = +b.slice(5) - 1;
    if (a === b) return 'en ' + PI_ML[ma] + ' ' + a.slice(0, 4);
    return 'de ' + PI_ML[ma] + (a.slice(0, 4) !== b.slice(0, 4) ? ' ' + a.slice(0, 4) : '') + ' à ' + PI_ML[mb] + ' ' + b.slice(0, 4);
  }
  function piAddDays(d, n) { const x = new Date(Date.parse(d) + n * 864e5); return x.getUTCFullYear() + '-' + String(x.getUTCMonth() + 1).padStart(2, '0') + '-' + String(x.getUTCDate()).padStart(2, '0'); }
  const piAge = d => d ? Math.max(0, daysBetween(d, localDay())) : null;
  const piDue = r => r.days ? dFrUI(piAddDays(localDay(), r.days)) : r.text();
  const piDueTip = r => r.days ? 'Délai proposé : ' + r.days + ' jours à partir d’aujourd’hui' : 'Échéance proposée';
  const piMode = () => SESSION.piMode === 'diff' ? 'diff' : 'int';
  const piDiff = () => piMode() === 'diff';
  // Version diffusable : une case de moins de 5 n'est jamais imprimée
  function piMask(n) { return piDiff() && piNum(n) && n > 0 && n < PILOT.mask ? 'moins de ' + PILOT.mask : fmt(n); }
  function piNN(n, N) { return piMask(n) + '/' + piMask(N); }
  function piPct(n, N, d) { return N ? pct(n / N * 100, d === undefined ? 0 : d) : '–'; }
  function piCap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function piBtn(text, fn, extra) { const b = el('button', { class: 'btn' + (extra ? ' ' + extra : ''), type: 'button', text }); b.addEventListener('click', fn); return b; }
  function piSites() { if (PI_SR.n !== RENDER_N || !PI_SR.rows) { PI_SR.rows = siteRows(); PI_SR.n = RENDER_N; } return PI_SR.rows; }
  // filtres sans la période (la fenêtre de comparaison est posée par le bandeau)
  function piDimOk(v) {
    return (F.act === 'ALL' || v.act === F.act) && (F.fo < 0 || v.fo === F.fo) && (F.region < 0 || v.region === F.region) && (F.district < 0 || v.district === F.district) &&
      (F.org < 0 || v.org === F.org) && (F.imp < 0 || v.imp === F.imp);
  }
  // famille d'un code d'alerte (les questions « à confirmer » n'entrent dans aucune famille)
  const PI_FC = new Map();
  function piFamOf(act, code) {
    const k = act + '|' + code; if (PI_FC.has(k)) return PI_FC.get(k);
    const tier = typeof ovTier === 'function' ? ovTier(act, code) : (k === 'SMP|HHDistDiv' ? 'c' : null);
    const f = tier === 'c' ? null : (PI_FAM.find(x => x.codes.indexOf(code) >= 0) || {}).id || null;
    PI_FC.set(k, f); return f;
  }
  const PI_VF = new Map();
  function piVF(v) {
    let s = PI_VF.get(v.i); if (s) return s;
    s = new Set(); (v.risks || []).forEach(r => { const f = RISK[r] ? piFamOf(v.act, RISK[r].code) : null; if (f) s.add(f); });
    PI_VF.set(v.i, s); return s;
  }
  const piHasCode = (v, codes) => (v.risks || []).some(r => RISK[r] && codes.indexOf(RISK[r].code) >= 0);
  // l'activité pose-t-elle une question de cette famille ?
  function piHasFam(act, fam) { return Object.keys(D.riskQ || {}).some(k => k.split('|')[0] === act && piFamOf(act, k.slice(act.length + 1)) === fam); }
  function piHasQ(act, code) { return !!(D.riskQ || {})[act + '|' + code]; }
  // couverture : définition unique covCalc (core), appliquée à une fenêtre de mois donnée
  function piCov(act, W) {
    if (typeof covCalc !== 'function' || !W || !W.length) return { planned: 0, visited: 0, p: null, outOfYear: true };
    const m0 = F.m0, m1 = F.m1;
    try { F.m0 = W[0]; F.m1 = W[W.length - 1]; return covCalc({ act }); } finally { F.m0 = m0; F.m1 = m1; }
  }

  // ---------------------------------------------------------------- période de référence
  function piPeriod() {
    const k = SESSION.piK === 1 ? 1 : PILOT.k;
    const dataEnd = (D.period && D.period[1]) || localDay(), Ml = dataEnd.slice(0, 7);
    const last = new Date(Date.UTC(+Ml.slice(0, 4), +Ml.slice(5, 7), 0)).getUTCDate();
    const dmc = typeof plLastComplete === 'function' ? plLastComplete() : (+dataEnd.slice(8, 10) >= last ? Ml : addMonths(Ml, -1));
    const m1 = MONTHS.length ? F.m1 : dmc, E = m1 < dmc ? m1 : dmc;
    const R = piMonths(addMonths(E, -(k - 1)), E), P = piMonths(addMonths(E, -(2 * k - 1)), addMonths(E, -k));
    return { k, E, R, P, dmc, dataEnd, Ml, partial: Ml !== dmc ? Ml : null, m0Cut: MONTHS.length && F.m0 > P[0] };
  }
  function piComplete(M) {
    const by = {}; M.ok.forEach(v => { by[v.month] = (by[v.month] || 0) + 1; });
    const Ml = M.T.Ml, prev = [3, 2, 1].map(i => addMonths(Ml, -i)), avg = mean(prev.map(m => by[m] || 0));
    const n = by[Ml] || 0, ratio = avg ? n / avg * 100 : null;
    return { Ml, n, avg, ratio, prev, by, incomplete: !!M.T.partial || (ratio !== null && ratio < PILOT.complete) };
  }

  // ---------------------------------------------------------------- P1 : une ligne par activité
  function piActRow(a, M) {
    const xa = M.ok.filter(v => v.act === a);
    const scoreOf = W => { const s = new Set(W); const x = xa.filter(v => s.has(v.month) && piNum(v.score)); return { n: x.length, mean: x.length ? mean(x.map(v => v.score)) : null, sites: piSiteN(x), W, x }; };
    let win = { R: M.T.R, P: M.T.P, fallback: false }, r = scoreOf(win.R), p = scoreOf(win.P); const r0 = r;
    if (r.n < PILOT.minN && M.T.k === 3) {
      const R2 = M.T.P, P2 = piMonths(addMonths(R2[0], -3), addMonths(R2[0], -1)), r2 = scoreOf(R2);
      if (r2.n >= PILOT.minN) { win = { R: R2, P: P2, fallback: true }; r = r2; p = scoreOf(P2); }
    }
    const cov = piCov(a, win.R), covP = piCov(a, win.P);
    const ws = new Set(win.R), seenW = new Set(xa.filter(v => ws.has(v.month) && PI_CODE[v.i] && PI_CODE[v.i] !== 'NA').map(piKey)).size;
    const covOk = !cov.outOfYear && cov.planned > 0 && (!seenW || cov.planned >= seenW / 2);
    const covP100 = covOk ? cov.visited / cov.planned * 100 : null;
    const selA = M.sel.filter(v => v.act === a), detect = piHasFam(a, 'grave');
    const graves = selA.filter(v => piVF(v).has('grave'));
    const E = M.T.E, actE = piCov(a, [E]).planned, nE = xa.filter(v => v.month === E).length;
    const six = new Set(piMonths(addMonths(E, -6), addMonths(E, -1))), n6 = xa.filter(v => six.has(v.month)).length;
    const lastD = xa.reduce((m, v) => v.date > m ? v.date : m, '');
    const interrupted = actE >= PILOT.blindSites && nE === 0 && n6 >= PILOT.minN;
    const diff = r.mean !== null && p.mean !== null ? r.mean - p.mean : null;
    const bothN = r.n >= PILOT.minN && p.n >= PILOT.minN;
    const why = []; let verdict;
    const low = r.n >= PILOT.minN && r.mean < THR.mid, drop = bothN && diff <= -PILOT.drop;
    if (low || drop || interrupted) {
      verdict = 'out';
      if (low) why.push('score sous ' + THR.mid);
      if (drop) why.push('baisse de ' + fmt(-diff, 1) + ' points');
      if (interrupted) why.push('aucune visite en ' + PI_ML[+E.slice(5) - 1] + ' pour ' + fmt(actE) + ' sites actifs');
    } else if (r.n < PILOT.minN || (covOk && covP100 < PILOT.covFloor)) {
      verdict = 'inc';
      if (r.n < PILOT.minN) why.push(r.n ? 'moins de ' + PILOT.minN + ' visites' : 'aucune visite');
      if (covOk && covP100 < PILOT.covFloor) why.push('couverture sous ' + PILOT.covFloor + ' %');
    } else if (r.mean < THR.good || (diff !== null && diff <= -PILOT.drop)) {
      verdict = 'watch';
      if (r.mean < THR.good) why.push('sous la cible de ' + THR.good);
      if (diff !== null && diff <= -PILOT.drop) why.push('baisse de ' + fmt(-diff, 1) + ' points sur peu de visites');
    } else { verdict = 'ok'; why.push('au-dessus de la cible'); }
    if (win.fallback) why.push('fenêtre ' + piWin(win.R) + ', la dernière exploitable');
    if (!p.n && r.n) why.push('pas de fenêtre précédente');
    const show = xa.length > 0 || cov.planned > 0;
    return { a, show, xa, r, p, r0, win, diff, bothN, cov, covP, covOk, covP100, seenW, selA, detect, graves, actE, nE, n6, lastD, interrupted, verdict, why, low, drop };
  }

  // ---------------------------------------------------------------- cas (visite × code) et familles
  function piCases(vs) {
    const S = typeof ovCaseStore === 'function' ? ovCaseStore() : ((D.cases && typeof D.cases === 'object') ? D.cases : {});
    const out = [];
    vs.forEach(v => (v.risks || []).forEach(r => {
      const code = RISK[r] && RISK[r].code, f = code ? piFamOf(v.act, code) : null; if (!f) return;
      const key = typeof ovCaseKey === 'function' ? ovCaseKey(v, code) : v.act + '|' + (PI_CODE[v.i] || 'NA') + '|' + (v.date || 'NA') + '|' + code;
      const st = S[key]; out.push({ v, code, fam: f, key, st: st ? (+st.s || 0) : 0 });
    }));
    return out;
  }
  function piFamStats(M, fam) {
    const C = M.cases.filter(c => c.fam === fam.id), byV = new Map();
    C.forEach(c => { let o = byV.get(c.v.i); if (!o) byV.set(c.v.i, o = { v: c.v, st: 0, codes: [] }); o.codes.push(c.code); if (c.st > o.st) o.st = c.st; });
    const vis = Array.from(byV.values()), ages = vis.map(o => piAge(o.v.date));
    const idx = siteIndex(); let rev = 0, revOk = 0, recur = 0; const delays = [];
    vis.forEach(o => { const l = idx.get(piKey(o.v)) || []; const nx = l.find(w => w.date > o.v.date); if (!nx) return; rev++; const d = daysBetween(o.v.date, nx.date); delays.push(d); if (d <= PILOT.revisitDays) revOk++; if (piVF(nx).has(fam.id)) recur++; });
    const inR = M.okR.filter(v => piVF(v).has(fam.id)).length, inP = M.okP.filter(v => piVF(v).has(fam.id)).length;
    const chR = M.okR.filter(v => piHasFam(v.act, fam.id)).length, chP = M.okP.filter(v => piHasFam(v.act, fam.id)).length;
    const perAct = M.acts.map(a => { const N = M.sel.filter(v => v.act === a).length; return { a, n: vis.filter(o => o.v.act === a).length, N, can: piHasFam(a, fam.id) }; }).filter(x => x.N);
    const codes = {}; C.forEach(c => { codes[c.code] = (codes[c.code] || 0) + 1; });
    return { fam, C, vis, n: vis.length, cases: C.length, sites: piSiteN(vis.map(o => o.v)), decl: C.filter(c => /^HH/.test(c.code)).length, obs: C.filter(c => /^MO/.test(c.code)).length,
      noSt: vis.filter(o => !(o.st >= 1)).length, old: ages.filter(x => x > PILOT.oldDays).length, mid: ages.filter(x => x > PILOT.caseAge && x <= PILOT.oldDays).length,
      last: vis.reduce((m, o) => o.v.date > m ? o.v.date : m, ''), rev, revOk, recur, med: delays.length ? median(delays) : null,
      inR, inP, chR, chP, silent: chR / M.T.k < PILOT.channelMin, perAct, codes };
  }
  function piTier1(M) {
    if (typeof ovVT !== 'function') return null;
    let n = 0, cases = 0; const vs = [];
    M.sel.forEach(v => { const t = ovVT(v)[1].length; if (t) { n++; cases += t; vs.push(v); } });
    return { n, cases, sites: piSiteN(vs), N: M.sel.length };
  }

  // ---------------------------------------------------------------- signaux hors S&E
  function piShare(M, acts, codes, W) {
    const ws = new Set(W), x = M.ok.filter(v => acts.indexOf(v.act) >= 0 && ws.has(v.month)), hit = x.filter(v => piHasCode(v, codes));
    return { n: hit.length, N: x.length, hit, x, p: x.length ? hit.length / x.length * 100 : null };
  }
  function piBreak(vs, key) {
    const m = new Map(); vs.forEach(v => { const k = v[key]; m.set(k, (m.get(k) || 0) + 1); });
    return Array.from(m.entries()).map(([k, n]) => ({ k, n, name: (DICT[key] || [])[k] || '(non renseigné)' })).sort((a, b) => b.n - a.n);
  }
  function piMeals(M) {
    const x = M.sel.filter(v => v.act === 'SMP'), vals = [], last = new Map();
    x.forEach(v => {
      const d = v.x && v.x.meal_days20, e = v.x && v.x.enrolled; if (piNum(d)) vals.push(Math.min(20, d));
      if (!piNum(d) || !piNum(e)) return; const k = piSiteKey(v), o = last.get(k);
      if (!o || o.date < v.date) last.set(k, { date: v.date, d: Math.min(20, d), e, v });
    });
    const L = Array.from(last.values()), low = L.filter(o => o.d < PILOT.mealDays);
    return { n: vals.length, mean: vals.length ? mean(vals) : null, schools: L.length, low: low.length, pupils: sum(L.map(o => o.e)), pupilsLow: sum(low.map(o => o.e)), N: x.length };
  }
  function piStock(M) {
    const gd = M.sel.filter(v => v.act === 'GD'), ctl = gd.filter(v => piNum(v.x.stock_lines) && v.x.stock_lines > 0);
    const gap = ctl.filter(v => piNum(v.x.stock_gap_lines) && v.x.stock_gap_lines > 0), by = piBreak(gap, 'imp');
    return { gd: gd.length, ctl: ctl.length, gap: gap.length, gapV: gap, lines: sum(ctl.map(v => v.x.stock_lines)), gapLines: sum(gap.map(v => v.x.stock_gap_lines)), by,
      top: by[0] && by[0].n >= PILOT.stockVisits ? by[0] : null, div: gap.filter(v => piHasCode(v, ['MODistDiv', 'HHDistDiv'])).length };
  }

  // ---------------------------------------------------------------- P5 : couverture, capacité, zones aveugles
  function piBlind(M) {
    const W = piMonths(addMonths(M.T.E, -(PILOT.blindMonths - 1)), M.T.E), ws = new Set(W), z = new Map();
    siteFiltered(piSites()).forEach(s => {
      if (!W.some(m => eligible(s, m))) return;
      const k = s.act + '|' + s.kDis; let o = z.get(k); if (!o) z.set(k, o = { act: s.act, district: s.district, region: s.region, N: 0, seen: 0 });
      o.N++; if (s.hist.some(v => ws.has(v.month))) o.seen++;
    });
    const blind = Array.from(z.values()).filter(o => o.N >= PILOT.blindSites && !o.seen).sort((a, b) => b.N - a.N);
    return { W, blind, sites: sum(blind.map(o => o.N)), zones: z.size };
  }
  function piNever() {
    const l = siteFiltered(piSites()).filter(s => s.actif && s.security < 99);
    return { n: l.filter(s => !s.nVis).length, N: l.length };
  }
  function piLoad(M) {
    let R = null; try { if (typeof rbmCompute === 'function') R = rbmCompute(); } catch (e) { R = null; }
    const capN = M.okR.length / M.T.k;
    if (!R || !R.scored || !R.months) return { na: true, cap: capN };
    const list = siteFiltered(R.scored), months = R.months;
    const dem = typeof plDemand === 'function' ? plDemand(list, months) : { avg: months.length ? sum(months.map(m => sum(list.map(s => eligible(s, m) ? 1 / Math.max(1, s.freq) : 0)))) / months.length : 0, per: [] };
    const byCat = {}; list.forEach(s => { if (months.some(m => eligible(s, m))) byCat[s.cat] = (byCat[s.cat] || 0) + 1; });
    const exec = typeof plValidatedExec === 'function' ? plValidatedExec(list) : [];
    return { demand: dem.avg, per: dem.per || [], cap: capN, ratio: capN ? dem.avg / capN : null, months, byCat, exec, sites: list.length, cfg: R.cfg };
  }

  // ---------------------------------------------------------------- P6 : où agir (normes systémiques ou localisées)
  function piNorms(M) {
    return M.rows.map(row => {
      const a = row.a, it = D.items && D.items[a]; if (!it) return null;
      const W = row.win.R, ws = new Set(W), okIdx = new Map(), gk = (a === 'SMP' || a === 'RES') ? 'district' : 'imp';
      M.ok.forEach(v => { if (v.act === a && ws.has(v.month)) okIdx.set(v.i, v); });
      const res = { a, W, gk, observed: 0, total: it.meta.length, sys: [], loc: [] };
      it.meta.forEach((m, j) => {
        let n = 0, s = 0; const G = new Map();
        (it.vals[j] || []).forEach(p => {
          const v = okIdx.get(p[0]); if (!v) return; n++; s += p[1];
          const g = v[gk]; if (g === null || g === undefined || !(DICT[gk] || [])[g]) return;
          let o = G.get(g); if (!o) G.set(g, o = { n: 0, s: 0 }); o.n++; o.s += p[1];
        });
        if (n < PILOT.normN) return;
        res.observed++;
        const groups = Array.from(G.entries()).filter(e => e[1].n >= PILOT.normGroupN).map(([g, o]) => ({ g, name: DICT[gk][g], n: o.n, p: o.s / o.n }));
        const below = groups.filter(o => o.p < THR.mid), it2 = { m, j, n, p: s / n, groups, below };
        if (it2.p < THR.mid && groups.length >= 2 && below.length / groups.length >= PILOT.normShare / 100) res.sys.push(it2);
        else if (below.length) res.loc.push(it2);
      });
      res.sys.sort((x, y) => x.p - y.p); res.loc.sort((x, y) => (y.below.length - x.below.length) || (x.p - y.p));
      return res;
    }).filter(Boolean);
  }

  // ---------------------------------------------------------------- P7 : organisations de suivi et partenaires
  function piOrgs(M) {
    const x = M.okR, N = x.length, by = new Map(), vk = new Map();
    x.forEach(v => {
      let o = by.get(v.org); if (!o) by.set(v.org, o = { org: v.org, name: DICT.org[v.org] || '(non renseigné)', n: 0, ag: new Set(), gN: 0, gn: 0 });
      o.n++; (v.enus || []).forEach(e => { if (e !== PI_NR) o.ag.add(e); }); vk.set(D.visitKeys[v.i], o);
    });
    const SC = D.subs.cols, iv = SC.indexOf('valid'), idist = SC.indexOf('dist'), ik = SC.indexOf('vkey');
    if (iv >= 0 && idist >= 0 && ik >= 0) D.subs.rows.forEach(r => { if (r[iv] !== 1) return; const o = vk.get(r[ik]); if (!o) return; const d = r[idist]; if (!piNum(d)) return; o.gN++; if (d <= PILOT.gpsKm) o.gn++; });
    const rows = Array.from(by.values()).map(o => Object.assign(o, { internal: /^PAM$/i.test(o.name), agents: o.ag.size, perMonth: o.n / M.T.k, share: N ? o.n / N * 100 : null, perAgent: o.ag.size ? o.n / o.ag.size / M.T.k : null }))
      .sort((a, b) => (a.internal - b.internal) || (b.n - a.n));
    const top = rows.find(o => !o.internal), topP = top ? M.okP.filter(v => v.org === top.org).length : 0;
    const imp = x.filter(v => (DICT.imp[v.imp] || '') !== '').length, pairs = new Map();
    x.forEach(v => { if (!(DICT.imp[v.imp] || '')) return; const k = v.act + '|' + v.imp; pairs.set(k, (pairs.get(k) || 0) + 1); });
    const judge = Array.from(pairs.values()).filter(n => n >= GRADE_SCALES.imp.minN).length;
    return { rows, N, top, topP, NP: M.okP.length, imp, pairs: pairs.size, judge };
  }

  // ---------------------------------------------------------------- P8 : résultats vus par le suivi
  function piResults(M) {
    const ratio = (act, a, b, label) => {
      const x = M.sel.filter(v => v.act === act && piNum(v.x[a]) && piNum(v.x[b]) && v.x[b] > 0);
      return { label, act, n: sum(x.map(v => v.x[a])), N: sum(x.map(v => v.x[b])), visits: x.length };
    };
    const out = [];
    if (M.acts.indexOf('MIARO') >= 0) { out.push(ratio('MIARO', 'att_PBW', 'plan_PBW', 'Femmes enceintes et allaitantes présentes')); out.push(ratio('MIARO', 'att_Under2', 'plan_Under2', 'Enfants de moins de 2 ans présents')); }
    if (M.acts.indexOf('RES') >= 0) out.push(ratio('RES', 'cep_adopters', 'cep_members', 'Champs-écoles : membres qui appliquent les techniques'));
    return out;
  }

  // ---------------------------------------------------------------- P9 : fiabilité
  function piReliability(M) {
    const allR = M.dims.filter(v => v.date && M.Rs.has(v.month)), allSel = fv();
    const cnt = new Map(); M.sel.forEach(v => { const k = piSiteKey(v); cnt.set(k, (cnt.get(k) || 0) + 1); });
    const sc = M.sel.filter(v => piNum(v.score)), smp = M.sel.filter(v => v.act === 'SMP');
    let target = null; try { if (typeof plCfg === 'function') target = plCfg().target; } catch (e) { target = null; }
    return { validR: [M.okR.length, allR.length], validSel: [M.sel.length, allSel.length], imp: [M.sel.filter(v => (DICT.imp[v.imp] || '') !== '').length, M.sel.length],
      twice: [Array.from(cnt.values()).filter(n => n >= 2).length, cnt.size], target, gScore: sc.length ? mean(sc.map(v => v.score)) : null, gN: sc.length,
      anyAlert: [M.sel.filter(v => (v.risks || []).length).length, M.sel.length], smpDiv: [smp.filter(v => piHasCode(v, ['HHDistDiv'])).length, smp.length] };
  }

  // ---------------------------------------------------------------- P2 : sujets qui demandent une décision
  function piSubjects(M) {
    const S = [], f = id => M.fams.find(x => x.fam.id === id);
    // A1 cas graves sans suite
    const g = f('grave'), cib = f('ciblage');
    if (g) {
      const open = g.vis.filter(o => !(o.st >= 1)), late = open.filter(o => piAge(o.v.date) > PILOT.caseAge);
      if (late.length) {
        const openC = cib ? cib.vis.filter(o => !(o.st >= 1)) : [];
        S.push({ key: 'A1|grave', cat: 'A', route: PILOT_ROUTE.grave, sites: g.sites, title: 'Cas graves sans suite',
          fact: fmt(g.n) + ' visites avec atteinte grave sur ' + fmt(g.sites) + ' sites, ' + piNN(g.n - g.noSt, g.n) + ' avec une suite enregistrée, ' + piMask(g.old) + ' de plus de ' + PILOT.oldDays + ' jours' +
            (openC.length ? '. Ciblage : ' + piMask(openC.length) + ' visites sur ' + piMask(cib.sites) + ' sites' : '') + '.',
          decision: 'Nommer un responsable par cas, transmettre au canal confidentiel, clore l’arriéré.',
          rule: 'Au moins une visite avec atteinte grave sans statut enregistré depuis plus de ' + PILOT.caseAge + ' jours.',
          value: [['Visites avec atteinte grave', fmt(g.n) + ' (' + fmt(g.cases) + ' cas, ' + fmt(g.sites) + ' sites)'], ['Sans suite enregistrée', nOf(g.noSt, g.n, 'visites')], ['Sans suite depuis plus de ' + PILOT.caseAge + ' jours', nOf(late.length, g.n, 'visites')], ['Dernière relevée', dFrUI(g.last)]],
          go: ['Ouvrir le registre des cas', piGoCases] });
      }
    }
    // A2 sécurité des équipes
    const sec = piSecSites(M);
    if (sec.unknown.length) S.push({ key: 'A2|securite', cat: 'A', route: PILOT_ROUTE.secu, sites: sec.unknown.length, title: 'Sécurité des équipes',
      fact: fmt(sec.flagged.length) + ' sites actifs en ' + PI_ML[+sec.CM.slice(5) - 1] + ' avec acteurs armés ou trajet peu sûr à la dernière visite, niveau de sécurité non renseigné pour ' + piNN(sec.unknown.length, sec.flagged.length) + '.',
      decision: 'Revue de sécurité avant de signer les ordres de mission.',
      rule: 'Site actif ce mois-ci dont la dernière visite exploitable porte « acteurs armés » ou « trajet peu sûr », et dont la situation sécuritaire n’a jamais été saisie.',
      value: [['Sites signalés à la dernière visite', fmt(sec.flagged.length)], ['Situation sécuritaire non renseignée', nOf(sec.unknown.length, sec.flagged.length, 'sites')]],
      go: ['Voir les priorités du mois', piGoPrio], extra: sec });
    // B activités hors contrôle (+ signaux C attachés)
    const cand = { B: [], C: [], D: [], E: [] };
    const ration = M.acts.indexOf('GD') >= 0 ? piRation(M) : null, rationOn = ration && ration.on;
    const stockOn = M.stock.top && M.acts.indexOf('GD') >= 0;
    M.rows.filter(r => r.verdict === 'out').forEach(r => {
      const parts = [], dec = [];
      if (r.interrupted) { parts.push('aucune visite en ' + PI_ML[+M.T.E.slice(5) - 1] + ' pour ' + fmt(r.actE) + ' sites actifs'); dec.push('confirmer si l’activité a lieu ; si oui, reprendre le suivi'); }
      if (r.r.n) parts.push('conformité ' + fmt(r.r.mean, 1) + ' (' + fmt(r.r.n) + ' visites)' + (r.p.n ? ' contre ' + fmt(r.p.mean, 1) + ' (' + fmt(r.p.n) + ')' : ''));
      if (r.low || r.drop) dec.push('plan d’action avec les partenaires');
      const route = Object.assign({}, PILOT_ROUTE.act, { role: 'Programme ' + ACT[r.a].short + ', chefs de bureau' });
      const sub = { key: 'B|' + r.a, cat: 'B', route, sites: r.cov.planned || r.r.sites, title: ACT[r.a].short + ' hors contrôle', row: r,
        rule: 'Verdict « hors contrôle » dans « Par activité » : ' + r.why.join(', ') + '.', go: ['Ouvrir l’activité', () => piGoAct(r.a)] };
      if (r.a === 'GD' && rationOn) { parts.push('rations réduites dans ' + piNN(ration.R.n, ration.R.N) + ' visites (' + piPct(ration.R.n, ration.R.N) + ') contre ' + piNN(ration.P.n, ration.P.N)); dec.push('vérifier les réductions avec l’approvisionnement avant toute mesure envers un partenaire'); route.role += ', approvisionnement'; sub.ration = ration; }
      if (r.a === 'GD' && stockOn) { parts.push('écart de stock dans ' + piNN(M.stock.gap, M.stock.ctl) + ' visites contrôlées'); sub.stock = true; }
      sub.fact = piCap(parts.join(' ; ')) + '.'; sub.decision = piCap(dec.join(' ; ') || 'décider des suites avec les partenaires') + '.';
      cand.B.push(sub);
    });
    const gdOut = M.rows.some(r => r.a === 'GD' && r.verdict === 'out');
    // C signaux hors S&E
    if (rationOn && !gdOut) cand.C.push({ key: 'C|rations', cat: 'C', route: PILOT_ROUTE.ration, sites: piSiteN(ration.R.hit), title: 'Rations réduites (GD)',
      fact: 'Rations réduites ou remplacées dans ' + piNN(ration.R.n, ration.R.N) + ' visites (' + piPct(ration.R.n, ration.R.N) + ') contre ' + piNN(ration.P.n, ration.P.N) + ' avant.',
      decision: 'Vérifier avec l’approvisionnement avant toute mesure envers un partenaire.', rule: ration.rule, go: ['Ouvrir l’activité', () => piGoAct('GD')] });
    const ml = M.meals;
    if (M.acts.indexOf('SMP') >= 0 && ml.schools >= PILOT.mealSchools && ml.low / ml.schools * 100 >= PILOT.mealShare)
      cand.C.push({ key: 'C|repas', cat: 'C', route: PILOT_ROUTE.meal, sites: ml.low, title: 'Repas scolaires',
        fact: piNN(ml.low, ml.schools) + ' écoles (' + piPct(ml.low, ml.schools, 1) + ') sous ' + PILOT.mealDays + ' jours de repas sur 20 au dernier relevé, soit ' + fmt(ml.pupilsLow) + ' élèves sur ' + fmt(ml.pupils) + '.',
        decision: 'Point avec l’approvisionnement et les partenaires.', rule: 'Au moins ' + PILOT.mealShare + ' % des écoles sous ' + PILOT.mealDays + ' jours de repas sur 20 au dernier relevé, sur au moins ' + PILOT.mealSchools + ' écoles.',
        value: [['Écoles sous le seuil', nOf(ml.low, ml.schools, 'écoles')], ['Élèves concernés', nOf(ml.pupilsLow, ml.pupils, 'élèves')], ['Jours de repas en moyenne', fmt(ml.mean, 1) + ' sur 20 (' + fmt(ml.n) + ' visites)']],
        go: ['Ouvrir l’activité', () => piGoAct('SMP')] });
    if (stockOn && !gdOut) cand.C.push({ key: 'C|stock', cat: 'C', route: PILOT_ROUTE.stock, sites: piSiteN(M.stock.gapV), title: 'Écarts de stock (GD)',
      fact: 'Écart de stock dans ' + piNN(M.stock.gap, M.stock.ctl) + ' visites contrôlées, dont ' + piMask(M.stock.top.n) + ' chez ' + (piDiff() ? 'un même partenaire' : M.stock.top.name) + '.',
      decision: 'Rapprochement des stocks avec le partenaire et la logistique.', rule: 'Écart de stock relevé dans au moins ' + PILOT.stockVisits + ' visites d’un même partenaire.', go: ['Ouvrir l’activité', () => piGoAct('GD')] });
    // D ressources du suivi
    const L = M.load, B = M.blind;
    if ((L.ratio !== null && L.ratio > PILOT.cap) || B.blind.length) {
      const parts = [];
      if (!L.na && L.ratio !== null) parts.push(fmt(L.demand) + ' visites dues par mois contre ' + fmt(L.cap) + ' réalisées en ' + piWin(M.T.R) + ', soit ' + fmt(L.ratio, 1) + ' fois la capacité');
      if (B.blind.length) parts.push(fmt(B.blind.length) + ' zones (' + fmt(B.sites) + ' sites actifs) sans visite depuis ' + PILOT.blindMonths + ' mois');
      cand.D.push({ key: 'D|capacite', cat: 'D', route: PILOT_ROUTE.cap, sites: B.sites || (L.demand || 0), title: 'Capacité de suivi', fact: piCap(parts.join(' ; ')) + '.',
        decision: 'Choisir un levier : fréquences, périmètre ou budget TPM.', rule: 'Charge du plan au-delà de ' + fmt(PILOT.cap, 1) + ' fois la capacité, ou au moins une zone aveugle (' + PILOT.blindSites + ' sites actifs, ' + PILOT.blindMonths + ' mois sans visite).',
        go: ['Capacité et exécution', piGoCap] });
    }
    // E mesure
    const det = M.sel.filter(v => piHasFam(v.act, 'grave')).length, N = M.sel.length;
    if (N && det / N * 100 < PILOT.detectMin) {
      const blindActs = M.acts.filter(a => !piHasFam(a, 'grave') && M.sel.some(v => v.act === a));
      cand.E.push({ key: 'E|detection', cat: 'E', route: PILOT_ROUTE.mesure, sites: N - det, title: 'Cas graves non détectables',
        fact: piNN(N - det, N) + ' visites passent par un formulaire sans question de cas grave (' + blindActs.map(a => ACT[a].short).join(', ') + ').',
        decision: 'Ajouter une question fiable aux formulaires concernés.', rule: 'Moins de ' + PILOT.detectMin + ' % des visites passent par un formulaire capable de signaler un cas grave.', go: ['Méthodologie', () => piGoTab('method')] });
    }
    const noImp = M.acts.map(a => { const x = M.sel.filter(v => v.act === a); return { a, N: x.length, n: x.filter(v => (DICT.imp[v.imp] || '') !== '').length }; }).filter(o => o.N >= PILOT.minN && o.n / o.N * 100 < PILOT.impMin);
    if (noImp.length) cand.E.push({ key: 'E|partenaire', cat: 'E', route: PILOT_ROUTE.mesure, sites: sum(noImp.map(o => o.N - o.n)), title: 'Partenaire non renseigné',
      fact: noImp.map(o => ACT[o.a].short + ' ' + piNN(o.n, o.N)).join(', ') + ' visites avec un partenaire de mise en œuvre.',
      decision: 'Ajouter le partenaire aux formulaires concernés.', rule: 'Moins de ' + PILOT.impMin + ' % des visites avec partenaire, pour une activité d’au moins ' + PILOT.minN + ' visites.', go: ['Qualité des données', () => piGoTab('quality')] });
    const sysN = sum(M.norms.map(n => n.sys.length));
    if (sysN) cand.E.push({ key: 'E|normes', cat: 'E', route: PILOT_ROUTE.mesure, sites: sysN, title: 'Normes en échec presque partout',
      fact: M.norms.filter(n => n.sys.length).map(n => ACT[n.a].short + ' ' + n.sys.length + ' sur ' + n.observed).join(', ') + ' normes observées.',
      decision: 'Revoir ces normes au niveau du programme, après vérification du formulaire.', rule: 'Norme sous ' + THR.mid + ' % au total et sous ' + THR.mid + ' % dans au moins ' + PILOT.normShare + ' % des groupes (au moins 2).', go: ['Où agir', () => piNormsDrawer(M)] });
    Object.keys(cand).forEach(k => cand[k].sort((a, b) => b.sites - a.sites));
    const top = S.slice(); ['B', 'C', 'D', 'E'].forEach(k => { if (cand[k].length) top.push(cand[k][0]); });
    const shown = top.slice(0, PILOT.maxSubjects), shownK = new Set(shown.map(s => s.key));
    const others = top.concat(cand.B.slice(1), cand.C.slice(1), cand.D.slice(1), cand.E.slice(1)).filter(s => !shownK.has(s.key));
    return { top: shown, others };
  }
  function piRation(M) {
    const R = piShare(M, ['GD'], ['MOAsstIKRed'], M.T.R), P = piShare(M, ['GD'], ['MOAsstIKRed'], M.T.P);
    const rise = R.p !== null && P.p !== null && P.N >= PILOT.minN ? R.p - P.p : null;
    const on = R.N >= PILOT.minN && (R.p >= PILOT.supply || (rise !== null && rise >= PILOT.supplyRise));
    return { R, P, rise, on, rule: 'Rations réduites dans au moins ' + PILOT.supply + ' % des visites GD de la fenêtre (au moins ' + PILOT.minN + ' visites), ou hausse de ' + PILOT.supplyRise + ' points ou plus.' };
  }
  function piSecSites(M) {
    const CM = currentMonth(), E = M.T.E, SK = typeof plSecSet === 'function' ? plSecSet() : new Set(), flagged = [], unknown = [];
    siteFiltered(piSites()).forEach(s => {
      if (!eligible(s, CM)) return;
      let lv = null; for (const v of s.hist) { if (v.month <= E && piDimOk(v)) lv = v; }
      if (!lv || !piHasCode(lv, ['MOAsstArmed', 'HHAsstSafeLevel'])) return;
      flagged.push(s); if (!s.security && !SK.has(s.act + '|' + s.code)) unknown.push(s);
    });
    return { CM, flagged, unknown };
  }

  // ---------------------------------------------------------------- décisions de direction (sans donnée personnelle)
  const piStore = () => (D.pilotDecisions && typeof D.pilotDecisions === 'object' && !Array.isArray(D.pilotDecisions)) ? D.pilotDecisions : {};
  function piClean(t) { return String(t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\S+@\S+/g, '[retiré]').replace(/\+?\d[\d .-]{7,}\d/g, '[retiré]').replace(/\s+/g, ' ').trim().slice(0, 200); }
  function piSetDecision(key, s, ref, after) {
    requireAdmin(() => {
      if (!D.pilotDecisions || typeof D.pilotDecisions !== 'object' || Array.isArray(D.pilotDecisions)) D.pilotDecisions = {};
      const st = Math.max(0, Math.min(PI_ST.length - 1, Math.round(+s) || 0)), c = piClean(ref), at = localDay();
      if (!st && !c) delete D.pilotDecisions[key]; else D.pilotDecisions[key] = { s: st, ref: c, at };
      if (!Array.isArray(D.pilotLog)) D.pilotLog = [];
      D.pilotLog.push({ k: String(key).slice(0, 40), s: st, at }); while (D.pilotLog.length > 500) D.pilotLog.shift();
      if (CUR !== D) { CUR.pilotDecisions = D.pilotDecisions; CUR.pilotLog = D.pilotLog; }
      SESSION.dirty = true; render(); if (after) after();
    });
  }
  function piStatusText(key) { const o = piStore()[key]; if (!o) return PI_ST[0]; return PI_ST[o.s || 0] + (o.s ? ' le ' + dFrUI(o.at) : ''); }

  // ---------------------------------------------------------------- notes figées et révisions
  function piFiltKey() { return JSON.stringify([F.act, F.fo < 0 ? null : DICT.fo[F.fo], F.region < 0 ? null : DICT.region[F.region], F.district < 0 ? null : DICT.district[F.district], F.org < 0 ? null : DICT.org[F.org], F.imp < 0 ? null : DICT.imp[F.imp]]); }
  const piSnaps = () => Array.isArray(D.pilotSnapshots) ? D.pilotSnapshots : [];
  function piSnapFor(M) { const fk = piFiltKey(); return piSnaps().filter(s => s && s.E === M.T.E && s.k === M.T.k && s.fk === fk).slice(-1)[0] || null; }
  function piRevision(M, row) {
    const sn = M.snap; if (!sn) return null; const o = (sn.rows || []).find(x => x.a === row.a); if (!o) return null;
    const s = row.r.mean !== null ? Math.round(row.r.mean * 10) / 10 : null;
    if (o.n === row.r.n && (o.s === s || (o.s !== null && s !== null && Math.abs(o.s - s) <= 0.05))) return null;
    return 'Révisé depuis la note du ' + dFrUI(sn.at) + ' : ' + (o.s === null ? '–' : fmt(o.s, 1)) + ' (' + fmt(o.n) + ' visites) devient ' + (s === null ? '–' : fmt(s, 1)) + ' (' + fmt(row.r.n) + ')';
  }
  function piFreeze(M) {
    requireAdmin(() => {
      const snaps = piSnaps().slice();
      snaps.push({ at: localDay(), E: M.T.E, k: M.T.k, fk: piFiltKey(), filters: filtersActiveText(), hash: SESSION.piHash ? SESSION.piHash.h.slice(0, 12) : '',
        rows: M.rows.map(r => ({ a: r.a, v: r.verdict, s: r.r.mean !== null ? Math.round(r.r.mean * 10) / 10 : null, n: r.r.n, cov: r.covOk ? [r.cov.visited, r.cov.planned] : null })),
        subjects: M.subjects.top.map(s => s.key) });
      while (snaps.length > 24) snaps.shift();
      D.pilotSnapshots = snaps; if (CUR !== D) CUR.pilotSnapshots = snaps;
      SESSION.dirty = true; render();
    });
  }

  // ---------------------------------------------------------------- version des données (empreinte)
  function piHashKey() { return [D.generated, (D.visits || []).length, PI_NVALID, typeof plVer === 'function' ? plVer() : (D.planFull.rows || []).length, JSON.stringify(D.updated || {})].join('|'); }
  function piHash(cb) {
    const key = piHashKey(); if (SESSION.piHash && SESSION.piHash.key === key) { cb(SESSION.piHash.h); return; }
    setTimeout(() => {
      let s; try { s = JSON.stringify([D.period, D.updated, D.visits, D.visitKeys, D.planFull.rows]); } catch (e) { cb(null); return; }
      const done = h => { SESSION.piHash = { key, h }; cb(h); };
      try {
        if (window.crypto && crypto.subtle && typeof crypto.subtle.digest === 'function') {
          crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(b => done(Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('')), () => done(sha256hex(s)));
          return;
        }
      } catch (e) { /* repli en JavaScript pur */ }
      done(sha256hex(s));
    }, 40);
  }
  const piHashTxt = h => h ? h.slice(0, 12).replace(/(.{4})(?=.)/g, '$1 ') : 'en calcul';
  const piHashNow = () => SESSION.piHash && SESSION.piHash.key === piHashKey() ? SESSION.piHash.h : null;

  // ---------------------------------------------------------------- navigation vers le détail
  function piGoTab(tab, prep) { closeDrawer(); if (prep) prep(); TAB = tab; buildTabs(); render(); window.scrollTo(0, 0); }
  function piGoAct(a) { piGoTab('activity', () => { ACT_SEL = a; }); }
  function piGoCap() { piGoTab('rbm', () => { if (typeof PLS !== 'undefined' && PLS) { PLS.sub = SESSION.plSub = 'cap'; PLS.page = 0; } }); }
  function piGoPrio() { piGoTab('rbm', () => { if (typeof PLS !== 'undefined' && PLS) { PLS.sub = SESSION.plSub = 'prio'; PLS.page = 0; } }); }
  function piGoCases() { if (typeof ovCasesDrawer === 'function') ovCasesDrawer(); else piGoTab('overview'); }

  // ---------------------------------------------------------------- éléments d'affichage
  function piSec(title, info, kids, opt) {
    opt = opt || {};
    const h = el('div', { class: 'pi-h' }, [el('h2', { text: title }), info ? infoBtn(info) : null, opt.right ? el('div', { class: 'pi-hr' }, opt.right) : null]);
    return el('section', { class: 'pi-sec' + (opt.cls ? ' ' + opt.cls : '') }, [h].concat((kids || []).filter(Boolean)));
  }
  function piTable(cols, rows, opt) {
    opt = opt || {};
    const t = el('table', { class: 'pi-t' + (opt.cls ? ' ' + opt.cls : '') });
    t.appendChild(el('thead', null, el('tr', null, cols.map(c => { const th = el('th', { scope: 'col', class: c.num ? 'num' : '', text: c.t }); if (c.tip) bindTip(th, () => c.tip); return th; }))));
    const tb = el('tbody');
    rows.forEach(r => {
      const tr = el('tr');
      if (opt.onRow) {
        tr.classList.add('pi-clk'); tr.tabIndex = 0; tr.setAttribute('aria-label', (opt.label ? opt.label(r) : 'Ligne') + ' : ouvrir le détail');
        tr.addEventListener('click', ev => { if (ev.target.closest('button,a,input,select,textarea')) return; opt.onRow(r); });
        tr.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target === tr) opt.onRow(r); });
      }
      cols.forEach(c => {
        const v = c.f(r), td = el('td', { class: (c.num ? 'num' : '') + (c.cls ? ' ' + c.cls : '') }, v === null || v === undefined || v === '' ? '–' : typeof v === 'object' ? v : String(v));
        if (c.tipf) { const tx = c.tipf(r); if (tx) bindTip(td, () => tx); }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return el('div', { class: 'pi-tw' }, t);
  }
  function piVerdict(k) { const d = PI_VD[k]; return el('span', { class: 'pi-vd pi-' + d[2], text: d[0] + ' ' + d[1] }); }
  function piDrawer(title, sub, o) {
    return openDrawer(title, sub, [
      o.value ? xsec('Valeur et base', [kvList(o.value)]) : null,
      o.ref ? xsec('Référence', [typeof o.ref === 'string' ? el('p', { text: o.ref }) : kvList(o.ref)]) : null
    ].concat(o.extra || [], [
      o.formula ? xsec('Calcul', [formulaBox(o.formula)]) : null,
      o.limits && o.limits.filter(Boolean).length ? xsec('Limites', o.limits.filter(Boolean).map(t => limitBox(t, 'warn'))) : null,
      o.links && o.links.length ? el('div', { class: 'pi-links' }, o.links.filter(Boolean).map(l => piBtn(l[0], l[1]))) : null,
      xsec('Fenêtre et filtres', [kvList([['Fenêtre', PI_CTX.win], ['Filtres', filtersActiveText()], ['Données', PI_CTX.ver]])])
    ]));
  }
  function piTile(l, v, s, open, k) {
    const t = el('div', { class: 'pi-tile' + (k ? ' pi-k-' + k : '') }, [el('div', { class: 'pi-tl', text: l }), el('div', { class: 'pi-tv', text: v }), s ? el('div', { class: 'pi-ts', text: s }) : null]);
    if (open) { t.classList.add('pi-clk'); t.tabIndex = 0; t.setAttribute('role', 'button'); t.setAttribute('aria-label', l + ' : ouvrir le détail'); t.addEventListener('click', open); t.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } }); }
    return t;
  }
  const piRef = () => [['Cible', THR.good + ' (provisoire)'], ['Seuil faible', THR.mid + ' (provisoire)'], ['Baisse significative', PILOT.drop + ' points, avec au moins ' + PILOT.minN + ' visites de chaque côté'], ['Effectif minimal', PILOT.minN + ' visites']];

  // ---------------------------------------------------------------- tiroirs
  function piRulesDrawer() {
    const rows = PILOT_DEF.map(d => [d[1], fmt(PILOT[d[0]], d[0] === 'cap' ? 1 : 0) + ' ' + d[2] + (d[3] ? ' (' + d[3].replace('minN', PILOT.minN) + ')' : '')]);
    const routes = [['Cas graves', 'grave'], ['Sécurité des équipes', 'secu'], ['Activité hors contrôle', 'act'], ['Rations réduites', 'ration'], ['Repas scolaires', 'meal'], ['Écarts de stock', 'stock'], ['Capacité de suivi', 'cap'], ['Mesure (formulaires, données)', 'mesure']]
      .map(([l, k]) => [l, PILOT_ROUTE[k].role + ', ' + (PILOT_ROUTE[k].days ? PILOT_ROUTE[k].days + ' jours' : PILOT_ROUTE[k].text())]);
    piDrawer('Règles et seuils provisoires', 'À valider par la direction ; une seule table, lue par toute la page', {
      value: [['Cible de conformité', THR.good + ' (table commune des seuils)'], ['Seuil faible', THR.mid + ' (table commune des seuils)']].concat(rows),
      extra: [xsec('Verdict par activité (première règle vraie)', [el('ol', { class: 'pi-ol' }, [
        el('li', { text: '✗ Hors contrôle : score sous ' + THR.mid + ' sur au moins ' + PILOT.minN + ' visites, ou baisse d’au moins ' + PILOT.drop + ' points avec ' + PILOT.minN + ' visites de chaque côté, ou suivi interrompu (au moins ' + PILOT.blindSites + ' sites actifs, aucune visite le mois de fin, au moins ' + PILOT.minN + ' visites les 6 mois d’avant).' }),
        el('li', { text: '? Non concluant : moins de ' + PILOT.minN + ' visites, ou moins de ' + PILOT.covFloor + ' % des sites actifs vus.' }),
        el('li', { text: '! À surveiller : score sous ' + THR.good + ', ou baisse d’au moins ' + PILOT.drop + ' points sur peu de visites.' }),
        el('li', { text: '✓ Sous contrôle sinon.' })])]),
        xsec('Qui décide, et pour quand', [kvList(routes)]),
        xsec('Familles de cas graves', [kvList(PI_FAM.map(f => [f.label + ' → ' + f.to, f.codes.join(', ')]))]),
        xsec('Ordre des sujets', [el('p', { text: 'Personnes d’abord (cas graves, sécurité), puis une activité hors contrôle, un signal hors S&E, les ressources du suivi et la mesure. Au plus ' + PILOT.maxSubjects + ' sujets ; le reste va dans « Autres sujets ».' })])],
      limits: ['Valeurs proposées par l’unité S&E, non validées.', 'Un sujet disparaît dès que sa condition n’est plus vraie.']
    });
  }
  function piBannerDrawer(M) {
    const C = M.complete, ms = [3, 2, 1, 0].map(i => addMonths(C.Ml, -i));
    piDrawer('Période et version', 'Comment la fenêtre de référence est choisie', {
      value: [['Mois de fin', piWin([M.T.E])], ['Fenêtre', piWin(M.T.R)], ['Comparée à', piWin(M.T.P)], ['Dernier mois complet', piWin([M.T.dmc])], ['Données', 'du ' + dFrUI((D.period || [])[0]) + ' au ' + dFrUI(M.T.dataEnd)]],
      extra: [xsec('Visites par mois (filtres sans la période)', [piTable([{ t: 'Mois', f: m => piWin([m]) }, { t: 'Visites exploitables', num: 1, f: m => fmt(C.by[m] || 0) }, { t: 'Part d’un mois habituel', num: 1, f: m => { const p3 = [3, 2, 1].map(i => C.by[addMonths(m, -i)] || 0), av = mean(p3); return av ? pct((C.by[m] || 0) / av * 100, 0) : '–'; } }], ms)]),
        xsec('Empreinte des données', [el('p', { text: 'Empreinte SHA-256 des visites, des clés de visite, du plan de suivi, de la période et des dates d’extraction (' + piHashTxt(piHashNow()) + '). Deux impressions qui portent la même empreinte viennent des mêmes données. Elle ne dit pas qui a produit le fichier. Les statuts des cas et des décisions n’entrent pas dans l’empreinte.' })])],
      formula: 'Mois de fin = le plus tôt entre le mois choisi « Au mois » et le dernier mois complet. Un mois est complet si les données vont jusqu’à son dernier jour. Fenêtre = les ' + M.T.k + ' mois qui finissent au mois de fin ; comparée aux ' + M.T.k + ' mois d’avant.',
      limits: [C.incomplete ? piCap(piWin([C.Ml])) + ' : ' + fmt(C.n) + ' visites, ' + (C.ratio === null ? '–' : pct(C.ratio, 0)) + ' d’un mois habituel. Affiché ailleurs, il n’entre ni dans les tendances ni dans les déclencheurs.' : null,
        M.T.m0Cut ? 'Le filtre « Du mois » ne raccourcit pas les fenêtres de comparaison ; il borne seulement les cas graves, les signaux cumulés et les résultats.' : null,
        (F.org >= 0 || F.imp >= 0) ? 'Les filtres TPM et partenaire ne s’appliquent pas au plan des sites : les couvertures portent sur tous les sites de la zone.' : null],
      links: [['Données et mises à jour', () => piGoTab('data')]]
    });
  }
  function piActDrawer(M, r) {
    const xa = r.xa, ms = piMonths(addMonths(M.T.E, -5), M.T.E);
    const mrow = ms.map(m => { const x = xa.filter(v => v.month === m && piNum(v.score)); return { m, n: x.length, s: x.length ? mean(x.map(v => v.score)) : null }; });
    piDrawer(ACT[r.a].label, PI_VD[r.verdict][0] + ' ' + PI_VD[r.verdict][1] + ' : ' + r.why.join(', '), {
      value: [['Conformité ' + piWin(r.win.R), r.r.n ? fmt(r.r.mean, 1) + ' / 100 sur ' + fmt(r.r.n) + ' visites (' + fmt(r.r.sites) + ' sites)' : 'aucune visite notée'],
        ['Conformité ' + piWin(r.win.P), r.p.n ? fmt(r.p.mean, 1) + ' / 100 sur ' + fmt(r.p.n) + ' visites' : 'aucune visite notée'],
        ['Écart', r.diff === null ? '–' : (r.diff > 0 ? '+' : '') + fmt(r.diff, 1) + ' points' + (r.bothN ? '' : ' (indicatif : moins de ' + PILOT.minN + ' visites d’un côté)')],
        r.win.fallback ? ['Fenêtre de référence ' + piWin(M.T.R), fmt(r.r0.n) + ' visites seulement : la dernière fenêtre exploitable est utilisée'] : null,
        ['Sites actifs vus', r.covOk ? nOf(r.cov.visited, r.cov.planned, 'sites') : 'non calculable (le plan liste ' + fmt(r.cov.planned) + ' sites actifs pour ' + fmt(r.seenW) + ' sites visités)'],
        ['Atteintes graves (période choisie)', r.detect ? nOf(r.graves.length, r.selA.length, 'visites') : 'non détectables : le formulaire n’a pas de question de ce type'],
        ['Dernière visite exploitable', dFrUI(r.lastD)]],
      ref: piRef(),
      extra: [xsec('Six derniers mois', [piTable([{ t: 'Mois', f: o => piWin([o.m]) }, { t: 'Visites notées', num: 1, f: o => fmt(o.n) }, { t: 'Score moyen', num: 1, f: o => o.n ? (nStatus(o.n) === 'na' ? 'non calculé' : fmt(o.s, 1) + (nStatus(o.n) === 'low' ? ' (indicatif)' : '')) : '–' }], mrow)])],
      formula: 'Conformité = moyenne du score des visites exploitables de la fenêtre (filtres sans la période). Sites vus = sites actifs du plan au moins un mois de la fenêtre ayant reçu une visite exploitable (même calcul que la couverture du plan). Verdict : première règle vraie, voir « Règles et seuils ».',
      limits: ['Les formulaires diffèrent d’une activité à l’autre : ne comparez jamais deux activités entre elles.', 'La grille d’activation du plan est presque partout à « Oui » : le nombre de sites actifs est sans doute surestimé.', M.complete.incomplete ? 'Le mois incomplet (' + piWin([M.complete.Ml]) + ') est exclu.' : null, piRevision(M, r)],
      links: [['Ouvrir l’activité', () => piGoAct(r.a)], ['Capacité et exécution', piGoCap], r.detect ? ['Registre des cas', piGoCases] : null]
    });
  }
  function piSubjectDrawer(M, s) {
    const o = piStore()[s.key] || { s: 0, ref: '' }, log = (Array.isArray(D.pilotLog) ? D.pilotLog : []).filter(x => x && x.k === s.key).slice(-10).reverse();
    const sel = el('select', { 'aria-label': 'Statut du sujet' }); PI_ST.forEach((t, i) => { const op = el('option', { value: String(i), text: t }); if ((o.s || 0) === i) op.selected = true; sel.appendChild(op); });
    const cm = el('input', { type: 'text', placeholder: 'Référence courte, sans nom (200 caractères)', 'aria-label': 'Commentaire de la décision' }); cm.value = o.ref || ''; cm.maxLength = 200;
    const save = piBtn('Enregistrer', () => piSetDecision(s.key, +sel.value, cm.value, () => { const m2 = PI_LAST; const s2 = m2 && m2.subjects.top.concat(m2.subjects.others).find(x => x.key === s.key); if (s2) piSubjectDrawer(m2, s2); }), 'on');
    const stBox = piDiff() ? null : xsec('Décision', [el('div', { class: 'pi-dec' }, [sel, cm, save]), limitBox('Pas de nom ni de donnée personnelle : indiquez seulement la décision, le canal ou une référence. Modification en mode administrateur.', 'warn'),
      log.length ? kvList(log.map(x => [dFrUI(x.at), PI_ST[x.s] || '–'])) : el('p', { class: 'muted', text: 'Aucun changement de statut enregistré.' })]);
    piDrawer(s.title, 'Sujet proposé à la décision', {
      value: (s.value || [['Constat', s.fact]]).concat([['Décision demandée', s.decision], ['Qui', s.route.role], ['Échéance proposée', piDue(s.route)]]),
      ref: [['Règle', s.rule], ['Seuils', 'provisoires, voir « Règles et seuils »']],
      extra: [stBox],
      limits: ['Un signalement est une observation non vérifiée.', 'Le sujet disparaît dès que sa condition n’est plus vraie ; son statut reste enregistré.'],
      links: [s.go, ['Règles et seuils', piRulesDrawer]]
    });
  }
  function piOthersDrawer(M) {
    openDrawer('Autres sujets', fmt(M.subjects.others.length) + ' sujet(s) au-delà des ' + PILOT.maxSubjects + ' premiers', [
      M.subjects.others.length ? piSubjectsTable(M, M.subjects.others) : el('p', { class: 'muted', text: 'Aucun autre sujet.' })]);
  }
  function piFamDrawer(M, st) {
    const f = st.fam, codes = Object.keys(st.codes);
    piDrawer(f.label, 'Destinataire : ' + f.to, {
      value: [['Visites', fmt(st.n) + ' (' + fmt(st.cases) + ' cas, ' + fmt(st.sites) + ' sites)'], ['Déclarés par des bénéficiaires', fmt(st.decl) + ' cas'], ['Observés par l’agent', fmt(st.obs) + ' cas'],
        ['Sans suite enregistrée', nOf(st.noSt, st.n, 'visites')], ['Ancienneté', fmt(st.old) + ' de plus de ' + PILOT.oldDays + ' jours, ' + fmt(st.mid) + ' entre ' + (PILOT.caseAge + 1) + ' et ' + PILOT.oldDays + ' jours'], ['Dernière relevée', dFrUI(st.last)],
        ['Site revu ensuite', nOf(st.rev, st.n, 'visites') + ', dont ' + fmt(st.revOk) + ' dans les ' + PILOT.revisitDays + ' jours' + (st.med !== null ? ' (délai médian ' + fmt(st.med, 1) + ' jours)' : '')], ['Même alerte au passage suivant', nOf(st.recur, st.rev, 'revisites')],
        ['Tendance', fmt(st.inR) + ' visites en ' + piWin(M.T.R) + ' contre ' + fmt(st.inP) + ' en ' + piWin(M.T.P) + (st.silent ? ' ; question posée dans ' + fmt(st.chR) + ' visites seulement : signal non mesuré' : '')]],
      extra: [xsec('Par activité', [piTable([{ t: 'Activité', f: x => ACT[x.a].short }, { t: 'Visites concernées', num: 1, f: x => x.can ? piNN(x.n, x.N) : 'non détectable' }], st.perAct)]),
        xsec('Questions comptées', [kvList(f.codes.map(c => { const k = Object.keys(D.riskQ || {}).filter(q => q.split('|')[1] === c && piFamOf(q.split('|')[0], c) === f.id); const q = k.length ? D.riskQ[k[0]] : null; return q ? [c + ' (' + k.map(x => ACT[x.split('|')[0]].short).join(', ') + ')', '« ' + q.q + ' » = ' + q.ans + ' · ' + fmt(st.codes[c] || 0) + ' cas'] : null; }).filter(Boolean))]),
        codes.length ? null : el('p', { class: 'muted', text: 'Aucun cas dans les filtres.' })],
      formula: 'Visites exploitables de la période choisie portant au moins un code de la famille. Revisite = première visite exploitable du même site à une date postérieure. Statut = registre des cas.',
      limits: ['Un signalement est une observation non vérifiée.', 'Les familles et les niveaux sont une proposition à valider par la protection, la sécurité et la conformité.', st.silent ? 'Une baisse sans question posée assez souvent n’est pas une amélioration.' : null],
      links: [['Ouvrir le registre des cas', piGoCases], ['Vue d’ensemble', () => piGoTab('overview')]]
    });
  }
  function piSignalDrawer(M, sg) {
    const ms = piMonths(addMonths(M.T.E, -5), M.T.E);
    const per = sg.monthly ? ms.map(m => { const x = sg.monthly(m); return { m, n: x.n, N: x.N }; }) : null;
    piDrawer(sg.label, 'Destinataire : ' + sg.to, {
      value: sg.value, extra: [per ? xsec('Six derniers mois', [piTable([{ t: 'Mois', f: o => piWin([o.m]) }, { t: 'Visites', num: 1, f: o => o.N ? piNN(o.n, o.N) + ' (' + piPct(o.n, o.N) + ')' : '–' }], per)]) : null].concat(sg.extra || []),
      formula: sg.formula, limits: sg.limits, links: sg.links
    });
  }
  function piNormsDrawer(M) {
    const box = M.norms.map(n => xsec(ACT[n.a].short + ', ' + piWin(n.W) + ' (' + n.observed + ' normes observées)', [
      n.sys.length ? el('p', { class: 'pi-b', text: 'Au niveau du programme' }) : null,
      n.sys.length ? piTable([{ t: 'Norme', f: q => q.m.label }, { t: '% conforme', num: 1, f: q => pct(q.p, 1) }, { t: 'Groupes sous ' + THR.mid, num: 1, f: q => q.below.length + '/' + q.groups.length }], n.sys.slice(0, 12), { onRow: q => piNormOne(M, n, q), label: q => q.m.label }) : null,
      n.loc.length ? el('p', { class: 'pi-b', text: 'Avec certains ' + (n.gk === 'imp' ? 'partenaires' : 'districts') }) : null,
      n.loc.length ? piTable([{ t: 'Norme', f: q => q.m.label }, { t: '% conforme', num: 1, f: q => pct(q.p, 1) }, { t: n.gk === 'imp' ? 'Partenaires sous ' + THR.mid : 'Districts sous ' + THR.mid, f: q => piDiff() ? q.below.length + '/' + q.groups.length : q.below.map(g => g.name).join(', ') }], n.loc.slice(0, 12), { onRow: q => piNormOne(M, n, q), label: q => q.m.label }) : null,
      !n.sys.length && !n.loc.length ? el('p', { class: 'muted', text: n.observed ? 'Aucune norme sous ' + THR.mid + '.' : 'Pas assez de visites pour juger (au moins ' + PILOT.normN + ' par norme).' }) : null]));
    piDrawer('Où agir', 'Normes en échec presque partout : décision de programme. Normes en échec chez une partie des acteurs : action ciblée.', {
      extra: box, formula: '% conforme = moyenne des visites (partiel = ½), comme l’onglet Activités. Norme observée : au moins ' + PILOT.normN + ' visites. Groupe = partenaire de mise en œuvre (GD, MIARO, PECMAM) ou district (SMP, Résilience), compté à partir de ' + PILOT.normGroupN + ' visites. Programme : sous ' + THR.mid + ' % au total et dans au moins ' + PILOT.normShare + ' % des groupes (2 au moins).',
      limits: ['Une norme sous 5 % partout vient souvent d’une question mal posée : vérifier le formulaire avant de changer la norme.', 'Les visites sans partenaire renseigné ne comptent dans aucun groupe.'],
      links: [['Activités', () => piGoTab('activity')]]
    });
  }
  function piNormOne(M, n, q) {
    const x = M.ok.filter(v => v.act === n.a && n.W.indexOf(v.month) >= 0);
    if (typeof ovNormDrawer === 'function') {
      const ix = new Set(x.map(v => v.i)), vals = (D.items[n.a].vals[q.j] || []).filter(p => ix.has(p[0]));
      ovNormDrawer(n.a, { m: q.m, p: q.p, n: vals.length, c: vals.filter(p => p[1] >= 99.95).length, nc: vals.filter(p => p[1] <= 0.05).length, part: vals.filter(p => p[1] > 0.05 && p[1] < 99.95).length }, x);
    }
  }

  // ---------------------------------------------------------------- blocs de la page
  function piSubjectsTable(M, list) {
    const cols = [{ t: 'N°', f: s => String(list.indexOf(s) + 1), cls: 'pi-no' }, { t: 'Sujet', f: s => el('b', { text: s.title }) }, { t: 'Constat', f: s => s.fact, cls: 'pi-fact' },
      { t: 'Décision demandée', f: s => s.decision }, { t: 'Qui', f: s => s.route.role }, { t: 'Échéance', f: s => piDue(s.route), tipf: s => piDueTip(s.route) }];
    if (!piDiff()) cols.push({ t: 'Statut', f: s => { const o = piStore()[s.key]; return el('span', { class: 'pi-st pi-st' + (o ? o.s || 0 : 0), text: piStatusText(s.key) }); }, tipf: s => { const o = piStore()[s.key]; return o && o.ref ? o.ref : 'Statut saisi en mode administrateur (tiroir du sujet)'; } });
    return piTable(cols, list, { onRow: s => piSubjectDrawer(M, s), label: s => s.title, cls: 'pi-subj' });
  }
  function piBlockHead(M, main) {
    const C = M.complete;
    const seg = (cur, opts, on) => el('div', { class: 'pi-seg', role: 'group' }, opts.map(([v, l]) => { const b = piBtn(l, () => on(v), cur === v ? 'on' : ''); b.setAttribute('aria-pressed', String(cur === v)); return b; }));
    // Impression et versions (interne / diffusable, figer) sont déléguées au Rapport (modèles « Note de direction » / « Synthèse ») ; ici, cockpit vivant seulement.
    const toReport = () => { if (Array.isArray(TABS) && !TABS.some(t => t[0] === 'report')) return; piGoTab('report'); };
    const tools = el('div', { class: 'pi-tools pi-screen' }, [
      seg(M.T.k, [[3, '3 mois'], [1, '1 mois']], v => { SESSION.piK = v; render(); }),
      piBtn('Règles et seuils', piRulesDrawer),
      piBtn('Imprimer / exporter → Rapport ›', toReport, 'pi-golink')]);
    const head = el('header', { class: 'pi-head' }, [
      el('div', { class: 'pi-ht' }, [el('h1', { text: 'Cockpit de pilotage — ' + piWin(M.T.R) })]),
      el('p', { class: 'pi-meta' }, 'Comparé à ' + piWin(M.T.P) + '. Données du ' + dFrUI((D.period || [])[0]) + ' au ' + dFrUI(M.T.dataEnd) + '.'),
      el('p', { class: 'pi-meta pi-print' }, 'Filtres : ' + filtersActiveText() + '.'),
      C.incomplete ? el('p', { class: 'pi-warn' }, piCap(piWin([C.Ml])) + ' incomplet : ' + fmt(C.n) + ' visites, ' + (C.ratio === null ? '–' : pct(C.ratio, 0)) + ' d’un mois habituel, hors tendances.') : null,
      (!piDiff() && typeof secIsDefault === 'function' && secIsDefault()) ? el('p', { class: 'pi-warn pi-screen' }, ['Mot de passe initial encore actif. ', infoBtn('Le mot de passe protège les boutons, pas les données : quiconque reçoit le fichier lit tout. Changez-le dans « Données et mises à jour ».')]) : null,
      tools]);
    const info = infoBtn('Fenêtre = les ' + M.T.k + ' derniers mois complets avant le mois de fin choisi, comparés aux ' + M.T.k + ' mois d’avant. Le filtre « Du mois » ne raccourcit pas ces fenêtres. Clic sur le bandeau : détail.');
    head.querySelector('.pi-ht').appendChild(info);
    head.classList.add('pi-clk'); head.addEventListener('click', ev => { if (ev.target.closest('button,select,input,.pi-tools')) return; piBannerDrawer(M); });
    main.appendChild(head);
  }
  function piBlockActs(M) {
    const ok = M.okR.filter(v => piNum(v.score)), okP = M.okP.filter(v => piNum(v.score));
    const mix = 'Pas de score toutes activités confondues : il vaudrait ' + fmt(mean(ok.map(v => v.score)), 1) + ' (' + fmt(ok.length) + ' visites) contre ' + fmt(mean(okP.map(v => v.score)), 1) + ' (' + fmt(okP.length) + ') et suit surtout le poids de chaque activité dans les visites, pas la performance. Cible ' + THR.good + ' et seuil ' + THR.mid + ' provisoires. Ne comparez pas deux activités entre elles : les formulaires diffèrent.';
    const t = piTable([
      { t: 'Activité', f: r => el('b', { text: ACT[r.a].short }) },
      { t: 'Statut', f: r => piVerdict(r.verdict) },
      { t: 'Score', num: 1, f: r => r.r.n ? fmt(r.r.mean, 1) : '–', tipf: r => r.r.n ? fmt(r.r.n) + ' visites, ' + fmt(r.r.sites) + ' sites, ' + piWin(r.win.R) : 'Aucune visite notée' },
      { t: 'Avant', num: 1, f: r => r.p.n ? fmt(r.p.mean, 1) : '–', tipf: r => r.p.n ? fmt(r.p.n) + ' visites, ' + piWin(r.win.P) : 'Aucune visite notée' },
      { t: 'Écart', num: 1, f: r => r.diff === null ? '–' : el('span', { class: r.bothN && Math.abs(r.diff) >= PILOT.drop ? (r.diff < 0 ? 'bad' : 'good') : '', text: (r.diff > 0 ? '+' : r.diff < 0 ? '−' : '') + fmt(Math.abs(r.diff), 1) }), tipf: r => r.bothN ? 'Significatif à partir de ' + PILOT.drop + ' points' : 'Indicatif : moins de ' + PILOT.minN + ' visites d’un côté' },
      { t: 'Sites vus', num: 1, f: r => r.covOk ? piNN(r.cov.visited, r.cov.planned) : 'n.c.', tipf: r => r.covOk ? pct(r.covP100, 1) + ' des sites actifs vus en ' + piWin(r.win.R) : 'Non calculable : le plan liste ' + fmt(r.cov.planned) + ' sites actifs pour ' + fmt(r.seenW) + ' sites visités' },
      { t: 'Graves', num: 1, f: r => r.detect ? piMask(r.graves.length) : 'n.d.', tipf: r => r.detect ? 'Visites avec atteinte grave, période choisie' : 'Non détectables : le formulaire n’a pas de question de ce type' },
      { t: 'Pourquoi', f: r => { const rv = piRevision(M, r); return el('span', null, [piCap(r.why.join(', ')), rv ? el('span', { class: 'pi-rev', text: ' révisé' }) : null]); }, tipf: r => piRevision(M, r), cls: 'pi-why' }
    ], M.rows, { onRow: r => piActDrawer(M, r), label: r => ACT[r.a].short, cls: 'pi-acts' });
    return piSec('Par activité', mix, [M.rows.length ? t : el('p', { class: 'muted', text: 'Aucune activité dans les filtres.' })]);
  }
  function piBlockSubjects(M) {
    const n = M.subjects.others.length;
    return piSec('À décider ce mois', 'Sujets créés par des règles à partir des données du jour : personnes d’abord, puis activité, signaux hors S&E, ressources et mesure. Qui et échéance sont des propositions à valider.', [
      M.subjects.top.length ? piSubjectsTable(M, M.subjects.top) : el('p', { class: 'muted', text: 'Aucun sujet ne remplit une règle de décision.' })],
      { right: n ? [piBtn('Autres sujets (' + n + ')', () => piOthersDrawer(M), 'sm pi-screen')] : null });
  }
  function piBlockCases(M) {
    const T1 = M.tier1, det = M.sel.filter(v => piHasFam(v.act, 'grave')).length;
    const info = 'Alertes de niveau 1 rangées en trois familles, chacune pour un destinataire. Sans nom ni récit. ' + (T1 ? 'Niveau 1 au total : ' + fmt(T1.n) + ' visites (' + fmt(T1.cases) + ' cas, ' + fmt(T1.sites) + ' sites), même chiffre que la Vue d’ensemble. ' : '') +
      'Formulaires qui peuvent signaler une atteinte grave : ' + nOf(det, M.sel.length, 'visites') + '. Familles proposées, à valider.';
    const t = piTable([
      { t: 'Famille', f: s => el('b', { text: s.fam.label }) }, { t: 'Pour', f: s => s.fam.to },
      { t: 'Visites', num: 1, f: s => piMask(s.n) }, { t: 'Sites', num: 1, f: s => piMask(s.sites) },
      { t: 'Sans suite', num: 1, f: s => el('span', { class: s.noSt ? 'bad' : '', text: piMask(s.noSt) }), tipf: s => 'Visites sans statut enregistré dans le registre des cas' },
      { t: '> ' + PILOT.oldDays + ' j', num: 1, f: s => piMask(s.old) },
      { t: 'Revus', num: 1, f: s => piNN(s.rev, s.n), tipf: s => fmt(s.revOk) + ' revus dans les ' + PILOT.revisitDays + ' jours' + (s.med !== null ? ', délai médian ' + fmt(s.med, 1) + ' jours' : '') + ' ; même alerte au passage suivant : ' + fmt(s.recur) },
      { t: 'Tendance', num: 1, f: s => s.silent ? 'non mesuré' : piMask(s.inR) + ' / ' + piMask(s.inP), tipf: s => fmt(s.inR) + ' visites en ' + piWin(M.T.R) + ', ' + fmt(s.inP) + ' en ' + piWin(M.T.P) + (s.silent ? '. Question posée dans ' + fmt(s.chR) + ' visites seulement : une baisse n’est pas une amélioration.' : '') }
    ], M.fams, { onRow: s => piFamDrawer(M, s), label: s => s.fam.label });
    return piSec('Cas graves', info, [t, T1 ? el('p', { class: 'pi-cap' }, 'Niveau 1 : ' + piMask(T1.n) + ' visites, ' + piMask(T1.sites) + ' sites') : null]);
  }
  function piSignals(M) {
    const S = [], has = a => M.acts.indexOf(a) >= 0, R = M.T.R, P = M.T.P, mono = (acts, codes) => m => piShare(M, acts, codes, [m]);
    if (has('GD')) {
      const ra = piRation(M), byImp = piBreak(ra.R.hit, 'imp'), byOrg = piBreak(ra.R.hit, 'org');
      S.push({ label: 'Rations réduites (GD)', to: 'Approvisionnement', R: ra.R, P: ra.P, k: ra.on ? 'bad' : '', monthly: mono(['GD'], ['MOAsstIKRed']),
        value: [[piWin(R), nOf(ra.R.n, ra.R.N, 'visites GD')], [piWin(P), nOf(ra.P.n, ra.P.N, 'visites GD')]],
        extra: piDiff() ? [] : [xsec('Par partenaire et par organisation de suivi (' + piWin(R) + ')', [kvList(byImp.slice(0, 6).map(o => ['Partenaire ' + o.name, fmt(o.n) + ' sur ' + fmt(ra.R.x.filter(v => v.imp === o.k).length) + ' visites'])
          .concat(byOrg.slice(0, 4).map(o => ['Relevées par ' + o.name, fmt(o.n) + ' sur ' + fmt(ra.R.x.filter(v => v.org === o.k).length) + ' visites'])))])],
        formula: 'Visites GD exploitables où « rations réduites ou remplacées » a été relevé ÷ visites GD de la fenêtre.', limits: ['À vérifier par un autre observateur et sur le stock avant toute mesure envers un partenaire.'], links: [['Activité GD', () => piGoAct('GD')]] });
    }
    if (has('SMP')) {
      const ml = M.meals, sm = D.smpMeals || {};
      S.push({ label: 'Écoles sous ' + PILOT.mealDays + ' jours de repas (SMP)', to: 'Approvisionnement', R: { n: ml.low, N: ml.schools }, P: null, unit: 'écoles', k: ml.schools && ml.low / ml.schools * 100 >= PILOT.mealShare ? 'bad' : '',
        value: [['Écoles sous le seuil au dernier relevé', nOf(ml.low, ml.schools, 'écoles')], ['Élèves de ces écoles', nOf(ml.pupilsLow, ml.pupils, 'élèves')], ['Jours de repas en moyenne', fmt(ml.mean, 1) + ' sur 20 (' + fmt(ml.n) + ' visites)'],
          sm.n_all ? ['Ruptures, retards ou catastrophes cités', nOf(sm.supply || 0, sm.n_all, 'fiches') + ', toute la période (ne suit pas les filtres)'] : null],
        formula: 'Pour chaque école, dernier relevé de la période où les jours de repas (sur 20) et l’effectif sont renseignés.', limits: ['Le dénominateur de 20 jours compte aussi des jours sans école (week-ends, jours fériés) : l’indicateur sous-estime la continuité.'], links: [['Activité SMP', () => piGoAct('SMP')]] });
    }
    if (has('PECMAM')) {
      [['MOWhDisposeEvidSpill', 'Traces de déversement en magasin (PECMAM)'], ['MOWHBadCommod', 'Vivres endommagés (PECMAM)']].forEach(([c, l]) => {
        if (!piHasQ('PECMAM', c)) return; const a = piShare(M, ['PECMAM'], [c], R), b = piShare(M, ['PECMAM'], [c], P);
        S.push({ label: l, to: 'Logistique', R: a, P: b, k: a.p > THR.rHigh ? 'bad' : '', monthly: mono(['PECMAM'], [c]), value: [[piWin(R), nOf(a.n, a.N, 'visites')], [piWin(P), nOf(b.n, b.N, 'visites')]],
          formula: 'Visites PECMAM exploitables où l’alerte a été relevée ÷ visites PECMAM de la fenêtre.', links: [['Activité PECMAM', () => piGoAct('PECMAM')]] });
      });
    }
    if (has('GD')) {
      const st = M.stock;
      S.push({ label: 'Écarts de stock (GD)', to: 'Logistique', R: { n: st.gap, N: st.ctl }, P: null, unit: 'visites contrôlées', k: st.top ? 'bad' : '',
        value: [['Visites avec écart', nOf(st.gap, st.ctl, 'visites contrôlées')], ['Lignes produits en écart', nOf(st.gapLines, st.lines, 'lignes')], ['Rapprochement de stock fait', nOf(st.ctl, st.gd, 'visites GD')], ['Écart et indice de détournement', fmt(st.div) + ' visite(s)']],
        extra: piDiff() ? [] : [xsec('Par partenaire', [kvList(st.by.slice(0, 6).map(o => [o.name, fmt(o.n) + ' visite(s) avec écart']))])],
        formula: 'Période choisie. Écart = au moins une ligne produit dont le stock compté s’écarte du stock théorique (seuil fixé à l’import).', links: [['Activité GD', () => piGoAct('GD')]] });
    }
    const armActs = ['GD', 'MIARO'].filter(a => has(a) && piHasQ(a, 'MOAsstArmed'));
    if (armActs.length) {
      const a = piShare(M, armActs, ['MOAsstArmed'], R), b = piShare(M, armActs, ['MOAsstArmed'], P), silent = a.N / M.T.k < PILOT.channelMin, key = piDiff() ? 'region' : 'district';
      S.push({ label: 'Acteurs armés (' + armActs.map(x => ACT[x].short).join(', ') + ')', to: 'Sécurité', R: a, P: b, silent, k: a.n ? 'bad' : '', monthly: mono(armActs, ['MOAsstArmed']),
        value: [[piWin(R), nOf(a.n, a.N, 'visites')], [piWin(P), nOf(b.n, b.N, 'visites')], ['Question posée', fmt(a.N) + ' visites en ' + piWin(R) + (silent ? ' : moins de ' + PILOT.channelMin + ' par mois, signal non mesuré' : '')]],
        extra: [xsec(key === 'region' ? 'Par région (fenêtre)' : 'Par district (fenêtre)', [kvList(piBreak(a.hit, key).slice(0, 6).map(o => [o.name, piMask(o.n)]))])],
        formula: 'Visites exploitables où la présence d’acteurs armés a été relevée ÷ visites des activités qui posent la question.', limits: ['Un silence n’est pas une amélioration : regardez le nombre de visites où la question a été posée.'], links: [['Carte', () => piGoTab('map')]] });
    }
    return S;
  }
  function piBlockSignals(M) {
    const S = piSignals(M);
    const cell = (x, unit) => x && x.N ? el('span', null, [piNN(x.n, x.N), el('span', { class: 'pi-mut', text: ' ' + piPct(x.n, x.N) })]) : '–';
    const t = piTable([{ t: 'Signal', f: s => el('span', { class: s.k === 'bad' ? 'pi-flag' : '', text: s.label }) }, { t: 'Pour', f: s => s.to },
      { t: piWin(M.T.R), num: 1, f: s => s.silent ? 'non mesuré' : cell(s.R), tipf: s => s.unit ? 'Période choisie, en ' + s.unit : 'Visites de la fenêtre' }, { t: 'Avant', num: 1, f: s => s.P ? cell(s.P) : '–' }],
      S, { onRow: s => piSignalDrawer(M, s), label: s => s.label });
    return piSec('Signaux', 'À transmettre hors S&E, chacun à son destinataire. Un signalement reste à vérifier. Version diffusable : aucun nom de partenaire.', [S.length ? t : el('p', { class: 'muted', text: 'Aucun signal pour cette sélection.' })]);
  }
  function piBlockCoverage(M) {
    const c = M.cov, L = M.load, B = M.blind, nv = M.never;
    const covOk = c.R && !c.R.outOfYear && c.R.planned;
    const tiles = [
      piTile('Sites vus', covOk ? pct(c.R.visited / c.R.planned * 100, 1) : 'n.c.', covOk ? piNN(c.R.visited, c.R.planned) + (c.P && c.P.planned ? ', avant ' + pct(c.P.visited / c.P.planned * 100, 1) : '') : 'hors année du plan', () => piCovDrawer(M)),
      piTile('Jamais visités', fmt(nv.n), 'sur ' + fmt(nv.N) + ' sites actifs', () => piCovDrawer(M)),
      piTile('Zones aveugles', fmt(B.blind.length), B.blind.length ? fmt(B.sites) + ' sites actifs, ' + PILOT.blindMonths + ' mois' : 'aucune', () => piBlindDrawer(M), B.blind.length ? 'bad' : ''),
      piTile('Charge du plan', L.na || L.ratio === null ? 'n.c.' : '× ' + fmt(L.ratio, 1), L.na ? 'planification indisponible' : fmt(L.demand) + ' dues, ' + fmt(L.cap) + ' faites par mois', () => piLoadDrawer(M), !L.na && L.ratio > PILOT.cap ? 'bad' : '')];
    return piSec('Couverture et capacité', covDefinition(), [el('div', { class: 'pi-tiles' }, tiles)]);
  }
  function piCovDrawer(M) {
    const rows = M.rows.map(r => ({ a: r.a, R: piCov(r.a, M.T.R), P: piCov(r.a, M.T.P), r }));
    const effort = M.acts.map(a => ({ a, n: M.okR.filter(v => v.act === a).length })).filter(o => o.n);
    piDrawer('Sites vus', 'Sites actifs du plan ayant reçu au moins une visite exploitable', {
      value: [[piWin(M.T.R), M.cov.R.planned ? nOf(M.cov.R.visited, M.cov.R.planned, 'sites actifs') : '–'], [piWin(M.T.P), M.cov.P.planned ? nOf(M.cov.P.visited, M.cov.P.planned, 'sites actifs') : '–'], ['Jamais visités', nOf(M.never.n, M.never.N, 'sites actifs')]],
      extra: [xsec('Par activité', [piTable([{ t: 'Activité', f: o => ACT[o.a].short }, { t: piWin(M.T.R), num: 1, f: o => o.r.covOk || o.R.planned ? piNN(o.R.visited, o.R.planned) : '–' }, { t: 'Avant', num: 1, f: o => o.P.planned ? piNN(o.P.visited, o.P.planned) : '–' }], rows)]),
        xsec('Effort de la fenêtre', [kvList(effort.map(o => [ACT[o.a].short, nOf(o.n, M.okR.length, 'visites')]))])],
      formula: covDefinition(), limits: ['La grille d’activation est presque partout à « Oui » : le nombre de sites actifs est sans doute surestimé.', (F.org >= 0 || F.imp >= 0) ? 'Avec un filtre TPM ou partenaire, seules ses visites comptent mais tous les sites de la zone restent au dénominateur.' : null],
      links: [['Planification', () => piGoTab('rbm')], ['Carte', () => piGoTab('map')], ['Sites', () => piGoTab('sites')]]
    });
  }
  function piBlindDrawer(M) {
    const B = M.blind;
    piDrawer('Zones aveugles', 'Activité × district : au moins ' + PILOT.blindSites + ' sites actifs et aucune visite en ' + piWin(B.W), {
      value: [['Zones aveugles', fmt(B.blind.length) + ' sur ' + fmt(B.zones) + ' zones'], ['Sites actifs concernés', fmt(B.sites)]],
      extra: [B.blind.length ? piTable([{ t: 'Activité', f: o => ACT[o.act].short }, { t: piDiff() ? 'Région' : 'District', f: o => piDiff() ? o.region : o.district }, { t: 'Sites actifs', num: 1, f: o => fmt(o.N) }], B.blind.slice(0, 30)) : null],
      formula: 'Pour chaque couple activité × district du plan : sites actifs au moins un mois de ' + piWin(B.W) + ', et sites qui ont reçu une visite exploitable sur ces mois (toute organisation).',
      limits: ['Une zone peut être aveugle parce que l’activité n’a pas eu lieu (vacances, fin de distribution) : à confirmer avec le programme.'], links: [['Planification', () => piGoTab('rbm')]]
    });
  }
  function piLoadDrawer(M) {
    const L = M.load;
    if (L.na) { piDrawer('Charge du plan', '', { limits: ['Le moteur de planification n’est pas disponible dans ce fichier.'] }); return; }
    const exec = L.exec || [], planned = sum(exec.map(o => o.N)), done = sum(exec.map(o => o.n));
    piDrawer('Charge du plan', 'Visites dues selon le risque des sites, contre visites réellement faites', {
      value: [['Visites dues par mois', fmt(L.demand, 1) + ' (moyenne de ' + piWin(L.months) + ', ' + fmt(L.sites) + ' sites)'], ['Visites faites par mois', fmt(L.cap, 1) + ' (' + piWin(M.T.R) + ')'], ['Rapport', L.ratio === null ? '–' : fmt(L.ratio, 2) + ' fois la capacité'],
        ['Sites par niveau de risque', ['high', 'med', 'low', 'never'].filter(k => L.byCat[k]).map(k => ({ high: 'élevé', med: 'moyen', low: 'faible', never: 'jamais visité' })[k] + ' ' + fmt(L.byCat[k])).join(', ')],
        ['Exécution du plan validé', exec.length ? nOf(done, planned, 'visites prévues') : 'non calculable : aucun plan mensuel validé']],
      formula: 'Visites dues = somme, sur les sites actifs, de 1 ÷ intervalle de visite du niveau de risque (paramètres de la planification), en moyenne sur l’horizon du plan.',
      limits: ['Les sites jamais visités ont tous le même risque théorique : la demande dépend de ce choix. À lire comme un ordre de grandeur, avec des scénarios.'], links: [['Capacité et exécution', piGoCap]]
    });
  }
  function piBlockWhere(M) {
    const t = piTable([{ t: 'Activité', f: n => el('b', { text: ACT[n.a].short }) }, { t: 'Fenêtre', f: n => piWin(n.W) }, { t: 'Normes observées', num: 1, f: n => n.observed ? n.observed + '/' + n.total : 'n.c.' },
      { t: 'Programme', num: 1, f: n => n.observed ? fmt(n.sys.length) : '–', tipf: n => n.sys.slice(0, 3).map(q => q.m.label + ' : ' + pct(q.p, 0)).join('\n') || null },
      { t: 'Ciblé', num: 1, f: n => n.observed ? fmt(n.loc.length) : '–', tipf: n => n.loc.slice(0, 3).map(q => q.m.label + ' : ' + q.below.length + ' groupe(s) sous ' + THR.mid).join('\n') || null }],
    M.norms, { onRow: () => piNormsDrawer(M), label: n => ACT[n.a].short });
    return piSec('Où agir', 'Programme : norme sous ' + THR.mid + ' % presque partout, la règle elle-même est en cause. Ciblé : norme sous ' + THR.mid + ' % chez une partie des partenaires (ou des districts pour SMP et Résilience), action corrective avec eux.', [t], { cls: 'pi-noprint' });
  }
  function piBlockPartners(M) {
    if (piDiff()) return null;
    const O = M.orgs;
    const t = piTable([{ t: 'Organisation', f: o => o.internal ? 'Suivi interne (PAM)' : o.name }, { t: 'Visites/mois', num: 1, f: o => fmt(o.perMonth, 1) }, { t: 'Part', num: 1, f: o => pct(o.share, 1), tipf: o => fmt(o.n) + ' visites sur ' + fmt(O.N) },
      { t: 'Agents', num: 1, f: o => fmt(o.agents) }, { t: 'Visites/agent/mois', num: 1, f: o => o.perAgent === null ? '–' : fmt(o.perAgent, 1) },
      { t: 'GPS ≤ ' + PILOT.gpsKm + ' km', num: 1, f: o => o.gN ? pct(o.gn / o.gN * 100, 0) : '–', tipf: o => o.gN ? fmt(o.gn) + ' fiches sur ' + fmt(o.gN) + ' avec une position' : 'Aucune position' }], O.rows, { onRow: () => piGoTab('partners'), label: o => o.name });
    const cap = O.top ? O.top.name + ' assure ' + pct(O.top.share, 1) + ' du suivi' + (O.NP ? ', contre ' + pct(O.topP / O.NP * 100, 1) + ' en ' + piWin(M.T.P) : '') + '. Partenaire renseigné : ' + piNN(O.imp, O.N) + ' visites.' : '';
    return piSec('Partenaires', 'Organisations de suivi sur ' + piWin(M.T.R) + ', sans note composite. Partenaires de mise en œuvre jugeables (au moins ' + GRADE_SCALES.imp.minN + ' visites) : ' + O.judge + ' couples sur ' + O.pairs + '. Coût et objectifs des contrats : dans MEMS.', [t, cap ? el('p', { class: 'pi-cap', text: cap }) : null], { cls: 'pi-noprint' });
  }
  function piBlockResults(M) {
    const R = piResults(M), ml = M.meals;
    const items = R.map(o => ({ l: o.label, v: nStatus(o.visits) === 'na' ? 'non calculé' : piPct(o.n, o.N, 1) + (nStatus(o.visits) === 'low' ? ' (indicatif)' : ''), tip: fmt(o.n) + ' sur ' + fmt(o.N) + ', ' + fmt(o.visits) + ' visites' }));
    if (M.acts.indexOf('SMP') >= 0 && ml.n) items.push({ l: 'Repas scolaires servis', v: fmt(ml.mean, 1) + ' jours sur 20', tip: fmt(ml.n) + ' visites' });
    if (!items.length) return null;
    const list = el('dl', { class: 'pi-res' }, [].concat.apply([], items.map(o => { const dd = el('dd', { text: o.v }); bindTip(dd, () => o.tip); return [el('dt', { text: o.l }), dd]; })));
    return piSec('Résultats', 'Ce que les visites montrent des résultats, sur la période choisie. Tonnage et bénéficiaires : MEMS, Distribution d’urgence. Taux de guérison PECMAM : rapports nutrition. Moins de ' + SMALL_N.min + ' visites : non calculé ; moins de ' + SMALL_N.low + ' : indicatif.', [list], { cls: 'pi-noprint' });
  }
  function piBlockReliability(M) {
    const Rl = M.rel;
    const li = (t, tip) => { const n = el('li', { text: t }); if (tip) bindTip(n, () => tip); return n; };
    const yes = el('ul', { class: 'pi-ul' }, [
      li('Visites exploitables ' + piNN(Rl.validR[0], Rl.validR[1]) + ' sur la fenêtre', 'Sur la période choisie : ' + nOf(Rl.validSel[0], Rl.validSel[1], 'visites')),
      li('Partenaire renseigné ' + piNN(Rl.imp[0], Rl.imp[1])), li('Sites vus deux fois ou plus ' + piNN(Rl.twice[0], Rl.twice[1])),
      li('Cible ' + THR.good + ' ici' + (Rl.target && Rl.target !== THR.good ? ', ' + Rl.target + ' en planification' : '') + ', provisoire')]);
    const no = el('ul', { class: 'pi-ul' }, [
      li('Score toutes activités (' + fmt(Rl.gScore, 1) + ')', 'Moyenne de ' + fmt(Rl.gN) + ' visites : elle suit le mélange des activités.'),
      li('Part des visites avec au moins une alerte (' + piPct(Rl.anyAlert[0], Rl.anyAlert[1]) + ')', 'Mélange un sac endommagé et des acteurs armés : lisez les familles.'),
      li('Couverture cumulée depuis janvier'),
      M.acts.indexOf('SMP') >= 0 ? li('Détournement SMP (' + piNN(Rl.smpDiv[0], Rl.smpDiv[1]) + ')', 'Question sans libellé français dans le formulaire SMP : non fiable.') : null]);
    return piSec('Fiabilité', 'Citable : conformité par activité, cas graves, couverture de la fenêtre, visites par organisation, toujours avec n.', [el('div', { class: 'pi-two' }, [el('div', null, [el('p', { class: 'pi-b', text: 'Citable, avec n' }), yes]), el('div', null, [el('p', { class: 'pi-b', text: 'À ne pas citer' }), no])])], { cls: 'pi-rel' });
  }
  function piTexts(M) {
    const R = M.T.R, rows = M.rows.filter(r => r.r.n), tot = M.okR.length, out = M.rows.filter(r => r.verdict === 'out');
    const nAct = rows.length, nw = n => PI_NUMW[n] || fmt(n);
    const conf = rows.map(r => fmt(r.r.mean, 1) + ' pour ' + PI_ACT_TXT[r.a] + ' (' + fmt(r.r.n) + ' visites' + (r.win.fallback ? ', ' + piWin(r.win.R) : '') + ')' + (r.bothN && r.diff <= -PILOT.drop ? ', en baisse de ' + fmt(-r.diff, 1) + ' points' : r.bothN && r.diff >= PILOT.drop ? ', en hausse de ' + fmt(r.diff, 1) + ' points' : ''));
    const ra = M.acts.indexOf('GD') >= 0 ? piRation(M) : null;
    const b = [piCap(piWinText(R)) + ', ' + fmt(tot) + ' visites exploitables ont été réalisées sur ' + nw(nAct) + ' activité' + (nAct > 1 ? 's' : '') + '.'];
    if (conf.length) b.push('La conformité atteint ' + conf.join(', ') + '.');
    if (ra && ra.on) b.push('Des réductions de rations ont été relevées dans ' + piNN(ra.R.n, ra.R.N) + ' visites de distribution générale ; une vérification avec l’approvisionnement est proposée.');
    if (M.meals.schools >= PILOT.mealSchools && M.meals.low) b.push(piNN(M.meals.low, M.meals.schools) + ' écoles ont servi moins de ' + PILOT.mealDays + ' jours de repas sur 20 au dernier relevé.');
    const g = M.fams.find(x => x.fam.id === 'grave'); if (g && g.n) b.push(piMask(g.n) + ' visites ont relevé une atteinte grave ; chaque cas suit le canal de signalement prévu.');
    const c = [piCap(piWinText(R)) + ' : ' + fmt(tot) + ' visites exploitables.'];
    if (out.length) c.push('Hors contrôle : ' + out.map(r => ACT[r.a].short + ' (' + r.why.join(', ') + ')').join(' ; ') + '.');
    const watch = M.rows.filter(r => r.verdict === 'watch'); if (watch.length) c.push('À surveiller : ' + watch.map(r => ACT[r.a].short).join(', ') + '.');
    if (M.subjects.top.length) c.push('Décisions demandées : ' + M.subjects.top.map((s, i) => (i + 1) + ') ' + s.title.toLowerCase() + ', ' + s.route.role.toLowerCase() + ', ' + piDue(s.route)).join(' ; ') + '.');
    if (M.cov.R && M.cov.R.planned) c.push('Sites actifs vus : ' + pct(M.cov.R.visited / M.cov.R.planned * 100, 1) + ' (' + piNN(M.cov.R.visited, M.cov.R.planned) + ').');
    return { comite: c.join(' '), bailleur: b.join(' ') };
  }
  function piBlockTexts(M) {
    const T = piTexts(M);
    const box = (lab, txt) => {
      const ta = el('textarea', { class: 'pi-ta', 'aria-label': lab }); ta.value = txt; ta.rows = 5;
      const msg = el('span', { class: 'pi-mut' });
      const cp = piBtn('Copier', () => {
        const done = ok => { msg.textContent = ok ? 'Copié.' : 'Copie impossible : sélectionnez le texte.'; };
        try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(ta.value).then(() => done(true), () => { ta.select(); done(false); }); return; } } catch (e) { /* repli */ }
        ta.select(); done(false);
      }, 'sm');
      return el('div', { class: 'pi-txt' }, [el('p', { class: 'pi-b', text: lab }), ta, el('div', { class: 'pi-links' }, [cp, msg])]);
    };
    const d = el('details', { class: 'pi-sec pi-noprint pi-det' }, [el('summary', null, [el('span', { class: 'pi-sum', text: 'Texte pour le comité' }), infoBtn('Recalculé à chaque mise à jour, modifiable ici, jamais enregistré. La version bailleur ne nomme ni partenaire ni personne.')]),
      box('Comité de gestion', T.comite), box('Bailleur', T.bailleur)]);
    return d;
  }
  function piBlockSnaps(M) {
    const L = piSnaps();
    if (!L.length) return null;
    const d = el('details', { class: 'pi-sec pi-noprint pi-det' }, [el('summary', null, [el('span', { class: 'pi-sum', text: 'Notes figées (' + L.length + ')' }), infoBtn('Instantané des chiffres présentés en comité. Si une nouvelle extraction change un chiffre d’une note figée sur la même fenêtre et les mêmes filtres, la ligne porte « révisé ».')]),
      piTable([{ t: 'Date', f: s => dFrUI(s.at) }, { t: 'Fenêtre', f: s => s.E ? piWin(piMonths(addMonths(s.E, -((s.k || 3) - 1)), s.E)) : '–' }, { t: 'Filtres', f: s => s.filters || '–' }, { t: 'Version', f: s => s.hash ? piHashTxt(s.hash) : '–' },
        { t: 'Activités', f: s => (s.rows || []).map(r => (ACT[r.a] ? ACT[r.a].short : r.a) + ' ' + (r.s === null ? '–' : fmt(r.s, 1))).join(', ') }], L.slice().reverse())]);
    return d;
  }
  function piFooter(M) {
    const nAg = DICT.enu.filter((e, i) => e && i !== PI_NR).length, PF = D.planFull, il = PF.cols.indexOf('lat');
    const nGps = il >= 0 ? PF.rows.filter(r => piNum(r[il])).length : 0, vGps = V.filter(v => piNum(v.lat)).length;
    const txt = piDiff() ? 'Version diffusable : agrégée, sans nom de personne, de site ni de partenaire ; cases de moins de ' + PILOT.mask + ' masquées. Version des données '
      : 'Usage interne. Ne transférez pas le fichier : il contient en clair ' + fmt(nAg) + ' noms d’agents, les positions GPS de ' + fmt(nGps) + ' sites et de ' + fmt(vGps) + ' visites, et les alertes par site et par date. Version ';
    return el('footer', { class: 'pi-foot' }, [txt, el('span', { class: 'pi-hashv', text: piHashTxt(piHashNow()) }), '.']);
  }

  // ---------------------------------------------------------------- impression A4 (une page)
  function piFitDom() {
    const doc = document.querySelector('.pi-doc'); if (!doc) return;
    document.body.classList.add('pi-measure');
    const mm = 96 / 25.4, maxH = 277 * mm; let f = PILOT.fontMax;
    doc.classList.remove('pi-tight'); doc.style.fontSize = f + 'pt';
    while (doc.scrollHeight > maxH && f > PILOT.fontMin) { f = Math.round((f - 0.25) * 100) / 100; doc.style.fontSize = f + 'pt'; }
    if (doc.scrollHeight > maxH) doc.classList.add('pi-tight');
    doc.dataset.fit = String(f);
    document.body.classList.remove('pi-measure');
  }
  function piUnfit() { const doc = document.querySelector('.pi-doc'); if (doc) { doc.style.fontSize = ''; doc.classList.remove('pi-tight'); } }
  function piPrint(mode) {
    const prev = piMode(); SESSION.piMode = mode; render(); piFitDom();
    let done = false;
    const back = () => { if (done) return; done = true; window.removeEventListener('afterprint', back); SESSION.piMode = prev; if (TAB === 'pilot') render(); };
    window.addEventListener('afterprint', back);
    window.print();
  }
  if (!SESSION.piPrintHook) {   // impression par le navigateur (Ctrl+P) : même ajustement, sans changer le mode
    SESSION.piPrintHook = true;
    window.addEventListener('beforeprint', () => { if (document.body.classList.contains('is-pilot')) { const d = document.querySelector('.pi-doc'); if (d && !d.style.fontSize) { piFitDom(); d.dataset.auto = '1'; } } });
    window.addEventListener('afterprint', () => { const d = document.querySelector('.pi-doc'); if (d && d.dataset.auto) { delete d.dataset.auto; piUnfit(); } });
  }

  // ---------------------------------------------------------------- calcul et rendu
  function piModel() {
    const T = piPeriod(), Rs = new Set(T.R), Ps = new Set(T.P);
    const dims = V.filter(piDimOk), ok = dims.filter(v => v.valid && v.date);
    const M = { T, Rs, Ps, dims, ok, okR: ok.filter(v => Rs.has(v.month)), okP: ok.filter(v => Ps.has(v.month)), sel: fv(v => v.valid), acts: F.act === 'ALL' ? ACTS.slice() : [F.act] };
    M.complete = piComplete(M);
    M.cases = piCases(M.sel);
    M.rows = M.acts.map(a => piActRow(a, M)).filter(r => r.show);
    M.snap = piSnapFor(M);
    M.fams = PI_FAM.map(f => piFamStats(M, f));
    M.tier1 = piTier1(M);
    M.meals = piMeals(M); M.stock = piStock(M);
    M.blind = piBlind(M); M.never = piNever(); M.load = piLoad(M);
    M.cov = { R: piCov(F.act, T.R), P: piCov(F.act, T.P) };
    M.norms = piNorms(M);
    M.orgs = piOrgs(M);
    M.rel = piReliability(M);
    M.subjects = piSubjects(M);
    return M;
  }
  function piRender(main) {
    if (!MONTHS.length) { main.appendChild(el('p', { class: 'note warn', text: 'Aucune visite datée dans les données.' })); return; }
    const t0 = performance.now(), M = piModel(); PI_LAST = M;
    PI_CTX = { win: piWin(M.T.R) + ' comparée à ' + piWin(M.T.P), ver: 'données du ' + dFrUI((D.period || [])[0]) + ' au ' + dFrUI(M.T.dataEnd) + ', version ' + piHashTxt(piHashNow()) };
    const doc = el('div', { class: 'pi-doc pi-m-' + piMode() });
    piBlockHead(M, doc);
    doc.appendChild(piBlockActs(M));
    doc.appendChild(piBlockSubjects(M));
    doc.appendChild(el('div', { class: 'pi-grid' }, [piBlockCases(M), piBlockSignals(M)]));
    doc.appendChild(piBlockCoverage(M));
    doc.appendChild(piBlockReliability(M));
    doc.appendChild(piFooter(M));
    [piBlockWhere(M), piBlockPartners(M), piBlockResults(M), piBlockTexts(M), piBlockSnaps(M)].forEach(b => { if (b) doc.appendChild(b); });
    main.appendChild(doc);
    piHash(h => { doc.querySelectorAll('.pi-hashv').forEach(n => { n.textContent = piHashTxt(h); }); PI_CTX.ver = PI_CTX.ver.replace(/version .*$/, 'version ' + piHashTxt(h)); });
    SESSION.piMs = Math.round(performance.now() - t0);
  }
  if (/debug/.test(location.hash)) window.__dashPilot = { model: () => PI_LAST, fit: piFitDom, unfit: piUnfit, PILOT, setMode: m => { SESSION.piMode = m; render(); }, setK: k => { SESSION.piK = k; render(); }, F, render, ms: () => SESSION.piMs }; /*DEBUG*/
