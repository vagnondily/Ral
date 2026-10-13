const { withTenantTransaction } = require('../../config/db');
const { insertRows } = require('../../db/batch');
const { notFound, forbidden, badRequest } = require('../../middleware/errors');
const { computeAll, overallIndex } = require('./monitoringMath');
const { classDistribution, dimGroups, topFlop, classify } = require('./coverageDashboard');
const { detectMapping, DIMENSION_COLUMN, EDITABLE_KEYS } = require('./memsMapping');
const { computeCalcFields, checkExpression, previewCalc, makeGetter } = require('./calcFields');
const { buildLookup, groupPathRenamer, TRIM_CLASS } = require('./submissionsImport');
const { templateForActivity, moduleLabel, suggestBindings, indicatorFromItem } = require('./indicatorTemplates');
const { OTHER_VALUES } = require('./memsMapping');
const { applySubmissionsGeoTx, applySubmissionSitesTx, officeChoiceLabelsTx, choiceLabelsTx, loadPartiesTx, lockSubmissionLinksTx } = require('../settings/placeMatch.repository');
const { resolvePartner, resolveAgent } = require('../common/partyMatch');

/** Charge les champs calculés d'une fiche (ordre), pour l'analyse et la grille. */
async function calcDefsFor(client, tenantId, formId) {
  const { rows } = await client.query(
    `SELECT name, label, kind, expression, source_field AS "sourceField", mapping, default_value AS "defaultValue", sort_order
       FROM monitoring_calc_fields WHERE tenant_id = $1 AND form_id = $2 ORDER BY sort_order, name`,
    [tenantId, formId]
  );
  return rows;
}
/** Fusionne les champs calculés dans le `data` de chaque soumission (pour l'agrégation). */
function withCalc(subs, defs) {
  if (!defs || !defs.length) return subs;
  return subs.map((s) => ({ ...s, data: { ...s.data, ...computeCalcFields(defs, s.data || {}) } }));
}

/**
 * Suivi de processus — data access. Forms + configurable indicators (the
 * mapping) + real submissions. Everything tenant-scoped and inside a tenant
 * transaction so RLS applies.
 */

const num = (v) => (v == null ? v : Number(v));

// ---- Forms ---------------------------------------------------------------
async function listForms(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT f.id, f.code, f.label, f.active, f.activity_category AS "activityCategory", f.updated_at AS "updatedAt",
              f.source_url AS "sourceUrl", f.source_kind AS "sourceKind",
              f.source_cursor::float8 AS "sourceCursor", f.source_synced_at AS "sourceSyncedAt",
              COALESCE((SELECT count(*) FROM monitoring_indicators i WHERE i.form_id = f.id), 0)::int AS "indicatorCount",
              COALESCE((SELECT count(*) FROM monitoring_submissions s WHERE s.form_id = f.id), 0)::int AS "submissionCount"
         FROM monitoring_forms f WHERE f.tenant_id = $1 ORDER BY f.label`,
      [tenantId]
    );
    return rows;
  });
}

/** Mémorise le lien de données d'une fiche, sa nature et le curseur incrémental. */
async function setFormSource(tenantId, formId, url, { kind = null, cursor = null } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query(
      `UPDATE monitoring_forms SET source_url = $3, source_kind = $4, source_cursor = $5, source_synced_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, formId, url || null, kind, cursor]);
  });
}

/** Source mémorisée + noms des champs du catalogue (pour normaliser les clés Ona). */
async function formSourceContext(tenantId, formId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT f.source_url AS "sourceUrl", f.source_kind AS "sourceKind", f.source_cursor::float8 AS "sourceCursor",
              COALESCE((SELECT array_agg(ff.name) FROM monitoring_form_fields ff WHERE ff.tenant_id = f.tenant_id AND ff.form_id = f.id), '{}') AS "fieldNames"
         FROM monitoring_forms f WHERE f.tenant_id = $1 AND f.id = $2`, [tenantId, formId]);
    return rows[0] || null;
  });
}

async function createForm(tenantId, { code, label }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO monitoring_forms (tenant_id, code, label) VALUES ($1,$2,$3) RETURNING id`,
      [tenantId, code, label]
    );
    return rows[0].id;
  });
}

/**
 * `activityCategory` : rattachement de la fiche à une activité du MMR (libellé
 * canonique, déjà contrôlé par l'appelant) — il relie la fiche aux sites, à la
 * couverture et au plan de suivi. `undefined` = inchangé, `null` = détacher.
 */
async function updateForm(tenantId, id, { label, active, activityCategory }) {
  return withTenantTransaction(tenantId, async (client) => {
    if (activityCategory !== undefined) await lockSubmissionLinksTx(client, tenantId);
    const { rowCount } = await client.query(
      `UPDATE monitoring_forms SET label = COALESCE($3, label), active = COALESCE($4, active),
              activity_category = CASE WHEN $5::boolean THEN $6 ELSE activity_category END, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, label ?? null, active ?? null, activityCategory !== undefined, activityCategory ?? null]
    );
    // L'activité de la fiche délimite les sites candidats : les formulaires reçus sont reliés à nouveau.
    if (rowCount === 1 && activityCategory !== undefined) await applySubmissionSitesTx(client, tenantId);
    return rowCount === 1;
  });
}

/**
 * Suppression d'une fiche (variables, choix, indicateurs et soumissions suivent
 * par cascade). Une fiche SANS données se supprime librement ; une fiche AVEC
 * données exige un administrateur qui ressaisit son code — sinon on la désactive.
 */
async function deleteForm(tenantId, id, { isAdmin = false, confirm = null } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT f.code, (SELECT count(*) FROM monitoring_submissions s WHERE s.form_id = f.id)::int AS n
         FROM monitoring_forms f WHERE f.tenant_id = $1 AND f.id = $2 FOR UPDATE`, [tenantId, id]);
    if (!rows.length) throw notFound('Fiche introuvable');
    const { code, n } = rows[0];
    if (n > 0 && !isAdmin) throw forbidden(`Cette fiche contient ${n} soumission(s) : désactivez-la, ou demandez à un administrateur de la supprimer.`);
    if (n > 0 && confirm !== code) throw badRequest(`Pour supprimer une fiche et ses ${n} soumission(s), ressaisissez son code « ${code} ».`);
    await client.query('DELETE FROM monitoring_forms WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return { deleted: 1, submissions: n };
  });
}

// ---- Indicators (the configurable mapping) -------------------------------
function castIndicator(r) {
  return { ...r, target: num(r.target) };
}

async function listIndicators(tenantId, formId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, form_id AS "formId", code, label, module, source_field AS "sourceField",
              agg, positive_value AS "positiveValue", target, direction, sort_order AS "sortOrder", active,
              na_values AS "naValues", scored, template_code AS "templateCode"
         FROM monitoring_indicators WHERE tenant_id = $1 AND form_id = $2
        ORDER BY sort_order, label`,
      [tenantId, formId]
    );
    return rows.map(castIndicator);
  });
}

async function createIndicator(tenantId, formId, ind) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO monitoring_indicators
         (tenant_id, form_id, code, label, module, source_field, agg, positive_value, target, direction, sort_order, active,
          na_values, scored)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,true),COALESCE($13,'{}'::text[]),COALESCE($14,true)) RETURNING id`,
      [tenantId, formId, ind.code, ind.label, ind.module || null, ind.sourceField, ind.agg || 'percent_yes',
        ind.positiveValue || null, ind.target ?? null, ind.direction || 'higher_better', ind.sortOrder ?? 0, ind.active,
        ind.naValues ?? null, ind.scored ?? null]
    );
    return rows[0].id;
  });
}

async function updateIndicator(tenantId, id, ind) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE monitoring_indicators SET
         label = COALESCE($3,label), module = $4, source_field = COALESCE($5,source_field),
         agg = COALESCE($6,agg), positive_value = $7, target = $8,
         direction = COALESCE($9,direction), sort_order = COALESCE($10,sort_order), active = COALESCE($11,active),
         na_values = COALESCE($12,na_values), scored = COALESCE($13,scored)
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, ind.label ?? null, ind.module ?? null, ind.sourceField ?? null, ind.agg ?? null,
        ind.positiveValue ?? null, ind.target ?? null, ind.direction ?? null, ind.sortOrder ?? null, ind.active ?? null,
        ind.naValues ?? null, ind.scored ?? null]
    );
    return rowCount === 1;
  });
}

// ---- Modèle d'indicateurs de l'activité (retour n° 12) -------------------------------
/**
 * Variables de la fiche pour la liaison au modèle : catalogue XLSForm (libellé,
 * liste de choix courte) + colonnes vues dans les données importées (variables
 * du .sav absentes du XLSForm, colonnes éclatées des choix multiples).
 */
async function bindingFieldsTx(client, tenantId, formId) {
  const { rows: cat } = await client.query(
    `SELECT name, label, type, list_name AS "listName" FROM monitoring_form_fields
      WHERE tenant_id = $1 AND form_id = $2 ORDER BY sort_order, name`, [tenantId, formId]);
  const { rows: keys } = await client.query(
    'SELECT DISTINCT jsonb_object_keys(data) AS name FROM monitoring_submissions WHERE tenant_id = $1 AND form_id = $2 ORDER BY 1',
    [tenantId, formId]);
  const lists = [...new Set(cat.map((f) => f.listName).filter(Boolean))];
  const { rows: choices } = lists.length ? await client.query(
    `SELECT list_name AS "listName", value, label FROM monitoring_choices
      WHERE tenant_id = $1 AND form_id = $2 AND list_name = ANY($3::text[]) ORDER BY list_name, sort_order`,
    [tenantId, formId, lists]) : { rows: [] };
  const byList = new Map();
  for (const c of choices) { if (!byList.has(c.listName)) byList.set(c.listName, []); byList.get(c.listName).push({ value: String(c.value), label: c.label }); }
  const seen = new Set(cat.map((f) => f.name.toLowerCase()));
  return [
    // Listes longues (lieux, écoles) inutiles pour choisir une valeur positive : non envoyées.
    ...cat.map((f) => ({ name: f.name, label: f.label, type: f.type || null, choices: (byList.get(f.listName) || []).length <= 40 ? byList.get(f.listName) || [] : [] })),
    ...keys.filter((k) => !seen.has(k.name.toLowerCase())).map((k) => ({ name: k.name, label: null, type: null, choices: [] })),
  ];
}

