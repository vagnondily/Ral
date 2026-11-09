'use strict';
// Lot « planification » : un seul moteur de plan (rbmCfg / rbmCompute), un seul registre (siteRows), une seule écriture du
// plan de suivi (plEdit, module), un seul import (onglet Données, reconnaît aussi les exports MoDA / ONA / Kobo).
// Les fonctions du moteur sont écrites ici comme de vraies fonctions (Node vérifie leur syntaxe) et injectées par toString().
/* eslint-disable no-undef */

// ======================================================================= MOTEUR (IIFE ENGINE) — fonctions injectées
function parseCSV(text, onHeader, onRow) {
  // RFC 4180 : BOM, séparateur , ; ou tabulation (compté hors guillemets), champs entre guillemets sur plusieurs lignes.
  // Garde-fous (données non fiables) : ligne de plus de 1 Mo ou plus de 5 000 colonnes → refus propre, rien n'est écrit.
  const MAX_COLS = 5000, MAX_LINE = 1e6;
  let i = 0; const n = text.length;
  if (text.charCodeAt(0) === 0xFEFF) i = 1;
  const nl = text.indexOf('\n', i); const first = text.slice(i, nl < 0 ? n : nl);
  const cnt = c => { let k = 0, q = false; for (let p = 0; p < first.length; p++) { const ch = first[p]; if (ch === '"') q = !q; else if (!q && ch === c) k++; } return k; };
  const sep = [',', ';', '\t'].sort((a, b) => cnt(b) - cnt(a))[0]; const SEP = sep.charCodeAt(0);
  let row = [], field = '', header = null, keep = null, line = 1, rowStart = i;
  const tooLong = () => { throw new Error('ligne ' + line + ' anormalement longue (plus de 1 Mo)'); };
  while (i < n) {
    let c = text.charCodeAt(i);
    if (c === 34 && field === '') {
      i++; let start = i, buf = '';
      for (;;) {
        const q = text.indexOf('"', i);
        if (q < 0) { buf += text.slice(start); i = n; break; }
        if (text.charCodeAt(q + 1) === 34) { buf += text.slice(start, q + 1); i = q + 2; start = i; continue; }
        buf += text.slice(start, q); i = q + 1; break;
      }
      if (i - rowStart > MAX_LINE) tooLong();
      field = buf; c = text.charCodeAt(i);
      // tolerate stray characters after closing quote
      while (i < n && c !== SEP && c !== 10 && c !== 13) { field += text[i]; i++; c = text.charCodeAt(i); }
    }
    if (i >= n) break;
    if (c === SEP) { row.push(field); field = ''; i++; if (row.length > MAX_COLS) throw new Error('ligne ' + line + ' : plus de ' + MAX_COLS + ' colonnes'); continue; }
    if (c === 13 || c === 10) {
      row.push(field); field = '';
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      i++;
      if (!header) { header = row; keep = onHeader(header); } else if (row.length > 1 || row[0] !== '') onRow(row, keep);
      row = []; line++; rowStart = i; continue;
    }
    const j0 = i; while (i < n) { const d = text.charCodeAt(i); if (d === SEP || d === 10 || d === 13) break; i++; }
    field += text.slice(j0, i);
    if (i - rowStart > MAX_LINE) tooLong();
  }
  if (field !== '' || row.length) { row.push(field); if (!header) { header = row; onHeader(header); } else onRow(row, keep); }
  return header;
}

