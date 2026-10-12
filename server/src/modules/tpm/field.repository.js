const { withTenantTransaction } = require('../../config/db');
const { sitePatchSql } = require('./sitePatch');
const { chunkRows } = require('../../db/batch');
const { summarizeVisits, collectionDays, buildCoverageMatrix } = require('./fieldMath');
const { isDue, frequencyFor } = require('./rbmMath');
const { scoreSite, normalizeSecurity } = require('./rbmScore');
const { coverageRecap } = require('./coverageRecap');
const { mmrLookup, siteCounters, rankSites, boardKpis, normalizeChanges, currentStatus, mmrKeyOf, mmrCapacity, autoPlanMonths, norm } = require('./planBoard');
const { badRequest, conflict } = require('../../middleware/errors');

/**
 * Suivi terrain — planification/réalisation des visites, affectées aux
 * prestataires TPM. Réutilise le registre de sites partagé (`sites`) — un seul
 * référentiel de sites pour tout le suivi (RBM, affectations, visites). Only
 * this repository writes SQL; every query filters tenant_id (RLS).
 */

const SITE_COLS = 'id, district, commune, fokontany, name, activity';

// Deterministic slug used as the site `code` so an import dedups on
// (district, commune, name) via the (tenant_id, code) unique constraint.
function siteCode(s) {
  const slug = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `${slug(s.district)}--${slug(s.commune)}--${slug(s.name)}`.slice(0, 120) || `site-${Date.now()}`;
}

