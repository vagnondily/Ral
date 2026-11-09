  // ================================================================== AIDES COMMUNES (injectées) : textes calculés, barèmes, périodes
  function dFrUI(s) { return s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) + '/' + String(s).slice(0, 4) : '–'; }
  function planYearUI() {
    if (D.planYear) return String(D.planYear);
    const PF = D.planFull || { cols: [], rows: [] }, j = PF.cols.indexOf('annee'); const c = {};
    PF.rows.forEach(r => { const y = r[j]; if (y !== null && y !== undefined && y !== '') c[y] = (c[y] || 0) + 1; });
    const ks = Object.keys(c).sort((a, b) => c[b] - c[a]); return ks[0] || (D.period ? String(D.period[1]).slice(0, 4) : '');
  }
  function winLabel() { const w = D.window || {}; return w.from ? 'du ' + dFrUI(w.from) + ' au ' + dFrUI(w.to) : 'période du suivi'; }
  // Sites distincts suivis (visites exploitables, filtres appliqués) pour une activité
  function sitesFollowed(a) { return new Set(fv(v => v.act === a && v.valid).map(v => v.site)).size; }
  // La couverture n'a de sens que si le plan liste au moins la moitié des sites réellement suivis
  function coverageComputable(a, cp) { const seen = sitesFollowed(a); return cp.planned > 0 && (!seen || cp.planned >= seen / 2); }
  function resCoverageNote() {
    const out = [];
    ACTS.forEach(a => { const cp = coverage(a, -1), seen = sitesFollowed(a); if (seen && cp.planned < seen / 2) out.push(ACT[a].short + ' : le plan ne liste que ' + fmt(cp.planned) + ' site(s) actif(s) alors que ' + fmt(seen) + ' ont été suivis – couverture non calculable'); });
    return out.length ? ' ' + out.join(' ; ') + '.' : '';
  }
  function autresNote() {
    const SC = D.subs.cols, io = SC.indexOf('org');
    const nOrg = io < 0 ? 0 : D.subs.rows.filter(r => String(r[io]) === 'Autres' || String(r[io]) === 'AUTRES').length;
    const ia = DICT.imp.findIndex(x => /^autres/i.test(String(x || '')));
    const nImp = ia < 0 ? 0 : V.filter(v => v.imp === ia).length;
    return fmt(nOrg) + ' fiche(s) avec l’organisation « Autres », ' + fmt(nImp) + ' visite(s) avec le partenaire « Autres »';
  }
  function formRiskNote() {
    const R = D.formRisk || {}, c = (D.formCmp || {}).GD;
    if (R.ScoreRisk_raw_max === 0) return 'GD/PREVMA : la composante « risques » de l’indice du formulaire n’est jamais déduite (ScoreRisk_raw maximal = 0 sur les visites importées) alors que ' + pct(R.visitsWithRisk) + ' des visites recalculées présentent au moins une alerte critique : l’indice du formulaire ne pénalise pas les risques.' + (c ? ' Corrélation avec le score recalculé : r = ' + fmt(c.corr, 2) + ' (' + fmt(c.n) + ' visites).' : '');
    if (R.ScoreRisk_raw_max === null || R.ScoreRisk_raw_max === undefined) return 'GD/PREVMA : la composante « risques » de l’indice du formulaire n’est pas présente dans l’extraction : impossible de vérifier si l’indice pénalise les risques.';
    return 'GD/PREVMA : la composante « risques » de l’indice du formulaire est appliquée (ScoreRisk_raw maximal = ' + fmt(R.ScoreRisk_raw_max) + ') ; ' + pct(R.visitsWithRisk) + ' des visites recalculées présentent au moins une alerte critique.';
  }
  // Explication d'une note avec le BON barème selon le type évalué
  function gradeTip(g, kind) {
    const s = GRADE_SCALES[kind] || GRADE_SCALES.agent;
    const base = { A: 'Note A : très bon (≥ ' + s.A + ')', B: 'Note B : bon (' + s.B + ' à ' + s.A + ')', C: 'Note C : à accompagner (' + s.C + ' à ' + s.B + ')', D: 'Note D : insuffisant (< ' + s.C + ')', 'N/N': 'Non noté : moins de ' + s.minN + ' ' + s.unit + ' – échantillon trop faible pour noter' }[g] || g;
    return base + '\nBarème ' + s.label + ' : A ≥ ' + s.A + ' · B ≥ ' + s.B + ' · C ≥ ' + s.C + ' · D < ' + s.C + ' · non noté sous ' + s.minN + ' ' + s.unit + '.';
  }
  // ================================================================== FILTRES : UNE barre, conservée après une mise à jour, portée par onglet
  // Les filtres sont gardés par NOM (les index des dictionnaires changent à chaque import) et réappliqués après reboot.
  function saveFilters() {
    SESSION.Fkeep = { act: F.act, fo: F.fo < 0 ? null : DICT.fo[F.fo], region: F.region < 0 ? null : DICT.region[F.region], district: F.district < 0 ? null : DICT.district[F.district],
      org: F.org < 0 ? null : DICT.org[F.org], imp: F.imp < 0 ? null : DICT.imp[F.imp], m0: F.m0, m1: F.m1, full: F.m0 === MONTHS[0] && F.m1 === MONTHS[MONTHS.length - 1] };
  }
  function restoreFilters() {
    const k = SESSION.Fkeep; if (!k) return;
    const ix = (dict, name) => { if (name === null || name === undefined) return -1; const i = (DICT[dict] || []).indexOf(name); return i; };
    if (k.act === 'ALL' || ACTS.includes(k.act)) F.act = k.act;
    F.fo = ix('fo', k.fo); F.region = ix('region', k.region); F.district = ix('district', k.district); F.org = ix('org', k.org); F.imp = ix('imp', k.imp);
    if (MONTHS.length) {
      if (k.full) { F.m0 = MONTHS[0]; F.m1 = MONTHS[MONTHS.length - 1]; }   // « toute la période » reste toute la période (nouveaux mois compris)
      else { F.m0 = MONTHS.includes(k.m0) ? k.m0 : MONTHS[0]; F.m1 = MONTHS.includes(k.m1) ? k.m1 : MONTHS[MONTHS.length - 1]; }
    }
  }
  // Filtres pris en compte par chaque onglet (les autres sont grisés, avec la raison) : aucun filtre « muet »
  const FILTER_SCOPE = {
    overview: 'all', map: 'all', activity: 'all', agents: 'all', partners: 'all', quality: 'all', report: 'all', pilot: 'all', logistique: 'all', cases: 'all',
    sites: ['act', 'fo', 'region', 'district'], rbm: ['act', 'fo', 'region', 'district', 'period'], data: [], method: []
  };
  const FILTER_WHY = {
    sites: 'Le registre des sites montre l’état actuel de chaque site : la période et les partenaires ne s’y appliquent pas.',
    rbm: 'Le risque et le plan partent de tout l’historique de chaque site (dernière visite, alertes, score) ; la période « Du mois / Au mois » ne sert qu’à la vue « Capacité & exécution ». Les partenaires ne s’y appliquent pas.',
    data: 'Les imports portent sur le fichier entier.', method: 'La méthodologie décrit le calcul pour tout le fichier.'
  };
  function filterApplies(key) { const s = FILTER_SCOPE[TAB]; return s === 'all' || (Array.isArray(s) && s.includes(key)); }
  function filtersActiveText() {
    const p = [];
    if (F.act !== 'ALL') p.push(ACT[F.act].short); if (F.fo >= 0) p.push('bureau ' + DICT.fo[F.fo]); if (F.region >= 0) p.push(DICT.region[F.region]);
    if (F.district >= 0) p.push('district ' + DICT.district[F.district]); if (F.org >= 0) p.push('TPM ' + DICT.org[F.org]); if (F.imp >= 0) p.push('MEO ' + DICT.imp[F.imp]);
    if (MONTHS.length && (F.m0 !== MONTHS[0] || F.m1 !== MONTHS[MONTHS.length - 1])) p.push(monthLabel(F.m0) + ' → ' + monthLabel(F.m1));
    return p.length ? p.join(' · ') : 'aucun filtre (tout le fichier)';
  }
  // ================================================================== NAVIGATION : familles d'onglets (table centrale, lue par buildTabs)
  // clé d'onglet → famille. Les onglets ajoutés par d'autres lots (pilot, cases) sont classés ici sans les modifier ;
  // une clé absente de la table tombe dans « Autres » (jamais perdue). buildTabs rend la barre groupée sur une ligne.
  const TAB_FAMILIES = [
    ['Synthèse & décision', ['pilot', 'overview', 'cases', 'map']],
    ['Analyse', ['activity', 'quality']],
    ['Terrain & plan', ['sites', 'rbm']],
    ['Produire', ['report']],
    ['Admin', ['data', 'method']]
  ];

  // ================================================================== DÉTAIL D'UN CALCUL : tiroir latéral et blocs réutilisables
  // Chaque note affichée doit pouvoir s'ouvrir ici : valeur réelle · référence · n/N · formule · limites.
  function drawerEsc(e) { if (e.key === 'Escape') closeDrawer(); }
  function closeDrawer() { const o = document.querySelector('.xd-ov'); if (o) o.remove(); document.removeEventListener('keydown', drawerEsc); }
  function openDrawer(title, subtitle, kids) {
    closeDrawer(); hideTip();
    const ov = el('div', { class: 'xd-ov', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const x = el('button', { class: 'btn xd-x', type: 'button', text: 'Fermer ✕', 'aria-label': 'Fermer le détail' }); x.addEventListener('click', closeDrawer);
    const body = el('div', { class: 'xd-b' }, kids.filter(Boolean));
    ov.appendChild(el('aside', { class: 'xd' }, [el('div', { class: 'xd-h' }, [el('div', null, [el('h2', { text: title }), subtitle ? el('p', { class: 'hint', text: subtitle }) : null]), x]), body]));
    ov.addEventListener('click', e => { if (e.target === ov) closeDrawer(); });
    document.addEventListener('keydown', drawerEsc);
    document.body.appendChild(ov); x.focus();
    return body;
  }
  // « 31 / 38 fiches (81,6 %) »
  function nOf(n, N, unit, d) { return N ? fmt(n) + ' / ' + fmt(N) + (unit ? ' ' + unit : '') + ' (' + pct(n / N * 100, d === undefined ? 1 : d) + ')' : 'non mesuré (0 ' + (unit || '') + ')'; }
  function xsec(title, kids) { return el('section', { class: 'xs' }, [el('h3', { text: title })].concat(kids.filter(Boolean))); }
  // Liste clé → valeur
  function kvList(pairs) { return el('dl', { class: 'kv' }, [].concat.apply([], pairs.filter(Boolean).map(([k, v]) => [el('dt', { text: k }), el('dd', null, typeof v === 'object' && v !== null ? v : String(v ?? '–'))]))); }
  function formulaBox(text) { return el('p', { class: 'xf', text }); }
  function limitBox(text, kind) { return el('p', { class: 'note ' + (kind || 'warn'), text }); }
  // Tableau « comment la note est calculée » : une ligne par critère
  // rows : [{ k, raw, ref, sub, w, pts, why, na }] ; na = critère non mesuré, retiré du calcul (poids redistribué)
  function explainTable(rows, foot) {
    const t = el('table', { class: 'xt' });
    t.appendChild(el('thead', null, el('tr', null, ['Critère', 'Valeur réelle (n / N)', 'Référence', 'Sous-note /100', 'Poids', 'Points'].map((h, i) => el('th', { scope: 'col', class: i >= 3 ? 'num' : '', text: h })))));
    const tb = el('tbody');
    rows.forEach(r => {
      const tr = el('tr', { class: r.na ? 'xna' : '' });
      tr.appendChild(el('td', null, [el('b', { text: r.k }), r.why ? el('div', { class: 'muted', text: r.why }) : null]));
      tr.appendChild(el('td', { text: r.raw }));
      tr.appendChild(el('td', { text: r.ref || '–' }));
      tr.appendChild(el('td', { class: 'num' }, r.na ? 'non mesuré' : cellTxt(r.sub)));
      tr.appendChild(el('td', { class: 'num', text: r.na ? '—' : pct(r.w * 100, 0) }));
      tr.appendChild(el('td', { class: 'num', text: r.na ? '—' : fmt(r.pts, 1) }));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    if (foot) t.appendChild(el('tfoot', null, el('tr', null, [el('td', { colspan: '5', text: foot[0] }), el('td', { class: 'num', text: foot[1] })])));
    return el('div', { class: 'tw' }, t);
  }
  function cellTxt(v) { const k = v === null || v === undefined || isNaN(v) ? 'na' : cls(v); return el('span', { class: 'cell bg-' + k, text: v === null || v === undefined || isNaN(v) ? '–' : fmt(v, 0) }); }
  // Histogramme horizontal compact : [{ label, n, k: 'good'|'mid'|'bad'|'na' }]
  function histo(bins, unit) {
    const tot = sum(bins.map(b => b.n)) || 1, mx = Math.max.apply(null, bins.map(b => b.n).concat([1]));
    return el('div', { class: 'xh' }, bins.map(b => {
      const bar = el('i', { class: 'bg-' + (b.k || 'na') }); bar.style.width = Math.max(b.n ? 2 : 0, b.n / mx * 100) + '%';
      return el('div', { class: 'xh-r' }, [el('span', { class: 'xh-l', text: b.label }), el('span', { class: 'xh-b' }, bar), el('span', { class: 'xh-v', text: fmt(b.n) + (unit ? ' ' + unit : '') + ' · ' + pct(b.n / tot * 100, 0) })]);
    }));
  }
  // Texte de référence d'un seuil de score / d'alerte, depuis la table unique THR
  function scoreRefText() { return 'bon ≥ ' + THR.good + ' · à améliorer ' + THR.mid + '–' + THR.good + ' · faible < ' + THR.mid; }
  function riskRefText() { return 'alertes peu fréquentes ≤ ' + THR.rLow + ' % des visites · fréquentes ' + THR.rLow + '–' + THR.rHigh + ' % · très fréquentes > ' + THR.rHigh + ' % (repères internes provisoires)'; }
  // ================================================================== EFFECTIFS FAIBLES : une règle unique pour tous les écrans
  // < 5 observations : non calculé ; 5 à 9 : indicatif (grisé, exclu des classements et des couleurs) ; ≥ 10 : normal.
  const SMALL_N = { min: 5, low: 10 };
  function nStatus(n) { return !n || n < SMALL_N.min ? 'na' : n < SMALL_N.low ? 'low' : 'ok'; }
  function nNote(n, unit) { const s = nStatus(n); return s === 'na' ? 'non calculé (n = ' + fmt(n || 0) + (unit ? ' ' + unit : '') + ', minimum ' + SMALL_N.min + ')' : s === 'low' ? 'effectif faible (n = ' + fmt(n) + (unit ? ' ' + unit : '') + ') — indicatif' : ''; }
  // ================================================================== COUVERTURE DU PLAN : une seule définition, lue par tous les onglets
  // Fenêtre = période filtrée ∩ année du plan. Univers = sites du plan éligibles (actif, hors zone interdite, grille « Oui »)
  // au moins un mois de la fenêtre, dans le périmètre (activité, bureau, région, district). Suivi = au moins une visite
  // exploitable du site dans la fenêtre (les filtres TPM / MEO s'appliquent aux visites).
  const covNorm = s => String(s === null || s === undefined ? '' : s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  const COV_CACHE = { n: -1, rows: null };   // registre relu une fois par affichage (une modification du plan relance l'affichage)
  function covCalc(opt) {
    opt = opt || {};
    const Y = String(planYearUI()), act = opt.act || F.act, regionIdx = opt.regionIdx === undefined ? F.region : opt.regionIdx;
    const full = !MONTHS.length || (F.m0 === MONTHS[0] && F.m1 === MONTHS[MONTHS.length - 1]);
    const wm = []; for (let i = 1; i <= 12; i++) { const m = Y + '-' + String(i).padStart(2, '0'); if (full || (m >= F.m0 && m <= F.m1)) wm.push(m); }
    const wset = new Set(wm);
    const rName = opt.regionName !== undefined ? opt.regionName : regionIdx >= 0 ? DICT.region[regionIdx] : null;
    const rN = rName ? covNorm(ENGINE.canonRegion(rName) || rName) : null;
    const dName = opt.districtName !== undefined ? opt.districtName : F.district >= 0 ? DICT.district[F.district] : null;
    const foN = F.fo >= 0 ? covNorm(FO_NORM(DICT.fo[F.fo])) : null, dN = dName ? covNorm(dName) : null;
    const visOk = v => wset.has(v.month) && (F.org < 0 || v.org === F.org) && (F.imp < 0 || v.imp === F.imp);
    const res = { year: Y, window: wm.length ? [wm[0], wm[wm.length - 1]] : null, outOfYear: !wm.length, planned: 0, visited: 0, never: 0, sites: [], perAct: {} };
    if (!wm.length) return res;
    if (COV_CACHE.n !== RENDER_N || !COV_CACHE.rows) { COV_CACHE.rows = siteRows(); COV_CACHE.n = RENDER_N; }
    COV_CACHE.rows.forEach(s => {
      if (act !== 'ALL' && s.act !== act) return;
      if (rN && covNorm(s.region) !== rN) return; if (foN && covNorm(s.fo) !== foN) return; if (dN && covNorm(s.district) !== dN) return;
      if (!wm.some(m => eligible(s, m))) return;
      const seen = s.hist.some(visOk);
      res.planned++; if (seen) res.visited++; if (!s.nVis) res.never++;
      const pa = res.perAct[s.act] || (res.perAct[s.act] = { planned: 0, visited: 0 }); pa.planned++; if (seen) pa.visited++;
      if (opt.keepSites) res.sites.push({ s, seen });
    });
    res.p = res.planned ? res.visited / res.planned * 100 : null;
    return res;
  }
  function covText(c) { return c.outOfYear ? 'période hors de l’année du plan ' + c.year : c.planned ? fmt(c.visited) + ' / ' + fmt(c.planned) + ' sites actifs (' + pct(c.p, 1) + ')' : 'aucun site actif au plan dans ce périmètre'; }
  function covDefinition() { return 'Couverture du plan de suivi ' + planYearUI() + ' = sites du plan actifs au moins un mois de la période (grille « Oui », hors zone interdite) ayant reçu au moins une visite exploitable dans la période, sur ces sites actifs. Période = filtre « Du mois / Au mois » limité à l’année du plan. Avec un filtre TPM ou MEO, seules ses visites comptent, mais le dénominateur reste l’ensemble des sites du périmètre (le plan ne dit pas qui suit chaque site).'; }
  if (/debug/.test(location.hash)) window.__dashBoot = { covCalc, siteRows, F, render, buildFilters }; /*DEBUG*/
  function filtersAny() { return F.act !== 'ALL' || F.fo >= 0 || F.region >= 0 || F.district >= 0 || F.org >= 0 || F.imp >= 0 || (MONTHS.length && (F.m0 !== MONTHS[0] || F.m1 !== MONTHS[MONTHS.length - 1])); }
  function dateFrLong(s) { if (!s) return '–'; const t = String(s); const m = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][+t.slice(5, 7) - 1]; return (+t.slice(8, 10)) + ' ' + m + ' ' + t.slice(0, 4); }
