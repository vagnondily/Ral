  // ================================================================== VERSION À PARTAGER (lot share)
  // Copie du dashboard pour diffusion hors de l'équipe S&E. Tout se fait sur un clone : CUR n'est jamais modifié.
  // Agents pseudonymisés (codes au hasard, assez différents pour ne jamais être rapprochés par clusterNames),
  // positions des visites ramenées au site, réponses libres retirées, auteurs anonymes, lecture seule.
  // Avant l'enregistrement, la copie est recalculée (refreshPlanTables) et comparée à l'original : sinon rien n'est créé.
  const SH_TEAM = 'équipe S&E', SH_FREE = 'retiré de la version à partager', SH_NONE = '(Non renseigné)';
  const SH_ALPHA = 'BCDFGHJKLMNPQRSTVWXZ';   // consonnes seules : jamais un vrai nom, jamais de chiffre (nkey retire les chiffres)
  const SH_SITE = 'Site hors liste';
  const SH_MAX_RATIO = 0.8;                  // < 0,88, seuil de rapprochement des graphies du moteur
  const SH_OPTS = [
    { k: 'agents', l: 'Agents pseudonymisés', tip: 'Chaque agent reçoit un code tiré au hasard (par exemple Agent KTRMV), le même partout dans la copie, sans lien avec son nom. Toutes les graphies d’un même agent prennent le même code. Les notes, scores et nombres de fiches ne changent pas. La liste des enquêteurs des formulaires est retirée.' },
    { k: 'gps', l: 'Positions ramenées au site', tip: 'Le point d’une visite (lieu de l’entretien) prend la position du site au registre, arrondie à 3 décimales (environ 100 m). Sans site au registre, il est arrondi à 2 décimales (environ 1 km). La carte reste utilisable.' },
    { k: 'free', l: 'Réponses libres retirées', tip: 'Les précisions « Autre » saisies sur le terrain et les noms de sites tapés hors liste sont retirés. Seul leur nombre reste, avec la mention « retiré de la version à partager ».' },
    { k: 'by', l: 'Auteurs anonymes', tip: 'Les noms des personnes qui ont fait les mises à jour, modifié ou validé le plan, ou suivi un cas deviennent « équipe S&E ». Les commentaires du registre des cas sont retirés, les statuts restent.' },
    { k: 'ro', l: 'Lecture seule', fixed: true, tip: 'La copie reçoit un mot de passe tiré au hasard que personne ne connaît : elle ne peut être ni modifiée ni repartagée. Toujours appliqué.' }
  ];
  let SH_LAST = null;   // dernière copie de la session : correspondance code → nom (gardée en mémoire, jamais dans la copie)
  const SH_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function shDateFr(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? (+m[3]) + (m[3] === '01' ? 'er' : '') + ' ' + SH_MONTHS[+m[2] - 1] + ' ' + m[1] : '–'; }
  function shRand(n) { const b = new Uint8Array(n); try { crypto.getRandomValues(b); } catch (e) { b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); }); } return b; }
  const shHex = n => Array.from(shRand(n)).map(x => x.toString(16).padStart(2, '0')).join('');
  const shLetters = n => Array.from(shRand(n), x => SH_ALPHA[x % SH_ALPHA.length]).join('');
  // Codes d'agents : « Agent » + 5 consonnes ; clé du moteur = « AGENT XXXXX » ; deux clés ne se ressemblent jamais à 0,8 ou plus
  function shAgentCodes() {
    const used = [];
    return () => {
      for (let t = 0; t < 20000; t++) {
        const c = shLetters(5), k = 'AGENT ' + c;
        if (used.every(u => u !== k && ENGINE.seqRatio(u, k) < SH_MAX_RATIO)) { used.push(k); return 'Agent ' + c; }
      }
      throw new Error('impossible de tirer des codes d’agents assez différents');
    };
  }
  // Variantes de casse d'un libellé : même texte en minuscules, chaînes exactes différentes (les sites hors liste se
  // regroupent par nom en minuscules à l'écran, mais par chaîne exacte dans le moteur : les deux comptes sont conservés)
  function shCase(s, i) { let b = 0; return s.split('').map(ch => { if (!/[a-z]/i.test(ch)) return ch; const flip = (i >> (b++)) & 1; return flip ? (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()) : ch; }).join(''); }
  // Clé contenant un site hors liste : … '999:' + nom du site + ':' + agent …
  function shKeyParts(k) {
    if (typeof k !== 'string') return null;
    let a = -1; for (let i = k.indexOf('999:'); i >= 0; i = k.indexOf('999:', i + 1)) { if (i === 0 || k[i - 1] === '|') { a = i; break; } }
    if (a < 0) return null;
    let e = k.indexOf('|', a); if (e < 0) e = k.length;
    const c = k.lastIndexOf(':', e - 1); if (c < a + 4) return null;
    return { a, c, e, site: k.slice(a + 4, c), enu: k.slice(c + 1, e) };
  }
  const shCodeOfKey = k => { const s = String(k || ''); return s.slice(s.indexOf('|') + 1, s.lastIndexOf('|')); };
  const shAU = x => { const y = String(x).replace(/\.+$/, ''); return y === 'Autres' ? 'Autres (non précisé*)' : y; };   // = libellé de la table des agents (recomputeTables)

  // ---------------------------------------------------------------- transformation (clone de CUR, jamais CUR)
  function shTransform(opt) {
    const P = JSON.parse(JSON.stringify(CUR));
    const rep = { agents: 0, spellings: 0, snapped: 0, rounded: 0, free: 0, sitesOff: 0, by: 0, comments: 0, enumList: 0 };
    const SC = P.subs.cols, si = k => SC.indexOf(k), iR = si('enu_raw'), iK = si('site_k'), iV = si('vkey');
    // 1. agents : un code par nom harmonisé (même regroupement que le moteur)
    const raws = P.subs.rows.map(r => r[iR]).filter(x => x !== null && x !== undefined);
    const canon = ENGINE.clusterNames(raws);
    const code = new Map(), next = shAgentCodes();
    const ag = n => { if (!opt.agents || n === null || n === undefined || n === '' || n === SH_NONE) return n; if (!code.has(n)) code.set(n, next()); return code.get(n); };
    const agRaw = n => (n === null || n === undefined) ? n : ag(canon(n) || n);
    if (opt.agents) { rep.spellings = new Set(raws).size; Array.from(new Set(raws.map(n => canon(n) || n))).forEach(ag); P.dict.enu.forEach(ag); }
    // 2. noms de sites tapés hors liste (« Autre, précisez ») : un code par nom ; les noms du registre et les sites vides restent
    const nrm = s => String(s).trim().toLowerCase();
    const keep = new Set(['', '999', 'nan', 'none', 'site non renseigné (hors liste)']);
    const off = new Set(), onl = new Set();
    P.visits.forEach((r, i) => (shKeyParts(P.visitKeys[i]) ? off : onl).add(r[8]));
    if (opt.free) {
      onl.forEach(j => keep.add(nrm(P.dict.site[j])));
      const PF = P.planFull, pl = PF.cols.indexOf('localite'); if (pl >= 0) PF.rows.forEach(r => { if (r[pl]) keep.add(nrm(r[pl])); });
    }
    const sCode = new Map(), sVar = new Map(), sUsed = new Set();
    const st = s => {
      if (!opt.free || s === null || s === undefined) return s; const k = nrm(s); if (keep.has(k)) return s;
      if (!sCode.has(k)) { let c; do { c = shLetters(5); } while (sUsed.has(c)); sUsed.add(c); sCode.set(k, c); sVar.set(k, new Map()); }
      const vm = sVar.get(k); if (!vm.has(s)) vm.set(s, shCase(SH_SITE, vm.size) + ' ' + sCode.get(k)); return vm.get(s);
    };
    const rekey = k => { const q = shKeyParts(k); return q ? k.slice(0, q.a + 4) + st(q.site) + ':' + ag(q.enu) + k.slice(q.e) : k; };
    const origKeys = P.visitKeys.slice();
    if (opt.agents || opt.free) {
      P.subs.rows.forEach(r => { r[iR] = agRaw(r[iR]); r[iK] = rekey(r[iK]); r[iV] = rekey(r[iV]); });
      P.visitKeys = P.visitKeys.map(rekey);
      if (P.cases && typeof P.cases === 'object') { const C = {}; Object.keys(P.cases).forEach(k => { C[rekey(k)] = P.cases[k]; }); P.cases = C; }
    }
    if (opt.agents) {
      P.dict.enu = P.dict.enu.map(ag);
      Object.keys((P.spec && P.spec.acts) || {}).forEach(a => { const S = P.spec.acts[a], f = S && S.cfg && S.cfg.enu; if (f && S.choices && S.choices[f]) { rep.enumList += Object.keys(S.choices[f]).length; S.choices[f] = {}; } });   // liste des enquêteurs du formulaire (sert seulement à l'import)
      rep.agents = code.size;
    }
    if (opt.free) {
      const only = Array.from(off).filter(j => !onl.has(j));
      only.forEach(j => { P.dict.site[j] = st(P.dict.site[j]); });
      rep.sitesOff = sCode.size;
    }
    // 3. positions des visites : site du registre (3 décimales), sinon arrondi à 2 décimales
    if (opt.gps) {
      const PF = P.planFull, pc = k => PF.cols.indexOf(k), iA = pc('act'), iLa = pc('lat'), iLo = pc('lon'), pos = new Map();
      PF.rows.forEach(r => { const la = r[iLa], lo = r[iLo]; if (typeof la === 'number' && typeof lo === 'number' && isFinite(la) && isFinite(lo)) pos.set(r[iA] + '|' + String(r[0]), [la, lo]); });
      const A = P.acts.map(a => a.code), r3 = x => Math.round(x * 1000) / 1000, r2 = x => Math.round(x * 100) / 100;
      P.visits.forEach((r, i) => {
        if (typeof r[9] !== 'number' || typeof r[10] !== 'number') return;
        const s = pos.get(A[r[0]] + '|' + shCodeOfKey(origKeys[i]));
        if (s) { r[9] = r3(s[0]); r[10] = r3(s[1]); rep.snapped++; } else { r[9] = r2(r[9]); r[10] = r2(r[10]); rep.rounded++; }
      });
    }
    // 4. réponses libres : remplacées par la mention, une par réponse (les écrans en gardent le décompte, filtres compris)
    if (opt.free) {
      Object.keys(P.explorer || {}).forEach(a => ((P.explorer[a] || {}).q || []).forEach(q => {
        if (Array.isArray(q.o)) q.o = q.o.map(t => { if (t === null || t === undefined || t === '') return t; rep.free++; return SH_FREE; });
      }));
      const M = P.smpMeals; if (M && Array.isArray(M.oth_top)) { const n = M.oth_top.reduce((s, x) => s + (+x[1] || 0), 0); M.oth_top = n ? [[SH_FREE, n]] : []; }
    }
    // 5. auteurs : tout champ « by » devient « équipe S&E » ; leurs noms sont aussi effacés des motifs et journaux
    if (opt.by) {
      const SKIP = new Set(['subs', 'visits', 'visitKeys', 'explorer', 'items', 'planFull', 'spec', 'plan', 'geo', 'dict', 'agents', 'orgs', 'imps']);
      const names = new Set();
      const walkBy = v => { if (Array.isArray(v)) v.forEach(walkBy); else if (v && typeof v === 'object') Object.keys(v).forEach(k => {
        if (k === 'by' && typeof v[k] === 'string') { const s = v[k].trim(); if (s && !/^[—–-]+$/.test(s) && s !== SH_TEAM) { names.add(s); rep.by++; } if (s) v[k] = SH_TEAM; } else walkBy(v[k]); }); };
      Object.keys(P).filter(k => !SKIP.has(k)).forEach(k => walkBy(P[k]));
      const L = Array.from(names).filter(n => n.length >= 3).sort((a, b) => b.length - a.length);
      const scrub = s => { let o = s; L.forEach(n => { if (o.indexOf(n) >= 0) o = o.split(n).join(SH_TEAM); }); return o; };
      const walkTxt = v => { if (typeof v === 'string') return scrub(v); if (Array.isArray(v)) { v.forEach((x, i) => { v[i] = walkTxt(x); }); return v; } if (v && typeof v === 'object') { Object.keys(v).forEach(k => { v[k] = walkTxt(v[k]); }); return v; } return v; };
      if (L.length) { Object.keys(P).filter(k => !SKIP.has(k)).forEach(k => { P[k] = walkTxt(P[k]); }); const im = P.planFull.cols.indexOf('motif'); if (im >= 0) P.planFull.rows.forEach(r => { if (typeof r[im] === 'string') r[im] = scrub(r[im]); }); }
      if (P.cases && typeof P.cases === 'object') Object.keys(P.cases).forEach(k => { const c = P.cases[k]; if (!c || typeof c !== 'object') { delete P.cases[k]; return; } if (c.c) rep.comments++; c.c = ''; if (!c.s) delete P.cases[k]; });
    }
    // 6. lecture seule : empreinte d'un mot de passe tiré au hasard et jeté ; nouvel identifiant de fichier
    const hadId = Object.prototype.hasOwnProperty.call(CUR, 'fileId');
    P.auth = typeof secMakeAuth === 'function' ? secMakeAuth(shHex(32)) : (s => ({ salt: s, hash: sha256hex(s + ':' + shHex(32)) }))(shHex(8));
    if (!hadId) delete CUR.fileId;   // secMakeAuth pose un identifiant s'il manque : jamais sur le fichier courant
    P.fileId = 'f' + shHex(8);
    delete P.pseudo;
    P.shareInfo = { date: localDay(), options: { agents: !!opt.agents, gps: !!opt.gps, free: !!opt.free, by: !!opt.by, ro: true },
      version: { from: (P.period || [])[0] || null, to: (P.period || [])[1] || null, visits: P.visits.length, subs: P.subs.rows.length, generated: P.generated || null }, counts: rep };
    return { P, rep, code, canon, raws };
  }

  // ---------------------------------------------------------------- contrôle : la copie recalculée donne les mêmes résultats
  function shCheck(R0, R1, T, opt) {
    const err = [];
    const disp = new Map(); T.code.forEach((c, n) => disp.set(shAU(n), shAU(c)));
    const mapEnu = x => disp.get(x) || x;
    const A0 = R0.agents, A1 = R1.agents, ai = A0.cols.indexOf('enu'), gi = A0.cols.indexOf('grade');
    if (A0.rows.length !== A1.rows.length) err.push('nombre d’agents ' + A0.rows.length + ' → ' + A1.rows.length);
    if (A0.cols.join() !== A1.cols.join()) err.push('colonnes de la table des agents différentes');
    const idx = new Map(A1.rows.map(r => [r[ai], r])); let same = 0;
    A0.rows.forEach(r => {
      const r1 = idx.get(mapEnu(r[ai])); if (!r1) { err.push('agent sans correspondance'); return; }
      const d = A0.cols.filter((c, j) => j !== ai && JSON.stringify(r[j]) !== JSON.stringify(r1[j]));
      if (d.length) err.push('agent : ' + d.slice(0, 3).join(', ') + ' différent(s)'); else same++;
    });
    const rowsKey = T2 => T2.rows.map(r => JSON.stringify(r)).sort().join('\n');
    if (rowsKey(R0.orgs) !== rowsKey(R1.orgs)) err.push('notes des organisations de suivi différentes');
    if (rowsKey(R0.imps) !== rowsKey(R1.imps)) err.push('notes des partenaires de mise en œuvre différentes');
    if (JSON.stringify(R0.dq) !== JSON.stringify(R1.dq)) err.push('contrôles de qualité différents');
    if (JSON.stringify(R0.coverage) !== JSON.stringify(R1.coverage)) err.push('couverture différente');
    if (R0.visits.length !== R1.visits.length || R0.subs.rows.length !== R1.subs.rows.length) err.push('nombre de visites ou de fiches différent');
    const offN = R => { const s = new Set(); R.visitKeys.forEach((k, i) => { const q = shKeyParts(k); if (q && q.site.trim() && !/^(999|nan|none)$/i.test(q.site.trim())) s.add(R.visits[i][0] + '|' + q.site.trim().toLowerCase()); }); return s.size; };
    if (offN(R0) !== offN(R1)) err.push('nombre de sites hors liste différent');
    // les codes ne sont pas rapprochés entre eux au recalcul, et aucun nom d'origine ne reste dans les colonnes d'agents
    if (opt.agents) {
      const si = R1.subs.cols.indexOf('enu_raw'), raw1 = R1.subs.rows.map(r => r[si]).filter(x => x !== null && x !== undefined);
      const c1 = ENGINE.clusterNames(raw1), codes = new Set(T.code.values());
      if (raw1.some(x => !codes.has(x) || c1(x) !== x)) err.push('codes d’agents rapprochés au recalcul');
      const orig = new Set(T.raws.concat(Array.from(T.code.keys())));
      const left = R1.dict.enu.concat(raw1, R1.agents.rows.map(r => r[ai])).filter(x => orig.has(x)).length
        + R1.visitKeys.concat(R1.subs.rows.map(r => r[R1.subs.cols.indexOf('site_k')])).filter(k => { const q = shKeyParts(k); return q && orig.has(q.enu); }).length;
      if (left) err.push(left + ' nom(s) d’agent restant(s)');
    }
    const grades = {}; A1.rows.forEach(r => { grades[r[gi]] = (grades[r[gi]] || 0) + 1; });
    return { ok: !err.length, err, agents: A1.rows.length, same, grades, orgs: R1.orgs.rows.length, imps: R1.imps.rows.length };
  }

  // ---------------------------------------------------------------- création et téléchargement
  function shMake(opt, noDownload) {
    let T = null, R1 = null, chk = null; const R0 = ENGINE.refreshPlanTables(CUR);
    for (let attempt = 0; attempt < 3; attempt++) {   // nouveau tirage si, par malchance, deux codes se ressemblaient
      T = shTransform(opt); R1 = ENGINE.refreshPlanTables(T.P); chk = shCheck(R0, R1, T, opt);
      if (chk.ok || !chk.err.every(e => /codes d’agents/.test(e))) break;
    }
    if (!chk.ok) throw new Error('la copie ne donnerait pas les mêmes résultats (' + chk.err.slice(0, 3).join(' ; ') + '). Rien n’a été créé.');
    const name = 'Dashboard_Suivi_Processus_PAM_MDG_PARTAGE_' + localDay() + '.html';
    if (!noDownload) downloadBlob(new Blob([serializeHtml(R1)], { type: 'text/html;charset=utf-8' }), name);
    const ai = R0.agents.cols.indexOf('enu'), oi = R0.agents.cols.indexOf('org'), orgOf = new Map(R0.agents.rows.map(r => [r[ai], r[oi]]));
    const spell = new Map(); T.raws.forEach(n => { const c = T.canon(n) || n; if (!spell.has(c)) spell.set(c, new Set()); spell.get(c).add(n); });
    const map = Array.from(T.code.entries()).map(([n, c]) => [c, n, orgOf.get(shAU(n)) || '', spell.has(n) ? spell.get(n).size : 0]).sort((x, y) => x[0] < y[0] ? -1 : 1);
    SH_LAST = { at: localDay(), name, rep: T.rep, chk, map, info: R1.shareInfo };
    return SH_LAST;
  }
  function shExportMap() {
    if (!SH_LAST || !SH_LAST.map.length) return;
    downloadBlob(xlsxBlob([{ name: 'Correspondance', header: ['Code dans la copie', 'Agent (nom harmonisé)', 'Organisation', 'Graphies rapprochées'], rows: SH_LAST.map },
      { name: 'À lire', header: ['Information', 'Valeur'], rows: [['Copie', SH_LAST.name], ['Créée le', SH_LAST.at], ['Diffusion', 'Équipe S&E seulement. Ne jamais joindre ce fichier à la version à partager.']] }]),
    'Correspondance_agents_PARTAGE_' + SH_LAST.at + '.xlsx');
  }
  function shDoneText(r) {
    return 'Copie téléchargée : ' + r.name + '. Mêmes notes et scores pour les ' + fmt(r.chk.agents) + ' agents.';
  }
  // Ce qui a été retiré ou transformé (infobulle du bandeau et de la carte)
  function shWhatTip(S) {
    const o = S.options || {}, c = S.counts || {}, v = S.version || {}, L = [];
    if (o.agents) L.push('• ' + fmt(c.agents) + ' agents remplacés par des codes tirés au hasard (' + fmt(c.spellings) + ' graphies). Notes, scores et nombres de fiches inchangés. Liste des enquêteurs des formulaires retirée.');
    if (o.gps) L.push('• Positions des visites : ' + fmt(c.snapped) + ' ramenées au site du registre (environ 100 m), ' + fmt(c.rounded) + ' arrondies à environ 1 km.');
    if (o.free) L.push('• ' + fmt(c.free) + ' précisions « Autre » et ' + fmt(c.sitesOff) + ' noms de sites tapés hors liste retirés ; seul leur nombre reste.');
    if (o.by) L.push('• Auteurs des mises à jour, du plan et des cas remplacés par « ' + SH_TEAM + ' » ; commentaires des cas retirés.');
    L.push('• Lecture seule : mot de passe inconnu, aucune mise à jour possible.');
    return 'Ce qui a changé par rapport au fichier de l’équipe S&E :\n' + L.join('\n') +
      '\nCe qui reste : organisation, activités, bureau et district de chaque agent. Un agent seul dans son organisation ou son district peut encore être reconnu.' +
      (v.to ? '\nDonnées du ' + shDateFr(v.from) + ' au ' + shDateFr(v.to) + ', ' + fmt(v.visits) + ' visites.' : '');
  }
  function shAddInfo(c, text) { const h = c.querySelector('.ch'); if (h) h.appendChild(infoBtn(text)); return c; }

  // ---------------------------------------------------------------- carte « Version à partager » (onglet Données, mode administrateur)
  function shareCard(main) {
    const S = D.shareInfo;
    if (S && typeof S === 'object') { main.appendChild(shAddInfo(card('Version à partager', null, [note('Ce fichier est déjà une version à partager, du ' + shDateFr(S.date) + '.')]), shWhatTip(S))); return; }
    const boxes = {};
    const rows = SH_OPTS.map(o => {
      const cb = el('input', { type: 'checkbox', id: 'sh-opt-' + o.k }); cb.checked = true; if (o.fixed) cb.disabled = true; boxes[o.k] = cb;
      return el('div', { class: 'sh-opt' }, [cb, el('label', { for: 'sh-opt-' + o.k, text: o.l }), infoBtn(o.tip)]);
    });
    const out = el('p', { class: 'note sh-out' }); out.style.display = SH_LAST ? '' : 'none'; if (SH_LAST) out.textContent = shDoneText(SH_LAST);
    const corr = btn('Table de correspondance (.xlsx)', () => requireAdmin(shExportMap));
    const corrTip = infoBtn('Codes et vrais noms des agents de la dernière copie créée. À garder dans l’équipe S&E pour répondre aux questions sur un code ; ne jamais l’envoyer avec la copie.');
    const showCorr = () => { const v = SH_LAST && SH_LAST.map.length ? '' : 'none'; corr.style.display = v; corrTip.style.display = v; };
    const go = btn('Créer la version à partager', () => requireAdmin(() => {
      const opt = { ro: true }; SH_OPTS.forEach(o => { opt[o.k] = o.fixed ? true : !!boxes[o.k].checked; });
      out.style.display = ''; out.className = 'note sh-out'; out.textContent = 'Préparation de la copie…'; go.disabled = true;
      setTimeout(() => {
        try { out.textContent = shDoneText(shMake(opt)); } catch (e) { out.className = 'note warn sh-out'; out.textContent = 'Copie non créée : ' + ((e && e.message) || e); }
        go.disabled = false; showCorr();
      }, 30);
    }), 'on');
    showCorr();
    main.appendChild(shAddInfo(card('Version à partager', 'Copie sans données personnelles, pour diffuser hors de l’équipe S&E.', [el('div', { class: 'sh-opts' }, rows), el('div', { class: 'frow sh-act' }, [go, corr, corrTip]), out]),
      'La copie garde tous les onglets, les mêmes chiffres et les mêmes notes ; son nom se termine par _PARTAGE_ et la date. Le fichier ouvert ici ne change pas. Avant l’enregistrement, la copie est recalculée et comparée à l’original : si une note devait changer, rien n’est créé. Les codes changent à chaque copie.'));
  }

  // ---------------------------------------------------------------- bandeau d'une copie (en-tête, visible sur tous les onglets et à l'impression)
  function shBanner() {
    const old = document.getElementById('sh-banner'); if (old) old.remove();
    const S = D.shareInfo, host = document.getElementById('subtitle');
    if (!S || typeof S !== 'object' || !host || !host.parentNode) return;
    const o = S.options || {};
    const parts = [o.agents && 'agents pseudonymisés', o.gps && 'positions ramenées au site', o.free && 'réponses libres retirées', o.by && 'auteurs anonymes', 'lecture seule'].filter(Boolean);
    const b = el('p', { class: 'sh-banner', id: 'sh-banner', role: 'note' }, [el('b', { text: 'Version à partager du ' + shDateFr(S.date) + '.' }), el('span', { text: parts.join(', ').replace(/^./, x => x.toUpperCase()) + '.' }), infoBtn(shWhatTip(S))]);
    host.parentNode.insertBefore(b, host.nextSibling);
  }
  shBanner();
  if (/debug/.test(location.hash)) window.__dashShare = { make: (o, noDl) => shMake(Object.assign({ agents: true, gps: true, free: true, by: true, ro: true }, o || {}), noDl !== false), last: () => SH_LAST, keyParts: shKeyParts, cardText: () => { const m = document.createElement('div'); shareCard(m); return { text: m.innerText || m.textContent, buttons: Array.from(m.querySelectorAll('button')).map(b => b.textContent) }; } }; /*DEBUG*/
