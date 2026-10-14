const { stripRowsGps } = require('../map/submissionGps');
const { indicatorKeys, unusedKeys, dataWithout } = require('./indicatorKeys');
const { toPeriod } = require('../common/period');
const { monthWithin } = require('../common/periodSql');
const { submissionSiteKey } = require('../common/submissionSiteKey');
const { pageFacts, mergeAll, mergeVisits, resultsFromTallies } = require('./indicatorTallies');

/**
 * Faits d'indicateurs d'une fiche, lus EN FLUX (lot 7a, C1) — lecture seule, sur le
 * client de la transaction de l'appelant (withTenantTransaction : tenant_id = $1
 * partout, RLS active ; requêtes l'une après l'autre sur ce client).
 *
 *  1. comptages par groupe en SQL (soumissions, sites (données), sites du registre,
 *     communes, agents ; identité du bureau) ;
 *  2. un CURSEUR sur les seules réponses utiles (`data - clés inutiles`, lot 1b),
 *     lu par pages de 5 000 : chaque page est décomptée par groupe (bureau, mois…)
 *     avec la boucle du calcul, puis oubliée — mémoire bornée à une page, quel que
 *     soit le volume (l'ancien chemin gardait toutes les soumissions : 674 Mo par
 *     fiche à 50 000) ; les décomptes se réunissent (indicatorTallies.mergeAll).
 * Un passage par fiche sert le global, les bureaux et les mois : un bloc « par
 * bureau » et un bloc global ne relisent pas les données.
 */

const PAGE = 5000;
// Taille de l'échantillon de réponses qui complète le catalogue pour connaître les clés d'une fiche.
const KEY_SAMPLE = 200;
let cursorSeq = 0;

/** Champs calculés d'une fiche (ordre d'évaluation). */
async function calcDefsTx(client, tenantId, formId) {
  const { rows } = await client.query(
    `SELECT name, label, kind, expression, source_field AS "sourceField", mapping, default_value AS "defaultValue", sort_order
       FROM monitoring_calc_fields WHERE tenant_id = $1 AND form_id = $2 ORDER BY sort_order, name`,
    [tenantId, formId]
  );
  return rows;
}

/** Indicateurs actifs d'une fiche (ordre d'affichage). */
async function activeIndicatorsTx(client, tenantId, formId) {
  const { rows } = await client.query(
    `SELECT id, code, label, module, source_field AS "sourceField", agg,
            positive_value AS "positiveValue", target, direction, sort_order,
            na_values AS "naValues", scored
       FROM monitoring_indicators WHERE tenant_id = $1 AND form_id = $2 AND active = true
      ORDER BY sort_order, label`,
    [tenantId, formId]
  );
  return rows;
}

/** Clés connues d'une fiche : son catalogue (XLSForm / .sav) et les clés d'un échantillon de réponses. */
async function knownKeysTx(client, tenantId, formId) {
  const { rows } = await client.query(
    `SELECT name AS k FROM monitoring_form_fields WHERE tenant_id = $1 AND form_id = $2
     UNION
     SELECT DISTINCT jsonb_object_keys(s.data)
       FROM (SELECT data FROM monitoring_submissions WHERE tenant_id = $1 AND form_id = $2 LIMIT $3) s`,
    [tenantId, formId, KEY_SAMPLE]);
  return rows.map((r) => r.k);
}

/** Clé d'un agent : agent MEMS relié (migration 059), sinon le nom brut de la fiche, sinon 'vide'. */
const agentKeySql = (alias) => `COALESCE('id:' || ${alias}.agent_id::text, 'raw:' || NULLIF(btrim(${alias}.agent), ''), 'vide')`;

/**
 * Filtre des soumissions d'un fait : hors exclues, période (bornes semi-ouvertes) et
 * filtres du rapport —
 *  - `officeKey` : 'id:<bureau>' (le bureau MEMS ET ses antennes : un bureau couvre son
 *    sous-arbre), 'lib:…' / 'code:…' (libellé ou code d'une fiche, jointure officeLabelSql
 *    requise), 'unlinked' (aucun bureau MEMS relié) ;
 *  - `partnerId`, `agentKey` ; `formId` et `activity` (catégorie d'activité des fiches)
 *    pour les comptages qui portent sur plusieurs fiches.
 * Pousse ses paramètres ; renvoie « AND … ».
 */
