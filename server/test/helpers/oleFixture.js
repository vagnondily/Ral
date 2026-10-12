/**
 * Fabrique de conteneurs OLE « Compound File » v3 pour les tests (un seul flux,
 * nommé « Workbook » par défaut — « WordDocument » pour simuler un .doc) — et
 * d'un flux BIFF8 réduit aux globals (BOF + BOUNDSHEET + EOF) pour nommer des
 * feuilles sans écrire de cellules.
 */
const rec = (type, data) => { const h = Buffer.alloc(4); h.writeUInt16LE(type, 0); h.writeUInt16LE(data.length, 2); return Buffer.concat([h, data]); };

/** Globals BIFF8 : une feuille par nom (assez pour lire les noms de feuilles). */
function biffGlobals(sheetNames) {
  const bof = rec(0x0809, Buffer.concat([Buffer.from([0x00, 0x06, 0x05, 0x00]), Buffer.alloc(12)]));
  const sheets = sheetNames.map((name) => {
    const meta = Buffer.alloc(6); // position du flux de la feuille (inutile ici) + visibilité + type
    return rec(0x0085, Buffer.concat([meta, Buffer.from([name.length, 0]), Buffer.from(name, 'latin1')]));
  });
  return Buffer.concat([bof, ...sheets, rec(0x000a, Buffer.alloc(0))]);
}

function oleFile(stream, { streamName = 'Workbook' } = {}) {
  const SS = 512; const FREE = 0xffffffff; const END = 0xfffffffe;
  const sectors = (buf) => { const n = Math.ceil(buf.length / SS); const out = Buffer.alloc(n * SS); buf.copy(out); return out; };
  const fat = Array(128).fill(FREE); fat[0] = 0xfffffffd; fat[1] = END;
  const header = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
  header.writeUInt16LE(0x3e, 0x18); header.writeUInt16LE(3, 0x1a); header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e); header.writeUInt16LE(6, 0x20); header.writeUInt32LE(1, 0x2c); header.writeUInt32LE(1, 0x30);
  header.writeUInt32LE(4096, 0x38); header.writeUInt32LE(END, 0x44);
  for (let i = 0; i < 109; i += 1) header.writeUInt32LE(i === 0 ? 0 : FREE, 0x4c + i * 4);
  const entry = (name, type, start, size, child = FREE) => {
    const e = Buffer.alloc(128); Buffer.from(`${name}\0`, 'utf16le').copy(e); e.writeUInt16LE((name.length + 1) * 2, 64);
    e[66] = type; e.writeUInt32LE(FREE, 68); e.writeUInt32LE(FREE, 72); e.writeUInt32LE(child, 76); e.writeUInt32LE(start, 116); e.writeUInt32LE(size, 120);
    return e;
  };
  let body; let root; let wbEntry;
  if (stream.length >= 4096) { // flux ordinaire : secteurs 2.. chaînés dans la FAT
    const data = sectors(stream); const n = data.length / SS;
    for (let i = 0; i < n; i += 1) fat[2 + i] = i === n - 1 ? END : 3 + i;
    header.writeUInt32LE(END, 0x3c);
    root = entry('Root Entry', 5, END, 0, 1); wbEntry = entry(streamName, 2, 2, stream.length);
    body = data;
  } else { // petit flux : mini-secteurs de 64 octets dans le flux de la racine
    const mini = Buffer.alloc(Math.ceil(stream.length / 64) * 64); stream.copy(mini);
    const nMini = mini.length / 64; const miniFat = Array(128).fill(FREE);
    for (let i = 0; i < nMini; i += 1) miniFat[i] = i === nMini - 1 ? END : i + 1;
    const container = sectors(mini); const n = container.length / SS;
    fat[2] = END; for (let i = 0; i < n; i += 1) fat[3 + i] = i === n - 1 ? END : 4 + i;
    header.writeUInt32LE(2, 0x3c); header.writeUInt32LE(1, 0x40);
    const mf = Buffer.alloc(SS); miniFat.forEach((v, i) => mf.writeUInt32LE(v, i * 4));
    root = entry('Root Entry', 5, 3, mini.length, 1); wbEntry = entry(streamName, 2, 0, stream.length);
    body = Buffer.concat([mf, container]);
  }
  const fatSec = Buffer.alloc(SS); fat.forEach((v, i) => fatSec.writeUInt32LE(v, i * 4));
  const dir = Buffer.concat([root, wbEntry, Buffer.alloc(256)]);
  return Buffer.concat([header, fatSec, dir, body]);
}

module.exports = { oleFile, biffGlobals };
