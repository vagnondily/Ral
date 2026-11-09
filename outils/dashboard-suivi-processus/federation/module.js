  // ================================================================== CONSOLIDATION MULTI-BUREAUX (lot federation)
  // Chaque bureau tient une copie de l'outil, met à jour SES sites, et sort un paquet .json daté
  // { office, dataVersion, exportedAt, keys } ne contenant QUE sa couche opérationnelle (plan/activation de ses
  // sites, plan validé, config RBM, cas, décisions de pilotage, textes du rapport). Au national, on importe
  // plusieurs paquets : aperçu avant écriture, périmètres disjoints = aucune perte, provenance par enregistrement,
  // journal append-only (CUR.mergeLog), et un conflit (même clé, deux bureaux, valeurs différentes) est signalé
  // et JAMAIS écrasé. Aucune donnée personnelle de bénéficiaire ; pas les soumissions nationales (sauf choix).
  const FED_NAT = 'National';                 // identité « copie de consolidation »
  const FED_MAX_PKG = 12e6;                   // plafond d'un paquet importé (octets) : un paquet reste léger
  const FED_MAX_REC = 200000;                 // plafond d'enregistrements par type (garde-fou)
  const FED_KINDS = ['activation', 'rbmPlan', 'rbmCap', 'cases', 'pilot', 'report'];
  const FED_KIND_FR = { activation: 'plan / activation des sites', rbmPlan: 'plan de visites validé', rbmCap: 'capacités RBM', cases: 'cas à suivre', pilot: 'décisions de pilotage', report: 'textes du rapport', subs: 'fiches de suivi' };
  let FED = { packages: [], preview: null, result: null };   // mémoire de session (jamais dans le fichier)

  // ---- modèle de bureau : à plat (un bureau = son field office ; ce fichier ne porte pas d'arbre d'antennes) ----
  function fedNormFo(s) { return FO_NORM(typeof s === 'string' ? s : (s == null ? '' : String(s))).trim(); }
  function fedOffices() { const seen = Object.create(null), out = []; DICT.fo.forEach(f => { const n = fedNormFo(f); if (n && !seen[n]) { seen[n] = 1; out.push(n); } }); out.sort(); return out; }
  function fedOfficeOf(P) { const o = P && P.office; return (typeof o === 'string' && o.trim()) ? o.trim() : null; }
  function fedIsNat(office) { return !office || office === FED_NAT; }

  // table site -> bureau, bâtie une fois sur le registre national (adm. de confiance : la graphie du fichier, pas celle d'un paquet)
  function fedSiteFo(P) {
    const PF = P.planFull, c = k => PF.cols.indexOf(k), ci = { act: c('act'), fo: c('fo'), pub: c('publicId') };
    const byKey = new Map(), byPub = new Map();
    PF.rows.forEach(r => { const fo = fedNormFo(r[ci.fo]); byKey.set(r[ci.act] + '|' + r[0], fo); const p = r[ci.pub]; if (p) byPub.set(p, fo); });
    return { byKey, byPub };
  }
  // bureau d'une clé « ACT|Code|… » (cas, cellule de plan) via le registre national ; null si le site est inconnu
  function fedKeyFo(sm, key) { const s = String(key || ''); const i = s.indexOf('|'); if (i < 0) return null; const j = s.indexOf('|', i + 1); const act = s.slice(0, i), code = s.slice(i + 1, j < 0 ? s.length : j); const fo = sm.byKey.get(act + '|' + code); return fo === undefined ? null : fo; }

  // écriture sûre : jamais une clé de valeur dangereuse sur un objet (__proto__ / prototype / constructor)
  function fedSafeKey(k) { return typeof k === 'string' && k !== '__proto__' && k !== 'prototype' && k !== 'constructor'; }
  function fedSet(obj, k, v) { if (fedSafeKey(k)) obj[k] = v; }
  const fedEqual = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } }
  const fedClone = x => JSON.parse(JSON.stringify(x));

  // ------------------------------------------------------------------ fabrication d'un paquet de bureau (pur, lit P)
  function fedBuildPackage(P, office, opt) {
    opt = opt || {}; const scope = fedIsNat(office) ? null : fedNormFo(office);
    const inScope = fo => scope === null || fo === scope;
    const sm = fedSiteFo(P);
    const PF = P.planFull, c = k => PF.cols.indexOf(k);
    const ci = { act: c('act'), fo: c('fo'), pub: c('publicId'), actif: c('actif'), months: c('months'), motif: c('motif'), security: c('security'), annee: c('annee') };
    // 1. plan / activation : état opérationnel de CHAQUE site du périmètre (snapshot, pas un delta abstrait)
    const activation = [];
    PF.rows.forEach(r => {
      const fo = fedNormFo(r[ci.fo]); if (!inScope(fo)) return;
      const pub = r[ci.pub] || null, key = pub || (r[ci.act] + '|' + r[0]);
      activation.push({ key: key, code: r[0], act: r[ci.act], publicId: pub,
        value: { actif: r[ci.actif], months: r[ci.months] || null, motif: r[ci.motif] || '', security: r[ci.security], annee: r[ci.annee] } });
    });
    // 2. plan de visites validé : cellules, ajouts/retraits manuels et motifs de non-réalisation des sites du périmètre
    const rbmPlan = [], months = Object.create(null), RP = P.rbmPlan;
    if (RP && typeof RP === 'object') {
      Object.keys(RP.months || {}).forEach(m => { const M = RP.months[m] || {}, cells = M.cells || {}; let n = 0;
        Object.keys(cells).forEach(k => { const cell = cells[k]; const fo = fedNormFo(cell && cell.fo) || fedKeyFo(sm, k); if (!inScope(fo)) return; rbmPlan.push({ typ: 'cell', m: m, key: k, value: cell }); n++; });
        if (n) months[m] = { savedAt: M.savedAt || null, by: M.by || null }; });
      Object.keys(RP.manual || {}).forEach(km => { const fo = fedKeyFo(sm, km); if (!inScope(fo)) return; rbmPlan.push({ typ: 'manual', key: km, value: RP.manual[km] }); });
      Object.keys(RP.misses || {}).forEach(km => { const fo = fedKeyFo(sm, km); if (!inScope(fo)) return; rbmPlan.push({ typ: 'miss', key: km, value: RP.misses[km] }); });
    }
    // 3. capacités RBM (et plafonds par activité) du bureau
    const rbmCap = [], R = P.rbm;
    if (R && typeof R === 'object') {
      Object.keys(R.cap || {}).forEach(fo => { if (inScope(fedNormFo(fo))) rbmCap.push({ typ: 'cap', key: fo, value: R.cap[fo] }); });
      Object.keys(R.capAct || {}).forEach(k => { const fo = fedNormFo(String(k).split('|')[0]); if (inScope(fo)) rbmCap.push({ typ: 'capAct', key: k, value: R.capAct[k] }); });
    }
    // 4. cas à suivre des sites du périmètre (clé activité|site|jour|code)
    const cases = [], CS = P.cases;
    if (CS && typeof CS === 'object') Object.keys(CS).forEach(k => { const fo = fedKeyFo(sm, k); if (fo === null ? scope !== null : !inScope(fo)) return; cases.push({ key: k, value: CS[k] }); });
    // 5. décisions de pilotage (clés sémantiques, non géographiques : exportées en entier)
    const pilot = [], PD = P.pilotDecisions;
    if (PD && typeof PD === 'object' && !Array.isArray(PD)) Object.keys(PD).forEach(k => pilot.push({ key: k, value: PD[k] }));
    // 6. textes du rapport saisis (localStorage de ce fichier ; disponibles seulement sur la copie vivante)
    const report = [];
    if (P === CUR && typeof ovStoreLoad === 'function') { try { const S = ovStoreLoad(); if (S && typeof S === 'object') Object.keys(S).forEach(k => { const v = S[k]; if (v && typeof v === 'object' && typeof v.t === 'string') report.push({ key: k, value: { t: v.t.slice(0, 20000), base: typeof v.base === 'string' ? v.base.slice(0, 20000) : null, ver: typeof v.ver === 'string' ? v.ver : null, at: typeof v.at === 'string' ? v.at : null } }); }); } catch (e) { /* stockage indisponible */ } }
    // 7. soumissions (optionnel : par défaut nationales, pas dans le paquet)
    let subs = null;
    if (opt.subs && P.subs && Array.isArray(P.subs.rows)) { const fi = P.subs.cols.indexOf('fo'); const rows = fi < 0 ? [] : P.subs.rows.filter(r => inScope(fedNormFo(r[fi]))); if (rows.length) subs = { cols: P.subs.cols.slice(), rows: rows }; }

    const keys = { activation: activation.length, rbmPlan: rbmPlan.length, rbmCap: rbmCap.length, cases: cases.length, pilot: pilot.length, report: report.length, subs: subs ? subs.rows.length : 0 };
    return { mems_fed: 1, office: fedIsNat(office) ? FED_NAT : fedNormFo(office), dataVersion: P.generated || null, planVersion: P.planVersion || 0,
      exportedAt: new Date().toISOString(), by: (typeof SESSION !== 'undefined' && SESSION.by) || '', keys: keys,
      records: { activation: activation, rbmPlan: rbmPlan, rbmCap: rbmCap, cases: cases, pilot: pilot, report: report, subs: subs } };
  }

  // ------------------------------------------------------------------ lecture / validation stricte d'un paquet
  function fedParsePackage(text, name) {
    let o; try { o = JSON.parse(text); } catch (e) { throw new Error('JSON illisible'); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('ce n’est pas un paquet de bureau');
    if (o.mems_fed !== 1) throw new Error('format non reconnu (étiquette mems_fed absente)');
    if (typeof o.office !== 'string' || !o.office.trim()) throw new Error('bureau d’origine absent');
    const rec = o.records && typeof o.records === 'object' && !Array.isArray(o.records) ? o.records : {};
    const arr = k => Array.isArray(rec[k]) ? rec[k].slice(0, FED_MAX_REC).filter(r => r && typeof r === 'object' && typeof r.key === 'string' && fedSafeKey(r.key)) : [];
    const subs = rec.subs && typeof rec.subs === 'object' && Array.isArray(rec.subs.rows) && Array.isArray(rec.subs.cols) ? { cols: rec.subs.cols, rows: rec.subs.rows.slice(0, FED_MAX_REC) } : null;
    return { mems_fed: 1, office: o.office.trim().slice(0, 80), dataVersion: typeof o.dataVersion === 'string' ? o.dataVersion : null,
      planVersion: +o.planVersion || 0, exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : null, by: typeof o.by === 'string' ? o.by.slice(0, 80) : '',
      name: name || null,
      records: { activation: arr('activation'), rbmPlan: arr('rbmPlan'), rbmCap: arr('rbmCap'), cases: arr('cases'), pilot: arr('pilot'), report: arr('report'), subs: subs } };
  }

  // ------------------------------------------------------------------ consolidation (pure : clone P0, ne le touche jamais)
  // Retourne { P, applied, conflicts, outOfScope, unmatched, perPkg, offices, dataVersions, reportTexts }.
  function fedConsolidate(P0, packages, opt) {
    opt = opt || {}; const P = fedClone(P0); const sm = fedSiteFo(P);
    const reg = {}; FED_KINDS.forEach(k => reg[k] = new Map());
    const applied = { activation: 0, rbmPlan: 0, rbmCap: 0, cases: 0, pilot: 0, report: 0, subs: 0 };
    const conflicts = [], outOfScope = [], unmatched = [], perPkg = [];
    let subsSig = null;   // signatures des fiches existantes, bâties à la première fiche reçue (dédoublonnage, jamais de perte)
    const offices = [], dataVersions = Object.create(null);
    const prov = fedProvObj(P);
    // textes du rapport : base = store national courant (passé par l'UI) ; sinon vide
    const reportTexts = Object.create(null); const rb = opt.reportBase && typeof opt.reportBase === 'object' ? opt.reportBase : {};
    Object.keys(rb).forEach(k => { if (fedSafeKey(k)) reportTexts[k] = rb[k]; });

    // assure les conteneurs opérationnels
    if (!P.cases || typeof P.cases !== 'object' || Array.isArray(P.cases)) P.cases = {};
    if (!P.pilotDecisions || typeof P.pilotDecisions !== 'object' || Array.isArray(P.pilotDecisions)) P.pilotDecisions = {};
    if (!Array.isArray(P.pilotLog)) P.pilotLog = [];
    if (!Array.isArray(P.mergeLog)) P.mergeLog = [];
    if (!P.rbm || typeof P.rbm !== 'object') P.rbm = {};
    P.rbm.cap = P.rbm.cap && typeof P.rbm.cap === 'object' ? P.rbm.cap : {};
    P.rbm.capAct = P.rbm.capAct && typeof P.rbm.capAct === 'object' ? P.rbm.capAct : {};

    // index national du plan (pour l'activation) : publicId -> row, et act|code -> row
    const PF = P.planFull, c = k => PF.cols.indexOf(k);
    const pc = { act: c('act'), pub: c('publicId'), actif: c('actif'), months: c('months'), motif: c('motif'), security: c('security'), annee: c('annee') };
    const rowByPub = new Map(), rowByKey = new Map();
    PF.rows.forEach(r => { if (r[pc.pub]) rowByPub.set(r[pc.pub], r); rowByKey.set(r[pc.act] + '|' + r[0], r); });

    const at = typeof localDay === 'function' ? localDay() : new Date().toISOString().slice(0, 10);

    packages.forEach(pkg => {
      const office = fedNormFo(pkg.office) || pkg.office; offices.push(office);
      if (pkg.dataVersion) dataVersions[pkg.dataVersion] = (dataVersions[pkg.dataVersion] || 0) + 1;
      const pa = { office: office, dataVersion: pkg.dataVersion, exportedAt: pkg.exportedAt, by: pkg.by, name: pkg.name, applied: { activation: 0, rbmPlan: 0, rbmCap: 0, cases: 0, pilot: 0, report: 0, subs: 0 }, conflicts: 0, outOfScope: 0, unmatched: 0 };

      // un pas de fusion générique : conflit = même clé, autre bureau, valeur différente -> garder, signaler, ne pas écraser.
      // siteFo : bureau du site au registre national (chaîne) pour les enregistrements géographiques ; undefined = non géographique (pas de contrôle de périmètre).
      const step = (kind, key, value, siteFo, write) => {
        if (typeof siteFo === 'string' && siteFo && siteFo !== office) { outOfScope.push({ kind: kind, key: key, office: office, siteFo: siteFo }); pa.outOfScope++; }
        const r = reg[kind].get(key);
        if (!r) { if (write() === false) { pa.unmatched++; return; } reg[kind].set(key, { office: office, value: value }); applied[kind]++; pa.applied[kind]++; fedSet(prov[kind], key, { office: office, at: at }); return; }
        if (r.office === office) { if (write() !== false) { r.value = value; } return; }
        if (fedEqual(r.value, value)) return;                    // idempotent (même valeur venue d'ailleurs)
        conflicts.push({ kind: kind, key: key, keep: r.office, drop: office, keepVal: r.value, dropVal: value }); pa.conflicts++;   // conflit : on garde, on signale
      };

      // 1. activation
      pkg.records.activation.forEach(rec => {
        const fo = (rec.publicId && sm.byPub.has(rec.publicId)) ? sm.byPub.get(rec.publicId) : (sm.byKey.has(rec.act + '|' + rec.code) ? sm.byKey.get(rec.act + '|' + rec.code) : undefined);
        step('activation', rec.key, rec.value, fo, () => {
          const row = (rec.publicId && rowByPub.get(rec.publicId)) || rowByKey.get(rec.act + '|' + rec.code);
          if (!row) { unmatched.push({ kind: 'activation', key: rec.key, office: office }); return false; }        // site inconnu : jamais créé
          const v = rec.value || {};
          if (v.actif === 0 || v.actif === 1) row[pc.actif] = v.actif;
          if (typeof v.months === 'string') row[pc.months] = v.months;
          if (typeof v.motif === 'string') row[pc.motif] = v.motif;
          if (v.security === 0 || v.security === 1 || v.security === 3 || v.security === 99) row[pc.security] = v.security;
          if (v.annee === null || typeof v.annee === 'number') row[pc.annee] = v.annee;
        });
      });
      // 2. plan validé
      const ensureRP = () => { if (!P.rbmPlan) P.rbmPlan = { start: null, savedAt: null, by: null, version: 0, months: {}, manual: {}, misses: {}, log: [] }; return P.rbmPlan; };
      pkg.records.rbmPlan.forEach(rec => {
        if (rec.typ === 'cell') { const fo = fedKeyFo(sm, rec.key) || fedNormFo(rec.value && rec.value.fo) || undefined; const m = String(rec.m || '');
          step('rbmPlan', 'cell|' + m + '|' + rec.key, rec.value, fo, () => { const RP = ensureRP(); RP.months = RP.months || {}; const M = RP.months[m] = RP.months[m] || { savedAt: null, by: null, n: 0, cells: {} }; M.cells = M.cells || {}; fedSet(M.cells, rec.key, rec.value); M.n = Object.keys(M.cells).length; }); }
        else if (rec.typ === 'manual') { const fo = fedKeyFo(sm, rec.key) || undefined;
          step('rbmPlan', 'manual|' + rec.key, rec.value, fo, () => { const RP = ensureRP(); RP.manual = RP.manual || {}; fedSet(RP.manual, rec.key, rec.value); }); }
        else if (rec.typ === 'miss') { const fo = fedKeyFo(sm, rec.key) || undefined;
          step('rbmPlan', 'miss|' + rec.key, rec.value, fo, () => { const RP = ensureRP(); RP.misses = RP.misses || {}; fedSet(RP.misses, rec.key, rec.value); }); }
      });
      // 3. capacités RBM
      pkg.records.rbmCap.forEach(rec => {
        if (rec.typ === 'cap') { const fo = fedNormFo(rec.key); step('rbmCap', 'cap|' + fo, rec.value, fo || undefined, () => { fedSet(P.rbm.cap, fo, rec.value); }); }
        else if (rec.typ === 'capAct') { const fo = fedNormFo(String(rec.key).split('|')[0]); step('rbmCap', 'capAct|' + rec.key, rec.value, fo || undefined, () => { fedSet(P.rbm.capAct, rec.key, rec.value); }); }
      });
      // 4. cas
      pkg.records.cases.forEach(rec => { const fo = fedKeyFo(sm, rec.key);
        step('cases', rec.key, rec.value, fo === null ? undefined : fo, () => { fedSet(P.cases, rec.key, rec.value); }); });
      // 5. pilotage (clé sémantique, non géographique)
      pkg.records.pilot.forEach(rec => { step('pilot', rec.key, rec.value, undefined, () => { fedSet(P.pilotDecisions, rec.key, rec.value); P.pilotLog.push({ k: String(rec.key).slice(0, 40), s: rec.value && rec.value.s, at: at, office: office }); while (P.pilotLog.length > 500) P.pilotLog.shift(); }); });
      // 6. textes du rapport (fusion dans reportTexts ; l'UI écrit ensuite dans le localStorage national)
      pkg.records.report.forEach(rec => { step('report', rec.key, rec.value, undefined, () => { fedSet(reportTexts, rec.key, rec.value); }); });
      // 7. soumissions éventuelles (jamais de perte : on ajoute les nouvelles fiches, dédoublonnées par signature)
      if (pkg.records.subs && P.subs && Array.isArray(P.subs.rows) && pkg.records.subs.cols.join('\u0001') === P.subs.cols.join('\u0001')) {
        if (!subsSig) subsSig = new Set(P.subs.rows.map(r => JSON.stringify(r)));
        let add = 0; pkg.records.subs.rows.forEach(r => { if (!Array.isArray(r)) return; const sig = JSON.stringify(r); if (subsSig.has(sig)) return; subsSig.add(sig); P.subs.rows.push(r); add++; });
        applied.subs += add; pa.applied.subs += add;
      }

      perPkg.push(pa);
    });

    // écriture de la provenance et du journal (append-only)
    P.fedProv = prov;
    if (applied.activation) { P.planVersion = (+P.planVersion || 0) + 1; P.planEdited = { date: at, by: 'Consolidation (' + offices.filter((x, i, a) => a.indexOf(x) === i).join(', ') + ')' }; }
    if (P.rbmPlan) P.rbmPlan.version = (+P.rbmPlan.version || 0) + 1;
    P.mergeLog.push({ at: at, by: (typeof SESSION !== 'undefined' && SESSION.by) || '—', offices: offices.slice(), dataVersions: Object.keys(dataVersions),
      applied: Object.assign({}, applied), conflicts: conflicts.length, outOfScope: outOfScope.length, unmatched: unmatched.length,
      detail: conflicts.slice(0, 200).map(x => ({ kind: x.kind, key: x.key, keep: x.keep, drop: x.drop })) });
    while (P.mergeLog.length > 500) P.mergeLog.shift();

    return { P: P, applied: applied, conflicts: conflicts, outOfScope: outOfScope, unmatched: unmatched, perPkg: perPkg,
      offices: offices.filter((x, i, a) => a.indexOf(x) === i), dataVersions: Object.keys(dataVersions), reportTexts: reportTexts };
  }
  // provenance existante (objets sans prototype pour ne jamais tirer une clé d'une valeur)
  function fedProvObj(P) {
    const src = P.fedProv && typeof P.fedProv === 'object' ? P.fedProv : {};
    const out = Object.create(null);
    FED_KINDS.forEach(k => { out[k] = Object.create(null); const s = src[k]; if (s && typeof s === 'object') Object.keys(s).forEach(key => { if (fedSafeKey(key)) out[k][key] = s[key]; }); });
    return out;
  }

  // ------------------------------------------------------------------ UI : onglet Données (mode administrateur)
  function fedHeaderBadge() {
    const host = document.querySelector('header .brand'); if (!host) return;
    const old = document.getElementById('fed-office'); if (old) old.remove();
    const office = fedOfficeOf(CUR); if (!office) return;
    const b = el('span', { class: 'fed-office', id: 'fed-office', text: fedIsNat(office) ? 'Copie nationale' : 'Copie · ' + office });
    bindTip(b, () => fedIsNat(office) ? 'Cette copie sert à consolider les mises à jour des bureaux.' : 'Cette copie appartient au bureau de ' + office + '. Sa mise à jour s’exporte en .json, puis s’intègre à la copie nationale.');
    host.appendChild(b);
  }
  function fedCards(main) {
    if (!SESSION.admin) return;   // réservé au mode administrateur (l'ancre est déjà dans la zone admin)
    fedIdentityCard(main);
    const office = fedOfficeOf(CUR);
    if (!fedIsNat(office)) fedExportCard(main, office);
    fedConsolidateCard(main);
    if (fedIsNat(office)) fedExportCard(main, office);   // au national, l'export (tout) reste possible mais en second
    fedMergeLogCard(main);
  }
  function fedIdentityCard(main) {
    const cur = fedOfficeOf(CUR);
    const sel = el('select', { 'aria-label': 'Bureau de cette copie' });
    sel.appendChild(el('option', { value: '', text: '— choisir —' }));
    sel.appendChild(el('option', { value: FED_NAT, text: 'National / consolidation' }));
    fedOffices().forEach(o => sel.appendChild(el('option', { value: o, text: 'Bureau de ' + o })));
    sel.value = cur || '';
    const msg = el('p', { class: 'note' }); msg.style.display = 'none';
    const save = btn('Enregistrer', () => requireAdmin(() => {
      const v = sel.value; if (!v) { msg.style.display = ''; msg.textContent = 'Choisissez d’abord le bureau de cette copie.'; msg.className = 'note warn'; return; }
      CUR.office = v === FED_NAT ? FED_NAT : fedNormFo(v); SESSION.dirty = true; fedHeaderBadge();
      msg.style.display = ''; msg.textContent = 'Identité enregistrée. Téléchargez le dashboard mis à jour pour la garder dans le fichier.'; msg.className = 'note';
    }), 'on');
    const info = 'À poser une fois par copie. Un bureau choisit son nom : sa mise à jour s’exporte alors pour ses seuls sites. La copie « National » sert à recevoir et fusionner les paquets des bureaux.';
    const body = [el('div', { class: 'frow' }, [el('label', { class: 'fld' }, ['Bureau de cette copie', sel]), save]), msg,
      cur ? note(fedIsNat(cur) ? 'Copie nationale (consolidation).' : 'Copie du bureau de ' + cur + '.', 'hint') : note('Non renseigné.', 'hint')];
    main.appendChild(fedCard('Identité de ce fichier', info, body));
  }
  function fedExportCard(main, office) {
    const pkg = fedBuildPackage(CUR, office, {});   // aperçu des volumes, sans les fiches
    const k = pkg.keys;
    const subsChk = el('input', { type: 'checkbox', 'aria-label': 'Inclure les fiches de suivi de ce bureau' });
    const rows = [['Plan / activation des sites', k.activation], ['Plan de visites validé', k.rbmPlan], ['Capacités RBM', k.rbmCap], ['Cas à suivre', k.cases], ['Décisions de pilotage', k.pilot], ['Textes du rapport', k.report]];
    const go = btn('Exporter la mise à jour de ce bureau (.json)', () => requireAdmin(() => {
      const full = fedBuildPackage(CUR, office, { subs: subsChk.checked });
      const name = 'maj_bureau_' + fedSlug(fedIsNat(office) ? 'national' : office) + '_' + (CUR.generated || localDay()) + '.json';
      downloadBlob(new Blob([JSON.stringify(full)], { type: 'application/json;charset=utf-8' }), name);
    }), 'on');
    const info = 'Paquet léger et daté (étiquette bureau, version des données, date d’export). Il contient la couche opérationnelle des sites de ce bureau, sans les soumissions nationales ni aucune donnée personnelle de bénéficiaire. À envoyer au national pour consolidation.';
    const body = [el('div', { class: 'fed-counts' }, rows.map(([l, n]) => el('div', { class: 'fed-chip' }, [el('span', { class: 'fed-n', text: fmt(n) }), el('span', { class: 'fed-l', text: l })]))),
      el('label', { class: 'fed-opt' }, [subsChk, el('span', { text: 'Inclure aussi les fiches de suivi de ce bureau (rare : les extractions sont normalement nationales)' })]),
      el('div', { class: 'frow' }, [go])];
    main.appendChild(fedCard('Mise à jour de ce bureau', info, body));
  }
  function fedConsolidateCard(main) {
    const fi = inp({ type: 'file', accept: '.json,application/json', 'aria-label': 'Paquets des bureaux (.json)' }); fi.multiple = true;
    const st = el('p', { class: 'hint' });
    const pv = el('div', { class: 'fed-pv' });
    const say = (t, warn) => { st.textContent = t; st.className = 'note' + (warn ? ' warn' : ''); };
    fi.addEventListener('change', async () => {
      const files = Array.from(fi.files || []); clear(pv); FED.packages = []; FED.result = null; FED.preview = null;
      if (!files.length) { say('Choisissez un ou plusieurs fichiers .json exportés par les bureaux.'); return; }
      const pkgs = [], errs = [];
      for (const f of files) {
        if (f.size > FED_MAX_PKG) { errs.push(f.name + ' : trop volumineux (' + fmt(f.size / 1e6, 1) + ' Mo, plafond ' + fmt(FED_MAX_PKG / 1e6, 0) + ' Mo)'); continue; }
        try { const text = await f.text(); pkgs.push(fedParsePackage(text, f.name)); }
        catch (e) { errs.push(f.name + ' : ' + String((e && e.message) || e)); }
      }
      FED.packages = pkgs;
      if (errs.length) say(fmt(errs.length) + ' fichier(s) refusé(s) : ' + errs.join(' ; '), true);
      else say('Vérification terminée, rien n’a été modifié.');
      if (pkgs.length) { try { FED.result = fedConsolidate(CUR, pkgs, { reportBase: (typeof ovStoreLoad === 'function' ? ovStoreLoad() : {}) }); fedPreviewView(pv, FED.result); } catch (e) { say('Vérification impossible : ' + String((e && e.message) || e), true); } }
    });
    const info = 'Sur la copie nationale : importez les paquets .json des bureaux. L’aperçu montre, avant toute écriture, les bureaux, le nombre de clés par type, les périmètres et les conflits éventuels. Périmètres disjoints = aucune perte ni double comptage. Un conflit (même clé modifiée par deux bureaux) est signalé et jamais écrasé : à vous de trancher.';
    main.appendChild(fedCard('Consolider les mises à jour des bureaux', info, [el('div', { class: 'frow' }, [el('label', { class: 'fld' }, ['Paquets des bureaux (.json)', fi])]), st, pv], 'wide'));
  }
  function fedPreviewView(pv, R) {
    clear(pv);
    const cols = [{ k: 'office', t: 'Bureau' }, { k: 'dataVersion', t: 'Données', fmt: r => r.dataVersion || '–' }, { k: 'exportedAt', t: 'Exporté le', fmt: r => r.exportedAt ? String(r.exportedAt).slice(0, 10) : '–' }];
    FED_KINDS.forEach(k => cols.push({ k: k, t: fedKindShort(k), num: 1, fmt: r => fmt(r.applied[k]) }));
    cols.push({ k: 'conflicts', t: 'Conflits', num: 1, fmt: r => r.conflicts ? el('span', { class: 'fed-bad', text: fmt(r.conflicts) }) : '0' });
    cols.push({ k: 'outOfScope', t: 'Hors périmètre', num: 1, fmt: r => r.outOfScope ? el('span', { class: 'fed-warn', text: fmt(r.outOfScope) }) : '0' });
    pv.appendChild(xsec('Paquets reçus', [table(cols, R.perPkg)]));

    const totApplied = FED_KINDS.reduce((a, k) => a + R.applied[k], 0) + R.applied.subs;
    const sumKv = [['Bureaux', R.offices.join(', ') || '–'], ['Enregistrements intégrés', fmt(totApplied)], ['Conflits signalés', fmt(R.conflicts.length)], ['Hors périmètre', fmt(R.outOfScope.length)], ['Sites inconnus (jamais créés)', fmt(R.unmatched.length)]];
    if (R.dataVersions.length > 1) sumKv.push(['Versions de données', R.dataVersions.join(', ') + ' — fusion quand même (la couche opérationnelle suit les sites, pas les lignes d’extraction)']);
    pv.appendChild(xsec('Bilan', [kvList(sumKv)]));

    if (R.conflicts.length) {
      const cr = R.conflicts.slice(0, 200).map(x => ({ kind: fedKindShort(x.kind), key: x.key, keep: x.keep, drop: x.drop, keepVal: fedShort(x.keepVal), dropVal: fedShort(x.dropVal) }));
      pv.appendChild(el('details', { class: 'fed-panel' }, [el('summary', null, [el('b', { text: fmt(R.conflicts.length) + ' conflit(s) — gardés des deux bureaux, aucun écrasé' }), infoBtn('Même clé modifiée par deux bureaux avec des valeurs différentes. La valeur du premier bureau consolidé est conservée ; l’autre est journalisée. À trancher à la main (par exemple en recontactant le bureau concerné).')]),
        table([{ k: 'kind', t: 'Type' }, { k: 'key', t: 'Clé' }, { k: 'keep', t: 'Gardé (bureau)' }, { k: 'keepVal', t: 'Valeur gardée' }, { k: 'drop', t: 'Écarté (bureau)' }, { k: 'dropVal', t: 'Valeur écartée' }], cr)]));
    }
    if (R.outOfScope.length) {
      const orr = R.outOfScope.slice(0, 200).map(x => ({ kind: fedKindShort(x.kind), key: x.key, office: x.office, siteFo: x.siteFo }));
      pv.appendChild(el('details', { class: 'fed-panel' }, [el('summary', null, [el('b', { text: fmt(R.outOfScope.length) + ' enregistrement(s) hors périmètre du bureau' }), infoBtn('Le paquet décrit un site qui, dans le registre national, appartient à un autre bureau (ou à aucun). Intégré quand même s’il n’entre pas en conflit, mais signalé pour vérifier qui est responsable du site.')]),
        table([{ k: 'kind', t: 'Type' }, { k: 'key', t: 'Clé' }, { k: 'office', t: 'Paquet du bureau' }, { k: 'siteFo', t: 'Bureau du site (national)' }], orr)]));
    }

    const go = btn('Intégrer dans la copie nationale', () => fedApply(), 'on');
    const cancel = btn('Annuler', () => { FED.packages = []; FED.result = null; clear(pv); });
    pv.appendChild(el('div', { class: 'frow fed-act' }, [go, cancel, note(R.conflicts.length ? 'Les conflits seront journalisés ; les valeurs existantes ne sont pas écrasées.' : 'Rien n’a encore été modifié.', R.conflicts.length ? 'warn' : 'hint')]));
  }
  function fedApply() {
    requireAdmin(() => setTimeout(() => {
      const R = FED.result; if (!R) return;
      // textes du rapport : écrits dans le localStorage national (hors CUR)
      if (R.reportTexts && typeof ovStoreSave === 'function') { try { const o = {}; Object.keys(R.reportTexts).forEach(k => { if (fedSafeKey(k)) o[k] = R.reportTexts[k]; }); ovStoreSave(o); } catch (e) { /* stockage indisponible */ } }
      SESSION.dirty = true; FED.packages = []; FED.result = null;
      reboot(ENGINE.refreshPlanTables(R.P), 'data');
      setTimeout(() => { try { exportHtml(); } catch (e) { /* téléchargement manuel possible via « Enregistrer et partager » */ } }, 50);
    }, 0));
  }
  function fedMergeLogCard(main) {
    const L = Array.isArray(CUR.mergeLog) ? CUR.mergeLog.slice(-50).reverse() : []; if (!L.length) return;
    const rows = L.map(e => ({ at: e.at || '–', offices: (e.offices || []).join(', '), applied: FED_KINDS.reduce((a, k) => a + ((e.applied && e.applied[k]) || 0), 0) + ((e.applied && e.applied.subs) || 0), conflicts: e.conflicts || 0, oos: e.outOfScope || 0, by: e.by || '–' }));
    main.appendChild(fedCard('Journal des consolidations', 'Enregistré dans le fichier (append-only). Chaque ligne : date, bureaux intégrés, enregistrements, conflits.', [table([
      { k: 'at', t: 'Date' }, { k: 'offices', t: 'Bureaux' }, { k: 'applied', t: 'Intégrés', num: 1, fmt: r => fmt(r.applied) }, { k: 'conflicts', t: 'Conflits', num: 1, fmt: r => fmt(r.conflicts) }, { k: 'oos', t: 'Hors périmètre', num: 1, fmt: r => fmt(r.oos) }, { k: 'by', t: 'Par' }], rows)], 'wide'));
  }

  // ---- petits utilitaires d'affichage ----
  function fedCard(title, info, body, cls) { const c = card(title, null, body, cls); const h = c.querySelector('.ch'); if (info && h) h.appendChild(infoBtn(info)); return c; }
  function fedKindShort(k) { return ({ activation: 'Activation', rbmPlan: 'Plan validé', rbmCap: 'Capacités', cases: 'Cas', pilot: 'Pilotage', report: 'Rapport', subs: 'Fiches' })[k] || k; }
  function fedSlug(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'bureau'; }
  function fedShort(v) { try { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; } catch (e) { return '–'; } }

  // accroche de test : paquets et consolidation accessibles via #debug
  if (/debug/.test(location.hash)) window.__dashFed = { build: (office, opt) => fedBuildPackage(CUR, office, opt || {}), buildFrom: (P, office, opt) => fedBuildPackage(P, office, opt || {}), parse: fedParsePackage, consolidate: (P, pkgs, opt) => fedConsolidate(P || CUR, pkgs, opt || {}), siteFo: () => fedSiteFo(CUR), offices: fedOffices, CUR: () => CUR, clone: fedClone }; /*DEBUG*/
