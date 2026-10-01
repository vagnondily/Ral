/**
 * Lecteur SPSS « .sav » (System File) — pur, sans dépendance, pour ingérer les
 * exports Kobo (le zip Kobo contient data.sav + repeats). Couvre le format
 * courant produit par SPSS/Ona : little-endian, compression bytecode
 * (compression=1), variables numériques et chaînes (y compris multi-segments),
 * étiquettes de valeurs, noms longs (extension 13) et encodage (extension 20).
 *
 * Renvoie { meta, variables, rows } où rows est une liste d'objets
 * { <nomVariable>: valeur }. Les valeurs numériques « system-missing » sont
 * null ; les chaînes sont décodées (UTF-8 par défaut) et détourées.
 *
 * Hors périmètre (dégradation gracieuse, pas d'erreur) : ZSAV (zlib,
 * compression=2) et « very long strings » > 255 (extension 14) — rares dans les
 * exports Kobo de process monitoring.
 */

const MAGIC = '$FL2';

function makeReader(buf, le) {
  let p = 0;
  return {
    get pos() { return p; },
    set pos(v) { p = v; },
    eof() { return p >= buf.length; },
    i32() { const v = le ? buf.readInt32LE(p) : buf.readInt32BE(p); p += 4; return v; },
    u8() { const v = buf.readUInt8(p); p += 1; return v; },
    f64() { const v = le ? buf.readDoubleLE(p) : buf.readDoubleBE(p); p += 8; return v; },
    bytes(n) { const v = buf.subarray(p, p + n); p += n; return v; },
    str(n) { const v = buf.toString('latin1', p, p + n); p += n; return v; },
  };
}

function decodeStr(bytes, encoding) {
  const enc = /utf-?8/i.test(encoding || '') ? 'utf8' : 'latin1';
  return Buffer.from(bytes).toString(enc);
}

