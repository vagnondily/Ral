const crypto = require('node:crypto');
const { siteDistrictCtes, keySql } = require('../common/siteActivitySql');
const { MONITORING_LINE } = require('../contracts/budgetCatalog');
const {
  summarizeRestamp, buildZoneTable, cellForSite, segments, tpmSelectable, visitDecision, tpmsByContract, linkPastMonths,
} = require('./tpmAttribution');
// Règle commune « prestataire actif » (lot 8) : liens prestataire ↔ contrat et fiches partenaires.
const activeProviderRepo = require('./activeProvider.repository');
const { currentMonth } = require('./rbmMath');

/**
 * Affectation des TPM par zone (retour 58) — SEUL fichier de ce chantier qui écrit du SQL.
 * Les décisions sont prises par la règle pure (tpmAttribution.js) ; ici on lit les entrées et
 * on applique les résultats. Chaque requête filtre tenant_id = $1, dans la transaction de
 * l'appelant (withTenantTransaction / withSubmissionLinks) ; les requêtes d'un même client
 * s'enchaînent avec await, jamais Promise.all. Ne requiert ni field.repository ni
 * placeMatch.repository (aucun cycle : ce sont eux qui l'appellent).
 *
 * Ordre des verrous, partout (aucun interblocage) : rattachements (withSubmissionLinks) →
 * génération RBM → ligne de contrat (FOR UPDATE pour les écrivains de contrats ; FOR KEY SHARE pour
 * les écrivains du lien TPM ↔ contrat, lockTpmLinkTx) → verrou d'attribution du compte (ici,
 * toujours après la ligne de contrat) → lignes tpm_zone_overrides et site_visits, clés étrangères
 * vers partners (jamais une ligne de partenaire avant le verrou d'attribution : règle du lot 8,
 * partners/partnerRole).
 */

const ATTRIBUTION_KEY = (tenantId) => `tpm-attribution:${tenantId}`;

/**
 * Verrou d'attribution du compte (réentrant dans la transaction) : attente bornée à 20 s, puis
 * 55P03 → 503 « réessayez » (middleware/errors). Le même que prend mems_tpm_stamp en base.
 */
async function lockAttributionTx(client, tenantId) {
  await client.query("SET LOCAL lock_timeout = '20s'");
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ATTRIBUTION_KEY(tenantId)]);
  await client.query('SET LOCAL lock_timeout = DEFAULT');
}

/**
 * Rattachement d'un site à son district du découpage : la règle commune des tableaux de bord
 * (siteDistrictCtes, lot 1b — la graphie du site dans SA région, le P-code n'étant cru que s'il
 * concorde), rapportée au district officiel dont le nom normalisé est la clé du site, dans la
 * région du site (ou unique si le site n'a pas de région). Jumelle pure : tpmAttribution.districtAreaFor.
 * CTE à placer après siteDistrictCtes() ; rend zarea(site_id, district_id).
 */
const ZONE_CTES = `sdcand AS (
       SELECT sd.site_id, d.id AS district_id
         FROM sdist sd
         JOIN sites s ON s.tenant_id = $1 AND s.id = sd.site_id
         JOIN admin_areas d ON d.tenant_id = $1 AND d.depth = 2 AND ${keySql('d.name')} = sd.dkey
         JOIN admin_areas r ON r.tenant_id = $1 AND r.id = d.lineage[1]
        WHERE sd.dkey <> '—' AND ${keySql('s.adm1')} IN ('', ${keySql('r.name')})),
     zarea AS MATERIALIZED (
       SELECT site_id, CASE WHEN count(*) = 1 THEN min(district_id::text)::uuid END AS district_id
         FROM sdcand GROUP BY site_id)`;

/**
 * Zone (district, commune) de chaque site du compte, recalculée et écrite seulement là où elle
 * change (sites.zone_district_id / zone_commune_id, migration 070). Appelée à la fin de chaque
 * rattachement des sites (placeMatch.applySitesGeoTx) : toute écriture de sites ou du découpage
 * y passe. Commune = la localité reconnue du site (admin_area_id) si elle est dans ce district.
 * @returns {Promise<{ changed: number }>}
 */
async function refreshSiteZonesTx(client, tenantId) {
  const { rowCount } = await client.query(
    `WITH ${siteDistrictCtes()},
     ${ZONE_CTES},
     z AS (
       SELECT s.id, za.district_id AS did,
              CASE WHEN a.depth = 3 AND a.lineage[2] = za.district_id THEN a.id
                   WHEN a.depth = 4 AND a.lineage[2] = za.district_id THEN a.lineage[3] END AS cid
         FROM sites s
         LEFT JOIN zarea za ON za.site_id = s.id
         LEFT JOIN admin_areas a ON a.tenant_id = $1 AND a.id = s.admin_area_id
        WHERE s.tenant_id = $1)
     UPDATE sites s SET zone_district_id = z.did, zone_commune_id = z.cid
       FROM z
      WHERE s.tenant_id = $1 AND s.id = z.id
        AND (s.zone_district_id IS DISTINCT FROM z.did OR s.zone_commune_id IS DISTINCT FROM z.cid)`, [tenantId]);
  return { changed: rowCount };
}

/**
 * Visite « déjà facturée » : le TPM qu'elle porte a une facture (rapport financier) SOUMISE ou
 * VALIDÉE pour son mois — ses jours de collecte ont servi à facturer. Aucune re-dérivation
 * automatique (réparation de démarrage, « Appliquer les TPM des contrats », changement de contrat,
 * de zone ou de géographie) ne la touche ; seul un choix explicite, motivé, le peut.
 * Lu par l'index idx_tpm_reports_partner (tenant_id, partner_id, period_month). Alias de visite : v.
 */
const INVOICED_SQL = `EXISTS (SELECT 1 FROM tpm_reports r
   WHERE r.tenant_id = v.tenant_id AND r.partner_id = v.provider_id AND r.period_month = v.period_month
     AND r.kind = 'financier' AND r.status IN ('soumis', 'valide'))`;
/**
 * Visites qu'une re-dérivation automatique peut toucher : PRÉVUES, non figées (« antérieur à la
 * règle », migration 070 b) et pas encore facturées — jamais une visite réalisée ou annulée, dont
 * le TPM est celui qui l'a faite (jours de collecte, base de facture). L'origine « visite » (TPM
 * choisi avec une raison) est exclue par chaque appelant. Jumelle en base : le filtre des p_ids de
 * mems_tpm_stamp (défense en profondeur). Alias de visite : v.
 */
const AUTO_RESTAMPABLE_SQL = `v.status = 'planifie' AND v.provider_zone_state IS DISTINCT FROM 'anterieur' AND NOT ${INVOICED_SQL}`;

/**
 * Clé « qui suit » d'une visite pour les regroupements par TPM (exécution des visites, matrices,
 * rapports attendus) : l'identifiant de son TPM, 'interne' (équipe S&E : colonne générée
 * monitored_by, migration 107) ou 'non_affecte' (antérieure à la règle). Jamais une visite interne
 * comptée « non affectée ». Alias de visite : `alias` (défaut v).
 */
const monitorKeySql = (alias = 'v') => `COALESCE(${alias}.provider_id::text, CASE WHEN ${alias}.monitored_by = 'interne' THEN 'interne' ELSE 'non_affecte' END)`;

