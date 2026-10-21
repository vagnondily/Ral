/**
 * Data access for the Contrats module. The service owns the transaction and
 * composes these calls, so a contract operation (status + history + outbox
 * event, or budget replace across many cells) stays atomic. Every query
 * filters on tenant_id explicitly; RLS is the backstop.
 *
 * Budget model (rebuilt from the real FLA file): one row per cost line AND
 * per activity in contract_budget_lines (line_code, activity_id, amount).
 * Consumption on the monitoring line comes from validated TPM financial
 * reports, not from the contract itself (expenses moved to the TPM module).
 */
const { REALISED_STATUS } = require('../tpm/realised');

const CONTRACT_COLUMNS = `
  c.id, c.numero, c.partner_name AS "partnerName", c.partner_id AS "partnerId",
  pt.code AS "partnerType", pt.label AS "partnerTypeLabel", c.activities,
  c.numero_fla AS "numeroFla", c.numero_po AS "numeroPo", c.numero_vendor AS "numeroVendor",
  c.date_debut AS "dateDebut", c.date_fin AS "dateFin", c.status,
  c.validator_id AS "validatorId", v.email AS "validatorEmail",
  c.submitted_by AS "submittedBy", c.submitted_at AS "submittedAt",
  c.decided_by AS "decidedBy", c.decided_at AS "decidedAt",
  c.termination_reason AS "terminationReason", c.termination_date AS "terminationDate",
  c.renewed_from_id AS "renewedFromId", c.amendment_count AS "amendmentCount",
  c.management_fee_pct AS "managementFeePct", c.period_months AS "periodMonths",
  c.created_by AS "createdBy", c.created_at AS "createdAt", c.updated_at AS "updatedAt", c.version`;

const num = (v) => (v == null ? v : Number(v));

// The join to partners/partner_types is via the (denormalized) partner_id.
const FROM_CONTRACT = `
  FROM contracts c
  LEFT JOIN users v ON v.id = c.validator_id
  LEFT JOIN partners pr ON pr.id = c.partner_id
  LEFT JOIN partner_types pt ON pt.id = pr.partner_type_id`;

// ------------------------------------------------------------------ reads