async function listSites(tenantId, { q } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['tenant_id = $1'];
    if (q) { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR commune ILIKE $${params.length} OR district ILIKE $${params.length})`); }
    const { rows } = await client.query(
      `SELECT ${SITE_COLS} FROM sites WHERE ${where.join(' AND ')} ORDER BY district, commune, name`,
      params
    );
    return rows;
  });
}

async function createSite(tenantId, s) {
  return withTenantTransaction(tenantId, async (client) => {
    const resolveOffice = `(SELECT c.office_id FROM field_office_communes c
         JOIN field_offices o ON o.id = c.office_id
        WHERE c.tenant_id = $1 AND lower(btrim(c.commune)) = lower(btrim($4))
        ORDER BY (o.parent_id IS NOT NULL) DESC, o.national ASC, o.code LIMIT 1)`;
    const { rows } = await client.query(
      `INSERT INTO sites (tenant_id, code, district, commune, fokontany, name, activity, adm2, adm3, adm4, field_office_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$3,$4,$5,${resolveOffice})
       ON CONFLICT (tenant_id, code) DO UPDATE SET fokontany = EXCLUDED.fokontany,
         activity = COALESCE(EXCLUDED.activity, sites.activity),
         adm2 = EXCLUDED.adm2, adm3 = EXCLUDED.adm3, adm4 = COALESCE(EXCLUDED.adm4, sites.adm4),
         field_office_id = COALESCE(sites.field_office_id, EXCLUDED.field_office_id)
       RETURNING id`,
      [tenantId, siteCode(s), s.district, s.commune, s.fokontany || null, s.name, s.activity || null]
    );
    return rows[0].id;
  });
}

/** Mise à jour partielle : seuls les champs envoyés changent (un changement de risque n'efface plus l'activité). */
async function updateSite(tenantId, id, patch) {
  const { sets, values } = sitePatchSql(patch, 3);
  return withTenantTransaction(tenantId, async (client) => {
    if (!sets.length) {
      const { rowCount } = await client.query('SELECT 1 FROM sites WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
      return rowCount > 0;
    }
    const { rowCount } = await client.query(
      `UPDATE sites SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`, [tenantId, id, ...values]);
    return rowCount > 0;
  });
}

// ---- RBM (Risk-Based Monitoring) ----------------------------------------
/**
 * Une soumission compte comme « collecte réelle » d'un site (alias ms = soumission,
 * mf = sa fiche, s = le site) si elle n'a pas été écartée au nettoyage et si sa
 * fiche n'est pas rattachée à une AUTRE activité que celle du site (une fiche non
 * rattachée compte pour tous les sites de la commune).
 */
const SUBMISSION_COUNTS_FOR_SITE = `NOT ms.excluded
         AND (mf.activity_category IS NULL OR s.activity IS NULL OR lower(btrim(mf.activity_category)) = lower(btrim(s.activity)))`;

const RBM_SELECT = `
  SELECT s.id, s.code, s.name, s.district, s.commune, s.activity, s.risk_level AS "riskLevel",
         s.adm1, s.adm2, s.adm3, s.adm4, s.fokontany,
         s.gps_lat AS "gpsLat", s.gps_lng AS "gpsLng",
         s.field_office_id AS "fieldOfficeId",
         ant.name AS "antenneName",
         COALESCE(par.name, ant.name) AS "subOfficeName",
         s.security_situation AS "security", s.programme_synergies AS "synergies",
         s.beneficiary_over_200 AS "beneficiaryOver200", s.new_partner AS "newPartner",
         s.issues_process AS "issuesProcess", s.issues_partner_report AS "issuesPartnerReport",
         s.issues_cfm AS "issuesCFM", s.fraud_suspected AS "fraud",
         s.location_id AS "locationId", s.poi_subtype AS "poiSubtype", s.urban_area AS "urbanArea",
         s.modality_type AS "modalityType", s.beneficiary_number AS "beneficiaryNumber",
         s.experienced_partner AS "experiencedPartner", to_char(s.last_visit_date, 'YYYY-MM-DD') AS "lastVisitDate",
         s.adm3_pcode AS "adm3Pcode",
         to_char(pv.last, 'YYYY-MM') AS "plannedVisitMonth",
         to_char(dv.last, 'YYYY-MM') AS "dataVisitMonth",
         dv.last_at AS "dataVisitAt",
         COALESCE(dv.n, 0) AS "dataVisitCount",
         -- Dernière visite effective = la plus récente entre le suivi terrain
         -- planifié/réalisé (site_visits) et la COLLECTE RÉELLE issue des
         -- données uploadées (soumissions rattachées par pcode de commune).
         to_char(GREATEST(pv.last, dv.last, date_trunc('month', s.last_visit_date)::date), 'YYYY-MM') AS "lastVisitMonth"
    FROM sites s
    LEFT JOIN field_offices ant ON ant.id = s.field_office_id
    LEFT JOIN field_offices par ON par.id = ant.parent_id
    LEFT JOIN LATERAL (
      SELECT max(period_month) AS last FROM site_visits v
       WHERE v.tenant_id = s.tenant_id AND v.site_id = s.id AND v.status <> 'annule'
    ) pv ON true
    LEFT JOIN LATERAL (
      -- Collecte réelle au niveau commune : la soumission la plus récente dont
      -- le pcode de commune (adm3) correspond à celui du site, hors soumissions
      -- écartées au nettoyage et hors fiches d'une AUTRE activité que le site.
      SELECT max(ms.period_month) AS last, max(ms.submitted_at) AS last_at, count(*) AS n
        FROM monitoring_submissions ms
        JOIN monitoring_forms mf ON mf.id = ms.form_id
       WHERE ms.tenant_id = s.tenant_id
         AND s.adm3_pcode IS NOT NULL AND ms.admin3 = s.adm3_pcode
         AND ${SUBMISSION_COUNTS_FOR_SITE}
    ) dv ON true
   WHERE s.tenant_id = $1`;

/** Site registry with risk level, last visit and whether it is due for `month`. */
async function rbmSites(tenantId, { month, risk } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId]; let where = '';
    if (risk) { params.push(risk); where = ` AND s.risk_level = $${params.length}`; }
    const { rows } = await client.query(`${RBM_SELECT}${where} ORDER BY s.district, s.commune, s.name`, params);
    const target = month ? String(month).slice(0, 7) : null;
    return rows.map((r) => {
      // Intervalle de référence : fréquence RBM selon le niveau de risque
      // (en l'absence d'un paramètre MMR précis pour ce site).
      const interval = frequencyFor(r.riskLevel);
      const score = scoreSite(r, { targetMonth: target, mmrInterval: interval });
      // « À suivre » = retard (score) OU échéance de fréquence atteinte (isDue),
      // pour rester cohérent avec l'ancienne logique.
      const due = target ? (score.due || isDue(r.riskLevel, r.lastVisitMonth, target)) : false;
      return { ...r, ...score, due, interval };
    });
  });
}

/** Import the Master Data site referential (Region/District/Commune/Site/code). */
async function importMasterData(tenantId, rows) {
  return withTenantTransaction(tenantId, async (client) => {
    const clean = rows.filter((r) => r.district && r.commune && r.name);
    let inserted = 0;
    for (const r of clean) {
      const code = (r.code && String(r.code).trim()) || siteCode(r);
      // Rattachement automatique au bureau via le périmètre communes : on prend
      // le bureau le PLUS spécifique couvrant la commune (antenne avant bureau
      // parent, bureau terrain avant bureau pays).
      const resolveOffice = `(SELECT c.office_id FROM field_office_communes c
           JOIN field_offices o ON o.id = c.office_id
          WHERE c.tenant_id = $1 AND lower(btrim(c.commune)) = lower(btrim($4))
          ORDER BY (o.parent_id IS NOT NULL) DESC, o.national ASC, o.code
          LIMIT 1)`;
      const { rows: out } = await client.query(
        `INSERT INTO sites (tenant_id, code, district, commune, fokontany, name, activity, risk_level, adm1, adm2, adm3, adm4, adm2_pcode, adm3_pcode, field_office_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'moyenne'),$9,$3,$4,$5,$10,$11,${resolveOffice})
         ON CONFLICT (tenant_id, code) DO UPDATE SET district = EXCLUDED.district,
           commune = EXCLUDED.commune, fokontany = COALESCE(EXCLUDED.fokontany, sites.fokontany),
           name = EXCLUDED.name, adm1 = COALESCE(EXCLUDED.adm1, sites.adm1),
           adm2 = EXCLUDED.adm2, adm3 = EXCLUDED.adm3, adm4 = COALESCE(EXCLUDED.adm4, sites.adm4),
           adm2_pcode = COALESCE(EXCLUDED.adm2_pcode, sites.adm2_pcode),
           adm3_pcode = COALESCE(EXCLUDED.adm3_pcode, sites.adm3_pcode),
           field_office_id = COALESCE(sites.field_office_id, EXCLUDED.field_office_id)
         RETURNING (xmax = 0) AS inserted`,
        [tenantId, code, r.district, r.commune, r.fokontany || null, r.name, r.activity || null, r.riskLevel || null, r.region || null,
          r.adm2Pcode || null, r.adm3Pcode || null]
      );
      if (out[0].inserted) inserted += 1;
    }
    return { total: clean.length, inserted };
  });
}

/**
 * Import complet du Plan de suivi (feuille « Risk-based site selection ») :
 * upsert des sites avec géographie + critères + SCORE FINAL + GPS + activité +
 * risque (du score) + rattachement bureau (par commune) + dernières visites.
 * `sites` vient de planImport.parsePlanWorkbook.
 */
async function importPlanSites(tenantId, userId, sites) {
  return withTenantTransaction(tenantId, async (client) => {
    // commune (minuscule) → bureau le plus spécifique.
    const { rows: perim } = await client.query(
      `SELECT lower(btrim(c.commune)) AS commune, c.office_id
         FROM field_office_communes c JOIN field_offices o ON o.id = c.office_id
        WHERE c.tenant_id = $1
        ORDER BY (o.parent_id IS NOT NULL) DESC, o.national ASC, o.code`,
      [tenantId]
    );
    const officeByCommune = new Map();
    for (const r of perim) if (!officeByCommune.has(r.commune)) officeByCommune.set(r.commune, r.office_id);

    // Code = slug géographie+nom (stable, unique dans l'import ; on ignore
    // l'« ID Sites » du fichier qui peut être vide ou dupliqué).
    const seenCodes = new Set();
    const uniq = sites.filter((s) => { const c = siteCode(s); if (seenCodes.has(c)) return false; seenCodes.add(c); return true; });
    const COLS = 21; const CH = 200; let upserted = 0; const lastVisits = [];
    for (let i = 0; i < uniq.length; i += CH) {
      const slice = uniq.slice(i, i + CH);
      const params = [tenantId]; const vals = [];
      for (const s of slice) {
        const code = siteCode(s);
        if (s.lastVisit) lastVisits.push({ code, month: s.lastVisit });
        params.push(code, s.name, s.district, s.commune, s.region || null, s.district, s.commune, s.fokontany || null,
          s.risk || 'moyenne', officeByCommune.get(String(s.commune).trim().toLowerCase()) || null, s.activity || null,
          s.gpsLat ?? null, s.gpsLng ?? null, normalizeSecurity(s.security), s.synergies || 0, s.beneficiaryOver200 || 0,
          s.newPartner || 0, s.issuesProcess || 0, s.issuesPartnerReport || 0, s.issuesCFM || 0, s.fraud || 0);
        const b = params.length; const p = (k) => `$${b - COLS + 1 + k}`;
        vals.push(`($1,${Array.from({ length: COLS }, (_, k) => p(k)).join(',')})`);
      }
      const { rowCount } = await client.query(
        `INSERT INTO sites (tenant_id, code, name, district, commune, adm1, adm2, adm3, fokontany,
           risk_level, field_office_id, activity, gps_lat, gps_lng,
           security_situation, programme_synergies, beneficiary_over_200, new_partner,
           issues_process, issues_partner_report, issues_cfm, fraud_suspected)
         VALUES ${vals.join(',')}
         ON CONFLICT (tenant_id, code) DO UPDATE SET
           name = EXCLUDED.name, adm1 = COALESCE(EXCLUDED.adm1, sites.adm1),
           adm2 = EXCLUDED.adm2, adm3 = EXCLUDED.adm3, fokontany = COALESCE(EXCLUDED.fokontany, sites.fokontany),
           risk_level = EXCLUDED.risk_level, field_office_id = COALESCE(EXCLUDED.field_office_id, sites.field_office_id),
           activity = COALESCE(EXCLUDED.activity, sites.activity),
           gps_lat = COALESCE(EXCLUDED.gps_lat, sites.gps_lat), gps_lng = COALESCE(EXCLUDED.gps_lng, sites.gps_lng),
           security_situation = EXCLUDED.security_situation, programme_synergies = EXCLUDED.programme_synergies,
           beneficiary_over_200 = EXCLUDED.beneficiary_over_200, new_partner = EXCLUDED.new_partner,
           issues_process = EXCLUDED.issues_process, issues_partner_report = EXCLUDED.issues_partner_report,
           issues_cfm = EXCLUDED.issues_cfm, fraud_suspected = EXCLUDED.fraud_suspected`,
        params
      );
      upserted += rowCount;
    }
    const total = uniq.length;
    // Dernières visites → visites réalisées datées (idempotent).
    let visits = 0;
    if (lastVisits.length) {
      const idByCode = new Map();
      const codes = lastVisits.map((x) => x.code);
      for (let i = 0; i < codes.length; i += 500) {
        const { rows } = await client.query('SELECT id, code FROM sites WHERE tenant_id = $1 AND code = ANY($2)', [tenantId, codes.slice(i, i + 500)]);
        for (const r of rows) idByCode.set(r.code, r.id);
      }
      for (let i = 0; i < lastVisits.length; i += 200) {
        const slice = lastVisits.slice(i, i + 200).filter((x) => idByCode.get(x.code));
        if (!slice.length) continue;
        const params = [tenantId, userId || null]; const vals = [];
        for (const x of slice) { params.push(idByCode.get(x.code), `${x.month}-01`); const b = params.length; vals.push(`($1,$${b - 1},$${b},'realise',$2)`); }
        const { rowCount } = await client.query(
          `INSERT INTO site_visits (tenant_id, site_id, period_month, status, created_by)
           VALUES ${vals.join(',')} ON CONFLICT DO NOTHING`, params);
        visits += rowCount;
      }
    }
    return { total, upserted, lastVisits: visits };
  });
}

/** Generate the month's planned visits from the RBM: one planifie visit per due
 * site (optionally filtered by risk). Idempotent (skips existing). */
async function generateFromRbm(tenantId, userId, month, { risk } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId]; let where = '';
    if (risk) { params.push(risk); where = ` AND s.risk_level = $${params.length}`; }
    const { rows } = await client.query(`${RBM_SELECT}${where}`, params);
    const target = String(month).slice(0, 7);
    const pm = `${target}-01`;
    let created = 0;
    for (const s of rows) {
      if (!isDue(s.riskLevel, s.lastVisitMonth, target)) continue;
      const res = await client.query(
        `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, created_by)
         VALUES ($1,$2,$3,$4,'planifie',$5)
         ON CONFLICT (tenant_id, site_id, period_month, activity) DO NOTHING`,
        [tenantId, s.id, pm, s.activity || null, userId]
      );
      created += res.rowCount;
    }
    return { created, due: rows.filter((s) => isDue(s.riskLevel, s.lastVisitMonth, target)).length };
  });
}

/** Bulk upsert sites (shared registry) from an import; returns a code→id map. */
async function upsertSites(client, tenantId, sites) {
  const map = new Map();
  let inserted = 0;
  for (const s of sites) {
    const code = siteCode(s);
    const resolveOffice = `(SELECT c.office_id FROM field_office_communes c
         JOIN field_offices o ON o.id = c.office_id
        WHERE c.tenant_id = $1 AND lower(btrim(c.commune)) = lower(btrim($4))
        ORDER BY (o.parent_id IS NOT NULL) DESC, o.national ASC, o.code LIMIT 1)`;
    const { rows } = await client.query(
      `INSERT INTO sites (tenant_id, code, district, commune, fokontany, name, activity, adm2, adm3, adm4, field_office_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$3,$4,$5,${resolveOffice})
       ON CONFLICT (tenant_id, code)
       DO UPDATE SET fokontany = EXCLUDED.fokontany, activity = COALESCE(EXCLUDED.activity, sites.activity),
         adm2 = EXCLUDED.adm2, adm3 = EXCLUDED.adm3, adm4 = COALESCE(EXCLUDED.adm4, sites.adm4),
         field_office_id = COALESCE(sites.field_office_id, EXCLUDED.field_office_id)
       RETURNING id, (xmax = 0) AS inserted`,
      [tenantId, code, s.district, s.commune, s.fokontany || null, s.name, s.activity || null]
    );
    map.set(`${s.district}|${s.commune}|${s.name}`, rows[0].id);
    if (rows[0].inserted) inserted += 1;
  }
  return { map, inserted };
}

const VISIT_COLS = `
  v.id, v.site_id AS "siteId", s.name AS "siteName", s.district, s.commune, s.fokontany,
  v.activity, to_char(v.period_month, 'YYYY-MM') AS "periodMonth",
  v.contract_id AS "contractId", v.provider_id AS "providerId", p.name AS "providerName",
  v.agent, v.status, v.visit_date AS "visitDate",
  -- Dernière collecte réelle (données uploadées) pour la commune du site.
  (SELECT to_char(max(ms.period_month), 'YYYY-MM') FROM monitoring_submissions ms
     JOIN monitoring_forms mf ON mf.id = ms.form_id
     WHERE ms.tenant_id = s.tenant_id AND s.adm3_pcode IS NOT NULL AND ms.admin3 = s.adm3_pcode
       AND ${SUBMISSION_COUNTS_FOR_SITE}) AS "dataVisitMonth"`;

async function listVisits(tenantId, { month, providerId, status } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['v.tenant_id = $1'];
    if (month) { params.push(`${String(month).slice(0, 7)}-01`); where.push(`v.period_month = $${params.length}`); }
    if (providerId) { params.push(providerId); where.push(`v.provider_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`v.status = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT ${VISIT_COLS}
         FROM site_visits v
         JOIN sites s ON s.id = v.site_id
         LEFT JOIN partners p ON p.id = v.provider_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.district, s.commune, s.name`,
      params
    );
    return rows;
  });
}