function factFilter(alias, { period, officeKey, partnerId, agentKey, formId, activity } = {}, params, office) {
  const a = `${alias}.`;
  const parts = [`NOT ${a}excluded`];
  const p = toPeriod(period);
  if (p) parts.push(monthWithin(`${a}period_month`, p, params));
  if (officeKey) {
    if (officeKey === 'unlinked') parts.push(`${a}field_office_id IS NULL`);
    else if (officeKey.startsWith('id:')) {
      params.push(officeKey.slice(3));
      parts.push(`${a}field_office_id IN (SELECT o.id FROM field_offices o WHERE o.tenant_id = ${a}tenant_id AND (o.id = $${params.length}::uuid OR o.parent_id = $${params.length}::uuid))`);
    } else {
      if (!office) throw new Error('Filtre bureau : jointure des bureaux requise.');
      params.push(String(officeKey)); parts.push(`${office.key} = $${params.length}`);
    }
  }
  if (formId) { params.push(formId); parts.push(`${a}form_id = $${params.length}::uuid`); }
  if (activity) {
    params.push(String(activity));
    parts.push(`${a}form_id IN (SELECT f.id FROM monitoring_forms f WHERE f.tenant_id = ${a}tenant_id AND lower(btrim(f.activity_category)) = lower(btrim($${params.length})))`);
  }
  if (partnerId) { params.push(partnerId); parts.push(`${a}partner_id = $${params.length}::uuid`); }
  if (agentKey) { params.push(String(agentKey)); parts.push(`${agentKeySql(alias)} = $${params.length}`); }
  return ` AND ${parts.join(' AND ')}`;
}

/** Expression de groupe : '' (aucun), 'bureau' (clé officeLabelSql), 'month', 'bureau_month' (« clé|AAAA-MM »), 'agent'. */
function groupSql(group, alias, office) {
  const month = `COALESCE(to_char(${alias}.period_month, 'YYYY-MM'), '')`;
  switch (group) {
    case 'bureau': return office.key;
    case 'month': return month;
    case 'bureau_month': return `${office.key} || '|' || ${month}`;
    case 'agent': return agentKeySql(alias);
    default: return "''";
  }
}

const byBureau = (group) => group === 'bureau' || group === 'bureau_month';
const needsOfficeJoin = (opts) => byBureau(opts.group) || (opts.officeKey && /^(lib|code):/.test(opts.officeKey));

/**
 * Faits d'indicateurs d'une fiche.
 * @param {object} client client pg de la transaction (tenant posé)
 * @param {{ period?: {from,to}|null, group?: ''|'bureau'|'month'|'bureau_month'|'agent',
 *           officeKey?: string, partnerId?: string, agentKey?: string,
 *           officeSql?: (params:any[]) => {join,key,status,name,code,formId},
 *           inds?: object[], defs?: object[] }} opts
 *   officeSql : jointure des bureaux (monitoring.repository.officeLabelSql avec les libellés
 *   déjà lus) — requise pour grouper par bureau ou filtrer sur une clé de bureau.
 * @returns {Promise<{ inds, defs, overall: object[], groups: Map<string, object[]>, counts: Map<string, object> }>}
 *   overall et chaque groupe : un décompte par indicateur (indicatorTallies).
 */