async function listContracts(client, tenantId, { status, q } = {}) {
  const params = [tenantId, REALISED_STATUS]; // $2 = statut du « Réalisé » (définition unique, tpm/realised)
  const where = ['c.tenant_id = $1'];
  if (status) {
    params.push(status);
    where.push(`c.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    where.push(`(c.partner_name ILIKE ${p} OR c.numero ILIKE ${p} OR c.numero_fla ILIKE ${p} OR c.numero_po ILIKE ${p} OR c.numero_vendor ILIKE ${p})`);
  }
  const { rows } = await client.query(
    `SELECT ${CONTRACT_COLUMNS},
            COALESCE(b.total, 0) AS "directTotal",
            COALESCE(m.total, 0) AS "monitoringBudget",
            COALESCE(x.total, 0) AS "spentTotal",
            (SELECT count(*) FROM contract_areas z WHERE z.tenant_id = c.tenant_id AND z.contract_id = c.id)::int AS "zonesCount",
            EXISTS (SELECT 1 FROM contract_amendments a
                     WHERE a.contract_id = c.id AND a.status = 'en_validation') AS "amendmentPending",
            EXISTS (SELECT 1 FROM contracts r WHERE r.renewed_from_id = c.id) AS "renewed"
       ${FROM_CONTRACT}
       LEFT JOIN LATERAL (SELECT SUM(unit_count * unit_cost) AS total FROM contract_budget_items WHERE contract_id = c.id) b ON true
       LEFT JOIN LATERAL (SELECT SUM(unit_count * unit_cost) AS total FROM contract_budget_items WHERE contract_id = c.id AND line_code = 'IV.suivi') m ON true
       LEFT JOIN LATERAL (SELECT SUM(reported_amount) AS total FROM tpm_reports
                           WHERE tenant_id = c.tenant_id AND contract_id = c.id AND kind = 'financier' AND status = $2) x ON true
      WHERE ${where.join(' AND ')}
      ORDER BY CASE c.status WHEN 'en_validation' THEN 0 WHEN 'brouillon' THEN 1 WHEN 'rejete' THEN 2
                             WHEN 'actif' THEN 3 ELSE 4 END,
               c.date_fin`,
    params
  );
  return rows.map((r) => {
    const direct = num(r.directTotal) || 0;
    const fee = Number(r.managementFeePct) || 0;
    return {
      ...r,
      managementFeePct: Number(r.managementFeePct),
      directTotal: direct,
      budgetTotal: Math.round(direct * (1 + fee) * 100) / 100, // total de l'accord
      monitoringBudget: num(r.monitoringBudget),
      spentTotal: num(r.spentTotal),
    };
  });
}

/**
 * Verrou de la fiche contrat pour une écriture : FOR NO KEY UPDATE. Il sérialise les écrivains du
 * contrat sans bloquer le FOR KEY SHARE des clés étrangères vers lui (site_visits.contract_id posé par
 * une réestampille, rapports, plans). Avec FOR UPDATE, l'approbation d'un avenant (contrat verrouillé
 * PUIS restampFromNow → verrou d'attribution) interbloquait avec un changement de rôle du titulaire
 * (verrou d'attribution PUIS site_visits.contract_id = ce contrat) : 40P01.
 * Les UPDATE de contracts faits sous ce verrou ne listent jamais une colonne de clé
 * (CONTRACT_KEY_COLUMNS ; contrôlé contre la base par test/lot8Db.test.js) : avec le déclencheur
 * BEFORE UPDATE trg_same_tenant, une colonne de clé dans la liste SET, même inchangée, reprendrait la
 * ligne FOR UPDATE.
 * Seule la SUPPRESSION garde FOR UPDATE (`forDelete`) : elle vérifie qu'aucun document n'est relié
 * puis supprime ; aucun document relié ne doit pouvoir s'insérer entre les deux.
 */
const CONTRACT_KEY_COLUMNS = ['id', 'tenant_id', 'numero'];
const contractLock = ({ forUpdate, forDelete }) => (forDelete ? 'FOR UPDATE OF c' : forUpdate ? 'FOR NO KEY UPDATE OF c' : '');

async function getContract(client, tenantId, id, { forUpdate = false, forDelete = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${CONTRACT_COLUMNS} ${FROM_CONTRACT}
      WHERE c.tenant_id = $1 AND c.id = $2
      ${contractLock({ forUpdate, forDelete })}`,
    [tenantId, id]
  );
  return rows[0] || null;
}

/**
 * Suppression d'un contrat : ses rapports verrouillés (FOR UPDATE, ordre stable), juste après le
 * verrou du contrat et AVANT de compter les données reliées. Remplir ou soumettre un gabarit ne
 * verrouille que la ligne du rapport (contract_id inchangé : aucun FOR KEY SHARE sur le contrat) :
 * sans ce verrou, un gabarit rempli pendant la suppression passait le décompte, puis la cascade le
 * supprimait avec ses postes. Ici, on attend l'écrivain en cours ; en READ COMMITTED le décompte qui
 * suit voit ce qu'il a validé, et un écrivain arrivé après trouve le rapport supprimé (introuvable).
 * Ordre des verrous : la ligne du contrat, PUIS ses rapports. Règle que doit suivre tout écrivain de
 * rapport : ne jamais verrouiller la ligne du contrat (FOR KEY SHARE compris, y compris par une clé
 * étrangère posée vers lui — une réestampille qui écrit site_visits.contract_id) APRÈS la ligne d'un
 * rapport ; un écrivain qui peut toucher au contrat prend sa ligne D'ABORD, comme les créations le font
 * avec lockTpmLinkTx. Un écrivain qui l'enfreint interbloque avec cette suppression (40P01 → 503).
 */
async function lockReportsForDeleteTx(client, tenantId, contractId) {
  await client.query('SELECT id FROM tpm_reports WHERE tenant_id = $1 AND contract_id = $2 ORDER BY id FOR UPDATE', [tenantId, contractId]);
}

async function getContractActivities(client, tenantId, contractId) {
  const { rows } = await client.query(
    `SELECT a.id, a.code, a.label FROM contract_activities ca
       JOIN activities a ON a.id = ca.activity_id
      WHERE ca.tenant_id = $1 AND ca.contract_id = $2 ORDER BY a.sort_order, a.label`,
    [tenantId, contractId]
  );
  return rows;
}

/** All budget items: [{ id, lineCode, description, unitCount, unitCost, allocations, sortOrder }]. */
async function getBudgetItems(client, tenantId, contractId) {
  const { rows } = await client.query(
    `SELECT id, line_code AS "lineCode", description, unit_count AS "unitCount", unit_cost AS "unitCost",
            allocations, sort_order AS "sortOrder"
       FROM contract_budget_items WHERE tenant_id = $1 AND contract_id = $2
       ORDER BY line_code, sort_order, created_at`,
    [tenantId, contractId]
  );
  return rows.map((r) => ({ ...r, unitCount: num(r.unitCount), unitCost: num(r.unitCost) }));
}

/**
 * Geographic areas assigned to the provider (retours 38 / 79) :
 * [{ adminAreaId, path, depth, pcode, siteCount, subActivityCount, offices }].
 * `pcode`, `siteCount`, `subActivityCount` et `offices` enrichissent le tableau
 * des zones. Les sites d'une zone = ceux rattachés à l'unité ou à l'une de ses
 * sous-unités (`admin_area_id` + `lineage`), SINON par P-code (district/commune),
 * SINON par nom de l'unité au bon niveau avec son parent — EXACTEMENT la règle du
 * répertoire des localités (retour 90, `SITE_COLUMNS` : adm1 / adm2|district /
 * adm3|commune / adm4|fokontany), pour un décompte cohérent. La plupart des sites
 * sont géocodés par nom/P-code, pas par `admin_area_id` : sans ce repli, les
 * comptes seraient quasi nuls. Sous-activités = `tag_code` distincts de ces
 * sites (retours 66 / 92) ; bureaux = `field_offices` distincts de ces sites
 * (honnête : ce que portent vraiment les sites, pas un périmètre déduit). Une
 * zone « à resélectionner » (unité absente du découpage) a `pcode` null, des
 * comptes à 0 et aucun bureau.
 */
// Colonne du registre qui porte le nom de l'unité d'une PROFONDEUR (miroir de
// localities.domain.SITE_COLUMNS, par depth : adm1 / adm2|district / adm3|commune / adm4|fokontany).
const SITE_NAME_BY_DEPTH = `CASE %d%
    WHEN 1 THEN s.adm1
    WHEN 2 THEN COALESCE(s.adm2, s.district)
    WHEN 3 THEN COALESCE(s.adm3, s.commune)
    WHEN 4 THEN COALESCE(s.adm4, s.fokontany)
  END`;
async function getContractAreas(client, tenantId, contractId) {
  const siteName = (d) => SITE_NAME_BY_DEPTH.replace('%d%', d);
  const { rows } = await client.query(
    `SELECT ca.admin_area_id AS "adminAreaId", ca.path, ca.depth,
            aa.pcode,
            COALESCE(sc.n, 0) AS "siteCount",
            COALESCE(sc.subacts, 0) AS "subActivityCount",
            COALESCE(sc.offices, '{}') AS offices
       FROM contract_areas ca
       LEFT JOIN admin_areas aa ON aa.id = ca.admin_area_id AND aa.tenant_id = ca.tenant_id
       LEFT JOIN admin_areas pp ON pp.id = aa.parent_id AND pp.tenant_id = aa.tenant_id
       LEFT JOIN LATERAL (
         SELECT count(DISTINCT s.id)::int AS n,
                count(DISTINCT NULLIF(btrim(s.tag_code), ''))::int AS subacts,
                array_remove(array_agg(DISTINCT fo.name), NULL) AS offices
           FROM sites s
           LEFT JOIN admin_areas sa ON sa.id = s.admin_area_id
           LEFT JOIN field_offices fo ON fo.id = s.field_office_id AND fo.tenant_id = s.tenant_id
          WHERE s.tenant_id = ca.tenant_id AND aa.id IS NOT NULL
            AND (
                 sa.id = aa.id
              OR sa.lineage @> ARRAY[aa.id]
              OR (aa.pcode IS NOT NULL AND aa.pcode IN (s.adm2_pcode, s.adm3_pcode))
              OR (
                   lower(btrim(${siteName('aa.depth')})) = lower(btrim(aa.name))
                   AND (pp.id IS NULL OR lower(btrim(${siteName('pp.depth')})) = lower(btrim(pp.name)))
                 )
            )
       ) sc ON true
      WHERE ca.tenant_id = $1 AND ca.contract_id = $2
      ORDER BY ca.path`,
    [tenantId, contractId]
  );
  return rows.map((r) => ({
    adminAreaId: r.adminAreaId, path: r.path, depth: r.depth,
    pcode: r.pcode || null, siteCount: r.siteCount, subActivityCount: r.subActivityCount,
    offices: r.offices || [],
  }));
}

async function replaceAreas(client, tenantId, contractId, areas) {
  await client.query('DELETE FROM contract_areas WHERE tenant_id = $1 AND contract_id = $2', [tenantId, contractId]);
  let order = 0;
  for (const a of areas) {
    await client.query(
      `INSERT INTO contract_areas (contract_id, tenant_id, admin_area_id, path, depth, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [contractId, tenantId, a.adminAreaId, a.path, a.depth || 0, order++]
    );
  }
}

/** Resolve selected admin-area ids to { adminAreaId, path, depth } for this tenant. */
async function getAdminAreasByIds(client, tenantId, ids) {
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT id AS "adminAreaId", path, depth FROM admin_areas WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, ids]
  );
  return rows;
}

/** Units of the given levels (to re-find, by path, a zone whose unit was replaced). */
async function adminAreasAtDepths(client, tenantId, depths) {
  const { rows } = await client.query(
    `SELECT id AS "adminAreaId", path, depth FROM admin_areas WHERE tenant_id = $1 AND ($2::int[] IS NULL OR depth = ANY($2::int[]))`,
    [tenantId, depths && depths.length ? depths : null]
  );
  return rows;
}

/** Réalisé du contrat : factures TPM au statut REALISED_STATUS (validées) = consommé sur la ligne de suivi. */
async function monitoringSpent(client, tenantId, contractId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(reported_amount), 0) AS total FROM tpm_reports
      WHERE tenant_id = $1 AND contract_id = $2 AND kind = 'financier' AND status = $3`,
    [tenantId, contractId, REALISED_STATUS]
  );
  return num(rows[0].total);
}

/**
 * Données de prévision d'un contrat : budget Suivi/TPM (ligne IV) + réalisé
 * mensuel (factures au statut REALISED_STATUS, validées), pour forecast.js.
 */
async function forecastData(client, tenantId, contractId) {
  const { MONITORING_LINE } = require('./contracts.domain');
  const { rows: budgetRows } = await client.query(
    `SELECT COALESCE(SUM(unit_count * unit_cost), 0) AS total
       FROM contract_budget_items WHERE tenant_id = $1 AND contract_id = $2 AND line_code = $3`,
    [tenantId, contractId, MONITORING_LINE]
  );
  const { rows: monthly } = await client.query(
    `SELECT to_char(period_month, 'YYYY-MM') AS month,
            COALESCE(SUM(reported_amount) FILTER (WHERE kind = 'financier' AND status = $3), 0) AS actual
       FROM tpm_reports WHERE tenant_id = $1 AND contract_id = $2
      GROUP BY period_month ORDER BY period_month`,
    [tenantId, contractId, REALISED_STATUS]
  );
  return { monitoringBudget: num(budgetRows[0].total), monthly: monthly.map((m) => ({ month: m.month, actual: num(m.actual) })) };
}

async function listAmendments(client, tenantId, contractId) {
  const { rows } = await client.query(
    `SELECT a.id, a.number, a.justification, a.new_date_fin AS "newDateFin", a.budget_changes AS "budgetChanges",
            a.status, a.validator_id AS "validatorId", v.email AS "validatorEmail",
            a.created_by AS "createdBy", u.email AS "createdByEmail", a.created_at AS "createdAt",
            a.decided_at AS "decidedAt", d.email AS "decidedByEmail", a.decision_comment AS "decisionComment"
       FROM contract_amendments a
       JOIN users u ON u.id = a.created_by
       JOIN users v ON v.id = a.validator_id
       LEFT JOIN users d ON d.id = a.decided_by
      WHERE a.tenant_id = $1 AND a.contract_id = $2 ORDER BY a.number DESC`,
    [tenantId, contractId]
  );
  return rows;
}

async function getAmendment(client, tenantId, contractId, amendmentId) {
  const { rows } = await client.query(
    `SELECT id, number, status, validator_id AS "validatorId", created_by AS "createdBy",
            new_date_fin AS "newDateFin", budget_changes AS "budgetChanges"
       FROM contract_amendments WHERE tenant_id = $1 AND contract_id = $2 AND id = $3 FOR UPDATE`,
    [tenantId, contractId, amendmentId]
  );
  return rows[0] || null;
}

async function listHistory(client, tenantId, contractId) {
  const { rows } = await client.query(
    `SELECT h.id, h.action, h.comment, h.details, h.created_at AS "createdAt", u.email AS "actorEmail"
       FROM contract_history h JOIN users u ON u.id = h.actor_id
      WHERE h.tenant_id = $1 AND h.contract_id = $2 ORDER BY h.created_at DESC, h.id`,
    [tenantId, contractId]
  );
  return rows;
}

async function listValidators(client, tenantId) {
  const { rows } = await client.query(
    // Validateurs possibles d'un contrat = rôles qui valident (validateur+), + legacy 'manager'.
    `SELECT id, email, role FROM users WHERE tenant_id = $1 AND role IN ('validator', 'admin', 'superuser', 'manager') ORDER BY email`,
    [tenantId]
  );
  return rows;
}

async function findRenewal(client, tenantId, contractId) {
  const { rows } = await client.query(
    `SELECT id, numero FROM contracts WHERE tenant_id = $1 AND renewed_from_id = $2`,
    [tenantId, contractId]
  );
  return rows[0] || null;
}

async function getPartner(client, tenantId, partnerId) {
  const { rows } = await client.query(
    `SELECT p.id, p.name, pt.code AS "typeCode" FROM partners p
       JOIN partner_types pt ON pt.id = p.partner_type_id
      WHERE p.tenant_id = $1 AND p.id = $2 AND p.active = true`,
    [tenantId, partnerId]
  );
  return rows[0] || null;
}

async function activityLabels(client, tenantId, ids) {
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT id, label FROM activities WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY sort_order, label`,
    [tenantId, ids]
  );
  return rows;
}

async function validActivityIds(client, tenantId, ids) {
  if (ids.length === 0) return [];
  const { rows } = await client.query(
    `SELECT id FROM activities WHERE tenant_id = $1 AND active = true AND id = ANY($2::uuid[])`,
    [tenantId, ids]
  );
  return rows.map((r) => r.id);
}

// ----------------------------------------------------------------- writes

async function nextSequence(client, tenantId, year) {
  const { rows } = await client.query(
    `INSERT INTO contract_counters (tenant_id, year, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, year) DO UPDATE SET last_value = contract_counters.last_value + 1
     RETURNING last_value`,
    [tenantId, year]
  );
  return rows[0].last_value;
}

async function insertContract(client, tenantId, c) {
  const { rows } = await client.query(
    `INSERT INTO contracts (tenant_id, numero, partner_id, partner_name, activities, numero_fla, numero_po, numero_vendor,
                            date_debut, date_fin, created_by, renewed_from_id, management_fee_pct, period_months)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [tenantId, c.numero, c.partnerId, c.partnerName, c.activityCodes || [], c.numeroFla || null, c.numeroPo || null,
      c.numeroVendor || null, c.dateDebut, c.dateFin, c.createdBy, c.renewedFromId || null,
      c.managementFeePct ?? 0.07, c.periodMonths ?? null]
  );
  return rows[0].id;
}

async function setContractActivities(client, tenantId, contractId, activityIds) {
  await client.query('DELETE FROM contract_activities WHERE tenant_id = $1 AND contract_id = $2', [tenantId, contractId]);
  for (const activityId of activityIds) {
    await client.query(
      'INSERT INTO contract_activities (contract_id, tenant_id, activity_id) VALUES ($1,$2,$3)',
      [contractId, tenantId, activityId]
    );
  }
  // Keep the denormalized contracts.activities (codes) in sync — it is what
  // the list projection reads, so UI-created contracts show their activities.
  await client.query(
    `UPDATE contracts SET activities = COALESCE(
       (SELECT array_agg(a.code ORDER BY a.sort_order, a.label)
          FROM contract_activities ca JOIN activities a ON a.id = ca.activity_id
         WHERE ca.contract_id = $2), '{}')
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, contractId]
  );
}

/** Replace the whole budget with a list of items (poste). */
async function replaceBudget(client, tenantId, contractId, items) {
  await client.query('DELETE FROM contract_budget_items WHERE tenant_id = $1 AND contract_id = $2', [tenantId, contractId]);
  let order = 0;
  for (const it of items) {
    await client.query(
      `INSERT INTO contract_budget_items (contract_id, tenant_id, line_code, description, unit_count, unit_cost, allocations, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [contractId, tenantId, it.lineCode, it.description, it.unitCount, it.unitCost, JSON.stringify(it.allocations || {}), order++]
    );
  }
}

/** Colonnes modifiables par updateContract — aucune colonne de clé (voir getContract). */
const CONTRACT_UPDATE_COLUMNS = Object.freeze({
  partnerId: 'partner_id', partnerName: 'partner_name', activities: 'activities', numeroFla: 'numero_fla',
  numeroPo: 'numero_po', numeroVendor: 'numero_vendor', dateDebut: 'date_debut', dateFin: 'date_fin',
  status: 'status', validatorId: 'validator_id', submittedBy: 'submitted_by', submittedAt: 'submitted_at',
  decidedBy: 'decided_by', decidedAt: 'decided_at', terminationReason: 'termination_reason',
  terminationDate: 'termination_date', amendmentCount: 'amendment_count',
  managementFeePct: 'management_fee_pct', periodMonths: 'period_months',
});

async function updateContract(client, tenantId, id, version, fields) {
  const cols = CONTRACT_UPDATE_COLUMNS;
  const sets = [];
  const params = [tenantId, id, version];
  for (const [k, val] of Object.entries(fields)) {
    if (!(k in cols)) throw new Error(`Unknown contract field ${k}`);
    params.push(val === undefined ? null : val);
    sets.push(`${cols[k]} = $${params.length}`);
  }
  const { rowCount } = await client.query(
    `UPDATE contracts SET ${sets.join(', ')}, version = version + 1, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND version = $3`,
    params
  );
  return rowCount === 1;
}

async function nextAmendmentNumber(client, tenantId, contractId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(number), 0) + 1 AS n FROM contract_amendments WHERE tenant_id = $1 AND contract_id = $2`,
    [tenantId, contractId]
  );
  return rows[0].n;
}

async function insertAmendment(client, tenantId, contractId, a) {
  // budget_changes now records the amendment payload { newDateFin?, newFeePct? }.
  const { rows } = await client.query(
    `INSERT INTO contract_amendments (tenant_id, contract_id, number, justification, new_date_fin, budget_changes,
                                      validator_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [tenantId, contractId, a.number, a.justification, a.newDateFin || null, JSON.stringify(a.changes || {}),
      a.validatorId, a.createdBy]
  );
  return rows[0].id;
}

