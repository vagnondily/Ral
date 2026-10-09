const { withTenantTransaction } = require('../../config/db');
const { computeAll, overallIndex } = require('./monitoringMath');
const { classDistribution, dimGroups, topFlop, classify } = require('./coverageDashboard');
const { detectMapping, DIMENSION_COLUMN, EDITABLE_KEYS } = require('./memsMapping');
const { computeCalcFields } = require('./calcFields');

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
      `SELECT f.id, f.code, f.label, f.active, f.source_url AS "sourceUrl",
              COALESCE((SELECT count(*) FROM monitoring_indicators i WHERE i.form_id = f.id), 0)::int AS "indicatorCount",
              COALESCE((SELECT count(*) FROM monitoring_submissions s WHERE s.form_id = f.id), 0)::int AS "submissionCount"
         FROM monitoring_forms f WHERE f.tenant_id = $1 ORDER BY f.label`,
      [tenantId]
    );
    return rows;
  });
}

/** Mémorise le lien de données (ONA/MoDA/export web) d'une fiche. */
async function setFormSource(tenantId, formId, url) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query('UPDATE monitoring_forms SET source_url = $3 WHERE tenant_id = $1 AND id = $2', [tenantId, formId, url || null]);
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

async function updateForm(tenantId, id, { label, active }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE monitoring_forms SET label = COALESCE($3, label), active = COALESCE($4, active)
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, label ?? null, active ?? null]
    );
    return rowCount === 1;
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
              agg, positive_value AS "positiveValue", target, direction, sort_order AS "sortOrder", active
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
         (tenant_id, form_id, code, label, module, source_field, agg, positive_value, target, direction, sort_order, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,true)) RETURNING id`,
      [tenantId, formId, ind.code, ind.label, ind.module || null, ind.sourceField, ind.agg || 'percent_yes',
        ind.positiveValue || null, ind.target ?? null, ind.direction || 'higher_better', ind.sortOrder ?? 0, ind.active]
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
         direction = COALESCE($9,direction), sort_order = COALESCE($10,sort_order), active = COALESCE($11,active)
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, ind.label ?? null, ind.module ?? null, ind.sourceField ?? null, ind.agg ?? null,
        ind.positiveValue ?? null, ind.target ?? null, ind.direction ?? null, ind.sortOrder ?? null, ind.active ?? null]
    );
    return rowCount === 1;
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
              (SELECT s.commune FROM sites s
                WHERE s.tenant_id = ms.tenant_id AND s.adm3_pcode IS NOT NULL AND s.adm3_pcode = ms.admin3
                LIMIT 1) AS "communeName"
         FROM monitoring_submissions ms
        WHERE ${where.join(' AND ')}
        ORDER BY ms.submitted_at DESC NULLS LAST, ms.period_month DESC
        LIMIT $${params.length}`,
      params
    );
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

/**
 * Enrichit le catalogue d'une fiche depuis les variables d'un .sav (SPSS) :
 * name + label de variable, et étiquettes de valeurs → listes de choix. Ne fait
 * rien si un catalogue existe déjà (le XLSForm reste la source de vérité) ;
 * sinon, nomme les colonnes à partir des labels du .sav. Batché, idempotent.
 */
