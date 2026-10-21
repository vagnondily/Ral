/**
 * Relecture r114c (points 2, 3 et 13) — EN BASE RÉELLE, sur demande :
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables le test est ignoré.
 *
 *  - Point 13 : le `lock_timeout` de l'appelant survit au verrou d'attribution — lockAttributionTx, la
 *    fonction mems_tpm_stamp (migration 109) et restampVisitsTx le rétablissent, jamais DEFAULT.
 *  - Point 2 (relecture r2stamp, points 1 et 5 : garde STRUCTURELLE, jamais un seuil qui mesure l'état des
 *    statistiques) : mems_tpm_stamp porte `plan_cache_mode=force_custom_plan` (pg_proc.proconfig : sans lui,
 *    PL/pgSQL passait au plan générique au 6ᵉ appel d'une session) ; 4 000 visites couvertes par un
 *    contrat, tables touchées ANALYSÉES d'abord (état des statistiques fixé, celui de la production), puis
 *    7 appels dans UNE session mems2_app : les appels 6 et 7 au plus 3 fois la médiane des appels 2 à 5,
 *    et un plafond grossier de 15 s par appel. Mesuré (base analysée, migration 120) : 1ᵉʳ appel ~0,7 à 1 s
 *    (4 000 lignes écrites et leurs déclencheurs), les suivants 60 à 150 ms. Puis le premier document d'un
 *    TPM sur ce contrat, pour le plus ancien mois (reports.insertReport) : les 4 000 visites passées le
 *    suivent (un paquet par mois), sous 30 s.
 *  - Point 3 : contrat KB (district D) suivi par Y ; contrat K4 (commune C de D, titulaire W, TPM),
 *    commencé à M−3 — les visites passées de C, estampillées Y/KB avant K4, sont « en retard » (la
 *    règle dit W/K4) et le passé ne se réécrit pas en silence. Le premier plan de Z sur KB pour M−2 :
 *    les visites du district (hors C) suivent le lien ; celles de C, que la zone plus précise de K4
 *    décide (même cellule avant et après), ne changent pas. Plan supprimé : retour.
 */
const SU_URL = process.env.MEMS_TEST_DATABASE_URL;
const APP_URL = process.env.MEMS_TEST_APP_DATABASE_URL;
const dbName = (u) => { try { return decodeURIComponent(new URL(u).pathname.slice(1)); } catch { return ''; } };
const enabled = Boolean(SU_URL && APP_URL && /test/i.test(dbName(SU_URL)) && dbName(SU_URL) === dbName(APP_URL));
if (enabled) process.env.APP_DATABASE_URL = APP_URL;
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');