// ---- correspondance des colonnes : extraction Tableau OU export brut MoDA / ONA / Kobo (codes « XML » ou libellés)
// Un export brut nomme les colonnes d'après le XLSForm : « groupe/sous-groupe/variable », « groupe-variable », « groupe:variable »,
// choix multiples « variable/code » (export en codes) ou « variable/Libellé » (export en libellés). Le spec connaît chaque variable par
// son nom XLSForm : on résout le même besoin par le nom exact de colonne, puis par le nom de variable, puis par le libellé.
// Toutes les tables indexées par un nom de colonne importé sont des Map ou des objets sans prototype.
let EX_CTX = null;   // P courant (registre des sites, codes administratifs) : posé par previewExtract et par l'enveloppe d'importActivity
const LAB_NORM = s => asciiFold(String(s === null || s === undefined ? '' : s)).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const LAB_YESNO = new Map([['oui', '1'], ['yes', '1'], ['vrai', '1'], ['true', '1'], ['non', '0'], ['no', '0'], ['faux', '0'], ['false', '0'], ['partiellement', '2'], ['partiel', '2'], ['partially', '2'], ['en partie', '2']]);
const LAB_NA = new Set(['', 'n a', 'na', 'nan', 'sans objet', 'non applicable', 'not applicable', 'none', 'null']);
const LAB_CODE = /^-?\d+(\.\d+)?$|^(true|false)$/i;
// Colonne de site d'un export brut Kobo : le spec nomme la variable avec le suffixe de l'activité
// (DPName_GD, DPName_MAM, DPName_MIARO, DPName_SMP, DPName_Resilience_re) mais l'export garde le nom
// de base du XLSForm. Table documentée du dernier segment attendu, par activité :
//   GD / PECMAM : DPName (code POI « MG… » ou nom saisi) · MIARO : POIName · SMP : Adm4Code_SMP (code
//   du fokontany de l'école, format du registre SMP) · RES : rattaché par nom (ADMIN5Name_DP, chemin « libellés »).
// Les colonnes « …_Other / _oth » (site hors liste) sont écartées : on ne compare que le dernier segment EXACT.
const SITE_ALIASES = { GD: ['dpname', 'poiname'], PECMAM: ['dpname', 'poiname'], MIARO: ['poiname', 'dpname'], SMP: ['adm4codesmp', 'adm4codesmpid', 'dpname', 'poiname'], RES: ['dpname', 'poiname'] };
function siteSegKey(h) { return asciiFold(hClean(h)).toLowerCase().split(/[/:]/).pop().replace(/[^a-z0-9]+/g, ''); }
function resolveSiteAlias(M, S, act) {
  const site = S.tb && S.tb.site; if (!site || M.idx[site] !== undefined || !act) return null;
  const al = SITE_ALIASES[act]; if (!al) return null;
  const used = new Set(Object.keys(M.idx).map(k => M.idx[k]));
  for (const key of al) {
    let any = -1, free = -1;
    for (let j = 0; j < M.header.length; j++) { if (siteSegKey(M.header[j]) !== key) continue; if (any < 0) any = j; if (!used.has(j)) { free = j; break; } }
    const pick = free >= 0 ? free : any;
    if (pick >= 0) { M.idx[site] = pick; M.src[site] = 'site'; return M.header[pick]; }
  }
  return null;
}
function needOf(S, gdRep) {
  const need = new Set([S.mainid]);
  Object.values(S.vars).forEach(v => { if (v.t === 'm') v.o.forEach(o => need.add(o[0])); else need.add(v.c); });
  Object.values(S.tb).forEach(c => need.add(c));
  if (gdRep) { need.add(gdRep.fid); need.add(gdRep.sex); need.add(gdRep.rid); Object.values(gdRep.stock).forEach(c => c && need.add(c)); }
  return need;
}
function hClean(h) { return String(h === null || h === undefined ? '' : h).replace(/^﻿/, '').trim(); }
function hKey(h) { return asciiFold(hClean(h)).toLowerCase().replace(/[/:.-]+/g, '/').replace(/\s+/g, ' ').replace(/^\/+|\/+$/g, ''); }
// libellé ↔ code d'une variable, d'après les listes de choix du spec et les tables de l'explorateur (une seule source : le formulaire)
function labelDicts(S) {
  const toCode = new Map(), toLabel = new Map();
  const put = (nm, code, label) => { if (!nm || label === undefined || label === null) return; if (!toCode.has(nm)) { toCode.set(nm, new Map()); toLabel.set(nm, new Map()); } const k = LAB_NORM(label); if (k && !toCode.get(nm).has(k)) toCode.get(nm).set(k, String(code)); if (!toLabel.get(nm).has(String(code))) toLabel.get(nm).set(String(code), String(label)); };
  Object.keys(S.choices || {}).forEach(nm => { const c = S.choices[nm]; if (c && typeof c === 'object') Object.keys(c).forEach(code => put(nm, code, c[code])); });
  (S.explorer || []).forEach(q => { if (q && q.n && Array.isArray(q.k) && Array.isArray(q.c)) q.k.forEach((code, i) => put(q.n, code, q.c[i])); });
  return { toCode, toLabel };
}
function headerMap(header, S, gdRep) {
  const need = needOf(S, gdRep), LD = labelDicts(S);
  const exact = new Map(), suf = new Map(), kids = new Map();
  header.forEach((h, j) => {
    const k = hClean(h); if (k && !exact.has(k)) exact.set(k, j);
    const segs = hKey(h).split('/').filter(x => x !== '');
    for (let i = 0; i < segs.length; i++) { const sk = segs.slice(i).join('/'); if (!suf.has(sk)) suf.set(sk, j); }
    if (segs.length >= 2) { const p = segs[segs.length - 2]; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(j); }
  });
  // libellés de questions connus du spec (normes, explorateur) → nom de variable (export « en-têtes en libellés »)
  const lab = new Map(); let byLabel = 0;
  (S.items || []).forEach(it => { if (it && it.label && it.name) lab.set(hKey(it.label), it.name); });
  (S.explorer || []).forEach(q => { if (q && q.l && q.n) lab.set(hKey(q.l), q.n); });
  header.forEach((h, j) => { const nm = lab.get(hKey(h)); if (nm) { const k = hKey(nm); if (!suf.has(k)) { suf.set(k, j); byLabel++; } } });
  const idx = Object.create(null), src = Object.create(null), combo = Object.create(null);
  const put = (k, j, how) => { if (j === undefined || j === null || idx[k] !== undefined) return false; idx[k] = j; src[k] = how; return true; };
  need.forEach(k => { if (exact.has(k)) put(k, exact.get(k), 'exact'); });
  Object.keys(S.vars).forEach(nm => {
    const v = S.vars[nm], key = hKey(nm);
    if (v.t === 'm') {
      const tl = LD.toLabel.get(nm);
      v.o.forEach(o => {
        const cap = o[0], code = String(o[1]); if (idx[cap] !== undefined) return;
        if (put(cap, suf.get(key + '/' + hKey(code)), 'nom')) return;
        const l = tl && tl.get(code); if (l && put(cap, suf.get(key + '/' + hKey(l)), 'libellé')) return;
      });
      // export en libellés sans liste connue : colonnes filles dans l'ordre du formulaire = options dans l'ordre du spec
      const ch = (kids.get(key) || []).filter(j => !Object.keys(idx).some(k => idx[k] === j));
      if (v.o.every(o => idx[o[0]] === undefined) && ch.length && ch.length === v.o.length) v.o.forEach((o, i) => put(o[0], ch[i], 'position'));
      if (v.o.every(o => idx[o[0]] === undefined)) { const jc = suf.get(key); if (jc !== undefined) v.o.forEach(o => { combo[o[0]] = String(o[1]); put(o[0], jc, 'liste'); }); }
    }
    else if (v.c && idx[v.c] === undefined) put(v.c, suf.get(key), 'nom');
  });
  need.forEach(k => {
    if (idx[k] !== undefined) return;
    const c = [hKey(k)]; const p2 = k.lastIndexOf('__'); if (p2 >= 0) c.push(hKey(k.slice(p2 + 2)));
    const p3 = k.replace(/\s*\(Data\d*\)\s*$/i, ''); if (p3 !== k) c.push(hKey(p3));
    for (const x of c) { const j = suf.has(x) ? suf.get(x) : suf.has('_' + x) ? suf.get('_' + x) : suf.get(x.replace(/^_+/, '')); if (j !== undefined) { put(k, j, 'nom'); break; } }
  });
  // GPS d'un export Kobo : colonnes « …/_HHCoord_xx_latitude / _longitude / _precision » dérivées de la colonne de précision du spec
  let gps = null;
  if (S.tb && S.tb.prec && (idx[S.tb.lat] === undefined || idx[S.tb.lon] === undefined)) {
    const p = String(S.tb.prec), i0 = p.lastIndexOf('_HHCoord');
    if (i0 >= 0) { const tail = p.slice(i0); const seg = x => hKey(tail.replace(/precision$/i, x)); const jl = suf.get(seg('latitude')), jo = suf.get(seg('longitude')), jp = suf.get(seg('precision'));
      if (jl !== undefined && jo !== undefined) { if (put(S.tb.lat, jl, 'gps') | put(S.tb.lon, jo, 'gps')) gps = tail; if (jp !== undefined) put(S.tb.prec, jp, 'gps'); } }
  }
  if (idx[S.mainid] === undefined) { for (const a of ['_uuid', 'meta/instanceid', 'instanceid', '_id', '_index', 'key']) { if (put(S.mainid, suf.get(a), 'identifiant')) break; } }
  const H = header.map(hClean);
  return { idx, src, combo, byLabel, header: H, idSource: idx[S.mainid] !== undefined ? H[idx[S.mainid]] : null, gps, LD };
}
function makeGetters(M) {
  const g = new Map();
  Object.keys(M.idx).forEach(k => {
    const j = M.idx[k], code = M.combo[k];
    if (code === undefined) g.set(k, row => { const v = row[j]; return v === undefined || NA_SET.has(v) ? null : v; });
    else g.set(k, row => { const v = row[j]; if (v === undefined || NA_SET.has(v)) return null; return String(v).split(/[\s,;]+/).indexOf(code) >= 0 ? '1' : '0'; });
  });
  return g;
}
// 2ᵉ ligne d'en-tête d'un export Kobo « en libellés » : les cellules reprennent le nom de la variable (« _id », « start ») ou le libellé de la question
function isLabelRow(row, M, S) {
  const seg = h => { const s = String(h).split(/[/]/).pop(); return s; };
  let eq = 0; M.header.forEach((h, j) => { if (row[j] !== undefined && row[j] !== '' && row[j] === seg(h)) eq++; });
  const ji = M.idx[S.mainid], idv = ji === undefined ? undefined : row[ji];
  const idLikeData = idv !== undefined && (/^\d+$/.test(String(idv)) || /^[0-9a-f-]{20,}$/i.test(String(idv)));
  if (idLikeData) return false;
  if (ji !== undefined && idv !== undefined && LAB_NORM(idv) === LAB_NORM(seg(M.header[ji]))) return true;
  return eq >= 5;
}
function mapReport(M, S) {
  const used = new Set(); Object.keys(M.idx).forEach(k => used.add(M.idx[k]));
  let exactN = 0, aliasN = 0; const alias = [];
  Object.keys(M.idx).forEach(k => { if (M.src[k] === 'exact') exactN++; else { aliasN++; if (alias.length < 80) alias.push([k, M.header[M.idx[k]], M.src[k]]); } });
  const names = Object.keys(S.vars); const missing = []; let found = 0;
  names.forEach(nm => { const v = S.vars[nm]; const ok = v.t === 'm' ? v.o.some(o => M.idx[o[0]] !== undefined) : M.idx[v.c] !== undefined; if (ok) found++; else missing.push(nm); });
  const tbMissing = Object.keys(S.tb).filter(k => M.idx[S.tb[k]] === undefined).map(k => k + ' (' + S.tb[k] + ')');
  const ignored = M.header.filter((h, j) => h && !used.has(j));
  return { exactN, aliasN, alias, missing, tbMissing, ignored, nVars: names.length, found, idSource: M.idSource, byLabel: M.byLabel };
}
function readExtract(text, S, gdRep) {
  const P = EX_CTX; const act = P && P.spec && P.spec.acts ? Object.keys(P.spec.acts).find(a => P.spec.acts[a].tab === S.tab && P.spec.acts[a].mainid === S.mainid) || null : null;
  let M = null, G = null, mainRows = [], seen = new Set(), fRows = [], fSeen = new Set(), sRows = [], sSeen = new Set(), nRaw = 0, noId = 0, header, labelRow = false, first = true, siteAlias = null;
  const cols = [];
  const val = (row, k) => { const f = G.get(k); return f ? f(row) : null; };
  header = parseCSV(text, h => { M = headerMap(h, S, gdRep); siteAlias = resolveSiteAlias(M, S, act); G = makeGetters(M); Object.keys(M.idx).forEach(k => cols.push(k)); return null; }, row => {
    if (first) { first = false; if (isLabelRow(row, M, S)) { labelRow = true; return; } }
    nRaw++;
    const id = val(row, S.mainid); if (id === null) noId++;
    const key = id === null ? '\u0000' : id;
    if (!seen.has(key)) { seen.add(key); mainRows.push(cols.map(k => val(row, k))); }
    if (gdRep) {
      const nid = id !== null && NUMRE.test(id) ? String(Number(id)) : id;
      const f = val(row, gdRep.fid); if (f !== null && !fSeen.has(f)) { fSeen.add(f); fRows.push([nid, val(row, gdRep.sex)]); }
      const s = val(row, gdRep.rid); if (s !== null && !sSeen.has(s)) { sSeen.add(s); sRows.push([nid].concat(['MOComOpeningBalance', 'MOComReceived', 'MOComDamaged', 'MOComDistributed', 'MOActualBalance', 'MOFoodReceivedMatch'].map(k => gdRep.stock[k] ? val(row, gdRep.stock[k]) : null))); }
    }
  });
  if (!M || M.idx[S.mainid] === undefined) throw new Error('Colonne identifiant « ' + S.mainid + ' » absente (ni _uuid, ni _id, ni meta/instanceID) : ce fichier ne correspond pas à cette activité.');
  const raw = Object.create(null); cols.forEach((k, j) => { raw[k] = normCol(mainRows.map(r => r[j])); });
  const nr = mainRows.length; const nul = () => new Array(nr).fill(null);
  // ---- export « en libellés » ? décidé sur les normes et les alertes (Oui / Non / n/a plutôt que 1 / 0)
  const capVar = new Map(); Object.keys(S.vars).forEach(nm => { const v = S.vars[nm]; if (v.t === 'm') v.o.forEach(o => capVar.set(o[0], { nm, opt: true, code: String(o[1]) })); else if (v.c) capVar.set(v.c, { nm, opt: false }); });
  const diag = { labelRow, labels: false, decoded: 0, kept: 0, itemsFound: 0, itemsDecodable: 0, risksFound: 0, risksDecodable: 0, admByName: 0, siteSrc: M.idx[S.tb.site] !== undefined ? 'code' : 'absent', siteCol: M.idx[S.tb.site] !== undefined ? M.header[M.idx[S.tb.site]] : null, siteAlias: siteAlias || null, siteNamed: 0, siteMatched: 0, siteDistinct: 0, gpsSrc: M.gps ? 'kobo' : (M.idx[S.tb.lat] !== undefined ? 'tableau' : 'absent'), noId };
  const probe = (S.items || []).map(it => S.vars[it.name] && S.vars[it.name].c).concat((S.risks || []).map(r => S.vars[r] && S.vars[r].c)).filter(c => c && raw[c]);
  let numN = 0, labN = 0; probe.forEach(c => raw[c].forEach(v => { if (v === null) return; if (LAB_CODE.test(v)) numN++; else { const k = LAB_NORM(v); if (LAB_YESNO.has(k) || LAB_NA.has(k)) labN++; } }));
  diag.labels = labN > numN && labN > 0;
  if (diag.labels) {
    const isItem = new Set((S.items || []).map(it => it.name).concat(S.risks || []));
    capVar.forEach((info, cap) => {
      const col = raw[cap]; if (!col) return; const v = S.vars[info.nm]; if (!info.opt && v.t === 'n') return;
      const dict = M.LD.toCode.get(info.nm) || null, optLabel = info.opt ? LAB_NORM((M.LD.toLabel.get(info.nm) || new Map()).get(info.code) || '') : '';
      raw[cap] = col.map(x => {
        if (x === null) return null; if (LAB_CODE.test(x)) return x; const k = LAB_NORM(x);
        if (LAB_NA.has(k)) { diag.decoded++; return null; }
        if (info.opt) { if (LAB_YESNO.has(k)) { diag.decoded++; return LAB_YESNO.get(k); } if (optLabel && k === optLabel) { diag.decoded++; return '1'; } diag.kept++; return x; }
        if (dict && dict.has(k)) { diag.decoded++; return dict.get(k); }
        if (LAB_YESNO.has(k)) { diag.decoded++; return LAB_YESNO.get(k); }
        if (dict || isItem.has(info.nm)) diag.kept++;   // seule une question à choix compte comme « non décodée » (texte libre et dates : rien à décoder)
        return x;
      });
    });
  }
  (S.items || []).forEach(it => { const c = S.vars[it.name] && S.vars[it.name].c; if (!c || !raw[c]) return; diag.itemsFound++; if (raw[c].some(x => x === '1' || x === '0' || x === '2' || x === '1.0' || x === '0.0')) diag.itemsDecodable++; });
  (S.risks || []).forEach(r => { const c = S.vars[r] && S.vars[r].c; if (!c || !raw[c]) return; diag.risksFound++; if (raw[c].some(x => x === '1' || x === '0')) diag.risksDecodable++; });
  // ---- région / district fournis en noms (export Kobo) → codes administratifs du spec
  if (P && P.spec) {
    const inv = o => { const m = new Map(); Object.keys(o || {}).forEach(code => { const k = LAB_NORM(o[code]); if (k && !m.has(k)) m.set(k, code); }); return m; };
    [[S.cfg.r1, inv(P.spec.adm1)], [S.cfg.r2, inv(P.spec.adm2)]].forEach(([nm, m]) => {
      const c = nm && S.vars[nm] && S.vars[nm].c; if (!c || !raw[c] || !m.size) return;
      raw[c] = raw[c].map(x => { if (x === null || LAB_CODE.test(x)) return x; const code = m.get(LAB_NORM(x)); if (code !== undefined) { diag.admByName++; return code; } return x; });
    });
  }
  // ---- site sans code (export Kobo : nom du site saisi) : rattaché au registre par son nom, sinon clé = nom normalisé
  const siteo = S.cfg.siteo && S.vars[S.cfg.siteo] && S.vars[S.cfg.siteo].c; const names = siteo && raw[siteo] ? raw[siteo] : null;
  if (names) {
    const reg = new Map(); if (P && P.planFull && act) { const PF = P.planFull, ci = PF.cols.indexOf('act'), cl = PF.cols.indexOf('localite'); PF.rows.forEach(r => { if (r[ci] !== act) return; const k = LAB_NORM(r[cl]); if (k && !reg.has(k)) reg.set(k, String(r[0])); }); }
    const codes = raw[S.tb.site] || nul(); const regCodes = new Set(reg.values());
    const codeOk = codes.filter(x => x !== null && (LAB_CODE.test(x) || regCodes.has(String(x)))).length, codeN = codes.filter(x => x !== null).length;
    if (!codeN || (diag.labels && codeOk < codeN / 2)) {
      const dist = new Set();
      raw[S.tb.site] = codes.map((x, i) => { if (x !== null && regCodes.has(String(x))) return x; const k = LAB_NORM(names[i]); if (!k) return x !== null && LAB_CODE.test(x) ? x : null; dist.add(k); diag.siteNamed++; const code = reg.get(k); if (code) { diag.siteMatched++; return code; } return 'N:' + k.slice(0, 80); });
      diag.siteSrc = 'nom'; diag.siteDistinct = dist.size;
    }
  }
  const missing = []; Object.entries(S.vars).forEach(([nm, v]) => { if (v.t !== 'm' && !(v.c in raw)) missing.push(nm); });
  Object.values(S.tb).forEach(c => { if (!(c in raw)) missing.push(c); });
  const df = {};
  Object.entries(S.vars).forEach(([nm, v]) => {
    if (v.t === 'm') {
      const oc = v.o.filter(o => o[0] in raw); if (!oc.length) { df[nm] = nul(); return; }
      df[nm] = Array.from({ length: nr }, (_, i) => { if (oc.every(o => raw[o[0]][i] === null)) return null; return oc.filter(o => { const x = raw[o[0]][i]; return x === 'True' || x === '1' || x === '1.0'; }).map(o => o[1]); });
    } else if (v.t === 'n') df[nm] = v.c in raw ? raw[v.c].map(toNum) : new Array(nr).fill(NaN);
    else df[nm] = v.c in raw ? raw[v.c].map(clean) : nul();
  });
  const TB = {}; Object.entries(S.tb).forEach(([k, c]) => { TB[k] = c in raw ? raw[c] : nul(); });
  df._id = raw[S.mainid].map(x => x === null ? 'nan' : x);
  return { df, TB, nr, nRaw, fRows, sRows, missing, ncols: header ? header.length : 0, map: M, diag };
}
// Vérification SANS écriture : même lecture que l'import (correspondance, décodage, site, région), rien n'est conservé
function previewExtract(P, text, act) {
  const S = P.spec.acts[act]; if (!S) throw new Error('activité inconnue');
  const gdRep = act === 'GD' ? P.spec.gdRepeat : null;
  const prev = EX_CTX; EX_CTX = P; let X;
  try { X = readExtract(text, S, gdRep); } finally { EX_CTX = prev; }
  const rep = mapReport(X.map, S);
  const ds = []; let noDate = 0; (X.df.SvyDate || []).forEach(v => { const d = parseDay(v); if (d) ds.push(d); else noDate++; }); ds.sort(cmp);
  const dcap = S.vars.SvyDate ? S.vars.SvyDate.c : null;
  return Object.assign(rep, { act, rows: X.nRaw, fiches: X.nr, noId: X.diag.noId, idOk: true, period: ds.length ? [ds[0], ds[ds.length - 1]] : null,
    outWin: ds.filter(d => d < WIN0 || d > WIN1).length, noDate, dateCol: dcap && X.map.idx[dcap] !== undefined ? X.map.header[X.map.idx[dcap]] : null, win: [WIN0, WIN1], ncols: X.ncols, diag: X.diag });
}

