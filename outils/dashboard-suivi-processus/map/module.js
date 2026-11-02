  // ================================================================== CARTE (lot map)
  // Une seule source par notion : visites = fv() (barre de filtres) ; sites = siteRows() ; plan = rbmCompute(rbmCfg()) en lecture seule.
  // Recadrage automatique à chaque changement de filtre global ; un zoom ou déplacement manuel tient jusqu'au filtre suivant.
  // Sécurité : noms de sites / agents = données non fiables → el()/sv() + textContent seulement ; aucune coordonnée de fiche affichée.
  const MAPP = SESSION.mapPref3 || (SESSION.mapPref3 = { mode: 'act', fond: 'score', vis: true, rbm: false, due: false, nov: false, off: false, bub: false, nr: false, exHH: false, clu: false, month: null });   // comme la carte d'origine : une couleur par activité, un point par visite
  const MAPV = { vb: null, sig: null, manual: false, fit: null, svg: null, W: 800, H: 600, marks: [], level: null, M: null, raf: 0, layers: null };
  const MAP_ALL = { x: -2.2, y: -0.2, w: 12.6, h: 15 };          // Madagascar entier (unités de project())
  const MAP_KM = 108;                                           // ≈ km par unité horizontale à la latitude du Sud
  const MAP_MIN_W = 40 / MAP_KM, MAP_MARGIN = 0.15;             // largeur minimale ≈ 40 km, marge 15 % de chaque côté
  const MAP_CLU = { minPts: 40, maxW: 0.7, cellPx: 56, maxMarks: 70 };   // regroupement : > 40 points, vue de plus de ≈ 75 km, ≈ 70 marques au plus par couche
  const MAP_PAL = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7'];
  const MAP_GREY = '#9aa5b1';
  const MAP_FOND = { good: 'rgba(31,138,76,.20)', mid: 'rgba(208,138,0,.22)', bad: 'rgba(194,59,42,.20)', none: 'rgba(150,160,170,.10)' };   // fond clair : les points ressortent
  const MAP_HH = RISK.findIndex(r => r.code === 'HHDistDiv');   // question SMP « signes de détournement » jugée à confirmer (constat qualité)
  const MAP_LEVEL = { high: ['#b2182b', 'élevé'], med: ['#ef8a62', 'moyen'], low: ['#67a9cf', 'faible'], never: ['#8c6bb1', 'jamais visité, risque non mesuré'], na: [MAP_GREY, 'non calculé'], off: ['#5d6b7a', 'inactif / zone interdite'] };
  const MAP_ST = {
    done: ['#1f8a4c', 'visité ce mois'], plan: ['#0a6ebd', 'planifié'], due: ['#c23b2a', 'dû, non planifié'],
    ok: ['#b9c2cc', 'à jour, pas dû ce mois'], off: ['#5d6b7a', 'inactif ce mois']
  };
  const mapRegKey = name => { let k = geoNorm(name || ''); if (k === 'vatovavy' || k === 'fitovinany') k = 'vatovavyfitovinany'; return k; };
  const mapDisKey = name => geoNorm(name || '');
  const mapHasGeo = v => v.lat !== null && v.lat !== undefined && v.lon !== null && v.lon !== undefined && !isNaN(v.lat) && !isNaN(v.lon);
  const mapAddM = (m, k) => { let [y, mm] = String(m).split('-').map(Number); mm += k; y += Math.floor((mm - 1) / 12); mm = ((mm - 1) % 12 + 12) % 12 + 1; return y + '-' + String(mm).padStart(2, '0'); };
  const mapDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const mapBtn = (text, on) => { const b = el('button', { class: 'btn', type: 'button', text }); b.addEventListener('click', on); return b; };
  const mapLv = k => MAP_LEVEL[k] || [MAP_GREY, String(k || 'non calculé')];
  const mapCat = sc => !sc ? 'na' : sc.cat || (sc.nVis ? sc.level : 'never');   // catégorie du moteur de planification ; repli : jamais visité à part
  const mapNext = sc => { const x = sc && (sc.nextPossible || sc.dueRaw || sc.due); return x ? (String(x).length > 7 ? dFrUI(x) : monthLabel(String(x))) + (sc.late ? ' (échéance dépassée de ' + fmt(sc.monthsLate || 0) + ' mois)' : '') : '–'; };   // champ plus précis du moteur s'il existe
  const mapElig = (s, m) => { if (!m) return s.actif && s.security < 99; try { if (typeof eligible === 'function') return eligible(s, m); } catch (e) { /* repli */ } return s.actif && s.security < 99; };
  const mapRisks = v => MAPP.exHH && v.act === 'SMP' && MAP_HH >= 0 ? v.risks.filter(r => r !== MAP_HH) : v.risks;
  const mapRisksX = v => v.act === 'SMP' && MAP_HH >= 0 ? v.risks.filter(r => r !== MAP_HH) : v.risks;
  const mapSec = x => ({ 0: '0 · pas de restriction', 1: '1 · restriction modérée', 3: '3 · restriction stricte', 99: '99 · zone interdite' })[x] || String(x);
  const mapWin = M => M && M.cov && M.cov.window ? monthLabel(M.cov.window[0]) + ' → ' + monthLabel(M.cov.window[1]) : monthLabel(F.m0) + ' → ' + monthLabel(F.m1);   // fenêtre de la couverture commune
  const mapCovDef = () => typeof covDefinition === 'function' ? covDefinition() : 'Couverture = sites du plan actifs au moins un mois de la période (grille « Oui », hors zone interdite) ayant reçu au moins une visite exploitable dans la période, sur ces sites actifs.';
  function mapMonthRange(a, b) { const out = []; if (!a || !b) return out; let m = a; for (let k = 0; m <= b && k < 60; k++) { out.push(m); m = mapAddM(m, 1); } return out; }

  // ---------------------------------------------------------------- données (un seul calcul par affichage)
  function mapRbm() {
    const empty = { ok: false, err: '', cfg: null, scored: [], plan: [], months: [], overflow: [], used: {}, cap: {}, byJ: new Map(), planBy: new Map() };
    if (typeof rbmCfg !== 'function' || typeof rbmCompute !== 'function') return Object.assign(empty, { err: 'planification RBM indisponible' });
    try {
      const cfg = rbmCfg(), R = rbmCompute(cfg) || {};
      const scored = Array.isArray(R.scored) ? R.scored : [], plan = Array.isArray(R.plan) ? R.plan : [];
      const byJ = new Map(); scored.forEach(s => { if (s && s.j !== undefined) byJ.set(s.j, s); });
      const planBy = new Map(); plan.forEach(p => { if (!p || !p.s || !p.m) return; const l = planBy.get(p.s.j) || []; l.push(p.m); planBy.set(p.s.j, l); });
      planBy.forEach(l => l.sort());
      return { ok: true, err: '', cfg, scored, plan, months: Array.isArray(R.months) ? R.months : [], overflow: Array.isArray(R.overflow) ? R.overflow : [], used: R.used || {}, cap: R.cap || {}, byJ, planBy,
        why: R.why instanceof Map ? R.why : null, dueInactive: Array.isArray(R.dueInactive) ? R.dueInactive : null, ref: R.ref || localDay(), dataEnd: R.dataEnd || null };
    } catch (e) { return Object.assign(empty, { err: String((e && e.message) || e) }); }
  }
  function mapCandidate(s, m) {      // même règle que la répartition RBM : dû dès sc.due, puis échéance repoussée de freq après chaque mois planifié
    if (!s.sc || !s.sc.due) return false; let nx = s.sc.due; const f = Math.max(1, +s.sc.freq || 1);
    s.pm.forEach(p => { if (p < m) nx = mapAddM(p, f); }); return nx <= m;
  }
  const MAP_WHY_ST = { planned: 'plan', manual: 'plan', cap: 'due', frozen: 'due', removed: 'due', inactive: 'off', forbidden: 'off', notdue: 'ok' };
  function mapStatus(s, m, why) {
    const w = why && m ? (why.get(s.j) || {})[m] : null;
    if (w && MAP_WHY_ST[w.st]) { if (w.st !== 'inactive' && w.st !== 'forbidden' && s.hist.some(v => v.month === m)) return 'done'; return MAP_WHY_ST[w.st]; }
    if (!mapElig(s, m)) return 'off';
    if (m && s.hist.some(v => v.month === m)) return 'done';
    if (s.pm.includes(m)) return 'plan';
    if (m && mapCandidate(s, m)) return 'due';
    return 'ok';
  }
  function mapModel() {
    const t0 = performance.now(), M = { t0 };
    M.N = 0; V.forEach(v => { if (v.valid) M.N++; });
    M.vis = fv(v => v.valid);
    M.visGeo = M.vis.filter(mapHasGeo);
    M.rbm = mapRbm();
    M.months = M.rbm.months;
    M.month = M.months.includes(MAPP.month) ? MAPP.month : (M.months[0] || null);
    M.lastM = M.months[M.months.length - 1] || null;
    M.pMonths = mapMonthRange(F.m0, F.m1);
    M.keyOf = v => { const k = (D.visitKeys || [])[v.i]; return k ? v.act + '|' + k.slice(k.indexOf('|') + 1, k.lastIndexOf('|')) : null; };
    const base = typeof siteRows === 'function' ? siteRows() : [];
    const PF = D.planFull || { cols: [], rows: [] }, iLat = PF.cols.indexOf('lat'), iLon = PF.cols.indexOf('lon');
    const reg = F.region >= 0 ? DICT.region[F.region] : null, fo = F.fo >= 0 ? DICT.fo[F.fo] : null, dis = F.district >= 0 ? mapDisKey(DICT.district[F.district]) : null;
    // couverture : règle commune covCalc() (fenêtre = période ∩ année du plan, filtres globaux) ; repli local si absente
    M.cov = null; try { if (typeof covCalc === 'function') M.cov = covCalc({ keepSites: true }); } catch (e) { M.cov = null; }
    const covSeen = M.cov ? new Map(M.cov.sites.map(x => [x.s.j, !!x.seen])) : null;
    M.byKey = new Map(); M.byJ = new Map(); M.sites = [];
    base.forEach(s => {
      M.byKey.set(s.act + '|' + s.code, s); M.byJ.set(s.j, s);
      const row = PF.rows[s.j] || [], lat = row[iLat], lon = row[iLon];
      s.geo = lat !== null && lat !== undefined && lon !== null && lon !== undefined && lat !== '' && !isNaN(lat) && !isNaN(lon);
      if (s.geo) { const q = project(+lon, +lat); s.x = q[0]; s.y = q[1]; s.lat = +lat; s.lon = +lon; }
      s.sc = M.rbm.byJ.get(s.j) || null; s.pm = M.rbm.planBy.get(s.j) || [];
      s.rk = mapRegKey(s.region); s.dk = mapDisKey(s.district);
      s.zone = (covSeen && covSeen.has(s.j)) || ((F.act === 'ALL' || s.act === F.act) && (!reg || s.region === reg) && (!fo || s.fo === fo) && (!dis || s.dk === dis));
      if (!s.zone) return;
      s.visP = 0; s.lastP = null; s.hist.forEach(v => { if (v.month >= F.m0 && v.month <= F.m1) { s.visP++; s.lastP = v; } });   // visites du site dans la période (info-bulle, tiroir)
      if (covSeen) { s.actP = covSeen.has(s.j); s.seen = s.actP && covSeen.get(s.j); }   // univers et « suivi » de la couverture commune
      else { s.actP = M.pMonths.some(m => mapElig(s, m)); s.seen = s.actP && s.visP > 0; }
      s.st = mapStatus(s, M.month, M.rbm.why); s.over = null;
      M.sites.push(s);
    });
    // dus non planifiés sur l'horizon : faute de capacité, ou parce que la grille du registre dit Non
    M.over = { cap: 0, grid: 0 };
    if (M.rbm.dueInactive) {     // moteur de planification : manque de capacité (overflow) et dus inactifs séparés
      M.rbm.overflow.forEach(o => { const s = o && M.byJ.get(o.j); if (s && s.zone) { s.over = 'cap'; M.over.cap++; } });
      M.rbm.dueInactive.forEach(o => { const s = o && M.byJ.get(o.j); if (s && s.zone && !s.over) { s.over = 'grid'; M.over.grid++; } });
    } else M.rbm.overflow.forEach(o => { const s = o && M.byJ.get(o.j); if (!s || !s.zone) return; const ok = M.months.some(m => m >= (s.sc ? s.sc.due : '') && mapElig(s, m)); s.over = ok ? 'cap' : 'grid'; M.over[s.over]++; });
    // dernière visite connue de chaque site avec alerte, sans visite depuis
    const idx = typeof siteIndex === 'function' ? siteIndex() : new Map();
    M.lastAlert = new Set(); idx.forEach(l => { const v = l[l.length - 1]; if (v && mapRisks(v).length) M.lastAlert.add(v); });
    // agrégats régionaux (région du registre / de la fiche, pas le GPS)
    M.reg = new Map(); M.dis = new Map();
    const bucket = (map, k, name) => { if (!map.has(k)) map.set(k, { k, names: {}, vis: [], sites: [] }); const b = map.get(k); if (name) b.names[name] = (b.names[name] || 0) + 1; return b; };
    M.vis.forEach(v => {
      const rn = DICT.region[v.region] || '', rk = mapRegKey(rn); if (rk) bucket(M.reg, rk, rn).vis.push(v);
      const dn = DICT.district[v.district] || '', dk = mapDisKey(dn); if (dk) { const b = bucket(M.dis, dk, dn); b.vis.push(v); b.rk = b.rk || rk; }
    });
    M.sites.forEach(s => { if (s.rk) bucket(M.reg, s.rk, s.region).sites.push(s); if (s.dk) { const b = bucket(M.dis, s.dk, s.district); b.sites.push(s); b.rk = b.rk || s.rk; } });
    M.ms = Math.round(performance.now() - t0);
    return M;
  }
  const mapName = b => { const ks = Object.keys(b.names); return ks.length ? ks.sort((x, y) => b.names[y] - b.names[x])[0] : b.k; };
  function mapAggVis(vs) {
    const a = { n: vs.length, scN: 0, sc: 0, al: 0, alX: 0, gps: 0 };
    vs.forEach(v => { if (v.score !== null && v.score !== undefined && !isNaN(v.score)) { a.sc += v.score; a.scN++; } if (v.risks.length) a.al++; if (mapRisksX(v).length) a.alX++; if (mapHasGeo(v)) a.gps++; });
    a.mean = a.scN ? a.sc / a.scN : null; a.alM = MAPP.exHH ? a.alX : a.al; return a;
  }
  function mapAggSites(ss) {
    const a = { N: 0, n: 0, never: 0, due: 0, plan: 0, high: 0, scored: 0 };
    ss.forEach(s => { if (s.actP) { a.N++; if (s.seen) a.n++; if (!s.nVis) a.never++; } if (s.over === 'cap') a.due++; if (s.st === 'plan') a.plan++; if (s.sc) { a.scored++; if (mapCat(s.sc) === 'high') a.high++; } });
    return a;
  }

  // ---------------------------------------------------------------- couleurs des points
  function mapVisitMode(M) {
    const mode = MAPP.mode;
    if (mode === 'act') return { title: 'activité', classes: ACTS.map(a => [a, ACT_COLOR[a] || MAP_GREY, ACT[a].label]), of: v => v.act };
    if (mode === 'alert') return { title: 'alerte', classes: [['y', '#c23b2a', 'au moins 1 alerte' + (MAPP.exHH ? ' (hors HHDistDiv SMP)' : '')], ['n', '#4e79a7', 'aucune alerte']], of: v => mapRisks(v).length ? 'y' : 'n' };
    if (mode === 'org' || mode === 'imp') {
      const key = mode, cnt = new Map(); M.visGeo.forEach(v => cnt.set(v[key], (cnt.get(v[key]) || 0) + 1));
      const nr = i => !DICT[key][i] || /non renseign/i.test(DICT[key][i]);
      const top = Array.from(cnt.keys()).filter(i => !nr(i)).sort((a, b) => cnt.get(b) - cnt.get(a));
      const keep = top.slice(0, top.length > MAP_PAL.length ? MAP_PAL.length - 1 : MAP_PAL.length), ks = new Set(keep);
      const classes = keep.map((i, j) => ['k' + i, MAP_PAL[j], DICT[key][i]]);
      if (top.length > keep.length) classes.push(['autre', '#9c755f', 'autres (' + fmt(top.length - keep.length) + ' partenaires)']);
      classes.push(['nr', MAP_GREY, 'non renseigné']);
      return { title: mode === 'org' ? 'partenaire de suivi (TPM)' : 'partenaire de mise en œuvre (MEO)', classes, of: v => nr(v[key]) ? 'nr' : ks.has(v[key]) ? 'k' + v[key] : 'autre' };
    }
    return { title: 'score de la visite', classes: [['good', '#1f8a4c', 'bon ≥ ' + THR.good], ['mid', '#d08a00', 'à améliorer ' + THR.mid + '–' + THR.good], ['bad', '#c23b2a', 'faible < ' + THR.mid], ['na', MAP_GREY, 'non scoré']], of: v => cls(v.score) };
  }
  function mapSiteMode(M) {
    const cfg = M.rbm.cfg || {};
    if (MAPP.mode === 'risk') return { title: 'niveau de risque RBM du site', classes: [['high', MAP_LEVEL.high[0], 'élevé, R ≥ ' + fmt(cfg.thHigh)], ['med', MAP_LEVEL.med[0], 'moyen, ' + fmt(cfg.thMed) + '–' + fmt(cfg.thHigh)], ['low', MAP_LEVEL.low[0], 'faible, R < ' + fmt(cfg.thMed)], ['never', MAP_LEVEL.never[0], 'jamais visité, risque non mesuré'], ['na', MAP_GREY, 'hors calcul RBM'], ['off', MAP_LEVEL.off[0], 'inactif ce mois']],
      of: s => s.st === 'off' ? 'off' : s.sc ? mapCat(s.sc) : 'na' };
    return { title: 'statut du plan — ' + (M.month ? monthLabel(M.month) : 'mois ?'), classes: ['done', 'plan', 'due', 'ok', 'off'].map(k => [k, MAP_ST[k][0], MAP_ST[k][1]]), of: s => s.st };
  }
  function mapIsSiteMode() { return MAPP.mode === 'risk' || MAPP.mode === 'plan'; }

  // ---------------------------------------------------------------- géométrie : vue, recadrage, échelle des symboles
  function mapScale() { const vb = MAPV.vb; return Math.max(vb.w / MAPV.W, vb.h / MAPV.H); }
  function mapSetVB() { const vb = MAPV.vb; if (MAPV.svg) MAPV.svg.setAttribute('viewBox', vb.x.toFixed(4) + ' ' + vb.y.toFixed(4) + ' ' + vb.w.toFixed(4) + ' ' + vb.h.toFixed(4)); }
  function mapAspect(b) {      // même rapport largeur / hauteur que la zone d'affichage, largeur minimale garantie
    const A = MAPV.W / MAPV.H; let { w, h } = b; const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (w / h < A) w = h * A; else h = w / A;
    if (w < MAP_MIN_W) { h *= MAP_MIN_W / w; w = MAP_MIN_W; }
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  function mapFitPts(pts) {
    const n = pts.length; if (!n) return null;
    const xs = pts.map(p => p[0]).sort((a, b) => a - b), ys = pts.map(p => p[1]).sort((a, b) => a - b);
    const tr = n >= 100 ? Math.floor(n * 0.005) : 0;          // 0,5 % des points les plus éloignés de chaque côté (GPS aberrants)
    const x0 = xs[tr], x1 = xs[n - 1 - tr], y0 = ys[tr], y1 = ys[n - 1 - tr];
    const w = Math.max(x1 - x0, 0.01), h = Math.max(y1 - y0, 0.01);
    const vb = mapAspect({ x: x0 - w * MAP_MARGIN, y: y0 - h * MAP_MARGIN, w: w * (1 + 2 * MAP_MARGIN), h: h * (1 + 2 * MAP_MARGIN) });
    const out = pts.filter(p => p[0] < vb.x || p[0] > vb.x + vb.w || p[1] < vb.y || p[1] > vb.y + vb.h).length;
    return { vb, n, out };
  }
  function mapGeoBox(key) {
    const f = (D.geo || []).find(g => mapRegKey(g.name) === key); if (!f) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    (f.type === 'Polygon' ? [f.coords] : f.coords).forEach(poly => poly.forEach(ring => ring.forEach(p => { const q = project(p[0], p[1]); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); })));
    return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  function mapFitPoints(M) {      // points réellement affichés : visites filtrées + sites des couches actives
    const pts = [];
    const partner = F.org >= 0 || F.imp >= 0, siteMode = mapIsSiteMode();
    if (!siteMode && (MAPP.vis || partner)) M.visGeo.forEach(v => { if (!MAPP.nr || M.lastAlert.has(v)) { const q = project(v.lon, v.lat); pts.push(q); } });
    if (siteMode || !partner || !pts.length) mapSitePts(M).forEach(s => pts.push([s.x, s.y]));
    return pts;
  }
  function mapAutoFit(M) {
    const pts = mapFitPoints(M); let r = mapFitPts(pts);
    if (r) { MAPV.fit = { kind: 'sel', n: r.n, out: r.out }; return r.vb; }
    const rb = F.region >= 0 ? mapGeoBox(mapRegKey(DICT.region[F.region])) : null;
    if (rb) { MAPV.fit = { kind: 'region', n: 0, out: 0 }; return mapAspect({ x: rb.x - rb.w * 0.1, y: rb.y - rb.h * 0.1, w: rb.w * 1.2, h: rb.h * 1.2 }); }
    MAPV.fit = { kind: 'pays', n: 0, out: 0 }; return mapAspect(MAP_ALL);
  }
  // les points grossissent un peu quand on zoome (×0,85 en vue pays, jusqu'à ×1,6 très près) ; étiquettes et groupes gardent leur taille
  function mapGrow() { return Math.max(0.85, Math.min(1.6, Math.pow(11 / Math.max(0.05, MAPV.vb.w), 0.22))); }
  function mapRescale() {
    const s = mapScale(), t = ' scale(' + s.toPrecision(5) + ')', tg = ' scale(' + (s * mapGrow()).toPrecision(5) + ')';
    for (let i = 0; i < MAPV.marks.length; i++) { const m = MAPV.marks[i]; m[0].setAttribute('transform', m[1] + (m[2] ? t : tg)); }
  }
  const mapInBox = (x, y, b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  const mapBoxIn = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  function mapLevel() { if (!MAPP.clu || MAPV.vb.w <= MAP_CLU.maxW) return 0; return Math.pow(2, Math.round(Math.log2(MAPV.vb.w / (MAPV.W / MAP_CLU.cellPx)))); }
  function mapApplyView(redrawIfLevel) {
    mapSetVB();
    const lv = mapLevel();
    if (redrawIfLevel && (lv !== MAPV.level || (MAPV.drawn && !mapBoxIn(MAPV.vb, MAPV.drawn)))) mapDrawPoints();
    mapRescale();
    mapViewText();
  }
  function mapZoom(f, cx, cy) {
    const vb = MAPV.vb; const nw = Math.min(16, Math.max(MAP_MIN_W * 0.5, vb.w * f)), nh = nw * vb.h / vb.w;
    if (cx === undefined) { cx = vb.x + vb.w / 2; cy = vb.y + vb.h / 2; }
    MAPV.vb = { x: cx - (cx - vb.x) * nw / vb.w, y: cy - (cy - vb.y) * nh / vb.h, w: nw, h: nh }; MAPV.manual = true;
    mapSchedule();
  }
  function mapSchedule() { if (MAPV.raf) return; MAPV.raf = requestAnimationFrame(() => { MAPV.raf = 0; mapApplyView(true); }); }
  function mapToUser(svg, cx, cy) { const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; const ctm = svg.getScreenCTM(); if (!ctm) return [MAPV.vb.x, MAPV.vb.y]; const p = pt.matrixTransform(ctm.inverse()); return [p.x, p.y]; }

  // ---------------------------------------------------------------- symboles (dessinés en pixels, puis mis à l'échelle de la vue)
  function mapMark(g, x, y, kids, d, fixed) {
    const pre = 'translate(' + x.toFixed(4) + ' ' + y.toFixed(4) + ')';
    const m = sv('g', { class: 'mk', transform: pre + ' scale(' + (mapScale() * (fixed ? 1 : mapGrow())).toPrecision(5) + ')' });
    kids.forEach(k => m.appendChild(k)); m._d = d; MAPV.marks.push([m, pre, !!fixed]); g.appendChild(m); return m;
  }
  function mapGlyph(kind, color, alert) {
    if (kind === 'vis') return [sv('circle', { r: 3.6, fill: color, stroke: alert ? '#111' : '#fff', 'stroke-width': alert ? 1.3 : 0.8 })];
    if (kind === 'dot') return [sv('circle', { r: 2.4, fill: '#5d6b7a', 'fill-opacity': 0.55 })];
    if (kind === 'plan') return [sv('path', { d: 'M0 -5.6L5.6 0L0 5.6L-5.6 0Z', fill: color, stroke: '#fff', 'stroke-width': 1 })];
    if (kind === 'due') return [sv('circle', { r: 4.6, fill: '#fff', 'fill-opacity': 0.75, stroke: color, 'stroke-width': 2.2 })];
    if (kind === 'done') return [sv('circle', { r: 4.8, fill: color, stroke: '#fff', 'stroke-width': 0.8 }), sv('path', { d: 'M-2.4 0.2L-0.7 1.9L2.5 -1.6', fill: 'none', stroke: '#fff', 'stroke-width': 1.5 })];
    if (kind === 'ok') return [sv('circle', { r: 3, fill: color, stroke: '#5d6b7a', 'stroke-width': 0.6 })];
    if (kind === 'off') return [sv('rect', { x: -2.8, y: -2.8, width: 5.6, height: 5.6, fill: color, stroke: '#fff', 'stroke-width': 0.6 })];
    if (kind === 'nov') return [sv('circle', { r: 3.3, fill: '#fff', 'fill-opacity': 0.55, stroke: '#4b5866', 'stroke-width': 1.1 })];
    if (kind === 'never') return [sv('circle', { r: 3.6, fill: '#fff', 'fill-opacity': 0.85, stroke: '#2f3b48', 'stroke-width': 1.4, 'stroke-dasharray': '2.2 1.4' })];
    if (kind === 'site') return [sv('circle', { r: 4.2, fill: color, stroke: '#fff', 'stroke-width': 0.8 })];
    return [sv('circle', { r: 3, fill: color })];
  }
  const MAP_STG = { done: 'done', plan: 'plan', due: 'due', ok: 'ok', off: 'off' };
  function mapBlob(color, n, r) {      // groupe de points : un cercle simple, taille ∝ √n ; chiffre seulement si n ≥ 10 et s'il y a la place
    const kids = [sv('circle', { r, fill: color, 'fill-opacity': 0.8, stroke: '#fff', 'stroke-width': 1.4 })];
    if (n >= 10 && r >= 9) { const t = sv('text', { class: 'mapx-cn', 'text-anchor': 'middle', dy: '0.35em' }); t.textContent = n >= 1000 ? fmt(n / 1000, 1) + 'k' : String(n); kids.push(t); }
    return kids;
  }
  function mapCluster(g, items, xy, classOf, colorOf, labelOf, layer, unit, groupColor) {
    const bin = l => { const m = new Map(); items.forEach(it => { const p = xy(it); const k = Math.floor(p[0] / l) + ',' + Math.floor(p[1] / l); let c = m.get(k); if (!c) { c = { items: [], sx: 0, sy: 0 }; m.set(k, c); } c.items.push(it); c.sx += p[0]; c.sy += p[1]; }); return m; };
    let lv = MAPV.level, cells = bin(lv);
    for (let k = 0; k < 4 && cells.size > MAP_CLU.maxMarks; k++) { lv *= 2; cells = bin(lv); }   // au plus ≈ 70 marques par couche en vue large
    const singles = [], mx = Math.max(1, ...Array.from(cells.values()).map(c => c.items.length));
    cells.forEach(c => {
      if (c.items.length === 1) { singles.push(c.items[0]); return; }
      const cnt = new Map(); c.items.forEach(it => { const k = classOf(it); cnt.set(k, (cnt.get(k) || 0) + 1); });
      const counts = Array.from(cnt.keys()).sort((a, b) => cnt.get(b) - cnt.get(a)).map(k => [colorOf(k), cnt.get(k), labelOf(k)]);
      const gc = groupColor ? groupColor(c.items) : null;
      const r = Math.min(20, 5 + 15 * Math.sqrt(c.items.length / mx));
      mapMark(g, c.sx / c.items.length, c.sy / c.items.length, mapBlob(gc ? gc.color : counts[0][0], c.items.length, r),
        { k: 'clu', items: c.items, xy, counts, layer, unit, gtxt: gc ? gc.txt : 'Couleur = classe la plus fréquente : ' + counts[0][2] }, true);
    });
    return singles;
  }
  function mapSitePts(M) {        // sites dessinés (pour le recadrage et les comptes) selon le mode et les couches
    if (mapIsSiteMode()) return M.sites.filter(s => s.geo && (s.st !== 'off' || MAPP.off));
    const out = [];
    M.sites.forEach(s => { const k = mapSiteLayer(s); if (k) { s.lay = k; out.push(s); } });
    return out;
  }
  // couche d'un site (une seule marque par site) : plan RBM du mois > dû non planifié > sans visite dans la période > inactif
  function mapSiteLayer(s) {
    if (!s.geo) return null;
    if (MAPP.rbm && (s.st === 'plan' || s.st === 'done')) return s.st;
    if (MAPP.due && s.st === 'due') return 'due';
    if (MAPP.nov && s.actP && !s.seen && s.st !== 'off') return s.nVis ? 'nov' : 'never';
    if (MAPP.off && s.st === 'off') return 'off';
    return null;
  }

  // ---------------------------------------------------------------- dessin des couches de points
  function mapDrawPoints() {
    const M = MAPV.M, L = MAPV.layers; if (!M || !L) return;
    MAPV.marks = MAPV.marks.filter(m => m[0].parentNode && m[0].parentNode.getAttribute('class') === 'mapx-lab');   // garde les étiquettes
    [L.bub, L.site0, L.site, L.vis].forEach(clear);
    MAPV.level = mapLevel();
    const siteMode = mapIsSiteMode();
    // vue rapprochée sans regroupement : seuls les points autour de la vue sont dessinés (redessin quand on en sort)
    const vb = MAPV.vb, ext = { x: vb.x - vb.w, y: vb.y - vb.h, w: vb.w * 3, h: vb.h * 3 };
    const cull = !MAPV.level && (M.visGeo.length + M.sites.length) > 1500; MAPV.drawn = cull ? ext : null;
    const near = (x, y) => !cull || mapInBox(x, y, ext);
    // bulles par district
    if (MAPP.bub) mapDrawBubbles(M, L.bub);
    // sites
    const sp = mapSitePts(M);
    if (sp.length) {
      let classOf, colorOf, labelOf, glyphOf;
      if (siteMode) { const sm = mapSiteMode(M), cm = new Map(sm.classes.map(c => [c[0], c])); classOf = sm.of; colorOf = k => (cm.get(k) || [0, MAP_GREY])[1]; labelOf = k => (cm.get(k) || [0, 0, k])[2];
        glyphOf = s => MAPP.mode === 'plan' ? mapGlyph(MAP_STG[s.st] || 'ok', MAP_ST[s.st][0]) : (s.st === 'off' ? mapGlyph('off', MAP_LEVEL.off[0]) : mapGlyph('site', colorOf(classOf(s)))); }
      else { classOf = s => s.lay;
        const col = { plan: MAP_ST.plan[0], due: MAP_ST.due[0], done: MAP_ST.done[0], off: MAP_ST.off[0], nov: '#c9d1da', never: '#7d8996' };
        const lab = { plan: 'planifié', due: 'dû, non planifié', done: 'visité ce mois', off: 'inactif ce mois', nov: 'non suivi', never: 'jamais visité' };
        colorOf = k => col[k]; labelOf = k => lab[k];
        glyphOf = s => { const k = classOf(s); return k === 'nov' || k === 'never' ? mapGlyph(k) : mapGlyph(k, col[k]); }; }
      let rest = sp;
      // le plan RBM du mois (peu de sites) n'est jamais regroupé ; les autres sites le sont en vue large
      const keepAlone = s => !siteMode && (s.lay === 'plan' || s.lay === 'done');
      if (MAPV.level && sp.length > MAP_CLU.minPts) { const grp = sp.filter(s => !keepAlone(s)); rest = sp.filter(keepAlone).concat(mapCluster(L.site0, grp, s => [s.x, s.y], classOf, colorOf, labelOf, 'site', 'sites')); }
      // sous les visites : sites sans visite / inactifs / mode site ; au-dessus : plan RBM du mois (peu nombreux, à ne pas masquer)
      rest.forEach(s => (keepAlone(s) || near(s.x, s.y)) && mapMark(!siteMode && (s.lay === 'plan' || s.lay === 'done' || s.lay === 'due') ? L.site : L.site0, s.x, s.y, glyphOf(s), { k: 'site', s }));
    }
    // visites
    if (MAPP.vis && !siteMode) {     // en mode « site », les sites du plan remplacent les visites
      const pts = MAPP.nr ? M.visGeo.filter(v => M.lastAlert.has(v)) : M.visGeo;
      pts.forEach(v => { if (v._xy === undefined) v._xy = project(v.lon, v.lat); });
      {
        const vm = mapVisitMode(M), cm = new Map(vm.classes.map(c => [c[0], c]));
        const colorOf = k => (cm.get(k) || [0, MAP_GREY])[1], labelOf = k => (cm.get(k) || [0, 0, k])[2];
        let rest = pts;
        const gcol = MAPP.mode === 'score' ? vs => { const g = mapAggVis(vs); const k = g.scN ? cls(g.mean) : 'na'; return { color: colorOf(k), txt: 'Couleur = score moyen du groupe : ' + (g.scN ? fmt(g.mean, 1) + ' / 100 (n = ' + fmt(g.scN) + ')' : 'non scoré') }; } : null;
        if (MAPV.level && pts.length > MAP_CLU.minPts) rest = mapCluster(L.vis, pts, v => v._xy, vm.of, colorOf, labelOf, 'vis', 'visites', gcol);
        rest.forEach(v => near(v._xy[0], v._xy[1]) && mapMark(L.vis, v._xy[0], v._xy[1], mapGlyph('vis', colorOf(vm.of(v)), MAPP.mode === 'score' && mapRisks(v).length > 0), { k: 'vis', v }));
      }
    }
  }
  const mapCovColor = p => { if (p === null) return MAP_GREY; const t = Math.max(0, Math.min(1, p / 100)); const a = [222, 235, 247], b = [8, 81, 156]; return 'rgb(' + a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(',') + ')'; };
  function mapDistricts(M) {
    const out = [];
    M.dis.forEach(b => {
      const a = mapAggSites(b.sites), av = mapAggVis(b.vis);
      const geo = b.sites.filter(s => s.geo); let x, y;
      if (geo.length) { x = mean(geo.map(s => s.x)); y = mean(geo.map(s => s.y)); }
      else { const gv = b.vis.filter(mapHasGeo); if (!gv.length) return; const q = gv.map(v => project(v.lon, v.lat)); x = mean(q.map(p => p[0])); y = mean(q.map(p => p[1])); }
      out.push({ k: b.k, rk: b.rk, name: mapName(b), x, y, a, av, b });
    });
    return out;
  }
  function mapDrawBubbles(M, g) {
    mapDistricts(M).forEach(d => {
      if (!d.a.N && !d.av.n) return;
      const p = d.a.N ? d.a.n / d.a.N * 100 : null, r = Math.min(30, 8 + 3.2 * Math.sqrt(d.a.due));
      const t = sv('text', { class: 'mapx-bn' + (p !== null && p > 55 ? ' w' : ''), 'text-anchor': 'middle', dy: '0.35em' }); t.textContent = String(d.a.due);
      mapMark(g, d.x, d.y, [sv('circle', { r, fill: mapCovColor(p), 'fill-opacity': 0.82, stroke: '#fff', 'stroke-width': 1.2 }), t], { k: 'dis', key: d.k, d }, true);
    });
  }

  // ---------------------------------------------------------------- fond régional
  function mapRegFill(b, M) {
    const f = MAPP.fond; if (f === 'none') return { fill: 'rgba(150,160,170,.08)', txt: '' };
    const av = mapAggVis(b ? b.vis : []), as = mapAggSites(b ? b.sites : []);
    const hatch = 'url(#mapx-hatch)', none = MAP_FOND.none;
    const cl = c => MAP_FOND[c] || none;
    if (f === 'visits') { const mx = Math.max(1, ...Array.from(M.reg.values()).map(x => x.vis.length)); return av.n ? { fill: 'rgba(10,110,189,' + (0.06 + 0.4 * av.n / mx).toFixed(2) + ')', txt: fmt(av.n) + ' visites' } : { fill: none, txt: '' }; }
    if (f === 'cov') { const st = nStatus(as.N); if (!as.N) return { fill: none, txt: '' }; const p = as.n / as.N * 100; return st === 'na' ? { fill: none, txt: fmt(as.n) + '/' + fmt(as.N) + ' sites (< ' + SMALL_N.min + ')' } : st === 'low' ? { fill: hatch, txt: fmt(as.n) + '/' + fmt(as.N) + ' sites · indicatif' } : { fill: mapCovColor(p), op: 0.32, txt: pct(p) + ' · ' + fmt(as.n) + '/' + fmt(as.N) + ' sites' }; }
    const n = f === 'risk' ? av.n : av.scN; if (!n) return { fill: none, txt: '' };
    const st = nStatus(n);
    if (st === 'na') return { fill: none, txt: 'n = ' + fmt(n) + ' (< ' + SMALL_N.min + ')' };
    if (f === 'risk') { const p = av.alM / av.n * 100; return { fill: st === 'low' ? hatch : cl(riskCls(p)), txt: pct(p) + ' · ' + fmt(av.alM) + '/' + fmt(av.n) + (st === 'low' ? ' · indicatif' : '') }; }
    return { fill: st === 'low' ? hatch : cl(cls(av.mean)), txt: fmt(av.mean, 1) + '/100 · n = ' + fmt(n) + (st === 'low' ? ' · indicatif' : '') };
  }
  function mapCentroid(f) {
    let best = null, bestA = 0;
    (f.type === 'Polygon' ? [f.coords] : f.coords).forEach(poly => { const ring = poly[0]; if (!ring || ring.length < 3) return; let A = 0, cx = 0, cy = 0;
      const q = ring.map(p => project(p[0], p[1]));
      for (let i = 0; i < q.length; i++) { const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % q.length]; const c = x0 * y1 - x1 * y0; A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c; }
      if (Math.abs(A) > bestA) { bestA = Math.abs(A); best = [cx / (3 * A), cy / (3 * A)]; } });
    return best;
  }

  // ---------------------------------------------------------------- info-bulles
  function mapVisitTip(v) {
    const M = MAPV.M, s = M.byKey.get(M.keyOf(v));
    const rk = mapRisks(v);
    return (ACT[v.act] ? ACT[v.act].short : v.act) + ' – ' + (DICT.site[v.site] || 'site ?') + '\n' + (DICT.district[v.district] || '') + ' (' + (DICT.region[v.region] || '') + ')\nDate : ' + dFrUI(v.date) +
      '\nPartenaire de suivi (TPM) : ' + (DICT.org[v.org] || '–') + (DICT.imp[v.imp] ? '\nPartenaire MEO : ' + DICT.imp[v.imp] : '') +
      '\nScore : ' + fmt(v.score, 1) + ' / 100 (' + CLS_TXT[cls(v.score)] + ')\nAgent(s) : ' + v.enus.map(e => DICT.enu[e]).join(', ') +
      (rk.length ? '\nAlertes (' + rk.length + ') : ' + rk.map(r => riskLabel(v.act, r)).join(' ; ') : '\nAucune alerte') +
      (() => { let nc = []; try { nc = typeof nonConf === 'function' ? nonConf(v) : []; } catch (e) { nc = []; } return nc.length ? '\nNormes non conformes (' + nc.length + ') :\n' + nc.slice(0, 5).map(m => '• ' + m.label).join('\n') + (nc.length > 5 ? '\n…' : '') : ''; })() +
      (s ? '\nSite du plan : ' + (s.publicId || s.code) + (s.sc ? ' · risque RBM ' + mapLv(mapCat(s.sc))[1] + (mapCat(s.sc) === 'never' ? '' : ' (' + fmt(s.sc.R, 1) + '/100)') : '') : '\nSite absent du plan de suivi (registre)') +
      '\nPosition : GPS médian des fiches de la visite\n→ cliquer pour la fiche du site';
  }
  function mapSiteTip(s) {
    const M = MAPV.M, l = s.hist, last = l[l.length - 1];
    return (s.localite || s.code) + ' — ' + (ACT[s.act] ? ACT[s.act].short : s.act) + ' · ' + (s.publicId || s.code) + '\n' + (s.commune ? s.commune + ', ' : '') + s.district + ' (' + s.region + ') · bureau ' + (s.fo || '–') +
      '\nStatut ' + (M.month ? monthLabel(M.month) : '') + ' : ' + MAP_ST[s.st][1] + (s.pm.length ? '\nPrévu au plan RBM : ' + s.pm.map(monthLabel).join(', ') : '') +
      (s.sc ? '\nRisque RBM : ' + mapLv(mapCat(s.sc))[1] + (mapCat(s.sc) === 'never' ? '' : ' (' + fmt(s.sc.R, 1) + '/100)') + ' · prochaine visite possible à partir de ' + mapNext(s.sc) : s.actif ? '' : '\nInactif au registre') +
      '\nVisites dans la période : ' + fmt(s.visP) + ' · au total : ' + fmt(s.nVis) + (last ? '\nDernière visite : ' + dFrUI(last.date) + ' (score ' + fmt(last.score, 1) + ')' : '\nJamais visité') +
      '\nPosition : coordonnées du registre\n→ cliquer pour la fiche du site';
  }
  function mapTipText(d) {
    if (d.k === 'vis') return mapVisitTip(d.v);
    if (d.k === 'site') return mapSiteTip(d.s);
    if (d.k === 'clu') return 'Groupe de ' + fmt(d.items.length) + ' ' + d.unit + ' proches (regroupés en vue large)\n' + d.gtxt + '\n' + d.counts.map(c => '• ' + c[2] + ' : ' + fmt(c[1])).join('\n') + '\n→ cliquer pour zoomer sur le groupe';
    if (d.k === 'dis') { const x = d.d; return 'District ' + x.name + '\nSites actifs dans la période : ' + fmt(x.a.N) + ' · suivis : ' + (x.a.N ? nOf(x.a.n, x.a.N, '') : '–') + '\nDus non planifiés (capacité, plan RBM) : ' + fmt(x.a.due) + '\nVisites exploitables : ' + fmt(x.av.n) + '\n→ cliquer pour le détail du district'; }
    if (d.k === 'reg') { const M = MAPV.M, b = M.reg.get(d.key); const av = mapAggVis(b ? b.vis : []), as = mapAggSites(b ? b.sites : []);
      if (!av.n && !as.N) return d.name + '\nAucune visite exploitable ni site actif dans la sélection';
      return d.name + '\nVisites exploitables : ' + fmt(av.n) + '\nScore moyen : ' + (nStatus(av.scN) === 'na' ? nNote(av.scN, 'visites') : fmt(av.mean, 1) + ' / 100 (n = ' + fmt(av.scN) + ')' + (nStatus(av.scN) === 'low' ? ' — indicatif' : '')) +
        '\nVisites avec ≥ 1 alerte : ' + (av.n ? nOf(av.alM, av.n, '') : '–') + (MAPP.exHH ? ' (hors HHDistDiv SMP)' : '') + '\nCouverture du plan : ' + (as.N ? nOf(as.n, as.N, 'sites actifs') : 'aucun site actif au plan') + '\n→ cliquer pour le détail de la région'; }
    return '';
  }
  function mapTarget(node) {
    if (!node || !node.closest) return null;
    const mk = node.closest('.mk'); if (mk && mk._d) return mk._d;
    const rg = node.closest('.region'); if (rg && rg._d) return rg._d;
    return null;
  }

  // ---------------------------------------------------------------- interactions : molette, pincement, glisser, clic
  function mapInteract(svg) {
    const ptrs = new Map(); let drag = null, pinch = null, moved = false;
    svg.addEventListener('wheel', ev => { ev.preventDefault(); const p = mapToUser(svg, ev.clientX, ev.clientY); mapZoom(ev.deltaY > 0 ? 1.2 : 1 / 1.2, p[0], p[1]); }, { passive: false });
    svg.addEventListener('pointerdown', ev => {
      if (ev.button !== undefined && ev.button > 0) return;
      ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (ptrs.size === 1) { drag = { x: ev.clientX, y: ev.clientY, vb: Object.assign({}, MAPV.vb), id: ev.pointerId }; moved = false; }
      else if (ptrs.size === 2) { const [a, b] = Array.from(ptrs.values()); pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, vb: Object.assign({}, MAPV.vb), c: mapToUser(svg, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2) }; drag = null; moved = true; }
    });
    svg.addEventListener('pointermove', ev => {
      if (ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (pinch && ptrs.size === 2) { const [a, b] = Array.from(ptrs.values()); const f = pinch.d / (Math.hypot(a[0] - b[0], a[1] - b[1]) || 1); const vb = pinch.vb, nw = Math.min(16, Math.max(MAP_MIN_W * 0.5, vb.w * f)), nh = nw * vb.h / vb.w;
        MAPV.vb = { x: pinch.c[0] - (pinch.c[0] - vb.x) * nw / vb.w, y: pinch.c[1] - (pinch.c[1] - vb.y) * nh / vb.h, w: nw, h: nh }; MAPV.manual = true; mapSchedule(); return; }
      if (!drag || drag.id !== ev.pointerId) { if (!drag) { const d = mapTarget(ev.target); if (d) showTip(ev, mapTipText(d)); else hideTip(); } return; }
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) > 4) { moved = true; hideTip(); svg.classList.add('mapx-drag'); try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* sans capture */ } }
      if (!moved) return;
      const s = mapScale(); MAPV.vb = { x: drag.vb.x - dx * s, y: drag.vb.y - dy * s, w: drag.vb.w, h: drag.vb.h }; MAPV.manual = true;
      mapSetVB(); mapViewText();
    });
    const up = ev => { ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) { if (drag && moved) mapApplyView(true); drag = null; svg.classList.remove('mapx-drag'); } };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    svg.addEventListener('mouseleave', hideTip);
    svg.addEventListener('click', ev => {
      if (moved) { moved = false; return; }
      const d = mapTarget(ev.target); if (!d) return; hideTip();
      if (d.k === 'vis') { const M = MAPV.M; mapOpenSite(M.byKey.get(M.keyOf(d.v)) || null, d.v); }
      else if (d.k === 'site') mapOpenSite(d.s, null);
      else if (d.k === 'clu') { const r = mapFitPts(d.items.map(d.xy)); if (r) { MAPV.vb = r.vb; MAPV.manual = true; mapApplyView(true); } }
      else if (d.k === 'dis') mapOpenZone('dis', d.key);
      else if (d.k === 'reg') mapOpenZone('reg', d.key);
    });
  }

  // ---------------------------------------------------------------- rendu de l'onglet
  function mapSel(label, opts, cur, on, title) {
    const s = el('select', { 'aria-label': label, title: title || label });
    opts.forEach(([v, t]) => { if (v === '—') { const og = el('optgroup'); og.label = t; s.appendChild(og); return; } const o = el('option', { value: v, text: t }); if (String(v) === String(cur)) o.selected = true; (s.lastChild && s.lastChild.tagName === 'OPTGROUP' ? s.lastChild : s).appendChild(o); });
    s.addEventListener('change', () => on(s.value));
    return el('label', { class: 'mapx-f' }, [el('span', { text: label }), s]);
  }
  function mapChk(label, on, val, n, title, disabled) {
    const c = el('input', { type: 'checkbox' }); c.checked = !!val; c.disabled = !!disabled; c.addEventListener('change', () => on(c.checked));
    return el('label', { title: title || label, class: disabled ? 'mapx-dis' : null }, [c, el('span', { text: label }), n !== undefined && n !== null ? el('span', { class: 'mapx-n', text: fmt(n) }) : null]);
  }
  function mapSw(kind, color, alert) { const s = sv('svg', { class: 'mapx-sw', viewBox: '-7 -7 14 14', 'aria-hidden': 'true' }); mapGlyph(kind, color, alert).forEach(k => s.appendChild(k)); return s; }
  function mapViewText() {
    const box = document.getElementById('mapx-view'); if (!box) return; const f = MAPV.fit || {}; const km = Math.round(MAPV.vb.w * MAP_KM);
    box.textContent = MAPV.manual ? 'Vue libre' : f.kind === 'sel' ? 'Vue ajustée aux filtres' : f.kind === 'region' ? 'Vue de la région' : 'Vue du pays';
    box.title = (MAPV.manual ? 'Vue déplacée à la main : le prochain changement de filtre la recadre.' : 'Recadrée sur les ' + fmt(f.n || 0) + ' points affichés, avec une marge de ' + Math.round(MAP_MARGIN * 100) + ' % et au moins 40 km de large.' + (f.out ? ' ' + fmt(f.out) + ' point(s) isolé(s) restent hors du cadre, le bouton Pays les montre.' : '')) + ' Largeur actuelle : environ ' + fmt(km) + ' km.';
  }
  function mapReset() { F.act = 'ALL'; F.fo = -1; F.region = -1; F.district = -1; F.org = -1; F.imp = -1; F.m0 = MONTHS[0]; F.m1 = MONTHS[MONTHS.length - 1]; render(); }
  function mapNeedsMonth() { return mapIsSiteMode() || MAPP.rbm || MAPP.due || MAPP.off; }
  function mapRender(main) {
    const M = mapModel(); MAPV.M = M;
    const sig = JSON.stringify([F.act, F.fo, F.region, F.district, F.org, F.imp, F.m0, F.m1, D.generated]);
    const refit = sig !== MAPV.sig || !MAPV.vb; MAPV.sig = sig;
    const siteMode = mapIsSiteMode();
    const title = 'Carte des visites';
    const re = () => render();
    // ---- couches (panneau repliable) avec leurs comptes
    const nPlan = M.sites.filter(s => s.geo && (s.st === 'plan' || s.st === 'done')).length, nDue = M.sites.filter(s => s.geo && s.st === 'due').length;
    const nNov = M.sites.filter(s => s.geo && s.actP && !s.seen && s.st !== 'off').length, nOff = M.sites.filter(s => s.geo && s.st === 'off').length;
    const nNR = M.visGeo.filter(v => M.lastAlert.has(v)).length;
    const det = el('details', { class: 'mapx-dd' }); det.open = !!MAPV.ddOpen; det.addEventListener('toggle', () => { MAPV.ddOpen = det.open; });
    const nOn = [MAPP.rbm, MAPP.due, MAPP.nov, MAPP.off, MAPP.bub, MAPP.nr].filter(Boolean).length;
    det.appendChild(el('summary', { class: 'btn', text: 'Couches' + (nOn ? ' (+' + nOn + ')' : '') + ' ▾' }));
    det.appendChild(el('div', { class: 'mapx-ddp', role: 'group', 'aria-label': 'Couches de la carte' }, [
      el('p', { class: 'mapx-ddt', text: 'Points' }),
      mapChk('Visites de la période', v => { MAPP.vis = v; re(); }, MAPP.vis && !siteMode, M.visGeo.length, siteMode ? 'En mode « site », les sites du plan remplacent les visites' : 'Une marque par visite exploitable des filtres (position : GPS médian des fiches)', siteMode),
      mapChk('Sites planifiés ce mois', v => { MAPP.rbm = v; re(); }, MAPP.rbm && !siteMode, nPlan, 'Losange : site prévu au plan du mois choisi (coche s’il est déjà visité ce mois)', siteMode),
      mapChk('Sites dus non planifiés', v => { MAPP.due = v; re(); }, MAPP.due && !siteMode, nDue, 'Site dû ce mois selon le plan mais non retenu, faute de capacité du bureau', siteMode),
      mapChk('Sites non suivis', v => { MAPP.nov = v; re(); }, MAPP.nov && !siteMode, nNov, 'Sites actifs du plan sans visite sur ' + mapWin(M) + ' (pointillé : jamais visité)', siteMode),
      mapChk('Sites inactifs ce mois', v => { MAPP.off = v; re(); }, MAPP.off, nOff, 'Inactif au plan, grille du mois à Non ou zone interdite'),
      mapChk('Alertes non revisitées seulement', v => { MAPP.nr = v; re(); }, MAPP.nr, nNR, 'Dernière visite connue du site, avec au moins une alerte', siteMode),
      el('p', { class: 'mapx-ddt', text: 'Zones' }),
      mapSel('Fond des régions', [['score', 'Score moyen'], ['visits', 'Nombre de visites'], ['risk', '% visites avec alerte'], ['cov', 'Couverture du plan'], ['none', 'Aucun']], MAPP.fond, v => { MAPP.fond = v; re(); }),
      mapChk('Bulles par district', v => { MAPP.bub = v; re(); }, MAPP.bub, null, 'Taille et nombre : sites dus non planifiés. Couleur : couverture du plan'),
      el('p', { class: 'mapx-ddt', text: 'Options' }),
      M.vis.some(v => v.act === 'SMP') && MAP_HH >= 0 ? mapChk('Ignorer l’alerte SMP à confirmer', v => { MAPP.exHH = v; re(); }, MAPP.exHH, null, riskLabel('SMP', MAP_HH) + ' (HHDistDiv) : question sans libellé français, probablement mal comprise (voir Qualité)') : null,
      mapChk('Regrouper les points proches', v => { MAPP.clu = v; re(); }, MAPP.clu, null, 'En vue large, les points proches forment un cercle, plus grand s’il y a plus de points. Un clic zoome.')
    ]));
    // ---- une ligne de réglages
    const bar = el('div', { class: 'mapx-bar' }, [
      mapSel('Couleur', [['—', 'Visites'], ['score', 'Score'], ['act', 'Activité'], ['org', 'Partenaire de suivi (TPM)'], ['imp', 'Partenaire de mise en œuvre'], ['alert', 'Alertes'],
        ['—', 'Sites du plan'], ['risk', 'Risque du site'], ['plan', 'Plan du mois']], MAPP.mode, v => { MAPP.mode = v; re(); }),
      M.months.length && mapNeedsMonth() ? mapSel('Mois du plan', M.months.map(m => [m, monthLabel(m)]), M.month, v => { MAPP.month = v; re(); }, 'Mois du plan en cours (horizon réglé dans Planification)') : null,
      det,
      mapBtn('Recadrer', () => { MAPV.vb = mapAutoFit(MAPV.M); MAPV.manual = false; mapApplyView(true); })
    ]);
    bar.lastChild.title = 'Recadrer sur les points affichés';
    const sp = mapSitePts(M);
    const vShown = siteMode ? 0 : M.visGeo.length;
    // ---- aucune donnée
    if (!vShown && !sp.length) {
      const why = !M.vis.length ? 'Aucune visite pour ces filtres' : siteMode ? 'Aucun site à afficher' : 'Visites sans GPS';
      const why2 = !M.sites.length ? 'aucun site du plan dans cette zone' : fmt(M.sites.length) + ' sites masqués par les couches';
      const box = el('div', { class: 'mapx-empty', role: 'status' }, [el('p', { class: 'mapx-et', text: 'Rien à afficher' }), el('p', { text: why + (siteMode ? '' : ', ' + why2) + '. Élargissez la période ou retirez un filtre.' }), mapBtn('Réinitialiser les filtres', mapReset)]);
      main.appendChild(card(title, null, [bar, box]));
      return;
    }
    // ---- carte
    const svg = sv('svg', { class: 'mapx-svg', role: 'img', 'aria-label': 'Carte de Madagascar : ' + fmt(vShown) + ' visites et ' + fmt(sp.length) + ' sites affichés. Le tableau Régions sous la carte donne les mêmes chiffres.' });
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const defs = sv('defs'), pat = sv('pattern', { id: 'mapx-hatch', patternUnits: 'userSpaceOnUse', width: 0.09, height: 0.09, patternTransform: 'rotate(45)' });
    pat.appendChild(sv('rect', { width: 0.09, height: 0.09, fill: 'rgba(150,160,170,.08)' })); pat.appendChild(sv('line', { x1: 0, y1: 0, x2: 0, y2: 0.09, stroke: 'rgba(90,100,112,.30)', 'stroke-width': 0.02 }));
    defs.appendChild(pat); svg.appendChild(defs);
    const L = { reg: sv('g'), lab: sv('g', { class: 'mapx-lab' }), bub: sv('g'), site0: sv('g'), vis: sv('g'), site: sv('g') };
    MAPV.layers = L; MAPV.svg = svg; MAPV.marks = [];
    Object.values(L).forEach(g => svg.appendChild(g));
    const zc = el('div', { class: 'mapctl mapx-ctl' });
    [['+', 1 / 1.5, 'Zoom avant'], ['−', 1.5, 'Zoom arrière']].forEach(([t, f, lab]) => { const b = el('button', { class: 'btn', type: 'button', text: t, title: lab, 'aria-label': lab }); b.addEventListener('click', () => mapZoom(f)); zc.appendChild(b); });
    const pays = el('button', { class: 'btn', type: 'button', text: 'Pays', title: 'Vue d’ensemble du pays', 'aria-label': 'Vue d’ensemble du pays' }); pays.addEventListener('click', () => { MAPV.vb = mapAspect(MAP_ALL); MAPV.manual = true; MAPV.fit = { kind: 'pays' }; mapApplyView(true); }); zc.appendChild(pays);
    const view = el('span', { class: 'mapx-view', id: 'mapx-view', role: 'status' });
    const mw = el('div', { class: 'mapwrap' }, [svg, zc, view]);
    const banner = !vShown && !siteMode ? el('p', { class: 'note warn', text: (M.vis.length ? 'Visites sans GPS' : 'Aucune visite pour ces filtres') + ', seuls les sites sont affichés.' }) : null;
    const left = el('div', { class: 'mapx-left' }, [banner, mw, mapLegend(M)]);
    const row = el('div', { class: 'mapx-row' }, [left, mapSummary(M)]);
    const c = card(title, null, [bar, row]);
    const ch = c.querySelector('.ch'); if (ch && !ch.querySelector('.info')) { const ib = mapInfo('Molette ou pincement pour zoomer, glisser pour se déplacer. Clic sur un point : fiche du site. Clic sur une région : détail de la région. La carte se recadre à chaque changement de filtre. ' + mapMethodText()); if (ib) ch.appendChild(ib); }
    main.appendChild(c);
    // ---- mesure de la zone d'affichage, puis recadrage (le filtre l'emporte sur le zoom manuel)
    const r = svg.getBoundingClientRect(); MAPV.W = Math.max(200, r.width || 800); MAPV.H = Math.max(200, r.height || 600);
    if (refit) { MAPV.vb = mapAutoFit(M); MAPV.manual = false; }
    mapSetVB();
    // fond régional (teintes claires) + nom des régions concernées ; chiffres au survol et au clic
    (D.geo || []).forEach(f => {
      const polys = f.type === 'Polygon' ? [f.coords] : f.coords; let d = '';
      polys.forEach(poly => poly.forEach(ring => { ring.forEach((p, i) => { const q = project(p[0], p[1]); d += (i ? 'L' : 'M') + q[0].toFixed(3) + ' ' + q[1].toFixed(3); }); d += 'Z'; }));
      const k = mapRegKey(f.name), b = M.reg.get(k), fl = mapRegFill(b, M);
      const path = sv('path', { d, class: 'region', fill: fl.fill }); if (fl.op) path.setAttribute('fill-opacity', fl.op); path._d = { k: 'reg', key: k, name: f.name }; L.reg.appendChild(path);
      if (b && (b.vis.length || b.sites.length)) { const ce = mapCentroid(f); if (ce) { const t1 = sv('text', { 'text-anchor': 'middle' }); t1.textContent = f.name; mapMark(L.lab, ce[0], ce[1], [t1], null, true); } }
    });
    mapDrawPoints();
    mapInteract(svg);
    if (MAPV.ro) MAPV.ro.disconnect();
    if (window.ResizeObserver) { MAPV.ro = new ResizeObserver(() => { const b = svg.getBoundingClientRect(); if (b.width > 50 && (Math.abs(b.width - MAPV.W) > 1 || Math.abs(b.height - MAPV.H) > 1)) { MAPV.W = b.width; MAPV.H = b.height; mapRescale(); } }); MAPV.ro.observe(svg); }
    mapViewText();
    main.appendChild(mapRegionTable(M));
    if (/debug/.test(location.hash)) window.__dashMap = { MAPP, MAPV, model: () => MAPV.M, ms: M.ms, renderMs: Math.round(performance.now() - M.t0) };
  }

  // ---------------------------------------------------------------- légende compacte (couche et mode actifs, avec comptes)
  function mapLegend(M) {
    const items = [], siteMode = mapIsSiteMode(), sep = () => items.push(el('span', { class: 'mapx-sep', text: '|' }));
    const it = (sw, t, title) => { const s = el('span', { class: 'mapx-li', title: title || null }, [sw, t]); items.push(s); };
    if (!siteMode && MAPP.vis) {
      const pts = MAPP.nr ? M.visGeo.filter(v => M.lastAlert.has(v)) : M.visGeo;
      const vm = mapVisitMode(M), cnt = {}; pts.forEach(v => { const k = vm.of(v); cnt[k] = (cnt[k] || 0) + 1; });
      items.push(el('b', { text: (MAPP.nr ? 'Alertes non revisitées' : 'Visites') + ' (' + fmt(pts.length) + ') :' }));
      vm.classes.filter(c => cnt[c[0]]).forEach(c => it(mapSw('vis', c[1]), c[2] + ' (' + fmt(cnt[c[0]]) + ')'));
      if (MAPP.mode === 'score') { const a = pts.filter(v => mapRisks(v).length).length; it(mapSw('vis', '#ffffff', true), 'contour noir = alerte (' + fmt(a) + ')', nOf(a, pts.length, 'visites avec au moins 1 alerte')); }
    }
    const sp = mapSitePts(M);
    if (siteMode) {
      const sm = mapSiteMode(M), cnt = {}; sp.forEach(s => { const k = sm.of(s); cnt[k] = (cnt[k] || 0) + 1; });
      items.push(el('b', { text: 'Sites (' + fmt(sp.length) + ') :' }));
      sm.classes.filter(c => cnt[c[0]]).forEach(c => it(MAPP.mode === 'plan' ? mapSw(MAP_STG[c[0]], c[1]) : c[0] === 'off' ? mapSw('off', c[1]) : mapSw('site', c[1]), c[2] + ' (' + fmt(cnt[c[0]]) + ')'));
    } else if (sp.length) {
      const cnt = { plan: 0, due: 0, done: 0, nov: 0, never: 0, off: 0 }; sp.forEach(s => { cnt[s.lay]++; });
      if (items.length) sep();
      items.push(el('b', { text: 'Sites' + (M.month && (MAPP.rbm || MAPP.due) ? ' (' + monthLabel(M.month) + ')' : '') + ' :' }));
      if (MAPP.rbm) { it(mapSw('plan', MAP_ST.plan[0]), 'planifiés (' + fmt(cnt.plan) + ')'); if (cnt.done) it(mapSw('done', MAP_ST.done[0]), 'visités ce mois (' + fmt(cnt.done) + ')'); }
      if (MAPP.due) it(mapSw('due', MAP_ST.due[0]), 'dus non planifiés (' + fmt(cnt.due) + ')');
      if (MAPP.nov) { it(mapSw('nov'), 'non suivis ' + mapWin(M) + ' (' + fmt(cnt.nov) + ')'); it(mapSw('never'), 'jamais visités (' + fmt(cnt.never) + ')'); }
      if (MAPP.off) it(mapSw('off', MAP_ST.off[0]), 'inactifs (' + fmt(cnt.off) + ')');
    }
    if (MAPP.bub) { sep(); it(mapSw('site', mapCovColor(70)), 'bulles : couverture (couleur), dus non planifiés (nombre)'); }
    const box = (c, cl) => { const i = el('i', { class: 'mapx-fb' + (cl ? ' ' + cl : '') }); if (c) i.style.background = c; return i; };
    const fd = MAPP.fond;
    if (fd !== 'none') {
      sep(); items.push(el('b', { text: 'Fond :' }));
      if (fd === 'score') { it(box(MAP_FOND.good), '≥ ' + THR.good); it(box(MAP_FOND.mid), THR.mid + '–' + THR.good); it(box(MAP_FOND.bad), '< ' + THR.mid); }
      if (fd === 'risk') { it(box(MAP_FOND.good), 'alerte ≤ ' + THR.rLow + ' %'); it(box(MAP_FOND.mid), THR.rLow + '–' + THR.rHigh + ' %'); it(box(MAP_FOND.bad), '> ' + THR.rHigh + ' %'); }
      if (fd === 'visits') { const mx = Math.max(0, ...Array.from(M.reg.values()).map(x => x.vis.length)); it(box('rgba(10,110,189,.08)'), '1'); it(box('rgba(10,110,189,.46)'), fmt(mx) + ' visites'); }
      if (fd === 'cov') { it(box(mapCovColor(0)), '0 %'); it(box(mapCovColor(100)), '100 % des sites actifs visités'); }
      if (fd !== 'visits') it(box(null, 'mapx-hb'), 'indicatif', 'Hachuré : ' + SMALL_N.min + ' à ' + (SMALL_N.low - 1) + ' observations (indicatif) ; gris : moins de ' + SMALL_N.min + ' (non calculé)');
    }
    const ib = typeof infoBtn === 'function' ? infoBtn(mapMethodText()) : null;
    return el('div', { class: 'mapx-leg' }, items.concat([ib]));
  }
  function mapMethodText() {
    return 'Une visite est placée au GPS médian de ses fiches, un site aux coordonnées du plan. La région d’une visite est celle de la fiche ou du plan, pas le GPS. Vatovavy et Fitovinany sont regroupées sur le fond. Fond gris : moins de ' + SMALL_N.min + ' observations ; hachuré : ' + SMALL_N.min + ' à ' + (SMALL_N.low - 1) + ', indicatif. En vue large, les points proches sont regroupés (couleur : score moyen du groupe, ou classe la plus fréquente). Limites régionales simplifiées : Highcharts Map Collection, CC BY.';
  }

  // ---------------------------------------------------------------- synthèse : 4 chiffres clés (gardée à la demande de l'utilisateur) + détail dans le tiroir
  const mapInfo = t => typeof infoBtn === 'function' ? infoBtn(t) : null;
  function mapXs(title, kids, info) { const x = xsec(title, kids); if (info) { const h = x.querySelector('h3'); const b = mapInfo(info); if (h && b) { h.classList.add('mapx-h3'); h.appendChild(b); } } return x; }
  function mapSR(k, v, sub, info) { return el('div', { class: 'mapx-sr' }, [el('div', { class: 'k' }, [k, info ? mapInfo(info) : null]), el('div', { class: 'v', text: v }), sub ? el('div', { class: 's', text: sub }) : null]); }
  function mapKey(label, value, base, cl, tip) {
    const k = el('div', { class: 'mapx-k', role: 'button', tabindex: '0', 'aria-label': label + ' : ' + value + (base ? ', ' + base : '') + '. Ouvrir le détail' }, [el('div', { class: 'l', text: label }), el('div', { class: 'v' + (cl ? ' ' + cl : ''), text: value }), base ? el('div', { class: 'b', text: base }) : null]);
    if (tip) bindTip(k, () => tip + '\nCliquer pour le détail');
    k.addEventListener('click', () => mapOpenDetail()); k.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mapOpenDetail(); } });
    return k;
  }
  function mapSummary(M) {
    const av = mapAggVis(M.vis), as = mapAggSites(M.sites);
    const cv = M.cov ? { n: M.cov.visited, N: M.cov.planned } : { n: as.n, N: as.N };
    const kids = [el('h3', { text: 'Sélection' })];
    kids.push(mapKey('Visites', fmt(M.visGeo.length), 'sur ' + fmt(M.N) + ' dans le fichier', null, nOf(M.visGeo.length, M.N, 'visites exploitables affichées') + (M.vis.length > M.visGeo.length ? '\n' + fmt(M.vis.length - M.visGeo.length) + ' sans GPS, non affichées' : '')));
    kids.push(mapKey('Score moyen', av.scN && nStatus(av.scN) !== 'na' ? fmt(av.mean, 1) + ' / 100' : 'n.c.', 'sur ' + fmt(av.scN) + ' visites', av.scN && nStatus(av.scN) === 'ok' ? cls(av.mean) : null, 'Score moyen sur 100, ' + fmt(av.scN) + ' visites\nRepères : ' + scoreRefText()));
    kids.push(mapKey('Avec alerte', av.n ? fmt(av.al) : '–', av.n ? 'sur ' + fmt(av.n) + ' visites, ' + pct(av.al / av.n * 100) : null, null, av.n ? nOf(av.al, av.n, 'visites avec au moins une alerte') + '\nRepères : ' + riskRefText() : ''));
    kids.push(mapKey('Couverture', M.cov && M.cov.outOfYear ? 'hors année' : cv.N ? fmt(cv.n) : '–', M.cov && M.cov.outOfYear ? 'période hors de l’année du plan' : cv.N ? 'sur ' + fmt(cv.N) + ' sites, ' + pct(cv.n / cv.N * 100) : 'aucun site actif', null, mapCovDef() + '\nFenêtre : ' + mapWin(M)));
    const b = el('button', { class: 'mapx-lnk', type: 'button', text: 'Voir le détail' }); b.addEventListener('click', () => mapOpenDetail()); kids.push(b);
    return el('aside', { class: 'mapx-sum', 'aria-label': 'Chiffres clés de la sélection' }, kids);
  }
  function mapOpenDetail() {
    const M = MAPV.M; if (!M) return;
    const av = mapAggVis(M.vis), as = mapAggSites(M.sites);
    const keys = new Set(), off = new Set(); M.vis.forEach(v => { const k = M.keyOf(v) || ('n' + v.site); keys.add(k); if (!M.byKey.has(k)) off.add(k); });
    const byAct = ACTS.map(a => [a, mapAggVis(M.vis.filter(v => v.act === a))]).filter(z => z[1].n);
    const actTxt = byAct.map(([a, g]) => ACT[a].short + ' ' + (nStatus(g.scN) === 'na' ? 'n.c.' : fmt(g.mean, 1)) + (nStatus(g.scN) === 'low' ? '*' : '')).join(', ');
    const R = M.rbm, cfg = R.cfg || {};
    const zoneScored = M.sites.filter(s => s.sc);
    const dueH = zoneScored.filter(s => s.sc.due && M.lastM && s.sc.due <= M.lastM).length, plannedH = zoneScored.filter(s => s.pm.length).length;
    const stM = { plan: 0, due: 0, done: 0 }; M.sites.forEach(s => { if (stM[s.st] !== undefined) stM[s.st]++; });
    const lv = { high: 0, med: 0, low: 0, never: 0 }; zoneScored.forEach(s => { const c = mapCat(s.sc); lv[c] = (lv[c] || 0) + 1; });
    const nrN = M.vis.filter(v => M.lastAlert.has(v)).length;
    const covN = M.cov ? M.cov.planned : as.N, covV = M.cov ? M.cov.visited : as.n;
    const kids = [];
    kids.push(mapSR('Visites affichées', nOf(M.visGeo.length, M.N, 'visites du fichier'), M.vis.length > M.visGeo.length ? fmt(M.vis.length - M.visGeo.length) + ' sans GPS, non affichées' : null, 'Visites exploitables qui passent les filtres du haut, du ' + monthLabel(F.m0) + ' au ' + monthLabel(F.m1) + '. Position d’une visite : GPS médian de ses fiches.'));
    kids.push(mapSR('Sites visités', fmt(keys.size), off.size ? 'dont ' + fmt(off.size) + ' hors plan de suivi' : null, 'Sites distincts ayant au moins une visite dans la sélection. Un site hors plan ne peut pas être planifié.'));
    kids.push(mapSR('Score moyen', av.scN ? fmt(av.mean, 1) + ' sur 100, ' + fmt(av.scN) + ' visites' : 'non calculé', actTxt ? 'Par activité : ' + actTxt : null, 'Repères : ' + scoreRefText() + '. La moyenne toutes activités dépend du poids de chaque activité : mieux vaut comparer par activité. * = moins de ' + SMALL_N.low + ' visites, indicatif.'));
    kids.push(mapSR('Visites avec alerte', av.n ? nOf(av.al, av.n, 'visites') : 'non mesuré', M.vis.some(v => v.act === 'SMP') && MAP_HH >= 0 ? 'Sans l’alerte SMP à confirmer : ' + nOf(av.alX, av.n, '') : null, 'Au moins une alerte critique dans la visite. Repères : ' + riskRefText() + '. L’alerte SMP « ' + (MAP_HH >= 0 ? riskLabel('SMP', MAP_HH) : '') + ' » (HHDistDiv) est probablement mal comprise : voir l’onglet Qualité.'));
    kids.push(mapSR('Couverture du plan', covN ? nOf(covV, covN, 'sites actifs') : 'aucun site actif', covN ? 'Jamais visités : ' + fmt(M.cov ? M.cov.never : as.never) : null, mapCovDef() + ' Fenêtre : ' + mapWin(M) + '.'));
    if (R.ok && M.month) {
      kids.push(mapSR('Plan de ' + monthLabel(M.month), fmt(stM.plan) + ' planifiés, ' + fmt(stM.due) + ' dus non planifiés', 'Sur l’horizon : ' + fmt(plannedH) + ' planifiés, ' + fmt(M.over.cap) + ' refusés faute de capacité' + (M.over.grid ? ', ' + fmt(M.over.grid) + ' inactifs' : ''),
        'Horizon ' + monthLabel(M.months[0]) + ' à ' + monthLabel(M.lastM) + ' : ' + fmt(dueH) + ' sites dus. Le plan part de tout l’historique de chaque site : la période et les partenaires ne s’y appliquent pas.'));
      kids.push(mapSR('Risque des sites', fmt(lv.high) + ' élevés, ' + fmt(lv.med) + ' moyens, ' + fmt(lv.low) + ' faibles', lv.never ? fmt(lv.never) + ' jamais visités, risque non mesuré' : null, 'Seuils du plan : élevé à partir de ' + fmt(cfg.thHigh) + ', moyen à partir de ' + fmt(cfg.thMed) + ' sur 100.'));
    } else kids.push(mapSR('Plan', 'non disponible', R.err || null));
    kids.push(mapSR('Alertes non revisitées', fmt(nrN) + ' sites', null, 'Sites dont la dernière visite porte au moins une alerte, sans visite depuis. Menu Couches pour les afficher seuls.'));
    openDrawer('Détail de la sélection', null, [el('div', { class: 'mapx-dsum' }, kids), el('p', { class: 'hint', text: mapMethodText() })]);
  }

  // ---------------------------------------------------------------- tableau des régions (replié ; accès clavier au détail)
  function mapRegionTable(M) {
    const names = {}; (D.geo || []).forEach(f => { names[mapRegKey(f.name)] = f.name; });
    const rows = Array.from(M.reg.values()).map(b => { const av = mapAggVis(b.vis), as = mapAggSites(b.sites);
      return { key: b.k, reg: names[b.k] || mapName(b), n: av.n, sc: nStatus(av.scN) === 'na' ? null : av.mean, scN: av.scN, al: av.n >= SMALL_N.min ? av.alM / av.n * 100 : null, alN: av.alM, cov: as.N >= SMALL_N.min ? as.n / as.N * 100 : null, covN: as.n, covD: as.N }; })
      .filter(r => r.n || r.covD);
    const tipCell = (txt, tip) => { const s = el('span', { text: txt }); if (tip) bindTip(s, () => tip); return s; };
    const t = table([{ k: 'reg', t: 'Région' }, { k: 'n', t: 'Visites', num: 1, fmt: r => fmt(r.n) },
      { k: 'sc', t: 'Score', num: 1, title: 'Score moyen sur 100. n.c. sous ' + SMALL_N.min + ' visites, * indicatif sous ' + SMALL_N.low, fmt: r => tipCell(r.sc === null ? 'n.c.' : fmt(r.sc, 1) + (nStatus(r.scN) === 'low' ? '*' : ''), fmt(r.scN) + ' visites scorées') },
      { k: 'al', t: 'Alertes', num: 1, title: 'Visites avec au moins une alerte' + (MAPP.exHH ? ', sans l’alerte SMP à confirmer' : ''), fmt: r => tipCell(r.al === null ? 'n.c.' : pct(r.al), fmt(r.alN) + ' sur ' + fmt(r.n) + ' visites') },
      { k: 'cov', t: 'Couverture', num: 1, title: 'Sites actifs suivis sur sites actifs de la région', fmt: r => r.covD ? tipCell(fmt(r.covN) + '/' + fmt(r.covD), r.cov === null ? 'moins de ' + SMALL_N.min + ' sites' : pct(r.cov, 1)) : '–' }],
    rows, { sortK: 1, onRow: r => mapOpenZone('reg', r.key) });
    const det = el('details', { class: 'mapx-rt' }); det.open = !!MAPV.rtOpen; det.addEventListener('toggle', () => { MAPV.rtOpen = det.open; });
    det.appendChild(el('summary', { text: 'Régions (' + fmt(rows.length) + ')' }));
    det.appendChild(t);
    return el('div', { class: 'card mapx-tab' }, [det]);
  }

  // ---------------------------------------------------------------- tiroir : site
  function mapGoTab(tab, prep) { return () => { closeDrawer(); try { if (prep) prep(); } catch (e) { /* onglet sans recherche */ } TAB = tab; buildTabs(); render(); window.scrollTo(0, 0); }; }
  function mapVisitTable(list) {
    const rows = list.slice().reverse().slice(0, 8);
    return table([{ k: 'date', t: 'Date', fmt: r => dFrUI(r.date) }, { k: 'score', t: 'Score /100', num: 1, fmt: r => { const k = cls(r.score); return el('span', null, [cellTxt(r.score), ' ' + (k === 'na' ? '' : CLS_TXT[k].split(' (')[0].toLowerCase())]); } },
      { k: 'al', t: 'Alertes', fmt: r => r.risks.length ? r.risks.map(j => riskLabel(r.act, j)).join(' ; ') : 'aucune', sortVal: r => r.risks.length },
      { k: 'ag', t: 'Agent(s)', fmt: r => r.enus.map(e => DICT.enu[e]).filter(Boolean).join(', ') || '–' }, { k: 'org', t: 'TPM', fmt: r => DICT.org[r.org] || '–' }], rows);
  }
  function mapRbmTable(s, cfg) {
    if (Array.isArray(s.sc.factors) && s.sc.factors.length) {     // facteurs détaillés du moteur de planification (une seule source)
      const t = el('table', { class: 'xt' });
      t.appendChild(el('thead', null, el('tr', null, ['Facteur', 'Valeur réelle', 'Règle', 'Facteur (0–1)', 'Points / max'].map((h, i) => el('th', { scope: 'col', class: i >= 3 ? 'num' : '', text: h })))));
      const tb = el('tbody');
      s.sc.factors.forEach(x => tb.appendChild(el('tr', { class: x.na ? 'xna' : '' }, [el('td', null, el('b', { text: x.l || x.k })), el('td', { text: x.raw || '–' }), el('td', { text: x.rule || '–' }), el('td', { class: 'num', text: x.na ? 'sans objet' : fmt(x.f, 2) }), el('td', { class: 'num', text: x.na ? '—' : fmt(x.pts, 1) + ' / ' + fmt(x.max, 1) })])));
      t.appendChild(tb);
      t.appendChild(el('tfoot', null, el('tr', null, [el('td', { colspan: '4', text: 'Score de risque R = somme des points des facteurs mesurés (poids total ' + fmt(s.sc.wsum) + ' ; les facteurs « sans objet » sont retirés)' }), el('td', { class: 'num', text: fmt(s.sc.R, 1) + ' / 100' })])));
      return el('div', { class: 'tw' }, t);
    }
    const sc = s.sc, w = cfg.w || {}, ws = Object.values(w).reduce((a, x) => a + Math.max(0, +x || 0), 0) || 1, comp = sc.comp || {};
    const l = s.hist, last2 = l.slice(-2), ref = localDay(), rd = Math.max(30, +cfg.recencyDays || 180);
    const lab = {}; (typeof RBM_W !== 'undefined' && Array.isArray(RBM_W) ? RBM_W : []).forEach(x => { lab[x[0]] = x[1]; });
    const raw = {
      score: [last2.length ? 'Moyenne des ' + last2.length + ' dernière(s) visite(s) : ' + last2.map(v => fmt(v.score, 0) + ' (' + dFrUI(v.date) + ')').join(' et ') : 'Aucune visite scorée : facteur fixé à 0,5', '0 si ≥ cible ' + fmt(cfg.target) + ' ; maximum si ≤ ' + fmt((+cfg.target || 0) - 35)],
      alert: [s.lastV ? fmt(s.lastRisks.length) + ' alerte(s) à la dernière visite' + (s.lastRisks.length ? ' : ' + s.lastRisks.map(j => riskLabel(s.act, j)).join(' ; ') : '') : 'Jamais visité : 0', 'maximum dès 2 alertes'],
      never: [s.nVis ? 'Non (' + fmt(s.nVis) + ' visite(s))' : 'Oui', '1 si aucune visite exploitable'],
      recency: [s.nVis ? 'Dernière visite le ' + dFrUI(s.last) + ', il y a ' + fmt(mapDays(s.last, ref)) + ' j' : 'Jamais visité : maximum', 'maximum dès ' + fmt(rd) + ' j'],
      partner: [sc.imp ? 'Partenaire ' + sc.imp + (sc.g ? ' noté ' + sc.g : ' non noté') : 'Non renseigné' + (s.act === 'SMP' || s.act === 'RES' ? ' (champ absent du formulaire ' + ACT[s.act].short + ')' : '') + ' : 0,3', 'D 1 · C 0,6 · B 0,2 · A 0 · inconnu 0,3']
    };
    const t = el('table', { class: 'xt' });
    t.appendChild(el('thead', null, el('tr', null, ['Facteur', 'Valeur réelle', 'Règle', 'Facteur (0–1)', 'Points / max'].map((h, i) => el('th', { scope: 'col', class: i >= 3 ? 'num' : '', text: h })))));
    const tb = el('tbody'); let tot = 0;
    Object.keys(w).forEach(k => { const f = +comp[k] || 0, pts = Math.max(0, +w[k] || 0) * f / ws * 100, mx = Math.max(0, +w[k] || 0) / ws * 100; tot += pts;
      tb.appendChild(el('tr', null, [el('td', null, el('b', { text: lab[k] || k })), el('td', { text: (raw[k] || ['–'])[0] }), el('td', { text: (raw[k] || ['', '–'])[1] }), el('td', { class: 'num', text: fmt(f, 2) }), el('td', { class: 'num', text: fmt(pts, 1) + ' / ' + fmt(mx, 1) })])); });
    t.appendChild(tb);
    t.appendChild(el('tfoot', null, el('tr', null, [el('td', { colspan: '4', text: 'Score de risque R = somme des points (poids ' + Object.keys(w).map(k => fmt(+w[k] || 0)).join(' / ') + ', total ' + fmt(ws) + ')' }), el('td', { class: 'num', text: fmt(sc.R, 1) + ' / 100' })])));
    return el('div', { class: 'tw' }, t);
  }
  function mapWhyNotPlanned(s, M) {
    const R = M.rbm;
    if (!R.ok) return 'Planification RBM indisponible : ' + (R.err || 'erreur');
    const w = R.why ? R.why.get(s.j) : null;     // raisons écrites par le moteur de planification, mois par mois
    if (w && M.months.some(m => w[m] && w[m].txt)) return M.months.filter(m => w[m] && w[m].txt).map(m => monthLabel(m) + ' : ' + w[m].txt.replace(/^pas encore dû : prochaine échéance/, 'intervalle RBM non écoulé (prochaine visite possible à partir de') + (/^pas encore dû/.test(w[m].txt) ? ')' : '')).join(' · ');
    if (!s.actif) return 'Non planifié : site inactif au registre' + (s.motif ? ' (' + s.motif + ')' : '') + '.';
    if (s.security >= 99) return 'Non planifié : zone interdite (sécurité 99).';
    if (!s.sc) return 'Non planifié : site absent du calcul RBM.';
    if (!M.lastM || !s.sc.due) return 'Non planifié.';
    if (s.sc.due > M.lastM) return 'Non planifié : intervalle RBM non écoulé (prochaine visite possible à partir de ' + mapNext(s.sc) + ', intervalle minimal de ' + fmt(Math.max(1, +s.sc.freq || 1)) + ' mois pour un risque ' + mapLv(mapCat(s.sc))[1] + '), après l’horizon du plan (' + monthLabel(M.months[0]) + ' → ' + monthLabel(M.lastM) + ').';
    const okM = M.months.filter(m => m >= s.sc.due && mapElig(s, m));
    if (!okM.length) return 'Dû dès ' + monthLabel(s.sc.due) + ', mais la grille mensuelle du registre dit « Non » pour tous les mois restants de l’horizon : non planifiable.';
    const u = R.used[okM[0] + '|' + s.fo];
    return 'Dû dès ' + monthLabel(s.sc.due) + ' mais non retenu : capacité du bureau ' + (s.fo || '?') + ' atteinte' + (u ? ' (' + fmt(u.planned) + ' visites planifiées sur ' + fmt(u.cap) + ' possibles en ' + monthLabel(okM[0]) + ', pour ' + fmt(u.demand) + ' sites dus)' : '') + ' ; les sites au score de risque le plus élevé passent d’abord (ce site : ' + fmt(s.sc.R, 1) + ' / 100).';
  }
  function mapOpenSite(s, v) {
    const M = MAPV.M; if (!M) return;
    if (!s) return mapOpenOffPlan(v);
    const cfg = M.rbm.cfg || {}, l = s.hist, last = l[l.length - 1] || null;
    const fk = s.fokontany && String(s.fokontany) !== '0' && String(s.fokontany).toLowerCase() !== String(s.localite).toLowerCase() ? ', fokontany ' + s.fokontany : '';
    const kids = [];
    kids.push(mapXs('Site', [kvList([
      v ? ['Visite cliquée', dFrUI(v.date) + ', score ' + fmt(v.score, 1) + (v.risks.length ? ', ' + fmt(v.risks.length) + ' alerte(s)' : '')] : null,
      ['Activité', ACT[s.act] ? ACT[s.act].label : s.act], ['Lieu', [s.commune, s.district, s.region].filter(Boolean).join(', ') + fk || '–'], ['Bureau', s.fo || '–'],
      ['TPM', last ? DICT.org[last.org] || 'non renseigné' : 'jamais visité'], ['Partenaire', last ? DICT.imp[last.imp] || 'non renseigné' : 'jamais visité'],
      ['Statut', (s.actif ? 'Actif' : 'Inactif' + (s.motif ? ', ' + s.motif : '')) + (M.month && s.actif && !mapElig(s, M.month) ? ', non planifiable en ' + monthLabel(M.month) : '')],
      ['Sécurité', s.security === 0 ? 'Pas de restriction (à confirmer)' : mapSec(s.security)],
      ['Position', s.geo ? fmt(s.lat, 3) + ' ; ' + fmt(s.lon, 3) : 'non renseignée']])],
      'Code POI ' + s.code + (s.publicId ? ', ID ' + s.publicId : '') + '. TPM et partenaire : ceux de la dernière visite. Sécurité 0 est aussi la valeur par défaut quand rien n’a été saisi. Position : coordonnées du plan, arrondies.'));
    kids.push(mapXs('Visites', [l.length ? mapVisitTable(l) : el('p', { class: 'hint', text: 'Aucune visite.' })],
      fmt(s.nVis) + ' visites exploitables, dont ' + fmt(s.visP) + ' dans la période.' + (l.length > 8 ? ' Les 8 plus récentes sont listées (depuis le ' + dFrUI(l[0].date) + ').' : '')));
    if (s.sc) {
      const sc = s.sc, w = cfg.w || {}, ws = Object.values(w).reduce((a, x) => a + Math.max(0, +x || 0), 0) || 1;
      const r0 = (0.5 * (+w.score || 0) + (+w.never || 0) + (+w.recency || 0) + 0.3 * (+w.partner || 0)) / ws * 100;
      const cat = mapCat(sc), lvTxt = mapLv(cat)[1], ref = M.rbm.ref || localDay();
      const lim = Array.isArray(sc.factors)
        ? (cat === 'never' ? 'Site jamais visité : le risque n’est pas mesuré, le score théorique de ' + fmt(sc.R, 1) + ' ne veut rien dire. ' : '') + (sc.factors.some(x => x.na) ? 'Les facteurs sans objet sont retirés et leur poids redistribué. ' : '') + 'Score recalculé chaque jour, au ' + dFrUI(ref) + (M.rbm.dataEnd ? ', sur les visites jusqu’au ' + dFrUI(M.rbm.dataEnd) : '') + '.'
        : 'Un site jamais visité vaut toujours ' + fmt(r0, 1) + ' sur 100, quel que soit son risque réel. Jamais visité et délai comptent deux fois le même fait. SMP et RES n’ont pas de partenaire dans le formulaire. Score recalculé chaque jour, au ' + dFrUI(ref) + '.';
      const iv = el('span', { text: fmt(Math.max(1, +sc.freq || 1)) + ' mois (niveau ' + lvTxt + ', RBM) · ' + (s.last ? 'dernière visite le ' + dFrUI(s.last) : 'jamais visité') + ' · prochaine visite possible à partir de ' + mapNext(sc) });
      if (sc.freqSrc) bindTip(iv, () => 'Source : ' + sc.freqSrc);
      const calc = el('details', { class: 'mapx-calc' }, [el('summary', { text: 'Calcul du score' }), mapRbmTable(s, cfg), el('p', { class: 'hint', text: lim })]);
      kids.push(mapXs('Risque', [
        kvList([['Niveau', cat === 'never' ? lvTxt : lvTxt + ', ' + fmt(sc.R, 1) + ' sur 100'], ['Intervalle minimal entre deux suivis', iv],
          sc.team && sc.team.org ? ['Équipe prévue', sc.team.org] : null, ['Pourquoi', sc.why || '–'], ['À vérifier', sc.how || '–']]),
        calc, typeof plSiteDrawer === 'function' ? mapBtn('Détail du calcul de risque', () => { try { plSiteDrawer(s.j, M.month); } catch (e) { /* tiroir de planification indisponible */ } }) : null],
        'Seuils : élevé à partir de ' + fmt(cfg.thHigh) + ', moyen à partir de ' + fmt(cfg.thMed) + ' sur 100 (réglages du plan).'));
    } else kids.push(mapXs('Risque', [el('p', { class: 'hint', text: s.actif ? (s.security >= 99 ? 'Zone interdite, hors calcul.' : 'Hors calcul.') : 'Site inactif, hors calcul.' })]));
    kids.push(mapXs('Planification', [M.months.length ? kvList([['Prévu en', s.pm.length ? s.pm.map(monthLabel).join(', ') : 'aucun mois'], ['En ' + monthLabel(M.month), MAP_ST[s.st][1]]]) : null,
      s.pm.length ? null : el('p', { class: 'mapx-why', text: mapWhyNotPlanned(s, M) })], M.months.length ? 'Horizon du plan : ' + monthLabel(M.months[0]) + ' à ' + monthLabel(M.lastM) + '.' : null));
    kids.push(el('div', { class: 'mapx-acts' }, [mapBtn('Ouvrir la planification', mapGoTab('rbm')), mapBtn('Ouvrir dans Sites', mapGoTab('sites', () => { SITE_UI.q = s.code; SITE_UI.status = 'all'; }))]));
    openDrawer((s.localite || s.code) + ', ' + (ACT[s.act] ? ACT[s.act].short : s.act), (s.publicId ? s.publicId + ', ' : '') + 'code POI ' + s.code, kids);
  }
  function mapOpenOffPlan(v) {
    if (!v) return; const M = MAPV.M, key = M.keyOf(v); const idx = typeof siteIndex === 'function' ? siteIndex() : new Map(); const list = (key && idx.get(key)) || [v];
    const last = list[list.length - 1];
    openDrawer((DICT.site[v.site] || 'Site') + ', ' + (ACT[v.act] ? ACT[v.act].short : v.act), 'Hors plan de suivi', [
      el('p', { class: 'note warn', text: 'Site absent du plan : à ajouter pour pouvoir le planifier.' }),
      mapXs('Site', [kvList([['Activité', ACT[v.act] ? ACT[v.act].label : v.act], ['Lieu', [DICT.district[v.district], DICT.region[v.region]].filter(Boolean).join(', ') || '–'], ['Bureau', DICT.fo[v.fo] || '–'],
        ['TPM', DICT.org[last.org] || 'non renseigné'], ['Partenaire', DICT.imp[last.imp] || 'non renseigné']])], 'Informations tirées des fiches de visite. Sans code du plan, le site n’a ni risque, ni planification, ni situation sécuritaire. Ajout : onglet Données et mises à jour, import du plan.'),
      mapXs('Visites', [mapVisitTable(list)], fmt(list.length) + ' visites exploitables.'),
      el('div', { class: 'mapx-acts' }, [mapBtn('Ouvrir dans Sites', mapGoTab('sites'))])]);
  }

  function mapBars(fr) {     // une barre par alerte : n / N visites de son activité (jamais un % sans sa base)
    const mx = Math.max(1, ...fr.map(r => r.n));
    return el('div', { class: 'xh mapx-xh' }, fr.map(r => { const na = nStatus(r.tot) === 'na';
      const bar = el('i', { class: 'bg-' + (na ? 'na' : riskCls(r.p)) }); bar.style.width = Math.max(2, r.n / mx * 100) + '%';
      const row = el('div', { class: 'xh-r' }, [el('span', { class: 'xh-l', text: ACT[r.act].short + ', ' + riskLabel(r.act, r.r) + (r.act === 'SMP' && r.r === MAP_HH ? ' (à confirmer)' : '') }), el('span', { class: 'xh-b' }, bar),
        el('span', { class: 'xh-v', text: fmt(r.n) + '/' + fmt(r.tot) + (na ? '' : ' ' + pct(r.p)) })]);
      bindTip(row, () => riskLabel(r.act, r.r) + '\n' + fmt(r.n) + ' visites sur ' + fmt(r.tot) + ' visites ' + ACT[r.act].short + (na ? '\nMoins de ' + SMALL_N.min + ' visites : non interprétable' : ''));
      return row; }));
  }
  // ---------------------------------------------------------------- tiroir : région ou district
  function mapOpenZone(kind, key) {
    const M = MAPV.M; if (!M) return;
    const b = (kind === 'reg' ? M.reg : M.dis).get(key) || { k: key, names: {}, vis: [], sites: [] };
    const gname = kind === 'reg' ? ((D.geo || []).find(f => mapRegKey(f.name) === key) || {}).name : null;
    const name = gname || mapName(b);
    const vs = b.vis, ss = b.sites, av = mapAggVis(vs), as = mapAggSites(ss);
    const kids = [];
    const ds = vs.map(v => v.date).filter(Boolean).sort();
    const orgC = {}; vs.forEach(v => { const o = DICT.org[v.org] || 'non renseigné'; orgC[o] = (orgC[o] || 0) + 1; });
    kids.push(mapXs('Visites', [kvList([['Visites', fmt(av.n) + (av.n - av.gps ? ', dont ' + fmt(av.n - av.gps) + ' sans GPS' : '')], ['Sites', fmt(new Set(vs.map(v => M.keyOf(v) || v.site)).size)], ['Dates', ds.length ? dFrUI(ds[0]) + ' au ' + dFrUI(ds[ds.length - 1]) : '–'],
      ['TPM', Object.keys(orgC).sort((x, y) => orgC[y] - orgC[x]).slice(0, 4).map(o => o + ' ' + fmt(orgC[o])).join(', ') || '–']])],
      'Région ou district d’une visite : celui de la fiche ou du plan, pas le GPS. Les orthographes de district sont rapprochées (Toliary-II = Toliary-Ii).'));
    const byAct = ACTS.map(a => ({ a, g: mapAggVis(vs.filter(v => v.act === a)) })).filter(z => z.g.n);
    const big = byAct.slice().sort((p, q) => q.g.n - p.g.n)[0];
    kids.push(mapXs('Score', [
      el('p', null, [el('b', { text: av.scN ? (nStatus(av.scN) === 'na' ? nNote(av.scN, 'visites') : fmt(av.mean, 1) + ' sur 100') : 'non calculé' }), av.scN && nStatus(av.scN) !== 'na' ? ', ' + fmt(av.scN) + ' visites' : '']),
      table([{ k: 'a', t: 'Activité', fmt: r => ACT[r.a].short }, { k: 'n', t: 'Visites', num: 1, fmt: r => fmt(r.g.n), sortVal: r => r.g.n },
        { k: 's', t: 'Score', num: 1, sortVal: r => r.g.mean, fmt: r => nStatus(r.g.scN) === 'na' ? 'n.c.' : el('span', null, [cellTxt(r.g.mean), nStatus(r.g.scN) === 'low' ? '*' : '']) },
        { k: 'al', t: 'Alertes', num: 1, sortVal: r => r.g.n ? r.g.al / r.g.n : null, fmt: r => fmt(r.g.al) + '/' + fmt(r.g.n) }], byAct, { sortK: 1 }),
      byAct.length > 1 && big && big.g.n / av.n > 0.4 ? el('p', { class: 'hint', text: ACT[big.a].short + ' fait ' + pct(big.g.n / av.n * 100) + ' des visites : comparez par activité.' }) : null],
      'Score moyen sur 100. Repères : ' + scoreRefText() + '. n.c. sous ' + SMALL_N.min + ' visites, * indicatif sous ' + SMALL_N.low + '.'));
    const freq = riskFreq(vs).sort((p, q) => q.n - p.n);
    const top = freq.filter(r => nStatus(r.tot) !== 'na').slice(0, 3);
    const hhN = MAP_HH >= 0 ? vs.filter(v => v.act === 'SMP' && v.risks.includes(MAP_HH)).length : 0;
    kids.push(mapXs('Alertes', [
      el('p', null, [el('b', { text: av.n ? nOf(av.al, av.n, 'visites') : 'aucune visite' }), hhN ? ', ' + nOf(av.alX, av.n, '', 0) + ' sans l’alerte SMP à confirmer' : '']),
      top.length ? el('ol', { class: 'mapx-top' }, top.map(r => el('li', { text: ACT[r.act].short + ', ' + riskLabel(r.act, r.r) + ' : ' + fmt(r.n) + '/' + fmt(r.tot) + (r.act === 'SMP' && r.r === MAP_HH ? ' (à confirmer)' : '') }))) : el('p', { class: 'hint', text: 'Aucune alerte sur au moins ' + SMALL_N.min + ' visites.' }),
      freq.length > 3 ? el('details', { class: 'mapx-calc' }, [el('summary', { text: 'Toutes les alertes' }), mapBars(freq.slice(0, 10))]) : null],
      'Visites avec au moins une alerte. Chaque alerte est rapportée aux visites de son activité. Une alerte relevée sur moins de ' + SMALL_N.min + ' visites n’est jamais citée en tête. Repères : ' + riskRefText() + '.' + (hhN ? ' L’alerte SMP HHDistDiv (' + fmt(hhN) + ' visites) est probablement mal comprise.' : '')));
    const covAct = ACTS.map(a => ({ a, g: mapAggSites(ss.filter(s => s.act === a)) })).filter(z => z.g.N);
    kids.push(mapXs('Couverture', [
      el('p', null, [el('b', { text: as.N ? nOf(as.n, as.N, 'sites actifs') : 'aucun site actif' })]),
      covAct.length > 1 ? el('p', { class: 'hint', text: covAct.map(z => ACT[z.a].short + ' ' + fmt(z.g.n) + '/' + fmt(z.g.N)).join(', ') + '. Jamais visités : ' + fmt(as.never) + '.' }) : null],
      mapCovDef() + ' Fenêtre : ' + mapWin(M) + '.'));
    const dueL = ss.filter(s => s.over === 'cap').sort((p, q) => q.sc.R - p.sc.R);
    kids.push(mapXs('Planification', [M.rbm.ok && M.month ? kvList([['Planifiés en ' + monthLabel(M.month), fmt(as.plan)], ['Dus non planifiés', fmt(dueL.length)], ['Risque élevé', fmt(as.high) + ' sur ' + fmt(as.scored) + ' sites']]) : el('p', { class: 'hint', text: 'Plan indisponible.' }),
      dueL.length ? el('details', { class: 'mapx-calc' }, [el('summary', { text: 'Sites dus non planifiés' }), table([{ k: 'l', t: 'Site', fmt: r => (r.localite || r.code) + ' (' + ACT[r.act].short + ')' }, { k: 'R', t: 'Risque', num: 1, sortVal: r => r.sc.R, fmt: r => mapCat(r.sc) === 'never' ? 'jamais visité' : fmt(r.sc.R, 1) }, { k: 'due', t: 'Dû depuis', fmt: r => monthLabel(r.sc.due), sortVal: r => r.sc.due }], dueL.slice(0, 12), { onRow: r => mapOpenSite(r, null) })]) : null],
      'Dus non planifiés : sites dus sur l’horizon du plan mais refusés faute de capacité du bureau (12 premiers listés, risque décroissant).' + (ss.some(s => s.over === 'grid') ? ' ' + fmt(ss.filter(s => s.over === 'grid').length) + ' autres sont dus mais inactifs.' : '')));
    if (kind === 'reg') {
      const dl = mapDistricts(M).filter(d => d.rk === key);
      if (dl.length) kids.push(mapXs('Districts', [table([{ k: 'name', t: 'District' }, { k: 'n', t: 'Visites', num: 1, sortVal: r => r.av.n, fmt: r => fmt(r.av.n) },
        { k: 's', t: 'Score', num: 1, sortVal: r => r.av.mean, fmt: r => nStatus(r.av.scN) === 'na' ? 'n.c.' : fmt(r.av.mean, 1) + (nStatus(r.av.scN) === 'low' ? '*' : '') },
        { k: 'al', t: 'Alertes', num: 1, sortVal: r => r.av.n ? r.av.al / r.av.n : null, fmt: r => nStatus(r.av.n) === 'na' ? 'n.c.' : pct(r.av.al / r.av.n * 100) },
        { k: 'c', t: 'Couverture', num: 1, sortVal: r => r.a.N ? r.a.n / r.a.N : null, fmt: r => r.a.N ? fmt(r.a.n) + '/' + fmt(r.a.N) : '–' }, { k: 'd', t: 'Dus', num: 1, title: 'Sites dus non planifiés', sortVal: r => r.a.due, fmt: r => fmt(r.a.due) }], dl, { sortK: 1, onRow: r => mapOpenZone('dis', r.k) })],
        'n.c. sous ' + SMALL_N.min + ' visites, * indicatif sous ' + SMALL_N.low + '. Dus : sites dus non planifiés. Une ligne ouvre le district.'));
    }
    openDrawer((kind === 'reg' ? 'Région ' : 'District ') + name, fmt(av.n) + ' visites, ' + fmt(as.N) + ' sites actifs', kids);
  }