/**
 * Vue par mois d'une année : une ligne par mois avec ses stats de visites
 * (planifiées / réalisées / annulées / couverture / sites). Agrégé en SQL ;
 * les 12 mois sont toujours renvoyés (0 si aucune visite).
 */
async function monthsOverview(tenantId, { year } = {}) {
  const y = Number(year) || new Date().getFullYear();
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT to_char(period_month, 'YYYY-MM') AS month,
              count(*)::int AS total,
              count(*) FILTER (WHERE status = 'planifie')::int AS planifie,
              count(*) FILTER (WHERE status = 'realise')::int AS realise,
              count(*) FILTER (WHERE status = 'annule')::int AS annule,
              count(DISTINCT site_id)::int AS sites,
              count(DISTINCT provider_id) FILTER (WHERE provider_id IS NOT NULL)::int AS providers
         FROM site_visits
        WHERE tenant_id = $1 AND date_part('year', period_month) = $2
        GROUP BY 1`,
      [tenantId, y]
    );
    // Situation (workflow) du plan par mois.
    const { rows: statuses } = await client.query(
      `SELECT to_char(period_month, 'YYYY-MM') AS month, status
         FROM field_month_plans WHERE tenant_id = $1 AND date_part('year', period_month) = $2`,
      [tenantId, y]
    );
    const statusByMonth = new Map(statuses.map((r) => [r.month, r.status]));
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    const out = [];
    for (let m = 1; m <= 12; m += 1) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const r = byMonth.get(key) || { month: key, total: 0, planifie: 0, realise: 0, annule: 0, sites: 0, providers: 0 };
      const done = r.realise;
      const base = r.planifie + r.realise; // annulées exclues du taux
      r.coverage = base > 0 ? done / base : 0;
      // Statut explicite si saisi ; sinon « draft » dès qu'il y a des visites, « vide » sinon.
      r.status = statusByMonth.get(key) || (r.total > 0 ? 'draft' : 'vide');
      out.push(r);
    }
    return { year: y, months: out };
  });
}

/**
 * Données pour la carte des sites : agrégation géographique (région → district
 * → commune avec mix de risque et couverture) + points GPS des sites qui en ont.
 * Agrégé en SQL. Filtrable par bureau (sous-arbre côté client via field_office_id).
 */
async function mapData(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: communes } = await client.query(
      `SELECT COALESCE(s.adm1, '') AS region, COALESCE(s.adm2, s.district, '') AS district,
              COALESCE(s.adm3, s.commune, '') AS commune,
              count(*)::int AS sites,
              count(*) FILTER (WHERE s.risk_level = 'elevee')::int AS elevee,
              count(*) FILTER (WHERE s.risk_level = 'moyenne')::int AS moyenne,
              count(*) FILTER (WHERE s.risk_level = 'faible')::int AS faible,
              count(DISTINCT v.site_id)::int AS visited
         FROM sites s
         LEFT JOIN site_visits v ON v.site_id = s.id AND v.tenant_id = s.tenant_id AND v.status = 'realise'
        WHERE s.tenant_id = $1
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3`,
      [tenantId]
    );
    const { rows: points } = await client.query(
      `SELECT s.id, s.name, s.gps_lat::float8 AS lat, s.gps_lng::float8 AS lng,
              s.risk_level AS "riskLevel", COALESCE(s.adm2, s.district) AS district,
              COALESCE(s.adm3, s.commune) AS commune, ant.name AS "antenneName"
         FROM sites s LEFT JOIN field_offices ant ON ant.id = s.field_office_id
        WHERE s.tenant_id = $1 AND s.gps_lat IS NOT NULL AND s.gps_lng IS NOT NULL`,
      [tenantId]
    );
    return { communes, points };
  });
}

/** Définit (upsert) la situation du plan mensuel. */
async function setMonthStatus(tenantId, { month, status }, userId) {
  const pm = `${String(month).slice(0, 7)}-01`;
  return withTenantTransaction(tenantId, async (client) => {
    await client.query(
      `INSERT INTO field_month_plans (tenant_id, period_month, status, updated_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, period_month)
       DO UPDATE SET status = EXCLUDED.status, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [tenantId, pm, status, userId]
    );
    return true;
  });
}