/**
 * Re-dérivation du TPM des visites « zone » (mems_tpm_stamp, migration 070 : jumelle SQL de la
 * règle, seule à écrire le TPM d'une visite « zone »). Inclut TOUJOURS les visites « à
 * estampiller » ; la portée ajoute des visites prévues, non figées et non facturées
 * (AUTO_RESTAMPABLE_SQL) :
 *   {}                    rien de plus (écrivains de visites) ;
 *   { fromMonth }         prévues des mois ≥ fromMonth (contrats, géographie des sites) ;
 *   { areaIds, months }   prévues dont le district OU la commune est visé, ces mois-là, passés
 *                         compris (modification d'une zone) ;
 *   { from, to }          prévues de la plage (« Réappliquer ») ;
 *   { visitIds }          visites que l'appelant VIENT de créer (seeds, avant que les zones des sites
 *                         soient connues) : rendues « à estampiller » puis estampillées comme à leur
 *                         création, quel que soit leur statut — jamais une visite d'un autre auteur.
 * Une visite réalisée, annulée, figée (« antérieur ») ou déjà facturée (INVOICED_SQL), « visite »
 * ou « reprise » n'est jamais recalculée par une portée. Idempotent : un 2ᵉ appel n'écrit rien.
 * @returns {Promise<{ changed, byState, moves }>}
 */
async function restampVisitsTx(client, tenantId, scope = {}) {
  await lockAttributionTx(client, tenantId);
  const params = [tenantId];
  let where = null;
  const planned = `v.provider_source = 'zone' AND ${AUTO_RESTAMPABLE_SQL}`;
  if (Array.isArray(scope.visitIds)) {
    if (scope.visitIds.length) {
      await client.query(
        `UPDATE site_visits v SET provider_zone_state = NULL, updated_at = now()
          WHERE v.tenant_id = $1 AND v.provider_source = 'zone' AND v.id = ANY ($2::uuid[])
            AND v.provider_zone_state IS NOT NULL`, [tenantId, scope.visitIds]);
    }
  } else if (scope.fromMonth) {
    params.push(`${String(scope.fromMonth).slice(0, 7)}-01`);
    where = `${planned} AND v.period_month >= $2::date`;
  } else if (Array.isArray(scope.areaIds) && Array.isArray(scope.months)) {
    params.push(scope.areaIds, scope.months.map((m) => `${String(m).slice(0, 7)}-01`));
    where = `${planned} AND v.period_month = ANY ($3::date[])
             AND EXISTS (SELECT 1 FROM sites s WHERE s.tenant_id = $1 AND s.id = v.site_id
                          AND (s.zone_district_id = ANY ($2::uuid[]) OR s.zone_commune_id = ANY ($2::uuid[])))`;
  } else if (scope.from && scope.to) {
    params.push(`${String(scope.from).slice(0, 7)}-01`, `${String(scope.to).slice(0, 7)}-01`);
    where = `${planned} AND v.period_month BETWEEN $2::date AND $3::date`;
  }
  const ids = where ? `ARRAY(SELECT v.id FROM site_visits v WHERE v.tenant_id = $1 AND ${where})` : "'{}'::uuid[]";
  const { rows } = await client.query(
    `SELECT o_id AS id, o_old_provider AS "fromProviderId", o_new_provider AS "providerId", o_state AS "zoneState", o_dated AS dated
       FROM mems_tpm_stamp($1, ${ids})`, params);
  return summarizeRestamp(rows);
}

/**
 * Lien TPM ↔ contrat (D1) : le TPM d'un contrat vient de ses plans de collecte et de ses factures /
 * rapports. Existe-t-il au moins un document de ce couple ? (lu avant et après une écriture).
 */
