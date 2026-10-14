/**
 * Grille « Sites (actifs / inactifs) » (retour n° 64) : lecture, enregistrement
 * journalisé, import du classeur d'activation. Seul ce module écrit le SQL de
 * la grille ; règles dans activationMath (pur). L'état courant est
 * site_month_status (migration 045) ; chaque changement est inscrit, dans la
 * même transaction, au journal site_activation_changes (migration 072).
 */
const { withTenantTransaction } = require('../../config/db');
const { insertRows } = require('../../db/batch');
const { monthStatusesTx } = require('./field.repository');
const { MONTHS, buildSiteIndex, diffActivation, summarizeChanges, cleanReason, identifierOf } = require('./activationMath');

/** Mois du site → « OON-… » (O actif, N inactif, - non renseigné) : 12 caractères au lieu d'un objet. */
const packMonths = (months = {}) => MONTHS.map((m) => (months[m] === true ? 'O' : months[m] === false ? 'N' : '-')).join('');

/**
 * Sites du registre et leur statut par mois pour un exercice, avec le dernier
 * motif de changement. Réponse compacte (mois codés sur 12 caractères).
 */
async function activationGrid(tenantId, { year }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `WITH st AS (
         SELECT site_id, json_object_agg(month, active) AS months
           FROM site_month_status WHERE tenant_id = $1 AND year = $2 GROUP BY site_id),
       lc AS (
         SELECT DISTINCT ON (site_id) site_id, reason, changed_at
           FROM site_activation_changes
          WHERE tenant_id = $1 AND year = $2 AND reason IS NOT NULL
          ORDER BY site_id, changed_at DESC, id)
       SELECT s.id, s.code, s.public_id AS "publicId", s.location_id AS "locationId", s.tag_code AS "tagCode", s.name,
              o.name AS "officeName", o.code AS "officeCode", COALESCE(par.name, o.name) AS bureau,
              s.adm1, s.adm1_pcode AS "adm1Pcode", COALESCE(s.adm2, s.district) AS district, s.adm2_pcode AS "adm2Pcode",
              COALESCE(s.adm3, s.commune) AS commune, s.adm3_pcode AS "adm3Pcode",
              COALESCE(s.adm4, s.fokontany) AS fokontany, s.adm4_pcode AS "adm4Pcode",
              s.activity, s.gps_lat::float8 AS lat, s.gps_lng::float8 AS lng,
              st.months, lc.reason, lc.changed_at AS "reasonAt"
         FROM sites s
         LEFT JOIN field_offices o ON o.id = s.field_office_id
         LEFT JOIN field_offices par ON par.id = o.parent_id
         LEFT JOIN st ON st.site_id = s.id
         LEFT JOIN lc ON lc.site_id = s.id
        WHERE s.tenant_id = $1
        ORDER BY COALESCE(s.adm2, s.district), COALESCE(s.adm3, s.commune), s.name, s.id`,
      [tenantId, year]);
    return { year, rows: rows.map((r) => ({ ...r, ident: identifierOf(r), months: r.months || {} })) };
  });
}

/** Grille compacte pour l'écran (mois sur 12 caractères, sans les colonnes de l'export). */
async function activationGridCompact(tenantId, { year }) {
  const { rows } = await activationGrid(tenantId, { year });
  return {
    year,
    rows: rows.map((r) => ({
      id: r.id, ident: r.ident, publicId: r.publicId, name: r.name, activity: r.activity, bureau: r.bureau, office: r.officeName,
      region: r.adm1, district: r.district, commune: r.commune, fokontany: r.fokontany,
      m: packMonths(r.months), reason: r.reason, reasonAt: r.reasonAt,
    })),
  };
}

/** État courant (mois → actif) des sites, verrouillés dans l'ordre des id (aucun interblocage). */
async function lockedStatusTx(client, tenantId, year, siteIds) {
  const { rows: known } = await client.query(
    'SELECT id FROM sites WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE', [tenantId, siteIds]);
  const { rows } = await client.query(
    'SELECT site_id, month, active FROM site_month_status WHERE tenant_id = $1 AND year = $2 AND site_id = ANY($3::uuid[])',
    [tenantId, year, siteIds]);
  const current = new Map();
  for (const r of rows) {
    if (!current.has(r.site_id)) current.set(r.site_id, {});
    current.get(r.site_id)[r.month] = r.active;
  }
  return { known: new Set(known.map((k) => k.id)), current };
}

