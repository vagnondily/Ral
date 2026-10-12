const { badRequest, notFound } = require('../../middleware/errors');
const repo = require('./monitoring.repository');
const { parseSubmissions, submissionsFromObjects } = require('./submissionsImport');
const { MAP } = require('./memsMapping');
const { safeFetch, FetchRefused } = require('./remoteFetch');
const {
  classifyLink, onaApiOrigins, onaDataUrl, koboDataUrl, collectPages, normalizeOnaRecord, maxId,
} = require('./dataLinks');

/**
 * Import d'une fiche de suivi depuis UN lien collé par l'utilisateur :
 * lien Tableau WDC / open-data Ona-MoDA, API Kobo v2, ou export CSV/XLSX/JSON.
 * Toutes les requêtes passent par safeFetch (anti-SSRF, délai, taille) ; les
 * lignes suivent le pipeline commun (dédoublonnage par _uuid) ; la source et
 * le curseur incrémental sont mémorisés sur la fiche.
 */
const PAGE_SIZE = 1000;
// Noms techniques connus du mapping MEMS (admin1…, site, partner…) : servent à
// retrouver un champ Ona renommé (« grp_admin_admin3 ») même sans catalogue XLSForm.
const KNOWN_FIELDS = [...new Set(Object.values(MAP).flat().filter((a) => /^[a-z0-9_]+$/.test(a)))];

const parseJson = (buf) => { try { return JSON.parse(buf.toString('utf8')); } catch { throw new FetchRefused('Réponse non JSON.'); } };
const authHeader = (token) => (token ? { Authorization: /^(Token|Bearer) /i.test(token) ? token : `Token ${token}` } : {});

// Lien « suivant » d'un en-tête HTTP Link (RFC 8288).
function nextFromLink(linkHeader, currentUrl) {
  if (!linkHeader) return null;
  const part = linkHeader.split(',').map((p) => p.trim()).find((p) => /\brel\s*=\s*"?next"?/i.test(p));
  const m = part && part.match(/<([^>]+)>/);
  if (!m) return null;
  try { return new URL(m[1], currentUrl).href; } catch { return null; }
}

/** Ona/MoDA open-data : essaie l'hôte du lien puis api.<hôte> ; pagination page/page_size. */
async function pullOna(link, { gtId }) {
  let lastErr = null;
  for (const apiOrigin of onaApiOrigins(link.origin)) {
    try {
      const res = await collectPages(async (i) => {
        const url = onaDataUrl(apiOrigin, link.uuid, { page: i + 1, pageSize: PAGE_SIZE, gtId });
        const r = await safeFetch(url, { headers: { Accept: 'application/json' } });
        if (r.status === 404 && i > 0) return { rows: [] }; // au-delà de la dernière page
        if (!r.ok) { const e = new FetchRefused(`HTTP ${r.status}`); e.status = r.status; throw e; }
        const body = parseJson(r.buffer);
        if (Array.isArray(body)) return { rows: body };
        return { rows: body.results || body.data || [], next: body.next || nextFromLink(r.headers.get('link'), url), hasNextField: 'next' in body };
      }, { pageSize: PAGE_SIZE });
      return { ...res, apiOrigin };
    } catch (err) {
      lastErr = err;
      if (err.status !== 404 && !/introuvable|ENOTFOUND/i.test(err.message)) break; // autre erreur : inutile d'essayer api.
    }
  }
  throw lastErr || new FetchRefused('Lien open-data introuvable.');
}

/** Kobo v2 : pagination limit/start, champ « next » du corps. */
async function pullKobo(link, token) {
  if (!token) throw badRequest('Un token d\'API Kobo est requis pour ce lien (Compte › Paramètres de sécurité › API).');
  return collectPages(async (i) => {
    const url = koboDataUrl(link.origin, link.assetUid, { limit: PAGE_SIZE, start: i * PAGE_SIZE });
    const r = await safeFetch(url, { headers: { Accept: 'application/json', ...authHeader(token) } });
    if (!r.ok) throw new FetchRefused(r.status === 401 || r.status === 403 ? 'Token Kobo refusé.' : `HTTP ${r.status}`);
    const body = parseJson(r.buffer);
    return { rows: Array.isArray(body) ? body : (body.results || []), next: body.next, hasNextField: !Array.isArray(body) };
  }, { pageSize: PAGE_SIZE });
}