async function summary(tenantId, { month } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['v.tenant_id = $1'];
    if (month) { params.push(`${String(month).slice(0, 7)}-01`); where.push(`v.period_month = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT v.status, v.provider_id AS "providerId", p.name AS "providerName", s.district, v.activity
         FROM site_visits v JOIN sites s ON s.id = v.site_id
         LEFT JOIN partners p ON p.id = v.provider_id
        WHERE ${where.join(' AND ')}`,
      params
    );
    const providerLabel = {};
    for (const r of rows) if (r.providerId) providerLabel[r.providerId] = r.providerName;
    return summarizeVisits(rows, providerLabel);
  });
}

/**
 * Récap de couverture : par site, le nombre de visites RÉALISÉES (agrégé en
 * SQL), puis le récap pur par niveau de risque (coverageRecap). Optionnellement
 * filtré par district (adm2). `operationMonths` fixe les visites requises MMR.
 */
async function coverageRecapSummary(tenantId, { district, operationMonths = 12 } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['s.tenant_id = $1'];
    if (district) { params.push(district); where.push(`(s.adm2 = $${params.length} OR s.district = $${params.length})`); }
    const { rows } = await client.query(
      `SELECT s.risk_level AS "riskLevel",
              COUNT(v.id) FILTER (WHERE v.status = 'realise') AS "visitCount"
         FROM sites s
         LEFT JOIN site_visits v ON v.site_id = s.id AND v.tenant_id = s.tenant_id
        WHERE ${where.join(' AND ')}
        GROUP BY s.id, s.risk_level`,
      params
    );
    const recap = coverageRecap(rows.map((r) => ({ riskLevel: r.riskLevel, visitCount: Number(r.visitCount) })), operationMonths);
    // Liste des districts pour le filtre.
    const { rows: districts } = await client.query(
      `SELECT DISTINCT COALESCE(adm2, district) AS d FROM sites WHERE tenant_id = $1 AND COALESCE(adm2, district) IS NOT NULL ORDER BY d`,
      [tenantId]
    );
    return { ...recap, operationMonths, districts: districts.map((x) => x.d) };
  });
}

/**
 * Matrice de couverture mensuelle pour une année : par programme (activité) et
 * par prestataire TPM — planifiées/réalisées et taux par mois. Agrégé en SQL,
 * mis en forme par la logique pure testée `buildCoverageMatrix`.
 */
async function coverageMatrix(tenantId, { year } = {}) {
  const y = Number(year) || new Date().getFullYear();
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: act } = await client.query(
      `SELECT to_char(period_month, 'YYYY-MM') AS month,
              COALESCE(NULLIF(activity, ''), '—') AS key,
              COALESCE(NULLIF(activity, ''), '—') AS label,
              count(*) FILTER (WHERE status = 'planifie')::int AS planifie,
              count(*) FILTER (WHERE status = 'realise')::int AS realise
         FROM site_visits
        WHERE tenant_id = $1 AND date_part('year', period_month) = $2
        GROUP BY 1, 2, 3`,
      [tenantId, y]
    );
    const { rows: prov } = await client.query(
      `SELECT to_char(v.period_month, 'YYYY-MM') AS month,
              COALESCE(v.provider_id::text, 'non_affecte') AS key,
              COALESCE(p.name, 'Non affecté') AS label,
              count(*) FILTER (WHERE v.status = 'planifie')::int AS planifie,
              count(*) FILTER (WHERE v.status = 'realise')::int AS realise
         FROM site_visits v LEFT JOIN partners p ON p.id = v.provider_id
        WHERE v.tenant_id = $1 AND date_part('year', v.period_month) = $2
        GROUP BY 1, 2, 3`,
      [tenantId, y]
    );
    // Années disponibles (pour le sélecteur).
    const { rows: yrs } = await client.query(
      `SELECT DISTINCT date_part('year', period_month)::int AS y FROM site_visits WHERE tenant_id = $1 ORDER BY y DESC`,
      [tenantId]
    );
    return { year: y, years: yrs.map((r) => r.y), byActivity: buildCoverageMatrix(act, y), byProvider: buildCoverageMatrix(prov, y) };
  });
}

/**
 * Jours de collecte par prestataire pour un mois = visites datées (non
 * annulées) + jours de déplacement manuels (tpm_collection_days).
 */
async function collectionDaysSummary(tenantId, { month } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const pm = month ? `${String(month).slice(0, 7)}-01` : null;
    const vParams = [tenantId]; const vWhere = ['v.tenant_id = $1'];
    if (pm) { vParams.push(pm); vWhere.push(`v.period_month = $${vParams.length}`); }
    const { rows: visits } = await client.query(
      `SELECT v.provider_id AS "providerId", p.name AS "providerName", v.status,
              v.visit_date AS "visitDate"
         FROM site_visits v LEFT JOIN partners p ON p.id = v.provider_id
        WHERE ${vWhere.join(' AND ')}`,
      vParams
    );
    const tParams = [tenantId]; const tWhere = ['tenant_id = $1'];
    if (pm) { tParams.push(pm); tWhere.push(`period_month = $${tParams.length}`); }
    const { rows: travel } = await client.query(
      `SELECT provider_id AS "providerId", travel_days AS "travelDays" FROM tpm_collection_days WHERE ${tWhere.join(' AND ')}`,
      tParams
    );
    const travelByProvider = {}; const providerLabel = {};
    for (const t of travel) travelByProvider[t.providerId] = t.travelDays;
    for (const v of visits) if (v.providerId) providerLabel[v.providerId] = v.providerName;
    return collectionDays(visits, travelByProvider, providerLabel);
  });
}

async function setTravelDays(tenantId, { providerId, month, travelDays }) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query(
      `INSERT INTO tpm_collection_days (tenant_id, provider_id, period_month, travel_days)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, provider_id, period_month)
       DO UPDATE SET travel_days = EXCLUDED.travel_days, updated_at = now()`,
      [tenantId, providerId, `${String(month).slice(0, 7)}-01`, Math.max(0, Math.round(Number(travelDays) || 0))]
    );
    return true;
  });
}

