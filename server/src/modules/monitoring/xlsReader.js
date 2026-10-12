/**
 * Lecteur PUR (sans dépendance, sans I/O) des classeurs Excel 97-2003 (.xls,
 * format BIFF8 dans un conteneur OLE « Compound File »). Kobo et ODK
 * produisent encore des XLSForms en .xls ; ExcelJS ne lit que le .xlsx.
 *
 * Ne renvoie que des VALEURS de cellules (texte, nombre, booléen) par feuille,
 * sous la forme attendue par parseXlsformRows : { [feuille]: lignes[][] }.
 * Aucune macro, formule ou lien n'est exécuté (on lit la valeur en cache).
 * Refuse explicitement un fichier protégé par mot de passe ou antérieur à
 * Excel 97 (BIFF5), plutôt que de rendre des données fausses.
 */
class XlsError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

/** Le tampon commence-t-il par la signature d'un conteneur OLE (.xls, .doc…) ? */
const isOleFile = (buf) => Buffer.isBuffer(buf) && buf.length >= 512 && buf.subarray(0, 8).equals(SIGNATURE);

// ---- Conteneur OLE (Compound File Binary) ------------------------------------------
function readCompoundFile(buf) {
  if (!isOleFile(buf)) throw new XlsError('Ce fichier n\'est pas un classeur Excel 97-2003 (.xls).', 'NOT_OLE');
  const sectorSize = 1 << buf.readUInt16LE(0x1e);
  const miniSectorSize = 1 << buf.readUInt16LE(0x20);
  const firstDirSector = buf.readUInt32LE(0x30);
  const miniCutoff = buf.readUInt32LE(0x38);
  const firstMiniFat = buf.readUInt32LE(0x3c);
  let difatSector = buf.readUInt32LE(0x44);
  const sectorOffset = (n) => (n + 1) * sectorSize;
  const sector = (n) => {
    const off = sectorOffset(n);
    if (off >= buf.length) throw new XlsError('Fichier .xls tronqué ou corrompu.', 'CORRUPT');
    return buf.subarray(off, Math.min(off + sectorSize, buf.length));
  };

  // Table d'allocation (FAT) : secteurs listés dans l'en-tête puis dans la chaîne DIFAT.
  const fatSectors = [];
  for (let i = 0; i < 109; i += 1) { const s = buf.readUInt32LE(0x4c + i * 4); if (s !== FREESECT) fatSectors.push(s); }
  const perDifat = sectorSize / 4 - 1;
  for (let guard = 0; difatSector !== ENDOFCHAIN && difatSector !== FREESECT && guard < 10000; guard += 1) {
    const d = sector(difatSector);
    for (let i = 0; i < perDifat; i += 1) { const s = d.readUInt32LE(i * 4); if (s !== FREESECT) fatSectors.push(s); }
    difatSector = d.readUInt32LE(perDifat * 4);
  }
  const fat = [];
  for (const s of fatSectors) { const d = sector(s); for (let i = 0; i + 4 <= d.length; i += 4) fat.push(d.readUInt32LE(i)); }

  const chain = (start, table) => {
    const out = []; const seen = new Set();
    for (let s = start; s !== ENDOFCHAIN && s !== FREESECT && s < table.length; s = table[s]) {
      if (seen.has(s)) throw new XlsError('Fichier .xls corrompu (chaîne de secteurs en boucle).', 'CORRUPT');
      seen.add(s); out.push(s);
    }
    return out;
  };
  const readChain = (start, size) => Buffer.concat(chain(start, fat).map(sector)).subarray(0, size);

  // Répertoire : entrées de 128 octets.
  const dir = Buffer.concat(chain(firstDirSector, fat).map(sector));
  const entries = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLen = dir.readUInt16LE(off + 64);
    const type = dir[off + 66];
    if (!type) continue;
    entries.push({
      name: dir.toString('utf16le', off, off + Math.max(0, nameLen - 2)),
      type, start: dir.readUInt32LE(off + 116), size: dir.readUInt32LE(off + 120),
    });
  }
  const root = entries.find((e) => e.type === 5);

  // Mini-flux : petits flux (< miniCutoff) rangés dans le flux de la racine.
  let miniStream = null; let miniFat = null;
  const stream = (name) => {
    const e = entries.find((x) => x.type === 2 && x.name.toLowerCase() === name.toLowerCase());
    if (!e) return null;
    if (e.size >= miniCutoff) return readChain(e.start, e.size);
    if (!miniStream) {
      miniStream = root ? readChain(root.start, root.size) : Buffer.alloc(0);
      miniFat = [];
      for (const s of chain(firstMiniFat, fat)) { const d = sector(s); for (let i = 0; i + 4 <= d.length; i += 4) miniFat.push(d.readUInt32LE(i)); }
    }
    return Buffer.concat(chain(e.start, miniFat).map((s) => miniStream.subarray(s * miniSectorSize, (s + 1) * miniSectorSize))).subarray(0, e.size);
  };
  return { stream };
}