async function tpmLinkExistsTx(client, tenantId, partnerId, contractId) {
  const { rows: [r] } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM tpm_collection_plans WHERE tenant_id = $1 AND partner_id = $2 AND contract_id = $3)
         OR EXISTS (SELECT 1 FROM tpm_reports WHERE tenant_id = $1 AND partner_id = $2 AND contract_id = $3) AS ok`,
    [tenantId, partnerId, contractId]);
  return Boolean(r && r.ok);
}

/**
 * Écrivains du lien TPM ↔ contrat (plans de collecte, factures / rapports, gabarits mensuels :
 * création et suppression), en tête de leur transaction, dans l'ordre de l'en-tête :
 *   1. création (contractId donné) : la ligne du contrat FOR KEY SHARE — le verrou que la clé
 *      étrangère du document prendrait de toute façon, pris AVANT le verrou d'attribution, comme les
 *      écrivains de contrats (ligne FOR UPDATE, puis restampFromNow). Prise après, elle formait un
 *      cycle avec une approbation d'avenant, une validation ou une résiliation du même contrat
 *      (re-relecture, point 1 : 40P01) ; FOR KEY SHARE ne gêne ni un FOR NO KEY UPDATE du contrat ni
 *      la fiche du partenaire ;
 *   2. le verrou d'attribution du compte, AVANT toute lecture du lien, la ligne du document et sa clé
 *      étrangère vers partners (« verrou d'abord », règle du lot 8) : deux écrivains du même compte se
 *      suivent, le second lit le lien laissé par le premier (deux suppressions des deux derniers
 *      documents, ou une création pendant une suppression, ne sautent jamais la ré-estampille).
 * Réentrant : restampVisitsTx reprend le verrou d'attribution.
 * @returns {Promise<{ partnerId, contractId, had: boolean }|null>}  lien AVANT l'écriture (création) ;
 *   sans partnerId / contractId (suppression : lus ensuite sur le document), seulement le verrou.
 */
async function lockTpmLinkTx(client, tenantId, { partnerId = null, contractId = null } = {}) {
  if (contractId) await client.query('SELECT 1 FROM contracts WHERE tenant_id = $1 AND id = $2 FOR KEY SHARE', [tenantId, contractId]);
  await lockAttributionTx(client, tenantId);
  if (!partnerId || !contractId) return null;
  return { partnerId, contractId, had: await tpmLinkExistsTx(client, tenantId, partnerId, contractId) };
}

/**
 * Portée PASSÉE d'un changement de lien (re-relecture, point 2) : les mois passés que le contrat
 * couvre (rule.linkPastMonths) × SES zones — districts et communes de contract_areas, régions
 * étendues à leurs districts (une zone détachée ou un fokontany ne décide de rien). Jamais les
 * visites d'un autre contrat ou d'une autre zone : le passé ne se réécrit pas en silence ailleurs.
 * @returns {Promise<{ areaIds: string[], months: string[] }|null>}  null : rien de passé à recalculer
 */
async function linkPastScopeTx(client, tenantId, contractId, docMonth, today) {
  const { rows: [c] } = await client.query(
    `SELECT c.status, c.date_debut AS "dateDebut", c.date_fin AS "dateFin", c.termination_date AS "terminationDate",
            (SELECT COALESCE(sum(b.unit_count * b.unit_cost), 0) FROM contract_budget_items b
              WHERE b.tenant_id = $1 AND b.contract_id = c.id AND b.line_code = $3) > 0 AS monitoring
       FROM contracts c WHERE c.tenant_id = $1 AND c.id = $2`, [tenantId, contractId, MONITORING_LINE]);
  const months = linkPastMonths(c, docMonth, today);
  if (!months.length) return null;
  const { rows: zones } = await client.query(
    `SELECT DISTINCT a.id, a.depth FROM contract_areas z
       JOIN admin_areas a ON a.tenant_id = z.tenant_id AND a.id = z.admin_area_id
      WHERE z.tenant_id = $1 AND z.contract_id = $2 AND a.depth <= 3`, [tenantId, contractId]);
  const areaIds = zones.filter((z) => Number(z.depth) >= 2).map((z) => z.id);
  areaIds.push(...await expandRegionsTx(client, tenantId, zones.filter((z) => Number(z.depth) === 1).map((z) => z.id)));
  return areaIds.length ? { areaIds: [...new Set(areaIds)], months } : null;
}

/**
 * Après l'écriture, sous le verrou pris par lockTpmLinkTx : le premier document d'un couple TPM ×
 * contrat, ou la suppression du dernier, change le TPM du contrat — les visites prévues
 * ré-estampillables (AUTO_RESTAMPABLE_SQL : jamais réalisées, annulées, figées, facturées ou motivées)
 * sont recalculées dans la MÊME transaction : du mois du document s'il est passé au mois précédent,
 * dans les SEULES zones du contrat (linkPastScopeTx) ; puis du mois courant, pour tout le compte
 * (comme contracts.service.restampFromNow). Sans changement du lien : rien.
 * @param {{ partnerId, contractId, had: boolean, month?: string }} link
 *   had = lien avant l'écriture ; month = premier mois du document (« AAAA-MM… »)
 * @returns {Promise<{ changed, past, current }|null>}  visites changées (passé dans les zones, puis courant)
 */
async function restampIfTpmLinkChangedTx(client, tenantId, { partnerId, contractId, had, month = null }) {
  if (!partnerId || !contractId || had === await tpmLinkExistsTx(client, tenantId, partnerId, contractId)) return null;
  const today = currentMonth();
  const scope = await linkPastScopeTx(client, tenantId, contractId, month, today);
  const past = scope ? await restampVisitsTx(client, tenantId, scope) : null;
  const current = await restampVisitsTx(client, tenantId, { fromMonth: today });
  return { changed: (past ? past.changed : 0) + current.changed, past, current };
}

// ---- Entrées de la règle ------------------------------------------------------------
const toMonthDate = (m) => `${String(m).slice(0, 7)}-01`;

/** Partenaires du compte avec le code de leur type (« tpm », « prestataire »…) — règle commune (lot 8). */
const partnersTx = (client, tenantId) => activeProviderRepo.partnersTx(client, tenantId);

/**
 * Entrées de la règle pour une plage de mois : contrats « actif » ou « résilié » qui la
 * chevauchent (avec « contrat de suivi » calculé en SQL, leur titulaire — type et fiche active, pour
 * la décision D1 —, leurs zones — profondeur, chemin et lignée lus dans le découpage — et leurs TPM
 * rattachés), modifications de ces mois (liées et détachées), indisponibilités des TPM (retour
 * 114), partenaires et liens prestataire ↔ contrat de la règle commune (lot 8).
 */
async function loadInputsTx(client, tenantId, { from, to }) {
  const { rows: contracts } = await client.query(
    `SELECT c.id, c.numero, c.numero_fla AS "numeroFla", c.status, c.partner_id AS "partnerId", COALESCE(p.name, c.partner_name) AS "partnerName",
            pt.code AS "holderTypeCode", COALESCE(p.active, false) AS "holderActive",
            c.date_debut AS "dateDebut", c.date_fin AS "dateFin", c.termination_date AS "terminationDate",
            (SELECT COALESCE(sum(b.unit_count * b.unit_cost), 0) FROM contract_budget_items b
              WHERE b.tenant_id = $1 AND b.contract_id = c.id AND b.line_code = $4) > 0 AS monitoring
       FROM contracts c LEFT JOIN partners p ON p.tenant_id = c.tenant_id AND p.id = c.partner_id
       LEFT JOIN partner_types pt ON pt.tenant_id = c.tenant_id AND pt.id = p.partner_type_id
      WHERE c.tenant_id = $1 AND c.status IN ('actif', 'resilie')
        AND date_trunc('month', c.date_debut)::date <= $3::date
        AND date_trunc('month', CASE WHEN c.status = 'resilie' THEN c.termination_date ELSE c.date_fin END)::date >= $2::date
      ORDER BY c.numero`, [tenantId, toMonthDate(from), toMonthDate(to), MONITORING_LINE]);
  const ids = contracts.map((c) => c.id);
  const { rows: zones } = ids.length ? await client.query(
    `SELECT z.contract_id AS "contractId", z.admin_area_id AS "adminAreaId", COALESCE(a.depth, z.depth) AS depth,
            COALESCE(a.path, z.path) AS path, COALESCE(a.lineage, '{}'::uuid[]) AS lineage
       FROM contract_areas z LEFT JOIN admin_areas a ON a.tenant_id = $1 AND a.id = z.admin_area_id
      WHERE z.tenant_id = $1 AND z.contract_id = ANY ($2::uuid[])
      ORDER BY z.sort_order, z.path`, [tenantId, ids]) : { rows: [] };
  const byContract = new Map(contracts.map((c) => [c.id, (c.zones = [])]));
  for (const z of zones) byContract.get(z.contractId).push({ adminAreaId: z.adminAreaId, depth: Number(z.depth), path: z.path, lineage: z.lineage || [] });
  const overrides = await overridesTx(client, tenantId, { from, to });
  const unavailability = await unavailabilityTx(client, tenantId, { from, to });
  const partners = await partnersTx(client, tenantId);
  const links = await activeProviderRepo.providerLinksTx(client, tenantId);
  const tpms = tpmsByContract(links, partners);
  for (const c of contracts) c.tpms = tpms.get(c.id) || [];
  return { contracts, overrides, unavailability, partners, links };
}

/**
 * Indisponibilités des TPM sur les mois [from, to] (retour 114, tpm_unavailability : une ligne par
 * TPM × mois), avec le nom du TPM et l'auteur de la dernière décision. `providerId` : un seul TPM.
 */
async function unavailabilityTx(client, tenantId, { from, to, providerId = null }) {
  const { rows } = await client.query(
    `SELECT u.id, u.provider_id AS "providerId", p.name AS "providerName", to_char(u.period_month, 'YYYY-MM') AS month,
            u.reason, u.batch_id AS "batchId", u.updated_at AS "updatedAt", u.created_at AS "createdAt",
            COALESCE(us.full_name, us.email::text) AS "updatedByName"
       FROM tpm_unavailability u
       JOIN partners p ON p.tenant_id = u.tenant_id AND p.id = u.provider_id
       LEFT JOIN users us ON us.tenant_id = u.tenant_id AND us.id = COALESCE(u.updated_by, u.created_by)
      WHERE u.tenant_id = $1 AND u.period_month BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR u.provider_id = $4::uuid)
      ORDER BY p.name, u.provider_id, u.period_month`,
    [tenantId, toMonthDate(from), toMonthDate(to), providerId]);
  return rows;
}

/** Modifications des mois [from, to] (liées et détachées), avec l'auteur de la dernière décision. */
async function overridesTx(client, tenantId, { from, to }) {
  const { rows } = await client.query(
    `SELECT o.id, o.admin_area_id AS "adminAreaId", o.area_path AS "areaPath", o.area_depth AS "areaDepth",
            to_char(o.period_month, 'YYYY-MM') AS month, o.provider_id AS "providerId",
            o.expected_state AS "expectedState", o.expected_provider_id AS "expectedProviderId", o.expected_label AS "expectedLabel",
            o.reason, o.batch_id AS "batchId", o.updated_at AS "updatedAt",
            COALESCE(u.full_name, u.email::text) AS "updatedByName"
       FROM tpm_zone_overrides o
       LEFT JOIN users u ON u.tenant_id = o.tenant_id AND u.id = COALESCE(o.updated_by, o.created_by)
      WHERE o.tenant_id = $1 AND o.period_month BETWEEN $2::date AND $3::date
      ORDER BY o.period_month, o.area_path`, [tenantId, toMonthDate(from), toMonthDate(to)]);
  return rows;
}

/** Aires (district / commune) avec leur lignée et leur région. */
async function areasTx(client, tenantId, ids) {
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT a.id, a.depth, a.name, a.path, a.lineage, a.pcode,
            CASE WHEN a.depth = 1 THEN a.id ELSE a.lineage[1] END AS "regionId",
            COALESCE(r.name, a.name) AS "regionName",
            CASE WHEN a.depth = 3 THEN a.lineage[2] END AS "districtId"
       FROM admin_areas a
       LEFT JOIN admin_areas r ON r.tenant_id = a.tenant_id AND r.id = a.lineage[1]
      WHERE a.tenant_id = $1 AND a.id = ANY ($2::uuid[])`, [tenantId, [...new Set(ids)]]);
  return rows.map((r) => ({ ...r, depth: Number(r.depth), lineage: r.lineage || [] }));
}