/**
 * Variables d'une fiche pour l'éditeur de formule : catalogue (XLSForm ou SPSS,
 * avec libellés, type et choix) + colonnes présentes dans les données, et les
 * champs calculés déjà définis. null si la fiche n'existe pas.
 */
async function formVariables(tenantId, formId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: f } = await client.query('SELECT id FROM monitoring_forms WHERE tenant_id = $1 AND id = $2', [tenantId, formId]);
    if (!f[0]) return null;
    const fields = await bindingFieldsTx(client, tenantId, formId);
    const { rows: calc } = await client.query(
      'SELECT id, name, label FROM monitoring_calc_fields WHERE tenant_id = $1 AND form_id = $2 ORDER BY sort_order, name', [tenantId, formId]);
    return { fields, calcFields: calc };
  });
}

/** Modèle de l'activité de la fiche, avec la variable proposée pour chaque indicateur. */
async function formTemplate(tenantId, formId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: [form] } = await client.query(
      'SELECT id, code, label, activity_category AS "activityCategory" FROM monitoring_forms WHERE tenant_id = $1 AND id = $2',
      [tenantId, formId]);
    if (!form) return null;
    const tpl = templateForActivity(form.activityCategory);
    if (!tpl) return { form, template: null, fields: [] };
    const fields = await bindingFieldsTx(client, tenantId, formId);
    const suggestions = suggestBindings(tpl, fields);
    const { rows: existing } = await client.query(
      `SELECT code, source_field AS "sourceField", positive_value AS "positiveValue" FROM monitoring_indicators
        WHERE tenant_id = $1 AND form_id = $2 AND template_code IS NOT NULL`, [tenantId, formId]);
    const done = new Map(existing.map((e) => [e.code, e]));
    return {
      form,
      template: {
        key: tpl.key, label: tpl.label, domains: tpl.domains,
        items: tpl.items.map((it, i) => ({ ...it, module: moduleLabel(tpl, it.domain), suggestion: suggestions[i], existing: done.get(it.code) || null })),
      },
      fields: fields.map((f) => ({ name: f.name, label: f.label, choices: f.choices })),
    };
  });
}

/**
 * Crée (ou met à jour) les indicateurs du modèle choisis par l'utilisateur, en
 * une transaction et une écriture groupée. Chaque élément doit appartenir au
 * modèle de l'activité de la fiche et viser une variable qui existe dans la
 * fiche (XLSForm ou données) ; sinon rien n'est écrit (400).
 */
async function applyTemplate(tenantId, formId, bindings) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: [form] } = await client.query(
      'SELECT id, activity_category AS "activityCategory" FROM monitoring_forms WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [tenantId, formId]);
    if (!form) return null;
    const tpl = templateForActivity(form.activityCategory);
    if (!tpl) throw badRequest('Cette fiche n\'est rattachée à aucune activité qui a un modèle d\'indicateurs.');
    const items = new Map(tpl.items.map((it, i) => [it.code, { it, i }]));
    const names = new Set((await bindingFieldsTx(client, tenantId, formId)).map((f) => f.name));
    const codes = bindings.map((b) => b.code);
    if (new Set(codes).size !== codes.length) throw badRequest('Un même indicateur est envoyé deux fois.');
    const unknownCode = bindings.find((b) => !items.has(b.code));
    if (unknownCode) throw badRequest(`Indicateur « ${unknownCode.code} » absent du modèle « ${tpl.label} ».`);
    const unknownField = bindings.find((b) => !names.has(b.sourceField));
    if (unknownField) throw badRequest(`Variable « ${unknownField.sourceField} » introuvable dans cette fiche.`);
    const rows = bindings.map((b) => {
      const { it, i } = items.get(b.code);
      return indicatorFromItem(tpl, it, { sourceField: b.sourceField, positiveValue: b.positiveValue }, i);
    });
    const applied = await insertRows(client, {
      table: 'monitoring_indicators',
      columns: ['tenant_id', 'form_id', 'code', 'label', 'module', 'source_field', 'agg', 'positive_value', 'direction', 'na_values', 'scored', 'template_code', 'sort_order'],
      rows,
      values: (r) => [tenantId, formId, r.code, r.label, r.module, r.sourceField, r.agg, r.positiveValue, r.direction, r.naValues, r.scored, r.templateCode, r.sortOrder],
      suffix: `ON CONFLICT (form_id, code) DO UPDATE SET label = EXCLUDED.label, module = EXCLUDED.module,
        source_field = EXCLUDED.source_field, agg = EXCLUDED.agg, positive_value = EXCLUDED.positive_value,
        direction = EXCLUDED.direction, na_values = EXCLUDED.na_values, scored = EXCLUDED.scored,
        template_code = EXCLUDED.template_code, sort_order = EXCLUDED.sort_order, active = true`,
    });
    await client.query('UPDATE monitoring_forms SET updated_at = now() WHERE tenant_id = $1 AND id = $2', [tenantId, formId]);
    return { applied, template: tpl.key };
  });
}

async function deleteIndicator(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM monitoring_indicators WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rowCount === 1;
  });
}

// ---- Submissions ---------------------------------------------------------
/** Distinct answer fields seen in recent submissions — feeds the mapping UI. */
async function formFields(tenantId, formId) {
  return withTenantTransaction(tenantId, async (client) => {
    // Catalogue importé (XLSForm) d'abord, puis clés dérivées des soumissions.
    const { rows: cat } = await client.query(
      'SELECT name, label, type, group_path AS "group" FROM monitoring_form_fields WHERE tenant_id = $1 AND form_id = $2 ORDER BY sort_order, name',
      [tenantId, formId]
    );
    const { rows: keys } = await client.query(
      `SELECT DISTINCT k AS field
         FROM (SELECT jsonb_object_keys(data) AS k
                 FROM monitoring_submissions
                WHERE tenant_id = $1 AND form_id = $2
                ORDER BY created_at DESC LIMIT 500) t
        ORDER BY field`,
      [tenantId, formId]
    );
    const seen = new Set(cat.map((c) => c.name));
    const extra = keys.map((r) => r.field).filter((f) => !seen.has(f)).map((f) => ({ name: f, label: f, type: null, group: null, derived: true }));
    // Rétro-compatible : liste de chaînes + détail enrichi.
    const all = [...cat.map((c) => ({ ...c, derived: false })), ...extra];
    return all.map((f) => f.name);
  });
}

/** Catalogue détaillé (champs + listes de choix) d'une fiche, pour l'UI. */
async function formCatalog(tenantId, formId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: fields } = await client.query(
      'SELECT name, label, type, group_path AS "group", list_name AS "listName", relevant, required FROM monitoring_form_fields WHERE tenant_id = $1 AND form_id = $2 ORDER BY sort_order, name',
      [tenantId, formId]
    );
    const { rows: choices } = await client.query(
      'SELECT list_name AS "listName", value, label FROM monitoring_choices WHERE tenant_id = $1 AND form_id = $2 ORDER BY list_name, sort_order',
      [tenantId, formId]
    );
    return { fields, choices };
  });
}

// Noms de district et de commune d'une soumission géocodée par pcode : le découpage
// (Paramétrage › Localités) d'abord, sinon le référentiel de sites (même pcode).
const PLACE_NAMES = `
              COALESCE((SELECT a.name FROM admin_areas a WHERE a.tenant_id = ms.tenant_id AND a.pcode = ms.admin2 LIMIT 1),
                       (SELECT s.district FROM sites s WHERE s.tenant_id = ms.tenant_id AND s.adm2_pcode = ms.admin2 LIMIT 1)) AS "districtName",
              COALESCE((SELECT a.name FROM admin_areas a WHERE a.tenant_id = ms.tenant_id AND a.pcode = COALESCE(ms.adm3_pcode, ms.admin3) LIMIT 1),
                       (SELECT s.commune FROM sites s WHERE s.tenant_id = ms.tenant_id AND s.adm3_pcode IS NOT NULL
                           AND s.adm3_pcode = COALESCE(ms.adm3_pcode, ms.admin3) LIMIT 1)) AS "communeName",
              (SELECT st.name FROM sites st WHERE st.tenant_id = ms.tenant_id AND st.id = ms.site_id) AS "siteName",
              ms.site_status AS "siteStatus",
              (SELECT o.name FROM field_offices o WHERE o.tenant_id = ms.tenant_id AND o.id = ms.field_office_id) AS "officeName"`;

// Région en clair d'une soumission : par le code de commune rattaché (découpage
// officiel d'abord, registre de sites en repli), sinon par un code de région
// (admin1 = MG51), sinon la valeur brute. Une région = un libellé.
const REGION_CTE = `WITH pcode_region AS (
         SELECT DISTINCT ON (pcode) pcode, region FROM (
           SELECT c.pcode, r.name AS region, 0 AS src FROM admin_areas c JOIN admin_areas r ON r.id = c.lineage[1]
            WHERE c.tenant_id = $1 AND c.pcode IS NOT NULL AND cardinality(c.lineage) >= 1
           UNION ALL
           SELECT r.pcode, r.name, 0 FROM admin_areas r WHERE r.tenant_id = $1 AND r.depth = 1 AND r.pcode IS NOT NULL
           UNION ALL
           SELECT adm3_pcode, adm1, 1 FROM sites WHERE tenant_id = $1 AND adm3_pcode IS NOT NULL AND NULLIF(adm1, '') IS NOT NULL
         ) x ORDER BY pcode, src)`;
const REGION_JOIN = (a) => `LEFT JOIN pcode_region pr ON pr.pcode = COALESCE(${a}.adm3_pcode, ${a}.admin3)
         LEFT JOIN pcode_region pr1 ON pr1.pcode = upper(btrim(${a}.admin1))`;
