const { withTenantTransaction } = require('../../config/db');
const { afterSitesChangedTx, lockSubmissionLinksTx, withSubmissionLinks } = require('../settings/placeMatch.repository');
const { sitePatchSql } = require('./sitePatch');
const { chunkRows } = require('../../db/batch');
const { lockVisitMonthsTx, yearMonths } = require('./visitLocks');
const { isActiveMonth, activeMonthSql } = require('../common/siteActivity');
const { shapeRangeSummary, shapeCoverageFacts, collectionDays, buildCoverageMatrix } = require('./fieldMath');
const { isDue, frequencyFor, visitState, currentMonth, toMonth, needsPlanning, planningCounts } = require('./rbmMath');
const { scoreSite, normalizeSecurity } = require('./rbmScore');
const { coverageRecap } = require('./coverageRecap');
const { rbmCounts: countRbm } = require('./rbmSummary');
const { mmrLookup, siteCounters, rankSites, boardKpis, normalizeChanges, currentStatus, mmrKeyOf, mmrCapacity, autoPlanMonths, norm } = require('./planBoard');
const { badRequest, conflict } = require('../../middleware/errors');
const { unattachedText } = require('../common/codeLabel');
const { toPeriod, periodInfo, monthsOf, addMonths } = require('../common/period');
const { PERIOD_CAPS } = require('../common/periodCaps');
const { monthWithin } = require('../common/periodSql');
const { siteMonthFactsCtes, siteDistrictCtes, DISTRICT_LABEL_SQL, SITE_FACT_COLUMNS, MONTH_FACT_COLUMNS } = require('../common/siteActivitySql');
// Retour 58 : TPM des visites = celui de leur zone (toute écriture de visites finit par restampVisitsTx ;
// filet de sécurité en base : migration 070). Verrou d'attribution AVANT toute ligne de visite mise à jour.
const { restampVisitsTx, lockAttributionTx, applyVisitRequestTx, boardTpmTx, monitorKeySql } = require('./tpmAttribution.repository');
const { visitErrorMessage } = require('./tpmAttribution');

/** Période d'un appel : `period` ({ from, to } | null) si fourni, sinon l'ancien { month }. */
const periodArg = (opts = {}) => (opts.period !== undefined ? opts.period : toPeriod(opts));

/**
 * Période « toutes les visites » quand aucune n'est demandée : du premier au dernier mois
 * des visites du tenant, plafonnée aux derniers mois que permettent les faits site × mois
 * (common/periodCaps.facts, 24 mois — la même durée maximale qu'une période demandée : sans
 * période, la requête ne coûte jamais plus qu'avec) ; sans visite, le mois courant.
 */
async function visitSpanTx(client, tenantId) {
  const { rows: [r] } = await client.query(
    `SELECT to_char(min(period_month), 'YYYY-MM') AS lo, to_char(max(period_month), 'YYYY-MM') AS hi
       FROM site_visits WHERE tenant_id = $1`, [tenantId]);
  if (!r || !r.hi) { const m = currentMonth(); return { from: m, to: m }; }
  const floor = addMonths(r.hi, -(PERIOD_CAPS.facts - 1));
  return { from: r.lo < floor ? floor : r.lo, to: r.hi };
}

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
    if (q) {
      params.push(`%${q}%`);
      where.push(`(name ILIKE $${params.length} OR commune ILIKE $${params.length} OR district ILIKE $${params.length}
               OR code ILIKE $${params.length} OR location_id ILIKE $${params.length})`);
    }
    const { rows } = await client.query(
      `SELECT ${SITE_COLS} FROM sites WHERE ${where.join(' AND ')} ORDER BY district, commune, name`,
      params
    );
    return rows;
  });
}

/**
 * Création d'un site (formulaire « Nouveau site » de la page Visites). Un site de
 * même code (district + commune + nom) est REFUSÉ par un 409 qui porte son id —
 * jamais fusionné en silence : l'ancien `ON CONFLICT DO UPDATE` remettait le
 * fokontany à NULL et réécrivait adm2/adm3 depuis un formulaire qui ne les porte pas.
 * La vérification préalable évite aussi de consommer un numéro L### pour rien
 * (le déclencheur d'attribution s'exécute avant la détection du conflit).
 */
async function createSite(tenantId, s) {
  return withSubmissionLinks(tenantId, (client) => createSiteTx(client, tenantId, s));
}

const duplicateSite = (siteId) => conflict('Ce site existe déjà (même district, commune et nom).', siteId ? { siteId } : undefined);

async function createSiteTx(client, tenantId, s) {
  const code = siteCode(s);
  const { rows: dup } = await client.query('SELECT id FROM sites WHERE tenant_id = $1 AND code = $2', [tenantId, code]);
  if (dup.length) throw duplicateSite(dup[0].id);
  await lockSubmissionLinksTx(client, tenantId); // avant toute écriture de sites (voir afterSitesChangedTx)
  const resolveOffice = `(SELECT c.office_id FROM field_office_communes c
       JOIN field_offices o ON o.id = c.office_id
      WHERE c.tenant_id = $1 AND lower(btrim(c.commune)) = lower(btrim($4))
      ORDER BY (o.parent_id IS NOT NULL) DESC, o.national ASC, o.code LIMIT 1)`;
  let id;
  try {
    ({ rows: [{ id }] } = await client.query(
      `INSERT INTO sites (tenant_id, code, district, commune, fokontany, name, activity, adm2, adm3, adm4, field_office_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$3,$4,$5,${resolveOffice})
       RETURNING id`,
      [tenantId, code, s.district, s.commune, s.fokontany || null, s.name, s.activity || null]
    ));
  } catch (err) {
    if (err.code === '23505') throw duplicateSite(null); // création simultanée du même site
    throw err;
  }
  // Hors du try : une erreur des rattachements n'est jamais présentée comme « site existant ».
  await afterSitesChangedTx(client, tenantId); // registre modifié : lieux, bureau et formulaires reçus reliés à nouveau
  return id;
}

