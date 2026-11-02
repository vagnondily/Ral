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
  let M = null, G = null, mainRows = [], seen = new Set(), fRows = [], fSeen = new Set(), sRows = [], sSeen = new Set(), nRaw = 0, noId = 0, header, labelRow = false, first = true;
  const cols = [];
  const val = (row, k) => { const f = G.get(k); return f ? f(row) : null; };
  header = parseCSV(text, h => { M = headerMap(h, S, gdRep); G = makeGetters(M); Object.keys(M.idx).forEach(k => cols.push(k)); return null; }, row => {
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
  const diag = { labelRow, labels: false, decoded: 0, kept: 0, itemsFound: 0, itemsDecodable: 0, risksFound: 0, risksDecodable: 0, admByName: 0, siteSrc: M.idx[S.tb.site] !== undefined ? 'code' : 'absent', siteNamed: 0, siteMatched: 0, siteDistinct: 0, gpsSrc: M.gps ? 'kobo' : (M.idx[S.tb.lat] !== undefined ? 'tableau' : 'absent'), noId };
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
      "    const LAB_CODE = /^-?\\d+(\\.\\d+)?$|^(true|false)$/i;\n" + src(needOf, hClean, hKey, labelDicts, headerMap, makeGetters, isLabelRow, mapReport, readExtract, previewExtract) },
  { label: 'moteur : import du plan de suivi (colonnes tolérantes, case vide = mois inchangé, identifiants conservés) + aperçu',
    start: '    function importPlan(P0, text) {', end: '      P.planFull.rows = out;\n      return P;\n    }', replace: src(planKey, planColumns, importPlan, previewPlan) },
  { label: 'moteur : détection de l’activité (aussi sur les en-têtes Kobo « groupe/variable »)',
    start: '    function detectAct(P, headerLine) {', end: '      return bs >= 3 ? best : null;\n    }', replace: src(detectActDetail, detectAct) },
  { label: 'moteur : exports du lot planification',
    find: '    /*ENGINE-EXPORTS*/',
    replace: "    API.previewExtract = previewExtract; API.previewPlan = previewPlan; API.detectActDetail = detectActDetail; API.headerMap = headerMap; API.parseDay = parseDay;\n" +
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