const REGION_OF = (a) => `COALESCE(pr.region, pr1.region, NULLIF(${a}.admin1, ''), '(non renseigné)')`;

/**
 * Soumissions brutes d'une fiche (données importées), pour la visualisation :
 * champs typés (date, bureau, zones, site, partenaire, agent) + réponses brutes
 * (JSONB). Bornée par `limit`, filtrable par mois. Nom de commune résolu depuis
 * le référentiel de sites (même pcode adm3) comme ailleurs.
 */
async function formSubmissions(tenantId, formId, { month, limit = 200 } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId, formId];
    const where = ['ms.tenant_id = $1', 'ms.form_id = $2'];
    if (month) { params.push(`${String(month).slice(0, 7)}-01`); where.push(`ms.period_month = $${params.length}`); }
    params.push(Math.min(Math.max(Number(limit) || 200, 1), 2000));
    const { rows } = await client.query(
      `SELECT ms.id, ms.external_id AS "externalId", to_char(ms.period_month, 'YYYY-MM') AS "periodMonth",
              ms.submitted_at AS "submittedAt", ms.field_office AS "fieldOffice",
              ms.admin1, ms.admin2, ms.admin3, ms.admin4, ms.site, ms.partner, ms.agent, ms.source, ms.data,
              ms.excluded, ms.exclude_reason AS "excludeReason",
              ${PLACE_NAMES}
         FROM monitoring_submissions ms
        WHERE ${where.join(' AND ')}
        ORDER BY ms.submitted_at DESC NULLS LAST, ms.period_month DESC
        LIMIT $${params.length}`,
      params
    );
    // Codes → libellés (« 6 » → « Ambovombe ») des colonnes typées, d'après les listes de la fiche.
    // Une requête à la fois sur le client de la transaction (pg ne les parallélise pas).
    const labelMaps = {};
    for (const dim of ['field_office', 'partner', 'agent', 'site']) {
      labelMaps[dim] = ((await choiceLabelsTx(client, tenantId, dim)).get(formId)) || new Map();
    }
    for (const r of rows) {
      r.fieldOfficeLabel = (r.fieldOffice != null && labelMaps.field_office.get(String(r.fieldOffice))) || null;
      r.partnerLabel = (r.partner != null && labelMaps.partner.get(String(r.partner))) || null;
      r.agentLabel = (r.agent != null && labelMaps.agent.get(String(r.agent))) || null;
      r.siteLabel = (r.site != null && labelMaps.site.get(String(r.site))) || null;
    }
    const { rows: cnt } = await client.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE excluded)::int AS excluded
         FROM monitoring_submissions ms WHERE ${where.slice(0, month ? 3 : 2).join(' AND ')}`,
      params.slice(0, month ? 3 : 2)
    );
    // Champs calculés : fusionnés dans le `data` renvoyé (colonnes de la grille).
    const calcFields = await calcDefsFor(client, tenantId, formId);
    const outRows = calcFields.length
      ? rows.map((r) => ({ ...r, data: { ...r.data, ...computeCalcFields(calcFields, r.data || {}) } }))
      : rows;
    return { rows: outRows, total: cnt[0]?.total ?? rows.length, excluded: cnt[0]?.excluded ?? 0, limit: params[params.length - 1], calcFields };
  });
}

/** Listes de choix d'une fiche, insérées par lots. */
function insertChoices(client, tenantId, formId, choices) {
  return insertRows(client, {
    table: 'monitoring_choices', columns: ['tenant_id', 'form_id', 'list_name', 'value', 'label', 'sort_order'],
    rows: choices, values: (c) => [tenantId, formId, c.listName, c.value, c.label, c.sort],
  });
}

/**
 * Enrichit le catalogue d'une fiche depuis les variables d'un .sav (SPSS) :
 * name + label de variable, et étiquettes de valeurs → listes de choix.
 * - Sans catalogue : nomme les colonnes à partir des labels du .sav.
 * - Avec un catalogue XLSForm : le XLSForm reste la source de vérité, mais une
 *   variable codée que le XLSForm ne décrit pas par une liste (ex. le bureau
 *   « field_office », simple texte dans le formulaire, exporté 1…10 par Kobo)
 *   reçoit les étiquettes du .sav dans une liste « sav:<variable> » : « 6 » se
 *   lit alors « Ambovombe » partout (tableaux de bord, rattachement du bureau).
 * Batché, idempotent (les listes « sav: » sont remplacées à chaque import).
 */
async function ensureCatalogFromSav(tenantId, formId, variables) {
  if (!variables || !variables.length) return { added: 0 };
  return withTenantTransaction(tenantId, (client) => ensureCatalogFromSavTx(client, tenantId, formId, variables));
}

async function ensureCatalogFromSavTx(client, tenantId, formId, variables) {
  const { rows: existing } = await client.query(
    'SELECT name, list_name AS "listName", sort_order AS "sort" FROM monitoring_form_fields WHERE tenant_id = $1 AND form_id = $2',
    [tenantId, formId]
  );
  const withLabels = variables.filter((v) => v && v.name);
  const coded = (v) => Array.isArray(v.valueLabels) && v.valueLabels.length > 0;
  const choicesOf = (v, listName) => v.valueLabels.map((x, i) => ({ listName, value: x.value, label: x.label || x.value, sort: i }));

  if (existing.length === 0) {
    if (withLabels.length) {
      await insertRows(client, {
        table: 'monitoring_form_fields', columns: ['tenant_id', 'form_id', 'name', 'type', 'label', 'group_path', 'list_name', 'sort_order'],
        rows: withLabels.map((v, i) => ({ v, i })), suffix: 'ON CONFLICT (form_id, name) DO NOTHING',
        values: ({ v, i }) => [tenantId, formId, v.name, v.type || null, v.label || v.name, null, coded(v) ? v.name : null, i],
      });
    }
    const flat = withLabels.filter(coded).flatMap((v) => choicesOf(v, v.name));
    if (flat.length) await insertChoices(client, tenantId, formId, flat);
    return { added: withLabels.length };
  }

  // Catalogue XLSForm présent : compléter seulement les variables codées sans liste XLSForm.
  const byName = new Map(existing.map((f) => [f.name.toLowerCase(), f]));
  let nextSort = Math.max(0, ...existing.map((f) => f.sort || 0)) + 1;
  const relink = []; const added = []; const flat = [];
  for (const v of withLabels.filter(coded)) {
    const field = byName.get(v.name.toLowerCase());
    if (field && field.listName && !field.listName.startsWith('sav:')) continue; // liste du XLSForm : prioritaire
    const listName = `sav:${v.name}`;
    if (field) { if (field.listName !== listName) relink.push([field.name, listName]); } else added.push({ v, listName, i: nextSort++ });
    flat.push(...choicesOf(v, listName));
  }
  if (relink.length) {
    await client.query(
      `UPDATE monitoring_form_fields f SET list_name = u.list_name
         FROM unnest($3::text[], $4::text[]) AS u(name, list_name)
        WHERE f.tenant_id = $1 AND f.form_id = $2 AND f.name = u.name`,
      [tenantId, formId, relink.map((r) => r[0]), relink.map((r) => r[1])]
    );
  }
  if (added.length) {
    await insertRows(client, {
      table: 'monitoring_form_fields', columns: ['tenant_id', 'form_id', 'name', 'type', 'label', 'group_path', 'list_name', 'sort_order'],
      rows: added, suffix: 'ON CONFLICT (form_id, name) DO NOTHING',
      values: ({ v, listName, i }) => [tenantId, formId, v.name, v.type || null, v.label || v.name, null, listName, i],
    });
  }
  const lists = [...new Set(flat.map((c) => c.listName))];
  if (lists.length) {
    await client.query('DELETE FROM monitoring_choices WHERE tenant_id = $1 AND form_id = $2 AND list_name = ANY($3::text[])', [tenantId, formId, lists]);
    await insertChoices(client, tenantId, formId, flat);
  }
  return { added: added.length, completed: relink.length + added.length };
}

/**
 * Mapping « formulaire ↔ référentiels MEMS » : quelle colonne du formulaire
 * (catalogue XLSForm + clés vues dans les données) alimente chaque dimension
 * MEMS. Dérivé en direct via la table d'alias partagée (aucun stockage).
 */
async function memsMappingForForm(tenantId, formId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: cat } = await client.query(
      'SELECT name, label FROM monitoring_form_fields WHERE tenant_id = $1 AND form_id = $2 ORDER BY sort_order, name',
      [tenantId, formId]
    );
    const { rows: keys } = await client.query(
      `SELECT DISTINCT jsonb_object_keys(data) AS field
         FROM monitoring_submissions WHERE tenant_id = $1 AND form_id = $2`,
      [tenantId, formId]
    );
    const { rows: ov } = await client.query(
      'SELECT dimension, column_name AS "columnName" FROM monitoring_field_map WHERE tenant_id = $1 AND form_id = $2',
      [tenantId, formId]
    );
    const labelByName = new Map(cat.map((c) => [c.name, c.label]));
    const names = [...new Set([...cat.map((c) => c.name), ...keys.map((k) => k.field)])];
    const overrideByDim = new Map(ov.map((o) => [o.dimension, o.columnName]));
    const auto = new Map(detectMapping(names).map((m) => [m.key, m]));

    const rows = detectMapping(names).map((m) => {
      const hasOverride = overrideByDim.has(m.key);
      const autoColumn = auto.get(m.key)?.column || null;
      const column = hasOverride ? (overrideByDim.get(m.key) || null) : autoColumn;
      return {
        key: m.key, label: m.label, mems: m.mems,
        column, columnLabel: column ? (labelByName.get(column) || null) : null,
        autoColumn, source: hasOverride ? 'manuel' : (autoColumn ? 'auto' : null),
        editable: EDITABLE_KEYS.includes(m.key),
      };
    });
    // Colonnes disponibles pour l'éditeur (catalogue + clés vues dans les données).
    const seen = new Set(cat.map((c) => c.name));
    const columns = [
      ...cat.map((c) => ({ name: c.name, label: c.label || c.name })),
      ...keys.map((k) => k.field).filter((f) => !seen.has(f)).map((f) => ({ name: f, label: f })),
    ];
    return { rows, columns };
  });
}

/** Surcharge (ou efface) le mapping d'une dimension MEMS pour une fiche. */
async function setMemsMapping(tenantId, formId, dimension, columnName) {
  if (!EDITABLE_KEYS.includes(dimension)) return null;
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query('SELECT 1 FROM monitoring_forms WHERE tenant_id = $1 AND id = $2', [tenantId, formId]);
    if (!rows.length) return null;
    const col = columnName && String(columnName).trim() ? String(columnName).trim() : '';
    await client.query(
      `INSERT INTO monitoring_field_map (tenant_id, form_id, dimension, column_name, updated_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (form_id, dimension) DO UPDATE SET column_name = EXCLUDED.column_name, updated_at = now()`,
      [tenantId, formId, dimension, col]
    );
    return { dimension, columnName: col };
  });
}

/** Rétablit la détection automatique pour une dimension (supprime la surcharge). */
async function resetMemsMapping(tenantId, formId, dimension) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM monitoring_field_map WHERE tenant_id = $1 AND form_id = $2 AND dimension = $3',
      [tenantId, formId, dimension]
    );
    return { removed: rowCount };
  });
}

/**
 * Réapplique les surcharges manuelles aux soumissions déjà importées : pour
 * chaque dimension surchargée, recopie `data->>colonne` dans le champ typé
 * (ou NULL si la dimension a été mise « non reliée »). N'affecte pas les
 * dimensions laissées en automatique (valeurs posées à l'import conservées).
 */
async function applyMappingToSubmissions(tenantId, formId) {
  return withTenantTransaction(tenantId, async (client) => {
    await lockSubmissionLinksTx(client, tenantId); // avant de toucher aux soumissions : jamais d'interblocage
    const { overrides, updated } = await reliftSubmissionsTx(client, tenantId, formId);
    // Les colonnes de lieu/bureau/site ont pu changer : rattachement rejoué (même transaction).
    const geo = await applySubmissionsGeoTx(client, tenantId);
    return { applied: overrides, updated, geo };
  });
}

/**
 * Relit les champs typés (bureau, lieux, site, partenaire, agent) d'une fiche
 * depuis les réponses brutes conservées, avec la MÊME règle qu'à l'import
 * (submissionsImport.buildLookup : alias, codes d'abord, première colonne non
 * vide, réponse « autre » remplacée par sa précision) ; une colonne choisie à
 * la main dans « Mapping MEMS » l'emporte ; sinon une valeur connue n'est jamais
 * effacée faute de colonne. Sert après un changement de mapping
 * et quand de nouveaux noms de colonnes sont reconnus (réparation au démarrage).
 * Une seule requête par fiche, valeurs brutes intactes.
 * @returns {{ overrides: number, updated: number }}
 */
async function reliftSubmissionsTx(client, tenantId, formId) {
  const { rows: keyRows } = await client.query(
    'SELECT DISTINCT jsonb_object_keys(data) AS k FROM monitoring_submissions WHERE tenant_id = $1 AND form_id = $2',
    [tenantId, formId]);
  const keys = keyRows.map((r) => r.k);
  const { rows: sample } = await client.query(
    'SELECT data FROM monitoring_submissions WHERE tenant_id = $1 AND form_id = $2 ORDER BY created_at DESC LIMIT 50',
    [tenantId, formId]);
  const picks = buildLookup(keys, sample.map((r) => keys.map((k) => r.data[k])));
  const { rows: ov } = await client.query(
    'SELECT dimension, column_name AS "columnName" FROM monitoring_field_map WHERE tenant_id = $1 AND form_id = $2',
    [tenantId, formId]);
  const forced = new Map(ov.map((o) => [o.dimension, (o.columnName || '').trim()]));
  const params = [tenantId, formId];
  const ref = (value) => { params.push(value); return `$${params.length}`; };
  let otherRef = null; // valeurs « autre » (999…) : paramètre ajouté seulement s'il sert
  const otherValues = () => { otherRef = otherRef || ref([...OTHER_VALUES]); return otherRef; };
  // Même nettoyage que l'import (String.prototype.trim) : espaces insécables compris.
  const trim = (x) => `regexp_replace(${x}, '^[${TRIM_CLASS}]+|[${TRIM_CLASS}]+$', '', 'g')`;
  const cell = (name) => `NULLIF(${trim(`data->>${ref(name)}`)}, '')`;
  // Colonne choisie à la main : nom exact d'abord, puis ses variantes de casse présentes dans les données.
  const forcedCell = (col) => {
    const ks = [col, ...keys.filter((k) => k !== col && k.toLowerCase() === col.toLowerCase())];
    return ks.length > 1 ? `COALESCE(${ks.map(cell).join(', ')})` : cell(col);
  };
  const exprFor = (dimension) => {
    if (forced.has(dimension)) return forced.get(dimension) ? forcedCell(forced.get(dimension)) : 'NULL';
    const cands = (picks.candidates && picks.candidates[dimension]) || [];
    if (!cands.length) return 'NULL';
    const parts = cands.map((i) => {
      const others = (picks.others[dimension] && picks.others[dimension].get(i)) || [];
      const base = cell(keys[i]);
      if (!others.length) return base;
      return `CASE WHEN lower(${trim(`data->>${ref(keys[i])}`)}) = ANY(${otherValues()}::text[]) THEN COALESCE(${others.map((j) => cell(keys[j])).join(', ')}, ${base}) ELSE ${base} END`;
    });
    return parts.length === 1 ? parts[0] : `COALESCE(${parts.join(', ')})`;
  };
  // Une valeur déjà connue n'est jamais remplacée par une absence (lignes saisies autrement, colonne
  // vide dans un autre format d'export) ; seule une colonne choisie à la main s'applique telle quelle.
  const cols = Object.entries(DIMENSION_COLUMN).map(([dimension, col]) => [col,
    forced.has(dimension) ? exprFor(dimension) : `COALESCE(${exprFor(dimension)}, ${col})`]);
  const { rowCount } = await client.query(
    `UPDATE monitoring_submissions SET ${cols.map(([c, e]) => `${c} = ${e}`).join(', ')}
      WHERE tenant_id = $1 AND form_id = $2
        AND (${cols.map(([c, e]) => `${c} IS DISTINCT FROM ${e}`).join(' OR ')})`,
    params);
  return { overrides: ov.length, updated: rowCount };
}

/**
 * Importe la définition d'un XLSForm : crée (ou retrouve par code) la fiche,
 * puis remplace son catalogue de champs et ses listes de choix.
 */
async function importDefinition(tenantId, { code, label }, fields, choicesMap) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: ex } = await client.query('SELECT id FROM monitoring_forms WHERE tenant_id = $1 AND code = $2', [tenantId, code]);
    let formId = ex[0]?.id;
    if (formId) {
      await client.query('UPDATE monitoring_forms SET label = $3, active = true, updated_at = now() WHERE tenant_id = $1 AND id = $2', [tenantId, formId, label]);
    } else {
      const { rows } = await client.query('INSERT INTO monitoring_forms (tenant_id, code, label) VALUES ($1,$2,$3) RETURNING id', [tenantId, code, label]);
      formId = rows[0].id;
    }
    await client.query('DELETE FROM monitoring_form_fields WHERE tenant_id = $1 AND form_id = $2', [tenantId, formId]);
    // Les étiquettes venues des exports SPSS (« sav: ») ne sont pas dans le XLSForm : on les garde.
    await client.query("DELETE FROM monitoring_choices WHERE tenant_id = $1 AND form_id = $2 AND list_name NOT LIKE 'sav:%'", [tenantId, formId]);

    // Instructions multi-lignes par lots (jamais N requêtes en boucle, jamais au-delà
    // de la limite de paramètres de PostgreSQL — un XLSForm peut porter 20 000 choix).
    if (fields.length) {
      await insertRows(client, {
        table: 'monitoring_form_fields', columns: ['tenant_id', 'form_id', 'name', 'type', 'label', 'group_path', 'list_name', 'relevant', 'required', 'sort_order'],
        rows: fields.map((f, i) => ({ f, i })), suffix: 'ON CONFLICT (form_id, name) DO NOTHING',
        values: ({ f, i }) => [tenantId, formId, f.name, f.type || null, f.label || f.name, f.group || null, f.listName || null, f.relevant || null, f.required === true, i],
      });
    }
    let choiceCount = 0;
    const flatChoices = [];
    for (const [listName, opts] of Object.entries(choicesMap || {})) {
      opts.forEach((o, i) => flatChoices.push({ listName, value: o.value, label: o.label || o.value, sort: i }));
    }
    if (flatChoices.length) {
      await insertChoices(client, tenantId, formId, flatChoices);
      choiceCount = flatChoices.length;
    }
    // Champs codés que le XLSForm ne décrit pas par une liste (« field_office » en texte, exporté 1…10) :
    // reliés de nouveau à leurs étiquettes SPSS déjà reçues (« sav:Field_office »), casse ignorée.
    await client.query(
      `UPDATE monitoring_form_fields f SET list_name = c.list_name
         FROM (SELECT DISTINCT list_name FROM monitoring_choices WHERE tenant_id = $1 AND form_id = $2 AND list_name LIKE 'sav:%') c
        WHERE f.tenant_id = $1 AND f.form_id = $2 AND f.list_name IS NULL AND lower('sav:' || f.name) = lower(c.list_name)`,
      [tenantId, formId]);
    return { formId, fields: fields.length, choices: choiceCount };
  });
}

async function importSubmissions(tenantId, formId, submissions, { variables } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    await lockSubmissionLinksTx(client, tenantId); // avant d'écrire les soumissions : jamais d'interblocage
    // Confirm the form belongs to the tenant.
    const { rows: f } = await client.query('SELECT id FROM monitoring_forms WHERE tenant_id = $1 AND id = $2', [tenantId, formId]);
    if (!f[0]) return null;
    // Étiquettes du .sav AVANT le rattachement des bureaux, dans la même transaction :
    // « 6 » est reconnu comme « Ambovombe » dès ce premier import.
    if (variables && variables.length) await ensureCatalogFromSavTx(client, tenantId, formId, variables);

    // Surcharges manuelles de mapping : écrasent la détection par alias, au moment
    // de l'import, à partir des réponses brutes (data) de chaque soumission.
    const SUB_PROP = { field_office: 'fieldOffice', admin1: 'admin1', admin2: 'admin2', admin3: 'admin3', admin4: 'admin4', site: 'site', partner: 'partner', agent: 'agent' };
    const { rows: ov } = await client.query(
      'SELECT dimension, column_name AS "columnName" FROM monitoring_field_map WHERE tenant_id = $1 AND form_id = $2',
      [tenantId, formId]
    );
    // Valeur nettoyée comme à l'import automatique (valueOf) et à la relecture SQL.
    const applyOverrides = (s) => {
      for (const o of ov) {
        const prop = SUB_PROP[o.dimension]; if (!prop) continue;
        const col = (o.columnName || '').trim();
        const v = col && s.data ? makeGetter(s.data)(col) : undefined; // casse ignorée (XLSForm ≠ export SPSS)
        const t = v == null ? '' : String(v).trim();
        s[prop] = t === '' ? null : t;
      }
    };
    // Clés des réponses ramenées aux noms du catalogue (export Excel « avec les groupes ») :
    // les mêmes clés quel que soit le format, donc les mêmes indicateurs.
    const { rows: names } = await client.query(
      'SELECT name FROM monitoring_form_fields WHERE tenant_id = $1 AND form_id = $2', [tenantId, formId]);
    const canonical = groupPathRenamer(names.map((r) => r.name));

    let inserted = 0; let created = 0;
    const months = new Map();
    // Insert row by row so ON CONFLICT dedup (per _uuid) is simple and safe.
    // Même soumission déjà reçue : le MÊME format la remplace (corrections faites dans Kobo) ;
    // un AUTRE format (Excel après SPSS…) la complète sans effacer ce qu'il ne porte pas.
    const merged = (col) => `${col} = CASE WHEN monitoring_submissions.source IS NOT DISTINCT FROM EXCLUDED.source
      THEN EXCLUDED.${col} ELSE COALESCE(EXCLUDED.${col}, monitoring_submissions.${col}) END`;
    const TYPED = ['period_month', 'submitted_at', 'field_office', 'admin1', 'admin2', 'admin3', 'admin4', 'site', 'partner', 'agent'];
    // Même identifiant Kobo deux fois dans le fichier : une seule soumission, la dernière version
    // (sans cela, le compte rendu la compterait « mise à jour » et ses mois deux fois).
    const unique = []; const at = new Map();
    for (const s of submissions) {
      if (s.externalId && at.has(s.externalId)) { unique[at.get(s.externalId)] = s; continue; }
      if (s.externalId) at.set(s.externalId, unique.length);
      unique.push(s);
    }
    for (const s of unique) {
      s.data = canonical(s.data || {});
      if (ov.length) applyOverrides(s);
      const res = await client.query(
        `INSERT INTO monitoring_submissions
           (tenant_id, form_id, external_id, period_month, submitted_at, field_office,
            admin1, admin2, admin3, admin4, site, partner, agent, source, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (form_id, external_id) DO UPDATE SET
           ${TYPED.map(merged).join(',\n           ')},
           data = CASE WHEN monitoring_submissions.source IS NOT DISTINCT FROM EXCLUDED.source
             THEN EXCLUDED.data ELSE monitoring_submissions.data || EXCLUDED.data END,
           source = EXCLUDED.source
         RETURNING (xmax = 0) AS created`,
        [tenantId, formId, s.externalId, s.periodMonth, s.submittedAt, s.fieldOffice,
          s.admin1, s.admin2, s.admin3, s.admin4, s.site, s.partner, s.agent, s.source, JSON.stringify(s.data)]
      );
      inserted += res.rowCount;
      if (res.rows[0] && res.rows[0].created) created += 1;
      if (s.periodMonth) months.set(s.periodMonth, (months.get(s.periodMonth) || 0) + 1);
    }
    // Commune (pcode) et bureau rattachés dans la même transaction que l'import.
    const geo = await applySubmissionsGeoTx(client, tenantId);
    // État de la fiche après import (geo, lui, couvre toutes les fiches du compte).
    const { rows: [state] } = await client.query(
      `SELECT count(*)::int AS total, count(field_office_id)::int AS "withOffice", count(adm3_pcode)::int AS "withCommune",
              count(site_id)::int AS "withSite", count(*) FILTER (WHERE site_status IN ('a_valider', 'ambigu'))::int AS "sitePending"
         FROM monitoring_submissions WHERE tenant_id = $1 AND form_id = $2`, [tenantId, formId]);
    // Compte rendu : nouvelles / déjà présentes (mises à jour), mois couverts.
    return {
      received: submissions.length, duplicates: submissions.length - unique.length, inserted, created, updated: inserted - created, geo, form: state,
      months: [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, n]) => ({ month, n })),
    };
  });
}

// ---- Correspondances des valeurs codées (retour n° 3) -----------------------------------
const CORR = {
  field_office: { raw: 'field_office', target: 'field_office_id', link: 'office_id' },
  partner: { raw: 'partner', target: 'partner_id', link: 'partner_id' },
  agent: { raw: 'agent', target: 'agent_id', link: 'agent_id' },
};

/**
 * Correspondances d'une fiche pour une dimension : chaque valeur reçue (code et
 * libellé), son nombre de soumissions, l'objet MEMS auquel elle est reliée
 * aujourd'hui, la correction manuelle éventuelle et la proposition automatique.
 * @returns {Promise<null|{ rows: object[], options: object[] }>}
 */
async function formCorrespondences(tenantId, formId, dimension) {
  const d = CORR[dimension];
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: f } = await client.query('SELECT id FROM monitoring_forms WHERE tenant_id = $1 AND id = $2', [tenantId, formId]);
    if (!f[0]) return null;
    // Un agent se résout DANS son partenaire : comptes par (valeur, cible, partenaire) pour cette dimension.
    const { rows: counts } = await client.query(
      `SELECT ${d.raw} AS raw, ${d.target} AS tid, ${dimension === 'agent' ? 'partner_id' : 'NULL::uuid'} AS "partnerId", count(*)::int AS n
         FROM monitoring_submissions WHERE tenant_id = $1 AND form_id = $2 AND NULLIF(btrim(${d.raw}), '') IS NOT NULL
        GROUP BY 1, 2, 3`, [tenantId, formId]);
    const { rows: links } = await client.query(
      `SELECT raw_value AS raw, ${d.link} AS "targetId" FROM monitoring_value_links
        WHERE tenant_id = $1 AND form_id = $2 AND dimension = $3`, [tenantId, formId, dimension]);
    const labels = (await choiceLabelsTx(client, tenantId, dimension)).get(formId) || new Map();
    let options;
    let parties = null;
    if (dimension === 'field_office') {
      const { rows } = await client.query('SELECT id, name, active FROM field_offices WHERE tenant_id = $1 ORDER BY name', [tenantId]);
      options = rows;
    } else {
      parties = await loadPartiesTx(client, tenantId);
      const pName = new Map(parties.partners.map((p) => [p.id, p.name]));
      options = dimension === 'partner'
        ? parties.partners.map((p) => ({ id: p.id, name: p.name, active: p.active }))
        : parties.agents.map((a) => ({ id: a.id, name: a.code ? `${a.name} (${a.code})` : a.name, group: pName.get(a.partnerId) || null, active: a.active }));
    }
    const byRaw = new Map();
    for (const c of counts) {
      if (!byRaw.has(c.raw)) byRaw.set(c.raw, { raw: c.raw, n: 0, current: new Map(), partners: new Set() });
      const r = byRaw.get(c.raw);
      r.n += c.n;
      r.current.set(c.tid, (r.current.get(c.tid) || 0) + c.n);
      r.partners.add(c.partnerId);
    }
    const manual = new Map(links.map((l) => [l.raw, l.targetId]));
    const rows = [...byRaw.values()].map((r) => {
      const label = labels.get(r.raw) || null;
      let proposal = null;
      if (dimension === 'partner') {
        const m = resolvePartner(parties.partnerIndex, { raw: r.raw, label });
        proposal = { status: m.status, ids: m.partner ? [m.partner.id] : m.candidates.map((x) => x.id) };
      } else if (dimension === 'agent') {
        // Même résolution que l'application (une par partenaire) ; résultats différents selon le partenaire → « partiel ».
        const per = [...r.partners].map((partnerId) => {
          const m = resolveAgent(parties.agentIndex, { raw: r.raw, label, partnerId });
          return { status: m.status, ids: m.agent ? [m.agent.id] : m.candidates.map((x) => x.id) };
        });
        const same = per.every((x) => x.status === per[0].status && x.ids.join() === per[0].ids.join());
        proposal = same ? per[0] : { status: 'partiel', ids: [] };
      }
      return {
        raw: r.raw, label, n: r.n,
        current: [...r.current].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n),
        manual: manual.has(r.raw) ? { targetId: manual.get(r.raw) } : null,
        proposal,
        // Une correspondance s'enregistre pour une valeur de 200 caractères au plus (contrainte de la table).
        editable: String(r.raw).length <= 200,
      };
    }).sort((a, b) => b.n - a.n || String(a.raw).localeCompare(String(b.raw), 'fr', { numeric: true }));
    return { rows, options };
  });
}

/**
 * Correction d'une correspondance : relier (targetId), « ne pas relier »
 * (targetId null) ou revenir à l'automatique (mode 'auto'), puis réapplication
 * immédiate aux formulaires déjà reçus — dans la même transaction.
 */
async function setCorrespondence(tenantId, userId, formId, { dimension, raw, mode, targetId }) {
  const d = CORR[dimension];
  return withTenantTransaction(tenantId, async (client) => {
    // Avant d'enregistrer la correction : la réapplication voit celles des autres transactions.
    await lockSubmissionLinksTx(client, tenantId);
    const { rows: f } = await client.query('SELECT id FROM monitoring_forms WHERE tenant_id = $1 AND id = $2', [tenantId, formId]);
    if (!f[0]) return null;
    if (mode === 'auto') {
      await client.query('DELETE FROM monitoring_value_links WHERE tenant_id = $1 AND form_id = $2 AND dimension = $3 AND raw_value = $4',
        [tenantId, formId, dimension, raw]);
    } else {
      // La cible doit appartenir au compte (la contrainte « même client » le garantit aussi en base).
      if (mode === 'link') {
        const table = { field_office: 'field_offices', partner: 'partners', agent: 'tpm_agents' }[dimension];
        const { rows } = await client.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, targetId]);
        if (!rows[0]) throw badRequest('Élément MEMS introuvable.');
      }
      await client.query(
        `INSERT INTO monitoring_value_links (tenant_id, form_id, dimension, raw_value, ${d.link}, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, form_id, dimension, raw_value)
         DO UPDATE SET office_id = EXCLUDED.office_id, partner_id = EXCLUDED.partner_id, agent_id = EXCLUDED.agent_id,
                       created_by = EXCLUDED.created_by, updated_at = now()`,
        [tenantId, formId, dimension, raw, mode === 'link' ? targetId : null, userId || null]);
    }
    const geo = await applySubmissionsGeoTx(client, tenantId);
    const { rows: [n] } = await client.query(
      `SELECT count(*)::int AS n FROM monitoring_submissions WHERE tenant_id = $1 AND form_id = $2 AND ${d.raw} = $3`, [tenantId, formId, raw]);
    return { submissions: n.n, geo };
  });
}

/**
 * Vérification avant import : la fiche existe-t-elle, et combien des identifiants
 * Kobo du fichier y sont déjà (ils seront mis à jour, pas ajoutés) ? Lecture seule.
 * @returns {Promise<null|{ already: number }>}
 */
async function importPreview(tenantId, formId, ids) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: f } = await client.query('SELECT id FROM monitoring_forms WHERE tenant_id = $1 AND id = $2', [tenantId, formId]);
    if (!f[0]) return null;
    let already = 0;
    for (let i = 0; i < ids.length; i += 5000) {
      const { rows } = await client.query(
        'SELECT count(*)::int AS n FROM monitoring_submissions WHERE tenant_id = $1 AND form_id = $2 AND external_id = ANY($3::text[])',
        [tenantId, formId, ids.slice(i, i + 5000)]);
      already += rows[0].n;
    }
    return { already };
  });
}

/** Compute the form's indicator values over submissions (optional month filter). */
async function computeValues(tenantId, formId, { month } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId, formId];
    let where = 's.tenant_id = $1 AND s.form_id = $2 AND NOT s.excluded';
    if (month) { params.push(`${month.slice(0, 7)}-01`); where += ` AND s.period_month = $${params.length}`; }
    const { rows: subs } = await client.query(`SELECT data FROM monitoring_submissions s WHERE ${where}`, params);
    const { rows: inds } = await client.query(
      `SELECT id, code, label, module, source_field AS "sourceField", agg,
              positive_value AS "positiveValue", target, direction, sort_order,
              na_values AS "naValues", scored
         FROM monitoring_indicators WHERE tenant_id = $1 AND form_id = $2 AND active = true
        ORDER BY sort_order, label`,
      [tenantId, formId]
    );
    const subsC = withCalc(subs, await calcDefsFor(client, tenantId, formId));
    return { count: subsC.length, indicators: computeAll(inds, subsC) };
  });
}

/** Dashboard restitution: coverage counts + per-bureau split + indicator values. */
async function dashboard(tenantId, formId, { month } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId, formId];
    let where = 's.tenant_id = $1 AND s.form_id = $2 AND NOT s.excluded';
    if (month) { params.push(`${month.slice(0, 7)}-01`); where += ` AND s.period_month = $${params.length}`; }

    const { rows: cov } = await client.query(
      `SELECT count(*)::int AS submissions,
              count(DISTINCT NULLIF(site, ''))::int AS sites,
              count(DISTINCT NULLIF(agent, ''))::int AS agents,
              count(DISTINCT NULLIF(partner, ''))::int AS partners,
              count(DISTINCT NULLIF(field_office, ''))::int AS "fieldOffices"
         FROM monitoring_submissions s WHERE ${where}`,
      params
    );
    const { rows: byBureau } = await client.query(
      `SELECT COALESCE(NULLIF(field_office, ''), '(non renseigné)') AS bureau,
              count(*)::int AS submissions,
              count(DISTINCT NULLIF(site, ''))::int AS sites
         FROM monitoring_submissions s WHERE ${where}
        GROUP BY 1 ORDER BY submissions DESC`,
      params
    );
    const { rows: subs } = await client.query(`SELECT data FROM monitoring_submissions s WHERE ${where}`, params);
    const { rows: inds } = await client.query(
      `SELECT id, code, label, module, source_field AS "sourceField", agg,
              positive_value AS "positiveValue", target, direction, sort_order,
              na_values AS "naValues", scored
         FROM monitoring_indicators WHERE tenant_id = $1 AND form_id = $2 AND active = true
        ORDER BY sort_order, label`,
      [tenantId, formId]
    );
    const subsC = withCalc(subs, await calcDefsFor(client, tenantId, formId));
    const indicators = computeAll(inds, subsC);
    return { coverage: cov[0], byBureau, indicators, overallIndex: overallIndex(indicators) };
  });
}

/**
 * Filtre période des soumissions — un mois, ou un intervalle de mois inclusif
 * [from, to] — et TOUJOURS hors soumissions exclues au nettoyage (comme les
 * onglets Résultats/Tableau de bord d'une fiche). Pousse ses paramètres dans
 * `params` et renvoie le fragment SQL « AND … ».
 */
function submissionFilter(alias, { month, from, to, bureau } = {}, params) {
  const a = alias ? `${alias}.` : '';
  const parts = [`NOT ${a}excluded`];
  if (bureau) { params.push(bureau); parts.push(`COALESCE(NULLIF(${a}field_office, ''), '(non renseigné)') = $${params.length}`); }
  const m = (v) => `${String(v).slice(0, 7)}-01`;
  if (month) { params.push(m(month)); parts.push(`${a}period_month = $${params.length}`); } else {
    if (from) { params.push(m(from)); parts.push(`${a}period_month >= $${params.length}`); }
    if (to) { params.push(m(to)); parts.push(`${a}period_month <= $${params.length}`); }
  }
  return ` AND ${parts.join(' AND ')}`;
}

/** Résultats d'indicateurs d'une fiche sur la période (exclusions + champs calculés appliqués). */
async function formResults(client, tenantId, formId, period) {
  const { rows: inds } = await client.query(
    `SELECT id, code, label, module, source_field AS "sourceField", agg,
            positive_value AS "positiveValue", target, direction, sort_order,
              na_values AS "naValues", scored
       FROM monitoring_indicators WHERE tenant_id = $1 AND form_id = $2 AND active = true
      ORDER BY sort_order, label`,
    [tenantId, formId]
  );
  const p = [tenantId, formId];
  const { rows: subs } = await client.query(`SELECT data FROM monitoring_submissions s WHERE s.tenant_id = $1 AND s.form_id = $2${submissionFilter('s', period, p)}`, p);
  const subsC = withCalc(subs, await calcDefsFor(client, tenantId, formId));
  return { inds, count: subsC.length, results: computeAll(inds, subsC) };
}

/**
 * Synthèse transversale « Suivi de processus » — agrège toutes les fiches :
 * volume de données versées, tendance mensuelle, répartition par bureau, et
 * indice de conformité global (moyenne des indicateurs percent_* de toutes les
 * fiches, via overallIndex). Recalculé en direct, rien de stocké.
 */
/**
 * Nom lisible du bureau d'une soumission, pour l'affichage : bureau MEMS
 * rattaché (field_office_id), sinon libellé du choix dans le XLSForm de la
 * fiche (« 7 » → « Tsihombe »), sinon valeur brute. Ajoute ses paramètres à
 * `params` ; renvoie la jointure et l'expression SQL.
 */
async function officeNameSql(client, tenantId, alias, params) {
  const labels = await officeChoiceLabelsTx(client, tenantId);
  const forms = []; const values = []; const names = [];
  for (const [formId, map] of labels) for (const [value, label] of map) { forms.push(formId); values.push(value); names.push(label); }
  params.push(forms, values, names);
  const n = params.length;
  return {
    join: `LEFT JOIN field_offices fo ON fo.id = ${alias}.field_office_id AND fo.tenant_id = ${alias}.tenant_id
           LEFT JOIN unnest($${n - 2}::uuid[], $${n - 1}::text[], $${n}::text[]) AS och(form_id, value, label)
                  ON och.form_id = ${alias}.form_id AND och.value = ${alias}.field_office`,
    expr: `COALESCE(fo.name, och.label, NULLIF(${alias}.field_office, ''), '(non renseigné)')`,
  };
}

/** Dernier mois d'une période (« AAAA-MM-01 ») : le mois choisi, sinon la borne haute, sinon null (mois courant). */
const periodEnd = ({ month, to } = {}) => ((month || to) ? `${String(month || to).slice(0, 7)}-01` : null);

/**
 * Soumissions par mois sur les 12 mois qui finissent au mois de la période
 * (mois courant par défaut), mois vides compris — une date aberrante (tablette
 * remise à zéro) ne déforme plus l'axe. `formId` restreint à une fiche.
 */
async function monthlyTrend(client, tenantId, period, formId = null) {
  const { rows } = await client.query(
    `WITH b AS (SELECT COALESCE($2::date, date_trunc('month', now())::date) AS hi)
     SELECT to_char(m, 'YYYY-MM') AS month, COALESCE(c.n, 0)::int AS submissions
       FROM b CROSS JOIN generate_series(b.hi - interval '11 months', b.hi, interval '1 month') AS m
       LEFT JOIN (SELECT s.period_month, count(*) AS n FROM monitoring_submissions s, b
                   WHERE s.tenant_id = $1 AND NOT s.excluded AND ($3::uuid IS NULL OR s.form_id = $3)
                     AND s.period_month BETWEEN (b.hi - interval '11 months')::date AND b.hi
                   GROUP BY 1) c ON c.period_month = m::date
      ORDER BY m`,
    [tenantId, periodEnd(period), formId]
  );
  return rows;
}

async function processOverview(tenantId, period = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const p = [tenantId];
    const f = submissionFilter('s', period, p);
    const office = await officeNameSql(client, tenantId, 's', p);
    const { rows: tot } = await client.query(
      `SELECT count(*)::int AS submissions,
              count(DISTINCT NULLIF(s.site, ''))::int AS sites,
              count(DISTINCT NULLIF(s.agent, ''))::int AS agents,
              count(DISTINCT NULLIF(s.partner, ''))::int AS partners,
              count(DISTINCT ${office.expr}) FILTER (WHERE s.field_office_id IS NOT NULL OR NULLIF(s.field_office, '') IS NOT NULL)::int AS "fieldOffices"
         FROM monitoring_submissions s ${office.join} WHERE s.tenant_id = $1${f}`,
      p
    );
    const trend = await monthlyTrend(client, tenantId, period);
    // Dernier mois ayant des données (hors exclues, pas dans le futur) : l'écran
    // s'y place quand le mois demandé est vide, au lieu d'afficher des zéros.
    const { rows: [last] } = await client.query(
      `SELECT to_char(max(period_month), 'YYYY-MM') AS month FROM monitoring_submissions
        WHERE tenant_id = $1 AND NOT excluded AND period_month <= date_trunc('month', now())::date`,
      [tenantId]
    );
    const { rows: byBureau } = await client.query(
      `SELECT ${office.expr} AS bureau,
              count(*)::int AS submissions, count(DISTINCT NULLIF(s.site, ''))::int AS sites
         FROM monitoring_submissions s ${office.join} WHERE s.tenant_id = $1${f}
        GROUP BY 1 ORDER BY submissions DESC LIMIT 12`,
      p
    );
    const { rows: forms } = await client.query(
      `SELECT id, code, label, activity_category AS "activityCategory"
         FROM monitoring_forms WHERE tenant_id = $1 AND active = true ORDER BY label`,
      [tenantId]
    );
    // Indice de conformité : résultats de toutes les fiches, moyennés (overallIndex).
    let allResults = [];
    const perForm = [];
    let indicatorsCount = 0;
    for (const fm of forms) {
      const { inds, count, results } = await formResults(client, tenantId, fm.id, period);
      indicatorsCount += inds.length;
      allResults = allResults.concat(results);
      perForm.push({
        id: fm.id, code: fm.code, label: fm.label, activityCategory: fm.activityCategory,
        submissions: count, indicators: inds.length, index: overallIndex(results),
      });
    }

    return {
      totals: { ...tot[0], forms: forms.length, indicators: indicatorsCount },
      latestMonth: last ? last.month : null,
      trend,
      byBureau,
      perForm,
      conformityIndex: overallIndex(allResults),
    };
  });
}

/**
 * Tableau de bord « Couverture & performance » — volet suivi/conformité, par
 * activité (= fiche). Recalculé en direct à partir des fiches, indicateurs et
 * soumissions ; rien de stocké. Pour chaque fiche : indice, répartition en
 * 5 bandes (coverageDashboard.classify), dimensions (par `module`), top/flop
 * d'indicateurs, tendance mensuelle et répartition par bureau. Plus l'agrégat
 * global, la répartition par région (adm1) et le nombre de communes ayant
 * réellement versé des données le mois (pour le « plan vs réalisé » des
 * soumissions). La couverture terrain et le RBM restent fournis par leurs
 * propres endpoints (field/summary, field/rbm) et sont combinés côté client.
 */
async function coverageDashboard(tenantId, period = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const p = [tenantId];
    const f = submissionFilter('s', period, p);
    const { rows: tot } = await client.query(
      `SELECT count(*)::int AS submissions,
              count(DISTINCT NULLIF(site, ''))::int AS sites,
              count(DISTINCT NULLIF(agent, ''))::int AS agents,
              count(DISTINCT NULLIF(partner, ''))::int AS partners,
              count(DISTINCT NULLIF(admin3, ''))::int AS communes
         FROM monitoring_submissions s WHERE s.tenant_id = $1${f}`,
      p
    );
    // Région en clair : la soumission porte un pcode de commune (admin3) ; on
    // le résout en NOM de région via le référentiel de sites (sites.adm3_pcode
    // → sites.adm1). Repli sur le pcode brut puis « (non renseigné) ».
    const { rows: regionRows } = await client.query(
      `${REGION_CTE}
       SELECT ${REGION_OF('s')} AS region,
              count(*)::int AS submissions,
              count(DISTINCT NULLIF(s.admin3, ''))::int AS communes
         FROM monitoring_submissions s
         ${REGION_JOIN('s')}
        WHERE s.tenant_id = $1${f}
        GROUP BY 1 ORDER BY submissions DESC`,
      p
    );

    const { rows: forms } = await client.query(
      "SELECT id, code, label FROM monitoring_forms WHERE tenant_id = $1 AND active = true ORDER BY label",
      [tenantId]
    );

    let allResults = [];
    let indicatorsCount = 0;
    const perForm = [];
    for (const fm of forms) {
      const { inds, count, results } = await formResults(client, tenantId, fm.id, period);
      indicatorsCount += inds.length;
      // Tendance mensuelle de la fiche : 12 mois finissant au mois de la période.
      const formTrend = await monthlyTrend(client, tenantId, period, fm.id);
      const bp = [tenantId, fm.id];
      const bf = submissionFilter('s', period, bp);
      const office = await officeNameSql(client, tenantId, 's', bp);
      const { rows: formBureau } = await client.query(
        `SELECT ${office.expr} AS bureau,
                count(*)::int AS submissions, count(DISTINCT NULLIF(s.site, ''))::int AS sites
           FROM monitoring_submissions s ${office.join} WHERE s.tenant_id = $1 AND s.form_id = $2${bf}
          GROUP BY 1 ORDER BY submissions DESC LIMIT 8`,
        bp
      );
      allResults = allResults.concat(results);
      const { top, flop } = topFlop(results);
      perForm.push({
        id: fm.id, code: fm.code, label: fm.label,
        submissions: count,
        indicatorCount: inds.length,
        index: overallIndex(results),
        classes: classDistribution(results),
        dims: dimGroups(results),
        top, flop,
        // Liste complète des indicateurs (pour la salle de contrôle / bulletin).
        indicators: results.map((r) => ({
          label: r.label, code: r.code, value: r.value, base: r.base,
          agg: r.agg, module: r.module || null, target: r.target, cls: classify(r),
        })),
        byBureau: formBureau,
        trend: formTrend,
      });
    }

    return {
      month: period.month || null,
      from: period.month ? null : (period.from || null),
      to: period.month ? null : (period.to || null),
      totals: { ...tot[0], forms: forms.length, indicators: indicatorsCount },
      conformityIndex: overallIndex(allResults),
      classes: classDistribution(allResults),
      regions: regionRows,
      forms: perForm,
    };
  });
}

/**
 * Données « suivi de processus » d'un rapport, calculées UNE fois pour la
 * période : par fiche — résultats d'indicateurs (exclusions + champs calculés),
 * partition par bureau, sites visités, sites actifs de l'activité rattachée,
 * complétude mensuelle — et régions. Les indicateurs restent calculés par la
 * logique pure partagée (computeAll) ; le SQL fait les comptages.
 */
async function reportMonitoringData(tenantId, period) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: forms } = await client.query(
      `SELECT f.id, f.code, f.label, f.activity_category AS "activityCategory",
              (SELECT count(*)::int FROM sites st WHERE st.tenant_id = f.tenant_id AND f.activity_category IS NOT NULL
                  AND lower(btrim(st.activity)) = lower(btrim(f.activity_category))) AS "sitesActive"
         FROM monitoring_forms f WHERE f.tenant_id = $1 AND f.active = true ORDER BY f.label`, [tenantId]);
    const out = [];
    for (const fm of forms) {
      const { rows: inds } = await client.query(
        `SELECT id, code, label, module, source_field AS "sourceField", agg,
                positive_value AS "positiveValue", target, direction, sort_order,
              na_values AS "naValues", scored
           FROM monitoring_indicators WHERE tenant_id = $1 AND form_id = $2 AND active = true ORDER BY sort_order, label`,
        [tenantId, fm.id]);
      const p = [tenantId, fm.id];
      const f = submissionFilter('s', period, p);
      const { rows: subs } = await client.query(
        `SELECT data, COALESCE(NULLIF(field_office, ''), '(non renseigné)') AS bureau,
                COALESCE(site_id::text, NULLIF(site, ''), NULLIF(admin3, '')) AS sitekey FROM monitoring_submissions s
          WHERE s.tenant_id = $1 AND s.form_id = $2${f}`, p);
      const { rows: cnt } = await client.query(
        `SELECT count(*)::int AS visits, count(DISTINCT COALESCE(site_id::text, NULLIF(site, ''), NULLIF(admin3, '')))::int AS "sitesVisited"
           FROM monitoring_submissions s WHERE s.tenant_id = $1 AND s.form_id = $2${f}`, p);
      const { rows: monthly } = await client.query(
        `SELECT to_char(period_month, 'YYYY-MM') AS month, count(DISTINCT COALESCE(site_id::text, NULLIF(site, ''), NULLIF(admin3, '')))::int AS sites
           FROM monitoring_submissions s WHERE s.tenant_id = $1 AND s.form_id = $2${f}
          GROUP BY 1 ORDER BY 1`, p);
      const defs = await calcDefsFor(client, tenantId, fm.id);
      const subsC = withCalc(subs, defs);
      const results = computeAll(inds, subsC);
      const byBureau = new Map();
      subsC.forEach((sub) => { if (!byBureau.has(sub.bureau)) byBureau.set(sub.bureau, []); byBureau.get(sub.bureau).push(sub); });
      const bureaux = [...byBureau.entries()].sort((a, b) => b[1].length - a[1].length).map(([bureau, list]) => {
        const r = computeAll(inds, list);
        // Visites et sites visités PAR bureau (chiffres clés filtrés par bureau du concepteur).
        const sitesVisited = new Set(list.map((x) => x.sitekey).filter(Boolean)).size;
        return { bureau, n: list.length, visits: list.length, sitesVisited, index: overallIndex(r), dims: dimGroups(r) };
      });
      out.push({
        id: fm.id, code: fm.code, label: fm.label, activityCategory: fm.activityCategory, sitesActive: fm.activityCategory ? fm.sitesActive : null,
        visits: cnt[0].visits, sitesVisited: cnt[0].sitesVisited, monthly,
        index: overallIndex(results), dims: dimGroups(results),
        indicators: results.map((r) => ({ label: r.label, code: r.code, module: r.module || null, value: r.value, base: r.base, target: r.target, agg: r.agg, cls: classify(r) })),
        bureaux,
      });
    }
    const rp = [tenantId];
    const rf = submissionFilter('s', period, rp);
    const { rows: regions } = await client.query(
      `${REGION_CTE}
       SELECT ${REGION_OF('s')} AS region,
              count(*)::int AS submissions, count(DISTINCT NULLIF(s.admin3, ''))::int AS communes
         FROM monitoring_submissions s ${REGION_JOIN('s')}
        WHERE s.tenant_id = $1${rf} GROUP BY 1 ORDER BY submissions DESC`, rp);
    const tp = [tenantId];
    const tf = submissionFilter('s', period, tp);
    const { rows: tot } = await client.query(`SELECT count(*)::int AS submissions FROM monitoring_submissions s WHERE s.tenant_id = $1${tf}`, tp);
    return { forms: out, regions, submissions: tot[0].submissions };
  });
}

/**
 * Données réelles (soumissions brutes) — pour la « table des données actuelles »
 * rattachée au plan de suivi. Bornée (limit) ; on résout le nom de la commune
 * à partir du pcode (adm3) via le référentiel de sites, pour afficher un nom
 * lisible plutôt que le seul code. Filtrable par mois.
 */
async function listSubmissions(tenantId, { month, limit = 300 } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['ms.tenant_id = $1'];
    if (month) { params.push(`${String(month).slice(0, 7)}-01`); where.push(`ms.period_month = $${params.length}`); }
    params.push(Math.min(Math.max(Number(limit) || 300, 1), 2000));
    const { rows } = await client.query(
      `SELECT ms.external_id AS "externalId", to_char(ms.period_month, 'YYYY-MM') AS "periodMonth",
              ms.submitted_at AS "submittedAt", ms.field_office AS "fieldOffice",
              ms.admin1, ms.admin2, ms.admin3, ms.partner, ms.source,
              ms.excluded, f.label AS "formLabel", f.activity_category AS "activityCategory",
              ${PLACE_NAMES}
         FROM monitoring_submissions ms
         JOIN monitoring_forms f ON f.id = ms.form_id AND f.tenant_id = ms.tenant_id
        WHERE ${where.join(' AND ')}
        ORDER BY ms.submitted_at DESC NULLS LAST, ms.period_month DESC
        LIMIT $${params.length}`,
      params
    );
    return rows;
  });
}

// ---- Nettoyage : champs calculés + exclusion -----------------------------
async function listCalcFields(tenantId, formId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, name, label, kind, expression, source_field AS "sourceField", mapping,
              default_value AS "defaultValue", sort_order AS "sortOrder"
         FROM monitoring_calc_fields WHERE tenant_id = $1 AND form_id = $2 ORDER BY sort_order, name`,
      [tenantId, formId]
    );
    return rows;
  });
}

