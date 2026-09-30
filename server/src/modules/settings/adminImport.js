const os = require('os');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { DBFFile } = require('dbffile');

// Parse an uploaded admin breakdown (one file PER COUNTRY / tenant) into
// { levels: [labels...], records: [[v1,v2,...], ...] }.
// Accepted: .csv/.txt (header row = level labels), .dbf (shapefile attribute
// table), or a .zip shapefile bundle (its .dbf is read). For a .dbf we keep the
// attribute columns that look like administrative levels, ordered coarse→fine.

const LEVEL_HINTS = [
  [/^(adm0|country|pays|nation)/i, 0],
  [/^(adm1|province|region|région|faritra)/i, 1],
  [/^(adm2|district|departement|département|departement)/i, 2],
  [/^(adm3|commune|kaominina|municipality|ville)/i, 3],
  [/^(adm4|fokontany|fokotany|village|locality|localite|localité|quartier)/i, 4],
];

function detectDelimiter(line) {
  const c = (line.match(/;/g) || []).length;
  const v = (line.match(/,/g) || []).length;
  const t = (line.match(/\t/g) || []).length;
  if (t >= c && t >= v) return '\t';
  return c >= v ? ';' : ',';
}

function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) throw new Error('Fichier CSV vide ou sans données.');
  const delim = detectDelimiter(lines[0]);
  const split = (l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
  const levels = split(lines[0]).filter(Boolean);
  const records = lines.slice(1).map(split);
  return { levels, records };
}

function orderDbfFields(fieldNames) {
  const scored = fieldNames
    .map((name) => {
      const hit = LEVEL_HINTS.find(([re]) => re.test(name));
      return hit ? { name, rank: hit[1] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);
  // De-dupe by rank keeping the first match.
  const seen = new Set();
  const ordered = [];
  for (const f of scored) { if (!seen.has(f.rank)) { seen.add(f.rank); ordered.push(f.name); } }
  return ordered;
}

async function parseDbf(buffer) {
  const tmp = path.join(os.tmpdir(), `mems-admin-${Date.now()}.dbf`);
  fs.writeFileSync(tmp, buffer);
  try {
    const dbf = await DBFFile.open(tmp);
    const fieldNames = dbf.fields.map((f) => f.name);
    let levelFields = orderDbfFields(fieldNames);
    if (levelFields.length === 0) {
      // Fallback: all fields, in file order (user can refine later).
      levelFields = fieldNames;
    }
    const rows = await dbf.readRecords();
    const records = rows.map((r) => levelFields.map((f) => String(r[f] ?? '').trim()));
    return { levels: levelFields, records };
  } finally {
    fs.unlink(tmp, () => {});
  }
}

async function parseUpload(buffer, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'csv' || ext === 'txt') return parseCsv(buffer.toString('utf8'));
  if (ext === 'dbf') return parseDbf(buffer);
  if (ext === 'zip') {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const dbfEntry = entries.find((e) => e.entryName.toLowerCase().endsWith('.dbf'));
    if (dbfEntry) return parseDbf(dbfEntry.getData());
    const csvEntry = entries.find((e) => /\.(csv|txt)$/i.test(e.entryName));
    if (csvEntry) return parseCsv(csvEntry.getData().toString('utf8'));
    throw new Error('Le .zip ne contient ni .dbf ni .csv.');
  }
  throw new Error('Format non supporté : fournissez un .csv, un .dbf ou un .zip (shapefile).');
}

module.exports = { parseUpload };