async function ensureCatalogFromSav(tenantId, formId, variables) {
  if (!variables || !variables.length) return { added: 0 };
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: ex } = await client.query(
      'SELECT count(*)::int AS n FROM monitoring_form_fields WHERE tenant_id = $1 AND form_id = $2',
      [tenantId, formId]
    );
    if ((ex[0]?.n ?? 0) > 0) return { added: 0, skipped: 'catalogue existant' };

    const withLabels = variables.filter((v) => v && v.name);
    if (withLabels.length) {
      const cols = 8; const params = []; const tuples = withLabels.map((v, i) => {
        const b = i * cols;
        const hasChoices = Array.isArray(v.valueLabels) && v.valueLabels.length > 0;
        params.push(tenantId, formId, v.name, v.type || null, v.label || v.name, null, hasChoices ? v.name : null, i);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
      });
      await client.query(
        `INSERT INTO monitoring_form_fields (tenant_id, form_id, name, type, label, group_path, list_name, sort_order)
         VALUES ${tuples.join(',')} ON CONFLICT (form_id, name) DO NOTHING`,
        params
      );
    }
    const flat = [];
    for (const v of withLabels) for (let i = 0; i < (v.valueLabels || []).length; i += 1) {
      flat.push({ listName: v.name, value: v.valueLabels[i].value, label: v.valueLabels[i].label || v.valueLabels[i].value, sort: i });
    }
    if (flat.length) {
      const cols = 6; const params = []; const tuples = flat.map((c, i) => {
        const b = i * cols; params.push(tenantId, formId, c.listName, c.value, c.label, c.sort);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
      });
      await client.query(
        `INSERT INTO monitoring_choices (tenant_id, form_id, list_name, value, label, sort_order) VALUES ${tuples.join(',')}`,
        params
      );
    }
    return { added: withLabels.length };
  });
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
    const { rows: ov } = await client.query(
      'SELECT dimension, column_name AS "columnName" FROM monitoring_field_map WHERE tenant_id = $1 AND form_id = $2',
      [tenantId, formId]
    );
    let applied = 0;
    for (const o of ov) {
      const col = DIMENSION_COLUMN[o.dimension];
      if (!col) continue; // dimension non surchargeable (ex. date)
      if (o.columnName && o.columnName.trim()) {
        await client.query(
          `UPDATE monitoring_submissions SET ${col} = NULLIF(data->>$3, '')
             WHERE tenant_id = $1 AND form_id = $2`,
          [tenantId, formId, o.columnName.trim()]
        );
      } else {
        await client.query(
          `UPDATE monitoring_submissions SET ${col} = NULL WHERE tenant_id = $1 AND form_id = $2`,
          [tenantId, formId]
        );
      }
      applied += 1;
    }
    return { applied };
  });
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
    await client.query('DELETE FROM monitoring_choices WHERE tenant_id = $1 AND form_id = $2', [tenantId, formId]);

    // Batch : une seule instruction multi-lignes (jamais N requêtes en boucle).
    if (fields.length) {
      const cols = 10;
      const params = [];
      const tuples = fields.map((f, i) => {
        const b = i * cols;
        params.push(tenantId, formId, f.name, f.type || null, f.label || f.name, f.group || null, f.listName || null, f.relevant || null, f.required === true, i);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`;
      });
      await client.query(
        `INSERT INTO monitoring_form_fields (tenant_id, form_id, name, type, label, group_path, list_name, relevant, required, sort_order)
         VALUES ${tuples.join(',')} ON CONFLICT (form_id, name) DO NOTHING`,
        params
      );
    }
    let choiceCount = 0;
    const flatChoices = [];
    for (const [listName, opts] of Object.entries(choicesMap || {})) {
      opts.forEach((o, i) => flatChoices.push({ listName, value: o.value, label: o.label || o.value, sort: i }));
    }
    if (flatChoices.length) {
      const cols = 6;
      const params = [];
      const tuples = flatChoices.map((c, i) => {
        const b = i * cols;
        params.push(tenantId, formId, c.listName, c.value, c.label, c.sort);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
      });
      await client.query(
        `INSERT INTO monitoring_choices (tenant_id, form_id, list_name, value, label, sort_order) VALUES ${tuples.join(',')}`,
        params
      );
      choiceCount = flatChoices.length;
    }
    return { formId, fields: fields.length, choices: choiceCount };
  });
}

async function importSubmissions(tenantId, formId, submissions) {
  return withTenantTransaction(tenantId, async (client) => {
    // Confirm the form belongs to the tenant.
    const { rows: f } = await client.query('SELECT id FROM monitoring_forms WHERE tenant_id = $1 AND id = $2', [tenantId, formId]);
    if (!f[0]) return null;

    // Surcharges manuelles de mapping : écrasent la détection par alias, au moment
    // de l'import, à partir des réponses brutes (data) de chaque soumission.
    const SUB_PROP = { field_office: 'fieldOffice', admin1: 'admin1', admin2: 'admin2', admin3: 'admin3', admin4: 'admin4', site: 'site', partner: 'partner', agent: 'agent' };
    const { rows: ov } = await client.query(
      'SELECT dimension, column_name AS "columnName" FROM monitoring_field_map WHERE tenant_id = $1 AND form_id = $2',
      [tenantId, formId]
    );
    const applyOverrides = (s) => {
      for (const o of ov) {
        const prop = SUB_PROP[o.dimension]; if (!prop) continue;
        if (o.columnName && o.columnName.trim()) {
          const v = s.data ? s.data[o.columnName.trim()] : undefined;
          s[prop] = (v == null || v === '') ? null : String(v);
        } else { s[prop] = null; }
      }
    };

    let inserted = 0;
    // Insert row by row so ON CONFLICT dedup (per _uuid) is simple and safe.
    for (const s of submissions) {
      if (ov.length) applyOverrides(s);
      const res = await client.query(
        `INSERT INTO monitoring_submissions
           (tenant_id, form_id, external_id, period_month, submitted_at, field_office,
            admin1, admin2, admin3, admin4, site, partner, agent, source, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (form_id, external_id) DO UPDATE SET
           period_month = EXCLUDED.period_month, submitted_at = EXCLUDED.submitted_at,
           field_office = EXCLUDED.field_office, admin1 = EXCLUDED.admin1, admin2 = EXCLUDED.admin2,
           admin3 = EXCLUDED.admin3, admin4 = EXCLUDED.admin4, site = EXCLUDED.site,
           partner = EXCLUDED.partner, agent = EXCLUDED.agent, source = EXCLUDED.source, data = EXCLUDED.data`,
        [tenantId, formId, s.externalId, s.periodMonth, s.submittedAt, s.fieldOffice,
          s.admin1, s.admin2, s.admin3, s.admin4, s.site, s.partner, s.agent, s.source, JSON.stringify(s.data || {})]
      );
      inserted += res.rowCount;
    }
    return { received: submissions.length, inserted };
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
              positive_value AS "positiveValue", target, direction, sort_order
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
              positive_value AS "positiveValue", target, direction, sort_order
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
 * Synthèse transversale « Suivi de processus » — agrège toutes les fiches :
 * volume de données versées, tendance mensuelle, répartition par bureau, et
 * indice de conformité global (moyenne des indicateurs percent_* de toutes les
 * fiches, via overallIndex). Recalculé en direct, rien de stocké.
 */
async function processOverview(tenantId, { month } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const monthFilter = month ? `${month.slice(0, 7)}-01` : null;
    const p = monthFilter ? [tenantId, monthFilter] : [tenantId];
    const mWhere = monthFilter ? ' AND s.period_month = $2' : '';

    const { rows: tot } = await client.query(
      `SELECT count(*)::int AS submissions,
              count(DISTINCT NULLIF(site, ''))::int AS sites,
              count(DISTINCT NULLIF(agent, ''))::int AS agents,
              count(DISTINCT NULLIF(partner, ''))::int AS partners,
              count(DISTINCT NULLIF(field_office, ''))::int AS "fieldOffices"
         FROM monitoring_submissions s WHERE s.tenant_id = $1${mWhere}`,
      p
    );
    // Tendance : soumissions par mois (12 derniers mois présents).
    const { rows: trend } = await client.query(
      `SELECT to_char(period_month, 'YYYY-MM') AS month, count(*)::int AS submissions
         FROM monitoring_submissions WHERE tenant_id = $1
        GROUP BY period_month ORDER BY period_month DESC LIMIT 12`,
      [tenantId]
    );
    const { rows: byBureau } = await client.query(
      `SELECT COALESCE(NULLIF(field_office, ''), '(non renseigné)') AS bureau,
              count(*)::int AS submissions, count(DISTINCT NULLIF(site, ''))::int AS sites
         FROM monitoring_submissions s WHERE s.tenant_id = $1${mWhere}
        GROUP BY 1 ORDER BY submissions DESC LIMIT 12`,
      p
    );

    const { rows: forms } = await client.query(
      "SELECT id, code, label FROM monitoring_forms WHERE tenant_id = $1 AND active = true ORDER BY label",
      [tenantId]
    );
    // Indice de conformité : on rassemble les résultats d'indicateurs de toutes
    // les fiches puis on moyenne (overallIndex).
    let allResults = [];
    const perForm = [];
    let indicatorsCount = 0;
    for (const f of forms) {
      const { rows: inds } = await client.query(
        `SELECT id, code, label, module, source_field AS "sourceField", agg,
                positive_value AS "positiveValue", target, direction, sort_order
           FROM monitoring_indicators WHERE tenant_id = $1 AND form_id = $2 AND active = true
          ORDER BY sort_order, label`,
        [tenantId, f.id]
      );
      indicatorsCount += inds.length;
      const subP = monthFilter ? [tenantId, f.id, monthFilter] : [tenantId, f.id];
      const { rows: subs } = await client.query(
        `SELECT data FROM monitoring_submissions s WHERE s.tenant_id = $1 AND s.form_id = $2${monthFilter ? ' AND s.period_month = $3' : ''}`,
        subP
      );
      const results = computeAll(inds, subs);
      allResults = allResults.concat(results);
      perForm.push({ id: f.id, code: f.code, label: f.label, submissions: subs.length, index: overallIndex(results) });
    }

    return {
      totals: { ...tot[0], forms: forms.length, indicators: indicatorsCount },
      trend: trend.reverse(),
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
async function coverageDashboard(tenantId, { month } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const monthFilter = month ? `${month.slice(0, 7)}-01` : null;
    const p = monthFilter ? [tenantId, monthFilter] : [tenantId];
    const mWhere = monthFilter ? ' AND s.period_month = $2' : '';

    const { rows: tot } = await client.query(
      `SELECT count(*)::int AS submissions,
              count(DISTINCT NULLIF(site, ''))::int AS sites,
              count(DISTINCT NULLIF(agent, ''))::int AS agents,
              count(DISTINCT NULLIF(partner, ''))::int AS partners,
              count(DISTINCT NULLIF(admin3, ''))::int AS communes
         FROM monitoring_submissions s WHERE s.tenant_id = $1${mWhere}`,
      p
    );
    // Région en clair : la soumission porte un pcode de commune (admin3) ; on
    // le résout en NOM de région via le référentiel de sites (sites.adm3_pcode
    // → sites.adm1). Repli sur le pcode brut puis « (non renseigné) ».
    const { rows: regionRows } = await client.query(
      `WITH pcode_region AS (
         SELECT DISTINCT ON (adm3_pcode) adm3_pcode, adm1 AS region
           FROM sites WHERE tenant_id = $1 AND adm3_pcode IS NOT NULL AND NULLIF(adm1, '') IS NOT NULL
       )
       SELECT COALESCE(pr.region, NULLIF(s.admin1, ''), '(non renseigné)') AS region,
              count(*)::int AS submissions,
              count(DISTINCT NULLIF(s.admin3, ''))::int AS communes
         FROM monitoring_submissions s
         LEFT JOIN pcode_region pr ON pr.adm3_pcode = s.admin3
        WHERE s.tenant_id = $1${mWhere}
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
    for (const f of forms) {
      const { rows: inds } = await client.query(
        `SELECT id, code, label, module, source_field AS "sourceField", agg,
                positive_value AS "positiveValue", target, direction, sort_order
           FROM monitoring_indicators WHERE tenant_id = $1 AND form_id = $2 AND active = true
          ORDER BY sort_order, label`,
        [tenantId, f.id]
      );
      indicatorsCount += inds.length;
      const subP = monthFilter ? [tenantId, f.id, monthFilter] : [tenantId, f.id];
      const { rows: subs } = await client.query(
        `SELECT data FROM monitoring_submissions s WHERE s.tenant_id = $1 AND s.form_id = $2${monthFilter ? ' AND s.period_month = $3' : ''}`,
        subP
      );
      // Tendance mensuelle de la fiche (indépendante du filtre mois).
      const { rows: formTrend } = await client.query(
        `SELECT to_char(period_month, 'YYYY-MM') AS month, count(*)::int AS submissions
           FROM monitoring_submissions WHERE tenant_id = $1 AND form_id = $2
          GROUP BY period_month ORDER BY period_month DESC LIMIT 12`,
        [tenantId, f.id]
      );
      const { rows: formBureau } = await client.query(
        `SELECT COALESCE(NULLIF(field_office, ''), '(non renseigné)') AS bureau,
                count(*)::int AS submissions, count(DISTINCT NULLIF(site, ''))::int AS sites
           FROM monitoring_submissions s WHERE s.tenant_id = $1 AND s.form_id = $2${monthFilter ? ' AND s.period_month = $3' : ''}
          GROUP BY 1 ORDER BY submissions DESC LIMIT 8`,
        subP
      );
      const results = computeAll(inds, subs);
      allResults = allResults.concat(results);
      const { top, flop } = topFlop(results);
      perForm.push({
        id: f.id, code: f.code, label: f.label,
        submissions: subs.length,
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
        trend: formTrend.reverse(),
      });
    }

    return {
      month: month || null,
      totals: { ...tot[0], forms: forms.length, indicators: indicatorsCount },
      conformityIndex: overallIndex(allResults),
      classes: classDistribution(allResults),
      regions: regionRows,
      forms: perForm,
    };
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
              f.label AS "formLabel",
              -- Nom de commune résolu depuis le référentiel de sites (même pcode).
              (SELECT s.commune FROM sites s
                WHERE s.tenant_id = ms.tenant_id AND s.adm3_pcode IS NOT NULL AND s.adm3_pcode = ms.admin3
                LIMIT 1) AS "communeName"
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
  listCalcFields, createCalcField, updateCalcField, deleteCalcField, setExclusion,
  setFormSource,
  listForms, createForm, updateForm,
  listIndicators, createIndicator, updateIndicator, deleteIndicator,
  formFields, importSubmissions, computeValues, dashboard, processOverview, coverageDashboard,
  formCatalog, memsMappingForForm, setMemsMapping, resetMemsMapping, applyMappingToSubmissions,
  formSubmissions, ensureCatalogFromSav, importDefinition, listSubmissions,
};