/**
 * Aperçu d'un champ calculé (éditeur de formule) sur les 300 soumissions les plus
 * récentes de la fiche (non exclues) : vérification de la formule contre les
 * variables connues (catalogue, données, autres champs calculés), quelques
 * lignes et la répartition des résultats. Lecture seule ; seules les réponses
 * utilisées par les formules sont lues.
 * @returns {Promise<null|{check:object, n?:number}>} null si la fiche n'existe pas
 */
async function calcPreview(tenantId, formId, def, { excludeId } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: f } = await client.query('SELECT id FROM monitoring_forms WHERE tenant_id = $1 AND id = $2', [tenantId, formId]);
    if (!f[0]) return null;
    const { rows: defs } = await client.query(
      `SELECT id, name, kind, expression, source_field AS "sourceField", mapping, default_value AS "defaultValue"
         FROM monitoring_calc_fields WHERE tenant_id = $1 AND form_id = $2 ORDER BY sort_order, name`, [tenantId, formId]);
    // Le calcul réel passe les champs dans l'ordre : celui qu'on édite ne voit que ceux qui le PRÉCÈDENT
    // (un nouveau champ est ajouté à la fin : il voit tous les autres).
    const at = excludeId ? defs.findIndex((d) => d.id === excludeId) : -1;
    const prior = at >= 0 ? defs.slice(0, at) : defs.filter((d) => d.id !== excludeId);
    const later = new Set(at >= 0 ? defs.slice(at + 1).map((d) => d.name.toLowerCase()) : []);
    const { rows: keyRows } = await client.query(
      `SELECT name AS k FROM monitoring_form_fields WHERE tenant_id = $1 AND form_id = $2
       UNION SELECT DISTINCT jsonb_object_keys(data) FROM (
         SELECT data FROM monitoring_submissions WHERE tenant_id = $1 AND form_id = $2 ORDER BY created_at DESC LIMIT 300) s`,
      [tenantId, formId]);
    const known = new Set([...keyRows.map((r) => r.k), ...prior.map((d) => d.name)]);
    const check = def.kind === 'recode'
      ? { error: def.sourceField ? null : { message: 'Choisissez la variable à recoder.', at: null }, warnings: [], references: [def.sourceField].filter(Boolean) }
      : checkExpression(def.expression, { fields: known });
    for (const w of check.warnings || []) {
      if (w.name && later.has(w.name.toLowerCase())) {
        w.message = `« ${w.name} » est un champ calculé placé après celui-ci dans la liste : il est calculé plus tard, donc vide ici.`;
      }
    }
    if (check.error) return { check };
    // Réponses utiles seulement : variables de la formule et de tous les champs calculés existants.
    const needed = new Set(check.references);
    for (const d of prior) {
      if (d.kind === 'recode') needed.add(d.sourceField);
      else checkExpression(d.expression).references.forEach((r) => needed.add(r));
    }
    const { rows: sample } = await client.query(
      `SELECT COALESCE((SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(s.data) e WHERE lower(e.key) = ANY($3::text[])), '{}'::jsonb) AS data
         FROM monitoring_submissions s
        WHERE s.tenant_id = $1 AND s.form_id = $2 AND NOT s.excluded
        ORDER BY s.submitted_at DESC NULLS LAST, s.created_at DESC LIMIT 300`,
      [tenantId, formId, [...needed].filter(Boolean).map((k) => String(k).toLowerCase())]);
    return { check, ...previewCalc(def, sample.map((r) => r.data), prior) };
  });
}

