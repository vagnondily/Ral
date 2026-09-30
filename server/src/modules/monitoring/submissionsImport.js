const ExcelJS = require('exceljs');

/**
 * Parse a monitoring export (CSV or XLSX, e.g. a Kobo download) into normalized
 * submission rows. The raw answers are kept verbatim in `data`; a few well-known
 * Kobo columns are lifted into typed fields for filtering/grouping. The same
 * shape is produced whatever the source, so the Kobo v2 API and SPSS .sav
 * importers (next phase) can feed the very same insert path.
 */

// Well-known Kobo/XLSForm columns → normalized fields (case-insensitive).
const MAP = {
  external_id: ['_uuid', '_id', 'uuid', 'meta/instanceid'],
  submitted_at: ['_submission_time', 'end', 'submissiondate', 'today', 'svydate'],
  field_office: ['field_office', 'fieldoffice', 'sous bureau', 'sousbureau'],
  admin1: ['admin1name', 'admin1', 'region', 'niveau régional'],
  admin2: ['admin2name', 'admin2', 'province'],
  admin3: ['admin3name', 'admin3', 'district'],
  admin4: ['admin4name', 'admin4', 'commune', 'community'],
  site: ['site', 'sitename', 'site_name', 'epp', 'etablissement', 'établissement'],
  partner: ['enupartner', 'partner', 'organisation', 'ong'],
  agent: ['enuname', 'enumerator', 'agent', 'énumérateur'],
};

const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function buildLookup(headers) {
  const byNorm = new Map();
  headers.forEach((h, i) => { if (h != null && h !== '') byNorm.set(norm(h), i); });
  const picks = {};
  for (const [field, aliases] of Object.entries(MAP)) {
    for (const a of aliases) { if (byNorm.has(a)) { picks[field] = byNorm.get(a); break; } }
  }
  return picks;
}

function monthOf(value) {
  if (!value) return null;
  const s = String(value);
  const m = s.match(/(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-01`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return null;
}

function rowToSubmission(headers, values, picks, source) {
  const data = {};
  headers.forEach((h, i) => {
    if (h == null || h === '') return;
    const v = values[i];
    if (v !== undefined && v !== null && v !== '') data[h] = v;
  });
  const at = (field) => (picks[field] != null ? values[picks[field]] : undefined);
  const submittedRaw = at('submitted_at');
  return {
    externalId: at('external_id') != null ? String(at('external_id')) : null,
    periodMonth: monthOf(submittedRaw),
    submittedAt: submittedRaw ? new Date(submittedRaw) : null,
    fieldOffice: at('field_office') != null ? String(at('field_office')) : null,
    admin1: at('admin1') != null ? String(at('admin1')) : null,
    admin2: at('admin2') != null ? String(at('admin2')) : null,
    admin3: at('admin3') != null ? String(at('admin3')) : null,
    admin4: at('admin4') != null ? String(at('admin4')) : null,
    site: at('site') != null ? String(at('site')) : null,
    partner: at('partner') != null ? String(at('partner')) : null,
    agent: at('agent') != null ? String(at('agent')) : null,
    source,
    data,
  };
}

/** Split a CSV line honoring quotes; delimiter given. */
function splitCsvLine(line, delim) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const headers = splitCsvLine(lines[0], delim).map((h) => h.trim());
  const rows = lines.slice(1).map((l) => splitCsvLine(l, delim));
  return { headers, rows };
}

async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => { headers[col - 1] = cellText(c); });
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const vals = [];
    let any = false;
    for (let c = 0; c < headers.length; c += 1) {
      const v = cellText(row.getCell(c + 1));
      vals[c] = v;
      if (v !== '') any = true;
    }
    if (any) rows.push(vals);
  }
  return { headers, rows };
}

function cellText(cell) {
  const v = cell && cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v instanceof Date) return v.toISOString();
    return '';
  }
  return v;
}

/** Parse a buffer (auto-detect XLSX vs CSV) into normalized submissions. */
async function parseSubmissions(buffer, { filename = '' } = {}) {
  const isXlsx = buffer[0] === 0x50 && buffer[1] === 0x4b; // 'PK' zip magic (xlsx)
  const { headers, rows } = isXlsx
    ? await parseXlsx(buffer)
    : parseCsv(buffer.toString('utf8'));
  const source = isXlsx ? 'xlsx' : 'csv';
  void filename;
  if (!headers.length) return { submissions: [], headers: [] };
  const picks = buildLookup(headers);
  const submissions = rows
    .map((v) => rowToSubmission(headers, v, picks, source))
    .filter((s) => Object.keys(s.data).length > 0);
  return { submissions, headers };
}

/**
 * Normalize an array of plain objects (e.g. Kobo v2 API `data.json` records)
 * into the same submission shape. Group-prefixed keys ("grp/field") are
 * flattened to their leaf name so they match the mapping fields.
 */
function submissionsFromObjects(objects, source = 'kobo') {
  const out = [];
  for (const obj of objects || []) {
    const flat = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v == null || typeof v === 'object') continue;
      const leaf = String(k).split('/').pop();
      if (!(leaf in flat)) flat[leaf] = v;
    }
    const headers = Object.keys(flat);
    const values = headers.map((h) => flat[h]);
    const picks = buildLookup(headers);
    const s = rowToSubmission(headers, values, picks, source);
    // Kobo identifiers live on the raw object, not always flattened.
    s.externalId = obj._uuid || obj['meta/instanceID'] || s.externalId || (obj._id != null ? String(obj._id) : null);
    if (!s.periodMonth) s.periodMonth = monthOf(obj._submission_time);
    if (Object.keys(s.data).length > 0) out.push(s);
  }
  return out;
}

module.exports = { parseSubmissions, submissionsFromObjects, MAP };