/** Mise à jour partielle : seuls les champs envoyés changent (un changement de risque n'efface plus l'activité). */
async function updateSite(tenantId, id, patch) {
  const { sets, values } = sitePatchSql(patch, 3);
  return withSubmissionLinks(tenantId, async (client) => {
    if (!sets.length) {
      const { rowCount } = await client.query('SELECT 1 FROM sites WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
      return rowCount > 0;
    }
    const { rowCount } = await client.query(
      `UPDATE sites SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`, [tenantId, id, ...values]);
    await afterSitesChangedTx(client, tenantId); // registre modifié : lieux, bureau et formulaires reçus reliés à nouveau
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
// Soumission qui vaut collecte pour le site `s` : reliée à CE site (site reconnu à l'import),
// sinon — site non reconnu — même commune (pcode), granularité dont on dispose alors.
const SUBMISSION_OF_SITE = `(ms.site_id = s.id OR (ms.site_id IS NULL AND s.adm3_pcode IS NOT NULL AND ms.adm3_pcode = s.adm3_pcode))`;
const SUBMISSION_COUNTS_FOR_SITE = `NOT ms.excluded
         AND (mf.activity_category IS NULL OR s.activity IS NULL OR lower(btrim(mf.activity_category)) = lower(btrim(s.activity)))`;

/**
 * SELECT RBM (sites + dernière visite effective). `asOfRef` (« $n », 1er du mois de
 * référence, facultatif) lit l'ÉTAT À CE MOIS (lot 1b) : les visites réalisées, les données
 * reçues et la date du registre POSTÉRIEURES au mois de référence sont ignorées — un site
 * visité en août n'est pas « à jour » en juin. Les visites PRÉVUES ne sont jamais bornées
 * (« à planifier » regarde le plan à venir).
 */
function rbmSelect(asOfRef = null, { factsCte = null } = {}) {
  const doneBound = asOfRef ? ` AND v.period_month <= ${asOfRef}::date` : '';
  const dataBound = asOfRef ? `\n         AND ms.period_month <= ${asOfRef}::date` : '';
  const lastVisitDate = asOfRef
    ? `CASE WHEN s.last_visit_date < (${asOfRef}::date + interval '1 month') THEN to_char(s.last_visit_date, 'YYYY-MM-DD') END`
    : "to_char(s.last_visit_date, 'YYYY-MM-DD')";
  return `
  SELECT s.id, s.code, s.public_id AS "publicId", s.name, s.district, s.commune, s.activity, s.risk_level AS "riskLevel",
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
         s.experienced_partner AS "experiencedPartner", ${lastVisitDate} AS "lastVisitDate",
         s.adm3_pcode AS "adm3Pcode",
         -- Dernière visite effective = rbmMath.visitState (une seule règle, testée) : la plus
         -- récente entre une visite RÉALISÉE, la COLLECTE RÉELLE (données uploadées) et la date
         -- du registre. Une visite seulement PLANIFIÉE n'en est jamais une (retour n° 48) : les
         -- mois prévus sont rendus à part (« prévue AAAA-MM »).
         to_char(pv.last_done, 'YYYY-MM') AS "fieldVisitMonth",
         COALESCE(pv.planned, '{}'::text[]) AS "plannedMonths",
         to_char(dv.last, 'YYYY-MM') AS "dataVisitMonth",
         dv.last_at AS "dataVisitAt",
         COALESCE(dv.n, 0)::bigint AS "dataVisitCount",
         COALESCE(dv.site_n, 0)::bigint AS "dataVisitSiteCount"
    FROM sites s
    LEFT JOIN field_offices ant ON ant.id = s.field_office_id
    LEFT JOIN field_offices par ON par.id = ant.parent_id
    LEFT JOIN LATERAL (
      SELECT max(v.period_month) FILTER (WHERE v.status = 'realise'${doneBound}) AS last_done,
             array_agg(DISTINCT to_char(v.period_month, 'YYYY-MM')) FILTER (WHERE v.status = 'planifie') AS planned
        FROM site_visits v
       WHERE v.tenant_id = s.tenant_id AND v.site_id = s.id AND v.status IN ('realise', 'planifie')
    ) pv ON true
    ${factsCte ? `LEFT JOIN ${factsCte} dv ON dv.id = s.id` : `LEFT JOIN LATERAL (
      -- Collecte réelle : la soumission la plus récente reliée à ce site (site
      -- reconnu à l'import), ou, faute de site reconnu, de la même commune ;
      -- hors soumissions écartées au nettoyage et hors fiches d'une AUTRE activité.
      SELECT max(ms.period_month) AS last, max(ms.submitted_at) AS last_at, count(*) AS n,
             count(*) FILTER (WHERE ms.site_id = s.id) AS site_n
        FROM monitoring_submissions ms
        JOIN monitoring_forms mf ON mf.id = ms.form_id
       WHERE ms.tenant_id = s.tenant_id AND ${SUBMISSION_OF_SITE}
         AND ${SUBMISSION_COUNTS_FOR_SITE}${dataBound}
    ) dv ON true`}
   WHERE s.tenant_id = $1`;
}
const RBM_SELECT = rbmSelect();

/**
 * Lignes du SELECT RBM avec l'état des visites (dernière visite effective, visites prévues).
 * `asOf` (« AAAA-MM ») : état au mois de référence (rbmSelect).
 */
async function rbmRowsTx(client, tenantId, { risk, siteId, targetMonth, ordered = false, asOf = null } = {}) {
  const params = [tenantId]; let where = '';
  let asOfRef = null;
  const asOfDay = asOf ? `${String(asOf).slice(0, 7)}-01` : null;
  if (asOfDay) { params.push(asOfDay); asOfRef = `$${params.length}`; }
  if (risk) { params.push(risk); where += ` AND s.risk_level = $${params.length}`; }
  if (siteId) { params.push(siteId); where += ` AND s.id = $${params.length}`; }
  // Collecte réelle calculée en ENSEMBLE (siteDataFactsSql, même règle que la sous-requête
  // par site du SELECT RBM) : ≈ 10× plus rapide à 2 500 sites qu'une sous-requête par ligne.
  const facts = siteDataFactsSql(
    `SELECT s.id, s.adm3_pcode, lower(btrim(s.activity)) AS act FROM sites s WHERE s.tenant_id = $1${where}`,
    params, { asOfRef: asOfRef || undefined });
  const { rows } = await client.query(
    `WITH facts AS (${facts})${rbmSelect(asOfRef, { factsCte: 'facts' })}${where}${ordered ? ' ORDER BY s.district, s.commune, s.name' : ''}`, params);
  return rows.map((r) => ({ ...r, ...visitState(r, targetMonth) }));
}

/** Site registry with risk level, last visit and whether it is due for `month`. */
async function rbmSites(tenantId, opts = {}) {
  return withTenantTransaction(tenantId, (client) => rbmSitesTx(client, tenantId, opts));
}

/**
 * Compteurs de l'état RBM (rbmSummary.rbmCounts) sur les MÊMES lignes que /rbm/sites : les
 * écrans qui n'affichent que des totaux ne téléchargent plus la liste complète des sites.
 */
async function rbmCounts(tenantId, opts = {}) {
  const rows = await rbmSites(tenantId, opts);
  return { month: opts.month ? String(opts.month).slice(0, 7) : null, ...countRbm(rows) };
}

/**
 * Un site RBM avec son explication (raisons, conséquence, actions — retour n° 48),
 * calculée par la MÊME fonction que la liste : servie à la demande pour que la liste
 * de tous les sites reste légère (+50 % de JSON sinon). null si le site n'existe pas.
 */
async function rbmSiteExplain(tenantId, siteId, { month, asOf } = {}) {
  return withTenantTransaction(tenantId, async (client) => (await rbmSitesTx(client, tenantId, { month, asOf, siteId, explain: true }))[0] || null);
}

/**
 * Statuts d'activité d'un exercice (grille « Sites (actifs / inactifs) ») : l'année a-t-elle
 * une grille, et les cases (site × mois) renseignées. Lus pour appliquer LA règle commune
 * (siteActivity.isActiveMonth : année avec grille → « Oui » explicite seulement).
 */
async function yearActivityTx(client, tenantId, year, { month = null, siteIds = null } = {}) {
  const { rows: [g] } = await client.query(
    'SELECT EXISTS (SELECT 1 FROM site_month_status WHERE tenant_id = $1 AND year = $2) AS has_grid', [tenantId, year]);
  const params = [tenantId, year]; let where = '';
  if (month) { params.push(month); where += ` AND month = $${params.length}`; }
  if (siteIds) { params.push(siteIds); where += ` AND site_id = ANY($${params.length}::uuid[])`; }
  const { rows } = await client.query(`SELECT site_id, month, active FROM site_month_status WHERE tenant_id = $1 AND year = $2${where}`, params);
  const cells = new Map(rows.map((r) => [`${r.site_id}|${r.month}`, r.active]));
  const hasGrid = Boolean(g && g.has_grid);
  return { hasGrid, isActive: (siteId, m) => isActiveMonth(cells.get(`${siteId}|${m}`), hasGrid) };
}

/** Sites dont la visite du mois a été ANNULÉE, et sites inactifs ce mois (règle commune). */
async function monthBlocksTx(client, tenantId, target) {
  if (!target) return { cancelled: new Set(), isInactive: () => false };
  const [y, m] = target.split('-').map(Number);
  const { rows: c } = await client.query(
    `SELECT DISTINCT site_id FROM site_visits WHERE tenant_id = $1 AND period_month = $2::date AND status = 'annule'
       AND NOT EXISTS (SELECT 1 FROM site_visits o WHERE o.tenant_id = $1 AND o.site_id = site_visits.site_id
                         AND o.period_month = $2::date AND o.status <> 'annule')`,
    [tenantId, `${target}-01`]);
  const act = await yearActivityTx(client, tenantId, y, { month: m });
  return { cancelled: new Set(c.map((r) => r.site_id)), isInactive: (siteId) => !act.isActive(siteId, m) };
}

async function rbmSitesTx(client, tenantId, { month, risk, siteId, explain = false, asOf = null } = {}) {
  const target = month ? String(month).slice(0, 7) : null;
  const rows = await rbmRowsTx(client, tenantId, { risk, siteId, targetMonth: target, ordered: true, asOf });
  const blocks = await monthBlocksTx(client, tenantId, target);
  return rows.map((r) => {
    // Intervalle de référence : fréquence RBM selon le niveau de risque
    // (en l'absence d'un paramètre MMR précis pour ce site).
    const interval = frequencyFor(r.riskLevel);
    const { reasons, consequence, actions, ...score } = scoreSite(r, { targetMonth: target, mmrInterval: interval });
    // « À suivre » = retard (score) OU échéance de fréquence atteinte (isDue),
    // pour rester cohérent avec l'ancienne logique.
    const due = target ? (score.due || isDue(r.riskLevel, r.lastVisitMonth, target)) : false;
    // « À planifier » (compteur et bouton « Générer ») : à suivre, hors zone interdite, sans visite prévue ce mois.
    const cancelledThisMonth = blocks.cancelled.has(r.id);
    const inactiveThisMonth = blocks.isInactive(r.id);
    const toPlan = needsPlanning({ due, forbidden: score.forbidden, nextPlannedMonth: r.nextPlannedMonth, cancelledThisMonth, inactiveThisMonth }, target);
    return { ...r, ...score, due, toPlan, cancelledThisMonth, inactiveThisMonth, interval, ...(explain ? { reasons, consequence, actions } : {}) };
  });
}

/** Import the Master Data site referential (Region/District/Commune/Site/code). */
async function importMasterData(tenantId, rows) {
  return withSubmissionLinks(tenantId, async (client) => {
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
    await afterSitesChangedTx(client, tenantId); // registre modifié : lieux, bureau et formulaires reçus reliés à nouveau
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
  return withSubmissionLinks(tenantId, async (client) => {
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
        for (const x of slice) { params.push(idByCode.get(x.code), `${x.month}-01`); const b = params.length; vals.push(`($${b - 1}::uuid,$${b}::date)`); }
        // Idempotent même sans activité (la contrainte unique laisse passer les NULL) : jamais une
        // 2ᵉ visite réalisée pour le même site et le même mois.
        const { rowCount } = await client.query(
          `INSERT INTO site_visits (tenant_id, site_id, period_month, status, created_by)
           SELECT DISTINCT $1::uuid, t.site_id, t.pm, 'realise', $2::uuid FROM (VALUES ${vals.join(',')}) AS t(site_id, pm)
            WHERE NOT EXISTS (SELECT 1 FROM site_visits v WHERE v.tenant_id = $1 AND v.site_id = t.site_id
                                AND v.period_month = t.pm AND v.status = 'realise')
           ON CONFLICT DO NOTHING`, params);
        visits += rowCount;
      }
    }
    await afterSitesChangedTx(client, tenantId); // registre modifié : lieux, bureau et formulaires reçus reliés à nouveau
    return { total, upserted, lastVisits: visits };
  });
}

/**
 * « Générer depuis le RBM » : une visite planifiée par site « à planifier » du mois
 * (rbmMath.needsPlanning — à suivre, hors zone interdite, sans visite non annulée ce
 * mois), éventuellement filtré par risque. Mêmes lignes et même règle « à suivre » que
 * la page RBM (rbmSitesTx) : une visite seulement planifiée ne rend jamais un site
 * « à jour », mais elle suffit à ne pas le replanifier.
 *
 * Idempotent : un deuxième clic ne crée rien. Le contrôle « déjà une visite ce mois »
 * est dans l'INSERT lui-même (NOT EXISTS sur les visites non annulées, toutes activités)
 * car UNIQUE (tenant_id, site_id, period_month, activity) laisse passer les doublons
 * quand l'activité est NULL. Deux générations simultanées du même mois sont mises en
 * file par un verrou consultatif (sinon chacune insérerait avant de voir l'autre).
 * Une visite ANNULÉE de même activité est replanifiée (comme le Plan de suivi).
 * @returns {{ created: number, due: number, toPlan: number }}  visites planifiées par ce
 *   clic ; sites à suivre (hors zones interdites) et, parmi eux, à planifier avant ce clic.
 */
async function generateFromRbm(tenantId, userId, month, opts = {}) {
  return withTenantTransaction(tenantId, (client) => generateFromRbmTx(client, tenantId, userId, month, opts));
}

async function generateFromRbmTx(client, tenantId, userId, month, { risk } = {}) {
  const target = toMonth(month);
  if (!target) throw badRequest('Mois invalide (attendu : AAAA-MM).');
  // Verrou du mois (visitLocks : même clé pour tous les écrivains de plan, attente bornée à 20 s
  // puis 503), AVANT le verrou d'attribution que prend restampVisitsTx — même ordre partout.
  await lockVisitMonthsTx(client, tenantId, [target]);
  // MÊME règle que GET /rbm/sites?month= (compteur « à planifier ») : état au mois cible (asOf) —
  // dernière visite = dernier mois réalisé ≤ M (définition commune) ; pour un mois passé, une
  // visite ou une donnée postérieure ne rend jamais le site « à jour ».
  const rows = await rbmSitesTx(client, tenantId, { month: target, risk, asOf: target });
  const counts = planningCounts(rows, target);
  const todo = rows.filter((s) => s.toPlan);
  if (!todo.length) return { created: 0, ...counts };
  // Une seule instruction ; jamais sur un site qui a DÉJÀ une visite ce mois (quel que soit son
  // statut : une visite annulée est une décision, elle n'est pas ressuscitée) ni inactif ce mois
  // (règle commune : année avec grille → « Oui » explicite seulement).
  const [y, m] = target.split('-').map(Number);
  const { rowCount } = await client.query(
    `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, created_by)
     SELECT $1, t.site_id, $2::date, t.activity, 'planifie', $3
       FROM unnest($4::uuid[], $5::text[]) AS t(site_id, activity)
      WHERE NOT EXISTS (SELECT 1 FROM site_visits v
                         WHERE v.tenant_id = $1 AND v.site_id = t.site_id AND v.period_month = $2::date)
        AND ${activeMonthSql({ site: 't.site_id', year: '$6', month: '$7' })}
     ON CONFLICT (tenant_id, site_id, period_month, activity) DO NOTHING`,
    [tenantId, `${target}-01`, userId || null, todo.map((s) => s.id), todo.map((s) => s.activity || null), y, m]
  );
  // Retour 58 : les visites créées prennent le TPM de leur zone (compte rendu par état).
  const tpm = await restampVisitsTx(client, tenantId);
  return { created: rowCount, ...counts, tpm: { byState: tpm.byState } };
}

/**
 * Site déjà au registre lors d'un import de planning : l'import COMPLÈTE ce qui
 * manque, il ne remplace ni n'efface rien (rbm-38). L'ancienne clause écrasait
 * fokontany (NULL si la colonne était vide), adm2/adm3 et l'activité du registre.
 */
const PLANNING_SITE_MERGE = `ON CONFLICT (tenant_id, code) DO UPDATE SET
         fokontany = COALESCE(sites.fokontany, EXCLUDED.fokontany),
         activity = COALESCE(sites.activity, EXCLUDED.activity),
         adm2 = COALESCE(sites.adm2, EXCLUDED.adm2), adm3 = COALESCE(sites.adm3, EXCLUDED.adm3),
         adm4 = COALESCE(sites.adm4, EXCLUDED.adm4),
         field_office_id = COALESCE(sites.field_office_id, EXCLUDED.field_office_id)`;

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
       ${PLANNING_SITE_MERGE}
       RETURNING id, (xmax = 0) AS inserted`,
      [tenantId, code, s.district, s.commune, s.fokontany || null, s.name, s.activity || null]
    );
    map.set(`${s.district}|${s.commune}|${s.name}`, rows[0].id);
    if (rows[0].inserted) inserted += 1;
  }
  return { map, inserted };
}

// Colonnes de la liste des visites : celles que les écrans lisent (plan du mois, budget de collecte) —
// sans le contrat de la visite (jamais affiché ; 50 octets par ligne) : la page reste sous 1 Mo.
const VISIT_COLS = `
  v.id, v.site_id AS "siteId", s.name AS "siteName", s.district, s.commune, s.fokontany,
  v.activity, to_char(v.period_month, 'YYYY-MM') AS "periodMonth",
  v.provider_id AS "providerId", p.name AS "providerName",
  v.provider_source AS "providerSource", v.provider_zone_state AS "providerZoneState", v.provider_reason AS "providerReason",
  v.monitored_by AS "monitoredBy",
  COALESCE(c.numero_fla, c.numero) AS "contractLabel", s.zone_district_id AS "zoneDistrictId",
  v.agent, v.status, v.visit_date AS "visitDate"`;

/** Taille d'une page de la liste des visites (et maximum accepté) : ≈ 0,3 Mo par page de 1 000. */
const VISIT_PAGE = 1000;
const VISIT_PAGE_MAX = 2000;

/**
 * Collecte réelle (données uploadées) d'un ensemble de sites, en ENSEMBLE (jamais une
 * sous-requête par ligne) — même règle que SUBMISSION_OF_SITE / SUBMISSION_COUNTS_FOR_SITE :
 * une soumission reliée à CE site, ou, faute de site reconnu, de la même commune (pcode),
 * hors soumissions écartées et hors fiches d'une AUTRE activité que celle du site.
 * `sitesSql` rend (id, adm3_pcode, act = lower(btrim(activity))) ; `asOf` (« AAAA-MM-01 »,
 * facultatif) borne les données à ce mois — ou `asOfRef`, le même paramètre déjà présent
 * (« $n »). Rend le SELECT : id, last (date), last_at, n, site_n.
 */
function siteDataFactsSql(sitesSql, params, { asOf, asOfRef } = {}) {
  let bound = '';
  if (asOfRef) bound = ` AND ms.period_month <= ${asOfRef}::date`; // paramètre déjà présent (« $n »)
  else if (asOf) { params.push(asOf); bound = ` AND ms.period_month <= $${params.length}::date`; }
  return `WITH ts AS MATERIALIZED (${sitesSql}),
     by_site AS MATERIALIZED (
       SELECT ms.site_id, lower(btrim(mf.activity_category)) AS cat,
              max(ms.period_month) AS last, max(ms.submitted_at) AS last_at, count(*)::int AS n
         FROM monitoring_submissions ms JOIN monitoring_forms mf ON mf.id = ms.form_id AND mf.tenant_id = ms.tenant_id
        WHERE ms.tenant_id = $1 AND NOT ms.excluded AND ms.site_id = ANY (ARRAY(SELECT id FROM ts))${bound}
        GROUP BY 1, 2),
     by_commune AS MATERIALIZED (
       SELECT ms.adm3_pcode, lower(btrim(mf.activity_category)) AS cat,
              max(ms.period_month) AS last, max(ms.submitted_at) AS last_at, count(*)::int AS n
         FROM monitoring_submissions ms JOIN monitoring_forms mf ON mf.id = ms.form_id AND mf.tenant_id = ms.tenant_id
        WHERE ms.tenant_id = $1 AND NOT ms.excluded AND ms.site_id IS NULL
          AND ms.adm3_pcode = ANY (ARRAY(SELECT DISTINCT adm3_pcode FROM ts WHERE adm3_pcode IS NOT NULL))${bound}
        GROUP BY 1, 2),
     bs AS (SELECT ts.id, max(b.last) AS last, max(b.last_at) AS last_at, sum(b.n)::int AS n
              FROM ts JOIN by_site b ON b.site_id = ts.id AND (b.cat IS NULL OR ts.act IS NULL OR b.cat = ts.act)
             GROUP BY ts.id),
     bc AS (SELECT ts.id, max(c.last) AS last, max(c.last_at) AS last_at, sum(c.n)::int AS n
              FROM ts JOIN by_commune c ON c.adm3_pcode = ts.adm3_pcode AND (c.cat IS NULL OR ts.act IS NULL OR c.cat = ts.act)
             GROUP BY ts.id)
     SELECT ts.id, GREATEST(bs.last, bc.last) AS last, GREATEST(bs.last_at, bc.last_at) AS last_at,
            COALESCE(bs.n, 0) + COALESCE(bc.n, 0) AS n, COALESCE(bs.n, 0) AS site_n
       FROM ts LEFT JOIN bs ON bs.id = ts.id LEFT JOIN bc ON bc.id = ts.id`;
}

/**
 * Visites, filtrables par période ({ period } ou l'ancien { month } — 12 mois au plus,
 * contrôlé par la route), prestataire et statut ; avec la dernière collecte réelle du
 * site (`dataVisitMonth`), calculée en ensemble sur les sites de la page.
 * Paginée : `limit` (1 000 par défaut, 2 000 au plus) et `offset` ; ordre stable (district,
 * commune, site, mois, identifiant). Rend { items, total, limit, offset } — une réponse reste
 * bornée (< 1 Mo) quel que soit le volume ; l'écran lit les pages jusqu'à `total`.
 */
async function listVisits(tenantId, opts = {}) {
  const { providerId, status } = opts;
  const period = periodArg(opts);
  const limit = Math.min(VISIT_PAGE_MAX, Math.max(1, Math.floor(Number(opts.limit)) || VISIT_PAGE));
  const offset = Math.max(0, Math.floor(Number(opts.offset)) || 0);
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['v.tenant_id = $1', monthWithin('v.period_month', period, params)];
    if (providerId) { params.push(providerId); where.push(`v.provider_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`v.status = $${params.length}`); }
    params.push(limit, offset);
    const { rows: page } = await client.query(
      `SELECT ${VISIT_COLS}, count(*) OVER ()::int AS _total
         FROM site_visits v
         JOIN sites s ON s.id = v.site_id AND s.tenant_id = v.tenant_id
         LEFT JOIN partners p ON p.id = v.provider_id AND p.tenant_id = v.tenant_id
         LEFT JOIN contracts c ON c.id = v.contract_id AND c.tenant_id = v.tenant_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.district, s.commune, s.name, v.period_month, v.id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    let total = page.length ? page[0]._total : 0;
    if (!page.length && offset > 0) {
      // Page au-delà de la fin : le total vient d'un comptage (la fenêtre n'a rien rendu).
      const { rows: [c] } = await client.query(
        `SELECT count(*)::int AS n FROM site_visits v WHERE ${where.join(' AND ')}`, params.slice(0, -2));
      total = c ? c.n : 0;
    }
    const rows = page.map(({ _total, ...r }) => r);
    const ids = [...new Set(rows.map((r) => r.siteId))];
    const last = new Map();
    if (ids.length) {
      const dp = [tenantId, ids];
      const { rows: data } = await client.query(
        `${siteDataFactsSql(`SELECT s.id, s.adm3_pcode, lower(btrim(s.activity)) AS act FROM sites s
                              WHERE s.tenant_id = $1 AND s.id = ANY($2::uuid[])`, dp)}`, dp);
      for (const d of data) if (d.last) last.set(d.id, String(d.last).slice(0, 7));
    }
    for (const r of rows) r.dataVisitMonth = last.get(r.siteId) || null;
    return { items: rows, total, limit, offset };
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

/**
 * Résumé terrain sur une période (lot 1b) — faits site × mois (common/siteActivitySql,
 * UNE requête GROUPING SETS + série mensuelle) et une requête prestataires (une visite
 * porte le prestataire, pas le site), mis en forme par fieldMath.shapeRangeSummary.
 * Les champs hérités (planifie / realise / annule / total / active / rate, lignes de
 * visites) gardent leur sens : alertsMath.fieldAlerts et les cartes les lisent tels quels.
 * Sans période : toutes les visites (de la première à la dernière, 60 mois au plus).
 * @param {{ period?: {from,to}|null, month?: string }} opts
 */
async function summary(tenantId, opts = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const period = periodArg(opts) || await visitSpanTx(client, tenantId);
    const params = [tenantId];
    const ctes = siteMonthFactsCtes({ period, todayMonth: currentMonth() }, params);
    const { rows } = await client.query(
      `${ctes}
       SELECT CASE WHEN GROUPING(office) = 0 THEN 'office' WHEN GROUPING(dkey) = 0 THEN 'district'
                   WHEN GROUPING(activity) = 0 THEN 'activity' ELSE 'overall' END AS dim,
              COALESCE(office, dkey, activity) AS key,
              -- Nom affiché du district : officiel (découpage), sinon une graphie qui n'est pas tout en capitales.
              ${DISTRICT_LABEL_SQL} AS "districtLabel",
              NULL::boolean AS known, ${SITE_FACT_COLUMNS}
         FROM per_site GROUP BY GROUPING SETS ((), (office), (dkey), (activity))
       UNION ALL
       SELECT 'month', to_char(m, 'YYYY-MM'), NULL, bool_or(known), ${MONTH_FACT_COLUMNS}
         FROM fact GROUP BY m`,
      params
    );
    // Prestataires : mêmes bornes (semi-ouvertes) que les faits.
    const pp = [tenantId];
    const within = monthWithin('v.period_month', period, pp);
    const { rows: providers } = await client.query(
      `SELECT ${monitorKeySql('v')} AS key, min(p.name) AS label,
              count(*) FILTER (WHERE v.status = 'planifie')::int AS planifie,
              count(*) FILTER (WHERE v.status = 'realise')::int AS realise,
              count(*) FILTER (WHERE v.status = 'annule')::int AS annule,
              count(DISTINCT v.site_id) FILTER (WHERE v.status <> 'annule')::int AS "sitesPlanned",
              count(DISTINCT v.site_id) FILTER (WHERE v.status = 'realise')::int AS "sitesRealised"
         FROM site_visits v LEFT JOIN partners p ON p.id = v.provider_id AND p.tenant_id = v.tenant_id
        WHERE v.tenant_id = $1 AND ${within}
        GROUP BY 1`,
      pp
    );
    return { period: periodInfo(period), ...shapeRangeSummary(rows, providers) };
  });
}

/**
 * Récap de couverture (sites visités 1/2/3/4+ fois face au MMR) sur une période :
 * les sites ACTIFS sur la période (faits site × mois), chacun avec ses site × mois
 * réalisés pendant un mois actif ; puis le récap pur par niveau de risque
 * (coverageRecap). Filtrable par district (même clé que le résumé : siteDistrictCtes,
 * graphie du site, jamais un district d'une autre région). Sans période : les visites des 24 derniers
 * mois de visites au plus (visitSpanTx, common/periodCaps.facts), rendus dans `span`.
 * `operationMonths` : visites requises MMR (défaut : durée de la période si elle est
 * donnée, sinon 12).
 */
async function coverageRecapSummary(tenantId, { district, operationMonths, period: asked, month } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const given = periodArg({ period: asked, month });
    const period = given || await visitSpanTx(client, tenantId);
    const months = operationMonths || (given ? monthsOf(given).length : 12);
    const params = [tenantId];
    const ctes = siteMonthFactsCtes({ period, todayMonth: currentMonth(), district }, params);
    const { rows } = await client.query(
      `${ctes}
       SELECT risk AS "riskLevel", realise_active AS "visitCount" FROM per_site WHERE active`,
      params
    );
    const recap = coverageRecap(rows.map((r) => ({ riskLevel: r.riskLevel, visitCount: Number(r.visitCount) })), months);
    // Liste des districts pour le filtre : un nom par district, la même clé que le résumé
    // (siteDistrictCtes : graphie du site, nom officiel seulement quand le P-code est d'accord).
    const { rows: districts } = await client.query(
      `WITH ${siteDistrictCtes()}
       SELECT ${DISTRICT_LABEL_SQL} AS d FROM sdist WHERE dkey <> '—' GROUP BY dkey ORDER BY 1`,
      [tenantId]
    );
    // span : mois réellement lus (la période demandée, sinon les visites des 24 derniers mois) — l'écran le dit.
    return { ...recap, operationMonths: months, districts: districts.map((x) => x.d), period: periodInfo(given), span: periodInfo(period) };
  });
}

/**
 * Matrice de couverture mensuelle par programme (activité de la visite) et par
 * prestataire TPM — planifiées/réalisées et taux par mois. Une année (`year`,
 * comportement historique) ou une période (`period` : colonnes = mois de la période).
 * Agrégé en SQL, mis en forme par la logique pure testée `buildCoverageMatrix`.
 */
async function coverageMatrix(tenantId, { year, period } = {}) {
  const y = Number(year) || new Date().getFullYear();
  const p = period || { from: `${y}-01`, to: `${y}-12` };
  return withTenantTransaction(tenantId, async (client) => {
    const ap = [tenantId];
    const aw = monthWithin('period_month', p, ap);
    const { rows: act } = await client.query(
      `SELECT to_char(period_month, 'YYYY-MM') AS month,
              COALESCE(NULLIF(activity, ''), '—') AS key,
              COALESCE(NULLIF(activity, ''), '—') AS label,
              count(*) FILTER (WHERE status = 'planifie')::int AS planifie,
              count(*) FILTER (WHERE status = 'realise')::int AS realise
         FROM site_visits
        WHERE tenant_id = $1 AND ${aw}
        GROUP BY 1, 2, 3`,
      ap
    );
    const pp = [tenantId];
    const pw = monthWithin('v.period_month', p, pp);
    const { rows: prov } = await client.query(
      `SELECT to_char(v.period_month, 'YYYY-MM') AS month,
              ${monitorKeySql('v')} AS key,
              COALESCE(p.name, CASE WHEN v.monitored_by = 'interne' THEN 'Interne' ELSE 'Non affecté' END) AS label,
              count(*) FILTER (WHERE v.status = 'planifie')::int AS planifie,
              count(*) FILTER (WHERE v.status = 'realise')::int AS realise
         FROM site_visits v LEFT JOIN partners p ON p.id = v.provider_id AND p.tenant_id = v.tenant_id
        WHERE v.tenant_id = $1 AND ${pw}
        GROUP BY 1, 2, 3`,
      pp
    );
    // Années disponibles (pour le sélecteur).
    const { rows: yrs } = await client.query(
      `SELECT DISTINCT date_part('year', period_month)::int AS y FROM site_visits WHERE tenant_id = $1 ORDER BY y DESC`,
      [tenantId]
    );
    const cols = period ? monthsOf(period) : y;
    return {
      year: period ? null : y, period: periodInfo(period || null), years: yrs.map((r) => r.y),
      byActivity: buildCoverageMatrix(act, cols), byProvider: buildCoverageMatrix(prov, cols),
    };
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
    await assertVisitRefs(client, tenantId, { providerId });
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

// Une clé étrangère ne voit pas la RLS : un identifiant d'un AUTRE tenant passerait.
// Chaque référence d'une visite est donc vérifiée dans le tenant courant.
// Le contrat d'une visite est dérivé de sa zone (retour 58) : il n'est plus reçu du client.
const VISIT_REFS = [['siteId', 'sites', 'Site inconnu.'], ['providerId', 'partners', 'TPM inconnu.']];
async function assertVisitRefs(client, tenantId, v) {
  for (const [key, table, message] of VISIT_REFS) {
    if (!v[key]) continue;
    const { rowCount } = await client.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, v[key]]);
    if (!rowCount) throw badRequest(message);
  }
}

/** Décision de TPM refusée par la règle (raison manquante, prestataire non sélectionnable…) → 400. */
const visitRuleError = (res) => badRequest(visitErrorMessage(res), { code: res.error });

/**
 * Nouvelle visite : elle prend le TPM de sa zone (retour 58). Un autre TPM (`providerId`, y
 * compris null) n'est accepté qu'avec sa raison (`providerReason`, déjà nettoyée par la route) ;
 * choisir la valeur de la zone ne demande rien. Le contrat est dérivé, jamais reçu.
 */
async function createVisit(tenantId, userId, v) {
  return withTenantTransaction(tenantId, async (client) => {
    await lockAttributionTx(client, tenantId);
    await assertVisitRefs(client, tenantId, { siteId: v.siteId, providerId: v.providerId });
    let id;
    try {
      ({ rows: [{ id }] } = await client.query(
        `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, agent, status, visit_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [tenantId, v.siteId, `${String(v.periodMonth).slice(0, 7)}-01`, v.activity || null,
          v.agent || null, v.status || 'planifie', v.visitDate || null, userId]
      ));
    } catch (err) {
      if (err.code === '23505') throw conflict('Une visite existe déjà pour ce site, ce mois et cette activité.');
      throw err;
    }
    await restampVisitsTx(client, tenantId);
    if (v.providerId !== undefined) {
      const res = await applyVisitRequestTx(client, tenantId, userId, [id], { action: 'set', providerId: v.providerId || null, reason: v.providerReason || null });
      if (res.error) throw visitRuleError(res);
    }
    return id;
  });
}