const SKIP = enabled ? false : 'base jetable absente (MEMS_TEST_DATABASE_URL / MEMS_TEST_APP_DATABASE_URL, nom contenant « test »)';
const addMonth = (m, n) => {
  const [y, mm] = m.split('-').map(Number);
  const i = y * 12 + (mm - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};

let su;
let T;
let U;
let types;
const q = async (sql, params) => (await su.query(sql, params)).rows;

test.before(async () => {
  if (!enabled) return;
  require('../src/jobs/outbox').nudgeOutbox = async () => {}; // aucun Redis pendant le test
  const { Client } = require('pg');
  su = new Client({ connectionString: SU_URL });
  await su.connect();
  [{ id: T }] = await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1');
  [{ id: U }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' ORDER BY email LIMIT 1", [T]);
  types = Object.fromEntries((await q('SELECT code, id FROM partner_types WHERE tenant_id = $1', [T])).map((r) => [r.code, r.id]));
});

test.after(async () => {
  if (!enabled) return;
  await su.end();
  await require('../src/config/db').pool.end();
});

/** Région → district(s) → commune de test, isolés : aucun contrat du jeu de données n'y a de zone. */
async function makeAreas(tag, districts = 1, withCommune = false) {
  const [{ id: R }] = await q("INSERT INTO admin_areas (tenant_id, depth, name, path) VALUES ($1, 1, $2, $2) RETURNING id", [T, `${tag} région`]);
  const out = { R, D: [], C: null, ids: [R], paths: {} };
  for (let i = 1; i <= districts; i += 1) {
    const path = `${tag} région > ${tag} district ${i}`;
    const [{ id }] = await q('INSERT INTO admin_areas (tenant_id, depth, name, parent_id, path) VALUES ($1, 2, $2, $3, $4) RETURNING id', [T, `${tag} district ${i}`, R, path]);
    out.D.push(id); out.ids.push(id); out.paths[id] = path;
  }
  if (withCommune) {
    const path = `${out.paths[out.D[0]]} > ${tag} commune`;
    const [{ id }] = await q('INSERT INTO admin_areas (tenant_id, depth, name, parent_id, path) VALUES ($1, 3, $2, $3, $4) RETURNING id', [T, `${tag} commune`, out.D[0], path]);
    out.C = id; out.ids.push(id); out.paths[id] = path;
  }
  return out;
}

/** Contrat de suivi (ligne IV.suivi > 0) actif sur une zone. */
async function makeContract(numero, { holder, holderName, from, to, area, path, depth }) {
  const [{ id }] = await q(
    `INSERT INTO contracts (tenant_id, numero, partner_id, partner_name, date_debut, date_fin, status, created_by)
     VALUES ($1, $2, $3, $4, $5, ($6::date + interval '1 month' - interval '1 day')::date, 'actif', $7) RETURNING id`,
    [T, numero, holder, holderName, `${from}-01`, `${to}-01`, U]);
  await q(`INSERT INTO contract_budget_items (contract_id, tenant_id, line_code, description, unit_count, unit_cost, allocations, sort_order)
           VALUES ($1, $2, 'IV.suivi', 'Suivi (test r114c)', 1, 1000, '{}'::jsonb, 0)`, [id, T]);
  await q('INSERT INTO contract_areas (contract_id, tenant_id, admin_area_id, path, depth, sort_order) VALUES ($1, $2, $3, $4, $5, 0)', [id, T, area, path, depth]);
  return id;
}

async function cleanup(made) {
  if (made.visits && made.visits.length) await q('DELETE FROM site_visits WHERE id = ANY ($1::uuid[])', [made.visits]);
  if (made.sites && made.sites.length) await q('DELETE FROM site_visits WHERE site_id = ANY ($1::uuid[])', [made.sites]);
  if (made.reports && made.reports.length) await q('DELETE FROM tpm_reports WHERE id = ANY ($1::uuid[])', [made.reports]);
  if (made.plans && made.plans.length) await q('DELETE FROM tpm_collection_plans WHERE id = ANY ($1::uuid[])', [made.plans]);
  for (const k of made.contracts || []) {
    await q('DELETE FROM contract_areas WHERE contract_id = $1', [k]);
    await q('DELETE FROM contract_budget_items WHERE contract_id = $1', [k]);
    await q('DELETE FROM contracts WHERE id = $1', [k]);
  }
  if (made.sites && made.sites.length) await q('DELETE FROM sites WHERE id = ANY ($1::uuid[])', [made.sites]);
  if (made.areas && made.areas.length) await q('DELETE FROM admin_areas WHERE id = ANY ($1::uuid[])', [made.areas]);
  // Le journal d'attribution (inscription seule) peut garder un partenaire : il reste alors, inactif.
  if (made.partners && made.partners.length) {
    await q('DELETE FROM partners WHERE id = ANY ($1::uuid[])', [made.partners])
      .catch(() => q('UPDATE partners SET active = false WHERE id = ANY ($1::uuid[])', [made.partners]));
  }
}

test('point 13 : le délai d attente de l appelant survit au verrou d attribution (JS, mems_tpm_stamp, restampVisitsTx)', { skip: SKIP, timeout: 60000 }, async () => {
  const { withTenantTransaction } = require('../src/config/db');
  const tpm = require('../src/modules/tpm/tpmAttribution.repository');
  await withTenantTransaction(T, async (client) => {
    const now = async () => (await client.query("SELECT current_setting('lock_timeout') AS v")).rows[0].v;
    const initial = await now();
    await tpm.lockAttributionTx(client, T);
    assert.equal(await now(), initial, 'sans réglage de l appelant : inchangé');
    await client.query("SET LOCAL lock_timeout = '7s'");
    await tpm.lockAttributionTx(client, T);
    assert.equal(await now(), '7s', 'lockAttributionTx rétablit la valeur de l appelant');
    await client.query("SELECT count(*) FROM mems_tpm_stamp($1, '{}'::uuid[])", [T]);
    assert.equal(await now(), '7s', 'mems_tpm_stamp aussi');
    await client.query("SET LOCAL lock_timeout = '20s'");
    await tpm.restampVisitsTx(client, T, { restampIds: [] });
    assert.equal(await now(), '20s', 'le 20 s d un écrivain de plan survit à restampVisitsTx');
    assert.equal((await client.query("SELECT current_setting('mems.tpm_stamping', true) AS v")).rows[0].v, 'off');
    assert.equal((await client.query("SELECT current_setting('plan_cache_mode') AS v")).rows[0].v, 'auto', 'le réglage de la fonction ne fuit pas');
  });
});

test('point 2 : 4 000 visites couvertes — mems_tpm_stamp 7 fois de suite (mems2_app), jamais le plan générique ; premier document d un TPM : toutes suivent',
  { skip: SKIP, timeout: 300000 }, async () => {
    const { Client } = require('pg');
    const reports = require('../src/modules/tpm/reports.repository');
    const { currentMonth } = require('../src/modules/tpm/rbmMath');
    const made = { visits: [], sites: [], reports: [], contracts: [], areas: [], partners: [] };
    try {
      const M = currentMonth();
      const A = await makeAreas('Test r114c perf');
      made.areas = A.ids.slice().reverse();
      const mk = async (name, type) => (await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id', [T, types[type], name]))[0].id;
      const X = await mk('Test r114c perf titulaire', 'tpm');
      const P = await mk('Test r114c perf TPM', 'tpm');
      made.partners = [X, P];
      const K = await makeContract('TEST-R114C-PERF', { holder: X, holderName: 'Test r114c perf titulaire', from: addMonth(M, -48), to: addMonth(M, 6), area: A.D[0], path: A.paths[A.D[0]], depth: 2 });
      made.contracts = [K];
      made.sites = (await q(`INSERT INTO sites (tenant_id, code, name, zone_district_id)
                             SELECT $1, 'TEST-R114C-PERF-' || g, 'Site perf r114c ' || g, $2 FROM generate_series(1, 100) g RETURNING id`, [T, A.D[0]])).map((r) => r.id);
      // 40 mois passés × 100 sites, estampillés « à l'ancienne » (sans TPM) sous le drapeau de l'estampille.
      await q('BEGIN');
      await q("SELECT set_config('mems.tpm_stamping', 'on', true)");
      made.visits = (await q(
        `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source, provider_zone_state)
         SELECT $1, s, (date_trunc('month', $3::date) - make_interval(months => g))::date, 'Test r114c perf', 'planifie', 'zone', 'sans_tpm'
           FROM unnest($2::uuid[]) s, generate_series(1, 40) g RETURNING id`, [T, made.sites, `${M}-01`])).map((r) => r.id);
      await q('COMMIT');
      assert.equal(made.visits.length, 4000);
      // Garde structurelle : la fonction est planifiée à chaque appel avec ses valeurs (migration 109).
      const [{ conf }] = await q("SELECT proconfig AS conf FROM pg_proc WHERE proname = 'mems_tpm_stamp'");
      assert.ok((conf || []).includes('plan_cache_mode=force_custom_plan'), `proconfig : ${JSON.stringify(conf)}`);
      // Migration 120 : l'estimation juste de la politique de sécurité (tenant_id::text) sur ces tables.
      const [{ n: stx }] = await q("SELECT count(*)::int AS n FROM pg_statistic_ext WHERE stxname LIKE '%\\_tenant\\_text\\_stx'");
      assert.equal(stx, 12, 'statistiques d expression de la migration 120');
      // État des statistiques FIXÉ (celui de la production, autovacuum) : tables lues par mems_tpm_cells analysées.
      await q(`ANALYZE sites, site_visits, contracts, contract_budget_items, contract_areas, admin_areas, partners, partner_types,
                       tpm_collection_plans, tpm_reports, tpm_zone_overrides, tpm_unavailability`);

      // Sept appels de suite dans UNE session du rôle applicatif (RLS) ; tout est annulé ensuite.
      const app = new Client({ connectionString: APP_URL });
      await app.connect();
      const ms = [];
      try {
        await app.query('BEGIN');
        await app.query("SELECT set_config('app.tenant_id', $1, true)", [T]);
        await app.query("SET LOCAL statement_timeout = '60s'");
        for (let i = 0; i < 7; i += 1) {
          const t0 = process.hrtime.bigint();
          const { rows: [r] } = await app.query('SELECT count(*)::int AS n FROM mems_tpm_stamp($1, $2::uuid[])', [T, made.visits]);
          ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
          assert.equal(r.n, i === 0 ? 4000 : 0, `appel ${i + 1} : ${i === 0 ? 'toutes estampillées' : 'rien à changer'}`);
        }
      } finally {
        await app.query('ROLLBACK').catch(() => {});
        await app.end();
      }
      const all = ms.map(Math.round).join(', ');
      // Relatif, jamais absolu : les appels 6 et 7 (là où le plan générique arrivait) au plus 3 fois la médiane
      // des appels 2 à 5 (+ 100 ms de marge pour une machine chargée) ; plafond grossier de 15 s par appel.
      const median = [...ms.slice(1, 5)].sort((x, y) => x - y).slice(1, 3).reduce((x, y) => x + y, 0) / 2;
      for (const [i, t] of ms.entries()) assert.ok(t < 15000, `appel ${i + 1} : ${Math.round(t)} ms, plafond 15 s (${all} ms)`);
      for (const i of [5, 6]) {
        assert.ok(ms[i] <= 3 * median + 100, `appel ${i + 1} : ${Math.round(ms[i])} ms > 3 × médiane des appels 2 à 5 (${Math.round(median)} ms) — plan générique ? (${all} ms)`);
      }

      // Premier document de P sur K pour le plus ancien mois : les 4 000 visites passées suivent P (un paquet par mois).
      const t0 = Date.now();
      made.reports.push(await reports.insertReport(T, { partnerId: P, contractId: K, periodMonth: `${addMonth(M, -40)}-01`, kind: 'technique', createdBy: U }));
      const elapsed = Date.now() - t0;
      const [after] = await q(`SELECT count(*) FILTER (WHERE provider_id = $2 AND provider_zone_state = 'contrat' AND contract_id = $3)::int AS n
                                 FROM site_visits WHERE id = ANY ($1::uuid[])`, [made.visits, P, K]);
      assert.equal(after.n, 4000, 'toutes les visites passées suivent le TPM rattaché');
      assert.ok(elapsed < 30000, `premier document : ${elapsed} ms (mesuré ~1,5 à 3 s ; plafond grossier)`);
    } finally {
      await cleanup(made);
    }
  });

test('point 3 : passé d un lien — seules les visites que le lien décide ; jamais celles d une zone plus précise d un autre contrat',
  { skip: SKIP, timeout: 180000 }, async () => {
    const planning = require('../src/modules/tpm/planning.repository');
    const { currentMonth } = require('../src/modules/tpm/rbmMath');
    const made = { visits: [], sites: [], plans: [], contracts: [], areas: [], partners: [] };
    try {
      const M = currentMonth();
      const A = await makeAreas('Test r114c imbrique', 1, true);
      made.areas = A.ids.slice().reverse();
      const D = A.D[0]; const C = A.C;
      const mk = async (name, type) => (await q('INSERT INTO partners (tenant_id, partner_type_id, name) VALUES ($1, $2, $3) RETURNING id', [T, types[type], name]))[0].id;
      const H = await mk('Test r114c mise en oeuvre', 'prestataire');
      const Y = await mk('Test r114c TPM Y', 'tpm');
      const Z = await mk('Test r114c TPM Z', 'tpm');
      const W = await mk('Test r114c TPM W', 'tpm');
      made.partners = [H, Y, Z, W];
      // KB : district D, titulaire H (mise en œuvre) ; Y rattaché par un plan de M−4.
      const KB = await makeContract('TEST-R114C-KB', { holder: H, holderName: 'Test r114c mise en oeuvre', from: addMonth(M, -8), to: addMonth(M, 6), area: D, path: A.paths[D], depth: 2 });
      made.contracts.push(KB);
      made.plans.push(await planning.createPlan(T, { partnerId: Y, contractId: KB, periodMonth: `${addMonth(M, -4)}-01`, title: 'Test r114c plan Y', items: [], createdBy: U }));
      // S dans la commune C, S2 dans le district hors de C ; visites prévues de M−2 et M−1, estampillées au COMMIT.
      const [s1, s2] = await q(`INSERT INTO sites (tenant_id, code, name, zone_district_id, zone_commune_id)
                                VALUES ($1, 'TEST-R114C-S', 'Site r114c commune', $2, $3), ($1, 'TEST-R114C-S2', 'Site r114c district', $2, NULL) RETURNING id`, [T, D, C]);
      made.sites = [s1.id, s2.id];
      const months = [addMonth(M, -2), addMonth(M, -1)];
      const ins = await q(
        `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source)
         SELECT $1, s, m::date, 'Test r114c', 'planifie', 'zone' FROM unnest($2::uuid[]) s, unnest($3::text[]) m RETURNING id, site_id, to_char(period_month, 'YYYY-MM') AS m`,
        [T, made.sites, months.map((m) => `${m}-01`)]);
      made.visits = ins.map((r) => r.id);
      const name = (r) => `${r.site_id === s1.id ? 'S' : 'S2'}@${r.m}`;
      const read = async () => Object.fromEntries((await q(
        `SELECT site_id, to_char(period_month, 'YYYY-MM') AS m, provider_zone_state AS st, provider_id AS p, contract_id AS k
           FROM site_visits WHERE id = ANY ($1::uuid[])`, [made.visits])).map((r) => [name(r), [r.st, r.p, r.k]]));
      const cells = async () => Object.fromEntries((await q(
        `SELECT c_site_id AS site_id, to_char(c_month, 'YYYY-MM') AS m, c_state AS st, c_provider_id AS p, c_contract_id AS k
           FROM mems_tpm_cells($1, $2::uuid[], $3::date[])`,
        [T, ins.map((r) => r.site_id), ins.map((r) => `${r.m}-01`)])).map((r) => [name(r), [r.st, r.p, r.k]]));
      const keys = ins.map(name);
      const stampedYKB = Object.fromEntries(keys.map((k) => [k, ['contrat', Y, KB]]));
      assert.deepEqual(await read(), stampedYKB, 'toutes estampillées Y/KB');

      // K4 : commune C, titulaire W (TPM), dès M−3 — posé sans ré-estampille du passé : les visites de C sont « en retard ».
      const K4 = await makeContract('TEST-R114C-K4', { holder: W, holderName: 'Test r114c TPM W', from: addMonth(M, -3), to: addMonth(M, 6), area: C, path: A.paths[C], depth: 3 });
      made.contracts.push(K4);
      const rule = await cells();
      for (const m of months) {
        assert.deepEqual(rule[`S@${m}`], ['contrat', W, K4], `S@${m} : la zone plus précise (K4) décide`);
        assert.deepEqual(rule[`S2@${m}`], ['contrat', Y, KB]);
      }
      assert.deepEqual(await read(), stampedYKB, 'le passé ne se réécrit pas en silence');

      // Premier plan de Z sur KB pour M−2 : le lien décide S2 (KB : Y et Z), jamais S (K4 avant comme après).
      const planZ = await planning.createPlan(T, { partnerId: Z, contractId: KB, periodMonth: `${months[0]}-01`, title: 'Test r114c plan Z', items: [], createdBy: U });
      made.plans.push(planZ);
      let v = await read();
      const ruleZ = await cells();
      for (const m of months) {
        assert.deepEqual(v[`S@${m}`], ['contrat', Y, KB], `S@${m} : décidée par K4, jamais réécrite par le lien de KB`);
        assert.deepEqual(v[`S2@${m}`], ruleZ[`S2@${m}`], `S2@${m} : suit le lien (règle)`);
        assert.notDeepEqual(v[`S2@${m}`], ['contrat', Y, KB], `S2@${m} : a changé`);
      }
      // Dernier document de Z supprimé : S2 revient à Y/KB ; S toujours inchangée.
      assert.equal(await planning.deletePlan(T, planZ, { actorId: U, isAdmin: true }), 'ok');
      made.plans = made.plans.filter((x) => x !== planZ);
      v = await read();
      assert.deepEqual(v, stampedYKB, 'retour : S2 à Y/KB, S jamais touchée');
    } finally {
      await cleanup(made);
    }
  });