/**
 * Communes qui peuvent avoir leur propre ligne sur la plage : zone de contrat exactement sur une
 * commune (contrats chargés) ou modification posée sur une commune.
 */
function communeRowIds({ contracts, overrides }) {
  const ids = new Set();
  for (const c of contracts) for (const z of c.zones) if (z.adminAreaId && z.depth === 3) ids.add(z.adminAreaId);
  for (const o of overrides) if (o.adminAreaId && Number(o.areaDepth) === 3) ids.add(o.adminAreaId);
  return [...ids];
}

/**
 * Lignes de l'onglet : districts qui ont au moins un site, districts dont une zone de contrat
 * (district) couvre la plage, aires des modifications ; tous les districts du découpage si `all` ;
 * plus les sites par district et par commune et le nombre de sites sans district reconnu.
 */
async function zoneRowsTx(client, tenantId, { regionId = null, all = false, inputs }) {
  const { rows: siteCounts } = await client.query(
    `SELECT zone_district_id AS "districtId", zone_commune_id AS "communeId", count(*)::int AS n
       FROM sites WHERE tenant_id = $1 GROUP BY 1, 2`, [tenantId]);
  const districtIds = new Set();
  for (const r of siteCounts) if (r.districtId) districtIds.add(r.districtId);
  for (const c of inputs.contracts) for (const z of c.zones) if (z.adminAreaId && z.depth === 2) districtIds.add(z.adminAreaId);
  for (const o of inputs.overrides) if (o.adminAreaId && Number(o.areaDepth) === 2) districtIds.add(o.adminAreaId);
  if (all) {
    const { rows } = await client.query('SELECT id FROM admin_areas WHERE tenant_id = $1 AND depth = 2', [tenantId]);
    for (const r of rows) districtIds.add(r.id);
  }
  const communeIds = communeRowIds(inputs);
  let areas = await areasTx(client, tenantId, [...districtIds, ...communeIds]);
  if (regionId) areas = areas.filter((a) => a.regionId === regionId);
  return { areas, siteCounts };
}

/** Visites de la plage, regroupées par zone du site × mois × statut × origine × TPM (comptes en SQL). */
async function visitGroupsTx(client, tenantId, { from, to }) {
  const { rows } = await client.query(
    `SELECT s.zone_district_id AS "districtId", s.zone_commune_id AS "communeId", to_char(v.period_month, 'YYYY-MM') AS month,
            v.status, v.provider_source AS source, v.provider_zone_state AS "zoneState", v.provider_id AS "providerId", count(*)::int AS n,
            count(*) FILTER (WHERE v.visit_date IS NOT NULL)::int AS dated
       FROM site_visits v JOIN sites s ON s.tenant_id = v.tenant_id AND s.id = v.site_id
      WHERE v.tenant_id = $1 AND v.period_month BETWEEN $2::date AND $3::date
      GROUP BY 1, 2, 3, 4, 5, 6, 7`, [tenantId, toMonthDate(from), toMonthDate(to)]);
  return rows;
}

/** Districts (avec au moins un site) des régions demandées — « toute la région ». */
async function expandRegionsTx(client, tenantId, regionIds) {
  if (!regionIds.length) return [];
  const { rows } = await client.query(
    `SELECT DISTINCT d.id FROM admin_areas d
       JOIN sites s ON s.tenant_id = d.tenant_id AND s.zone_district_id = d.id
      WHERE d.tenant_id = $1 AND d.depth = 2 AND d.lineage[1] = ANY ($2::uuid[])`, [tenantId, regionIds]);
  return rows.map((r) => r.id);
}

/**
 * Visites prévues « zone » (hors antérieures et déjà facturées : AUTO_RESTAMPABLE_SQL) d'aires × mois,
 * avec la zone de leur site : exactement celles que restampVisitsTx({ areaIds, months }) recalcule
 * (aperçu = enregistrement).
 */
async function plannedZoneVisitsTx(client, tenantId, { areaIds, months }) {
  const { rows } = await client.query(
    `SELECT v.id, s.zone_district_id AS "districtId", s.zone_commune_id AS "communeId", to_char(v.period_month, 'YYYY-MM') AS month,
            v.provider_id AS "providerId", v.provider_zone_state AS "zoneState", v.contract_id AS "contractId",
            (v.visit_date IS NOT NULL) AS dated
       FROM site_visits v JOIN sites s ON s.tenant_id = v.tenant_id AND s.id = v.site_id
      WHERE v.tenant_id = $1 AND v.provider_source = 'zone' AND ${AUTO_RESTAMPABLE_SQL}
        AND v.period_month = ANY ($3::date[])
        AND (s.zone_district_id = ANY ($2::uuid[]) OR s.zone_commune_id = ANY ($2::uuid[]))`,
    [tenantId, areaIds, months.map(toMonthDate)]);
  return rows;
}

/** Visites (≤ 500) verrouillées pour une décision, avec la zone de leur site. */
async function visitsForUpdateTx(client, tenantId, ids) {
  const { rows } = await client.query(
    `SELECT v.id, v.site_id AS "siteId", s.name AS "siteName", s.location_id AS "locationId",
            s.zone_district_id AS "districtId", s.zone_commune_id AS "communeId",
            to_char(v.period_month, 'YYYY-MM') AS month, v.status, v.provider_id AS "providerId",
            v.provider_source AS source, v.provider_zone_state AS "zoneState"
       FROM site_visits v JOIN sites s ON s.tenant_id = v.tenant_id AND s.id = v.site_id
      WHERE v.tenant_id = $1 AND v.id = ANY ($2::uuid[])
      ORDER BY v.id
        FOR UPDATE OF v`, [tenantId, ids]);
  return rows;
}

/** Zone d'un site (district, commune) — lecture. */
async function siteZoneTx(client, tenantId, siteId) {
  const { rows: [s] } = await client.query(
    `SELECT s.id, s.name, s.zone_district_id AS "districtId", s.zone_commune_id AS "communeId"
       FROM sites s WHERE s.tenant_id = $1 AND s.id = $2`, [tenantId, siteId]);
  return s || null;
}

