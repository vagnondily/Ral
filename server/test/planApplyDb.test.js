/**
 * « Appliquer » de la planification automatique sur une VRAIE base (lot 5) : aperçu → application →
 * visites créées (jour de terrain, rôle générique, date, sans prestataire choisi) → trace plan_runs
 * (paramètres jsonb : tableaux compris) → même demande renvoyée = 409 et 0 visite de plus →
 * nouvel aperçu sans doublon. Garde-fous re-vérifiés en base : visite annulée intacte, mois
 * inactif jamais planifié, une visite par site × mois.
 *
 * Les tests avec faux client ne voient pas la conversion des paramètres par node-pg (un tableau JS
 * devient un tableau Postgres « {…} », pas du JSON) : ce test-ci l'exerce.
 *
 * Base requise, sinon le test est ignoré : PLAN_DB_TEST_URL (superutilisateur, pour préparer et
 * nettoyer un compte jetable) et PLAN_DB_TEST_APP_URL (rôle mems2_app : le service tourne sous
 * RLS comme l'API). Exemple : base neuve migrée (npm run migrate), jamais la base de production.
 */
process.env.LOG_LEVEL = 'silent';
const SU = process.env.PLAN_DB_TEST_URL;
const APP = process.env.PLAN_DB_TEST_APP_URL;
if (APP) process.env.APP_DATABASE_URL = APP;

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const skip = !SU || !APP ? 'PLAN_DB_TEST_URL et PLAN_DB_TEST_APP_URL absents' : false;