// ---- plan de suivi (liste DOTS) : colonnes reconnues par nom exact puis par graphie tolérante (casse, accents, espaces, mois anglais)
function planKey(h) { return asciiFold(hClean(h)).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function planColumns(h) {
  const ALIAS = { 'Code POI': ['codepoi', 'poicode'], 'Tag code': ['tagcode'], 'Actif': ['actif', 'active'], 'Region': ['region', 'adm1name'], 'District': ['district', 'adm2name'], 'Commune': ['commune', 'adm3name'],
    'Localité': ['localite', 'locality', 'sitename'], 'Field office': ['fieldoffice', 'bureau'], 'Latitude': ['latitude', 'lat'], 'Longitude': ['longitude', 'lon', 'long', 'lng'], 'Activity tag': ['activitytag'],
    'Activity tag (group)': ['activitytaggroup'], 'Fokontany': ['fokontany', 'adm4name'], 'Field office code': ['fieldofficecode'], 'Année': ['annee', 'year'], 'Tag_rev': ['tagrev'], 'Geometrie_planned': ['geometrieplanned'],
    'Motif du changement': ['motifduchangement', 'motif'], 'Derniere Visite': ['dernierevisite', 'lastvisit'], 'Nb apres derniere visite': ['nbapresdernierevisite'],
    'Jan': ['jan', 'janv', 'janvier', 'january'], 'Fév': ['fev', 'fevr', 'fevrier', 'feb', 'february'], 'Mar': ['mar', 'mars', 'march'], 'Avr': ['avr', 'avril', 'apr', 'april'], 'Mai': ['mai', 'may'],
    'Juin': ['juin', 'jun', 'june'], 'Juil': ['juil', 'juillet', 'jul', 'july'], 'Août': ['aout', 'aug', 'august'], 'Sep': ['sep', 'sept', 'septembre', 'september'], 'Oct': ['oct', 'octobre', 'october'],
    'Nov': ['nov', 'novembre', 'november'], 'Déc': ['dec', 'decembre', 'december'] };
  const ex = new Map(), ky = new Map();
  h.forEach((x, j) => { const c = hClean(x); if (c && !ex.has(c)) ex.set(c, j); const k = planKey(x); if (k && !ky.has(k)) ky.set(k, j); });
  const out = new Map(), how = new Map();
  Object.keys(ALIAS).forEach(nm => { if (ex.has(nm)) { out.set(nm, ex.get(nm)); how.set(nm, 'exact'); return; } for (const a of [planKey(nm)].concat(ALIAS[nm])) if (ky.has(a)) { out.set(nm, ky.get(a)); how.set(nm, 'nom'); return; } });
  return { out, how };
}
function importPlan(P0, text) {
  const P = JSON.parse(JSON.stringify(P0));
  const rows = []; let h = null;
  parseCSV(text, hd => { h = hd.map(hClean); return null; }, rw => rows.push(rw));
  if (!h) throw new Error('fichier vide');
  const PC = planColumns(h).out;
  if (!PC.has('Code POI') || !PC.has('Tag code')) throw new Error('Colonnes « Code POI » et « Tag code » introuvables : ce fichier n’est pas le plan de suivi.');
  const TAG = new Map(); Object.keys(P.spec.planTag).forEach(a => { TAG.set(String(P.spec.planTag[a]), a); });
  const MON = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
  const PF = P.planFull, pc = k => PF.cols.indexOf(k);
  const prev = new Map(PF.rows.map(x => [x[0] + '|' + x[1], x]));
  const retired = new Map(Object.entries(PF.retired || {}));
  const taken = new Set(PF.rows.map(x => x[pc('publicId')])); retired.forEach(v => taken.add(v[0]));
  const seen = new Set(); const out = [];
  const g = (rw, k) => { const j = PC.get(k); if (j === undefined) return null; const v = rw[j]; return v === undefined || NA_SET.has(v) ? null : String(v).trim(); };
  rows.forEach(rw => {
    let code = g(rw, 'Code POI'); if (code === null) return; code = code.replace(/\.0$/, '');
    const tag = g(rw, 'Tag code'); const a = TAG.get(tag); if (!a) return; const key = code + '|' + a; if (seen.has(key)) return; seen.add(key);
    const old = prev.get(key) || null, ret = retired.get(key) || null;
    const ac = g(rw, 'Actif'); const actif = ac === null ? (old ? old[pc('actif')] : 1) : (/^(non|no|0|false|faux|inactif|inactive)$/i.test(ac) ? 0 : 1);
    const fc = toNum(g(rw, 'Field office code')), an = toNum(g(rw, 'Année'));
    // une case de mois VIDE laisse le mois inchangé (même année) : un Oui / Non saisi dans l'application n'est pas effacé
    const sameYear = !!old && (isNaN(an) || old[pc('annee')] === an); const om = sameYear ? String(old[pc('months')] || '') : '';
    const months = MON.map((m, i) => { const v = g(rw, m); if (v === null) return om[i] === '1' || om[i] === '0' ? om[i] : '-'; return /^(oui|yes|1|true|vrai|x)$/i.test(v) ? '1' : '0'; }).join('');
    const motif = g(rw, 'Motif du changement');
    const o = { code, act: a, region: g(rw, 'Region'), district: g(rw, 'District'), commune: g(rw, 'Commune'), localite: g(rw, 'Localité'), fo: g(rw, 'Field office'), lat: r(toNum(g(rw, 'Latitude')), 6), lon: r(toNum(g(rw, 'Longitude')), 6),
      actif, months, tag: g(rw, 'Activity tag'), tagCode: tag, tagGroup: g(rw, 'Activity tag (group)'), fokontany: g(rw, 'Fokontany'), foCode: isNaN(fc) ? null : fc, annee: isNaN(an) ? null : an, tagRev: g(rw, 'Tag_rev'),
      geom: g(rw, 'Geometrie_planned'), motif: motif !== null ? motif : (old ? old[pc('motif')] : null), dvisit: g(rw, 'Derniere Visite'), nbapres: g(rw, 'Nb apres derniere visite'),
      publicId: old ? old[pc('publicId')] : ret ? ret[0] : newPublicId(taken), security: old ? old[pc('security')] : ret ? ret[1] : 0 };
    out.push(PF.cols.map(k => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null));
  });
  if (!out.length) throw new Error('Aucun site reconnu dans le fichier (Code POI + Tag code parmi ' + Array.from(TAG.keys()).join(', ') + ').');
  // sites retirés : identifiant public et sécurité conservés (un site qui revient garde son identifiant S-XXXX-XXXX)
  const R2 = {}; retired.forEach((v, k) => { R2[k] = v; }); PF.rows.forEach(x => { const k = x[0] + '|' + x[1]; if (!seen.has(k)) R2[k] = [x[pc('publicId')], x[pc('security')]]; }); seen.forEach(k => { delete R2[k]; });
  PF.srcCols = h.filter(x => x !== '');
  PF.retired = R2;
  PF.rows = out;
  return P;
}
function previewPlan(P0, text) {
  let h = null, nRows = 0;
  parseCSV(text, hd => { h = hd.map(hClean); return null; }, () => { nRows++; });
  if (!h) throw new Error('fichier vide');
  const C = planColumns(h);
  const missingKey = ['Code POI', 'Tag code'].filter(nm => !C.out.has(nm));
  const missing = ['Actif', 'Region', 'District', 'Commune', 'Localité', 'Field office', 'Latitude', 'Longitude', 'Année', 'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'].filter(nm => !C.out.has(nm));
  const used = new Set(C.out.values()); const ignored = h.filter((x, j) => x && !used.has(j));
  const alias = []; let exactN = 0; C.how.forEach((how, nm) => { if (how === 'exact') exactN++; else alias.push([nm, h[C.out.get(nm)], how]); });
  const rep = { rows: nRows, ncols: h.length, missingKey, missing, ignored, alias, exactN, aliasN: alias.length, sites: 0, added: 0, removed: 0, actifChanged: 0, monthsChanged: 0, years: [], err: null };
  if (missingKey.length) return rep;
  try {
    const P = importPlan(P0, text); const PF = P.planFull, pc = k => PF.cols.indexOf(k);
    const prev = new Map(P0.planFull.rows.map(x => [x[0] + '|' + x[1], x])); const now = new Set();
    PF.rows.forEach(x => { const k = x[0] + '|' + x[1]; now.add(k); const o = prev.get(k); if (!o) rep.added++; else { if (o[pc('actif')] !== x[pc('actif')]) rep.actifChanged++; if (o[pc('months')] !== x[pc('months')]) rep.monthsChanged++; } });
    prev.forEach((x, k) => { if (!now.has(k)) rep.removed++; });
    rep.sites = PF.rows.length; rep.years = Array.from(new Set(PF.rows.map(x => x[pc('annee')]).filter(x => x !== null))).sort();
  } catch (e) { rep.err = String((e && e.message) || e); }
  return rep;
}
function detectActDetail(P, headerLine) {
  const cells = []; parseCSV(String(headerLine || '') + '\n', hd => { hd.forEach(x => cells.push(hClean(x))); return null; }, () => {});
  const keys = new Set(); cells.forEach(c => { const segs = hKey(c).split('/').filter(Boolean); for (let i = 0; i < segs.length; i++) keys.add(segs.slice(i).join('/')); });
  const pk = new Set(cells.map(planKey));
  if (pk.has('codepoi') && pk.has('tagcode')) return { act: 'PLAN', scores: [] };
  // classeur RBM / plan de suivi : en-tête à plat (POIName + Type d'activité + Field_Office)
  if (pk.has('poiname') && pk.has('typedactivite') && (pk.has('fieldoffice') || pk.has('adm1'))) return { act: 'RBMPLAN', scores: [] };
  const scores = Object.keys(P.spec.acts).map(a => {
    const S = P.spec.acts[a];
    const sig = S.sig.filter(c => keys.has(hKey(c)) || keys.has(hKey(c.replace(/\s*\(Data\d*\)\s*$/i, '')))).length;
    const names = Object.keys(S.vars); const hit = names.filter(nm => keys.has(hKey(nm)) || (S.vars[nm].c && keys.has(hKey(S.vars[nm].c)))).length;
    const exactId = cells.indexOf(S.mainid) >= 0;
    return { act: a, sig, hit, share: names.length ? hit / names.length : 0, exactId, score: sig + (exactId ? 2 : 0) + (names.length ? hit / names.length * 10 : 0) };
  }).sort((x, y) => y.score - x.score);
  const b = scores[0];
  const ok = !!b && (b.sig + (b.exactId ? 2 : 0) >= 3 || b.share >= 0.15);
  return { act: ok ? b.act : null, scores };
}
function detectAct(P, headerLine) { return detectActDetail(P, headerLine).act; }

// ======================================================================= Classeur RBM / Plan de suivi (feuille « Plan_de_suivi »)
// Table documentée « Type d'activité » du classeur → code d'activité du dashboard. Rapprochement par mot-clé
// normalisé (casse, accents, espaces) pour tolérer GD-PREV, CBT/UCT, School meal, STUNT/MIARO, Resilience…
function rbmActOf(type) {
  const MAP = [[/(^| )(mam|pecmam)( |$)|nutrition treatment|traitement de la mam|moderate acute/, 'PECMAM'], [/school meal|cantine|alimentation scolaire|(^| )smp( |$)/, 'SMP'],
    [/stunt|miaro|malnutrition prevention|prevention du retard|prevention de la malnutrition/, 'MIARO'], [/(^| )gd|prevma|cbt|uct|unconditional|distribution generale|general distribution|resource transfer/, 'GD'],
    [/resilience|ffa|food assistance for assets|sams|cep|vsla|rrt|asset creation/, 'RES']];
  const k = asciiFold(String(type === null || type === undefined ? '' : type)).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (!k) return null;
  for (let i = 0; i < MAP.length; i++) if (MAP[i][0].test(k)) return MAP[i][1]; return null;
}
// mois (0 = Jan … 11 = Déc) d'un libellé de colonne (en-tête ou titre). « huil » = coquille de juillet du classeur source.
function rbmMonthOf(label) {
  const RE = [[/^jan/, 0], [/^f[eé]v|^feb/, 1], [/^mar/, 2], [/^av|^apr/, 3], [/^mai|^may/, 4], [/^jui?n|^jun/, 5], [/^juil|^jul|^huil/, 6], [/^ao[uû]|^aug/, 7], [/^sep/, 8], [/^oct/, 9], [/^nov/, 10], [/^d[eé]c/, 11]];
  const k = asciiFold(String(label === null || label === undefined ? '' : label)).toLowerCase().replace(/^(reel|prevu|active)[^a-z]*/, '').replace(/[^a-z0-9]+/g, '').trim(); if (!k) return -1;
  for (let i = 0; i < RE.length; i++) if (RE[i][0].test(k)) return RE[i][1]; return -1;
}
function rbmTruthy(v) { if (v === null || v === undefined) return false; const s = String(v).trim().toLowerCase(); return s === '1' || s === 'oui' || s === 'yes' || s === 'true' || s === 'vrai' || s === 'x'; }
// Analyse la feuille Plan_de_suivi (titre ligne 1, en-têtes ligne 2, données à partir de la ligne 5) OU un export à
// plat (en-têtes ligne 1, données ligne 2). Repère la ligne d'en-têtes par son contenu, les colonnes par leur nom.
function parsePlanBook(text) {
  const rows = []; parseCSV(text, h => { rows.push(h); return null; }, rw => rows.push(rw));
  if (!rows.length) return { ok: false, err: 'fichier vide' };
  const normH = x => hClean(x);
  const findHeader = () => { for (let i = 0; i < Math.min(rows.length, 12); i++) { const set = new Set(rows[i].map(x => normH(x))); if (set.has('POIName') && (set.has('Field_Office') || set.has('ADM1') || set.has("Type d'activité"))) return i; } return -1; };
  const hi = findHeader(); if (hi < 0) return { ok: false, err: 'en-têtes du plan de suivi introuvables (POIName, Field_Office, Type d’activité) : ce n’est pas le classeur de plan de suivi.' };
  const H = rows[hi].map(normH); const title = hi > 0 ? rows[hi - 1].map(normH) : null;
  const key = s => asciiFold(hClean(s)).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const colBy = (...names) => { const want = names.map(key); for (let j = 0; j < H.length; j++) if (want.indexOf(key(H[j])) >= 0) return j; return -1; };
  const col = { num: colBy('#'), fo: colBy('Field_Office', 'Field office', 'Bureau'), adm1: colBy('ADM1', 'Region'), p1: colBy('ADMI1_PCOD', 'ADM1_PCOD'), adm2: colBy('ADMIN2', 'District'), p2: colBy('ADM2_PCOD'), adm3: colBy('ADMIN3', 'Commune'), p3: colBy('ADM3_PCOD'), adm4: colBy('ADM4', 'Fokontany'), p4: colBy('ADM4_PCOD'), poi: colBy('POIName', 'Localité', 'Localite'), lat: colBy('Latitude', 'Lat'), lon: colBy('Longitude', 'Lon', 'Long'), cp: colBy('Nom du CP', 'Nom du CP (conformément au nom du fournisseur)', 'CP name', 'Partenaire'), type: colBy("Type d'activité", "Type d activite", 'Activity type', 'Activity category'), activeYear: colBy('Active or not active for the reporting year', 'Active or not active', 'Actif'), id: colBy('ID_MEMS', 'ID site', 'ID_site', 'Identifiant') };
  // colonne de code POI : « Code POI » si nommée, sinon la colonne (sans en-tête) juste après POIName
  let codeCol = colBy('Code POI', 'POI code', 'Code', 'POICode'); if (codeCol < 0 && col.poi >= 0) codeCol = col.poi + 1;
  // triplets mensuels : chaque cellule « Active » ouvre un triplet (Active | Prévu | Réel)
  const trip = []; H.forEach((h, j) => { if (/^active$/i.test(h)) trip.push({ a: j, p: j + 1, r: j + 2 }); });
  // mois de chaque triplet : libellé du titre (classeur d'origine), sinon 3ᵉ en-tête (Réel_xxx), sinon position
  trip.forEach((t, i) => { let mi = title ? rbmMonthOf(title[t.a]) : -1; if (mi < 0) mi = rbmMonthOf(H[t.r]); if (mi < 0) mi = rbmMonthOf(H[t.a]); t.mi = mi; });
  const labelled = trip.filter(t => t.mi >= 0).length;
  // grille 12 mois (Jan..Déc) : colonne « Active » du triplet de chaque mois ; la dernière occurrence gagne (année en cours).
  const monthCols = new Array(12).fill(-1), prevuCols = new Array(12).fill(-1), reelCols = new Array(12).fill(-1);
  if (labelled >= 12) trip.forEach(t => { if (t.mi >= 0) { monthCols[t.mi] = t.a; prevuCols[t.mi] = t.p; reelCols[t.mi] = t.r; } });
  else if (trip.length >= 16) for (let k = 0; k < 12; k++) { const t = trip[4 + k]; monthCols[k] = t.a; prevuCols[k] = t.p; reelCols[k] = t.r; }   // Sept(Y0)…Déc(Y1) : les 12 derniers = Jan…Déc
  else if (trip.length >= 12) for (let k = 0; k < 12; k++) { const t = trip[trip.length - 12 + k]; monthCols[k] = t.a; prevuCols[k] = t.p; reelCols[k] = t.r; }
  const dataRows = rows.slice(hi + 1).filter(r => r && ((codeCol >= 0 && hClean(r[codeCol]) !== '') || (col.poi >= 0 && hClean(r[col.poi]) !== '')));
  return { ok: true, H, col, codeCol, trip, monthCols, prevuCols, reelCols, dataRows, nTrip: trip.length, labelled, hasTitle: !!title };
}
// Parse « Overarching_parameters » → paramètres MMR/RBM par activité (intervalle mini, fréquence mini, niveau, cible/faisable).
function parseOverarching(text) {
  if (!text) return null; const rows = []; parseCSV(text, h => { rows.push(h); return null; }, rw => rows.push(rw));
  let hi = -1; for (let i = 0; i < Math.min(rows.length, 6); i++) { if (rows[i].some(x => /activity category/i.test(hClean(x)))) { hi = i; break; } }
  if (hi < 0) return null; const H = rows[hi].map(hClean);
  const find = re => { for (let j = 0; j < H.length; j++) if (re.test(H[j])) return j; return -1; };
  const cCat = find(/activity category/i), cNsite = find(/number of sites/i), cRisk = find(/risk level/i), cInt = find(/minimum required interval/i), cFreq = find(/minimum required frequency/i), cTarget = find(/targeted number of sites/i), cFeas = find(/feasible number of sites/i);
  if (cCat < 0) return null;
  const perAct = {};
  rows.slice(hi + 1).forEach(r => {
    const act = rbmActOf(r[cCat]); if (!act) return; const nsite = cNsite >= 0 ? toNum(r[cNsite]) : 0;
    const row = { nsite: isNaN(nsite) ? 0 : nsite, risk: cRisk >= 0 ? toNum(r[cRisk]) : NaN, interval: cInt >= 0 ? toNum(r[cInt]) : NaN, freq: cFreq >= 0 ? toNum(r[cFreq]) : NaN, target: cTarget >= 0 ? toNum(r[cTarget]) : NaN, feasible: cFeas >= 0 ? toNum(r[cFeas]) : NaN };
    if (!perAct[act] || row.nsite > perAct[act].nsite) perAct[act] = row;   // par activité : la ligne qui couvre le plus de sites
  });
  return Object.keys(perAct).length ? perAct : null;
}
// Parse « Risk_based_selection_ » → compte des sites classés et répartition de priorité (agrégats ; pas de rattachement par nom, pcode absent).
function rbmRiskStats(text) {
  if (!text) return null; const rows = []; parseCSV(text, h => { rows.push(h); return null; }, rw => rows.push(rw));
  let hi = -1; for (let i = 0; i < Math.min(rows.length, 8); i++) { if (rows[i].some(x => /site name/i.test(hClean(x)))) { hi = i; break; } }
  if (hi < 0) return null; const H = rows[hi].map(hClean);
  const cSite = H.findIndex(h => /site name/i.test(h)); let cPrio = -1; for (let j = H.length - 1; j >= 0; j--) if (/priority|final score/i.test(H[j])) { cPrio = j; break; }
  let n = 0; const prio = { 0: 0, 1: 0, 2: 0 };
  rows.slice(hi + 1).forEach(r => { if (cSite < 0 || hClean(r[cSite]) === '') return; n++; if (cPrio >= 0) { const p = toNum(r[cPrio]); if (p === 0 || p === 1 || p === 2) prio[p]++; } });
  return n ? { n, prio } : null;
}
// Construit les lignes planFull à partir du plan (fusion : met à jour les sites connus par act|code, ajoute les nouveaux, garde les autres).
function rbmPlanRows(P, B, annee) {
  const PF = P.planFull, pc = k => PF.cols.indexOf(k);
  const prevByKey = new Map(PF.rows.map(r => [r[pc('act')] + '|' + r[0], r]));
  const retired = new Map(Object.entries(PF.retired || {}));
  const taken = new Set(PF.rows.map(r => r[pc('publicId')])); retired.forEach(v => taken.add(v[0]));
  const g = (r, j) => { if (j === undefined || j < 0) return null; const v = r[j]; return v === undefined || NA_SET.has(v) ? null : String(v).trim(); };
  const book = {}; const seen = new Set(); const byAct = {}; let added = 0, updated = 0, withGps = 0, skippedType = 0, noCode = 0;
  const updates = new Map();   // key -> new row (replaces existing in place)
  const fresh = [];
  B.dataRows.forEach(r => {
    const act = rbmActOf(r[B.col.type]); if (!act) { skippedType++; return; }
    let code = g(r, B.codeCol); if (code === null) { code = g(r, B.col.p4); } if (code === null) { noCode++; return; } code = code.replace(/\.0$/, '');
    const key = act + '|' + code; if (seen.has(key)) return; seen.add(key);
    byAct[act] = (byAct[act] || 0) + 1;
    const old = prevByKey.get(key) || null, ret = retired.get(key) || null;
    // grille des mois : « 1 » actif, « 0 » / cellule vide inactif, « - » (notre export d'un site sans grille) = valeur conservée
    const oldM = old ? String(old[pc('months')] || '------------').padEnd(12, '-') : null;
    const m12 = B.monthCols.map((j, k) => { if (j < 0 || r[j] === undefined) return oldM ? oldM[k] : '-'; const v = String(r[j]).trim(); if (rbmTruthy(v)) return '1'; if (v === '-') return oldM ? oldM[k] : '-'; return '0'; }).join('');
    const ayRaw = g(r, B.col.activeYear); const actif = ayRaw && /not active|inactif|inactive|^non$|^no$|^0$/i.test(ayRaw) ? 0 : (m12.indexOf('1') >= 0 ? 1 : (old ? old[pc('actif')] : 1));
    const lat = r2n(g(r, B.col.lat)), lon = r2n(g(r, B.col.lon)); if (lat !== null && lon !== null) withGps++;
    const planId = g(r, B.col.id);   // identifiant MEMS porté par notre propre export (S-XXXX-XXXX) : repris tel quel pour l'aller-retour
    // sites CONNUS : on ne détruit pas la géographie canonique du registre ni l'identifiant ; on met à jour la grille, le GPS, l'actif, le partenaire, l'année.
    const o = old ? { code, act, region: old[pc('region')], district: old[pc('district')], commune: old[pc('commune')], localite: old[pc('localite')], fo: g(r, B.col.fo) || old[pc('fo')],
        lat: lat !== null ? lat : old[pc('lat')], lon: lon !== null ? lon : old[pc('lon')], actif, months: m12, tag: g(r, B.col.type) || old[pc('tag')], tagCode: old[pc('tagCode')] || P.spec.planTag[act] || act, tagGroup: g(r, B.col.type) || old[pc('tagGroup')],
        fokontany: old[pc('fokontany')], foCode: old[pc('foCode')], annee, tagRev: old[pc('tagRev')], geom: old[pc('geom')], motif: old[pc('motif')], dvisit: old[pc('dvisit')], nbapres: old[pc('nbapres')], publicId: old[pc('publicId')], security: old[pc('security')] }
      : { code, act, region: canonRegion(g(r, B.col.adm1)) || g(r, B.col.adm1), district: g(r, B.col.adm2), commune: g(r, B.col.adm3), localite: g(r, B.col.poi), fo: g(r, B.col.fo),
        lat, lon, actif, months: m12, tag: g(r, B.col.type), tagCode: P.spec.planTag[act] || act, tagGroup: g(r, B.col.type), fokontany: g(r, B.col.adm4), foCode: null,
        annee, tagRev: null, geom: null, motif: null, dvisit: null, nbapres: null,
        publicId: (planId && /^S-[0-9A-Z]{4}-[0-9A-Z]{4}$/i.test(planId) && !taken.has(planId.toUpperCase())) ? planId.toUpperCase() : (ret ? ret[0] : newPublicId(taken)), security: ret ? ret[1] : 0 };
    const rowArr = PF.cols.map(k => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null);
    if (old) { updates.set(key, rowArr); updated++; } else { fresh.push(rowArr); added++; taken.add(o.publicId); }
    book[key] = { p1: g(r, B.col.p1), p2: g(r, B.col.p2), p3: g(r, B.col.p3), p4: g(r, B.col.p4), cp: g(r, B.col.cp), fokontany: g(r, B.col.adm4), region: g(r, B.col.adm1), district: g(r, B.col.adm2), commune: g(r, B.col.adm3) };
  });
  // fusion : on garde toutes les lignes existantes (mises à jour sur place), on ajoute les nouvelles
  const merged = PF.rows.map(row => { const k = row[pc('act')] + '|' + row[0]; return updates.has(k) ? updates.get(k) : row; }).concat(fresh);
  return { merged, book, byAct, added, updated, withGps, skippedType, noCode, nPlan: seen.size };
}
function r2n(v) { const n = toNum(v); return isNaN(n) || !isFinite(n) ? null : r(n, 6); }
function importRbmPlan(P0, planText, extra, meta) {
  const P = JSON.parse(JSON.stringify(P0));
  const B = parsePlanBook(planText); if (!B.ok) throw new Error(B.err);
  if (!B.dataRows.length) throw new Error('aucun site reconnu dans le plan de suivi.');
  const PF = P.planFull, pc = k => PF.cols.indexOf(k);
  const yrs = {}; PF.rows.forEach(r => { const y = r[pc('annee')]; if (y !== null && y !== undefined && y !== '') yrs[y] = (yrs[y] || 0) + 1; });
  const annee = +(Object.keys(yrs).sort((a, b) => yrs[b] - yrs[a])[0]) || new Date().getUTCFullYear();
  const R = rbmPlanRows(P, B, annee);
  if (!R.nPlan) throw new Error('aucun site du plan n’a pu être relié à une activité connue (colonne « Type d’activité »).');
  PF.rows = R.merged; PF.rbmBook = Object.assign({}, PF.rbmBook || {}, R.book); PF.rbmYear = annee;
  PF.srcCols = ['#', 'Field_Office', 'ADM1', 'ADMI1_PCOD', 'ADMIN2', 'ADM2_PCOD', 'ADMIN3', 'ADM3_PCOD', 'ADM4', 'ADM4_PCOD', 'POIName', 'Code POI', 'Latitude', 'Longitude', 'Nom du CP', "Type d'activité"];
  // Overarching_parameters → configuration MMR par activité (fréquence mini = plancher ; intervalle mini = plancher ; l'intervalle RBM n'est jamais raccourci)
  const over = parseOverarching(extra && extra.params); const applied = [];
  if (over) { P.rbm = P.rbm || {}; P.rbm.mmr = P.rbm.mmr || {}; Object.keys(over).forEach(a => { const x = over[a]; const m = P.rbm.mmr[a] = P.rbm.mmr[a] || {}; if (isFinite(x.freq) && x.freq >= 1) m.minYear = Math.round(x.freq); if (isFinite(x.interval) && x.interval >= 1) m.floor = Math.round(x.interval); applied.push(a); }); P.rbm.mmrSrc = Object.assign({}, P.rbm.mmrSrc || {}, over); }
  const risk = rbmRiskStats(extra && extra.risk);
  P.updated = P.updated || {}; P.updated.PLAN = { date: meta.date, by: meta.by || '—', file: meta.file || '', rows: R.nPlan };
  P.planVersion = (P.planVersion || 0) + 1; P.planEdited = { date: meta.date, by: meta.by || '—' };
  return { P, report: { nPlan: R.nPlan, added: R.added, updated: R.updated, withGps: R.withGps, byAct: R.byAct, skippedType: R.skippedType, noCode: R.noCode, annee, overApplied: applied, risk, nTrip: B.nTrip, labelled: B.labelled, totalSites: PF.rows.length } };
}
function previewRbmPlan(P0, planText, extra) {
  const B = parsePlanBook(planText);
  if (!B.ok) return { rbm: true, err: B.err };
  const annee = (() => { const PF = P0.planFull, pc = k => PF.cols.indexOf(k); const yrs = {}; PF.rows.forEach(r => { const y = r[pc('annee')]; if (y !== null && y !== undefined && y !== '') yrs[y] = (yrs[y] || 0) + 1; }); return +(Object.keys(yrs).sort((a, b) => yrs[b] - yrs[a])[0]) || new Date().getUTCFullYear(); })();
  const R = rbmPlanRows(JSON.parse(JSON.stringify(P0)), B, annee);
  const over = parseOverarching(extra && extra.params); const risk = rbmRiskStats(extra && extra.risk);
  const monthsRead = B.monthCols.filter(j => j >= 0).length;
  return { rbm: true, err: null, nPlan: R.nPlan, added: R.added, updated: R.updated, withGps: R.withGps, byAct: R.byAct, skippedType: R.skippedType, noCode: R.noCode, annee, monthsRead, nTrip: B.nTrip, labelled: B.labelled,
    codeNamed: B.codeCol >= 0 && B.codeCol < B.H.length && hClean(B.H[B.codeCol]) !== '', over: over ? Object.keys(over).map(a => ({ act: a, interval: over[a].interval, freq: over[a].freq, risk: over[a].risk, target: over[a].target, feasible: over[a].feasible })) : null, risk, totalSites: P0.planFull.rows.length, rows: B.dataRows.length };
}

// ======================================================================= Référentiel des zones administratives (.dbf d'un shapefile)
// Parseur dBase III/IV PUR (aucune dépendance, comme le lecteur XLSX) : en-tête, descripteurs de champ, enregistrements.
// Il alimente le même référentiel que le moteur pour résoudre région/district par P-code (spec.adm1 / adm2, voir districtOf).
function dbfLooksLike(u8) {
  if (!u8 || u8.length < 33) return false;
  const known = [0x02, 0x03, 0x04, 0x05, 0x30, 0x31, 0x32, 0x43, 0x63, 0x83, 0x8b, 0x8e, 0xf5, 0xfb].indexOf(u8[0]) >= 0;
  if (!known) return false;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const hdr = dv.getUint16(8, true), rec = dv.getUint16(10, true);
  if (hdr < 33 || hdr > (1 << 20)) return false;
  if (rec < 1 || rec > (1 << 16)) return false;
  if (u8[2] > 12 || u8[3] > 31) return false;   // mois / jour de la date de l'en-tête
  return true;
}
function parseDbf(buf, cpgText) {
  // En-tête : 0 version · 4-7 nb d'enregistrements · 8-9 taille d'en-tête · 10-11 taille d'un enregistrement · 29 encodage.
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length > DBF_MAX) throw new Error('fichier .dbf trop volumineux (' + Math.round(u8.length / 1e6) + ' Mo, plafond 50 Mo).');
  if (u8.length < 33) throw new Error('fichier .dbf tronqué : en-tête incomplet.');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = u8[0], nRecHdr = dv.getUint32(4, true), headerSize = dv.getUint16(8, true), recSize = dv.getUint16(10, true), langId = u8[29];
  if (headerSize < 33 || headerSize > u8.length) throw new Error('en-tête .dbf incohérent (taille déclarée ' + headerSize + ', fichier ' + u8.length + ' octets).');
  // Descripteurs de champ : 32 octets chacun à partir de l'octet 32, jusqu'au terminateur 0x0D.
  const fields = []; let p = 32, off = 1;
  while (p + 1 <= u8.length && u8[p] !== 0x0D) {
    if (p + 32 > headerSize) throw new Error('descripteurs de champ corrompus (terminateur 0x0D absent avant les données).');
    let nm = ''; for (let i = 0; i < 11; i++) { const c = u8[p + i]; if (c === 0) break; nm += String.fromCharCode(c); }
    nm = nm.trim();
    const type = String.fromCharCode(u8[p + 11] || 0x43), len = u8[p + 16], dec = u8[p + 17];
    fields.push({ name: nm, type: type, len: len, dec: dec, off: off });
    off += len; p += 32;
    if (fields.length > 4096) throw new Error('fichier .dbf refusé : plus de 4096 champs.');
  }
  if (u8[p] !== 0x0D) throw new Error('terminateur d’en-tête (0x0D) introuvable : ce n’est pas un fichier dBase valide.');
  if (!fields.length) throw new Error('aucun champ décrit dans l’en-tête .dbf.');
  const sumLen = off;   // 1 (indicateur de suppression) + somme des longueurs des champs
  if (recSize && recSize !== sumLen) throw new Error('taille d’enregistrement incohérente (déclarée ' + recSize + ', calculée ' + sumLen + ' d’après les champs) : fichier .dbf corrompu.');
  const stride = recSize || sumLen, dataStart = headerSize;
  const avail = Math.max(0, Math.floor((u8.length - dataStart) / stride));
  const nRec = nRecHdr > 0 && nRecHdr <= avail ? nRecHdr : avail;
  if (nRec > 5e6) throw new Error('fichier .dbf refusé : ' + nRec + ' enregistrements (plafond 5 000 000).');
  // Encodage : .cpg s'il est fourni, sinon UTF-8 puis repli Windows-1252 si des caractères de remplacement apparaissent.
  let enc = 'utf-8';
  if (cpgText) { const c = String(cpgText).toLowerCase(); if (/utf\-?8|65001/.test(c)) enc = 'utf-8'; else if (/1252|8859\-?1|8859_1|latin\-?1|latin1|ansi|windows/.test(c)) enc = 'windows-1252'; }
  else { const probe = u8.subarray(dataStart, Math.min(u8.length, dataStart + Math.min(stride * nRec, 262144))); let bad = 0; try { bad = (new TextDecoder('utf-8').decode(probe).match(/�/g) || []).length; } catch (e) { bad = 1; } if (bad > 0) enc = 'windows-1252'; }
  let DEC; try { DEC = new TextDecoder(enc); } catch (e) { DEC = new TextDecoder('utf-8'); enc = 'utf-8'; }
  const cell = (start, len) => DEC.decode(u8.subarray(start, start + len)).replace(/\u0000/g, '').trim();
  const records = []; let deleted = 0;
  for (let k = 0; k < nRec; k++) {
    const base = dataStart + k * stride; if (base + stride > u8.length) break;
    const flag = u8[base]; if (flag === 0x2A) { deleted++; continue; }   // 0x2A = enregistrement supprimé
    if (flag === 0x1A) break;   // marqueur de fin de fichier
    records.push(fields.map(f => cell(base + f.off, f.len)));
  }
  return { fields: fields, records: records, encoding: enc, version: version, langId: langId, nRecords: records.length, deleted: deleted, nFields: fields.length };
}
// Reconnaissance d'une colonne par son NOM (jamais par le contenu) : niveau 1 Région … 4 Fokontany, nom ou P-code, lat / lon.
function admKey(h) { return asciiFold(String(h === null || h === undefined ? '' : h)).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function admClassify(header) {
  const k = admKey(header); if (!k) return null;
  if (/^(lat|latitude|ycoord|ycoordinate|pointy|y)$/.test(k)) return { kind: 'lat' };
  if (/^(lon|lng|long|longitude|xcoord|xcoordinate|pointx|x)$/.test(k)) return { kind: 'lon' };
  let m = k.match(/^adm[i]?([1-5])(?:pcode|pcod|pc|code)$/); if (m) return { level: +m[1], kind: 'pcode' };
  m = k.match(/^p(?:code)?([1-5])$/); if (m) return { level: +m[1], kind: 'pcode' };
  m = k.match(/^([1-5])pcode$/); if (m) return { level: +m[1], kind: 'pcode' };
  const LBL = { region: 1, reg: 1, district: 2, dist: 2, commune: 3, comm: 3, fokontany: 4, fokotany: 4, village: 5 };
  for (const w in LBL) { if (k === w + 'pcode' || k === w + 'pcod' || k === w + 'pc' || k === w + 'code') return { level: LBL[w], kind: 'pcode' }; }
  m = k.match(/^adm[i]?n?([1-5])(?:name|nm|fr|en|lib|libelle|label)?$/); if (m) return { level: +m[1], kind: 'name' };
  for (const w in LBL) { if (k === w || k === w + 'name' || k === w + 'nm') return { level: LBL[w], kind: 'name' }; }
  return null;
}
// Normalise chaque enregistrement en { names:[adm1..admN], pcodes:[adm1..admN], lat?, lng? } d'après les colonnes reconnues.
function admFromDbf(fields, records) {
  const lvl = Object.create(null); let latCol = -1, lonCol = -1; const recognized = [];
  fields.forEach((f, j) => {
    const c = admClassify(f.name); if (!c) return;
    if (c.kind === 'lat') { if (latCol < 0) { latCol = j; recognized.push([f.name, 'Latitude']); } return; }
    if (c.kind === 'lon') { if (lonCol < 0) { lonCol = j; recognized.push([f.name, 'Longitude']); } return; }
    const n = c.level; if (!lvl[n]) lvl[n] = { name: -1, pcode: -1 };
    if (c.kind === 'name' && lvl[n].name < 0) { lvl[n].name = j; recognized.push([f.name, ADM_LABEL[n] + ' (nom)']); }
    if (c.kind === 'pcode' && lvl[n].pcode < 0) { lvl[n].pcode = j; recognized.push([f.name, ADM_LABEL[n] + ' (P-code)']); }
  });
  const levels = Object.keys(lvl).map(Number).sort((a, b) => a - b);
  const maxLevel = levels.length ? levels[levels.length - 1] : 0;
  const out = [];
  records.forEach(r => {
    const names = [], pcodes = [];
    for (let n = 1; n <= maxLevel; n++) { const L = lvl[n] || { name: -1, pcode: -1 }; names.push(L.name >= 0 ? (r[L.name] || '') : ''); pcodes.push(L.pcode >= 0 ? (r[L.pcode] || '') : ''); }
    const lat = latCol >= 0 ? toNum(r[latCol]) : NaN, lng = lonCol >= 0 ? toNum(r[lonCol]) : NaN;
    out.push({ names: names, pcodes: pcodes, lat: isFinite(lat) ? lat : null, lng: isFinite(lng) ? lng : null });
  });
  return { records: out, levels: levels, maxLevel: maxLevel, lvl: lvl, latCol: latCol, lonCol: lonCol, recognized: recognized };
}
// Vérification SANS écriture : nb de zones par niveau, colonnes reconnues, exemples, P-codes manquants, nouveautés vs référentiel.
function previewAdmin(P, parsed) {
  const A = admFromDbf(parsed.fields, parsed.records);
  if (!A.maxLevel) throw new Error('aucune colonne de zone administrative reconnue (ADM1…ADM4, Région / District / Commune / Fokontany, et leurs P-codes). Vérifiez les en-têtes de la table.');
  const pairs = {}; for (let n = 1; n <= A.maxLevel; n++) pairs[n] = new Map();
  A.records.forEach(rec => { for (let n = 1; n <= A.maxLevel; n++) { const nm = String(rec.names[n - 1] || '').trim(), pc = String(rec.pcodes[n - 1] || '').trim(); if (pc && ADM_SAFE(pc) && nm && !pairs[n].has(pc)) pairs[n].set(pc, nm); } });
  const curOf = n => (P.spec && P.spec['adm' + n]) || {};
  const perLevel = [];
  for (let n = 1; n <= A.maxLevel; n++) {
    const L = A.lvl[n] || { name: -1, pcode: -1 };
    const names = new Set(); let withName = 0, missPc = 0, withPc = 0;
    A.records.forEach(rec => { const nm = String(rec.names[n - 1] || '').trim(), pc = String(rec.pcodes[n - 1] || '').trim(); if (nm) { names.add(nm); withName++; if (!pc) missPc++; } if (pc) withPc++; });
    const cur = curOf(n); let added = 0, changed = 0, same = 0;
    pairs[n].forEach((nm, pc) => { const val = n === 1 ? (canonRegion(nm) || nm) : nm; const had = Object.prototype.hasOwnProperty.call(cur, pc); if (!had) added++; else if (cur[pc] !== val) changed++; else same++; });
    perLevel.push({ level: n, label: ADM_LABEL[n], nameCol: L.name >= 0 ? parsed.fields[L.name].name : null, pcodeCol: L.pcode >= 0 ? parsed.fields[L.pcode].name : null, distinctNames: names.size, distinctPcodes: pairs[n].size, withName: withName, withPcode: withPc, missingPcode: missPc, added: added, changed: changed, same: same });
  }
  const examples = A.records.slice(0, 6).map(rec => { const parts = []; for (let n = 1; n <= A.maxLevel; n++) { const nm = String(rec.names[n - 1] || '').trim(); if (nm) parts.push(nm); } return { path: parts.join(' › '), pcode: String(rec.pcodes[A.maxLevel - 1] || '').trim(), lat: rec.lat, lng: rec.lng }; });
  let withGps = 0; A.records.forEach(rec => { if (rec.lat !== null && rec.lng !== null) withGps++; });
  return { maxLevel: A.maxLevel, perLevel: perLevel, examples: examples, recognized: A.recognized, gps: { lat: A.latCol >= 0 ? parsed.fields[A.latCol].name : null, lon: A.lonCol >= 0 ? parsed.fields[A.lonCol].name : null, withGps: withGps }, nRecords: A.records.length, encoding: parsed.encoding, deleted: parsed.deleted || 0, nFields: parsed.nFields, totalAdded: perLevel.reduce((a, x) => a + x.added, 0), totalChanged: perLevel.reduce((a, x) => a + x.changed, 0) };
}
// Application : enrichit spec.adm1…adm4 (P-code → nom, source unique utilisée par le moteur), ré-aligne par P-code les sites
// qui portent un P-code (rbmBook) sans jamais supprimer un site, puis journalise. refreshPlanTables recalcule le reste.
function importAdmin(P0, parsed, meta) {
  const P = JSON.parse(JSON.stringify(P0));
  const A = admFromDbf(parsed.fields, parsed.records);
  if (!A.maxLevel) throw new Error('aucune colonne de zone administrative reconnue dans le fichier .dbf.');
  P.spec = P.spec || {};
  const target = n => { const key = 'adm' + n; if (!P.spec[key] || typeof P.spec[key] !== 'object') P.spec[key] = {}; return P.spec[key]; };
  const counts = {}, pairs = {}; for (let n = 1; n <= A.maxLevel; n++) { pairs[n] = new Map(); counts[n] = { added: 0, changed: 0, same: 0, names: new Set(), pcodes: new Set() }; }
  A.records.forEach(rec => { for (let n = 1; n <= A.maxLevel; n++) { const nm = String(rec.names[n - 1] || '').trim(), pc = String(rec.pcodes[n - 1] || '').trim(); if (!pc || !ADM_SAFE(pc)) continue; counts[n].pcodes.add(pc); if (nm) counts[n].names.add(nm); if (nm && !pairs[n].has(pc)) pairs[n].set(pc, nm); } });
  for (let n = 1; n <= A.maxLevel; n++) { const map = target(n), c = counts[n]; pairs[n].forEach((nm, pc) => { const val = n === 1 ? (canonRegion(nm) || nm) : nm; const had = Object.prototype.hasOwnProperty.call(map, pc); if (!had) c.added++; else if (map[pc] !== val) c.changed++; else c.same++; map[pc] = val; }); }
  // ré-alignement des sites par P-code (uniquement ceux dont le P-code est connu via rbmBook) : complète / renomme, n'efface jamais.
  const PF = P.planFull, pc = k => PF.cols.indexOf(k), book = PF.rbmBook || {};
  const ADM1 = P.spec.adm1 || {}, ADM2 = P.spec.adm2 || {}, ADM3 = P.spec.adm3 || {}, ADM4 = P.spec.adm4 || {};
  const byPrefix = (map, code) => { if (typeof code !== 'string' || !code) return null; for (let L = code.length; L >= 2; L--) { const k = code.slice(0, L); if (Object.prototype.hasOwnProperty.call(map, k)) return map[k]; } return null; };
  let siteReRes = 0;
  PF.rows.forEach(r => {
    const b = book[r[pc('act')] + '|' + r[0]]; if (!b) return;
    const reg = (b.p1 && ADM1[b.p1]) || (b.p3 ? byPrefix(ADM1, b.p3) : null);
    const dis = (b.p2 && ADM2[b.p2]) || (b.p3 ? byPrefix(ADM2, b.p3) : null);
    const com = b.p3 && ADM3[b.p3] ? ADM3[b.p3] : null, fok = b.p4 && ADM4[b.p4] ? ADM4[b.p4] : null;
    let touched = false;
    if (reg) { const v = canonRegion(reg) || reg; if (r[pc('region')] !== v) { r[pc('region')] = v; touched = true; } }
    if (dis && r[pc('district')] !== dis) { r[pc('district')] = dis; touched = true; }
    if (com && r[pc('commune')] !== com) { r[pc('commune')] = com; touched = true; }
    if (fok && r[pc('fokontany')] !== fok) { r[pc('fokontany')] = fok; touched = true; }
    if (touched) siteReRes++;
  });
  P.adminRef = { date: meta.date, by: meta.by || '—', file: meta.file || '', maxLevel: A.maxLevel, records: A.records.length, counts: {} };
  for (let n = 1; n <= A.maxLevel; n++) P.adminRef.counts[n] = { names: counts[n].names.size, pcodes: counts[n].pcodes.size, added: counts[n].added, changed: counts[n].changed };
  P.updated = P.updated || {}; P.updated.ADMIN = { date: meta.date, by: meta.by || '—', file: meta.file || '', rows: A.records.length };
  return { P: P, report: { maxLevel: A.maxLevel, nRecords: A.records.length, counts: P.adminRef.counts, siteReResolved: siteReRes } };
}
// Résout un P-code en région / district / commune / fokontany par préfixe, avec le référentiel courant (même logique que districtOf).
function admResolve(P, code) {
  const sp = P.spec || {};
  const by = map => { if (!map || typeof code !== 'string' || !code) return null; for (let L = code.length; L >= 2; L--) { const k = code.slice(0, L); if (Object.prototype.hasOwnProperty.call(map, k)) return map[k]; } return null; };
  return { region: by(sp.adm1), district: by(sp.adm2), commune: by(sp.adm3), fokontany: by(sp.adm4) };
}

const src = (...fns) => fns.map(f => '    ' + f.toString()).join('\n');

// ======================================================================= ÉCRAN (zone 1814-2222 du socle) — textes injectés
const RBM_BLOCK = `  // ---------------- tab: planning — moteur UNIQUE (paramètres, score de risque, plan) ; écran, détails et exports dans le module « planification »
  const RBM_DEF = { w: { score: 3, alert: 3, never: 2, recency: 2, partner: 1 }, thHigh: 60, thMed: 35, freq: { high: 1, med: 2, low: 3, never: 2 }, horizon: 3, start: null, cap: {}, capAct: {}, target: 85, recencyDays: 180, mmr: {}, neverHigh: false, vpd: 0 };
  const RBM_W = [['score', 'Score de conformité faible', 'Écart entre la moyenne des 2 dernières visites et le score cible.'], ['alert', 'Alertes critiques', 'Alertes critiques relevées à la dernière visite (2 alertes ou plus = maximum).'],
    ['never', 'Jamais visité', 'Site actif sans aucune visite exploitable.'], ['recency', 'Délai depuis la dernière visite', 'Jours écoulés depuis la dernière visite, rapportés au délai maximal.'],
    ['partner', 'Note du partenaire de mise en œuvre', 'Note du partenaire de la dernière visite : D = maximum, C = 0,6, B = 0,2, A = 0 ; sans objet ou inconnu = facteur retiré.']];
  function rbmCfg() { return plCfg(); }
  function defaultCap() { return plCapacity().auto; }
  function rbmCompute(cfg) { return plCompute(cfg ? plCfgFrom([cfg]) : plCfg()); }
  const every = n => +n === 1 ? 'chaque mois' : 'tous les ' + n + ' mois';
  function renderRbm(main) { plRenderPlanning(main); }`;

module.exports = [
  // ---------------------------------------------------------------- moteur
  { label: 'moteur : lecteur CSV (séparateur compté hors guillemets, garde-fous ligne / colonnes)',
    start: '    function parseCSV(text, onHeader, onRow) {', end: '      return header;\n    }', replace: src(parseCSV) },
  { label: 'moteur : correspondance des colonnes (Tableau, MoDA, ONA, Kobo) + lecture d’une extraction + vérification sans écriture',
    start: '    function readExtract(text, S, gdRep) {', end: '      return { df, TB, nr, nRaw, fRows, sRows, missing, ncols: header ? header.length : 0 };\n    }',
    replace: "    let EX_CTX = null;   // P courant : registre des sites et codes administratifs (posé par previewExtract et par l’enveloppe d’importActivity)\n" +
      "    const LAB_NORM = s => asciiFold(String(s === null || s === undefined ? '' : s)).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();\n" +
      "    const LAB_YESNO = new Map([['oui', '1'], ['yes', '1'], ['vrai', '1'], ['true', '1'], ['non', '0'], ['no', '0'], ['faux', '0'], ['false', '0'], ['partiellement', '2'], ['partiel', '2'], ['partially', '2'], ['en partie', '2']]);\n" +
      "    const LAB_NA = new Set(['', 'n a', 'na', 'nan', 'sans objet', 'non applicable', 'not applicable', 'none', 'null']);\n" +
      "    const LAB_CODE = /^-?\\d+(\\.\\d+)?$|^(true|false)$/i;\n" +
      "    const SITE_ALIASES = { GD: ['dpname', 'poiname'], PECMAM: ['dpname', 'poiname'], MIARO: ['poiname', 'dpname'], SMP: ['adm4codesmp', 'adm4codesmpid', 'dpname', 'poiname'], RES: ['dpname', 'poiname'] };\n" +
      src(siteSegKey, resolveSiteAlias, needOf, hClean, hKey, labelDicts, headerMap, makeGetters, isLabelRow, mapReport, readExtract, previewExtract) },
  { label: 'moteur : import du plan de suivi (colonnes tolérantes, case vide = mois inchangé, identifiants conservés) + aperçu',
    start: '    function importPlan(P0, text) {', end: '      P.planFull.rows = out;\n      return P;\n    }', replace: src(planKey, planColumns, importPlan, previewPlan) },
  { label: 'moteur : détection de l’activité (aussi sur les en-têtes Kobo « groupe/variable ») + import du classeur RBM / plan de suivi + référentiel .dbf des zones',
    start: '    function detectAct(P, headerLine) {', end: '      return bs >= 3 ? best : null;\n    }',
    replace: "    const DBF_MAX = 50e6;\n" +
      "    const ADM_LABEL = { 1: 'Région', 2: 'District', 3: 'Commune', 4: 'Fokontany', 5: 'Village' };\n" +
      "    const ADM_SAFE = k => k !== '__proto__' && k !== 'constructor' && k !== 'prototype';\n" +
      src(detectActDetail, detectAct, rbmActOf, rbmMonthOf, rbmTruthy, parsePlanBook, parseOverarching, rbmRiskStats, r2n, rbmPlanRows, importRbmPlan, previewRbmPlan,
        dbfLooksLike, parseDbf, admKey, admClassify, admFromDbf, previewAdmin, importAdmin, admResolve) },
  { label: 'moteur : exports du lot planification',
    find: '    /*ENGINE-EXPORTS*/',
    replace: "    API.previewExtract = previewExtract; API.previewPlan = previewPlan; API.detectActDetail = detectActDetail; API.headerMap = headerMap; API.parseDay = parseDay;\n" +
      "    API.previewRbmPlan = previewRbmPlan; API.importRbmPlan = importRbmPlan; API.parsePlanBook = parsePlanBook; API.rbmActOf = rbmActOf;\n" +
      "    API.parseDbf = parseDbf; API.dbfLooksLike = dbfLooksLike; API.previewAdmin = previewAdmin; API.importAdmin = importAdmin; API.admResolve = admResolve; API.admFromDbf = admFromDbf;\n" +
      "    { const importActivityRaw = API.importActivity; API.importActivity = (P0, act, text, meta) => { const prev = EX_CTX; EX_CTX = P0; try { return importActivityRaw(P0, act, text, meta); } finally { EX_CTX = prev; } }; }   // readExtract lit le registre et les codes administratifs de P0\n" +
      "    /*ENGINE-EXPORTS*/" },

  // ---------------------------------------------------------------- écran
  { label: 'sous-titre : « données de visites » et « plan de suivi » distingués',
    start: '  function lastUpdateLine() {', end: "    return ds.length ? 'dernière mise à jour des données : ' + ds[ds.length - 1] : '';\n  }",
    replace: '  function lastUpdateLine() { return plUpdateLine(); }' },
  { label: 'Données : tableau des mises à jour (activités + plan de suivi)',
    start: '    const rows = D.acts.map(a => {\n      const u = U[a.code] || {}; const dq', end: "{ k: 'per', t: 'Période couverte' }], rows)], 'wide'));",
    replace: '    plUpdatesCard(main);' },
  { label: 'Données : journal des imports conservé dans le fichier',
    start: "    if (SESSION.log.length) main.appendChild(card('Journal des imports de cette session'", end: "SESSION.log.slice().reverse())], 'wide'));",
    replace: '    plLogCard(main);' },
  { label: 'Données : import unique avec vérification et confirmation (CSV, XLSX, MoDA / ONA / Kobo)',
    start: '    // import card', end: "aucune donnée n’est envoyée sur Internet.' })])], 'wide'));",
    replace: '    plImportCard(main);' },
  { label: 'registre des sites : district / commune fusionnés, sécurité renseignée ou non ; filtre district',
    start: '  function siteRows() {', end: "return rows.filter(s => (F.act === 'ALL' || s.act === F.act) && (!reg || s.region === reg) && (!fo || s.fo === fo));\n  }",
    replace: `  function siteRows() {
    const PF = D.planFull, c = k => PF.cols.indexOf(k); const idx = siteIndex(); const ref = localDay(); const CN = plCanon(); const SK = plSecSet();
    const ci = { act: c('act'), region: c('region'), district: c('district'), commune: c('commune'), localite: c('localite'), fo: c('fo'), actif: c('actif'), months: c('months'), tagCode: c('tagCode'), fokontany: c('fokontany'), motif: c('motif'), annee: c('annee'), publicId: c('publicId'), security: c('security'), lat: c('lat'), lon: c('lon') };
    return PF.rows.map((r, j) => {
      const l = idx.get(r[ci.act] + '|' + r[0]) || []; const last = l[l.length - 1];
      const dR = r[ci.district] || '', cR = r[ci.commune] || ''; const region = ENGINE.canonRegion(r[ci.region]) || '';
      const district = CN.district.get(plNorm(dR)) || dR, commune = CN.commune.get(plNorm(cR)) || cR, sec = +r[ci.security] || 0;
      return { j, code: r[0], act: r[ci.act], region, district, commune, districtRaw: dR, communeRaw: cR, kReg: plNorm(region), kDis: plNorm(district), localite: r[ci.localite] || '', fo: FO_NORM(r[ci.fo] || ''),
        actif: r[ci.actif] === 1, months: r[ci.months] || '------------', nVis: l.length, last: last ? last.date : null, since: last ? daysBetween(last.date, ref) : null,
        lastScore: last ? last.score : null, lastRisks: last ? last.risks : [], lastV: last || null, hist: l,
        tagCode: r[ci.tagCode], fokontany: r[ci.fokontany] || '', motif: r[ci.motif] || '', annee: r[ci.annee], publicId: r[ci.publicId] || '', security: sec, secKnown: sec !== 0 || SK.has(r[ci.act] + '|' + r[0]), lat: r[ci.lat], lon: r[ci.lon] };
    });
  }
  function siteFiltered(rows) {
    const reg = F.region >= 0 ? plNorm(DICT.region[F.region]) : null, fo = F.fo >= 0 ? DICT.fo[F.fo] : null, dis = F.district >= 0 ? plNorm(DICT.district[F.district]) : null;
    return rows.filter(s => (F.act === 'ALL' || s.act === F.act) && (!reg || s.kReg === reg) && (!fo || s.fo === fo) && (!dis || s.kDis === dis));
  }` },
  { label: 'grille d’activation : écriture unique du plan de suivi (plEdit)',
    find: "if (SESSION.admin) b.addEventListener('click', () => { const r = D.planFull.rows[s.j], ci = D.planFull.cols.indexOf('months'); const a = (r[ci] || '------------').split(''); a[i] = a[i] === '1' ? '0' : '1'; r[ci] = a.join(''); SESSION.dirty = true; render(); });",
    replace: "if (SESSION.admin) b.addEventListener('click', () => { const a = (D.planFull.rows[s.j][D.planFull.cols.indexOf('months')] || '------------').split(''); a[i] = a[i] === '1' ? '0' : '1'; plEdit([{ j: s.j, field: 'months', value: a.join('') }], { motif: 'Grille ' + MONTHS_FR[i] + ' ' + (s.annee || '') + ' → ' + (a[i] === '1' ? 'Oui' : 'Non') }); });" },
  { label: 'sécurité : « non renseignée » distinguée de 0, écriture unique (plEdit)',
    start: '  function secCell(s) {', end: '    return se;\n  }', replace: '  function secCell(s) { return plSecCell(s); }' },
  { label: 'onglet Sites : écran du module (filtres globaux, district, statut RBM, tiroir de site)',
    start: "  const SITE_UI = { q: '', status: 'all' };\n  function renderSites(main) {", end: "'hint'));\n  }\n  const SITE_XLS_H",
    replace: "  const SITE_UI = { q: '', status: 'all', page: 0 };\n  function renderSites(main) { plRenderSites(main); }\n  const SITE_XLS_H" },
  { label: 'planification : moteur unique (API rbmCfg / rbmCompute conservée)',
    start: '  // ---------------- tab: RBM planning', end: "      el('li', { text: 'Les données utilisées sont celles des visites exploitables (scores recalculés, alertes critiques) et la note des partenaires de mise en œuvre de l’onglet Partenaires.' })]))]));\n  }",
    replace: RBM_BLOCK },
  { label: 'export CSV : neutralisation des formules (cellules = + - @ tabulation retour)',
    start: '  function csvBlob(header, rows) {', end: "{ type: 'text/csv;charset=utf-8' });\n  }",
    replace: `  function csvBlob(header, rows) {
    // données de terrain non fiables : une cellule TEXTE qui commence par = + - @ tabulation ou retour chariot est préfixée d'une apostrophe
    const q = x => { if (x === null || x === undefined) return ''; if (typeof x === 'number') return isFinite(x) ? String(x) : ''; let t = String(x); if (/^[=+\\-@\\t\\r]/.test(t)) t = "'" + t; return /[",;\\r\\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    return new Blob(['\\uFEFF' + [header].concat(rows).map(r => r.map(q).join(',')).join('\\r\\n') + '\\r\\n'], { type: 'text/csv;charset=utf-8' });
  }` },
  { label: 'Données : carte « Enregistrer » allégée (les consignes passent en infobulle)',
    start: "    main.appendChild(card('Enregistrer et partager', null, [", end: "importez, puis téléchargez la nouvelle version.', 'hint')]));",
    replace: "    main.appendChild(plCard('Enregistrer et partager', 'Le fichier téléchargé contient toutes les données et les dates de mise à jour. Remplacez l’ancien fichier sur le dossier partagé (ou envoyez-le) : les destinataires l’ouvrent dans Chrome ou Edge et consultent tout en lecture seule.\\n\\nPour mettre à jour plus tard : ouvrez le dernier fichier, déverrouillez, importez, puis téléchargez la nouvelle version.', [\n      el('div', { class: 'frow' }, [btn('Télécharger le dashboard mis à jour (.html)', () => { exportHtml(); }, 'on')])]));" },
  { label: 'onglet : « Planification » (espace unique)', find: "['rbm', 'Planification RBM']", replace: "['rbm', 'Planification']" },
];