/** Applique des écarts (état + journal) dans la transaction appelante. */
async function applyChangesTx(client, tenantId, userId, year, changes, source) {
  if (!changes.length) return;
  await monthStatusesTx(client, tenantId, year, changes.map((c) => ({ siteId: c.siteId, month: c.month, active: c.after })));
  await insertRows(client, {
    table: 'site_activation_changes',
    columns: ['tenant_id', 'site_id', 'year', 'month', 'before', 'after', 'reason', 'source', 'changed_by'],
    rows: changes,
    values: (c) => [tenantId, c.siteId, year, c.month, c.before, c.after, c.reason, source, userId],
  });
}

/**
 * Enregistre des changements saisis à l'écran (tout ou rien).
 * @param {{ year:number, changes:{siteId, month, active:boolean|null}[], reason?:string }} input
 */
async function saveActivation(tenantId, userId, { year, changes, reason }) {
  return withTenantTransaction(tenantId, async (client) => {
    const ids = [...new Set(changes.map((c) => c.siteId))].sort();
    const { known, current } = await lockedStatusTx(client, tenantId, year, ids);
    if (known.size !== ids.length) {
      const e = new Error('Site inconnu (ou hors de ce compte).'); e.code = 'UNKNOWN_SITE'; throw e;
    }
    const why = cleanReason(reason);
    const wanted = new Map();
    for (const c of changes) {
      if (!wanted.has(c.siteId)) wanted.set(c.siteId, { siteId: c.siteId, months: {}, reason: why });
      wanted.get(c.siteId).months[c.month] = c.active;
    }
    const diff = diffActivation(current, [...wanted.values()]);
    await applyChangesTx(client, tenantId, userId, year, diff, 'ecran');
    return summarizeChanges(diff);
  });
}

/**
 * Import du classeur d'activation : rapprochement des lignes, écarts, aperçu ;
 * `commit` applique en une transaction. Les sites viennent du registre : une
 * ligne inconnue n'en crée jamais, elle est listée.
 * @param {{ year:number, rows:Array<{line, ident, codePoi, tagCode, name, months, reason}> }} input
 */
async function importActivation(tenantId, userId, { year, rows }, { commit = false } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: sites } = await client.query(
      'SELECT id, code, public_id AS "publicId", location_id AS "locationId", tag_code AS "tagCode" FROM sites WHERE tenant_id = $1', [tenantId]);
    const index = buildSiteIndex(sites);
    const unknown = []; const ambiguous = []; const duplicates = [];
    const wanted = []; const firstLine = new Map();
    for (const r of rows) {
      const hit = index.resolve(r.ident, { locationId: r.codePoi, tagCode: r.tagCode, publicId: r.publicId });
      if (!hit.siteId) { (hit.ambiguous ? ambiguous : unknown).push({ line: r.line, ident: r.ident, name: r.name || null }); continue; }
      if (firstLine.has(hit.siteId)) { duplicates.push({ line: r.line, ident: r.ident, firstLine: firstLine.get(hit.siteId) }); continue; }
      firstLine.set(hit.siteId, r.line);
      wanted.push({ siteId: hit.siteId, months: r.months, reason: r.reason });
    }
    const ids = wanted.map((w) => w.siteId).sort();
    const { current } = commit
      ? await lockedStatusTx(client, tenantId, year, ids)
      : await (async () => {
        const { rows: st } = await client.query(
          'SELECT site_id, month, active FROM site_month_status WHERE tenant_id = $1 AND year = $2 AND site_id = ANY($3::uuid[])',
          [tenantId, year, ids]);
        const cur = new Map();
        for (const s of st) { if (!cur.has(s.site_id)) cur.set(s.site_id, {}); cur.get(s.site_id)[s.month] = s.active; }
        return { current: cur };
      })();
    const diff = diffActivation(current, wanted);
    if (commit) await applyChangesTx(client, tenantId, userId, year, diff, 'import');
    return {
      year, committed: commit, rows: rows.length, matched: wanted.length,
      unknownCount: unknown.length, unknown: unknown.slice(0, 200),
      ambiguousCount: ambiguous.length, ambiguous: ambiguous.slice(0, 200),
      duplicateCount: duplicates.length, duplicates: duplicates.slice(0, 200),
      ...summarizeChanges(diff),
    };
  });
}

/** Journal d'un site sur un exercice (le plus récent d'abord). */
async function activationHistory(tenantId, { siteId, year }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT c.month, c.before, c.after, c.reason, c.source, c.changed_at AS "changedAt", u.email AS "changedBy"
         FROM site_activation_changes c LEFT JOIN users u ON u.id = c.changed_by
        WHERE c.tenant_id = $1 AND c.site_id = $2 AND c.year = $3
        ORDER BY c.changed_at DESC, c.month LIMIT 300`, [tenantId, siteId, year]);
    return rows;
  });
}

module.exports = { activationGrid, activationGridCompact, saveActivation, importActivation, activationHistory, packMonths };