async function decideAmendment(client, tenantId, amendmentId, status, userId, comment) {
  await client.query(
    `UPDATE contract_amendments SET status = $3, decided_by = $4, decided_at = now(), decision_comment = $5
      WHERE tenant_id = $1 AND id = $2 AND status = 'en_validation'`,
    [tenantId, amendmentId, status, userId, comment || null]
  );
}


async function addHistory(client, tenantId, contractId, { action, actorId, comment, details }) {
  await client.query(
    `INSERT INTO contract_history (tenant_id, contract_id, action, actor_id, comment, details)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [tenantId, contractId, action, actorId, comment || null, JSON.stringify(details || {})]
  );
}

async function addEvent(client, tenantId, eventType, aggregateId, payload) {
  await client.query(
    `INSERT INTO domain_events (tenant_id, event_type, aggregate_id, payload) VALUES ($1,$2,$3,$4)`,
    [tenantId, eventType, aggregateId, JSON.stringify(payload)]
  );
}

// Supprime un contrat (ses postes, zones, activités, avenants et historique
// disparaissent par cascade). L'appelant garantit qu'il est en brouillon.
async function deleteContract(client, tenantId, id) {
  const { rowCount } = await client.query(
    'DELETE FROM contracts WHERE tenant_id = $1 AND id = $2', [tenantId, id]
  );
  return rowCount === 1;
}

async function deleteAmendment(client, tenantId, amendmentId) {
  const { rowCount } = await client.query(
    'DELETE FROM contract_amendments WHERE tenant_id = $1 AND id = $2', [tenantId, amendmentId]
  );
  return rowCount === 1;
}

/**
 * Avenants de TOUS les contrats (concepteur de rapport, lot 7a) : demandés sur la période,
 * filtrables par partenaire ; bornés (500). `periodSql` = fragment « AND … » déjà paramétré.
 */
async function listAmendmentsReport(client, tenantId, { periodSql = '', params = [], partnerId = null } = {}) {
  const p = [tenantId, ...params];
  let where = periodSql;
  if (partnerId) { p.push(partnerId); where += ` AND c.partner_id = $${p.length}::uuid`; }
  const { rows } = await client.query(
    `SELECT a.id, a.number, a.status, a.justification, a.new_date_fin AS "newDateFin", a.budget_changes AS "budgetChanges",
            to_char(a.created_at, 'YYYY-MM-DD') AS "createdAt", to_char(a.decided_at, 'YYYY-MM-DD') AS "decidedAt",
            c.id AS "contractId", c.numero, c.numero_fla AS "numeroFla", c.partner_name AS "partnerName", c.date_fin AS "dateFin"
       FROM contract_amendments a JOIN contracts c ON c.id = a.contract_id AND c.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1${where}
      ORDER BY a.created_at DESC, c.numero LIMIT 500`, p);
  return rows;
}

module.exports = {
  listAmendmentsReport,
  listContracts,
  getContract,
  deleteContract, lockReportsForDeleteTx, CONTRACT_KEY_COLUMNS, CONTRACT_UPDATE_COLUMNS,
  deleteAmendment,
  forecastData,
  getContractActivities,
  getBudgetItems,
  getContractAreas,
  replaceAreas,
  getAdminAreasByIds,
  adminAreasAtDepths,
  monitoringSpent,
  listAmendments,
  getAmendment,
  listHistory,
  listValidators,
  findRenewal,
  getPartner,
  activityLabels,
  validActivityIds,
  nextSequence,
  insertContract,
  setContractActivities,
  replaceBudget,
  updateContract,
  nextAmendmentNumber,
  insertAmendment,
  decideAmendment,
  addHistory,
  addEvent,
};
