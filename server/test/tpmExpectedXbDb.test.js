/**
 * Relecture croisée (lot 8 × retour 114 × plan auto) — rapports attendus EN BASE RÉELLE, sur demande :
 *   MEMS_TEST_DATABASE_URL      superutilisateur d'une base JETABLE (son nom contient « test »),
 *                               migrée puis peuplée (npm run seed && npm run seed:test) ;
 *   MEMS_TEST_APP_DATABASE_URL  rôle applicatif mems2_app sur la MÊME base (RLS active, comme l'API).
 * Sans ces variables les tests sont ignorés. Tout ce qu'un test écrit est supprimé à la fin.
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

let su = null;
async function q(sql, params) {
  if (!su) {
    const { Client } = require('pg');
    su = new Client({ connectionString: SU_URL });
    await su.connect();
  }
  return (await su.query(sql, params)).rows;
}
test.after(async () => {
  if (su) await su.end();
  if (enabled) await require('../src/config/db').pool.end();
});
const tenant = async () => (await q('SELECT id FROM tenants ORDER BY created_at, id LIMIT 1'))[0].id;

test('suivi interne (points 6, 18, 23) : l équipe d un site est son bureau RACINE, comme le plan automatique', { skip: SKIP }, async () => {
  const T = await tenant();
  const reports = require('../src/modules/tpm/reports.repository');
  const { rootOfficeOf } = require('../src/modules/common/officeScope');
  // Antenne de 3ᵉ niveau (antenne › antenne › bureau) et un de ses sites.
  const [chain] = await q(`SELECT o3.id AS o3, o2.name AS n2, o1.name AS n1, s.id AS site
                             FROM field_offices o3 JOIN field_offices o2 ON o2.id = o3.parent_id JOIN field_offices o1 ON o1.id = o2.parent_id
                             JOIN sites s ON s.tenant_id = o3.tenant_id AND s.field_office_id = o3.id
                            WHERE o3.tenant_id = $1 AND NOT o1.national ORDER BY o3.name, s.id LIMIT 1`, [T]);
  assert.ok(chain, 'un bureau à trois niveaux (npm run seed:test)');
  const offices = await q('SELECT id, parent_id AS "parentId", name, national FROM field_offices WHERE tenant_id = $1', [T]);
  assert.equal(rootOfficeOf(offices, chain.o3).name, chain.n1);
  // Une visite prévue d'un mois sans aucun contrat : suivi interne.
  const M = '2031-01';
  const [{ id: V }] = await q(`INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, provider_source)
                                VALUES ($1, $2, $3, 'Test point 6', 'planifie', 'zone') RETURNING id`, [T, chain.site, `${M}-01`]);
  try {
    const [v] = await q('SELECT monitored_by AS by FROM site_visits WHERE id = $1', [V]);
    assert.equal(v.by, 'interne');
    const own = (await reports.expectedReports(T, { period: { from: M, to: M }, today: '2026-10' })).rows.find((r) => r.unit.kind === 'interne');
    assert.ok(own, 'rapport interne attendu');
    assert.deepEqual(own.unit.offices, [chain.n1], `équipe : le bureau racine (${chain.n1}), jamais l'antenne intermédiaire (${chain.n2})`);
  } finally {
    await q('DELETE FROM site_visits WHERE id = $1', [V]);
  }
});