async function formFactsTx(client, tenantId, formId, opts = {}) {
  const inds = opts.inds || await activeIndicatorsTx(client, tenantId, formId);
  const defs = opts.defs || await calcDefsTx(client, tenantId, formId);
  const withOffice = needsOfficeJoin(opts);
  if (withOffice && !opts.officeSql) throw new Error('Bureau : officeSql requis.');
  // FROM … WHERE commun ; chaque requête a ses PROPRES paramètres.
  const base = (params) => {
    const office = withOffice ? opts.officeSql(params) : null;
    const where = `s.tenant_id = $1 AND s.form_id = $2${factFilter('s', { ...opts, formId: null, activity: null }, params, office)}`;
    return { office, join: office ? office.join : '', where, g: groupSql(opts.group, 's', office) };
  };

  // 1. Comptages par groupe (et identité du bureau quand on groupe par bureau).
  const cp = [tenantId, formId];
  const cb = base(cp);
  const officeMeta = cb.office && byBureau(opts.group)
    ? `, min(${cb.office.status}) AS "officeStatus", min(${cb.office.name}) AS "officeName",
         min(${cb.office.code}) AS "officeCode", min(${cb.office.formId}) AS "officeFormId"` : '';
  const { rows: countRows } = await client.query(
    `SELECT ${cb.g} AS g, count(*)::int AS total,
            count(DISTINCT ${submissionSiteKey('s')})::int AS sites,
            count(DISTINCT s.site_id)::int AS "registrySites",
            count(DISTINCT NULLIF(btrim(s.admin3), ''))::int AS communes,
            count(DISTINCT ${agentKeySql('s')}) FILTER (WHERE ${agentKeySql('s')} <> 'vide')::int AS agents${officeMeta}
       FROM monitoring_submissions s ${cb.join}
      WHERE ${cb.where}
      GROUP BY 1`, cp);
  const counts = new Map(countRows.map((r) => [r.g, r]));
  const groups = new Map();
  const visitGroups = new Map();
  const visits = opts.visits ? { keep: opts.visits.keep || 50 } : null;

  // 2. Réponses utiles lues en flux, décomptées par groupe et par page.
  if (countRows.length && inds.length) {
    const drop = unusedKeys(await knownKeysTx(client, tenantId, formId), indicatorKeys(inds, defs));
    const pp = [tenantId, formId];
    const pb = base(pp);
    let data = 's.data';
    if (drop.length) { pp.push(drop); data = dataWithout('s', `$${pp.length}`); }
    cursorSeq = (cursorSeq + 1) % 1e9;
    const cursor = `mems_facts_${cursorSeq}`;
    // Identité de chaque visite (liste des visites urgentes) : seulement quand on la demande. Le nom
    // du site MEMS est lu APRÈS, pour les seules visites gardées : une jointure aux sites dans le
    // curseur coûtait 2,2 s sur 42 000 soumissions sous RLS (mesuré, lot 7a).
    const meta = visits
      ? `, s.id, to_char(s.period_month, 'YYYY-MM') AS month, NULLIF(btrim(s.site), '') AS site, s.site_id AS "siteId",
         NULLIF(btrim(s.agent), '') AS agent`
      : '';
    await client.query(
      `DECLARE ${cursor} NO SCROLL CURSOR FOR
       SELECT ${pb.g} AS g, ${data} AS data${meta} FROM monitoring_submissions s ${pb.join} WHERE ${pb.where}`, pp);
    try {
      for (;;) {
        const { rows } = await client.query(`FETCH ${PAGE} FROM ${cursor}`);
        const byGroup = new Map();
        for (const r of rows) {
          if (visits) r.meta = { id: r.id, month: r.month, site: r.site, siteId: r.siteId, agent: r.agent, group: r.g };
          if (!byGroup.has(r.g)) byGroup.set(r.g, []);
          byGroup.get(r.g).push(r);
        }
        for (const [g, list] of byGroup) {
          // precise === false (aperçus pour un rôle hors admin / gestionnaire, lot 6a) : positions GPS
          // des ménages retirées AVANT les champs calculés — une formule ne peut pas les recopier.
          const rowsFor = opts.precise === false ? stripRowsGps(list, false) : list;
          const f = pageFacts(inds, rowsFor, defs, { visits: !!visits, keep: visits ? visits.keep : 0 });
          groups.set(g, mergeAll([groups.get(g), f.tallies], inds.length));
          if (visits) visitGroups.set(g, mergeVisits([visitGroups.get(g), f.visits], visits.keep));
        }
        if (rows.length < PAGE) break;
      }
    } finally {
      // Une erreur a déjà annulé la transaction : la fermeture échoue sans conséquence.
      await client.query(`CLOSE ${cursor}`).catch(() => {});
    }
  }
  for (const g of counts.keys()) if (!groups.has(g)) groups.set(g, mergeAll([], inds.length));
  const out = { inds, defs, overall: mergeAll([...groups.values()], inds.length), groups, counts };
  if (visits) {
    // Une soumission sans indicateur lu reste une visite (non évaluée).
    for (const [g, c] of counts) if (!visitGroups.has(g)) visitGroups.set(g, { ...mergeVisits([]), n: c.total, classes: { exc: 0, sat: 0, imp: 0, urg: 0, na: c.total } });
    out.visitGroups = visitGroups;
    out.visits = mergeVisits([...visitGroups.values()], visits.keep);
    await nameUrgentSitesTx(client, tenantId, [...visitGroups.values()]);
  }
  return out;
}

/** Nom du site MEMS des visites urgentes gardées (une lecture par index, ids distincts). */
async function nameUrgentSitesTx(client, tenantId, visitList) {
  const ids = [...new Set(visitList.flatMap((v) => v.urgent.map((u) => u.siteId)).filter(Boolean))];
  if (!ids.length) return;
  const { rows } = await client.query('SELECT id, name FROM sites WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
  const name = new Map(rows.map((r) => [r.id, r.name]));
  for (const v of visitList) for (const u of v.urgent) if (u.siteId && name.has(u.siteId)) u.site = name.get(u.siteId);
}

/**
 * Résultats d'indicateurs d'une fiche sur la période (exclusions + champs calculés) —
 * même forme que l'ancien monitoring.repository.formResults : { inds, count, results }.
 */
async function formResultsTx(client, tenantId, formId, period, opts = {}) {
  const f = await formFactsTx(client, tenantId, formId, { ...opts, period });
  let count = 0;
  for (const c of f.counts.values()) count += c.total;
  return { inds: f.inds, count, results: resultsFromTallies(f.inds, f.overall), facts: f };
}

/** Résultats d'un décompte (global, groupe, ou réunion de groupes) d'un fait déjà calculé. */
const resultsOf = (facts, tallies) => resultsFromTallies(facts.inds, tallies);

/** Réunion de groupes d'un fait (ex. les mois d'un bureau). */
const mergeGroups = (facts, keys) => mergeAll(keys.map((k) => facts.groups.get(k)), facts.inds.length);

module.exports = {
  formFactsTx, formResultsTx, resultsOf, mergeGroups, calcDefsTx, activeIndicatorsTx, knownKeysTx,
  factFilter, agentKeySql, needsOfficeJoin, PAGE,
};