// ---- Enregistrements BIFF8 ------------------------------------------------------------
const R = {
  BOF: 0x0809, EOF: 0x000a, FILEPASS: 0x002f, BOUNDSHEET: 0x0085, SST: 0x00fc, CONTINUE: 0x003c,
  LABELSST: 0x00fd, LABEL: 0x0204, RSTRING: 0x00d6, NUMBER: 0x0203, RK: 0x027e, MULRK: 0x00bd,
  BOOLERR: 0x0205, FORMULA: 0x0006, STRING: 0x0207,
};

function* records(buf) {
  for (let off = 0; off + 4 <= buf.length;) {
    const type = buf.readUInt16LE(off); const len = buf.readUInt16LE(off + 2);
    yield { type, offset: off, data: buf.subarray(off + 4, Math.min(off + 4 + len, buf.length)) };
    off += 4 + len;
  }
}

/** Valeur d'un nombre « RK » (entier ou flottant compressé, éventuellement ×100). */
function rkValue(rk) {
  let v;
  if (rk & 0x02) v = rk >> 2; // entier signé sur 30 bits
  else { const b = Buffer.alloc(8); b.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4); v = b.readDoubleLE(0); }
  return rk & 0x01 ? v / 100 : v;
}

/**
 * Lecture de chaînes réparties sur plusieurs enregistrements (SST + CONTINUE) :
 * à chaque frontière d'enregistrement au milieu des caractères, un nouvel octet
 * d'options indique si la suite est en 1 ou 2 octets par caractère.
 */
class SegmentReader {
  constructor(segments) { this.segs = segments; this.i = 0; this.pos = 0; }
  get cur() { return this.segs[this.i]; }
  ensure() { while (this.cur && this.pos >= this.cur.length) { this.i += 1; this.pos = 0; } return Boolean(this.cur); }
  u8() { this.ensure(); const v = this.cur[this.pos]; this.pos += 1; return v; }
  u16() { return this.u8() | (this.u8() << 8); }
  u32() { return (this.u16() | (this.u16() << 16)) >>> 0; }
  skip(n) { let left = n; while (left > 0 && this.ensure()) { const k = Math.min(left, this.cur.length - this.pos); this.pos += k; left -= k; } }
  chars(cch, highByte) {
    let out = ''; let wide = highByte; let left = cch;
    while (left > 0) {
      if (!this.ensure()) break;
      if (this.pos === 0 && out.length > 0) wide = (this.u8() & 0x01) === 1; // reprise dans un CONTINUE
      const avail = Math.floor((this.cur.length - this.pos) / (wide ? 2 : 1));
      const n = Math.min(left, avail);
      if (n <= 0) { this.i += 1; this.pos = 0; continue; }
      const slice = this.cur.subarray(this.pos, this.pos + n * (wide ? 2 : 1));
      out += wide ? slice.toString('utf16le') : slice.toString('latin1');
      this.pos += n * (wide ? 2 : 1); left -= n;
    }
    return out;
  }
  /** XLUnicodeRichExtendedString (entrée de la table SST). */
  richString() {
    const cch = this.u16(); const flags = this.u8();
    const runs = flags & 0x08 ? this.u16() : 0;
    const ext = flags & 0x04 ? this.u32() : 0;
    const s = this.chars(cch, (flags & 0x01) === 1);
    this.skip(runs * 4 + ext);
    return s;
  }
}