/** Parse un buffer .sav. Lève une erreur claire si ce n'est pas un System File. */
function parseSav(buffer, { applyValueLabels = false } = {}) {
  if (!buffer || buffer.length < 176) throw new Error('Fichier .sav trop court ou vide.');
  const magic = buffer.toString('latin1', 0, 4);
  if (magic !== MAGIC) {
    if (magic === '$FL3') throw new Error('Fichier ZSAV (compressé zlib) non pris en charge — exportez en .sav classique ou CSV.');
    throw new Error('Signature .sav invalide (attendu $FL2).');
  }
  // Détection endianness via layout_code (@64) : 2 ou 3 en little-endian.
  let le = true;
  const probe = buffer.readInt32LE(64);
  if (probe !== 2 && probe !== 3) le = false;

  const r = makeReader(buffer, le);
  r.pos = 64;
  const layoutCode = r.i32();
  const caseSize = r.i32();          // nominal_case_size = nombre de « slots » par cas
  const compression = r.i32();       // 0 none, 1 bytecode, 2 zlib (ZSAV)
  r.i32();                           // weight_index
  const ncases = r.i32();            // -1 si inconnu
  const bias = r.f64();              // généralement 100
  r.str(9); r.str(8); r.str(64);     // date, time, file_label
  r.str(3);                          // padding → header = 176 octets
  if (compression === 2) throw new Error('Fichier ZSAV (compression zlib) non pris en charge — exportez en .sav classique ou CSV.');

  const variables = [];   // tous les enregistrements (y compris continuations -1)
  const valueLabelSets = []; // { labels: Map(numeric->label), vars: [dictIdx 1-based] }
  let encoding = 'utf-8';
  const longNames = {};   // SHORT -> LongName

  // ---- Dictionnaire -------------------------------------------------------
  let guard = 0;
  for (;;) {
    guard += 1; if (guard > 1e7) throw new Error('.sav : dictionnaire anormalement long.');
    const recType = r.i32();
    if (recType === 999) { r.i32(); break; } // filler puis début des données
    if (recType === 2) {
      const type = r.i32();            // 0 numérique, >0 largeur chaîne, -1 continuation
      const hasLabel = r.i32();
      const nMissing = r.i32();
      r.i32(); r.i32();                // print/write formats
      const name = r.str(8).trim();
      let label = '';
      if (hasLabel) {
        const len = r.i32();
        label = r.str(len);
        const pad = (4 - (len % 4)) % 4; r.pos += pad;
      }
      if (nMissing) r.pos += Math.abs(nMissing) * 8;
      variables.push({ type, name, label, continuation: type === -1 });
    } else if (recType === 3) {
      const count = r.i32();
      const labels = new Map();
      for (let i = 0; i < count; i += 1) {
        const value = r.f64();         // valeur (numérique ; pour les chaînes = 8 octets)
        const len = r.u8();
        const text = r.str(len);
        const used = 1 + len; const pad = (8 - (used % 8)) % 8; r.pos += pad;
        labels.set(value, text);
      }
      const t4 = r.i32();
      if (t4 !== 4) throw new Error('.sav : enregistrement 4 (variables d\'étiquettes) attendu.');
      const vcount = r.i32();
      const vars = [];
      for (let i = 0; i < vcount; i += 1) vars.push(r.i32());
      valueLabelSets.push({ labels, vars });
    } else if (recType === 6) {        // documents
      const n = r.i32(); r.pos += n * 80;
    } else if (recType === 7) {        // extensions
      const subtype = r.i32();
      const size = r.i32();
      const count = r.i32();
      const total = size * count;
      const raw = r.bytes(total);
      if (subtype === 20) encoding = Buffer.from(raw).toString('latin1').trim() || encoding;
      else if (subtype === 13) {
        const s = Buffer.from(raw).toString('utf8');
        for (const pair of s.split('\t')) { const eq = pair.indexOf('='); if (eq > 0) longNames[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim(); }
      }
      // autres subtypes ignorés
    } else {
      throw new Error(`.sav : type d'enregistrement inattendu ${recType} à l'octet ${r.pos - 4}.`);
    }
  }

  // ---- Variables logiques (regrouper les segments de chaîne) --------------
  const logical = [];   // { name, label, isStr, segments, width, dictIdx }
  for (let i = 0; i < variables.length; i += 1) {
    const v = variables[i];
    if (v.continuation) continue; // absorbé par sa variable principale
    if (v.type === 0) {
      logical.push({ name: v.name, label: v.label, isStr: false, segments: 1, width: 0, dictIdx: i });
    } else {
      const width = v.type;
      const segments = Math.max(1, Math.ceil(width / 8));
      logical.push({ name: v.name, label: v.label, isStr: true, segments, width, dictIdx: i });
      i += segments - 1; // sauter les continuations
    }
  }
  // Appliquer les noms longs.
  for (const lv of logical) if (longNames[lv.name]) lv.name = longNames[lv.name];

  // Étiquettes de valeurs par variable (index dict 1-based → variable logique).
  const labelByDictIdx = new Map();
  for (const set of valueLabelSets) for (const dv of set.vars) labelByDictIdx.set(dv - 1, set.labels);
  for (const lv of logical) { const m = labelByDictIdx.get(lv.dictIdx); if (m) lv.valueLabels = m; }

  // ---- Données ------------------------------------------------------------
  // Lecture valeur par valeur selon les « slots » (un par enregistrement de
  // variable, continuations incluses) ; compression bytecode si compression=1.
  const SYSMIS = Symbol('sysmis');
  let cmd = null; let cmdIdx = 8;
  const nextCode = () => {
    if (cmdIdx >= 8) {
      if (r.pos + 8 > buffer.length) return null;
      cmd = r.bytes(8); cmdIdx = 0;
    }
    return cmd[cmdIdx++];
  };
  // Un « slot » = 8 octets logiques. Renvoie {num} ou {strBytes} ou END.
  const nextSlot = (isStr) => {
    if (compression === 0) {
      if (r.pos + 8 > buffer.length) return 'END';
      return isStr ? { strBytes: r.bytes(8) } : { num: r.f64() };
    }
    for (;;) {
      const code = nextCode();
      if (code == null || code === 252) return 'END';
      if (code === 0) continue;                       // padding
      if (code === 253) return isStr ? { strBytes: r.bytes(8) } : { num: r.f64() };
      if (code === 254) return { strBytes: Buffer.from('        ', 'latin1') };
      if (code === 255) return { num: SYSMIS };
      return { num: code - bias };                     // 1..251 : petit entier compressé
    }
  };

  const rows = [];
  const maxCases = ncases >= 0 ? ncases : 1e7;
  let caseCount = 0;
  outer: while (caseCount < maxCases) {
    const row = {};
    for (const lv of logical) {
      if (!lv.isStr) {
        const s = nextSlot(false);
        if (s === 'END') break outer;
        row[lv.name] = s.num === SYSMIS ? null : s.num;
      } else {
        const parts = [];
        for (let seg = 0; seg < lv.segments; seg += 1) {
          const s = nextSlot(true);
          if (s === 'END') { if (seg === 0 && lv === logical[0]) break outer; break; }
          parts.push(s.strBytes || Buffer.from('        ', 'latin1'));
        }
        const bytes = Buffer.concat(parts).subarray(0, lv.width);
        row[lv.name] = decodeStr(bytes, encoding).replace(/\s+$/, '');
      }
    }
    if (Object.keys(row).length === 0) break;
    if (applyValueLabels) {
      for (const lv of logical) if (lv.valueLabels && row[lv.name] != null && lv.valueLabels.has(row[lv.name])) row[lv.name] = lv.valueLabels.get(row[lv.name]);
    }
    rows.push(row);
    caseCount += 1;
  }

  return {
    meta: { encoding, compression, cases: rows.length, declaredCases: ncases, caseSize, bias, layoutCode },
    variables: logical.map((v) => ({ name: v.name, label: v.label, type: v.isStr ? 'string' : 'numeric', width: v.width })),
    rows,
  };
}

module.exports = { parseSav };