/** Statuts des plans mensuels (avertissement « plan validé » de l'aperçu). */
async function monthPlanStatusesTx(client, tenantId, months) {
  const { rows } = await client.query(
    `SELECT to_char(period_month, 'YYYY-MM') AS month, status FROM field_month_plans
      WHERE tenant_id = $1 AND period_month = ANY ($2::date[])`, [tenantId, months.map(toMonthDate)]);
  return rows;
}

// ---- Écritures --------------------------------------------------------------------
/** Suppression des modifications (une instruction). */
async function deleteOverridesTx(client, tenantId, ids) {
  if (!ids.length) return 0;
  const { rowCount } = await client.query('DELETE FROM tpm_zone_overrides WHERE tenant_id = $1 AND id = ANY ($2::uuid[])', [tenantId, ids]);
  return rowCount;
}

/**
 * Création / mise à jour des modifications (une instruction multi-lignes). Chemin et profondeur
 * viennent du DÉCOUPAGE (jointure admin_areas), jamais du client ; une aire hors district /
 * commune ou hors compte ne produit aucune ligne (contrôlé avant par le service).
 */
async function upsertOverridesTx(client, tenantId, { actorId, batchId, reason, rows }) {
  if (!rows.length) return 0;
  const { rowCount } = await client.query(
    `INSERT INTO tpm_zone_overrides (tenant_id, admin_area_id, area_path, area_depth, period_month, provider_id,
                                     expected_state, expected_provider_id, expected_label, reason, batch_id, created_by, updated_by)
     SELECT $1, a.id, a.path, a.depth, u.m, u.provider_id, u.expected_state, u.expected_provider_id, u.expected_label, $2, $3, $4, $4
       FROM unnest($5::uuid[], $6::date[], $7::uuid[], $8::text[], $9::uuid[], $10::text[])
              AS u(area_id, m, provider_id, expected_state, expected_provider_id, expected_label)
       JOIN admin_areas a ON a.tenant_id = $1 AND a.id = u.area_id AND a.depth IN (2, 3)
     ON CONFLICT (tenant_id, admin_area_id, period_month) WHERE admin_area_id IS NOT NULL DO UPDATE SET
       provider_id = EXCLUDED.provider_id, expected_state = EXCLUDED.expected_state,
       expected_provider_id = EXCLUDED.expected_provider_id, expected_label = EXCLUDED.expected_label,
       reason = EXCLUDED.reason, batch_id = EXCLUDED.batch_id, area_path = EXCLUDED.area_path,
       area_depth = EXCLUDED.area_depth, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [tenantId, reason, batchId, actorId || null,
      rows.map((r) => r.areaId), rows.map((r) => toMonthDate(r.month)), rows.map((r) => r.providerId || null),
      rows.map((r) => r.expectedState), rows.map((r) => r.expectedProviderId || null), rows.map((r) => r.expectedLabel || null)]);
  return rowCount;
}

/**
 * Décisions sur des visites (une instruction) : 'zone' rend la visite à sa zone (la garde en base
 * la remet « à estampiller ») ; 'visite' pose un TPM motivé pour cette visite (contrat effacé).
 */
async function applyVisitDecisionsTx(client, tenantId, actorId, decisions) {
  if (!decisions.length) return 0;
  const { rowCount } = await client.query(
    `UPDATE site_visits v SET
            provider_source = u.source,
            provider_id = CASE WHEN u.source = 'visite' THEN u.provider_id ELSE v.provider_id END,
            contract_id = CASE WHEN u.source = 'visite' THEN NULL ELSE v.contract_id END,
            provider_zone_state = CASE WHEN u.source = 'visite' THEN NULL ELSE v.provider_zone_state END,
            provider_reason = CASE WHEN u.source = 'visite' THEN u.reason END,
            provider_set_by = $2, provider_set_at = now(), updated_at = now()
       FROM unnest($3::uuid[], $4::text[], $5::uuid[], $6::text[]) AS u(id, source, provider_id, reason)
      WHERE v.tenant_id = $1 AND v.id = u.id`,
    [tenantId, actorId || null, decisions.map((d) => d.id), decisions.map((d) => d.source),
      decisions.map((d) => d.providerId || null), decisions.map((d) => d.reason || null)]);
  return rowCount;
}

const LOG_COLS = ['batch_id', 'scope', 'action', 'label', 'admin_area_id', 'period_month', 'visit_id', 'month_from', 'month_to',
  'old_state', 'old_provider_id', 'new_state', 'new_provider_id', 'contract_label', 'zones_changed', 'visits_updated', 'reason', 'old_reason'];
const LOG_TYPES = ['uuid', 'text', 'text', 'text', 'uuid', 'date', 'uuid', 'date', 'date', 'text', 'uuid', 'text', 'uuid', 'text', 'int', 'int', 'text', 'text'];

/**
 * Journal (une instruction, inscription seule) : noms des prestataires et de l'auteur résolus en
 * SQL dans la même instruction — instantanés, aucune clé étrangère.
 */
async function insertLogTx(client, tenantId, actorId, rows) {
  if (!rows.length) return 0;
  const val = (r, c) => {
    const v = r[c];
    if (v === undefined || v === null || v === '') return null;
    return (c === 'period_month' || c === 'month_from' || c === 'month_to') ? toMonthDate(v) : v;
  };
  const params = [tenantId, actorId || null, ...LOG_COLS.map((c) => rows.map((r) => val(r, c)))];
  const { rowCount } = await client.query(
    `INSERT INTO tpm_attribution_log (tenant_id, ${LOG_COLS.join(', ')}, old_provider_name, new_provider_name, changed_by, changed_by_name)
     SELECT $1, ${LOG_COLS.map((c) => `u.${c}`).join(', ')}, po.name, pn.name, $2,
            (SELECT COALESCE(us.full_name, us.email::text) FROM users us WHERE us.tenant_id = $1 AND us.id = $2)
       FROM unnest(${LOG_COLS.map((c, i) => `$${i + 3}::${LOG_TYPES[i]}[]`).join(', ')}) AS u(${LOG_COLS.join(', ')})
       LEFT JOIN partners po ON po.tenant_id = $1 AND po.id = u.old_provider_id
       LEFT JOIN partners pn ON pn.tenant_id = $1 AND pn.id = u.new_provider_id`, params);
  return rowCount;
}

/** Journal : lots (en-têtes) paginés, filtrables ; ou le détail d'un lot (`batchId`). */
async function listLogTx(client, tenantId, { batchId = null, areaId = null, visitId = null, providerId = null, from = null, to = null, action = null, limit = 50, offset = 0 } = {}) {
  const LOG_SELECT = `l.id, l.batch_id AS "batchId", l.scope, l.action, l.label, l.admin_area_id AS "areaId",
       to_char(l.period_month, 'YYYY-MM') AS month, l.visit_id AS "visitId",
       to_char(l.month_from, 'YYYY-MM') AS "monthFrom", to_char(l.month_to, 'YYYY-MM') AS "monthTo",
       l.old_state AS "oldState", l.old_provider_name AS "oldProviderName", l.new_state AS "newState", l.new_provider_name AS "newProviderName",
       l.contract_label AS "contractLabel", l.zones_changed AS "zonesChanged", l.visits_updated AS "visitsUpdated",
       l.reason, l.old_reason AS "oldReason", l.changed_by_name AS "changedByName", l.changed_at AS "changedAt"`;
  if (batchId) {
    const { rows } = await client.query(
      `SELECT ${LOG_SELECT} FROM tpm_attribution_log l
        WHERE l.tenant_id = $1 AND l.batch_id = $2 AND l.scope <> 'lot'
        ORDER BY l.label, l.period_month NULLS LAST LIMIT 2000`, [tenantId, batchId]);
    return { items: rows, total: rows.length };
  }
  const params = [tenantId];
  const where = ["l.tenant_id = $1", "l.scope = 'lot'"];
  if (action) { params.push(action); where.push(`l.action = $${params.length}`); }
  if (from) { params.push(toMonthDate(from)); where.push(`l.month_to >= $${params.length}::date`); }
  if (to) { params.push(toMonthDate(to)); where.push(`l.month_from <= $${params.length}::date`); }
  if (areaId) {
    params.push(areaId);
    where.push(`l.batch_id IN (SELECT x.batch_id FROM tpm_attribution_log x WHERE x.tenant_id = $1 AND x.scope = 'zone' AND x.admin_area_id = $${params.length})`);
  }
  if (visitId) {
    params.push(visitId);
    where.push(`l.batch_id IN (SELECT x.batch_id FROM tpm_attribution_log x WHERE x.tenant_id = $1 AND x.visit_id = $${params.length})`);
  }
  if (providerId) {
    params.push(providerId);
    where.push(`l.batch_id IN (SELECT x.batch_id FROM tpm_attribution_log x WHERE x.tenant_id = $1 AND x.scope = 'tpm' AND x.new_provider_id = $${params.length})`);
  }
  params.push(limit, offset);
  const { rows } = await client.query(
    `SELECT ${LOG_SELECT}, count(*) OVER ()::int AS _total FROM tpm_attribution_log l
      WHERE ${where.join(' AND ')}
      ORDER BY l.changed_at DESC, l.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { items: rows.map(({ _total, ...r }) => r), total: rows.length ? rows[0]._total : 0 };
}

/** Compteurs de l'onglet : sites sans district reconnu, visites prévues reprises (à vérifier). */
async function attributionCountsTx(client, tenantId, { fromMonth }) {
  const { rows: [r] } = await client.query(
    `SELECT (SELECT count(*) FROM sites WHERE tenant_id = $1 AND zone_district_id IS NULL)::int AS "sitesWithoutDistrict",
            (SELECT count(*) FROM site_visits WHERE tenant_id = $1 AND provider_source = 'reprise' AND status = 'planifie'
                AND period_month >= $2::date)::int AS "plannedReprise",
            (SELECT count(*) FROM site_visits WHERE tenant_id = $1 AND provider_source = 'zone' AND provider_zone_state IS NULL)::int AS pending`,
    [tenantId, toMonthDate(fromMonth)]);
  return r;
}

/** Zone (district, commune) des sites demandés — Plan de suivi. */
async function siteZonesTx(client, tenantId, siteIds) {
  if (!siteIds.length) return [];
  const { rows } = await client.query(
    `SELECT id, zone_district_id AS "districtId", zone_commune_id AS "communeId" FROM sites
      WHERE tenant_id = $1 AND id = ANY ($2::uuid[])`, [tenantId, siteIds]);
  return rows;
}

/**
 * Modifications de zones lors d'un réimport du découpage (localities.replaceBreakdown), APRÈS le
 * verrou d'attribution : chemin et profondeur courants, puis les modifications détachées
 * rattachées par chemin (`relinked` : Map idModification → idAire). En cas de collision
 * (zone × mois déjà modifiés), la modification vivante est gardée et l'ancienne reste détachée.
 */
async function refreshOverridePathsTx(client, tenantId) {
  await client.query(
    `UPDATE tpm_zone_overrides o SET area_path = a.path, area_depth = a.depth
       FROM admin_areas a
      WHERE o.tenant_id = $1 AND a.tenant_id = $1 AND a.id = o.admin_area_id AND a.depth IN (2, 3)
        AND (o.area_path IS DISTINCT FROM a.path OR o.area_depth IS DISTINCT FROM a.depth)`, [tenantId]);
  const { rows } = await client.query(
    'SELECT id AS ref, area_path AS path, to_char(period_month, \'YYYY-MM\') AS month FROM tpm_zone_overrides WHERE tenant_id = $1 AND admin_area_id IS NULL', [tenantId]);
  return rows;
}

async function relinkOverridesTx(client, tenantId, pairs) {
  if (!pairs.length) return 0;
  const { rowCount } = await client.query(
    `UPDATE tpm_zone_overrides o SET admin_area_id = a.id, area_path = a.path, area_depth = a.depth
       FROM unnest($2::uuid[], $3::uuid[]) AS u(id, area_id)
       JOIN admin_areas a ON a.tenant_id = $1 AND a.id = u.area_id AND a.depth IN (2, 3)
      WHERE o.tenant_id = $1 AND o.id = u.id AND o.admin_area_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM tpm_zone_overrides x WHERE x.tenant_id = $1 AND x.admin_area_id = a.id AND x.period_month = o.period_month)`,
    [tenantId, pairs.map(([id]) => id), pairs.map(([, area]) => area)]);
  return rowCount;
}

// ---- Indisponibilités des TPM (retour 114) -------------------------------------------
/** Suppression d'indisponibilités (une instruction) : « mettre fin ». */
async function deleteUnavailabilityTx(client, tenantId, ids) {
  if (!ids.length) return 0;
  const { rowCount } = await client.query('DELETE FROM tpm_unavailability WHERE tenant_id = $1 AND id = ANY ($2::uuid[])', [tenantId, ids]);
  return rowCount;
}

/**
 * Indisponibilité d'un TPM sur des mois (une instruction multi-lignes) : création, ou nouveau motif
 * (même TPM × mois). Le TPM est contrôlé par le service (partenaire actif de type TPM du compte) et
 * par la base (clé étrangère, contrôle « même compte »).
 */
async function upsertUnavailabilityTx(client, tenantId, { actorId, providerId, batchId, reason, months }) {
  if (!months.length) return 0;
  const { rowCount } = await client.query(
    `INSERT INTO tpm_unavailability (tenant_id, provider_id, period_month, reason, batch_id, created_by, updated_by)
     SELECT $1, $2, u.m, $3, $4, $5, $5 FROM unnest($6::date[]) AS u(m)
      WHERE EXISTS (SELECT 1 FROM partners p WHERE p.tenant_id = $1 AND p.id = $2)
     ON CONFLICT (tenant_id, provider_id, period_month) DO UPDATE SET
       reason = EXCLUDED.reason, batch_id = EXCLUDED.batch_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [tenantId, providerId, reason, batchId, actorId || null, months.map(toMonthDate)]);
  return rowCount;
}

/**
 * Visites prévues « zone » ré-estampillables (AUTO_RESTAMPABLE_SQL) d'une plage de mois, avec la zone
 * de leur site : exactement celles que restampVisitsTx({ from, to }) recalcule (aperçu = enregistrement).
 */
async function plannedRangeVisitsTx(client, tenantId, { from, to }) {
  const { rows } = await client.query(
    `SELECT v.id, s.zone_district_id AS "districtId", s.zone_commune_id AS "communeId", to_char(v.period_month, 'YYYY-MM') AS month,
            v.provider_id AS "providerId", v.provider_zone_state AS "zoneState", v.contract_id AS "contractId",
            (v.visit_date IS NOT NULL) AS dated
       FROM site_visits v JOIN sites s ON s.tenant_id = v.tenant_id AND s.id = v.site_id
      WHERE v.tenant_id = $1 AND v.provider_source = 'zone' AND ${AUTO_RESTAMPABLE_SQL}
        AND v.period_month BETWEEN $2::date AND $3::date`,
    [tenantId, toMonthDate(from), toMonthDate(to)]);
  return rows;
}

// ---- Table de zones pour un ensemble de sites / visites ------------------------------
/** Cellule réduite pour l'écran et pour les autres modules (TPM, origine, contrat, raison, drapeaux). */
const slimCell = (c) => (c ? {
  areaId: c.areaId || null, // zone qui décide (district, ou commune portée) : lien vers l'onglet
  state: c.state, providerId: c.providerId || null, providerName: c.providerName || null,
  // Qui suit : un TPM, ou l'équipe S&E (« Interne », retour 114) — jamais « à affecter ».
  monitoredBy: c.monitoredBy || (c.providerId ? 'tpm' : 'interne'),
  contractId: c.contractId || null, numero: c.numero || null, contractLabel: c.contractLabel || null,
  reason: c.override ? c.override.reason : null, flags: (c.flags || []).filter((f) => f !== 'titulaire_non_tpm'),
  candidates: c.state === 'a_arbitrer' && c.default
    ? (c.candidates || c.default.candidates).map((x) => ({ providerId: x.providerId, providerName: x.providerName, contractLabel: x.contractLabel })) : undefined,
  detached: c.detached || undefined, // zone de contrat à resélectionner (indice, aucun TPM)
  // Pourquoi « Interne » : contrats de suivi sans TPM (D1), TPM indisponible(s) ce mois (motif).
  noTpm: c.state === 'sans_tpm' && c.default && c.default.noTpm && c.default.noTpm.length ? c.default.noTpm : undefined,
  unavailable: c.unavailable && c.unavailable.length ? c.unavailable : undefined,
} : null);

/**
 * Table zone × mois qui suffit pour situer des sites : leurs districts et communes, plus les
 * communes qui peuvent avoir leur propre ligne. Lecture seule ; l'appelant tient le verrou s'il écrit.
 */
async function tableForSitesTx(client, tenantId, { zones, months, today = null }) {
  const sorted = [...new Set(months)].sort();
  const inputs = await loadInputsTx(client, tenantId, { from: sorted[0], to: sorted[sorted.length - 1] });
  const ids = new Set(communeRowIds(inputs));
  for (const z of zones) { if (z.districtId) ids.add(z.districtId); if (z.communeId) ids.add(z.communeId); }
  const areas = await areasTx(client, tenantId, [...ids]);
  const table = buildZoneTable({ areas, months: sorted, ...inputs, today });
  return { table, inputs, areas, months: sorted };
}

/**
 * Plan de suivi (retour 58, colonne « Prestataire (TPM) ») : pour chaque site, la cellule de sa
 * zone au mois de référence et les segments de l'exercice. Bornée à 12 mois.
 * @returns {Promise<Map<string, { ref, segments }>>}
 */
async function boardTpmTx(client, tenantId, { year, refMonth, siteIds }) {
  const zones = await siteZonesTx(client, tenantId, siteIds);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const { table } = await tableForSitesTx(client, tenantId, { zones, months });
  const slim = slimCell;
  const out = new Map();
  for (const z of zones) {
    const cells = months.map((m) => { const c = cellForSite(z, m, table); return c ? { ...c, month: m, flags: c.flags || [] } : null; }).filter(Boolean);
    out.set(z.id, {
      ref: slim(cellForSite(z, refMonth, table)), refMonth,
      segments: segments(cells).map((s) => ({ from: s.from, to: s.to, ...slim(s.cell) })),
    });
  }
  return out;
}

/**
 * TPM de visites (≤ 500) : décision de la règle pure pour chacune (visitDecision), une
 * instruction d'écriture, estampille des visites rendues à leur zone, journal (un lot + une
 * ligne par visite changée) — dans la transaction de l'appelant, SOUS le verrou d'attribution.
 * `request` : { action:'zone' | 'set' | 'keep', providerId?, reason? } (raison déjà nettoyée).
 * Erreur de règle → { error, visit } (le service ou la route la traduit en 400).
 */
async function applyVisitRequestTx(client, tenantId, actorId, visitIds, request) {
  await lockAttributionTx(client, tenantId);
  const visits = await visitsForUpdateTx(client, tenantId, visitIds);
  if (visits.length !== new Set(visitIds).size) return { error: 'visit_unknown' };
  const { table, inputs, months } = await tableForSitesTx(client, tenantId, { zones: visits, months: visits.map((v) => v.month) });
  const selectable = tpmSelectable({ links: inputs.links, partners: inputs.partners, months, unavailability: inputs.unavailability });
  const decisions = [];
  for (const v of visits) {
    const cell = cellForSite(v, v.month, table);
    const d = visitDecision({ visit: v, cell, request, selectable });
    if (d.error) return { error: d.error, visit: v };
    if (d.source === 'zone' && v.source === 'zone') continue; // suit déjà sa zone
    if (d.source === 'visite' && v.source === 'visite' && (d.providerId || null) === (v.providerId || null) && request.action !== 'keep') continue;
    decisions.push({ id: v.id, ...d, visit: v, cell });
  }
  if (!decisions.length) return { updated: 0, visits: { changed: 0, byState: {}, moves: [] } };
  await applyVisitDecisionsTx(client, tenantId, actorId, decisions);
  const stamped = await restampVisitsTx(client, tenantId);
  const action = request.action === 'zone' ? 'visite_zone' : (request.action === 'keep' ? 'visite_garder' : 'visite_modifier');
  const ms = decisions.map((d) => d.visit.month).sort();
  const batchId = crypto.randomUUID();
  const after = (d) => (d.source === 'zone' ? (d.cell || {}) : { state: null, providerId: d.providerId || null });
  await insertLogTx(client, tenantId, actorId, [
    { batch_id: batchId, scope: 'lot', action, label: `${decisions.length} visite(s)`.slice(0, 300), month_from: ms[0], month_to: ms[ms.length - 1],
      visits_updated: decisions.length, reason: request.reason || null },
    ...decisions.map((d) => ({
      batch_id: batchId, scope: 'visite', action: d.source === 'zone' ? 'visite_zone' : action,
      label: `${d.visit.locationId || d.visit.siteName} · ${d.visit.month}`.slice(0, 300), period_month: d.visit.month, visit_id: d.id,
      old_state: d.visit.source === 'zone' ? d.visit.zoneState : d.visit.source, old_provider_id: d.visit.providerId || null,
      new_state: d.source === 'zone' ? (after(d).state || null) : 'visite', new_provider_id: after(d).providerId || null,
      reason: d.source === 'zone' ? null : (request.reason || null),
    })),
  ]);
  return { updated: decisions.length, batchId, visits: stamped };
}

/**
 * TPM de la zone de sites pour des mois — pour les autres modules (planification automatique du
 * lot 5, aperçus) : lecture seule, MÊME règle que l'estampille des visites (une visite insérée
 * sans TPM reçoit cette valeur au COMMIT). `pairs` : [{ siteId, month: 'AAAA-MM' }].
 * @returns {Promise<Map<string, object>>} clé `${siteId}|${month}` → { state, providerId,
 *   providerName, contractId, numero, contractLabel, reason, flags, candidates? } ; site inconnu : absent.
 */
async function cellsForSitesTx(client, tenantId, pairs) {
  const out = new Map();
  const list = (pairs || []).filter((p) => p && p.siteId && /^\d{4}-\d{2}$/.test(String(p.month || '').slice(0, 7)));
  if (!list.length) return out;
  const zones = await siteZonesTx(client, tenantId, [...new Set(list.map((p) => p.siteId))]);
  const { table } = await tableForSitesTx(client, tenantId, { zones, months: list.map((p) => String(p.month).slice(0, 7)) });
  const byId = new Map(zones.map((z) => [z.id, z]));
  for (const p of list) {
    const z = byId.get(p.siteId);
    const m = String(p.month).slice(0, 7);
    if (z) out.set(`${p.siteId}|${m}`, slimCell(cellForSite(z, m, table)));
  }
  return out;
}

/**
 * « Appliquer les TPM des contrats » — et reprise de l'existant au démarrage (réparation r58) :
 * les visites PRÉVUES de la période (toutes sans période) dont le TPM n'a PAS été choisi à la main
 * avec une raison reprennent le TPM de leur zone : origine « zone » et « reprise » (TPM saisi avant
 * la règle, sans raison, rendue à sa zone). Jamais touchées, et comptées dans `kept` : une visite
 * « visite » (écart motivé), une visite réalisée ou annulée (elle garde le TPM qui l'a faite ; une
 * « reprise » réalisée reste « TPM saisi avant la règle »), une visite figée « antérieur à la
 * règle », une visite déjà facturée (INVOICED_SQL). Journal : un lot, plus une ligne par visite
 * dont le TPM change (avant → après) — l'ancienne saisie reste lisible. Sous le verrou
 * d'attribution ; idempotent : rejoué, ne change plus rien.
 * @returns {Promise<{ visits, converted, changed, byState, moves, kept: { reasoned, done, anterieur, invoiced }, batchId? }>}
 */
async function applyContractsTx(client, tenantId, actorId, { period = null, reason = null, label = null } = {}) {
  await lockAttributionTx(client, tenantId);
  const params = [tenantId];
  let range = '';
  if (period) { params.push(toMonthDate(period.from), toMonthDate(period.to)); range = ' AND v.period_month BETWEEN $2::date AND $3::date'; }
  const eligible = `v.provider_source IN ('zone', 'reprise') AND ${AUTO_RESTAMPABLE_SQL}`;
  const { rows: [span] } = await client.query(
    `SELECT count(*) FILTER (WHERE ${eligible})::int AS n,
            count(*) FILTER (WHERE ${eligible} AND v.provider_source = 'reprise')::int AS reprise,
            count(*) FILTER (WHERE v.provider_source = 'visite')::int AS reasoned,
            count(*) FILTER (WHERE v.provider_source <> 'visite' AND v.status <> 'planifie')::int AS done,
            count(*) FILTER (WHERE v.provider_source <> 'visite' AND v.status = 'planifie'
                               AND v.provider_zone_state = 'anterieur')::int AS anterieur,
            count(*) FILTER (WHERE v.provider_source <> 'visite' AND v.status = 'planifie'
                               AND v.provider_zone_state IS DISTINCT FROM 'anterieur' AND ${INVOICED_SQL})::int AS invoiced,
            to_char(min(v.period_month) FILTER (WHERE ${eligible}), 'YYYY-MM') AS lo,
            to_char(max(v.period_month) FILTER (WHERE ${eligible}), 'YYYY-MM') AS hi
       FROM site_visits v WHERE v.tenant_id = $1${range}`, params);
  const kept = {};
  for (const k of ['reasoned', 'done', 'anterieur', 'invoiced']) kept[k] = (span && span[k]) || 0;
  if (!span || !span.n) return { visits: 0, converted: 0, changed: 0, byState: {}, moves: [], kept };
  if (span.reprise) {
    await client.query(
      `UPDATE site_visits v SET provider_source = 'zone', provider_reason = NULL, provider_set_by = $${params.length + 1},
              provider_set_at = now(), updated_at = now()
        WHERE v.tenant_id = $1 AND v.provider_source = 'reprise' AND ${AUTO_RESTAMPABLE_SQL}${range}`, [...params, actorId || null]);
  }
  const { rows } = await client.query(
    `SELECT o_id AS id, o_old_provider AS "fromProviderId", o_new_provider AS "providerId", o_state AS "zoneState", o_dated AS dated
       FROM mems_tpm_stamp($1, ARRAY(SELECT v.id FROM site_visits v
                                      WHERE v.tenant_id = $1 AND v.provider_source = 'zone' AND ${AUTO_RESTAMPABLE_SQL}${range}))`, params);
  const moved = rows.filter((r) => (r.fromProviderId || null) !== (r.providerId || null));
  const where = new Map();
  if (moved.length) {
    const { rows: w } = await client.query(
      `SELECT v.id, to_char(v.period_month, 'YYYY-MM') AS month, COALESCE(s.public_id, s.location_id, s.name) AS site
         FROM site_visits v JOIN sites s ON s.tenant_id = v.tenant_id AND s.id = v.site_id
        WHERE v.tenant_id = $1 AND v.id = ANY ($2::uuid[])`, [tenantId, moved.map((r) => r.id)]);
    for (const x of w) where.set(x.id, x);
  }
  const from = period ? period.from : span.lo;
  const to = period ? period.to : span.hi;
  const batchId = crypto.randomUUID();
  await insertLogTx(client, tenantId, actorId, [
    { batch_id: batchId, scope: 'lot', action: 'reappliquer', label: (label || `TPM des contrats appliqués aux visites · ${from} → ${to}`).slice(0, 300),
      month_from: from, month_to: to, visits_updated: rows.length, reason: reason || null },
    ...moved.map((r) => {
      const x = where.get(r.id) || {};
      return {
        batch_id: batchId, scope: 'visite', action: 'visite_zone', label: `${x.site || '—'} · ${x.month || ''}`.slice(0, 300),
        period_month: x.month || from, visit_id: r.id, old_provider_id: r.fromProviderId || null,
        new_state: r.zoneState, new_provider_id: r.providerId || null,
      };
    }),
  ]);
  return { visits: span.n, converted: span.reprise, batchId, kept, ...summarizeRestamp(rows) };
}

module.exports = {
  cellsForSitesTx, applyContractsTx, slimCell, unavailabilityTx, deleteUnavailabilityTx, upsertUnavailabilityTx, plannedRangeVisitsTx,
  tableForSitesTx, boardTpmTx, applyVisitRequestTx,
  ATTRIBUTION_KEY, ZONE_CTES, INVOICED_SQL, AUTO_RESTAMPABLE_SQL, monitorKeySql, lockAttributionTx, tpmLinkExistsTx, lockTpmLinkTx, linkPastScopeTx, restampIfTpmLinkChangedTx, refreshSiteZonesTx, restampVisitsTx,
  partnersTx, loadInputsTx, overridesTx, areasTx, communeRowIds, zoneRowsTx, visitGroupsTx, expandRegionsTx,
  plannedZoneVisitsTx, visitsForUpdateTx, siteZoneTx, monthPlanStatusesTx,
  deleteOverridesTx, upsertOverridesTx, applyVisitDecisionsTx, insertLogTx, listLogTx, attributionCountsTx, siteZonesTx,
  refreshOverridePathsTx, relinkOverridesTx,
};
