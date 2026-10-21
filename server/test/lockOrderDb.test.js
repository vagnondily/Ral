/**
 * Lot « verrous » — ordre des verrous EN BASE RÉELLE, sur demande :
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables le test est ignoré.
 *
 * Ordre de tous les écrivains (tpm/visitLocks) : rattachements → mois des visites → lignes (sites,
 * localités) par identifiant → verrou d'attribution du compte → le reste. Chaque test met deux vrais
 * écrivains face à face ; une 3ᵉ connexion ne fait que RETARDER le premier une fois ses lignes prises
 * (verrou de table qu'il demande ensuite), le temps que le second se mette à attendre. Avant le lot :
 * le second attendait EN TENANT le verrou d'attribution (ou des lignes dans un autre ordre) et l'un des
 * deux finissait en 40P01 « deadlock detected » (503). Après : il attend sans tenir le verrou
 * d'attribution, et les deux aboutissent. Tout ce qu'un test écrit est supprimé à la fin.
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
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

let su = null;
async function connect() {
  const { Client } = require('pg');
  const c = new Client({ connectionString: SU_URL });
  await c.connect();
  return c;
}
async function q(sql, params) {
  if (!su) su = await connect();
  return (await su.query(sql, params)).rows;
}
test.after(async () => {
  if (su) await su.end();
  if (enabled) await require('../src/config/db').pool.end();
});

const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, code: e.code, status: e.statusCode, msg: String(e.message) }));
async function waitFor(pred, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return true; await sleep(15); }
  return false;
}
/** Nombre de sessions de la base qui attendent un verrou (hors la 3ᵉ connexion). */
const waiting = async (except) => (await q(`SELECT count(*)::int AS n FROM pg_stat_activity
  WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> ALL ($1::int[])`, [except]))[0].n;
/** Le verrou d'attribution du compte est-il libre ? Essai dans une transaction aussitôt annulée. */
async function attributionFree(T) {
  const { ATTRIBUTION_KEY } = require('../src/modules/tpm/tpmAttribution.repository');
  const c = await connect();
  try {
    await c.query('BEGIN');
    const { rows: [r] } = await c.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok', [ATTRIBUTION_KEY(T)]);
    await c.query('ROLLBACK');
    return r.ok;
  } finally { await c.end(); }
}
/**
 * Duel orchestré : `first` démarre et se bloque sur le verrou que tient `hold` (pris après ses lignes) ;
 * `second` démarre et se met à attendre ; on relève si le verrou d'attribution est libre à ce moment,
 * puis on libère `hold`. Rend { a, b, attributionFreeWhileWaiting }.
 */
async function duel(T, { holdSql, holdParams = [], first, firstBlockedOn, second }) {
  const hold = await connect();
  try {
    await hold.query('BEGIN');
    await hold.query(holdSql, holdParams);
    const pa = settle(first());
    assert.ok(await waitFor(async () => (await q(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()
      AND wait_event_type = 'Lock' AND query ~ $1`, [firstBlockedOn]))[0].n > 0), `premier écrivain retenu (${firstBlockedOn})`);
    const pb = settle(second());
    const done = { b: false }; pb.then(() => { done.b = true; });
    // Le second se met à attendre (ou a déjà fini, s'il n'a rien à attendre).
    await waitFor(async () => done.b || (await waiting([hold.processID])) >= 2);
    const free = await attributionFree(T);
    await hold.query('COMMIT');
    const [a, b] = [await pa, await pb];
    return { a, b, attributionFreeWhileWaiting: free };
  } finally {
    await hold.query('ROLLBACK').catch(() => {});
    await hold.end();
  }
}
const why = (r) => (r.ok ? 'ok' : `${r.code || r.status} ${r.msg}`);

async function fixture() {
  const [{ id: T }] = await q("SELECT id FROM tenants WHERE name = 'Bureau de Toliara' ORDER BY created_at LIMIT 1");
  const [{ id: U }] = await q("SELECT id FROM users WHERE tenant_id = $1 AND email = 'admin@mems.mg'", [T]);
  const { currentMonth } = require('../src/modules/tpm/rbmMath');
  const Y = Number(currentMonth().slice(0, 4)) + 1; // exercice à venir : mois toujours ouverts, sans grille d'activité
  return { T, U, Y };
}

test('#7 écrivain de sites (sites FOR UPDATE puis attribution) × coche du plan / nouvelle visite sur le même site : jamais d interblocage',
  { skip: SKIP, timeout: 120000 }, async () => {
    const { T, U, Y } = await fixture();
    const field = require('../src/modules/tpm/field.repository');
    const sites = await q(`SELECT s.id, s.programme_synergies AS syn FROM sites s WHERE s.tenant_id = $1 AND s.zone_district_id IS NOT NULL
                             AND NOT EXISTS (SELECT 1 FROM site_visits v WHERE v.site_id = s.id AND v.period_month >= $2::date) ORDER BY s.id LIMIT 2`, [T, `${Y}-01-01`]);
    assert.equal(sites.length, 2);
    try {
      for (const [i, second] of [
        [0, (S) => field.setPlannedMonths(T, U, { year: Y, changes: [{ siteId: S, month: 1, planned: true }] })],
        [1, (S) => field.createVisit(T, U, { siteId: S, periodMonth: `${Y}-02`, status: 'planifie' })],
      ]) {
        const S = sites[i].id;
        const r = await duel(T, {
          holdSql: 'LOCK TABLE location_match_queue IN SHARE MODE', // retient l'écrivain de sites APRÈS « sites FOR UPDATE »
          first: () => field.bulkUpdateSites(T, U, { year: Y, siteIds: [S], set: { synergies: 1 } }),
          firstBlockedOn: 'location_match_queue',
          second: () => second(S),
        });
        assert.equal(r.attributionFreeWhileWaiting, true, `visite ${i} : attend la ligne du site sans tenir le verrou d'attribution`);
        assert.equal(why(r.a), 'ok', 'écrivain de sites');
        assert.equal(why(r.b), 'ok', 'écrivain de visites');
      }
      assert.equal((await q('SELECT count(*)::int AS n FROM site_visits WHERE site_id = ANY($1::uuid[]) AND period_month >= $2::date',
        [sites.map((s) => s.id), `${Y}-01-01`]))[0].n, 2, 'les deux visites sont écrites');
    } finally {
      await q('DELETE FROM site_visits WHERE site_id = ANY($1::uuid[]) AND period_month >= $2::date', [sites.map((s) => s.id), `${Y}-01-01`]);
      for (const s of sites) await q('UPDATE sites SET programme_synergies = $2 WHERE id = $1', [s.id, s.syn]);
    }
  });