test('« Appliquer » sur une vraie base : visites, trace, 409 sur une demande renvoyée, aucun doublon', { skip }, async () => {
  const { Client } = require('pg');
  const db = require('../src/config/db');
  const service = require('../src/modules/tpm/plan.service');
  const su = new Client({ connectionString: SU });
  await su.connect();
  const q = (sql, params) => su.query(sql, params);
  const year = new Date().getUTCFullYear() + 1; // exercice à venir : tous les mois planifiables
  const tag = crypto.randomBytes(4).toString('hex');
  let tenantId = null;
  try {
    tenantId = (await q('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`plan-test-${tag}`])).rows[0].id;
    const userId = (await q(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`, [tenantId, `plan-${tag}@mems.mg`])).rows[0].id;
    const officeId = (await q(`INSERT INTO field_offices (tenant_id, code, name) VALUES ($1, 'BT', 'Bureau test') RETURNING id`, [tenantId])).rows[0].id;
    await q(`INSERT INTO mmr_parameters (tenant_id, field_office_id, activity_category, operation_duration, number_of_sites, risk_level, feasible,
               persons_to_deploy, visits_per_day, working_days)
             VALUES ($1, $2, 'Activité test', 12, 6, 2, 10, 1, 3, 20)`, [tenantId, officeId]);
    const sites = [];
    for (let i = 1; i <= 6; i += 1) {
      const commune = i <= 3 ? 'Commune A' : 'Commune B';
      const { rows } = await q(`INSERT INTO sites (tenant_id, code, name, district, commune, adm1, adm2, adm3, activity, risk_level, field_office_id, security_situation)
                                VALUES ($1, $2, $3, 'District T', $4, 'Region T', 'District T', $4, 'Activité test', 'moyenne', $5, 0) RETURNING id`,
      [tenantId, `T-${tag}-${i}`, `Site ${i}`, commune, officeId]);
      sites.push(rows[0].id);
    }
    // Grille d'activation complète (Oui partout), sauf le site 5 inactif en février.
    await q(`INSERT INTO site_month_status (tenant_id, site_id, year, month, active)
             SELECT $1, s, $2, m, NOT (s = $3 AND m = 2) FROM unnest($4::uuid[]) s, generate_series(1, 12) m`, [tenantId, year, sites[4], sites]);
    // Site 6 : visite ANNULÉE en janvier (une décision : jamais remplacée).
    await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status) VALUES ($1, $2, make_date($3, 1, 1), 'Activité test', 'annule')`,
      [tenantId, sites[5], year]);

    const body = { year, from: 1, to: 3, officeId: null, activity: null, district: null, params: {}, adjust: {} };
    const p = await service.preview(tenantId, body);
    assert.equal(p.strategy, 'besoins');
    assert.ok(p.proposals.length > 0, 'des visites proposées');
    assert.ok(!p.proposals.some((x) => x.siteId === sites[5] && x.month === 1), 'visite annulée : jamais remplacée');
    assert.ok(!p.proposals.some((x) => x.siteId === sites[4] && x.month === 2), 'mois inactif : jamais planifié');
    assert.ok(p.needs.months.length === 3 && p.needs.peak.agents >= 1);

    const keep = p.proposals.map((x) => ({ siteId: x.siteId, month: x.month }));
    const r = await service.apply(tenantId, userId, { ...body, fingerprint: p.fingerprint, sections: p.sections, keep, changes: [] });
    assert.ok(r.runId);
    assert.equal(r.created, keep.length);

    const v = (await q(`SELECT site_id, extract(month FROM period_month)::int AS m, status, agent, visit_date, plan_day, plan_tour, plan_why,
                               jsonb_typeof(plan_detail) AS detail, provider_id
                          FROM site_visits WHERE tenant_id = $1 AND plan_run_id = $2`, [tenantId, r.runId])).rows;
    assert.equal(v.length, r.created);
    for (const x of v) {
      assert.equal(x.status, 'planifie');
      assert.match(x.agent, /^Agent \d+$/);
      assert.ok(x.plan_day >= 1 && x.plan_tour >= 1 && x.plan_why && x.detail === 'object');
      const d = typeof x.visit_date === 'string' ? x.visit_date : x.visit_date.toISOString().slice(0, 10);
      assert.ok(d.startsWith(`${year}-${String(x.m).padStart(2, '0')}-`), `date dans le mois : ${d}`);
      assert.equal(x.provider_id, null, 'aucun contrat de zone : le prestataire n\'est jamais deviné');
    }
    const run = (await q(`SELECT strategy, proposed, kept, created_visits, jsonb_typeof(pools) AS pools, jsonb_array_length(pools) AS n_pools,
                                 jsonb_typeof(params) AS params, jsonb_typeof(summary) AS summary, jsonb_typeof(needs) AS needs,
                                 jsonb_typeof(params->'excludedCommunes') AS excluded
                            FROM plan_runs WHERE tenant_id = $1 AND id = $2`, [tenantId, r.runId])).rows[0];
    assert.deepEqual(run, { strategy: 'besoins', proposed: keep.length, kept: keep.length, created_visits: keep.length, pools: 'array',
      n_pools: 1, params: 'object', summary: 'object', needs: 'object', excluded: 'array' });
    const cancelled = (await q(`SELECT status FROM site_visits WHERE tenant_id = $1 AND site_id = $2 AND period_month = make_date($3, 1, 1)`, [tenantId, sites[5], year])).rows;
    assert.deepEqual(cancelled, [{ status: 'annule' }], 'la visite annulée reste seule et intacte');

    // La MÊME demande renvoyée : les visites ont changé → 409, 0 visite de plus.
    const count = async () => Number((await q('SELECT count(*) FROM site_visits WHERE tenant_id = $1', [tenantId])).rows[0].count);
    const before = await count();
    await assert.rejects(service.apply(tenantId, userId, { ...body, fingerprint: p.fingerprint, sections: p.sections, keep, changes: [] }),
      (e) => e.statusCode === 409 && e.details.code === 'plan_inputs_changed' && e.details.sections.includes('visites'));
    assert.equal(await count(), before, '0 visite de plus');

    // Nouvel aperçu : rien sur une case qui a déjà une visite ; l'appliquer ne crée aucun doublon.
    const p2 = await service.preview(tenantId, body);
    const taken = new Set((await q('SELECT site_id || \'|\' || extract(month FROM period_month)::int AS k FROM site_visits WHERE tenant_id = $1', [tenantId])).rows.map((x) => x.k));
    assert.ok(!p2.proposals.some((x) => taken.has(`${x.siteId}|${x.month}`)), 'aucune proposition sur une case occupée');
    if (p2.proposals.length) {
      const r2 = await service.apply(tenantId, userId, { ...body, fingerprint: p2.fingerprint, sections: p2.sections, keep: p2.proposals.map((x) => ({ siteId: x.siteId, month: x.month })), changes: [] });
      assert.equal(r2.created, p2.proposals.length);
    }
    const dup = (await q(`SELECT count(*) FROM (SELECT site_id, period_month FROM site_visits WHERE tenant_id = $1 GROUP BY 1, 2 HAVING count(*) > 1) d`, [tenantId])).rows[0].count;
    assert.equal(Number(dup), 0, 'une visite par site × mois');
    const perSite = (await q(`SELECT site_id, count(*) AS n FROM site_visits WHERE tenant_id = $1 AND status <> 'annule' GROUP BY 1`, [tenantId])).rows;
    assert.ok(perSite.every((x) => Number(x.n) <= 2), 'jamais plus de visites que l\'exigence du MMR (2 par site)');
  } finally {
    if (tenantId) {
      // Compte jetable : tout part avec lui (clés ON DELETE CASCADE) ; plan_runs n'est pas effaçable par l'application.
      await q('DELETE FROM site_visits WHERE tenant_id = $1', [tenantId]).catch(() => {});
      await q('DELETE FROM plan_runs WHERE tenant_id = $1', [tenantId]).catch(() => {});
      await q('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => {});
    }
    await su.end();
    await db.pool.end();
  }
});