async function createVisit(tenantId, userId, v) {
  return withTenantTransaction(tenantId, async (client) => {
    try {
      const { rows } = await client.query(
        `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, contract_id, provider_id, agent, status, visit_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenantId, v.siteId, `${String(v.periodMonth).slice(0, 7)}-01`, v.activity || null,
          v.contractId || null, v.providerId || null, v.agent || null, v.status || 'planifie', v.visitDate || null, userId]
      );
      return rows[0].id;
    } catch (err) {
      if (err.code === '23505') { const e = new Error('Une visite existe déjà pour ce site, ce mois et cette activité.'); e.status = 409; throw e; }
      throw err;
    }
  });
}

/** Mise à jour partielle d'une visite : champ absent = inchangé, null = effacé (désaffectation possible). */
async function updateVisit(tenantId, id, patch) {
  const given = (k) => patch[k] !== undefined;
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE site_visits
          SET provider_id = CASE WHEN $3::boolean THEN $4::uuid ELSE provider_id END,
              agent = CASE WHEN $5::boolean THEN $6 ELSE agent END,
              contract_id = CASE WHEN $7::boolean THEN $8::uuid ELSE contract_id END,
              status = COALESCE($9, status),
              visit_date = CASE WHEN $10::boolean THEN $11::date ELSE visit_date END, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, given('providerId'), patch.providerId ?? null, given('agent'), patch.agent ?? null,
        given('contractId'), patch.contractId ?? null, patch.status ?? null, given('visitDate'), patch.visitDate ?? null]
    );
    return rowCount > 0;
  });
}

async function deleteVisit(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM site_visits WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rowCount > 0;
  });
}

/**
 * Import a planning: create/keep the sites (shared registry) and plan their
 * visits for a month. `rows`: [{ district, commune, fokontany, name, activity,
 * agent }]. One visit per (site, activity) for the month; existing ones are
 * skipped (idempotent).
 */
async function importPlanning(tenantId, userId, month, rows) {
  return withTenantTransaction(tenantId, async (client) => {
    const clean = rows.filter((r) => r.district && r.commune && r.name);
    const { map, inserted } = await upsertSites(client, tenantId, clean);
    let visits = 0;
    const pm = `${String(month).slice(0, 7)}-01`;
    for (const r of clean) {
      const siteId = map.get(`${r.district}|${r.commune}|${r.name}`);
      if (!siteId) continue;
      const res = await client.query(
        `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, agent, status, created_by)
         VALUES ($1,$2,$3,$4,$5,'planifie',$6)
         ON CONFLICT (tenant_id, site_id, period_month, activity) DO NOTHING`,
        [tenantId, siteId, pm, r.activity || null, r.agent || null, userId]
      );
      visits += res.rowCount;
    }
    return { sitesInserted: inserted, sitesTotal: clean.length, visitsCreated: visits };
  });
}

/**
 * Données « terrain » d'un rapport sur une période [from, to] (mois inclus) :
 * par bureau (antenne comptée avec son bureau parent) — sites du référentiel,
 * visites planifiées (non annulées) et réalisées — et par mois. Agrégé en SQL.
 */
async function reportFieldData(tenantId, { from, to }) {
  return withTenantTransaction(tenantId, async (client) => {
    const p = [tenantId, `${from}-01`, `${to}-01`];
    const { rows: byOffice } = await client.query(
      `WITH s AS (
         SELECT st.id, COALESCE(par.name, o.name, '(non rattaché)') AS bureau
           FROM sites st LEFT JOIN field_offices o ON o.id = st.field_office_id LEFT JOIN field_offices par ON par.id = o.parent_id
          WHERE st.tenant_id = $1)
       SELECT s.bureau, count(DISTINCT s.id)::int AS "sitesActive",
              count(v.id) FILTER (WHERE v.status <> 'annule')::int AS planned,
              count(v.id) FILTER (WHERE v.status = 'realise')::int AS done,
              count(DISTINCT v.site_id) FILTER (WHERE v.status = 'realise')::int AS "sitesVisited"
         FROM s LEFT JOIN site_visits v ON v.site_id = s.id AND v.tenant_id = $1 AND v.period_month BETWEEN $2 AND $3
        GROUP BY s.bureau ORDER BY "sitesActive" DESC`, p);
    const { rows: monthly } = await client.query(
      `SELECT to_char(period_month, 'YYYY-MM') AS month,
              count(*) FILTER (WHERE status <> 'annule')::int AS planned,
              count(*) FILTER (WHERE status = 'realise')::int AS done
         FROM site_visits WHERE tenant_id = $1 AND period_month BETWEEN $2 AND $3
        GROUP BY 1 ORDER BY 1`, p);
    return { byOffice, monthly };
  });
}

/**
 * Plan de suivi d'un exercice : sites (critères, bureau + parent, dernière
 * visite effective, données reçues), visites de l'année agrégées en SQL par
 * site (json_agg) et lignes MMR — puis compteurs exigées/faites/prévues/reste,
 * priorité et classement par la logique pure (planBoard, rbmScore).
 */
async function planBoard(tenantId, opts) {
  return withTenantTransaction(tenantId, (client) => planBoardTx(client, tenantId, opts));
}

async function planBoardTx(client, tenantId, { year, adjusted = false }) {
  const y = Number(year);
  const params = [tenantId, `${y}-01-01`, `${y}-12-01`];
  const { rows: sites } = await client.query(
    `WITH base AS (${RBM_SELECT}),
     -- Position de repli d'un site sans GPS : centroïde de sa commune (P-code, puis nom dans
     -- son district), moyenne des sites géolocalisés de la commune, centroïde du district.
     communes AS (
       SELECT DISTINCT ON (lower(c.name), lower(p.name)) c.pcode, lower(c.name) AS lc, lower(p.name) AS ld, c.lat::float8 AS lat, c.lng::float8 AS lng
         FROM admin_areas c JOIN admin_areas p ON p.id = c.parent_id
        WHERE c.tenant_id = $1 AND c.depth = 3 AND c.lat IS NOT NULL
        ORDER BY lower(c.name), lower(p.name), c.pcode NULLS LAST),
     districts AS (
       SELECT DISTINCT ON (lower(name)) lower(name) AS ld, lat::float8 AS lat, lng::float8 AS lng
         FROM admin_areas WHERE tenant_id = $1 AND depth = 2 AND lat IS NOT NULL ORDER BY lower(name), pcode NULLS LAST),
     site_gps AS (
       SELECT lower(COALESCE(adm3, commune)) AS lc, lower(COALESCE(adm2, district)) AS ld, avg(gps_lat)::float8 AS lat, avg(gps_lng)::float8 AS lng
         FROM sites WHERE tenant_id = $1 AND gps_lat IS NOT NULL AND gps_lng IS NOT NULL GROUP BY 1, 2)
     SELECT b.*, o.parent_id AS "parentOfficeId",
            CASE WHEN b."gpsLat" IS NOT NULL AND b."gpsLng" IS NOT NULL THEN 'gps'
                 WHEN cp.lat IS NOT NULL OR cn.lat IS NOT NULL OR sg.lat IS NOT NULL THEN 'commune'
                 WHEN dn.lat IS NOT NULL THEN 'district' END AS geo,
            COALESCE(b."gpsLat"::float8, cp.lat, cn.lat, sg.lat, dn.lat) AS "mapLat",
            COALESCE(b."gpsLng"::float8, cp.lng, cn.lng, sg.lng, dn.lng) AS "mapLng",
            COALESCE(vv.months, '[]'::json) AS months,
            (SELECT json_object_agg(ms.month, ms.active) FROM site_month_status ms
              WHERE ms.tenant_id = $1 AND ms.site_id = b.id AND ms.year = extract(year FROM $2::date)) AS "monthStatus"
       FROM base b
       LEFT JOIN field_offices o ON o.id = b."fieldOfficeId"
       LEFT JOIN communes cp ON cp.pcode = b."adm3Pcode"
       LEFT JOIN communes cn ON cp.pcode IS NULL AND cn.lc = lower(COALESCE(b.adm3, b.commune)) AND cn.ld = lower(COALESCE(b.adm2, b.district))
       LEFT JOIN site_gps sg ON sg.lc = lower(COALESCE(b.adm3, b.commune)) AND sg.ld = lower(COALESCE(b.adm2, b.district))
       LEFT JOIN districts dn ON dn.ld = lower(COALESCE(b.adm2, b.district))
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('month', extract(month FROM v.period_month)::int, 'status', v.status,
                                           'date', to_char(v.visit_date, 'YYYY-MM-DD')) ORDER BY v.period_month) AS months
           FROM site_visits v
          WHERE v.tenant_id = $1 AND v.site_id = b.id AND v.status <> 'annule' AND v.period_month BETWEEN $2 AND $3
       ) vv ON true
      ORDER BY b.district, b.commune, b.name`, params);
  const { rows: mmr } = await client.query(
    `SELECT field_office_id AS "fieldOfficeId", activity_category AS "activityCategory", operation_duration AS "operationDuration",
            number_of_sites AS "numberOfSites", risk_level AS "riskLevel", feasible, persons_to_deploy AS "personsToDeploy",
            visits_per_day::float8 AS "visitsPerDay", working_days AS "workingDays"
       FROM mmr_parameters WHERE tenant_id = $1`, [tenantId]);
  const lookup = mmrLookup(mmr);
  const target = `${y}-12`;
  const out = sites.map((s) => {
    const mmrRow = lookup(s.fieldOfficeId, s.parentOfficeId, s.activity);
    const score = scoreSite(s, { targetMonth: target });
    const counters = siteCounters({ months: s.months }, mmrRow, { adjusted });
    const status = currentStatus(s.monthStatus);
    return {
      id: s.id, code: s.code, locationId: s.locationId, name: s.name, region: s.adm1, district: s.district, commune: s.commune,
      activity: s.activity, bureau: s.subOfficeName || s.antenneName || null, fieldOfficeId: s.fieldOfficeId, mmrKey: mmrKeyOf(mmrRow),
      riskLevel: s.riskLevel, priority: score.priorityLabel, finalScore: score.finalScore,
      forbidden: Number(s.security) >= 99,
      status, inactive: status === 'Inactive', monthStatus: s.monthStatus || {},
      lastVisitMonth: s.lastVisitMonth, dataCount: s.dataVisitCount, months: s.months,
      // Registre « Locations Management » (vue standard, carte)
      poiSubtype: s.poiSubtype, urbanArea: s.urbanArea, gpsLat: s.gpsLat, gpsLng: s.gpsLng, security: s.security,
      mapLat: s.mapLat, mapLng: s.mapLng, geo: s.geo,
      synergies: s.synergies, modalityType: s.modalityType, beneficiaryNumber: s.beneficiaryNumber, newPartner: s.newPartner,
      experiencedPartner: s.experiencedPartner, lastVisitDate: s.lastVisitDate, issuesProcess: s.issuesProcess,
      issuesPartnerReport: s.issuesPartnerReport, issuesCFM: s.issuesCFM, fraud: s.fraud,
      ...counters,
    };
  });
  // Capacité mensuelle par ligne MMR (pied de grille). Nombre de sites non saisi → sites actifs du périmètre.
  const counted = new Map();
  for (const s of out) if (s.mmrKey && !s.inactive && !s.forbidden) counted.set(s.mmrKey, (counted.get(s.mmrKey) || 0) + 1);
  const capacity = mmrCapacity(mmr.map((r) => (r.numberOfSites == null ? { ...r, numberOfSites: counted.get(mmrKeyOf(r)) || 0 } : r)));
  return { year: y, adjusted, sites: rankSites(out), kpis: boardKpis(out), capacity };
}

/**
 * Planification par lot (cases des mois cochées / décochées), TOUT OU RIEN :
 * une insertion multi-lignes idempotente (ON CONFLICT) et une suppression des
 * seules visites encore « planifiées » (une visite réalisée n'est jamais effacée).
 */
async function setPlannedMonths(tenantId, userId, { year, changes }) {
  return withTenantTransaction(tenantId, (client) => planMonthsTx(client, tenantId, userId, year, changes));
}

async function planMonthsTx(client, tenantId, userId, year, changes) {
  let { add } = normalizeChanges(changes);
  const { remove } = normalizeChanges(changes);
  const ids = [...new Set([...add, ...remove].map(([id]) => id))];
  if (!ids.length) return { added: 0, removed: 0 };
  const { rows: known } = await client.query('SELECT id, activity FROM sites WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
  if (known.length !== ids.length) throw badRequest('Site inconnu (ou hors de ce compte).');
  const activity = new Map(known.map((k) => [k.id, k.activity || null]));
  const pm = (m) => `${year}-${String(m).padStart(2, '0')}-01`;
  let added = 0; let removed = 0;
  // Un site « Inactive » sur un mois n'est pas planifiable ce mois-là.
  const { rows: inactive } = await client.query(
    'SELECT site_id, month FROM site_month_status WHERE tenant_id = $1 AND year = $2 AND NOT active AND site_id = ANY($3::uuid[])', [tenantId, year, ids]);
  const blocked = new Set(inactive.map((r) => `${r.site_id}|${r.month}`));
  const skippedInactive = add.filter(([id, m]) => blocked.has(`${id}|${m}`)).length;
  add = add.filter(([id, m]) => !blocked.has(`${id}|${m}`));
  // Par lots (limite de paramètres de PostgreSQL) : 5 000 sites × 12 mois en une modification groupée.
  for (const slice of chunkRows(add, 3)) {
    const params = [tenantId, userId]; const tuples = slice.map(([id, m]) => {
      params.push(id, pm(m), activity.get(id));
      const b = params.length - 2;
      return `($1, $${b}::uuid, $${b + 1}::date, $${b + 2}, 'planifie', $2)`;
    });
    const { rowCount } = await client.query(
      `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, created_by) VALUES ${tuples.join(',')}
       ON CONFLICT (tenant_id, site_id, period_month, activity) DO UPDATE SET status = 'planifie', updated_at = now()
         WHERE site_visits.status = 'annule'`, params);
    added += rowCount;
  }
  for (const slice of chunkRows(remove, 2)) {
    const params = [tenantId]; const tuples = slice.map(([id, m]) => { params.push(id, pm(m)); return `($${params.length - 1}::uuid, $${params.length}::date)`; });
    const { rowCount } = await client.query(
      `DELETE FROM site_visits v USING (VALUES ${tuples.join(',')}) AS x(site_id, pm)
        WHERE v.tenant_id = $1 AND v.site_id = x.site_id AND v.period_month = x.pm AND v.status = 'planifie'`, params);
    removed += rowCount;
  }
  return { added, removed, skippedInactive };
}

// ---- Registre « Locations Management » : export / import Excel ---------------
const SITE_UPD_COLS = ['location_id', 'name', 'poi_subtype', 'activity', 'field_office_id', 'adm1', 'adm2', 'adm3', 'district', 'commune',
  'urban_area', 'gps_lat', 'gps_lng', 'security_situation', 'programme_synergies', 'modality_type', 'beneficiary_number', 'new_partner',
  'experienced_partner', 'last_visit_date', 'issues_process', 'issues_partner_report', 'issues_cfm', 'fraud_suspected'];
const SITE_UPD_TYPES = ['text', 'text', 'text', 'text', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'numeric', 'numeric',
  'smallint', 'smallint', 'text', 'int', 'smallint', 'smallint', 'date', 'smallint', 'smallint', 'smallint', 'smallint'];
const siteVals = (r) => [r.locationId, r.name, r.poiSubtype, r.activity, r.officeId, r.admin1, r.admin2, r.admin3, r.admin2, r.admin3,
  r.urbanArea, r.gpsLat, r.gpsLng, r.security, r.synergies, r.modalityType, r.beneficiaryNumber, r.newPartner, r.experiencedPartner,
  r.lastVisitDate, r.issuesProcess, r.issuesPartnerReport, r.issuesCFM, r.fraud];

/** Données d'export du registre pour un exercice (sites + statuts + visites + bureaux). */
async function locationsExportData(tenantId, { year }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: sites } = await client.query(
      `SELECT s.id, s.location_id AS "locationId", s.name, s.poi_subtype AS "poiSubtype", s.activity,
              o.name AS "officeName", s.adm1 AS admin1, COALESCE(s.adm2, s.district) AS admin2, COALESCE(s.adm3, s.commune) AS admin3,
              s.urban_area AS "urbanArea", s.gps_lat::float8 AS "gpsLat", s.gps_lng::float8 AS "gpsLng", s.security_situation AS security,
              s.programme_synergies AS synergies, s.modality_type AS "modalityType", s.beneficiary_number AS "beneficiaryNumber",
              s.new_partner AS "newPartner", s.experienced_partner AS "experiencedPartner", to_char(s.last_visit_date, 'YYYY-MM-DD') AS "lastVisitDate",
              s.issues_process AS "issuesProcess", s.issues_partner_report AS "issuesPartnerReport", s.issues_cfm AS "issuesCFM", s.fraud_suspected AS fraud,
              (SELECT json_object_agg(ms.month, ms.active) FROM site_month_status ms WHERE ms.site_id = s.id AND ms.year = $2) AS "monthStatus",
              (SELECT json_object_agg(extract(month FROM v.period_month)::int, v.status) FROM site_visits v
                WHERE v.tenant_id = s.tenant_id AND v.site_id = s.id AND v.status <> 'annule' AND extract(year FROM v.period_month) = $2) AS visits
         FROM sites s LEFT JOIN field_offices o ON o.id = s.field_office_id
        WHERE s.tenant_id = $1 ORDER BY s.location_id NULLS LAST, s.district, s.commune, s.name`, [tenantId, year]);
    const { rows: offices } = await client.query(
      `SELECT o.name, o.code, p.code AS "parentCode" FROM field_offices o LEFT JOIN field_offices p ON p.id = o.parent_id
        WHERE o.tenant_id = $1 AND o.active ORDER BY o.code`, [tenantId]);
    return { sites: sites.map((x) => ({ ...x, finalScore: scoreSite(x, {}).finalScore })), offices };
  });
}

/**
 * Import du registre (lignes déjà validées par parseLocationsWorkbook).
 * Rapproche par ID L### puis par district + commune + nom ; `commit=false` =
 * aperçu (rien n'est écrit). En écriture : mises à jour, créations, statuts
 * mensuels et mois prévus — requêtes multi-lignes, une seule transaction.
 */
async function importLocations(tenantId, userId, { year, rows }, { commit = false } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: existing } = await client.query('SELECT id, code, location_id FROM sites WHERE tenant_id = $1', [tenantId]);
    const byLoc = new Map(existing.filter((e) => e.location_id).map((e) => [e.location_id, e.id]));
    const byCode = new Map(existing.map((e) => [e.code, e.id]));
    let nextNum = existing.reduce((m, e) => Math.max(m, Number(String(e.location_id || '').slice(1)) || 0), 0);
    const plan = rows.map((r) => {
      const code = siteCode({ district: r.admin2 || '', commune: r.admin3 || '', name: r.name });
      const id = (r.locationId && byLoc.get(r.locationId)) || byCode.get(code) || null;
      return { ...r, code, id };
    });
    const toUpdate = plan.filter((p) => p.id); const toCreate = plan.filter((p) => !p.id);
    const summary = { read: rows.length, updated: toUpdate.length, created: toCreate.length };
    if (!commit) return { ...summary, committed: false };

    for (const p of toCreate) if (!p.locationId) { nextNum += 1; p.locationId = `L${String(nextNum).padStart(3, '0')}`; }
    const CH = 400;
    for (let i = 0; i < toUpdate.length; i += CH) {
      const slice = toUpdate.slice(i, i + CH); const params = [tenantId];
      const tuples = slice.map((p) => {
        const vals = [p.id, ...siteVals(p)]; const types = ['uuid', ...SITE_UPD_TYPES];
        return `(${vals.map((v, k) => { params.push(v ?? null); return `$${params.length}::${types[k]}`; }).join(',')})`;
      });
      await client.query(
        `UPDATE sites s SET ${SITE_UPD_COLS.map((c) => (c === 'location_id' ? 'location_id = COALESCE(v.location_id, s.location_id)' : `${c} = v.${c}`)).join(', ')}
           FROM (VALUES ${tuples.join(',')}) AS v(id, ${SITE_UPD_COLS.join(', ')})
          WHERE s.tenant_id = $1 AND s.id = v.id`, params);
    }
    for (let i = 0; i < toCreate.length; i += CH) {
      const slice = toCreate.slice(i, i + CH); const params = [tenantId];
      const tuples = slice.map((p) => {
        const vals = [p.code, ...siteVals(p)]; const types = ['text', ...SITE_UPD_TYPES];
        return `($1, ${vals.map((v, k) => { params.push(v ?? null); return `$${params.length}::${types[k]}`; }).join(',')})`;
      });
      const { rows: ins } = await client.query(
        `INSERT INTO sites (tenant_id, code, ${SITE_UPD_COLS.join(', ')}) VALUES ${tuples.join(',')} RETURNING id, code`, params);
      const idByCode = new Map(ins.map((x) => [x.code, x.id]));
      slice.forEach((p) => { p.id = idByCode.get(p.code); });
    }
    let statuses = 0; let plannedAdded = 0;
    if (year) {
      const st = plan.flatMap((p) => Object.entries(p.monthStatus || {}).map(([m, a]) => [p.id, Number(m), a]));
      for (let i = 0; i < st.length; i += 2000) {
        const slice = st.slice(i, i + 2000); const params = [tenantId, year];
        const tuples = slice.map(([sid, m, a]) => { params.push(sid, m, a); const b = params.length - 2; return `($1, $${b}::uuid, $2, $${b + 1}::smallint, $${b + 2}::boolean)`; });
        const r = await client.query(
          `INSERT INTO site_month_status (tenant_id, site_id, year, month, active) VALUES ${tuples.join(',')}
           ON CONFLICT (site_id, year, month) DO UPDATE SET active = EXCLUDED.active, updated_at = now()`, params);
        statuses += r.rowCount;
      }
      const pv = plan.flatMap((p) => (p.planned || []).map((m) => [p.id, m, p.activity]));
      for (let i = 0; i < pv.length; i += 2000) {
        const slice = pv.slice(i, i + 2000); const params = [tenantId, userId];
        const tuples = slice.map(([sid, m, act]) => { params.push(sid, `${year}-${String(m).padStart(2, '0')}-01`, act); const b = params.length - 2; return `($1, $${b}::uuid, $${b + 1}::date, $${b + 2}, 'planifie', $2)`; });
        const r = await client.query(
          `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, created_by) VALUES ${tuples.join(',')}
           ON CONFLICT (tenant_id, site_id, period_month, activity) DO NOTHING`, params);
        plannedAdded += r.rowCount;
      }
    }
    return { ...summary, committed: true, statuses, plannedAdded };
  });
}

/** Statuts mensuels Active/Inactive par lot (null = effacer le mois), une transaction. */
async function setMonthStatuses(tenantId, { year, changes }) {
  return withTenantTransaction(tenantId, (client) => monthStatusesTx(client, tenantId, year, changes));
}

async function monthStatusesTx(client, tenantId, year, changes) {
  const last = new Map();
  for (const c of changes) last.set(`${c.siteId}|${c.month}`, c);
  const list = [...last.values()];
  const ids = [...new Set(list.map((c) => c.siteId))];
  const { rows: known } = await client.query('SELECT id FROM sites WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
  if (known.length !== ids.length) throw badRequest('Site inconnu (ou hors de ce compte).');
  const set = list.filter((c) => c.active !== null); const clear = list.filter((c) => c.active === null);
  let updated = 0; let cleared = 0;
  for (const slice of chunkRows(set, 3)) {
    const params = [tenantId, year]; const tuples = slice.map((c) => { params.push(c.siteId, c.month, c.active); const b = params.length - 2; return `($1, $${b}::uuid, $2, $${b + 1}::smallint, $${b + 2}::boolean)`; });
    const { rowCount } = await client.query(
      `INSERT INTO site_month_status (tenant_id, site_id, year, month, active) VALUES ${tuples.join(',')}
       ON CONFLICT (site_id, year, month) DO UPDATE SET active = EXCLUDED.active, updated_at = now()`, params);
    updated += rowCount;
  }
  for (const slice of chunkRows(clear, 2)) {
    const params = [tenantId, year]; const tuples = slice.map((c) => { params.push(c.siteId, c.month); return `($${params.length - 1}::uuid, $${params.length}::smallint)`; });
    const { rowCount } = await client.query(
      `DELETE FROM site_month_status m USING (VALUES ${tuples.join(',')}) AS x(site_id, month)
        WHERE m.tenant_id = $1 AND m.year = $2 AND m.site_id = x.site_id AND m.month = x.month`, params);
    cleared += rowCount;
  }
  return { updated, cleared };
}

// ---- Plan de suivi : modification groupée et ajout de site ---------------------
const BULK_SITE_FIELDS = {
  fieldOfficeId: 'field_office_id', activity: 'activity', poiSubtype: 'poi_subtype', urbanArea: 'urban_area', modalityType: 'modality_type',
  security: 'security_situation', synergies: 'programme_synergies', newPartner: 'new_partner', experiencedPartner: 'experienced_partner',
  issuesProcess: 'issues_process', issuesPartnerReport: 'issues_partner_report', issuesCFM: 'issues_cfm', fraud: 'fraud_suspected',
};

/** Bureau du tenant (jamais un identifiant d'un autre compte) ; null autorisé (sans bureau). */
async function assertOffice(client, tenantId, officeId) {
  if (!officeId) return;
  const { rowCount } = await client.query('SELECT 1 FROM field_offices WHERE tenant_id = $1 AND id = $2', [tenantId, officeId]);
  if (!rowCount) throw badRequest('Bureau inconnu.');
}

/** Activity Tag = une catégorie du MMR (libellé canonique) ; texte libre seulement si le MMR est vide. */
async function canonicalActivity(client, tenantId, activity) {
  if (activity == null || activity === '') return null;
  const { rows } = await client.query('SELECT DISTINCT activity_category AS a FROM mmr_parameters WHERE tenant_id = $1', [tenantId]);
  if (!rows.length) return activity;
  const hit = rows.find((r) => norm(r.a) === norm(activity));
  if (!hit) throw badRequest(`Activité inconnue du MMR : « ${activity} ». Choisissez une catégorie paramétrée dans le MMR.`);
  return hit.a.trim();
}

/**
 * Modification groupée, TOUT OU RIEN : champs du registre, statut mensuel sur
 * une plage de mois, puis planification (un mois coché/décoché, ou répartition
 * des visites restantes selon le MMR). Le statut est appliqué avant la
 * planification : un mois rendu inactif n'est pas planifié.
 */
async function bulkUpdateSites(tenantId, userId, { year, siteIds, set = {}, status = null, plan = null }) {
  return withTenantTransaction(tenantId, async (client) => {
    const ids = [...new Set(siteIds)];
    const { rows: known } = await client.query('SELECT id FROM sites WHERE tenant_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE', [tenantId, ids]);
    if (known.length !== ids.length) throw badRequest('Site inconnu (ou hors de ce compte).');
    const result = { sites: ids.length, updated: 0, status: null, plan: null };
    const fields = { ...set };
    if (fields.fieldOfficeId !== undefined) await assertOffice(client, tenantId, fields.fieldOfficeId);
    if (fields.activity !== undefined) fields.activity = await canonicalActivity(client, tenantId, fields.activity);
    const cols = Object.entries(fields).filter(([k, v]) => BULK_SITE_FIELDS[k] && v !== undefined);
    if (cols.length) {
      const params = [tenantId, ids];
      const assigns = cols.map(([k, v]) => { params.push(v); return `${BULK_SITE_FIELDS[k]} = $${params.length}`; });
      ({ rowCount: result.updated } = await client.query(
        `UPDATE sites SET ${assigns.join(', ')} WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, params));
    }
    if (status) {
      const months = []; for (let m = status.from; m <= status.to; m += 1) months.push(m);
      result.status = await monthStatusesTx(client, tenantId, year, ids.flatMap((id) => months.map((m) => ({ siteId: id, month: m, active: status.active }))));
    }
    if (plan && plan.auto) {
      // Visites restantes de chaque site, réparties sur les mois libres et actifs à partir de `fromMonth`.
      const board = await planBoardTx(client, tenantId, { year, adjusted: Boolean(plan.adjusted) });
      const wanted = new Set(ids);
      const changes = [];
      let skipped = 0;
      for (const s of board.sites) {
        if (!wanted.has(s.id)) continue;
        if (s.forbidden || s.inactive || !s.parametered) { skipped += 1; continue; }
        const busy = (s.months || []).map((m) => m.month);
        const inactive = Object.entries(s.monthStatus || {}).filter(([, a]) => a === false).map(([m]) => Number(m));
        autoPlanMonths({ toPlan: s.toPlan, fromMonth: plan.fromMonth, busy, inactive }).forEach((m) => changes.push({ siteId: s.id, month: m, planned: true }));
      }
      result.plan = changes.length ? await planMonthsTx(client, tenantId, userId, year, changes) : { added: 0, removed: 0, skippedInactive: 0 };
      result.plan.skippedSites = skipped;
    } else if (plan) {
      result.plan = await planMonthsTx(client, tenantId, userId, year, ids.map((id) => ({ siteId: id, month: plan.month, planned: plan.planned })));
    }
    return result;
  });
}