/** Chaîne XLUnicodeString d'un seul enregistrement (LABEL, STRING, noms de feuilles). */
function shortString(data, off, { lengthBytes = 2 } = {}) {
  const cch = lengthBytes === 1 ? data[off] : data.readUInt16LE(off);
  const flags = data[off + lengthBytes];
  const start = off + lengthBytes + 1;
  return flags & 0x01 ? data.toString('utf16le', start, start + cch * 2) : data.toString('latin1', start, start + cch);
}

/**
 * @param {Buffer} buf  contenu du fichier .xls
 * @returns {{ sheets: Object<string, Array<Array<string|number|boolean|null>>>, order: string[] }}
 */
function readXls(buf) {
  const cf = readCompoundFile(buf);
  const wb = cf.stream('Workbook');
  if (!wb) {
    if (cf.stream('Book')) throw new XlsError('Classeur Excel 95 ou plus ancien : enregistrez-le en .xlsx.', 'BIFF5');
    throw new XlsError('Aucun classeur dans ce fichier .xls.', 'NO_WORKBOOK');
  }

  // Globals : feuilles (position dans le flux) et table des chaînes partagées.
  const sheetsMeta = []; const sstSegs = []; let inSst = false;
  for (const rec of records(wb)) {
    if (rec.type === R.FILEPASS) throw new XlsError('Classeur protégé par mot de passe : retirez la protection puis réessayez.', 'ENCRYPTED');
    if (rec.type === R.BOF && rec.offset > 0) break; // fin des globals
    if (rec.type === R.BOUNDSHEET) sheetsMeta.push({ pos: rec.data.readUInt32LE(0), kind: rec.data[5], name: shortString(rec.data, 6, { lengthBytes: 1 }) });
    if (rec.type === R.SST) { inSst = true; sstSegs.push(rec.data.subarray(8)); continue; }
    if (rec.type === R.CONTINUE && inSst) { sstSegs.push(rec.data); continue; }
    inSst = false;
  }
  const sst = [];
  if (sstSegs.length) {
    const r = new SegmentReader(sstSegs);
    while (r.ensure()) sst.push(r.richString());
  }

  const sheets = {}; const order = [];
  for (const meta of sheetsMeta.filter((m) => m.kind === 0)) {
    const rows = [];
    const set = (row, col, v) => { (rows[row] ||= [])[col] = v; };
    let pendingFormula = null;
    for (const rec of records(wb.subarray(meta.pos))) {
      const d = rec.data;
      if (rec.type === R.EOF) break;
      switch (rec.type) {
        case R.LABELSST: set(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? null); break;
        case R.LABEL: case R.RSTRING: set(d.readUInt16LE(0), d.readUInt16LE(2), shortString(d, 6)); break;
        case R.NUMBER: set(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6)); break;
        case R.RK: set(d.readUInt16LE(0), d.readUInt16LE(2), rkValue(d.readUInt32LE(6))); break;
        case R.MULRK: {
          const row = d.readUInt16LE(0); const first = d.readUInt16LE(2);
          const n = (d.length - 6) / 6;
          for (let k = 0; k < n; k += 1) set(row, first + k, rkValue(d.readUInt32LE(4 + k * 6 + 2)));
          break;
        }
        case R.BOOLERR: if (d[7] === 0) set(d.readUInt16LE(0), d.readUInt16LE(2), d[6] === 1); break;
        case R.FORMULA: {
          const row = d.readUInt16LE(0); const col = d.readUInt16LE(2);
          if (d.readUInt16LE(12) !== 0xffff) set(row, col, d.readDoubleLE(6));
          else if (d[6] === 0) pendingFormula = { row, col }; // résultat texte dans l'enregistrement STRING suivant
          else if (d[6] === 1) set(row, col, d[8] === 1);
          break;
        }
        case R.STRING: if (pendingFormula) { set(pendingFormula.row, pendingFormula.col, shortString(d, 0)); pendingFormula = null; } break;
        default: break;
      }
    }
    sheets[meta.name] = Array.from(rows, (r) => (r ? Array.from(r, (v) => (v === undefined ? null : v)) : []));
    order.push(meta.name);
  }
  return { sheets, order };
}

module.exports = { readXls, isOleFile, rkValue, XlsError };
