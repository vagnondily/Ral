const ExcelJS = require('exceljs');

/**
 * Parseur de la feuille « Risk-based site selection » du Plan de suivi
 * (feuilles Co-Monitoring / par bureau). Détecte la ligne d'en-tête et les
 * colonnes par mots-clés (robuste aux décalages), puis renvoie un site par
 * ligne avec géographie + critères + SCORE FINAL + GPS + activité + dernière
 * visite. Pur (pas d'I/O DB) ; l'upsert est fait par le repository.
 */
const txt = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if (v.text) return v.text;
    if (v.result != null) return String(v.result);
    return '';
  }
  return String(v);
};
const num = (v) => { const t = txt(v).trim(); if (t === '' || t === '-') return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const clamp = (v, lo, hi) => { const n = num(v); if (n == null) return 0; return Math.max(lo, Math.min(hi, Math.round(n))); };
const serialToMonth = (v) => { const n = num(v); if (!n || n < 10000 || n > 60000) return null; const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const riskFromScore = (n) => (n === 0 ? 'faible' : n === 1 ? 'moyenne' : 'elevee');

// Colonnes détectées par mot-clé dans la ligne d'en-tête.
const MATCHERS = {
  subOffice: /sub-?office name/i,
  antenne: /^antenne$/i,
  name: /site name/i,
  region: /^region$/i,
  district: /^district$/i,
  commune: /^communes?$/i,
  fokontany: /fokontany/i,
  code: /id sites?/i,
  gpsLat: /lat/i,
  gpsLng: /^.*(lon|lng)/i,
  activity: /activity category/i,
  security: /security/i,
  synergies: /synergies/i,
  caseload: /caseload|size \(/i,
  newPartner: /new partner/i,
  lastVisit: /last visit/i,
  issuesProcess: /internal process|issues from internal/i,
  issuesPartnerReport: /partner report/i,
  issuesCFM: /cfm/i,
  fraud: /fraud/i,
  finalScore: /final score/i,
};

function detectHeader(ws) {
  // En-tête = la 1re ligne (parmi les 8 premières) qui contient « Site name » ET « FINAL SCORE ».
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r += 1) {
    const row = ws.getRow(r); const map = {}; let hasName = false; let hasScore = false;
    for (let c = 1; c <= ws.columnCount; c += 1) {
      const h = txt(row.getCell(c).value).trim(); if (!h) continue;
      for (const [key, re] of Object.entries(MATCHERS)) {
        if (map[key] == null && re.test(h)) map[key] = c;
      }
      if (/site name/i.test(h)) hasName = true;
      if (/final score/i.test(h)) hasScore = true;
    }
    if (hasName && hasScore && map.name) return { headerRow: r, cols: map };
  }
  return null;
}

/**
 * @returns { sites: [...], headerRow, skipped } — sites prêts à upsert.
 * Un site requiert au moins district + commune + nom (sinon ignoré).
 */
async function parsePlanWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  // Cherche une feuille exploitable (Co-Monitoring, par bureau, …).
  let found = null;
  for (const ws of wb.worksheets) {
    const det = detectHeader(ws);
    if (det) { found = { ws, ...det }; break; }
  }
  if (!found) return { sites: [], headerRow: null, skipped: 0, sheet: null };
  const { ws, headerRow, cols } = found;
  const cell = (row, key) => (cols[key] ? row.getCell(cols[key]).value : null);
  const sites = []; const seen = new Set(); let skipped = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const name = txt(cell(row, 'name')).trim();
    const district = txt(cell(row, 'district')).trim();
    const commune = txt(cell(row, 'commune')).trim();
    if (!name) continue;
    if (!district || !commune) { skipped += 1; continue; }
    const key = `${district}|${commune}|${name}`.toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    const lat = num(cell(row, 'gpsLat')); const lng = num(cell(row, 'gpsLng'));
    const finalScore = clamp(cell(row, 'finalScore'), 0, 2);
    sites.push({
      name, district, commune,
      region: txt(cell(row, 'region')).trim() || null,
      fokontany: txt(cell(row, 'fokontany')).trim() || null,
      code: txt(cell(row, 'code')).trim() || null,
      activity: txt(cell(row, 'activity')).trim() || null,
      gpsLat: (lat != null && lat > -30 && lat < 0) ? lat : null,
      gpsLng: (lng != null && lng > 40 && lng < 55) ? lng : null,
      security: clamp(cell(row, 'security'), 0, 2),
      synergies: clamp(cell(row, 'synergies'), 0, 1),
      beneficiaryOver200: clamp(cell(row, 'caseload'), 0, 1),
      newPartner: clamp(cell(row, 'newPartner'), 0, 1),
      issuesProcess: clamp(cell(row, 'issuesProcess'), 0, 2),
      issuesPartnerReport: clamp(cell(row, 'issuesPartnerReport'), 0, 2),
      issuesCFM: clamp(cell(row, 'issuesCFM'), 0, 2),
      fraud: clamp(cell(row, 'fraud'), 0, 1),
      finalScore,
      risk: riskFromScore(finalScore),
      lastVisit: serialToMonth(cell(row, 'lastVisit')),
    });
  }
  return { sites, headerRow, skipped, sheet: ws.name };
}

module.exports = { parsePlanWorkbook };