/**
 * Ajout d'un site au registre (formulaire « Ajouter un site ») : l'ID L### est
 * attribué par la base, le statut du mois courant passe à Active. Un doublon
 * (district + commune + nom) est refusé, jamais fusionné en silence.
 */
async function addSite(tenantId, s, { today = new Date() } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    await assertOffice(client, tenantId, s.fieldOfficeId);
    const activity = await canonicalActivity(client, tenantId, s.activity);
    let row;
    try {
      ({ rows: [row] } = await client.query(
        `INSERT INTO sites (tenant_id, code, name, adm1, district, adm2, commune, adm3, fokontany, activity, field_office_id, poi_subtype, urban_area,
                            gps_lat, gps_lng, security_situation, programme_synergies, modality_type, beneficiary_number, new_partner, experienced_partner)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING id, location_id AS "locationId"`,
        [tenantId, siteCode(s), s.name, s.region || null, s.district, s.commune, s.fokontany || null, activity, s.fieldOfficeId || null,
          s.poiSubtype || null, s.urbanArea || null, s.gpsLat ?? null, s.gpsLng ?? null, s.security ?? 0, s.synergies ?? 0,
          s.modalityType || null, s.beneficiaryNumber ?? null, s.newPartner ?? 0, s.experiencedPartner ?? 0]));
    } catch (err) {
      if (err.code === '23505') throw conflict('Ce site existe déjà (même district, commune et nom).');
      throw err;
    }
    await client.query(
      `INSERT INTO site_month_status (tenant_id, site_id, year, month, active) VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (site_id, year, month) DO UPDATE SET active = true, updated_at = now()`,
      [tenantId, row.id, today.getUTCFullYear(), today.getUTCMonth() + 1]);
    return row;
  });
}

module.exports = {
  reportFieldData, planBoard, setPlannedMonths, setMonthStatuses, bulkUpdateSites, addSite, locationsExportData, importLocations,
  listSites, createSite, updateSite,
  listVisits, summary, createVisit, updateVisit, deleteVisit, importPlanning,
  collectionDaysSummary, setTravelDays, coverageRecapSummary, coverageMatrix, monthsOverview, setMonthStatus, mapData,
  rbmSites, importMasterData, importPlanSites, generateFromRbm,
};
