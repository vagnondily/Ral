const { withTenantTransaction } = require('../../config/db');
const { formFactsTx } = require('../monitoring/indicatorFacts.repository');
const { officeLabelsTx, officeLabelSql } = require('../monitoring/monitoring.repository');
const { officeTreeSql } = require('../common/siteActivitySql');

/**
 * Tableau de bord « Couverture & performance du suivi » — lectures (lecture seule).
 * Une transaction par appel (withTenantTransaction : tenant_id = $1 partout, RLS active),
 * requêtes l'une après l'autre sur le même client (jamais Promise.all).
 *
 * Les indicateurs ne sont PAS recalculés ici : chaque fiche passe par indicatorFacts
 * (curseur sur les seules réponses utiles, décomptes additifs, score de chaque visite) — le
 * même chemin que la Synthèse, les Résultats et le concepteur de rapport. Le SQL ne fait que
 * des comptages (GROUP BY) ; la mise en forme est dans performanceMath (pure, testée).
 */

/**
 * Fiches actives du compte, ou d'UNE activité : `activity` = catégorie (casse et espaces
 * ignorés), '' = fiches sans activité, undefined = toutes.
 */
async function formsTx(client, tenantId, activity) {
  const params = [tenantId];
  let where = '';
  if (activity === '') where = " AND NULLIF(btrim(f.activity_category), '') IS NULL";
  else if (activity != null) {
    params.push(String(activity));
    where = ` AND lower(btrim(f.activity_category)) = lower(btrim($${params.length}::text))`;
  }
  const { rows } = await client.query(
    `SELECT f.id, f.code, f.label, NULLIF(btrim(f.activity_category), '') AS "activityCategory"
       FROM monitoring_forms f
      WHERE f.tenant_id = $1 AND f.active = true${where}
      ORDER BY f.label, f.id`,
    params
  );
  return rows;
}

/**
 * Sites du registre par activité, dans le périmètre du bureau choisi (le bureau et toutes ses
 * antennes : sous-arbre récursif, comme la carte) — sert à lister les activités qui ont des
 * sites même sans données de suivi. Une ligne par catégorie (casse et espaces ignorés).
 */
async function registryActivitiesTx(client, tenantId, officeId) {
  const params = [tenantId];
  let head = '';
  let scope = '';
  if (officeId) {
    params.push(officeId);
    head = `WITH RECURSIVE ${officeTreeSql(`$${params.length}`).replace(/,\s*$/, '')} `;
    scope = ' AND s.field_office_id IN (SELECT id FROM office_tree)';
  }
  const { rows } = await client.query(
    `${head}SELECT min(btrim(s.activity)) AS activity, count(*)::int AS sites
       FROM sites s
      WHERE s.tenant_id = $1 AND NULLIF(btrim(s.activity), '') IS NOT NULL${scope}
      GROUP BY lower(btrim(s.activity))
      ORDER BY 2 DESC, 1`,
    params
  );
  return rows;
}

/** Noms des agents MEMS reliés (« id:<uuid> ») présents dans les faits groupés par agent. */
async function agentNamesTx(client, tenantId, forms) {
  const ids = [...new Set(forms.flatMap((f) => [...f.facts.counts.keys()]).filter((k) => k.startsWith('id:')).map((k) => k.slice(3)))];
  if (!ids.length) return new Map();
  const { rows } = await client.query('SELECT id, name FROM tpm_agents WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
  return new Map(rows.map((r) => [`id:${r.id}`, r.name]));
}

/**
 * Faits d'indicateurs des fiches (toutes, ou celles d'une activité), un passage par fiche.
 * @param {string} tenantId
 * @param {{ period: {from,to}, officeId?: string|null, activity?: string,
 *           group: 'bureau_month'|'month'|'agent', visitsKeep?: number, registry?: boolean }} opts
 *   officeId : bureau MEMS (avec ses antennes) — soumissions reliées à ce bureau ;
 *   group    : regroupement des décomptes (bureau × mois pour la page, mois pour la tendance,
 *              agent pour la qualité de saisie) ;
 *   registry : lire aussi les activités du registre des sites (liste des onglets).
 * @returns {Promise<{ forms: object[], registry: object[]|null, agentNames: Map|null }>}
 */
async function performanceFacts(tenantId, { period, officeId = null, activity, group = 'bureau_month', visitsKeep = 15, registry = false }) {
  return withTenantTransaction(tenantId, async (client) => {
    const forms = await formsTx(client, tenantId, activity);
    const labels = group === 'bureau_month' && forms.length ? await officeLabelsTx(client, tenantId) : null;
    const officeSql = labels ? (params) => officeLabelSql(labels, 's', params) : undefined;
    const officeKey = officeId ? `id:${officeId}` : null;
    const out = [];
    for (const f of forms) { // une fiche à la fois (client de la transaction)
      const facts = await formFactsTx(client, tenantId, f.id, { period, group, officeSql, officeKey, visits: { keep: visitsKeep } });
      out.push({ ...f, facts });
    }
    const reg = registry ? await registryActivitiesTx(client, tenantId, officeId) : null;
    const agentNames = group === 'agent' ? await agentNamesTx(client, tenantId, out) : null;
    return { forms: out, registry: reg, agentNames };
  });
}

module.exports = { performanceFacts, formsTx, registryActivitiesTx, agentNamesTx };