async function createCalcField(tenantId, formId, b) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO monitoring_calc_fields (tenant_id, form_id, name, label, kind, expression, source_field, mapping, default_value, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE((SELECT max(sort_order)+1 FROM monitoring_calc_fields WHERE form_id=$2), 0))
       RETURNING id`,
      [tenantId, formId, b.name, b.label || b.name, b.kind, b.expression || null, b.sourceField || null,
        b.mapping ? JSON.stringify(b.mapping) : null, b.defaultValue ?? null]
    );
    return rows[0].id;
  });
}

async function updateCalcField(tenantId, id, b) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE monitoring_calc_fields SET name=$3, label=$4, kind=$5, expression=$6, source_field=$7, mapping=$8, default_value=$9
         WHERE tenant_id=$1 AND id=$2`,
      [tenantId, id, b.name, b.label || b.name, b.kind, b.expression || null, b.sourceField || null,
        b.mapping ? JSON.stringify(b.mapping) : null, b.defaultValue ?? null]
    );
    return rowCount > 0;
  });
}

async function deleteCalcField(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM monitoring_calc_fields WHERE tenant_id=$1 AND id=$2', [tenantId, id]);
    return rowCount > 0;
  });
}

/** Exclut / réintègre des soumissions (curation). `ids` = monitoring_submissions.id. */
async function setExclusion(tenantId, formId, { ids, excluded, reason } = {}) {
  if (!Array.isArray(ids) || !ids.length) return { updated: 0 };
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE monitoring_submissions SET excluded = $3, exclude_reason = $4
         WHERE tenant_id = $1 AND form_id = $2 AND id = ANY($5::uuid[])`,
      [tenantId, formId, excluded === true, excluded ? (reason || null) : null, ids]
    );
    return { updated: rowCount };
  });
}

module.exports = {
  reliftSubmissionsTx, formTemplate, applyTemplate,
  listCalcFields, calcPreview, formVariables, importPreview, formCorrespondences, setCorrespondence, createCalcField, updateCalcField, deleteCalcField, setExclusion,
  setFormSource, formSourceContext, reportMonitoringData,
  listForms, createForm, updateForm, deleteForm,
  listIndicators, createIndicator, updateIndicator, deleteIndicator,
  formFields, importSubmissions, computeValues, dashboard, processOverview, coverageDashboard,
  formCatalog, memsMappingForForm, setMemsMapping, resetMemsMapping, applyMappingToSubmissions,
  formSubmissions, ensureCatalogFromSav, importDefinition, listSubmissions,
};