/** Export web : CSV / XLSX, ou JSON paginé par en-tête Link. */
async function pullFile(url, token) {
  const headers = { Accept: 'text/csv, application/json, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*', ...authHeader(token) };
  const first = await safeFetch(url, { headers });
  if (!first.ok) throw new FetchRefused(`HTTP ${first.status}`);
  const ct = String(first.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('json') || /\.json(\?|$)/i.test(url)) {
    const extract = (data) => (Array.isArray(data) ? data
      : (data.results || data.data || (Array.isArray(data.features) ? data.features.map((f) => f.properties || f) : [])));
    let page = first; let pageUrl = url; const records = [];
    for (let i = 0; i < 1000 && page; i += 1) {
      const chunk = extract(parseJson(page.buffer));
      if (!chunk.length) break;
      records.push(...chunk);
      const next = nextFromLink(page.headers.get('link'), pageUrl);
      if (!next || next === pageUrl) break;
      pageUrl = next; page = await safeFetch(next, { headers });
      if (!page.ok) throw new FetchRefused(`HTTP ${page.status}`);
    }
    return { submissions: submissionsFromObjects(records, 'kobo'), pages: 1 };
  }
  const buf = first.buffer;
  const isXlsx = /\.xlsx(\?|$)/i.test(url) || ct.includes('spreadsheet') || (buf[0] === 0x50 && buf[1] === 0x4b);
  const parsed = await parseSubmissions(buf, { filename: isXlsx ? 'data.xlsx' : 'data.csv' });
  return { submissions: parsed.submissions, pages: 1 };
}

/**
 * @param {string} tenantId
 * @param {string} formId
 * @param {{ url: string, token?: string, full?: boolean }} input  full = ignorer le curseur incrémental
 */
async function importFromLink(tenantId, formId, { url, token, full = false }) {
  const ctx = await repo.formSourceContext(tenantId, formId);
  if (!ctx) throw notFound('Formulaire introuvable');
  const link = classifyLink(url);
  if (link.kind === 'invalid') throw badRequest('Lien invalide.');

  let submissions; let pages = 1; let truncated = false; let cursor = null; let gtId = null;
  try {
    if (link.kind === 'ona-open-data') {
      gtId = !full && ctx.sourceKind === 'ona-open-data' && ctx.sourceUrl === url ? ctx.sourceCursor : null;
      const res = await pullOna(link, { gtId });
      submissions = submissionsFromObjects(res.rows.map((r) => normalizeOnaRecord(r, [...ctx.fieldNames, ...KNOWN_FIELDS])), 'ona');
      ({ pages, truncated } = res);
      cursor = maxId(res.rows, gtId);
    } else if (link.kind === 'kobo-api') {
      const res = await pullKobo(link, token);
      submissions = submissionsFromObjects(res.rows, 'kobo');
      ({ pages, truncated } = res);
    } else {
      ({ submissions, pages } = await pullFile(link.url, token));
    }
  } catch (err) {
    if (err.status && err.status < 500 && err.expose !== false && !(err instanceof FetchRefused)) throw err;
    throw badRequest(`Lien de données illisible (${err.message}). Vérifiez le lien${link.kind === 'kobo-api' ? ' et le token' : ''}.`);
  }

  const incremental = gtId != null;
  if (!submissions.length && !incremental) throw badRequest('Aucune soumission trouvée à ce lien.');
  const result = submissions.length ? await repo.importSubmissions(tenantId, formId, submissions) : { received: 0, inserted: 0 };
  await repo.setFormSource(tenantId, formId, url, { kind: link.kind, cursor });
  return { ...result, kind: link.kind, pages, truncated, incremental };
}

module.exports = { importFromLink, nextFromLink };
