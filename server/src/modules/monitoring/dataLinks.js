/**
 * Connecteurs « lien de données » — logique PURE (testée, sans I/O).
 *
 * Un utilisateur colle UN lien ; on reconnaît sa nature :
 *  - « ona-open-data » : lien Tableau Web Data Connector d'Ona / MoDA
 *    (…/tableau-web-data-connector/<uuid>) ou API open-data
 *    (…/api/v2/open-data/<uuid>[/data|/schema]). La page WDC n'est qu'une
 *    coquille HTML/JS : les données viennent de GET /api/v2/open-data/<uuid>/data
 *    (JSON, public — l'uuid fait office de clé), pagination page/page_size,
 *    filtre gt_id (rafraîchissement incrémental). Réf. : onadata OpenDataViewSet.
 *  - « kobo-api » : API KoboToolbox v2 (…/api/v2/assets/<uid>/data[.json]) ou
 *    lien d'interface (…/#/forms/<uid>/…) — token requis, pagination limit/start
 *    + champ « next ».
 *  - « file » : tout autre lien (export CSV / XLSX / JSON).
 */
const UUID = '[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function classifyLink(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return { kind: 'invalid' }; }
  const path = decodeURIComponent(u.pathname);
  let m = path.match(new RegExp(`/tableau-web-data-connector/(${UUID})`, 'i'))
    || path.match(new RegExp(`/api/v[12]/open-data/(${UUID})`, 'i'));
  if (m) return { kind: 'ona-open-data', origin: u.origin, uuid: m[1].toLowerCase().replace(/-/g, '') };
  const q = u.searchParams.get('uuid');
  if (q && new RegExp(`^(${UUID})$`, 'i').test(q) && /tableau|open-?data/i.test(path)) {
    return { kind: 'ona-open-data', origin: u.origin, uuid: q.toLowerCase().replace(/-/g, '') };
  }
  m = path.match(/\/api\/v2\/assets\/([A-Za-z0-9]{10,40})(?:\/data(?:\.json)?)?\/?$/) || `${u.hash}`.match(/#\/forms\/([A-Za-z0-9]{10,40})/);
  if (m) return { kind: 'kobo-api', origin: u.origin, assetUid: m[1] };
  return { kind: 'file', url: u.href };
}

/** URL d'API candidates : même hôte, puis sous-domaine api. (MoDA/Ona séparent parfois l'API). */
function onaApiOrigins(origin) {
  const u = new URL(origin);
  const out = [u.origin];
  if (!u.hostname.startsWith('api.')) out.push(`${u.protocol}//api.${u.hostname.replace(/^www\./, '')}${u.port ? `:${u.port}` : ''}`);
  return out;
}

function onaDataUrl(apiOrigin, uuid, { page, pageSize, gtId } = {}) {
  const u = new URL(`/api/v2/open-data/${uuid}/data`, apiOrigin);
  if (gtId != null) u.searchParams.set('gt_id', String(gtId));
  if (page != null) { u.searchParams.set('page', String(page)); u.searchParams.set('page_size', String(pageSize || 1000)); }
  return u.href;
}

function koboDataUrl(origin, assetUid, { limit = 1000, start = 0 } = {}) {
  const u = new URL(`/api/v2/assets/${assetUid}/data.json`, origin);
  u.searchParams.set('limit', String(limit)); u.searchParams.set('start', String(start));
  return u.href;
}

/**
 * Parcourt des pages jusqu'à épuisement. `fetchPage(i)` renvoie { rows, next? }.
 * S'arrête sur page vide, page incomplète (< pageSize), absence de « next »
 * quand le serveur en fournit, ou le plafond de pages (jamais de boucle infinie).
 * @returns {Promise<{ rows: object[], pages: number, truncated: boolean }>}
 */
async function collectPages(fetchPage, { pageSize = 1000, maxPages = 1000 } = {}) {
  const rows = [];
  for (let i = 0; i < maxPages; i += 1) {
    const { rows: chunk = [], next, hasNextField } = await fetchPage(i);
    rows.push(...chunk);
    if (!chunk.length) return { rows, pages: i + 1, truncated: false };
    if (hasNextField ? !next : chunk.length < pageSize) return { rows, pages: i + 1, truncated: false };
  }
  return { rows, pages: maxPages, truncated: true };
}

/**
 * Ona open-data renomme les champs (« groupe/question » → « groupe_question »).
 * On retrouve le nom XLSForm grâce au catalogue de la fiche : un champ dont la
 * clé est le nom du catalogue, ou se termine par « _<nom> » (le plus long gagne).
 * Les répétitions (tableaux imbriqués) sont conservées telles quelles.
 */
function normalizeOnaRecord(rec, catalogNames = []) {
  if (!catalogNames.length) return rec;
  const names = [...catalogNames].sort((a, b) => b.length - a.length);
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_') || names.includes(k)) { out[k] = v; continue; }
    const hit = names.find((n) => k.endsWith(`_${n}`));
    const key = hit || k;
    if (!(key in out)) out[key] = v;
  }
  return out;
}

/** Plus grand _id rencontré (curseur du rafraîchissement incrémental). */
function maxId(rows, current = null) {
  let m = current == null ? null : Number(current);
  for (const r of rows) { const id = Number(r && r._id); if (Number.isFinite(id) && (m == null || id > m)) m = id; }
  return m;
}

module.exports = { classifyLink, onaApiOrigins, onaDataUrl, koboDataUrl, collectPages, normalizeOnaRecord, maxId };