/**
 * Mise à jour partielle d'une visite : champ absent = inchangé, null = effacé. Le TPM passe par la
 * règle (retour 58) : `followZone` rend la visite à sa zone ; `providerId` (null = désaffecter)
 * différent de la zone exige `providerReason`. Une visite re-planifiée reprend le TPM de sa zone
 * (garde en base), sauf écart motivé.
 */
async function updateVisit(tenantId, id, patch, userId = null) {
  const given = (k) => patch[k] !== undefined;
  return withTenantTransaction(tenantId, async (client) => {
    await lockAttributionTx(client, tenantId);
    await assertVisitRefs(client, tenantId, { providerId: patch.providerId });
    const { rowCount } = await client.query(
      `UPDATE site_visits
          SET agent = CASE WHEN $3::boolean THEN $4 ELSE agent END,
              status = COALESCE($5, status),
              visit_date = CASE WHEN $6::boolean THEN $7::date ELSE visit_date END, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, given('agent'), patch.agent ?? null, patch.status ?? null, given('visitDate'), patch.visitDate ?? null]
    );
    if (!rowCount) return false;
    let res = null;
    if (patch.followZone) res = await applyVisitRequestTx(client, tenantId, userId, [id], { action: 'zone' });
    else if (given('providerId')) res = await applyVisitRequestTx(client, tenantId, userId, [id], { action: 'set', providerId: patch.providerId || null, reason: patch.providerReason || null });
    if (res && res.error) throw visitRuleError(res);
    await restampVisitsTx(client, tenantId);
    return true;
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
  return withSubmissionLinks(tenantId, async (client) => {
    const clean = rows.filter((r) => r.district && r.commune && r.name);
    const { map, inserted } = await upsertSites(client, tenantId, clean);
    let visits = 0;
    const pm = `${String(month).slice(0, 7)}-01`;
    for (const r of clean) {
      const siteId = map.get(`${r.district}|${r.commune}|${r.name}`);
      if (!siteId) continue;
      // Idempotent même sans activité (NULL n'entre pas en conflit) : rien si une visite non annulée
      // de même activité (ou sans activité des deux côtés) existe déjà ce mois.
      const res = await client.query(
        `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, agent, status, created_by)
         SELECT $1, $2, $3::date, $4::text, $5, 'planifie', $6
          WHERE NOT EXISTS (SELECT 1 FROM site_visits v WHERE v.tenant_id = $1 AND v.site_id = $2 AND v.period_month = $3::date
                              AND v.status <> 'annule' AND COALESCE(v.activity, '') = COALESCE($4::text, ''))
         ON CONFLICT (tenant_id, site_id, period_month, activity) DO NOTHING`,
        [tenantId, siteId, pm, r.activity || null, r.agent || null, userId]
      );
      visits += res.rowCount;
    }
    await afterSitesChangedTx(client, tenantId); // registre modifié : lieux, bureau et formulaires reçus reliés à nouveau
    return { sitesInserted: inserted, sitesTotal: clean.length, visitsCreated: visits };
  });
}

/**
 * Données « terrain » d'un rapport sur une période [from, to] (mois inclus) — faits
 * site × mois (common/siteActivitySql, le même service que le résumé terrain) :
 *   byOffice : par bureau (antenne comptée avec son bureau parent ; un site sans bureau
 *     sous « (non rattaché) » dans la langue du rapport) — sitesActive = sites ACTIFS au
 *     moins un mois de la période (plus tout le registre), sitesVisited = sites réalisés
 *     PENDANT un mois actif (inclus dans les actifs : plus de « 407,7 % »), planned / done
 *     = visites (site × mois, comptées une fois) prévues non annulées / réalisées ;
 *   monthly  : par mois de la période (mois sans visite compris) : planned, done.
 * Mêmes noms de champs qu'avant (reportData : bureau_coverage, plan_vs_actual) ; les faits
 * complets (sitesPlanned, sitesRealisedInactive, upcoming…) sont ajoutés.
 */
async function reportFieldData(tenantId, { from, to }, { lang = 'fr' } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const period = { from: String(from).slice(0, 7), to: String(to).slice(0, 7) };
    const params = [tenantId];
    const ctes = siteMonthFactsCtes({ period, todayMonth: currentMonth(), office: 'bureau', unattached: unattachedText(lang) }, params);
    const { rows } = await client.query(
      `${ctes}
       SELECT 'office' AS dim, office AS key, ${SITE_FACT_COLUMNS} FROM per_site GROUP BY office
       UNION ALL
       SELECT 'month', to_char(m, 'YYYY-MM'), ${MONTH_FACT_COLUMNS} FROM fact GROUP BY m`,
      params
    );
    const visits = (r) => ({ planned: r.smPlanifie + r.smRealise, done: r.smRealise });
    return {
      period: periodInfo(period),
      byOffice: rows.filter((r) => r.dim === 'office')
        .map(({ dim: _dim, key, ...r }) => ({ bureau: key, ...r, ...visits(r), sitesVisited: r.sitesRealised }))
        .sort((a, b) => b.sitesActive - a.sitesActive || String(a.bureau).localeCompare(String(b.bureau))),
      monthly: rows.filter((r) => r.dim === 'month').map((r) => ({ month: r.key, ...visits(r) }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    };
  });
}

/**
 * Faits de COUVERTURE d'une période pour le concepteur de rapport (lot 7a) — le SERVICE
 * UNIQUE des faits site × mois (siteMonthFactsCtes, bureau parent comme le rapport) en UNE
 * requête : global, par bureau, district et activité, par mois et par mois × activité
 * (GROUPING SETS), mis en forme par fieldMath.shapeCoverageFacts (mêmes taux que la
 * Couverture & performance : ratesOf) ; plus les visites par prestataire sur les MÊMES sites.
 * Filtres : `officeId` (bureau MEMS et ses antennes, ou 'unlinked'), `activity` (catégorie du site).
 * Sans période : toutes les visites (60 mois au plus), comme summary.
 */
async function coverageFacts(tenantId, { period: asked = null, officeId = null, activity = null, lang = 'fr' } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const period = toPeriod(asked) || await visitSpanTx(client, tenantId);
    const params = [tenantId];
    const ctes = siteMonthFactsCtes({ period, todayMonth: currentMonth(), office: 'bureau', unattached: unattachedText(lang), officeId, activity }, params);
    const { rows } = await client.query(
      `${ctes}
       SELECT CASE WHEN GROUPING(office) = 0 THEN 'office' WHEN GROUPING(dkey) = 0 THEN 'district'
                   WHEN GROUPING(activity) = 0 THEN 'activity' ELSE 'overall' END AS dim,
              COALESCE(office, dkey, activity) AS key, NULL::text AS sub,
              COALESCE(min(official), min(dname) FILTER (WHERE dname <> upper(dname)), min(dname)) AS "districtLabel",
              NULL::boolean AS known, count(*)::int AS "sitesTotal", ${SITE_FACT_COLUMNS}
         FROM per_site GROUP BY GROUPING SETS ((), (office), (dkey), (activity))
       UNION ALL
       SELECT CASE WHEN GROUPING(r.activity) = 0 THEN 'month_activity' ELSE 'month' END, to_char(f.m, 'YYYY-MM'),
              CASE WHEN GROUPING(r.activity) = 0 THEN r.activity END, NULL, bool_or(f.known), count(*)::int, ${MONTH_FACT_COLUMNS}
         FROM fact f JOIN reg r ON r.site_id = f.site_id
        GROUP BY GROUPING SETS ((f.m), (f.m, r.activity))`,
      params
    );
    // Visites par prestataire, sur les sites retenus (mêmes bornes semi-ouvertes).
    const pp = [tenantId];
    const within = monthWithin('v.period_month', period, pp);
    let scope = '';
    if (officeId === 'unlinked') scope += ' AND s.field_office_id IS NULL';
    else if (officeId) { pp.push(officeId); scope += ` AND (s.field_office_id = $${pp.length}::uuid OR fo.parent_id = $${pp.length}::uuid)`; }
    if (activity) { pp.push(activity); scope += ` AND lower(btrim(s.activity)) = lower(btrim($${pp.length}::text))`; }
    const { rows: providers } = await client.query(
      `SELECT ${monitorKeySql('v')} AS key, min(p.name) AS label,
              count(*) FILTER (WHERE v.status = 'planifie')::int AS planifie,
              count(*) FILTER (WHERE v.status = 'realise')::int AS realise,
              count(*) FILTER (WHERE v.status = 'annule')::int AS annule,
              count(DISTINCT v.site_id) FILTER (WHERE v.status <> 'annule')::int AS "sitesPlanned",
              count(DISTINCT v.site_id) FILTER (WHERE v.status = 'realise')::int AS "sitesRealised"
         FROM site_visits v
         JOIN sites s ON s.id = v.site_id AND s.tenant_id = v.tenant_id
         LEFT JOIN field_offices fo ON fo.id = s.field_office_id AND fo.tenant_id = s.tenant_id
         LEFT JOIN partners p ON p.id = v.provider_id AND p.tenant_id = v.tenant_id
        WHERE v.tenant_id = $1 AND ${within}${scope}
        GROUP BY 1`,
      pp
    );
    const { byProvider } = shapeRangeSummary([], providers);
    return { period: periodInfo(period), ...shapeCoverageFacts(rows), byProvider };
  });
}

/**
 * Plan de suivi d'un exercice : sites (critères, bureau + parent, dernière
 * visite effective, données reçues), visites de l'année agrégées en SQL par
 * site (json_agg) et lignes MMR — puis compteurs exigées/faites/prévues/reste,
 * priorité et classement par la logique pure (planBoard, rbmScore).
 */
async function planBoard(tenantId, opts) {
  return withTenantTransaction(tenantId, (client) => planBoardWithTpmTx(client, tenantId, opts));
}

/** Plan de suivi + TPM de zone de chaque site, sur le client de l'appelant (planification automatique). */
async function planBoardWithTpmTx(client, tenantId, opts) {
  const board = await planBoardTx(client, tenantId, opts);
  // Retour 58 : TPM de la zone de chaque site — mois courant s'il est dans l'exercice (sinon
  // décembre d'un exercice passé, janvier d'un exercice à venir) et segments de l'exercice.
  const y = Number(board.year); const cur = currentMonth();
  const refMonth = cur.startsWith(`${y}-`) ? cur : (String(y) < cur.slice(0, 4) ? `${y}-12` : `${y}-01`);
  const tpm = await boardTpmTx(client, tenantId, { year: y, refMonth, siteIds: board.sites.map((s) => s.id) });
  for (const s of board.sites) s.tpm = tpm.get(s.id) || null;
  return { ...board, tpmRefMonth: refMonth };
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
            COALESCE(vv.months, '[]'::json) AS months, vv.providers AS "providers", COALESCE(vv.cancelled, '{}') AS "cancelledMonths",
            (SELECT json_object_agg(ms.month, ms.active) FROM site_month_status ms
              WHERE ms.tenant_id = $1 AND ms.site_id = b.id AND ms.year = extract(year FROM $2::date)) AS "monthStatus"
       FROM base b
       LEFT JOIN field_offices o ON o.id = b."fieldOfficeId"
       LEFT JOIN communes cp ON cp.pcode = b."adm3Pcode"
       LEFT JOIN communes cn ON cp.pcode IS NULL AND cn.lc = lower(COALESCE(b.adm3, b.commune)) AND cn.ld = lower(COALESCE(b.adm2, b.district))
       LEFT JOIN site_gps sg ON sg.lc = lower(COALESCE(b.adm3, b.commune)) AND sg.ld = lower(COALESCE(b.adm2, b.district))
       LEFT JOIN districts dn ON dn.ld = lower(COALESCE(b.adm2, b.district))
       LEFT JOIN LATERAL (
         -- Visites de l'exercice, avec le prestataire de suivi (TPM) affecté à chacune. Les mois
         -- d'une visite ANNULÉE sont rendus à part (cancelledMonths) : une annulation est une
         -- décision, la planification automatique n'y replace jamais de visite.
         SELECT json_agg(json_build_object('month', extract(month FROM v.period_month)::int, 'status', v.status,
                                           'date', to_char(v.visit_date, 'YYYY-MM-DD'), 'provider', p.name, 'src', v.provider_source) ORDER BY v.period_month)
                  FILTER (WHERE v.status <> 'annule') AS months,
                string_agg(DISTINCT p.name, ', ') FILTER (WHERE v.status <> 'annule') AS providers,
                array_agg(DISTINCT extract(month FROM v.period_month)::int) FILTER (WHERE v.status = 'annule') AS cancelled
           FROM site_visits v
           LEFT JOIN partners p ON p.id = v.provider_id AND p.tenant_id = v.tenant_id
          WHERE v.tenant_id = $1 AND v.site_id = b.id AND v.period_month BETWEEN $2 AND $3
       ) vv ON true
      ORDER BY b.district, b.commune, b.name`, params);
  const { rows: mmr } = await client.query(
    `SELECT field_office_id AS "fieldOfficeId", activity_category AS "activityCategory", operation_duration AS "operationDuration",
            number_of_sites AS "numberOfSites", risk_level AS "riskLevel", feasible, persons_to_deploy AS "personsToDeploy",
            visits_per_day::float8 AS "visitsPerDay", working_days AS "workingDays"
       FROM mmr_parameters WHERE tenant_id = $1`, [tenantId]);
  const lookup = mmrLookup(mmr);
  const target = `${y}-12`;
  // L'exercice a-t-il une grille d'activation (au moins un statut) ? → règle commune isActiveMonth,
  // la même que la garde SQL activeMonthSql des écritures.
  const { rows: [grid] } = await client.query(
    'SELECT EXISTS (SELECT 1 FROM site_month_status WHERE tenant_id = $1 AND year = $2) AS has_grid', [tenantId, y]);
  const yearHasGrid = Boolean(grid && grid.has_grid);
  const out = sites.map((row) => {
    // Dernière visite = visite réalisée ou collecte réelle (jamais une visite seulement prévue) ;
    // la prochaine visite prévue est rendue à part, vue depuis le mois courant.
    const s = { ...row, ...visitState(row, currentMonth()) };
    const mmrRow = lookup(s.fieldOfficeId, s.parentOfficeId, s.activity);
    const score = scoreSite(s, { targetMonth: target });
    const counters = siteCounters({ months: s.months }, mmrRow, { adjusted });
    // Statut affiché = dernier mois renseigné (colonne Status du classeur). Règle commune : une
    // année qui a une grille ne planifie que les « Oui » ; un site sans aucun statut cette année-là
    // est donc « non renseigné », non planifiable (inactive), jamais « actif par défaut ».
    const status = currentStatus(s.monthStatus);
    return {
      id: s.id, code: s.code, publicId: s.publicId, locationId: s.locationId, name: s.name, region: s.adm1, district: s.district, commune: s.commune,
      activity: s.activity, bureau: s.subOfficeName || s.antenneName || null, fieldOfficeId: s.fieldOfficeId, parentOfficeId: s.parentOfficeId || null,
      mmrKey: mmrKeyOf(mmrRow),
      riskLevel: s.riskLevel, priority: score.priorityLabel, finalScore: score.finalScore, urgent: Boolean(score.urgentFlags),
      forbidden: Number(s.security) >= 99,
      status, inactive: status === 'Inactive' || (yearHasGrid && !status), monthStatus: s.monthStatus || {},
      lastVisitMonth: s.lastVisitMonth, lastVisitSource: s.lastVisitSource, nextPlannedMonth: s.nextPlannedMonth,
      dataCount: s.dataVisitCount, months: s.months, cancelledMonths: s.cancelledMonths || [],
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
  return { year: y, adjusted, yearHasGrid, sites: rankSites(out), kpis: boardKpis(out), capacity };
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
  const pm = (m) => `${year}-${String(m).padStart(2, '0')}-01`;
  // Ordre des verrous (le même pour tous les écrivains de plan) : mois des visites touchées
  // (visitLocks, croissants, attente bornée) PUIS verrou d'attribution (retour 58) — jamais
  // l'inverse, aucun interblocage avec « Générer depuis le RBM » ni la planification automatique.
  await client.query("SET LOCAL lock_timeout = '20s'");
  await lockVisitMonthsTx(client, tenantId, [...add, ...remove].map(([, m]) => pm(m)));
  await lockAttributionTx(client, tenantId); // une visite annulée re-cochée est mise à jour (retour 58)
  const { rows: known } = await client.query('SELECT id, activity FROM sites WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
  if (known.length !== ids.length) throw badRequest('Site inconnu (ou hors de ce compte).');
  const activity = new Map(known.map((k) => [k.id, k.activity || null]));
  let added = 0; let removed = 0;
  // Un site inactif un mois (règle commune isActiveMonth : année avec grille → « Oui » explicite
  // seulement) n'est pas planifiable ce mois-là.
  const act = await yearActivityTx(client, tenantId, Number(year), { siteIds: ids });
  const skippedInactive = add.filter(([id, m]) => !act.isActive(id, m)).length;
  add = add.filter(([id, m]) => act.isActive(id, m));
  // Par lots (limite de paramètres de PostgreSQL) : 5 000 sites × 12 mois en une modification groupée.
  for (const slice of chunkRows(add, 3)) {
    const params = [tenantId, userId]; const tuples = slice.map(([id, m]) => {
      params.push(id, pm(m), activity.get(id));
      const b = params.length - 2;
      return `($1::uuid, $${b}::uuid, $${b + 1}::date, $${b + 2}::text, 'planifie', $2::uuid)`;
    });
    // Garde en base de la même règle (activeMonthSql), sous les verrous des mois.
    const { rowCount } = await client.query(
      `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, created_by)
       SELECT t.tenant_id, t.site_id, t.pm, t.activity, t.status, t.created_by
         FROM (VALUES ${tuples.join(',')}) AS t(tenant_id, site_id, pm, activity, status, created_by)
        WHERE ${activeMonthSql({ site: 't.site_id', year: 'extract(year FROM t.pm)::int', month: 'extract(month FROM t.pm)::int' })}
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
  // Retour 58 : visites prévues (ou re-planifiées) au TPM de leur zone, sauf écart motivé.
  await restampVisitsTx(client, tenantId);
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
    // Listes du découpage (Paramétrage › Localités) pour les listes déroulantes Admin level 1-3 du classeur.
    const { rows: areas } = await client.query(
      'SELECT DISTINCT depth, name FROM admin_areas WHERE tenant_id = $1 AND depth BETWEEN 1 AND 3 ORDER BY depth, name', [tenantId]);
    const places = { regions: [], districts: [], communes: [] };
    for (const a of areas) (a.depth === 1 ? places.regions : a.depth === 2 ? places.districts : places.communes).push(a.name);
    return { sites: sites.map((x) => ({ ...x, finalScore: scoreSite(x, {}).finalScore })), offices, places };
  });
}

/**
 * Import du registre (lignes déjà validées par parseLocationsWorkbook).
 * Rapproche par ID L### puis par district + commune + nom ; `commit=false` =
 * aperçu (rien n'est écrit). En écriture : mises à jour, créations, statuts
 * mensuels et mois prévus — requêtes multi-lignes, une seule transaction.
 */
async function importLocations(tenantId, userId, { year, rows }, { commit = false } = {}) {
  return (commit ? withSubmissionLinks : withTenantTransaction)(tenantId, async (client) => {
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
    await afterSitesChangedTx(client, tenantId); // registre modifié : lieux, bureau et formulaires reçus reliés à nouveau
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
  return withSubmissionLinks(tenantId, async (client) => {
    const ids = [...new Set(siteIds)];
    // Ordre des verrous des écrivains de plan : rattachements (withSubmissionLinks) → mois de
    // l'exercice (visitLocks, croissants, attente bornée) → lignes des sites → attribution
    // (retour 58). Les mois AVANT « sites FOR UPDATE » : « Appliquer » le plan automatique et
    // « Générer depuis le RBM » tiennent ces mois puis insèrent (clé étrangère sur ces mêmes
    // sites) — dans l'autre ordre, interblocage (40P01). planMonthsTx les reprend sans effet.
    if (plan) await lockVisitMonthsTx(client, tenantId, yearMonths(year));
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
        // Un mois d'une visite annulée n'est pas « libre » : une annulation est une décision.
        const busy = [...(s.months || []).map((m) => m.month), ...(s.cancelledMonths || [])];
        // Mois inactifs = règle commune (année avec grille → « Oui » explicite seulement).
        const inactive = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => !isActiveMonth((s.monthStatus || {})[m], board.yearHasGrid));
        autoPlanMonths({ toPlan: s.toPlan, fromMonth: plan.fromMonth, busy, inactive }).forEach((m) => changes.push({ siteId: s.id, month: m, planned: true }));
      }
      result.plan = changes.length ? await planMonthsTx(client, tenantId, userId, year, changes) : { added: 0, removed: 0, skippedInactive: 0 };
      result.plan.skippedSites = skipped;
    } else if (plan) {
      result.plan = await planMonthsTx(client, tenantId, userId, year, ids.map((id) => ({ siteId: id, month: plan.month, planned: plan.planned })));
    }
    await afterSitesChangedTx(client, tenantId); // registre modifié : lieux, bureau et formulaires reçus reliés à nouveau
    return result;
  });
}

/**
 * Ajout d'un site au registre (formulaire « Ajouter un site ») : l'ID L### est
 * attribué par la base, le statut du mois courant passe à Active. Un doublon
 * (district + commune + nom) est refusé, jamais fusionné en silence.
 */
async function addSite(tenantId, s, { today = new Date() } = {}) {
  return withSubmissionLinks(tenantId, async (client) => {
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
    await afterSitesChangedTx(client, tenantId); // registre modifié : lieux, bureau et formulaires reçus reliés à nouveau
    return row;
  });
}

module.exports = {
  reportFieldData, coverageFacts, planBoard, setPlannedMonths, setMonthStatuses, bulkUpdateSites, addSite, locationsExportData, importLocations,
  listSites, createSite, createSiteTx, upsertSites, updateSite,
  listVisits, summary, createVisit, updateVisit, deleteVisit, importPlanning,
  collectionDaysSummary, setTravelDays, coverageRecapSummary, coverageMatrix, monthsOverview, setMonthStatus,
  siteDataFactsSql, rbmSites, rbmCounts, rbmSitesTx, rbmSiteExplain, importMasterData, importPlanSites, generateFromRbm, generateFromRbmTx, planBoardTx,
  planBoardWithTpmTx, monthStatusesTx, yearActivityTx,
};
